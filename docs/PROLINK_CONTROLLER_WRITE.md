# ProLink — relative selected-controller write (experimental)

Base: the **ProLink-Controller-State-2026-10-20** and **ProLink-Extension-Quelldateien** deliveries, not the older unchanged GitHub branch. Files in this archive are **complete replacements**, not patches.

## Changed source files

- `actions.js`: new Companion action `prolink_controller_relative`; guarded callback `self.changeFocusedProlinkController(direction, steps)`.
- `lib/prolink-codec.js`: outgoing `ChangeControllerValue` with OSC tags `,ii` (request int32, signed delta int32).
- `lib/prolink-observations.js`: local diagnostic readback state, avoiding claims of per-request remote execution success.
- `variables.js`: new write/readback diagnostic variables.

## Unchanged supporting files included for consistency

- `feedbacks.js`, `lib/prolink-osc.js`, `lib/prolink-controller-state.js` and `__tests__/prolink-controller-state.test.js` are included from the preceding controller-state delivery. The last two are required for the new code and tests.
- `__tests__/prolink-controller-write.test.js` is a **new Jest test**.

`main.js` and `lib/prolink-service.js` are **not included and are not modified**. This preserves your current custom logging and transport debugging. The previous instruction to change the legacy debug decoder in `main.js` to `decodeOsc` remains important if `[PROLINK_RX_RAW] Unsupported OSC type: d` appears.

## Meaning and limitations

`ChangeControllerValue` is an OSC command with `requestId:int32, delta:int32`. The sign and magnitude represent an input change, **not a dB or normalized parameter value**. The REA analysis shows a path that clamps continuous deltas to `±8` and applies a non-linear mapping; discrete/switch controls have different logic. The action limits steps to 1..8 and rejects a zero, out-of-range, or fractional step. Which sign increases a specific plugin parameter remains a live-test question; the UI labels the direction as positive/negative rather than guaranteeing the physical result.

The command is **focus-bound**: it contains no slot, rack or VST3 parameter address. For this reason it refuses to send until a controller Properties notification **and** a controller Value notification have been observed. This is an operational guard, not proof that focus cannot change between a check and the send. To enable readback, first use the existing `prolink_controller_subscription` action to subscribe to current-controller updates.

## Companion variables

| Variable | Meaning |
|---|---|
| `prolink_controller_write_delta` | Locally requested signed delta, e.g. `-1` |
| `prolink_controller_write_sent_ms` | Local successful socket-write attempt timestamp |
| `prolink_controller_write_observed_ms` | Time of first **different** incoming controller value after send |
| `prolink_controller_write_status` | `idle`, `awaiting_change`, `observed_after_send`, `unconfirmed`, or `context_changed` |

`observed_after_send` is **not** a confirmed command/result association. The notification has no request ID, and manual plugin/UI changes can occur in parallel. A missing value change after 2500 ms yields `unconfirmed`, which is not necessarily failure (e.g. the control may be at a limit). A changed Properties message invalidates an in-flight observation. Disconnect resets the diagnostics.

The separate existing `ResultCommand` / `prolink_last_command_status` functionality remains unchanged. Neither of the above is proof of DSP sample-accurate processing.

## Installation

1. On the branch with the previous ProLink extensions and Controller-State feature, back up any local edits to these files.
2. Unpack this ZIP at the repository root, keeping the directory structure; overwrite matching files.
3. Verify: `node --check actions.js`, `node --check lib/prolink-codec.js`, `node --check lib/prolink-observations.js`, `yarn test`.
4. Start SuperRack, connect ProLink, subscribe to controller updates, and select a stable plugin controller.
5. Set the new action **ProLink: Adjust selected Touch-and-Turn controller (relative)** to **Positive (+)** or **Negative (-)**, magnitude **1**. Confirm the actual value's direction and scaling in SuperRack.
6. Confirm `prolink_controller_write_status` moves from `awaiting_change` to `observed_after_send` if a *different* value arrives. Try an input at a limit: `unconfirmed` is expected if no value changes.
7. Navigate to a new controller while a write is pending: expect `context_changed`. Disconnect: expect `idle`.

## Validation performed

- All JavaScript files pass `node --check`.
- Nine independent Node runtime checks passed for the outgoing protocol, guards, monitoring and timeout.
- All six prior Controller-State Jest-style regression tests passed with a local compatibility shim.
- The complete repository `yarn test` suite and SuperRack hardware behavior were **not** executed in this environment (full module dependencies are not present).

Suggested commit:

`feat(prolink): add guarded relative Touch-and-Turn controller control and readback diagnostics`
