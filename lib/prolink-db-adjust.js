'use strict'

// Experimental calibrated adapter for one LIVE-VERIFIED control: PSE Threshold.
// The selected control has no explicit rack/plugin/parameter address in ProLink;
// these updates are best-effort focus-bound observations, not command acks.
const DB_PER_RAW = 0.06 // PSE Threshold live measurements: magnitude 1 => 1 raw, 4 => 16, 8 => 64
const LEVEL_MIN_DB = -60
const LEVEL_MAX_DB = 0
const DB_CHOICES = new Set(['0.1', '0.5', '1', '3'])
const READBACK_TIMEOUT_MS = 2500
const MAX_QUEUE = 8
const MAX_COMMANDS_PER_REQUEST = 8
const RAW_TOLERANCE = 0.25 // Double carries fractional raw offset; step differences should be integers.

function confirmedPseThreshold(state) {
	const p = state?.properties?.values
	const v = state?.value?.values
	return Array.isArray(p) && p.length === 13 && p[0] === 'Threshold' &&
		p[5] === 'dB' && p[10] === 'PSE' &&
		p[3] === LEVEL_MIN_DB && p[4] === LEVEL_MAX_DB &&
		Array.isArray(v) && typeof v[1] === 'number' && Number.isFinite(v[1]) &&
		v[1] >= -RAW_TOLERANCE && v[1] <= 1000 + RAW_TOLERANCE
}

function selectMagnitude(remainingRaw) {
	if (!Number.isInteger(remainingRaw) || remainingRaw === 0) return null
	return Math.min(8, Math.floor(Math.sqrt(Math.abs(remainingRaw))))
}

class ProLinkDbAdjust {
	constructor(instance, observations) {
		this.instance = instance
		this.observations = observations
		this.queue = []
		this.active = null
		this.timer = null
		this.residualRaw = 0
		this.lastContext = null
	}

	write(values) {
		this.instance.setVariableValues(values)
	}

	fail(reason) {
		return this.instance._controlFailure(`ProLink dB adjustment: ${reason}`)
	}

	reset() {
		this.stopTimer()
		this.active = null
		this.queue = []
		this.residualRaw = 0
		this.lastContext = null
		return {
			prolink_db_status: 'idle',
			prolink_db_requested: '',
			prolink_db_observed: '',
			prolink_db_target_raw: '',
			prolink_db_remaining_raw: '',
			prolink_db_queue_length: 0,
			prolink_db_error: '',
			prolink_db_residual_raw: 0,
		}
	}

	stopTimer() {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
	}

	request(direction, db) {
		const sign = Number(direction)
		const choice = String(db)
		if (![1, -1].includes(sign) || !DB_CHOICES.has(choice)) {
			return this.fail('direction must be +/- and step must be 0.1, 0.5, 1 or 3 dB')
		}
		const state = this.observations.controllerState
		if (!confirmedPseThreshold(state)) {
			return this.fail('only observed PSE Threshold (-60..0 dB) is currently calibrated')
		}
		if (this.queue.length >= MAX_QUEUE) return this.fail('dB adjustment queue full')
		const context = state.contextVersion
		const signature = state.properties.signature
		this.queue.push({ sign, db: Number(choice), context, signature })
		this.write({ prolink_db_queue_length: this.queue.length })
		if (!this.active) this.startNext()
		return true
	}

	startNext() {
		if (this.active || !this.queue.length) return
		const item = this.queue.shift()
		const state = this.observations.controllerState
		this.write({ prolink_db_queue_length: this.queue.length })
		if (!confirmedPseThreshold(state) || state.contextVersion !== item.context ||
			state.properties.signature !== item.signature) {
			this.abort('context_changed', 'Controller changed before queued adjustment')
			return
		}
		// Residual is preserved across clicks in the same controller context,
		// so repeated 0.1 dB commands average to 0.1 instead of always 0.12.
		const contextKey = `${item.context}:${item.signature}`
		if (this.lastContext !== contextKey) {
			this.residualRaw = 0
			this.lastContext = contextKey
		}
		const raw = state.value.values[1]
		const desired = (item.sign * item.db / DB_PER_RAW) + this.residualRaw
		const change = Math.round(desired)
		const target = raw + change
		// Never run a command that requests beyond the verified parameter range.
		if (target < -RAW_TOLERANCE || target > 1000 + RAW_TOLERANCE || !change) {
			this.abort('out_of_range', 'Requested change exceeds calibrated Threshold range')
			return
		}
		this.active = { ...item, startRaw: raw, latestRaw: raw, target, desired, sent: 0, waiting: null }
		this.write({
			prolink_db_status: 'in_progress',
			prolink_db_requested: item.sign * item.db,
			prolink_db_observed: 0,
			prolink_db_target_raw: target,
			prolink_db_remaining_raw: change,
			prolink_db_error: '',
		})
		this.sendNext()
	}

