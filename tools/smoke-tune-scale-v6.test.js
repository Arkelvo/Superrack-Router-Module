'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { ProLinkTuneScaleControl, VERIFIED_SCALES } = require('../lib/prolink-tune-scale-control')
const registerActions = require('../actions')
const properties = ['Scale Type',false,44,0,32,'',0.001,0,false,1,'Tune RT','User Scale','Asavari (Carnatic)']
const speed = ['Speed',true,0,0.1,800,'ms',0.001,0,false,1,'Tune RT','0.1','800.0']

function setup() {
  const calls=[], values={}, logs=[]
  const self={
    config:{controlTransport:'prolink'}, _prolinkReady:true,
    _prolink:{state:'connected',onState(){}},
    setVariableValues:v=>Object.assign(values,v), checkFeedbacks(){}, updateActions(){},
    setActionDefinitions:a=>{self.actions=a},
    _sendProlink:(name,arg)=>{calls.push([name,arg]);return true},
    _log:(...args)=>logs.push(args), _controlFailure:()=>false,
    _buildRackChoices:()=>[], _buildHotPluginChoices:()=>[], _buildHotSnapshotChoices:()=>[],
  }
  self._prolinkObservations=new ProLinkObservations(self)
  self._tuneScaleControl=new ProLinkTuneScaleControl(self,{timeoutMs:40})
  registerActions(self)
  const observation=self._prolinkObservations
  const prop=p=>observation.observeControllerProperties(p)
  const value=(name,n)=>observation.observeControllerValue([name,n])
  const select=(name,n)=>{prop(properties);value(name,n)}
  const clean=()=>{self._tuneScaleControl.reset();observation.reset()}
  return {self,calls,values,logs,select,prop,value,clean,observation}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('44 UI-ordered choices preserve the previously observed 1..9 mapping',()=>{
  assert.equal(VERIFIED_SCALES.length,44)
  assert.deepEqual(VERIFIED_SCALES.slice(1,10).map(x=>x.raw),[1,2,3,4,5,6,7,8,9])
  assert.equal(VERIFIED_SCALES[0].label,'User Scale')
  assert.equal(VERIFIED_SCALES[43].label,'Asavari (Carnatic)')
  assert.equal(new Set(VERIFIED_SCALES.map(x=>x.id)).size,44)
})

test('two-step Scale Type command is event-driven, one OSC true per confirmed increment',async()=>{
  const c=setup(); c.select('Major',2)
  const run=c.self.actions.tune_set_scale.callback({options:{scale:'harmonic_minor'}})
  assert.deepEqual(c.calls,[['SwitchControllerValue',true]])
  assert.equal(c.values.tune_status,'changing_scale')
  c.value('Major',2)
  assert.equal(c.calls.length,1)
  c.value('Natural Minor',3)
  assert.deepEqual(c.calls,[['SwitchControllerValue',true],['SwitchControllerValue',true]])
  c.value('Harmonic Minor',4)
  assert.equal(await run,true)
  assert.equal(c.values.tune_status,'scale_observed_target')
  assert.equal(c.values.tune_scale,'Harmonic Minor')
  assert.equal(c.values.tune_scale_steps,2)
  assert.equal(c.values.tune_root,undefined)
  c.clean()
})

test('equal target needs no send; backwards goals now use verified cyclic forward stepping',async()=>{
  const c=setup();c.select('Natural Minor',3)
  assert.equal(await c.self._tuneScaleControl.setScale('natural_minor'),true)
  assert.equal(c.values.tune_status,'already_at_target')
  assert.equal(await c.self._tuneScaleControl.setScale('a scale not known'),false)
  assert.equal(c.values.tune_status,'invalid_target')
  assert.deepEqual(c.calls,[])
  // Start at the observed end of the 44-entry menu, then wrap 43 -> 0 -> 1 -> 2.
  c.select('Asavari (Carnatic)',43)
  const run=c.self._tuneScaleControl.setScale('major')
  c.value('User Scale',0)
  c.value('Chromatic',1)
  c.value('Major',2)
  assert.equal(await run,true)
  assert.equal(c.values.tune_scale_steps,3)
  assert.equal(c.calls.length,3)
  c.clean()
})

test('wrong plugin, focus, incomplete, stale, disconnected, or mismatched raw/text never send',async()=>{
  const c=setup()
  assert.equal(await c.self._tuneScaleControl.setScale('major'),false)
  c.prop(speed);c.value('140.0',140)
  assert.equal(await c.self._tuneScaleControl.setScale('major'),false)
  c.select('Major',2)
  c.observation.controllerState.value.lastSeenAtMs-=5000
  assert.equal(await c.self._tuneScaleControl.setScale('dorian'),false)
  c.value('Natural Minor',3)
  c.value('Incorrect label',4)
  assert.equal(await c.self._tuneScaleControl.setScale('dorian'),false)
  c.value('Major',2)
  c.self._prolink.state='waiting'
  assert.equal(await c.self._tuneScaleControl.setScale('dorian'),false)
  assert.deepEqual(c.calls,[])
  c.clean()
})

test('readback timeout aborts without blind retries or confirmed success',async()=>{
  const c=setup();c.select('Major',2)
  const ok=await c.self._tuneScaleControl.setScale('dorian')
  assert.equal(ok,false)
  assert.deepEqual(c.calls,[['SwitchControllerValue',true]])
  assert.equal(c.values.tune_status,'readback_timeout')
  c.clean()
})

test('focus change aborts sequence before next step',async()=>{
  const c=setup();c.select('Major',2)
  const run=c.self._tuneScaleControl.setScale('dorian')
  c.prop(speed)
  assert.equal(await run,false)
  c.value('150.0',150)
  assert.equal(c.calls.length,1)
  assert.equal(c.values.tune_status,'focus_changed')
  c.clean()
})

test('unexpected step jump aborts without second send',async()=>{
  const c=setup();c.select('Major',2)
  const run=c.self._tuneScaleControl.setScale('dorian')
  c.value('Harmonic Minor',4)
  assert.equal(await run,false)
  assert.equal(c.values.tune_status,'unexpected_readback')
  assert.equal(c.calls.length,1)
  c.clean()
})

test('parallel actions do not trigger extra writes, and V5 one-step probe blocked',async()=>{
  const c=setup();c.select('Major',2)
  const run=c.self._tuneScaleControl.setScale('natural_minor')
  assert.equal(await c.self._tuneScaleControl.setScale('dorian'),false)
  assert.equal(c.self.probeFocusedDiscreteSwitch('tune_scale'),false)
  assert.equal(c.calls.length,1)
  c.value('Natural Minor',3)
  assert.equal(await run,true)
  c.clean()
})

test('disconnect/reset aborts pending sequence and forgets confirmed scale',async()=>{
  const c=setup();c.select('Major',2)
  const run=c.self._tuneScaleControl.setScale('dorian')
  c.self._prolink.state='waiting'
  c.observation.reset()
  assert.equal(await run,false)
  assert.equal(c.values.tune_scale,'')
  assert.equal(c.values.tune_controller_available,false)
  assert.equal(c.calls.length,1)
  c.clean()
})

test('explicit result rejection aborts before timeout',async()=>{
  const c=setup();c.select('Major',2)
  const run=c.self._tuneScaleControl.setScale('dorian')
  c.self._tuneScaleControl.onResult('SwitchControllerValue',false)
  assert.equal(await run,false)
  assert.equal(c.values.tune_status,'command_rejected')
  assert.equal(c.calls.length,1)
  c.clean()
})

test('send failures leave no background timer or pending write',async()=>{
  const c=setup();c.select('Major',2)
  c.self._sendProlink=()=>false
  const ok=await c.self._tuneScaleControl.setScale('dorian')
  assert.equal(ok,false)
  assert.equal(c.values.tune_status,'send_failed')
  assert.equal(c.self._tuneScaleControl.pending,null)
  c.clean()
})

test('new presets/feedbacks reflect focused scale observations',async()=>{
  const Module=require('module'),original=Module._load
  try {
    Module._load=function(name,parent,isMain) {
      if(name==='@companion-module/base') return {combineRgb:(r,g,b)=>(r<<16)|(g<<8)|b}
      return original.call(this,name,parent,isMain)
    }
    const c=setup();c.self.label='unit'
    c.self.setFeedbackDefinitions=x=>{c.feedbacks=x}
    c.self.setPresetDefinitions=x=>{c.presets=x}
    require('../feedbacks')(c.self);require('../presets')(c.self)
    c.select('Major',2)
    assert.equal(c.feedbacks.tune_scale_matches.callback({options:{scale:'major'}}),true)
    assert.equal(c.feedbacks.tune_scale_matches.callback({options:{scale:'dorian'}}),false)
    assert.equal(c.presets.tune_scale_dorian.steps[0].down[0].actionId,'tune_set_scale')
    assert.equal(c.presets.tune_scale_status.feedbacks[0].feedbackId,'tune_scale_busy')
    c.clean()
  } finally {Module._load=original}
})
