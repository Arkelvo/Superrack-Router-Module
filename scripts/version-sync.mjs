#!/usr/bin/env node
/**
 * Version Sync Script
 * Synchronizes version between package.json and companion/manifest.json
 * Usage: node scripts/version-sync.mjs --write <version> | --check <version>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const PKG_FILE = path.join(ROOT_DIR, 'package.json');
const MANIFEST_FILE = path.join(ROOT_DIR, 'companion', 'manifest.json');

function readJson(file) {
  const content = fs.readFileSync(file, 'utf-8');
  return JSON.parse(content);
}

function writeJson(file, data) {
  const content = JSON.stringify(data, null, '\t') + '\n';
  fs.writeFileSync(file, content, 'utf-8');
}

function checkVersion(version) {
  const pkg = readJson(PKG_FILE);
  const manifest = readJson(MANIFEST_FILE);
  
  const pkgMatch = pkg.version === version;
  const manifestMatch = manifest.version === version;
  
  console.log(`package.json version: ${pkg.version} ${pkgMatch ? '✅' : '❌'}`);
  console.log(`manifest.json version: ${manifest.version} ${manifestMatch ? '✅' : '❌'}`);
  console.log(`Expected version: ${version}`);
  
  if (pkgMatch && manifestMatch) {
    console.log('✅ Versions match');
    return 0;
  } else {
    console.log('❌ Version mismatch');
    return 1;
  }
}

function writeVersion(version) {
  // Validate version format (semver)
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error(`Invalid version format: ${version}. Expected MAJOR.MINOR.PATCH[-prerelease]`);
    return 1;
  }
  
  const pkg = readJson(PKG_FILE);
  const manifest = readJson(MANIFEST_FILE);
  
  const oldPkgVersion = pkg.version;
  const oldManifestVersion = manifest.version;
  
  pkg.version = version;
  manifest.version = version;
  
  writeJson(PKG_FILE, pkg);
  writeJson(MANIFEST_FILE, manifest);
  
  console.log(`Updated package.json: ${oldPkgVersion} -> ${version}`);
  console.log(`Updated manifest.json: ${oldManifestVersion} -> ${version}`);
  
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.error('Usage: node scripts/version-sync.mjs --write|--check <version>');
    console.error('  --write <version>  Update both package.json and manifest.json to version');
    console.error('  --check <version>  Verify both files have the specified version');
    process.exit(1);
  }
  
  const [command, version] = args;
  
  if (command === '--write') {
    process.exit(writeVersion(version));
  } else if (command === '--check') {
    process.exit(checkVersion(version));
  } else {
    console.error(`Unknown command: ${command}. Use --write or --check`);
    process.exit(1);
  }
}

main();