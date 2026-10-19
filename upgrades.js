module.exports = [
	function (context, props) {
		const cfg = { ...props.config }
		let changed = false
		if (!cfg.logLevel) {
			cfg.logLevel = 'info'
			changed = true
		}
		if (!cfg.maxRacks) {
			cfg.maxRacks = 64
			changed = true
		}
		if (cfg.host || cfg.port) {
			// old demo fields
			delete cfg.host
			delete cfg.port
			changed = true
		}
		return {
			updatedConfig: changed ? cfg : null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
	function (_context, props) {
		return {
			updatedConfig: props.config?.controlTransport == null ? { ...props.config, controlTransport: 'midi' } : null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
]
