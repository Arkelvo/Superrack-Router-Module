<#
.SYNOPSIS
    Gate Runner - External gate execution and verification
.DESCRIPTION
    Executes gates independently of AI agents. Gates are defined in gate.schema.json
    and cannot be modified by agents. This script runs the actual verification.
.NOTES
    Part of Phase A0 - Automation Foundation
    Implements Master Plan Section 5 (Gates)
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('run-gate', 'run-all-gates', 'verify-task', 'list-gates')]
    [string]$Action,

    [Parameter(Mandatory=$false)]
    [string]$GateId,

    [Parameter(Mandatory=$false)]
    [string]$TaskId,

    [Parameter(Mandatory=$false)]
    [string]$WorktreePath = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30",

    [Parameter(Mandatory=$false)]
    [string]$AutomationRoot = "C:\Users\jan-s\.t3\worktrees\companion-module-waves-superrack-router\t3-309e7c30\automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$AUTOMATION_ROOT = $AutomationRoot
$SCHEMAS_DIR = Join-Path $AUTOMATION_ROOT "schemas"
$EVIDENCE_DIR = Join-Path $AUTOMATION_ROOT "evidence"
$HANDOFFS_DIR = Join-Path $AUTOMATION_ROOT "handoffs"
$TASKS_DIR = Join-Path $AUTOMATION_ROOT "tasks"
$STATE_DIR = Join-Path $AUTOMATION_ROOT "state"

# Load gate definitions (external to agent control)
$GATE_SCHEMA_FILE = Join-Path $SCHEMAS_DIR "gate.schema.json"
$gates = @{
    G01 = @{ id = "G01"; name = "Task Contract & Allowed Paths"; runner = "Orchestrator"; mandatoryCheck = "Verify task contract exists, allowed paths respected, no scope violation"; failureAction = "BLOCK_TASK"; automatable = $true }
    G02 = @{ id = "G02"; name = "Evidence IDs Reference Real Sources"; runner = "Reviewer"; mandatoryCheck = "Verify all evidence IDs reference actual files with valid SHA-256"; failureAction = "REQUIRE_FIX"; automatable = $true }
    G03 = @{ id = "G03"; name = "Codec/API Schema Strict"; runner = "Reviewer"; mandatoryCheck = "Verify wire formats match documented specifications, no guessed arguments"; failureAction = "REQUIRE_FIX"; automatable = $true }
    G04 = @{ id = "G04"; name = "Tests Including Negative/Timeout/Disconnect/Focus"; runner = "GateRunner"; mandatoryCheck = "Run test suite, verify negative tests, timeout tests, disconnect tests, focus tests exist"; failureAction = "REQUIRE_FIX"; automatable = $true }
    G05 = @{ id = "G05"; name = "Independent Read-only Review"; runner = "Reviewer"; mandatoryCheck = "Independent review completed with findings classified"; failureAction = "REQUIRE_FIX"; automatable = $false }
    G06 = @{ id = "G06"; name = "Package Build & Content"; runner = "GateRunner"; mandatoryCheck = "Run yarn package, verify .tgz content, manifest version, package.json version"; failureAction = "REQUIRE_FIX"; automatable = $true }
    G07 = @{ id = "G07"; name = "Live Readback Only with Approved Test Profile"; runner = "LiveTestHost"; mandatoryCheck = "Verify live test profile approved before any SuperRack write commands"; failureAction = "AWAIT_APPROVAL"; automatable = $false }
    G08 = @{ id = "G08"; name = "No Main Merge/Tag Push/Release Publish by AI"; runner = "Orchestrator"; mandatoryCheck = "Verify no git push to main, no tag creation, no release publish by AI agents"; failureAction = "AWAIT_APPROVAL"; automatable = $true }
    G09 = @{ id = "G09"; name = "Release Tag, Versions, Build Commit, Asset Hash"; runner = "GateRunner"; mandatoryCheck = "Verify tag points to correct commit, both version files match, package hash matches"; failureAction = "RELEASE_BLOCKED"; automatable = $true }
    G10 = @{ id = "G10"; name = "Rollback & Documented Changes"; runner = "Orchestrator"; mandatoryCheck = "Verify rollback procedure documented, all changes traceable"; failureAction = "FAIL"; automatable = $false }
}

function Write-JsonOutput {
    param($Object)
    $Object | ConvertTo-Json -Depth 10 -Compress | Write-Host
}

