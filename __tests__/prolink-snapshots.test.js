'use strict'

const { ProLinkSnapshots } = require('../lib/prolink-snapshots')
const { ProLinkObservations } = require('../lib/prolink-observations')

const prefix = '/waves.com/remote/'
function oscString(s) {
	const source = Buffer.from(s, 'utf8')
	const out = Buffer.alloc(Math.ceil((source.length + 1) / 4) * 4)
	source.copy(out)
	return out
}
function i32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
function frame(command, tags, args = []) {
	return { type: 5, payload: Buffer.concat([oscString(prefix + command), oscString(tags), ...args]) }
}
function fixture() {
	const values = {}
	const instance = {
		_log: jest.fn(), checkFeedbacks: jest.fn(), updateActions: jest.fn(),
		setVariableValues: jest.fn(next => Object.assign(values, next)),
	}
	return { obs: new ProLinkObservations(instance), values, instance }
}

test('current snapshot number comes only from a matched well-typed GiveCurrentSnapshotNumber', () => {
	const { obs, values } = fixture()
	obs.track('GetCurrentSnapshotNumber', 10)
	obs.receive(frame('GiveCurrentSnapshotNumber', ',is', [i32(10), oscString('invalid')]))
	expect(values.prolink_snapshot_current_known).toBeUndefined()
	expect(obs.pending.size).toBe(1)
	obs.receive(frame('GiveCurrentSnapshotNumber', ',ii', [i32(10), i32(7)]))
	expect(values.prolink_snapshot_current_known).toBe(true)
	expect(values.prolink_snapshot_current_number_raw).toBe(7)
	expect(obs.pending.size).toBe(0)
	obs.reset()
	expect(values.prolink_snapshot_current_known).toBe(false)
	expect(values.prolink_snapshot_current_number_raw).toBe('')
})

test('snapshot names are keyed by original provider ID across interleaved replies', () => {
	const { obs, values } = fixture()
	obs.track('GetSnapshotName', 21, 12)
	obs.track('GetSnapshotName', 22, 4)
	obs.receive(frame('GiveSnapshotName', ',is', [i32(22), oscString('Bridge')]))
	obs.receive(frame('GiveSnapshotName', ',is', [i32(21), oscString('Intro')]))
	expect(JSON.parse(values.prolink_snapshot_names_json)).toEqual({ 4: 'Bridge', 12: 'Intro' })
	expect(values.prolink_snapshot_last_name_target_id).toBe(12)
	expect(values.prolink_snapshot_last_name).toBe('Intro')
	obs.receive(frame('GiveSnapshotName', ',is', [i32(21), oscString('Wrong stale packet')]))
	expect(JSON.parse(values.prolink_snapshot_names_json)[12]).toBe('Intro')
	obs.reset()
	expect(values.prolink_snapshot_names_json).toBe('{}')
})

test('lists retain raw nested OSC values without inventing indexes or names', () => {
	const { obs, values } = fixture()
	obs.track('GetListOfSnapshots', 13)
	obs.receive(frame('GiveListOfSnapshot', ',ii', [i32(13), i32(3)]))
	expect(values.prolink_snapshot_list_known).toBe(true)
	expect(values.prolink_snapshot_list_raw).toBe('[3]')
	expect(values.prolink_snapshot_names_json).toBeUndefined()
	obs.reset()
	expect(values.prolink_snapshot_list_known).toBe(false)
})

test('only matching responses mutate snapshot state, malformed names leave request pending', () => {
	const { obs, values } = fixture()
	obs.track('GetSnapshotName', 27, 8)
	obs.receive(frame('GiveSnapshotName', ',ii', [i32(27), i32(200)]))
	expect(obs.pending.size).toBe(1)
	obs.receive(frame('GiveSnapshotName', ',is', [i32(300), oscString('Unknown')]))
	expect(obs.pending.size).toBe(1)
	obs.receive(frame('GiveSnapshotName', ',is', [i32(27), oscString('Verse')]))
	expect(JSON.parse(values.prolink_snapshot_names_json)).toEqual({ 8: 'Verse' })
	obs.reset()
})

test('independent snapshot state validation is bounded and does not infer list shape', () => {
	const state = new ProLinkSnapshots({ setVariableValues: jest.fn() })
	expect(state.accepts('GiveSnapshotName', ['name'], { argument: undefined })).toBe(false)
	expect(state.accepts('GiveSnapshotName', ['name'], { argument: 0 })).toBe(true)
	expect(state.accepts('GiveListOfSnapshot', ['x'.repeat(66000)], {})).toBe(false)
	expect(state.accepts('GiveCurrentSnapshotNumber', [-1], {})).toBe(true)
})

test('main.js passes the original getter argument into the request tracker', () => {
	const fs = require('node:fs')
	const path = require('node:path')
	const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
	expect(main).toContain('this._prolinkObservations.track(command, sequence, id)')
})
