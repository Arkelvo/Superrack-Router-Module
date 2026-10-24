const { ProLinkTapTempo, MIN_BPM, MAX_BPM, MAX_TAP_GAP_MS } = require('../lib/prolink-tap-tempo')

function makeTaps() {
	let ns = 0n
	const tempo = new ProLinkTapTempo(() => ns)
	return {
		tempo,
		tapAfter(ms) {
			ns += BigInt(Math.round(ms * 1_000_000))
			return tempo.tap()
		},
	}
}

test('accepts user-approved BPM limits and timeout', () => {
	expect([MIN_BPM, MAX_BPM, MAX_TAP_GAP_MS]).toEqual([40, 500, 1700])
})

test('first tap does not send; second tap yields BPM', () => {
	const { tapAfter } = makeTaps()
	expect(tapAfter(0).status).toBe('waiting_for_second_tap')
	expect(tapAfter(500)).toMatchObject({ status: 'ready', bpm: 120, tapCount: 2 })
})

test('averages all intervals, not the latest interval or BPM readings', () => {
	const { tapAfter } = makeTaps()
	tapAfter(0)
	expect(tapAfter(500).bpm).toBe(120)
	expect(tapAfter(600)).toMatchObject({ status: 'ready', bpm: 109, tapCount: 3 })
	expect(tapAfter(400)).toMatchObject({ status: 'ready', bpm: 120, tapCount: 4 })
})

test('rounds to whole BPM before validating 40..500, including both endpoints', () => {
	const lower = makeTaps()
	lower.tapAfter(0)
	expect(lower.tapAfter(1510)).toMatchObject({ status: 'ready', bpm: 40 }) // 39.735... -> 40
	const upper = makeTaps()
	upper.tapAfter(0)
	expect(upper.tapAfter(119.9)).toMatchObject({ status: 'ready', bpm: 500 })
	const tooLow = makeTaps()
	tooLow.tapAfter(0)
	expect(tooLow.tapAfter(1520)).toMatchObject({ status: 'out_of_range', bpm: 39 })
	const tooHigh = makeTaps()
	tooHigh.tapAfter(0)
	expect(tooHigh.tapAfter(119)).toMatchObject({ status: 'out_of_range', bpm: 504 })
})

test('out-of-range taps remain in the average and are not discarded', () => {
	const { tapAfter } = makeTaps()
	tapAfter(0)
	expect(tapAfter(100)).toMatchObject({ status: 'out_of_range', bpm: 600, tapCount: 2 })
	expect(tapAfter(100)).toMatchObject({ status: 'out_of_range', bpm: 600, tapCount: 3 })
	expect(tapAfter(200)).toMatchObject({ status: 'ready', bpm: 450, tapCount: 4 })
})

test('does not reset on exactly 1700 ms, but resets for a greater interval', () => {
	const { tapAfter } = makeTaps()
	tapAfter(0)
	expect(tapAfter(1700)).toMatchObject({ status: 'out_of_range', bpm: 35, tapCount: 2 })
	expect(tapAfter(1700.000001)).toMatchObject({ status: 'timeout_reset', bpm: null, tapCount: 1 })
	expect(tapAfter(500)).toMatchObject({ status: 'ready', bpm: 120, tapCount: 2 })
})

test('nonincreasing timestamps are ignored without modifying the sequence', () => {
	const { tapAfter, tempo } = makeTaps()
	tapAfter(0)
	expect(tapAfter(0)).toMatchObject({ status: 'invalid_interval', tapCount: 1 })
	expect(tempo.snapshot().tapCount).toBe(1)
	expect(tapAfter(500)).toMatchObject({ status: 'ready', bpm: 120, tapCount: 2 })
})

test('explicit reset removes all timing history', () => {
	const { tapAfter, tempo } = makeTaps()
	tapAfter(0)
	tapAfter(500)
	tempo.reset()
	expect(tempo.snapshot()).toEqual({ tapCount: 0, calculatedBpm: null, lastIntervalMs: null, averageIntervalMs: null })
	expect(tapAfter(500).status).toBe('waiting_for_second_tap')
})