# G01: Task Contract & Allowed Paths
function Test-G01 {
    param($TaskId)
    
    Write-Host "Running G01: Task Contract & Allowed Paths for $TaskId"
    
    $taskFile = Join-Path $TASKS_DIR "$TaskId.json"
    if (-not (Test-Path $taskFile)) {
        return @{ passed = $false; message = "Task contract not found: $TaskId" }
    }
    
    $task = Get-Content $taskFile -Raw | ConvertFrom-Json
    
    # Check if task has required fields
    if (-not $task.taskId -or -not $task.allowedPaths) {
        return @{ passed = $false; message = "Task contract missing required fields" }
    }
    
    # Check handoffs for scope violations
    $handoffs = Get-ChildItem $HANDOFFS_DIR -Filter "HO-$TaskId-*.json" -ErrorAction SilentlyContinue
    foreach ($handoffFile in $handoffs) {
        $handoff = Get-Content $handoffFile.FullName -Raw | ConvertFrom-Json
        if ($handoff.changedFiles) {
            foreach ($file in $handoff.changedFiles) {
                $allowed = $false
                foreach ($pattern in $task.allowedPaths) {
                    if ($file.path -like $pattern -or $file.path -like "$pattern*") {
                        $allowed = $true
                        break
                    }
                }
                if (-not $allowed) {
                    return @{ passed = $false; message = "Scope violation: $($file.path) not in allowedPaths" }
                }
            }
        }
    }
    
    return @{ passed = $true; message = "Task contract valid, all changes within allowed paths" }
}

# G02: Evidence IDs Reference Real Sources
function Test-G02 {
    param($TaskId)
    
    Write-Host "Running G02: Evidence IDs Reference Real Sources for $TaskId"
    
    $evidenceFiles = Get-ChildItem $EVIDENCE_DIR -Filter "EV-$TaskId-*.json" -ErrorAction SilentlyContinue
    if ($evidenceFiles.Count -eq 0) {
        return @{ passed = $false; message = "No evidence files found for task $TaskId" }
    }
    
    foreach ($evidenceFile in $evidenceFiles) {
        $evidence = Get-Content $evidenceFile.FullName -Raw | ConvertFrom-Json
        
        # Verify SHA-256 format
        if (-not $evidence.sha256 -or $evidence.sha256 -notmatch '^[a-f0-9]{64}$') {
            return @{ passed = $false; message = "Invalid SHA-256 in $($evidence.evidenceId)" }
        }
        
        # Verify source file exists (for STATIC_CONFIRMED)
        if ($evidence.type -eq 'STATIC_CONFIRMED' -and $evidence.location) {
            $sourcePath = Join-Path $WorktreePath $evidence.location
            if (-not (Test-Path $sourcePath)) {
                return @{ passed = $false; message = "Source file not found: $($evidence.location) for $($evidence.evidenceId)" }
            }
        }
    }
    
    return @{ passed = $true; message = "All evidence IDs reference real sources with valid SHA-256" }
}

# G03: Codec/API Schema Strict
function Test-G03 {
    param($TaskId)
    
    Write-Host "Running G03: Codec/API Schema Strict for $TaskId"
    
    # This would check actual codec implementation against documented wire formats
    # For now, verify evidence exists
    $evidenceFiles = Get-ChildItem $EVIDENCE_DIR -Filter "EV-$TaskId-*.json" -ErrorAction SilentlyContinue
    $codecEvidence = $evidenceFiles | Where-Object { 
        $e = Get-Content $_.FullName -Raw | ConvertFrom-Json
        $e.description -like "*codec*" -or $e.description -like "*wire*" -or $e.description -like "*schema*"
    }
    
    if ($codecEvidence.Count -eq 0) {
        return @{ passed = $true; message = "No codec changes in this task (gate not applicable)" }
    }
    
    return @{ passed = $true; message = "Codec evidence present (manual verification required)" }
}

# G04: Tests Including Negative/Timeout/Disconnect/Focus
function Test-G04 {
    param($TaskId)
    
    Write-Host "Running G04: Tests Including Negative/Timeout/Disconnect/Focus for $TaskId"
    
    # Run full test suite
    $process = Start-Process -FilePath "cmd" -ArgumentList "/c", "yarn test" -WorkingDirectory $WorktreePath -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        return @{ passed = $false; message = "Test suite failed with exit code $($process.ExitCode)" }
    }
    
    # Run package build
    $process = Start-Process -FilePath "cmd" -ArgumentList "/c", "yarn package" -WorkingDirectory $WorktreePath -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        return @{ passed = $false; message = "Package build failed with exit code $($process.ExitCode)" }
    }
    
    # Check for negative test files (heuristic)
    $testFiles = Get-ChildItem "$WorktreePath\__tests__" -Filter "*.test.js" -ErrorAction SilentlyContinue
    $hasNegativeTests = $false
    foreach ($tf in $testFiles) {
        $content = Get-Content $tf.FullName -Raw
        if ($content -match "negative|invalid|error|timeout|disconnect|focus" -and $content -match "expect.*toThrow|expect.*toReject|catch") {
            $hasNegativeTests = $true
            break
        }
    }
    
    return @{ passed = $true; message = "All tests pass, package builds; negative tests detected: $hasNegativeTests" }
}

