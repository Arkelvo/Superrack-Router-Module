# Operations Manual - ProLink Autonomous Development

**Version:** 1.0.0  
**Date:** 2026-11-16  
**Plan:** PROLINK_AUTONOMOUS_MASTER_PLAN.md

---

## Overview

This manual describes the operational procedures for the ProLink Autonomous Development system on Windows using OpenCode and T3 Code.

---

## System Components

### 1. Windows Orchestrator
**Location:** `automation/scripts/orchestrator.ps1`

**Usage:**
```powershell
# Run a task
.\orchestrator.ps1 -Action run-task -TaskId A0-04 -Role Builder

# Validate all tasks
.\orchestrator.ps1 -Action validate

# List all tasks
.\orchestrator.ps1 -Action list-tasks

# Check status
.\orchestrator.ps1 -Action status
```

**Features:**
- Manages independent OpenCode sessions per role (Planner, Builder, Reviewer, Fixer)
- Process groups, timeouts, exit codes handling
- JSON protocol for task input/output
- Resume/restart capability
- Circuit breaker prevents infinite retry loops

### 2. Gate Runner
**Location:** `automation/scripts/gate-runner.ps1`

**Usage:**
```powershell
# Run specific gate
.\gate-runner.ps1 -Action run-gate -GateId G01 -TaskId A0-04

# Run all gates for task
.\gate-runner.ps1 -Action run-all-gates -TaskId A0-04

# List all gates
.\gate-runner.ps1 -Action list-gates
```

**Gates:**
- G01: Task Contract & Allowed Paths
- G02: Evidence IDs Reference Real Sources
- G03: Codec/API Schema Strict
- G04: Tests Including Negative/Timeout/Disconnect/Focus
- G05: Independent Read-only Review
- G06: Package Build & Content
- G07: Live Readback Only with Approved Test Profile
- G08: No Main Merge/Tag Push/Release Publish by AI
- G09: Release Tag, Versions, Build Commit, Asset Hash
- G10: Rollback & Documented Changes

### 3. Version Sync
**Location:** `scripts/version-sync.mjs`

**Usage:**
```bash
# Write version to both files
node scripts/version-sync.mjs --write 0.9.0

# Check version in both files
node scripts/version-sync.mjs --check 0.9.0
```

---

## Task Execution Workflow

### Standard Task Flow
1. **Planner** creates/updates task contract in `automation/tasks/`
2. **Orchestrator** validates dependencies satisfied
3. **Builder** implements in new OpenCode session (allowedPaths only)
4. **Tests** run automatically (yarn test, yarn package)
5. **Reviewer** performs read-only review in new OpenCode session
6. **Fixer** addresses findings (max 2 rounds)
7. **Gate Runner** verifies all gates
8. **Handoff** persisted to `automation/handoffs/`

### Starting a New Task
```powershell
# 1. Ensure task contract exists in automation/tasks/TASK-ID.json
# 2. Run with Builder role
.\orchestrator.ps1 -Action run-task -TaskId TASK-ID -Role Builder -MaxAttempts 3 -MaxFixRounds 2 -TimeoutMinutes 20
```

### Resuming After Interruption
```powershell
# Check status
.\orchestrator.ps1 -Action status

# Resume (to be implemented)
.\orchestrator.ps1 -Action resume -TaskId TASK-ID
```

---

## GitHub Release Process (Draft-First)

### 1. User Creates Draft Release
- Go to GitHub → Releases → "Draft a new release"
- Enter tag (e.g., `0.9.0`), target `main`
- Click "Save draft" (DO NOT PUBLISH)

### 2. Prepare Workflow
- Go to GitHub → Actions → "Prepare Release Draft"
- Enter draft tag (e.g., `0.9.0`)
- Click "Run workflow"

**What happens:**
- Validates draft exists and is not published
- Creates branch `release/version-sync/0.9.0`
- Runs `version-sync --write 0.9.0`
- Runs tests and build
- Creates PR with version changes

