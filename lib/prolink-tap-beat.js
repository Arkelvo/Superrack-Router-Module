'use strict'

// A local visual metronome for Companion feedback. Does NOT observe Waves' DSP
// clock and does NOT send any OSC packets itself. One timer per edge, no polling.
const MIN_BPM = 40
const MAX_BPM = 500
const NS_PER_MS = 1_000_000n
class ProLinkTapBeat {
	constructor({ now = () => process.hrtime.bigint(), setTimer = setTimeout,
		clearTimer = clearTimeout, onChange = () => {} } = {}) {
		this.now = now
		this.setTimer = setTimer
		this.clearTimer = clearTimer
		this.onChange = onChange
		this.running = false
		this.active = false
		this.generation = 0
		this.onTimer = null
		this.offTimer = null
	}

	_setActive(value) {
		if (this.active === value) return
		this.active = value
		this.onChange(value)
	}

	_schedule(callback, delayMs) {
		const timer = this.setTimer(callback, Math.max(0, delayMs))
		if (typeof timer?.unref === 'function') timer.unref()
		return timer
	}

	stop() {
		this.generation++
		this.running = false
		if (this.onTimer != null) this.clearTimer(this.onTimer)
		if (this.offTimer != null) this.clearTimer(this.offTimer)
		this.onTimer = null
		this.offTimer = null
		this._setActive(false)
	}

	start(bpm) {
		if (!Number.isInteger(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) throw new RangeError('Invalid beat feedback BPM')
		this.stop()
		this.running = true
		this.periodNs = BigInt(Math.round(60_000_000_000 / bpm))
		this.pulseMs = Math.min(80, Number(this.periodNs) / Number(NS_PER_MS) * 0.6)
		this.anchorNs = this.now()
		this._pulse(this.generation)
		this._next(this.generation)
	}

	_pulse(generation) {
		if (!this.running || generation !== this.generation) return
		this._setActive(true)
		if (this.offTimer != null) this.clearTimer(this.offTimer)
		this.offTimer = this._schedule(() => {
			this.offTimer = null
			if (this.running && generation === this.generation) this._setActive(false)
		}, this.pulseMs)
	}

	_next(generation) {
		if (!this.running || generation !== this.generation) return
		// Keep phase aligned to the starting monotonic timestamp, even if JS
		// timers fire late. Skip overdue beats rather than firing a burst.
		const elapsed = this.now() - this.anchorNs
		const beatIndex = elapsed < 0n ? 1n : elapsed / this.periodNs + 1n
		const target = this.anchorNs + beatIndex * this.periodNs
		const delay = Number(target - this.now()) / Number(NS_PER_MS)
		this.onTimer = this._schedule(() => {
			this.onTimer = null
			if (!this.running || generation !== this.generation) return
			this._pulse(generation)
			this._next(generation)
		}, Math.max(1, Math.ceil(delay)))
	}
}

module.exports = { ProLinkTapBeat }
