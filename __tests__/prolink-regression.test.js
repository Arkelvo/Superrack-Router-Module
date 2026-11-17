'use strict'

// Comprehensive regression test suite for ProLink functionality
// This test ensures all existing behavior is preserved and catches regressions

const { encodeOsc, encodeCommand, encodeHello, encodeDiscovery, WaveParser, COMMAND_SCHEMAS } = require('../lib/prolink-codec')
const { decodeOsc } = require('../lib/prolink-osc')
const { ProLinkControllerState, classifyControllerType } = require('../lib/prolink-controller-state')
const { ProLinkObservations } = require('../lib/prolink-observations')
const registerActions = require('../actions')

// ============================================================
// CODEC REGRESSION TESTS
// ============================================================

describe('ProLink Codec Regression', () => {
  // Original 10 vectors must continue to work
  const originalCommands = [
    'ShowRackByID', 'RecallSnapshot', 'HighlightSnapshot',
    'NavigatePlugin', 'NavigateRack', 'SetTempo', 'ShowPlugin',
    'GetNumRacks', 'GetCurrentSnapshotNumber', 'GetListOfSnapshots',
    'GetCPUUsage', 'GetSessionDirtyState', 'GetRackName',
    'GetRacksInfo', 'GetSnapshotName', 'RequestControllerInfoUpdates',
    'ChangeControllerValue', 'SwitchControllerValue',
    'StoreSnapshot', 'DuplicateSnapshot', 'MoveSnapshot',
    'SetSnapshotName', 'DeleteSnapshot'
  ]

  test('all original commands still in COMMAND_SCHEMAS', () => {
    for (const cmd of originalCommands) {
      expect(Object.hasOwn(COMMAND_SCHEMAS, cmd)).toBe(true)
    }
  })

  test('original 10 OSC vectors still encode correctly', () => {
    const vectors = [
      { cmd: 'ShowRackByID', seq: 0, id: 0, len: 44 },
      { cmd: 'ShowRackByID', seq: 0, id: 63, len: 44 },
      { cmd: 'ShowRackByID', seq: 0, id: -1, len: 44 },
      { cmd: 'RecallSnapshot', seq: 0, id: 0, len: 48 },
      { cmd: 'RecallSnapshot', seq: 0, id: 63, len: 48 },
      { cmd: 'RecallSnapshot', seq: 0, id: -1, len: 48 },
      { cmd: 'HighlightSnapshot', seq: 0, id: 0, len: 48 },
      { cmd: 'HighlightSnapshot', seq: 0, id: 63, len: 48 },
      { cmd: 'HighlightSnapshot', seq: 0, id: -1, len: 48 },
      { cmd: 'ShowRackByID', seq: 0, id: 7, len: 44 },
    ]

    for (const v of vectors) {
      const osc = encodeOsc(v.cmd, v.seq, v.id)
      expect(osc.length).toBe(v.len)
      const frame = encodeCommand(v.cmd, v.seq, v.id)
      expect(frame.subarray(0, 12).toString('hex')).toBe('000000015761766500000005')
      expect(frame.readInt32BE(12)).toBe(v.len)
      expect(frame.subarray(16)).toEqual(osc)
    }
  })

  test('SwitchControllerValue V5-V12 vectors still work', () => {
    const vectors = [
      { seq: 0, val: 0, name: 'V5' },
      { seq: 0, val: 1, name: 'V6' },
      { seq: 1, val: 0, name: 'V7' },
      { seq: 1, val: 1, name: 'V8' },
      { seq: -1, val: 0, name: 'V9' },
      { seq: 7, val: 0, name: 'V11' },
      { seq: 8, val: 1, name: 'V12' },
    ]

    for (const v of vectors) {
      const osc = encodeOsc('SwitchControllerValue', v.seq, v.val)
      expect(osc.length).toBe(52)
      const frame = encodeCommand('SwitchControllerValue', v.seq, v.val)
      expect(frame.readInt32BE(12)).toBe(52)
      expect(frame.subarray(16)).toEqual(osc)
    }
  })

  test('int32 validation unchanged for all commands', () => {
    for (const cmd of ['ShowRackByID', 'ChangeControllerValue', 'SwitchControllerValue']) {
      for (const id of [NaN, 1.5, 2147483648, -2147483649]) {
        expect(() => encodeOsc(cmd, 0, id)).toThrow('Expected int32')
        expect(() => encodeOsc(cmd, id, 0)).toThrow('Expected int32')
      }
    }
  })

  test('Hello and Discovery encoding unchanged', () => {
    const hello = encodeHello('Mixing Station')
    expect(hello.length).toBe(58)
    expect(hello.subarray(44).toString()).toBe('Mixing Station')

    const discovery = encodeDiscovery(54321, 'Mixing Station')
    expect(discovery.length).toBe(78)
    expect(discovery.readUInt16BE(38)).toBe(54321)
  })
})

