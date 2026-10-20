# ProLink PSE Threshold: calibrated dB steps (experimental)

This is a **follow-up** to `ProLink-Controller-Write-2026-10-20.zip`. It is **not** a direct patch against the older `janschaack/prolink-extension` GitHub ref (which currently still lacks the previous packages). Unpack into the repository root after the previous Controller-State / Controller-Write versions.

## New Companion action

**`prolink_controller_db` – ProLink: Adjust PSE Threshold (dB, calibrated)**

- Direction: Decrease (−) / Increase (+)
- dB step: **0.1 / 0.5 / 1 / 3**
- Existing `prolink_controller_relative` (raw +/- magnitude 1–8) is retained for other control types and diagnostic work.

**Strict permission:** the current selected controller's live `NotifyControllerProperties` and `NotifyControllerValue` must indicate **PSE / Threshold / dB / −60..0**, and its raw value must be in the verified range 0..1000. No writing to an uncalibrated Waves parameter.

## Algorithm

Live observations for this particular control indicate:

```
rawDelta = sign * magnitude^2,  magnitude in [1..8]
relative dB ~= 0.06 * rawDelta
```

The controller sends bounded positive/negative *integer* OSC magnitudes. For each button press it:

1. Reads the current focused-controller metadata and raw Double value.
2. Converts the requested signed dB step into a target raw offset.
3. Chooses a non-overshooting magnitude from 1..8 using the square-law model.
4. Waits for a changed raw Double notification consistent with the expected delta (tolerance 0.25 raw units).
5. Sends the next magnitude if necessary; otherwise finishes and records observed delta.
6. Preserves fractional raw residual between presses on the same observed controller context so that repeated 0.1 dB presses approximate 0.1 dB on average.

Examples for an initial residual of 0:

| Requested | Rounded raw target | Magnitudes | Model dB change |
|---|---:|---|---:|
| +0.1 dB | +2 | +1, +1 | +0.12 dB |
| +0.5 dB | +8 | +2, +2 | +0.48 dB |
| +1 dB | +17 | +4, +1 | +1.02 dB |
| +3 dB | +50 | +7, +1 | +3.00 dB |

These are model estimates, *not promises that the displayed Threshold text changes by fractional dB*. SuperRack's captured Threshold text is displayed as whole dB. Ten presses of +0.1 dB should add about +1.02 dB (17 raw), not 10 x 0.12 dB.

## Safety controls

- Max eight queued presses; queue is serialized on changed readback.
- Max eight separate magnitude commands for any one press (actual presets need at most a few).
- Timeout 2.5 s per magnitude if raw Double doesn't change.
- Abort and discard queued actions if focus metadata changes, the observed change is inconsistent, or the write cannot be sent.
- Abort requests outside the assumed −60..0 dB raw domain rather than pushing into the limit.
- On disconnect, cancel in-flight timers and reset residual/queue.
- A changed readback is **observational only**. It is not a per-request acknowledgement: the notification contains no command sequence, rack, plugin or parameter identity. Switching between two controls with *identical* metadata may be undetectable. Avoid navigating/changing parameters while operating this action.
- Other effects and parameters that happen to use the `dB` label are **not** automatically deemed compatible.

## New Companion variables

- `prolink_db_status`: idle, in_progress, observed_after_send, out_of_range, unconfirmed, unexpected_change, context_changed, send_failed, step_limit
- `prolink_db_requested`: signed requested amount, dB
- `prolink_db_observed`: estimated dB change calculated from observed raw Double delta
- `prolink_db_target_raw`, `prolink_db_remaining_raw`: internal diagnostic fields
- `prolink_db_queue_length`: queued requests awaiting serial execution
- `prolink_db_error`: reason why an action was canceled
- `prolink_db_residual_raw`: retained fractional raw offset used for averaging precision

## Installation and testing

Unzip into the repository root, replacing the existing full files. Existing `main.js` and `lib/prolink-service.js` are intentionally NOT replaced; custom debug hooks survive. To eliminate `Unsupported OSC type: d` in the legacy `main.js` debug parser, use `decodeOsc` from `lib/prolink-osc.js` as described in the prior Controller-State release.

```
node --check actions.js
node --check lib/prolink-db-adjust.js
yarn test
```

Live manual check: Subscribe to focused controller info; focus PSE Threshold; perform positive and negative 0.1 dB, test ten rapid clicks of +0.1 dB, 0.5 / 1 / 3 dB, try boundary −60 or 0 dB, and navigate to a different plugin while a step is pending. Compare `prolink_db_observed` to raw Double changes and confirm the queue doesn't run after an abort.

## Development status

All included JS source/test files passed `node --check`. Seven new tests and twelve earlier tests passed using a local Jest-compatible harness. This is NOT a full-repository Jest run and hardware execution on the final package remains to be verified.
