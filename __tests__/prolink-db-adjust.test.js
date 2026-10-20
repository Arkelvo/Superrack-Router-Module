'use strict'
const { ProLinkObservations } = require('../lib/prolink-observations')
const { decodeOsc } = require('../lib/prolink-osc')
const { confirmedPseThreshold, selectMagnitude, DB_PER_RAW } = require('../lib/prolink-db-adjust')

const PROPERTIES_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657250726f70657274696573000000002c7354696464736464466973737300005468726573686f6c6400000000000000c04e0000000000000000000000000000644200003f50624dd2f1a9fc000000000000000000000001505345002d36300030000000'
const VALUE_HEX = '2f77617665732e636f6d2f72656d6f74652f4e6f74696679436f6e74726f6c6c657256616c7565002c7364002d3531004063555555555556'
const propsArgs = decodeOsc(Buffer.from(PROPERTIES_HEX,'hex')).args
const valArgs = decodeOsc(Buffer.from(VALUE_HEX,'hex')).args

function make() {
	const values = {}, sent = []
	const self = {
		_log: () => {},
		setVariableValues: obj => Object.assign(values, obj),
		checkFeedbacks: () => {}, updateActions: () => {},
		_controlFailure: message => { self.lastError = message; return false },
		_sendProlink: (cmd, delta) => { sent.push({ cmd, delta }); return true },
	}
	const obs = new ProLinkObservations(self)
	self._prolinkObservations = obs
	obs.observeControllerProperties([...propsArgs])
	obs.observeControllerValue([...valArgs])
	return { values, sent, self, obs, controller: obs.dbAdjust }
}
function rawValue(obs, raw, display = '-51') {
	obs.observeControllerValue([display, raw])
}
async function flush() {
	await new Promise(resolve => setImmediate(resolve))
}
async function drain(test, startRaw) {
	let last = startRaw
	for (let n = 0; n < 10; n++) {
		await flush()
		const job = test.controller.active
		if (!job) break
		if (!job.waiting) continue
		const next = job.waiting.fromRaw + job.waiting.expected
		if (Math.abs(next - last) < 1e-7) throw new Error('Did not advance')
		rawValue(test.obs, next, '-51') // display intentionally unchanged
		last = next
	}
	await flush()
	if (test.controller.active) throw new Error('Did not finish within 10 increments')
	return last
}

describe('PSE Threshold dB-adjusted ProLink actions', () => {
	test('recognizes only the measured PSE Threshold and conservative raw domain', () => {
		const t = make()
		expect(confirmedPseThreshold(t.obs.controllerState)).toBe(true)
		expect(selectMagnitude(50)).toBe(7)
		expect(DB_PER_RAW).toBe(0.06)
		t.obs.observeControllerProperties(['Attack', ...propsArgs.slice(1)])
		expect(confirmedPseThreshold(t.obs.controllerState)).toBe(false)
		expect(t.controller.request(1, '1')).toBe(false)
	})
	test('offers 0.1, 0.5, 1 and 3 dB via expected magnitudes and raw readback', async () => {
		const cases = [
			['0.1', [1,1], 2], ['0.5', [2,2], 8],
			['1', [4,1], 17], ['3', [7,1], 50],
		]
		for (const [step, expected, rawDelta] of cases) {
			const t = make()
			expect(t.controller.request(1, step)).toBe(true)
			const end = await drain(t, valArgs[1])
			expect(t.sent.map(p=>p.delta)).toEqual(expected)
			expect(end - valArgs[1]).toBeCloseTo(rawDelta, 10)
			expect(t.values.prolink_db_status).toBe('observed_after_send')
			t.obs.reset()
		}
	})
	test('repeated 0.1 dB presses compensate rounding instead of accumulating +0.12 every time', async () => {
		const t=make()
		let raw=valArgs[1]
		for (let i=0; i<10; i++) {
			expect(t.controller.request(1,'0.1')).toBe(true)
			raw=await drain(t,raw)
		}
		expect(raw - valArgs[1]).toBeCloseTo(17,9)
		expect((raw - valArgs[1])*DB_PER_RAW).toBeCloseTo(1.02,9)
		expect(t.values.prolink_db_residual_raw).toBeCloseTo(-1/3,5)
		t.obs.reset()
	})
	test('negative direction, short burst of clicks and serialized readbacks', async () => {
		const t = make()
		expect(t.controller.request(-1, '0.5')).toBe(true)
		expect(t.controller.request(-1, '0.5')).toBe(true)
		expect(t.values.prolink_db_queue_length).toBe(1)
		let raw=valArgs[1]
		raw=await drain(t,raw)
		// Scheduled next job might start between drain calls.
		raw=await drain(t,raw)
		expect(raw - valArgs[1]).toBeCloseTo(-17,9)
		expect(t.sent.every(p => p.delta < 0)).toBe(true)
		t.obs.reset()
	})
	test('rejects unsupported dB steps, missing selection and values beyond bounds', () => {
		const t=make()
		expect(t.controller.request(1, '0.2')).toBe(false)
		expect(t.controller.request(0,'1')).toBe(false)
		rawValue(t.obs, 999, '0')
		expect(t.controller.request(1, '1')).toBe(true)
		expect(t.sent).toHaveLength(0)
		expect(t.values.prolink_db_status).toBe('out_of_range')
		t.obs.reset()
	})
	test('focus switch aborts pending writes and discards queued presses', async () => {
		const t=make()
		t.controller.request(1,'3')
		t.controller.request(1,'0.1')
		expect(t.sent).toHaveLength(1)
		t.obs.observeControllerProperties(['Attack', ...propsArgs.slice(1)])
		expect(t.values.prolink_db_status).toBe('context_changed')
		await flush()
		expect(t.sent).toHaveLength(1)
		expect(t.values.prolink_db_queue_length).toBe(0)
		t.obs.reset()
	})
	test('unexpected raw jump cancels sequence and reset clears status', async () => {
		const t=make()
		t.controller.request(1,'3')
		rawValue(t.obs, valArgs[1]+3)
		expect(t.values.prolink_db_status).toBe('unexpected_change')
		await flush()
		expect(t.sent).toHaveLength(1)
		t.obs.reset()
		expect(t.values.prolink_db_status).toBe('idle')
	})
})
