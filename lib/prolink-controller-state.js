'use strict'

// Read-only representation of the *selected* SuperRack Touch-and-Turn control.
// ProLink notifications have no request ID or rack/plugin/parameter address.
// Properties are positional (not VST3 ParameterInfo); their deeper semantics
// are deliberately not guessed. See docs/PROLINK_CONTROLLER_STATE.md.
const PROPERTY_TYPES = [
	'string', 'boolean', 'integer', 'double', 'double', 'string',
	'double', 'double', 'boolean', 'integer', 'string', 'string', 'string',
]

function validateProperties(args) {
	if (!Array.isArray(args) || args.length !== PROPERTY_TYPES.length) return false
	return args.every((v, i) => {
		const type = PROPERTY_TYPES[i]
		if (type === 'string') return typeof v === 'string' && v.length <= 2048
		if (type === 'boolean') return typeof v === 'boolean'
		if (type === 'integer') return Number.isInteger(v)
		return typeof v === 'number' && Number.isFinite(v)
	})
}

class ProLinkControllerState {
	constructor() {
		this.properties = null
		this.value = null
		this.contextVersion = 0
	}

	hasData() {
		return this.properties !== null || this.value !== null
	}

	reset() {
		this.properties = null
		this.value = null
		this.contextVersion = 0
		return {
			prolink_controller_properties_known: false,
			prolink_controller_known: false,
			prolink_controller_name: '',
			prolink_controller_unit: '',
			prolink_controller_bounds_a_raw: '',
			prolink_controller_bounds_b_raw: '',
			prolink_controller_bounds_a_text_raw: '',
			prolink_controller_bounds_b_text_raw: '',
			prolink_controller_aux_text_raw: '',
			prolink_controller_properties: '',
			prolink_controller_text: '',
			prolink_controller_value: '',
			prolink_controller_context_version: 0,
			prolink_controller_last_properties_update_ms: '',
			prolink_controller_last_value_update_ms: '',
		}
	}

	observeProperties(args) {
		if (!validateProperties(args)) return null
		const signature = JSON.stringify(args)
		if (this.properties?.signature === signature) return { changed: false }
		const hadProperties = this.properties !== null
		const previousName = this.properties?.values[0] ?? ''
		const previousUnit = this.properties?.values[5] ?? ''
		this.properties = { values: [...args], signature }
		this.contextVersion++
		const changes = {
			prolink_controller_properties_known: true,
			prolink_controller_name: args[0],
			prolink_controller_unit: args[5],
			// Raw positional doubles (fields 3,4): not verified VST3 bounds.
			prolink_controller_bounds_a_raw: args[3],
			prolink_controller_bounds_b_raw: args[4],
			prolink_controller_bounds_a_text_raw: args[11],
			prolink_controller_bounds_b_text_raw: args[12],
			prolink_controller_aux_text_raw: args[10],
			prolink_controller_properties: signature,
			prolink_controller_context_version: this.contextVersion,
			prolink_controller_last_properties_update_ms: Date.now(),
		}
		// The subscription changes focus without a controller identifier. When
		// any known properties change, discard an earlier controller's value.
		if (hadProperties) {
			this.value = null
			Object.assign(changes, {
				prolink_controller_known: false,
				prolink_controller_text: '',
				prolink_controller_value: '',
				prolink_controller_last_value_update_ms: '',
			})
		}
		return {
			changed: true,
			values: changes,
			log: { name: args[0], unit: args[5], previousName, previousUnit, contextVersion: this.contextVersion },
		}
	}

	observeValue(args) {
		if (!Array.isArray(args) || args.length !== 2 ||
			typeof args[0] !== 'string' || args[0].length > 2048 ||
			typeof args[1] !== 'number' || !Number.isFinite(args[1])) return null
		const signature = JSON.stringify(args)
		if (this.value?.signature === signature) return { changed: false }
		this.value = { values: [...args], signature }
		return {
			changed: true,
			values: {
				prolink_controller_known: true,
				prolink_controller_text: args[0],
				prolink_controller_value: args[1],
				prolink_controller_last_value_update_ms: Date.now(),
			},
			log: { valueText: args[0], rawDouble: args[1], contextVersion: this.contextVersion },
		}
	}
}

module.exports = { ProLinkControllerState, validateProperties }
