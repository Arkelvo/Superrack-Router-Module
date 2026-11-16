const fs = require('fs')
const path = require('path')
const { encodeOsc, encodeCommand, encodeHello, encodeDiscovery, WaveParser } = require('../lib/prolink-codec')

// Archive is UTF-16LE with BOM, retained byte-for-byte.
const vectors = fs
	.readFileSync(path.join(__dirname, 'fixtures/original-codec-vectors.txt'), 'utf16le')
	.replace(/^\uFEFF/, '')
test('archive supplies all ten original OSC vectors', () => {
	expect(vectors.split(/\r?\n/).filter((line) => line.includes(' hex='))).toHaveLength(10)
})
for (const line of vectors.split(/\r?\n/)) {
	const m = /^(\w+) request=(\d+) id=(-?\d+) length=(\d+) hex=([0-9a-f]+)$/.exec(line)
	if (!m) continue
	test(`original encoder: ${m[1]} ID ${m[3]}`, () => {
		const osc = encodeOsc(m[1], Number(m[2]), Number(m[3]))
		expect(osc.toString('hex')).toBe(m[5])
		expect(osc.length).toBe(Number(m[4]))
		const frame = encodeCommand(m[1], Number(m[2]), Number(m[3]))
		expect(frame.subarray(0, 12).toString('hex')).toBe('000000015761766500000005')
		expect(frame.readInt32BE(12)).toBe(Number(m[4]))
		expect(frame.subarray(16)).toEqual(osc)
	})
}

test('Hello and UDP discovery use distinct original layouts and identity', () => {
	const hello = encodeHello('Mixing Station')
	expect(hello.length).toBe(58)
	expect(hello.subarray(0, 24).toString('hex')).toBe('000000015761766500000001000001f40000000000010000')
	expect(hello.subarray(24, 40).toString('hex')).toBe('449f183fe083e99716e584736b821e20')
	expect(hello.readInt32BE(40)).toBe(14)
	expect(hello.subarray(44).toString()).toBe('Mixing Station')
	const reply = encodeDiscovery(54321, 'Mixing Station')
	expect(reply.length).toBe(78)
	expect(reply.subarray(0, 22).toString('hex')).toBe('00000001576176650000000200000000000100000000')
	expect(reply.subarray(22, 38)).toEqual(Buffer.alloc(16))
	expect(reply.readUInt16BE(38)).toBe(54321)
	expect(reply.readInt32BE(40)).toBe(0)
	expect(reply.subarray(44, 60).toString('hex')).toBe('449f183fe083e99716e584736b821e20')
	expect(reply.readInt32BE(60)).toBe(14)
})

const heartbeat = Buffer.from('00000001576176650000000400000000', 'hex')
test('every split point and coalesced frames are consumed exactly once', () => {
	const bytes = Buffer.concat([encodeHello('Peer'), heartbeat, encodeCommand('ShowRackByID', 1, 7)])
	for (let split = 0; split <= bytes.length; split++) {
		const parser = new WaveParser()
		const frames = [...parser.push(bytes.subarray(0, split)), ...parser.push(bytes.subarray(split))]
		expect(frames.map((f) => f.type)).toEqual([1, 4, 5])
		expect(frames[2].payload.readInt32BE(frames[2].payload.length - 4)).toBe(7)
	}
	const parser = new WaveParser()
	expect([...bytes].flatMap((b) => parser.push(Buffer.from([b]))).map((f) => f.type)).toEqual([1, 4, 5])
})

test.each([
	'00000002576176650000000400000000',
	'00000001426164640000000400000000',
	'00000001d7e1f6e50000000400000000',
	'00000001576176650000006300000000',
	'000000015761766500000005ffffffff',
	'0000000157617665000000057fffffff',
	'00000001576176650000000500000000',
])('rejects invalid frame %s without retaining it', (hex) => {
	const parser = new WaveParser()
	expect(() => parser.push(Buffer.from(hex, 'hex'))).toThrow()
	parser.reset()
	expect(parser.push(heartbeat).map((f) => f.type)).toEqual([4])
})

test('reset discards partial frame; TCP type 2 is only 16 bytes', () => {
	const parser = new WaveParser()
	parser.push(encodeCommand('RecallSnapshot', 0, 2).subarray(0, 19))
	parser.reset()
	const tcp2 = Buffer.from('000000015761766500000002000001f4', 'hex')
	expect(parser.push(Buffer.concat([tcp2, heartbeat])).map((f) => f.type)).toEqual([2, 4])
})

test('validates integer limits, command names and name lengths', () => {
	for (const id of [NaN, 1.5, 2147483648, -2147483649]) expect(() => encodeOsc('ShowRackByID', 0, id)).toThrow()
	expect(() => encodeOsc('Unknown', 0, 1)).toThrow()
	expect(() => encodeHello('x'.repeat(1025))).toThrow()
	const hello = encodeHello('Peer')
	hello.writeInt32BE(-1, 40)
	expect(() => new WaveParser().push(hello)).toThrow()
})

