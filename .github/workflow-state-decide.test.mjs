/**
 * Tests for the automation check's decision logic.
 *
 * These run with no network and no gh CLI, which is why the rules were split
 * out of workflow-state-check.mjs. The cases that matter most are the two the
 * check exists to stop repeating:
 *
 *   "a state this check has never heard of is reported, not passed"  (#95)
 *   "a repository whose listing failed is reported as unread"        (#95)
 *
 * and the real reading that started it, in "the November 2026 state of the
 * org is reported as two switched off workflows" (#110).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  reviewWorkflowStates, countFindings, isRunning, describeState,
  CATEGORIES, HEADINGS, GUIDANCE, RUNNING_STATE,
} from './workflow-state-decide.mjs';

const wf = (over = {}) => ({
  name: 'CI', state: 'active', path: '.github/workflows/ci.yml', ...over,
});

test('an active workflow is not a finding', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', workflows: [wf()] },
  ]);
  assert.equal(countFindings(groups), 0);
});

test('disabled_inactivity is reported, in the API\'s own words', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', workflows: [wf({ state: 'disabled_inactivity' })] },
  ]);
  const off = groups.get('off');
  assert.equal(off.length, 1);
  assert.equal(off[0].state, 'disabled_inactivity');
  assert.equal(off[0].repo, 'org/a');
  assert.equal(off[0].name, 'CI');
});

test('disabled_manually and disabled_fork are reported too', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', workflows: [wf({ name: 'M', state: 'disabled_manually' })] },
    { repo: 'org/b', workflows: [wf({ name: 'F', state: 'disabled_fork' })] },
  ]);
  assert.deepEqual(groups.get('off').map((o) => o.state),
    ['disabled_manually', 'disabled_fork']);
});

// The #95 lesson, inverted rule. A new state must not read as healthy.
test('a state this check has never heard of is reported, not passed', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', workflows: [wf({ state: 'disabled_by_some_future_rule' })] },
  ]);
  assert.equal(groups.get('off').length, 1);
  assert.equal(groups.get('off')[0].state, 'disabled_by_some_future_rule');
});

test('a missing or blank state is reported as unknown rather than guessed at', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', workflows: [{ name: 'X' }] },
    { repo: 'org/b', workflows: [wf({ name: 'Y', state: '   ' })] },
  ]);
  assert.deepEqual(groups.get('off').map((o) => o.state), ['unknown', 'unknown']);
});

// The other #95 lesson. A failed read is a finding, never a clean bill.
test('a repository whose listing failed is reported as unread', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', error: 'HTTP 429 rate limited' },
    { repo: 'org/b', workflows: [wf()] },
  ]);
  assert.equal(groups.get('unreadable').length, 1);
  assert.equal(groups.get('unreadable')[0].repo, 'org/a');
  assert.match(groups.get('unreadable')[0].reason, /429/);
  assert.equal(countFindings(groups), 1);
});

test('an unreadable repository is not also counted as bare', () => {
  const groups = reviewWorkflowStates([{ repo: 'org/a', error: 'boom' }]);
  assert.equal(groups.get('bare').length, 0);
  assert.equal(groups.get('unreadable').length, 1);
});

test('a repository with no workflows is reported separately from a disabled one', () => {
  const groups = reviewWorkflowStates([
    { repo: 'org/a', workflows: [] },
    { repo: 'org/b', workflows: [wf({ state: 'disabled_inactivity' })] },
  ]);
  assert.deepEqual(groups.get('bare').map((b) => b.repo), ['org/a']);
  assert.deepEqual(groups.get('off').map((o) => o.repo), ['org/b']);
  assert.equal(countFindings(groups), 2);
});

test('a repository reporting neither workflows nor an error counts as bare', () => {
  const groups = reviewWorkflowStates([{ repo: 'org/a' }]);
  assert.deepEqual(groups.get('bare').map((b) => b.repo), ['org/a']);
});

test('one repository can contribute more than one switched off workflow', () => {
  const groups = reviewWorkflowStates([
    {
      repo: 'org/a',
      workflows: [
        wf({ name: 'CI', state: 'disabled_inactivity' }),
        wf({ name: 'Nightly', state: 'disabled_manually' }),
        wf({ name: 'Release', state: 'active' }),
      ],
    },
  ]);
  assert.deepEqual(groups.get('off').map((o) => o.name), ['CI', 'Nightly']);
});

test('output is sorted by repository then workflow name, so two runs match', () => {
  const readings = [
    { repo: 'org/z', workflows: [wf({ name: 'B', state: 'off_a' })] },
    { repo: 'org/a', workflows: [wf({ name: 'Z', state: 'off_b' }), wf({ name: 'A', state: 'off_c' })] },
  ];
  const first = reviewWorkflowStates(readings).get('off').map((o) => `${o.repo}:${o.name}`);
  const second = reviewWorkflowStates([...readings].reverse()).get('off').map((o) => `${o.repo}:${o.name}`);
  assert.deepEqual(first, ['org/a:A', 'org/a:Z', 'org/z:B']);
  assert.deepEqual(first, second);
});

test('an empty reading list is no findings rather than an error', () => {
  const groups = reviewWorkflowStates([]);
  assert.equal(countFindings(groups), 0);
  assert.deepEqual([...groups.keys()], CATEGORIES);
});

test('a missing reading list is no findings rather than a crash', () => {
  assert.equal(countFindings(reviewWorkflowStates()), 0);
});

test('every category carries a heading and a line of guidance', () => {
  for (const c of CATEGORIES) {
    assert.ok(HEADINGS[c], `no heading for ${c}`);
    assert.ok(GUIDANCE[c], `no guidance for ${c}`);
  }
});

test('isRunning and describeState agree on the one running state', () => {
  assert.equal(RUNNING_STATE, 'active');
  assert.ok(isRunning({ state: 'active' }));
  assert.ok(!isRunning({ state: 'disabled_inactivity' }));
  assert.ok(!isRunning({}));
  assert.ok(!isRunning(undefined));
  assert.equal(describeState('  active  '), 'active');
  assert.equal(describeState(null), 'unknown');
  assert.equal(describeState(7), 'unknown');
});

// The reading that started this, from #110, as a regression guard.
test('the November 2026 state of the org is reported as two switched off workflows', () => {
  const groups = reviewWorkflowStates([
    { repo: 'contextpassport/spec', workflows: [wf({ name: 'Spec CI' }), wf({ name: 'Steward' })] },
    { repo: 'contextpassport/python', workflows: [wf()] },
    { repo: 'contextpassport/typescript', workflows: [wf()] },
    { repo: 'contextpassport/conformance-tests', workflows: [wf({ name: 'Conformance', state: 'disabled_inactivity' })] },
    { repo: 'contextpassport/verifiable-agent-template', workflows: [wf({ state: 'disabled_inactivity' })] },
    { repo: 'contextpassport/tinker-provenance', workflows: [wf()] },
  ]);
  assert.equal(countFindings(groups), 2);
  assert.deepEqual(groups.get('off').map((o) => `${o.repo} ${o.name}`), [
    'contextpassport/conformance-tests Conformance',
    'contextpassport/verifiable-agent-template CI',
  ]);
});
