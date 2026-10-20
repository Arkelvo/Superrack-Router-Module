'use strict'
const assert = require('node:assert/strict')
const Module = require('node:module')
const original = Module._load
Module._load = function(request, parent, isMain) {
  if (request === '@companion-module/base') return { combineRgb: (...values) => values }
  return original.apply(this, arguments)
}
const define = require('../feedbacks')
Module._load = original
const statuses = new Map()
let definitions
const self = {
  config: { controlTransport: 'prolink' },
  _prolink: { state: 'connected' },
  _prolinkObservations: {
    statuses,
    controllerState: { properties: null, value: null },
    racks: new Map(),
    monitoring: { statuses: new Map([['GetCPUUsage','received']]), hasIssue: () => false },
  },
  state: { lastRoutedRacks: [], sequenceRunning: false },
  setFeedbackDefinitions(defs) { definitions = defs },
}
;(async () => {
  await define(self)
  statuses.set('prolink_session_dirty', 'true')
  assert.equal(definitions.prolink_session_dirty_observed.callback(), true)
  assert.equal(definitions.prolink_snapshot_dirty_observed.callback(), false)
  assert.equal(definitions.prolink_monitor_cpu_observed.callback(), true)
  assert.equal(definitions.prolink_monitor_query_issue.callback(), false)
  self._prolink.state = 'waiting'
  assert.equal(definitions.prolink_session_dirty_observed.callback(), false)
  assert.equal(definitions.prolink_monitor_cpu_observed.callback(), false)
  assert.equal(definitions.prolink_connected.callback(), false)
  process.stdout.write('P6 feedback smoke passed\n')
})().catch(e => { console.error(e); process.exitCode = 1 })
