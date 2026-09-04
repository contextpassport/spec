#!/usr/bin/env node
/**
 * Fails when an outside contribution has been left without a maintainer reply.
 *
 * Scans open issues and pull requests across the Context Passport repositories
 * (REPOS), then asks the API for each item's comments and — for pull requests
 * — reviews. An item counts as "awaiting reply" when:
 *
 *   - it was opened by someone who is not a maintainer and not a bot, and
 *   - no maintainer has commented or submitted a review, and
 *   - it is older than GRACE_DAYS.
 *
 * Maintainers are read from .github/CODEOWNERS in the checkout, which
 * GOVERNANCE.md names as the authoritative list. The workflow passes
 * GH_TOKEN from the Actions token; no separate PAT is required.
 *
 * Exit 1 makes GitHub email the repository owner. Nothing is posted publicly.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DEFAULT_REPOS = [
  'contextpassport/spec',
  'contextpassport/python',
  'contextpassport/typescript',
  'contextpassport/conformance-tests',
  'contextpassport/verifiable-agent-template',
  'contextpassport/tinker-provenance',
];

const CODEOWNERS = '.github/CODEOWNERS';

const repos = (process.env.REPOS || process.env.REPO || DEFAULT_REPOS.join(' '))
  .split(/\s+/)
  .filter(Boolean);
const graceDays = Number(process.env.GRACE_DAYS || '7');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function maintainersFromCodeowners(path = CODEOWNERS) {
  const text = readFileSync(path, 'utf8');
  const logins = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const part of trimmed.split(/\s+/).slice(1)) {
      if (part.startsWith('@')) logins.add(part.slice(1).toLowerCase());
    }
  }
  if (logins.size === 0) {
    throw new Error(`no maintainers found in ${path}`);
  }
  return [...logins];
}

let maintainers;
try {
  maintainers = maintainersFromCodeowners();
} catch (err) {
  console.error(`Could not read maintainers from ${CODEOWNERS}: ${err.message || err}`);
  process.exit(1);
}

const isBot = (login = '') =>
  login.endsWith('[bot]') || /(^|-)(bot|dependabot|renovate)$/i.test(login);
const isMaintainer = (login = '') => maintainers.includes(login.toLowerCase());

function listOpen(repo, kind) {
  const subcommand = kind === 'issue' ? 'issue' : 'pr';
  const out = gh([
    subcommand, 'list', '--repo', repo, '--state', 'open', '--limit', '100',
    '--json', 'number,title,author,createdAt,url',
  ]);
  const label = kind === 'issue' ? 'issue' : 'pull request';
  return JSON.parse(out).map((item) => ({ ...item, repo, kind: label }));
}

function responders(repo, number, isPullRequest) {
  const logins = new Set();
  try {
    const comments = gh([
      'api', '--paginate', `repos/${repo}/issues/${number}/comments`,
      '--jq', '.[].user.login',
    ]);
    comments.split('\n').filter(Boolean).forEach((login) => logins.add(login));
  } catch {
    // Treat a failed comment fetch as no reply rather than skipping the item.
  }
  if (isPullRequest) {
    try {
      const reviews = gh([
        'api', '--paginate', `repos/${repo}/pulls/${number}/reviews`,
        '--jq', '.[].user.login',
      ]);
      reviews.split('\n').filter(Boolean).forEach((login) => logins.add(login));
    } catch {
      // Same as above.
    }
  }
  return [...logins];
}

const ageDays = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

const items = [];
for (const repo of repos) {
  try {
    items.push(...listOpen(repo, 'issue'));
    items.push(...listOpen(repo, 'pull request'));
  } catch (err) {
    console.error(`Could not scan ${repo}: ${err.message || err}`);
    process.exit(1);
  }
}

const waiting = [];
for (const it of items) {
  const author = it.author?.login || '';
  if (isMaintainer(author) || isBot(author)) continue;

  const age = ageDays(it.createdAt);
  if (age < graceDays) continue;

  const isPullRequest = it.kind === 'pull request';
  const replied = responders(it.repo, it.number, isPullRequest).some(isMaintainer);
  if (!replied) waiting.push({ ...it, author, age: Math.floor(age) });
}

console.log(
  `Scanned ${items.length} open item(s) across ${repos.length} repo(s); maintainers (${CODEOWNERS}): ${maintainers.join(', ')}`,
);

if (waiting.length === 0) {
  console.log('Nothing is waiting on a reply.');
  process.exit(0);
}

console.error(`\n${waiting.length} contribution(s) awaiting a maintainer reply:\n`);
for (const w of waiting.sort((a, b) => b.age - a.age)) {
  console.error(`  ${w.age}d  ${w.kind} ${w.repo}#${w.number} by ${w.author}`);
  console.error(`       ${w.title}`);
  console.error(`       ${w.url}\n`);
}
console.error('These are the only part of this project that decays from neglect.');
process.exit(1);
