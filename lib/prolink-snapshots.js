'use strict'

// Read-only snapshot state, using verified live SuperRack 2026-10-20 OSC
// replies. GiveListOfSnapshot: [requestId, count, id, name, id, name, ...].
// The request ID has already been removed by the observer.
const MAX_NAME_LENGTH = 2048
const MAX_NAMES = 512
const MAX_LIST_JSON_LENGTH = 65536

const SNAPSHOT_VARIABLES = Object.freeze({
	prolink_snapshot_current_known: false,
	prolink_snapshot_current_number_raw: '',
	prolink_snapshot_last_name_target_id: '',
	prolink_snapshot_last_name: '',
	prolink_snapshot_names_json: '{}',
	prolink_snapshot_list_known: false,
	prolink_snapshot_list_raw: '',
	prolink_snapshot_count: '',
	prolink_snapshot_list_json: '[]',
})

function parseSnapshotList(values) {
	if (!Array.isArray(values) || values.length === 0) return null
	const count = values[0]
	if (!Number.isInteger(count) || count < 0 || count > MAX_NAMES || values.length !== 1 + 2 * count) return null
	const entries = []
	const seen = new Set()
	for (let i = 0; i < count; i++) {
		const id = values[1 + i * 2]
		const name = values[2 + i * 2]
		if (!Number.isInteger(id) || id < 0 || id > 2147483647 || seen.has(id) ||
			typeof name !== 'string' || name.length > MAX_NAME_LENGTH) return null
		seen.add(id)
		entries.push({ id, name })
	}
	if (JSON.stringify(values).length > MAX_LIST_JSON_LENGTH) return null
	return entries
}

class ProLinkSnapshots {
	constructor(instance) {
		this.instance = instance
		this.resetState()
	}

	resetState() {
		this.names = new Map()
		this.currentKnown = false
		this.currentNumber = null
		this.listKnown = false
		this.listRaw = ''
		this.listEntries = []
	}

	reset() {
		this.resetState()
		return { ...SNAPSHOT_VARIABLES }
	}

	// Validate before consuming the correlated request, not after it. Invalid
	// packets must not terminate the only outstanding request for that ID.
	accepts(reply, values, request) {
		if (!Array.isArray(values)) return false
		switch (reply) {
			case 'GiveCurrentSnapshotNumber':
				return values.length === 1 && Number.isInteger(values[0]) &&
					values[0] >= -2147483648 && values[0] <= 2147483647
			case 'GiveSnapshotName':
				return Number.isInteger(request?.argument) && request.argument >= 0 &&
					(this.names.has(request.argument) || this.names.size < MAX_NAMES) &&
					values.length === 1 && typeof values[0] === 'string' && values[0].length <= MAX_NAME_LENGTH
			case 'GiveListOfSnapshot':
				return parseSnapshotList(values) !== null
			default: return false
		}
	}

	accept(reply, values, request) {
		if (!this.accepts(reply, values, request)) return false
		const changes = {}
		switch (reply) {
			case 'GiveCurrentSnapshotNumber':
				if (!this.currentKnown || this.currentNumber !== values[0]) {
					this.currentNumber = values[0]
					this.currentKnown = true
					changes.prolink_snapshot_current_known = true
					changes.prolink_snapshot_current_number_raw = values[0]
				}
				break
			case 'GiveSnapshotName': {
				const id = request.argument
				const name = values[0]
				if (!this.names.has(id) && this.names.size >= MAX_NAMES) return false
				if (this.names.get(id) !== name) {
					this.names.set(id, name)
					// JSON uses a keyed object, not a position-based array or hot-slot ID.
					changes.prolink_snapshot_names_json = JSON.stringify(Object.fromEntries(this.names))
					if (this.listKnown && this.listEntries.some(entry => entry.id === id)) {
						this.listEntries = this.listEntries.map(entry => entry.id === id ? { id, name } : entry)
						changes.prolink_snapshot_list_json = JSON.stringify(this.listEntries)
						this.instance.updateActions?.()
					}
				}
				changes.prolink_snapshot_last_name_target_id = id
				changes.prolink_snapshot_last_name = name
				break
			}
			case 'GiveListOfSnapshot': {
				const entries = parseSnapshotList(values)
				if (!entries) return false
				const json = JSON.stringify(values)
				const normalized = JSON.stringify(entries)
				if (!this.listKnown || this.listRaw !== json ||
					JSON.stringify(this.listEntries) !== normalized) {
					this.listKnown = true
					this.listRaw = json
					this.listEntries = entries
					// Full list is authoritative for the current connection.
					// Remove stale IDs from earlier list responses.
					this.names = new Map(entries.map(entry => [entry.id, entry.name]))
					Object.assign(changes, {
						prolink_snapshot_list_known: true,
						prolink_snapshot_list_raw: json,
						prolink_snapshot_count: entries.length,
						prolink_snapshot_list_json: normalized,
						prolink_snapshot_names_json: JSON.stringify(Object.fromEntries(this.names)),
					})
					this.instance.updateActions?.()
				}
				break
			}
		}
		if (Object.keys(changes).length) this.instance.setVariableValues(changes)
		return true
	}
}

module.exports = { ProLinkSnapshots, SNAPSHOT_VARIABLES, parseSnapshotList }
