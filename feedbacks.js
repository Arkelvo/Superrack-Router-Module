const { combineRgb } = require('@companion-module/base')
const { VERIFIED_SCALES } = require('./lib/prolink-tune-scale-control')
const { TARGET_CHOICES, parseTarget } = require('./lib/prolink-discrete-control')

module.exports = async function (self) {
	const observed = (variable, value) =>
		self.config?.controlTransport === 'prolink' &&
		self._prolink?.state === 'connected' &&
		self._prolinkObservations?.statuses.get(variable) === JSON.stringify(value)

	self.setFeedbackDefinitions({
		prolink_discrete_ready: {
			name: 'V11: recognized focused discrete controller currently observed', type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 110, 65), color: combineRgb(255, 255, 255) },
			callback: () => self._discreteControl?.connected() === true &&
				!!(self._discreteControl.current('cla76_analog') || self._discreteControl.current('tune_scale')),
		},
		prolink_discrete_profile_focused: {
			name: 'V12: specific verified discrete profile is currently focused', type: 'boolean',
			options: [{ id: 'profile', type: 'dropdown', label: 'Verified focused controller',
				choices: [
					{ id: 'tune_scale', label: 'Tune RT – Scale Type' },
					{ id: 'cla76_analog', label: 'CLA-76 – Analog' },
				], default: 'cla76_analog' }],
			defaultStyle: { bgcolor: combineRgb(0, 100, 65), color: combineRgb(255, 255, 255) },
			callback: ({ options }) => self._discreteControl?.connected() === true &&
				!!self._discreteControl?.current(options.profile),
		},
		prolink_discrete_matches: {
			name: 'V11: focused discrete value observed equal to selected target', type: 'boolean',
			options: [{ id: 'target', type: 'dropdown', label: 'Verified profile target',
				choices: TARGET_CHOICES.map(({ id, label }) => ({ id, label })), default: 'cla76_analog:off' }],
			defaultStyle: { bgcolor: combineRgb(0, 100, 65), color: combineRgb(255, 255, 255) },
			callback: ({ options }) => {
				const target = parseTarget(options.target)
				return !!target && self._discreteControl?.connected() === true &&
					self._discreteControl?.current(target.profileId)?.item.raw === target.item.raw
			},
		},
		prolink_discrete_busy: {
			name: 'V11: focused discrete set awaiting readback', type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(180, 95, 0), color: combineRgb(255, 255, 255) },
			callback: () => !!self._discreteControl?.pending,
		},
		prolink_discrete_failure: {
			name: 'V11: generic discrete set failed or blocked', type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(150, 35, 35), color: combineRgb(255, 255, 255) },
			callback: () => !!self._discreteControl && !['idle', 'changing', 'already_at_target', 'observed_target'].includes(self._discreteControl.lastStatus),
		},
		tune_scale_ready: {
			name: 'Tune RT Scale Type currently selected and observed', type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 110, 65), color: combineRgb(255, 255, 255) },
			callback: () => self._tuneScaleControl?.connected() === true && !!self._tuneScaleControl?.current(),
		},
		tune_scale_matches: {
			name: 'Focused Tune RT Scale Type equals selected observed scale', type: 'boolean',
			options: [{ id: 'scale', type: 'dropdown', label: 'Scale',
				choices: VERIFIED_SCALES.map(({ id, label }) => ({ id, label })), default: 'major' }],
			defaultStyle: { bgcolor: combineRgb(0, 95, 70), color: combineRgb(255, 255, 255) },
			callback: fb => self._tuneScaleControl?.connected() === true &&
				self._tuneScaleControl?.current()?.item.id === fb.options.scale,
		},
		tune_scale_busy: {
			name: 'Tune scale change is waiting for readback', type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(180, 100, 0), color: combineRgb(255, 255, 255) },
			callback: () => !!self._tuneScaleControl?.pending,
		},
		tune_scale_failure: {
			name: 'Tune scale action blocked or failed (not a confirmed state)', type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(150, 35, 35), color: combineRgb(255, 255, 255) },
			callback: () => !!self._tuneScaleControl &&
				['blocked_scale_focus', 'blocked_pending', 'invalid_target', 'target_label_mismatch',
					'focus_changed', 'unexpected_readback', 'invalid_readback', 'readback_timeout',
					'send_failed', 'step_limit', 'other_write_pending', 'command_rejected'].includes(self._tuneScaleControl.lastStatus),
		},
		tune_blocked: {
			name: 'Tune Root/Key control blocked (Scale Type focused control separate)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(150, 70, 0), color: combineRgb(255, 255, 255) },
			callback: () => self._tuneDiagnostics?.connected() === true,
		},
		tune_diagnostic_candidate: {
			name: 'Tune diagnostic: focused label is Scale Root / Scale Type (UNVERIFIED)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(40, 60, 115), color: combineRgb(255, 255, 255) },
			callback: () => self._tuneDiagnostics?.connected() === true &&
				['root', 'scale'].includes(self._tuneDiagnostics?.focused?.kind),
		},
		prolink_tap_beat: {
			name: 'ProLink Tap Tempo – local beat flash (not observed DSP phase)',
			type: 'boolean',
			options: [],
			defaultStyle: { bgcolor: combineRgb(255, 196, 0), color: combineRgb(0, 0, 0) },
			callback: () => self.config?.controlTransport === 'prolink' &&
				self._prolink?.state === 'connected' && self._tapBeat?.active === true,
		},
		prolink_connected: {
			name: 'ProLink TCP connected (not execution confirmation)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: () => self.config?.controlTransport === 'prolink' && self._prolink?.state === 'connected',
		},
		prolink_controller_observed: {
			name: 'Selected ProLink controller properties and value observed',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: () =>
				self.config?.controlTransport === 'prolink' &&
				self._prolink?.state === 'connected' &&
				self._prolinkObservations?.controllerState?.properties != null &&
				self._prolinkObservations?.controllerState?.value != null,
		},
		// Status feedbacks do not interpret protocol values as healthy/unhealthy.
		// They only report equality with actually observed Notify* payloads.
		prolink_session_dirty_observed: {
			name: 'SuperRack NotifySessionDirty = true (observed)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(190, 105, 0), color: combineRgb(255, 255, 255) },
			callback: () => observed('prolink_session_dirty', true),
		},
		prolink_snapshot_dirty_observed: {
			name: 'SuperRack NotifySnapshotDirty = true (observed)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(190, 105, 0), color: combineRgb(255, 255, 255) },
			callback: () => observed('prolink_snapshot_dirty', true),
		},
		prolink_iobox_true_observed: {
			name: 'SuperRack NotifyIOBoxStatus = true (observed, raw semantics)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: () => observed('prolink_iobox_status', true),
		},
		prolink_sgs_true_observed: {
			name: 'SuperRack NotifySGSStatus = true (observed, raw semantics)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: () => observed('prolink_sgs_status', true),
		},
		prolink_monitor_cpu_observed: {
			name: 'ProLink CPU getter response received (raw, not percentage)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: () => self._prolink?.state === 'connected' &&
				self._prolinkObservations?.monitoring?.statuses.get('GetCPUUsage') === 'received',
		},
		prolink_monitor_query_issue: {
			name: 'ProLink monitoring query not confirmed (diagnostic)',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(180, 85, 0), color: combineRgb(255, 255, 255) },
			callback: () => self._prolink?.state === 'connected' &&
				self._prolinkObservations?.monitoring?.hasIssue() === true,
		},
		prolink_rack_muted: {
			name: 'SuperRack rack muted (observed)',
			type: 'boolean',
			options: [{ id: 'rackId', type: 'number', label: 'Rack (1–64)', min: 1, max: 64, default: 1 }],
			defaultStyle: { bgcolor: combineRgb(160, 0, 0), color: combineRgb(255, 255, 255) },
			callback: (fb) =>
				self._prolink?.state === 'connected' &&
				self._prolinkObservations?.racks.get(Number(fb.options.rackId))?.muted === true,
		},
		prolink_rack_on: {
			name: 'SuperRack rack on (observed)',
			type: 'boolean',
			options: [{ id: 'rackId', type: 'number', label: 'Rack (1–64)', min: 1, max: 64, default: 1 }],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: (fb) =>
				self._prolink?.state === 'connected' &&
				self._prolinkObservations?.racks.get(Number(fb.options.rackId))?.on === true,
		},
		active_source: {
			name: 'active source',
			type: 'boolean', label: 'active source',
			options: [{ id: 'sourceIndex', type: 'number', label: 'Source Index' }],
			defaultStyle: { bgcolor: combineRgb(0, 100, 0), color: combineRgb(255, 255, 255) },
			callback: (fb) => fb.options.sourceIndex === self.state.activeSourceIndex,
		},
		rack_last_used: {
			name: 'last used rack',
			type: 'boolean', label: 'last used rack',
			options: [{ id: 'rackId', type: 'number', label: 'Rack ID' }],
			defaultStyle: { bgcolor: combineRgb(80, 0, 80), color: combineRgb(255, 255, 255) },
			callback: (fb) => self.state.lastRoutedRacks.includes(fb.options.rackId),
		},
		sequence_running: {
			name: 'sequence running',
			type: 'boolean', options: [],
			defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(0, 0, 0) },
			callback: () => self.state.sequenceRunning === true,
		},
	})
}
