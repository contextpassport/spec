# Context Passport Specification

**Version:** 2.0  
**Status:** v2.0 adopts RFC 8785 (JSON Canonicalization Scheme) for hashing and signing, closing the cross-implementation portability gaps of v1.x. Reference implementations: `context-passport==2.0.x` on PyPI, `@contextpassport/core@2.0.x` on npm. v1.x records remain verifiable via the compatibility shim shipped with v2.x. Migration playbook in [`docs/migrations/v1-to-v2.md`](docs/migrations/v1-to-v2.md). New features ship via the extension model (see `EXTENSIONS.md`) without breaking existing implementations.  
**Specification license:** CC0 1.0 Universal (public domain)  
**Reference implementation license:** Apache-2.0 (with explicit patent grant)  
**Maintained by:** Context Passport maintainers
**Repository:** github.com/contextpassport/spec

---

## Abstract

Context Passport is an open standard for structured, verifiable records of AI agent events. It defines a minimal JSON envelope that any agent, framework, or model can produce and consume — making agent decisions, handoffs, checkpoints, and audits interoperable, cryptographically verifiable, and auditable across systems.

Event types covered by this specification include developer events (commit, fork, checkpoint, spawn, retry, error) and compliance events (override, consent, escalate, redact, audit). Handoffs are one event type among many.

The goal of this specification is to become the standard interchange format for AI agent event records across the AI ecosystem.

---

## Table of contents

