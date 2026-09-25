# Context Passport

**The envelope format for AI agent events.**

Version 2.0 · Spec: CC0 1.0 · Reference implementations: Apache-2.0

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22153488.svg)](https://doi.org/10.5281/zenodo.22153488)

---

Context Passport is a minimal JSON schema for structured, verifiable records of AI agent events — decisions, handoffs, checkpoints, forks, audits, and consent. Model-agnostic. Framework-agnostic. Cryptographically verifiable.

The goal: become the standard envelope format for AI agent events — a record any agent can produce and any party can verify, with built-in integrity guarantees that do not require trusting any central authority.

## Quick look

```json
{
  "$schema": "https://contextpassport.com/schema/v2.json",
  "schema_version": "2.0",
  "id": "ctx_1774358291224_bad9b976",
  "parent_id": "ctx_previous_or_null",
  "created_by": {
    "agent_id": "agent-researcher-01",
    "agent_name": "Research Agent",
    "role": "researcher",
    "provider": "anthropic",
    "model": "claude-opus-4-6"
  },
  "event": { "type": "commit", "to_agent_id": "agent-writer-01", "timestamp": "2026-03-29T10:00:00Z" },
  "payload": {
    "input":  "Analyze Q1 earnings",
    "output": { "summary": "APAC up 34%", "confidence": 0.94 }
  },
  "integrity": {
    "payload_hash":        "sha256:e7733904...",
    "parent_hash":         "sha256:f4a2b1c3...",
    "integrity_hash":      "sha256:8a1c9d22...",
    "verification_status": "valid"
  },
  "created_at": "2026-03-29T10:00:00Z"
}
```

## Contents

- [`docs/quickstart.md`](docs/quickstart.md) — five minutes from install to a verified chain
- [`docs/quickstart-typescript.md`](docs/quickstart-typescript.md) — the same quickstart for the TypeScript SDK
- [`SPEC.md`](SPEC.md) — full specification (v2.0)
- [`schema/v2.json`](schema/v2.json) — machine-readable JSON Schema (v2.0, single record)
- [`schema/v2-chain.json`](schema/v2-chain.json) — array of v2 records (`*.passports.json` chains)
- [`schema/v1.json`](schema/v1.json) — machine-readable JSON Schema (v1.x, retained for compatibility)
- [`docs/`](docs/) — non-normative design notes for implementers
  - [`throughput-and-trust.md`](docs/throughput-and-trust.md) — submission patterns, trust properties, SDK guidance
  - [`external-anchoring.md`](docs/external-anchoring.md) — using OpenTimestamps (and alternatives) to anchor passports at creation time
  - [`key-management.md`](docs/key-management.md) — file-based, PKI/X.509, and DID-based signing key patterns
  - [`witness-log.md`](docs/witness-log.md) — operator architecture for publishing public, anchored checkpoint chains
  - [`migration-and-versioning.md`](docs/migration-and-versioning.md) — minor vs. major versions, cross-version compatibility, upgrade playbook
  - [`migrations/v1-to-v2.md`](docs/migrations/v1-to-v2.md) — concrete operator playbook for the v1.x → v2.0 upgrade
  - [`regulatory-mapping.md`](docs/regulatory-mapping.md) — field-by-field mapping to EU AI Act, FINRA 17a-4, HIPAA, SOX, GDPR, PCI DSS, ISO/IEC 42001, NIST AI RMF
  - [`threat-model.md`](docs/threat-model.md) — adversaries, defenses, defense-in-depth recommendations
- [`proposals/`](proposals/) — draft proposals
  - [`context-passport-for-mcp.md`](proposals/context-passport-for-mcp.md) — MCP extension proposal
  - [`canonical-json-jcs.md`](proposals/canonical-json-jcs.md) — adopt RFC 8785 in v2.0 to close v1.x portability gaps
  - [`in-toto-predicate.md`](proposals/in-toto-predicate.md) — an in-toto attestation predicate for AI agent decisions, drafted for submission upstream
- [`EXTENSIONS.md`](EXTENSIONS.md) — vendor-namespaced extension registry
- [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md) — known implementations
- [`CHANGELOG.md`](CHANGELOG.md) — what changed between specification versions
- [`GOVERNANCE.md`](GOVERNANCE.md) — how this specification evolves
- [`examples/`](examples/) — example passports and chains, including a worked
  record for every compliance event type (`consent`, `override`, `escalate`,
  `redact`, `audit`)

## Implementations

Open-source reference implementations are maintained under the [`contextpassport` GitHub organization](https://github.com/contextpassport):

- [`contextpassport/python`](https://github.com/contextpassport/python) — Python reference implementation
- [`contextpassport/typescript`](https://github.com/contextpassport/typescript) — TypeScript reference implementation
- [`contextpassport/conformance-tests`](https://github.com/contextpassport/conformance-tests) — conformance test suite

Third-party implementations are listed in [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md). Building an implementation? Open a PR to add yours.

## Status

v2.0. Adopts RFC 8785 (JCS) for cross-implementation byte-equivalence. Reference SDKs ship as `context-passport==2.0.x` on PyPI and `@contextpassport/core@2.0.x` on npm. v1.x records remain verifiable via the compatibility shim in both SDKs. See [`docs/migrations/v1-to-v2.md`](docs/migrations/v1-to-v2.md).

Feedback welcome via GitHub Issues.

## Get involved

Context Passport is a community-governed open standard. We are actively looking for additional contributors and maintainers.

- **Open an issue or a PR.** Editorial fixes, new examples, RFC proposals, extensions — all welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Become a maintainer.** A standard with one maintainer is, in practice, a vendor schema. Becoming a maintainer is documented in [`CONTRIBUTING.md` §5](CONTRIBUTING.md#5-becoming-a-maintainer). We are explicitly looking for maintainers from underrepresented language ecosystems, regulated industries, and non-US/EU regulatory contexts.
- **Build a reference implementation.** A new language port (Rust, Go, Java, Ruby) or framework integration (LangChain, LlamaIndex, CrewAI) is one of the most impactful contributions possible right now. See the [`contextpassport` organization](https://github.com/contextpassport).
- **Discuss.** General questions: [GitHub Discussions](https://github.com/contextpassport/spec/discussions). Direct contact: `maintainers@contextpassport.com`.

Governance and decision-making are documented in [`GOVERNANCE.md`](GOVERNANCE.md). Code of conduct in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security reports to `security@contextpassport.com` ([`SECURITY.md`](SECURITY.md)).

## License

## Citing this specification

Archived on Zenodo, so it can be cited in research, regulatory filings and
standards work without depending on a branch URL that may move.

**DOI: [10.5281/zenodo.22153488](https://doi.org/10.5281/zenodo.22153488)**

That is the *concept* DOI: it always resolves to the newest published version.
Cite it when you mean the specification. Each release also mints a version DOI
pinned to one exact snapshot, listed on the Zenodo record, for when you need to
name the version you actually implemented.

The archive is CC0, like the specification. Nothing about citing it creates an
obligation to anyone.

The **specification** (SPEC.md, schema/, README.md content) is released under **CC0 1.0 Universal** — no rights reserved, public domain. Implement it, fork it, extend it. No attribution required.

The **reference implementations** are released under **Apache-2.0** — includes an explicit patent grant. They live in their own repositories: [`contextpassport/python`](https://github.com/contextpassport/python) and [`contextpassport/typescript`](https://github.com/contextpassport/typescript). The Apache-2.0 licence also covers the small amount of tooling in this repository (`server.js`, which serves contextpassport.com, and the scripts under `tools/`).

See [`LICENSE`](LICENSE) (CC0) and [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt) (Apache-2.0).
