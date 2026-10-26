const registerActions = require('../actions')
const { encodeOsc, encodeCommand } = require('../lib/prolink-codec')
const { decodeOsc } = require('../lib/prolink-osc')
const { ProLinkObservations } = require('../lib/prolink-observations')

const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'
function oscString(s) { const src=Buffer.from(s); const dst=Buffer.alloc(Math.ceil((src.length+1)/4)*4); src.copy(dst); return dst }
function doubleBuffer(n) { const b=Buffer.alloc(8); b.writeDoubleBE(n); return b }
function valuePacket(label, number) {
  return {type:5, payload:Buffer.concat([oscString('/waves.com/remote/NotifyControllerValue'), oscString(',sd'), oscString(label), doubleBuffer(number)])}
}
function setup() {
  const values = {}
  const self = {
    config: { controlTransport: 'prolink' },
    _prolink: { state: 'connected', onState() {} },
    _prolinkReady: true,
    _log: jest.fn(),
    setVariableValues: jest.fn(v => Object.assign(values,v)),
    checkFeedbacks: jest.fn(), updateActions: jest.fn(),
    _sendProlink: jest.fn(() => true),
    _controlFailure: jest.fn(() => false),
    _prolinkId: (value,min,max) => Number.isInteger(Number(value)) && Number(value)>=min && Number(value)<=max ? Number(value) : null,
    _buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
    setActionDefinitions: jest.fn(),
  }
  self._prolinkObservations=new ProLinkObservations(self)
  registerActions(self)
  const actions=self.setActionDefinitions.mock.calls[0][0]
  return {self,actions,obs:self._prolinkObservations,values}
}
function observeSelection(obs) {
  obs.receive({type:5,payload:Buffer.from(PROPERTIES_HEX,'hex')})
  obs.receive({type:5,payload:Buffer.from(VALUE_HEX,'hex')})
}

test('ChangeControllerValue wire signature is request-id + signed int32 delta', () => {
  expect(decodeOsc(encodeOsc('ChangeControllerValue',7,3))).toEqual({path:'/waves.com/remote/ChangeControllerValue',args:[7,3]})
  expect(decodeOsc(encodeOsc('ChangeControllerValue',8,-8)).args).toEqual([8,-8])
  expect(encodeCommand('ChangeControllerValue',9,-1).readInt32BE(8)).toBe(5)
  expect(decodeOsc(encodeOsc('ShowRackByID',5,0)).args).toEqual([5,0])
  expect(() => encodeOsc('ChangeControllerValue',0,1.5)).toThrow('Expected int32')
})

test('action does not send blindly; validates direction and magnitude', async () => {
  const {self,actions,obs}=setup()
  const action=actions.prolink_controller_relative
  expect(action).toBeDefined()
  await action.callback({options:{direction:1,steps:1}})
  expect(self._sendProlink).not.toHaveBeenCalled()
  expect(self._controlFailure).toHaveBeenCalled()
  observeSelection(obs)
  for(const [direction,steps] of [[0,1],[2,1],[1,0],[1,9],[-1,1.5],[1,'nan']]) {
    expect(self.changeFocusedProlinkController(direction,steps)).toBe(false)
  }
  expect(self._sendProlink).not.toHaveBeenCalled()
  expect(self.changeFocusedProlinkController(-1,3)).toBe(true)
  expect(self._sendProlink).toHaveBeenCalledWith('ChangeControllerValue',-3)
  expect(self.changeFocusedProlinkController(1,8)).toBe(true)
  expect(self._sendProlink).toHaveBeenLastCalledWith('ChangeControllerValue',8)
  obs.reset()
})

test('changed controller value after write is marked observed, not confirmed', () => {
  const {self,obs,values}=setup()
  observeSelection(obs)
  expect(self.changeFocusedProlinkController(1,1)).toBe(true)
  expect(values.prolink_controller_write_status).toBe('awaiting_change')
  expect(values.prolink_controller_write_delta).toBe(1)
  obs.receive(valuePacket('-50',165))
  expect(values.prolink_controller_write_status).toBe('observed_after_send')
  expect(values.prolink_controller_value).toBe(165)
  expect(values.prolink_controller_write_observed_ms).toEqual(expect.any(Number))
  obs.reset()
})

test('identical packets and missing change are not counted as readback confirmation', () => {
  jest.useFakeTimers()
  try {
    const {self,obs,values}=setup()
    observeSelection(obs)
    expect(self.changeFocusedProlinkController(1,1)).toBe(true)
    obs.receive({type:5,payload:Buffer.from(VALUE_HEX,'hex')})
    expect(values.prolink_controller_write_status).toBe('awaiting_change')
    jest.advanceTimersByTime(2500)
    expect(values.prolink_controller_write_status).toBe('unconfirmed')
    obs.reset()
  } finally { jest.useRealTimers() }
})

