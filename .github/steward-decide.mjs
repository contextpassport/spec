/**
 * The decision logic for the contribution check, separated from the network.
 *
 * This file holds every rule about what counts as a neglected contribution and
 * nothing about how to fetch one. That split exists so the rules can be tested
 * against fixed inputs, which matters more here than in most places: this is
 * the code that decides what lands in the owner's inbox, and a change to it
 * has twice had to be walked back after it cried wolf (#67, #76). Rules that
 * can only be reasoned about get reasoned about wrongly.
 *
 * Three shapes of neglect, each asking a different question of the maintainer.
 *
 *   unanswered         Nobody has replied at all.
 *   approved_unmerged  Someone reviewed it, said yes, and then nothing.
 *   stalled            It was answered and the thread has since gone still.
 *
 * The middle rule is the one that exists because the other two missed. See
 * WHY_NOT_JUST_ACTIVITY below before changing any of this, and
 * WHY_NOT_REVIEW_DECISION_ALONE before trusting `reviewDecision`.
 */

export const CATEGORIES = [
  'unanswered', 'approved_unmerged', 'stalled', 'maintainer_unmerged',
];

/**
 * The first three ask something of the maintainer on someone else's behalf.
 * The fourth is his own backlog. The reporting half needs to tell them apart,
 * because "these decay from neglect" is true of a contributor and not of a
 * pull request its own author can merge whenever he likes.
 */
export const OUTSIDE_CATEGORIES = ['unanswered', 'approved_unmerged', 'stalled'];

/**
 * WHY_NOT_JUST_ACTIVITY
 *
 * The obvious second rule is "nothing has happened for GRACE_DAYS", read off
 * the item's updatedAt. It does not work, and the reason is worth keeping.
 *
 * updatedAt is reset by any activity, including a maintainer's own comment. So
 * a reviewer who keeps posting on a pull request they never merge keeps
 * resetting the clock on the check that is supposed to notice they never
 * merged it. On 12 September 2026 spec#70 had been open twelve days, carried
 * five approving reviews, and had not moved; its updatedAt was two days old,
 * because the most recent of those reviews had just been posted. An idle-time
 * rule would have called it healthy.
 *
 * That is the failure mode in miniature: an instrument that counts words reads
 * a stalled thread as busy so long as somebody keeps talking on it. So the
 * rule that catches this case reads the outcome instead. A pull request from
 * outside that has been approved and is still open is waiting on a merge, and
 * no amount of further discussion changes that or silences it.
 *
 * The idle-time rule is still here, as `stalled`. It is the right instrument
 * for a different question, namely a thread that genuinely went quiet, and it
 * is the only one of the three that covers issues as well as pull requests.
 */

/**
 * WHY_MAINTAINER_PULL_REQUESTS
 *
 * The three rules above all drop maintainer-authored items before any rule
 * runs, and for an outside contribution that is right: the question each one
 * asks is whether somebody who does not have the merge button has been left
 * waiting. A maintainer is never waiting on himself for a reply.
 *
 * That filter went wrong when the maintainer list had one name on it and that
 * name wrote every open pull request. On 6 October 2026 the check reported
 * "nothing is waiting on a reply, a merge, or a decision" across six open pull
 * requests, the oldest three open since 29 August, one of them the fix for a
 * canonicalization divergence already published to PyPI and npm. Every line of
 * that report was true under the check's own definition and the project was
 * still sitting on a 40 day stall. See #97.
 *
 * So maintainer-authored work gets one rule of its own, and it is deliberately
 * the dullest one available: a pull request he opened, still open past the
 * grace period. No reply rule, because a reply from himself proves nothing. No
 * approval rule, because nobody else reviews these and waiting for an approval
 * that is not coming is how the stall happened. Open and old is the whole test.
 *
 * Issues are excluded, and that exclusion is what keeps this from crying wolf
 * the way #67 and #76 did. A maintainer's own issue is a note about work not
 * yet done, which is what an issue tracker is for; flagging those would report
 * the entire backlog every Monday until it was closed, and a check that always
 * fails is a check nobody reads. A pull request is different in kind. It is
 * finished work, already written and already green, held up only by the merge
 * nobody else can perform, and the cost of leaving it open is that the tree it
 * was cut from keeps moving underneath it.
 */

/**
 * WHY_NOT_REVIEW_DECISION_ALONE
 *
 * `reviewDecision` is the obvious field for "has this been approved", and it
 * is a trap here. GitHub only computes it when the base branch actually
 * requires review. This organisation's `main-branch-protection` ruleset sets
 * `required_approving_review_count: 0` and `require_code_owner_review: false`,
 * so there is no review requirement and the field comes back null on every
 * pull request in these repositories, approved or not.
 *
 * Read against real data on 19 September 2026, spec#70 was 19 days old with a
 * standing approval from the only maintainer, and spec#74 was 15 days old in
 * the same state. Both had an `updatedAt` four days old, because a maintainer
 * comment had just reset it. A rule keyed on `reviewDecision === "APPROVED"`
 * flags neither, and `stalled` does not reach them either. The check would
 * have gone on reporting the exact two pull requests it was written to catch
 * as healthy.
 *
 * So approval is derived from the reviews themselves: the latest review state
 * per reviewer, ignoring COMMENTED, which does not change an approval and is
 * what a reviewer leaves when they post an update. `reviewDecision` is still
 * honoured when present, so this stays correct if review is ever required.
 */

