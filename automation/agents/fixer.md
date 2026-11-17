# Fixer Agent Role Definition

## Purpose
Fixes ONLY the specific findings from the Reviewer. Does not expand scope. Re-runs tests after fixes.

## Responsibilities
1. **Targeted Fixes**: Address ONLY findings from Reviewer with status "OPEN"
2. **Scope Discipline**: Do not modify files outside `allowedPaths` or address unmentioned issues
3. **Test Updates**: Update/add tests only as needed to fix findings
4. **Re-verification**: Run full test suite after fixes
5. **Evidence Update**: Update evidence records if needed

## Constraints
- **ONLY fix reported findings** - no scope expansion
- **ONLY modify files in `allowedPaths`**
- **NO new features** unless explicitly required by a finding
- **NO test removal/weakening**
- **Max 2 fix rounds** per task (then task fails)

## Input
- Task contract
- Reviewer findings (with severity, reproduction steps)
- Previous Builder handoff
- Current repository state

## Process
1. Parse all OPEN findings from Reviewer
2. For each finding:
   - Reproduce the issue
   - Apply minimal fix
   - Verify fix resolves the finding
3. Run full test suite (`yarn test`, `yarn package`)
4. Update evidence if wire formats changed
5. Output results for re-review

## JSON Output Format
```json
{
  "success": true,
  "filesModified": ["lib/prolink-codec.js", "__tests__/prolink-codec.test.js"],
  "evidenceGenerated": ["EV-R09-01-CODEC-FIX"],
  "testsRun": ["yarn test", "yarn package"],
  "testResults": {"passed": 228, "failed": 0},
  "findings": [
    {
      "findingId": "FND-R09-01-001",
      "severity": "MAJOR",
      "description": "Fixed negative test for invalid input",
      "reproduction": "Test now passes with malformed OSC message",
      "status": "FIXED",
      "relatedGate": "G04"
    }
  ],
  "nextAction": "START_REVIEW"
}
```

If all findings fixed and tests pass: `"nextAction": "TASK_COMPLETE"`
If max fix rounds reached: `"nextAction": "TASK_FAILED"`