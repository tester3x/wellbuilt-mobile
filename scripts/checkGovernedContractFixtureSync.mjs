#!/usr/bin/env node
// AUTHORITATIVE cross-repo divergence guard (Thor 1 final proof #2, Option B).
// Runs where BOTH repos are checked out (the integration environment / a CI job
// that has both). Fails LOUDLY if the client and server golden copies differ by
// a single byte, or if their version/digest disagree. This is the check that
// actually detects client-vs-server VERSION DIVERGENCE — distinct from the
// server harness's internal-integrity digest check (which only detects
// corruption of a single file, not staleness relative to the other repo).
//
//   RUN: node scripts/checkGovernedContractFixtureSync.mjs   (exit 0 = in sync)
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const CLIENT_GOLDEN = join(CLIENT_ROOT, 'src', 'services', '__tests__', '__fixtures__', 'wbm-governed-contract.json');
const SERVER_GOLDEN = process.env.WB_SERVER_FIXTURE
  || resolve(CLIENT_ROOT, '..', '_dash-chrono-reconcile', 'functions', 'emulator', 'fixtures', 'wbm-governed-contract.json');

function fail(msg) { console.error(`[fixture-sync] DIVERGENCE: ${msg}`); process.exit(1); }

if (!existsSync(CLIENT_GOLDEN)) fail(`client golden missing: ${CLIENT_GOLDEN}`);
if (!existsSync(SERVER_GOLDEN)) fail(`server golden missing: ${SERVER_GOLDEN} (set WB_SERVER_FIXTURE if the repo lives elsewhere)`);

const cBytes = readFileSync(CLIENT_GOLDEN);
const sBytes = readFileSync(SERVER_GOLDEN);
const cSha = createHash('sha256').update(cBytes).digest('hex');
const sSha = createHash('sha256').update(sBytes).digest('hex');

if (!cBytes.equals(sBytes)) fail(`client and server copies differ (client ${cSha.slice(0, 16)} vs server ${sSha.slice(0, 16)}) — run scripts/syncGovernedContractFixture.mjs`);

const c = JSON.parse(cBytes.toString('utf8'));
const s = JSON.parse(sBytes.toString('utf8'));
if (c.version !== s.version) fail(`version mismatch: client ${c.version} vs server ${s.version}`);
if (c.digest !== s.digest) fail(`digest mismatch: client ${c.digest.slice(0, 16)} vs server ${s.digest.slice(0, 16)}`);

console.log(`[fixture-sync] IN SYNC — client == server, byte-for-byte`);
console.log(`  version=${c.version} digest=${c.digest}`);
console.log(`  fileSha256=${cSha}`);
