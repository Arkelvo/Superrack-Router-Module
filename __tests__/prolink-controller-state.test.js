const { ProLinkControllerState, classifyControllerType } = require('../lib/prolink-controller-state')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { decodeOsc } = require('../lib/prolink-osc')

// Exact raw OSC payloads from the user's SuperRack Performer live capture.
const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'
const PROPERTIES_FRAME = { type: 5, payload: Buffer.from(PROPERTIES_HEX, 'hex') }
const VALUE_FRAME = { type: 5, payload: Buffer.from(VALUE_HEX, 'hex') }

function createObserver() {
	const values = {}
	const self = {
		_log: jest.fn(),
		setVariableValues: jest.fn(next => Object.assign(values, next)),
		checkFeedbacks: jest.fn(),
		updateActions: jest.fn(),
	}
	return { obs: new ProLinkObservations(self), self, values }
}

test('live OSC packets decode exactly, including 64-bit floating point', () => {
	expect(decodeOsc(PROPERTIES_FRAME.payload)).toEqual({
		path: '/waves.com/remote/NotifyControllerProperties',
		args: ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0'],
	})
	expect(decodeOsc(VALUE_FRAME.payload)).toEqual({
		path: '/waves.com/remote/NotifyControllerValue',
		args: ['-51', 154.66666666666669],
	})
})

test('properties and value expose only grounded fields and preserve raw double', () => {
	const { obs, values } = createObserver()
	obs.receive(PROPERTIES_FRAME)
	expect(values.prolink_controller_properties_known).toBe(true)
	expect(values.prolink_controller_name).toBe('Threshold')
	expect(values.prolink_controller_unit).toBe('dB')
	expect(values.prolink_controller_bounds_a_raw).toBe(-60)
	expect(values.prolink_controller_bounds_b_raw).toBe(0)
	expect(values.prolink_controller_aux_text_raw).toBe('PSE')
	expect(JSON.parse(values.prolink_controller_properties)).toHaveLength(13)
	obs.receive(VALUE_FRAME)
	expect(values.prolink_controller_known).toBe(true)
	expect(values.prolink_controller_text).toBe('-51')
	expect(values.prolink_controller_value).toBe(154.66666666666669)
	expect(values.prolink_controller_value).not.toBe(-51)
})

test('unchanged notifications do not cause repeated Companion variable writes', () => {
	const { obs, self } = createObserver()
	obs.receive(PROPERTIES_FRAME)
	obs.receive(VALUE_FRAME)
	const calls = self.setVariableValues.mock.calls.length
	for (let i = 0; i < 20; i++) {
		obs.receive(PROPERTIES_FRAME)
		obs.receive(VALUE_FRAME)
	}
	expect(self.setVariableValues).toHaveBeenCalledTimes(calls)
})

test('property change invalidates stale value and disconnect clears everything', () => {
	const { obs, values } = createObserver()
	obs.receive(PROPERTIES_FRAME)
	obs.receive(VALUE_FRAME)
	const updated = [...decodeOsc(PROPERTIES_FRAME.payload).args]
	updated[0] = 'Attack'
	const change = obs.controllerState.observeProperties(updated)
	expect(change.changed).toBe(true)
	expect(change.values.prolink_controller_known).toBe(false)
	expect(change.values.prolink_controller_text).toBe('')
	obs.receive(PROPERTIES_FRAME) // same as original should cause a context change
	expect(obs.controllerState.value).toBe(null)
	obs.reset()
	expect(values.prolink_controller_properties_known).toBe(false)
	expect(values.prolink_controller_known).toBe(false)
	expect(values.prolink_controller_name).toBe('')
	expect(values.prolink_controller_value).toBe('')
	expect(values.prolink_controller_context_version).toBe(0)
})

test('invalid property shapes and nonfinite values are rejected', () => {
	const state = new ProLinkControllerState()
	expect(state.observeProperties(['Threshold'])).toBe(null)
	expect(state.observeValue(['-51', Infinity])).toBe(null)
	expect(state.hasData()).toBe(false)
})

test('debug log is emitted only for changes when legacy parser is muted for these notifications', () => {
	const { obs, self } = createObserver()
	obs.receive(PROPERTIES_FRAME)
	obs.receive(VALUE_FRAME)
	obs.receive(PROPERTIES_FRAME)
	obs.receive(VALUE_FRAME)
	const messages = self._log.mock.calls.map(call => call[1])
	expect(messages).toEqual(['[PROLINK_CONTROLLER_PROPERTIES_CHANGED]', '[PROLINK_CONTROLLER_VALUE_CHANGED]'])
})

