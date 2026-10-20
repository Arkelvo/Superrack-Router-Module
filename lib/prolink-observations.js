'use strict'

const { decodeOsc } = require('./prolink-osc')
const { ProLinkControllerState } = require('./prolink-controller-state')
const { ProLinkRequestTracker } = require('./prolink-request-tracker')
const { ProLinkSnapshots } = require('./prolink-snapshots')

const COMMAND_RESULT_TIMEOUT_MS = 2500
const CONTROLLER_READBACK_TIMEOUT_MS = 2500
const REMOTE_PREFIX = '/waves.com/remote/'
const NOTIFY_STATUS = {
	NotifySyncStatus: 'prolink_sync_status',
	NotifyIOBoxStatus: 'prolink_iobox_status',
	NotifySGSStatus: 'prolink_sgs_status',
	NotifyRemoteOperation: 'prolink_remote_operation',
	NotifySnapshotDirty: 'prolink_snapshot_dirty',
	NotifySessionDirty: 'prolink_session_dirty',
}

class ProLinkObservations {
	constructor(instance) {
		this.instance = instance
		this.racks = new Map() // 1-based rack IDs, only observed state
		this.statuses = new Map()
		this.requestTracker = new ProLinkRequestTracker({
			timeoutMs: COMMAND_RESULT_TIMEOUT_MS,
			onTimeout: ({ command, sequence, expectedReply }) => {
				this.lastCommandStatus = 'unconfirmed'
				this.instance.setVariableValues({
					prolink_command_pending: this.pending.size,
					prolink_last_command: command,
					prolink_last_command_status: 'unconfirmed',
					prolink_last_result_text: expectedReply
						? `No ${expectedReply} received before timeout (not proof of failure)`
						: 'No ResultCommand received before timeout (not proof of failure)',
				})
				this.log('warn', '[PROLINK_UNCONFIRMED]', { command, sequence, expectedReply })
			},
		})
		// Preserve the existing Map-shaped interface for older tests / callers.
		this.pending = this.requestTracker.pending
		this.lastCommandStatus = ''
		this.lastReply = null
		this.snapshots = new ProLinkSnapshots(instance)
		this.controllerState = new ProLinkControllerState()
		this.controllerWrite = null
	}

	log(level, message, data) {
		// Preserve the existing onDebugFrame debugger and the specialized controller deltas.
		if (level === 'debug' && typeof this.instance._prolink?.onDebugFrame === 'function' &&
			!message.startsWith('[PROLINK_CONTROLLER_')) return
		this.instance._log(level, message, data)
	}

	reset() {
		if (this.racks.size === 0 && this.statuses.size === 0 && this.pending.size === 0 &&
			!this.lastCommandStatus && !this.lastReply && !this.controllerState.hasData() && !this.controllerWrite &&
			!this.snapshots.currentKnown && !this.snapshots.listKnown && this.snapshots.names.size === 0) return
		const hadNames = this.racks.size > 0 || this.snapshots.listKnown
		this.requestTracker.reset()
		if (this.controllerWrite?.timer) clearTimeout(this.controllerWrite.timer)
		this.controllerWrite = null
		this.racks.clear()
		this.statuses.clear()
		this.lastCommandStatus = ''
		this.lastReply = null
		const values = {
			...this.controllerState.reset(),
			...this.snapshots.reset(),
			prolink_controller_write_status: 'idle',
			prolink_controller_write_delta: '',
			prolink_controller_write_sent_ms: '',
			prolink_controller_write_observed_ms: '',
			prolink_command_pending: 0,
			prolink_last_command_status: '',
			prolink_last_command: '',
			prolink_last_ack_sequence: '',
			prolink_last_result: '',
			prolink_last_result_text: '',
			prolink_touch_ownership: '',
			prolink_last_reply_command: '',
			prolink_last_reply_sequence: '',
			prolink_last_reply_args: '',
			prolink_last_reply_matched: false,
			prolink_last_reply_request: '',
			prolink_last_reply_target_id: '',
		}
		for (const variable of Object.values(NOTIFY_STATUS)) values[variable] = ''
		for (let rack = 1; rack <= 64; rack++) {
			values[`rack_${rack}_name`] = ''
			values[`rack_${rack}_muted`] = ''
			values[`rack_${rack}_on`] = ''
			values[`rack_${rack}_known`] = false
		}
		this.instance.setVariableValues(values)
		this.instance.checkFeedbacks?.('prolink_rack_muted', 'prolink_rack_on', 'prolink_controller_observed')
		if (hadNames) this.instance.updateActions?.()
	}

	track(command, sequence, argument) {
		if (!this.requestTracker.track(command, sequence, argument)) return
		this.lastCommandStatus = 'pending'
		this.instance.setVariableValues({
			prolink_command_pending: this.pending.size,
			prolink_last_command: command,
			prolink_last_command_status: 'pending',
		})
	}

