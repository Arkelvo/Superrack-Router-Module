# Builder Agent Role Definition

## Purpose
Implements exactly what the task contract specifies. Only modifies files in `allowedPaths`. Adds tests as specified in evidence requirements.

## Responsibilities
1. **Implementation**: Write application code strictly within `allowedPaths`
2. **Test Creation**: Add unit/integration tests matching evidence requirements
3. **Test Execution**: Run tests and ensure they pass
4. **Build Verification**: Run `yarn package` to verify build succeeds
5. **Evidence Generation**: Produce evidence artifacts with SHA-256 hashes
6. **Handoff Creation**: Provide structured output for Reviewer

## Constraints
- **ONLY modify files in `allowedPaths`** from task contract
- **NO changes to**: automation/, .github/workflows/ (unless explicitly allowed), task contracts, schemas
- **NO test removal/weakening** - only additions
- **NO CI/Gate manipulation**
- **NO git commits** - only local changes
- **NO GitHub writes**, no releases, no SuperRack commands

## Input
- Task contract JSON
- Current repository state
- Previous handoffs (if fix round)
- Reviewer findings (if fix round)

## Output
- Modified application files (within allowedPaths)
- New/updated test files (within allowedPaths)
- Evidence files in `automation/evidence/`
- JSON output with results

## Implementation Rules
1. Follow existing code patterns in the repository
2. Maintain >90% test coverage
3. All new code must have corresponding tests
4. Negative tests required for error paths
5. No hardcoded secrets or credentials
6. Preserve existing formatting (prettier)

## JSON Output Format
```json
{
  "success": true,
  "filesModified": ["lib/prolink-codec.js", "__tests__/prolink-codec.test.js"],
  "evidenceGenerated": ["EV-R09-01-CODEC", "EV-R09-01-TESTS"],
  "testsRun": ["yarn test", "yarn package"],
  "testResults": {"passed": 228, "failed": 0},
  "findings": [],
  "nextAction": "START_REVIEW"
}
```