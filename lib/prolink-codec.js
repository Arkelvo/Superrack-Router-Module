const { createHash } = require('crypto')

// Verified OSC request signatures; every request begins with a signed int32 ID.
// Additional snapshots args are flattened, not OSC array tags.
const COMMAND_SCHEMAS = Object.freeze({
	ShowRackByID: 'i', RecallSnapshot: 'i', HighlightSnapshot: 'i',
	NavigatePlugin: 'i', NavigateRack: 'i', SetTempo: 'i', ShowPlugin: '',
	GetNumRacks: '', GetCurrentSnapshotNumber: '', GetListOfSnapshots: '',
	GetCPUUsage: '', GetSessionDirtyState: '', GetRackName: 'i',
	GetRacksInfo: 'i', GetSnapshotName: 'i', RequestControllerInfoUpdates: 'b',
	ChangeControllerValue: 'i',
	StoreSnapshot: '',
	DuplicateSnapshot: 'i',
	MoveSnapshot: 'ii',
	SetSnapshotName: 'map',
	DeleteSnapshot: 'list',
})
const MAX_PAYLOAD = 1024 * 1024
const MAX_NAME = 1024
const MAX_SNAPSHOT_ENTRIES = 512
const MAX_SNAPSHOT_NAME_BYTES = 2048

function int32(value) {
	if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('Expected int32')
	const bytes = Buffer.alloc(4)
	bytes.writeInt32BE(value)
	return bytes
}

function header(type) {
	return Buffer.concat([int32(1), Buffer.from('Wave'), int32(type)])
}

function oscString(value) {
	const bytes = Buffer.alloc(Math.ceil((value.length + 1) / 4) * 4)
	bytes.write(value, 'ascii')
	return bytes
}

function oscUtf8String(value) {
	if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid snapshot name')
	const encoded = Buffer.from(value, 'utf8')
	if (encoded.length > MAX_SNAPSHOT_NAME_BYTES) throw new Error('Snapshot name too long')
	const padded = Buffer.alloc(Math.ceil((encoded.length + 1) / 4) * 4)
	encoded.copy(padded)
	return padded
}

function encodeSnapshotMap(value) {
	if (!Array.isArray(value) || value.length !== 1) {
		// One targeted rename per user action; do not silently overwrite a map of names.
		throw new Error('Expected one snapshot ID/name pair')
	}
	const entry = value[0]
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid snapshot map entry')
	if (!Number.isInteger(entry.id) || entry.id < 0 || entry.id > 2147483647) throw new Error('Invalid snapshot ID')
	return { tags: 'iis', data: [int32(1), int32(entry.id), oscUtf8String(entry.name)] }
}

function encodeSnapshotIdList(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SNAPSHOT_ENTRIES ||
		!value.every((id) => Number.isInteger(id) && id >= 0 && id <= 2147483647) ||
		new Set(value).size !== value.length) {
		throw new Error('Invalid snapshot ID list')
	}
	return { tags: 'i' + 'i'.repeat(value.length), data: [int32(value.length), ...value.map(int32)] }
}

function encodeOsc(command, sequence, value) {
	if (!Object.hasOwn(COMMAND_SCHEMAS, command)) throw new Error('Unsupported ProLink command')
	const schema = COMMAND_SCHEMAS[command]
	let tags = ',i'
	const argumentsBytes = [int32(sequence)]
	if (schema === 'i') {
		tags += 'i'
		argumentsBytes.push(int32(value))
	} else if (schema === 'b') {
		if (typeof value !== 'boolean') throw new Error('Expected ProLink boolean')
		tags += value ? 'T' : 'F'
	} else if (schema === 'ii') {
		if (!Array.isArray(value) || value.length !== 2) throw new Error('Expected two snapshot indices')
		tags += 'ii'
		argumentsBytes.push(int32(value[0]), int32(value[1]))
	} else if (schema === 'map') {
		const payload = encodeSnapshotMap(value)
		tags += payload.tags
		argumentsBytes.push(...payload.data)
	} else if (schema === 'list') {
		const payload = encodeSnapshotIdList(value)
		tags += payload.tags
		argumentsBytes.push(...payload.data)
	} else if (value !== undefined) {
		throw new Error('ProLink command does not accept an argument')
	}
	const result = Buffer.concat([oscString(`/waves.com/remote/${command}`), oscString(tags), ...argumentsBytes])
	if (result.length > MAX_PAYLOAD) throw new Error('OSC payload exceeds maximum')
	return result
}

