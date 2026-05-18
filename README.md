# Context Passport

**The envelope format for AI agent events.**

Version 1.0 · Draft · Spec: CC0 1.0 · Reference implementations: Apache-2.0

---

Context Passport is a minimal JSON schema for structured, verifiable records of AI agent events — decisions, handoffs, checkpoints, forks, audits, and consent. Model-agnostic. Framework-agnostic. Cryptographically verifiable.

The goal: become the standard envelope format for AI agent events — a record any agent can produce and any party can verify, with built-in integrity guarantees that do not require trusting any central authority.

## Quick look

```json
{
  "$schema": "https://contextpassport.com/schema/v1.json",
  "schema_version": "1.0",
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

- [`SPEC.md`](SPEC.md) — full specification
- [`schema/v1.json`](schema/v1.json) — machine-readable JSON Schema
- [`docs/`](docs/) — non-normative design notes for implementers
  - [`throughput-and-trust.md`](docs/throughput-and-trust.md) — submission patterns, trust properties, SDK guidance
  - [`external-anchoring.md`](docs/external-anchoring.md) — using OpenTimestamps (and alternatives) to anchor passports at creation time
- [`proposals/`](proposals/) — draft proposals
  - [`context-passport-for-mcp.md`](proposals/context-passport-for-mcp.md) — MCP extension proposal
- [`EXTENSIONS.md`](EXTENSIONS.md) — vendor-namespaced extension registry
- [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md) — known implementations
- [`GOVERNANCE.md`](GOVERNANCE.md) — how this specification evolves
- [`examples/`](examples/) — example passports and chains

## Implementations

| Implementation | Type | License | Link |
|---|---|---|---|
| DarkMatter | Reference | Apache-2.0 | darkmatterhub.ai |

Building an implementation? Open a PR to add it to this list. Conformance test suite at `github.com/contextpassport/conformance-tests`.

## Status

Draft v1.0. The schema is stable enough to build against. We are collecting feedback before advancing to v1.0 final.

Feedback welcome via GitHub Issues.

## License

The **specification** (SPEC.md, schema/, README.md content) is released under **CC0 1.0 Universal** — no rights reserved, public domain. Implement it, fork it, extend it. No attribution required.

The **reference implementations** (server.js, test.js, language-specific SDKs) are released under **Apache-2.0** — includes an explicit patent grant.

See `LICENSE` (CC0) and `LICENSE-APACHE` (Apache-2.0).
