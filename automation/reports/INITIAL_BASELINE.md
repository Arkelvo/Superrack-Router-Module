# Initial Baseline Report

**Generated:** 2026-11-16 00:18:38  
**Plan:** PROLINK_AUTONOMOUS_MASTER_PLAN.md  
**Start Prompt:** START_AUTONOMOUS_PLAN.md  
**Repository:** Arkelvo/Superrack-Router-Module  
**Worktree:** C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30

---

## 1. Repository State

| Property | Value |
|----------|-------|
| Git Remote | https://github.com/Schaack-Jan/companion-module-waves-superrack-router.git |
| Default Branch | main |
| Current Branch | t3/309e7c30 |
| HEAD Commit SHA | 6497309a36b31b5a90d243b52f4055803b86cfef |
| Git Status | Clean (nothing to commit, working tree clean) |
| Last Release Tag | 0.8.2 (2026-10-24) |

---

## 2. Plan File Verification

| File | Absolute Path | SHA-256 |
|------|---------------|---------|
| Master Plan | C:\Users\jan-s\Documents\GitHub\companion-module-waves-superrack-router\automation\plans\PROLINK_AUTONOMOUS_MASTER_PLAN.md | 49f67941302cca74546880a4c7dd09ebf533f6d52557869e179f119f391e7a48 |
| Start Prompt | C:\Users\jan-s\Documents\GitHub\companion-module-waves-superrack-router\automation\prompts\START_AUTONOMOUS_PLAN.md | 5f277f23455f50811d259ed6634327a10a99b928ee0cf62e3c6ad040f37d25b6 |

**Status:** Both files exist on local disk and are readable.

---

## 3. Version State

| File | Version |
|------|---------|
| package.json | 0.8.2 |
| companion/manifest.json | 0.7.1 |
| Last GitHub Release | 0.8.2 |

**Known Deviation:** `package.json` (0.8.2) vs `companion/manifest.json` (0.7.1) — documented in Master Plan as baseline exception.

---

## 4. Runtime Environment

| Tool | Version |
|------|---------|
| Node.js | v22.23.1 |
| Yarn | 4.10.3 |
| PowerShell | 5.1.26100.9818 |
| OpenCode CLI | v2.3.0 |
| OS | Windows 11 (Build 26100) |
| packageManager | yarn@4.10.3 |
| Engines (package.json) | node >=18 <23 |

---

## 5. Test Baseline

**Command:** `yarn test`  
**Exit Code:** 0  
**Result:** 32 test suites passed, 228 tests passed, 0 failed  
**Duration:** 10.353s  

All tests pass cleanly at baseline.

---

## 6. Build Baseline

**Command:** `yarn package`  
**Exit Code:** 0  
**Output Artifact:** waves-superrack-router-0.8.2.tgz  
**Build Status:** Successful

---

## 7. CI/CD Workflows (in source repository)

Located at: C:\Users\jan-s\Documents\GitHub\companion-module-waves-superrack-router\.github\workflows\

| Workflow | Status | Notes |
|----------|--------|-------|
| release-on-version-change.yaml | Active | Uses Node 24 (conflicts with project node <23); creates releases on package.json/manifest.json changes to main |
| pr-unit-test.yaml | Active | Triggers on review events only (not all PR pushes); uses Node 22 |
| build-module-package.yaml | Active | Build verification |
| build-midi-helper.yaml | Active | MIDI helper build |
| companion-module-checks.yaml.inactive | Inactive | Disabled |

**Key Issues Identified:**
1. `release-on-version-change.yaml` uses Node 24 but project declares node <23
2. `pr-unit-test.yaml` does not trigger on all PR pushes (only review events)
3. Existing release workflow must be replaced/deactivated per Master Plan Section 2.3

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Version mismatch (package.json vs manifest.json) | Medium | Addressed in A0-02 Baseline Audit; will be synchronized via new Draft-first pipeline |
| Existing release workflow conflicts with new Draft-first process | High | Must be deactivated/replaced in A0-07 before enabling new pipeline |
| CI not running on all PR pushes | Medium | Fix in A0-06 CI hardening |
| Node version mismatch in CI | Medium | Align to Node 22 in A0-06 |
| No .github/workflows in current worktree | Low | Worktree created from specific commit; workflows exist in source repo |

---

## 9. Next Steps (Phase A0)

Per Master Plan Section 8, immediate work without further approval:

1. ✅ Plan and Start Prompt verified on disk (SHA-256 documented)
2. ✅ Repository and runtime audited read-only
3. ✅ Version/CI deviations listed
4. → **Next:** Implement automation/ Task Registry, Schemas, Orchestrator (A0-03, A0-04, A0-05)
5. → **Next:** CI hardening (A0-06)
6. → **Next:** Draft-first Release Pipeline (A0-07)
7. → **Next:** Governance Acceptance (A0-08)

---

## 10. Compliance

- No application code changes made
- No GitHub writes performed
- No Release or SuperRack commands executed
- All secrets protected (none in this report)
- Baseline documented per Master Plan A0-01 and Start Prompt requirements

---

**Report Status:** INITIAL_BASELINE_COMPLETE  
**Next Gate:** A0-02 Baseline & CI Audit