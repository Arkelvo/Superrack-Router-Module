'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const cycle = require('../lib/prolink-discrete-cycle')
const { blocksCompetingControllerWrite } = require('../lib/prolink-controller-write-lock')
const { ProLinkControllerState } = require('../lib/prolink-controller-state')
const { ProLinkDiscreteControl, PROFILES } = require('../lib/prolink-discrete-control')

const CLA = ['Analog',false,3,0,1,'',0.001,0,false,1,'CLA-76','50Hz','Off']
const TUNE = ['Scale Type',false,44,0,32,'',0.001,0,false,1,'Tune RT','User Scale','Asavari (Carnatic)']
function harness(profile = 'cla76_analog', raw = 0) {
  const cs = new ProLinkControllerState()
  cs.observeProperties(profile === 'cla76_analog' ? CLA : TUNE)
  const labels = profile === 'cla76_analog' ? ['50Hz','60Hz','Off'] : PROFILES.tune_scale.targets.map(x=>x.label)
  cs.observeValue([labels[raw], raw])
  const writes = [], values = {}
  const self = {
    config: { controlTransport: 'prolink' }, _prolinkReady: true,
    _prolink: { state: 'connected' },
    _prolinkObservations: { controllerState: cs, controllerWrite: null,
      trackControllerWrite(x) { this.controllerWrite = x } },
    _tuneScaleControl: { pending: null }, _discreteEvidence: { pending: null },
    _sendProlink(...args) { writes.push(args); return true },
    setVariableValues(x) { Object.assign(values,x) }, checkFeedbacks() {}, _log() {},
  }
  const engine = new ProLinkDiscreteControl(self, { timeoutMs: 40 })
  self._discreteControl = engine
  return { cs, writes, values, self, engine }
}

test('shared cyclic model maps 43 -> 0 -> 1 -> 2 and 2 -> 0 with exactly bounded steps', () => {
  assert.deepEqual(cycle.buildCyclicPlan(43,2,44).expectedRawSequence,[0,1,2])
  assert.deepEqual(cycle.buildCyclicPlan(2,0,3).expectedRawSequence,[0])
  assert.equal(cycle.forwardDistance(9,2,44),37)
  assert.equal(cycle.nextRaw(2,3),0)
  assert.equal(cycle.forwardDistance(2,2,3),0)
})

test('invalid counts and raw values can never produce a plan', () => {
  for(const [from,to,count] of [[-1,0,3],[0,3,3],[0,0,0],[0,0,1],[1,1,2.5],['1',0,3]]) {
    assert.throws(()=>cycle.buildCyclicPlan(from,to,count),RangeError)
  }
  assert.throws(()=>cycle.nextRaw(3,3),RangeError)
})

test('duplicate notifications do not advance, unexpected values abort', () => {
  assert.equal(cycle.classifyStep(0,0,3,'old','old').kind,'duplicate')
  assert.equal(cycle.classifyStep(0,1,3,'old','new').kind,'advance')
  assert.equal(cycle.classifyStep(0,2,3,'old','new').kind,'unexpected')
})

test('read-only preview shows current CLA-76 focus and exact target plan, sends nothing', () => {
  const x = harness()
  assert.equal(x.engine.previewTarget('cla76_analog:off'),true)
  const payload = JSON.parse(x.values.prolink_discrete_plan_json)
  assert.equal(payload.status,'ready')
  assert.equal(payload.sendsCommands,false)
  assert.equal(payload.remoteParameterAddressingVerified,false)
  assert.equal(payload.requiresManualControllerFocus,true)
  assert.deepEqual(payload.expectedRawSequence,[1,2])
  assert.equal(payload.steps,2)
  assert.equal(payload.focused.label,'50Hz')
  assert.deepEqual(x.writes,[])
})

test('read-only preview supports 44 Tune states and identifies mapping assumptions', () => {
  const x = harness('tune_scale',43)
  assert.equal(x.engine.previewTarget('tune_scale:major'),true)
  const payload = JSON.parse(x.values.prolink_discrete_plan_json)
  assert.deepEqual(payload.expectedRawSequence,[0,1,2])
  assert.match(payload.mappingNote,/UI order/)
  assert.equal(x.writes.length,0)
})

test('preview never reports ready with wrong focus, disconnected transport, stale value or active write', () => {
  const x = harness()
  assert.equal(x.engine.previewTarget('tune_scale:major'),false)
  assert.equal(x.values.prolink_discrete_plan_status,'blocked_focus')
  x.cs.value.lastSeenAtMs -= 10000
  assert.equal(x.engine.previewTarget('cla76_analog:off'),false)
  assert.equal(x.values.prolink_discrete_plan_status,'blocked_focus')
  x.cs.value.lastSeenAtMs = Date.now()
  x.self._prolinkObservations.controllerWrite = {command:'SwitchControllerValue'}
  assert.equal(x.engine.previewTarget('cla76_analog:off'),false)
  assert.equal(x.values.prolink_discrete_plan_status,'blocked_pending')
  x.self._prolink.state='disconnected'
  assert.equal(x.engine.previewTarget('cla76_analog:off'),false)
  assert.equal(x.values.prolink_discrete_plan_status,'disconnected')
  assert.equal(x.engine.previewTarget('evil:value'),false)
  assert.equal(x.values.prolink_discrete_plan_status,'invalid_target')
  assert.deepEqual(x.writes,[])
})

