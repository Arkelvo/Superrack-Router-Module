'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { ProLinkDiscreteEvidence, observed, MAX_RECORDS } = require('../lib/prolink-discrete-evidence')
const registerActions = require('../actions')

const scale = ['Scale Type', false, 44, 0, 32, '', .001, 0, false, 1, 'Tune RT', 'User Scale', 'Asavari (Carnatic)']
const analog = ['Analog', false, 3, 0, 1, '', .001, 0, false, 1, 'CLA-76', '50Hz', 'Off']
const speed = ['Speed', true, 0, .1, 800, 'ms', .001, 0, false, 1, 'Tune RT', '.1', '800.0']
function setup({ timeoutMs = 25, sendOk = true } = {}) {
  const vars = {}, sent = [], logs = [], errors = []
  const self = {
    config: { controlTransport: 'prolink' }, _prolink: { state: 'connected', onState() {} }, _prolinkReady: true,
    setVariableValues: data => Object.assign(vars, data), checkFeedbacks() {},
    _log: (...args) => logs.push(args), _controlFailure: reason => { errors.push(reason); return false },
    _sendProlink: (command, value) => { sent.push([command, value]); return sendOk },
    _buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
    setActionDefinitions: actions => { self.actions = actions },
  }
  self._prolinkObservations = new ProLinkObservations(self)
  self._discreteEvidence = new ProLinkDiscreteEvidence(self, {timeoutMs})
  registerActions(self)
  const select = (p, label, raw) => {
    self._prolinkObservations.observeControllerProperties(p)
    self._prolinkObservations.observeControllerValue([label, raw])
  }
  return { self, select, vars, sent, logs, errors, stop: () => self._prolinkObservations.reset() }
}
const probe = (x, target) => x.self.actions.prolink_discrete_switch_probe.callback({options: {target}})

test('CLA76 Analog single switch is recorded only after an actual changed readback', async () => {
  const x = setup(); x.select(analog, '60Hz', 2)
  assert.equal(await probe(x, 'cla76_analog'), true)
  assert.equal(x.vars.prolink_discrete_evidence_status, 'awaiting_readback')
  assert.deepEqual(x.sent, [['SwitchControllerValue',true]])
  x.self._prolinkObservations.observeControllerValue(['60Hz',2])
  assert.equal(x.vars.prolink_discrete_evidence_count, 0)
  x.self._prolinkObservations.observeControllerValue(['Off',0])
  assert.equal(x.vars.prolink_discrete_evidence_status, 'observed_value_changed')
  const record = JSON.parse(x.vars.prolink_discrete_evidence_json).records[0]
  assert.deepEqual(record.before, {label:'60Hz',raw:2})
  assert.deepEqual(record.after, {label:'Off',raw:0})
  assert.equal(record.matchesExpectedForwardCandidate, true)
  assert.equal(record.observedValueChange, true)
  assert.equal(JSON.parse(x.vars.prolink_discrete_evidence_json).resultIsCausalProof, false)
  x.stop()
})

test('readback mismatch does not infer a valid cyclic increment', async () => {
  const x = setup(); x.select(analog,'Off',0)
  await probe(x,'cla76_analog')
  x.self._prolinkObservations.observeControllerValue(['60Hz',2])
  const record = JSON.parse(x.vars.prolink_discrete_evidence_json).records[0]
  assert.equal(record.observedValueChange,true)
  assert.equal(record.matchesExpectedForwardCandidate,false)
  x.stop()
})

test('focus changed aborts pending evidence without claiming a changed value', async () => {
  const x=setup();x.select(scale,'Major',2)
  await probe(x,'tune_scale')
  x.self._prolinkObservations.observeControllerProperties(speed)
  assert.equal(x.vars.prolink_discrete_evidence_status,'focus_changed')
  assert.equal(JSON.parse(x.vars.prolink_discrete_evidence_json).records[0].after,null)
  x.stop()
})

test('timeout records no readback and clears timer', async () => {
  const x=setup({timeoutMs:12});x.select(analog,'60Hz',2)
  await probe(x,'cla76_analog')
  await new Promise(resolve=>setTimeout(resolve,30))
  assert.equal(x.vars.prolink_discrete_evidence_status,'readback_timeout')
  assert.equal(JSON.parse(x.vars.prolink_discrete_evidence_json).records[0].observedValueChange,false)
  x.stop()
})

