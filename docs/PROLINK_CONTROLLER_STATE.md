# ProLink selected-controller state — implementation and live validation

Basis: the **previous delivered ProLink-Extension-Quelldateien.zip** on top of
`janschaack/prolink-extension`, not the older unmodified remote branch.
This update is additive; it does not alter MIDI, routing or OSC wire commands.

## Replace / add

- REPLACE `lib/prolink-observations.js`
- REPLACE `variables.js`
- REPLACE `feedbacks.js`
- REPLACE `actions.js` (confirmed NavigateRack direction labels)
- ADD `lib/prolink-controller-state.js`
- ADD `__tests__/prolink-controller-state.test.js`

`lib/prolink-osc.js` must already contain the `case 'd'` and `readDoubleBE`
implementation from the preceding ZIP. It is not replaced here.

### Fix the existing debug parser (`main.js`) manually (TWO edits)

The remote GitHub branch contains an older, **separate** function
`decodeProlinkOsc` inside `main.js`. It rejects `d` even when the structured
state parser works. This causes repetitive `[PROLINK_RX_RAW]` lines. Preserve
all unrelated logging, especially rack-change / ResultCommand logging.

1. Add after the existing imports:

```js
const { decodeOsc } = require('./lib/prolink-osc')
```

2. In `this._prolink.onDebugFrame = (frame) => { ... }`, replace exactly

```js
message = decodeProlinkOsc(frame.payload)
```

with

```js
message = decodeOsc(frame.payload)
```

3. Directly below the line `const { path, args } = message` in that debug
handler, insert:

```js
// Controller notifications are already logged once per meaningful change
// by ProLinkObservations. Keep all other existing decoded debugging intact.
if (path === '/waves.com/remote/NotifyControllerProperties' ||
    path === '/waves.com/remote/NotifyControllerValue') return
```

Optionally remove the now unused local `decodeProlinkOsc` implementation.
Leaving it unused is also harmless.

## Observed OSC evidence

Exact live `NotifyControllerProperties` packet decoded to these **13**
positional fields:

```
["Threshold", true, 0, -60, 0, "dB", 0.001, 0, false, 1, "PSE", "-60", "0"]
```

Exact `NotifyControllerValue` packet decoded to:

```
["-51", 154.66666666666669]
```

Do **not** mistake numeric value `154.666...` for -51 dB, 0–1 or a
normalized 0–100% fader position. Fields 3/4 look like -60 and 0 dB bounds
in this example, but REA has not established their universal semantics.
All original properties remain available as positional raw JSON. Field 10
(`PSE`) is a raw auxiliary label and is not assumed to identify a plugin.

## Companion variables

Read-only variables updated only when changed:

- `prolink_controller_name` (Properties position 0)
- `prolink_controller_unit` (position 5)
- `prolink_controller_properties` (complete 13-field JSON)
- `prolink_controller_properties_known` (boolean)
- `prolink_controller_bounds_a_raw` / `_bounds_b_raw` (positions 3 and 4)
- `prolink_controller_bounds_a_text_raw` / `_bounds_b_text_raw` (positions 11/12)
- `prolink_controller_aux_text_raw` (position 10)
- `prolink_controller_context_version` (local counter, **not** a remote ID)
- `prolink_controller_text` (formatted value text, e.g. `-51`)
- `prolink_controller_value` (raw OSC double, e.g. `154.666...`)
- `prolink_controller_known` (true only when a value has been received)
- `prolink_controller_last_properties_update_ms`, `_last_value_update_ms`

New boolean Companion feedback `prolink_controller_observed` is only true
when ProLink is connected and both properties and a current value exist.

A changed properties packet clears the previous value to prevent showing an
obviously stale number. But **there is no remote context/parameter ID** in
these notifications: late packets cannot be correlated perfectly, so the
feedback remains best-effort selected-controller feedback. No arbitrary
plugin parameter or absolute write is implemented.

## Tests and manual smoke checklist

```bash
node --check lib/prolink-controller-state.js
node --check lib/prolink-observations.js
node --check variables.js
node --check feedbacks.js
yarn test
```

1. Enable ProLink / debug, subscribe via `RequestControllerInfoUpdates=true`.
2. Select a threshold control: verify name, unit, raw bounds and `-51` text.
3. Observe repeated identical packets: only first one should update variables
   and emit `[PROLINK_CONTROLLER_*_CHANGED]` once.
4. Change the value: verify numeric and display text update only upon change.
5. Select a different controller: verify context version increments and value
   known becomes false until a new `NotifyControllerValue` arrives.
6. Disconnect SuperRack: properties-known and value-known both become false.
7. Disable subscription; compare outgoing notifications and reconnect behavior.

The included Jest test uses **unaltered capture hex**. Full live hardware
validation was not possible in this execution environment.

Live-verified navigation: `NavigateRack` direction 0 = **next**, 1 = **previous**.
