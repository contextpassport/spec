# Adopt RFC 8785 (JSON Canonicalization Scheme) in v2.0

**Status:** Proposal, draft
**Target version:** Context Passport 2.0
**Authors:** Context Passport maintainers
**Companion to:** [SPEC.md §3.4](../SPEC.md#34-integrity-computation), [docs/migration-and-versioning.md](../docs/migration-and-versioning.md)

---

## Problem

The v1.x canonical-JSON algorithm (SPEC.md §3.4.1) is defined by analogy to each language's default JSON serializer. This produces byte-equivalent output across implementations for the common case but diverges in three known cases:

1. Non-ASCII strings where implementations differ on `\uXXXX` escape behavior
2. Numbers larger than 2^53 − 1 (JavaScript safe-integer limit)
3. Floating-point number serialization (precision, scientific notation, trailing zeros)

The polyglot conformance harness at [`contextpassport/conformance-tests/runner/polyglot/`](https://github.com/contextpassport/conformance-tests/tree/main/runner/polyglot) demonstrates these gaps with concrete failing test cases.

For Context Passport to be a credible cross-implementation standard rather than a Python-defined schema, this gap must close.

## Proposal

Adopt [RFC 8785: JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785) as the canonical-JSON algorithm in Context Passport v2.0.

RFC 8785 is an IETF-standardized algorithm specifically designed for cryptographic canonicalization of JSON. It precisely specifies:

- Key sort order (lexicographic on UTF-16 code units)
- String escape rules (only ASCII control characters and `"` `\\` are escaped; all other Unicode characters emitted as raw UTF-8)
- Number serialization (per ECMAScript ToString algorithm, which canonicalizes `1.0` → `1`, removes trailing zeros, handles scientific notation deterministically)
- UTF-8 output encoding
- Edge cases (empty objects, nested arrays, control character escapes)

Mature implementations exist in multiple languages:

- Python: [`jcs`](https://pypi.org/project/jcs/) (PyPI, pure Python, no native deps)
- JavaScript / TypeScript: [`canonicalize`](https://www.npmjs.com/package/canonicalize) (npm, no deps)
- Go: [`github.com/cyberphone/json-canonicalization`](https://github.com/cyberphone/json-canonicalization)
- Java, C#, Rust: see the RFC 8785 reference-implementation list

Adopting JCS closes all three v1.x portability gaps with one algorithm change.

## Breaking-change scope

Per [`docs/migration-and-versioning.md`](../docs/migration-and-versioning.md) §3, changing the canonical-JSON algorithm requires a major version bump. This proposal is therefore for v2.0.

Specifically, a v1.x record with a non-ASCII string payload, a large integer, or a floating-point number will have a `payload_hash` that does not match what a v2.0 implementation computes for the same logical payload. Such v1.x records cannot be verified under v2.0 rules without a compatibility shim.

For v1.x records with ASCII-only string payloads, integer values within safe-integer range, and no floats: the JCS algorithm produces identical bytes to the v1.x algorithm. These records continue to verify under v2.0 without change. Empirically, this is the majority of records in production.

## Migration plan

Per the migration-and-versioning playbook, v2.0 adoption uses **chain reset** at the version boundary. Implementations carry a `schema_version` field; verifiers dispatch to the v1.x or v2.0 rule set based on that field. A reference compatibility shim (`context_passport.compat.v1`) translates v1.x records to v2.0 for processing where possible.

### Phases

1. **Pre-2.0 (now → v2.0-draft tag).** Publish this proposal. Solicit feedback for 60 days via GitHub Discussions on `contextpassport/spec`. Document the polyglot harness failures as the empirical motivation.

2. **v2.0-draft (T0).** Tag v2.0-draft in the spec repo. Reference implementations (`context-passport`, `@contextpassport/core`) ship `2.0.0-rc.1` with JCS via the chosen library. Conformance test suite adds `vectors/v2/` with JCS-specific test vectors borrowed from RFC 8785's reference vectors. Polyglot harness passes 100% under v2.0 rules.

3. **6-month overlap (T0 → T0+6m).** Both v1.x and v2.0 implementations remain published. Operators run dual-write per the migration playbook (`docs/migration-and-versioning.md` §5.2). New records ship as v2.0; old records remain valid v1.x records.

4. **v2.0-final (T0+6m).** Tag v2.0-final. Reference implementations bump to `2.0.0`. Default install of `pip install context-passport` and `npm install @contextpassport/core` resolves to v2.0. v1.x branches enter security-only maintenance.

5. **v1.x sunset (T0+12m+).** No new v1.x feature releases. v1.x records remain verifiable indefinitely via the compatibility shim shipped in v2.x.

### Required artifacts before v2.0-final

- [ ] Spec text in SPEC.md §3.4 replaced with normative reference to RFC 8785
- [ ] `context-passport` Python SDK uses `jcs` library (or implements RFC 8785 inline)
- [ ] `@contextpassport/core` TypeScript SDK uses `canonicalize` library (or implements RFC 8785 inline)
- [ ] All existing conformance vectors continue to pass under v2.0 rules (they should: existing vectors are ASCII-only with safe-range integers)
- [ ] New conformance vectors covering JCS edge cases: non-ASCII strings, emoji, large integers, floats, mixed types in arrays, deep nesting
- [ ] Polyglot conformance harness shows 0 failures
- [ ] `context_passport.compat.v1` (Python) and equivalent TypeScript module translate v1.x records to v2.0 for cross-version verification
- [ ] Migration guide in `docs/migrations/v1-to-v2.md` with copy-paste operator playbook
- [ ] Reference verifier in [`darkmatter-hub/darkmatter`](https://github.com/darkmatter-hub/darkmatter) and other downstream implementations updated to v2.0

## Costs

- One dependency added to each reference SDK (`jcs` for Python, `canonicalize` for TypeScript). Both are small (< 200 LOC each), pure-language, no native deps.
- Hash chains for records produced under v1.x with non-portable payload shapes will not verify under v2.0. The compatibility shim mitigates but cannot eliminate this.
- Operators running mixed-version pipelines need to handle the version boundary explicitly (already covered by the migration playbook).

## Alternatives considered

**Alternative A — define a custom canonicalization in the spec text without referencing JCS.** Rejected: this is what v1.x effectively does, and the polyglot harness shows it doesn't work. Any custom algorithm would need the same precision JCS already provides, with no offsetting benefit.

**Alternative B — fix v1.x in-place via a minor version (1.1).** Rejected: changing the canonicalization algorithm is breaking by definition per `docs/migration-and-versioning.md` §2. The cost of mislabeling a breaking change as additive is much higher than the cost of a v2.0 bump.

**Alternative C — keep the current algorithm but mandate `ensure_ascii=False` in Python and document the integer range as a hard constraint.** Considered. This is a less ambitious version of the same idea: it would close the Unicode gap (the most common one) without the larger v2.0 lift. But it leaves the float / large-integer gaps open and the spec text becomes a list of language-specific instructions rather than a single algorithm reference. RFC 8785 is the right destination; partial measures delay rather than avoid the work.

## Open questions

1. **Should v2.0 also adopt `signature` as a required field rather than optional?** Separate question, not bundled with this proposal. Worth opening as a sibling RFC if pursued.
2. **Should the canonicalization output also be specified for verification of arbitrary JSON values outside the passport envelope?** Currently SPEC.md only specifies canonicalization for `payload`. JCS naturally extends to any JSON value, so adopting it implicitly does this.
3. **Is the `jcs` Python library (last released 2023) maintained well enough to depend on?** Reviewer due-diligence item. If not, implement JCS inline (< 100 LOC).

## Discussion

Open a discussion thread at https://github.com/contextpassport/spec/discussions referencing this proposal. The 60-day feedback window starts on the merge date of this file. After the window closes and any substantive feedback is incorporated, a maintainer will create the v2.0-draft tag and the implementation work begins.
