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
