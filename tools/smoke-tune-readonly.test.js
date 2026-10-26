'use strict'

// Dependency-free safety smoke tests: node --test tools/smoke-tune-readonly.test.js
// Jest remains the canonical complete test suite (npm test), when dependencies exist.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ProLinkTuneDiagnostics, detectTuneField, ROOTS, SCALES } = require('../lib/prolink-tune-diagnostics')
const { ProLinkControllerState } = require('../lib/prolink-controller-state')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { decodeOsc } = require('../lib/prolink-osc')
const registerActions = require('../actions')

const propertiesPacket = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
const valuePacket = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'

function context() {
	const variables = {}
	const calls = []
	let now = 5000
	const self = {
		config: { controlTransport: 'prolink' },
		_prolink: { state: 'connected', send: (c, arg) => { calls.push([c, arg]); return calls.length }, onState() {} },
		_log() {}, setVariableValues: x => Object.assign(variables, x), checkFeedbacks() {}, updateActions() {},
		_controlFailure: () => false,
		_buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
		setActionDefinitions: x => { self.actions = x },
		_sendProlink: (...args) => calls.push(args),
	}
	self._prolinkObservations = new ProLinkObservations(self)
	self._tuneDiagnostics = new ProLinkTuneDiagnostics(self, () => now)
	const controller = self._prolinkObservations.controllerState
	function props(name) {
		const recorded = controller.observeProperties([name, true, 0, 0, 11, '', 1, 0, false, 1, 'unverified', 'C', 'B'])
		if (recorded?.changed) self._tuneDiagnostics.observeProperties(controller)
	}
	function value(label, v = 1) {
		const recorded = controller.observeValue([label, v])
		if (recorded?.changed) self._tuneDiagnostics.observeValue(controller)
	}
	return { self, variables, calls, props, value, advance: ms => { now += ms }, diagnostic: self._tuneDiagnostics }
}

test('validated real controller fixtures do not embed a plugin target', () => {
	const raw = decodeOsc(Buffer.from(propertiesPacket, 'hex'))
	assert.equal(raw.args.length, 13)
	assert.equal(raw.args[0], 'Threshold')
	assert.equal(raw.args[10], 'PSE')
	assert.equal(decodeOsc(Buffer.from(valuePacket, 'hex')).args[0], '-51')
	assert.equal(detectTuneField('Threshold'), null)
	assert.equal(detectTuneField('Scale Root'), 'root')
	assert.equal(ROOTS.length, 12)
	assert.equal(SCALES.length, 2)
})

test('manual root capture stays unverified; no remote change', () => {
	const c = context()
	c.diagnostic.reset()
	c.props('Scale Root')
	c.value('C#', 10000)
	assert.equal(c.diagnostic.capture('root'), true)
	assert.equal(c.variables.tune_root, '')
	assert.equal(c.variables.tune_controller_available, false)
	const evidence = JSON.parse(c.variables.tune_debug_export_json)
	assert.equal(evidence.root.text, 'C#')
	assert.equal(evidence.root.unverified, true)
	assert.equal(evidence.remoteParameterAddressingVerified, false)
	assert.deepEqual(c.calls, [])
	c.self._prolinkObservations.reset()
	assert.equal(c.variables.tune_debug_export_json, '')
})

test('stale, absent, wrong, and disconnected focus never capture as Tune', () => {
	const c = context()
	c.props('Scale Root')
	assert.equal(c.diagnostic.capture('root'), false)
	c.value('C', 4)
	assert.equal(c.diagnostic.capture('scale'), false)
	c.advance(16000)
	assert.equal(c.diagnostic.capture('root'), false)
	c.self._prolink.state = 'waiting'
	assert.equal(c.diagnostic.capture('raw'), false)
	assert.deepEqual(c.calls, [])
	c.self._prolinkObservations.reset()
})

test('focus change clears previous value before next valid notification', () => {
	const c = context()
	c.props('Scale Root')
	c.value('D', 4)
	c.props('Scale Type')
	assert.equal(c.variables.tune_debug_focused_text, '')
	assert.equal(c.diagnostic.capture('scale'), false)
	c.value('Major', 7)
	assert.equal(c.diagnostic.capture('scale'), true)
	assert.equal(c.variables.tune_scale, undefined)
	c.self._prolinkObservations.reset()
})

test('Tune request actions explicitly block writes and record requested target only', async () => {
	const c = context()
	c.diagnostic.reset()
	registerActions(c.self)
	assert.ok(c.self.actions.tune_set_root.name.includes('BLOCKED'))
	await c.self.actions.tune_set_root.callback({ options: { root: 'C#' } })
	await c.self.actions.tune_set_scale.callback({ options: { scale: 'major' } })
	await c.self.actions.tune_set_key.callback({ options: { root: 'D', scale: 'natural_minor' } })
	await c.self.actions.tune_read_key.callback({ options: {} })
	assert.deepEqual(c.calls, [])
	assert.equal(c.variables.tune_target_root, 'D')
	assert.equal(c.variables.tune_target_scale, 'natural_minor')
	assert.equal(c.variables.tune_status, 'blocked_unaddressable')
	assert.equal(c.variables.tune_root, '')
	assert.equal(c.variables.tune_scale, '')
	c.self._prolinkObservations.reset()
})