	receive(frame) {
		if (frame.type !== 5) return
		let message
		try {
			message = decodeOsc(frame.payload)
		} catch (error) {
			this.log('warn', '[PROLINK_OSC_INVALID]', { error: error.message })
			return
		}
		const { path, args } = message
		if (!path.startsWith(REMOTE_PREFIX)) return
		const command = path.slice(REMOTE_PREFIX.length)
		if (command.startsWith('Give')) return this.observeReply(command, args)
		if (command === 'NotifyControllerValue') return this.observeControllerValue(args)
		if (command === 'NotifyControllerProperties') return this.observeControllerProperties(args)
		if (command === 'NotifyRacksConfigChanged') return this.observeRacks(args)
		if (command === 'ResultCommand') return this.observeResult(args)
		const statusVariable = NOTIFY_STATUS[command]
		if (statusVariable) return this.observeStatus(command, statusVariable, args)
		if (command === 'NotifyTouchAndTurnControlOwnership') {
			return this.observeStatus(command, 'prolink_touch_ownership', args)
		}
		this.log('debug', '[PROLINK_RX]', { path, args: JSON.stringify(args).slice(0, 1024) })
	}

	observeReply(command, args) {
		// Payload layouts remain raw until checked against captured replies.
		if (!Array.isArray(args) || !args.length || !Number.isInteger(args[0])) return
		const sequence = args[0]
		const tracked = this.pending.get(sequence)
		const snapshotReply = ['GiveCurrentSnapshotNumber', 'GiveSnapshotName', 'GiveListOfSnapshot'].includes(command)
		if (snapshotReply && tracked?.expectedReply === command &&
			!this.snapshots.accepts(command, args.slice(1), tracked)) {
			this.log('warn', '[PROLINK_SNAPSHOT_REPLY_INVALID]', { command, sequence, argumentCount: args.length - 1 })
			return
		}
		const request = this.requestTracker.receiveReply(command, sequence)
		const matched = !!request
		const encoded = JSON.stringify(args.slice(1)).slice(0, 8192)
		// A duplicate Give* must not overwrite an already matched reply as unmatched.
		const identity = JSON.stringify([command, sequence, encoded])
		if (identity === this.lastReply) return
		this.lastReply = identity
		this.instance.setVariableValues({
			prolink_last_reply_command: command,
			prolink_last_reply_sequence: sequence,
			prolink_last_reply_args: encoded,
			prolink_last_reply_matched: matched,
			prolink_last_reply_request: request?.command || '',
			prolink_last_reply_target_id: request?.argument ?? '',
			prolink_command_pending: this.pending.size,
			...(matched ? { prolink_last_command: request.command, prolink_last_command_status: 'replied' } : {}),
		})
		if (matched) {
			if (snapshotReply) this.snapshots.accept(command, args.slice(1), request)
			this.lastCommandStatus = 'replied'
			this.log('debug', '[PROLINK_QUERY_REPLY]', { command, sequence, request: request.command, targetId: request.argument })
		}
	}

	trackControllerWrite({ delta, contextVersion, previousSignature }) {
		// A readback is observational, not proof that our command caused the change.
		if (this.controllerWrite?.timer) clearTimeout(this.controllerWrite.timer)
		const write = { delta, contextVersion, previousSignature, timer: null }
		this.controllerWrite = write
		write.timer = setTimeout(() => {
			if (this.controllerWrite !== write) return
			this.controllerWrite = null
			this.instance.setVariableValues({ prolink_controller_write_status: 'unconfirmed' })
			this.log('warn', '[PROLINK_CONTROLLER_READBACK_UNCONFIRMED]', { delta })
		}, CONTROLLER_READBACK_TIMEOUT_MS)
		write.timer.unref?.()
		this.instance.setVariableValues({
			prolink_controller_write_status: 'awaiting_change',
			prolink_controller_write_delta: delta,
			prolink_controller_write_sent_ms: Date.now(),
			prolink_controller_write_observed_ms: '',
		})
	}

	_finishControllerWrite(status, timestamp) {
		if (!this.controllerWrite) return
		clearTimeout(this.controllerWrite.timer)
		this.controllerWrite = null
		const values = { prolink_controller_write_status: status }
		if (status === 'observed_after_send') values.prolink_controller_write_observed_ms = timestamp
		this.instance.setVariableValues(values)
	}

	observeControllerProperties(args) {
		const observation = this.controllerState.observeProperties(args)
		if (!observation) {
			this.log('warn', '[PROLINK_CONTROLLER_PROPERTIES_INVALID]', { count: args.length })
			return
		}
		if (!observation.changed) return
		if (this.controllerWrite) this._finishControllerWrite('context_changed')
		this.instance.setVariableValues(observation.values)
		this.instance.checkFeedbacks?.('prolink_controller_observed')
		this.log('debug', '[PROLINK_CONTROLLER_PROPERTIES_CHANGED]', observation.log)
	}

