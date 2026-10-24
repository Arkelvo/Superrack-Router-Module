# ProLink Tap Tempo V1

## Implementation scope

- `ProLink: Tap Tempo` is a Companion action triggered by a button press.
- The first tap starts a sequence; the second and every subsequent in-range tap sends `SetTempo`.
- The arithmetic mean of **every** interval in the active sequence is used. Intervals, not BPM readings, are averaged.
- Convert the mean interval to BPM using `60000 / meanIntervalMs`, then round to the nearest integer, **then** check 40–500 BPM inclusive.
- An out-of-range result is not sent; its interval remains in the running measurement.
- An interval strictly greater than 1700 ms starts a new sequence; exactly 1700 ms still belongs to the prior sequence (but produces an out-of-range BPM when used as the only interval).
- Tap presses while ProLink is unavailable are ignored and clear the active sequence. Changing transports or losing the connection also clears it.
- A valid `SetTempo` is sent for **every** eligible tap even when the rounded BPM is unchanged, preserving the observed remote beat-phase reset behavior.
- No MIDI is involved. No network-latency compensation, debounce, minimum tap interval, maximum history length, or rolling average is introduced in V1.

## Existing action adjustment

- `ProLink: Set BPM` accepts 40–500 BPM, inclusive.
- The former `(does not reset beat phase)` caption has been removed in response to an observed live phase reset.
- The existing OSC encoder and command request tracking are unchanged.

## Diagnostics

Companion variables:

- `prolink_tap_status`: local state, **not** remote acknowledgement.
- `prolink_tap_count`: number of taps in the current sequence.
- `prolink_tap_calculated_bpm`: rounded candidate, including rejected candidates.
- `prolink_tap_last_sent_bpm`: latest BPM submitted locally, not a confirmation from SuperRack.
- `prolink_tap_last_interval_ms` and `prolink_tap_average_interval_ms`: timing diagnostics.

The `[PROLINK_TAP_TEMPO]` log captures each local tap action. The existing `SetTempo` request/response monitoring remains responsible for acknowledging commands.

## Testing

1. Run `npm test` and `npm run package` with the project's dependencies installed.
2. Assign `ProLink: Tap Tempo` to a **Press** action in Companion.
3. Confirm the first press does not send; the second sends a calculated tempo.
4. Tap repeatedly at steady tempo and verify **every** valid tap sends `SetTempo`, including identical values; inspect SuperRack's host-synchronized effect phase.
5. Test near 40 BPM and 500 BPM, out-of-range tap sequences, 1700/1701 ms gaps, and disconnect/reconnect.
6. Verify the old direct `ProLink: Set BPM` action still works over its new 40–500 BPM input range.

All software-only tests confirm local algorithm behavior; actual beat-phase resetting is based on user live observations and requires live acceptance testing.
