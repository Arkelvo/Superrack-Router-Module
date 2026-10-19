# Waves SuperRack Router Companion Module

> **Release-Ready for Bitfocus Companion v4+**

This module enables routing of WING sources to Waves SuperRack racks using predefined MIDI sequences. By default it exposes variables that can be triggered via a Generic-MIDI instance. Optionally, it opens **native MIDI ports** ("SuperRack Router In/Out") so MIDI hosts can talk to it directly — virtual ports on macOS/Linux, loopMIDI-based on Windows (see HELP).

An explicit experimental ProLink transport is also available alongside the default MIDI path. Existing configurations remain MIDI-compatible. See [setup, protocol limits and manual SuperRack acceptance](docs/PROLINK.md). Live interoperability with SuperRack has not yet been confirmed.

---

## Features

- Routing of racks, hot snapshots, and hot plugins via MIDI variables
- Optional native MIDI ports: virtual in/out ports on macOS/Linux; on Windows 11 24H2+ a real virtual device via Windows MIDI Services (experimental helper), with automatic loopMIDI fallback; incoming CC triggers rack routing
- HTTP UI for mapping, patch overview, and health check
- Variables for a Generic-MIDI instance remain fully supported (no breaking change)
- Compatible with Companion v4+ (Node 18–22)
- Full test coverage (>90% recommended)

---

## Setup

1. Add this module in Companion v4
2. Configure:
   - Log level
   - Rack count (4/8/16/32/64, default: 64)
   - Channel count (min. 32, max. 512, default: 128)
   - HTTP port (for the UI, default: 8010)
3. Add a Generic-MIDI instance and use its actions (e.g., send CC) with the variables from this module

---

## Actions

- **Route Rack**: Triggers the MIDI sequence for a specific rack
- **Route Hot Snapshot**: Triggers the sequence for a hot snapshot (IDs 1–6)
- **Route Hot Plugin**: Triggers the sequence for a hot plugin (IDs 1–12)

## Feedbacks

- **active_source**: True if the given source index is currently active
- **rack_last_used**: True if the given rack was last routed
- **sequence_running**: True while a routing sequence is running

## Variables

- `last_routed_racks`: JSON array of recently routed rack IDs
- `last_action_timestamp`: Timestamp (ms) of the last routing action
- `failed_steps_total`: Total number of failed MIDI steps
- `midi_last_type`: Last MIDI type (cc, noteon, program)
- `midi_last_channel`: Last MIDI channel
- `midi_last_controller`: Last controller/note/program
- `midi_last_value`: Last value
- `active_source_index`: Currently active source index (if used)
- `active_source_label`: Currently active source label (if used)

---

## Example: Using with Generic-MIDI

Set up a trigger in Companion:

- When `$(superrack-router:last_action_timestamp)` changes,
- Send a MIDI CC message with:
  - Channel: `$(superrack-router:midi_last_channel)`
  - Controller: `$(superrack-router:midi_last_controller)`
  - Value: `$(superrack-router:midi_last_value)`
- Make sure "Use Variables" is enabled in the Generic-MIDI action

---

## Hot Snapshots & Hot Plugins

- Hot Snapshots (IDs 1–6) and Hot Plugins (IDs 1–12) must be defined in your MIDI Map JSON as arrays/objects
- If a sequence is missing, a warning will be logged (no error)

---

## HTTP UI

- UI is available at `/patch` on the configured port
- Endpoints: `/`, `/patch`, `/patch/`, `/health`, `/patch/mappings`, `/patch/update`, `/rack/:id`
- Example: `http://localhost:12345/patch`

---

## Project Structure (as of 2026-01)

- `main.js` – Module entry point (Companion v4)
- `actions.js`, `feedbacks.js`, `variables.js`, `default-variables.js`, `upgrades.js` – Module logic
- `lib/midi-map.js` – MIDI mapping
- `ui/http.js` – HTTP server for UI
- `ui/public/` – Static web UI (HTML, JS, CSS, icons)
- `companion/manifest.json` – Companion metadata
- `__tests__/` – Unit and integration tests (Jest)
- `package.json` – npm/Node configuration
- `LICENSE`, `CHANGELOG.md`, `companion-release-checklist.md` – Metadata

---

## Development & Testing

- Node version: >=18 <23
- Dependencies: `@companion-module/base`, `fastify`, `@fastify/static`, `@julusian/midi`
- Build: `yarn package`
- Formatting: `yarn format`
- Tests: `yarn test` (Jest, coverage >90% recommended)
- Coverage report: `coverage/`

---

## License

MIT
