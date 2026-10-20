'use strict'

const { encodeOsc, encodeCommand } = require('../lib/prolink-codec')
const { decodeOsc } = require('../lib/prolink-osc')
const { ProLinkObservations } = require('../lib/prolink-observations')
const registerActions = require('../actions')

function context(entries = [[0, 'First'], [1, 'Second'], [2, 'Third']]) {
	let sequence = 100
	let actions
	const values = {}
	const calls = []
	const service = {
		state: 'connected',
		onState: jest.fn(),
		send: jest.fn((command, argument) => {
			const id = sequence++
			calls.push({ command, argument, sequence: id })
			return id
		}),
	}
	const self = {
		config: { controlTransport: 'prolink' },
		_prolink: service,
		_prolinkReady: true,
		_log: jest.fn(),
		setVariableValues: jest.fn(v => Object.assign(values, v)),
		checkFeedbacks: jest.fn(), updateActions: jest.fn(),
		setActionDefinitions: jest.fn(a => { actions = a }),
		_buildRackChoices: () => [], _buildHotSnapshotChoices: () => [], _buildHotPluginChoices: () => [],
		_prolinkId: (v, min, max) => /^\d+$/.test(String(v)) && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null,
		_controlFailure: jest.fn(() => false),
	}
	const obs = new ProLinkObservations(self)
	self._prolinkObservations = obs
	self._sendProlink = jest.fn((command, argument) => {
		const seq = service.send(command, argument)
		obs.track(command, seq, argument)
		return true
	})
	function receiveList(list = entries) {
		obs.track('GetListOfSnapshots', 20)
		obs.observeReply('GiveListOfSnapshot', [20, list.length, ...list.flat()])
		obs.snapshotSyncStatus = 'ready'
	}
	function build() { registerActions(self); return actions }
	function answerCurrent(id) {
		const call = calls.filter(call => call.command === 'GetCurrentSnapshotNumber').at(-1)
		if (!call) throw new Error('No current snapshot request sent')
		obs.observeReply('GiveCurrentSnapshotNumber', [call.sequence, id])
	}
	receiveList()
	return { self, service, obs, values, calls, build, answerCurrent, receiveList }
}

function invoke(action, options) { return action.callback({ options: { confirm: 'yes', ...options } }) }
function commands(c) { return c.calls.map(({ command, argument }) => [command, argument]) }

test('OSC signatures remain byte compatible with P4', () => {
	expect(decodeOsc(encodeOsc('StoreSnapshot', 3)).args).toEqual([3])
	expect(decodeOsc(encodeOsc('DuplicateSnapshot', 4, 1)).args).toEqual([4, 1])
	expect(decodeOsc(encodeOsc('MoveSnapshot', 5, [0, 2])).args).toEqual([5, 0, 2])
	expect(decodeOsc(encodeOsc('SetSnapshotName', 6, [{ id: 1, name: 'Chör 🎶' }])).args).toEqual([6, 1, 1, 'Chör 🎶'])
	expect(decodeOsc(encodeOsc('DeleteSnapshot', 7, [2])).args).toEqual([7, 1, 2])
	expect(encodeCommand('MoveSnapshot', 8, [0, 1]).readInt32BE(8)).toBe(5)
})

test('every authorized mutation waits for its own fresh current snapshot reply', async () => {
	const cases = [
		['prolink_store_snapshot', {}, 'StoreSnapshot', undefined],
		['prolink_duplicate_snapshot', {}, 'DuplicateSnapshot', 2],
		['prolink_move_snapshot', { destination: '0' }, 'MoveSnapshot', [2, 0]],
		['prolink_rename_snapshot', { name: 'Fresh' }, 'SetSnapshotName', [{ id: 2, name: 'Fresh' }]],
		['prolink_delete_snapshot', { deleteConfirmation: 'DELETE CURRENT' }, 'DeleteSnapshot', [2]],
	]
	for (const [action, options, command, argument] of cases) {
		const c = context()
		// The formerly cached value is intentionally WRONG.
		c.obs.snapshots.currentKnown = true
		c.obs.snapshots.currentNumber = 0
		const pending = invoke(c.build()[action], options)
		expect(commands(c)).toEqual([['GetCurrentSnapshotNumber', undefined]])
		c.answerCurrent(2)
		expect(await pending).toBe(true)
		expect(commands(c)).toEqual([
			['GetCurrentSnapshotNumber', undefined],
			[command, argument],
		])
		expect(c.values.prolink_snapshot_last_edit_status).toBe('pending')
		c.obs.reset()
	}
})

