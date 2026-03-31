# Context Passport

**An open standard for AI agent context handoffs.**

Version 1.0 · Draft · CC0 1.0

---

Context Passport is a minimal JSON schema for structured, verifiable context handoffs between AI agents. Model-agnostic. Framework-agnostic. Cryptographically verifiable.

The goal: become the TCP of multi-agent systems — a standard envelope format that any agent can produce and any agent can consume, with built-in integrity verification that does not require trusting any central authority.

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
- [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md) — known implementations
- [`examples/`](examples/) — example passports and chains

## Implementations

| Implementation | Type | License | Link |
|---|---|---|---|
| DarkMatter | Reference | MIT | darkmatterhub.ai |

Building an implementation? Open a PR to add it to this list.

## Status

Draft v1.0. The schema is stable enough to build against. We are collecting feedback before advancing to v1.0 final.

Feedback welcome via GitHub Issues.

## License

CC0 1.0 Universal — no rights reserved. The specification is public domain. Implement it, fork it, extend it — no attribution required.

The reference implementation (DarkMatter) is separately licensed under MIT.
