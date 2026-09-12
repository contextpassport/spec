/**
 * Tests for the contribution check's decision logic.
 *
 * These run with no network and no gh CLI, which is the reason the rules were
 * split out of steward-check.mjs. The case that matters most is
 * "approved_unmerged catches a thread its own reviewer keeps bumping", because
 * that is the situation the previous version of this check reported as healthy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, triage, isBot, CATEGORIES } from './steward-decide.mjs';

const NOW = new Date('2026-09-12T12:00:00Z');
const OPTS = { maintainers: ['bengunvl'], graceDays: 7, now: NOW };

const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const pr = (over = {}) => ({
  kind: 'pull request',
  number: 1,
  title: 'a contribution',
  url: 'https://example.invalid/1',
  repo: 'contextpassport/spec',
  author: { login: 'outsider' },
  createdAt: daysAgo(10),
  updatedAt: daysAgo(10),
  reviewDecision: '',
  ...over,
});

const issue = (over = {}) => {
  const { reviewDecision, ...rest } = pr(over);
  return { ...rest, kind: 'issue' };
};

test('an outside item nobody answered is unanswered once past the grace period', () => {
  const v = classify(pr(), [], OPTS);
  assert.equal(v.category, 'unanswered');
});

test('inside the grace period nothing is reported, however quiet', () => {
  const v = classify(pr({ createdAt: daysAgo(3), updatedAt: daysAgo(3) }), [], OPTS);
  assert.equal(v, null);
});

test("a maintainer's own item is never reported", () => {
  assert.equal(classify(pr({ author: { login: 'bengunvl' } }), [], OPTS), null);
  assert.equal(classify(pr({ author: { login: 'BenGunvl' } }), [], OPTS), null);
});

test('bots are not contributors', () => {
  assert.equal(classify(pr({ author: { login: 'dependabot[bot]' } }), [], OPTS), null);
  assert.equal(classify(pr({ author: { login: 'renovate' } }), [], OPTS), null);
  assert.ok(isBot('some-bot'));
  assert.ok(!isBot('bengunvl'));
});

test('a reply from a non-maintainer does not count as an answer', () => {
  const v = classify(pr(), ['another-outsider'], OPTS);
  assert.equal(v.category, 'unanswered');
});

// The regression this change exists for.
test('approved and unmerged is reported even when a reviewer just commented', () => {
  // spec#70 on 12 September 2026: open twelve days, five approving reviews,
  // updatedAt two days old because the most recent review had just landed.
  const v = classify(
    pr({ createdAt: daysAgo(12), updatedAt: daysAgo(2), reviewDecision: 'APPROVED' }),
    ['bengunvl'],
    OPTS,
  );
  assert.equal(v.category, 'approved_unmerged');
  assert.ok(v.age >= 12);
  assert.ok(v.idle < OPTS.graceDays, 'the point is that idle time alone would have missed this');
});

test('an idle-time rule alone would have missed that case', () => {
  // Same item, asking only the question the old check could ask.
  const item = pr({ createdAt: daysAgo(12), updatedAt: daysAgo(2), reviewDecision: 'APPROVED' });
  const idle = (NOW - new Date(item.updatedAt)) / 86400000;
  assert.ok(idle < OPTS.graceDays);
});

test('changes requested is the contributor\'s turn, not a neglected merge', () => {
  const v = classify(
    pr({ createdAt: daysAgo(12), updatedAt: daysAgo(2), reviewDecision: 'CHANGES_REQUESTED' }),
    ['bengunvl'],
    OPTS,
  );
  assert.equal(v, null);
});

test('changes requested that then goes silent is still caught as stalled', () => {
  const v = classify(
    pr({ createdAt: daysAgo(40), updatedAt: daysAgo(30), reviewDecision: 'CHANGES_REQUESTED' }),
    ['bengunvl'],
    OPTS,
  );
  assert.equal(v.category, 'stalled');
});

test('an answered thread that goes still is stalled', () => {
  const v = classify(issue({ createdAt: daysAgo(30), updatedAt: daysAgo(20) }), ['bengunvl'], OPTS);
  assert.equal(v.category, 'stalled');
});

test('an answered thread still in active back and forth is quiet', () => {
  const v = classify(issue({ createdAt: daysAgo(30), updatedAt: daysAgo(1) }), ['bengunvl'], OPTS);
  assert.equal(v, null);
});

test('issues are never reported as approved_unmerged', () => {
  const v = classify(
    issue({ createdAt: daysAgo(12), updatedAt: daysAgo(1), reviewDecision: 'APPROVED' }),
    ['bengunvl'],
    OPTS,
  );
  assert.equal(v, null);
});

test('unanswered wins over the other two when nobody has replied at all', () => {
  const v = classify(
    pr({ createdAt: daysAgo(40), updatedAt: daysAgo(40), reviewDecision: 'APPROVED' }),
    [],
    OPTS,
  );
  assert.equal(v.category, 'unanswered');
});

test('a missing updatedAt falls back to age rather than throwing', () => {
  const v = classify(issue({ createdAt: daysAgo(30), updatedAt: undefined }), ['bengunvl'], OPTS);
  assert.equal(v.category, 'stalled');
});

test('triage groups by category and sorts each group oldest first', () => {
  const items = [
    pr({ number: 1, createdAt: daysAgo(9), updatedAt: daysAgo(9) }),
    pr({ number: 2, createdAt: daysAgo(30), updatedAt: daysAgo(30) }),
    pr({ number: 3, createdAt: daysAgo(12), updatedAt: daysAgo(2), reviewDecision: 'APPROVED' }),
    pr({ number: 4, author: { login: 'bengunvl' } }),
  ];
  const replied = new Set([3]);
  const groups = triage(items, (i) => (replied.has(i.number) ? ['bengunvl'] : []), OPTS);

  assert.deepEqual(groups.get('unanswered').map((i) => i.number), [2, 1]);
  assert.deepEqual(groups.get('approved_unmerged').map((i) => i.number), [3]);
  assert.deepEqual(groups.get('stalled').map((i) => i.number), []);
  assert.deepEqual([...groups.keys()], CATEGORIES);
});

test('a healthy set produces no findings at all', () => {
  const items = [
    pr({ number: 1, createdAt: daysAgo(2), updatedAt: daysAgo(1) }),
    pr({ number: 2, author: { login: 'bengunvl' }, createdAt: daysAgo(90) }),
    issue({ number: 3, createdAt: daysAgo(30), updatedAt: daysAgo(1) }),
  ];
  const groups = triage(items, () => ['bengunvl'], OPTS);
  assert.equal(CATEGORIES.reduce((n, c) => n + groups.get(c).length, 0), 0);
});
