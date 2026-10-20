'use strict'
const { ProLinkObservations } = require('../lib/prolink-observations')
const { isValidRawReply } = require('../lib/prolink-monitoring')

function setup() {
	const sent = []
	const values = {}
	const self = {
		config: { controlTransport: 'prolink' }, _destroyed: false, _prolinkReady: true,
		setVariableValues: jest.fn(next => Object.assign(values, next)),
		updateActions: jest.fn(), checkFeedbacks: jest.fn(), _log: jest.fn(),
	}
	self._prolink = {
		state: 'waiting', sequence: 0,
		onState(state) { this.state = state; if (state !== 'connected') self._prolinkObservations?.reset() },
		send: jest.fn(function(command, value) {
			if (this.state !== 'connected') throw new Error('disconnected')
			const sequence = this.sequence++
			sent.push({ command, value, sequence })
			return sequence
		}),
	}
	self._prolinkObservations = new ProLinkObservations(self)
	return { self, obs: self._prolinkObservations, sent, values }
}

describe('P6 ProLink read-only monitoring', () => {
	afterEach(() => jest.useRealTimers())

	test('Connect and reconnect request separate CPU and dirty queries once and clear their state', () => {
		jest.useFakeTimers()
		const { self, obs, sent, values } = setup()
		self._prolink.onState('connected')
		expect(sent.map(({ command }) => command)).toEqual([
			'GetListOfSnapshots', 'RequestControllerInfoUpdates', 'GetCPUUsage', 'GetSessionDirtyState',
		])
		expect(values.prolink_monitor_connection_count).toBe(1)
		self._prolink.onState('connected')
		expect(sent).toHaveLength(4)
		const cpu = sent[2], dirty = sent[3]
		obs.observeReply('GiveCPUUsage', [cpu.sequence, 23.5])
		obs.observeReply('GiveSessionDirtyState', [dirty.sequence, false])
		expect(values.prolink_monitor_cpu_args_json).toBe('[23.5]')
		expect(values.prolink_monitor_session_dirty_args_json).toBe('[false]')
		expect(values.prolink_monitor_cpu_known).toBe(true)
		expect(values.prolink_monitor_session_dirty_known).toBe(true)
		self._prolink.onState('waiting')
		expect(values.prolink_monitor_cpu_known).toBe(false)
		expect(values.prolink_monitor_cpu_args_json).toBe('')
		expect(obs.monitoring.timer).toBeNull()
		self._prolink.onState('connected')
		expect(values.prolink_monitor_connection_count).toBe(2)
		expect(sent.filter(e => e.command === 'GetCPUUsage')).toHaveLength(2)
		obs.reset()
	})

	test('No overlapping polls; reply IDs must match; invalid payload does not consume request', () => {
		jest.useFakeTimers()
		const { self, obs, sent, values } = setup()
		self._prolink.onState('connected')
		obs.monitoring.poll()
		expect(sent).toHaveLength(4)
		const cpu = sent[2]
		obs.observeReply('GiveCPUUsage', [cpu.sequence + 1000, 12])
		expect(values.prolink_monitor_cpu_known).not.toBe(true)
		obs.observeReply('GiveCPUUsage', [cpu.sequence, Infinity])
		expect(obs.pending.has(cpu.sequence)).toBe(true)
		obs.observeReply('GiveCPUUsage', [cpu.sequence, 50, 'unverified units'])
		expect(values.prolink_monitor_cpu_args_json).toBe('[50,"unverified units"]')
		obs.monitoring.poll()
		expect(sent.filter(e => e.command === 'GetCPUUsage')).toHaveLength(2)
		expect(sent.filter(e => e.command === 'GetSessionDirtyState')).toHaveLength(1)
		obs.reset()
	})

	test('Request timeout shows diagnostic without inventing a CPU percent or dirty meaning', () => {
		jest.useFakeTimers()
		const { self, obs, values } = setup()
		self._prolink.onState('connected')
		jest.advanceTimersByTime(2510)
		expect(values.prolink_monitor_cpu_status).toBe('unconfirmed')
		expect(values.prolink_monitor_session_dirty_status).toBe('unconfirmed')
		expect(obs.monitoring.hasIssue()).toBe(true)
		expect(values.prolink_monitor_cpu_known).not.toBe(true)
		self._prolink.onState('waiting')
		expect(obs.monitoring.hasIssue()).toBe(false)
	})

	test('Unchanged status notifications do not spam variable writes and are reset', () => {
		const { self, obs, values } = setup()
		self._prolink.onState('connected')
		obs.observeStatus('NotifySessionDirty', 'prolink_session_dirty', [true])
		expect(values.prolink_session_dirty).toBe(true)
		const count = self.setVariableValues.mock.calls.length
		obs.observeStatus('NotifySessionDirty', 'prolink_session_dirty', [true])
		expect(self.setVariableValues).toHaveBeenCalledTimes(count)
		obs.observeStatus('NotifyAudioStatus', 'prolink_audio_status_raw', [1, 'opaque'])
		expect(values.prolink_audio_status_raw).toBe('[1,"opaque"]')
		obs.reset()
		expect(values.prolink_audio_status_raw).toBe('')
		expect(values.prolink_session_dirty).toBe('')
	})

	test('Monitor getter payload is kept raw, bounded and rejects impossible numbers', () => {
		expect(isValidRawReply([20, false, 'test'])).toBe(true)
		expect(isValidRawReply([])).toBe(false)
		expect(isValidRawReply([NaN])).toBe(false)
		expect(isValidRawReply([Infinity])).toBe(false)
		expect(isValidRawReply(['x'.repeat(2049)])).toBe(false)
	})
})
