'use strict'

const request = require('supertest')
const { getPatchUiState } = require('../lib/patch-ui-state')
const { startHttpServer, stopHttpServer } = require('../ui/http')

function mockInstance(transport = 'prolink') {
	const observations = { racks: new Map([
		[1, { name: 'Voc Hannah' }],
		[2, { name: 'Keys' }],
		[3, { name: '' }],
	]) }
	return {
		state: { sequenceRunning: false, activeSourceIndex: null },
		config: { controlTransport: transport, racks: [null, { id: 1, value: 3 }], hotPlugin: {}, hotSnapshot: {} },
		rackCount: 64,
		channelCount: 64,
		emptyMapping: [],
		hotPlugin: { emptyMapping: [], mapping: [null, { id: 1, value: 7 }], type: 'cc', channel: 1 },
		hotSnapshot: { emptyMapping: [], mapping: [null, { id: 1, value: 8 }], type: 'cc', channel: 2 },
		_prolink: { state: 'connected' },
		_prolinkObservations: observations,
		_http: { port: 0, server: null, started: false },
		_log: jest.fn(), saveConfig: jest.fn(), _applyConfigToLocalScopes: jest.fn(),
		updateActions: jest.fn(), updateFeedbacks: jest.fn(), updateVariableDefinitions: jest.fn(),
	}
}

describe('Patch UI observed rack names and transport behavior', () => {
	test('only current connected ProLink state exposes names; empty names fall back', () => {
		const self = mockInstance()
		const live = getPatchUiState(self)
		expect(live).toMatchObject({ transport: 'prolink', prolinkConnected: true })
		expect(live.racks[0]).toEqual({ id: 1, name: 'Voc Hannah', observed: true })
		expect(live.racks[1].name).toBe('Keys')
		expect(live.racks[2]).toEqual({ id: 3, name: 'Rack 3', observed: false })
		expect(live.racks).toHaveLength(64)
		self._prolink.state = 'waiting'
		expect(getPatchUiState(self).racks[0].name).toBe('Rack 1')
		self._prolink.state = 'connected'
		self.config.controlTransport = 'midi'
		expect(getPatchUiState(self).racks[0].name).toBe('Rack 1')
		expect(getPatchUiState(self).transport).toBe('midi')
	})

	let self
	beforeEach(async () => {
		self = mockInstance()
		await startHttpServer(self)
		expect(self._http.started).toBe(true)
	})
	afterEach(async () => { await stopHttpServer(self) })

	test('root permanently stays a temporary 307 redirect; patch and assets work', async () => {
		const app = self._http.server.server
		const home = await request(app).get('/').redirects(0)
		expect(home.status).toBe(307)
		expect(home.headers.location).toBe('/patch')
		expect((await request(app).get('/patch')).status).toBe(200)
		expect((await request(app).get('/patch/')).status).toBe(200)
		expect((await request(app).get('/patch/patch-state.js')).status).toBe(200)
		expect((await request(app).get('/patch/mappings')).status).toBe(200)
		expect((await request(app).get('/health')).status).toBe(200)
	})

	test('new names and disconnect propagate through API without changing mappings', async () => {
		const app = self._http.server.server
		const before = await request(app).get('/patch/state')
		expect(before.status).toBe(200)
		expect(before.headers['cache-control']).toBe('no-store')
		expect(before.body.racks[0].name).toBe('Voc Hannah')
		self._prolinkObservations.racks.get(1).name = 'Lead Vocal'
		expect((await request(app).get('/patch/state')).body.racks[0].name).toBe('Lead Vocal')
		self._prolink.state = 'waiting'
		const after = await request(app).get('/patch/state')
		expect(after.body.racks[0].name).toBe('Rack 1')
		expect(after.body.prolinkConnected).toBe(false)
		expect(self.config.racks[1].value).toBe(3)
	})

	test('MIDI-only editor pages and writes are inaccessible in ProLink mode; mappings remain saved', async () => {
		const app = self._http.server.server
		expect((await request(app).get('/midi/plugin')).status).toBe(404)
		expect((await request(app).get('/midi/snapshot')).status).toBe(404)
		expect((await request(app).get('/midi/plugin/mapping')).status).toBe(200)
		expect((await request(app).get('/midi/snapshot/mapping')).status).toBe(200)
		expect(self.hotPlugin.mapping[1].value).toBe(7)
		expect(self.hotSnapshot.mapping[1].value).toBe(8)
		expect(self.saveConfig).not.toHaveBeenCalled()
		self.config.controlTransport = 'midi'
		expect((await request(app).get('/midi/plugin')).status).toBe(200)
		expect((await request(app).get('/midi/snapshot')).status).toBe(200)
		expect((await request(app).get('/patch/state')).body.transport).toBe('midi')
		expect((await request(app).get('/patch/state')).body.racks[0].name).toBe('Rack 1')
	})
})
