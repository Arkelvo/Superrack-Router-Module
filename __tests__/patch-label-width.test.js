'use strict'
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const code = fs.readFileSync(path.join(__dirname, '../ui/public/patch-state.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '../ui/public/rack-channel.html'), 'utf8')
const css = fs.readFileSync(path.join(__dirname, '../ui/public/patch-grid.css'), 'utf8')

test('patch label column is shared max-content and tracks live names without clipping', async () => {
	const labels = [{ textContent: 'Rack 1' }, { textContent: 'Rack 2' }]
	const table = { style: { gridTemplateColumns: '100px repeat(64, 30px)' } }
	let observe = null
	const matrix = { querySelector: () => table, querySelectorAll: () => labels }
	const tasks = []
	let next = { transport: 'prolink', prolinkConnected: true, racks: [{ id: 1, name: 'Very Long Vocal Name — ÄÖÜ 🎤', observed: true }] }
	const context = {
		document: { getElementById: () => matrix, querySelectorAll: () => [] },
		MutationObserver: class { observe(_target, options) { observe = options } },
		fetch: jest.fn(async () => ({ ok: true, json: async () => next })),
		setTimeout: fn => tasks.push(fn),
	}
	vm.runInNewContext(code, context)
	await new Promise(resolve => setImmediate(resolve))
	expect(table.style.gridTemplateColumns).toBe('max-content repeat(64, 30px)')
	expect(labels[0].textContent).toBe('Very Long Vocal Name — ÄÖÜ 🎤')
	expect(observe).toMatchObject({ childList: true })
	const first = table.style.gridTemplateColumns
	next = { transport: 'prolink', prolinkConnected: false, racks: [] }
	tasks.shift()()
	await new Promise(resolve => setImmediate(resolve))
	expect(labels[0].textContent).toBe('Rack 1')
	expect(table.style.gridTemplateColumns).toBe(first)
	expect(html).toMatch(/<base\s+href=["']\/patch\/["']\s*\/?\s*>/i)
	expect(html).toMatch(/<link\s+rel=["']stylesheet["']\s+href=["']patch-grid\.css["']\s*\/?\s*>/i)
	expect(new URL('patch-grid.css', 'http://localhost/patch/').pathname).toBe('/patch/patch-grid.css')
	expect(css).toContain('white-space: nowrap')
	expect(css).toContain('overflow: visible')
})
