/**
 * The parts of the adoption check that can be decided without a network call.
 *
 * Split out for the same reason steward-decide.mjs was: adoption-check.mjs
 * runs four code searches and writes a state file, so nothing in it could be
 * tested. The two things most worth testing are exactly the two that broke in
 * #89, and neither needs GitHub:
 *
 *   parseBackoffSeconds  reads the wait GitHub asks for out of gh's error text
 *   reportLines          decides what a signal looks like when it was NOT
 *                        measured, which is the whole bug
 *
 * #89 in one sentence: four rate-limited searches were reported by being left
 * out of the report, so the run printed a complete-looking list of forks and
 * stars, said "No change.", and exited 0 without having evaluated a single
 * code query. A reader could only have caught it by counting the lines they
 * expected against the lines that were there.
 */

/**
 * Pull the retry delay out of a gh error. On a 429 gh prints, to stderr:
 *
 *   gh: try again in 583.022129304s (HTTP 429)
 *
 * Returns whole seconds rounded up, or null when the text carries no such
 * wait. Rounded up rather than down so we never wake a hair early and spend
 * the retry on the same closed window.
 */
export function parseBackoffSeconds(text) {
  if (!text) return null;
  const m = /try again in ([0-9]+(?:\.[0-9]+)?)s/i.exec(String(text));
  if (!m) return null;
  const seconds = Number(m[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds);
}

/**
 * One line per signal, for every signal that was supposed to be measured.
 *
 * `skipped` names the signals whose query could not be evaluated. They are
 * printed as `unknown (search failed)` rather than omitted. Omitting them is
 * what made a report covering two signals look like a report covering six.
 */
export function reportLines({ names, current, before = {}, skipped = [] }) {
  const missing = new Set(skipped);
  return names.map((k) => {
    const label = k.padEnd(12);
    if (missing.has(k)) {
      const was = before[k];
      const known = was === undefined ? '' : `  (last known ${was})`;
      return `  ${label} ${'unknown'.padStart(5)}  search failed${known}`;
    }
    const v = current[k];
    const was = before[k];
    const delta =
      was === undefined ? '' : v > was ? `  (up from ${was})` : v < was ? `  (down from ${was})` : '';
    return `  ${label} ${String(v).padStart(5)}${delta}`;
  });
}

/**
 * What to say when nothing rose.
 *
 * The plain "No change." is reserved for a run that actually looked at
 * everything. When a signal was skipped, a run must not be able to report
 * nothing changed about a thing it did not check, so it says which ones it
 * could not see instead. It stays exit 0 either way: a transient upstream 429
 * is not adoption news, and failing the run on one is the cry-wolf pattern
 * this repository has already walked back three times (see #89, option 2).
 */
export function noChangeLines(skipped = []) {
  if (skipped.length === 0) return { lines: ['', 'No change.', ''], complete: true };
  return {
    complete: false,
    lines: [
      '',
      `No change in the signals that were measured. ${skipped.length} ${
        skipped.length === 1 ? 'was' : 'were'
      } not measured:`,
      `  ${skipped.join(', ')}`,
      '',
      'This run says nothing about those, and their baselines are untouched.',
      'The next run re-checks them.',
      '',
    ],
  };
}

/**
 * Whether to take a second pass over the signals the first pass could not
 * measure, and how long to settle first.
 *
 * The first pass already retries a rate-limited query in place, after the back
 * off GitHub names. That retry cannot absorb what GitHub is actually naming:
 * the waits observed in the wild are 583s (#89) and 735s (#95), and both are
 * at or beyond the cap a single query is allowed to wait. So the in-place
 * retry declines, and the signal is reported unknown.
 *
 * What did work, twice, was coming back a couple of minutes later: the manual
 * re-dispatch in #95 read three of the four signals the scheduled run could
 * not. That is the whole basis for this. The quota is per token and partly
 * spent when the job starts, so the window reopens on its own clock rather
 * than on the one the 429 advertises, and the advertised figure is the worst
 * case rather than the wait that is actually needed.
 *
 * A second pass is therefore cheap in the only way that matters: it costs a
 * fixed settle plus one call per unmeasured signal, and it is the difference
 * between a weekly tripwire that reads `records` and one that does not.
 *
 * It declines in two cases, both so that waiting cannot pile onto waiting:
 *
 *   nothing skipped  the first pass measured everything, so there is nothing
 *                    to come back for.
 *   budget spent     the first pass already sat through its total back off
 *                    allowance. A run that has waited fifteen minutes is in a
 *                    quota window that a further minute will not reopen, and
 *                    sitting there longer is worse than the gap it closes.
 *
 * Returns the signals to retry, in the order they were skipped, and the
 * seconds to wait before starting. Deciding this here rather than inline is
 * the same split the rest of this file exists for: the rule is testable, the
 * sleeping and the searching are not.
 */
export function planSecondPass({
  skipped = [],
  backoffSpent = 0,
  maxTotalBackoffSeconds = Infinity,
  settleSeconds = 60,
} = {}) {
  if (skipped.length === 0) {
    return { retry: [], waitSeconds: 0, reason: 'everything was measured on the first pass' };
  }
  if (backoffSpent >= maxTotalBackoffSeconds) {
    return {
      retry: [],
      waitSeconds: 0,
      reason: `this run already spent its ${maxTotalBackoffSeconds}s of waiting`,
    };
  }
  return {
    retry: [...skipped],
    waitSeconds: settleSeconds,
    reason: `${skipped.length} signal(s) went unmeasured`,
  };
}

/**
 * The signals still unmeasured after a second pass.
 *
 * Trivial on its own, and here on purpose. #89 was not a failure to retry, it
 * was a failure to carry the skip list into the report truthfully, and a
 * second pass that recovered a signal without taking it off this list would
 * reproduce that bug from the other side: the run would hold a real count and
 * still print `unknown` over it. Order is preserved so the summary names the
 * remaining gaps the way the run met them.
 */
export function remainingSkipped(skipped = [], recovered = []) {
  const done = new Set(recovered);
  return skipped.filter((name) => !done.has(name));
}
