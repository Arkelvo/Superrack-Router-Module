'use strict'

// Minimal OSC decoder for incoming SuperRack ProLink messages.
// Supports the types observed on the wire: int32, string, boolean and OSC arrays.
function decodeOsc(payload) {
	if (!Buffer.isBuffer(payload)) throw new TypeError('OSC payload must be a Buffer')
	let offset = 0
	const readString = () => {
		const end = payload.indexOf(0, offset)
		if (end < 0) throw new Error('Unterminated OSC string')
		const next = (end + 4) & ~3
		if (next > payload.length) throw new Error('Truncated OSC string padding')
		for (let i = end + 1; i < next; i++) {
			if (payload[i] !== 0) throw new Error('Invalid OSC string padding')
		}
		const value = payload.toString('utf8', offset, end)
		offset = next
		return value
	}
	const readInt32 = () => {
		if (offset + 4 > payload.length) throw new Error('Truncated OSC integer')
		const value = payload.readInt32BE(offset)
		offset += 4
		return value
	}

	const path = readString()
	const tags = readString()
	if (!path.startsWith('/') || !tags.startsWith(',')) throw new Error('Invalid OSC address or tags')
	let tagIndex = 1
	let itemCount = 0
	const readArgument = (depth = 0) => {
		if (depth > 4 || ++itemCount > 2048) throw new Error('OSC argument limit exceeded')
		const tag = tags[tagIndex++]
		switch (tag) {
			case 'i': return readInt32()
			case 's': return readString()
			case 'T': return true
			case 'F': return false
			case '[': {
				const values = []
				while (tagIndex < tags.length && tags[tagIndex] !== ']') {
					values.push(readArgument(depth + 1))
				}
				if (tags[tagIndex++] !== ']') throw new Error('Unclosed OSC array')
				return values
			}
			default: throw new Error(`Unsupported OSC type tag: ${String(tag)}`)
		}
	}
	const args = []
	while (tagIndex < tags.length) args.push(readArgument())
	if (offset !== payload.length) throw new Error('Unexpected OSC trailing bytes')
	return { path, args }
}

module.exports = { decodeOsc }
