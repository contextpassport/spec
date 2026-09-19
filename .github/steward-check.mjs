#!/usr/bin/env node
/**
 * Fails when an outside contribution has been left to rot.
 *
 * Scans open issues and pull requests across the Context Passport repositories
 * (REPOS), then asks the API for each item's comments, plus reviews on pull
 * requests. The rules for what counts as neglected live in
 * .github/steward-decide.mjs, away from the network, so they can be tested
 * against fixed inputs rather than only reasoned about. This file is the
 * fetching half and the reporting half; it holds no judgement of its own.
 *
 * Three shapes are reported separately, because they ask different things of
 * the maintainer: nobody answered, somebody approved and never merged, or the
 * thread was answered and then went still.
 *
 * Maintainers are read from .github/CODEOWNERS in the checkout, which
 * GOVERNANCE.md names as the authoritative list. The workflow passes
 * GH_TOKEN from the Actions token; no separate PAT is required.
 *
 * Exit 1 makes GitHub email the repository owner. Nothing is posted publicly.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  triage, approversFromReviews, CATEGORIES, HEADINGS, GUIDANCE,
} from './steward-decide.mjs';

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

function listOpen(repo, kind) {
  const isPullRequest = kind !== 'issue';
  const subcommand = isPullRequest ? 'pr' : 'issue';
  // reviewDecision exists only on pull requests, and is null wherever the base
  // branch does not require review, which is the case across these
  // repositories. It is still requested because it is correct when populated,
  // but approval is derived from the reviews themselves in responders().
  const fields = isPullRequest
    ? 'number,title,author,createdAt,updatedAt,url,reviewDecision'
    : 'number,title,author,createdAt,updatedAt,url';
  const out = gh([
    subcommand, 'list', '--repo', repo, '--state', 'open', '--limit', '100',
    '--json', fields,
  ]);
  const label = isPullRequest ? 'pull request' : 'issue';
  return JSON.parse(out).map((item) => ({ ...item, repo, kind: label }));
}

function responders(repo, number, isPullRequest) {
  const logins = new Set();
  let approvedBy = [];
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
      // login and state together: the state is what tells an approval that is
      // still standing from one that a later review withdrew. The API returns
      // reviews chronologically, which approversFromReviews relies on.
      const reviews = gh([
        'api', '--paginate', `repos/${repo}/pulls/${number}/reviews`,
        '--jq', '.[] | [.user.login, .state] | @tsv',
      ]);
      const parsed = reviews
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [login, state] = line.split('\t');
          return { login, state };
        });
      parsed.forEach(({ login }) => logins.add(login));
      approvedBy = approversFromReviews(parsed);
    } catch {
      // Same as above.
    }
  }
  return { logins: [...logins], approvedBy };
}

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

const groups = triage(
  items,
  (item) => responders(item.repo, item.number, item.kind === 'pull request'),
  { maintainers, graceDays, now: new Date() },
);

console.log(
  `Scanned ${items.length} open item(s) across ${repos.length} repo(s); maintainers (${CODEOWNERS}): ${maintainers.join(', ')}`,
);

const total = CATEGORIES.reduce((n, c) => n + groups.get(c).length, 0);

if (total === 0) {
  console.log('Nothing is waiting on a reply, a merge, or a decision.');
  process.exit(0);
}

console.error(`\n${total} contribution(s) need attention:\n`);
for (const category of CATEGORIES) {
  const list = groups.get(category);
  if (list.length === 0) continue;
  console.error(`${HEADINGS[category]} (${list.length})`);
  console.error(`  ${GUIDANCE[category]}\n`);
  for (const w of list) {
    const idle = Math.floor(w.idle);
    console.error(`  ${Math.floor(w.age)}d open, ${idle}d since activity  ${w.kind} ${w.repo}#${w.number} by ${w.author}`);
    console.error(`       ${w.title}`);
    console.error(`       ${w.url}\n`);
  }
}
console.error('These are the only part of this project that decays from neglect.');
process.exit(1);
