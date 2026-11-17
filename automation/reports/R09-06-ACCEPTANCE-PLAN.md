# R09-06 Live Acceptance Test Plan

**Phase:** 0.9.0 - Plugin Control Foundation  
**Task:** R09-06 Live-Akzeptanz  
**Date:** 2026-11-16  
**Status:** PLANNED (requires physical SuperRack hardware)

---

## Overview

This document defines the live acceptance test plan for ProLink integration with Waves SuperRack Performer/SoundGrid. Based on the 8 manual acceptance steps documented in `docs/PROLINK.md`, this plan provides a structured test matrix for verifying real-world interoperability.

**Evidence Class:** DOCUMENTED (plan) + RUNTIME_CONFIRMED (actual results when hardware available)

**Gates Required:** G07 (Live readback only with approved test profile), G08 (No main merge/tag push/release publish by AI)

---

## Prerequisites

### Hardware/Software Requirements
- [ ] Windows/Linux/macOS machine with Companion installed
- [ ] Waves SuperRack Performer or SoundGrid V15+ installed
- [ ] IPv6-capable network interface (link-local only, `fe80::/10`)
- [ ] UDP port 40123, multicast group ff12::7776 allowed
- [ ] Disposable test show (snapshot recall changes show state)

### Configuration
- [ ] Companion module version: 0.8.2+ (with Phase 0.9.0 changes)
- [ ] SuperRack version recorded
- [ ] Network interface IPv6 addresses documented
- [ ] Discovery name configured (default: "Mixing Station")

### Recording Requirements
For each test step, record:
- Timestamp (ISO 8601)
- OS / Companion version / Module commit / SuperRack product/version
- Interface addresses (IPv6 link-local)
- Discovery name
- Controller assignment
- Wireshark/pcap captures where applicable

---

## Test Matrix

### Step 1: Legacy Regression
**Reference:** PROLINK.md § Manual SuperRack acceptance step 1

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Load existing MIDI config without ProLink fields | Config loads without error | | |
| Route racks via MIDI | MIDI bytes/workflow match previous behavior | | |
| Trigger hot slots via MIDI | MIDI hot-slot behavior preserved | | |
| Export and compare persisted mappings | Mappings identical | | |

**Acceptance:** All MIDI functionality works identically to pre-ProLink version.

---

### Step 2: Discovery
**Reference:** PROLINK.md § Manual SuperRack acceptance step 2

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Switch to ProLink transport | Companion shows ProLink config options | | |
| Select intended interface (exactly 1 link-local IPv6) | Interface accepted, no "multiple IPv6" error | | |
| Capture `udp.port == 40123` and IPv6 TCP | Discovery reply to requesting address/port | | |
| Discovery reply contains dynamic listener port | SuperRack initiates TCP to that port | | |
| Controller assignment in SuperRack UI | "Mixing Station" appears, "Assign" works | | |

**Acceptance:** SuperRack discovers and connects to Companion via ProLink.

---

### Step 3: Handshake
**Reference:** PROLINK.md § Manual SuperRack acceptance step 3

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Capture immediate type-1 Hello | Hello sent on TCP connect | | |
| Capture periodic Hello (250ms interval) | Hello repeats every ~250ms | | |
| Capture peer type-2/4 messages | Heartbeat/status received | | |
| Record extra peer registration requirements | Document any additional handshake steps | | |
| Default/custom identity acceptance | Test both "Mixing Station" and custom name | | |
| No type-5 command on mere connection | No unsolicited commands sent | | |

**Acceptance:** Handshake completes; Hello/heartbeat observed; no spurious commands.

---

### Step 4: Rack Selection
**Reference:** PROLINK.md § Manual SuperRack acceptance step 4

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Trigger rack 1 (visible) | OSC ShowRackByID with ID 0 sent | | |
| Trigger rack 8 (visible) | OSC ShowRackByID with ID 7 sent | | |
| Trigger rack 64 (visible) | OSC ShowRackByID with ID 63 sent | | |
| Verify actual displayed rack in SuperRack | Rack matches triggered selection | | |
| Trigger unmapped channel / "None" | No ProLink command sent | | |
| Monitor MIDI output | No MIDI sent for ProLink actions | | |
| Monitor `last_action_timestamp` | Not updated for ProLink actions | | |
| Verify audio patches unchanged | No audio routing changes | | |

**Acceptance:** Rack selection works via ProLink; MIDI isolation confirmed.

---

### Step 5: Snapshot Gates
**Reference:** PROLINK.md § Manual SuperRack acceptance step 5

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Both gates OFF, invoke Recall action | No type-5 command sent | | |
| Both gates OFF, invoke Highlight action | No type-5 command sent | | |
| Enable Highlight gate only, test known provider ID | Highlight without recall | | |
| Enable Highlight gate only, test ID 0 | Test if ID 0 valid for this show | | |
| Enable Recall gate only, test same provider ID | Recall matches highlighted snapshot | | |
| Document ID convention | Provider ID ↔ Snapshot mapping recorded | | |
| Old Hot Snapshot/Plugin actions | Warning without fallback MIDI | | |

