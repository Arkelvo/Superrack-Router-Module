# Waves SuperRack Router – Inline Help

## Overview

This module links mixer channels to Waves SuperRack rack selection. The default **MIDI** path exposes variables for Generic-MIDI and optionally opens native MIDI ports. **ProLink** is an additional experimental transport; live SuperRack interoperability has not been confirmed.

## ProLink setup and limits

Select **Control transport → ProLink**, choose a network interface with exactly one link-local IPv6 address, and allow UDP 40123 multicast `ff12::7776` plus incoming TCP to the module's dynamic port. In SuperRack's **Setup → Controller → Pro Link Console Remote**, assign the advertised device (default name `Mixing Station`, matching the archived protocol identity). This module is an independent implementation. No fixed remote TCP port is needed.

Reuse **Route Rack**, **Trigger Channel** and existing mappings. Rack 1 maps to protocol ID 0. The mapping UI changes selection associations, not audio connections. ProLink sends no MIDI fallback. Existing configurations default to MIDI without recreating actions or mappings.

**MIDI OR ProLink:** only the selected service runs. Selecting ProLink closes all native MIDI ports (including input) and stops the Windows MIDI helper, even when its enable setting was previously saved. Switching back stops ProLink before MIDI starts. A helper that cannot be stopped blocks the switch and reports an error. Settings for the inactive transport are hidden but preserved.

Hot Snapshot/Hot Plugin remain MIDI-only. The separate ProLink Recall/Highlight actions take a raw snapshot provider ID unchanged and each requires its own off-by-default configuration gate. No recall or other action runs automatically on connection/reconnection. Disconnected commands are discarded.

`prolink_state`, `prolink_error`, `control_last_error` and `prolink_connected` expose transport status. TCP connected and last-rack history do not confirm remote execution. ProLink uses `prolink_last_send_timestamp`; it does not pulse the legacy `last_action_timestamp` Generic-MIDI trigger or alter MIDI output variables. Check any custom triggers on other shared variables before switching modes.

Before production use, verify discovery/assignment, actual rack 1/8/64 selection, unchanged snapshot IDs with each gate, no MIDI double-send, and reconnect without replay on a disposable show. Full setup, evidence limits and the manual acceptance checklist are in the repository's `docs/PROLINK.md`. The following MIDI setup remains applicable when MIDI is selected.

---

## Prerequisites

- A connection to your mixing console that can output the selected channel as an **integer** (INT)
- A **Generic-MIDI** connection that is integrated with Waves SuperRack

---

## How to Use

1. **Add this module in Companion v4.**
2. **Configure:**
   - Log level
   - Rack count (4/8/16/32/64)
   - Channel count (min 32, max 512)
   - HTTP port (for the UI)
   - Paste your SuperRack MIDI Map (JSON)
3. **Add a Generic-MIDI instance** and connect it to Waves SuperRack.
4. **Set up triggers:**
   - **Trigger 1:** On channel change from your mixing console, send the INT value to the `superrack-router` `trigger_channel_action`.
   - **Trigger 2:** On every change of `$(superrack-router:last_action_timestamp)`, send a MIDI message on the Generic-MIDI connection using the variables provided by this module (`midi_last_channel`, `midi_last_controller`, `midi_last_value`, etc.).

---

## Waves Configuration

Waves does not natively support selecting racks via MIDI. Therefore, a workaround is required:

- For **Rack 1**, set a plugin from Rack 1 as a Hot Plugin. Repeat this for each rack.
- If all Hot Plugins are already assigned, create a **Snapshot** that only stores the Hot Plugins.
- Save this Snapshot as a **Hot Snapshot**.

Once all Hot Snapshots and Hot Plugins exist, configure the MIDI settings:

- Use the helper buttons **"route single Hot Snapshot"** and **"route single Hot Plugin"** to assign MIDI calls.
- When all Hot Snapshots and Hot Plugins can be triggered via MIDI, you can proceed to map the racks to the channel ID in the connection.

---

## Actions

- **Route Rack**: Triggers the MIDI sequence for a specific rack.
- **Route Hot Snapshot**: Triggers the MIDI sequence for a Hot Snapshot (IDs 1–6).
- **Route Hot Plugin**: Triggers the MIDI sequence for a Hot Plugin (IDs 1–12).

## Feedbacks

- **active_source**: True if the given source index is currently active.
- **rack_last_used**: True if the given rack was last routed.
- **sequence_running**: True while a routing sequence is running.

## Variables

