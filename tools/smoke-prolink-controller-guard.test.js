'use strict'

// Dependency-free regression tests. Run with:
//   node --test tools/smoke-prolink-controller-guard.test.js
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { characterizeFocusedController, evaluateFocusedControllerWrite } = require('../lib/prolink-controller-capabilities')
const registerActions = require('../actions')

const speed = ['Speed', true, 0, 0.1, 800, 'ms', 0.001, 0, false, 1, 'Tune RT', '0.1', '800.0']
const transition = ['Note Transition', true, 0, 0.1, 800, 'ms', 0.001, 0, false, 1, 'Tune RT', '0.1', '800.0']
const scale = ['Scale Type', false, 44, 0, 32, '', 0.001, 0, false, 1, 'Tune RT', 'User Scale', 'Asavari (Carnatic)']
const analog = ['Analog', false, 3, 0, 1, '', 0.001, 0, false, 1, 'CLA-76', '50Hz', 'Off']

function setup() {
	const variables = {}, calls = [], failures = [], logEvents = []
	const self = {
		config: { controlTransport: 'prolink' },
		_prolink: { state: 'connected', onState() {} }, _prolinkReady: true,
		setVariableValues: v => Object.assign(variables, v),
		checkFeedbacks() {}, updateActions() {}, _log: (...args) => logEvents.push(args),
		_controlFailure: (message, options) => { failures.push({ message, options }); return false },
		_sendProlink: (name, delta) => { calls.push([name, delta]); return true },
		_buildRackChoices: () => [], _buildHotPluginChoices: () => [], _buildHotSnapshotChoices: () => [],
		setActionDefinitions: a => { self.actions = a },
	}
	self._prolinkObservations = new ProLinkObservations(self)
	registerActions(self)
	const obs = self._prolinkObservations
	return { self, obs, variables, calls, failures, logEvents, select: (properties, text, raw) => {
		obs.observeControllerProperties(properties)
		obs.observeControllerValue([text, raw])
	} }
}

test('two live discrete controller shapes are read-only for ChangeControllerValue', () => {
	for (const [props, text, raw, count] of [[scale, 'Major', 2, 44], [analog, '60Hz', 2, 3]]) {
		const c = setup()
		c.select(props, text, raw)
		assert.equal(c.variables.prolink_controller_kind_candidate, 'discrete_candidate')
		assert.equal(c.variables.prolink_controller_discrete_count_candidate, count)
		assert.equal(c.self.changeFocusedProlinkController(1, 8), false)
		assert.equal(c.variables.prolink_controller_write_status, 'blocked_discrete')
		assert.deepEqual(c.calls, [])
		assert.equal(JSON.parse(c.variables.prolink_controller_capability_json).remoteParameterAddressingVerified, false)
		c.obs.reset()
	}
})

test('continuous candidates preserve rapid signed relative encoder actions', () => {
	for (const prop of [speed, transition]) {
		const c = setup()
		c.select(prop, '20.0', 20)
		assert.equal(c.self.changeFocusedProlinkController(-1, 4), true)
		assert.deepEqual(c.calls, [['ChangeControllerValue', -4]])
		assert.equal(c.variables.prolink_controller_write_status, 'awaiting_change')
		assert.equal(c.self.changeFocusedProlinkController(1, 1), true)
		assert.equal(c.variables.prolink_controller_write_status, 'awaiting_change')
		assert.equal(c.calls.length, 2)
		c.obs.observeControllerValue(['21.0', 21])
		assert.equal(c.variables.prolink_controller_write_status, 'observed_after_send')
		c.obs.reset()
	}
})

test('duplicated notifications refresh observation freshness without inventing a changed value', () => {
	const c = setup()
	c.select(speed, '20.0', 20)
	const originalVersion = c.obs.controllerState.contextVersion
	c.obs.controllerState.properties.lastSeenAtMs -= 10000
	c.obs.controllerState.value.lastSeenAtMs -= 10000
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.variables.prolink_controller_write_status, 'blocked_stale')
	c.obs.observeControllerProperties(speed)
	c.obs.observeControllerValue(['20.0', 20])
	assert.equal(c.obs.controllerState.contextVersion, originalVersion)
	assert.equal(c.variables.prolink_controller_value, 20)
	assert.equal(c.self.changeFocusedProlinkController(1, 1), true)
	c.obs.reset()
})

