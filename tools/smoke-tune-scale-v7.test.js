'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { ProLinkTuneScaleControl, VERIFIED_SCALES, SCALE_COUNT, forwardDistance } = require('../lib/prolink-tune-scale-control')

const PROPERTIES = ['Scale Type',false,44,0,32,'',0.001,0,false,1,'Tune RT','User Scale','Asavari (Carnatic)']
const SPEED = ['Speed',true,0,0.1,800,'ms',0.001,0,false,1,'Tune RT','0.1','800.0']
const valuesByRaw = new Map([
  [0, 'User Scale'], [1, 'Chromatic'], [2, 'Major'], [3, 'Natural Minor'],
  [4, 'Harmonic Minor'], [5, 'Melodic Minor (Asc)'], [6, 'Melodic Minor (Asc+Dec)'],
  [7, 'Major Justonic'], [8, 'Minor Justonic'], [9, 'Dorian'], [43, 'Asavari (Carnatic)'],
])
function sample(raw) { return [valuesByRaw.get(raw) ?? `Simulated intermediary scale #${raw}`, raw] }
function setup({timeoutMs=40} = {}) {
  const sent=[], vars={}, logs=[]
  const self={
    config:{controlTransport:'prolink'}, _prolinkReady:true,
    _prolink:{state:'connected',onState(){}},
    _sendProlink:(name,arg)=>{sent.push([name,arg]);return true},
    setVariableValues:data=>Object.assign(vars,data),checkFeedbacks(){},
    _log:(...x)=>logs.push(x),
  }
  self._prolinkObservations=new ProLinkObservations(self)
  self._tuneScaleControl=new ProLinkTuneScaleControl(self,{timeoutMs})
  const select=raw=>{ self._prolinkObservations.observeControllerProperties(PROPERTIES);receive(raw) }
  const receive=raw=>self._prolinkObservations.observeControllerValue(sample(raw))
  const receiveOther=(name, raw)=>self._prolinkObservations.observeControllerValue([name,raw])
  const stop=()=>{self._tuneScaleControl.reset();self._prolinkObservations.reset()}
  return {sent,vars,logs,self,select,receive,receiveOther,stop}
}

test('live-observed User Scale 0 is recognized and can be selected',async()=>{
  const x=setup(); x.select(0)
  assert.equal(x.self._tuneScaleControl.current()?.item.label,'User Scale')
  assert.equal(VERIFIED_SCALES.some(s=>s.raw===0 && s.label==='User Scale'),true)
  const run=x.self._tuneScaleControl.setScale('chromatic')
  assert.equal(x.sent.length,1)
  x.receive(1)
  assert.equal(await run,true)
  assert.equal(x.vars.tune_scale,'Chromatic');x.stop()
})

test('forward loop from the confirmed last label to User Scale, then Major',async()=>{
  const x=setup();x.select(43)
  const run=x.self._tuneScaleControl.setScale('major')
  assert.deepEqual(x.sent,[['SwitchControllerValue',true]])
  x.receive(0)
  assert.equal(x.sent.length,2)
  assert.equal(x.vars.tune_scale,'User Scale')
  x.receive(1);assert.equal(x.sent.length,3)
  x.receive(2); assert.equal(await run,true)
  assert.equal(x.vars.tune_scale_steps,3)
  assert.equal(x.vars.tune_status,'scale_observed_target')
  x.stop()
})

test('starting at Dorian advances 37 steps, trusting only observed step readbacks',async()=>{
  const x=setup();x.select(9)
  const run=x.self._tuneScaleControl.setScale('major')
  for(let raw=10;raw<=43;raw++) {
    x.receive(raw)
    assert.equal(x.sent.length,raw-9+1)
    if(raw===25) assert.equal(x.vars.tune_scale,'Simulated intermediary scale #25')
  }
  x.receive(0);x.receive(1);x.receive(2)
  assert.equal(await run,true)
  assert.equal(x.sent.length,37)
  assert.equal(x.vars.tune_scale_steps,37)
  x.stop()
})

test('unexpected premature wrap at Dorian or jump aborts without another command',async()=>{
  const x=setup();x.select(9)
  const run=x.self._tuneScaleControl.setScale('major')
  x.receive(0)
  assert.equal(await run,false)
  assert.equal(x.vars.tune_status,'unexpected_readback')
  assert.equal(x.sent.length,1)
  x.stop()
})

test('unverified wrong raw/text and out-of-bounds values never count as valid progress',async()=>{
  const x=setup();x.select(9)
  const run=x.self._tuneScaleControl.setScale('major')
  x.receiveOther('Unknown',44)
  assert.equal(await run,false)
  assert.equal(x.sent.length,1)
  assert.equal(x.vars.tune_status,'invalid_readback')
  x.stop()
})

test('wrap action remains exclusive and aborts on loss of focus',async()=>{
  const x=setup();x.select(43)
  const run=x.self._tuneScaleControl.setScale('major')
  assert.equal(await x.self._tuneScaleControl.setScale('chromatic'),false)
  x.self._prolinkObservations.observeControllerProperties(SPEED)
  assert.equal(await run,false)
  assert.equal(x.sent.length,1)
  assert.equal(x.vars.tune_status,'focus_changed')
  x.stop()
})

test('last-label sentinel alone is not accepted without User Scale (0) readback',async()=>{
  const x=setup();x.select(43)
  const run=x.self._tuneScaleControl.setScale('major')
  x.receiveOther('User Scale',2)
  assert.equal(await run,false)
  assert.equal(x.sent.length,1)
  x.stop()
})

