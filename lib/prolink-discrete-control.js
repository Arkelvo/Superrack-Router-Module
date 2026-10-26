'use strict'

// V11: explicitly profile-locked, focus-bound cyclic discrete control.
// A parameter name and plugin label in the notifications are safety gates,
// NOT remote target addresses. Only profiles with live-confirmed step cycles.
const { VERIFIED_SCALES } = require('./prolink-tune-scale-control')
const cycle = require('./prolink-discrete-cycle')

const PROFILES = Object.freeze({
  tune_scale: Object.freeze({
    plugin: 'Tune RT', name: 'Scale Type', count: 44,
    targets: Object.freeze(VERIFIED_SCALES.map(item => Object.freeze({ ...item }))),
  }),
  cla76_analog: Object.freeze({
    plugin: 'CLA-76', name: 'Analog', count: 3,
    targets: Object.freeze([
      Object.freeze({ id: '50hz', label: '50Hz', raw: 0 }),
      Object.freeze({ id: '60hz', label: '60Hz', raw: 1 }),
      Object.freeze({ id: 'off', label: 'Off', raw: 2 }),
    ]),
  }),
})
const TARGET_CHOICES = Object.freeze(Object.entries(PROFILES).flatMap(([profileId, profile]) =>
  profile.targets.map(item => Object.freeze({
    id: `${profileId}:${item.id}`, label: `${profile.plugin} – ${profile.name}: ${item.label}`,
  }))))
const FRESH_MS = 3000
const TIMEOUT_MS = 2500
const normalize = text => String(text).trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
const ALIASES = new Map([
  [5, ['Melodic Minor (Asc)']],
  [6, ['Melodic Minor (Asc+Dec)']],
])
function textMatches(profileId, item, text) {
  if (normalize(item.label) === normalize(text)) return true
  if (profileId !== 'tune_scale') return false
  return (ALIASES.get(item.raw) ?? []).some(alias => normalize(alias) === normalize(text))
}
function requireLabel(profileId, raw, target = false) {
  // Tune UI-order mappings 12..42 are inferred, not all observed as ProLink
  // strings. Require a precise label for confirmed sample points only.
  return profileId === 'cla76_analog' || (raw <= 11 || raw === 43) || (target && raw <= 11)
}
const { forwardDistance } = cycle
function parseTarget(key) {
  if (typeof key !== 'string') return null
  const index = key.indexOf(':')
  if (index < 1) return null
  const profileId = key.slice(0, index)
  const profile = Object.hasOwn(PROFILES, profileId) ? PROFILES[profileId] : null
  const item = profile?.targets.find(entry => entry.id === key.slice(index + 1))
  return item ? { profileId, profile, item } : null
}

class ProLinkDiscreteControl {
  constructor(instance, { timeoutMs = TIMEOUT_MS } = {}) {
    this.instance = instance
    this.timeoutMs = timeoutMs
    this.pending = null
    this.sending = false
    this.lastStatus = 'idle'
  }

  connected() {
    const self = this.instance
    return self.config?.controlTransport === 'prolink' &&
      self._prolink?.state === 'connected' && self._prolinkReady === true &&
      !self._destroyed && !self._transportSwitching
  }

  current(profileId, now = Date.now()) {
    const profile = PROFILES[profileId]
    const state = this.instance._prolinkObservations?.controllerState
    const p = state?.properties, v = state?.value
    if (!profile || !p || !v || p.values?.length !== 13 || v.values?.length !== 2 ||
      p.values[0] !== profile.name || p.values[10] !== profile.plugin ||
      p.values[1] !== false || p.values[2] !== profile.count ||
      !Number.isInteger(v.values[1]) || v.values[1] < 0 || v.values[1] >= profile.count ||
      typeof v.values[0] !== 'string' || !v.values[0].trim()) return null
    const pa = now - p.lastSeenAtMs, va = now - v.lastSeenAtMs
    if (pa < 0 || va < 0 || pa > FRESH_MS || va > FRESH_MS) return null
    const item = profile.targets[v.values[1]]
    if (!item || item.raw !== v.values[1]) return null
    if (requireLabel(profileId, item.raw) && !textMatches(profileId, item, v.values[0])) return null
    return { profileId, profile, item, text: v.values[0], contextVersion: state.contextVersion,
      propertiesSignature: p.signature, valueSignature: v.signature }
  }

  publish(values) {
    if (Object.hasOwn(values, 'prolink_discrete_set_status')) this.lastStatus = values.prolink_discrete_set_status
    this.instance.setVariableValues?.(values)
    this.instance.checkFeedbacks?.('prolink_discrete_ready', 'prolink_discrete_matches',
      'prolink_discrete_busy', 'prolink_discrete_failure', 'prolink_discrete_profile_focused')
  }

