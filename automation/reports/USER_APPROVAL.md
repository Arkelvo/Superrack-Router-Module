# User Approval for A0 Infrastructure Changes

**Date:** 2026-11-16  
**Phase:** A0 - Automation Foundation  
**Status:** PENDING USER APPROVAL ⏳

---

## Overview

This document requests user approval for the infrastructure and permission changes implemented during Phase A0 (Automation Foundation) of the ProLink Autonomous Development Plan.

---

## Changes Requiring Approval

### 1. GitHub Actions Workflows
**New workflows created:**
- `pr-checks.yml` - Runs on PR open/synchronize/reopen (Node 22)
- `release-prepare.yml` - Manual trigger via GitHub Actions UI (Draft → PR)
- `release-finalize.yml` - Manual trigger via GitHub Actions UI (PR merge → tag + asset)
- `release-audit.yml` - Auto-trigger on `release.published` (verification only)

**Old workflow disabled:**
- `release-on-version-change.yaml` → `release-on-version-change.yaml.disabled`

**Impact:** Changes how releases are created. Old automatic release on version change is replaced by manual Draft-first process.

### 2. Version Management
**New script:** `scripts/version-sync.mjs`
- Synchronizes `package.json` and `companion/manifest.json` versions
- Used by release-prepare workflow
- Manual CLI available: `node scripts/version-sync.mjs --write|--check <version>`

**Impact:** Version changes now require Draft-first process; no direct editing of version files.

### 3. Automation Infrastructure
**New directories and files in `automation/`:**
- `schemas/` - 6 JSON schemas for validation
- `tasks/` - Task contracts with allowedPaths and gates
- `agents/` - Role definitions (Planner, Builder, Reviewer, Fixer)
- `scripts/` - Orchestrator, gate runner, test scripts
- `evidence/` - Evidence tracking with SHA-256
- `handoffs/` - Session persistence for resume/restart
- `state/` - Circuit breaker, global state
- `roadmap.json` - Complete phase/task hierarchy (33 tasks)

**Impact:** Structured automation framework for all future development.

### 4. Security Boundaries
**Enforced permissions:**
- Agents cannot modify `.github/workflows/` directly
- Agents cannot modify `scripts/version-sync.mjs`
- Agents cannot modify `automation/schemas/gate.schema.json`
- Agents cannot push to `main`, create tags, or publish releases
- Circuit breaker prevents runaway automation

**Impact:** Hard security boundaries prevent uncontrolled AI actions.

### 5. Windows Orchestration
**New capability:** PowerShell orchestrator (`automation/scripts/orchestrator.ps1`)
- Manages independent OpenCode sessions per role
- Process isolation, timeouts, exit code handling
- JSON protocol for task I/O
- Resume/restart capability
- Circuit breaker

**Impact:** Deterministic, recoverable automation on Windows.

---

## Approval Checklist

Please review and confirm each item:

### GitHub/Release Process
- [ ] Approve new Draft-first release workflow (replaces automatic release)
- [ ] Approve manual trigger requirement for Prepare/Finalize workflows
- [ ] Approve manual publish step (no auto-publish)
- [ ] Approve disabling of `release-on-version-change` workflow

### Version Management
- [ ] Approve version-sync script as single source of version updates
- [ ] Approve that version changes only via Draft-first process
- [ ] Acknowledge baseline version mismatch (0.8.2 vs 0.7.1) as documented exception

### Automation Framework
- [ ] Approve automation directory structure and schemas
- [ ] Approve task contract system with allowedPaths enforcement
- [ ] Approve 4-role model (Planner, Builder, Reviewer, Fixer)
- [ ] Approve evidence/handoff persistence system

### Security
- [ ] Approve hard security boundaries (no main push, no tag, no publish by AI)
- [ ] Approve circuit breaker and rate limiting
- [ ] Approve that SuperRack write commands require G07 approval

### Windows Operations
- [ ] Approve PowerShell orchestrator for task execution
- [ ] Approve OpenCode CLI as session executor
- [ ] Acknowledge T3 Code as optional UI only

---

## User Confirmation

**I have reviewed the above changes and approve the A0 infrastructure for production use.**

| Item | Approved (Y/N) | Notes |
|------|----------------|-------|
| GitHub/Release Process |  |  |
| Version Management |  |  |
| Automation Framework |  |  |
| Security Boundaries |  |  |
| Windows Operations |  |  |

**User Name:** _________________________  
**Date:** _________________________  
**Signature:** _________________________

---

## Next Steps After Approval

1. **A0 RELEASE-GATE** marked as passed
2. **Phase 0.9.0** (Plugin Control Foundation) can begin
3. **First task:** R09-01 Codec: SwitchControllerValue Implementation
4. **RELEASE-00** test matrix execution in isolated test repository (parallel)