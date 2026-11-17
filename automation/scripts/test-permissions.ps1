<#
.SYNOPSIS
    Permission negative tests - verify agents cannot exceed allowed paths
.DESCRIPTION
    Tests that Builder/Reviewer/Fixer roles cannot write outside their allowedPaths
#>

param(
    [string]$WorktreePath = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30",
    [string]$AutomationRoot = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30\automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$GATE_RUNNER = Join-Path $SCRIPT_DIR "gate-runner.ps1"

Write-Host "=== Permission Negative Tests ==="

# Test 1: Create a task with restricted allowedPaths
$task = @{
    taskId = "PERM-TEST-01"
    version = "1.0.0"
    phase = "A0"
    title = "Permission Test Task"
    description = "Task with restricted allowedPaths"
    allowedPaths = @("automation/state/perm-test.txt")  # Only this file allowed
    dependencies = @()
    evidenceRequirements = @()
    gates = @("G01")
    acceptanceCriteria = @("Only allowed file modified")
    createdAt = (Get-Date -Format "o")
    updatedAt = (Get-Date -Format "o")
    status = "READY"
    assignedRole = "Builder"
    attempts = 0
    fixRounds = 0
}
$taskFile = Join-Path (Join-Path $AutomationRoot "tasks") "PERM-TEST-01.json"
$task | ConvertTo-Json -Depth 5 | Set-Content $taskFile

Write-Host "Created task PERM-TEST-01 with restricted allowedPaths"

# Test 2: Simulate a handoff with scope violation
$handoff = @{
    handoffId = "HO-PERM-TEST-01-Builder-1"
    taskId = "PERM-TEST-01"
    planVersion = "1.0.0"
    sessionNumber = 1
    sessionRole = "Builder"
    baselineCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    resultCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    changedFiles = @(
        @{
            path = "main.js"  # OUTSIDE allowedPaths!
            reason = "Attempted unauthorized modification"
            linesAdded = 10
            linesRemoved = 5
        },
        @{
            path = "automation/state/perm-test.txt"  # This IS allowed
            reason = "Allowed modification"
            linesAdded = 1
            linesRemoved = 0
        }
    )
    createdAt = (Get-Date -Format "o")
    durationMs = 10000
    status = "COMPLETED"
    evidenceIds = @()
    testCommands = @()
    testExitCodes = @()
    reviewerFindings = @()
    risks = @()
    nextAction = "START_REVIEW"
    tokenBudgetUsed = 1000
    apiBudgetUsed = 0
}
$handoffFile = Join-Path (Join-Path $AutomationRoot "handoffs") "HO-PERM-TEST-01-Builder-1.json"
$handoff | ConvertTo-Json -Depth 5 | Set-Content $handoffFile

Write-Host "Created handoff with scope violation (main.js)"

# Test 3: Run G01 gate - should FAIL due to scope violation
Write-Host "`n--- Test G01 with scope violation ---"
$result = & $GATE_RUNNER -Action run-gate -GateId G01 -TaskId PERM-TEST-01
Write-Host "Result: $result"

$resultObj = $result | ConvertFrom-Json
if (-not $resultObj.passed -and $resultObj.message -like "*Scope violation*") {
    Write-Host "✅ G01 correctly detected scope violation"
    $test1Passed = $true
} else {
    Write-Host "❌ G01 failed to detect scope violation"
    $test1Passed = $false
}

# Test 4: Create clean handoff (only allowed paths)
$cleanHandoff = @{
    handoffId = "HO-PERM-TEST-01-Builder-2"
    taskId = "PERM-TEST-01"
    planVersion = "1.0.0"
    sessionNumber = 2
    sessionRole = "Builder"
    baselineCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    resultCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    changedFiles = @(
        @{
            path = "automation/state/perm-test.txt"
            reason = "Allowed modification"
            linesAdded = 1
            linesRemoved = 0
        }
    )
    createdAt = (Get-Date -Format "o")
    durationMs = 5000
    status = "COMPLETED"
    evidenceIds = @()
    testCommands = @()
    testExitCodes = @()
    reviewerFindings = @()
    risks = @()
    nextAction = "START_REVIEW"
    tokenBudgetUsed = 1000
    apiBudgetUsed = 0
}
$cleanHandoffFile = Join-Path (Join-Path $AutomationRoot "handoffs") "HO-PERM-TEST-01-Builder-2.json"
$cleanHandoff | ConvertTo-Json -Depth 5 | Set-Content $cleanHandoffFile

Write-Host "`n--- Test G01 with clean handoff ---"
$result = & $GATE_RUNNER -Action run-gate -GateId G01 -TaskId PERM-TEST-01
Write-Host "Result: $result"

$resultObj = $result | ConvertFrom-Json
if ($resultObj.passed) {
    Write-Host "✅ G01 correctly passes for allowed paths only"
    $test2Passed = $true
} else {
    Write-Host "❌ G01 incorrectly failed for allowed paths"
    $test2Passed = $false
}

# Test 5: Test Reviewer read-only constraint
Write-Host "`n--- Test Reviewer read-only ---"
$reviewerHandoff = @{
    handoffId = "HO-PERM-TEST-01-Reviewer-1"
    taskId = "PERM-TEST-01"
    planVersion = "1.0.0"
    sessionNumber = 1
    sessionRole = "Reviewer"
    baselineCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    resultCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    changedFiles = @(
        @{
            path = "lib/prolink-codec.js"  # Reviewer should NOT modify app code
            reason = "Reviewer attempted modification"
            linesAdded = 5
            linesRemoved = 2
        }
    )
    createdAt = (Get-Date -Format "o")
    durationMs = 5000
    status = "COMPLETED"
    evidenceIds = @()
    testCommands = @()
    testExitCodes = @()
    reviewerFindings = @()
    risks = @()
    nextAction = "TASK_COMPLETE"
    tokenBudgetUsed = 1000
    apiBudgetUsed = 0
}
$reviewerHandoffFile = Join-Path (Join-Path $AutomationRoot "handoffs") "HO-PERM-TEST-01-Reviewer-1.json"
$reviewerHandoff | ConvertTo-Json -Depth 5 | Set-Content $reviewerHandoffFile

# Run G05 - should FAIL because reviewer modified app code
$result = & $GATE_RUNNER -Action run-gate -GateId G05 -TaskId PERM-TEST-01
Write-Host "Result: $result"

$resultObj = $result | ConvertFrom-Json
if (-not $resultObj.passed -and $resultObj.message -like "*Reviewer modified*") {
    Write-Host "✅ G05 correctly detected reviewer modifying app code"
    $test3Passed = $true
} else {
    Write-Host "❌ G05 failed to detect reviewer violation"
    $test3Passed = $false
}

# Test 6: Clean reviewer handoff (no app code changes)
$cleanReviewerHandoff = @{
    handoffId = "HO-PERM-TEST-01-Reviewer-2"
    taskId = "PERM-TEST-01"
    planVersion = "1.0.0"
    sessionNumber = 2
    sessionRole = "Reviewer"
    baselineCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    resultCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    changedFiles = @()  # No changes - read only
    createdAt = (Get-Date -Format "o")
    durationMs = 5000
    status = "COMPLETED"
    evidenceIds = @()
    testCommands = @()
    testExitCodes = @()
    reviewerFindings = @(
        @{
            findingId = "FND-PERM-001"
            severity = "INFO"
            description = "Code looks good"
            reproduction = "N/A"
            status = "OPEN"
            relatedGate = "G05"
        }
    )
    risks = @()
    nextAction = "TASK_COMPLETE"
    tokenBudgetUsed = 1000
    apiBudgetUsed = 0
}
$cleanReviewerHandoffFile = Join-Path (Join-Path $AutomationRoot "handoffs") "HO-PERM-TEST-01-Reviewer-2.json"
$cleanReviewerHandoff | ConvertTo-Json -Depth 5 | Set-Content $cleanReviewerHandoffFile

# Remove the bad reviewer handoff
Remove-Item $reviewerHandoffFile

$result = & $GATE_RUNNER -Action run-gate -GateId G05 -TaskId PERM-TEST-01
Write-Host "Result: $result"

$resultObj = $result | ConvertFrom-Json
if ($resultObj.passed) {
    Write-Host "✅ G05 correctly passes for read-only reviewer"
    $test4Passed = $true
} else {
    Write-Host "❌ G05 incorrectly failed for read-only reviewer"
    $test4Passed = $false
}

# Cleanup
Remove-Item $taskFile
Remove-Item $handoffFile
Remove-Item $cleanHandoffFile
Remove-Item $cleanReviewerHandoffFile

Write-Host "`n=== Permission Tests Summary ==="
Write-Host "Test 1 (Scope violation detected): $($test1Passed)"
Write-Host "Test 2 (Clean handoff passes): $($test2Passed)"
Write-Host "Test 3 (Reviewer violation detected): $($test3Passed)"
Write-Host "Test 4 (Clean reviewer passes): $($test4Passed)"

if ($test1Passed -and $test2Passed -and $test3Passed -and $test4Passed) {
    Write-Host "`n✅ ALL PERMISSION TESTS PASSED"
    exit 0
} else {
    Write-Host "`n❌ SOME PERMISSION TESTS FAILED"
    exit 1
}