'use strict'
// V9 dependency-free tests: node --test tools/smoke-tune-root-v9.test.js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  ROOT_SPELLINGS, ROOT_BY_ID, STATIC_SOURCE, buildRootCapabilityReport,
} = require('../lib/prolink-tune-root-model')
const { ProLinkTuneDiagnostics } = require('../lib/prolink-tune-diagnostics')
const registerActions = require('../actions')
const { VERIFIED_SCALES } = require('../lib/prolink-tune-scale-control')

function instance(connected = true) {
  const vars = {}
  const commands = []
  const log = []
  const inst = {
    config: { controlTransport: 'prolink' },
    _prolink: { state: connected ? 'connected' : 'disconnected' },
    _prolinkObservations: { controllerState: { contextVersion: 5,
      properties: { values: ['Scale Type', false, 44, 0, 32, '', 0.001, 0, false, 1, 'Tune RT', 'User Scale', 'Asavari (Carnatic)'] },
      value: { values: ['Natural Minor', 3] } } },
    _sendProlink(...args) { commands.push(args); return true },
    setVariableValues(x) { Object.assign(vars, x) },
    checkFeedbacks() {},
    _log(level, event, detail) { log.push([level, event, detail]) },
    _controlFailure() { return false },
    _buildRackChoices() { return [] },
    _buildHotSnapshotChoices() { return [] },
    _buildHotPluginChoices() { return [] },
    setActionDefinitions(a) { inst.actions = a },
  }
  inst._tuneDiagnostics = new ProLinkTuneDiagnostics(inst)
  registerActions(inst)
  return { inst, vars, commands, log }
}

test('exactly 17 unique static automation indices encode 12 pitch classes', () => {
  assert.equal(ROOT_SPELLINGS.length, 17)
  assert.deepEqual(ROOT_SPELLINGS.map(r => r.automationIndex), [...Array(17).keys()])
  assert.equal(new Set(ROOT_SPELLINGS.map(r => r.id)).size, 17)
  assert.equal(new Set(ROOT_SPELLINGS.map(r => r.pitchClass)).size, 12)
  assert.ok(ROOT_SPELLINGS.every(x => Number.isInteger(x.pitchClass) && x.pitchClass >= 0 && x.pitchClass < 12))
  assert.ok(Object.isFrozen(ROOT_SPELLINGS))
  assert.ok(ROOT_SPELLINGS.every(Object.isFrozen))
})

test('enharmonic equivalents share pitch class, not automation index', () => {
  for (const [a, b] of [['C#','Db'], ['D#','Eb'], ['F#','Gb'], ['G#','Ab'], ['A#','Bb']]) {
    assert.equal(ROOT_BY_ID.get(a).pitchClass, ROOT_BY_ID.get(b).pitchClass)
    assert.notEqual(ROOT_BY_ID.get(a).automationIndex, ROOT_BY_ID.get(b).automationIndex)
  }
})

test('static sample mappings match RE evidence, not MIDI note values', () => {
  assert.deepEqual(['C','F#','A','B'].map(x => ROOT_BY_ID.get(x).automationIndex), [0,8,13,16])
  assert.equal(STATIC_SOURCE.rootAutomationParameterId, 82)
  assert.equal(STATIC_SOURCE.rootNativeHostControllerIndexCandidate, 40)
  assert.notEqual(STATIC_SOURCE.rootNativeHostControllerIndexCandidate, STATIC_SOURCE.rootAutomationParameterId)
})

test('invalid root options do not create a model state', () => {
  assert.throws(() => buildRootCapabilityReport({ requestedRoot: 'H' }), RangeError)
  assert.throws(() => buildRootCapabilityReport({ requestedRoot: 'C♯' }), RangeError)
})

test('model inspection never interprets focused Speed/Scale Type as current Root', () => {
  const state = { contextVersion: 2, properties: { values: ['Speed', true, 0, 0.1, 800, 'ms', 0.001, 0, false, 1, 'Tune RT','0.1','800.0'] }, value: { values: ['135.8', 673.7735] } }
  const report = buildRootCapabilityReport({ requestedRoot: 'Gb', connected: true, controllerState: state })
  assert.equal(report.selected.automationIndex, 9)
  assert.equal(report.currentRootKnown, false)
  assert.equal(report.remoteRootGetterVerified, false)
  assert.equal(report.remoteRootSetterVerified, false)
  assert.equal(report.networkRootTargetAddressVerified, false)
  assert.equal(report.observedTouchAndTurn.name, 'Speed')
  assert.equal(report.observedTouchAndTurn.contextVersion, 2)
})

