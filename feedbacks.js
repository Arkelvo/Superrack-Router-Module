const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	const observed = (variable, value) =>
		self.config?.controlTransport === 'prolink' &&
		self._prolink?.state === 'connected' &&
		self._prolinkObservations?.statuses.get(variable) === JSON.stringify(value)

	self.setFeedbackDefinitions({
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
