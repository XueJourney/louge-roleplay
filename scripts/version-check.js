#!/usr/bin/env node
/**
 * @file scripts/version-check.js
 * @description Validate project version metadata before release/tagging.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK   ${message}`);
}

function maybeExec(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (_) {
    return '';
  }
}

const pkg = readJson(packagePath);
const lock = fs.existsSync(lockPath) ? readJson(lockPath) : null;
const version = String(pkg.version || '').trim();
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (semverPattern.test(version)) ok(`package.json version ${version}`);
else fail(`package.json version is not valid SemVer: ${version || '<empty>'}`);

if (lock) {
  if (lock.version === version) ok('package-lock.json root version matches package.json');
  else fail(`package-lock.json version ${lock.version} does not match package.json ${version}`);

  const rootPackage = lock.packages && lock.packages[''];
  if (!rootPackage || rootPackage.version === version) ok('package-lock packages[""] version matches package.json');
  else fail(`package-lock packages[""] version ${rootPackage.version} does not match package.json ${version}`);
} else {
  fail('package-lock.json missing');
}

if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  if (changelog.includes(`## [${version}]`)) ok(`CHANGELOG.md contains entry for ${version}`);
  else fail(`CHANGELOG.md missing entry for ${version}`);
} else {
  fail('CHANGELOG.md missing');
}

const dirty = maybeExec('git', ['status', '--short']);
if (dirty) {
  console.log('WARN git working tree has uncommitted changes:');
  console.log(dirty);
} else {
  ok('git working tree clean');
}

const exactTag = maybeExec('git', ['describe', '--tags', '--exact-match', 'HEAD']);
if (exactTag) {
  if (exactTag === `v${version}`) ok(`HEAD is tagged ${exactTag}`);
  else console.log(`WARN HEAD tag ${exactTag} does not match package version v${version}`);
} else {
  console.log(`INFO no exact release tag on HEAD yet; expected tag is v${version}`);
}

if (process.exitCode) process.exit(process.exitCode);