test('never sends more than the reported 44-state safety cap',async()=>{
  const x=setup();x.select(9)
  const run=x.self._tuneScaleControl.setScale('major')
  for(let raw=10;raw<=42;raw++) x.receive(raw)
  x.receive(43)
  x.receive(0)
  x.receive(1)
  x.receive(2)
  assert.equal(await run,true)
  assert.ok(x.sent.length<=44)
  x.stop()
})


test('44 screenshot entries form contiguous 0..43 UI ordering and unique choices',()=>{
  assert.equal(SCALE_COUNT,44)
  assert.equal(VERIFIED_SCALES.length,44)
  assert.deepEqual(VERIFIED_SCALES.map(s=>s.raw), Array.from({length:44},(_,i)=>i))
  assert.equal(new Set(VERIFIED_SCALES.map(s=>s.id)).size,44)
  assert.equal(new Set(VERIFIED_SCALES.map(s=>s.label)).size,44)
  assert.equal(VERIFIED_SCALES[0].label,'User Scale')
  assert.equal(VERIFIED_SCALES[9].label,'Dorian')
  assert.equal(VERIFIED_SCALES[10].label,'Mixolydian')
  assert.equal(VERIFIED_SCALES[24].label,'Pythagorean')
  assert.equal(VERIFIED_SCALES[43].label,'Asavari (Carnatic)')
  assert.equal(forwardDistance(43,2),3)
  assert.equal(forwardDistance(9,2),37)
  assert.equal(forwardDistance(2,2),0)
  assert.equal(forwardDistance(3,2),43)
})

test('unknown UI-list option can be selected with correctly sequenced readback and matching final label',async()=>{
  const x=setup();x.select(9)
  const run=x.self._tuneScaleControl.setScale('mixolydian')
  x.receiveOther('Mixolydian',10)
  assert.equal(await run,true)
  assert.equal(x.vars.tune_scale,'Mixolydian')
  assert.equal(x.vars.tune_scale_raw,10)
  assert.equal(x.sent.length,1)
  x.stop()
})

test('target label mismatch cannot be reported as success even with expected numeric value',async()=>{
  const x=setup();x.select(9)
  const run=x.self._tuneScaleControl.setScale('mixolydian')
  x.receiveOther('unexpected different option',10)
  assert.equal(await run,false)
  assert.equal(x.vars.tune_status,'target_label_mismatch')
  assert.equal(x.sent.length,1)
  x.stop()
})

test('already-at-target also requires matching current text, not only numeric index',async()=>{
  const x=setup();x.select(10) // synthetic observed text for a screenshot-derived index
  assert.equal(await x.self._tuneScaleControl.setScale('mixolydian'),false)
  assert.equal(x.vars.tune_status,'target_label_mismatch')
  assert.equal(x.sent.length,0)
  x.stop()
})

test('known ProLink short labels (5/6) match the 44-entry UI aliases',async()=>{
  const x=setup();x.select(5)
  assert.equal(await x.self._tuneScaleControl.setScale('melodic_minor_asc'),true)
  x.receiveOther('Melodic Minor (Asc+Dec)',6)
  assert.equal(await x.self._tuneScaleControl.setScale('melodic_minor_asc_dec'),true)
  assert.equal(x.sent.length,0)
  x.stop()
})

test('wrap missing 0 readback aborts after one command without blind retry',async()=>{
  const x=setup({timeoutMs:15});x.select(43)
  const result=await x.self._tuneScaleControl.setScale('user_scale')
  assert.equal(result,false)
  assert.equal(x.vars.tune_status,'readback_timeout')
  assert.equal(x.sent.length,1)
  x.stop()
})

test('44 scale presets and feedback choices are fully generated and match required actions',async()=>{
  const Module=require('module'),original=Module._load
  try {
    Module._load=function(name,parent,isMain){
      if(name==='@companion-module/base')return {combineRgb:(r,g,b)=>(r<<16)|(g<<8)|b}
      return original.call(this,name,parent,isMain)
    }
    const x=setup();x.self.label='test'
    x.self.setFeedbackDefinitions=f=>{x.feedbacks=f}
    x.self.setPresetDefinitions=p=>{x.presets=p}
    x.self.setActionDefinitions=a=>{x.actions=a}
    require('../feedbacks')(x.self)
    require('../presets')(x.self)
    require('../actions')(x.self)
    assert.equal(x.actions.tune_set_scale.options[0].choices.length,44)
    assert.equal(x.feedbacks.tune_scale_matches.options[0].choices.length,44)
    for(const {id,label} of VERIFIED_SCALES) {
      assert.equal(x.presets[`tune_scale_${id}`].steps[0].down[0].options.scale,id)
      assert.ok(x.presets[`tune_scale_${id}`].style.text.includes(label))
    }
    x.stop()
  } finally {Module._load=original}
})

test('longest possible cyclic route performs exactly 43 verified sends',async()=>{
  const x=setup();x.select(3)
  const run=x.self._tuneScaleControl.setScale('major')
  for(let raw=4;raw<=43;raw++)x.receive(raw)
  x.receive(0);x.receive(1);x.receive(2)
  assert.equal(await run,true)
  assert.equal(x.vars.tune_scale_steps,43)
  assert.equal(x.sent.length,43)
  assert.equal(x.vars.tune_status,'scale_observed_target')
  x.stop()
})
