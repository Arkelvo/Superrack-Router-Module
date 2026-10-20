'use strict'

const { ProLinkObservations } = require('../lib/prolink-observations')

function fixture() {
	let sequence = 20
	let observations
	const values = {}
	const events = []
	const service = {
		state: 'waiting',
		onState: jest.fn((state) => { if (state !== 'connected') observations?.reset() }),
		send: jest.fn((command) => { events.push(command); return sequence++ }),
	}
	const instance = {
		config: { controlTransport: 'prolink' }, _prolink: service,
		_log: jest.fn(),
		setVariableValues: jest.fn(next => Object.assign(values, next)),
		checkFeedbacks: jest.fn(), updateActions: jest.fn(),
	}
	observations = new ProLinkObservations(instance)
	function state(next) {
		service.state = next
		service.onState(next, '')
	}
	return { instance, service, observations, events, values, state }
}

test('a connected peer automatically requests a full list with its own request ID', () => {
	const ctx = fixture()
	ctx.state('connected')
	expect(ctx.events).toEqual(['GetListOfSnapshots'])
	expect(ctx.service.send).toHaveBeenCalledWith('GetListOfSnapshots')
	expect(ctx.observations.pending.get(20)).toMatchObject({ command: 'GetListOfSnapshots', expectedReply: 'GiveListOfSnapshot' })
	expect(ctx.values.prolink_snapshot_sync_status).toBe('requesting')
	ctx.observations.observeReply('GiveListOfSnapshot', [20, 2, 0, 'Test', 1, 'Test2'])
	expect(ctx.values.prolink_snapshot_sync_status).toBe('ready')
	expect(ctx.values.prolink_snapshot_list_known).toBe(true)
	expect(ctx.values.prolink_snapshot_count).toBe(2)
	expect(ctx.instance.updateActions).toHaveBeenCalledTimes(1)
	ctx.observations.reset()
})

test('disconnect clears list and reconnect fetches a new complete list', () => {
	const ctx = fixture()
	ctx.state('connected')
	ctx.observations.observeReply('GiveListOfSnapshot', [20, 1, 4, 'Verse'])
	ctx.state('waiting')
	expect(ctx.values.prolink_snapshot_sync_status).toBe('idle')
	expect(ctx.values.prolink_snapshot_list_known).toBe(false)
	expect(ctx.observations.pending.size).toBe(0)
	ctx.state('connected')
	expect(ctx.events).toEqual(['GetListOfSnapshots', 'GetListOfSnapshots'])
	expect(ctx.observations.pending.has(21)).toBe(true)
	ctx.observations.observeReply('GiveListOfSnapshot', [21, 0])
	expect(ctx.values.prolink_snapshot_count).toBe(0)
	ctx.observations.reset()
})

test('invalid list leaves pending request and existing names untouched', () => {
	const ctx = fixture()
	ctx.state('connected')
	ctx.observations.observeReply('GiveListOfSnapshot', [20, 2, 1, 'Only one entry'])
	expect(ctx.observations.pending.has(20)).toBe(true)
	expect(ctx.values.prolink_snapshot_sync_status).toBe('requesting')
	expect(ctx.observations.snapshots.listKnown).toBe(false)
	ctx.observations.reset()
})

test('automatic sync is never sent when transport is MIDI, destroyed or send fails', () => {
	const ctx = fixture()
	ctx.instance.config.controlTransport = 'midi'
	ctx.state('connected')
	expect(ctx.service.send).not.toHaveBeenCalled()
	ctx.instance.config.controlTransport = 'prolink'
	ctx.instance._destroyed = true
	ctx.state('connected')
	expect(ctx.service.send).not.toHaveBeenCalled()
	ctx.instance._destroyed = false
	ctx.service.send.mockImplementation(() => { throw new Error('socket closed') })
	ctx.state('connected')
	expect(ctx.values.prolink_snapshot_sync_status).toBe('send_failed')
	ctx.state('waiting')
	expect(ctx.values.prolink_snapshot_sync_status).toBe('idle')
})

test('timeout reports unconfirmed without inventing an empty list', () => {
	jest.useFakeTimers()
	try {
		const ctx = fixture()
		ctx.state('connected')
		jest.advanceTimersByTime(2500)
		expect(ctx.values.prolink_snapshot_sync_status).toBe('unconfirmed')
		expect(ctx.observations.snapshots.listKnown).toBe(false)
		ctx.observations.reset()
	} finally { jest.useRealTimers() }
})
