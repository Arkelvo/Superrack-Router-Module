'use strict'
const cycle = require('./prolink-discrete-cycle')

// Ordered Tune RT Scale Type options from the actual SuperRack UI supplied by
// the operator (0..43); 0, 1..9 and 43 have also been observed as numeric
// readbacks. Other raw/name pairs are inferred from the 44-entry UI order,
// *not* independently verified controller fixtures. Abort on nonsequential
// numeric readbacks instead of assuming a different order or wrapping early.
const SCALE_LABELS = Object.freeze([
  'User Scale',
  'Chromatic',
  'Major',
  'Natural Minor',
  'Harmonic Minor',
  'Melodic Minor (Ascending)',
  'Melodic Minor (Ascending & Descending)',
  'Major Justonic',
  'Minor Justonic',
  'Dorian',
  'Mixolydian',
  'Blues',
  'Phrygian',
  'Locrian',
  'Lydian',
  'Whole Tone',
  'Diminished (W-H)',
  'Diminished (H-W)',
  'Bebop',
  'Major Pentatonic',
  'Minor Pentatonic',
  'Major Pentatonic With flat 3rd',
  'Minor Pentatonic + Blues',
  'Bebop + Blues',
  'Pythagorean',
  'Maqam Rast (Rast-Rast)',
  'Maqam Saba',
  'Maqam Bayati',
  'Maqam Nahawand',
  'Maqam Hijaz',
  'Maqam Kurd',
  'Maqam Huzam',
  'Bilawal (Hindustani)',
  'Bilawal (Carnatic)',
  'Kafi (Hindustani)',
  'Kafi (Carnatic)',
  'Bhairavi (Hindustani)',
  'Bhairavi (Carnatic)',
  'Kalyan (Hindustani)',
  'Kalyan (Carnatic)',
  'Khamaj (Hindustani)',
  'Khamaj (Carnatic)',
  'Asavari (Hindustani)',
  'Asavari (Carnatic)',
])
const SCALE_IDS = Object.freeze([
  'user_scale', 'chromatic', 'major', 'natural_minor', 'harmonic_minor',
  'melodic_minor_asc', 'melodic_minor_asc_dec', 'major_justonic', 'minor_justonic',
  'dorian', 'mixolydian', 'blues', 'phrygian', 'locrian', 'lydian',
  'whole_tone', 'diminished_wh', 'diminished_hw', 'bebop',
  'major_pentatonic', 'minor_pentatonic', 'major_pentatonic_flat3',
  'minor_pentatonic_blues', 'bebop_blues', 'pythagorean',
  'maqam_rast', 'maqam_saba', 'maqam_bayati', 'maqam_nahawand',
  'maqam_hijaz', 'maqam_kurd', 'maqam_huzam',
  'bilawal_hindustani', 'bilawal_carnatic', 'kafi_hindustani', 'kafi_carnatic',
  'bhairavi_hindustani', 'bhairavi_carnatic', 'kalyan_hindustani',
  'kalyan_carnatic', 'khamaj_hindustani', 'khamaj_carnatic',
  'asavari_hindustani', 'asavari_carnatic',
])
const SCALE_COUNT = 44
const VERIFIED_SCALES = Object.freeze(SCALE_LABELS.map((label, raw) =>
  Object.freeze({ id: SCALE_IDS[raw], label, raw })))
const BY_ID = new Map(VERIFIED_SCALES.map(s => [s.id, s]))
const BY_RAW = new Map(VERIFIED_SCALES.map(s => [s.raw, s]))
const FRESH_MS = 3000
const TIMEOUT_MS = 2500
const MAX_STEPS = SCALE_COUNT - 1

// Actual ProLink text for these options is shorter than the visible UI text.
const TEXT_ALIASES = new Map([
  [5, ['Melodic Minor (Asc)']],
  [6, ['Melodic Minor (Asc+Dec)']],
])
const canonicalText = text => text.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
function textMatches(item, text) {
  const observed = canonicalText(text)
  return observed === canonicalText(item.label) ||
    (TEXT_ALIASES.get(item.raw) ?? []).some(alias => canonicalText(alias) === observed)
}
const nextRaw = raw => cycle.nextRaw(raw, SCALE_COUNT)
const forwardDistance = (from, to) => cycle.forwardDistance(from, to, SCALE_COUNT)

