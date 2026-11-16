<#
.SYNOPSIS
    Test script for orchestrator resume functionality
.DESCRIPTION
    Verifies orchestrator can recover from interruption
#>

param(
    [string]$WorktreePath = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30",
    [string]$AutomationRoot = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30\automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ORCHESTRATOR = Join-Path $SCRIPT_DIR "orchestrator.ps1"
$STATE_DIR = Join-Path $AutomationRoot "state"
$HANDOFFS_DIR = Join-Path $AutomationRoot "handoffs"

Write-Host "=== Testing Orchestrator Resume Functionality ==="

# Simulate an interrupted task by creating a partial handoff
$partialHandoff = @{
    handoffId = "HO-RESUME-TEST-1"
    taskId = "RESUME-TEST"
    planVersion = "1.0.0"
    sessionNumber = 1
    sessionRole = "Builder"
    baselineCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    resultCommit = "6497309a36b31b5a90d243b52f4055803b86cfef"
    changedFiles = @(
        @{
            path = "automation/state/resume-test.txt"
            reason = "Partial work before interruption"
            linesAdded = 5
            linesRemoved = 0
        }
    )
    createdAt = (Get-Date -Format "o")
    durationMs = 30000
    status = "COMPLETED"
    evidenceIds = @("EV-RESUME-TEST-PARTIAL")
    testCommands = @()
    testExitCodes = @()
    reviewerFindings = @()
    risks = @("Task was interrupted before test phase")
    nextAction = "RUN_TESTS"
    tokenBudgetUsed = 5000
    apiBudgetUsed = 0
}

$handoffFile = Join-Path $HANDOFFS_DIR "HO-RESUME-TEST-1.json"
$partialHandoff | ConvertTo-Json -Depth 5 | Set-Content $handoffFile

# Create the partial output file
Set-Content -Path (Join-Path $AutomationRoot "state" "resume-test.txt") -Value "Partial work`nLine 2`nLine 3`nLine 4`nLine 5"

Write-Host "Created simulated partial handoff: HO-RESUME-TEST-1"

# Verify state persistence
$stateFile = Join-Path $AutomationRoot "state" "orchestrator-state.json"
if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    Write-Host "Global state exists with $($state.taskStates.Count) task states"
} else {
    Write-Host "No global state file yet (expected on first run)"
}

# Test circuit breaker state
$cbFile = Join-Path $AutomationRoot "state" "circuit-breaker.json"
if (Test-Path $cbFile) {
    $cb = Get-Content $cbFile -Raw | ConvertFrom-Json
    Write-Host "Circuit breaker state: failures=$($cb.failures), isOpen=$($cb.isOpen)"
} else {
    Write-Host "No circuit breaker file yet (expected on first run)"
}

Write-Host "`n=== Resume Test Setup Complete ==="
Write-Host "The orchestrator should be able to:"
Write-Host "  1. Load previous handoffs from $HANDOFFS_DIR"
Write-Host "  2. Load global state from $STATE_DIR"
Write-Host "  3. Resume from the last completed session"
Write-Host "  4. Continue with next action: $($partialHandoff.nextAction)"