test('wrong request ID is ignored; no edit until matching fresh answer', async () => {
	const c = context()
	const pending = invoke(c.build().prolink_rename_snapshot, { name: 'Changed' })
	c.obs.observeReply('GiveCurrentSnapshotNumber', [999, 0])
	expect(c.calls).toHaveLength(1)
	c.answerCurrent(1)
	expect(await pending).toBe(true)
	expect(commands(c)[1]).toEqual(['SetSnapshotName', [{ id: 1, name: 'Changed' }]])
	c.obs.reset()
})

test('requires confirmation before lookup and rejects concurrency', async () => {
	const c = context()
	const a = c.build()
	expect(await invoke(a.prolink_delete_snapshot, { deleteConfirmation: '' })).toBe(false)
	expect(await a.prolink_duplicate_snapshot.callback({ options: { confirm: 'no' } })).toBe(false)
	expect(c.calls).toHaveLength(0)
	const first = invoke(a.prolink_duplicate_snapshot, {})
	expect(await invoke(a.prolink_rename_snapshot, { name: 'No' })).toBe(false)
	expect(c.calls).toHaveLength(1)
	c.answerCurrent(1)
	expect(await first).toBe(true)
	c.obs.reset()
})

test('no mutation after timeout or unexpected negative ResultCommand', async () => {
	jest.useFakeTimers()
	try {
		const c = context()
		const first = invoke(c.build().prolink_store_snapshot, {})
		jest.advanceTimersByTime(2500)
		expect(await first).toBe(false)
		expect(c.calls).toHaveLength(1)
		const second = invoke(c.build().prolink_store_snapshot, {})
		const seq = c.calls.at(-1).sequence
		c.obs.observeResult([seq, 1, '/waves.com/remote/GetCurrentSnapshotNumber failed'])
		expect(await second).toBe(false)
		expect(c.calls).toHaveLength(2)
		c.obs.reset()
	} finally { jest.useRealTimers() }
})

test('disconnect cancels fresh lookup; a late reply cannot send an edit', async () => {
	const c = context()
	const pending = invoke(c.build().prolink_rename_snapshot, { name: 'No' })
	const seq = c.calls.at(-1).sequence
	c.obs.reset()
	c.service.state = 'waiting'
	c.obs.observeReply('GiveCurrentSnapshotNumber', [seq, 0])
	expect(await pending).toBe(false)
	expect(c.calls).toHaveLength(1)
})

test('list replacement during fresh lookup cancels the edit', async () => {
	const c = context()
	const pending = invoke(c.build().prolink_rename_snapshot, { name: 'No' })
	c.receiveList([[0, 'New'], [1, 'List'], [2, 'Now']])
	c.answerCurrent(1)
	expect(await pending).toBe(false)
	expect(c.calls).toHaveLength(1)
	c.obs.reset()
})

test('unknown current ID, noncontiguous positions, same move target and last delete are blocked', async () => {
	const cases = [
		{ entries: [[0, 'A'], [1, 'B']], action: 'prolink_store_snapshot', options: {}, current: -1 },
		{ entries: [[10, 'A'], [20, 'B']], action: 'prolink_duplicate_snapshot', options: {}, current: 20 },
		{ entries: [[0, 'A'], [1, 'B']], action: 'prolink_move_snapshot', options: { destination: '1' }, current: 1 },
		{ entries: [[0, 'A']], action: 'prolink_delete_snapshot', options: { deleteConfirmation: 'DELETE CURRENT' }, current: 0 },
	]
	for (const { entries, action, options, current } of cases) {
		const c = context(entries)
		const pending = invoke(c.build()[action], options)
		c.answerCurrent(current)
		expect(await pending).toBe(false)
		expect(c.calls).toHaveLength(1)
		c.obs.reset()
	}
})

test('successful mutation ACK refreshes list and current number; no other edit before refresh', async () => {
	const c = context()
	const a = c.build()
	const pending = invoke(a.prolink_duplicate_snapshot, {})
	c.answerCurrent(1)
	expect(await pending).toBe(true)
	expect(await invoke(a.prolink_store_snapshot, {})).toBe(false)
	const cmdSeq = c.calls.at(-1).sequence
	c.obs.observeResult([cmdSeq, 0, '/waves.com/remote/DuplicateSnapshot succeeded'])
	expect(commands(c).slice(2)).toEqual([
		['GetListOfSnapshots', undefined],
		['GetCurrentSnapshotNumber', undefined],
	])
	c.obs.reset()
})
