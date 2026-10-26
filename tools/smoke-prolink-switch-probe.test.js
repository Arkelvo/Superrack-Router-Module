'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { encodeOsc, encodeCommand } = require('../lib/prolink-codec')
const { decodeOsc } = require('../lib/prolink-osc')
const { ProLinkObservations } = require('../lib/prolink-observations')
const registerActions = require('../actions')

const scale = ['Scale Type', false, 44, 0, 32, '', 0.001, 0, false, 1, 'Tune RT', 'User Scale', 'Asavari (Carnatic)']
const analog = ['Analog', false, 3, 0, 1, '', 0.001, 0, false, 1, 'CLA-76', '50Hz', 'Off']
const speed = ['Speed', true, 0, 0.1, 800, 'ms', 0.001, 0, false, 1, 'Tune RT', '0.1', '800.0']
function setup() {
  const sent = [], failed = [], vars = {}, logs = []
  const self = {
    config: { controlTransport: 'prolink' },
    _prolink: { state: 'connected', onState() {} }, _prolinkReady: true,
    setVariableValues: v => Object.assign(vars, v),
    checkFeedbacks() {}, updateActions() {}, _log: (...args) => logs.push(args),
    _controlFailure: (error) => { failed.push(error); return false },
    _sendProlink: (command, arg) => { sent.push([command, arg]); return true },
    _buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
    setActionDefinitions: actions => { self.actions = actions },
  }
  self._prolinkObservations = new ProLinkObservations(self)
  registerActions(self)
  const select = (properties, text, num) => {
    self._prolinkObservations.observeControllerProperties(properties)
    self._prolinkObservations.observeControllerValue([text, num])
  }
  return {self, sent, failed, vars, logs, select, reset: ()=>self._prolinkObservations.reset()}
}

test('wire: only the OSC bool tag (no data bytes) after the int32 request id', () => {
  const on = encodeOsc('SwitchControllerValue', 53, true)
  const off = encodeOsc('SwitchControllerValue', 53, false)
  assert.deepEqual(decodeOsc(on), {path:'/waves.com/remote/SwitchControllerValue', args:[53, true]})
  assert.deepEqual(decodeOsc(off), {path:'/waves.com/remote/SwitchControllerValue', args:[53, false]})
  assert.equal(on.length, off.length)
  assert.equal(encodeCommand('SwitchControllerValue', 53, true).readInt32BE(12), on.length)
  for(const v of [0, 1, 'true', undefined, null]) assert.throws(()=>encodeOsc('SwitchControllerValue', 53, v))
})

test('one manual probe sends OSC true only for fresh, matching Tune Scale Type', async() => {
  const c = setup(); c.select(scale, 'Major', 2)
  assert.equal(await c.self.actions.prolink_discrete_switch_probe.callback({options: {target:'tune_scale'}}), true)
  assert.deepEqual(c.sent, [['SwitchControllerValue', true]])
  assert.equal(c.vars.prolink_controller_write_status, 'awaiting_change')
  assert.equal(c.logs.filter(x=>x[1]==='[PROLINK_DISCRETE_SWITCH_PROBE_SENT]').length,1)
  assert.equal(c.logs.find(x=>x[1]==='[PROLINK_DISCRETE_SWITCH_PROBE_SENT]')[2].confirmed, false)
  c.self._prolinkObservations.observeControllerValue(['Natural Minor',3])
  assert.equal(c.vars.prolink_controller_write_status, 'observed_after_send')
  c.reset()
})

test('one manual probe accepts a focused Analog control but not Scale under that selection', () => {
  const c=setup(); c.select(analog,'60Hz',2)
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  assert.equal(c.self.probeFocusedDiscreteSwitch('cla76_analog'),true)
  assert.deepEqual(c.sent, [['SwitchControllerValue',true]])
  c.reset()
})

test('no blind sends: wrong type, missing value, stale, disconnected or wrong target', () => {
  const c=setup()
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  c.select(speed, '200.0',200)
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  c.select(scale, 'Major',2)
  assert.equal(c.self.probeFocusedDiscreteSwitch('__proto__'),false)
  c.self._prolinkObservations.controllerState.properties.lastSeenAtMs -= 4000
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  c.self._prolinkObservations.observeControllerProperties(scale)
  c.self._prolink.state='disconnected'
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  assert.deepEqual(c.sent,[])
  c.reset()
})

test('cooldown and pending writes prevent repeated probe commands', () => {
  const c=setup(); c.select(scale,'Major',2)
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),true)
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  c.self._prolinkObservations.observeControllerValue(['Natural Minor',3])
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  c.self._prolinkDiscreteSwitchLastSend.atMs -= 2200
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),true)
  assert.deepEqual(c.sent,[['SwitchControllerValue',true],['SwitchControllerValue',true]])
  c.reset()
})

test('no false success when observed value does not change or focus switches', () => {
  const c=setup(); c.select(scale,'Major',2)
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),true)
  c.self._prolinkObservations.observeControllerValue(['Major',2])
  assert.equal(c.vars.prolink_controller_write_status,'awaiting_change')
  c.self._prolinkObservations.observeControllerProperties(analog)
  assert.equal(c.vars.prolink_controller_write_status,'context_changed')
  c.reset()
})
