const { encodeOsc, encodeCommand } = require('../lib/prolink-codec')
const { decodeOsc } = require('../lib/prolink-osc')
const { ProLinkObservations } = require('../lib/prolink-observations')

function oscString(text) {
	const bytes = Buffer.from(text, 'utf8')
	const result = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4)
	bytes.copy(result)
	return result
}
function int32(value) {
	const result = Buffer.alloc(4)
	result.writeInt32BE(value)
	return result
}
function frame(command, tags, data) {
	return {
		type: 5,
		payload: Buffer.concat([oscString('/waves.com/remote/' + command), oscString(tags), ...data]),
	}
}

test('preserves legacy OSC commands and supports typed extension commands', () => {
	expect(decodeOsc(encodeOsc('ShowRackByID', 0, 7)).args).toEqual([0, 7])
	expect(encodeCommand('RecallSnapshot', 2, 5).readInt32BE(8)).toBe(5)
	expect(decodeOsc(encodeOsc('GetNumRacks', 12)).args).toEqual([12])
	expect(decodeOsc(encodeOsc('NavigatePlugin', 13, 1)).args).toEqual([13, 1])
	expect(decodeOsc(encodeOsc('SetTempo', 14, 128)).args).toEqual([14, 128])
	expect(decodeOsc(encodeOsc('RequestControllerInfoUpdates', 15, true)).args).toEqual([15, true])
	expect(decodeOsc(encodeOsc('RequestControllerInfoUpdates', 16, false)).args).toEqual([16, false])
	expect(() => encodeOsc('GetNumRacks', 1, 0)).toThrow(/does not accept/)
	expect(() => encodeOsc('RequestControllerInfoUpdates', 1, 1)).toThrow(/boolean/)
	// DeleteSnapshot is supported since P4, but it requires a nonempty array of provider IDs.
	expect(() => encodeOsc('DeleteSnapshot', 1, 0)).toThrow(/Invalid snapshot ID list/)
	expect(decodeOsc(encodeOsc('DeleteSnapshot', 1, [0])).args).toEqual([1, 1, 0])
})

test('decodes float, double and 64-bit integer without losing precision', () => {
	const f = Buffer.alloc(4)
	f.writeFloatBE(0.25)
	const d = Buffer.alloc(8)
	d.writeDoubleBE(440.25)
	const h = Buffer.alloc(8)
	h.writeBigInt64BE(9007199254740993n)
	expect(decodeOsc(Buffer.concat([oscString('/t'), oscString(',fdh'), f, d, h])).args)
		.toEqual([0.25, 440.25, '9007199254740993'])
})

test('stores raw getter replies and focus-bound controller feedback', () => {
	const values = {}
	const observer = new ProLinkObservations({
		_log: jest.fn(),
		setVariableValues: (changed) => Object.assign(values, changed),
		checkFeedbacks: jest.fn(),
		updateActions: jest.fn(),
	})
	observer.track('GetNumRacks', 5)
	observer.receive(frame('GiveNumRacks', ',ii', [int32(5), int32(64)]))
	expect(values.prolink_last_reply_command).toBe('GiveNumRacks')
	expect(values.prolink_last_reply_sequence).toBe(5)
	expect(values.prolink_last_reply_args).toBe('[64]')
	expect(values.prolink_last_reply_matched).toBe(true)
	const value = Buffer.alloc(8)
	value.writeDoubleBE(440.25)
	observer.receive(frame('NotifyControllerValue', ',sd', [oscString('440 Hz'), value]))
	expect(values.prolink_controller_known).toBe(true)
	expect(values.prolink_controller_text).toBe('440 Hz')
	expect(values.prolink_controller_value).toBe(440.25)
	expect(values.active_rack).toBeUndefined()
	observer.reset()
	expect(values.prolink_controller_known).toBe(false)
	expect(values.prolink_last_reply_command).toBe('')
})

test('ProLink actions register without modifying main.js', async () => {
	const register = require('../actions')
	let actions
	const sent = []
	const self = {
		_buildRackChoices: () => [], _buildHotSnapshotChoices: () => [], _buildHotPluginChoices: () => [],
		setActionDefinitions: (definitions) => { actions = definitions },
		_prolinkId: (value, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null,
		_sendProlink: (command, value) => { sent.push([command, value]); return true },
		_controlFailure: () => false,
	}
	register(self)
	await actions.prolink_get_rack_count.callback()
	await actions.prolink_set_tempo.callback({ options: { bpm: 128 } })
	await actions.prolink_controller_subscription.callback({ options: { enabled: 'on' } })
	expect(sent).toEqual([['GetNumRacks', undefined], ['SetTempo', 128], ['RequestControllerInfoUpdates', true]])
})
