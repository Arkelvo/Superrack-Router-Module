jest.mock('@companion-module/base', () => ({
  ...jest.requireActual('@companion-module/base'),
  InstanceBase: class {},
  runEntrypoint: jest.fn(),
}))

const ModuleInstance = require('../main')
const { decodeOsc } = require('../lib/prolink-osc')

const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'

function oscString(text) {
  const bytes = Buffer.from(text, 'utf8')
  const result = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4)
  bytes.copy(result)
  return result
}
function oscInt(value) {
  const result = Buffer.alloc(4)
  result.writeInt32BE(value)
  return result
}
function frameFromHex(hex) {
  return { type: 5, payload: Buffer.from(hex, 'hex') }
}
function packet(name, tags, data) {
  return { type: 5, payload: Buffer.concat([
    oscString('/waves.com/remote/' + name), oscString(tags), ...data,
  ]) }
}
function createInstance() {
  const self = new ModuleInstance({})
  self._log = jest.fn()
  self.setVariableValues = jest.fn()
  self.checkFeedbacks = jest.fn()
  self.updateActions = jest.fn()
  self.logLevel = 'debug'
  self.config = { controlTransport: 'prolink' }
  return self
}
function deliver(self, message) {
  // Matches the actual service delivery order: observe first, debug second.
  self._prolink.onFrame(message)
  self._prolink.onDebugFrame(message)
}

test('repeated focused controller notifications do not flood PROLINK_RX, but meaningful changes are logged', () => {
  const self = createInstance()
  const props = frameFromHex(PROPERTIES_HEX)
  const value = frameFromHex(VALUE_HEX)
  for (let i = 0; i < 15; i++) {
    deliver(self, props)
    deliver(self, value)
  }
  const messages = self._log.mock.calls.map(([, label]) => label)
  expect(messages.filter(label => label === '[PROLINK_RX]')).toHaveLength(0)
  expect(messages.filter(label => label === '[PROLINK_CONTROLLER_PROPERTIES_CHANGED]')).toHaveLength(1)
  expect(messages.filter(label => label === '[PROLINK_CONTROLLER_VALUE_CHANGED]')).toHaveLength(1)
  expect(self._prolinkObservations.controllerState.value.values).toEqual(['-51', 154.66666666666669])
  self._prolinkObservations.reset()
})

test('other incoming OSC packets retain the original decoded debug path', () => {
  const self = createInstance()
  const status = packet('NotifySyncStatus', ',i', [oscInt(0)])
  deliver(self, status)
  expect(self._log).toHaveBeenCalledWith('debug', '[PROLINK_RX]', {
    path: '/waves.com/remote/NotifySyncStatus', args: [0],
  })
  const result = packet('ResultCommand', ',iis', [
    oscInt(7), oscInt(0), oscString('/waves.com/remote/ShowRackByID succeeded'),
  ])
  deliver(self, result)
  expect(self._log).toHaveBeenCalledWith('debug', '[PROLINK_COMMAND_RESULT]', {
    sequence: 7, resultCode: 0,
    resultText: '/waves.com/remote/ShowRackByID succeeded',
  })
  self._prolinkObservations.reset()
})

test('malformed packets still reach raw/error diagnostics', () => {
  const self = createInstance()
  const bad = frameFromHex('01020304')
  deliver(self, bad)
  expect(self._log).toHaveBeenCalledWith('warn', '[PROLINK_OSC_INVALID]', expect.any(Object))
  expect(self._log).toHaveBeenCalledWith('debug', '[PROLINK_RX_RAW]', expect.any(Object))
  self._prolinkObservations.reset()
})
