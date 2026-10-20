'use strict'

const { decodeOsc } = require('./prolink-osc')

const COMMAND_RESULT_TIMEOUT_MS = 2500
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
		this.racks = new Map() // 1-based rack IDs => observed values, never inferred from sent actions
		this.statuses = new Map()
		this.pending = new Map() // signed int32 request sequence => pending command
		this.lastCommandStatus = ''
	}

	log(level, message, data) {
		// If the user's existing decoded OSC debugger is installed, it already
		// logs rack diffs, command results and other incoming messages.
		// Keep that debugging unchanged without adding duplicate debug lines.
		if (level === 'debug' && typeof this.instance._prolink?.onDebugFrame === 'function') return
		this.instance._log(level, message, data)
	}

	reset() {
		if (this.racks.size === 0 && this.statuses.size === 0 && this.pending.size === 0 && !this.lastCommandStatus) return
		const hadNames = this.racks.size > 0
		for (const pending of this.pending.values()) clearTimeout(pending.timer)
		this.pending.clear()
		this.racks.clear()
		this.statuses.clear()
		this.lastCommandStatus = ''
		const values = {
			prolink_command_pending: 0,
			prolink_last_command_status: '',
			prolink_last_command: '',
			prolink_last_ack_sequence: '',
			prolink_last_result: '',
			prolink_last_result_text: '',
			prolink_touch_ownership: '',
		}
		for (const variable of Object.values(NOTIFY_STATUS)) values[variable] = ''
		for (let rack = 1; rack <= 64; rack++) {
			values[`rack_${rack}_name`] = ''
			values[`rack_${rack}_muted`] = ''
			values[`rack_${rack}_on`] = ''
			values[`rack_${rack}_known`] = false
		}
		this.instance.setVariableValues(values)
		this.instance.checkFeedbacks?.('prolink_rack_muted', 'prolink_rack_on')
		if (hadNames) this.instance.updateActions?.()
	}

	track(command, sequence) {
		if (!Number.isInteger(sequence)) return
		if (this.pending.has(sequence)) clearTimeout(this.pending.get(sequence).timer)
		const timer = setTimeout(() => {
			if (!this.pending.has(sequence)) return
			this.pending.delete(sequence)
			this.lastCommandStatus = 'unconfirmed'
			this.instance.setVariableValues({
				prolink_command_pending: this.pending.size,
				prolink_last_command: command,
				prolink_last_command_status: 'unconfirmed',
				prolink_last_result_text: 'No ResultCommand received before timeout (not proof of failure)',
			})
			this.log('warn', '[PROLINK_UNCONFIRMED]', { command, sequence })
		}, COMMAND_RESULT_TIMEOUT_MS)
		timer.unref?.()
		this.pending.set(sequence, { command, timer })
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
		if (command === 'NotifyRacksConfigChanged') return this.observeRacks(args)
		if (command === 'ResultCommand') return this.observeResult(args)
		const statusVariable = NOTIFY_STATUS[command]
		if (statusVariable) return this.observeStatus(command, statusVariable, args)
		if (command === 'NotifyTouchAndTurnControlOwnership') {
			return this.observeStatus(command, 'prolink_touch_ownership', args)
		}
		this.log('debug', '[PROLINK_RX]', { path, args: JSON.stringify(args).slice(0, 1024) })
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
				![2, 3, 4, 5, 6, 7, 10].every(i => Number.isInteger(row[i]))) {
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
				const differences = row.flatMap((value, i) => Object.is(value, previous.raw[i]) ? [] : [{ field: ['id', 'name', 'int1', 'int2', 'int3', 'int4', 'int5', 'int6', 'mute', 'on', 'int7'][i], from: previous.raw[i], to: value }])
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
		const pending = this.pending.get(sequence)
		if (!pending) {
			this.log('debug', '[PROLINK_RESULT_UNMATCHED]', { sequence, resultCode, resultText })
			return
		}
		clearTimeout(pending.timer)
		this.pending.delete(sequence)
		const success = resultCode === 0 && resultText === `${REMOTE_PREFIX}${pending.command} succeeded`
		const status = success ? 'succeeded' : 'rejected_or_unknown'
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
