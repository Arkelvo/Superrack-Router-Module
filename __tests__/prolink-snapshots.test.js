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

test('2026-10-20 live GiveListOfSnapshot layout yields real provider IDs and names', () => {
	const { obs, values, instance } = fixture()
	obs.track('GetListOfSnapshots', 0)
	obs.receive(frame('GiveListOfSnapshot', ',iiisis', [i32(0), i32(2), i32(0), oscString('Test'), i32(1), oscString('Test2')]))
	expect(values.prolink_snapshot_list_known).toBe(true)
	expect(values.prolink_snapshot_list_raw).toBe('[2,0,"Test",1,"Test2"]')
	expect(values.prolink_snapshot_count).toBe(2)
	expect(JSON.parse(values.prolink_snapshot_list_json)).toEqual([{ id: 0, name: 'Test' }, { id: 1, name: 'Test2' }])
	expect(JSON.parse(values.prolink_snapshot_names_json)).toEqual({ '0': 'Test', '1': 'Test2' })
	expect(obs.pending.size).toBe(0)
	expect(instance.updateActions).toHaveBeenCalledTimes(1)
	obs.reset()
	expect(values.prolink_snapshot_list_known).toBe(false)
	expect(values.prolink_snapshot_list_json).toBe('[]')
	expect(values.prolink_snapshot_count).toBe('')
	expect(instance.updateActions).toHaveBeenCalledTimes(2)
})

test('current snapshot 1 to 0 and snapshot name Test match exact observed responses', () => {
	const {obs,values} = fixture()
	obs.track('GetCurrentSnapshotNumber', 1)
	obs.receive(frame('GiveCurrentSnapshotNumber', ',ii', [i32(1), i32(1)]))
	expect(values.prolink_snapshot_current_number_raw).toBe(1)
	obs.track('GetCurrentSnapshotNumber', 9)
	obs.receive(frame('GiveCurrentSnapshotNumber', ',ii', [i32(9), i32(0)]))
	expect(values.prolink_snapshot_current_number_raw).toBe(0)
	obs.track('GetSnapshotName', 12, 0)
	obs.receive(frame('GiveSnapshotName', ',is', [i32(12), oscString('Test')]))
	expect(values.prolink_snapshot_last_name).toBe('Test')
	expect(values.prolink_snapshot_last_name_target_id).toBe(0)
	obs.reset()
})

test('malformed list does not consume pending request; empty and reordered lists work', () => {
	const { obs, values } = fixture()
	obs.track('GetListOfSnapshots', 13)
	obs.receive(frame('GiveListOfSnapshot', ',ii', [i32(13), i32(3)])) // count mismatch
	expect(obs.pending.size).toBe(1)
	expect(values.prolink_snapshot_list_known).toBeUndefined()
	obs.receive(frame('GiveListOfSnapshot', ',iiisis', [i32(13), i32(2), i32(1), oscString('B'), i32(1), oscString('Duplicate')]))
	expect(obs.pending.size).toBe(1)
	obs.receive(frame('GiveListOfSnapshot', ',iiisis', [i32(13), i32(2), i32(13), oscString('D'), i32(4), oscString('E')]))
	expect(values.prolink_snapshot_count).toBe(2)
	expect(JSON.parse(values.prolink_snapshot_names_json)).toEqual({ '4': 'E', '13': 'D' })
	obs.track('GetListOfSnapshots', 14)
	obs.receive(frame('GiveListOfSnapshot', ',ii', [i32(14), i32(0)]))
	expect(values.prolink_snapshot_count).toBe(0)
	expect(values.prolink_snapshot_names_json).toBe('{}')
	obs.reset()
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

test('independent snapshot validation enforces live count/id/name wire schema', () => {
	const state = new ProLinkSnapshots({ setVariableValues: jest.fn() })
	expect(state.accepts('GiveSnapshotName', ['name'], { argument: undefined })).toBe(false)
	expect(state.accepts('GiveSnapshotName', ['name'], { argument: 0 })).toBe(true)
	expect(state.accepts('GiveListOfSnapshot', [2, 0, 'A', 1, 'B'], {})).toBe(true)
	expect(state.accepts('GiveListOfSnapshot', [2, 0, 'A'], {})).toBe(false)
	expect(state.accepts('GiveListOfSnapshot', [2, 0, 'A', 0, 'B'], {})).toBe(false)
	expect(state.accepts('GiveListOfSnapshot', [1, 0, 'x'.repeat(66000)], {})).toBe(false)
	expect(state.accepts('GiveListOfSnapshot', [0], {})).toBe(true)
	expect(state.accepts('GiveCurrentSnapshotNumber', [-1], {})).toBe(true)
})

test('main.js passes the original getter argument into the request tracker', () => {
	const fs = require('node:fs')
	const path = require('node:path')
	const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
	expect(main).toContain('this._prolinkObservations.track(command, sequence, id)')
})
