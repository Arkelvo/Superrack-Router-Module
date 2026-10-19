# ProLink implementation plan

Goal: add an explicit ProLink control transport while retaining existing MIDI configurations and actions.

Basis: synchronized `prolink-integration` / `origin/main` at `0f3e5dedc3d94c8c53f505d83f314bbde0ce8408`; local knowledge graph restored from stash. No repository AGENTS.md found.

## Design and integration

Use Node built-ins in-process, with a separate codec and transport service. Extending the Windows MIDI helper would unnecessarily couple IPv6 control to a platform-specific MIDI backend. Embedding networking in actions would duplicate lifecycle handling. Neither alternative is needed.

`main.js` selects one transport at the route entry point. Existing `route_rack`, `trigger_channel`, native MIDI input, and the persisted `racks` array reuse `routeRack`. Existing MIDI hot-map semantics stay unchanged. ProLink maps visible rack 1..64 to ID 0..63 (0 means no selection). It does not interpret MIDI hot snapshot slots as provider IDs or hot plugins as racks.

Missing `controlTransport` means `midi`; append an upgrade script to persist that default without rewriting mappings. New fields: `controlTransport`, `prolinkInterface`, `prolinkName`, `prolinkRecallEnabled`, `prolinkHighlightEnabled`. Interface selection requires exactly one link-local IPv6 address as a conservative DESIGN choice. Device name defaults to the original `Mixing Station` for initial compatibility; it is configurable because multi-instance identity acceptance is UNKNOWN.

Dedicated snapshot actions take raw nonnegative int32 provider IDs unchanged and require their own false-by-default gate. Existing hot snapshot/plugin actions report unsupported in ProLink mode without MIDI fallback. There is no startup/reconnect recall, command replay, audio patch or DSP implementation.

Transport is a local ephemeral TCP server with IPv6 UDP responder at ff12::7776:40123. Hello immediately and every 250 ms; incoming TCP types 2/4 update heartbeat time. No mandatory heartbeat timeout is invented (original timeout callback is empty). Connection means TCP presence, not authenticated peer identity or remote execution confirmation. Received OSC is consumed but not treated as confirmed rack state.

## Tasks and proof

- [x] Codec (`lib/prolink-codec.js`, `__tests__/prolink-codec.test.js`): original archived OSC vectors; independent Hello/discovery offsets; int32 bounds; bounded streaming parser with all split points, coalescing, invalid header/type/length, reset. Copy archived vector fixture to tracked test fixtures to keep tests independent of the local knowledge bundle.
- [x] Transport (`lib/prolink-service.js`, lifecycle tests): start/stop serialization, interface validation, ephemeral listener, UDP response source port, single peer, periodic Hello, heartbeat tracking, parser reset, bounded writes, fatal/start failure cleanup, disconnect/reconnect and no replay. Fake network boundaries for deterministic errors; real loopback TCP where supported.
- [x] Integration (`main.js`, actions, feedbacks, variables, upgrades): exclusive selection, rack conversion, snapshot gates, stale MIDI sequence cancellation on config changes/destroy, status reporting, legacy config regression tests. Native MIDI input is available only in MIDI mode. A serialized break-before-make lifecycle prevents MIDI and ProLink services from running together.
- [x] Documentation and validation: `npm test`, targeted formatting, `npm run package`, inspect diff; setup and concrete manual acceptance in `docs/PROLINK.md` and Companion help.

Review focus: asynchronous start/stop races; pending MIDI sequence when switching transport; invalid interfaces and bind errors; slow/non-reading peers; misleading remote-success feedback. Each gets focused tests or explicit documented limits.

STATIC evidence describes original transport and conversion; PROBE vectors establish only encoder bytes. Limits, stricter header validation, link-local enforcement, gates and generation cancellation are DESIGN. Peer acceptance, identity rules, snapshot ID semantics and live SuperRack interoperability remain UNKNOWN until manual acceptance.

## Completion evidence (2026-10-19)

- Follow-up requirement: strict MIDI OR ProLink exclusivity, including input and helper process. Shared lifecycle queue stops the old service before starting the selected one, cancels superseded switches, and waits for helper exit. Failed shutdown blocks the other service; transport-specific settings are hidden, while saved values remain intact. Regression tests cover both switch directions, persisted MIDI enable in ProLink mode, deferred startup/destroy, helper timeout and unclosable MIDI ports.
- Focused follow-up review identified partial MIDI startup discarding unclosed port handles. Fixed by retaining handles immediately and sharing fail-closed shutdown with the startup failure path; regression reproduced before the fix and passes afterward. All 130 tests pass; no review findings deferred.

- Codec: all ten archived vectors compared byte-for-byte; archive copied without re-encoding. A vector-count assertion prevents silently skipping the UTF-16LE archive. Magic checked as raw bytes, including a regression for high-bit ASCII aliases.
- Lifecycle: controlled network-boundary tests plus real IPv6 loopback TCP exchange/reconnect; UDP multicast remains simulated in automated tests.
- Integration: old MIDI suites pass; explicit transport selection, preserved config/mappings, raw snapshot IDs/gates and cancellation covered. ProLink has a separate send timestamp so legacy Generic-MIDI timestamp triggers do not emit stale MIDI.
- Independent review found a possible ProLink restart after destroy during deferred init; fixed with a destroyed guard and both direct and deferred-init regression tests. Review's unchecked-plan minor resolved here. No review findings deferred.
- Final `npm test -- --silent`: 12 suites, 130 tests passed. Targeted Prettier check passed; `git diff --check` passed.
- `npm run package` invoked but its PowerShell child failed on `npx.ps1` execution policy while the wrapper misleadingly returned 0. Direct `npx.cmd --no-install webpack` with the same repository build configuration compiled successfully. Repacked the generated `pkg` tree with the tool's existing `tar` dependency; validated entrypoint, manifest, help and embedded ProLink identifiers. See `docs/PROLINK.md` for reproduction.
- Dependency installation repaired missing local `@julusian/midi`; no dependency declaration/lockfile change was needed. npm reported 34 existing dependency audit findings (5 moderate, 29 high); dependency remediation is outside this transport change. Native MIDI hardware/helper operation is not established by mocked regression tests.
- No real SuperRack session was available/performed. Manual acceptance remains explicitly outstanding. Implementation branch: `prolink-integration`; original knowledge graph and pre-sync stash retained.
