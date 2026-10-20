'use strict'

// Dependency-free Node.js test. Run from project root: node tools/smoke-p4-current.js
const assert = require('node:assert/strict')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { createProLinkSnapshotActions } = require('../lib/prolink-snapshot-actions')

function context(entries = [[0, 'One'], [1, 'Two'], [2, 'Three']]) {
	let sequence = 70
	const calls = []
	const variables = {}
	const failures = []
	const service = {
		state: 'connected', onState() {},
		send(command, argument) {
			const seq = sequence++
			calls.push({ command, argument, seq })
			return seq
		},
	}
	const self = {
		config: { controlTransport: 'prolink' }, _prolink: service, _prolinkReady: true,
		_log() {}, setVariableValues: value => Object.assign(variables, value),
		checkFeedbacks() {}, updateActions() {},
		_prolinkId: (v, min, max) => /^\d+$/.test(String(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null,
		_controlFailure: message => { failures.push(message); return false },
	}
	const obs = new ProLinkObservations(self)
	self._prolinkObservations = obs
	self._sendProlink = (cmd, arg) => {
		const seq = service.send(cmd, arg)
		obs.track(cmd, seq, arg)
		return true
	}
	obs.track('GetListOfSnapshots', 20)
	obs.observeReply('GiveListOfSnapshot', [20, entries.length, ...entries.flat()])
	obs.snapshotSyncStatus = 'ready'
	const actions = createProLinkSnapshotActions(self)
	return {
		obs, self, service, calls, variables, failures, actions,
		answerCurrent(id) {
			const get = calls.findLast(x => x.command === 'GetCurrentSnapshotNumber')
			assert.ok(get)
			obs.observeReply('GiveCurrentSnapshotNumber', [get.seq, id])
		},
	}
}
const invoke = (action, options={}) => action.callback({ options: { confirm: 'yes', ...options } })
async function test() {
	const cases = [
		['prolink_store_snapshot', {}, 'StoreSnapshot', undefined],
		['prolink_duplicate_snapshot', {}, 'DuplicateSnapshot', 2],
		['prolink_move_snapshot', { destination: '0' }, 'MoveSnapshot', [2, 0]],
		['prolink_rename_snapshot', { name: 'New' }, 'SetSnapshotName', [{ id: 2, name: 'New' }]],
		['prolink_delete_snapshot', { deleteConfirmation: 'DELETE CURRENT' }, 'DeleteSnapshot', [2]],
	]
	for (const [key, opt, command, argument] of cases) {
		const c = context()
		c.obs.snapshots.currentNumber = 0 // stale, must be ignored
		c.obs.snapshots.currentKnown = true
		const pending = invoke(c.actions[key], opt)
		assert.deepEqual(c.calls.map(x => x.command), ['GetCurrentSnapshotNumber'])
		c.answerCurrent(2)
		assert.equal(await pending, true)
		assert.deepEqual(c.calls.map(x => x.command), ['GetCurrentSnapshotNumber', command])
		assert.deepEqual(c.calls[1].argument, argument)
		c.obs.reset()
	}
	{
		const c = context()
		const pending = invoke(c.actions.prolink_rename_snapshot, {name:'Wait'})
		c.obs.observeReply('GiveCurrentSnapshotNumber', [999, 2])
		assert.equal(c.calls.length, 1)
		c.answerCurrent(1)
		assert.equal(await pending, true)
		assert.deepEqual(c.calls[1].argument, [{id:1,name:'Wait'}])
		c.obs.reset()
	}
	{
		const c = context()
		c.obs.requestTracker.timeoutMs = 25
		const pending = invoke(c.actions.prolink_store_snapshot)
		await new Promise(resolve => setTimeout(resolve, 50))
		assert.equal(await pending, false)
		assert.equal(c.calls.length, 1)
		assert.equal(c.obs.currentSnapshotWaiters.size, 0)
		c.obs.reset()
	}
	{
		const c = context()
		const pending = invoke(c.actions.prolink_store_snapshot)
		const seq = c.calls[0].seq
		c.obs.observeResult([seq, 1, '/waves.com/remote/GetCurrentSnapshotNumber failed'])
		assert.equal(await pending, false)
		assert.equal(c.calls.length,1)
		c.obs.reset()
	}
	{
		const c = context()
		const pending = invoke(c.actions.prolink_duplicate_snapshot)
		c.obs.reset()
		assert.equal(await pending, false)
		assert.equal(c.calls.length,1)
	}
	{
		const c = context()
		const pending = invoke(c.actions.prolink_duplicate_snapshot)
		const concurrent = await invoke(c.actions.prolink_store_snapshot)
		assert.equal(concurrent, false)
		c.answerCurrent(1)
		assert.equal(await pending, true)
		c.obs.reset()
	}
	{
		const c = context()
		assert.equal(await invoke(c.actions.prolink_delete_snapshot, {deleteConfirmation:'wrong'}), false)
		assert.equal(c.calls.length, 0)
		c.obs.reset()
	}
	{
		const c = context()
		const pending = invoke(c.actions.prolink_duplicate_snapshot)
		c.answerCurrent(-1)
		assert.equal(await pending, false)
		assert.equal(c.calls.length, 1)
		c.obs.reset()
	}
	{
		const c = context([[10,'A'],[20,'B']])
		const pending = invoke(c.actions.prolink_move_snapshot,{destination:'0'})
		c.answerCurrent(20)
		assert.equal(await pending, false)
		assert.equal(c.calls.length, 1)
		c.obs.reset()
	}
	{
		const c = context()
		const pending = invoke(c.actions.prolink_rename_snapshot,{name:'New'})
		c.answerCurrent(1)
		assert.equal(await pending,true)
		const seq = c.calls[1].seq
		c.obs.observeResult([seq,0,'/waves.com/remote/SetSnapshotName succeeded'])
		assert.equal(c.calls[2].command, 'GetListOfSnapshots')
		assert.equal(c.variables.prolink_snapshot_last_edit_status, 'acknowledged')
		c.obs.reset()
	}
	console.log('PASS: Fresh snapshot GET before all five mutations; correlated replies; stale values ignored; timeout; rejected GET; reset; concurrency; confirmations; ACK refresh.')
}
test().catch(error=>{console.error(error);process.exitCode=1})
