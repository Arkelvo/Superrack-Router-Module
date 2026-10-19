const { resolveRackForChannel } = require('./lib/midi-map')

module.exports = function (self) {
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
					options: [
						{
							id: 'snapshotId',
							type: 'number',
							label: 'Snapshot provider ID (unchanged, not a MIDI hot slot)',
							min: 0,
							max: 2147483647,
							default: 0,
						},
					],
					callback: async (event) => self.routeProlinkSnapshot(command, event.options.snapshotId),
				},
			]),
		),
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
			options: [
				{
					id: 'snapshotId',
					type: 'dropdown',
					label: 'Hot Snapshot',
					choices: hotSnapshotChoices,
					default: hotSnapshotChoices[0]?.id,
				},
			],
			callback: async (event) => {
				self._log('info', '[ROUTE_ENTRY] route_hot_snapshots invoked', { snapshotId: event.options.snapshotId })
				await self.routeSnapshot(event.options.snapshotId)
			},
		},
		route_hot_plugins: {
			name: 'Route Hot Plugin',
			options: [
				{
					id: 'pluginId',
					type: 'dropdown',
					label: 'Hot Plugin',
					choices: hotPluginChoices,
					default: hotPluginChoices[0]?.id,
				},
			],
			callback: async (event) => {
				self._log('info', '[ROUTE_ENTRY] route_hot_plugins invoked', { pluginId: event.options.pluginId })
				await self.routePlugin(event.options.pluginId)
			},
		},
		trigger_channel: {
			name: 'Trigger Channel',
			options: [
				{
					id: 'channel',
					type: 'textinput',
					label: 'Channel (Integer or Variable)',
					default: '1',
					required: true,
					tooltip: 'Enter the channel number or a variable (e.g. ${wing:sel_index}) to trigger (1-based index).',
				},
			],
			callback: async (event) => {
				let channelValue = event.options.channel
				if (typeof self.parseVariablesInString === 'function') {
					try {
						channelValue = await self.parseVariablesInString(channelValue)
					} catch (err) {
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
					channel,
					rackMapType: typeof self.rackMap,
					isArray: Array.isArray(self.rackMap),
				})
				// rackMap is indexed by rack ID: rackMap[rackId] = { id: rackId, value: channelId }
				// We need to find the rack whose .value matches the incoming channel
				const rackId = resolveRackForChannel(self.rackMap, channel)
				self._log('info', '[TRIGGER_CHANNEL] lookup', { channel, rackId })
				if (rackId) {
					await self.routeRack(rackId)
				} else {
					self._log('warn', 'No rack mapped to channel in rackMap', { channel })
				}
			},
		},
	})
}
