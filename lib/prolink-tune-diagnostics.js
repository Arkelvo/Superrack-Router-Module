'use strict'

const { createHash } = require('node:crypto')
const { ROOT_BY_ID, buildRootCapabilityReport } = require('./prolink-tune-root-model')
const { VERIFIED_SCALES } = require('./prolink-tune-scale-control')

// Read-only diagnostic layer for Waves Tune Real-Time under ProLink.
// The known controller notifications have neither plugin/slot ID nor parameter ID.
// Their labels and raw values are useful evidence, NOT safe remote target addresses.
// NEVER route ChangeControllerValue from this class without a separately verified
// addressable controller protocol, atomic focus lock, and value-to-note mapping.
const ROOTS = Object.freeze([
	{ id: 'C', label: 'C' }, { id: 'C#', label: 'C♯ / D♭' },
	{ id: 'D', label: 'D' }, { id: 'Eb', label: 'E♭ / D♯' },
	{ id: 'E', label: 'E' }, { id: 'F', label: 'F' },
	{ id: 'F#', label: 'F♯ / G♭' }, { id: 'G', label: 'G' },
	{ id: 'Ab', label: 'A♭ / G♯' }, { id: 'A', label: 'A' },
	{ id: 'Bb', label: 'B♭ / A♯' }, { id: 'B', label: 'B' },
])

// Display labels are documented musical scale names, not verified plugin values.
const SCALES = Object.freeze([
	{ id: 'major', label: 'Major (no mapped parameter value)' },
	{ id: 'natural_minor', label: 'Natural Minor (no mapped parameter value)' },
])

const BLOCK_REASON = 'Tune remote addressing unavailable: ProLink exposes only a focused controller without a verified plugin/parameter ID or absolute value map; no write was sent.'
const MAX_AGE_MS = 15_000
const TRACE_MAX_EVENTS = 48 // distinct changes; recurring identical poll samples are suppressed
const TRACE_FIRST_EVENTS = 6
const TRACE_MAX_COMMANDS = 48

function detectTuneField(label) {
	if (typeof label !== 'string') return null
	const normalized = label.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
	if (normalized === 'scale root') return 'root'
	if (normalized === 'scale type') return 'scale'
	return null
}

class ProLinkTuneDiagnostics {
	constructor(instance, now = () => Date.now()) {
		this.instance = instance
		this.now = now
		this.focused = null
		this.captures = { root: null, scale: null }
		this.lastCapture = null
		this.trace = null
		this.captureAttempt = null
	}

	connected() {
		return this.instance.config?.controlTransport === 'prolink' &&
			this.instance._prolink?.state === 'connected' && !this.instance._destroyed
	}

	publish(values) {
		this.instance.setVariableValues?.(values)
		this.instance.checkFeedbacks?.('tune_blocked', 'tune_diagnostic_candidate')
	}

	reset() {
		this.focused = null
		this.captures = { root: null, scale: null }
		this.lastCapture = null
		this.trace = null
		this.captureAttempt = null
		this.publish({
			tune_root: '', tune_scale: '', tune_key: '',
			tune_target_root: '', tune_target_scale: '',
			tune_controller_available: false,
			tune_status: this.connected() ? 'blocked_unaddressable' : 'disconnected',
			tune_last_error: BLOCK_REASON,
			tune_debug_focused_name: '', tune_debug_focused_kind: '',
			tune_debug_focused_text: '', tune_debug_focused_raw: '',
			tune_debug_focused_aux: '', tune_debug_context_version: '',
			tune_debug_root_candidate_text: '', tune_debug_scale_candidate_text: '',
			tune_debug_last_capture_json: '', tune_debug_export_json: '',
			tune_root_analysis_json: '', tune_root_remote_status: 'unavailable_unverified',
		})
	}

	// A failed capture must still yield a useful JSON export. In particular,
	// NotifyControllerValue can arrive without NotifyControllerProperties.
	exportEvidence() {
		const controller = this.instance._prolinkObservations?.controllerState
		const evidence = {
			source: 'ProLink read-only received frames and focused controller observations',
			remoteParameterAddressingVerified: false,
			connected: this.connected(),
			controller: {
				contextVersion: controller?.contextVersion ?? null,
				properties: controller?.properties?.values ?? null,
				value: controller?.value?.values ?? null,
				paired: !!(controller?.properties && controller?.value),
			},
			focused: this.focused,
			root: this.captures.root,
			scale: this.captures.scale,
			lastCapture: this.lastCapture,
			captureAttempt: this.captureAttempt,
			trace: this.trace ? {
				label: this.trace.label,
				active: this.trace.active,
				startedAtMs: this.trace.startedAtMs,
				stoppedAtMs: this.trace.stoppedAtMs,
				totalFrames: this.trace.totalFrames,
				countByPath: this.trace.countByPath,
				// Repeated frame content is suppressed by path, not treated as truncation.
				truncated: this.trace.droppedChanges > 0,
				droppedChanges: this.trace.droppedChanges,
				suppressedDuplicates: this.trace.suppressedDuplicates,
				firstEvents: this.trace.firstEvents,
				events: this.trace.events,
			} : null,
		}
		this.publish({ tune_debug_export_json: JSON.stringify(evidence) })
		return evidence
	}