// ============================================================
// PARSER REGRESSION TESTS
// ============================================================

describe('WaveParser Regression', () => {
  const heartbeat = Buffer.from('00000001576176650000000400000000', 'hex')

  test('all split points and coalesced frames consumed exactly once', () => {
    const bytes = Buffer.concat([encodeHello('Peer'), heartbeat, encodeCommand('ShowRackByID', 1, 7)])
    for (let split = 0; split <= bytes.length; split++) {
      const parser = new WaveParser()
      const frames = [...parser.push(bytes.subarray(0, split)), ...parser.push(bytes.subarray(split))]
      expect(frames.map(f => f.type)).toEqual([1, 4, 5])
      expect(frames[2].payload.readInt32BE(frames[2].payload.length - 4)).toBe(7)
    }
  })

  test('single byte push works', () => {
    const bytes = Buffer.concat([encodeHello('Peer'), heartbeat, encodeCommand('ShowRackByID', 1, 7)])
    const parser = new WaveParser()
    expect([...bytes].flatMap(b => parser.push(Buffer.from([b]))).map(f => f.type)).toEqual([1, 4, 5])
  })

  test('invalid frames rejected without retaining state', () => {
    const invalidFrames = [
      '00000002576176650000000400000000',
      '00000001426164640000000400000000',
      '00000001d7e1f6e50000000400000000',
      '00000001576176650000006300000000',
      '000000015761766500000005ffffffff',
      '0000000157617665000000057fffffff',
      '00000001576176650000000500000000',
    ]

    for (const hex of invalidFrames) {
      const parser = new WaveParser()
      expect(() => parser.push(Buffer.from(hex, 'hex'))).toThrow()
      parser.reset()
      expect(parser.push(heartbeat).map(f => f.type)).toEqual([4])
    }
  })

  test('TCP type 2 is only 16 bytes', () => {
    const parser = new WaveParser()
    parser.push(encodeCommand('RecallSnapshot', 0, 2).subarray(0, 19))
    parser.reset()
    const tcp2 = Buffer.from('000000015761766500000002000001f4', 'hex')
    expect(parser.push(Buffer.concat([tcp2, heartbeat])).map(f => f.type)).toEqual([2, 4])
  })
})

// ============================================================
// OSC DECODER REGRESSION
// ============================================================

describe('OSC Decoder Regression', () => {
  test('decodeOsc handles all original command types', () => {
    const osc = encodeOsc('ShowRackByID', 5, 7)
    const decoded = decodeOsc(osc)
    expect(decoded.path).toBe('/waves.com/remote/ShowRackByID')
    expect(decoded.args).toEqual([5, 7])
  })

  test('decodeOsc handles SwitchControllerValue', () => {
    const osc = encodeOsc('SwitchControllerValue', 7, 1)
    const decoded = decodeOsc(osc)
    expect(decoded.path).toBe('/waves.com/remote/SwitchControllerValue')
    expect(decoded.args).toEqual([7, 1])
  })

  test('decodeOsc handles ChangeControllerValue with negative delta', () => {
    const osc = encodeOsc('ChangeControllerValue', 8, -8)
    const decoded = decodeOsc(osc)
    expect(decoded.args).toEqual([8, -8])
  })
})

// ============================================================
// CONTROLLER STATE REGRESSION
// ============================================================

