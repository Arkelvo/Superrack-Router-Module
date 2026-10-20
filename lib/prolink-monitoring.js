'use strict'

// P6: Treat unknown GiveCPUUsage / GiveSessionDirtyState payloads as *raw* OSC
// fields. Neither CPU percentages nor dirty-state booleans are inferred here.
const MONITOR_POLL_INTERVAL_MS = 15000
const MAX_REPLY_JSON_LENGTH = 8192

const QUERIES = Object.freeze({
	GetCPUUsage: {
		reply: 'GiveCPUUsage',
		prefix: 'prolink_monitor_cpu',
	},
	GetSessionDirtyState: {
		reply: 'GiveSessionDirtyState',
		prefix: 'prolink_monitor_session_dirty',
	},
})

function isValidRawReply(values) {
	if (!Array.isArray(values) || values.length < 1 || values.length > 64) return false
	if (!values.every(value =>
		(typeof value === 'string' && value.length <= 2048) ||
		(typeof value === 'number' && Number.isFinite(value)) ||
		typeof value === 'boolean'
	)) return false
	return JSON.stringify(values).length <= MAX_REPLY_JSON_LENGTH
}

class ProLinkMonitoring {
	constructor(observations, { intervalMs = MONITOR_POLL_INTERVAL_MS } = {}) {
		this.observations = observations
		this.instance = observations.instance
		this.intervalMs = intervalMs
		this.timer = null
		this.connected = false
		this.connectionCount = 0
		this.samples = new Map()
		this.pending = new Map()
		this.statuses = new Map()
	}

	start() {
		if (this.connected || this.instance._destroyed ||
			this.instance.config?.controlTransport !== 'prolink' ||
			this.instance._prolink?.state !== 'connected') return false
		this.connected = true
		this.connectionCount++
		this.instance.setVariableValues({
			prolink_monitor_connection_count: this.connectionCount,
			prolink_monitor_connected_since_ms: Date.now(),
		})
		this.poll()
		this.timer = setInterval(() => this.poll(), this.intervalMs)
		this.timer.unref?.()
		this.instance._log?.('debug', '[PROLINK_MONITOR_STARTED]', { intervalMs: this.intervalMs })
		return true
	}

	stop() {
		const hadData = this.connected || this.timer !== null || this.samples.size !== 0 || this.pending.size !== 0
		if (this.timer) clearInterval(this.timer)
		this.timer = null
		this.connected = false
		this.samples.clear()
		this.pending.clear()
		this.statuses.clear()
		if (!hadData) return
		this.instance.setVariableValues({
			prolink_monitor_connected_since_ms: '',
			prolink_monitor_cpu_status: 'idle',
			prolink_monitor_cpu_known: false,
			prolink_monitor_cpu_args_json: '',
			prolink_monitor_cpu_last_seen_ms: '',
			prolink_monitor_session_dirty_status: 'idle',
			prolink_monitor_session_dirty_known: false,
			prolink_monitor_session_dirty_args_json: '',
			prolink_monitor_session_dirty_last_seen_ms: '',
		})
		this.instance.checkFeedbacks?.('prolink_monitor_cpu_observed', 'prolink_monitor_query_issue')
	}

	_markSendFailure(command, data, error) {
		this.statuses.set(command, 'send_failed')
		this.instance.setVariableValues({ [`${data.prefix}_status`]: 'send_failed' })
		this.instance._log?.('warn', '[PROLINK_MONITOR_SEND_FAILED]', { command, error: error.message })
		this.instance.checkFeedbacks?.('prolink_monitor_query_issue')
	}

	poll() {
		if (!this.connected || this.instance._destroyed ||
			this.instance.config?.controlTransport !== 'prolink' ||
			this.instance._prolink?.state !== 'connected') return
		for (const [command, data] of Object.entries(QUERIES)) {
			if (this.pending.has(command)) continue // Avoid overlapping requests and a growing queue.
			try {
				const sequence = this.instance._prolink.send(command)
				if (!Number.isInteger(sequence) || !this.observations.requestTracker.track(command, sequence)) {
					this._markSendFailure(command, data, new Error('Monitoring request did not return a valid tracked sequence'))
					continue
				}
				this.pending.set(command, sequence)
				this.statuses.set(command, 'requesting')
				this.observations.lastCommandStatus = 'pending'
				this.instance.setVariableValues({
					[`${data.prefix}_status`]: 'requesting',
					prolink_command_pending: this.observations.pending.size,
					prolink_last_command: command,
					prolink_last_command_status: 'pending',
					prolink_last_send_timestamp: Date.now(),
				})
			} catch (error) {
				this._markSendFailure(command, data, error)
			}
		}
	}

	accepts(command, values) {
		return Object.hasOwn(QUERIES, command) && isValidRawReply(values)
	}

	receiveReply(command, values, request) {
		const data = QUERIES[request?.command]
		if (!this.connected || !data || command !== data.reply || !isValidRawReply(values)) return false
		if (this.pending.get(request.command) !== request.sequence) return false
		this.pending.delete(request.command)
		this.statuses.set(request.command, 'received')
		this.samples.set(request.command, { values: [...values], timestamp: Date.now() })
		this.instance.setVariableValues({
			[`${data.prefix}_status`]: 'received',
			[`${data.prefix}_known`]: true,
			[`${data.prefix}_args_json`]: JSON.stringify(values),
			[`${data.prefix}_last_seen_ms`]: Date.now(),
		})
		this.instance.checkFeedbacks?.('prolink_monitor_cpu_observed', 'prolink_monitor_query_issue')
		return true
	}

	onTimeout({ command, sequence }) {
		const data = QUERIES[command]
		if (!data || this.pending.get(command) !== sequence) return
		this.pending.delete(command)
		this.statuses.set(command, 'unconfirmed')
		this.instance.setVariableValues({ [`${data.prefix}_status`]: 'unconfirmed' })
		this.instance.checkFeedbacks?.('prolink_monitor_cpu_observed', 'prolink_monitor_query_issue')
	}

	onResult(request, result) {
		const data = QUERIES[request?.command]
		if (!data || result.success || this.pending.get(request.command) !== request.sequence) return
		this.pending.delete(request.command)
		this.statuses.set(request.command, 'rejected_or_unknown')
		this.instance.setVariableValues({ [`${data.prefix}_status`]: 'rejected_or_unknown' })
		this.instance.checkFeedbacks?.('prolink_monitor_cpu_observed', 'prolink_monitor_query_issue')
	}

	hasIssue() {
		return this.connected && [...this.statuses.values()].some(status =>
			['send_failed', 'unconfirmed', 'rejected_or_unknown'].includes(status)
		)
	}

}

module.exports = { ProLinkMonitoring, MONITOR_POLL_INTERVAL_MS, QUERIES, isValidRawReply }
