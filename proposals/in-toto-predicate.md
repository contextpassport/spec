# Proposal: an in-toto attestation predicate for AI agent decisions

Status: draft, not yet submitted to `in-toto/attestation`.

This is the document we intend to submit as a new predicate type, drafted here
first so it can be reviewed and versioned in the open before being proposed
elsewhere. The in-toto guidelines are explicit that a predicate belongs to the
people who propose it: maintainers give feedback but do not write it.

The four preliminary questions the guidelines require are answered first,
because the answers are the case for the predicate existing at all.

---

## Preliminary questions

### What is the use case?

Software supply chains increasingly contain decisions no human made. An agent
triages a vulnerability report and closes it as a false positive. An agent
approves a dependency bump. An agent decides a failing test is flaky and
re-runs it. An agent drafts and merges a patch.

Each of those changes what ships. None of them currently produces an
attestation, so a policy engine that can verify *how* an artifact was built
cannot ask *who or what decided it should be built that way*.

### Why do the existing predicates not cover it?

The vetted predicates describe process and content:

- **SLSA Provenance** records how an artifact was built: builder, source,
  parameters. It says nothing about a judgement made during the process.
- **Test Result** records what a test harness concluded. An agent's decision is
  not a test with a pass or fail; it has a rationale, a confidence, and
  sometimes a human who overruled it.
- **SCAI** records assertions about attributes and capabilities of a supply
  chain element. It is close, and deliberately general, but it is not shaped to
  carry a decision, its inputs, and its position in a tamper-evident sequence
  of earlier decisions.
- **SPDX / CycloneDX** describe composition, not judgement.

The gap is not "a place to put agent metadata". Provenance could carry that in
`internalParameters`. The gap is a predicate whose subject matter is *a
decision*, with the properties a decision needs: what was asked, what was
concluded, how confident the agent was, whether a human intervened, and whether
the record has been altered since.

### What might the predicate look like?

A Context Passport record, which is an existing CC0 specification for exactly
this, expressed as an in-toto predicate. Concrete example below.

### What policy questions does it answer?

1. Was this artifact produced or approved by an automated agent, and which
   model and provider?
2. Was a human in the loop, and did they override the agent's conclusion?
3. Has the decision record been altered since it was made? The record commits
   to the hash of the decision before it, so an edit anywhere in the sequence
   is detectable.
4. Was a decision taken automatically at a confidence below the threshold that
   should have required escalation?
5. Across a release, were there any agent decisions with no corresponding human
   review where policy required one?

Questions 3 and 5 are the ones nothing else answers today.

---

## Predicate type: AI Agent Decision

Type URI: `https://contextpassport.com/attestation/agent-decision/v0.1`

Version: 0.1.0

Authors: Context Passport maintainers

### Purpose

Expresses a decision made by an automated agent about a supply chain artifact,
together with enough information to verify that the record of that decision has
not been altered since it was made.

