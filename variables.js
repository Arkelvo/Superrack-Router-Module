module.exports = function (self) {
	self.setVariableDefinitions([
		{ variableId: 'last_routed_racks', name: 'Last requested racks (local send history, not remote confirmation)' },
		{ variableId: 'prolink_state', name: 'ProLink transport state' },
		{ variableId: 'prolink_error', name: 'ProLink connection error' },
		{ variableId: 'prolink_last_send_timestamp', name: 'Last ProLink local write attempt (ms, not acknowledgement)' },
		{ variableId: 'control_last_error', name: 'Last control action error' },
		{ variableId: 'last_action_timestamp', name: 'Last action timestamp (ms)' },
		{ variableId: 'failed_steps_total', name: 'Failed control steps (total)' },
		{ variableId: 'midi_last_type', name: 'Last MIDI type' },
		{ variableId: 'midi_last_channel', name: 'Last MIDI channel' },
		{ variableId: 'midi_last_controller', name: 'Last MIDI controller' },
		{ variableId: 'midi_last_value', name: 'Last MIDI value' },
	])
}
