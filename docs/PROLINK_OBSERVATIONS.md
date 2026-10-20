# ProLink live feedback – preliminary evidence (2026-10-20)

A live SuperRack Performer session showed successful `ShowRackByID` execution via
`/waves.com/remote/ResultCommand` and an unsolicited
`/waves.com/remote/NotifyRacksConfigChanged` with 64 rack entries. Each entry
contains a 0-based ID, a UTF-8 name, seven presently undocumented integers,
and two OSC booleans: `bool1` = muted, `bool2` = on. These two boolean meanings
were checked with mute and on/off toggles on several named racks.

Startup notifications observed (raw values, semantics beyond naming unknown):

| Message | Arguments | Companion variable |
|---|---|---|
| `NotifySyncStatus` | `[0]` | `prolink_sync_status` |
| `NotifyIOBoxStatus` | `[true]` | `prolink_iobox_status` |
| `NotifySGSStatus` | `[true]` | `prolink_sgs_status` |
| `NotifyRemoteOperation` | `[6,602]` | `prolink_remote_operation` (JSON) |
| `NotifySnapshotDirty` | `[false]` | `prolink_snapshot_dirty` |
| `NotifySessionDirty` | `[true]` | `prolink_session_dirty` |

The receiver preserves the actual observed values without guessing the meaning
of enum values `0`, `6`, `602`, or the SoundGrid-related status fields.
`NotifyTouchAndTurnControlOwnership` is also tracked without repeated logs.

Per rack (1..64) the module exposes `rack_N_name`, `rack_N_muted`, `rack_N_on`
and `rack_N_known`. Feedbacks `prolink_rack_muted` and `prolink_rack_on` depend
on observed values, not the last sent rack action. The rack selector uses
observed names after receiving its first full configuration. On disconnect the
observed state is cleared to avoid stale green feedback.

`ResultCommand` with tags `,iis` is correlated to the locally sent signed
int32 sequence. The observed reply for `ShowRackByID` had result code `0` and
text `/waves.com/remote/ShowRackByID succeeded`. Only this exact combination
is labelled `succeeded`; all other matched replies are `rejected_or_unknown`.
Missing replies after 2.5 s are `unconfirmed` (not proof of failure). This
acknowledgement does **not** identify the rack currently shown after future
manual navigation; `active_rack` is deliberately not exposed.

## Manual validation checklist

1. Enable `Log level = debug` and select the ProLink transport.
2. On initial connect, confirm `rack_1_name` and the six raw startup statuses.
3. Mute/unmute rack 7 and switch rack 10 on/off directly in SuperRack. Confirm
   the matching `rack_N_muted`/`rack_N_on` variables and Companion feedbacks.
4. Rename a rack, confirm the name and new label in `Route Rack`.
5. Trigger rack 5 in Companion. Confirm `prolink_last_command_status=succeeded`
   and matching `prolink_last_ack_sequence` in the debug log.
6. Disconnect SuperRack and confirm `rack_N_known=false` and stale state cleared.
7. Validate duplicate packets, corrupt packets and missing acknowledgements.

Full hardware/OS compatibility and the unexplained int fields still require
further analysis. Existing generic MIDI behavior is intentionally unchanged.
