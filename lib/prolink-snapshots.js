'use strict'

// Read-only snapshot state. The binary analysis establishes the Give* addresses,
// but only the number/name getters have a sufficiently constrained value shape.
// The list is intentionally kept raw until a live OSC capture establishes its schema.
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
})

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
			case 'GiveListOfSnapshot': {
				const json = JSON.stringify(values)
				return typeof json === 'string' && json.length <= MAX_LIST_JSON_LENGTH
			}
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
				}
				changes.prolink_snapshot_last_name_target_id = id
				changes.prolink_snapshot_last_name = name
				break
			}
			case 'GiveListOfSnapshot': {
				const json = JSON.stringify(values)
				if (!this.listKnown || this.listRaw !== json) {
					this.listRaw = json
					this.listKnown = true
					changes.prolink_snapshot_list_known = true
					changes.prolink_snapshot_list_raw = json
				}
				break
			}
		}
		if (Object.keys(changes).length) this.instance.setVariableValues(changes)
		return true
	}
}

module.exports = { ProLinkSnapshots, SNAPSHOT_VARIABLES }
