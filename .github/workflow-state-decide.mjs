/**
 * The decision logic for the automation check, separated from the network.
 *
 * Same split as steward-decide.mjs and adoption-decide.mjs, for the same
 * reason: the fetching half cannot be tested, so the judgement does not live
 * there. What is being judged here is one reading per workflow, of the shape
 * the Actions API returns, and the question asked of each is only whether it
 * still runs.
 *
 * WHY_THIS_CHECK_EXISTS
 *
 * GitHub disables a scheduled workflow in a public repository after 60 days
 * with no repository activity. A repository that has settled down is exactly
 * what that rule punishes, and a weekly suite is worth most when nobody is
 * committing, so the quiet stretch that makes a schedule useful is the same
 * stretch that switches it off.
 *
 * On 5 November 2026 two repositories were found in that state, and neither
 * the Steward nor the Actions tab said so. contextpassport/conformance-tests
 * had Conformance in disabled_inactivity and
 * contextpassport/verifiable-agent-template had CI in the same state, both
 * having stopped on their own after a last successful run. Run history makes
 * this worse rather than better: the most recent recorded run in both cases
 * succeeded, so every surface a maintainer would think to look at read as
 * healthy right up to the point where the suite stopped running. See #110.
 *
 * It mattered most in conformance-tests, because both of its jobs grade the
 * published packages rather than a local checkout. A release of
 * context-passport or @contextpassport/core breaking the vectors produces no
 * commit in that repository, so the scheduled run was the only thing watching.
 *
 * WHY_NOT_AN_ALLOWLIST_OF_OFF_STATES
 *
 * The Actions API documents state as one of active, deleted, disabled_fork,
 * disabled_inactivity or disabled_manually. The tempting rule is to flag the
 * three disabled_ values, and it is the wrong way round. A state this check
 * has never heard of would then read as healthy, which is the failure #95 was
 * about: a signal that went unmeasured was reported by being left out of the
 * report. So the rule is inverted. Exactly one state means the workflow runs,
 * and anything else is reported in the words the API used.
 *
 * WHY_AN_UNREADABLE_REPOSITORY_IS_A_FINDING
 *
 * Same lesson as #95, which is the one failure mode this file is most at risk
 * of repeating. If the workflow listing for a repository cannot be read, the
 * honest report is that it was not read. Swallowing the error would turn a
 * rate limit or a token scope problem into a clean bill of health for every
 * repository behind it, and the run would exit 0 having checked nothing.
 *
 * WHY_NO_WORKFLOWS_IS_ALSO_A_FINDING
 *
 * A repository carrying no workflows at all has nothing watching it, which is
 * the condition this check was written to surface. It is reported separately
 * from a disabled workflow because the remedy differs: one is switched back
 * on, the other has to be written.
 */

/** The one state in which a workflow actually runs. */
export const RUNNING_STATE = 'active';

/**
 * Describe a reading in the API's own words.
 *
 * A missing or empty state is reported as unknown rather than guessed at, for
 * the reason in WHY_NOT_AN_ALLOWLIST_OF_OFF_STATES.
 */
export const describeState = (state) =>
  (typeof state === 'string' && state.trim()) ? state.trim() : 'unknown';

/** Whether one reading still runs. */
export const isRunning = (reading) => describeState(reading?.state) === RUNNING_STATE;

export const CATEGORIES = ['off', 'unreadable', 'bare'];

export const HEADINGS = {
  off: 'These workflows are switched off',
  unreadable: 'These repositories could not be read',
  bare: 'These repositories have no workflows at all',
};

export const GUIDANCE = {
  off: 'A workflow in this state runs on no trigger, schedule included. Enabling it again is a manual step, and a merge does not do it.',
  unreadable: 'Nothing was checked for these, so nothing below speaks for them. The listing has to be read before the rest of this report means anything.',
  bare: 'Nothing here is watching for a break. These need a workflow written, not switched on.',
};

/**
 * Sort key for stable output: repository first, then workflow name, so two
 * runs over unchanged state produce identical reports and a diff between runs
 * shows only what moved.
 */
const byRepoThenName = (a, b) =>
  a.repo.localeCompare(b.repo) || String(a.name || '').localeCompare(String(b.name || ''));

/**
 * Judge a list of per repository readings.
 *
 * Each reading is { repo, workflows } for a listing that was read, or
 * { repo, error } for one that was not. `workflows` entries carry whatever the
 * API gave: { name, state, path }.
 *
 * Returns a Map keyed by CATEGORIES, in that order, so the reporting half can
 * walk it the way steward-check.mjs walks its own groups.
 */
export function reviewWorkflowStates(readings = []) {
  const groups = new Map(CATEGORIES.map((c) => [c, []]));

  for (const reading of readings) {
    const repo = reading?.repo || '';

    if (reading?.error) {
      groups.get('unreadable').push({ repo, reason: String(reading.error) });
      continue;
    }

    const workflows = Array.isArray(reading?.workflows) ? reading.workflows : [];
    if (workflows.length === 0) {
      groups.get('bare').push({ repo });
      continue;
    }

    for (const workflow of workflows) {
      if (isRunning(workflow)) continue;
      groups.get('off').push({
        repo,
        name: workflow?.name || '(unnamed)',
        path: workflow?.path || '',
        state: describeState(workflow?.state),
      });
    }
  }

  groups.get('off').sort(byRepoThenName);
  groups.get('unreadable').sort((a, b) => a.repo.localeCompare(b.repo));
  groups.get('bare').sort((a, b) => a.repo.localeCompare(b.repo));
  return groups;
}

/** Total findings across every category. */
export const countFindings = (groups) =>
  CATEGORIES.reduce((n, c) => n + (groups.get(c)?.length || 0), 0);