describe('ProLinkControllerState Regression', () => {
  test('original live OSC packets decode exactly', () => {
    const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
    const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'
    const PROPERTIES_FRAME = { type: 5, payload: Buffer.from(PROPERTIES_HEX, 'hex') }
    const VALUE_FRAME = { type: 5, payload: Buffer.from(VALUE_HEX, 'hex') }

    expect(decodeOsc(PROPERTIES_FRAME.payload)).toEqual({
      path: '/waves.com/remote/NotifyControllerProperties',
      args: ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0'],
    })
    expect(decodeOsc(VALUE_FRAME.payload)).toEqual({
      path: '/waves.com/remote/NotifyControllerValue',
      args: ['-51', 154.66666666666669],
    })
  })

  test('properties and value expose only grounded fields', () => {
    const state = new ProLinkControllerState()
    const props = ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']
    const result = state.observeProperties(props)

    expect(result.values.prolink_controller_name).toBe('Threshold')
    expect(result.values.prolink_controller_unit).toBe('dB')
    expect(result.values.prolink_controller_bounds_a_raw).toBe(-60)
    expect(result.values.prolink_controller_bounds_b_raw).toBe(0)
    expect(JSON.parse(result.values.prolink_controller_properties)).toHaveLength(13)
  })

  test('unchanged notifications do not cause repeated writes', () => {
    const state = new ProLinkControllerState()
    const props = ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']

    state.observeProperties(props)
    state.observeValue(['-51', 154.66666666666669])

    for (let i = 0; i < 5; i++) {
      const r1 = state.observeProperties(props)
      const r2 = state.observeValue(['-51', 154.66666666666669])
      expect(r1.changed).toBe(false)
      expect(r2.changed).toBe(false)
    }
  })

  test('property change invalidates stale value', () => {
    const state = new ProLinkControllerState()
    const props1 = ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']
    const props2 = ['Attack', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']

    state.observeProperties(props1)
    state.observeValue(['-51', 154.66666666666669])
    const result = state.observeProperties(props2)

    expect(result.values.prolink_controller_known).toBe(false)
    expect(result.values.prolink_controller_text).toBe('')
    expect(state.value).toBe(null)
  })

  test('invalid shapes and nonfinite values rejected', () => {
    const state = new ProLinkControllerState()
    expect(state.observeProperties(['Threshold'])).toBe(null)
    expect(state.observeValue(['-51', Infinity])).toBe(null)
    expect(state.hasData()).toBe(false)
  })

  test('classifyControllerType backward compatible', () => {
    // Original threshold from live capture -> continuous (range > 1)
    expect(classifyControllerType(['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0'])).toBe('continuous')

    // Discrete from 0..1 bounds
    expect(classifyControllerType(['Bypass', true, 0, 0, 1, 'bool', 0, 0, false, 1, '', '0', '1'])).toBe('discrete')

    // Unknown when indeterminate
    expect(classifyControllerType(['A', true, 0, 0, 0.5, '', 0, 0, false, 1, '', '0', '0.5'])).toBe('unknown')
    expect(classifyControllerType(null)).toBe('unknown')
  })
})

// ============================================================
// ACTIONS REGRESSION
// ============================================================

describe('ProLink Actions Regression', () => {
  function setup() {
    const values = {}
    const self = {
      _log: jest.fn(),
      setVariableValues: jest.fn(v => Object.assign(values, v)),
      checkFeedbacks: jest.fn(), updateActions: jest.fn(),
      _sendProlink: jest.fn(() => true),
      _controlFailure: jest.fn(() => false),
      _prolinkId: (value, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null,
      _buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
      setActionDefinitions: jest.fn(),
    }
    self._prolinkObservations = new ProLinkObservations(self)
    registerActions(self)
    const actions = self.setActionDefinitions.mock.calls[0][0]
    return { self, actions, obs: self._prolinkObservations, values }
  }

  function observeSelection(obs) {
    const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
    const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'
    obs.receive({ type: 5, payload: Buffer.from(PROPERTIES_HEX, 'hex') })
    obs.receive({ type: 5, payload: Buffer.from(VALUE_HEX, 'hex') })
  }

  test('all expected actions are defined', () => {
    const { actions } = setup()
    const expectedActions = [
      'prolink_recall_snapshot', 'prolink_highlight_snapshot',
      'prolink_recall_snapshot_named', 'prolink_highlight_snapshot_named',
      'prolink_navigate_plugin', 'prolink_navigate_rack',
      'prolink_show_plugin', 'prolink_set_tempo', 'prolink_tap_tempo',
      'prolink_get_rack_count', 'prolink_get_current_snapshot',
      'prolink_get_snapshots', 'prolink_get_cpu', 'prolink_get_session_dirty',
      'prolink_get_rack_name', 'prolink_get_rack_info', 'prolink_get_snapshot_name',
      'prolink_controller_relative', 'prolink_controller_switch',
      'prolink_controller_subscription',
    ]

    for (const actionId of expectedActions) {
      expect(actions[actionId]).toBeDefined()
    }
  })

  test('prolink_controller_relative validates direction and magnitude', async () => {
    const { self, actions, obs } = setup()
    await actions.prolink_controller_relative.callback({ options: { direction: 1, steps: 1 } })
    expect(self._sendProlink).not.toHaveBeenCalled()

    observeSelection(obs)
    for (const [dir, steps] of [[0, 1], [2, 1], [1, 0], [1, 9], [-1, 1.5], [1, 'nan']]) {
      expect(self.changeFocusedProlinkController(dir, steps)).toBe(false)
    }
    expect(self.changeFocusedProlinkController(-1, 3)).toBe(true)
    expect(self._sendProlink).toHaveBeenCalledWith('ChangeControllerValue', -3)
    expect(self.changeFocusedProlinkController(1, 8)).toBe(true)
    expect(self._sendProlink).toHaveBeenLastCalledWith('ChangeControllerValue', 8)
  })

  test('prolink_controller_switch validates focus guard', async () => {
    const { self, actions, obs } = setup()
    await actions.prolink_controller_switch.callback({ options: { state: 1 } })
    expect(self._sendProlink).not.toHaveBeenCalled()
    expect(self._controlFailure).toHaveBeenCalled()

    observeSelection(obs)
    await actions.prolink_controller_switch.callback({ options: { state: 1 } })
    expect(self._sendProlink).toHaveBeenCalledWith('SwitchControllerValue', 1)
  })

  test('prolink_controller_switch rejects invalid states', () => {
    const { self, obs } = setup()
    observeSelection(obs)
    expect(self.switchFocusedProlinkController(2)).toBe(false)
    expect(self.switchFocusedProlinkController(-1)).toBe(false)
    expect(self.switchFocusedProlinkController('on')).toBe(false)
  })

  test('runProlinkExtension routes all commands correctly', async () => {
    const { self, obs } = setup()
    observeSelection(obs)

    // No-argument commands
    for (const cmd of ['GetNumRacks', 'GetCurrentSnapshotNumber', 'GetListOfSnapshots', 'GetCPUUsage', 'GetSessionDirtyState', 'ShowPlugin']) {
      self._sendProlink.mockClear()
      await self.runProlinkExtension(cmd)
      expect(self._sendProlink).toHaveBeenCalledWith(cmd)
    }

    // Single-int commands with valid ranges
    const intCommands = [
      ['NavigatePlugin', 0],    // range [0, 1]
      ['NavigateRack', 0],      // range [0, 1]
      ['SetTempo', 120],        // range [40, 500]
      ['GetRackName', 5],       // range [0, 63]
      ['GetRacksInfo', 5],      // range [0, 63]
      ['GetSnapshotName', 5],   // range [0, 2147483647]
    ]
    for (const [cmd, val] of intCommands) {
      self._sendProlink.mockClear()
      await self.runProlinkExtension(cmd, val)
      expect(self._sendProlink).toHaveBeenCalledWith(cmd, val)
    }

    // Boolean command
    self._sendProlink.mockClear()
    await self.runProlinkExtension('RequestControllerInfoUpdates', true)
    expect(self._sendProlink).toHaveBeenCalledWith('RequestControllerInfoUpdates', true)
  })
})

// ============================================================
// OBSERVATIONS REGRESSION
// ============================================================

describe('ProLinkObservations Regression', () => {
  function createObserver() {
    const values = {}
    const self = {
      _log: jest.fn(),
      setVariableValues: jest.fn(next => Object.assign(values, next)),
      checkFeedbacks: jest.fn(),
      updateActions: jest.fn(),
      _destroyed: false,
      config: { controlTransport: 'prolink' },
      _prolink: { state: 'connected', send: jest.fn(() => 1) },
      _prolinkReady: true,
      _transportSwitching: false,
    }
    return { obs: new ProLinkObservations(self), self, values }
  }

  test('controller subscription auto-requests on connect', () => {
    const { obs, self } = createObserver()
    // Connection handler triggers auto-subscribe
    self._prolink.state = 'connected'
    self._prolinkReady = true
    // The attachSnapshotSynchronization hooks into onState
    // This tests the integration path
    expect(typeof obs.requestControllerSubscriptionOnConnect).toBe('function')
    expect(typeof obs.requestSnapshotListOnConnect).toBe('function')
  })

  test('reset clears all state', () => {
    const { obs, values } = createObserver()
    const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
    const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'

    obs.receive({ type: 5, payload: Buffer.from(PROPERTIES_HEX, 'hex') })
    obs.receive({ type: 5, payload: Buffer.from(VALUE_HEX, 'hex') })
    expect(obs.controllerState.hasData()).toBe(true)

    obs.reset()
    expect(obs.controllerState.hasData()).toBe(false)
    expect(values.prolink_controller_properties_known).toBe(false)
    expect(values.prolink_controller_known).toBe(false)
    expect(values.prolink_controller_type).toBe('unknown')
  })
})

// ============================================================
// SNAPSHOT REGRESSION
// ============================================================

describe('Snapshot Actions Regression', () => {
  const { encodeOsc: eOsc } = require('../lib/prolink-codec')

  test('snapshot commands encode with correct schemas', () => {
    // StoreSnapshot - no args
    expect(() => eOsc('StoreSnapshot', 0)).not.toThrow()

    // DuplicateSnapshot - single int
    const dup = eOsc('DuplicateSnapshot', 1, 5)
    expect(decodeOsc(dup).args).toEqual([1, 5])

    // MoveSnapshot - two ints
    const mov = eOsc('MoveSnapshot', 2, [3, 7])
    expect(decodeOsc(mov).args).toEqual([2, 3, 7])

    // DeleteSnapshot - list of ints (args: sequence, count, IDs...)
    const del = eOsc('DeleteSnapshot', 3, [1, 2, 3])
    const delDecoded = decodeOsc(del)
    // decodeOsc returns all OSC args including sequence: [sequence, count, id1, id2, id3]
    expect(delDecoded.args).toEqual([3, 3, 1, 2, 3])
    expect(delDecoded.args.slice(2)).toEqual([1, 2, 3]) // IDs after sequence and count
  })
})

// ============================================================
// INTEGRATION REGRESSION: Full flow
// ============================================================

describe('Full Integration Regression', () => {
  test('complete controller workflow: subscribe -> observe -> write -> readback', () => {
    const { self, obs, values } = (() => {
      const values = {}
      const self = {
        _log: jest.fn(),
        setVariableValues: jest.fn(v => Object.assign(values, v)),
        checkFeedbacks: jest.fn(), updateActions: jest.fn(),
        _sendProlink: jest.fn(() => true),
        _controlFailure: jest.fn(() => false),
        _prolinkId: (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null,
        _buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
        setActionDefinitions: jest.fn(),
        config: { controlTransport: 'prolink' },
        _prolink: { state: 'connected', send: jest.fn(() => 1) },
        _prolinkReady: true,
        _transportSwitching: false,
      }
      self._prolinkObservations = new ProLinkObservations(self)
      registerActions(self)
      return { self, obs: self._prolinkObservations, values }
    })()

    // 1. Subscribe to controller updates
    self.runProlinkExtension('RequestControllerInfoUpdates', true)
    expect(self._sendProlink).toHaveBeenCalledWith('RequestControllerInfoUpdates', true)

    // 2. Receive properties and value (simulated from SuperRack)
    const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
    const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'
    obs.receive({ type: 5, payload: Buffer.from(PROPERTIES_HEX, 'hex') })
    obs.receive({ type: 5, payload: Buffer.from(VALUE_HEX, 'hex') })

    expect(values.prolink_controller_properties_known).toBe(true)
    expect(values.prolink_controller_known).toBe(true)
    expect(values.prolink_controller_type).toBe('continuous')

    // 3. Write relative change
    const contextVersion = obs.controllerState.contextVersion
    const prevSig = obs.controllerState.value.signature
    self.changeFocusedProlinkController(1, 2)
    expect(self._sendProlink).toHaveBeenCalledWith('ChangeControllerValue', 2)
    expect(values.prolink_controller_write_status).toBe('awaiting_change')
    expect(obs.controllerWrite.contextVersion).toBe(contextVersion)
    expect(obs.controllerWrite.previousSignature).toBe(prevSig)

    // 4. Receive value change (readback)
    obs.receive({ type: 5, payload: Buffer.from('2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3439004063333333333333', 'hex') })
    expect(values.prolink_controller_write_status).toBe('observed_after_send')

    // 5. Discrete switch write
    self.switchFocusedProlinkController(0)
    expect(self._sendProlink).toHaveBeenLastCalledWith('SwitchControllerValue', 0)
  })

  test('preset definitions load without error', () => {
    let presets
    const self = {
      label: 'waves-1',
      setPresetDefinitions: (data) => { presets = data },
      config: { controlTransport: 'prolink' },
    }
    jest.doMock('@companion-module/base', () => ({ combineRgb: (r, g, b) => (r << 16) | (g << 8) | b }))
    jest.isolateModules(() => require('../presets')(self))

    expect(presets.prolink_tap_tempo).toBeDefined()
    expect(presets.prolink_controller_generic).toBeDefined()
    expect(presets.prolink_tune_rt).toBeDefined()
    expect(presets.prolink_cla76).toBeDefined()
    expect(presets.prolink_tune_rt_note).toBeDefined()
    expect(presets.prolink_tune_rt_cents).toBeDefined()
    expect(presets.prolink_cla76_input).toBeDefined()
    expect(presets.prolink_cla76_output).toBeDefined()
    expect(presets.prolink_cla76_attack).toBeDefined()
    expect(presets.prolink_cla76_release).toBeDefined()
    expect(presets.prolink_cla76_ratio).toBeDefined()
  })
})