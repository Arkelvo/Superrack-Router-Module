# ProLink control (experimental)

ProLink is an additional, explicitly selected control path. **Live interoperability with SuperRack has not been confirmed.** The implementation follows the local Mixing Station 3.2.0/build 777 specification, not a complete official Waves protocol specification.

## Setup

1. Keep `Control transport = MIDI` for existing installations. Missing settings default to MIDI; an additive Companion upgrade persists that choice. Existing actions, native MIDI/helper settings, hot mappings and channel-to-rack assignments are preserved.
2. For ProLink, select `Control transport = ProLink` and the network interface shared with SuperRack. This implementation requires exactly one IPv6 address on that interface and explicitly requires it to be link-local (`fe80::/10`). Interfaces with no IPv6, a global address, or multiple IPv6 addresses fail with a descriptive status. This stricter link-local check is a design decision motivated by the archived compatibility warning.
3. Allow IPv6 UDP port **40123**, multicast group **ff12::7776**, and incoming TCP to this Companion process on its OS-assigned dynamic port. There is no fixed remote TCP port and no TCP-client connection to SuperRack. TCP binds to `::` (all local IPv6 interfaces), as distinct from the selected multicast interface. Use a trusted control network: no authentication or encryption is implemented by the reconstructed protocol.
4. The initial discovery name is `Mixing Station`, matching the original identity (MD5 of UTF-8 name). It identifies this independent module, not a running Mixing Station application. A custom name is configurable, but peer acceptance of custom names and simultaneous same-name instances is unverified. Begin with only one instance on the test network.
5. Following the archived setup instructions, in SuperRack's **Setup → Controller**, choose **Pro Link Console Remote**, open its configuration and assign the advertised device. The archived documentation identifies Performer/SoundGrid V15+ as the intended target; availability and acceptance must be checked on the actual installed version.
6. Reuse the module's existing channel/rack assignment UI, `Route Rack` and `Trigger Channel`. Visible rack 1, 8, 64 becomes wire ID 0, 7, 63. Rack 0 means no selection. The configured rack limit applies. MIDI and ProLink are mutually exclusive services. ProLink closes MIDI input/output and the Windows helper, even if midiEnabled remains saved as true. Use Companion actions for channel selection in ProLink mode.

`prolink_state` reports stopped/starting/waiting/connected/fault. `prolink_error` reports connection failures; `control_last_error` reports rejected actions. `prolink_connected` means TCP presence only. A failed startup is retried by saving the configuration; a disconnected peer can reconnect to the still-running listener. Changing interface/name/transport restarts the transport. Both snapshot gates can be changed without reconnecting.

The settings dropdown explicitly selects **MIDI OR ProLink**; options for the inactive transport are hidden and their saved values retained. Switching is serialized: stop the previous service before starting the next. The Windows MIDI helper is asked to quit, then killed after one second if needed; without confirmed exit within three seconds the switch fails and the other service stays disabled. Actions during switching are discarded. If a native MIDI port cannot be closed/destroyed, switching is likewise blocked.

## Action scope and compatibility

- `Route Rack` / `Trigger Channel`: use the configured transport exclusively. In ProLink mode they send only `ShowRackByID`, without the MIDI snapshot/plugin workaround.
- `Route Hot Snapshot` and `Route Hot Plugin`: retain their MIDI behavior. In ProLink mode they report unsupported and send nothing. MIDI hot-slot numbers have no established mapping to ProLink provider IDs.
- `ProLink: Recall snapshot by provider ID` and `ProLink: Highlight snapshot by provider ID`: explicit separate actions, each with a separate **off-by-default** configuration gate. They accept nonnegative int32 IDs unchanged. There is no implicit subtraction and no automatic mapping from MIDI slots. Whether an ID denotes the intended snapshot on a real peer must be tested.
- There is **no automatic recall, highlight or rack selection on start/reconnect**, and no replay of disconnected commands.
- Existing Generic-MIDI automation commonly watches `last_action_timestamp`. ProLink does **not** update that timestamp or the `midi_last_*` variables; it updates `prolink_last_send_timestamp` instead, preventing the documented legacy trigger from sending stale MIDI. User-created triggers on other shared variables must be reviewed separately.
- Last-rack history is local send-attempt history, never verified remote state. Neither a successful socket write nor a green TCP feedback confirms SuperRack execution. Disconnected/rejected actions do not update send history.
- Selection only: no audio patch, audio transport, plugin control/DSP, rack metadata synchronization, or general OSC receiver is implemented. Incoming Wave OSC payloads are bounded and consumed without executing actions or claiming remote state.

## Protocol and evidence

STATIC: local TCP server, UDP discovery reply to source address/port, Hello layout, 250 ms Hello interval, incoming TCP type 2/4 heartbeat, Wave framing and rack-number subtraction come from `knowledge-graph/mixing-station/specs/05-prolink-protokoll.md` and `06-ui-rack-zuweisung.md`.

PROBE: `__tests__/fixtures/original-codec-vectors.txt` is a byte-for-byte UTF-16LE copy of the archived isolated original-encoder output. Tests compare all ten OSC vectors and original name MD5. The negative-ID vectors test encoding only; user actions reject negative IDs. Wave framing/layout tests use the statically documented offsets, not original live captures.

