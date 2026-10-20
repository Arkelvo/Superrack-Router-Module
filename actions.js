const { resolveRackForChannel } = require('./lib/midi-map')

// Only these commands are enabled by the experimental ProLink action layer.
const EXTENSION_RANGES = Object.freeze({
	NavigatePlugin: [0, 1],
	NavigateRack: [0, 1], // Live verified: 0 = next, 1 = previous.
	SetTempo: [20, 300], // Conservative UI limit, not a known protocol limit.
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
		const controller = self._prolinkObservations?.controllerState
		if (!controller?.properties || !controller?.value) {
			return self._controlFailure('No selected controller properties and value observed; subscribe and select a control first')
		}
		const delta = sign * amount
		const contextVersion = controller.contextVersion
		const previousSignature = controller.value.signature
		if (self._sendProlink('ChangeControllerValue', delta) !== true) return false
		self._prolinkObservations.trackControllerWrite({ delta, contextVersion, previousSignature })
		return true
	}

	const rackChoices = self._buildRackChoices ? self._buildRackChoices() : []
	const hotSnapshotChoices = self._buildHotSnapshotChoices ? self._buildHotSnapshotChoices() : []
	const hotPluginChoices = self._buildHotPluginChoices ? self._buildHotPluginChoices() : []

	self.setActionDefinitions({
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
			name: 'ProLink: Set BPM (does not reset beat phase)',
			options: [{ id: 'bpm', type: 'number', label: 'BPM', min: 20, max: 300, default: 120 }],
			callback: async (event) => self.runProlinkExtension('SetTempo', event.options.bpm),
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
		prolink_controller_relative: {
			name: 'ProLink: Adjust selected Touch-and-Turn controller (relative)',
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