test('disconnect preserves prior evidence and stops pending timer', async () => {
  const x=setup();x.select(analog,'Off',0)
  await probe(x,'cla76_analog')
  x.self._prolinkObservations.observeControllerValue(['50Hz',1])
  x.self._prolinkDiscreteSwitchLastSend.atMs -= 2500
  await probe(x,'cla76_analog')
  x.self._prolinkObservations.reset()
  const exportData=JSON.parse(x.vars.prolink_discrete_evidence_json)
  assert.equal(exportData.records.length,2)
  assert.equal(exportData.records[0].observedValueChange,true)
  assert.equal(exportData.records[1].status,'connection_or_module_reset')
})

test('transport send failure cannot report observed success', async () => {
  const x=setup({sendOk:false});x.select(scale,'Major',2)
  assert.equal(await probe(x,'tune_scale'),false)
  assert.equal(x.vars.prolink_discrete_evidence_status,'send_failed')
  assert.equal(JSON.parse(x.vars.prolink_discrete_evidence_json).records[0].after,null)
  x.stop()
})

test('disconnected, continuous, wrong shape or stale data cannot arm probe',async()=>{
  const x=setup();x.select(speed,'135.8',674)
  assert.equal(await probe(x,'tune_scale'),false)
  x.select(scale,'Major',2)
  assert.equal(observed(x.self._prolinkObservations.controllerState)?.raw,2)
  x.self._prolinkObservations.controllerState.value.lastSeenAtMs-=4000
  assert.equal(await probe(x,'tune_scale'),false)
  x.stop()
  assert.deepEqual(x.sent,[])
})

test('export action is read-only and local clear is blocked while pending',async()=>{
  const x=setup();x.select(analog,'Off',0)
  assert.equal(await probe(x,'cla76_analog'),true)
  assert.equal(await x.self.actions.prolink_discrete_evidence_clear.callback(),false)
  assert.equal(await x.self.actions.prolink_discrete_evidence_export.callback(),true)
  assert.equal(x.sent.length,1)
  x.self._prolinkObservations.observeControllerValue(['50Hz',1])
  assert.equal(await x.self.actions.prolink_discrete_evidence_clear.callback(),true)
  assert.equal(x.vars.prolink_discrete_evidence_count,0)
  assert.equal(x.sent.length,1)
  x.stop()
})

test('bounded evidence does not accumulate indefinitely',()=>{
  const x=setup()
  const e=x.self._discreteEvidence
  for(let i=0;i<MAX_RECORDS+4;i++) {
    x.select(analog,'Off',0)
    assert.equal(e.begin({plugin:'CLA-76',name:'Analog',count:3}),true)
    x.self._prolinkObservations.observeControllerValue(['50Hz',1])
    x.self._prolinkObservations.observeControllerValue(['Off',0])
  }
  assert.equal(e.records.length,MAX_RECORDS)
  assert.equal(e.records[0].status,'observed_value_changed')
  x.stop()
})

test('Companion exposes V10 evidence variables and export preset with a real action', () => {
  const Module=require('module'),original=Module._load
  try {
    Module._load=function(name,parent,isMain) {
      if(name==='@companion-module/base') return {combineRgb:(r,g,b)=>(r<<16)|(g<<8)|b}
      return original.call(this,name,parent,isMain)
    }
    const x=setup(); x.self.label='test'
    x.self.setPresetDefinitions=presets=>{ x.self.presets=presets }
    x.self.setVariableDefinitions=vars=>{x.self.variableDefs=vars}
    require('../variables')(x.self)
    require('../presets')(x.self)
    assert.ok(x.self.actions.prolink_discrete_evidence_export)
    assert.ok(x.self.presets.prolink_discrete_evidence_export)
    assert.equal(x.self.presets.prolink_discrete_evidence_export.steps[0].down[0].actionId,'prolink_discrete_evidence_export')
    for(const id of ['prolink_discrete_evidence_status','prolink_discrete_evidence_count','prolink_discrete_evidence_json']) {
      assert.ok(x.self.variableDefs.find(v=>v.variableId===id),id)
    }
    x.stop()
  } finally { Module._load=original }
})
