'use strict'
const registerActions = require('../actions')
const { ProLinkSnapshots } = require('../lib/prolink-snapshots')

function mockModule() {
  const calls = []
  let actions
  const self = {
    _buildRackChoices: () => [], _buildHotSnapshotChoices: () => [], _buildHotPluginChoices: () => [],
    _prolinkId: (value, min, max) => {
      if (!/^\d+$/.test(String(value))) return null
      const parsed = Number(value)
      return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
    },
    _log: jest.fn(), _controlFailure: jest.fn(() => false),
    setVariableValues: jest.fn(), updateActions: jest.fn(),
    routeProlinkSnapshot: jest.fn((command, id) => { calls.push([command, id]); return true }),
    setActionDefinitions: jest.fn(value => { actions = value }),
  }
  self._prolinkObservations = { snapshots: new ProLinkSnapshots(self) }
  function refresh() { registerActions(self); return actions }
  return { self, calls, refresh }
}

test('only a verified live list populates named recall/highlight dropdowns', async () => {
  const { self, calls, refresh } = mockModule()
  let actions = refresh()
  expect(actions.prolink_recall_snapshot_named.options[0].choices).toEqual([])
  await actions.prolink_recall_snapshot_named.callback({ options: {snapshotId: '0'} })
  expect(self._controlFailure).toHaveBeenCalled()
  expect(calls).toHaveLength(0)

  self._prolinkObservations.snapshots.accept('GiveListOfSnapshot', [2, 0, 'Test', 1, 'Test2'], {})
  actions = refresh()
  expect(actions.prolink_recall_snapshot_named.options[0].choices).toEqual([
    { id: '0', label: 'Test [ID 0]' }, { id: '1', label: 'Test2 [ID 1]' },
  ])
  await actions.prolink_recall_snapshot_named.callback({options: {snapshotId: '1'}})
  await actions.prolink_highlight_snapshot_named.callback({options: {snapshotId: '0'}})
  expect(calls).toEqual([['RecallSnapshot', 1], ['HighlightSnapshot', 0]])

  self._prolinkObservations.snapshots.accept('GiveListOfSnapshot', [1, 0, 'Test'], {})
  actions = refresh()
  await actions.prolink_recall_snapshot_named.callback({options: {snapshotId: '1'}})
  expect(calls).toHaveLength(2) // obsolete IDs are rejected
})

test('legacy numeric provider-ID actions remain unchanged', () => {
  const { refresh } = mockModule()
  const actions = refresh()
  expect(actions.prolink_recall_snapshot.options[0].type).toBe('number')
  expect(actions.prolink_highlight_snapshot.options[0].type).toBe('number')
})