**Acceptance:** Snapshot gates enforce correctly; ID semantics documented.

---

### Step 6: Disconnect/Reconnect
**Reference:** PROLINK.md § Manual SuperRack acceptance step 6

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Disconnect peer (pull cable/stop SuperRack) | Companion status leaves "connected" | | |
| Attempt rack/recall actions while disconnected | No type-5 send, no send history update | | |
| Reconnect peer | Hello sent, status returns to "connected" | | |
| No old selection/recall replay on reconnect | No automatic commands | | |
| Repeat disconnect/reconnect 3x | Only one Hello stream per connection | | |
| Second peer while first connected | Second peer rejected | | |

**Acceptance:** Clean disconnect/reconnect; no replay; single peer enforcement.

---

### Step 7: Lifecycle/Errors
**Reference:** PROLINK.md § Manual SuperRack acceptance step 7

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Switch interface repeatedly | Clean restart each time | | |
| Switch MIDI/ProLink modes repeatedly | Serialized stop/start; no overlap | | |
| Switch during pending MIDI two-step | Old second step stopped | | |
| Disable/delete instance | Sockets/timers released | | |
| Occupy UDP 40123 | Visible startup failure | | |
| Select incompatible interface (no IPv6, global, multiple) | Descriptive startup failure | | |
| Correct configuration after failure | Retry succeeds | | |
| Test link interruption (no forced timeout) | No application-level disconnect | | |

**Acceptance:** All lifecycle transitions clean; errors visible and recoverable.

---

### Step 8: Parser Robustness
**Reference:** PROLINK.md § Manual SuperRack acceptance step 8

| Test | Expected | Pass/Fail | Notes |
|------|----------|-----------|-------|
| Send partial headers | Peer disconnects, discovery continues | | |
| Send partial bodies | Peer disconnects, discovery continues | | |
| Send multiple frames in one write | All frames parsed correctly | | |
| Send invalid magic | Peer disconnects | | |
| Send negative/oversized lengths | Peer disconnects | | |
| Disconnect mid-frame | Fresh connection parses independently | | |
| Compare with automated suite | Behavior matches unit tests | | |

**Acceptance:** Malformed peer handled gracefully; discovery survives.

---

## G07 Compliance: Live Readback Approval

This test plan serves as the **approved test profile** for G07. No productive SuperRack write commands (Recall, Highlight, Store, Delete, Move, ChangeControllerValue, SwitchControllerValue) may be executed in live testing without:

1. This plan reviewed and approved
2. Physical SuperRack hardware available
3. Disposable test show loaded
4. All captures recorded

---

## G08 Compliance: AI Security Boundaries

The automation infrastructure enforces:
- No AI push to main branch
- No AI tag creation
- No AI release publish
- Manual GitHub Actions triggers required for release workflows

---

## Results Recording Template

When live testing is performed, record results in:

**File:** `automation/evidence/R09-06-LIVE-RESULTS.json`

```json
{
  "taskId": "R09-06",
  "testDate": "2026-11-16T00:00:00Z",
  "tester": "Name",
  "environment": {
    "os": "Windows 11 / Ubuntu 22.04 / macOS 14",
    "companionVersion": "3.x.x",
    "moduleCommit": "git-sha",
    "superRackProduct": "Performer / SoundGrid",
    "superRackVersion": "V15.x.x",
    "interfaceAddresses": ["fe80::..."],
    "discoveryName": "Mixing Station"
  },
  "steps": {
    "1_legacy_regression": { "pass": true, "notes": "", "captures": [] },
    "2_discovery": { "pass": true, "notes": "", "captures": ["discovery.pcap"] },
    "3_handshake": { "pass": true, "notes": "", "captures": ["handshake.pcap"] },
    "4_rack_selection": { "pass": true, "notes": "", "captures": ["rack_select.pcap"] },
    "5_snapshot_gates": { "pass": true, "notes": "", "captures": [] },
    "6_disconnect_reconnect": { "pass": true, "notes": "", "captures": [] },
    "7_lifecycle_errors": { "pass": true, "notes": "", "captures": [] },
    "8_parser_robustness": { "pass": true, "notes": "", "captures": [] }
  },
  "overallPass": true,
  "blockingIssues": [],
  "minorIssues": []
}
```

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Test Engineer | | | |
| Reviewer | | | |
| Release Manager | | | |

---

## Next Steps

Upon successful live acceptance:
1. Record results in `R09-06-LIVE-RESULTS.json`
2. Update `docs/PROLINK.md` with live-confirmed status
3. Proceed to Phase 0.10.0 (Rack & Snapshot Management)
4. Schedule RELEASE-00 test matrix in isolated test repository