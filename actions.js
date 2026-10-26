const { resolveRackForChannel } = require('./lib/midi-map')
const { createProLinkSnapshotActions } = require('./lib/prolink-snapshot-actions')
const { VERIFIED_SCALES } = require('./lib/prolink-tune-scale-control')
const { TARGET_CHOICES } = require('./lib/prolink-discrete-control')
const { ROOT_SPELLINGS } = require('./lib/prolink-tune-root-model')
const { evaluateFocusedControllerWrite } = require('./lib/prolink-controller-capabilities')

// Rate-limit identical guard diagnostics without rate-limiting the guard itself.
const WRITE_BLOCK_LOG_INTERVAL_MS = 10_000

// Only these commands are enabled by the experimental ProLink action layer.
const EXTENSION_RANGES = Object.freeze({
	NavigatePlugin: [0, 1],
	NavigateRack: [0, 1], // Live verified: 0 = next, 1 = previous.
	SetTempo: [40, 500], // Live-verified Waves BPM limits.
	GetRackName: [0, 63], // Raw provider uiTrackID, not necessarily rack ordinal.
	GetRacksInfo: [0, 63],
	GetSnapshotName: [0, 2147483647],
})
const EXTENSION_NO_ARGUMENT = new Set([
	'ShowPlugin',
	'GetNumRacks',
	'GetCurrentSnapshotNumber',
	'GetListOfSnapshots',
	'GetCPUUsage',
	'GetSessionDirtyState',
])