- `last_routed_racks`: JSON array of recently routed rack IDs
- `last_action_timestamp`: Timestamp (ms) of the last routing action
- `failed_steps_total`: Total number of failed MIDI steps
- `midi_last_type`: Last MIDI type (cc, noteon, program)
- `midi_last_channel`: Last MIDI channel
- `midi_last_controller`: Last MIDI controller/note/program
- `midi_last_value`: Last MIDI value
- `active_source_index`: Currently active source index (if used)
- `active_source_label`: Currently active source label (if used)

---

## Example: Using with Generic-MIDI

Set up triggers in Companion:

- **Trigger 1:** When the selected channel changes on your mixing console, send the INT value to the `superrack-router` trigger channel action.
- **Trigger 2:** When `$(superrack-router:last_action_timestamp)` changes, send a MIDI CC message with:
  - Channel: `$(superrack-router:midi_last_channel)`
  - Controller: `$(superrack-router:midi_last_controller)`
  - Value: `$(superrack-router:midi_last_value)`
- Make sure "Use Variables" is enabled in the Generic-MIDI action.

---

## Native MIDI Ports (optional)

When **Enable native MIDI ports** is checked in the module config, the module opens its own MIDI input and output port named after the configured **MIDI port name** (default: `SuperRack Router In` / `SuperRack Router Out`). A Generic-MIDI instance is then no longer required for sending.

### macOS / Linux

Virtual ports are created automatically (CoreMIDI / ALSA) — no drivers or extra software needed. They appear in every MIDI host as soon as the module is running.

### Windows 11 24H2+ — Windows MIDI Services (no loopMIDI needed)

On Windows 11 24H2 or newer, the module can register a **real virtual MIDI device** via Windows MIDI Services (experimental):

1. Make sure the Windows MIDI Services rollout has reached your machine (Windows Update, Feb 2026 onwards) and install the SDK runtime from <https://aka.ms/midi>.
2. Get `SuperRackMidiHelper.exe` (built by the `build-midi-helper` GitHub Actions workflow, or build it yourself — see `helper/README.md`).
3. Place it at `helper/dist/win-x64/SuperRackMidiHelper.exe` inside the module, or set its full path in the config field **Windows MIDI helper path**.
4. Keep **Windows MIDI backend** on "Windows MIDI Services (fallback: loopMIDI)".

The device "SuperRack Router" then appears in every MIDI host — including old MIDI 1.0 (WinMM) DAWs, which see it through the service's automatic translation. If the helper is missing or fails (e.g. on older Windows), the module automatically falls back to the loopMIDI backend below.

### Windows (fallback) — loopMIDI

Without Windows MIDI Services, set up a loopback port once:

1. Download and install [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) (free for private use).
2. In loopMIDI, create a port whose name contains the configured MIDI port name (e.g. `SuperRack Router`).
3. Keep loopMIDI running (enable its autostart option).
4. Restart this connection in Companion; the module opens the loopMIDI port automatically by name.

To force this backend, set **Windows MIDI backend** to "loopMIDI only".

### Sending (MIDI out)

All routing actions (**Route Rack**, **Route Hot Snapshot**, **Route Hot Plugin**) send their MIDI sequences directly on the output port. The variables (`midi_last_*`) are still updated, so existing Generic-MIDI setups keep working unchanged.

### Receiving (MIDI in)

Incoming **CC** messages on the configured **MIDI-in trigger channel** and **trigger CC number** are interpreted like the _Trigger Channel_ action: the CC **value** is the mixer channel number, and the rack mapped to that channel is routed. Note: since MIDI CC values are 0–127, only mixer channels up to 127 can be triggered this way.

### Startup order

MIDI hosts usually scan ports only at startup. Start Companion (with this module enabled) **before** your DAW or SuperRack, and reconnect the ports in the host after restarting this connection.

---

## Hot Snapshots & Hot Plugins

- Hot Snapshots (IDs 1–6) and Hot Plugins (IDs 1–12) must be defined in your MIDI Map JSON as collections or arrays.
- If a sequence is missing, the action will log a warning and do nothing (no error thrown).

---

## HTTP UI

- The UI is served from `/` on the configured port.
- Endpoints: `/`, `/patch`, `/patch/`, `/health`, `/patch/mappings`, `/patch/update`, `/rack/:id`
- Example: `http://localhost:8010/`

---

## Troubleshooting

- If the UI does not load, check the configured HTTP port and ensure no other process is using it.
- No internal MIDI connection is opened; all MIDI is sent via variables to a Generic-MIDI instance.

---

## Maintainer Notes

- This module uses the Companion v4 Node runtime (`node22`, `nodejs-ipc`). No own IPC is required.
- Build artifacts and non-source UI are excluded from the repository.

---

For more details, see the README or contact the maintainers.
