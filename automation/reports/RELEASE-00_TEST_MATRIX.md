# RELEASE-00 Test Matrix

**Plan Version:** 1.0.0  
**Date:** 2026-11-16  
**Status:** DOCUMENTED

---

## Purpose

Document the complete test matrix for the Draft-first Release Pipeline (Gate RELEASE-00). All tests must pass before the pipeline is activated for production use.

---

## Test Categories

### Positive Tests (Must Pass)

| ID | Test Case | Description | Expected Result |
|----|-----------|-------------|-----------------|
| PT-01 | Draft creation | User creates draft release with new tag (e.g., 0.9.0) targeting main | Draft created, not published |
| PT-02 | Prepare workflow | User triggers Prepare workflow with draft tag | PR created with version sync, tests pass |
| PT-03 | PR merge | User reviews and merges PR | Version synced in both files on main |
| PT-04 | Finalize workflow | User triggers Finalize workflow | Tag created, package built, asset uploaded to draft |
| PT-05 | Readiness report | Finalize workflow produces READY_TO_PUBLISH | Report with tag, commit SHA, package SHA256, versions |
| PT-06 | Manual publish | User publishes draft in GitHub UI | Release published with tag and asset |
| PT-07 | Audit workflow | release.published triggers audit | PUBLISHED_VERIFIED status |
| PT-08 | Idempotent prepare | Re-run Prepare on same draft | No duplicate PR, idempotent |
| PT-09 | Stable version | Draft with 0.9.0 | Full pipeline works |
| PT-10 | Prerelease version | Draft with 0.9.0-beta.1 | Full pipeline works |

### Negative Tests (Must Fail Appropriately)

| ID | Test Case | Description | Expected Result |
|----|-----------|-------------|-----------------|
| NT-01 | Invalid version format | Draft tag "vfoo" or "0.4.6.5" | Prepare fails validation |
| NT-02 | Duplicate version | Draft tag matching existing release | Prepare fails "version exists" |
| NT-03 | Existing tag on different commit | Tag 0.9.0 exists but points elsewhere | Finalize fails "tag exists on different SHA" |
| NT-04 | Draft already published | User tries to Prepare published draft | Prepare fails "draft not found" |
| NT-05 | Draft deleted | Draft deleted before Finalize | Finalize fails "draft not found" |
| NT-06 | Wrong target branch | Draft targets develop not main | Prepare fails "wrong target" |
| NT-07 | Version mismatch | package.json != manifest.json after sync | Prepare fails verification |
| NT-08 | Build failure | yarn package fails | Prepare/Failize fails |
| NT-09 | Test failure | yarn test fails | Prepare/Finalize fails |
| NT-10 | Premature publish | User publishes before READY_TO_PUBLISH | Audit fails RELEASE_BLOCKED |
| NT-11 | Immutable release | Force-tag or asset replacement attempted | Finalize/Audit fails RELEASE_BLOCKED |
| NT-12 | Missing asset | Draft published without .tgz | Audit fails RELEASE_BLOCKED |
| NT-13 | Version file mismatch | Tag points to commit with wrong version | Audit fails RELEASE_BLOCKED |
| NT-14 | GITHUB_TOKEN limits | GITHUB_TOKEN doesn't trigger follow-up | Manual Finalize trigger works |

---

## Test Execution Strategy

### Phase 1: Isolated Test Repository
- Create test repository `Arkelvo/Superrack-Router-Module-Test`
- Run all positive and negative tests
- Document results with evidence

### Phase 2: Production Repository (Controlled)
- Run positive tests PT-01 through PT-08 with version 0.8.3
- Verify all gates pass
- Document evidence

### Phase 3: Gate RELEASE-00 Sign-off
- All positive tests pass
- All negative tests fail as expected
- No RELEASE_BLOCKED in positive scenarios
- Manual approval to activate pipeline

---

## Evidence Requirements

Each test must produce:
- GitHub Actions run URL
- Exit codes
- Artifact hashes (for package)
- Version verification output
- Audit log entries

---

## Acceptance Criteria for RELEASE-00

1. ✅ All positive tests pass in isolated test repository
2. ✅ All negative tests fail with correct error messages
3. ✅ No automated publish without human step
4. ✅ Immutable release handling verified
5. ✅ Version sync verified both directions
6. ✅ Package artifact matches tagged commit
7. ✅ Audit workflow detects all failure modes
8. ✅ Pipeline documented and approved

---

## Current Status

| Test | Status | Evidence |
|------|--------|----------|
| PT-01 | NOT_RUN | - |
| PT-02 | NOT_RUN | - |
| PT-03 | NOT_RUN | - |
| PT-04 | NOT_RUN | - |
| PT-05 | NOT_RUN | - |
| PT-06 | NOT_RUN | - |
| PT-07 | NOT_RUN | - |
| PT-08 | NOT_RUN | - |
| PT-09 | NOT_RUN | - |
| PT-10 | NOT_RUN | - |
| NT-01 | NOT_RUN | - |
| NT-02 | NOT_RUN | - |
| NT-03 | NOT_RUN | - |
| NT-04 | NOT_RUN | - |
| NT-05 | NOT_RUN | - |
| NT-06 | NOT_RUN | - |
| NT-07 | NOT_RUN | - |
| NT-08 | NOT_RUN | - |
| NT-09 | NOT_RUN | - |
| NT-10 | NOT_RUN | - |
| NT-11 | NOT_RUN | - |
| NT-12 | NOT_RUN | - |
| NT-13 | NOT_RUN | - |
| NT-14 | NOT_RUN | - |

---

## Next Steps

1. Create isolated test repository
2. Execute all test cases
3. Document evidence
4. Obtain RELEASE-00 gate approval
5. Activate pipeline for production use