	observeControllerValue(args) {
		const observation = this.controllerState.observeValue(args)
		if (!observation) {
			this.log('warn', '[PROLINK_CONTROLLER_VALUE_INVALID]', { count: args.length })
			return
		}
		if (!observation.changed) return
		const write = this.controllerWrite
		if (write && this.controllerState.contextVersion === write.contextVersion &&
			this.controllerState.value.signature !== write.previousSignature) {
			this._finishControllerWrite('observed_after_send', observation.values.prolink_controller_last_value_update_ms)
		}
		this.instance.setVariableValues(observation.values)
		this.instance.checkFeedbacks?.('prolink_controller_observed')
		this.log('debug', '[PROLINK_CONTROLLER_VALUE_CHANGED]', observation.log)
	}

	observeStatus(command, variable, args) {
		if (args.length === 0) return
		const value = args.length === 1 ? args[0] : args
		const encoded = JSON.stringify(value)
		if (this.statuses.get(variable) === encoded) return
		const previous = this.statuses.get(variable)
		this.statuses.set(variable, encoded)
		this.instance.setVariableValues({ [variable]: Array.isArray(value) ? encoded : value })
		this.log('debug', '[PROLINK_STATUS_CHANGED]', {
			command,
			previous: previous === undefined ? null : JSON.parse(previous),
			value,
		})
	}

	observeRacks(args) {
		const [count, ...rows] = args
		if (count !== 64 || rows.length !== count) {
			this.log('warn', '[PROLINK_RACKS_INVALID]', { count, rows: rows.length })
			return
		}
		const seen = new Set()
		for (const row of rows) {
			if (!Array.isArray(row) || row.length !== 11 ||
				!Number.isInteger(row[0]) || row[0] < 0 || row[0] >= 64 || seen.has(row[0]) ||
				typeof row[1] !== 'string' || typeof row[8] !== 'boolean' || typeof row[9] !== 'boolean' ||
				![2, 3, 4, 5, 6, 7, 10].every((i) => Number.isInteger(row[i]))) {
				this.log('warn', '[PROLINK_RACKS_INVALID]', { reason: 'Invalid rack entry' })
				return
			}
			seen.add(row[0])
		}
		const changed = {}
		let renamed = false
		for (const row of rows) {
			const rack = row[0] + 1
			const next = { name: row[1], muted: row[8], on: row[9], raw: row }
			const previous = this.racks.get(rack)
			if (previous && JSON.stringify(previous.raw) === JSON.stringify(row)) continue
			this.racks.set(rack, next)
			changed[`rack_${rack}_known`] = true
			if (!previous || previous.name !== next.name) {
				changed[`rack_${rack}_name`] = next.name
				renamed = true
			}
			if (!previous || previous.muted !== next.muted) changed[`rack_${rack}_muted`] = next.muted
			if (!previous || previous.on !== next.on) changed[`rack_${rack}_on`] = next.on
			if (previous) {
				const differences = row.flatMap((value, i) => Object.is(value, previous.raw[i]) ? [] : [{
					field: ['id', 'name', 'int1', 'int2', 'int3', 'int4', 'int5', 'int6', 'mute', 'on', 'int7'][i],
					from: previous.raw[i], to: value,
				}])
				this.log('debug', '[PROLINK_RACK_CHANGED]', { rack, name: next.name, changes: differences })
			}
		}
		if (Object.keys(changed).length) {
			this.instance.setVariableValues(changed)
			this.instance.checkFeedbacks?.('prolink_rack_muted', 'prolink_rack_on')
		}
		if (renamed) this.instance.updateActions?.()
	}

	observeResult(args) {
		if (args.length !== 3 || !Number.isInteger(args[0]) || !Number.isInteger(args[1]) || typeof args[2] !== 'string') {
			this.log('warn', '[PROLINK_RESULT_INVALID]', { args: JSON.stringify(args).slice(0, 256) })
			return
		}
		const [sequence, resultCode, resultText] = args
		const result = this.requestTracker.receiveResult(sequence, resultCode, resultText)
		if (!result || result.duplicate) {
			this.log('debug', '[PROLINK_RESULT_UNMATCHED]', { sequence, resultCode, resultText })
			return
		}
		const pending = result.item
		const status = result.success ? 'succeeded' : 'rejected_or_unknown'
		this.lastCommandStatus = status
		this.instance.setVariableValues({
			prolink_command_pending: this.pending.size,
			prolink_last_ack_sequence: sequence,
			prolink_last_command: pending.command,
			prolink_last_result: resultCode,
			prolink_last_result_text: resultText,
			prolink_last_command_status: status,
		})
		this.log('debug', '[PROLINK_COMMAND_RESULT]', { command: pending.command, sequence, resultCode, resultText, status })
	}
}

module.exports = { ProLinkObservations }
