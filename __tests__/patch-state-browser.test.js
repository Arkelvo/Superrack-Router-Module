'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const browserScript = fs.readFileSync(path.join(__dirname, '../ui/public/patch-state.js'), 'utf8')

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('browser updates rack labels in place, reverts on disconnect and transport switch', async () => {
	// First poll begins immediately, so the first fetch response is held by a controllable promise.
	const labels = Array.from({ length: 3 }, (_x, i) => ({ textContent: `Rack ${i + 1}`, title: '' }))
	const links = Array.from({ length: 2 }, () => ({ hidden: true, style: { display: 'none' } }))
	const cycles = []
	const scheduled = []
	const fetch = jest.fn(() => new Promise((resolve, reject) => cycles.push({ resolve, reject })))
	const document = {
		getElementById: () => ({ querySelectorAll: () => labels }),
		querySelectorAll: () => links,
	}
	vm.runInNewContext(browserScript, { document, fetch, setTimeout: (fn) => scheduled.push(fn) })
	expect(fetch).toHaveBeenCalledTimes(1)
	cycles.shift().resolve({ ok: true, json: async () => ({
		transport: 'prolink', prolinkConnected: true,
		racks: [{ id: 1, name: 'Voc Hannah', observed: true }, { id: 2, name: '<script>alert(1)</script>', observed: true }],
	}) })
	await tick()
	expect(labels.map((v) => v.textContent)).toEqual(['Voc Hannah', '<script>alert(1)</script>', 'Rack 3'])
	expect(links.every((v) => v.hidden && v.style.display === 'none')).toBe(true)

	scheduled.shift()()
	cycles.shift().resolve({ ok: true, json: async () => ({ transport: 'prolink', prolinkConnected: false, racks: [] }) })
	await tick()
	expect(labels.map((v) => v.textContent)).toEqual(['Rack 1', 'Rack 2', 'Rack 3'])

	scheduled.shift()()
	cycles.shift().resolve({ ok: true, json: async () => ({ transport: 'midi', prolinkConnected: false, racks: [] }) })
	await tick()
	expect(links.every((v) => !v.hidden && v.style.display === '')).toBe(true)

	scheduled.shift()()
	cycles.shift().reject(new Error('HTTP unavailable'))
	await tick()
	expect(labels[0].textContent).toBe('Rack 1')
	expect(links.every((v) => v.hidden)).toBe(true) // fail closed: unknown transport
})
