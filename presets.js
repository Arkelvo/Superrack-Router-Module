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

		// Generic ProLink Controller Preset
		prolink_controller_generic: {
			type: 'button',
			category: 'ProLink – Controller',
			name: 'Generic Controller (Switch + Relative)',
			style: {
				text: `CTRL\n$(${self.label}:prolink_controller_name)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 60, 90),
			},
			steps: [{
				down: [
					{ actionId: 'prolink_controller_switch', options: { state: 1 } },
					{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 1 } },
				],
				up: [
					{ actionId: 'prolink_controller_switch', options: { state: 0 } },
				],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// Waves Tune RT Preset
		prolink_tune_rt: {
			type: 'button',
			category: 'ProLink – Tune RT',
			name: 'Waves Tune RT (Pitch Correction)',
			style: {
				text: `TUNE RT\n$(${self.label}:prolink_controller_name)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(180, 40, 40),
			},
			steps: [
				{
					down: [{ actionId: 'prolink_controller_switch', options: { state: 1 } }],
					up: [{ actionId: 'prolink_controller_switch', options: { state: 0 } }],
				},
				{
					down: [{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 1 } }],
					up: [],
				},
			],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// Waves CLA-76 Preset
		prolink_cla76: {
			type: 'button',
			category: 'ProLink – CLA-76',
			name: 'Waves CLA-76 (Compressor)',
			style: {
				text: `CLA-76\n$(${self.label}:prolink_controller_name)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(40, 120, 40),
			},
			steps: [
				{
					down: [{ actionId: 'prolink_controller_switch', options: { state: 1 } }],
					up: [{ actionId: 'prolink_controller_switch', options: { state: 0 } }],
				},
				{
					down: [{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 1 } }],
					up: [],
				},
			],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// Tune RT – Note Selection (discrete)
		prolink_tune_rt_note: {
			type: 'button',
			category: 'ProLink – Tune RT',
			name: 'Tune RT – Note/Root Select',
			style: {
				text: `NOTE\n$(${self.label}:prolink_controller_name)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(150, 30, 30),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_switch', options: { state: 1 } }],
				up: [{ actionId: 'prolink_controller_switch', options: { state: 0 } }],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// Tune RT – Cents/Amount (continuous)
		prolink_tune_rt_cents: {
			type: 'button',
			category: 'ProLink – Tune RT',
			name: 'Tune RT – Cents/Amount',
			style: {
				text: `CENTS\n$(${self.label}:prolink_controller_value)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(120, 20, 20),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 2 } }],
				up: [],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// CLA-76 – Input Gain (continuous)
		prolink_cla76_input: {
			type: 'button',
			category: 'ProLink – CLA-76',
			name: 'CLA-76 – Input Gain',
			style: {
				text: `INPUT\n$(${self.label}:prolink_controller_value)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 80, 30),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 1 } }],
				up: [],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// CLA-76 – Output Gain (continuous)
		prolink_cla76_output: {
			type: 'button',
			category: 'ProLink – CLA-76',
			name: 'CLA-76 – Output Gain',
			style: {
				text: `OUTPUT\n$(${self.label}:prolink_controller_value)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 70, 30),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_relative', options: { direction: -1, steps: 1 } }],
				up: [],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// CLA-76 – Attack/Release (continuous)
		prolink_cla76_attack: {
			type: 'button',
			category: 'ProLink – CLA-76',
			name: 'CLA-76 – Attack',
			style: {
				text: `ATTACK\n$(${self.label}:prolink_controller_value)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(20, 60, 20),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 1 } }],
				up: [],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		prolink_cla76_release: {
			type: 'button',
			category: 'ProLink – CLA-76',
			name: 'CLA-76 – Release',
			style: {
				text: `RELEASE\n$(${self.label}:prolink_controller_value)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(20, 50, 20),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_relative', options: { direction: 1, steps: 1 } }],
				up: [],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},

		// CLA-76 – Ratio (discrete steps)
		prolink_cla76_ratio: {
			type: 'button',
			category: 'ProLink – CLA-76',
			name: 'CLA-76 – Ratio',
			style: {
				text: `RATIO\n$(${self.label}:prolink_controller_value)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(20, 40, 20),
			},
			steps: [{
				down: [{ actionId: 'prolink_controller_switch', options: { state: 1 } }],
				up: [{ actionId: 'prolink_controller_switch', options: { state: 0 } }],
			}],
			feedbacks: [{
				feedbackId: 'prolink_controller_observed',
				options: {},
				style: { bgcolor: combineRgb(0, 150, 0), color: combineRgb(255, 255, 255) },
			}],
		},
	})
}
