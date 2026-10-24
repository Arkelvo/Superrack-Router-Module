# Companion Tap Tempo preset (V1)

## User-facing behavior

The existing `ProLink: Tap Tempo` action now has a ready-made **ProLink – Tempo / Tap Tempo (BPM and beat flash)** preset for Companion 4.1 (module API 1.x).

- Press the button to tap the beat (the action runs on **Down**, not on release).
- The BPM text is the most recent locally submitted SetTempo value, or `--` before one is known.
- At every local beat boundary, the button briefly highlights in yellow. This is a **local visual metronome**, not feedback from SuperRack's DSP phase or clock.
- At each valid repeated Tap, the existing `SetTempo` is sent, even if BPM has not changed; the local visual clock is reanchored to the same send attempt.
- The existing `ProLink: Set BPM` action also reanchors the local blink and updates the displayed BPM on a successful local send.
- On ProLink disconnect or change of control transport, the blink stops and BPM is cleared. Timer resources are cleared on module destroy.
- The local visual phase is not network-latency compensated (per V1 requirements). Scheduling follows a monotonic clock; delayed timer callbacks skip overdue beats rather than producing a catch-up burst.

## Technical notes

A new `prolink_tap_beat` boolean feedback changes the preset background while the local pulse is active. Each transition calls `checkFeedbacks('prolink_tap_beat')`. The module uses edge-triggered timers, not busy polling. The independent `ProLinkTapBeat` class has no OSC or MIDI side effects.

Companion variables added: `prolink_tap_display_bpm` (`--` or a whole BPM) and `prolink_tap_beat_active` (boolean), alongside the existing Tap Tempo diagnostic variables.

This preset targets the **API 1.x** `setPresetDefinitions({...})` signature, corresponding to `@companion-module/base ~1.12.1` and Companion 4.1.4. API 2.x uses a different schema and would require a future migration.

## Safe installation

Only copy the files included in the overlay archive **into an existing repository**, overwriting only matching filenames. Do not delete or synchronize the repository against the short list of changed files. The separately supplied full-project archive preserves every file from the user's provided source ZIP.

With dependencies installed, run `npm test` and `npm run package`. Hardware test: connect ProLink; press Tap twice; watch BPM and blink; test repeated taps with same BPM, manual Set BPM, and disconnect.
