# Changelog

All notable changes to the Context Passport specification are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This file tracks the **specification**, not the reference SDKs, which version
independently and keep their own changelogs. Dates are taken from the
publication of the corresponding reference implementations, since the
specification is not separately tagged.

A note on what counts as a breaking change here. This format exists so that a
record written by one implementation verifies in another, years later. So the
compatibility surface is the **bytes that get hashed**, not just the field
list. A change that leaves every field intact but alters serialization is
breaking, which is exactly what happened in 2.0.

## [Unreleased]

### Added

- Worked examples for all five compliance event types: `consent`, `override`,
  `escalate`, `redact` and `audit`. The compliance types are the ones
  regulated users care about most and previously had nothing to copy from.
  `override` and `escalate` are two-record chains, because both only mean
  something next to the decision they act on.
- `tools/generate-compliance-examples.py`, which produces those files with the
  Python reference SDK so their integrity hashes are real rather than
  hand-written.
- `tools/validate-examples.mjs` and CI to run it. It recomputes every hash from
  the payload rather than checking that hashes look well-formed, because a
  record can satisfy every schema constraint while carrying hashes that do not
  correspond to its own payload.
- A runnable Anthropic SDK integration example, exercised by CI in an offline
  mode that needs no API key.
- `docs/quickstart.md`, a five-minute path from install to a verified chain
  and a demonstrated tamper detection.
- A weekly steward workflow that reports outside contributions left without a
  maintainer reply.

Nothing in this section changes the wire format. Records written against 2.0
are unaffected.

### Changed

- `schema/v2.json`: `event.type` now carries the pattern
  `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`, enforcing as validation the shape
  §3.3 always described: lowercase letters/digits/underscore segments joined
  by dots (#35). Not breaking under this file's definition — no hashed bytes
  change and every specified type matches — but records from implementations
  that ignored the naming guidance may now fail schema validation.
- §2.6 now says custom event types SHOULD be prefixed with a namespace, matching
  §3.3's keyword and mechanism language, instead of requiring that new event
  types MUST be namespaced. The fifteen specified types remain conforming
  without a namespace; custom fields and vendor extensions stay MUST (#38). Not
  breaking under this file's definition — no hashed bytes change and no
  previously conforming record becomes non-conforming.
- `GOVERNANCE.md`: the two-maintainer approval threshold for substantive changes
  is now satisfiable while the project has fewer than two maintainers, by
  approval from every listed maintainer plus the full 14-day RFC window. As
  written, that threshold made every substantive change unmergeable by anyone,
  including the sole maintainer. The accommodation lapses automatically once a
  second maintainer is listed in `.github/CODEOWNERS`. The same section now
  states that reconciling a contradiction between two sections is editorial
  where no conforming implementation changes behaviour.

## [2.0] - 2026-05-19

### Changed

- **Canonical JSON is now [RFC 8785 (JCS)](https://datatracker.ietf.org/doc/html/rfc8785).**
  This governs `payload_hash`, `integrity_hash` and the signing envelope.
  Nothing else in the envelope changed: fields, schema, event types,
  `parent_id` linkage and the signing block are all identical to 1.0. Only the
  byte-level serialization rule moved.

  For payloads that are pure ASCII with integers inside
  `[-(2^53 - 1), 2^53 - 1]`, 1.x and 2.0 produce identical bytes and identical
  hashes, so those records need no migration. Payloads containing non-ASCII
  characters, emoji, floats, or integers outside the safe range hash
  differently under the two rules.

- `schema_version` is `"2.0"` and `$schema` points at
  `https://contextpassport.com/schema/v2.json`.

### Added

- A v1.x compatibility shim in both reference SDKs
  (`context_passport.compat.v1`, `@contextpassport/core/compat/v1`).
  `verify_chain` dispatches per record on `schema_version`, so mixed-version
  chains verify correctly and 1.x records stay verifiable indefinitely.
- An explicit numeric range constraint (SPEC.md 3.4.2). JCS specifies number
  serialization but cannot widen the range a host language can represent, so
  applications needing arbitrary-precision integers must encode them as
  strings.

### Deprecated

- The 1.x canonicalization algorithm for **new** records. It is retained in the
  compat shim solely so existing records remain verifiable. Do not re-hash 1.x
  records under 2.0 rules: that changes their hashes, breaks any signature over
  them, and breaks anything downstream that referenced the old hash.

Migration guide: [`docs/migrations/v1-to-v2.md`](docs/migrations/v1-to-v2.md).

## [1.0] - 2026-05-19

### Added

- Initial specification: the JSON envelope, field definitions, developer and
  compliance event types, the integrity computation, conformance levels, and
  the security considerations.
- `schema/v1.json`.
- Reference implementations in Python and TypeScript.

[Unreleased]: https://github.com/contextpassport/spec/compare/main...HEAD
