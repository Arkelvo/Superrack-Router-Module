'use strict'

const { ProLinkTuneDiagnostics, detectTuneField, ROOTS, SCALES } = require('../lib/prolink-tune-diagnostics')
const { ProLinkControllerState } = require('../lib/prolink-controller-state')
const registerActions = require('../actions')

const PROPS = ['Scale Root', true, 0, 0, 11, '', 1, 0, false, 1, 'unverified auxiliary', 'C', 'B']

function fixture() {
	const values = {}
	let currentTime = 100_000
	const self = {
		config: { controlTransport: 'prolink' },
		_prolink: { state: 'connected' },
		_prolinkObservations: { controllerState: new ProLinkControllerState() },
		setVariableValues: jest.fn(v => Object.assign(values, v)),
		checkFeedbacks: jest.fn(),
		_log: jest.fn(),
		_sendProlink: jest.fn(),
		_controlFailure: jest.fn(() => false),
		runProlinkExtension: jest.fn(() => true),
		_buildRackChoices: () => [],
		_buildHotSnapshotChoices: () => [],
		_buildHotPluginChoices: () => [],
		setActionDefinitions: jest.fn(),
	}
	const diagnostic = new ProLinkTuneDiagnostics(self, () => currentTime)
	self._tuneDiagnostics = diagnostic
	const ctrl = self._prolinkObservations.controllerState
	const sendProperty = p => {
		const observation = ctrl.observeProperties(p)
		if (observation?.changed) diagnostic.observeProperties(ctrl)
	}
	const sendValue = (text, raw = 0) => {
		const observation = ctrl.observeValue([text, raw])
		if (observation?.changed) diagnostic.observeValue(ctrl)
	}
	return { self, diagnostic, values, ctrl, sendProperty, sendValue, advance: ms => { currentTime += ms } }
}

test('only exact parameter-name candidates; no guessed plugin IDs or note mapping', () => {
	expect(ROOTS).toHaveLength(12)
	expect(new Set(ROOTS.map(x => x.id)).size).toBe(12)
	expect(SCALES.map(x => x.id)).toEqual(['major', 'natural_minor'])
	expect(detectTuneField('Scale Root')).toBe('root')
	expect(detectTuneField(' scale-type ')).toBe('scale')
	expect(detectTuneField('Root')).toBeNull()
	expect(detectTuneField('Threshold')).toBeNull()
})

test('observations are read-only; manual captures are explicitly unverified', () => {
	const { self, diagnostic, values, sendProperty, sendValue } = fixture()
	diagnostic.reset('waiting_for_selection')
	sendProperty(PROPS)
	sendValue('C#', 999)
	expect(values.tune_controller_available).toBe(false)
	expect(values.tune_root).toBe('')
	expect(values.tune_debug_focused_kind).toBe('root')
	expect(values.tune_debug_focused_text).toBe('C#')
	expect(diagnostic.capture('root')).toBe(true)
	const evidence = JSON.parse(values.tune_debug_export_json)
	expect(evidence.root.unverified).toBe(true)
	expect(evidence.root.rawValue).toBe(999)
	expect(evidence.root.properties).toEqual(PROPS)
	expect(values.tune_root).toBe('')
	expect(values.tune_debug_root_candidate_text).toBe('C#')
	expect(self._sendProlink).not.toHaveBeenCalled()
})

test('capture denies missing value, wrong focus, stale and disconnected snapshots', () => {
	const { self, diagnostic, values, sendProperty, sendValue, advance } = fixture()
	sendProperty(PROPS)
	expect(diagnostic.capture('root')).toBe(false)
	sendValue('C', 4)
	expect(diagnostic.capture('scale')).toBe(false)
	advance(30_000)
	expect(diagnostic.capture('root')).toBe(false)
	sendValue('D', 5)
	expect(diagnostic.capture('root')).toBe(true)
	self._prolink.state = 'waiting'
	expect(diagnostic.capture('root')).toBe(false)
	diagnostic.reset('disconnected')
	expect(values.tune_debug_root_candidate_text).toBe('')
	expect(values.tune_debug_export_json).toBe('')
})