The predicate embeds a [Context Passport](https://github.com/contextpassport/spec)
record, a CC0 format whose integrity block is a SHA-256 chain computed over the
RFC 8785 (JCS) canonical form of the payload. Verification requires only the
records: no server, no account, and no trust in the party presenting them.

### Subject

The artifact the decision concerns. A predicate of this type SHOULD NOT be used
with the decision record itself as the subject: the record is the evidence, not
the thing being attested about.

### Schema

```jsonc
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "...", "digest": { "sha256": "..." } }],
  "predicateType": "https://contextpassport.com/attestation/agent-decision/v0.1",
  "predicate": {
    "decision": {
      "agentId": "string",           // stable identifier for the deciding agent
      "agentName": "string",
      "provider": "string",          // e.g. "anthropic", "openai", "self-hosted"
      "model": "string",             // the model that produced the decision
      "eventType": "string",         // Context Passport event type, SPEC.md 3.3
      "decidedAt": "<TIMESTAMP>",    // when the agent reached the decision
      "input": "string",             // what the agent was asked
      "output": "string",            // what it concluded
      "confidence": 0.0              // OPTIONAL, 0..1 as reported by the agent
    },
    "humanOversight": {              // OPTIONAL, omit when no human was involved
      "reviewed": true,
      "overrodeAgent": false,
      "reviewerRef": "string",       // pseudonymous; see Privacy below
      "authority": "string",         // the delegation the reviewer acted under
      "reviewedAt": "<TIMESTAMP>"
    },
    "record": {
      "id": "string",                // Context Passport record id
      "schemaVersion": "2.0",
      "payloadHash": "sha256:...",   // over the JCS canonical payload
      "parentHash": "sha256:...",    // null for the first decision in a chain
      "integrityHash": "sha256:..."
    },
    "chain": {
      "rootId": "string",            // first record in the sequence
      "position": 0,                 // 0-based index of this record
      "length": 0                    // total records at attestation time
    }
  }
}
```

Field names are lowerCamelCase and timestamps are RFC 3339 with timezone `Z`,
per the predicate conventions. Timestamp names say what they mark: `decidedAt`
is when the agent concluded, `reviewedAt` is when a human acted, and neither is
the time the attestation was generated.

### Example

An agent triages a CVE reported against a bundled dependency and concludes the
vulnerable path is unreachable. A human security engineer disagrees and
escalates. Both facts are in the record.

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "acme-api-server:2.4.1",
      "digest": { "sha256": "5f2c9e41a7b03d8c6e15f9a2d47b8c0e3f6a1d9b4c8e2f7a0d3b6c9e1f4a7d2c" }
    }
  ],
  "predicateType": "https://contextpassport.com/attestation/agent-decision/v0.1",
  "predicate": {
    "decision": {
      "agentId": "agent-secops-01",
      "agentName": "Vulnerability Triage Agent",
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "eventType": "audit",
      "decidedAt": "2026-03-29T10:01:00Z",
      "input": "Assess CVE-2026-1471 in transitive dependency parse-yaml@3.2.0 against this service.",
      "output": "not_exploitable: the vulnerable parser path is unreachable from any exported entrypoint",
      "confidence": 0.83
    },
    "humanOversight": {
      "reviewed": true,
      "overrodeAgent": true,
      "reviewerRef": "reviewer_2c9d",
      "authority": "Security Engineering on-call, policy SEC-2026-03",
      "reviewedAt": "2026-03-29T14:22:00Z"
    },
    "record": {
      "id": "ctx_1774778460000_d0c1de01a1b2",
      "schemaVersion": "2.0",
      "payloadHash": "sha256:9f1c7d4e2a8b05c3f6d9e1a4b7c0d3e6f9a2b5c8d1e4f7a0b3c6d9e2f5a8b1c4",
      "parentHash": null,
      "integrityHash": "sha256:31ab6f9c2d5e8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0a3d"
    },
    "chain": {
      "rootId": "ctx_1774778460000_d0c1de01a1b2",
      "position": 0,
      "length": 2
    }
  }
}
```

The agent was wrong, a human caught it, and the record says so. That is the
shape of evidence an auditor asks for and that nothing in the current predicate
set can express.

`eventType` values come from SPEC.md 3.3, which registers `audit` among the
compliance events and permits namespaced custom types such as
`security.vuln_triage` where the registered set is too coarse.

### Parsing rules

This predicate opts in to the general parsing rules, including the monotonic
principle: the absence of a field never implies a stronger claim than its
presence.

Specifically, an absent `humanOversight` means **no claim is made** about
whether a human was involved. It does not assert that none was. A policy that
requires human review MUST require `humanOversight.reviewed` to be present and
`true`, and MUST NOT infer review from the field's absence.

`confidence` is absent when the agent did not report one. Absence is not zero.

### Verification

Two independent checks, and they answer different questions:

1. **The attestation is authentic.** Standard in-toto envelope signature
   verification. Establishes who issued the attestation.
2. **The decision record is unaltered.** Recompute `payloadHash` from the
   payload and `integrityHash` from that and `parentHash`, per SPEC.md 3.4.
   Establishes that the decision has not been rewritten since it was made,
   including by whoever signed the attestation.

The second is the point. An attestation signed by the party that made the
decision proves they said it; the hash chain proves they have not since changed
what they said.

Reference implementations for step 2 are published as
[`context-passport`](https://pypi.org/project/context-passport/) (Python) and
[`@contextpassport/core`](https://www.npmjs.com/package/@contextpassport/core)
(TypeScript), both Apache-2.0, with a CC0 conformance suite.

### Privacy

`input` and `output` are free text and will frequently contain the substance of
a decision about a person. Producers SHOULD NOT place identifying information in
them, and SHOULD reference data subjects and reviewers by opaque handles, as
`reviewerRef` does in the example.

An attestation is intended to be shown to third parties. Anything placed in it
should be assumed to be readable by everyone it is ever shown to, permanently,
because the hash makes redaction detectable rather than silent.

### Changelog

- 0.1.0: initial draft.

---

## Open questions before submission

1. **Namespace.** The type URI above is under `contextpassport.com`. Requesting
   an `in-toto.io/attestation/...` URI is a separate PR and should probably
   follow acceptance rather than precede it.
2. **Relationship to SCAI.** SCAI is deliberately general and could express
   much of this. The argument for a distinct type is that decisions have a
   fixed shape worth standardising, and that the chain field has no SCAI
   equivalent. Worth putting to the maintainers directly rather than assuming.
3. **Chain excerpts.** The predicate carries one record and its position. It
   does not carry the preceding records, so a verifier can detect that a record
   claims a parent but cannot check the parent without fetching it. Whether to
   allow an optional embedded excerpt of ancestors is unresolved.