	startTrace(label = 'root') {
		if (!['root', 'scale', 'other'].includes(label)) return this.fail('Unknown diagnostic trace label')
		if (!this.connected()) return this.fail('Cannot trace: ProLink TCP is not connected')
		this.trace = {
			label, active: true, startedAtMs: this.now(), stoppedAtMs: null,
			totalFrames: 0, countByPath: {}, events: [], firstEvents: [],
			droppedChanges: 0, suppressedDuplicates: 0, lastFingerprintByPath: new Map(),
		}
		this.captureAttempt = null
		this.exportEvidence()
		this.instance._log?.('info', '[TUNE_TRACE_START]', { label, readOnly: true })
		return true
	}

	// Run on *every* inbound ProLink frame, even when the generic controller
	// notification parser would ignore it. Record only bounded, sanitized data;
	// never record full rack configuration blobs, TCP payloads or plugin presets.
	observeFrame(frame, message = null) {
		const trace = this.trace
		if (!trace?.active) return
		const path = typeof message?.path === 'string' ? message.path.slice(0, 128) : `frame-type-${frame.type}`
		trace.totalFrames++
		if (Object.prototype.hasOwnProperty.call(trace.countByPath, path)) {
			trace.countByPath[path]++
		} else if (Object.keys(trace.countByPath).length < TRACE_MAX_COMMANDS) {
			trace.countByPath[path] = 1
		} else {
			trace.countByPath['(additional paths)'] = (trace.countByPath['(additional paths)'] || 0) + 1
		}
		const isController = /\/NotifyController(?:Value|Properties)$/.test(path)
		const args = Array.isArray(message?.args) ? message.args : []
		const entry = {
			ms: this.now() - trace.startedAtMs, path, bytes: frame.payload?.length ?? 0,
			argc: args.length,
			// For unknown message types limit exposure to two primitive arguments.
			args: (isController ? args : args.slice(0, 2)).map(a => {
				if (typeof a === 'string') return a.slice(0, 48)
				if (typeof a === 'number' && Number.isFinite(a)) return a
				if (typeof a === 'boolean') return a
				return `[${typeof a}]`
			}),
		}
		// Important: ProLink repeatedly sends unchanged Touch-and-Turn state
		// (~every 250 ms). A simple ring buffer of every received frame loses
		// the exact parameter changes we are looking for within seconds.
		// Compare complete frame bytes, not only the truncated display args:
		// other command fields can change without changing the first two args.
		const fingerprint = createHash('sha256')
			.update(frame.payload ?? Buffer.alloc(0)).digest('hex').slice(0, 16)
		const previous = trace.lastFingerprintByPath.get(path)
		if (previous === fingerprint) {
			trace.suppressedDuplicates++
			return
		}
		// Fingerprint identifies repeated content only; it is not an OSC address.
		entry.fingerprint = fingerprint
		if (trace.lastFingerprintByPath.has(path) || trace.lastFingerprintByPath.size < TRACE_MAX_COMMANDS) {
			trace.lastFingerprintByPath.set(path, fingerprint)
		}
		if (trace.firstEvents.length < TRACE_FIRST_EVENTS) trace.firstEvents.push(entry)
		trace.events.push(entry)
		if (trace.events.length > TRACE_MAX_EVENTS) {
			trace.events.shift()
			trace.droppedChanges++
		}
	}

	stopTrace() {
		if (!this.trace) return this.fail('No Tune trace started; use Start RX trace first')
		this.trace.active = false
		this.trace.stoppedAtMs = this.now()
		const evidence = this.exportEvidence()
		this.instance._log?.('info', '[TUNE_TRACE_STOP]', {
			label: evidence.trace.label, totalFrames: evidence.trace.totalFrames,
			countByPath: evidence.trace.countByPath,
			distinctChangesRetained: evidence.trace.events.length,
			suppressedDuplicates: evidence.trace.suppressedDuplicates,
			exportVariable: 'tune_debug_export_json',
		})
		return true
	}

	// Called ONLY after ProLinkControllerState accepted a different properties packet.
	// A focus/context change invalidates a previous focused value immediately.
	observeProperties(controllerState) {
		const properties = controllerState.properties?.values
		this.focused = null
		this.publish({
			tune_debug_focused_name: properties?.[0] ?? '',
			tune_debug_focused_kind: detectTuneField(properties?.[0]) ?? '',
			tune_debug_focused_aux: properties?.[10] ?? '',
			tune_debug_focused_text: '', tune_debug_focused_raw: '',
			tune_debug_context_version: controllerState.contextVersion,
		})
	}

