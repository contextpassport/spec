# Context Passport Governance

**Status:** Draft. This document will evolve as the project adds maintainers.

## Purpose

Context Passport is an open standard. Governance exists to make the evolution of the specification predictable, transparent, and independent of any single vendor.

## Stewardship

The specification is currently stewarded by the Context Passport maintainers. Stewardship means: triage of issues and pull requests, scheduling of releases, and maintenance of the canonical repository. Stewardship does not confer ownership — the specification is released under CC0 and belongs to the community.

## Maintainers

Maintainers have merge rights on the canonical repository.

The current list of maintainers is published in the `.github/CODEOWNERS` file of the canonical repository.

**We are actively recruiting additional maintainers.** A standard with one maintainer is, in practice, a vendor schema. The credibility of Context Passport as a community standard grows with every additional independent maintainer. See [`CONTRIBUTING.md` §5](CONTRIBUTING.md#5-becoming-a-maintainer) for the path.

**Becoming a maintainer:** Maintainers are added by consensus of existing maintainers after sustained contribution (typically: three substantive merged pull requests over three months, plus participation in spec discussions). The goal is to grow to at least three independent maintainers from at least two organizations within twelve months of v1.0 final.

## Decision-making

**Editorial changes** (typos, clarifications, examples that do not change behavior): any maintainer may merge.

**Substantive changes** (new fields, changed semantics, new event types in the core spec): require a public RFC issue open for at least 14 days, with explicit approval from at least two maintainers and no unresolved objections from any maintainer.

**Breaking changes** (changes that would invalidate v1.0-conformant passports): not permitted within a major version. Breaking changes ship in a new major version with a documented migration path.

**Extensions** (new event types or fields added via the namespace mechanism): do not require a spec change. See `EXTENSIONS.md`.

## RFC process

Substantive changes are proposed as GitHub issues labeled `rfc`. An RFC includes:

1. Problem statement
2. Proposed change to the spec
3. Backward compatibility analysis
4. At least one reference implementation (can be a sketch)

After 14 days of public discussion, maintainers either accept, request changes, or decline. Accepted RFCs are merged into the next minor or major release.

## Releases

The specification follows semantic versioning at the major-version level. Within a major version, all changes are additive and backward-compatible. New major versions ship with a published migration guide.

## Trademark and naming

"Context Passport" is the canonical name of the specification. Implementations may describe themselves as "Context Passport conformant" only after passing the conformance test suite at `github.com/contextpassport/conformance-tests`. Use of the name in product names or marketing requires no permission, provided the implementation is conformant.

## Conflict resolution

Disagreements between maintainers are resolved by public discussion in the RFC issue. If consensus cannot be reached, the change does not proceed. The default action when in doubt is no change.

---

*This governance document is itself subject to change via the RFC process. The first amendment expected is the addition of independent maintainers.*