DESIGN: strict magic/type/length validation, 1 MiB OSC payload limit, 1024-byte name limit, parser reset per connection, serialized start/stop, rejection of early/second peers, 64 KiB pending-write limit, generation guards, explicit snapshot gates, no replay, and legacy MIDI trigger isolation. The sequence starts at zero per service instance and continues across reconnect, with signed int32 wrap. The original empty heartbeat-timeout callback is not turned into an invented mandatory disconnect: heartbeat receipt is tracked, but no application-level liveness timeout is enforced. OS TCP failure/EOF and write backpressure disconnect the peer.

UNKNOWN: actual discovery request contents and peer acceptance, extra handshake requirements, custom identity support, snapshot ID semantics, version-specific controller behavior, real heartbeat timing, OS multicast behavior and remote execution. The UDP responder follows the original behavior of replying to every received datagram; it does not claim to validate an undocumented request format.

## Automated verification

Run `npm test` and `npm run package` with the repository's dependencies installed. Tests cover legacy MIDI/configuration, archived encoding, all stream split points, concatenated and invalid frames, interface validation, UDP response destination, startup errors, early/second peers, timers, cleanup, disconnect/reconnect, no replay, transport switching and independent snapshot gates. Network fault tests use controlled Node socket doubles. An additional real IPv6 loopback TCP test exchanges Hello/commands and reconnects; it uses a simulated UDP layer and is **not a SuperRack interoperability test**.

Windows build note from this verification: the installed build tool launched PowerShell `npx`, which selected a blocked `npx.ps1`. It still returned zero and produced an archive without `main.js`. Do not accept that archive. Without changing the system execution policy, the missing bundling step was completed using the same webpack configuration and the archive rebuilt:

```powershell
# First run npm.cmd run package to prepare metadata, UI assets and MIDI prebuilds.
# If its nested npx.ps1 invocation fails as described, complete these steps:
npx.cmd --no-install webpack -c node_modules/@companion-module/tools/webpack.config.cjs --env "ROOT=$PWD" --env MODULETYPE=connection
# Continue only if webpack reports successful compilation.
node --check pkg/main.js
node -e "require('tar').create({gzip:true,file:'waves-superrack-router-0.7.0.tgz'},['pkg']).catch(e=>{console.error(e);process.exitCode=1})"
```

The final implementation verification passed 130 tests in 12 suites, formatting, direct webpack compilation and archive inspection. The package version is now 0.7.0; test builds do not create a published release. The dependency install reported 34 audit findings in the existing dependency tree; they were not remediated as part of ProLink.

## Manual SuperRack acceptance (not yet performed)

Record OS, Companion version, module commit, SuperRack product/version, interface addresses, discovery name, controller assignment and capture timestamps. Use a disposable test show; snapshot recall changes the show's state.

1. **Legacy regression:** load an existing MIDI configuration without the new field. Route racks and hot slots, trigger a mapped channel and verify the previous MIDI bytes/workflow. Export and compare persisted mappings.
2. **Discovery:** switch to ProLink and select the intended interface. Capture `udp.port == 40123` and IPv6 TCP. Verify a discovery reply returns to the requesting address/port, contains the actual dynamic listener port, and SuperRack initiates TCP to it. Confirm assignment in the controller UI. Failure is an interoperability finding, not proof of a guessed remote port.
3. **Handshake:** capture immediate and periodic type-1 Hello and peer type-2/4 messages. Record any extra peer registration requirements and whether the default/custom identity is accepted. Check that no type-5 command occurs merely from connection.
4. **Rack selection:** trigger racks 1, 8 and 64 and mapped channels. Check OSC target IDs 0, 7 and 63 AND the actual displayed rack. Trigger an unmapped channel/None: no command. Monitor MIDI output and the old `last_action_timestamp` trigger: neither must fire for these ProLink actions. Verify audio patches remain unchanged.
5. **Snapshot gates:** with both gates off, invoke both explicit actions: no type-5 send. Enable Highlight alone and test a known provider ID (including zero only if valid for this show); verify highlight without recall. Enable Recall separately and check the same unmodified ID against the actual recalled snapshot. Document the ID convention. Old Hot Snapshot/Plugin actions must produce a warning without fallback MIDI.
6. **Disconnect/reconnect:** disconnect the peer, attempt rack/recall actions, then reconnect. Status must leave connected, disconnected actions must not change send history, and reconnection must send Hello only. No old selection or recall may replay. Repeat several times; only one Hello stream must exist. A second peer must be rejected while the first remains connected.
7. **Lifecycle/errors:** switch interface and MIDI/ProLink modes repeatedly, including while a MIDI two-step sequence is pending; the old second step must stop. Disable/delete the instance and verify sockets/timers are released. Occupy UDP 40123 or select an incompatible interface and verify a visible startup failure, then correct it and retry. Test link interruption; note that there is no forced application heartbeat timeout.
8. **Parser robustness using a controlled peer:** send partial headers/bodies, multiple frames in one write, invalid magic, negative/oversized lengths, and disconnect mid-frame. A malformed peer must disconnect without stopping discovery; a fresh connection must parse independently. Compare with the automated suite.

Accept live interoperability only after recording actual visible rack/snapshot effects and the relevant capture, not merely because unit tests or socket writes succeed.