  onProperties() {
    if (this.pending) this.finish(false, 'focus_changed', 'Focused controller properties changed during discrete set')
    this.publish({ prolink_discrete_set_observed: '', prolink_discrete_set_observed_raw: '',
      prolink_discrete_set_ready: false, prolink_discrete_focus_profile: '', prolink_discrete_focus_name: '' })
  }

  onValue() {
    const job = this.pending
    const snapshot = job ? this.current(job.profileId) :
      this.current('cla76_analog') || this.current('tune_scale')
    if (!snapshot) {
      if (job) this.finish(false, 'invalid_readback', 'Focused discrete controller became invalid or stale')
      this.publish({ prolink_discrete_set_observed: '', prolink_discrete_set_observed_raw: '',
        prolink_discrete_set_ready: false, prolink_discrete_focus_profile: '', prolink_discrete_focus_name: '' })
      return
    }
    this.publish({ prolink_discrete_set_observed: snapshot.text,
      prolink_discrete_set_observed_raw: snapshot.item.raw, prolink_discrete_set_ready: true,
      prolink_discrete_focus_profile: snapshot.profileId, prolink_discrete_focus_name: `${snapshot.profile.plugin} / ${snapshot.profile.name}` })
    if (!job) return
    if (!this.connected() || snapshot.contextVersion !== job.contextVersion ||
        snapshot.propertiesSignature !== job.propertiesSignature) {
      this.finish(false, 'focus_changed', 'Connection or controller context changed')
      return
    }
    if (!job.waiting) return
    // Ignore repeated readings, never count duplicate notification as a step.
    const transition = cycle.classifyStep(job.lastRaw, snapshot.item.raw, job.profile.count,
      job.beforeSignature, snapshot.valueSignature)
    if (transition.kind === 'duplicate') return
    const expected = transition.expected
    if (transition.kind !== 'advance') {
      this.finish(false, 'unexpected_readback', `Expected ${expected}, observed ${snapshot.item.raw}`)
      return
    }
    clearTimeout(job.timer)
    job.timer = null
    job.waiting = false
    job.lastRaw = snapshot.item.raw
    job.steps++
    this.publish({ prolink_discrete_set_steps: job.steps })
    if (job.lastRaw === job.target.raw) {
      if (requireLabel(job.profileId, job.target.raw, true) &&
        !textMatches(job.profileId, job.target, snapshot.text)) {
        this.finish(false, 'target_label_mismatch', `Unexpected label at target ${job.target.raw}: ${snapshot.text}`)
      } else {
        this.finish(true, 'observed_target', '')
      }
    } else {
      this.sendNext(job)
    }
  }

  onResult(command, success) {
    if (command === 'SwitchControllerValue' && success === false && this.pending) {
      this.finish(false, 'command_rejected', 'SuperRack rejected SwitchControllerValue')
    }
  }

  finish(success, status, reason) {
    const job = this.pending
    if (!job) return
    if (job.timer) clearTimeout(job.timer)
    this.pending = null
    this.publish({ prolink_discrete_set_status: status, prolink_discrete_set_error: reason,
      prolink_discrete_set_steps: job.steps })
    this.instance._log?.(success ? 'info' : 'warn', '[PROLINK_DISCRETE_SET_RESULT]', {
      status, reason, profile: job.profileId, target: job.target.label,
      raw: job.target.raw, steps: job.steps, observed: success,
    })
    job.resolve(success)
  }

  reset() {
    if (this.pending) this.finish(false, 'disconnected', 'ProLink disconnected or module reset')
    this.publish({ prolink_discrete_set_ready: false, prolink_discrete_set_observed: '',
      prolink_discrete_set_observed_raw: '',
      ...(!this.pending ? { prolink_discrete_set_status: 'disconnected' } : {}) })
  }

  sendNext(job) {
    if (this.pending !== job) return
    if (!this.connected()) return this.finish(false, 'disconnected', 'ProLink disconnected')
    const state = this.current(job.profileId)
    if (!state || state.contextVersion !== job.contextVersion ||
        state.propertiesSignature !== job.propertiesSignature || state.item.raw !== job.lastRaw) {
      return this.finish(false, 'focus_changed', 'Discrete controller is not freshly and uniquely selected')
    }
    if (job.steps >= job.profile.count - 1) {
      return this.finish(false, 'step_limit', 'Maximum single-cycle step count exceeded')
    }
    if (this.instance._prolinkObservations?.controllerWrite) {
      return this.finish(false, 'other_write_pending', 'Another controller write is pending')
    }
    job.beforeSignature = state.valueSignature
    job.waiting = true
    job.timer = setTimeout(() => {
      if (this.pending === job) this.finish(false, 'readback_timeout', 'No expected new discrete value in time')
    }, this.timeoutMs)
    this.sending = true
    let sent
    try { sent = this.instance._sendProlink('SwitchControllerValue', true) === true }
    finally { this.sending = false }
    if (!sent) return this.finish(false, 'send_failed', 'SwitchControllerValue was not sent')
    if (this.pending !== job) return
    this.instance._prolinkObservations?.trackControllerWrite({
      command: 'SwitchControllerValue', delta: 'switch_touch',
      contextVersion: job.contextVersion, previousSignature: state.valueSignature,
    })
    this.instance._log?.('debug', '[PROLINK_DISCRETE_SET_STEP_SENT]', {
      profile: job.profileId, from: job.lastRaw,
      expected: cycle.nextRaw(job.lastRaw, job.profile.count), target: job.target.raw, observed: false,
    })
  }