test('new properties invalidate any pending write; disconnect clears state', () => {
  const {self,obs,values}=setup()
  observeSelection(obs)
  expect(self.changeFocusedProlinkController(-1,1)).toBe(true)
  const properties = decodeOsc(Buffer.from(PROPERTIES_HEX,'hex'))
  properties.args[0] = 'Attack'
  // Execute the corresponding observation path without manufacturing a guessed wire format.
  obs.observeControllerProperties(properties.args)
  expect(values.prolink_controller_write_status).toBe('context_changed')
  expect(values.prolink_controller_known).toBe(false)
  obs.reset()
  expect(values.prolink_controller_write_status).toBe('idle')
  expect(values.prolink_controller_write_delta).toBe('')
  expect(obs.controllerWrite).toBeNull()
})

test('failed sending does not create awaiting readback state', () => {
  const {self,obs,values}=setup()
  observeSelection(obs)
  self._sendProlink.mockReturnValue(false)
  expect(self.changeFocusedProlinkController(1,2)).toBe(false)
  expect(obs.controllerWrite).toBeNull()
  expect(values.prolink_controller_write_status).toBeUndefined()
})


const SCALE_PROPS = ['Scale Type', false, 44, 0, 32, '', 0.001, 0, false, 1,
  'Tune RT', 'User Scale', 'Asavari (Carnatic)']
const ANALOG_PROPS = ['Analog', false, 3, 0, 1, '', 0.001, 0, false, 1,
  'CLA-76', '50Hz', 'Off']
const SPEED_PROPS = ['Speed', true, 0, 0.1, 800, 'ms', 0.001, 0, false, 1,
  'Tune RT', '0.1', '800.0']

test.each([
  [SCALE_PROPS, ['Major', 2], 44],
  [ANALOG_PROPS, ['60Hz', 2], 3],
])('live-observed discrete shape %s cannot emit even a +8 command', (properties, value, optionsCandidate) => {
  const { self, obs, actions, values } = setup()
  obs.observeControllerProperties(properties)
  obs.observeControllerValue(value)
  expect(values.prolink_controller_kind_candidate).toBe('discrete_candidate')
  expect(values.prolink_controller_discrete_count_candidate).toBe(optionsCandidate)
  expect(self.changeFocusedProlinkController(1, 8)).toBe(false)
  expect(values.prolink_controller_write_status).toBe('blocked_discrete')
  expect(self._sendProlink).not.toHaveBeenCalled()
  expect(JSON.parse(values.prolink_controller_capability_json).absoluteDiscreteWriteVerified).toBe(false)
  expect(actions.prolink_controller_inspect).toBeDefined()
  expect(actions.prolink_controller_inspect.callback).toEqual(expect.any(Function))
  obs.reset()
})

test('fresh continuous candidate permits rapid relative steps without falsely confirming each write', () => {
  const { self, obs, values } = setup()
  obs.observeControllerProperties(SPEED_PROPS)
  obs.observeControllerValue(['10.0', 20])
  expect(values.prolink_controller_kind_candidate).toBe('relative_candidate')
  expect(self.changeFocusedProlinkController(1, 4)).toBe(true)
  expect(self.changeFocusedProlinkController(1, 4)).toBe(true)
  expect(values.prolink_controller_write_status).toBe('awaiting_change')
  expect(self._sendProlink).toHaveBeenCalledTimes(2)
  obs.observeControllerValue(['12.0', 22])
  expect(values.prolink_controller_write_status).toBe('observed_after_send')
  expect(self.changeFocusedProlinkController(-1, 1)).toBe(true)
  expect(self._sendProlink).toHaveBeenCalledTimes(3)
  obs.reset()
})

test('connection and recency are prerequisites even when continuous selection remains cached', () => {
  const { self, obs, values } = setup()
  obs.observeControllerProperties(SPEED_PROPS)
  obs.observeControllerValue(['10.0', 20])
  self._prolink.state = 'waiting'
  expect(self.changeFocusedProlinkController(1, 1)).toBe(false)
  expect(values.prolink_controller_write_status).toBe('blocked_disconnected')
  self._prolink.state = 'connected'
  obs.controllerState.properties.lastSeenAtMs -= 10_000
  obs.controllerState.value.lastSeenAtMs -= 10_000
  expect(self.changeFocusedProlinkController(1, 1)).toBe(false)
  expect(values.prolink_controller_write_status).toBe('blocked_stale')
  // An identical readback refreshes freshness WITHOUT claiming a value change.
  obs.observeControllerProperties(SPEED_PROPS)
  obs.observeControllerValue(['10.0', 20])
  expect(self.changeFocusedProlinkController(1, 1)).toBe(true)
  expect(self._sendProlink).toHaveBeenCalledTimes(1)
  obs.reset()
})

test('unknown controller properties and changed focus prevent writing', () => {
  const { self, obs, values } = setup()
  obs.observeControllerProperties(['Mystery', true, 7, 0, 1, '', .001, 0, false, 1, 'Unknown', '0', '1'])
  obs.observeControllerValue(['0', 0])
  expect(self.changeFocusedProlinkController(1, 1)).toBe(false)
  expect(values.prolink_controller_write_status).toBe('blocked_unknown')
  obs.observeControllerProperties(SPEED_PROPS)
  expect(self.changeFocusedProlinkController(1, 1)).toBe(false)
  expect(values.prolink_controller_write_status).toBe('blocked_missing_data')
  expect(self._sendProlink).not.toHaveBeenCalled()
  obs.reset()
})