test('disconnected and missing focus are blocked, no optimistic success', () => {
	const c = setup()
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.variables.prolink_controller_write_status, 'blocked_missing_data')
	c.select(speed, '20', 20)
	c.self._prolink.state = 'waiting'
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.variables.prolink_controller_write_status, 'blocked_disconnected')
	assert.deepEqual(c.calls, [])
	c.obs.reset()
	assert.equal(c.variables.prolink_controller_capability_json, '')
})

test('unknown property signature and stale value on focus change do not permit writing', () => {
	const c = setup()
	c.select(['Mystery', true, 7, 0, 1, '', .001, 0, false, 1, 'M', 'A', 'B'], '0', 0)
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.variables.prolink_controller_write_status, 'blocked_unknown')
	c.obs.observeControllerProperties(speed)
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.variables.prolink_controller_write_status, 'blocked_missing_data')
	assert.deepEqual(c.calls, [])
	c.obs.reset()
})

test('read-only inspection exports source fields without sending ProLink commands', async () => {
	const c = setup()
	c.select(analog, '60Hz', 2)
	assert.equal(await c.self.actions.prolink_controller_inspect.callback(), true)
	const evidence = JSON.parse(c.variables.prolink_controller_capability_json)
	assert.equal(evidence.kind, 'discrete_candidate')
	assert.equal(evidence.propertiesField2, 3)
	assert.equal(evidence.absoluteDiscreteWriteVerified, false)
	assert.deepEqual(c.calls, [])
	c.obs.reset()
})

test('classification never interprets field 2 as parameter address or proves absolute writes', () => {
	assert.equal(characterizeFocusedController({ values: scale }).discreteCountCandidate, 44)
	assert.equal(characterizeFocusedController({ values: analog }).discreteCountCandidate, 3)
	assert.equal(characterizeFocusedController({ values: speed }).kind, 'relative_candidate')
	assert.equal(characterizeFocusedController(null).kind, 'unknown')
	const result = evaluateFocusedControllerWrite({ connected: true, controller: {
		properties: { values: scale, lastSeenAtMs: Date.now() },
		value: { values: ['Major', 2], lastSeenAtMs: Date.now() },
	} })
	assert.equal(result.allowed, false)
	assert.equal(result.remoteParameterAddressingVerified, false)
})


test('value-before-properties never becomes a falsely paired controller state', () => {
	const c = setup()
	c.obs.observeControllerValue(['old selection', 7])
	assert.equal(c.obs.controllerState.value.values[1], 7)
	c.obs.observeControllerProperties(speed)
	assert.equal(c.obs.controllerState.value, null)
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.variables.prolink_controller_write_status, 'blocked_missing_data')
	assert.deepEqual(c.calls, [])
	c.obs.reset()
})

test('repeated discrete blocks are logged once per context/window but all attempts are blocked', () => {
	const c = setup()
	c.select(scale, 'Major', 2)
	for (let i = 0; i < 5; i++) {
		assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	}
	assert.equal(c.calls.length, 0)
	assert.equal(c.failures.length, 5)
	assert.ok(c.failures.every(item => item.options?.suppressLog === true))
	assert.equal(c.logEvents.filter(item => item[1] === '[PROLINK_CONTROLLER_WRITE_BLOCKED]').length, 1)
	assert.equal(c.self._prolinkWriteBlockLog.suppressed, 4)
	c.self._prolinkWriteBlockLog.atMs -= 11_000
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.logEvents.filter(item => item[1] === '[PROLINK_CONTROLLER_WRITE_BLOCKED]').length, 2)
	assert.equal(c.logEvents.at(-1)[2].suppressedRepeatCount, 4)
	c.select(analog, '60Hz', 2)
	assert.equal(c.self.changeFocusedProlinkController(1, 1), false)
	assert.equal(c.logEvents.filter(item => item[1] === '[PROLINK_CONTROLLER_WRITE_BLOCKED]').length, 3)
	assert.deepEqual(c.calls, [])
	c.obs.reset()
})
