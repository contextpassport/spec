#!/usr/bin/env node
/**
 * Fails when a workflow that is supposed to be watching has stopped running.
 *
 * GitHub switches off a scheduled workflow in a public repository after 60
 * days with no repository activity, and tells nobody. The run list is no help,
 * because the last recorded run succeeded; the Actions tab reads as healthy
 * right up to the point where the suite stopped running. Two repositories were
 * found in exactly that state in November 2026 and neither the Steward nor any
 * surface a maintainer would check said so. See #110, and
 * WHY_THIS_CHECK_EXISTS in workflow-state-decide.mjs.
 *
 * This file is the fetching half and the reporting half. Every rule about what
 * counts as switched off lives in .github/workflow-state-decide.mjs, away from
 * the network, so it can be tested against fixed readings. Same split as
 * steward-check.mjs and adoption-check.mjs, for the same reason.
 *
 * One API call per repository, needing the actions: read scope and no secrets.
 *
 * Exit 1 makes GitHub email the repository owner. Nothing is posted publicly.
 */

import { execFileSync } from 'node:child_process';

import { reposFromEnv } from './repos.mjs';
import {
  reviewWorkflowStates, countFindings, CATEGORIES, HEADINGS, GUIDANCE,
} from './workflow-state-decide.mjs';

const repos = reposFromEnv();

/**
 * Read one repository's workflow listing.
 *
 * A failure is returned rather than thrown, because the report has to be able
 * to say which repositories it did not manage to read. Exiting on the first
 * error would hide the state of every repository behind it, and swallowing the
 * error would report them all as healthy. See WHY_AN_UNREADABLE_REPOSITORY_IS
 * _A_FINDING in workflow-state-decide.mjs.
 */
function readWorkflows(repo) {
  try {
    const out = execFileSync('gh', [
      'api', '--paginate', `repos/${repo}/actions/workflows`,
      '--jq', '.workflows[] | [.name, .state, .path] | @tsv',
    ], { encoding: 'utf8' });

    const workflows = out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, state, path] = line.split('\t');
        return { name, state, path };
      });

    return { repo, workflows };
  } catch (err) {
    const detail = (err?.stderr || err?.message || String(err)).toString().trim();
    return { repo, error: detail.split('\n').filter(Boolean).pop() || 'unknown error' };
  }
}

const readings = repos.map(readWorkflows);
const groups = reviewWorkflowStates(readings);

const counted = readings.filter((r) => !r.error).length;
console.log(
  `Read workflow state for ${counted} of ${repos.length} repo(s): ${repos.join(', ')}`,
);

if (countFindings(groups) === 0) {
  console.log('Every workflow under watch is active.');
  process.exit(0);
}

console.error(`\n${countFindings(groups)} finding(s):\n`);
for (const category of CATEGORIES) {
  const list = groups.get(category);
  if (list.length === 0) continue;
  console.error(`${HEADINGS[category]} (${list.length})`);
  console.error(`  ${GUIDANCE[category]}\n`);
  for (const f of list) {
    if (category === 'off') {
      console.error(`  ${f.state}  ${f.repo}  ${f.name}`);
      if (f.path) console.error(`       ${f.path}`);
      console.error(`       https://github.com/${f.repo}/actions\n`);
    } else if (category === 'unreadable') {
      console.error(`  ${f.repo}`);
      console.error(`       ${f.reason}\n`);
    } else {
      console.error(`  ${f.repo}`);
      console.error(`       https://github.com/${f.repo}/actions\n`);
    }
  }
}

// Enabling a workflow again is a manual step. It is worth saying every time,
// because the intuitive fix is to merge the repository's heartbeat pull
// request, and a merge does not switch a disabled workflow back on. Where the
// disabled workflow also produces a required status check, it gates the merge
// of its own fix, which is how #110 was found.
console.error(
  'A workflow in a disabled state runs on no trigger. Enabling it is a manual step, and merging does not do it.',
);
process.exit(1);
