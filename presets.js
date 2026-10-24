const { combineRgb } = require('@companion-module/base')

// Companion 4.1 / module API 1.x preset format. Registered AFTER actions and feedbacks.
module.exports = function (self) {
	self.setPresetDefinitions({
		prolink_tap_tempo: {
			type: 'button',
			category: 'ProLink – Tempo',
			name: 'Tap Tempo (BPM and beat flash)',
			style: {
				text: `TAP\n$(${self.label}:prolink_tap_display_bpm) BPM`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(20, 25, 35),
			},
			steps: [{
				down: [{ actionId: 'prolink_tap_tempo', options: {} }],
				up: [],
			}],
			feedbacks: [{
				feedbackId: 'prolink_tap_beat',
				options: {},
				style: { bgcolor: combineRgb(61, 128, 255), color: combineRgb(255, 255, 255) },
			}],
		},
	})
}
