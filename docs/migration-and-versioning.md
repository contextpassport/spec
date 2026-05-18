# Migration and Versioning

**Status:** Non-normative design note
**Audience:** SDK implementers, operators planning multi-year deployments, anyone integrating with multiple Context Passport implementations
**Companion to:** [SPEC.md §2.4 — Versioned from the first release](../SPEC.md#24-versioned-from-the-first-release), [SPEC.md §2.6 — Forward-compatible by extension](../SPEC.md#26-forward-compatible-by-extension), [GOVERNANCE.md](../GOVERNANCE.md)

---

## Why this document exists

A standard that doesn't tell implementers what to do with old and new records becomes a fork generator. Two implementations both claim "Context Passport conformance"; one of them sees a passport with a field it doesn't recognize; what should it do? Reject? Strip the field? Pass it through? Each choice produces a different downstream behavior, and the absence of a documented answer means implementations diverge.

This document specifies the versioning model, the contract between major versions, and the playbook for migrating records, chains, and pipelines as the spec evolves.

---

## 1. Versioning model

Context Passport uses **semantic versioning at the major-version boundary**:

- **Patch versions** (`1.0.0` → `1.0.1`): editorial only. Typo fixes, clarifications, better examples. No behavior change. Implementations do not need to be aware of patch versions.
- **Minor versions** (`1.0` → `1.1`): additive only. New optional fields, new event types in the registry, new namespaced extensions promoted to core. All v1.0 passports remain valid v1.1 passports. All v1.1 implementations can consume v1.0 passports.
- **Major versions** (`1.x` → `2.0`): may include breaking changes. New required fields, removed fields, changed semantics, changed hash construction, changed signature canonicalization. Implementations of v2.0 are not required to consume v1.x passports natively (though they are encouraged to via a separate compatibility module).

The `schema_version` field in the passport envelope (SPEC.md §3.2.1) carries the version of the spec the passport was produced against. **`schema_version` MUST match `major.minor`** — patch versions are not reflected.

Examples:
- `"1.0"` — produced against v1.0
- `"1.1"` — produced against v1.1 (when it ships)
- `"2.0"` — produced against v2.0

---

## 2. What can change in a minor version

A minor version (`1.0` → `1.1`) may add:

- **New optional fields** in the envelope or in any sub-object (`created_by`, `event`, `integrity`, `lineage`, `signature`).
- **New values in open enums** like `event.type`, `created_by.provider`, `created_by.role`. These were always documented as "examples, custom values permitted" — new defaults entering the registry is purely additive.
- **New namespaced extensions promoted to core.** A field that lived in `EXTENSIONS.md` for at least six months with three independent implementations (per `EXTENSIONS.md`) may be promoted to a core field. The namespaced version remains valid as an alias for one full major version.
- **Stricter validation rules that loosen, not tighten.** Example: accepting additional date-time formats in `event.timestamp`.
- **New conformance levels** layered on top of existing ones. The Signed conformance level (introduced after the spec's initial draft) is an example.

A minor version may NOT:

- Add new required fields. An old client producing a v1.0 passport must still produce a passport that validates under v1.1.
- Remove or rename existing fields.
- Change the canonical-JSON algorithm or hash function.
- Change how `integrity_hash` is computed.
- Change how `signature.signature` is computed.

If any of these are needed, a major version is required.

---

## 3. What can change in a major version

A major version (`1.x` → `2.0`) may include any of the above plus:

- **New required fields.** Records emitted under v2.0 may be required to carry fields v1.x records did not have.
- **Removed fields.** A v1.x field may be deprecated and removed in v2.0.
- **Changed semantics.** A field's meaning may shift. (Rare in practice; usually preferred to rename and deprecate the old name.)
- **Changed canonical-JSON algorithm.** Unlikely but permitted. Would invalidate the hash chain across the version boundary.
- **New hash function.** Replacing SHA-256 with SHA-3 or BLAKE3 would require a major version.
- **New signature canonicalization.** The "signature over canonical envelope with signature.signature cleared" rule (SPEC.md §3.2.7) could be replaced with a different canonical-bytes definition.

Major version changes require:

- A formal RFC process per `GOVERNANCE.md`.
- A published migration guide (this document is the template).
- A reference migration tool in the official Python and TypeScript implementations.
- At least six months between the v2.0-draft tag and v2.0-final.

---

## 4. How implementations handle records from other versions

The contract between implementations and records, by version relationship:

### 4.1 Implementation version matches record version

The default case. Validate, verify, process normally.

### 4.2 Implementation is NEWER than record (e.g. impl is v1.2, record is v1.0)

**Required behavior:** accept. Any v1.x implementation MUST consume any v1.y passport where y ≤ current major. Backward compatibility within a major version is non-negotiable — this is the central promise of minor versioning.

Implementation details:
- Fields added in v1.1+ are simply absent on the v1.0 record. Treat as null/missing.
- Fields whose validation loosened in later minor versions: apply the loosened validation.
- Conformance level claims: the implementation may still claim its own conformance level. Whether the v1.0 record was created by a conformant v1.0 implementation is the record's question, not the consuming impl's.

### 4.3 Implementation is OLDER than record (e.g. impl is v1.0, record is v1.2)

**Required behavior:** accept and process the fields the impl understands, ignore the rest. SPEC.md §2.6 (forward-compatible by extension) requires that unknown fields not cause parse failure.

Implementation details:
- New optional fields: ignored silently. No warning required.
- New event-type values: treat as opaque strings. Don't reject just because the value isn't in the impl's known list.
- New extension fields: ignored (namespaced or not).

If the record has `schema_version` newer than the impl knows about: the impl SHOULD include a warning in logs or output indicating "schema_version X is newer than the impl supports; processing what is understood." The impl MUST NOT refuse to process.

### 4.4 Implementation is across a MAJOR version (e.g. impl is v1.x, record is v2.0)

**Default behavior:** reject. A v1.x impl is not required to consume v2.0 passports; they may have semantics it doesn't understand.

**Recommended behavior:** include a compatibility module that wraps v2.0 records into a v1.x-compatible shape where possible. This is what `cryptography`, `protobuf`, and most long-lived libraries do. The wrapping must be loss-tolerant (it's understood that some v2.0 fields cannot be represented in v1.x).

### 4.5 Implementation is across a MAJOR version, other direction (e.g. impl is v2.0, record is v1.x)

**Recommended behavior:** accept via a one-way migration shim. The v2.0 impl knows what v1.x looked like and can translate the record's structure to the v2.0 shape for internal processing.

Reference implementations (`contextpassport/python`, `contextpassport/typescript`) will ship migration shims when v2.0 lands, in modules named `context_passport.compat.v1` and similar.

---

## 5. Migration playbook for operators

When a new major version of the spec ships, an operator running a Context Passport pipeline has four migration patterns available. Choice depends on volume, risk tolerance, and downstream consumer flexibility.

### 5.1 Cutover (simplest)

At time T:
- Stop accepting v1.x writes.
- Update the impl to v2.0.
- Begin accepting v2.0 writes.

Existing v1.x records remain in storage, queried via a v1.x-aware reader.

**Pros:** simple, well-understood.
**Cons:** brief downtime; no in-flight compatibility.

Suitable for operators with a maintenance window and small/zero co-existence requirement.

### 5.2 Dual-write

For a transition period (typically weeks):
- The pipeline writes every commit twice — once as v1.x, once as v2.0.
- Readers can use either version.
- After the transition, drop the v1.x writes.

**Pros:** zero downtime, downstream consumers migrate at their own pace.
**Cons:** doubled storage cost during transition, doubled processing cost.

Suitable for operators with mixed downstream consumers and the budget for the transition.

### 5.3 Dual-publish via transformation

The pipeline writes only v2.0. A separate process transforms v2.0 records back to v1.x shape on demand for v1.x consumers.

**Pros:** single source of truth.
**Cons:** the transformation must be precise; lossy transformations produce inconsistencies.

Suitable for operators with a small number of v1.x consumers and the engineering capacity to maintain the transformer.

### 5.4 Hard cutover with v1.x archive

The pipeline switches to v2.0 at time T. All v1.x records are exported to a long-term archive (S3, glacier, IPFS) and removed from the live database. Verification of pre-T records becomes an explicitly slower operation that fetches from the archive.

**Pros:** clean live state.
**Cons:** v1.x records are no longer first-class — slow to query, separate access path.

Suitable for operators where pre-T records are rarely queried (e.g., compliance archives for past audit periods).

### Recommendation

For most operators: **dual-write for 3-6 months, then cutover**. Costs you double storage for a quarter; gives every consumer a window to migrate; eliminates compatibility code from the long-term codebase.

---

## 6. Hash chain considerations across versions

The hash chain depends on:
- The canonical-JSON algorithm
- The hash function (SHA-256)
- The integrity-hash construction rule (`sha256(payload_hash + parent_hash)`)

If any of these change in a major version, **the chain breaks at the version boundary**. A v2.0 record cannot have its `parent_hash` linked to a v1.x parent's `integrity_hash` if the underlying construction differs.

Two ways to handle this:

### 6.1 Chain reset

Treat the version boundary as a chain root. The first v2.0 commit has `parent_id` set to the last v1.x commit (for human-readable continuity) but `parent_hash` set to null and `integrity_hash` computed from the new construction.

The downstream verifier walking the chain detects the version transition (different `schema_version`) and uses the corresponding rules for each segment.

### 6.2 Anchor-based bridging

The last v1.x checkpoint and the first v2.0 checkpoint are both externally anchored (Bitcoin OTS). The chain continuity is provided not by the integrity_hash linkage but by the external anchors — anyone verifying records across the boundary uses the external anchors as the bridge.

For operators running a Witness Log, anchor-based bridging is essentially free — checkpoints are already anchored. The only operational change is documenting that v1.x records' `integrity_hash` values cannot be directly recomputed under v2.0 rules.

### Recommendation

Use **chain reset** for v1.x → v2.0. It's the cleanest and matches what every other versioned chain (Git, blockchains, append-only logs) does at major-version boundaries.

---

## 7. Conformance across versions

The conformance test suite at `contextpassport/conformance-tests` is versioned alongside the spec:

- `vectors/v1.0/required/` — v1.0 Core conformance vectors
- `vectors/v1.0/signed/` — v1.0 Signed conformance vectors
- `vectors/v1.1/required/` — v1.1-specific vectors (when v1.1 ships)
- `vectors/v2.0/required/` — v2.0 Core conformance vectors

An implementation declares conformance at a specific version, not generically:

```
✓ Context Passport v1.0 Core Conformant
✓ Context Passport v1.0 Signed Conformant
✓ Context Passport v1.1 Core Conformant (additional)
```

A v1.1-conformant impl is implicitly v1.0-conformant (per the backward-compatibility contract). A v2.0-conformant impl is **not** implicitly v1.x-conformant; if it claims both, it must pass both test suites.

Currently the vectors live in `vectors/required/` and `vectors/signed/` without version subdirectories. When v1.1 ships, the existing directories will be moved to `vectors/v1.0/` and new directories created. The runner will accept a `--spec-version` flag.

---

## 8. Extension promotion lifecycle

A namespaced extension (e.g. `acme.payment_amount`) lives in `EXTENSIONS.md`. Over time, an extension may be promoted to a core field. The lifecycle:

```
Draft (in EXTENSIONS.md)
   ↓ (6 months minimum + 3 independent implementations)
Candidate (still in EXTENSIONS.md, marked "promotion candidate")
   ↓ (RFC + community review)
Promoted (added to SPEC.md in next minor version, alias retained)
   ↓ (one full major version of overlap)
Core only (namespaced alias removed in the next major version)
```

Implementations consuming a passport during the overlap window must accept either the namespaced form or the core form. After the core-only transition, namespaced uses of the same field name are treated as separate (un-promoted) extensions; the same string in the namespace prefix has no special meaning.

This pattern ensures extensions can move toward being canonical without breaking implementations that adopted them early.

---

## 9. Deprecation policy

Fields and behaviors that are being removed in a future major version are marked **deprecated** in the current version:

- In SPEC.md: the field section has a "**Deprecated in v1.x; will be removed in v2.0**" note.
- In code: the reference implementations emit a runtime warning when the deprecated field is used.
- In the conformance test suite: a vector is added to verify the deprecation warning fires (where applicable).

Deprecation requires at least one full minor version of advance notice (e.g., deprecated in v1.1, removed in v2.0 not earlier). For high-impact deprecations (e.g., removing a required field), longer advance notice is expected per the RFC process.

---

## 10. Communication channels for version events

When a new minor or major version ships, the maintainers commit to publishing:

- **Release notes** in the spec repo's `CHANGELOG.md`
- **Migration guide** in `docs/migrations/v<old>-to-v<new>.md`
- **GitHub release** tagging the spec at the new version
- **A blog post or community announcement** at `contextpassport.com/blog/`
- **A heads-up to known implementers** at least 30 days before the release date

Implementers and operators who want to be notified early can:
- Subscribe to releases on the spec repo
- Watch the spec repo for new PRs labeled `version-bump`
- Join the maintainer Discord/Slack (TBD)

---

## 11. Concrete example — what a v1.0 to v1.1 transition might look like

A hypothetical v1.1 adds:
- New optional field `created_by.organization_id` (a stable org-level identifier)
- New event-type value `delegate` (for hand-off events with explicit delegation semantics)
- Promoted extension: `darkmatter.witness_log_ref` → core field `witness_log_ref`

Existing v1.0 implementations:
- Consume v1.1 passports correctly: missing `organization_id` is fine (optional); unknown event-type `delegate` is treated as an opaque string; the namespaced `darkmatter.witness_log_ref` is ignored (as it was in v1.0); the core `witness_log_ref` is ignored (unknown field).
- Do not need to upgrade.

Existing v1.0 records:
- Consumed by v1.1 implementations without modification.
- Validate against the v1.1 schema (no new required fields, all v1.0 records are valid v1.1 records).

Operators producing new records:
- Upgrade SDK to v1.1.
- Optionally start emitting `organization_id` and `witness_log_ref` core fields.
- Optionally retire the namespaced `darkmatter.witness_log_ref` alias.

This is the smoothest possible transition. Most minor versions should look like this.

---

## 12. Concrete example — what a v1.x to v2.0 transition might look like

A hypothetical v2.0 adds:
- Required field `created_by.organization_id` (was optional in v1.1)
- Replaced canonical-JSON with JCS (RFC 8785) instead of the current sorted-keys serialization
- Required `signature` block on all production passports

Existing v1.x implementations:
- Cannot consume v2.0 passports natively without modification.
- The reference implementation ships `context_passport.compat.v1` that translates v2.0 records into a v1.x-compatible shape (lossy: the signature requirement cannot be downgraded).

Existing v1.x records:
- Consumed by v2.0 implementations via the v2.0 impl's `compat.v1` module.
- Hash chains break at the version boundary (different canonical-JSON). Verifiers use the per-segment rule (v1.x rules for v1.x records, v2.0 rules for v2.0 records) and rely on external anchors (Witness Log) for cross-boundary continuity.

Operators:
- Receive 6+ months of advance notice in v1.x release notes.
- Choose a migration pattern from §5.
- Update SDKs and the receiving server simultaneously (or in compatible order — v2.0 server can accept v1.x writes via shim; v1.x server cannot accept v2.0 writes).
- Document the boundary in their own audit logs so downstream consumers can locate the transition.

Transitions like this should happen rarely (at most every few years).

---

## 13. What this document does not cover

- **Specific upgrade tools.** Per-implementation. The reference implementations will ship them when needed.
- **Backporting fixes from newer versions to older versions.** Generally not done. Operators on old versions are encouraged to upgrade.
- **Versioning of the conformance test suite separately from the spec.** The two are versioned together by convention.

---

*Context Passport — design notes for implementers. Released under CC0 along with the rest of the specification.*
