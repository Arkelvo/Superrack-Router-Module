const { ProLinkTapTempo } = require('../lib/prolink-tap-tempo')

jest.mock('@companion-module/base', () => ({
	...jest.requireActual('@companion-module/base'),
	InstanceBase: class {},
	runEntrypoint: jest.fn(),
}))

const ModuleInstance = require('../main')

function makeInstance() {
	const self = new ModuleInstance({})
	const values = {}
	let ns = 0n
	self.config = { controlTransport: 'prolink' }
	self._prolinkReady = true
	self._prolink.state = 'connected'
	self._log = jest.fn()
	self.setVariableValues = jest.fn((updates) => Object.assign(values, updates))
	self._updateVariables = jest.fn()
	self._sendProlink = jest.fn((command, bpm) => {
		if (command === 'SetTempo') {
			self._tapLastSentBpm = bpm
		}
		return true
	})
	self._tapTempo = new ProLinkTapTempo(() => ns)
	return {
		self,
		values,
		tapAfter(ms) {
			ns += BigInt(Math.round(ms * 1_000_000))
			return self.tapProlinkTempo()
		},
	}
}

test('action sends SetTempo every valid tap, even when BPM is unchanged', () => {
	const { self, values, tapAfter } = makeInstance()
	expect(tapAfter(0)).toBe(true)
	expect(self._sendProlink).not.toHaveBeenCalled()
	tapAfter(500)
	tapAfter(500)
	tapAfter(500)
	expect(self._sendProlink.mock.calls).toEqual([
		['SetTempo', 120], ['SetTempo', 120], ['SetTempo', 120],
	])
	expect(values.prolink_tap_status).toBe('local_sent')
	expect(values.prolink_tap_last_sent_bpm).toBe(120)
	expect(values.prolink_tap_count).toBe(4)
})

test('out-of-range value is never sent; measurement continues', () => {
	const { self, tapAfter } = makeInstance()
	tapAfter(0)
	tapAfter(100) // 600 BPM: do not send
	tapAfter(100) // 600 BPM: do not send
	tapAfter(200) // all three intervals average 133.333 ms -> 450 BPM
	expect(self._sendProlink.mock.calls).toEqual([['SetTempo', 450]])
})

test('tap while disconnected is ignored and erases previous sequence', () => {
	const { self, values, tapAfter } = makeInstance()
	tapAfter(0)
	self._prolink.state = 'waiting'
	expect(tapAfter(500)).toBe(false)
	expect(values.prolink_tap_status).toBe('disconnected')
	expect(values.prolink_tap_count).toBe(0)
	self._prolink.state = 'connected'
	expect(tapAfter(500)).toBe(true) // first tap since reconnect
	expect(self._sendProlink).not.toHaveBeenCalled()
	expect(tapAfter(500)).toBe(true)
	expect(self._sendProlink).toHaveBeenCalledWith('SetTempo', 120)
})

test('connection-state callback invalidates active tap sequence', () => {
	const { self, values, tapAfter } = makeInstance()
	self.updateStatus = jest.fn()
	self.checkFeedbacks = jest.fn()
	self._prolinkObservations.reset = jest.fn()
	tapAfter(0)
	self._prolinkStateChanged('waiting')
	expect(values.prolink_tap_count).toBe(0)
	expect(values.prolink_tap_status).toBe('disconnected')
})

test('failed local send does not claim a transmitted BPM', () => {
	const { self, values, tapAfter } = makeInstance()
	self._sendProlink.mockReturnValue(false)
	tapAfter(0)
	expect(tapAfter(500)).toBe(false)
	expect(values.prolink_tap_status).toBe('send_failed')
	expect(values.prolink_tap_last_sent_bpm).toBe('')
})

test('action UI exposes Tap Tempo and validates Set BPM against 40..500', async () => {
	const { self, tapAfter } = makeInstance()
	let actions
	self._buildRackChoices = () => []
	self._buildHotSnapshotChoices = () => []
	self._buildHotPluginChoices = () => []
	self.setActionDefinitions = (map) => { actions = map }
	self._prolinkId = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : null
	self._controlFailure = jest.fn(() => false)
	require('../actions')(self)
	expect(actions.prolink_set_tempo.name).toBe('ProLink: Set BPM')
	expect(actions.prolink_set_tempo.options[0]).toMatchObject({ min: 40, max: 500 })
	expect(actions.prolink_tap_tempo.name).toBe('ProLink: Tap Tempo')
	expect(actions.prolink_tap_tempo.options).toEqual([])
	await actions.prolink_set_tempo.callback({ options: { bpm: 40 } })
	await actions.prolink_set_tempo.callback({ options: { bpm: 500 } })
	await actions.prolink_set_tempo.callback({ options: { bpm: 39 } })
	await actions.prolink_set_tempo.callback({ options: { bpm: 501 } })
	expect(self._sendProlink.mock.calls).toEqual([['SetTempo', 40], ['SetTempo', 500]])
	expect(self._controlFailure).toHaveBeenCalledTimes(2)
	await actions.prolink_tap_tempo.callback()
	tapAfter(500)
	expect(self._sendProlink).toHaveBeenCalledWith('SetTempo', 120)
})