	sendNext() {
		const job = this.active
		if (!job) return
		const state = this.observations.controllerState
		if (!confirmedPseThreshold(state) || state.contextVersion !== job.context ||
			state.properties.signature !== job.signature) {
			this.abort('context_changed', 'Focus changed during dB adjustment')
			return
		}
		const remaining = Math.round(job.target - job.latestRaw)
		if (!remaining) return this.finish()
		if (job.sent >= MAX_COMMANDS_PER_REQUEST) return this.abort('step_limit', 'Command step limit reached')
		const magnitude = selectMagnitude(remaining)
		if (!magnitude) return this.abort('invalid_state', 'Invalid remaining raw change')
		const delta = Math.sign(remaining) * magnitude
		const fromRaw = job.latestRaw
		// Register expected readback before sending; delivery is normally async.
		job.waiting = { fromRaw, delta, expected: delta * Math.abs(delta) }
		if (this.instance._sendProlink('ChangeControllerValue', delta) !== true) {
			return this.abort('send_failed', 'ProLink write rejected before readback')
		}
		job.sent++
		this.timer = setTimeout(() => {
			if (this.active === job && job.waiting) this.abort('unconfirmed', 'No changed controller raw value within timeout')
		}, READBACK_TIMEOUT_MS)
		this.timer.unref?.()
	}

	onValue() {
		const job = this.active
		if (!job?.waiting) return
		const state = this.observations.controllerState
		if (state.contextVersion !== job.context || !confirmedPseThreshold(state) ||
			state.properties.signature !== job.signature) {
			this.abort('context_changed', 'Focus changed during readback')
			return
		}
		const raw = state.value.values[1]
		const readback = raw - job.waiting.fromRaw
		if (Math.abs(readback) <= 1e-7) return // Changed text alone is not confirmation.
		if (Math.abs(readback - job.waiting.expected) > RAW_TOLERANCE) {
			return this.abort('unexpected_change', `Unexpected raw change ${readback} (expected ${job.waiting.expected})`)
		}
		this.stopTimer()
		job.latestRaw = raw
		job.waiting = null
		this.write({
			prolink_db_observed: Number(((raw - job.startRaw) * DB_PER_RAW).toFixed(4)),
			prolink_db_remaining_raw: Math.round(job.target - raw),
		})
		// Schedule another step outside the incoming packet callback to avoid
		// processing a complete multi-step adjustment recursively.
		queueMicrotask(() => { if (this.active === job && !job.waiting) this.sendNext() })
	}

	onContextChanged() {
		this.residualRaw = 0
		this.lastContext = null
		if (this.active || this.queue.length) this.abort('context_changed', 'Selected controller metadata changed')
	}

	finish() {
		const job = this.active
		if (!job) return
		this.stopTimer()
		this.residualRaw = job.desired - (job.latestRaw - job.startRaw)
		this.active = null
		this.write({
			prolink_db_status: 'observed_after_send',
			prolink_db_observed: Number(((job.latestRaw - job.startRaw) * DB_PER_RAW).toFixed(4)),
			prolink_db_remaining_raw: 0,
			prolink_db_residual_raw: Number(this.residualRaw.toFixed(6)),
			prolink_db_queue_length: this.queue.length,
		})
		if (this.queue.length) queueMicrotask(() => this.startNext())
	}

	abort(status, reason) {
		this.stopTimer()
		this.active = null
		this.queue = [] // No deferred writes after a failed/ambiguous operation.
		this.residualRaw = 0
		this.lastContext = null
		this.write({
			prolink_db_status: status,
			prolink_db_error: reason,
			prolink_db_queue_length: 0,
			prolink_db_residual_raw: 0,
		})
		this.instance._log?.('warn', '[PROLINK_DB_ADJUST_ABORTED]', { status, reason })
	}
}

module.exports = { ProLinkDbAdjust, confirmedPseThreshold, selectMagnitude, DB_PER_RAW }
