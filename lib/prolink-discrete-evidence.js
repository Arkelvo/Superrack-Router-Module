'use strict'

// V10: bounded, observational evidence for exactly one manually triggered
// SwitchControllerValue probe. An OSC ResultCommand is never treated as a
// plugin-state confirmation. There is NO remote parameter address here.
const MAX_RECORDS = 24
const MAX_AGE_MS = 3000
const OBSERVATION_TIMEOUT_MS = 2500

function observed(controller, now = Date.now()) {
  const p = controller?.properties, v = controller?.value
  if (!p || !v || !Array.isArray(p.values) || p.values.length !== 13 ||
      !Array.isArray(v.values) || v.values.length !== 2 ||
      p.values[1] !== false || !Number.isInteger(p.values[2]) || p.values[2] < 2 ||
      typeof p.values[0] !== 'string' || typeof p.values[10] !== 'string' ||
      typeof v.values[0] !== 'string' || !Number.isInteger(v.values[1])) return null
  const pa = now - p.lastSeenAtMs, va = now - v.lastSeenAtMs
  if (pa < 0 || va < 0 || pa > MAX_AGE_MS || va > MAX_AGE_MS) return null
  return {
    name: p.values[0], plugin: p.values[10], countCandidate: p.values[2],
    contextVersion: controller.contextVersion,
    propertiesSignature: p.signature, valueSignature: v.signature,
    raw: v.values[1], label: v.values[0],
  }
}

class ProLinkDiscreteEvidence {
  constructor(instance, { timeoutMs = OBSERVATION_TIMEOUT_MS } = {}) {
    this.instance = instance
    this.timeoutMs = timeoutMs
    this.records = []
    this.pending = null
    this.status = 'idle'
  }

  publish() {
    this.instance.setVariableValues?.({
      prolink_discrete_evidence_status: this.status,
      prolink_discrete_evidence_count: this.records.length,
      prolink_discrete_evidence_json: JSON.stringify(this.export()),
    })
  }

  export() {
    return {
      source: 'V10 observed focused discrete SwitchControllerValue probes',
      remoteParameterAddressingVerified: false,
      absoluteDiscreteWriteVerified: false,
      resultIsCausalProof: false,
      explanation: 'A new matching controller value was observed after a manually triggered switch; manual/external concurrent edits cannot be excluded.',
      status: this.status,
      pending: this.pending ? {
        name: this.pending.before.name,
        plugin: this.pending.before.plugin,
        raw: this.pending.before.raw,
        label: this.pending.before.label,
      } : null,
      records: this.records.map(record => ({ ...record })),
    }
  }

  begin(target) {
    if (this.pending) return false
    const now = Date.now()
    const before = observed(this.instance._prolinkObservations?.controllerState, now)
    if (!before || before.plugin !== target.plugin || before.name !== target.name ||
        before.countCandidate !== target.count) return false
    const pending = { before, startedAtMs: now, timer: null }
    this.pending = pending
    this.status = 'awaiting_readback'
    pending.timer = setTimeout(() => {
      if (this.pending === pending) this.finish('readback_timeout', null)
    }, this.timeoutMs)
    this.publish()
    return true
  }

  onProperties() {
    if (this.pending) this.finish('focus_changed', null)
  }

  onValue() {
    const job = this.pending
    if (!job) return
    const after = observed(this.instance._prolinkObservations?.controllerState)
    if (!after || after.contextVersion !== job.before.contextVersion ||
        after.propertiesSignature !== job.before.propertiesSignature ||
        after.name !== job.before.name || after.plugin !== job.before.plugin) {
      this.finish('focus_changed', null)
      return
    }
    if (after.valueSignature === job.before.valueSignature) return
    if (after.raw === job.before.raw) {
      this.finish('ambiguous_value_change', after)
      return
    }
    this.finish('observed_value_changed', after)
  }

  onResult(command, success) {
    if (command === 'SwitchControllerValue' && success === false && this.pending) {
      this.finish('command_rejected', null)
    }
  }

  finish(status, after) {
    const job = this.pending
    if (!job) return
    clearTimeout(job.timer)
    this.pending = null
    this.status = status
    const nextByCandidate = (job.before.raw + 1) % job.before.countCandidate
    const record = {
      status,
      observedValueChange: status === 'observed_value_changed',
      switchCommand: 'SwitchControllerValue(true)',
      startedAtMs: job.startedAtMs,
      completedAtMs: Date.now(),
      contextVersion: job.before.contextVersion,
      name: job.before.name, plugin: job.before.plugin,
      countCandidate: job.before.countCandidate,
      before: { label: job.before.label, raw: job.before.raw },
      after: after ? { label: after.label, raw: after.raw } : null,
      matchesExpectedForwardCandidate: after ? after.raw === nextByCandidate : null,
    }
    this.records.push(record)
    if (this.records.length > MAX_RECORDS) this.records.shift()
    this.publish()
    this.instance._log?.(status === 'observed_value_changed' ? 'info' : 'debug',
      '[PROLINK_DISCRETE_EVIDENCE]', record)
  }

  reset() {
    if (this.pending) this.finish('connection_or_module_reset', null)
    if (!this.records.length) this.status = 'idle'
    this.publish()
  }

  clear() {
    if (this.pending) return false
    this.records = []
    this.status = 'idle'
    this.publish()
    return true
  }
}

module.exports = { ProLinkDiscreteEvidence, observed, MAX_RECORDS }