1. [Motivation](#1-motivation)
2. [Design Principles](#2-design-principles)
3. [Specification](#3-specification)
   - [Schema](#31-schema)
   - [Field definitions](#32-field-definitions)
      - [Identity fields](#321-identity-fields)
      - [Agent attribution](#322-agent-attribution)
      - [Event](#323-event)
      - [Payload](#324-payload)
      - [Integrity](#325-integrity)
      - [Lineage](#326-lineage)
      - [Signature (optional)](#327-signature-optional)
   - [Event types](#33-event-types)
   - [Integrity computation](#34-integrity-computation)
4. [Conformance](#4-conformance)
5. [Security considerations](#5-security-considerations)
6. [IANA considerations](#6-iana-considerations)
7. [References](#7-references)

## 1. Motivation

Multi-agent AI systems are becoming production infrastructure. As of 2025, teams routinely chain multiple AI agents together — researcher, writer, reviewer, validator — across different models, frameworks, and organizational boundaries.

When Agent A hands work to Agent B today, the format is arbitrary. A string, a dictionary, a JSON blob with no fixed shape. This creates four unsolved problems:

**1. Incompatibility.** Agents built with different frameworks cannot reliably exchange context. A LangGraph agent cannot hand context to a CrewAI agent without custom serialization code.

**2. Schema drift.** When the output schema of Agent A changes, Agent B fails silently. There is no contract, no version, no detection mechanism.

**3. No attribution.** The receiving agent does not know who produced the context, with which model, at what time, or whether it was modified in transit.

**4. No verifiability.** Audit trails stored inside any single system can be modified by that system. There is no standard mechanism for proving that a chain of agent decisions was not altered after the fact.

Context Passport solves all four.

---

## 2. Design Principles

### 2.1 Minimal by design

Context Passport defines the envelope, not the content. The `payload` block is open — agents put whatever they need inside it. The standard defines the fields that enable interoperability, attribution, and verification. Nothing more.

### 2.2 Transport-independent

Context Passport is a JSON document. It is not tied to HTTP, WebSockets, message queues, or any specific transport. Any system that can serialize and deserialize JSON can produce and consume Context Passports.

### 2.3 Verifiable without trusting the issuer

The SHA-256 hash chain enables any party holding a sequence of passports to verify the chain is intact — without trusting the system that stored them, without network access, and without any central authority.

### 2.4 Versioned from the first release

`schema_version` is a required field. Every major version of this specification either maintains backward compatibility with prior-major records, or ships a documented migration path and a per-version verification shim. v2.0 ships such a shim for v1.x records ([`context_passport.compat.v1`](https://github.com/contextpassport/python/tree/main/src/context_passport/compat) in Python, equivalent in TypeScript); see [`docs/migrations/v1-to-v2.md`](docs/migrations/v1-to-v2.md).

### 2.5 Open governance

This specification is released under CC0 1.0 — no copyright, no restrictions. Reference implementations published by the maintainers are released under Apache-2.0, which includes an explicit patent grant. Any person or organization may implement, extend, or fork the specification without restriction or attribution requirement. The standard belongs to the community.

### 2.6 Forward-compatible by extension

The specification grows by addition, never by breaking change within a major version. New event types, custom fields, and vendor-specific extensions MUST be namespaced (e.g. `myorg.custom_type`, `myorg.field_name`). Implementations MUST ignore unknown namespaced fields without error. A formal extension registry lives at `EXTENSIONS.md` in the repository. Anyone may submit an extension via pull request; widely-adopted extensions are candidates for promotion to the core spec in subsequent major versions.

---

## 3. Specification

### 3.1 Schema

A Context Passport is a JSON object with the following structure. Fields marked **Required** must be present. All other fields are optional but recommended.

```json
{
  "$schema":        "https://contextpassport.com/schema/v2.json",
  "schema_version": "2.0",

  "id":         "ctx_{unix_ms}_{6_hex_bytes}",
  "parent_id":  "ctx_... | null",
  "trace_id":   "trc_... | null",
  "branch_key": "main",

  "created_by": {
    "agent_id":   "string",
    "agent_name": "string",
    "role":       "string",
    "provider":   "anthropic | openai | google | mistral | local | custom",
    "model":      "string"
  },

  "event": {
    "type":        "string",
    "to_agent_id": "string | null",
    "timestamp":   "ISO 8601"
  },

  "payload": {
    "input":     "string | object | null",
    "output":    "string | object | null",
    "memory":    "object | null",
    "variables": "object | null"
  },

  "integrity": {
    "payload_hash":        "sha256:hex",
    "parent_hash":         "sha256:hex | null",
    "integrity_hash":      "sha256:hex",
    "verification_status": "valid | broken | unverified"
  },

  "lineage": {
    "fork_of":      "ctx_... | null",
    "fork_point":   "ctx_... | null",
    "lineage_root": "ctx_... | null"
  },

  "signature": {
    "algorithm":    "ed25519",
    "key_id":       "string",
    "public_key":   "base64",
    "signature":    "base64"
  },

  "created_at": "ISO 8601"
}
```

### 3.2 Field definitions

#### 3.2.1 Identity fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | **Yes** | Globally unique context identifier. MUST follow the format `ctx_{unix_ms}_{6 random hex bytes}`. Example: `ctx_1774358291224_bad9b976`. |
| `parent_id` | string \| null | No | The `id` of the previous context in the chain. MUST be null for root commits. When present, establishes a directed acyclic graph of contexts forming the execution lineage. |
| `trace_id` | string \| null | No | Groups multiple commits into a single pipeline run. Recommended format: `trc_{hex}`. |
| `branch_key` | string | **Yes** | Branch name for this context. MUST default to `"main"` when not specified. Used to distinguish fork branches from the main chain. |
| `schema_version` | string | **Yes** | Version of the Context Passport specification. Current value: `"1.0"`. |

#### 3.2.2 Agent attribution

| Field | Type | Required | Description |
|---|---|---|---|
| `created_by.agent_id` | string | **Yes** | Unique identifier of the agent that produced this context. |
| `created_by.agent_name` | string | **Yes** | Human-readable name for the agent. |
| `created_by.role` | string | No | Semantic role. Recommended values: `researcher`, `writer`, `reviewer`, `critic`, `planner`, `executor`, `validator`. Custom values are permitted. |
| `created_by.provider` | string | No | LLM provider. Recommended values: `anthropic`, `openai`, `google`, `mistral`, `local`, `custom`. |
| `created_by.model` | string | No | Specific model name or version string. |

#### 3.2.3 Event

| Field | Type | Required | Description |
|---|---|---|---|
| `event.type` | string | **Yes** | The type of event this passport records. See section 3.3. |
| `event.to_agent_id` | string \| null | No | The `agent_id` of the intended recipient. MUST be null for events with no specific recipient (checkpoint, audit). |
| `event.timestamp` | ISO 8601 | **Yes** | The time at which the event occurred, in ISO 8601 format with timezone. |

#### 3.2.4 Payload

All payload fields are optional. Implementations SHOULD use structured JSON objects rather than plain strings wherever possible, as this preserves schema information across the chain.

| Field | Type | Description |
|---|---|---|
| `payload.input` | string \| object \| null | What this agent received as input. |
| `payload.output` | string \| object \| null | What this agent produced. Prefer structured JSON. |
| `payload.memory` | object \| null | Persistent state, runtime parameters, tool results, or configuration. |
| `payload.variables` | object \| null | Named values intended for consumption by downstream agents. |

#### 3.2.5 Integrity

The integrity block MUST be computed by the implementation at commit time. Clients MUST NOT set these fields manually.

| Field | Description |
|---|---|
| `payload_hash` | SHA-256 of the canonicalized payload. See section 3.4. Formatted as `sha256:{hex}`. |
| `parent_hash` | The `integrity_hash` of the parent commit. Null for root commits. Formatted as `sha256:{hex}` or null. |
| `integrity_hash` | SHA-256 of the concatenation of `payload_hash` and `parent_hash`. See section 3.4. |
| `verification_status` | `valid` if the chain is intact to this point. `broken` if a hash mismatch is detected. `unverified` if verification has not been performed. |

#### 3.2.6 Lineage

Populated automatically by implementations on fork operations.

| Field | Description |
|---|---|
| `lineage.fork_of` | The `id` of the context that was forked from. |
| `lineage.fork_point` | The `id` of the checkpoint where the fork began. |
| `lineage.lineage_root` | The `id` of the root context of the original chain. |

#### 3.2.7 Signature (optional)

The signature block is optional but RECOMMENDED for any implementation that requires non-repudiation. When present, the signature MUST be computed over the canonical bytes of the envelope with the `signature.signature` field cleared. Canonical bytes are produced by the algorithm in section 3.4 (RFC 8785 / JCS for v2.0 records; the v1.x algorithm for v1.x records).

| Field | Description |
|---|---|
| `signature.algorithm` | Signature algorithm. RECOMMENDED: `ed25519`. Other values: `ecdsa-p256`, `rsa-pss-sha256`. |
| `signature.key_id` | Key identifier used to sign. Implementations SHOULD use stable, rotation-aware identifiers. |
| `signature.public_key` | Base64-encoded public key, or a reference (DID, URL) that resolves to the public key. |
| `signature.signature` | Base64-encoded signature bytes over the canonical envelope. |

Implementations that omit the signature block produce passports with tamper evidence (via the integrity hash chain) but without non-repudiation. Implementations that include the signature block produce passports where authorship can be proven to any third party holding the public key.

### 3.3 Event types

#### Developer events
`commit` `fork` `checkpoint` `revert` `branch` `merge` `spawn` `retry` `timeout` `error`

#### Compliance events
`override` `consent` `escalate` `redact` `audit`

Custom event types are permitted. Implementations SHOULD prefix custom types with a namespace: `myorg.custom_type`.

### 3.4 Integrity computation

Implementations MUST compute the integrity block as follows:

```
canonical_payload = canonical_json(payload)
payload_hash      = "sha256:" + hex(sha256(canonical_payload))

if parent exists:
  parent_hash    = parent.integrity.integrity_hash
  chain_input    = payload_hash + parent_hash
else:
  parent_hash    = null
  chain_input    = payload_hash + "root"

integrity_hash   = "sha256:" + hex(sha256(chain_input))
```

#### 3.4.1 Canonical-JSON algorithm (v2.0)

`canonical_json(value)` produces a deterministic UTF-8 byte sequence for any JSON value. v2.0 of this specification adopts [RFC 8785: JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785) as the normative algorithm. All conformant v2.0 implementations MUST produce byte-identical output for the same input JSON value.

In summary, JCS specifies:

1. **Key order.** Object keys are sorted at every level by UTF-16 code-unit order.
2. **No whitespace.** No spaces, tabs, or newlines between tokens.
3. **String escaping.** Only the seven JSON-mandated control-character escapes plus `"` and `\\`. All other Unicode characters are emitted as raw UTF-8 bytes.
4. **Number formatting.** Per the ECMAScript `Number.prototype.toString` algorithm: integer-valued numbers serialize without a decimal point, negative zero collapses to `0`, trailing zeros are removed, and scientific notation is deterministic. `NaN` and `Infinity` are not representable and MUST be rejected.
5. **Output encoding.** The output is a UTF-8 byte sequence. SHA-256 is computed over those bytes.

Refer to RFC 8785 for the full algorithm. Reference implementations: [`jcs`](https://pypi.org/project/jcs/) (Python), [`canonicalize`](https://www.npmjs.com/package/canonicalize) (TypeScript). Either may be used; the reference SDKs implement JCS inline to avoid an extra dependency.

#### 3.4.2 Numeric range constraint

JCS specifies number serialization but cannot widen the range of numbers a host language can represent. Implementations in languages whose default number type is IEEE-754 double precision (e.g., JavaScript) cannot losslessly carry integers outside `[-(2^53 − 1), 2^53 − 1]`. Applications that need arbitrary-precision integer values MUST encode them as strings in the payload.

#### 3.4.3 v1.x compatibility

v1.x records remain verifiable under v2.0 via the compatibility shim shipped in the reference implementations (`context_passport.compat.v1` in Python, `@contextpassport/core/compat/v1` in TypeScript). Verifiers dispatch per-record on `schema_version`: records carrying `"1.0"` or any other `"1.x"` value are hashed using the v1.x algorithm; everything else uses JCS. Mixed-version chains are valid and verify correctly.

The v1.x canonical-JSON algorithm (sorted keys; `json.dumps(value, separators=(",", ":"))` in Python; `JSON.stringify` with a sorted-keys replacer in TypeScript) is retained in the shim solely for backwards compatibility. New implementations SHOULD NOT produce v1.x records.

#### 3.4.4 Verification

**Verification** of a chain requires only the sequence of passports. For each passport after the root:
1. Recompute `payload_hash` from the stored payload.
2. Fetch the parent passport's `integrity_hash`.
3. Recompute `integrity_hash` from `payload_hash + parent_integrity_hash`.
4. Compare with the stored `integrity_hash`.

If any comparison fails, the chain is `broken` at that point.

---

## 4. Conformance

An implementation is **Context Passport v2.0 conformant** if it:

1. Produces passports that validate against the JSON Schema at `schema/v2.json`.
2. Correctly computes the integrity block per section 3.4 using RFC 8785 (JCS).
3. Correctly links parent commits via `parent_id`.
4. Correctly verifies chains by recomputing hashes. For mixed-version chains, dispatches per-record on `schema_version` (v1.x records use the v1.x algorithm; v2.x records use JCS).
5. Sets `schema_version: "2.0"` on all newly produced passports.
6. Passes the polyglot conformance harness at [`contextpassport/conformance-tests`](https://github.com/contextpassport/conformance-tests).

Conformant implementations are encouraged to list themselves in the implementations registry at `github.com/contextpassport/spec/IMPLEMENTATIONS.md`. A conformance test suite is published at `github.com/contextpassport/conformance-tests`. An implementation may declare itself conformant only after passing all required test vectors.

---

## 5. Security considerations

### 5.1 Tamper evidence vs tamper prevention

Context Passport provides tamper **evidence**, not tamper **prevention**. The hash chain makes modification detectable after the fact — it does not prevent modification. For stronger guarantees, implement at the storage layer (immutable append-only storage, WORM drives, or cryptographic timestamping services).

### 5.2 Payload confidentiality

Context Passport does not encrypt payloads. Implementations that need payload confidentiality SHOULD encrypt the payload before committing and decrypt after retrieval, using a key held by the client (BYOK pattern). The integrity hash is computed over the ciphertext in this case.

### 5.3 Agent identity

The `created_by.agent_id` field is self-reported by the committing agent. It is not cryptographically verified by the schema. Implementations that require verified agent identity SHOULD use W3C Decentralized Identifiers (DIDs) in the `created_by.agent_id` field and verify the DID document at verification time.

### 5.4 Completeness vs. integrity

This specification provides guarantees about the **integrity** of records that are created — they cannot be modified, reordered, or backdated without detection. It does not and cannot guarantee **completeness** — that every event the agent should have recorded was in fact recorded. A client who controls record creation can omit records they choose not to create, and no cryptographic system can reveal the omission.

Implementations and integrators that require completeness guarantees (e.g., regulated audit trails) MUST combine Context Passport with one or more of:

- **Continuity expectations** established by contract, regulation, or SLA, so that gaps are auditable through non-cryptographic means.
- **Counterparty reconciliation** with records from a second party to the same event (see `proposals/context-passport-for-mcp.md` for the MCP server/client pattern).
- **External anchoring at creation time** (e.g., OpenTimestamps) so that the existence of a record is provable independent of whether it later reaches a particular receiving server.

See `docs/throughput-and-trust.md` for a full discussion of submission patterns, trust properties, and defenses.

### 5.5 Submission timing and trust

A passport has three timing moments worth distinguishing — creation time, server-receipt time, and witness-inclusion time. Client-side batching, asynchronous submission, and offline operation widen the gap between these timestamps without affecting the integrity of the records themselves, provided records are signed at creation time. Implementations choosing to batch SHOULD also sign at creation time so the trust properties of the batched workflow match those of synchronous submission.

See `docs/throughput-and-trust.md` for the full taxonomy and recommended SDK patterns.

---

## 6. IANA considerations

This specification does not require any IANA actions.

---

## 7. References

- JSON: ECMA-262, ECMA-404
- SHA-256: NIST FIPS 180-4
- ISO 8601: Date and time format
- W3C DID: Decentralized Identifiers v1.0
- CC0 1.0: Creative Commons Zero

---

## Appendix A: Minimal implementation (Python)

```python
import json, hashlib, math, time, secrets

def _normalize(value):
    """JCS number normalization: reject non-finite, fold integer-valued floats to int."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise ValueError("JCS does not permit NaN or Infinity")
        if value == 0:
            return 0
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(v) for v in value]
    return value  # int, str

def make_passport(agent_id, agent_name, payload, parent=None,
                  to_agent_id=None, role=None, provider=None, model=None,
                  event_type="commit", trace_id=None, branch_key="main"):

    ts    = str(int(time.time() * 1000))
    hex_  = secrets.token_hex(6)
    ctx_id = f"ctx_{ts}_{hex_}"

    # RFC 8785 (JCS) canonicalization: sorted keys, raw UTF-8, normalized numbers.
    canonical  = json.dumps(_normalize(payload), sort_keys=True, ensure_ascii=False,
                            separators=(',', ':'))
    pay_hash   = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    if parent:
        parent_hash = parent["integrity"]["integrity_hash"]
        chain_input = pay_hash + parent_hash
        parent_id   = parent["id"]
    else:
        parent_hash = None
        chain_input = pay_hash + "root"
        parent_id   = None

    int_hash = "sha256:" + hashlib.sha256(chain_input.encode()).hexdigest()

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    return {
        "$schema":        "https://contextpassport.com/schema/v2.json",
        "schema_version": "2.0",
        "id":             ctx_id,
        "parent_id":      parent_id,
        "trace_id":       trace_id,
        "branch_key":     branch_key,
        "created_by": {
            "agent_id":   agent_id,
            "agent_name": agent_name,
            "role":       role,
            "provider":   provider,
            "model":      model,
        },
        "event": {
            "type":        event_type,
            "to_agent_id": to_agent_id,
            "timestamp":   now,
        },
        "payload": payload,
        "integrity": {
            "payload_hash":        pay_hash,
            "parent_hash":         parent_hash,
            "integrity_hash":      int_hash,
            "verification_status": "valid",
        },
        "lineage": {
            "fork_of":      None,
            "fork_point":   None,
            "lineage_root": None,
        },
        "created_at": now,
    }

def verify_chain(passports):
    """Returns True if chain is intact, False if any hash mismatch detected."""
    prev = None
    for p in passports:
        canonical  = json.dumps(_normalize(p["payload"]), sort_keys=True,
                                ensure_ascii=False, separators=(',', ':'))
        pay_hash   = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        parent_hash = prev["integrity"]["integrity_hash"] if prev else None
        chain_input = pay_hash + (parent_hash or "root")
        expected    = "sha256:" + hashlib.sha256(chain_input.encode()).hexdigest()
        if p["integrity"]["integrity_hash"] != expected:
            return False
        prev = p
    return True
```

---

## Appendix B: JSON Schemas

The machine-readable JSON Schemas are in this repository:

- `schema/v2.json` — current specification (v2.0)
- `schema/v1.json` — retained for verifying v1.x records via the compatibility shim

---

*Context Passport Specification v2.0. Specification released under CC0 1.0. Reference implementations released under Apache-2.0. Maintained by the Context Passport maintainers. Contributions welcome via GitHub.*
