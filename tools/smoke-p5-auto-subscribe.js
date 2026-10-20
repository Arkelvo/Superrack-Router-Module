'use strict'
// Standalone Node-22 regression smoke test: no Jest or live SuperRack required.
const assert = require('node:assert/strict')
const { ProLinkObservations } = require('../lib/prolink-observations')

function make(transport = 'prolink') {
  const values = {}
  const calls = []
  let nextSequence = 0
  const service = {
    state: 'waiting', onState() {},
    send(command, arg) { calls.push([command, arg]); return nextSequence++ },
  }
  const instance = {
    config: { controlTransport: transport }, _prolink: service,
    _destroyed: false, _prolinkReady: false,
    setVariableValues(v) { Object.assign(values, v) },
    _log() {}, checkFeedbacks() {}, updateActions() {},
  }
  const obs = new ProLinkObservations(instance)
  function emit(state) {
    service.state = state
    if (state !== 'connected') obs.reset() // mirrors main.js state change
    service.onState(state)
  }
  return { obs, values, calls, service, instance, emit }
}

function run() {
  const ctx = make()
  const { calls, obs, values, emit } = ctx
  emit('connected')
  assert.deepEqual(calls, [
    ['GetListOfSnapshots', undefined], ['RequestControllerInfoUpdates', true],
    ['GetCPUUsage', undefined], ['GetSessionDirtyState', undefined],
  ])
  assert.equal(values.prolink_controller_auto_subscription_sequence, 1)
  assert.equal(values.prolink_controller_auto_subscription_status, 'requesting')
  assert.equal(obs.pending.size, 4)
  emit('connected')
  assert.equal(calls.length, 4, 'no duplicate subscription for same peer')
  obs.observeResult([1, 0, '/waves.com/remote/RequestControllerInfoUpdates succeeded'])
  assert.equal(values.prolink_controller_auto_subscription_status, 'acknowledged')
  emit('waiting')
  assert.equal(values.prolink_controller_auto_subscription_status, 'idle')
  emit('connected')
  assert.deepEqual(calls[5], ['RequestControllerInfoUpdates', true])
  assert.equal(values.prolink_controller_auto_subscription_sequence, 5)
  obs.observeResult([5, 5, 'rejected'])
  assert.equal(values.prolink_controller_auto_subscription_status, 'rejected_or_unknown')
  emit('waiting')

  const midi = make('midi')
  midi.emit('connected')
  assert.equal(midi.calls.length, 0)
  midi.obs.reset()

  const fail = make()
  const original = fail.service.send.bind(fail.service)
  fail.service.send = (cmd, arg) => cmd === 'RequestControllerInfoUpdates'
    ? (() => { throw new Error('write failed') })() : original(cmd, arg)
  fail.emit('connected')
  assert.equal(fail.values.prolink_controller_auto_subscription_status, 'send_failed')
  assert.equal(fail.values.prolink_snapshot_sync_status, 'requesting')
  fail.obs.reset()

  const wrong = make()
  wrong.emit('connected')
  wrong.obs.observeResult([99, 0, '/waves.com/remote/RequestControllerInfoUpdates succeeded'])
  assert.equal(wrong.values.prolink_controller_auto_subscription_status, 'requesting')
  wrong.obs.reset()

  console.log('PASS P5: Connect, no duplicate, correlated ACK, disconnect/reconnect, reject, MIDI guard, send failure, wrong ACK sequence')
}
run()