// Focus-bound closed loop: one OSC switch per confirmed next numeric value.
// No verified remote rack/slot/controller address; the user must select
// the Tune RT Scale Type controller before executing a sequence.
class ProLinkTuneScaleControl {
	constructor(instance, { timeoutMs = TIMEOUT_MS } = {}) {
		this.instance = instance
		this.timeoutMs = timeoutMs
		this.pending = null
		this.sending = false
	}

	connected() {
		const self = this.instance
		return self.config?.controlTransport === 'prolink' && self._prolink?.state === 'connected' &&
			self._prolinkReady === true && !self._destroyed && !self._transportSwitching
	}

	current(now = Date.now()) {
		const controller = this.instance._prolinkObservations?.controllerState
		const p = controller?.properties
		const v = controller?.value
		if (!p || !v || !Array.isArray(p.values) || p.values.length !== 13 ||
			p.values[0] !== 'Scale Type' || p.values[10] !== 'Tune RT' ||
			p.values[1] !== false || p.values[2] !== 44) return null
		const pa = now - p.lastSeenAtMs
		const va = now - v.lastSeenAtMs
		if (pa < 0 || va < 0 || pa > FRESH_MS || va > FRESH_MS) return null
		const [text, raw] = v.values
		const item = BY_RAW.get(raw)
		if (!item || typeof text !== 'string' || !text.trim()) return null
		// For verified samples, a known contradictory label is not accepted.
		// For UI-ordered, not-yet-live-verified options, the sequential
		// readback is authoritative; publish the actual observed label.
		if ((raw <= 9 || raw === 43) && !textMatches(item, text)) return null
		return { item, text, contextVersion: controller.contextVersion, signature: v.signature }
	}

	publish(values) {
		if (Object.hasOwn(values, 'tune_status')) this.lastStatus = values.tune_status
		this.instance.setVariableValues?.(values)
		this.instance.checkFeedbacks?.('tune_scale_ready', 'tune_scale_matches', 'tune_scale_busy', 'tune_scale_failure')
	}

	reset() {
		this.abort('disconnected', 'ProLink connection or controller observation reset')
		this.publish({ tune_scale: '', tune_scale_raw: '', tune_controller_available: false,
			tune_scale_steps: 0, tune_status: this.connected() ? 'blocked_scale_focus' : 'disconnected' })
	}

	onProperties() {
		const wasChanging = !!this.pending
		if (this.pending) this.abort('focus_changed', 'Controller properties changed during Tune Scale operation')
		// Never display a previous controller's value as Tune Scale.
		this.publish({ tune_scale: '', tune_scale_raw: '', tune_controller_available: false,
			...(wasChanging ? {} : { tune_status: this.connected() ? 'blocked_scale_focus' : 'disconnected' }) })
	}

	onValue() {
		const state = this.current()
		if (!state) {
			if (this.pending) this.abort('invalid_readback', 'Unexpected or stale Scale Type readback')
			this.publish({ tune_scale: '', tune_scale_raw: '', tune_controller_available: false })
			return
		}
		this.publish({ tune_scale: state.text, tune_scale_raw: state.item.raw,
			tune_controller_available: true })
		const job = this.pending
		if (!job) {
			this.publish({ tune_status: 'ready_scale_only', tune_last_error: '' })
			return
		}
		if (job.contextVersion !== state.contextVersion) {
			this.abort('focus_changed', 'Controller focus changed')
			return
		}
		// Only react to *changed* packets while waiting; duplicate subscriptions
		// don't constitute a per-step confirmation.
		if (!job.waiting) return
		const transition = cycle.classifyStep(job.lastRaw, state.item.raw, SCALE_COUNT,
			job.beforeSignature, state.signature)
		if (transition.kind === 'duplicate') return
		if (transition.kind !== 'advance') {
			this.abort('unexpected_readback', `Expected next Scale Type value ${transition.expected}, got ${state.item.raw}`)
			return
		}
		clearTimeout(job.timer)
		job.timer = null
		job.waiting = false
		job.lastRaw = state.item.raw
		job.steps++
		this.publish({ tune_scale_steps: job.steps })
		if (state.item.raw === job.target.raw) {
			if (!textMatches(job.target, state.text)) {
				return this.abort('target_label_mismatch', `Target raw ${job.target.raw} reported unexpected label: ${state.text}`)
			}
			this.complete(true, 'scale_observed_target', '')
		} else {
			// Notifications arrive from the network asynchronously; no polling,
			// debouncing or timer-based step sequencing is used.
			this.sendNext(job)
		}
	}

