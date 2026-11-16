<#
.SYNOPSIS
    Test script for circuit breaker functionality
.DESCRIPTION
    Verifies circuit breaker triggers on repeated failures
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

Write-Host "=== Testing Circuit Breaker ==="

# Test circuit breaker by directly manipulating state
$cbFile = Join-Path $STATE_DIR "circuit-breaker.json"

# Test 1: Initial state
Write-Host "`n--- Test 1: Initial Circuit Breaker State ---"
if (Test-Path $cbFile) {
    Remove-Item $cbFile
}
$stateFile = Join-Path $STATE_DIR "orchestrator-state.json"
if (Test-Path $stateFile) {
    Remove-Item $stateFile
}

# Run orchestrator status to initialize
& $ORCHESTRATOR -Action status | Out-Null

if (Test-Path $cbFile) {
    $cb = Get-Content $cbFile -Raw | ConvertFrom-Json
    Write-Host "Initial state: failures=$($cb.failures), isOpen=$($cb.isOpen), threshold=$($cb.threshold)"
    if ($cb.failures -eq 0 -and $cb.isOpen -eq $false) {
        Write-Host "✅ Initial state correct"
    } else {
        Write-Host "❌ Initial state incorrect"
    }
}

# Test 2: Simulate failures
Write-Host "`n--- Test 2: Simulate 3 Failures ---"
$state = @{
    taskStates = @{}
    circuitBreaker = @{
        failures = 3
        lastFailure = (Get-Date -Format "o")
        isOpen = $false
        threshold = 5
        resetTimeoutMinutes = 30
    }
}
$state | ConvertTo-Json -Depth 5 | Set-Content $stateFile

& $ORCHESTRATOR -Action status | Out-Null

if (Test-Path $cbFile) {
    $cb = Get-Content $cbFile -Raw | ConvertFrom-Json
    Write-Host "After 3 failures: failures=$($cb.failures), isOpen=$($cb.isOpen)"
    if ($cb.failures -eq 3 -and $cb.isOpen -eq $false) {
        Write-Host "✅ Failure counting works"
    } else {
        Write-Host "❌ Failure counting failed"
    }
}

# Test 3: Trigger circuit breaker
Write-Host "`n--- Test 3: Trigger Circuit Breaker (5 failures) ---"
$state.circuitBreaker.failures = 5
$state | ConvertTo-Json -Depth 5 | Set-Content $stateFile

& $ORCHESTRATOR -Action status | Out-Null

if (Test-Path $cbFile) {
    $cb = Get-Content $cbFile -Raw | ConvertFrom-Json
    Write-Host "After 5 failures: failures=$($cb.failures), isOpen=$($cb.isOpen)"
    if ($cb.failures -eq 5 -and $cb.isOpen -eq $true) {
        Write-Host "✅ Circuit breaker triggered correctly"
    } else {
        Write-Host "❌ Circuit breaker not triggered"
    }
}

# Test 4: Verify blocked when open
Write-Host "`n--- Test 4: Verify Blocked When Open ---"
# Create a task that would run
$task = @{
    taskId = "CB-TEST-01"
    version = "1.0.0"
    phase = "A0"
    title = "Circuit Breaker Test Task"
    description = "Should be blocked by circuit breaker"
    allowedPaths = @("automation/state/cb-test.txt")
    dependencies = @()
    evidenceRequirements = @()
    gates = @("G01")
    acceptanceCriteria = @("Should not run")
    createdAt = (Get-Date -Format "o")
    updatedAt = (Get-Date -Format "o")
    status = "READY"
    assignedRole = "Builder"
    attempts = 0
    fixRounds = 0
}
$taskFile = Join-Path $AutomationRoot "tasks" "CB-TEST-01.json"
$task | ConvertTo-Json -Depth 5 | Set-Content $taskFile

# Try to run - should be blocked
Write-Host "Attempting to run task with open circuit breaker..."
$result = & $ORCHESTRATOR -Action run-task -TaskId CB-TEST-01 -Role Builder 2>&1
Write-Host "Result: $result"

if ($result -like "*CIRCUIT BREAKER IS OPEN*") {
    Write-Host "✅ Task correctly blocked by circuit breaker"
} else {
    Write-Host "❌ Task not blocked (may have run)"
}

# Test 5: Reset circuit breaker
Write-Host "`n--- Test 5: Reset Circuit Breaker ---"
$state.circuitBreaker.failures = 0
$state.circuitBreaker.isOpen = $false
$state.circuitBreaker.lastFailure = $null
$state | ConvertTo-Json -Depth 5 | Set-Content $stateFile

& $ORCHESTRATOR -Action status | Out-Null

if (Test-Path $cbFile) {
    $cb = Get-Content $cbFile -Raw | ConvertFrom-Json
    Write-Host "After reset: failures=$($cb.failures), isOpen=$($cb.isOpen)"
    if ($cb.failures -eq 0 -and $cb.isOpen -eq $false) {
        Write-Host "✅ Circuit breaker reset correctly"
    } else {
        Write-Host "❌ Circuit breaker reset failed"
    }
}

Write-Host "`n=== Circuit Breaker Tests Complete ==="