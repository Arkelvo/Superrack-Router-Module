'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ProLinkDiscreteControl, PROFILES, TARGET_CHOICES } = require('../lib/prolink-discrete-control')
const { ProLinkControllerState } = require('../lib/prolink-controller-state')

const CLA = ['Analog', false, 3, 0, 1, '', 0.001, 0, false, 1, 'CLA-76', '50Hz', 'Off']
const TUNE = ['Scale Type', false, 44, 0, 32, '', 0.001, 0, false, 1, 'Tune RT', 'User Scale', 'Asavari (Carnatic)']
function harness(type = 'cla76_analog', raw = 0, { timeoutMs = 40 } = {}) {
  const profile = PROFILES[type]
  const controllerState = new ProLinkControllerState()
  const set = () => controllerState.observeProperties(type === 'cla76_analog' ? CLA : TUNE)
  set()
  const values = { cla76_analog: ['50Hz', '60Hz', 'Off'] }
  function textFor(n) { return type === 'cla76_analog' ? values.cla76_analog[n] :
    ({ 0: 'User Scale', 1: 'Chromatic', 2: 'Major', 3: 'Natural Minor',
      43: 'Asavari (Carnatic)' }[n] || PROFILES.tune_scale.targets[n].label) }
  controllerState.observeValue([textFor(raw), raw])
  const writes = [], state = {}, log = [], instance = {
    config: { controlTransport: 'prolink' }, _prolink: { state: 'connected' },
    _prolinkReady: true, _prolinkObservations: {
      controllerState, controllerWrite: null,
      trackControllerWrite(item) { this.controllerWrite = item },
    }, _tuneScaleControl: { pending: null }, _discreteEvidence: { pending: null },
    setVariableValues(v) { Object.assign(state, v) }, checkFeedbacks() {},
    _log(...args) { log.push(args) }, _sendProlink(...args) { writes.push(args); return true },
  }
  const engine = new ProLinkDiscreteControl(instance, { timeoutMs })
  instance._discreteControl = engine
  function read(n, label = textFor(n)) {
    controllerState.observeValue([label, n])
    instance._prolinkObservations.controllerWrite = null
    engine.onValue()
  }
  return { engine, instance, controllerState, state, writes, log, read, set, profile, textFor }
}

test('validated profiles and 47 distinct Companion options', () => {
  assert.equal(PROFILES.cla76_analog.count, 3)
  assert.equal(PROFILES.tune_scale.count, 44)
  assert.equal(TARGET_CHOICES.length, 47)
  assert.equal(new Set(TARGET_CHOICES.map(c => c.id)).size, 47)
})
test('CLA-76 50Hz → Off: two separate notifications, never a blind second switch', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:off')
  assert.deepEqual(h.writes, [['SwitchControllerValue', true]])
  h.read(1)
  assert.equal(h.writes.length, 2)
  h.read(2)
  assert.equal(await promise, true)
  assert.equal(h.state.prolink_discrete_set_steps, 2)
  assert.equal(h.state.prolink_discrete_set_status, 'observed_target')
})
test('CLA-76 Off → 50Hz wraps exactly once', async () => {
  const h = harness('cla76_analog', 2)
  const promise = h.engine.setTarget('cla76_analog:50hz')
  assert.equal(h.writes.length, 1)
  h.read(0)
  assert.equal(await promise, true)
})
test('Tune raw 43 → 0 → 1 → 2, without pretending absolute parameter address', async () => {
  const h = harness('tune_scale', 43)
  const promise = h.engine.setTarget('tune_scale:major')
  h.read(0); h.read(1); h.read(2)
  assert.equal(await promise, true)
  assert.equal(h.writes.length, 3)
})
test('already at target sends no command', async () => {
  const h = harness()
  assert.equal(await h.engine.setTarget('cla76_analog:50hz'), true)
  assert.equal(h.writes.length, 0)
  assert.equal(h.state.prolink_discrete_set_status, 'already_at_target')
})
test('blocks wrong focus, mismatched property count, stale samples and invalid target', async () => {
  const h = harness()
  assert.equal(await h.engine.setTarget('tune_scale:major'), false)
  assert.equal(h.state.prolink_discrete_set_status, 'blocked_focus')
  h.controllerState.properties.lastSeenAtMs -= 5000
  assert.equal(await h.engine.setTarget('cla76_analog:off'), false)
  assert.equal(await h.engine.setTarget('unknown:foo'), false)
  assert.equal(h.writes.length, 0)
})
test('rejects a concurrent request rather than supersede pending transaction', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:off')
  assert.equal(await h.engine.setTarget('cla76_analog:60hz'), false)
  assert.equal(h.writes.length, 1)
  h.engine.reset()
  assert.equal(await promise, false)
})
test('rejects other ongoing Tune action and V10 evidence probe', async () => {
  const h = harness()
  h.instance._tuneScaleControl.pending = {}
  assert.equal(await h.engine.setTarget('cla76_analog:off'), false)
  h.instance._tuneScaleControl.pending = null
  h.instance._discreteEvidence.pending = {}
  assert.equal(await h.engine.setTarget('cla76_analog:off'), false)
  assert.equal(h.writes.length, 0)
})
test('unexpected value aborts without follow-on switch', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:off')
  h.read(2)
  assert.equal(await promise, false)
  assert.equal(h.state.prolink_discrete_set_status, 'unexpected_readback')
  assert.equal(h.writes.length, 1)
})
test('unexpected label aborts on a known discrete target', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:60hz')
  h.read(1, 'Unknown')
  assert.equal(await promise, false)
  assert.equal(h.state.prolink_discrete_set_status, 'invalid_readback')
})
test('properties/focus change aborts, no follow-on command', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:off')
  h.controllerState.observeProperties(TUNE)
  h.engine.onProperties()
  assert.equal(await promise, false)
  assert.equal(h.writes.length, 1)
  assert.equal(h.state.prolink_discrete_set_status, 'focus_changed')
})
test('disconnect resets pending without success', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:off')
  h.instance._prolink.state = 'disconnected'
  h.engine.reset()
  assert.equal(await promise, false)
  assert.equal(h.writes.length, 1)
})
test('timeout does not retry and never confirms success', async () => {
  const h = harness('cla76_analog', 0, { timeoutMs: 15 })
  assert.equal(await h.engine.setTarget('cla76_analog:off'), false)
  assert.equal(h.writes.length, 1)
  assert.equal(h.state.prolink_discrete_set_status, 'readback_timeout')
})
test('command rejected fails without fake success', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:60hz')
  h.engine.onResult('SwitchControllerValue', false)
  assert.equal(await promise, false)
  assert.equal(h.state.prolink_discrete_set_status, 'command_rejected')
})

