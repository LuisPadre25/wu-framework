#!/usr/bin/env node

/**
 * WU-FRAMEWORK BUILD SCRIPT
 *
 * Usage:
 *   node scripts/build.js [target] [options]
 *
 * Targets:
 *   dev   - Development build (unminified)
 *   prod  - Production build (minified)
 *   esm   - ESM module only
 *   cjs   - CommonJS only
 *   umd   - UMD browser bundle only
 *   all   - All formats (default)
 *
 * Options:
 *   --clean   - Clean dist before build
 *   --watch   - Watch mode (dev only)
 *   --verbose - Verbose output
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const C = {
  reset: '\x1b[0m', bright: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

const log = (msg, c = '') => console.log(`${c}${msg}${C.reset}`);
const ok = (msg) => console.log(`${C.green}✓${C.reset} ${msg}`);
const fail = (msg) => console.log(`${C.red}✗${C.reset} ${msg}`);

// Parse args
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--')) || 'all';
const options = {
  clean: args.includes('--clean'),
  watch: args.includes('--watch'),
  verbose: args.includes('--verbose')
};

console.log(`\n${C.cyan}${C.bright}  WU-FRAMEWORK BUILD${C.reset}`);
console.log(`${C.cyan}  Target: ${target} | Options: ${JSON.stringify(options)}${C.reset}\n`);

// Step 1: Clean
const distDir = path.join(rootDir, 'dist');
if (options.clean && fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
  ok('Cleaned dist/');
}

// Step 2: Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Step 3: Run Rollup
const startTime = Date.now();

try {
  const env = {
    ...process.env,
    BUILD_TARGET: target,
    NODE_ENV: target === 'dev' ? 'development' : 'production'
  };

  const rollupArgs = ['-c', 'rollup.config.js'];
  if (options.watch) rollupArgs.push('--watch');
  if (options.verbose) rollupArgs.push('--verbose');

  execSync(`npx rollup ${rollupArgs.join(' ')}`, {
    cwd: rootDir,
    env,
    stdio: 'inherit'
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('');
  ok(`Build completed in ${elapsed}s`);
} catch (error) {
  fail(`Build failed: ${error.message}`);
  process.exit(1);
}

// Step 4: Summary
console.log('');
const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js') && !f.endsWith('.map'));

if (files.length === 0) {
  fail('No output files generated!');
  process.exit(1);
}

const fmt = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

let totalSize = 0;

console.log(`  ${C.bright}File${C.reset}                              ${C.bright}Size${C.reset}`);
console.log(`  ${'─'.repeat(50)}`);

files.forEach(file => {
  const size = fs.statSync(path.join(distDir, file)).size;
  totalSize += size;
  console.log(`  ${file.padEnd(35)} ${fmt(size)}`);
});

console.log(`  ${'─'.repeat(50)}`);
console.log(`  ${C.bright}Total${C.reset}${' '.repeat(30)} ${C.bright}${fmt(totalSize)}${C.reset}`);
console.log('');

log('Usage:', C.yellow);
console.log(`  ${C.cyan}ESM:${C.reset}     import { wu } from 'wu-framework'`);
console.log(`  ${C.cyan}CJS:${C.reset}     const { wu } = require('wu-framework')`);
console.log(`  ${C.cyan}Browser:${C.reset} <script src="dist/wu-framework.umd.js"></script>`);
console.log('');
