'use strict'

// The rack matrix is owned by app.js. Update *only* its labels so mapped
// cells, selection and event handlers survive live SuperRack name changes.
;(function () {
	const POLL_MS = 2000
	const rackMatrix = document.getElementById('patch-matrix-container')
	const midiOnlyLinks = Array.from(document.querySelectorAll('[data-midi-only]'))
	const isMidiEditor = typeof window !== 'undefined' && /^\/midi\/(plugin|snapshot)$/.test(window.location.pathname)
	if (!rackMatrix && !midiOnlyLinks.length && !isMidiEditor) return

	function render(state) {
		const prolink = state?.transport === 'prolink'
		if (isMidiEditor && prolink) {
			window.location.replace('/patch')
			return
		}
		for (const el of midiOnlyLinks) {
			el.hidden = prolink
			el.style.display = prolink ? 'none' : ''
		}
		if (!rackMatrix) return
		const connected = prolink && state.prolinkConnected === true
		const knownNames = new Map()
		if (connected && Array.isArray(state.racks)) {
			for (const entry of state.racks) {
				if (Number.isInteger(entry.id) && entry.id >= 1 && entry.observed === true &&
					typeof entry.name === 'string' && entry.name.trim()) {
					knownNames.set(entry.id, entry.name)
				}
			}
		}
		const labels = rackMatrix.querySelectorAll('.patch-y-label')
		labels.forEach((label, index) => {
			const id = index + 1
			const text = knownNames.get(id) || `Rack ${id}`
			if (label.textContent !== text) label.textContent = text
			label.title = text
		})
	}

	async function poll() {
		try {
			const response = await fetch('/patch/state', { cache: 'no-store' })
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			render(await response.json())
		} catch (_error) {
			// Without a fresh server response no cached SuperRack name is trusted.
			render({ transport: 'prolink', prolinkConnected: false, racks: [] })
		} finally {
			setTimeout(poll, POLL_MS)
		}
	}
	poll()
})()
