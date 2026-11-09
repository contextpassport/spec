/**
 * The repositories the Steward watches, in one place.
 *
 * This list was duplicated, byte for byte, in adoption-check.mjs and
 * steward-check.mjs, and the automation check added a third reader. Three
 * copies of the set of repositories under watch is a set that eventually
 * disagrees with itself, and the failure would be silent in the worst
 * direction: a repository dropped from one copy is simply never checked by
 * that script, and nothing reports a repository it was never told about.
 *
 * The same reasoning is already written down in workflows/steward.yml, about
 * REPOS set in the workflow silently overriding the scripts. This is that
 * argument applied one level down.
 *
 * REPOS and REPO remain supported for running any of the scripts by hand
 * against a subset, which is the only reason the override exists.
 */

export const DEFAULT_REPOS = [
  'contextpassport/spec',
  'contextpassport/python',
  'contextpassport/typescript',
  'contextpassport/conformance-tests',
  'contextpassport/verifiable-agent-template',
  'contextpassport/tinker-provenance',
];

/**
 * The repositories to scan: REPOS or REPO when either is set, otherwise the
 * default list. Whitespace separated, empty entries dropped.
 */
export function reposFromEnv(env = process.env) {
  return (env.REPOS || env.REPO || DEFAULT_REPOS.join(' '))
    .split(/\s+/)
    .filter(Boolean);
}
