'use strict'

/** Read-only, transport-aware projection of observed ProLink rack names and status for the patch UI. */
function getPatchUiState(instance) {
	const transport = instance.config?.controlTransport === 'prolink' ? 'prolink' : 'midi'
	const prolinkConnected = transport === 'prolink' && instance._prolink?.state === 'connected'
	const count = Math.min(64, Math.max(0, Number.isInteger(instance.rackCount) ? instance.rackCount : 64))
	const racks = Array.from({ length: count }, (_, i) => {
		const id = i + 1
		let name = `Rack ${id}`
		let observed = false
		let muted = false
		let on = false
		if (prolinkConnected) {
			const rack = instance._prolinkObservations?.racks?.get(id)
			if (rack) {
				if (typeof rack.name === 'string' && rack.name.trim().length > 0) {
					name = rack.name
					observed = true
				}
				muted = rack.muted === true
				on = rack.on === true
			}
		}
		return { id, name, observed, muted, on }
	})
	return { transport, prolinkConnected, racks }
}

module.exports = { getPatchUiState }
