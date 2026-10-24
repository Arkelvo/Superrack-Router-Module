const { ProLinkTapTempo } = require('../lib/prolink-tap-tempo')
const { ProLinkTapBeat } = require('../lib/prolink-tap-beat')

function makeClock() {
	let ms = 0
	let seq = 0
	const tasks = new Map()
	return {
		now: () => BigInt(Math.round(ms * 1_000_000)),
		setTimer: (fn, delay) => {
			const id = ++seq
			tasks.set(id, { at: ms + delay, fn })
			return id
		},
		clearTimer: (id) => tasks.delete(id),
		advance: (delta) => {
			const end = ms + delta
			for (;;) {
				const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]
				if (!next || next[1].at > end) break
				tasks.delete(next[0])
				ms = next[1].at
				next[1].fn()
			}
			ms = end
		},
		count: () => tasks.size,
	}
}

test('V1 tap averaging: sends same tempo after every in-range tap, respects 1700ms reset', () => {
	const clock = makeClock()
	const taps = new ProLinkTapTempo(clock.now)
	expect(taps.tap().status).toBe('waiting_for_second_tap')
	clock.advance(500)
	expect(taps.tap().bpm).toBe(120)
	clock.advance(500)
	expect(taps.tap().bpm).toBe(120)
	clock.advance(500)
	expect(taps.tap().bpm).toBe(120)
	clock.advance(1701)
	expect(taps.tap().status).toBe('timeout_reset')
})

test('visual beat flashes on beat boundaries and stops on disconnect', () => {
	const clock = makeClock()
	const events = []
	const beat = new ProLinkTapBeat({ ...clock, onChange: (active) => events.push(active) })
	beat.start(120)
	expect(beat.active).toBe(true)
	clock.advance(80)
	expect(beat.active).toBe(false)
	clock.advance(420)
	expect(beat.active).toBe(true)
	clock.advance(80)
	expect(beat.active).toBe(false)
	clock.advance(420)
	expect(beat.active).toBe(true)
	beat.stop()
	expect(beat.active).toBe(false)
	expect(clock.count()).toBe(0)
	clock.advance(5000)
	expect(events).toEqual([true, false, true, false, true, false])
})

test('500 BPM flashes at 120ms without overlaps and changing BPM reanchors phase', () => {
	const clock = makeClock()
	const beat = new ProLinkTapBeat({ ...clock })
	beat.start(500)
	expect(beat.active).toBe(true)
	clock.advance(72)
	expect(beat.active).toBe(false)
	clock.advance(48)
	expect(beat.active).toBe(true)
	clock.advance(20)
	beat.start(120)
	clock.advance(80)
	expect(beat.active).toBe(false)
	clock.advance(419)
	expect(beat.active).toBe(false)
	clock.advance(1)
	expect(beat.active).toBe(true)
	beat.stop()
})

test('preset is a Companion API 1.x button with dynamic BPM and beat feedback', () => {
	let presets
	const self = { label: 'waves-1', setPresetDefinitions: (data) => { presets = data } }
	jest.doMock('@companion-module/base', () => ({ combineRgb: (r, g, b) => (r << 16) | (g << 8) | b }))
	jest.isolateModules(() => require('../presets')(self))
	const preset = presets.prolink_tap_tempo
	expect(preset.type).toBe('button')
	expect(preset.style.text).toContain('$(waves-1:prolink_tap_display_bpm)')
	expect(preset.steps[0].down[0].actionId).toBe('prolink_tap_tempo')
	expect(preset.feedbacks[0].feedbackId).toBe('prolink_tap_beat')
})