	onResult(command, success) {
		if (command === 'SwitchControllerValue' && success === false && this.pending) {
			this.abort('command_rejected', 'SuperRack rejected SwitchControllerValue')
		}
	}

	complete(success, status, reason) {
		const job = this.pending
		if (!job) return
		if (job.timer) clearTimeout(job.timer)
		this.pending = null
		this.publish({ tune_status: status, tune_last_error: reason, tune_scale_steps: job.steps })
		this.instance._log?.(success ? 'info' : 'warn', '[TUNE_SCALE_SET_RESULT]', {
			status, reason, target: job.target.label, steps: job.steps, observed: success,
		})
		job.resolve(success)
	}

	abort(status, reason) {
		if (!this.pending) return
		this.complete(false, status, reason)
	}

	sendNext(job) {
		if (job !== this.pending) return
		if (!this.connected()) return this.abort('disconnected', 'ProLink disconnected during Scale change')
		const sample = this.current()
		if (!sample || sample.contextVersion !== job.contextVersion || sample.item.raw !== job.lastRaw) {
			return this.abort('focus_changed', 'Scale Type focus or readback is no longer fresh')
		}
		if (job.steps >= MAX_STEPS) {
			return this.abort('step_limit', 'Maximum 43-step cycle exceeded')
		}
		if (this.instance._prolinkObservations?.controllerWrite) {
			return this.abort('other_write_pending', 'Another controller write is pending')
		}
		job.beforeSignature = sample.signature
		job.waiting = true
		// Set deadline before sending; this also protects a synchronous mock.
		job.timer = setTimeout(() => this.abort('readback_timeout', 'No new Scale Type value within 2.5 seconds'), this.timeoutMs)
		let sent
		this.sending = true
		try { sent = this.instance._sendProlink('SwitchControllerValue', true) === true }
		finally { this.sending = false }
		if (!sent) {
			return this.abort('send_failed', 'Could not send SwitchControllerValue')
		}
		// Reuse existing observer accounting; acknowledgement does not mean
		// the plugin value actually changed.
		this.instance._prolinkObservations?.trackControllerWrite({
			command: 'SwitchControllerValue', delta: 'switch_touch',
			contextVersion: job.contextVersion, previousSignature: sample.signature,
		})
		this.instance._log?.('debug', '[TUNE_SCALE_STEP_SENT]', {
			from: job.lastRaw, expected: nextRaw(job.lastRaw), target: job.target.raw, observed: false,
		})
	}

	setScale(id) {
		const target = BY_ID.get(id)
		if (!target) {
			this.publish({ tune_status: 'invalid_target', tune_last_error: 'Unknown or unverified Tune Scale option' })
			return Promise.resolve(false)
		}
		if (this.pending || this.instance._discreteControl?.pending) return Promise.resolve(false) // Never overlap controller transactions.
		this.publish({ tune_target_scale: target.label, tune_scale_steps: 0 })
		if (!this.connected()) {
			this.publish({ tune_status: 'disconnected', tune_last_error: 'ProLink not ready' })
			return Promise.resolve(false)
		}
		const current = this.current()
		if (!current) {
			this.publish({ tune_status: 'blocked_scale_focus',
				tune_last_error: 'Select Scale Type in Tune RT; fresh paired controller notifications required' })
			return Promise.resolve(false)
		}
		if (current.item.raw === target.raw) {
			if (!textMatches(target, current.text)) {
				this.publish({ tune_status: 'target_label_mismatch',
					tune_last_error: `Target raw ${target.raw} reported unexpected label: ${current.text}` })
				return Promise.resolve(false)
			}
			this.publish({ tune_status: 'already_at_target', tune_last_error: '' })
			return Promise.resolve(true)
		}
		const requiredSteps = forwardDistance(current.item.raw, target.raw)
		if (requiredSteps > MAX_STEPS || this.instance._prolinkObservations?.controllerWrite) {
			this.publish({ tune_status: 'blocked_pending', tune_last_error: 'Another write is pending or maximum 43-step cycle exceeded' })
			return Promise.resolve(false)
		}
		return new Promise(resolve => {
			const job = { resolve, target, contextVersion: current.contextVersion, lastRaw: current.item.raw,
				beforeSignature: current.signature, steps: 0, waiting: false, timer: null }
			this.pending = job
			this.publish({ tune_status: 'changing_scale', tune_last_error: '' })
			this.sendNext(job)
		})
	}
}

module.exports = { ProLinkTuneScaleControl, VERIFIED_SCALES, SCALE_COUNT, forwardDistance, nextRaw }
