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
 *   tinker       someone recorded a fine-tuning run. The namespaced event type
 *                is what makes this findable: a generic "commit" is
 *                indistinguishable from every other passport in the world,
 *                whereas "tinker.finetune_started" appears only where somebody
 *                actually recorded one. This is the argument for namespacing
 *                custom event types generally, not just here.
 *   forks_<repo>, stars_<repo>
 *                per repository. Weaker than a code hit, but a fork is a
 *                deliberate act and the repo prefix tells the owner which one moved.
 *
 * Every code query above matches text that exists only because somebody used
 * Context Passport: the schema URL, an SDK import path, a namespaced event
 * type. That is not a stylistic preference, it is the one rule this file has:
 *
 *   If a stranger can trip a signal without using this format, the signal is
 *   measuring something else.
 *
 * A fifth query, `mcp`, was removed on 2026-09-23 for breaking it four times
 * (#67, #76, #87). It searched for a third party package that emits passports,
 * first by tool name and then by package name, and so matched any repository
 * that indexes npm or the MCP registry. Every one of its hits was a registry
 * mirror or a security scanner; it produced four false positives and no true
 * ones, and the population able to trip it was growing while the population of
 * actual users stayed at zero. Narrowing the query never helped, because
 * precision was not the broken part: the signal was one step removed from the
 * thing being measured even when it was right. Somebody installing a server
 * that can emit passports is not somebody who used the format, and if they
 * then use it, `records` catches them directly, because the record carries the
 * schema URL.
 *
 * So: do not add a signal that matches somebody else's name. A tripwire whose
 * false positive rate rises over time will be ignored before it is ever right,
 * and the alert this file exists to deliver is one that must be read the first
 * time it fires.
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
 *
 * A signal that could not be measured is not the same as a signal that is
 * zero, and the run must never let the two look alike. Code search is limited
 * per token rather than per workflow, so a run can arrive at a window another
 * job already spent; when that happens the query is retried once after the
 * back off GitHub names, and if it still fails the signal is reported as
 * `unknown` and named in the summary. The bare "No change." is reserved for a
 * run that actually looked at everything. Before this, four rate-limited
 * searches were reported by being left out of the report, so a run that
 * evaluated no code query at all printed a complete-looking list and exited 0
 * (#89).
 *
 * Reporting a gap truthfully is not the same as not having one. The back off
 * a 429 advertises (583s in #89, 735s in #95) is at or beyond what a single
 * query is allowed to wait, so on a real rate limit the in-place retry
 * declines and the signal goes unknown however well that is then described.
 * What was measured to work, twice, is coming back a couple of minutes later,
 * so the run now takes one second pass over whatever it could not read before
 * it reports. That closes the gap rather than narrating it. It does not
 * change what happens when the gap survives: an unmeasured signal is still
 * `unknown`, still named, and still exits 0. Whether an unreadable `records`
 * ought to fail the run instead is a question about the alerting contract and
 * is open in #95.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  parseBackoffSeconds,
  reportLines,
  noChangeLines,
  planSecondPass,
  remainingSkipped,
} from './adoption-decide.mjs';

const STATE = '.github/adoption.json';

// How long a single rate-limited query may wait for the window GitHub asks
// for, and how much waiting the whole run may do. 583s is the longest back off
// observed in the wild (#89), so a single wait is allowed a little more than
// that and no more. The total budget matters because the quota is per token and
// shared: if four queries are all told to wait ten minutes, the fix for the
// first wait is usually the fix for all four, and a run that sat through each
// of them in turn would be worse than the gap it was closing.
//
// Overridable the same way REPOS is, so the waiting can be exercised by hand
// without sitting through eleven minutes of it. A junk value falls back to the
// default rather than becoming NaN, which would compare false against every
// limit and so quietly remove the cap it was setting.
const seconds = (value, fallback) => {
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const MAX_BACKOFF_SECONDS = seconds(process.env.MAX_BACKOFF_SECONDS, 660);
const MAX_TOTAL_BACKOFF_SECONDS = seconds(process.env.MAX_TOTAL_BACKOFF_SECONDS, 900);
// How long the second pass settles before re-reading the signals the first
// pass could not. Deliberately far short of the back off a 429 advertises:
// the point of coming back is that the window reopens on its own clock, and
// two minutes was measured as enough twice (#95). Overridable like the two
// above so the pass can be exercised without sitting through it.
const SECOND_PASS_SETTLE_SECONDS = seconds(process.env.SECOND_PASS_SETTLE_SECONDS, 60);
let backoffSpent = 0;
const DEFAULT_REPOS = [
  'contextpassport/spec',
  'contextpassport/python',
  'contextpassport/typescript',
  'contextpassport/conformance-tests',
  'contextpassport/verifiable-agent-template',
  'contextpassport/tinker-provenance',
];
const repos = (process.env.REPOS || process.env.REPO || DEFAULT_REPOS.join(' '))
  .split(/\s+/)
  .filter(Boolean);

// Queries chosen to be specific enough that a hit is real. Broad ones like
// `"schema_version": "2.0"` return thousands of unrelated files and are
// useless as a tripwire. Each of these matches text that only appears where
// somebody used this format; see the rule in the header before adding one.
const CODE_QUERIES = {
  records: '"contextpassport.com/schema" "integrity_hash"',
  python: '"from context_passport import"',
  typescript: '"@contextpassport/core"',
  tinker: '"tinker.finetune_started"',
};

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

// Everything gh said when it failed. The 429 back off is on stderr, not in
// the Error message, so a message-only read finds nothing to wait for.
function ghErrorText(e) {
  return [e?.stderr, e?.stdout, e?.message]
    .map((part) => (part == null ? '' : String(part)))
    .join('\n');
}

// One code search, no retry and no interpretation. Separate from
// codeSearchCount so the second pass can make a bare attempt without
// re-entering the back off machinery below. Throws on any gh failure; both
// callers decide what that means.
function searchCount(query) {
  return Number(
    gh(['api', '-X', 'GET', 'search/code', '--raw-field', `q=${query}`, '--jq', '.total_count']).trim(),
  );
}

/**
 * Count matches for one code query, retrying once if GitHub rate limits us.
 *
 * The retry helps only when the window GitHub names is one this run may wait
 * for. Code search is limited per token, not per workflow, so a shared runner
 * can arrive at a window that is already spent, and the back off then
 * advertised (583s in #89, 735s in #95) is far longer than anything the 7s
 * spacing between calls can absorb, and at or beyond the cap below. Spacing
 * calls within a run cannot open a window that is closed for reasons outside
 * the run; waiting for the window it names can, when the wait is short enough
 * to be allowed. When it is not, this declines, and the second pass at the
 * end of the run is what comes back for the signal instead.
 *
 * Returns null when the count could not be established, which the caller
 * records as unmeasured. Still null rather than 0: a transient API problem
 * must never read as adoption vanishing.
 */
function codeSearchCount(query, name) {
  const attempt = () => searchCount(query);
  try {
    return attempt();
  } catch (e) {
    const wait = parseBackoffSeconds(ghErrorText(e));
    if (wait === null) {
      console.error(`  ${name}: search failed, and GitHub named no retry delay`);
      return null;
    }
    if (wait > MAX_BACKOFF_SECONDS) {
      console.error(`  ${name}: rate limited for ${wait}s, longer than this run will wait`);
      return null;
    }
    if (backoffSpent + wait > MAX_TOTAL_BACKOFF_SECONDS) {
      console.error(`  ${name}: rate limited for ${wait}s, and this run has waited enough already`);
      return null;
    }
    console.error(`  ${name}: rate limited, waiting the ${wait}s GitHub asked for, then retrying once`);
    backoffSpent += wait;
    pause((wait + 1) * 1000);
    try {
      const count = attempt();
      console.error(`  ${name}: retry succeeded`);
      return count;
    } catch (retryErr) {
      console.error(`  ${name}: retry failed too: ${ghErrorText(retryErr).trim().split('\n')[0]}`);
      return null;
    }
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
  const stats = {};
  for (const repo of repos) {
    const short = repo.split('/')[1];
    try {
      const out = gh(['api', `repos/${repo}`, '--jq', '{forks: .forks_count, stars: .stargazers_count}']);
      const { forks, stars } = JSON.parse(out);
      stats[`forks_${short}`] = forks;
      stats[`stars_${short}`] = stars;
    } catch {
      // A single failed lookup must not erase the baseline for other repos.
    }
  }
  return stats;
}

// ---------------------------------------------------------------- gather

const current = {};
const foundIn = {};
// Signals whose query could not be evaluated. Tracked so the report can say
// so. Before #89 the only record of a skip was a console.log in the middle of
// a run judged by its exit code, and a skipped signal then vanished from the
// report rather than appearing as a gap in it.
let skipped = [];

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (const [name, query] of Object.entries(CODE_QUERIES)) {
  // GitHub's code search API allows roughly 10 requests a minute. A weekly
  // run is nowhere near that, but spacing the calls keeps a manual re-run
  // from 403ing, which would otherwise look like every signal going quiet.
  //
  // This spacing is not what protects against a 429. The quota is per token
  // and already partly spent when the job starts; see codeSearchCount.
  pause(7000);
  const count = codeSearchCount(query, name);
  if (count === null) {
    console.error(`  ${name}: not measured this run`);
    skipped.push(name);
    continue;
  }
  current[name] = count;
  if (count > 0) foundIn[name] = codeSearchRepos(query);
}

Object.assign(current, repoStats());

// ----------------------------------------------------------- second pass
//
// Come back once for whatever the first pass could not read. The in-place
// retry inside codeSearchCount honours the back off GitHub advertises, and
// that figure (583s in #89, 735s in #95) is at or past the cap a single query
// may wait, so on a real rate limit it declines and the signal goes unknown.
// Coming back a couple of minutes later is what was actually measured to
// work, twice. The fork and star lookups above have already run, so some of
// the settle is time this run was spending anyway.
//
// One bare attempt each, not the full retry machinery: the settle is the
// wait, and a second pass that could itself sit through another back off
// would make the run's cost unpredictable for no extra signal.
const plan = planSecondPass({
  skipped,
  backoffSpent,
  maxTotalBackoffSeconds: MAX_TOTAL_BACKOFF_SECONDS,
  settleSeconds: SECOND_PASS_SETTLE_SECONDS,
});

if (plan.retry.length > 0) {
  console.error(
    `\nSecond pass: ${plan.reason}. Settling ${plan.waitSeconds}s, then re-reading: ${plan.retry.join(', ')}`,
  );
  pause(plan.waitSeconds * 1000);

  const recovered = [];
  for (const name of plan.retry) {
    pause(7000);
    try {
      const count = searchCount(CODE_QUERIES[name]);
      current[name] = count;
      if (count > 0) foundIn[name] = codeSearchRepos(CODE_QUERIES[name]);
      recovered.push(name);
      console.error(`  ${name}: measured on the second pass`);
    } catch (e) {
      console.error(`  ${name}: still unreadable: ${ghErrorText(e).trim().split('\n')[0]}`);
    }
  }

  // A recovered signal must leave the skip list, or the report would print
  // `unknown` over a count the run is holding. That is #89 inverted, and it
  // would be just as untrue.
  skipped = remainingSkipped(skipped, recovered);
  if (skipped.length === 0) console.error('  second pass closed every gap');
}

const previous = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const before = previous.signals || {};

// ----------------------------------------------------------------- report

// Report every signal that was supposed to be measured, including the ones
// that were not. Iterating `current` alone is what made a run covering only
// forks and stars print as a complete list (#89): a skipped signal was not
// shown as unknown, it was absent, and absence looks like nothing to see.
const names = [...Object.keys(CODE_QUERIES), ...Object.keys(current).filter((k) => !(k in CODE_QUERIES))];

console.log('\nAdoption signals\n');
for (const line of reportLines({ names, current, before, skipped })) console.log(line);

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
  const { lines, complete } = noChangeLines(skipped);
  // A run that measured everything says so on stdout. A run with a gap in it
  // says that on stderr, so it survives into the step summary a reader
  // actually sees rather than sitting in the middle of the log.
  for (const line of lines) (complete ? console.log : console.error)(line);
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
