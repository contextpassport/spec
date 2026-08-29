#!/usr/bin/env node
/**
 * Watches for the first sign that somebody outside this project is actually
 * using Context Passport, and says so the moment it happens.
 *
 * The hard problem with a CC0 standard is that adoption is invisible by
 * design. Nobody signs up, nobody logs in, and there is no server to count.
 * Package download counts do not fill the gap: at low volume they are almost
 * entirely mirrors, CI and bots, so they look healthy while nothing is
 * happening. A package nobody uses still shows dozens of pulls a month.
 *
 * So this tracks signals that require a human to have done something:
 *
 *   records      someone committed a Context Passport record to a public repo.
 *                The strongest signal there is, because a record only exists if
 *                the format was used. Matched on the $schema URL AND
 *                integrity_hash together: the URL alone also appears in schema
 *                catalogues, and being listed in a catalogue is distribution,
 *                not usage. That false positive was live for one run, caused by
 *                our own SchemaStore entry being merged.
 *   python / ts  someone imported a reference SDK in a public repo.
 *   mcp          someone wired up the DarkMatter MCP tools.
 *   tinker       someone recorded a fine-tuning run. The namespaced event type
 *                is what makes this findable: a generic "commit" is
 *                indistinguishable from every other passport in the world,
 *                whereas "tinker.finetune_started" appears only where somebody
 *                actually recorded one. This is the argument for namespacing
 *                custom event types generally, not just here.
 *   forks/stars  weaker, but a fork is a deliberate act.
 *
 * State lives in .github/adoption.json, which deliberately carries no
 * timestamp: it should change only when a signal changes, so its git history
 * reads as a log of adoption rather than a weekly no-op commit. When the run
 * last happened is in the Actions history.
 *
 * The run FAILS when a signal rises,
 * which makes GitHub email the repository owner. That is deliberate: the
 * first real user is the single most important event in this project's life,
 * and it should not arrive as a line in a log nobody reads.
 *
 * Falling counts are recorded but never alarm. A deleted repo is not news.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const STATE = '.github/adoption.json';
const repo = process.env.REPO || 'contextpassport/spec';

// Queries chosen to be specific enough that a hit is real. Broad ones like
// `"schema_version": "2.0"` return thousands of unrelated files and are
// useless as a tripwire.
const CODE_QUERIES = {
  records: '"contextpassport.com/schema" "integrity_hash"',
  python: '"from context_passport import"',
  typescript: '"@contextpassport/core"',
  mcp: '"darkmatter_commit"',
  tinker: '"tinker.finetune_started"',
};

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function codeSearchCount(query) {
  try {
    const out = gh(['api', '-X', 'GET', 'search/code', '--raw-field', `q=${query}`, '--jq', '.total_count']);
    return Number(out.trim());
  } catch (e) {
    // A failed search must not read as zero, or a transient API problem would
    // silently look like adoption vanishing.
    return null;
  }
}

function codeSearchRepos(query) {
  try {
    const out = gh([
      'api', '-X', 'GET', 'search/code', '--raw-field', `q=${query}`,
      '--jq', '[.items[]?.repository.full_name] | unique | join(", ")',
    ]);
    return out.trim();
  } catch {
    return '';
  }
}

function repoStats() {
  try {
    const out = gh(['api', `repos/${repo}`, '--jq', '{forks: .forks_count, stars: .stargazers_count}']);
    return JSON.parse(out);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- gather

const current = {};
const foundIn = {};

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (const [name, query] of Object.entries(CODE_QUERIES)) {
  // GitHub's code search API allows roughly 10 requests a minute. A weekly
  // run is nowhere near that, but spacing the calls keeps a manual re-run
  // from 403ing, which would otherwise look like every signal going quiet.
  pause(7000);
  const count = codeSearchCount(query);
  if (count === null) {
    console.log(`  ${name}: search failed, skipping this run`);
    continue;
  }
  current[name] = count;
  if (count > 0) foundIn[name] = codeSearchRepos(query);
}

Object.assign(current, repoStats());

const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const before = previous.signals || {};

// ----------------------------------------------------------------- report

console.log('\nAdoption signals\n');
for (const [k, v] of Object.entries(current)) {
  const was = before[k];
  const delta = was === undefined ? '' : v > was ? `  (up from ${was})` : v < was ? `  (down from ${was})` : '';
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}${delta}`);
}

const risen = Object.entries(current).filter(([k, v]) => before[k] !== undefined && v > before[k]);
const firstEver = Object.entries(current).filter(
  ([k, v]) => v > 0 && (before[k] === undefined || before[k] === 0) && k in CODE_QUERIES,
);

// Merge over the previous state rather than replacing it. A rate-limited or
// failed search leaves its key out of `current`, and writing that directly
// would erase the baseline for that signal, so a later run would have nothing
// to compare the first real hit against.
const merged = { ...before, ...current };

writeFileSync(
  STATE,
  JSON.stringify({ signals: merged }, null, 2) + '\n',
);

if (firstEver.length === 0 && risen.length === 0) {
  console.log('\nNo change.\n');
  process.exit(0);
}

console.error('\n' + '='.repeat(60));
if (firstEver.length) {
  console.error('\nFIRST EXTERNAL USE DETECTED\n');
  for (const [k, v] of firstEver) {
    console.error(`  ${k}: ${v} hit(s) where there were none`);
    if (foundIn[k]) console.error(`    ${foundIn[k]}`);
  }
  console.error('\nSomebody is using this. Worth finding out who, and asking what');
  console.error('they needed it for.');
}
if (risen.length) {
  console.error('\nRisen since last check:');
  for (const [k, v] of risen) console.error(`  ${k}: ${before[k]} -> ${v}`);
}
console.error('\n' + 'To acknowledge this and stop the weekly alert,');
console.error('commit the new numbers into .github/adoption.json:');
console.error('  ' + JSON.stringify(merged));
console.error('\n' + '='.repeat(60) + '\n');
process.exit(1);