	// A value is evidence of the currently selected generic Touch-and-Turn field,
	// not evidence that the field belongs to an actual Tune Real-Time instance.
	observeValue(controllerState) {
		const properties = controllerState.properties?.values
		const value = controllerState.value?.values
		if (!value) return
		this.focused = {
			name: properties?.[0] ?? '',
			kind: detectTuneField(properties?.[0]),
			auxiliaryText: properties?.[10] ?? '',
			contextVersion: controllerState.contextVersion,
			properties: properties ? [...properties] : null,
			text: value[0],
			rawValue: value[1],
			observedAtMs: this.now(),
		}
		this.publish({
			tune_debug_focused_name: this.focused.name,
			tune_debug_focused_kind: this.focused.kind ?? '',
			tune_debug_focused_text: this.focused.text,
			tune_debug_focused_raw: this.focused.rawValue,
			tune_debug_focused_aux: this.focused.auxiliaryText,
			tune_debug_context_version: this.focused.contextVersion,
		})
	}

	capture(requested = 'auto') {
		if (!['auto', 'root', 'scale', 'raw'].includes(requested)) return this.captureFail(requested, 'Unknown diagnostic capture type')
		if (!this.connected()) return this.captureFail(requested, 'Tune diagnostic unavailable: ProLink TCP is not connected')
		const focused = this.focused
		if (!focused?.properties || !Number.isFinite(focused.rawValue) ||
			this.now() - focused.observedAtMs > MAX_AGE_MS || this.now() < focused.observedAtMs) {
			return this.captureFail(requested, 'No fresh, paired controller properties/value. This is still exported as a partial observation.')
		}
		if (requested !== 'raw' && !focused.kind) return this.captureFail(requested, 'Focused label is not Scale Root or Scale Type; no Tune candidate captured')
		if (['root', 'scale'].includes(requested) && focused.kind !== requested) {
			return this.captureFail(requested, `Expected Scale ${requested === 'root' ? 'Root' : 'Type'} but focused label is ${focused.name}`)
		}
		const evidence = { ...focused, capturedAtMs: this.now(), unverified: true,
			pluginIdentityVerified: false, parameterAddressVerified: false }
		this.lastCapture = evidence
		if (requested !== 'raw' && focused.kind) this.captures[focused.kind] = evidence
		this.captureAttempt = { requested, result: 'captured', atMs: this.now() }
		this.publish({
			tune_debug_root_candidate_text: this.captures.root?.text ?? '',
			tune_debug_scale_candidate_text: this.captures.scale?.text ?? '',
			tune_debug_last_capture_json: JSON.stringify(evidence),
			tune_last_error: BLOCK_REASON,
		})
		this.exportEvidence()
		this.instance._log?.('info', '[TUNE_DIAGNOSTIC_CAPTURE]', {
			requested, label: focused.name, contextVersion: focused.contextVersion,
			unverified: true, rawValue: focused.rawValue, text: focused.text,
		})
		return true // Success of LOCAL diagnostic capture, never success of remote setting.
	}

	captureFail(requested, message) {
		this.captureAttempt = { requested, result: 'incomplete', atMs: this.now(), error: message }
		this.exportEvidence()
		return this.fail(message)
	}

	fail(message) {
		this.publish({ tune_last_error: message,
			tune_status: this.connected() ? 'blocked_unaddressable' : 'disconnected',
			tune_controller_available: false })
		this.instance._log?.('warn', '[TUNE_UNAVAILABLE]', { reason: message })
		return false
	}

	// V9: statically supported 17 enharmonic spelling choices; this is an
	// inspection action, NOT an attempt to read the selected plugin's Root.
	inspectRoot(requestedRoot = 'C') {
		let report
		try {
			report = buildRootCapabilityReport({
				requestedRoot,
				connected: this.connected(),
				controllerState: this.instance._prolinkObservations?.controllerState,
			})
		} catch {
			return this.fail('Invalid Tune root spelling for V9 diagnostic')
		}
		this.publish({
			tune_root_analysis_json: JSON.stringify(report),
			tune_root_remote_status: 'unavailable_unverified',
		})
		this.instance._log?.('info', '[TUNE_ROOT_CAPABILITY]', {
			requestedRoot, staticAutomationIndex: report.selected.automationIndex,
			currentRootKnown: false, remoteRootSetterVerified: false, readOnly: true,
		})
		return true
	}

	requestWrite({ root, scale } = {}) {
		if (root !== undefined && !ROOT_BY_ID.has(root)) return this.fail('Invalid Tune root selection')
		if (scale !== undefined && !VERIFIED_SCALES.some(x => x.id === scale)) return this.fail('Invalid Tune scale selection')
		if (root === undefined && scale === undefined) return this.fail('No Tune target given')
		// Targets are explicitly REQUESTED ONLY; actual observed plugin values stay unknown.
		this.publish({
			...(root === undefined ? {} : { tune_target_root: root }),
			...(scale === undefined ? {} : { tune_target_scale: scale }),
		})
		return this.fail(BLOCK_REASON)
	}

	readKey() {
		return this.fail('Confirmed Tune key unavailable: focused ProLink controller notifications contain no plugin instance identity')
	}
}

module.exports = { ProLinkTuneDiagnostics, detectTuneField, ROOTS, SCALES, BLOCK_REASON }
