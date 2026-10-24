'use strict'

// Tap Tempo V1: the latest Tap starts the new beat phase in SuperRack when
// SetTempo reaches the remote host. No latency compensation is applied.
const MIN_BPM = 40
const MAX_BPM = 500
const MAX_TAP_GAP_MS = 1700
const NS_PER_MS = 1_000_000n
class ProLinkTapTempo {
	constructor(now = () => process.hrtime.bigint()) {
		if (typeof now !== 'function') throw new TypeError('Tap clock must be a function')
		this.now = now
		this.reset()
	}

	reset() {
		this.firstTapNs = null
		this.lastTapNs = null
		this.tapCount = 0
		this.lastIntervalMs = null
		this.averageIntervalMs = null
		this.calculatedBpm = null
	}

	_start(nowNs, status) {
		this.firstTapNs = nowNs
		this.lastTapNs = nowNs
		this.tapCount = 1
		this.lastIntervalMs = null
		this.averageIntervalMs = null
		this.calculatedBpm = null
		return { status, bpm: null, tapCount: 1 }
	}

	tap() {
		const nowNs = this.now()
		if (typeof nowNs !== 'bigint' || nowNs < 0n) throw new TypeError('Tap clock must return nonnegative nanoseconds as bigint')
		if (this.lastTapNs === null) return this._start(nowNs, 'waiting_for_second_tap')

		const intervalNs = nowNs - this.lastTapNs
		// Reject a non-increasing clock reading without corrupting the measurement.
		// This is not a debounce or a user-configurable minimum tap interval.
		if (intervalNs <= 0n) return { status: 'invalid_interval', bpm: null, tapCount: this.tapCount }
		if (intervalNs > BigInt(MAX_TAP_GAP_MS) * NS_PER_MS) return this._start(nowNs, 'timeout_reset')

		this.lastTapNs = nowNs
		this.tapCount += 1
		this.lastIntervalMs = Number(intervalNs) / Number(NS_PER_MS)
		// Mean of *all* intervals in this uninterrupted tap sequence.
		this.averageIntervalMs = Number(nowNs - this.firstTapNs) / (this.tapCount - 1) / Number(NS_PER_MS)
		const roundedBpm = Math.round(60_000 / this.averageIntervalMs)
		this.calculatedBpm = roundedBpm
		const result = {
			status: roundedBpm >= MIN_BPM && roundedBpm <= MAX_BPM ? 'ready' : 'out_of_range',
			bpm: roundedBpm,
			tapCount: this.tapCount,
			lastIntervalMs: this.lastIntervalMs,
			averageIntervalMs: this.averageIntervalMs,
		}
		return result
	}

	snapshot() {
		return {
			tapCount: this.tapCount,
			calculatedBpm: this.calculatedBpm,
			lastIntervalMs: this.lastIntervalMs,
			averageIntervalMs: this.averageIntervalMs,
		}
	}
}

module.exports = { ProLinkTapTempo, MIN_BPM, MAX_BPM, MAX_TAP_GAP_MS }