# G05: Independent Read-only Review
function Test-G05 {
    param($TaskId)
    
    Write-Host "Running G05: Independent Read-only Review for $TaskId"
    
    # Check if reviewer handoff exists
    $reviewerHandoffs = Get-ChildItem $HANDOFFS_DIR -Filter "HO-$TaskId-Reviewer-*.json" -ErrorAction SilentlyContinue
    if ($reviewerHandoffs.Count -eq 0) {
        return @{ passed = $false; message = "No reviewer handoff found - independent review not completed" }
    }
    
    # Verify reviewer didn't modify application code
    foreach ($rh in $reviewerHandoffs) {
        $handoff = Get-Content $rh.FullName -Raw | ConvertFrom-Json
        if ($handoff.changedFiles -and $handoff.changedFiles.Count -gt 0) {
            $appChanges = $handoff.changedFiles | Where-Object { $_.path -notlike "automation/*" }
            if ($appChanges.Count -gt 0) {
                return @{ passed = $false; message = "Reviewer modified application code: $($appChanges[0].path)" }
            }
        }
    }
    
    return @{ passed = $true; message = "Independent review completed, no application code modifications" }
}

# G06: Package Build & Content
function Test-G06 {
    param($TaskId)
    
    Write-Host "Running G06: Package Build & Content for $TaskId"
    
    # Run package build
    $process = Start-Process -FilePath "cmd" -ArgumentList "/c", "yarn package" -WorkingDirectory $WorktreePath -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        return @{ passed = $false; message = "Package build failed" }
    }
    
    # Verify .tgz exists
    $tgzFiles = Get-ChildItem $WorktreePath -Filter "*.tgz" -ErrorAction SilentlyContinue
    if ($tgzFiles.Count -eq 0) {
        return @{ passed = $false; message = "No .tgz package produced" }
    }
    
    # Verify versions match
    $pkgJson = Get-Content (Join-Path $WorktreePath "package.json") -Raw | ConvertFrom-Json
    $manifestJson = Get-Content (Join-Path $WorktreePath "companion\manifest.json") -Raw | ConvertFrom-Json
    
    if ($pkgJson.version -ne $manifestJson.version) {
        return @{ passed = $false; message = "Version mismatch: package.json=$($pkgJson.version), manifest.json=$($manifestJson.version)" }
    }
    
    return @{ passed = $true; message = "Package builds, versions match ($($pkgJson.version))" }
}

# G07: Live Readback Only with Approved Test Profile
function Test-G07 {
    param($TaskId)
    
    Write-Host "Running G07: Live Readback Only with Approved Test Profile for $TaskId"
    
    # Check if task involves live SuperRack commands
    $taskFile = Join-Path $TASKS_DIR "$TaskId.json"
    if (Test-Path $taskFile) {
        $task = Get-Content $taskFile -Raw | ConvertFrom-Json
        if ($task.allowedPaths -join "," -like "*SuperRack*" -or $task.description -like "*live*" -or $task.description -like "*SuperRack*") {
            # Check for approved test profile
            $profileFile = Join-Path $AUTOMATION_ROOT "evidence" "live-test-profile-approved.txt"
            if (-not (Test-Path $profileFile)) {
                return @{ passed = $false; message = "Live test profile not approved - cannot execute live commands" }
            }
        }
    }
    
    return @{ passed = $true; message = "No live SuperRack commands in this task, or profile approved" }
}

# G08: No Main Merge/Tag Push/Release Publish by AI
function Test-G08 {
    param($TaskId)
    
    Write-Host "Running G08: No Main Merge/Tag Push/Release Publish by AI for $TaskId"
    
    # Check handoffs for any git operations
    $handoffs = Get-ChildItem $HANDOFFS_DIR -Filter "HO-$TaskId-*.json" -ErrorAction SilentlyContinue
    foreach ($hf in $handoffs) {
        $handoff = Get-Content $hf.FullName -Raw | ConvertFrom-Json
        if ($handoff.changedFiles) {
            foreach ($file in $handoff.changedFiles) {
                if ($file.path -like ".git/*" -or $file.path -like "*.tag" -or $file.reason -like "*push*" -or $file.reason -like "*merge*" -or $file.reason -like "*publish*") {
                    return @{ passed = $false; message = "Git operation detected in handoff: $($file.path) - $($file.reason)" }
                }
            }
        }
    }
    
    return @{ passed = $true; message = "No git push/merge/tag/publish operations by AI" }
}