test('classifyControllerType detects discrete from 0/1 bounds', () => {
	// Threshold with 0..1 bounds -> discrete
	const props = ['Threshold', true, 0, 0, 1, 'dB', 0.001, 0, false, 1, 'PSE', '0', '1']
	expect(classifyControllerType(props)).toBe('discrete')

	// Reverse order bounds 1..0 -> discrete
	const props2 = ['Bypass', true, 0, 1, 0, 'bool', 0, 0, false, 1, '', '1', '0']
	expect(classifyControllerType(props2)).toBe('discrete')
})

test('classifyControllerType detects continuous from range > 1', () => {
	// Threshold with -60..0 dB -> continuous
	const props = ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']
	expect(classifyControllerType(props)).toBe('continuous')

	// Frequency with 20..20000 Hz -> continuous
	const props2 = ['Freq', true, 0, 20, 20000, 'Hz', 1, 100, false, 1, 'EQ', '20', '20000']
	expect(classifyControllerType(props2)).toBe('continuous')

	// Gain with -24..24 dB -> continuous
	const props3 = ['Gain', true, 0, -24, 24, 'dB', 0.1, 0, false, 1, 'Comp', '-24', '24']
	expect(classifyControllerType(props3)).toBe('continuous')
})

test('classifyControllerType uses unit heuristics', () => {
	// Explicit discrete units
	expect(classifyControllerType(['A', true, 0, 0, 1, 'bool', 0, 0, false, 1, '', '0', '1'])).toBe('discrete')
	expect(classifyControllerType(['B', true, 0, 0, 1, 'boolean', 0, 0, false, 1, '', '0', '1'])).toBe('discrete')
	expect(classifyControllerType(['C', true, 0, 0, 1, 'on/off', 0, 0, false, 1, '', '0', '1'])).toBe('discrete')
	expect(classifyControllerType(['D', true, 0, 0, 1, 'switch', 0, 0, false, 1, '', '0', '1'])).toBe('discrete')
	expect(classifyControllerType(['E', true, 0, 0, 1, 'toggle', 0, 0, false, 1, '', '0', '1'])).toBe('discrete')

	// Continuous units with bounds that are NOT 0..1
	expect(classifyControllerType(['A', true, 0, -60, 0, 'dB', 0, 0, false, 1, '', '-60', '0'])).toBe('continuous')
	expect(classifyControllerType(['B', true, 0, 20, 20000, 'Hz', 0, 0, false, 1, '', '20', '20000'])).toBe('continuous')
	expect(classifyControllerType(['C', true, 0, 0, 1000, 'ms', 0, 0, false, 1, '', '0', '1000'])).toBe('continuous')
	expect(classifyControllerType(['D', true, 0, 0, 100, '%', 0, 0, false, 1, '', '0', '100'])).toBe('continuous')
})

test('classifyControllerType returns unknown when indeterminate', () => {
	// No clear bounds or unit (bounds 0..0.5, empty unit)
	expect(classifyControllerType(['A', true, 0, 0, 0.5, '', 0, 0, false, 1, '', '0', '0.5'])).toBe('unknown')
	
	// Bounds 10..20 with custom unit -> range > 1 so continuous
	expect(classifyControllerType(['B', true, 0, 10, 20, 'custom', 0, 0, false, 1, '', '10', '20'])).toBe('continuous')
	
	// Null input
	expect(classifyControllerType(null)).toBe('unknown')
})

test('ProLinkControllerState exposes controller type in reset and observe', () => {
	const state = new ProLinkControllerState()
	const resetVars = state.reset()
	expect(resetVars.prolink_controller_type).toBe('unknown')

	// Observe discrete properties (0..1 bounds)
	const discreteProps = ['Bypass', true, 0, 0, 1, 'bool', 0, 0, false, 1, '', '0', '1']
	const result = state.observeProperties(discreteProps)
	expect(result.values.prolink_controller_type).toBe('discrete')
	expect(state.controllerType).toBe('discrete')

	// Observe continuous properties (-60..0 dB)
	const continuousProps = ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']
	const result2 = state.observeProperties(continuousProps)
	expect(result2.values.prolink_controller_type).toBe('continuous')
	expect(state.controllerType).toBe('continuous')
})

test('controller type resets on property change and invalidates value', () => {
	const state = new ProLinkControllerState()
	const discreteProps = ['Bypass', true, 0, 0, 1, 'bool', 0, 0, false, 1, '', '0', '1']
	state.observeProperties(discreteProps)
	expect(state.controllerType).toBe('discrete')

	// Change to continuous properties
	const continuousProps = ['Threshold', true, 0, -60, 0, 'dB', 0.001, 0, false, 1, 'PSE', '-60', '0']
	const result = state.observeProperties(continuousProps)
	expect(result.values.prolink_controller_type).toBe('continuous')
	expect(state.controllerType).toBe('continuous')
	expect(state.value).toBe(null) // value invalidated
})
