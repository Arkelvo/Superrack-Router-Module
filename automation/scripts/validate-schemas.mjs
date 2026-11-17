#!/usr/bin/env node
/**
 * Schema validation script for automation schemas.
 * Validates all JSON files against their corresponding schemas.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(__dirname, '..', 'schemas');
const TASK_DIR = path.join(__dirname, '..', 'tasks');
const ROADMAP_FILE = path.join(__dirname, '..', 'roadmap.json');

// Simple JSON Schema validator (using Ajv would be better but keeping deps minimal)
function validateJsonSchema(data, schema) {
  const errors = [];
  
  function checkRequired(obj, required, path) {
    for (const req of required) {
      if (!(req in obj)) {
        errors.push(`${path}.${req}: required property missing`);
      }
    }
  }
  
  function checkType(obj, expectedType, path) {
    const actualType = Array.isArray(obj) ? 'array' : typeof obj;
    if (expectedType === 'integer') {
      if (actualType !== 'number' || !Number.isInteger(obj)) {
        errors.push(`${path}: expected integer, got ${actualType} (${obj})`);
      }
    } else if (actualType !== expectedType) {
      errors.push(`${path}: expected ${expectedType}, got ${actualType}`);
    }
  }
  
  function checkEnum(value, allowed, path) {
    if (!allowed.includes(value)) {
      errors.push(`${path}: value "${value}" not in allowed enum [${allowed.join(', ')}]`);
    }
  }
  
  function checkPattern(value, pattern, path) {
    const regex = new RegExp(pattern);
    if (!regex.test(value)) {
      errors.push(`${path}: value "${value}" does not match pattern ${pattern}`);
    }
  }
  
  function validateObject(obj, schema, path = '') {
    if (schema.required) checkRequired(obj, schema.required, path);
    if (schema.type) checkType(obj, schema.type, path);
    if (schema.enum) checkEnum(obj, schema.enum, path);
    if (schema.pattern) checkPattern(obj, schema.pattern, path);
    
    if (schema.properties && typeof obj === 'object' && obj !== null) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateObject(obj[key], propSchema, `${path}.${key}`);
        }
      }
    }
    
    if (schema.items && Array.isArray(obj)) {
      obj.forEach((item, i) => validateObject(item, schema.items, `${path}[${i}]`));
    }
  }
  
  validateObject(data, schema);
  return errors;
}

async function main() {
  console.log('=== Schema Validation ===\n');
  
  // Load schemas
  const schemas = {};
  const schemaFiles = [
    'task.schema.json',
    'evidence.schema.json',
    'handoff.schema.json',
    'result.schema.json',
    'gate.schema.json',
    'release.schema.json'
  ];
  
  for (const file of schemaFiles) {
    const content = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf-8');
    schemas[file.replace('.schema.json', '')] = JSON.parse(content);
  }
  
  let allPassed = true;
  
  // Validate task contracts
  console.log('--- Validating Task Contracts ---');
  const taskFiles = fs.readdirSync(TASK_DIR).filter(f => f.endsWith('.json') && (f.startsWith('A0-') || f.startsWith('R')));
  for (const file of taskFiles) {
    const content = fs.readFileSync(path.join(TASK_DIR, file), 'utf-8');
    const data = JSON.parse(content);
    const errors = validateJsonSchema(data, schemas.task);
    if (errors.length > 0) {
      console.log(`❌ ${file}:`);
      errors.forEach(e => console.log(`  - ${e}`));
      allPassed = false;
    } else {
      console.log(`✅ ${file}`);
    }
  }
  
  // Validate roadmap
  console.log('\n--- Validating Roadmap ---');
  const roadmapContent = fs.readFileSync(ROADMAP_FILE, 'utf-8');
  const roadmap = JSON.parse(roadmapContent);
  // Basic structure validation
  if (!roadmap.phases || !Array.isArray(roadmap.phases)) {
    console.log('❌ roadmap.json: missing phases array');
    allPassed = false;
  } else {
    console.log(`✅ roadmap.json (${roadmap.phases.length} phases)`);
  }
  
  // Validate schemas themselves (meta-validation)
  console.log('\n--- Validating Schema Files ---');
  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema.$schema || !schema.title || !schema.type) {
      console.log(`❌ ${name}.schema.json: missing required meta fields`);
      allPassed = false;
    } else {
      console.log(`✅ ${name}.schema.json`);
    }
  }
  
  console.log('\n=== Validation Complete ===');
  if (allPassed) {
    console.log('✅ All validations passed');
    process.exit(0);
  } else {
    console.log('❌ Some validations failed');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Validation error:', err);
  process.exit(1);
});