const { combineRgb } = require('@companion-module/base')
const { VERIFIED_SCALES } = require('./lib/prolink-tune-scale-control')

// Companion 4.1 / module API 1.x preset format. Registered AFTER actions and feedbacks.
module.exports = function (self) {
	self.setPresetDefinitions({
		...Object.fromEntries(VERIFIED_SCALES.map(({ id, label }) => [
			`tune_scale_${id}`,
			{
				type: 'button', category: 'ProLink – Tune Scale (focus Scale Type first)',
				name: `Tune: Set Scale to ${label} (verified step readback)`,
				style: {
					text: `${label}\n$(${self.label}:tune_scale)`, size: 'auto',
					color: combineRgb(255, 255, 255), bgcolor: combineRgb(25, 30, 45),
				},
				steps: [{ down: [{ actionId: 'tune_set_scale', options: { scale: id } }], up: [] }],
				feedbacks: [{ feedbackId: 'tune_scale_matches', options: { scale: id },
					style: { bgcolor: combineRgb(0, 100, 65), color: combineRgb(255, 255, 255) } }],
			},
		])),
		...Object.fromEntries([
			['50hz', '50Hz'], ['60hz', '60Hz'], ['off', 'Off'],
		].map(([id, label]) => [`cla76_analog_${id}`, {
			type: 'button', category: 'ProLink – CLA-76 Analog (focus Analog first)',
			name: `CLA-76 Analog: ${label} (V11 observed target)`,
			style: { text: `ANALOG ${label}\n$(${self.label}:prolink_discrete_set_observed)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(25, 30, 45) },
			steps: [{ down: [{ actionId: 'prolink_discrete_set_target', options: { target: `cla76_analog:${id}` } }], up: [] }],
			feedbacks: [{ feedbackId: 'prolink_discrete_matches', options: { target: `cla76_analog:${id}` },
				style: { bgcolor: combineRgb(0, 100, 65), color: combineRgb(255, 255, 255) } }],
		}])),
		prolink_discrete_set_status: {
			type: 'button', category: 'ProLink – Discrete controller (verified focus only)',
			name: 'V12 focused discrete controller/target/status',
			style: { text: `DISCRETE $(${self.label}:prolink_discrete_focus_name)\nIst: $(${self.label}:prolink_discrete_set_observed)\nZiel: $(${self.label}:prolink_discrete_set_target)\n$(${self.label}:prolink_discrete_set_status) $(${self.label}:prolink_discrete_set_steps)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(45, 45, 55) },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'prolink_discrete_failure', options: {},
				style: { bgcolor: combineRgb(150, 35, 35), color: combineRgb(255, 255, 255) } },
				{ feedbackId: 'prolink_discrete_busy', options: {},
				style: { bgcolor: combineRgb(180, 95, 0), color: combineRgb(255, 255, 255) } }],
		},
		...Object.fromEntries([
			['tune_scale', 'Tune RT / Scale Type'], ['cla76_analog', 'CLA-76 / Analog'],
		].map(([id, label]) => [`prolink_discrete_focus_${id}`, {
			type: 'button', category: 'ProLink – Discrete controller (verified focus only)',
			name: `V12 active controller: ${label} (read-only)`,
			style: { text: `${label}\n$(${self.label}:prolink_discrete_set_observed)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(45, 45, 55) },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'prolink_discrete_profile_focused', options: { profile: id },
				style: { bgcolor: combineRgb(0, 100, 65), color: combineRgb(255, 255, 255) } }],
		}])),
		prolink_discrete_plan_status: {
			type: 'button', category: 'ProLink – Discrete controller (verified focus only)',
			name: 'V12 read-only cycle preview status',
			style: { text: `PLAN (READ-ONLY)\n$(${self.label}:prolink_discrete_plan_status)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(45, 45, 55) },
			steps: [{ down: [], up: [] }], feedbacks: [],
		},
		tune_scale_status: {
			type: 'button', category: 'ProLink – Tune Scale (focus Scale Type first)',
			name: 'Tune Scale: observed status',
			style: { text: `SCALE\n$(${self.label}:tune_scale)\n$(${self.label}:tune_status)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(45, 45, 55) },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'tune_scale_busy', options: {},
				style: { bgcolor: combineRgb(160, 85, 0), color: combineRgb(255, 255, 255) } }],
		},
		tune_root_capability: {
			type: 'button', category: 'ProLink – Tune Root research (read-only)',
			name: 'Tune V9 Root model: inspect static mapping (no Root setter)',
			style: { text: `ROOT V9\nREAD-ONLY\n$(${self.label}:tune_root_remote_status)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(65, 55, 90) },
			steps: [{ down: [{ actionId: 'tune_root_inspect', options: { root: 'C' } }], up: [] }],
			feedbacks: [],
		},
		tune_diagnostics: {
			type: 'button',
			category: 'ProLink – Tune diagnostics (Root/Key unsupported)',
			name: 'Tune focused-controller read-only diagnostic',
			style: {
				text: `TUNE DIAG\n$(${self.label}:tune_debug_focused_name)\n$(${self.label}:tune_debug_focused_text)`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(90, 40, 0),
			},
			steps: [{ down: [{ actionId: 'tune_capture_focus', options: { field: 'auto' } }], up: [] }],
			feedbacks: [{ feedbackId: 'tune_diagnostic_candidate', options: {},
				style: { bgcolor: combineRgb(40, 60, 115), color: combineRgb(255, 255, 255) } }],
		},
		prolink_discrete_evidence_export: {
			type: 'button', category: 'ProLink – Discrete controller research (focused only)',
			name: 'V10: Export observed switch transitions to JSON (read-only)',
			style: { text: `DISCRETE V10\n$(${self.label}:prolink_discrete_evidence_status)\n$(${self.label}:prolink_discrete_evidence_count) events`,
				size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(50, 55, 85) },
			steps: [{ down: [{ actionId: 'prolink_discrete_evidence_export', options: {} }], up: [] }], feedbacks: [],
		},
		prolink_focus_audit_start: {
			type: 'button', category: 'ProLink – Focus diagnostics (read-only)',
			name: 'Start focus audit (does not change controller)',
			style: { text: 'FOCUS\nSTART', size: 'auto',
				color: combineRgb(255, 255, 255), bgcolor: combineRgb(40, 65, 100) },
			steps: [{ down: [{ actionId: 'prolink_focus_audit_start', options: {} }], up: [] }], feedbacks: [],
		},
		prolink_focus_audit_mark: {
			type: 'button', category: 'ProLink – Focus diagnostics (read-only)',
			name: 'Mark focus audit after controller selection',
			style: { text: 'FOCUS\nMARK', size: 'auto',
				color: combineRgb(255, 255, 255), bgcolor: combineRgb(70, 70, 90) },
			steps: [{ down: [{ actionId: 'prolink_focus_audit_mark', options: { checkpoint: 'after_controller_click' } }], up: [] }], feedbacks: [],
		},
		prolink_focus_audit_stop: {
			type: 'button', category: 'ProLink – Focus diagnostics (read-only)',
			name: 'Stop focus audit (JSON in variable)',
			style: { text: 'FOCUS\n$('+self.label+':prolink_focus_audit_status)', size: 'auto',
				color: combineRgb(255, 255, 255), bgcolor: combineRgb(80, 60, 50) },
			steps: [{ down: [{ actionId: 'prolink_focus_audit_stop', options: {} }], up: [] }], feedbacks: [],
		},
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