const DAY_MS = 86400000;

export const isBot = (login = '') =>
  login.endsWith('[bot]') || /(^|-)(bot|dependabot|renovate)$/i.test(login);

export const daysBetween = (iso, now) => (now.getTime() - new Date(iso).getTime()) / DAY_MS;

/**
 * Activity may arrive as a plain array of logins, which is all the older rules
 * needed, or as { logins, approvedBy } once approval is derived from reviews.
 */
export function normalizeActivity(activity) {
  if (Array.isArray(activity)) return { logins: activity, approvedBy: [] };
  return { logins: activity?.logins ?? [], approvedBy: activity?.approvedBy ?? [] };
}

/**
 * The latest review state per reviewer, ignoring COMMENTED. Reviews must be in
 * the order the API returns them, which is chronological.
 */
export function approversFromReviews(reviews = []) {
  const latest = new Map();
  for (const { login, state } of reviews) {
    if (!login || !state || state === 'COMMENTED') continue;
    latest.set(login, state);
  }
  return [...latest].filter(([, state]) => state === 'APPROVED').map(([login]) => login);
}

/**
 * Decide whether one item is a neglected contribution, and if so which shape.
 *
 * `item` carries what the listing gives us: author, createdAt, updatedAt, kind
 * and, for pull requests, reviewDecision. `responders` is the set of logins
 * who have commented or reviewed. Everything needed for a verdict is an
 * argument, so a caller can construct any situation without touching GitHub.
 *
 * Returns null when the item is fine, otherwise { category, age, idle }.
 */
export function classify(item, activity, { maintainers, graceDays, now }) {
  const isMaintainer = (login = '') => maintainers.includes(login.toLowerCase());
  const { logins, approvedBy } = normalizeActivity(activity);

  const author = item.author?.login || '';
  if (!author || isBot(author)) return null;

  const age = daysBetween(item.createdAt, now);
  if (age < graceDays) return null;

  const idleOrAge = () => (item.updatedAt ? daysBetween(item.updatedAt, now) : age);

  // The maintainer's own backlog, on the one rule that cannot cry wolf:
  // a pull request he opened and has not merged. See WHY_MAINTAINER_PULL_REQUESTS.
  if (isMaintainer(author)) {
    if (item.kind !== 'pull request') return null;
    return { category: 'maintainer_unmerged', age, idle: idleOrAge() };
  }

  const replied = logins.some(isMaintainer);
  if (!replied) return { category: 'unanswered', age, idle: age };

  // Answered. The question is now whether answering led anywhere.
  const idle = idleOrAge();

  // Approved and still open is a merge that did not happen. Deliberately not
  // conditioned on idle time: see WHY_NOT_JUST_ACTIVITY. CHANGES_REQUESTED is
  // excluded because the ball is then with the contributor, and an approval
  // that arrives later moves the item into this rule on its own.
  // reviewDecision is null wherever review is not required, so a standing
  // approval read off the reviews counts too. See WHY_NOT_REVIEW_DECISION_ALONE.
  const approved =
    item.reviewDecision === 'APPROVED' || approvedBy.some(isMaintainer);
  const changesRequested = item.reviewDecision === 'CHANGES_REQUESTED';
  if (item.kind === 'pull request' && approved && !changesRequested) {
    return { category: 'approved_unmerged', age, idle };
  }

  if (idle >= graceDays) return { category: 'stalled', age, idle };

  return null;
}

/**
 * Apply `classify` across a list, returning the flagged items grouped by
 * category in the order given by CATEGORIES.
 */
export function triage(items, responderLookup, opts) {
  const found = [];
  for (const item of items) {
    const verdict = classify(item, responderLookup(item), opts);
    if (verdict) found.push({ ...item, ...verdict, author: item.author?.login || '' });
  }
  const groups = new Map(CATEGORIES.map((c) => [c, []]));
  for (const f of found) groups.get(f.category).push(f);
  for (const list of groups.values()) list.sort((a, b) => b.age - a.age);
  return groups;
}

export const HEADINGS = {
  unanswered: 'Nobody has answered these',
  approved_unmerged: 'These were approved and not merged',
  stalled: 'These were answered and then left',
  maintainer_unmerged: 'These are your own, still open',
};

export const GUIDANCE = {
  unanswered: 'A first reply is the whole ask here.',
  approved_unmerged:
    'The review already said yes. Merging, or saying what merging is waiting on, is what moves these.',
  stalled: 'These went quiet after a reply. They need a decision or a close, not another comment.',
  maintainer_unmerged:
    'Nobody else can merge these. Merging, closing, or writing down what each one is waiting on is what moves them.',
};