test('only explicitly selected existing subscription command can send', async () => {
	const c = context()
	registerActions(c.self)
	await c.self.actions.tune_refresh_focus.callback({ options: {} })
	assert.deepEqual(c.calls, [['RequestControllerInfoUpdates', true]])
	c.self._prolinkObservations.reset()
})


test('actual OSC frame reception flows through verified decoder and read-only diagnostic hook', () => {
	const c = context()
	c.self._prolinkObservations.receive({ type: 5, payload: Buffer.from(propertiesPacket, 'hex') })
	c.self._prolinkObservations.receive({ type: 5, payload: Buffer.from(valuePacket, 'hex') })
	assert.equal(c.variables.prolink_controller_name, 'Threshold')
	assert.equal(c.variables.tune_debug_focused_name, 'Threshold')
	assert.equal(c.variables.tune_debug_focused_text, '-51')
	assert.equal(c.diagnostic.capture('root'), false)
	assert.equal(c.diagnostic.capture('raw'), true)
	const evidence = JSON.parse(c.variables.tune_debug_export_json)
	assert.equal(evidence.lastCapture.properties[10], 'PSE')
	assert.equal(evidence.root, null)
	assert.deepEqual(c.calls, [])
	c.self._prolinkObservations.reset()
})


test('Companion UI publishes status + diagnostic only; no pretending root presets are operational', async () => {
	const Module = require('module')
	const originalLoad = Module._load
	let feedbacks, presets
	try {
		Module._load = function (request, parent, isMain) {
			if (request === '@companion-module/base') return { combineRgb: (r, g, b) => (r << 16) | (g << 8) | b }
			return originalLoad.call(this, request, parent, isMain)
		}
		feedbacks = require('../feedbacks')
		presets = require('../presets')
	} finally { Module._load = originalLoad }
	const c = context()
	c.self.label = 'superrack-test'
	c.diagnostic.reset()
	c.self.setFeedbackDefinitions = definitions => { c.feedbacks = definitions }
	c.self.setPresetDefinitions = definitions => { c.presets = definitions }
	c.self.setVariableDefinitions = definitions => { c.variableDefinitions = definitions }
	await feedbacks(c.self)
	presets(c.self)
	require('../variables')(c.self)
	const ids = c.variableDefinitions.map(x => x.variableId)
	assert.equal(ids.length, new Set(ids).size)
	assert.ok(ids.includes('tune_debug_export_json'))
	assert.ok(ids.includes('tune_controller_available'))
	assert.equal(c.feedbacks.tune_blocked.callback(), true)
	assert.equal(c.feedbacks.tune_diagnostic_candidate.callback(), false)
	assert.equal(c.presets.tune_diagnostics.steps[0].down[0].actionId, 'tune_capture_focus')
	assert.equal(c.presets.tune_diagnostics.style.text.includes('TUNE DIAG'), true)
	assert.equal(Object.keys(c.presets).filter(x => x.startsWith('tune_')).length, 47) // 44 scales + status + diagnostics + V9 Root capability
	assert.equal(Object.keys(c.presets).filter(x => x.startsWith('tune_scale_')).length, 45) // 44 scales + status
	assert.equal(c.presets.tune_diagnostics.steps[0].down[0].actionId, 'tune_capture_focus')
	assert.equal(c.presets.tune_scale_major.steps[0].down[0].actionId, 'tune_set_scale')
	c.self._prolinkObservations.reset()
})


test('failed manual capture exports partial value, despite missing controller properties', () => {
	const c = context()
	c.diagnostic.reset()
	c.value('Natural Minor', 3)
	assert.equal(c.diagnostic.capture('raw'), false)
	const evidence = JSON.parse(c.variables.tune_debug_export_json)
	assert.equal(evidence.captureAttempt.result, 'incomplete')
	assert.deepEqual(evidence.controller.value, ['Natural Minor', 3])
	assert.equal(evidence.controller.properties, null)
	assert.equal(evidence.controller.paired, false)
	assert.deepEqual(c.calls, [])
})

