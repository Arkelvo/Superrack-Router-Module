jest.mock('@companion-module/base', () => ({
	...jest.requireActual('@companion-module/base'),
	InstanceBase: class {},
	runEntrypoint: jest.fn(),
}))
const ModuleInstance = require('../main')
const actions = require('../actions')
const upgrades = require('../upgrades')

function instance(config = {}) {
	const self = new ModuleInstance({})
	Object.assign(self, {
		config,
		setVariableValues: jest.fn(),
		_log: jest.fn(),
		updateStatus: jest.fn(),
		saveConfig: jest.fn(),
		setActionDefinitions: jest.fn(),
		checkFeedbacks: jest.fn(),
	})
	self._prolinkReady = true
	self._prolink.send = jest.fn(() => 0)
	return self
}

test.each([
	[1, 0],
	[8, 7],
	[64, 63],
	['8', 7],
])('rack %s maps to wire ID %s without MIDI', async (rack, wireId) => {
	const self = instance({ controlTransport: 'prolink' })
	await self.routeRack(rack)
	expect(self._prolink.send).toHaveBeenCalledWith('ShowRackByID', wireId)
	expect(self.setVariableValues.mock.calls.some(([values]) => 'midi_last_type' in values)).toBe(false)
	// Existing users may trigger Generic-MIDI from this variable: never pulse it for ProLink.
	expect(self.setVariableValues.mock.calls.some(([values]) => 'last_action_timestamp' in values)).toBe(false)
	expect(self.setVariableValues.mock.calls.some(([values]) => 'prolink_last_send_timestamp' in values)).toBe(true)
	expect(self.state.lastRoutedRacks).toEqual([Number(rack)])
})

test.each([0, -1, 65, '2bad', 1.5, null, ''])('invalid/None rack %s never sends', async (rack) => {
	const self = instance({ controlTransport: 'prolink' })
	await self.routeRack(rack)
	expect(self._prolink.send).not.toHaveBeenCalled()
	expect(self.state.lastRoutedRacks).toEqual([])
})

test('legacy MIDI actions and maps work without transport config', async () => {
	const self = instance({ racks: [null, { id: 1, value: 12 }] })
	self._applyConfigToLocalScopes()
	await self.routeRack(1)
	expect(self._prolink.send).not.toHaveBeenCalled()
	expect(self.setVariableValues.mock.calls.filter(([v]) => 'midi_last_type' in v)).toHaveLength(2)
	expect(self.rackMap).toEqual(self.config.racks)
	const result = upgrades.at(-1)(null, { config: self.config })
	expect(result.updatedConfig.controlTransport).toBe('midi')
	expect(result.updatedConfig.racks).toEqual(self.config.racks)
	expect(upgrades.at(-1)(null, { config: { controlTransport: 'prolink' } }).updatedConfig).toBeNull()
})

test('channel mapping reuses rack path and missing mapping sends nothing', async () => {
	const self = instance({ controlTransport: 'prolink' })
	self.rackMap = [null, { id: 8, value: 12 }]
	actions(self)
	const defs = self.setActionDefinitions.mock.calls[0][0]
	await defs.trigger_channel.callback({ options: { channel: '12' } })
	await defs.trigger_channel.callback({ options: { channel: '13' } })
	expect(self._prolink.send.mock.calls).toEqual([['ShowRackByID', 7]])
})

test('disconnected or restarting service does not mark action as sent', async () => {
	const self = instance({ controlTransport: 'prolink' })
	self._prolink.send.mockImplementation(() => {
		throw new Error('not connected')
	})
	await self.routeRack(1)
	expect(self.state.lastRoutedRacks).toEqual([])
	expect(self.state.lastActionTimestamp).toBe(0)
	expect(self.state.failedStepsTotal).toBe(1)
	self._prolinkReady = false
	self._prolink.send.mockClear()
	await self.routeRack(1)
	expect(self._prolink.send).not.toHaveBeenCalled()
})

test('hot slots have no invented ProLink mapping or MIDI fallback', async () => {
	const self = instance({ controlTransport: 'prolink' })
	await self.routeSnapshot(1)
	await self.routePlugin(1)
	expect(self._prolink.send).not.toHaveBeenCalled()
	expect(self.setVariableValues.mock.calls.some(([v]) => 'midi_last_type' in v)).toBe(false)
	expect(self.state.failedStepsTotal).toBe(2)
})

test('explicit snapshot actions preserve provider IDs and require independent gates', async () => {
	const self = instance({ controlTransport: 'prolink' })
	actions(self)
	const defs = self.setActionDefinitions.mock.calls[0][0]
	await defs.prolink_recall_snapshot.callback({ options: { snapshotId: 63 } })
	await defs.prolink_highlight_snapshot.callback({ options: { snapshotId: 0 } })
	expect(self._prolink.send).not.toHaveBeenCalled()
	self.config.prolinkHighlightEnabled = true
	await defs.prolink_highlight_snapshot.callback({ options: { snapshotId: 0 } })
	await defs.prolink_recall_snapshot.callback({ options: { snapshotId: 63 } })
	expect(self._prolink.send.mock.calls).toEqual([['HighlightSnapshot', 0]])
	self.config.prolinkRecallEnabled = true
	await defs.prolink_recall_snapshot.callback({ options: { snapshotId: 63 } })
	expect(self._prolink.send).toHaveBeenLastCalledWith('RecallSnapshot', 63)
	await defs.prolink_recall_snapshot.callback({ options: { snapshotId: -1 } })
	expect(self._prolink.send).toHaveBeenCalledTimes(2)
	self.config.controlTransport = 'midi'
	await defs.prolink_recall_snapshot.callback({ options: { snapshotId: 63 } })
	expect(self._prolink.send).toHaveBeenCalledTimes(2)
})

test('switching transport cancels pending MIDI sequence without stale success state', async () => {
	jest.useFakeTimers()
	try {
		const self = instance()
		const running = self.routeRack(1)
		self.config = { controlTransport: 'prolink' }
		self._applyConfigToLocalScopes(true)
		await jest.runAllTimersAsync()
		await running
		expect(self.setVariableValues.mock.calls.filter(([v]) => 'midi_last_type' in v)).toHaveLength(1)
		expect(self.state.lastRoutedRacks).toEqual([])
	} finally {
		jest.useRealTimers()
	}
})

test('late initialization cannot restart ProLink after destroy', async () => {
	const self = instance({ controlTransport: 'prolink' })
	self._destroyed = true
	self._prolink.start = jest.fn()
	await self._configureTransport()
	expect(self._prolink.start).not.toHaveBeenCalled()
})