  // Read-only plan for a verified, currently focused profile. Never a remote
  // rack/plugin/parameter address and never proof that a future write succeeds.
  previewTarget(targetKey) {
    const requested = parseTarget(targetKey)
    const connected = this.connected()
    const current = requested && connected ? this.current(requested.profileId) : null
    const busy = !!(this.pending || this.instance._tuneScaleControl?.pending ||
      this.instance._discreteEvidence?.pending || this.instance._prolinkObservations?.controllerWrite)
    const status = !requested ? 'invalid_target' : !connected ? 'disconnected' :
      !current ? 'blocked_focus' : busy ? 'blocked_pending' : 'ready'
    const plan = current && requested ? cycle.buildCyclicPlan(current.item.raw, requested.item.raw,
      requested.profile.count) : null
    const info = {
      source: 'ProLink V12 read-only verified discrete cycle preview',
      status, sendsCommands: false, remoteParameterAddressingVerified: false,
      requiresManualControllerFocus: true,
      profile: requested?.profileId ?? null,
      focused: current ? { plugin: current.profile.plugin, controller: current.profile.name,
        label: current.text, raw: current.item.raw, contextVersion: current.contextVersion } : null,
      requestedTarget: requested ? { label: requested.item.label, raw: requested.item.raw } : null,
      count: requested?.profile.count ?? null,
      steps: plan?.steps ?? null,
      expectedRawSequence: plan?.expectedRawSequence ?? [],
      mappingNote: requested?.profileId === 'tune_scale'
        ? 'Scale raw labels 12..42 follow observed SuperRack UI order; only actual readbacks confirm each transition.'
        : 'CLA-76 Analog 0/1/2 and its wrap-around were observed live.',
    }
    this.instance.setVariableValues?.({
      prolink_discrete_plan_status: status,
      prolink_discrete_plan_json: JSON.stringify(info),
    })
    return status === 'ready'
  }

  setTarget(targetKey) {
    const requested = parseTarget(targetKey)
    if (!requested) {
      this.publish({ prolink_discrete_set_status: 'invalid_target', prolink_discrete_set_error: 'Unknown profile or target' })
      return Promise.resolve(false)
    }
    if (this.pending) return Promise.resolve(false)
    this.publish({ prolink_discrete_set_target: requested.item.label,
      prolink_discrete_set_target_profile: requested.profileId, prolink_discrete_set_steps: 0 })
    if (!this.connected()) {
      this.publish({ prolink_discrete_set_status: 'disconnected', prolink_discrete_set_error: 'ProLink not ready' })
      return Promise.resolve(false)
    }
    const current = this.current(requested.profileId)
    if (!current) {
      this.publish({ prolink_discrete_set_status: 'blocked_focus',
        prolink_discrete_set_error: `Select ${requested.profile.plugin} / ${requested.profile.name} manually and wait for fresh properties/value` })
      return Promise.resolve(false)
    }
    if (this.instance._tuneScaleControl?.pending || this.instance._discreteEvidence?.pending ||
        this.instance._prolinkObservations?.controllerWrite) {
      this.publish({ prolink_discrete_set_status: 'blocked_pending',
        prolink_discrete_set_error: 'Another controller write is pending' })
      return Promise.resolve(false)
    }
    if (current.item.raw === requested.item.raw) {
      if (requireLabel(requested.profileId, requested.item.raw, true) &&
        !textMatches(requested.profileId, requested.item, current.text)) {
        this.publish({ prolink_discrete_set_status: 'target_label_mismatch',
          prolink_discrete_set_error: 'Raw value disagrees with target label' })
        return Promise.resolve(false)
      }
      this.publish({ prolink_discrete_set_status: 'already_at_target', prolink_discrete_set_error: '' })
      return Promise.resolve(true)
    }
    return new Promise(resolve => {
      const job = {
        resolve, ...requested, contextVersion: current.contextVersion,
        propertiesSignature: current.propertiesSignature,
        lastRaw: current.item.raw, steps: 0, timer: null, waiting: false,
      }
      job.target = requested.item
      this.pending = job
      this.publish({ prolink_discrete_set_status: 'changing', prolink_discrete_set_error: '' })
      this.sendNext(job)
    })
  }
}
module.exports = { ProLinkDiscreteControl, PROFILES, TARGET_CHOICES, forwardDistance, parseTarget }
