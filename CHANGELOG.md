# Changelog

## [0.7.0] – 2026-10-19

### Added

- Experimental ProLink control with IPv6 discovery, a local TCP server, rack selection, and separately enabled snapshot recall/highlight actions. Live SuperRack interoperability remains unverified.
- Explicit MIDI OR ProLink selection, preserving existing MIDI configurations and channel/rack mappings.

### Fixed

- Transport switching stops the previous service before starting the next, including MIDI ports and the Windows helper; failed shutdown blocks switching.
- Test-build artifacts download directly as Companion-compatible `.tgz` files without an additional ZIP wrapper.

## [0.6.1] – 2026-07-02

### Fixed

- Module crashed on init under Companion 4's sandboxed module runtime (`--permission`): `fs.existsSync` on the helper path outside the module directory throws under Node's permission model. The check is now exception-safe, `startMidiService` failures can no longer take down `init()`, and the manifest declares the required runtime permissions (`native-addons`, `child-process`, `filesystem`).

## [0.6.0] – 2026-07-02

### Added

- **Windows MIDI Services backend (experimental, wave W3):** on Windows 11 24H2+ the module registers a real virtual MIDI device ("SuperRack Router") via a small C# helper (`helper/SuperRackMidiHelper`) against the official Windows MIDI Services App SDK — no loopMIDI required. WinMM MIDI 1.0 hosts see the device through the service's automatic translation.
  - ndjson-over-stdio bridge between module and helper; ready handshake with timeout.
  - Automatic fallback chain: Windows MIDI Services → loopMIDI (rtmidi-open) → variables-only.
  - New config options: Windows MIDI backend (auto/loopMIDI only), helper path.
  - GitHub Actions workflow `build-midi-helper.yaml` (windows-latest) builds the helper exe; not bundled with the module package.
  - Requires on-machine verification on Windows 11 24H2+ — the helper cannot be tested in CI beyond compilation.

## [0.5.0] – 2026-07-02

### Added

- Optional native MIDI support via `@julusian/midi` (waves W1/W2 of `docs/MIDI_INTEGRATION_PLAN.md`):
  - Virtual MIDI ports "SuperRack Router In/Out" on macOS (CoreMIDI) and Linux (ALSA), created at module start.
  - Windows: opens an existing loopMIDI port matched by the configured port name (setup guide in HELP).
  - All routing actions send their MIDI sequences directly on the output port; `midi_last_*` variables stay updated (no breaking change for Generic-MIDI setups).
  - Incoming CC on a configurable channel/controller triggers rack routing (Trigger-Channel semantics), with echo suppression.
  - New config options: enable native MIDI, port name, MIDI-in trigger channel and CC number.
- `resolveRackForChannel()` extracted to `lib/midi-map.js` and reused by the `trigger_channel` action and MIDI input.
- Jest tests for the MIDI service (byte encoding, backend selection, lifecycle, error paths, input mapping) without real ports.

## [0.2.4] – 2025-12-28

### Added

- Full support for Hot Snapshots (IDs 1–6) and Hot Plugins (IDs 1–12) via MIDI Map JSON.
- Robust HTTP server restart and config reinit (port change, mapping update).
- Complete English documentation (README, HELP).
- New variables: last_routed_racks, failed_steps_total, last_action_timestamp, active_source_index/label.
- Feedbacks: active_source, rack_last_used, sequence_running.

### Changed

- Actions/labels unified: "Route Rack", "Route Hot Snapshot", "Route Hot Plugin".
- Only `ui/public` is the UI source; build artifacts and patch-interface removed from repo.
- Manifest and package.json point to maintainer repo.

### Removed

- Deprecated action "trigger_channel" and all references to rack_channel_index_X.
- All build artifacts and non-source UI from repository.

### Fixed

- Sequence lifecycle, error counter, and variable updates are now robust and consistent.
- HTTP endpoints skip unnecessary config churn if mapping is unchanged.
- Improved error logging and status handling for HTTP server.

---

Older changes omitted for brevity.