test('Companion wiring: generic action and CLA76 presets, feedbacks and variables exist', async () => {
  const Module = require('module'), load = Module._load
  try {
    Module._load = function(name, parent, isMain) {
      if (name === '@companion-module/base') return { combineRgb: (r,g,b) => (r << 16) | (g << 8) | b }
      return load.call(this, name, parent, isMain)
    }
    const h = harness()
    const self = h.instance
    self.label = 'SuperRack'
    self._buildRackChoices = () => []
    self._buildHotPluginChoices = () => []
    self._buildHotSnapshotChoices = () => []
    self.setActionDefinitions = actions => { self.actions = actions }
    self.setPresetDefinitions = presets => { self.presets = presets }
    self.setVariableDefinitions = variables => { self.variableDefs = variables }
    self.setFeedbackDefinitions = feedbacks => { self.feedbacks = feedbacks }
    require('../actions')(self)
    require('../presets')(self)
    await require('../feedbacks')(self)
    require('../variables')(self)
    assert.equal(self.actions.prolink_discrete_set_target.options[0].choices.length, 47)
    for (const [id, value] of [['50hz',0],['60hz',1],['off',2]]) {
      const preset = self.presets[`cla76_analog_${id}`]
      assert.equal(preset.steps[0].down[0].actionId, 'prolink_discrete_set_target')
      assert.equal(preset.steps[0].down[0].options.target, `cla76_analog:${id}`)
      assert.equal(preset.feedbacks[0].feedbackId, 'prolink_discrete_matches')
      assert.equal(self.feedbacks.prolink_discrete_matches.callback({options:{target:`cla76_analog:${id}`}}), value===0)
    }
    const promise = self.actions.prolink_discrete_set_target.callback({options:{target:'cla76_analog:60hz'}})
    assert.equal(h.writes.length, 1)
    assert.equal(self.feedbacks.prolink_discrete_busy.callback(), true)
    h.read(1)
    assert.equal(await promise, true)
    assert.equal(self.feedbacks.prolink_discrete_busy.callback(), false)
    assert.equal(self.feedbacks.prolink_discrete_matches.callback({options:{target:'cla76_analog:60hz'}}), true)
    for(const id of ['prolink_discrete_set_status','prolink_discrete_set_target',
      'prolink_discrete_set_observed','prolink_discrete_set_steps','prolink_discrete_set_error']) {
      assert.ok(self.variableDefs.some(v=>v.variableId===id), id)
    }
  } finally { Module._load = load }
})

test('V11 generic busy blocks original Tune V7 action and manual V10 probe', async () => {
  const h = harness()
  const registerActions = require('../actions')
  h.instance._buildRackChoices = () => []
  h.instance._buildHotPluginChoices = () => []
  h.instance._buildHotSnapshotChoices = () => []
  h.instance._controlFailure = () => false
  h.instance.setActionDefinitions = actions => { h.instance.actions = actions }
  h.instance._tuneScaleControl = { pending: null, setScale() { throw new Error('Should not be called') } }
  registerActions(h.instance)
  const promise = h.instance.actions.prolink_discrete_set_target.callback({options:{target:'cla76_analog:off'}})
  assert.equal(h.writes.length,1)
  assert.equal(h.instance.probeFocusedDiscreteSwitch('cla76_analog'),false)
  assert.equal(h.writes.length,1)
  h.engine.reset()
  assert.equal(await promise,false)
})

test('duplicate same-value notification does not advance or abort pending step', async () => {
  const h = harness()
  const promise = h.engine.setTarget('cla76_analog:off')
  h.engine.onValue() // repeated pre-change value
  assert.equal(h.engine.pending?.waiting, true)
  assert.equal(h.writes.length, 1)
  h.read(1); h.read(2)
  assert.equal(await promise, true)
})
test('send failure is reported without a success or artificial retry', async () => {
  const h = harness()
  h.instance._sendProlink = (...args) => { h.writes.push(args); return false }
  assert.equal(await h.engine.setTarget('cla76_analog:off'), false)
  assert.equal(h.state.prolink_discrete_set_status, 'send_failed')
  assert.equal(h.writes.length, 1)
})
test('unknown CLA-76 Analog label cannot be accepted as a valid existing state', async () => {
  const h = harness()
  h.controllerState.observeValue(['Unrecognized', 0])
  assert.equal(await h.engine.setTarget('cla76_analog:off'), false)
  assert.equal(h.writes.length, 0)
})
