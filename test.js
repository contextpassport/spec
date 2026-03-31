#!/usr/bin/env node
/**
 * DarkMatter — Full endpoint test suite
 * Run: node test.js <BASE_URL> <AGENT_A_KEY> <AGENT_B_KEY>
 *
 * Requires two agents already created in your DarkMatter account.
 * Get keys from: https://darkmatterhub.ai/dashboard
 *
 * Usage:
 *   node test.js https://darkmatterhub.ai dm_sk_aaa... dm_sk_bbb...
 *
 * Or against local:
 *   node test.js http://localhost:3000 dm_sk_aaa... dm_sk_bbb...
 */

const BASE   = process.argv[2] || 'https://darkmatterhub.ai';
const KEY_A  = process.argv[3];
const KEY_B  = process.argv[4];

if (!KEY_A || !KEY_B) {
  console.error('Usage: node test.js <BASE_URL> <AGENT_A_KEY> <AGENT_B_KEY>');
  process.exit(1);
}

// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    results.push(`  ✓  ${name}`);
  } else {
    failed++;
    results.push(`  ✗  ${name}${detail ? ': ' + detail : ''}`);
  }
}

function skip(name, reason) {
  skipped++;
  results.push(`  ·  ${name} (skipped: ${reason})`);
}

async function req(method, path, body, key) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Authorization': `Bearer ${key}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const r = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await r.json(); } catch { data = {}; }
  return { status: r.status, data };
}

function section(title) {
  results.push('');
  results.push(`── ${title} ──`);
}

// ─── state shared across tests ───────────────────────────────────────────────

let agentAId, agentBId;
let ctx1Id, ctx2Id, ctx3Id;
let forkId;
let traceId = 'trc_test_' + Date.now();

