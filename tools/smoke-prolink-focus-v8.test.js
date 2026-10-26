'use strict'

// Run: node --test tools/smoke-prolink-focus-v8.test.js
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { ProLinkFocusAudit, MAX_EVENTS, MAX_MARKS } = require('../lib/prolink-focus-audit')
const registerActions = require('../actions')

const SPEED = ['Speed', true, 0, 0.1, 800, 'ms', 0.001, 0, false, 1, 'Tune RT', '0.1', '800.0']
const SCALE = ['Scale Type', false, 44, 0, 32, '', 0.001, 0, false, 1, 'Tune RT', 'User Scale', 'Asavari (Carnatic)']

function setup() {
  let clock = Date.now()
  const vars = {}, calls = []
  const self = {
    config: {controlTransport:'prolink'}, _prolinkReady:true,
    _prolink: {state:'connected', onState() {}},
    setVariableValues(v) {Object.assign(vars,v)}, checkFeedbacks() {},
    _log() {}, _sendProlink(...args) {calls.push(args); return true},
    _buildRackChoices:()=>[], _buildHotPluginChoices:()=>[], _buildHotSnapshotChoices:()=>[],
    setActionDefinitions(actions) {self.actions = actions},
  }
  self._prolinkObservations = new ProLinkObservations(self)
  self._focusAudit = new ProLinkFocusAudit(self, ()=>clock)
  registerActions(self)
  return {
    self, vars, calls, obs:self._prolinkObservations, audit:self._focusAudit,
    tick(n=1) {clock+=n},
    export() {return JSON.parse(vars.prolink_focus_audit_json)},
    focus(props, text, raw) {
      self._prolinkObservations.observeControllerProperties(props)
      self._prolinkObservations.observeControllerValue([text,raw])
    },
  }
}

test('start requires a connected ProLink transport and never sends a network command', () => {
  const x=setup()
  x.self._prolink.state='waiting'
  assert.equal(x.audit.start(),false)
  assert.equal(x.vars.prolink_focus_audit_status,'blocked_disconnected')
  x.self._prolink.state='connected'
  assert.equal(x.audit.start(),true)
  assert.equal(x.audit.start(),false)
  assert.equal(x.vars.prolink_focus_audit_status,'recording')
  assert.equal(x.export().remoteFocusSetterVerified,false)
  assert.deepEqual(x.calls,[])
})

test('unchanged periodic controller frames do not fill the event buffer',()=>{
  const x=setup()
  x.focus(SPEED,'20',20)
  x.audit.start()
  for(let i=0;i<300;i++) x.focus(SPEED,'20',20)
  x.audit.stop()
  const result=x.export()
  assert.equal(result.status,'stopped')
  assert.equal(result.events.length,2)
  assert.equal(result.droppedEvents,0)
  assert.equal(result.events[0].state.controller,'Speed')
  assert.equal(result.events[0].state.pluginLabel,'Tune RT')
  assert.equal(result.events[0].state.remotelyAddressable,false)
  assert.deepEqual(x.calls,[])
})

test('records real controller-property changes, then new matching values',()=>{
  const x=setup()
  x.focus(SPEED,'20',20)
  x.audit.start()
  x.tick(10)
  x.obs.observeControllerProperties(SCALE)
  x.tick(1)
  x.obs.observeControllerValue(['Major',2])
  x.audit.stop()
  const result=x.export()
  assert.deepEqual(result.events.map(e=>e.kind), [
    'start', 'focus_properties_changed', 'controller_value_changed','stop'
  ])
  assert.equal(result.events[1].state.controller,'Scale Type')
  assert.equal(result.events[1].state.valueText,null)
  assert.equal(result.events[1].state.paired,false)
  assert.equal(result.events[2].state.rawValue,2)
  assert.equal(result.events[2].state.contextVersion,2)
  assert.equal(result.events[2].state.discreteCountCandidate,44)
  assert.deepEqual(x.calls,[])
})

test('checkpoints prove only observations and never assert remote focus capability',()=>{
  const x=setup()
  x.focus(SPEED,'20',20)
  x.audit.start()
  assert.equal(x.audit.mark('after_plugin_selection'),true)
  assert.equal(x.audit.mark('after_root_click'),true)
  x.audit.stop()
  const result=x.export()
  assert.equal(result.markCount,2)
  assert.equal(result.events[1].state.controller,'Speed')
  assert.equal(result.events[2].state.controller,'Speed')
  assert.equal(result.remoteFocusSetterVerified,false)
  assert.equal(x.audit.mark('after_root_click'),false)
  assert.equal(x.audit.mark('unexpected_untrusted_label'),false)
})