module.exports = function (self) {
	// Register against the existing ModuleInstance without modifying main.js.
	self.runProlinkExtension = function (command, value) {
		if (command === 'RequestControllerInfoUpdates') {
			if (typeof value !== 'boolean') return self._controlFailure('Controller subscription requires a boolean')
			return self._sendProlink(command, value)
		}
		if (EXTENSION_NO_ARGUMENT.has(command)) {
			if (value !== undefined) return self._controlFailure('Unexpected ProLink argument')
			return self._sendProlink(command)
		}
		const range = EXTENSION_RANGES[command]
		if (!range) return self._controlFailure('Unsupported ProLink extension command')
		const number = self._prolinkId(value, range[0], range[1])
		if (number === null) return self._controlFailure(`Invalid ${command} argument`)
		return self._sendProlink(command, number)
	}

	// Focus-bound relative control only; no arbitrary rack, slot or parameter ID.
	// Require live controller properties and value to avoid blind manipulation.
	self.changeFocusedProlinkController = function (direction, steps) {
		const sign = Number(direction)
		const amount = Number(steps)
		if (![1, -1].includes(sign) || !Number.isInteger(amount) || amount < 1 || amount > 8) {
			return self._controlFailure('Controller adjustment requires direction +/-1 and 1..8 whole steps')
		}
		const observer = self._prolinkObservations
		const controller = observer?.controllerState
		const assessment = evaluateFocusedControllerWrite({
			controller,
			connected: self.config?.controlTransport === 'prolink' && self._prolink?.state === 'connected' &&
				!self._destroyed && self._prolinkReady !== false,
			pending: observer?.controllerWrite ?? null,
		})
		if (!assessment.allowed) {
			self.setVariableValues?.({
				prolink_controller_write_status: assessment.status,
				prolink_controller_write_guard_reason: assessment.reason,
			})
			const name = controller?.properties?.values?.[0] ?? ''
			const key = JSON.stringify([assessment.status, name, controller?.contextVersion ?? null, assessment.reason])
			const now = Date.now()
			const previous = self._prolinkWriteBlockLog
			if (!previous || previous.key !== key || now - previous.atMs >= WRITE_BLOCK_LOG_INTERVAL_MS ||
				now < previous.atMs) {
				self._log?.('warn', '[PROLINK_CONTROLLER_WRITE_BLOCKED]', {
					status: assessment.status, reason: assessment.reason, name,
					suppressedRepeatCount: previous?.key === key ? previous.suppressed : 0,
				})
				self._prolinkWriteBlockLog = { key, atMs: now, suppressed: 0 }
			} else {
				previous.suppressed++
			}
			// _controlFailure otherwise repeats the same warning in plain text.
			// Failed-step accounting and user-visible status remain unchanged.
			return self._controlFailure(assessment.reason, { suppressLog: true })
		}
		const contextVersion = controller.contextVersion
		const previousSignature = controller.value.signature
		const delta = sign * amount
		if (self._sendProlink('ChangeControllerValue', delta) !== true) return false
		self._prolinkObservations.trackControllerWrite({ delta, contextVersion, previousSignature })
		return true
	}

	// EXPERIMENTAL discrete switch probe. The static SuperRack binary analysis
	// identifies SwitchControllerValue(id, OSC true) as a single step on the
	// focused switchable control; only a live value change can support success.
	// This action never sends OSC false: it is a documented no-op, NOT a release.
	self.probeFocusedDiscreteSwitch = function (target) {
		const allowedTargets = {
			tune_scale: { plugin: 'Tune RT', name: 'Scale Type', count: 44 },
			cla76_analog: { plugin: 'CLA-76', name: 'Analog', count: 3 },
		}
		const expected = Object.hasOwn(allowedTargets, target) ? allowedTargets[target] : null
		if (!expected) return self._controlFailure('Unknown discrete switch probe target')
		if (self._destroyed || self.config?.controlTransport !== 'prolink' ||
			self._prolink?.state !== 'connected' || self._prolinkReady !== true) {
			return self._controlFailure('Switch probe blocked: ProLink is not connected and ready')
		}
		const observer = self._prolinkObservations
		const controller = observer?.controllerState
		const properties = controller?.properties
		const value = controller?.value
		if (!properties || !value || properties.values?.length !== 13 ||
			properties.values[0] !== expected.name ||
			properties.values[10] !== expected.plugin ||
			properties.values[1] !== false || properties.values[2] !== expected.count) {
			return self._controlFailure('Switch probe blocked: focused controller does not match selected verified test shape')
		}
		const now = Date.now()
		const ageProperties = now - properties.lastSeenAtMs
		const ageValue = now - value.lastSeenAtMs
		if (ageProperties < 0 || ageValue < 0 || ageProperties > 3000 || ageValue > 3000) {
			return self._controlFailure('Switch probe blocked: controller properties/value not fresh within 3 seconds')
		}
		if (observer.controllerWrite || self._tuneScaleControl?.pending || self._discreteControl?.pending) return self._controlFailure('Switch probe blocked: previous controller write pending')
		const last = self._prolinkDiscreteSwitchLastSend
		if (last && last.contextVersion === controller.contextVersion &&
			now >= last.atMs && now - last.atMs < 2000) {
			return self._controlFailure('Switch probe blocked: wait 2 seconds between probes')
		}
		const contextVersion = controller.contextVersion
		const previousSignature = value.signature
		const before = value.values[0]
		if (self._discreteEvidence && !self._discreteEvidence.begin(expected)) {
			return self._controlFailure('Switch probe blocked: evidence capture could not validate focused controller')
		}
		if (self._sendProlink('SwitchControllerValue', true) !== true) {
			self._discreteEvidence?.finish('send_failed', null)
			return false
		}
		self._prolinkDiscreteSwitchLastSend = { atMs: now, contextVersion }
		observer.trackControllerWrite({
			command: 'SwitchControllerValue', delta: 'switch_touch', contextVersion, previousSignature,
		})
		self._log?.('info', '[PROLINK_DISCRETE_SWITCH_PROBE_SENT]', {
			target, name: expected.name, plugin: expected.plugin, before,
			contextVersion, confirmed: false,
		})
		return true
	}

	// Available only after a validated GiveListOfSnapshot. These choices
	// are provider IDs, not a MIDI hot-snapshot slot or request sequence.
	const snapshots = self._prolinkObservations?.snapshots
	const snapshotChoices = (snapshots?.listKnown ? snapshots.listEntries : []).map(({ id, name }) => ({
		id: String(id), label: `${name || '(unnamed)'} [ID ${id}]`,
	}))
	self.routeKnownProlinkSnapshot = function (command, id) {
		const providerId = self._prolinkId(id, 0, 2147483647)
		if (providerId === null || !self._prolinkObservations?.snapshots?.listKnown ||
			!self._prolinkObservations.snapshots.listEntries.some(entry => entry.id === providerId)) {
			return self._controlFailure('Snapshot ID is not in the observed list; refresh GetListOfSnapshots first')
		}
		return self.routeProlinkSnapshot(command, providerId)
	}

	const rackChoices = self._buildRackChoices ? self._buildRackChoices() : []
	const hotSnapshotChoices = self._buildHotSnapshotChoices ? self._buildHotSnapshotChoices() : []
	const hotPluginChoices = self._buildHotPluginChoices ? self._buildHotPluginChoices() : []

	self.setActionDefinitions({
		// Tune Real-Time: ProLink cannot address a plugin parameter by ID.
		// These deliberately guarded actions NEVER emit a controller delta.
		tune_set_root: {
			name: 'Tune (BLOCKED): Request Root – no remote write',
			options: [{ id: 'root', type: 'dropdown', label: 'Requested root (static mapping only; NO OSC write)',
				choices: ROOT_SPELLINGS.map(({ id, label }) => ({ id, label })), default: 'C' }],
			callback: async event => self._tuneDiagnostics?.requestWrite({ root: event.options.root }) ?? false,
		},
		tune_set_scale: {
			name: 'Tune: Set Scale (focused Scale Type; cyclic, readback confirmed)',
			options: [{ id: 'scale', type: 'dropdown', label: 'Tune RT scale (44 choices; forward steps with wrap)',
				choices: VERIFIED_SCALES.map(({ id, label }) => ({ id, label })), default: 'major' }],
			callback: async event => self._tuneScaleControl
				? self._tuneScaleControl.setScale(event.options.scale)
				: self._tuneDiagnostics?.requestWrite({ scale: event.options.scale }) ?? false,
		},
		tune_set_key: {
			name: 'Tune (BLOCKED): Request Key – no remote write',
			options: [
				{ id: 'root', type: 'dropdown', label: 'Requested root', choices: ROOT_SPELLINGS.map(({ id, label }) => ({ id, label })), default: 'C' },
				{ id: 'scale', type: 'dropdown', label: 'Requested scale (key write BLOCKED)',
					choices: VERIFIED_SCALES.map(({ id, label }) => ({ id, label })), default: 'major' },
			],
			callback: async event => self._tuneDiagnostics?.requestWrite({
				root: event.options.root, scale: event.options.scale,
			}) ?? false,
		},
		tune_root_inspect: {
			name: 'Tune V9: Inspect Root mapping and remote capability (READ-ONLY)',
			options: [{ id: 'root', type: 'dropdown',
				label: 'Root spelling to inspect (static automation index; NOT an OSC target)',
				choices: ROOT_SPELLINGS.map(({ id, label }) => ({ id, label })), default: 'C' }],
			callback: async event => self._tuneDiagnostics?.inspectRoot(event.options.root) ?? false,
		},
		tune_read_key: {
			name: 'Tune: Read confirmed current key (reports unavailable when not verifiable)',
			options: [],
			callback: async () => self._tuneDiagnostics?.readKey() ?? false,
		},
		tune_capture_focus: {
			name: 'Tune DEBUG: Capture recent focused controller (read-only, unverified)',
			options: [{ id: 'field', type: 'dropdown', label: 'Label expected on currently focused controller',
				choices: [
					{ id: 'auto', label: 'Detect Scale Root / Scale Type label' },
					{ id: 'root', label: 'Scale Root (exact label required)' },
					{ id: 'scale', label: 'Scale Type (exact label required)' },
					{ id: 'raw', label: 'Any focused controller – raw diagnostic only' },
				], default: 'auto' }],
			callback: async event => self._tuneDiagnostics?.capture(event.options.field) ?? false,
		},
		tune_trace_start: {
			name: 'Tune DEBUG: Start read-only incoming ProLink trace',
			options: [{ id: 'label', type: 'dropdown', label: 'Which change will you make in SuperRack?',
				choices: [
					{ id: 'root', label: 'Root note changes (C, D, E...)' },
					{ id: 'scale', label: 'Scale changes (Major/Minor...)' },
					{ id: 'other', label: 'Other controller behavior' },
				], default: 'root' }],
			callback: async event => self._tuneDiagnostics?.startTrace(event.options.label) ?? false,
		},
		tune_trace_stop: {
			name: 'Tune DEBUG: Stop trace and export JSON (even without properties)',
			options: [],
			callback: async () => self._tuneDiagnostics?.stopTrace() ?? false,
		},
		prolink_focus_audit_start: {
			name: 'ProLink DEBUG: Start read-only focus audit', options: [],
			callback: async () => self._focusAudit?.start() ?? false,
		},
		prolink_focus_audit_mark: {
			name: 'ProLink DEBUG: Mark focus audit checkpoint (read-only)',
			options: [{ id: 'checkpoint', type: 'dropdown', label: 'Action just performed in SuperRack',
				choices: [
					{ id: 'before_navigation', label: 'Before plugin navigation' },
					{ id: 'after_navigation', label: 'After plugin navigation' },
					{ id: 'after_plugin_selection', label: 'After selecting plugin surface' },
					{ id: 'after_controller_click', label: 'After clicking Scale Type / another knob' },
					{ id: 'after_root_click', label: 'After clicking Scale Root note' },
					{ id: 'after_refresh', label: 'After controller subscription refresh' },
					{ id: 'other', label: 'Other observation' },
				], default: 'other' }],
			callback: async event => self._focusAudit?.mark(event.options.checkpoint) ?? false,
		},
		prolink_focus_audit_stop: {
			name: 'ProLink DEBUG: Stop focus audit and export JSON', options: [],
			callback: async () => self._focusAudit?.stop() ?? false,
		},
		tune_refresh_focus: {
			name: 'Tune DEBUG: Request focused controller updates (not a parameter read)',
			options: [],
			callback: async () => self.runProlinkExtension('RequestControllerInfoUpdates', true),
		},
		...createProLinkSnapshotActions(self),
		...Object.fromEntries(
			[
				['prolink_recall_snapshot', 'RecallSnapshot', 'ProLink: Recall snapshot by provider ID'],
				['prolink_highlight_snapshot', 'HighlightSnapshot', 'ProLink: Highlight snapshot by provider ID'],
			].map(([key, command, name]) => [
				key,
				{
					name,
					options: [{
						id: 'snapshotId', type: 'number',
						label: 'Snapshot provider ID (unchanged, not a MIDI hot slot)',
						min: 0, max: 2147483647, default: 0,
					}],
					callback: async (event) => self.routeProlinkSnapshot(command, event.options.snapshotId),
				},
			]),
		),
		...Object.fromEntries([
			['prolink_recall_snapshot_named', 'RecallSnapshot', 'Recall'],
			['prolink_highlight_snapshot_named', 'HighlightSnapshot', 'Highlight'],
		].map(([key, command, verb]) => [key, {
			name: `ProLink: ${verb} snapshot from observed list`,
			options: [{
				id: 'snapshotId', type: 'dropdown', label: 'Snapshot (SuperRack live list)',
				choices: snapshotChoices, default: snapshotChoices[0]?.id,
			}],
			callback: async event => self.routeKnownProlinkSnapshot(command, event.options.snapshotId),
		}])),
		prolink_navigate_plugin: {
			name: 'ProLink: Navigate plugin in selected rack',
			options: [{ id: 'direction', type: 'dropdown', label: 'Direction', choices: [
				{ id: 0, label: 'Next occupied plugin' },
				{ id: 1, label: 'Previous occupied plugin' },
			], default: 0 }],
			callback: async (event) => self.runProlinkExtension('NavigatePlugin', event.options.direction),
		},
		prolink_navigate_rack: {
			name: 'ProLink: Navigate rack',
			options: [{ id: 'direction', type: 'dropdown', label: 'Direction', choices: [
				{ id: 0, label: 'Next rack' }, { id: 1, label: 'Previous rack' },
			], default: 0 }],
			callback: async (event) => self.runProlinkExtension('NavigateRack', event.options.direction),
		},
		prolink_show_plugin: {
			name: 'ProLink: Show currently selected plugin',
			options: [], callback: async () => self.runProlinkExtension('ShowPlugin'),
		},
		prolink_set_tempo: {
			name: 'ProLink: Set BPM',
			options: [{ id: 'bpm', type: 'number', label: 'BPM', min: 40, max: 500, default: 120 }],
			callback: async (event) => self.runProlinkExtension('SetTempo', event.options.bpm),
		},
		prolink_tap_tempo: {
			name: 'ProLink: Tap Tempo',
			options: [],
			callback: async () => self.tapProlinkTempo(),
		},
		...Object.fromEntries([
			['prolink_get_rack_count', 'GetNumRacks', 'Get rack count'],
			['prolink_get_current_snapshot', 'GetCurrentSnapshotNumber', 'Get current snapshot number'],
			['prolink_get_snapshots', 'GetListOfSnapshots', 'Get snapshot list'],
			['prolink_get_cpu', 'GetCPUUsage', 'Get CPU usage'],
			['prolink_get_session_dirty', 'GetSessionDirtyState', 'Get session dirty state'],
		].map(([key, command, title]) => [key, {
			name: `ProLink: ${title}`, options: [], callback: async () => self.runProlinkExtension(command),
		}])),
		...Object.fromEntries([
			['prolink_get_rack_name', 'GetRackName', 'Get rack name by raw uiTrackID', 63],
			['prolink_get_rack_info', 'GetRacksInfo', 'Get rack information by raw provider index', 63],
			['prolink_get_snapshot_name', 'GetSnapshotName', 'Get snapshot name by provider ID', 2147483647],
		].map(([key, command, title, max]) => [key, {
			name: `ProLink: ${title}`, options: [{
				id: 'providerId', type: 'number', label: 'Raw provider ID (0-based)', min: 0, max, default: 0,
			}],
			callback: async (event) => self.runProlinkExtension(command, event.options.providerId),
		}])),
		prolink_controller_inspect: {
			name: 'ProLink: Inspect focused controller write capability (read-only)',
			options: [],
			callback: async () => self._prolinkObservations?.publishControllerCapability() ?? false,
		},
		prolink_discrete_evidence_export: {
			name: 'ProLink V10: Export focused discrete switch evidence (READ-ONLY)',
			options: [],
			callback: async () => { self._discreteEvidence?.publish(); return !!self._discreteEvidence },
		},
		prolink_discrete_evidence_clear: {
			name: 'ProLink V10: Clear local switch evidence (READ-ONLY)',
			options: [],
			callback: async () => self._discreteEvidence?.clear() ?? false,
		},
		prolink_discrete_set_target: {
			name: 'ProLink V11: Set focused discrete controller value (verified profiles, observed)',
			options: [{ id: 'target', type: 'dropdown', label: 'Target (requires manual focus on matching plugin controller)',
				choices: TARGET_CHOICES.map(({ id, label }) => ({ id, label })), default: 'cla76_analog:off' }],
			callback: async event => self._discreteControl?.setTarget(event.options.target) ?? false,
		},
		prolink_discrete_preview_target: {
			name: 'ProLink V12: Preview focused discrete target (READ-ONLY)',
			options: [{ id: 'target', type: 'dropdown', label: 'Verified profile target (no command sent)',
				choices: TARGET_CHOICES.map(({ id, label }) => ({ id, label })), default: 'cla76_analog:off' }],
			callback: async event => self._discreteControl?.previewTarget(event.options.target) ?? false,
		},
		prolink_discrete_switch_probe: {
			name: 'ProLink EXPERIMENT: Switch focused discrete controller (one touch)',
			options: [{
				id: 'target', type: 'dropdown', label: 'Required focused controller (one manual test step)',
				choices: [
					{ id: 'tune_scale', label: 'Tune RT — Scale Type only' },
					{ id: 'cla76_analog', label: 'CLA-76 — Analog only' },
				], default: 'tune_scale',
			}],
			callback: async event => self.probeFocusedDiscreteSwitch(event.options.target),
		},
		prolink_controller_relative: {
			name: 'ProLink: Adjust continuous Touch-and-Turn controller (relative; discrete blocked)',
			options: [
				{
					id: 'direction', type: 'dropdown', label: 'Signed direction (live semantics to verify)',
					choices: [{ id: 1, label: 'Positive (+)' }, { id: -1, label: 'Negative (-)' }],
					default: 1,
				},
				{ id: 'steps', type: 'number', label: 'Relative delta magnitude (1-8, NOT dB)', min: 1, max: 8, default: 1 },
			],
			callback: async (event) => self.changeFocusedProlinkController(event.options.direction, event.options.steps),
		},
		prolink_controller_subscription: {
			name: 'ProLink: Subscribe to focused controller updates',
			options: [{ id: 'enabled', type: 'dropdown', label: 'Subscription', choices: [
				{ id: 'on', label: 'Enable' }, { id: 'off', label: 'Disable' },
			], default: 'on' }],
			callback: async (event) => self.runProlinkExtension('RequestControllerInfoUpdates', event.options.enabled === 'on'),
		},
		route_rack: {
			name: 'Route Rack',
			options: [{ id: 'rackId', type: 'dropdown', label: 'Rack', choices: rackChoices, default: rackChoices[0]?.id }],
			callback: async (event) => {
				self._log('info', '[ROUTE_ENTRY] route_rack invoked', { rackId: event.options.rackId })
				await self.routeRack(event.options.rackId)
			},
		},
		route_hot_snapshots: {
			name: 'Route Hot Snapshot',
			options: [{ id: 'snapshotId', type: 'dropdown', label: 'Hot Snapshot', choices: hotSnapshotChoices, default: hotSnapshotChoices[0]?.id }],
			callback: async (event) => {
				self._log('info', '[ROUTE_ENTRY] route_hot_snapshots invoked', { snapshotId: event.options.snapshotId })
				await self.routeSnapshot(event.options.snapshotId)
			},
		},
		route_hot_plugins: {
			name: 'Route Hot Plugin',
			options: [{ id: 'pluginId', type: 'dropdown', label: 'Hot Plugin', choices: hotPluginChoices, default: hotPluginChoices[0]?.id }],
			callback: async (event) => {
				self._log('info', '[ROUTE_ENTRY] route_hot_plugins invoked', { pluginId: event.options.pluginId })
				await self.routePlugin(event.options.pluginId)
			},
		},
		trigger_channel: {
			name: 'Trigger Channel',
			options: [{
				id: 'channel', type: 'textinput', label: 'Channel (Integer or Variable)',
				default: '1', required: true,
				tooltip: 'Enter the channel number or a variable (e.g. ${wing:sel_index}) to trigger (1-based index).',
			}],
			callback: async (event) => {
				let channelValue = event.options.channel
				if (typeof self.parseVariablesInString === 'function') {
					try { channelValue = await self.parseVariablesInString(channelValue) }
					catch (err) {
						self._log('error', 'Failed to parse variables', { error: err?.message || err })
						return
					}
				}
				const channel = parseInt(channelValue, 10)
				if (isNaN(channel) || channel < 1 || channel > (self.channelCount || self.maxRacks)) {
					self._log('warn', 'Invalid channel number', { input: event.options.channel, resolved: channelValue })
					return
				}
				self._log('info', '[TRIGGER_CHANNEL] input', {
					channel, rackMapType: typeof self.rackMap, isArray: Array.isArray(self.rackMap),
				})
				const rackId = resolveRackForChannel(self.rackMap, channel)
				self._log('info', '[TRIGGER_CHANNEL] lookup', { channel, rackId })
				if (rackId) await self.routeRack(rackId)
				else self._log('warn', 'No rack mapped to channel in rackMap', { channel })
			},
		},
	})
}
