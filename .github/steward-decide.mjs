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
 * WHY_NOT_JUST_ACTIVITY below before changing any of this.
 */

export const CATEGORIES = ['unanswered', 'approved_unmerged', 'stalled'];

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

const DAY_MS = 86400000;

export const isBot = (login = '') =>
  login.endsWith('[bot]') || /(^|-)(bot|dependabot|renovate)$/i.test(login);

export const daysBetween = (iso, now) => (now.getTime() - new Date(iso).getTime()) / DAY_MS;

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
export function classify(item, responders, { maintainers, graceDays, now }) {
  const isMaintainer = (login = '') => maintainers.includes(login.toLowerCase());

  const author = item.author?.login || '';
  if (!author || isMaintainer(author) || isBot(author)) return null;

  const age = daysBetween(item.createdAt, now);
  if (age < graceDays) return null;

  const replied = responders.some(isMaintainer);
  if (!replied) return { category: 'unanswered', age, idle: age };

  // Answered. The question is now whether answering led anywhere.
  const idle = item.updatedAt ? daysBetween(item.updatedAt, now) : age;

  // Approved and still open is a merge that did not happen. Deliberately not
  // conditioned on idle time: see WHY_NOT_JUST_ACTIVITY. CHANGES_REQUESTED is
  // excluded because the ball is then with the contributor, and an approval
  // that arrives later moves the item into this rule on its own.
  if (item.kind === 'pull request' && item.reviewDecision === 'APPROVED') {
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
};

export const GUIDANCE = {
  unanswered: 'A first reply is the whole ask here.',
  approved_unmerged:
    'The review already said yes. Merging, or saying what merging is waiting on, is what moves these.',
  stalled: 'These went quiet after a reply. They need a decision or a close, not another comment.',
};