test('ownership changes are captured as raw observations without guessing meaning of 1',()=>{
  const x=setup()
  x.audit.start()
  x.obs.observeStatus('NotifyTouchAndTurnControlOwnership','prolink_touch_ownership',[1])
  x.obs.observeStatus('NotifyTouchAndTurnControlOwnership','prolink_touch_ownership',[1])
  x.obs.observeStatus('NotifyTouchAndTurnControlOwnership','prolink_touch_ownership',[0])
  x.audit.stop()
  const result=x.export()
  assert.equal(result.countByKind.touch_ownership_changed,2)
  assert.deepEqual(result.events.filter(e=>e.kind==='touch_ownership_changed').map(e=>e.state.touchOwnershipRaw),[1,0])
  assert.deepEqual(x.calls,[])
})

test('disconnect interrupts capture and repeated resets retain evidence for copy',()=>{
  const x=setup()
  x.focus(SPEED,'20',20)
  x.audit.start()
  x.self._prolink.state='waiting'
  x.obs.reset()
  assert.equal(x.vars.prolink_focus_audit_status,'interrupted')
  const original=x.vars.prolink_focus_audit_json
  const result=x.export()
  assert.equal(result.events.at(-1).kind,'connection_reset')
  assert.equal(result.events.at(-1).state.connected,false)
  assert.equal(typeof result.stoppedAtMs,'number')
  x.obs.reset()
  assert.equal(x.vars.prolink_focus_audit_json,original)
  x.audit.reset(true)
  assert.equal(x.vars.prolink_focus_audit_status,'idle')
  assert.equal(x.vars.prolink_focus_audit_json,'')
})

test('stop freezes the export, next successful start creates fresh evidence',()=>{
  const x=setup()
  x.audit.start();x.audit.stop()
  const old=x.vars.prolink_focus_audit_json
  x.focus(SCALE,'Major',2)
  assert.equal(x.vars.prolink_focus_audit_json,old)
  assert.equal(x.audit.start(),true)
  assert.equal(x.export().events.length,1)
  assert.equal(x.export().events[0].state.controller,'Scale Type')
})

test('bounded event capacity and checkpoints cannot create unbounded exports',()=>{
  const x=setup()
  x.audit.start()
  for(let i=0;i<MAX_MARKS+5;i++) x.audit.mark('other')
  assert.equal(x.export().markCount,MAX_MARKS)
  for(let i=0;i<MAX_EVENTS+10;i++) x.obs.observeControllerValue([`v${i}`,i])
  x.audit.stop()
  assert.equal(x.export().events.length,MAX_EVENTS)
  assert.ok(x.export().droppedEvents>0)
  assert.equal(x.audit.mark('other'),false)
})

test('registered Companion actions are read-only and preserve V7 writer definitions',async()=>{
  const x=setup()
  x.focus(SCALE,'Major',2)
  const action=x.self.actions
  assert.ok(action.tune_set_scale)
  assert.ok(action.prolink_focus_audit_start)
  assert.ok(action.prolink_focus_audit_mark)
  assert.ok(action.prolink_focus_audit_stop)
  assert.equal(await action.prolink_focus_audit_start.callback(),true)
  assert.equal(await action.prolink_focus_audit_mark.callback({options:{checkpoint:'after_root_click'}}),true)
  assert.equal(await action.prolink_focus_audit_stop.callback(),true)
  assert.equal(x.export().events[1].label,'after_root_click')
  assert.deepEqual(x.calls,[])
})

test('read-only focus audit Companion presets and variables exist',()=>{
  const Module=require('module'), load=Module._load
  let registerPresets
  try {
    Module._load=function(id, ...args) {
      if(id==='@companion-module/base') return {combineRgb:(r,g,b)=>(r<<16)|(g<<8)|b}
      return load.call(this,id,...args)
    }
    registerPresets=require('../presets')
  } finally {Module._load=load}
  const x=setup()
  x.self.label='test'
  x.self.setPresetDefinitions=presets=>x.presets=presets
  registerPresets(x.self)
  assert.ok(x.presets.prolink_focus_audit_start)
  assert.ok(x.presets.prolink_focus_audit_mark)
  assert.ok(x.presets.prolink_focus_audit_stop)
  assert.ok(x.presets.tune_scale_major) // V7 unchanged
  const variables=require('../variables')
  x.self.setVariableDefinitions=vars=>x.variableDefs=vars
  variables(x.self)
  for(const key of ['prolink_focus_audit_status','prolink_focus_audit_count','prolink_focus_audit_json'])
    assert.ok(x.variableDefs.some(v=>v.variableId===key))
})