// SwitchControllerValue: V5-V12 wire captures per ProLink protocol
// OSC path: /waves.com/remote/SwitchControllerValue (39 chars -> 40 bytes with null)
// OSC tags: ,ii (requestId:int32, value:int32) -> 4 bytes padded (,ii\0)
// Value semantics: 0=off, 1=on (discrete switch, distinct from relative ChangeControllerValue)
// Total OSC payload: 40 + 4 + 8 = 52 bytes

test('COMMAND_SCHEMAS includes SwitchControllerValue', () => {
	const { COMMAND_SCHEMAS } = require('../lib/prolink-codec')
	expect(Object.hasOwn(COMMAND_SCHEMAS, 'SwitchControllerValue')).toBe(true)
	expect(typeof COMMAND_SCHEMAS.SwitchControllerValue).toBe('string')
})

// V5: SwitchControllerValue request=0 value=0
test('SwitchControllerValue encodes value=0 (V5)', () => {
	const { encodeOsc, encodeCommand } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', 0, 0)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000000000000')
	expect(osc.length).toBe(52)
	const frame = encodeCommand('SwitchControllerValue', 0, 0)
	expect(frame.subarray(0, 12).toString('hex')).toBe('000000015761766500000005')
	expect(frame.readInt32BE(12)).toBe(52)
	expect(frame.subarray(16)).toEqual(osc)
})

// V6: SwitchControllerValue request=0 value=1
test('SwitchControllerValue encodes value=1 (V6)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', 0, 1)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000000000001')
	expect(osc.length).toBe(52)
})

// V7: SwitchControllerValue request=1 value=0
test('SwitchControllerValue encodes request=1 value=0 (V7)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', 1, 0)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000100000000')
	expect(osc.length).toBe(52)
})

// V8: SwitchControllerValue request=1 value=1
test('SwitchControllerValue encodes request=1 value=1 (V8)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', 1, 1)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000100000001')
	expect(osc.length).toBe(52)
})

// V9: SwitchControllerValue request=-1 value=0 (negative requestId)
test('SwitchControllerValue encodes negative requestId (V9)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', -1, 0)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c696900ffffffff00000000')
	expect(osc.length).toBe(52)
})

// V10: SwitchControllerValue full frame encoding
test('SwitchControllerValue full frame (V10)', () => {
	const { encodeCommand } = require('../lib/prolink-codec')
	const frame = encodeCommand('SwitchControllerValue', 0, 1)
	expect(frame.subarray(0, 12).toString('hex')).toBe('000000015761766500000005')
	expect(frame.readInt32BE(12)).toBe(52)
	expect(frame.subarray(16).toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000000000001')
})

// V11: SwitchControllerValue with different sequence
test('SwitchControllerValue sequence=7 value=0 (V11)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', 7, 0)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000700000000')
	expect(osc.length).toBe(52)
})

// V12: SwitchControllerValue sequence=8 value=1
test('SwitchControllerValue sequence=8 value=1 (V12)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	const osc = encodeOsc('SwitchControllerValue', 8, 1)
	expect(osc.toString('hex')).toBe('2f77617665732e636f6d2f72656d6f74652f537769746368436f6e74726f6c6c657256616c7565002c6969000000000800000001')
	expect(osc.length).toBe(52)
})

// Negative tests for SwitchControllerValue
test('SwitchControllerValue rejects non-integer value', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	expect(() => encodeOsc('SwitchControllerValue', 0, 1.5)).toThrow('Expected int32')
	expect(() => encodeOsc('SwitchControllerValue', 0, NaN)).toThrow('Expected int32')
	expect(() => encodeOsc('SwitchControllerValue', 0, 'on')).toThrow('Expected int32')
})

test('SwitchControllerValue rejects out-of-int32-range value', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	expect(() => encodeOsc('SwitchControllerValue', 0, 2147483648)).toThrow('Expected int32')
	expect(() => encodeOsc('SwitchControllerValue', 0, -2147483649)).toThrow('Expected int32')
})

test('SwitchControllerValue accepts any int32 value (protocol encodes any int32)', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	// These should not throw - protocol encodes any int32; application layer restricts to 0/1
	expect(() => encodeOsc('SwitchControllerValue', 0, -1)).not.toThrow()
	expect(() => encodeOsc('SwitchControllerValue', 0, 2)).not.toThrow()
	expect(() => encodeOsc('SwitchControllerValue', 0, -8)).not.toThrow()
	expect(() => encodeOsc('SwitchControllerValue', 0, 8)).not.toThrow()
})

test('SwitchControllerValue rejects invalid requestId', () => {
	const { encodeOsc } = require('../lib/prolink-codec')
	for (const id of [NaN, 1.5, 2147483648, -2147483649]) {
		expect(() => encodeOsc('SwitchControllerValue', id, 0)).toThrow('Expected int32')
	}
})
