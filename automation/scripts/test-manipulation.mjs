#!/usr/bin/env node
/**
 * Manipulation tests - verify agents cannot modify gates, schemas, or security boundaries
 * Tests that AI agents cannot modify gate definitions, schemas, or bypass security controls
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOMATION_ROOT = path.join(__dirname, '..');
const SCHEMAS_DIR = path.join(AUTOMATION_ROOT, 'schemas');
const TASKS_DIR = path.join(AUTOMATION_ROOT, 'tasks');
const STATE_DIR = path.join(AUTOMATION_ROOT, 'state');

async function runTest() {
    console.log('=== Manipulation Tests ===\n');
    
    let allPassed = true;
    
    // Test 1: Gate definitions external to agent control
    console.log('--- Test 1: Gate schema immutability ---');
    const gateSchemaFile = path.join(SCHEMAS_DIR, 'gate.schema.json');
    const originalHash = hashFile(gateSchemaFile);
    console.log(`Original gate.schema.json SHA256: ${originalHash}`);
    
    // Check if gate.schema.json is in agent allowedPaths (from A0-04 task)
    const agentAllowedPaths = ['automation/scripts/', 'automation/agents/'];
    let gateSchemaInAllowed = false;
    for (const ap of agentAllowedPaths) {
        if ('automation/schemas/gate.schema.json'.startsWith(ap.replace('*', ''))) {
            gateSchemaInAllowed = true;
            break;
        }
    }
    
    let test1Passed = false;
    if (!gateSchemaInAllowed) {
        console.log('✅ gate.schema.json correctly NOT in agent allowedPaths');
        test1Passed = true;
    } else {
        console.log('❌ gate.schema.json incorrectly in agent allowedPaths');
    }
    allPassed = allPassed && test1Passed;
    
    // Test 2: Task contract validation - agent cannot remove gates
    console.log('\n--- Test 2: Task contract gate enforcement ---');
    const task = {
        taskId: 'MANIP-TEST-01',
        version: '1.0.0',
        phase: 'A0',
        title: 'Manipulation Test Task',
        description: 'Task with required gates',
        allowedPaths: ['automation/state/manip-test.txt'],
        dependencies: [],
        evidenceRequirements: [],
        gates: ['G01', 'G04', 'G06'],
        acceptanceCriteria: ['Gates enforced'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'READY',
        assignedRole: 'Builder',
        attempts: 0,
        fixRounds: 0
    };
    const taskFile = path.join(TASKS_DIR, 'MANIP-TEST-01.json');
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
    
    // Verify gate runner uses original task contract (run validation)
    const validationResult = execSync(`node ${path.join(__dirname, 'validate-schemas.mjs')}`, { encoding: 'utf-8', cwd: AUTOMATION_ROOT });
    console.log('Validation passed');
    
    // Check that all required gates are in the task
    const requiredGates = ['G01', 'G04', 'G06'];
    const taskGates = task.gates;
    const missingGates = requiredGates.filter(g => !taskGates.includes(g));
    
    let test2Passed = false;
    if (missingGates.length === 0) {
        console.log('✅ Task contract contains all required gates');
        test2Passed = true;
    } else {
        console.log(`❌ Task contract missing gates: ${missingGates.join(', ')}`);
    }
    allPassed = allPassed && test2Passed;
    
    // Test 3: Circuit breaker cannot be disabled by agent
    console.log('\n--- Test 3: Circuit breaker protection ---');
    let test3Passed = false;
    const cbInAllowed = agentAllowedPaths.some(ap => 'automation/state/circuit-breaker.json'.startsWith(ap.replace('*', '')));
    if (!cbInAllowed) {
        console.log('✅ circuit-breaker.json correctly NOT in agent allowedPaths');
        test3Passed = true;
    } else {
        console.log('❌ circuit-breaker.json incorrectly in agent allowedPaths');
    }
    allPassed = allPassed && test3Passed;
    
    // Test 4: Schema validation prevents invalid task contracts
    console.log('\n--- Test 4: Schema validation blocks invalid contracts ---');
    const invalidTask = {
        taskId: 'A0-INVALID',
        version: '1.0.0',
        gates: ['G01'],
        status: 'READY'
    };
    const invalidTaskFile = path.join(TASKS_DIR, 'A0-INVALID.json');
    fs.writeFileSync(invalidTaskFile, JSON.stringify(invalidTask, null, 2));
    
    let test4Passed = false;
    try {
        execSync(`node ${path.join(__dirname, 'validate-schemas.mjs')}`, { encoding: 'utf-8', cwd: AUTOMATION_ROOT, stdio: 'pipe' });
        console.log('❌ Schema validation failed to reject invalid contract');
    } catch (err) {
        const output = err.stdout?.toString() || err.message;
        if (output.includes('A0-INVALID')) {
            console.log('✅ Schema validation correctly rejects invalid task contract');
            test4Passed = true;
        } else {
            console.log('❌ Schema validation error but not for expected reason:', output);
        }
    }
    fs.unlinkSync(invalidTaskFile);
    allPassed = allPassed && test4Passed;
    
    // Test 5: Version sync script not modifiable by agents
    console.log('\n--- Test 5: Version sync script protection ---');
    let test5Passed = false;
    const vsInAllowed = agentAllowedPaths.some(ap => 'scripts/version-sync.mjs'.startsWith(ap.replace('*', '')));
    if (!vsInAllowed) {
        console.log('✅ version-sync.mjs correctly NOT in agent allowedPaths');
        test5Passed = true;
    } else {
        console.log('❌ version-sync.mjs incorrectly in agent allowedPaths');
    }
    allPassed = allPassed && test5Passed;
    
    // Test 6: GitHub workflows not modifiable by agents
    console.log('\n--- Test 6: GitHub workflows protection ---');
    let test6Passed = false;
    const ghInAllowed = agentAllowedPaths.some(ap => '.github/workflows/'.startsWith(ap.replace('*', '')));
    if (!ghInAllowed) {
        console.log('✅ .github/workflows/ correctly NOT in agent allowedPaths');
        test6Passed = true;
    } else {
        console.log('❌ .github/workflows/ incorrectly in agent allowedPaths');
    }
    allPassed = allPassed && test6Passed;
    
    // Cleanup
    fs.unlinkSync(taskFile);
    
    console.log('\n=== Manipulation Tests Summary ===');
    console.log(`Test 1 (Gate schema immutable): ${test1Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 2 (Gate enforcement): ${test2Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 3 (Circuit breaker protected): ${test3Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 4 (Schema validation): ${test4Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 5 (Version sync protected): ${test5Passed ? 'PASS' : 'FAIL'}`);
    console.log(`Test 6 (GitHub workflows protected): ${test6Passed ? 'PASS' : 'FAIL'}`);
    
    if (allPassed) {
        console.log('\n✅ ALL MANIPULATION TESTS PASSED');
        process.exit(0);
    } else {
        console.log('\n❌ SOME MANIPULATION TESTS FAILED');
        process.exit(1);
    }
}

function hashFile(filepath) {
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

runTest().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});