'use strict'

/** Read-only, transport-aware projection of observed ProLink rack names for the patch UI. */
function getPatchUiState(instance) {
	const transport = instance.config?.controlTransport === 'prolink' ? 'prolink' : 'midi'
	const prolinkConnected = transport === 'prolink' && instance._prolink?.state === 'connected'
	const count = Math.min(64, Math.max(0, Number.isInteger(instance.rackCount) ? instance.rackCount : 64))
	const racks = Array.from({ length: count }, (_, i) => {
		const id = i + 1
		const raw = prolinkConnected ? instance._prolinkObservations?.racks?.get(id)?.name : null
		const observed = typeof raw === 'string' && raw.trim().length > 0
		return { id, name: observed ? raw : `Rack ${id}`, observed }
	})
	return { transport, prolinkConnected, racks }
}

module.exports = { getPatchUiState }
