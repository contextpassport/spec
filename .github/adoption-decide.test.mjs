/**
 * Tests for the adoption check's decision logic.
 *
 * No network and no gh CLI, which is why these rules were split out of
 * adoption-check.mjs. The case that matters most is "a skipped signal is
 * reported, not omitted", because that is the exact situation the previous
 * version reported as a complete run with nothing to see (#89).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBackoffSeconds, reportLines, noChangeLines } from './adoption-decide.mjs';

const NAMES = ['records', 'python', 'typescript', 'tinker', 'forks_spec', 'stars_spec'];

test('parseBackoffSeconds reads the wait out of a real gh 429', () => {
  assert.equal(parseBackoffSeconds('gh: try again in 583.022129304s (HTTP 429)'), 584);
});

test('parseBackoffSeconds rounds up, so the retry never wakes into the same closed window', () => {
  assert.equal(parseBackoffSeconds('try again in 0.4s'), 1);
  assert.equal(parseBackoffSeconds('try again in 89s'), 89);
});

test('parseBackoffSeconds finds the wait among the other lines gh prints', () => {
  const text = 'some preamble\ngh: try again in 111.336910316s (HTTP 429)\nexit status 1';
  assert.equal(parseBackoffSeconds(text), 112);
});

test('parseBackoffSeconds returns null when there is no wait to honour', () => {
  assert.equal(parseBackoffSeconds('gh: HTTP 403 Forbidden'), null);
  assert.equal(parseBackoffSeconds(''), null);
  assert.equal(parseBackoffSeconds(null), null);
  assert.equal(parseBackoffSeconds(undefined), null);
});

test('a measured signal prints its count, and its movement against the baseline', () => {
  const lines = reportLines({
    names: ['records', 'forks_spec'],
    current: { records: 1, forks_spec: 5 },
    before: { records: 0, forks_spec: 5 },
  });
  assert.match(lines[0], /records\s+1\s+\(up from 0\)/);
  assert.match(lines[1], /forks_spec\s+5$/);
});

test('a falling count is shown as falling', () => {
  const [line] = reportLines({
    names: ['forks_spec'],
    current: { forks_spec: 4 },
    before: { forks_spec: 5 },
  });
  assert.match(line, /\(down from 5\)/);
});

// The regression. Before #89 a skipped signal was left out of the report
// entirely, so this list would have been two lines long and looked whole.
test('a skipped signal is reported as unknown, not omitted', () => {
  const lines = reportLines({
    names: NAMES,
    current: { forks_spec: 5, stars_spec: 2 },
    before: { records: 0, python: 0, typescript: 0, tinker: 0, forks_spec: 5, stars_spec: 2 },
    skipped: ['records', 'python', 'typescript', 'tinker'],
  });
  assert.equal(lines.length, NAMES.length, 'every signal gets a line');
  const text = lines.join('\n');
  for (const name of ['records', 'python', 'typescript', 'tinker']) {
    assert.match(text, new RegExp(`${name}\\s+unknown\\s+search failed`));
  }
});

test('a skipped signal shows its last known value, so the baseline is not mistaken for gone', () => {
  const [line] = reportLines({
    names: ['records'],
    current: {},
    before: { records: 3 },
    skipped: ['records'],
  });
  assert.match(line, /unknown\s+search failed\s+\(last known 3\)/);
});

test('a skipped signal with no baseline says nothing it cannot support', () => {
  const [line] = reportLines({ names: ['records'], current: {}, before: {}, skipped: ['records'] });
  assert.match(line, /unknown\s+search failed$/);
});

test('a run that measured everything and found nothing says so plainly', () => {
  const { lines, complete } = noChangeLines([]);
  assert.equal(complete, true);
  assert.equal(lines.join('\n').trim(), 'No change.');
});

// The other half of #89: the run printed "No change." about signals it had not
// looked at. It must not be able to claim that again.
test('a run with a gap in it does not claim nothing changed', () => {
  const { lines, complete } = noChangeLines(['records', 'python']);
  assert.equal(complete, false);
  const text = lines.join('\n');
  assert.doesNotMatch(text, /^No change\.$/m);
  assert.match(text, /2 were not measured/);
  assert.match(text, /records, python/);
});

test('one skipped signal reads as one, not as 1 were', () => {
  const text = noChangeLines(['records']).lines.join('\n');
  assert.match(text, /1 was not measured/);
});