### 3. Review and Merge PR
- Review PR changes (package.json, manifest.json)
- Ensure CI passes
- Merge PR to main

### 4. Finalize Workflow
- Go to GitHub → Actions → "Finalize Release Draft"
- Enter draft tag (e.g., `0.9.0`)
- Click "Run workflow"

**What happens:**
- Runs tests on final commit
- Builds package
- Creates tag on final commit
- Uploads .tgz to draft release
- Generates READY_TO_PUBLISH report

### 5. Manual Publish
- Go to GitHub → Releases
- Find draft for `0.9.0`
- Click "Publish release"

### 6. Audit Workflow
- Automatically triggered on `release.published`
- Verifies tag, versions, asset hash
- Reports PUBLISHED_VERIFIED or RELEASE_BLOCKED

---

## Directory Structure

```
automation/
├── agents/           # Role definitions (Planner, Builder, Reviewer, Fixer)
├── evidence/         # Evidence files (EV-*.json)
├── handoffs/         # Session handoffs (HO-*.json)
├── reports/          # Reports and manuals
├── scripts/          # Orchestrator, gate runner, tests
├── schemas/          # JSON schemas
├── state/            # Runtime state (circuit breaker, global state)
├── tasks/            # Task contracts (A0-*.json, R09-*.json, etc.)
├── artifacts/        # Local build artifacts
└── roadmap.json      # Complete phase/task hierarchy
```

---

## Security Boundaries

### Agent Permissions
| Role | Read | Write | GitHub | SuperRack |
|------|------|-------|--------|-----------|
| Planner | All | automation/tasks/, schemas/, roadmap.json | No | No |
| Builder | All | Task allowedPaths only | No | No |
| Reviewer | All | NONE (read-only) | No | No |
| Fixer | All | Task allowedPaths only | No | No |
| Orchestrator | All | automation/state/, handoffs/ | No | No |
| Gate Runner | All | NONE (verification only) | No | No |

### Protected Resources (Agent CANNOT Modify)
- `.github/workflows/` (except via PR)
- `scripts/version-sync.mjs`
- `automation/schemas/gate.schema.json`
- `automation/state/circuit-breaker.json`
- `automation/state/orchestrator-state.json`
- Git tags, main branch, GitHub releases

---

## Troubleshooting

### Circuit Breaker Open
```powershell
# Check state
.\orchestrator.ps1 -Action status

# Manual reset (delete state files)
Remove-Item automation/state/circuit-breaker.json
Remove-Item automation/state/orchestrator-state.json
```

### Task Stuck
```powershell
# Check handoffs
ls automation/handoffs/HO-TASK-ID-*.json

# Check task status
cat automation/tasks/TASK-ID.json | jq .status
```

### Version Sync Issues
```bash
# Check current versions
node scripts/version-sync.mjs --check 0.9.0

# Force sync (use with caution)
node scripts/version-sync.mjs --write 0.9.0
```

### CI Failures
- Check GitHub Actions logs
- Common: Node version mismatch (use 22), yarn install issues
- Run locally: `yarn install --immutable && yarn test && yarn package`

---

## Emergency Procedures

### Stop All Automation
```powershell
# Kill any running OpenCode processes
taskkill /F /IM opencode.exe

# Reset circuit breaker
Remove-Item automation/state/circuit-breaker.json -ErrorAction SilentlyContinue
```

### Rollback Git Changes
```bash
# If AI made unwanted commits (should not happen)
git reset --hard HEAD~1
git push --force-with-lease origin main
```

### Revoke GitHub Token
- GitHub Settings → Developer settings → Personal access tokens
- Revoke any compromised tokens

---

## Contact & Escalation

- **Plan Issues:** Refer to `PROLINK_AUTONOMOUS_MASTER_PLAN.md`
- **Technical Issues:** Check handoffs and evidence in `automation/`
- **Security Incidents:** Follow emergency procedures above
- **User Approval Required:** Gates G07, G08, G09, G10