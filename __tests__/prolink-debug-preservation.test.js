jest.mock('@companion-module/base', () => ({
	...jest.requireActual('@companion-module/base'),
	InstanceBase: class {},
	runEntrypoint: jest.fn(),
}))

const ModuleInstance = require('../main')

const oscString = (s) => {
	const b = Buffer.from(s)
	const padded = Buffer.alloc(Math.ceil((b.length + 1) / 4) * 4)
	b.copy(padded)
	return padded
}
const oscInt = (i) => {
	const b = Buffer.alloc(4)
	b.writeInt32BE(i)
	return b
}
const packet = (name, tags, values) => ({
	type: 5,
	payload: Buffer.concat([oscString(`/waves.com/remote/${name}`), oscString(tags), ...values]),
})

function rackPacket(muted = false) {
	const tags = [',i']
	const values = [oscInt(64)]
	for (let i = 0; i < 64; i++) {
		tags.push(`[isiiiiii${i === 6 && muted ? 'T' : 'F'}Ti]`)
		values.push(oscInt(i), oscString(i === 6 ? 'Keys' : `Rack ${i + 1}`))
		values.push(...[1, 1, 100, 100, i, i, 0].map(oscInt))
	}
	return packet('NotifyRacksConfigChanged', tags.join(''), values)
}

test('keeps existing decoded debug logging while receiving structured state', () => {
	const self = new ModuleInstance({})
	self._log = jest.fn()
	self.setVariableValues = jest.fn()
	self.checkFeedbacks = jest.fn()
	self.updateActions = jest.fn()
	self.logLevel = 'debug'
	self.config = { controlTransport: 'prolink' }

	const first = rackPacket(false)
	self._prolink.onFrame(first)
	self._prolink.onDebugFrame(first)
	expect(self._prolinkObservations.racks.get(7)).toMatchObject({ name: 'Keys', muted: false, on: true })
	expect(self._log).toHaveBeenCalledWith('debug', '[PROLINK_RACK_NAMES]', expect.any(Array))

	const muted = rackPacket(true)
	self._prolink.onFrame(muted)
	self._prolink.onDebugFrame(muted)
	expect(self._prolinkObservations.racks.get(7).muted).toBe(true)
	expect(self._log).toHaveBeenCalledWith('debug', '[PROLINK_RACK_CHANGED]',
		expect.objectContaining({ rack: 7, name: 'Keys' }))

	self._prolink.onFrame(packet('NotifySyncStatus', ',i', [oscInt(0)]))
	self._prolink.onDebugFrame(packet('NotifySyncStatus', ',i', [oscInt(0)]))
	expect(self._log).toHaveBeenCalledWith('debug', '[PROLINK_RX]',
		{ path: '/waves.com/remote/NotifySyncStatus', args: [0] })
})
