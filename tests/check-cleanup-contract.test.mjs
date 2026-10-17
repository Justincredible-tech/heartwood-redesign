// Contract regression for tools/check-cleanup.mjs (TA03/ROOT-03 correction).
// The shipped static gate must name its review inputs explicitly, must fail
// closed when an explicitly named input is absent, and must keep acquisition
// and file-review admissions exact (no accidental waiver). Every CLI case here
// exits before the owned runtime starts, so this file stays portable and
// compiler-free like the rest of the required suite: no browsers, no services,
// no source writes, and the only temp tree it owns is removed in after().
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, assessStatic, assessFileInventory } from '../tools/check-cleanup.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(ROOT, 'tools', 'check-cleanup.mjs');
const digest = text => createHash('sha256').update(text).digest('hex');
const run = args => spawnSync(process.execPath, [ TOOL, ...args ], {
  cwd: ROOT, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL'
});

const owned = [];
after(async () => {
  for (const dir of owned) await rm(dir, { recursive: true, force: true });
});

test('check-cleanup help documents the explicit static review inputs', () => {
  const result = run([ '--help' ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--static/);
  assert.match(result.stdout, /--policy/);
  assert.match(result.stdout, /--catalog/);
  assert.match(result.stdout, /--runtime/);
});

test('check-cleanup rejects unknown flags and contradictory modes', () => {
  const unknown = run([ '--static', '--bogus' ]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /--bogus/, 'the rejected flag must be identified (wording may vary by Node version)');
  const both = run([ '--static', '--runtime', '--', 'true' ]);
  assert.notEqual(both.status, 0);
  assert.match(both.stderr, /select exactly one of --static\/--runtime/);
  const liveWithLedgerFlags = run([ '--runtime', '--policy', 'x', '--', 'true' ]);
  assert.notEqual(liveWithLedgerFlags.status, 0);
  assert.match(liveWithLedgerFlags.stderr, /--policy\/--catalog apply only to --static/);
  assert.equal(liveWithLedgerFlags.stdout.includes('cleanup runtime:'), false);
});

test('an explicitly named missing policy or catalog fails closed before any audit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-check-cleanup-contract-'));
  owned.push(dir);
  const missingPolicy = join(dir, 'no-policy.json');
  const policyRun = run([ '--static', '--policy', missingPolicy, '--out', join(dir, 'out') ]);
  assert.equal(policyRun.status, 1);
  assert.ok(policyRun.stderr.includes('--policy input missing: ' + missingPolicy), policyRun.stderr);
  assert.equal(policyRun.stdout.includes('cleanup static:'), false, 'no review may run without the named policy');
  const missingCatalog = join(dir, 'no-catalog.json');
  const catalogRun = run([ '--static', '--catalog', missingCatalog, '--out', join(dir, 'out') ]);
  assert.equal(catalogRun.status, 1);
  assert.ok(catalogRun.stderr.includes('--catalog input missing: ' + missingCatalog), catalogRun.stderr);
  assert.equal(catalogRun.stdout.includes('cleanup static:'), false, 'no review may run without the named catalog');
});

test('acquisition scanning still detects resource use and ignores comments and strings', () => {
  const source = [
    "import {spawnSync} from 'node:child_process';",
    "import {mkdtemp} from 'node:fs/promises';",
    '// spawnSync(',
    'const note="listen(0) and fetch(";',
    "const work=()=>mkdtemp('x');",
    "const also=()=>spawnSync('true',[]);",
    ''
  ].join('\n');
  const rows = scanSource('tools/fixture.mjs', source);
  assert.deepEqual(rows.map(row => row.kind).sort(), [ 'sync-process', 'temp' ]);
  for (const row of rows) assert.equal(row.fingerprint, digest(row.kind + '\n' + row.text));
  assert.equal(rows.find(row => row.kind === 'temp').text, "const work=()=>mkdtemp('x');");
  assert.equal(rows.find(row => row.kind === 'sync-process').text, "const also=()=>spawnSync('true',[]);");
});

test('an unreviewed acquisition fails, and only an exact current waiver admits it', () => {
  const source = 'const server=listen(0);\n';
  const rows = scanSource('tools/fixture.mjs', source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'listener');
  const sourceSha256 = digest(source);
  const current = rows.map(row => ({ ...row, sourceSha256 }));
  const bare = assessStatic(current, {});
  assert.equal(bare[0].status, 'unreviewed');
  const waiver = {
    path: 'tools/fixture.mjs', fingerprint: rows[0].fingerprint, sourceSha256,
    reason: 'bounded fixture listener closed in the same test', evidence: [ 'docs/evidence.md' ]
  };
  assert.equal(assessStatic(current, { reviewedResources: [ waiver ] })[0].status, 'reviewed');
  assert.equal(assessStatic(current, { reviewedResources: [ { ...waiver, fingerprint: digest('tampered') } ] })[0].status, 'unreviewed');
  assert.equal(assessStatic(current, { reviewedResources: [ { ...waiver, sourceSha256: digest('other source') } ] })[0].status, 'unreviewed');
  assert.equal(assessStatic(current, { reviewedResources: [ { ...waiver, evidence: undefined } ] })[0].status, 'unreviewed');
});

test('file review admits only a current hash with role, reason and existing evidence', () => {
  const sourceSha256 = digest('source bytes');
  const files = [ { path: 'tools/fixture.mjs', sourceSha256, mode: 0o644, executable: false } ];
  const entry = {
    path: 'tools/fixture.mjs', sourceSha256, role: 'maintained-tool',
    reason: 'plain library module without runtime acquisitions', evidence: [ 'docs/review.md' ]
  };
  assert.equal(assessFileInventory(files, { reviewedFiles: [ entry ] }, { evidenceExists: () => true })[0].status, 'reviewed');
  const noEvidence = assessFileInventory(files, { reviewedFiles: [ entry ] }, { evidenceExists: () => false })[0];
  assert.equal(noEvidence.status, 'unreviewed');
  assert.equal(noEvidence.failureKind, 'unreviewed-file');
  assert.equal(assessFileInventory([ { ...files[0], sourceSha256: digest('drifted') } ], { reviewedFiles: [ entry ] }, { evidenceExists: () => true })[0].status, 'unreviewed');
  assert.equal(assessFileInventory(files, {}, { evidenceExists: () => true })[0].status, 'unreviewed');
});

test('a configured static policy runs the audit to a report (the CLI success path)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-check-cleanup-contract-'));
  owned.push(dir);
  const policyPath = join(dir, 'policy.json');
  await writeFile(policyPath, '{}\n');
  const out = join(dir, 'out');
  const result = run([ '--static', '--policy', policyPath, '--out', out ]);
  assert.equal(result.status, 1, 'an empty reviewed ledger still fails closed');
  assert.match(result.stdout, /cleanup static: .*policy configured/, result.stdout);
  const report = JSON.parse(await readFile(join(out, 'static.json'), 'utf8'));
  assert.equal(report.mode, 'static');
  assert.equal(report.policy.configured, true);
  assert.equal(report.passed, false);
  assert.ok(report.files > 0, 'the real tree has inventoried files');
  assert.ok(report.sourceInventory.maintainedFiles > 0, 'the maintained tools/tests corpus is inventoried');
});