test('focus identity publishes only fresh recognized profiles and clears after switch', () => {
  const x = harness()
  x.engine.onValue()
  assert.equal(x.values.prolink_discrete_focus_profile,'cla76_analog')
  assert.equal(x.values.prolink_discrete_focus_name,'CLA-76 / Analog')
  x.cs.observeProperties(TUNE)
  x.engine.onProperties()
  assert.equal(x.values.prolink_discrete_focus_profile,'')
  assert.equal(x.values.prolink_discrete_focus_name,'')
  x.engine.reset()
  assert.equal(x.values.prolink_discrete_set_ready,false)
})

test('exclusive controller write lock blocks V7 and V11 competing writes in both directions', () => {
  const pending = {pending:{},sending:false}
  const free = {pending:null,sending:false}
  assert.equal(blocksCompetingControllerWrite('SwitchControllerValue',pending,free),true)
  assert.equal(blocksCompetingControllerWrite('ChangeControllerValue',pending,free),true)
  assert.equal(blocksCompetingControllerWrite('SwitchControllerValue',free,pending),true)
  assert.equal(blocksCompetingControllerWrite('SwitchControllerValue',{pending:{},sending:true},free),false)
  assert.equal(blocksCompetingControllerWrite('ChangeControllerValue',free,{pending:{},sending:true}),false)
  assert.equal(blocksCompetingControllerWrite('SetTempo',pending,pending),false)
  assert.equal(blocksCompetingControllerWrite('SwitchControllerValue',free,free),false)
})

test('live-verified action and new profile feedbacks/presets are correctly wired', async () => {
  const Module = require('module'), previous = Module._load
  Module._load = function(name,parent,isMain) {
    if(name === '@companion-module/base') return {combineRgb:(r,g,b)=>(r<<16)|(g<<8)|b}
    return previous.call(this,name,parent,isMain)
  }
  try {
    const x = harness()
    const s = x.self
    s.label = 'SuperRack'
    s._buildRackChoices = () => []
    s._buildHotPluginChoices = () => []
    s._buildHotSnapshotChoices = () => []
    s.setActionDefinitions = v => s.actions=v
    s.setFeedbackDefinitions = v => s.feedbacks=v
    s.setVariableDefinitions = v => s.variableDefs=v
    s.setPresetDefinitions = v => s.presets=v
    require('../actions')(s)
    await require('../feedbacks')(s)
    require('../variables')(s)
    require('../presets')(s)
    assert.equal(s.actions.prolink_discrete_preview_target.options[0].choices.length,47)
    assert.equal(await s.actions.prolink_discrete_preview_target.callback({options:{target:'cla76_analog:off'}}),true)
    assert.equal(x.writes.length,0)
    assert.equal(s.feedbacks.prolink_discrete_profile_focused.callback({options:{profile:'cla76_analog'}}),true)
    assert.equal(s.feedbacks.prolink_discrete_profile_focused.callback({options:{profile:'tune_scale'}}),false)
    assert.equal(s.presets.prolink_discrete_focus_cla76_analog.feedbacks[0].feedbackId,'prolink_discrete_profile_focused')
    assert.equal(s.presets.prolink_discrete_focus_tune_scale.steps[0].down.length,0)
    assert.match(s.presets.prolink_discrete_set_status.style.text,/Ziel:/)
    for(const key of ['prolink_discrete_plan_status','prolink_discrete_plan_json',
      'prolink_discrete_focus_profile','prolink_discrete_focus_name']) {
      assert.ok(s.variableDefs.some(x=>x.variableId===key),key)
    }
  } finally { Module._load = previous }
})

test('V7 scale controller tolerates repeated same-value notifications without false step or extra command', async () => {
  const { ProLinkTuneScaleControl } = require('../lib/prolink-tune-scale-control')
  const x = harness('tune_scale',43)
  const tune = new ProLinkTuneScaleControl(x.self,{timeoutMs:50})
  x.self._tuneScaleControl = tune
  const run = tune.setScale('major')
  assert.equal(x.writes.length,1)
  tune.onValue() // duplicate old frame: must not abort the live sequence
  assert.equal(x.writes.length,1)
  for(const n of [0,1,2]) {
    x.cs.observeValue([PROFILES.tune_scale.targets[n].label,n])
    x.self._prolinkObservations.controllerWrite=null
    tune.onValue()
  }
  assert.equal(await run,true)
  assert.equal(x.writes.length,3)
  assert.equal(x.values.tune_status,'scale_observed_target')
})

test('a live V7 send is recognized as the exclusive owner only during its synchronous send', async () => {
  const { ProLinkTuneScaleControl } = require('../lib/prolink-tune-scale-control')
  const x = harness('tune_scale', 2)
  const tune = new ProLinkTuneScaleControl(x.self,{timeoutMs:40})
  x.self._tuneScaleControl = tune
  const observedLocks = []
  x.self._sendProlink = (...args) => {
    observedLocks.push({ args, tuneSending:tune.sending, blocked:blocksCompetingControllerWrite(args[0],tune,x.engine) })
    return true
  }
  const promise = tune.setScale('natural_minor')
  assert.deepEqual(observedLocks.map(x=>x.blocked),[false])
  assert.equal(observedLocks[0].tuneSending,true)
  assert.equal(blocksCompetingControllerWrite('SwitchControllerValue',tune,x.engine),true)
  x.cs.observeValue(['Natural Minor',3]); x.self._prolinkObservations.controllerWrite=null; tune.onValue()
  assert.equal(await promise,true)
  assert.equal(blocksCompetingControllerWrite('SwitchControllerValue',tune,x.engine),false)
})
