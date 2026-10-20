'use strict'

const { ProLinkObservations } = require('../lib/prolink-observations')

function setup({ transport = 'prolink' } = {}) {
  const values = {}
  let sequence = 0
  const sends = []
  const service = {
    state: 'waiting',
    onState: jest.fn(),
    send: jest.fn((command, argument) => {
      sends.push({ command, argument })
      return sequence++
    }),
  }
  const self = {
    config: { controlTransport: transport },
    _prolink: service,
    _destroyed: false,
    _prolinkReady: false, // TCP can become connected before main marks it ready
    _log: jest.fn(),
    setVariableValues: jest.fn(next => Object.assign(values, next)),
    checkFeedbacks: jest.fn(),
    updateActions: jest.fn(),
  }
  const obs = new ProLinkObservations(self)
  function emit(state) {
    service.state = state
    if (state !== 'connected') obs.reset() // same ordering as main._prolinkStateChanged
    service.onState(state)
  }
  return { self, service, obs, sends, values, emit }
}

test('auto subscribes true alongside snapshot list exactly once on connect and every reconnect', () => {
  const { service, obs, sends, values, emit } = setup()
  emit('connected')
  expect(sends).toEqual([
    { command: 'GetListOfSnapshots', argument: undefined },
    { command: 'RequestControllerInfoUpdates', argument: true },
    { command: 'GetCPUUsage', argument: undefined },
    { command: 'GetSessionDirtyState', argument: undefined },
  ])
  expect(values.prolink_controller_auto_subscription_status).toBe('requesting')
  expect(values.prolink_controller_auto_subscription_sequence).toBe(1)
  expect(obs.pending.size).toBe(4)
  emit('connected')
  expect(service.send).toHaveBeenCalledTimes(4)
  emit('waiting')
  expect(values.prolink_controller_auto_subscription_status).toBe('idle')
  expect(values.prolink_controller_auto_subscription_sequence).toBe('')
  emit('connected')
  expect(service.send).toHaveBeenCalledTimes(8)
  expect(sends[5]).toEqual({ command: 'RequestControllerInfoUpdates', argument: true })
  expect(values.prolink_controller_auto_subscription_sequence).toBe(5)
  obs.reset()
})

test('no automatic subscription in MIDI transport or destroyed instance', () => {
  const midi = setup({ transport: 'midi' })
  midi.emit('connected')
  expect(midi.service.send).not.toHaveBeenCalled()
  midi.obs.reset()
  const inactive = setup()
  inactive.self._destroyed = true
  inactive.emit('connected')
  expect(inactive.service.send).not.toHaveBeenCalled()
  inactive.obs.reset()
})

test('matching result distinguishes acknowledged from controller notifications', () => {
  const { obs, values, emit } = setup()
  emit('connected')
  obs.observeResult([1, 0, '/waves.com/remote/RequestControllerInfoUpdates succeeded'])
  expect(values.prolink_controller_auto_subscription_status).toBe('acknowledged')
  obs.observeControllerProperties(['Gate Thresh', true, 0, -144, 0, 'dB', 0.001, 0, false, 1, 'EMO-D5', '-Inf', '0.0'])
  expect(values.prolink_controller_auto_subscription_status).toBe('receiving_updates')
  obs.observeControllerValue(['-52.9', 632.8508999999998])
  expect(values.prolink_controller_name).toBe('Gate Thresh')
  expect(values.prolink_controller_text).toBe('-52.9')
  obs.observeControllerProperties(['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0'])
  expect(values.prolink_controller_name).toBe('Threshold')
  expect(values.prolink_controller_known).toBe(false) // no stale value from EMO-D5
  expect(values.prolink_controller_auto_subscription_status).toBe('receiving_updates')
  obs.reset()
})

test('late or unrelated result cannot acknowledge auto subscription', () => {
  const { obs, values, emit } = setup()
  emit('connected')
  obs.observeResult([5, 0, '/waves.com/remote/RequestControllerInfoUpdates succeeded'])
  expect(values.prolink_controller_auto_subscription_status).toBe('requesting')
  obs.observeResult([1, 2, 'remote rejected'])
  expect(values.prolink_controller_auto_subscription_status).toBe('rejected_or_unknown')
  obs.reset()
})

test('send failure is surfaced without blocking snapshot synchronization or crashing service', () => {
  const { obs, values, service, emit } = setup()
  let next = 0
  service.send.mockImplementation((command) => {
    if (command === 'RequestControllerInfoUpdates') throw new Error('send failure')
    return next++
  })
  emit('connected')
  expect(values.prolink_snapshot_sync_status).toBe('requesting')
  expect(values.prolink_controller_auto_subscription_status).toBe('send_failed')
  expect(obs.pending.size).toBe(3)
  obs.reset()
})

test('timeout is unconfirmed, not falsely marked rejected, and reset clears it', () => {
  jest.useFakeTimers()
  try {
    const { values, emit } = setup()
    emit('connected')
    jest.advanceTimersByTime(2501)
    expect(values.prolink_controller_auto_subscription_status).toBe('unconfirmed')
    emit('waiting')
    expect(values.prolink_controller_auto_subscription_status).toBe('idle')
  } finally { jest.useRealTimers() }
})
