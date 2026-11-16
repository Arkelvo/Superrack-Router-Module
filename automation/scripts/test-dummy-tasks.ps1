<#
.SYNOPSIS
    Test script for orchestrator dummy tasks
.DESCRIPTION
    Creates and runs 3 dummy tasks to verify orchestrator functionality
#>

param(
    [string]$WorktreePath = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30",
    [string]$AutomationRoot = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30\automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ORCHESTRATOR = Join-Path $SCRIPT_DIR "orchestrator.ps1"

Write-Host "=== Testing Orchestrator with 3 Dummy Tasks ==="

# Test 1: Simple passing task
Write-Host "`n--- Test 1: DUMMY-PASS-01 (should pass) ---"
$task1 = @{
    taskId = "DUMMY-PASS-01"
    version = "1.0.0"
    phase = "A0"
    title = "Dummy Passing Task"
    description = "Creates a simple file and validates it"
    allowedPaths = @("automation/state/dummy-pass-01.txt")
    dependencies = @()
    evidenceRequirements = @()
    gates = @("G01", "G04")
    acceptanceCriteria = @("File created", "Content valid")
    createdAt = (Get-Date -Format "o")
    updatedAt = (Get-Date -Format "o")
    status = "READY"
    assignedRole = "Builder"
    attempts = 0
    fixRounds = 0
}
$taskFile1 = Join-Path (Join-Path $AutomationRoot "tasks") "DUMMY-PASS-01.json"
$task1 | ConvertTo-Json -Depth 5 | Set-Content $taskFile1

# Since we can't easily launch OpenCode from within this test, simulate the builder work directly
# Create the expected output file
$dummyContent = "Dummy task completed at $(Get-Date -Format 'o')"
Set-Content -Path (Join-Path (Join-Path $AutomationRoot "state") "dummy-pass-01.txt") -Value $dummyContent

Write-Host "Created dummy task DUMMY-PASS-01 and output file"

# Test 2: Another passing task
Write-Host "`n--- Test 2: DUMMY-PASS-02 (should pass) ---"
$task2 = @{
    taskId = "DUMMY-PASS-02"
    version = "1.0.0"
    phase = "A0"
    title = "Second Dummy Passing Task"
    description = "Creates another simple file"
    allowedPaths = @("automation/state/dummy-pass-02.txt")
    dependencies = @()
    evidenceRequirements = @()
    gates = @("G01", "G04")
    acceptanceCriteria = @("File created", "Content valid")
    createdAt = (Get-Date -Format "o")
    updatedAt = (Get-Date -Format "o")
    status = "READY"
    assignedRole = "Builder"
    attempts = 0
    fixRounds = 0
}
$taskFile2 = Join-Path (Join-Path $AutomationRoot "tasks") "DUMMY-PASS-02.json"
$task2 | ConvertTo-Json -Depth 5 | Set-Content $taskFile2

$dummyContent2 = "Second dummy task completed at $(Get-Date -Format 'o')"
Set-Content -Path (Join-Path (Join-Path $AutomationRoot "state") "dummy-pass-02.txt") -Value $dummyContent2

Write-Host "Created dummy task DUMMY-PASS-02 and output file"

# Test 3: Failing task (to test error handling)
Write-Host "`n--- Test 3: DUMMY-FAIL-01 (should fail) ---"
$task3 = @{
    taskId = "DUMMY-FAIL-01"
    version = "1.0.0"
    phase = "A0"
    title = "Dummy Failing Task"
    description = "Task that should fail validation"
    allowedPaths = @("automation/state/dummy-fail-01.txt")
    dependencies = @()
    evidenceRequirements = @()
    gates = @("G01", "G04")
    acceptanceCriteria = @("File created", "Content valid", "This will fail")
    createdAt = (Get-Date -Format "o")
    updatedAt = (Get-Date -Format "o")
    status = "READY"
    assignedRole = "Builder"
    attempts = 0
    fixRounds = 0
}
$taskFile3 = Join-Path (Join-Path $AutomationRoot "tasks") "DUMMY-FAIL-01.json"
$task3 | ConvertTo-Json -Depth 5 | Set-Content $taskFile3

Write-Host "Created dummy task DUMMY-FAIL-01"

# Validate all tasks
Write-Host "`n--- Validating all task contracts ---"
& $ORCHESTRATOR -Action validate

Write-Host "`n=== Dummy Task Setup Complete ==="
Write-Host "Tasks created:"
Write-Host "  - DUMMY-PASS-01 (passing)"
Write-Host "  - DUMMY-PASS-02 (passing)"
Write-Host "  - DUMMY-FAIL-01 (failing - for error handling test)"
Write-Host "`nRun orchestrator with: .\orchestrator.ps1 -Action run-task -TaskId DUMMY-PASS-01 -Role Builder"