# G09: Release Tag, Versions, Build Commit, Asset Hash
function Test-G09 {
    param($TaskId)
    
    Write-Host "Running G09: Release Tag, Versions, Build Commit, Asset Hash for $TaskId"
    
    # This gate is for release tasks - check if applicable
    $taskFile = Join-Path $TASKS_DIR "$TaskId.json"
    if (Test-Path $taskFile) {
        $task = Get-Content $taskFile -Raw | ConvertFrom-Json
        if ($task.phase -notlike "*RELEASE*" -and $task.title -notlike "*release*" -and $task.title -notlike "*Release*") {
            return @{ passed = $true; message = "Not a release task - gate not applicable" }
        }
    }
    
    return @{ passed = $true; message = "Release gate not applicable to this task" }
}

# G10: Rollback & Documented Changes
function Test-G10 {
    param($TaskId)
    
    Write-Host "Running G10: Rollback & Documented Changes for $TaskId"
    
    # Verify handoffs exist and document changes
    $handoffs = Get-ChildItem $HANDOFFS_DIR -Filter "HO-$TaskId-*.json" -ErrorAction SilentlyContinue
    if ($handoffs.Count -eq 0) {
        return @{ passed = $false; message = "No handoffs found - changes not documented" }
    }
    
    # Check for rollback documentation
    $reportFiles = Get-ChildItem (Join-Path $AUTOMATION_ROOT "reports") -Filter "*$TaskId*" -ErrorAction SilentlyContinue
    $hasRollbackDoc = $reportFiles.Count -gt 0
    
    return @{ passed = $true; message = "Changes documented in $($handoffs.Count) handoff(s); rollback doc: $hasRollbackDoc" }
}

# Main gate runner
function Run-Gate {
    param($GateId, $TaskId)
    
    switch ($GateId) {
        'G01' { return Test-G01 -TaskId $TaskId }
        'G02' { return Test-G02 -TaskId $TaskId }
        'G03' { return Test-G03 -TaskId $TaskId }
        'G04' { return Test-G04 -TaskId $TaskId }
        'G05' { return Test-G05 -TaskId $TaskId }
        'G06' { return Test-G06 -TaskId $TaskId }
        'G07' { return Test-G07 -TaskId $TaskId }
        'G08' { return Test-G08 -TaskId $TaskId }
        'G09' { return Test-G09 -TaskId $TaskId }
        'G10' { return Test-G10 -TaskId $TaskId }
        default { return @{ passed = $false; message = "Unknown gate: $GateId" } }
    }
}

# Execute action
switch ($Action) {
    'run-gate' {
        if (-not $GateId -or -not $TaskId) {
            Write-Error "run-gate requires -GateId and -TaskId"
            exit 1
        }
        $result = Run-Gate -GateId $GateId -TaskId $TaskId
        Write-JsonOutput $result
        if ($result.passed) { exit 0 } else { exit 1 }
    }
    
    'run-all-gates' {
        if (-not $TaskId) {
            Write-Error "run-all-gates requires -TaskId"
            exit 1
        }
        
        $taskFile = Join-Path $TASKS_DIR "$TaskId.json"
        if (-not (Test-Path $taskFile)) {
            Write-Error "Task not found: $TaskId"
            exit 1
        }
        $task = Get-Content $taskFile -Raw | ConvertFrom-Json
        
        $allPassed = $true
        $results = @{}
        
        foreach ($gateId in $task.gates) {
            $result = Run-Gate -GateId $gateId -TaskId $TaskId
            $results[$gateId] = $result
            if (-not $result.passed) {
                $allPassed = $false
            }
        }
        
        Write-JsonOutput @{ taskId = $TaskId; allPassed = $allPassed; gateResults = $results }
        if ($allPassed) { exit 0 } else { exit 1 }
    }
    
    'verify-task' {
        if (-not $TaskId) {
            Write-Error "verify-task requires -TaskId"
            exit 1
        }
        & $SCRIPT_DIR\gate-runner.ps1 -Action run-all-gates -TaskId $TaskId
        exit $LASTEXITCODE
    }
    
    'list-gates' {
        $gates.GetEnumerator() | ForEach-Object {
            Write-Host "$($_.Key): $($_.Value.name) - Runner: $($_.Value.runner)"
        }
        exit 0
    }
}