const { decodeOsc } = require('../lib/prolink-osc')
const { ProLinkObservations } = require('../lib/prolink-observations')

function oscString(text) {
	const bytes = Buffer.from(text, 'utf8')
	const padded = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4)
	bytes.copy(padded)
	return padded
}
function oscInt(value) {
	const b = Buffer.alloc(4)
	b.writeInt32BE(value)
	return b
}
function packet(path, tags, data) {
	return { type: 5, payload: Buffer.concat([oscString(path), oscString(tags), ...data]) }
}
const prefix = '/waves.com/remote/'
function rackPacket(overrides = {}) {
	const rows = []
	const tags = [',i']
	for (let i = 0; i < 64; i++) {
		const rack = overrides[i] ?? {}
		const muted = rack.muted ?? false
		const on = rack.on ?? true
		tags.push(`[isiiiiii${muted ? 'T' : 'F'}${on ? 'T' : 'F'}i]`)
		rows.push(oscInt(i), oscString(rack.name ?? `Rack ${i + 1}`))
		rows.push(...[1, 1, 100, 100, i, i, 0].map(oscInt))
	}
	return packet(prefix + 'NotifyRacksConfigChanged', tags.join(''), [oscInt(64), ...rows])
}
function observer() {
	const values = {}
	const self = {
		_log: jest.fn(),
		setVariableValues: jest.fn(v => Object.assign(values, v)),
		checkFeedbacks: jest.fn(),
		updateActions: jest.fn(),
	}
	return { obs: new ProLinkObservations(self), self, values }
}

test('decodes the observed ResultCommand OSC packet with sequence and text', () => {
	const p = packet(prefix + 'ResultCommand', ',iis', [
		oscInt(2), oscInt(0), oscString(prefix + 'ShowRackByID succeeded'),
	])
	expect(p.payload.length).toBe(92)
	expect(decodeOsc(p.payload)).toEqual({ path: prefix + 'ResultCommand', args: [2, 0, prefix + 'ShowRackByID succeeded'] })
})

test('reads 64 rack names and two boolean state flags; repeated payload is ignored', () => {
	const { obs, self, values } = observer()
	const first = rackPacket({ 6: { name: 'Keys', muted: false, on: true } })
	obs.receive(first)
	expect(obs.racks.size).toBe(64)
	expect(values.rack_7_name).toBe('Keys')
	expect(values.rack_7_muted).toBe(false)
	expect(values.rack_7_on).toBe(true)
	expect(values.rack_7_known).toBe(true)
	const before = self.setVariableValues.mock.calls.length
	obs.receive(first)
	expect(self.setVariableValues).toHaveBeenCalledTimes(before)
	obs.receive(rackPacket({ 6: { name: 'Keys', muted: true, on: false } }))
	expect(values.rack_7_muted).toBe(true)
	expect(values.rack_7_on).toBe(false)
	expect(self.updateActions).toHaveBeenCalledTimes(1)
})

test('startup statuses retain exact raw values and suppress duplicate updates', () => {
	const { obs, self, values } = observer()
	const items = [
		['NotifySyncStatus', ',i', [oscInt(0)], 'prolink_sync_status', 0],
		['NotifyIOBoxStatus', ',T', [], 'prolink_iobox_status', true],
		['NotifySGSStatus', ',T', [], 'prolink_sgs_status', true],
		['NotifyRemoteOperation', ',ii', [oscInt(6), oscInt(602)], 'prolink_remote_operation', '[6,602]'],
		['NotifySnapshotDirty', ',F', [], 'prolink_snapshot_dirty', false],
		['NotifySessionDirty', ',T', [], 'prolink_session_dirty', true],
	]
	for (const [command, tags, data, variable, value] of items) {
		const frame = packet(prefix + command, tags, data)
		obs.receive(frame)
		expect(values[variable]).toEqual(value)
		const before = self.setVariableValues.mock.calls.length
		obs.receive(frame)
		expect(self.setVariableValues).toHaveBeenCalledTimes(before)
	}
})

test('correlates ResultCommand with a sent sequence; unmatched ACK is not attributed', () => {
	jest.useFakeTimers()
	try {
		const { obs, values } = observer()
		obs.track('ShowRackByID', 2)
		expect(values.prolink_command_pending).toBe(1)
		obs.receive(packet(prefix + 'ResultCommand', ',iis', [oscInt(99), oscInt(0), oscString(prefix + 'ShowRackByID succeeded')]))
		expect(values.prolink_command_pending).toBe(1)
		obs.receive(packet(prefix + 'ResultCommand', ',iis', [oscInt(2), oscInt(0), oscString(prefix + 'ShowRackByID succeeded')]))
		expect(values.prolink_command_pending).toBe(0)
		expect(values.prolink_last_command_status).toBe('succeeded')
		expect(values.prolink_last_ack_sequence).toBe(2)
	} finally {
		jest.useRealTimers()
	}
})

test('timeout is unconfirmed, not an invented remote failure; disconnect clears observed state', () => {
	jest.useFakeTimers()
	try {
		const { obs, values } = observer()
		obs.track('ShowRackByID', 10)
		jest.advanceTimersByTime(2500)
		expect(values.prolink_last_command_status).toBe('unconfirmed')
		obs.receive(rackPacket())
		obs.reset()
		expect(values.rack_1_name).toBe('')
		expect(values.rack_1_known).toBe(false)
		expect(values.prolink_command_pending).toBe(0)
		expect(obs.racks.size).toBe(0)
	} finally {
		jest.useRealTimers()
	}
})

test('invalid OSC packets do not mutate state or crash receiver', () => {
	const { obs, self } = observer()
	obs.receive({ type: 5, payload: Buffer.from('bad message') })
	expect(obs.racks.size).toBe(0)
	expect(self._log).toHaveBeenCalledWith('warn', '[PROLINK_OSC_INVALID]', expect.any(Object))
})
