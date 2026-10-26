'use strict'

// V8: read-only observation of the current Touch-and-Turn context. The focus
// identity reported by ProLink is not a routable rack/slot/parameter address.
// In particular, selecting a rack or plugin is NOT proof of controller focus.
const MAX_EVENTS = 80
const MAX_MARKS = 24
const LABELS = new Set([
  'before_navigation', 'after_navigation', 'after_plugin_selection',
  'after_controller_click', 'after_root_click', 'after_refresh', 'other',
])

class ProLinkFocusAudit {
  constructor(instance, now = () => Date.now()) {
    this.instance = instance
    this.now = now
    this.recording = null
    this.lastExport = ''
    this.status = 'idle'
  }

  connected() {
    return !this.instance._destroyed && !this.instance._transportSwitching &&
      this.instance.config?.controlTransport === 'prolink' &&
      this.instance._prolink?.state === 'connected'
  }

  publish(values) {
    this.instance.setVariableValues?.(values)
  }

  // Called on reconnect/disconnect as well as during the module lifecycle.
  // Preserve an interrupted/stopped export across repeated transport resets;
  // otherwise diagnostics are lost before the user can copy them.
  reset(clear = false) {
    if (this.recording?.active) {
      this._record('connection_reset', 'ProLink context invalidated')
      this.recording.active = false
      this.recording.stoppedAtMs = this.now()
      this._export('interrupted')
      return
    }
    if (clear || !this.recording) {
      this.recording = null
      this.lastExport = ''
      this.status = 'idle'
      this.publish({
        prolink_focus_audit_status: 'idle', prolink_focus_audit_count: 0,
        prolink_focus_audit_json: '',
      })
    }
  }

  snapshot() {
    const state = this.instance._prolinkObservations?.controllerState
    const properties = state?.properties
    const value = state?.value
    const now = this.now()
    const age = sample => sample && Number.isFinite(sample.lastSeenAtMs)
      ? Math.max(0, now - sample.lastSeenAtMs) : null
    const ownershipString = this.instance._prolinkObservations?.statuses?.get('prolink_touch_ownership')
    let ownership = null
    if (ownershipString !== undefined) {
      try { ownership = JSON.parse(ownershipString) } catch { /* untrusted raw status */ }
    }
    return {
      connected: this.connected(),
      contextVersion: state?.contextVersion ?? null,
      controller: properties?.values?.[0] ?? null,
      pluginLabel: properties?.values?.[10] ?? null,
      controllerTypeFlag: properties?.values?.[1] ?? null,
      discreteCountCandidate: properties?.values?.[2] ?? null,
      valueText: value?.values?.[0] ?? null,
      rawValue: value?.values?.[1] ?? null,
      propertiesAgeMs: age(properties),
      valueAgeMs: age(value),
      paired: !!(properties && value),
      touchOwnershipRaw: ownership,
      // No known rack ID, plugin-slot ID or parameter address is conveyed.
      remotelyAddressable: false,
    }
  }

  _record(kind, label) {
    const audit = this.recording
    if (!audit?.active) return false
    const entry = { ms: Math.max(0, this.now() - audit.startedAtMs), kind, label, state: this.snapshot() }
    if (audit.events.length >= MAX_EVENTS) {
      audit.droppedEvents++
      return false
    }
    audit.events.push(entry)
    return true
  }

  _export(status) {
    const audit = this.recording
    if (!audit) return null
    const exported = {
      source: 'ProLink read-only focus audit',
      remoteFocusSetterVerified: false,
      status,
      startedAtMs: audit.startedAtMs,
      stoppedAtMs: audit.stoppedAtMs,
      markCount: audit.markCount,
      droppedEvents: audit.droppedEvents,
      countByKind: audit.events.reduce((counts, {kind}) => {
        counts[kind] = (counts[kind] || 0) + 1
        return counts
      }, {}),
      events: audit.events,
    }
    this.status = status
    this.lastExport = JSON.stringify(exported)
    this.publish({
      prolink_focus_audit_status: status,
      prolink_focus_audit_count: audit.events.length,
      prolink_focus_audit_json: this.lastExport,
    })
    return exported
  }

  start() {
    if (!this.connected()) {
      this.status = 'blocked_disconnected'
      this.publish({ prolink_focus_audit_status: this.status })
      return false
    }
    if (this.recording?.active) return false
    this.recording = {
      active: true, startedAtMs: this.now(), stoppedAtMs: null,
      markCount: 0, droppedEvents: 0, events: [],
    }
    this._record('start', 'baseline')
    this._export('recording')
    return true
  }

  mark(label) {
    if (!LABELS.has(label) || !this.recording?.active) return false
    if (!this.connected()) { this.reset(); return false }
    if (this.recording.markCount >= MAX_MARKS) return false
    this.recording.markCount++
    this._record('checkpoint', label)
    this._export('recording')
    return true
  }

  observeProperties() {
    if (!this.recording?.active) return
    // Called by ProLinkObservations only for an actual property change.
    this._record('focus_properties_changed', 'NotifyControllerProperties')
    this._export('recording')
  }

  observeValue() {
    if (!this.recording?.active) return
    // Called only when controller readback changes, not on repeated polling.
    this._record('controller_value_changed', 'NotifyControllerValue')
    this._export('recording')
  }

  observeOwnership() {
    if (!this.recording?.active) return
    // Called only on an actual ownership status change.
    this._record('touch_ownership_changed', 'NotifyTouchAndTurnControlOwnership')
    this._export('recording')
  }

  stop() {
    if (!this.recording?.active) return false
    this._record('stop', 'final_observation')
    this.recording.active = false
    this.recording.stoppedAtMs = this.now()
    this._export('stopped')
    return true
  }
}

module.exports = { ProLinkFocusAudit, LABELS, MAX_EVENTS, MAX_MARKS }