function encodeCommand(command, sequence, value) {
	const payload = encodeOsc(command, sequence, value)
	return Buffer.concat([header(5), int32(payload.length), payload])
}

function nameBytes(name) {
	if (typeof name !== 'string' || !name.trim()) throw new Error('ProLink device name must not be empty')
	const bytes = Buffer.from(name, 'utf8')
	if (bytes.length > MAX_NAME) throw new Error('ProLink device name exceeds 1024 UTF-8 bytes')
	return bytes
}

function encodeHello(name) {
	const bytes = nameBytes(name)
	const result = Buffer.alloc(44 + bytes.length)
	header(1).copy(result)
	result.writeInt32BE(500, 12)
	result.writeUInt16BE(1, 20)
	createHash('md5').update(bytes).digest().copy(result, 24)
	result.writeInt32BE(bytes.length, 40)
	bytes.copy(result, 44)
	return result
}

function encodeDiscovery(port, name) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TCP listen port')
	const bytes = nameBytes(name)
	const result = Buffer.alloc(64 + bytes.length)
	header(2).copy(result)
	result.writeUInt16BE(1, 16)
	result.writeUInt16BE(port, 38)
	createHash('md5').update(bytes).digest().copy(result, 44)
	result.writeInt32BE(bytes.length, 60)
	bytes.copy(result, 64)
	return result
}

// Accumulate only the current frame, never an unbounded concatenated TCP chunk.
class WaveParser {
	constructor() { this.reset() }
	reset() {
		this.buffer = Buffer.alloc(44)
		this.used = 0
		this.required = 12
		this.stage = 'header'
	}
	push(chunk) {
		try {
			return this._pushValidated(chunk)
		} catch (error) {
			this.reset()
			throw error
		}
	}

	// Error validation lives outside the local catch so PhpStorm does not
	// flag every legitimate framing error as a locally caught exception.
	_pushValidated(chunk) {
		const frames = []
		let offset = 0
		while (offset < chunk.length) {
				const count = Math.min(this.required - this.used, chunk.length - offset)
				chunk.copy(this.buffer, this.used, offset, offset + count)
				this.used += count
				offset += count
				if (this.used < this.required) continue
				if (this.stage === 'header') {
					if (this.buffer.readInt32BE(0) !== 1 || this.buffer.readUInt32BE(4) !== 0x57617665)
						throw new Error('Invalid Wave header')
					this.type = this.buffer.readInt32BE(8)
					if (![1, 2, 4, 5].includes(this.type)) throw new Error('Unsupported Wave type')
					this.required = this.type === 1 ? 44 : 16
					this.stage = 'fixed'
					continue
				}
				if (this.stage === 'fixed' && (this.type === 1 || this.type === 5)) {
					const length = this.buffer.readInt32BE(this.type === 1 ? 40 : 12)
					const limit = this.type === 1 ? MAX_NAME : MAX_PAYLOAD
					if (length < 1 || length > limit) throw new Error('Invalid Wave payload length')
					this.required += length
					const expanded = Buffer.alloc(this.required)
					this.buffer.copy(expanded, 0, 0, this.used)
					this.buffer = expanded
					this.stage = 'body'
					continue
				}
				frames.push({
					type: this.type,
					payload: Buffer.from(this.buffer.subarray(this.type === 5 ? 16 : 12, this.used)),
				})
				this.reset()
		}
		return frames
	}
}

module.exports = { encodeOsc, encodeCommand, encodeHello, encodeDiscovery, WaveParser, COMMAND_SCHEMAS }