test('V9 read-only inspection publishes full mapping and never sends any OSC', async () => {
  const c = instance()
  const result = await c.inst.actions.tune_root_inspect.callback({ options: { root: 'Db' } })
  assert.equal(result, true)
  const payload = JSON.parse(c.vars.tune_root_analysis_json)
  assert.equal(payload.selected.automationIndex, 2)
  assert.equal(payload.selected.pitchClass, 1)
  assert.equal(payload.remoteRootSetterVerified, false)
  assert.equal(payload.supportedSpellings.length, 17)
  assert.equal(c.vars.tune_root_remote_status, 'unavailable_unverified')
  assert.equal(c.vars.tune_root, undefined)
  assert.deepEqual(c.commands, [])
  assert.deepEqual(c.log[0][1], '[TUNE_ROOT_CAPABILITY]')
})

test('offline root report stays truthful and does not call network', async () => {
  const c = instance(false)
  const ok = await c.inst.actions.tune_root_inspect.callback({ options: { root: 'C' } })
  assert.equal(ok, true)
  const report = JSON.parse(c.vars.tune_root_analysis_json)
  assert.equal(report.connected, false)
  assert.equal(report.currentRootKnown, false)
  assert.deepEqual(c.commands, [])
})

test('root action accepts enhanced spelling choices but stays blocked with no write', async () => {
  const c = instance()
  for (const root of ROOT_SPELLINGS) {
    assert.equal(await c.inst.actions.tune_set_root.callback({ options: { root: root.id } }), false)
    assert.equal(c.vars.tune_target_root, root.id)
    assert.equal(c.vars.tune_status, 'blocked_unaddressable')
    assert.deepEqual(c.commands, [])
    assert.notEqual(c.vars.tune_root, root.id)
  }
})

test('combined key action rejects actual Root writes even for valid 44-scale options', async () => {
  const c = instance()
  for (const root of ['Db','A#']) {
    for (const scale of [VERIFIED_SCALES[0], VERIFIED_SCALES[43]]) {
      assert.equal(await c.inst.actions.tune_set_key.callback({ options: { root, scale: scale.id } }), false)
      assert.equal(c.vars.tune_target_root, root)
      assert.equal(c.vars.tune_target_scale, scale.id)
      assert.deepEqual(c.commands, [])
    }
  }
})

test('Companion exposes 17 spelled roots in selection and JSON capability action', () => {
  const c = instance()
  const rootChoices = c.inst.actions.tune_set_root.options[0].choices
  assert.equal(rootChoices.length, 17)
  assert.equal(c.inst.actions.tune_set_key.options[0].choices.length, 17)
  assert.equal(c.inst.actions.tune_set_key.options[1].choices.length, 44)
  assert.equal(c.inst.actions.tune_root_inspect.options[0].choices.length, 17)
  assert.ok(c.inst.actions.tune_set_root.name.includes('BLOCKED'))
  assert.ok(c.inst.actions.tune_root_inspect.name.includes('READ-ONLY'))
})

test('presets and vars expose only read-only capability and no falsely working root write', () => {
  const Module = require('node:module')
  const originalLoad = Module._load
  let registerPresets
  try {
    Module._load = function(request, parent, main) {
      if (request === '@companion-module/base') return { combineRgb: (r,g,b) => (r << 16) | (g << 8) | b }
      return originalLoad.call(this, request, parent, main)
    }
    registerPresets = require('../presets')
  } finally { Module._load = originalLoad }
  const c = instance()
  c.inst.label = 'prolink-test'
  c.inst.setPresetDefinitions = defs => { c.presets = defs }
  c.inst.setVariableDefinitions = defs => { c.variables = defs }
  registerPresets(c.inst)
  require('../variables')(c.inst)
  assert.equal(c.presets.tune_root_capability.steps[0].down[0].actionId, 'tune_root_inspect')
  assert.equal(Object.keys(c.presets).filter(x => x.startsWith('tune_scale_')).length, 45)
  assert.ok(c.variables.find(x => x.variableId === 'tune_root_analysis_json'))
  assert.ok(c.variables.find(x => x.variableId === 'tune_root_remote_status'))
  assert.equal(new Set(c.variables.map(x => x.variableId)).size, c.variables.length)
})