test('focus change invalidates the previous focused value and new value binds only to new context', () => {
	const { diagnostic, values, sendProperty, sendValue } = fixture()
	sendProperty(PROPS)
	sendValue('C', 0)
	sendProperty([...PROPS].map((x, i) => i === 0 ? 'Scale Type' : x))
	expect(values.tune_debug_focused_text).toBe('')
	expect(diagnostic.capture('scale')).toBe(false)
	sendValue('Major', 342)
	expect(diagnostic.capture('scale')).toBe(true)
	expect(values.tune_debug_scale_candidate_text).toBe('Major')
	expect(values.tune_scale).toBe('')
})

test('blocked set actions validate target and never send a ProLink write', async () => {
	const { self, diagnostic, values } = fixture()
	registerActions(self)
	const actions = self.setActionDefinitions.mock.calls[0][0]
	for (const id of ['tune_set_root', 'tune_set_scale', 'tune_set_key', 'tune_read_key', 'tune_capture_focus', 'tune_refresh_focus']) {
		expect(actions[id]).toBeDefined()
	}
	await actions.tune_set_root.callback({ options: { root: 'C#' } })
	await actions.tune_set_scale.callback({ options: { scale: 'major' } })
	await actions.tune_set_key.callback({ options: { root: 'D', scale: 'natural_minor' } })
	await actions.tune_read_key.callback({ options: {} })
	expect(values.tune_target_root).toBe('D')
	expect(values.tune_target_scale).toBe('natural_minor')
	expect(values.tune_root).toBeUndefined()
	expect(values.tune_status).toBe('blocked_unaddressable')
	expect(values.tune_last_error).toMatch(/address|focus/i)
	expect(diagnostic.requestWrite({ root: 'not a note' })).toBe(false)
	expect(diagnostic.requestWrite({ scale: 'unknown' })).toBe(false)
	expect(self._sendProlink).not.toHaveBeenCalled()
	expect(self.runProlinkExtension).not.toHaveBeenCalled()
	await actions.tune_refresh_focus.callback({ options: {} })
	expect(self.runProlinkExtension).toHaveBeenCalledWith('RequestControllerInfoUpdates', true)
})

test('diagnostics capture refuses non-Tune labels and never generates guessed commands', () => {
	const { self, diagnostic, sendProperty, sendValue } = fixture()
	sendProperty(['Threshold', ...PROPS.slice(1)])
	sendValue('-51', 154.666)
	expect(diagnostic.capture('root')).toBe(false)
	expect(diagnostic.capture('raw')).toBe(true)
	expect(self._sendProlink).not.toHaveBeenCalled()
})


test('failed capture exports a partial value even when properties are absent', () => {
	const { diagnostic, values, sendValue } = fixture()
	sendValue('Major', 2)
	expect(diagnostic.capture('raw')).toBe(false)
	const dump = JSON.parse(values.tune_debug_export_json)
	expect(dump.captureAttempt.result).toBe('incomplete')
	expect(dump.controller.properties).toBeNull()
	expect(dump.controller.value).toEqual(['Major', 2])
	expect(dump.controller.paired).toBe(false)
})

test('RX trace suppresses repeated periodic content but preserves changed payloads', () => {
	const { self, diagnostic, values, advance } = fixture()
	const first = { type: 8, payload: Buffer.from([1]) }
	const changed = { type: 8, payload: Buffer.from([2]) }
	expect(diagnostic.startTrace('root')).toBe(true)
	for (let i = 0; i < 250; i++) { diagnostic.observeFrame(first); advance(250) }
	diagnostic.observeFrame(changed)
	for (let i = 0; i < 250; i++) diagnostic.observeFrame(changed)
	diagnostic.observeFrame(first)
	expect(diagnostic.stopTrace()).toBe(true)
	const t = JSON.parse(values.tune_debug_export_json).trace
	expect(t.totalFrames).toBe(502)
	expect(t.events).toHaveLength(3)
	expect(t.firstEvents).toEqual(t.events)
	expect(t.suppressedDuplicates).toBe(499)
	expect(t.truncated).toBe(false)
	expect(t.droppedChanges).toBe(0)
	expect(self._sendProlink).not.toHaveBeenCalled()
})
