#!/usr/bin/env node
// AUTHORITATIVE cross-repo fixture sync (Thor 1 final proof #2, Option B).
// The CLIENT builders are the single source of truth. This one command:
//   1. regenerates the client golden from the REAL builders (jest WB_WRITE_FIXTURE),
//   2. copies that exact file to the SERVER emulator fixture path,
// so the two repo copies can NEVER silently diverge when run. It then prints the
// {version, digest, fileSha256} so the server harness's EXPECTED_CLIENT_CONTRACT
// pin can be bumped in lockstep.
//
//   RUN:   node scripts/syncGovernedContractFixture.mjs
//   VERIFY: node scripts/checkGovernedContractFixtureSync.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const CLIENT_GOLDEN = join(CLIENT_ROOT, 'src', 'services', '__tests__', '__fixtures__', 'wbm-governed-contract.json');
// The server repo path is derived (override with WB_SERVER_FIXTURE for CI layouts).
const SERVER_GOLDEN = process.env.WB_SERVER_FIXTURE
  || resolve(CLIENT_ROOT, '..', '_dash-chrono-reconcile', 'functions', 'emulator', 'fixtures', 'wbm-governed-contract.json');

// 1. Regenerate the client golden from the real builders.
console.log('[sync] regenerating client golden from the real WB-M builders …');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['jest', 'governedContractFixture', '--silent'],
  { cwd: CLIENT_ROOT, stdio: 'inherit', env: { ...process.env, WB_WRITE_FIXTURE: '1' } });

if (!existsSync(CLIENT_GOLDEN)) { console.error(`[sync] client golden missing: ${CLIENT_GOLDEN}`); process.exit(2); }

// 2. Copy the exact bytes to the server copy.
copyFileSync(CLIENT_GOLDEN, SERVER_GOLDEN);

const bytes = readFileSync(CLIENT_GOLDEN);
const g = JSON.parse(bytes.toString('utf8'));
const fileSha256 = createHash('sha256').update(bytes).digest('hex');
console.log(`[sync] wrote both copies:`);
console.log(`  client: ${CLIENT_GOLDEN}`);
console.log(`  server: ${SERVER_GOLDEN}`);
console.log(`[sync] version=${g.version} digest=${g.digest}`);
console.log(`[sync] fileSha256=${fileSha256}`);
console.log(`[sync] → set server EXPECTED_CLIENT_CONTRACT = { version: ${g.version}, digest: '${g.digest}' }`);
