jest.mock('@companion-module/base', () => ({
	...jest.requireActual('@companion-module/base'),
	InstanceBase: class {},
	runEntrypoint: jest.fn(),
}))
jest.mock('../ui/http', () => ({ startHttpServer: jest.fn(), stopHttpServer: jest.fn() }))
jest.mock('../lib/midi-service', () => ({
	...jest.requireActual('../lib/midi-service'),
	startMidiService: jest.fn(),
	stopMidiService: jest.fn(),
}))
const { startMidiService, stopMidiService } = require('../lib/midi-service')
const ModuleInstance = require('../main')
function setup() {
	const self = new ModuleInstance({})
	for (const name of [
		'_log',
		'updateActions',
		'updateFeedbacks',
		'updateVariableDefinitions',
		'updateStatus',
		'saveConfig',
		'setVariableValues',
	])
		self[name] = jest.fn()
	const active = new Set()
	startMidiService.mockImplementation(async () => {
		expect(active.has('prolink')).toBe(false)
		active.add('midi')
	})
	stopMidiService.mockImplementation(async () => {
		active.delete('midi')
	})
	jest.spyOn(self._prolink, 'start').mockImplementation(async () => {
		expect(active.has('midi')).toBe(false)
		active.add('prolink')
		self._prolink.state = 'waiting'
	})
	jest.spyOn(self._prolink, 'stop').mockImplementation(async () => {
		active.delete('prolink')
		self._prolink.state = 'stopped'
	})
	return { self, active }
}
beforeEach(() => jest.clearAllMocks())
test('ProLink never starts MIDI even with persisted midiEnabled=true', async () => {
	const { self, active } = setup()
	await self.init({ controlTransport: 'prolink', midiEnabled: true })
	expect(startMidiService).not.toHaveBeenCalled()
	expect([...active]).toEqual(['prolink'])
	await self.configUpdated({ controlTransport: 'prolink', midiEnabled: true, midiPortName: 'Changed' })
	expect(startMidiService).not.toHaveBeenCalled()
	await self.destroy()
	expect(active.size).toBe(0)
})
test('both switch directions stop old transport before starting new transport', async () => {
	const { self, active } = setup()
	await self.init({ midiEnabled: true })
	expect([...active]).toEqual(['midi'])
	await self.configUpdated({ controlTransport: 'prolink', midiEnabled: true })
	expect([...active]).toEqual(['prolink'])
	await self.configUpdated({ controlTransport: 'midi', midiEnabled: true })
	expect([...active]).toEqual(['midi'])
	await self.destroy()
})
test.each([false, true])('pending MIDI startup serialized with switch; destroy=%s', async (destroy) => {
	const { self, active } = setup()
	let release, entered
	const started = new Promise((resolve) => {
		entered = resolve
	})
	startMidiService.mockImplementationOnce(() => {
		entered()
		return new Promise((resolve) => {
			release = () => {
				active.add('midi')
				resolve()
			}
		})
	})
	const init = self.init({ midiEnabled: true })
	await started
	const update = self.configUpdated({ controlTransport: 'prolink', midiEnabled: true })
	expect(self._prolink.start).not.toHaveBeenCalled()
	const destroying = destroy ? self.destroy() : Promise.resolve()
	release()
	await Promise.all([init, update, destroying])
	expect([...active]).toEqual(destroy ? [] : ['prolink'])
	if (destroy) expect(self._prolink.start).not.toHaveBeenCalled()
	await self.destroy()
})
test('stop failure blocks starting the other transport', async () => {
	const { self } = setup()
	await self.init({ midiEnabled: true })
	stopMidiService.mockRejectedValueOnce(new Error('helper did not exit'))
	await self.configUpdated({ controlTransport: 'prolink' })
	expect(self._prolink.start).not.toHaveBeenCalled()
	expect(self._prolinkReady).toBe(false)
	await self.destroy()
})