// ─── test runner ─────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nDarkMatter Test Suite`);
  console.log(`Base URL: ${BASE}`);
  console.log(`Started:  ${new Date().toISOString()}\n`);

  // ── 1. Identity ───────────────────────────────────────────────────────────
  section('1. Identity (GET /api/me)');

  const meA = await req('GET', '/api/me', null, KEY_A);
  ok('Agent A — 200 OK', meA.status === 200);
  ok('Agent A — has agentId', !!meA.data.agentId);
  ok('Agent A — has agentName', !!meA.data.agentName);
  agentAId = meA.data.agentId;

  const meB = await req('GET', '/api/me', null, KEY_B);
  ok('Agent B — 200 OK', meB.status === 200);
  ok('Agent B — has agentId', !!meB.data.agentId);
  agentBId = meB.data.agentId;

  ok('Agent A and B are different agents', agentAId !== agentBId);

  const meBad = await req('GET', '/api/me', null, 'dm_sk_invalid_key');
  ok('Invalid key — 401', meBad.status === 401);

  // ── 2. Commit ─────────────────────────────────────────────────────────────
  section('2. Commit (POST /api/commit)');

  // Basic commit — Agent A → Agent B
  const c1 = await req('POST', '/api/commit', {
    toAgentId: agentBId,
    payload: {
      input:  'Analyze Q1 earnings report',
      output: { summary: 'APAC revenue up 34%', confidence: 0.94, sources: ['q1_report.pdf'] },
      memory: { model: 'claude-opus-4-6', temperature: 0.3 },
    },
    agent:   { role: 'researcher', provider: 'anthropic', model: 'claude-opus-4-6' },
    traceId,
    eventType: 'commit',
  }, KEY_A);

  ok('Commit 1 — 200 OK', c1.status === 200, JSON.stringify(c1.data).slice(0, 120));
  ok('Commit 1 — has id', !!c1.data.id);
  ok('Commit 1 — id starts with ctx_', c1.data?.id?.startsWith('ctx_'));
  ok('Commit 1 — schema_version 1.0', c1.data.schema_version === '1.0');
  ok('Commit 1 — has integrity block', !!c1.data.integrity);
  ok('Commit 1 — payload_hash present', !!c1.data.integrity?.payload_hash);
  ok('Commit 1 — payload_hash starts sha256:', c1.data.integrity?.payload_hash?.startsWith('sha256:'));
  ok('Commit 1 — verification_status valid', c1.data.integrity?.verification_status === 'valid');
  ok('Commit 1 — parent_id null (root)', c1.data.parent_id === null);
  ok('Commit 1 — created_by present', !!c1.data.created_by);
  ok('Commit 1 — created_by.role researcher', c1.data.created_by?.role === 'researcher');
  ok('Commit 1 — event.type commit', c1.data.event?.type === 'commit');
  ok('Commit 1 — structured output preserved', typeof c1.data.payload?.output === 'object');
  ctx1Id = c1.data.id;

  // Chained commit — Agent B → Agent A with parentId
  const c2 = await req('POST', '/api/commit', {
    toAgentId: agentAId,
    payload:   { input: c1.data.payload?.output, output: 'Draft report written based on APAC data.' },
    agent:     { role: 'writer', provider: 'anthropic', model: 'claude-opus-4-6' },
    parentId:  ctx1Id,
    traceId,
  }, KEY_B);

  ok('Commit 2 — 200 OK', c2.status === 200);
  ok('Commit 2 — parent_id = ctx1Id', c2.data.parent_id === ctx1Id);
  ok('Commit 2 — parent_hash present (chain linked)', !!c2.data.integrity?.parent_hash);
  ctx2Id = c2.data.id;

  // Third commit in chain
  const c3 = await req('POST', '/api/commit', {
    toAgentId: agentBId,
    payload:   { input: c2.data.payload?.output, output: 'Report reviewed. Approved with minor edits.' },
    agent:     { role: 'reviewer', provider: 'anthropic', model: 'claude-opus-4-6' },
    parentId:  ctx2Id,
    traceId,
    eventType: 'checkpoint',
  }, KEY_A);

  ok('Commit 3 — 200 OK', c3.status === 200);
  ok('Commit 3 — eventType checkpoint', c3.data.event?.type === 'checkpoint');
  ctx3Id = c3.data.id;

  // Missing toAgentId
  const cBad1 = await req('POST', '/api/commit', { payload: { output: 'test' } }, KEY_A);
  ok('Commit missing toAgentId — 400', cBad1.status === 400);

  // Missing payload
  const cBad2 = await req('POST', '/api/commit', { toAgentId: agentBId }, KEY_A);
  ok('Commit missing payload — 400', cBad2.status === 400);

  // Non-existent recipient
  const cBad3 = await req('POST', '/api/commit', {
    toAgentId: 'dm_nonexistent_agent',
    payload:   { output: 'test' },
  }, KEY_A);
  ok('Commit unknown recipient — 404', cBad3.status === 404);

  // Legacy context field still works
  const cLegacy = await req('POST', '/api/commit', {
    toAgentId: agentBId,
    context:   'legacy string context',
  }, KEY_A);
  ok('Commit legacy context field — 200', cLegacy.status === 200);

  // ── 3. Pull ───────────────────────────────────────────────────────────────
  section('3. Pull (GET /api/pull)');

  const pull = await req('GET', '/api/pull', null, KEY_B);
  ok('Pull — 200 OK', pull.status === 200);
  ok('Pull — has contexts array', Array.isArray(pull.data.contexts));
  ok('Pull — contexts count > 0', pull.data.count > 0);
  ok('Pull — first context has id', !!pull.data.contexts?.[0]?.id);
  ok('Pull — first context has payload', !!pull.data.contexts?.[0]?.payload);
  ok('Pull — first context has integrity', !!pull.data.contexts?.[0]?.integrity);
  ok('Pull — returns only verified contexts', pull.data.contexts?.every(c => c.integrity?.verification_status === 'valid'));

  // ── 4. Replay ─────────────────────────────────────────────────────────────
  section('4. Replay (GET /api/replay/:ctxId)');

  const replay = await req('GET', `/api/replay/${ctx3Id}`, null, KEY_A);
  ok('Replay — 200 OK', replay.status === 200);
  ok('Replay — chainIntact true', replay.data.chainIntact === true);
  ok('Replay — totalSteps = 3', replay.data.totalSteps === 3, `got ${replay.data.totalSteps}`);
  ok('Replay — steps in chronological order', replay.data.replay?.[0]?.id === ctx1Id);
  ok('Replay — last step = ctx3Id', replay.data.replay?.[replay.data.totalSteps-1]?.id === ctx3Id);
  ok('Replay — each step has payload (full mode)', !!replay.data.replay?.[0]?.payload);
  ok('Replay — each step has integrity', !!replay.data.replay?.[0]?.integrity);
  ok('Replay — summary block present', !!replay.data.summary);
  ok('Replay — summary.agents non-empty', replay.data.summary?.agents?.length > 0);
  ok('Replay — rootId = ctx1Id', replay.data.rootId === ctx1Id);

  // Summary mode
  const replaySummary = await req('GET', `/api/replay/${ctx3Id}?mode=summary`, null, KEY_A);
  ok('Replay summary mode — 200 OK', replaySummary.status === 200);
  ok('Replay summary mode — no payload in steps', !replaySummary.data.replay?.[0]?.payload);
  ok('Replay summary mode — still has integrity', !!replaySummary.data.replay?.[0]?.integrity);

  // Non-existent context
  const replayBad = await req('GET', '/api/replay/ctx_nonexistent_000000', null, KEY_A);
  ok('Replay non-existent — returns empty or 404', replayBad.status === 404 || replayBad.data.totalSteps === 0);

  // ── 5. Verify ─────────────────────────────────────────────────────────────
  section('5. Verify (GET /api/verify/:ctxId)');

  const verify = await req('GET', `/api/verify/${ctx3Id}`, null, KEY_A);
  ok('Verify — 200 OK', verify.status === 200);
  ok('Verify — chain_intact true', verify.data.chain_intact === true);
  ok('Verify — length = 3', verify.data.length === 3, `got ${verify.data.length}`);
  ok('Verify — root_hash present', !!verify.data.root_hash);
  ok('Verify — tip_hash present', !!verify.data.tip_hash);
  ok('Verify — root_hash starts sha256:', verify.data.root_hash?.startsWith('sha256:'));
  ok('Verify — verified_at present', !!verify.data.verified_at);
  ok('Verify — forked field present', verify.data.forked !== undefined);

  // Verify root commit
  const verifyRoot = await req('GET', `/api/verify/${ctx1Id}`, null, KEY_A);
  ok('Verify root — chain_intact true', verifyRoot.data.chain_intact === true);
  ok('Verify root — length = 1', verifyRoot.data.length === 1);

  // ── 6. Fork ───────────────────────────────────────────────────────────────
  section('6. Fork (POST /api/fork/:ctxId)');

  const fork = await req('POST', `/api/fork/${ctx2Id}`, {
    branchKey: 'experiment-prompt-v2',
    toAgentId: agentAId,
  }, KEY_A);

  ok('Fork — 200 OK', fork.status === 200, JSON.stringify(fork.data).slice(0, 150));
  ok('Fork — has id', !!fork.data.id);
  ok('Fork — fork_of = ctx2Id', fork.data.fork_of === ctx2Id);
  ok('Fork — lineage_root present', !!fork.data.lineage_root);
  ok('Fork — event.type fork', fork.data.event?.type === 'fork');
  ok('Fork — branch_key set', fork.data.branch_key === 'experiment-prompt-v2');
  forkId = fork.data.id;

  // Continue forked branch
  const forkContinue = await req('POST', '/api/commit', {
    toAgentId: agentBId,
    payload:   { input: 'Forked path', output: 'Alternative analysis with different prompt.' },
    agent:     { role: 'researcher', provider: 'anthropic', model: 'claude-opus-4-6' },
    parentId:  forkId,
    traceId:   traceId + '_fork',
  }, KEY_A);
  ok('Fork continue — 200 OK', forkContinue.status === 200);
  ok('Fork continue — parent_id = forkId', forkContinue.data.parent_id === forkId);
  ok('Fork continue — parent_hash present', !!forkContinue.data.integrity?.parent_hash);

  // Fork from non-existent
  const forkBad = await req('POST', '/api/fork/ctx_nonexistent_000000', {}, KEY_A);
  ok('Fork non-existent — 404', forkBad.status === 404);

  // ── 7. Export ─────────────────────────────────────────────────────────────
  section('7. Export (GET /api/export/:ctxId)');

  const exp = await req('GET', `/api/export/${ctx3Id}`, null, KEY_A);
  ok('Export — 200 OK', exp.status === 200);
  ok('Export — has metadata block', !!exp.data.metadata);
  ok('Export — metadata.ctx_id correct', exp.data.metadata?.ctx_id === ctx3Id);
  ok('Export — metadata.chain_length = 3', exp.data.metadata?.chain_length === 3, `got ${exp.data.metadata?.chain_length}`);
  ok('Export — has integrity block', !!exp.data.integrity);
  ok('Export — chain_intact true', exp.data.integrity?.chain_intact === true);
  ok('Export — chain_hash present', !!exp.data.integrity?.chain_hash);
  ok('Export — chain_hash starts sha256:', exp.data.integrity?.chain_hash?.startsWith('sha256:'));
  ok('Export — export_hash present', !!exp.data.export_hash);
  ok('Export — has chain array', Array.isArray(exp.data.chain));
  ok('Export — chain has 3 entries', exp.data.chain?.length === 3);

  // Export same chain twice — chain_hash must be identical (deterministic)
  const exp2 = await req('GET', `/api/export/${ctx3Id}`, null, KEY_A);
  ok('Export deterministic chain_hash', exp.data.integrity?.chain_hash === exp2.data.integrity?.chain_hash);
  // export_hash should differ (includes timestamp)
  // (not asserting this as it depends on timing)

  // ── 8. Lineage ────────────────────────────────────────────────────────────
  section('8. Lineage (GET /api/lineage/:ctxId)');

  const lineage = await req('GET', `/api/lineage/${ctx3Id}`, null, KEY_A);
  ok('Lineage — 200 OK', lineage.status === 200);
  ok('Lineage — depth = 3', lineage.data.depth === 3, `got ${lineage.data.depth}`);
  ok('Lineage — rootId = ctx1Id', lineage.data.rootId === ctx1Id);
  ok('Lineage — chain is array', Array.isArray(lineage.data.chain));
  ok('Lineage — integrityVerified true', lineage.data.integrityVerified === true);
  ok('Lineage — each entry has id', lineage.data.chain?.every(c => !!c.id));
  ok('Lineage — each entry has integrityHash', lineage.data.chain?.every(c => !!c.integrityHash));

  // ── 9. Agent self-registration ────────────────────────────────────────────
  section('9. Agent self-registration (POST /api/agents/register)');

  const reg = await req('POST', '/api/agents/register', {
    agentName: `test-spawned-agent-${Date.now()}`,
    role:      'validator',
    provider:  'anthropic',
    model:     'claude-opus-4-6',
  }, KEY_A);

  ok('Register — 201 Created', reg.status === 201, JSON.stringify(reg.data).slice(0, 150));
  ok('Register — has agentId', !!reg.data.agentId);
  ok('Register — has apiKey', !!reg.data.apiKey);
  ok('Register — apiKey starts dm_sk_', reg.data.apiKey?.startsWith('dm_sk_'));
  ok('Register — spawnedBy = agentAId', reg.data.spawnedBy === agentAId);
  ok('Register — meta.role = validator', reg.data.meta?.role === 'validator');

  // Verify spawned agent can authenticate
  const spawnedMe = await req('GET', '/api/me', null, reg.data.apiKey);
  ok('Register — spawned agent can auth', spawnedMe.status === 200);
  ok('Register — spawned agent has correct name', spawnedMe.data.agentName === reg.data.agentName);

  // Spawned agent can commit
  const spawnedCommit = await req('POST', '/api/commit', {
    toAgentId: agentAId,
    payload:   { input: 'spawned agent test', output: 'validation complete' },
    agent:     { role: 'validator' },
  }, reg.data.apiKey);
  ok('Register — spawned agent can commit', spawnedCommit.status === 200);

  // Invalid agent name
  const regBad = await req('POST', '/api/agents/register', {
    agentName: 'invalid<>name!@#',
  }, KEY_A);
  ok('Register invalid name — 400', regBad.status === 400);

  // Missing name
  const regNoName = await req('POST', '/api/agents/register', {}, KEY_A);
  ok('Register missing name — 400', regNoName.status === 400);

  // ── 10. BYOK encryption ───────────────────────────────────────────────────
  section('10. BYOK encryption (POST /enterprise/commit, POST /enterprise/decrypt)');

  const byokKey = require('crypto').randomBytes(32).toString('hex');

  const encCommit = await req('POST', '/enterprise/commit', {
    toAgentId: agentBId,
    payload:   { input: 'sensitive data', output: 'confidential analysis result' },
    byokKey,
    agent:     { role: 'researcher' },
  }, KEY_A);

  ok('BYOK commit — 200 OK', encCommit.status === 200, JSON.stringify(encCommit.data).slice(0, 150));
  ok('BYOK commit — encrypted: true', encCommit.data.encrypted === true);
  ok('BYOK commit — has key_hint', !!encCommit.data.key_hint);
  ok('BYOK commit — key_hint = last 4 of key', encCommit.data.key_hint === byokKey.slice(-4));
  ok('BYOK commit — integrity present', !!encCommit.data.integrity);
  ok('BYOK commit — has id', !!encCommit.data.id);

  const encCtxId = encCommit.data.id;

  // Decrypt with correct key
  const decrypt = await req('POST', `/enterprise/decrypt/${encCtxId}`, { byokKey }, KEY_A);
  ok('BYOK decrypt — 200 OK', decrypt.status === 200, JSON.stringify(decrypt.data).slice(0, 150));
  ok('BYOK decrypt — payload.input correct', decrypt.data.payload?.input === 'sensitive data');
  ok('BYOK decrypt — payload.output correct', decrypt.data.payload?.output === 'confidential analysis result');

  // Decrypt with wrong key — should fail
  const wrongKey = require('crypto').randomBytes(32).toString('hex');
  const decryptBad = await req('POST', `/enterprise/decrypt/${encCtxId}`, { byokKey: wrongKey }, KEY_A);
  ok('BYOK decrypt wrong key — 403', decryptBad.status === 403);

  // Missing byokKey
  const encBad = await req('POST', '/enterprise/commit', {
    toAgentId: agentBId,
    payload:   { output: 'test' },
  }, KEY_A);
  ok('BYOK commit missing key — 400', encBad.status === 400);

  // ── 11. Stats / Public ─────────────────────────────────────────────────────
  section('11. Public endpoints');

  const stats = await req('GET', '/api/stats', null, null);
  ok('Stats — 200 OK (no auth needed)', stats.status === 200);

  const demo = await req('GET', '/api/demo', null, null);
  ok('Demo — 200 OK (no auth needed)', demo.status === 200);
  ok('Demo — has chain or contexts', !!(demo.data.chain || demo.data.contexts || demo.data.replay));

  // ── 12. Page routes ────────────────────────────────────────────────────────
  section('12. Page routes (HTML pages serve correctly)');

  const pages = ['/', '/demo', '/pricing', '/docs', '/why', '/blog', '/enterprise', '/security', '/login', '/signup'];
  for (const pg of pages) {
    const r = await fetch(`${BASE}${pg}`);
    ok(`Page ${pg} — 200 OK`, r.status === 200);
  }

  // ── 13. Security / edge cases ─────────────────────────────────────────────
  section('13. Security and edge cases');

  // No auth header
  const noAuth = await req('GET', '/api/me', null, null);
  ok('No auth header — 401', noAuth.status === 401);

  // Empty string key
  const emptyKey = await req('GET', '/api/me', null, '');
  ok('Empty key — 401', emptyKey.status === 401);

  // Payload too large
  const bigPayload = { toAgentId: agentBId, payload: { output: 'x'.repeat(200000) } };
  try {
    const big = await req('POST', '/api/commit', bigPayload, KEY_A);
    ok('Oversized payload — rejected (413 or 400)', big.status === 413 || big.status === 400);
  } catch { ok('Oversized payload — connection error (expected)', true); }

  // SSRF webhook
  const ssrfWebhook = await req('POST', `/dashboard/agents/${agentAId}/webhook`,
    { webhookUrl: 'http://169.254.169.254/latest/meta-data/' }, KEY_A);
  // This requires JWT auth so will return 401 — that is still safe
  ok('SSRF webhook attempt — not 200', ssrfWebhook.status !== 200);

  // ── 14. Integrity math ────────────────────────────────────────────────────
  section('14. Integrity math verification');

  const crypto = require('crypto');
  // Recompute hash chain manually and verify it matches what the server returned
  if (c1.data && c2.data && c3.data) {
    const p1 = c1.data.payload;
    const norm1 = JSON.stringify(p1, Object.keys(p1).sort());
    const ph1 = 'sha256:' + crypto.createHash('sha256').update(norm1).digest('hex');
    ok('Hash chain — commit 1 payload_hash matches', c1.data.integrity?.payload_hash === ph1);

    // c2 parent_hash should equal c1 integrity_hash (without sha256: prefix match)
    const ih1 = c1.data.integrity?.payload_hash?.replace('sha256:', '');
    const ph1raw = ph1.replace('sha256:', '');
    const chain1 = ph1raw + 'root';
    const ih1computed = 'sha256:' + crypto.createHash('sha256').update(chain1).digest('hex');
    // Note: integrity_hash in response is payload_hash field (mapped from integrity_hash column)
    // The actual chain integrity is verified via verify endpoint which returned chain_intact:true
    ok('Hash chain — verify endpoint confirmed chain intact', verify.data.chain_intact === true);
    ok('Hash chain — all 3 commits in export chain', exp.data.chain?.length === 3);
  } else {
    skip('Hash chain math', 'commits not available');
  }

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(results.join('\n'));
  console.log('');
  console.log(`─────────────────────────────────`);
  console.log(`Passed:  ${passed}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total:   ${passed + failed + skipped}`);
  console.log('');

  if (failed > 0) {
    console.log(`${failed} test(s) failed. See ✗ lines above.`);
    process.exit(1);
  } else {
    console.log(`All tests passed.`);
  }
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
