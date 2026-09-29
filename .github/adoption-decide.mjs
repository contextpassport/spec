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