test('read-only RX trace logs actual incoming frames and yields export without controller properties', async () => {
	const c = context()
	registerActions(c.self)
	await c.self.actions.tune_trace_start.callback({ options: { label: 'root' } })
	assert.equal(JSON.parse(c.variables.tune_debug_export_json).trace.active, true)
	// Several inbound messages: no key data may appear at all.
	const frame = { type: 5, payload: Buffer.from(valuePacket, 'hex') }
	c.self._prolinkObservations.receive(frame)
	for (let i = 0; i < 4; i++) c.self._prolinkObservations.receive({ type: 8, payload: Buffer.from([i]) })
	await c.self.actions.tune_trace_stop.callback({ options: {} })
	const evidence = JSON.parse(c.variables.tune_debug_export_json)
	assert.equal(evidence.trace.active, false)
	assert.equal(evidence.trace.label, 'root')
	assert.equal(evidence.trace.totalFrames, 5)
	assert.equal(evidence.trace.events[0].path, '/waves.com/remote/NotifyControllerValue')
	assert.deepEqual(evidence.trace.events[0].args, ['-51', 154.66666666666669])
	assert.equal(evidence.controller.properties, null)
	assert.equal(evidence.controller.paired, false)
	assert.deepEqual(c.calls, [])
})

test('trace remains bounded with ongoing monitoring and clears on reconnect/reset', () => {
	const c = context()
	assert.equal(c.diagnostic.startTrace('scale'), true)
	for (let i = 0; i < 140; i++) c.self._prolinkObservations.receive({ type: 8, payload: Buffer.from([i]) })
	assert.equal(c.diagnostic.stopTrace(), true)
	const evidence = JSON.parse(c.variables.tune_debug_export_json)
	assert.equal(evidence.trace.totalFrames, 140)
	assert.equal(evidence.trace.events.length, 48)
	assert.equal(evidence.trace.truncated, true)
	assert.equal(evidence.trace.countByPath['frame-type-8'], 140)
	c.self._prolinkObservations.reset()
	assert.equal(c.variables.tune_debug_export_json, '')
	assert.deepEqual(c.calls, [])
})

test('periodic identical controller packets cannot overwrite the initial trace evidence', () => {
	const c = context()
	assert.equal(c.diagnostic.startTrace('root'), true)
	const p = { type: 5, payload: Buffer.from(propertiesPacket, 'hex') }
	const v = { type: 5, payload: Buffer.from(valuePacket, 'hex') }
	for (let i = 0; i < 250; i++) {
		c.self._prolinkObservations.receive(p)
		c.self._prolinkObservations.receive(v)
		c.advance(250)
	}
	assert.equal(c.diagnostic.stopTrace(), true)
	const t = JSON.parse(c.variables.tune_debug_export_json).trace
	assert.equal(t.totalFrames, 500)
	assert.equal(t.suppressedDuplicates, 498)
	assert.equal(t.events.length, 2)
	assert.equal(t.truncated, false)
	assert.deepEqual(t.firstEvents, t.events)
	assert.equal(t.events[0].path, '/waves.com/remote/NotifyControllerProperties')
	assert.equal(t.events[1].path, '/waves.com/remote/NotifyControllerValue')
	assert.equal(t.events[1].args[0], '-51')
	assert.deepEqual(c.calls, [])
})

test('changed payloads are retained despite thousands of identical frames; no guessed commands', () => {
	const c = context()
	assert.equal(c.diagnostic.startTrace('root'), true)
	const send = n => c.self._prolinkObservations.receive({ type: 8, payload: Buffer.from([n]) })
	for (let i = 0; i < 1000; i++) send(1)
	send(2)
	for (let i = 0; i < 1000; i++) send(2)
	send(1)
	assert.equal(c.diagnostic.stopTrace(), true)
	const t = JSON.parse(c.variables.tune_debug_export_json).trace
	assert.equal(t.totalFrames, 2002)
	assert.equal(t.suppressedDuplicates, 1999)
	assert.equal(t.events.length, 3)
	assert.equal(t.events[0].ms, 0)
	assert.equal(t.truncated, false)
	assert.equal(t.droppedChanges, 0)
	assert.equal(t.countByPath['frame-type-8'], 2002)
	assert.deepEqual(c.calls, [])
})

test('complete frame hash detects changes beyond previewed first two arguments', () => {
	const c = context()
	c.diagnostic.startTrace('root')
	const path = '/waves.com/remote/OtherNotification'
	const a = { path, args: [2, true, 'alpha'] }
	const b = { path, args: [2, true, 'beta'] }
	c.diagnostic.observeFrame({ type: 5, payload: Buffer.from('first') }, a)
	c.diagnostic.observeFrame({ type: 5, payload: Buffer.from('second') }, b)
	c.diagnostic.observeFrame({ type: 5, payload: Buffer.from('second') }, b)
	c.diagnostic.stopTrace()
	const t = JSON.parse(c.variables.tune_debug_export_json).trace
	assert.equal(t.events.length, 2)
	assert.deepEqual(t.events[0].args, [2, true])
	assert.deepEqual(t.events[1].args, [2, true])
	assert.notEqual(t.events[0].fingerprint, t.events[1].fingerprint)
	assert.equal(t.suppressedDuplicates, 1)
})
