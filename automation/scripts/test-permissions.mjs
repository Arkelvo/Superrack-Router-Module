#!/usr/bin/env node
/**
 * Permission negative tests - verify agents cannot exceed allowed paths
 * Tests that Builder/Reviewer/Fixer roles cannot write outside their allowedPaths
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOMATION_ROOT = path.join(__dirname, '..');
const TASKS_DIR = path.join(AUTOMATION_ROOT, 'tasks');
const HANDOFFS_DIR = path.join(AUTOMATION_ROOT, 'handoffs');
const STATE_DIR = path.join(AUTOMATION_ROOT, 'state');

async function runTest() {
    console.log('=== Permission Negative Tests ===\n');
    
    let allPassed = true;
    
    // Test 1: Create a task with restricted allowedPaths
    console.log('--- Test 1: Create task with restricted allowedPaths ---');
    const task = {
        taskId: 'PERM-TEST-01',
        version: '1.0.0',
        phase: 'A0',
        title: 'Permission Test Task',
        description: 'Task with restricted allowedPaths',
        allowedPaths: ['automation/state/perm-test.txt'],
        dependencies: [],
        evidenceRequirements: [],
        gates: ['G01'],
        acceptanceCriteria: ['Only allowed file modified'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'READY',
        assignedRole: 'Builder',
        attempts: 0,
        fixRounds: 0
    };
    const taskFile = path.join(TASKS_DIR, 'PERM-TEST-01.json');
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
    console.log('Created task PERM-TEST-01 with restricted allowedPaths');
    
    // Test 2: Simulate a handoff with scope violation
    console.log('\n--- Test 2: Create handoff with scope violation ---');
    const handoff = {
        handoffId: 'HO-PERM-TEST-01-Builder-1',
        taskId: 'PERM-TEST-01',
        planVersion: '1.0.0',
        sessionNumber: 1,
        sessionRole: 'Builder',
        baselineCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        resultCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        changedFiles: [
            {
                path: 'main.js',
                reason: 'Attempted unauthorized modification',
                linesAdded: 10,
                linesRemoved: 5
            },
            {
                path: 'automation/state/perm-test.txt',
                reason: 'Allowed modification',
                linesAdded: 1,
                linesRemoved: 0
            }
        ],
        createdAt: new Date().toISOString(),
        durationMs: 10000,
        status: 'COMPLETED',
        evidenceIds: [],
        testCommands: [],
        testExitCodes: [],
        reviewerFindings: [],
        risks: [],
        nextAction: 'START_REVIEW',
        tokenBudgetUsed: 1000,
        apiBudgetUsed: 0
    };
    const handoffFile = path.join(HANDOFFS_DIR, 'HO-PERM-TEST-01-Builder-1.json');
    fs.writeFileSync(handoffFile, JSON.stringify(handoff, null, 2));
    console.log('Created handoff with scope violation (main.js)');
    
    // Test 3: Run G01 gate - should FAIL due to scope violation
    console.log('\n--- Test 3: Run G01 with scope violation ---');
    const result1 = await runG01('PERM-TEST-01');
    console.log('Result:', JSON.stringify(result1));
    
    let test1Passed = false;
    if (!result1.passed && result1.message.includes('Scope violation')) {
        console.log('✅ G01 correctly detected scope violation');
        test1Passed = true;
    } else {
        console.log('❌ G01 failed to detect scope violation');
    }
    allPassed = allPassed && test1Passed;
    
    // Test 4: Create clean handoff (only allowed paths)
    console.log('\n--- Test 4: Create clean handoff ---');
    const cleanHandoff = {
        handoffId: 'HO-PERM-TEST-01-Builder-2',
        taskId: 'PERM-TEST-01',
        planVersion: '1.0.0',
        sessionNumber: 2,
        sessionRole: 'Builder',
        baselineCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        resultCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        changedFiles: [
            {
                path: 'automation/state/perm-test.txt',
                reason: 'Allowed modification',
                linesAdded: 1,
                linesRemoved: 0
            }
        ],
        createdAt: new Date().toISOString(),
        durationMs: 5000,
        status: 'COMPLETED',
        evidenceIds: [],
        testCommands: [],
        testExitCodes: [],
        reviewerFindings: [],
        risks: [],
        nextAction: 'START_REVIEW',
        tokenBudgetUsed: 1000,
        apiBudgetUsed: 0
    };
    const cleanHandoffFile = path.join(HANDOFFS_DIR, 'HO-PERM-TEST-01-Builder-2.json');
    fs.writeFileSync(cleanHandoffFile, JSON.stringify(cleanHandoff, null, 2));
    
    // Remove the violating handoff
    fs.unlinkSync(handoffFile);
    
    console.log('\n--- Test 5: Run G01 with clean handoff ---');
    const result2 = await runG01('PERM-TEST-01');
    console.log('Result:', JSON.stringify(result2));
    
    let test2Passed = false;
    if (result2.passed) {
        console.log('✅ G01 correctly passes for allowed paths only');
        test2Passed = true;
    } else {
        console.log('❌ G01 incorrectly failed for allowed paths');
    }
    allPassed = allPassed && test2Passed;
    
    // Test 6: Test Reviewer read-only constraint
    console.log('\n--- Test 6: Test Reviewer read-only constraint ---');
    const reviewerHandoff = {
        handoffId: 'HO-PERM-TEST-01-Reviewer-1',
        taskId: 'PERM-TEST-01',
        planVersion: '1.0.0',
        sessionNumber: 1,
        sessionRole: 'Reviewer',
        baselineCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        resultCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        changedFiles: [
            {
                path: 'lib/prolink-codec.js',
                reason: 'Reviewer attempted modification',
                linesAdded: 5,
                linesRemoved: 2
            }
        ],
        createdAt: new Date().toISOString(),
        durationMs: 5000,
        status: 'COMPLETED',
        evidenceIds: [],
        testCommands: [],
        testExitCodes: [],
        reviewerFindings: [],
        risks: [],
        nextAction: 'TASK_COMPLETE',
        tokenBudgetUsed: 1000,
        apiBudgetUsed: 0
    };
    const reviewerHandoffFile = path.join(HANDOFFS_DIR, 'HO-PERM-TEST-01-Reviewer-1.json');
    fs.writeFileSync(reviewerHandoffFile, JSON.stringify(reviewerHandoff, null, 2));
    
    console.log('\n--- Test 7: Run G05 with reviewer violation ---');
    const result3 = await runG05('PERM-TEST-01');
    console.log('Result:', JSON.stringify(result3));
    
    let test3Passed = false;
    if (!result3.passed && result3.message.includes('Reviewer modified')) {
        console.log('✅ G05 correctly detected reviewer modifying app code');
        test3Passed = true;
    } else {
        console.log('❌ G05 failed to detect reviewer violation');
    }
    allPassed = allPassed && test3Passed;
    
    // Test 8: Clean reviewer handoff (no app code changes)
    console.log('\n--- Test 8: Clean reviewer handoff ---');
    fs.unlinkSync(reviewerHandoffFile);
    
    const cleanReviewerHandoff = {
        handoffId: 'HO-PERM-TEST-01-Reviewer-2',
        taskId: 'PERM-TEST-01',
        planVersion: '1.0.0',
        sessionNumber: 2,
        sessionRole: 'Reviewer',
        baselineCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        resultCommit: '6497309a36b31b5a90d243b52f4055803b86cfef',
        changedFiles: [],
        createdAt: new Date().toISOString(),
        durationMs: 5000,
        status: 'COMPLETED',
        evidenceIds: [],
        testCommands: [],
        testExitCodes: [],
        reviewerFindings: [
            {
                findingId: 'FND-PERM-001',
                severity: 'INFO',
                description: 'Code looks good',
                reproduction: 'N/A',
                status: 'OPEN',
                relatedGate: 'G05'
            }
        ],
        risks: [],
        nextAction: 'TASK_COMPLETE',
        tokenBudgetUsed: 1000,
        apiBudgetUsed: 0
    };
    const cleanReviewerHandoffFile = path.join(HANDOFFS_DIR, 'HO-PERM-TEST-01-Reviewer-2.json');
    fs.writeFileSync(cleanReviewerHandoffFile, JSON.stringify(cleanReviewerHandoff, null, 2));
    
    console.log('\n--- Test 9: Run G05 with clean reviewer ---');
    const result4 = await runG05('PERM-TEST-01');
    console.log('Result:', JSON.stringify(result4));
    
    let test4Passed = false;
    if (result4.passed) {
        console.log('✅ G05 correctly passes for read-only reviewer');
        test4Passed = true;
    } else {
        console.log('❌ G05 incorrectly failed for read-only reviewer');
    }
    allPassed = allPassed && test4Passed;
    
    // Cleanup
    fs.unlinkSync(taskFile);
    fs.unlinkSync(cleanHandoffFile);
    fs.unlinkSync(cleanReviewerHandoffFile);
    
    console.log('\n=== Permission Tests Summary ===');
    console.log(`Test 1 (Scope violation detected): ${test1Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 2 (Clean handoff passes): ${test2Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 3 (Reviewer violation detected): ${test3Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 4 (Clean reviewer passes): ${test4Passed ? 'PASS' : 'FAIL'}`);
    
    if (allPassed) {
        console.log('\n✅ ALL PERMISSION TESTS PASSED');
        process.exit(0);
    } else {
        console.log('\n❌ SOME PERMISSION TESTS FAILED');
        process.exit(1);
    }
}

async function runG01(taskId) {
    const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
    if (!fs.existsSync(taskFile)) {
        return { passed: false, message: `Task contract not found: ${taskId}` };
    }
    
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
    
    if (!task.taskId || !task.allowedPaths) {
        return { passed: false, message: 'Task contract missing required fields' };
    }
    
    const handoffFiles = fs.readdirSync(HANDOFFS_DIR).filter(f => f.startsWith(`HO-${taskId}-`) && f.endsWith('.json'));
    
    for (const hf of handoffFiles) {
        const handoff = JSON.parse(fs.readFileSync(path.join(HANDOFFS_DIR, hf), 'utf-8'));
        if (handoff.changedFiles) {
            for (const file of handoff.changedFiles) {
                let allowed = false;
                for (const pattern of task.allowedPaths) {
                    if (file.path === pattern || file.path.startsWith(pattern.replace('*', ''))) {
                        allowed = true;
                        break;
                    }
                }
                if (!allowed) {
                    return { passed: false, message: `Scope violation: ${file.path} not in allowedPaths` };
                }
            }
        }
    }
    
    return { passed: true, message: 'Task contract valid, all changes within allowed paths' };
}

async function runG05(taskId) {
    const reviewerHandoffs = fs.readdirSync(HANDOFFS_DIR).filter(f => f.startsWith(`HO-${taskId}-Reviewer-`) && f.endsWith('.json'));
    
    if (reviewerHandoffs.length === 0) {
        return { passed: false, message: 'No reviewer handoff found - independent review not completed' };
    }
    
    for (const rh of reviewerHandoffs) {
        const handoff = JSON.parse(fs.readFileSync(path.join(HANDOFFS_DIR, rh), 'utf-8'));
        if (handoff.changedFiles && handoff.changedFiles.length > 0) {
            const appChanges = handoff.changedFiles.filter(f => !f.path.startsWith('automation/'));
            if (appChanges.length > 0) {
                return { passed: false, message: `Reviewer modified application code: ${appChanges[0].path}` };
            }
        }
    }
    
    return { passed: true, message: 'Independent review completed, no application code modifications' };
}

runTest().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});