# Threat Model

**Status:** Non-normative reference
**Audience:** Security architects, implementation reviewers, anyone running a Context Passport pipeline in an adversarial environment
**Companion to:** [SPEC.md §5 — Security considerations](../SPEC.md#5-security-considerations)

---

## Why this document exists

A standard that does not state what it defends against, and what it does not, gets evaluated against an imagined threat model that may not match reality. Implementations underbuild because they assume the spec defends more than it does, or overbuild because they assume it defends less. Auditors flag both as deficiencies.

This document states explicitly what Context Passport is designed to protect, against whom, and what defense-in-depth assumptions an implementer must layer on top.

It is based on the threat-modeling pattern from [Microsoft STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats) and the asset-adversary structure used by NIST SP 800-30 and the IETF security-considerations conventions.

---

## 1. Assets being protected

In priority order:

### A1 — Integrity of recorded events

The bytes of a committed passport must not be modifiable after creation without detection. Modification includes changing a single field, removing a field, reordering fields within the JSON, or substituting a different payload entirely.

**Why this matters:** the entire value proposition of a verifiable record collapses if records can be silently changed. Every regulatory and operational use case requires this.

### A2 — Attribution of records to their creator

Each record must be cryptographically attributable to the agent or operator that created it, in a way the creator cannot later repudiate.

**Why this matters:** in any post-incident analysis, the question "who did this?" must have a verifiable answer that does not rely on operator claims.

### A3 — Chronological ordering of records

The chain of records must reflect the true causal order of events. An attacker must not be able to insert a record at an earlier point in the chain, reorder records, or backdate.

**Why this matters:** reconstructing what happened in what order is the foundation of forensic analysis.

### A4 — Independence of verification

A third party must be able to verify A1-A3 without trusting the operator, the agent, or any single component. Verification must work offline, with no network call to a vendor, when given the records and the proof material.

**Why this matters:** this is the property that distinguishes a verifiable record from an audit log. A log requires trusting the logger; a verifiable record does not.

### A5 — Completeness of records (best-effort, not guaranteed)

To the extent possible, the system surfaces signals when expected records are missing.

**Why this matters:** see §5 on what Context Passport cannot guarantee. Completeness is a contractual and process property, not a cryptographic one.

---

## 2. Trust boundaries

The Context Passport architecture has five trust boundaries. An adversary on the far side of any boundary can affect different aspects of the threat model.

```
                  ┌──────────────────────────────────────────────────┐
                  │                                                  │
                  │  Agent runtime                                   │
                  │  (Trust boundary 1: agent vs. agent operator)    │
                  │                                                  │
                  └────────────────────┬─────────────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────────────────┐
                  │                                                  │
                  │  Client SDK                                      │
                  │  (Trust boundary 2: SDK vs. local environment)   │
                  │                                                  │
                  └────────────────────┬─────────────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────────────────┐
                  │                                                  │
                  │  Network                                         │
                  │  (Trust boundary 3: client vs. transit)          │
                  │                                                  │
                  └────────────────────┬─────────────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────────────────┐
                  │                                                  │
                  │  Receiving server                                │
                  │  (Trust boundary 4: client vs. operator)         │
                  │                                                  │
                  └────────────────────┬─────────────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────────────────┐
                  │                                                  │
                  │  External anchor / Witness Log                   │
                  │  (Trust boundary 5: operator vs. third party)    │
                  │                                                  │
                  └──────────────────────────────────────────────────┘
```

Each adversary in §3 operates on one side of one of these boundaries.

---

## 3. Adversaries

### Adv-1: Modification attacker (downstream)

A party with access to records *after* they have been created. They want to alter a stored record to misrepresent what happened.

**Capability:** read and write access to record storage; cannot create new records signed by the original creator.

**What the spec defends against this:** the hash chain (SPEC.md §3.4). Modifying any field changes the `payload_hash`, which breaks the `integrity_hash`, which breaks every subsequent record's `parent_hash`. Detection is mechanical.

**What the spec adds with signature:** SPEC.md §3.2.7's signature defeats modification even on a single isolated record (no chain context needed).

**Residual risk:** none, given client-side signing at creation time.

### Adv-2: Forgery attacker

A party who wants to inject false records claiming to come from a specific agent or operator.

**Capability:** can submit arbitrary data to the receiving server.

**What the spec defends against this:** with signature, the attacker must produce a valid Ed25519 (or other algorithm) signature over the envelope. Without the private key, they cannot. The receiving server validates the signature against the embedded public key and the key's known association with the claimed identity.

**Residual risk:** if the private key is compromised (Adv-7), forgery is undetectable. Defense: HSM-bound keys, key rotation, revocation infrastructure (docs/key-management.md).

### Adv-3: Omission attacker

A party who controls record creation and wants to *not record* a specific event they would normally be expected to record.

**Capability:** controls what the SDK calls; can choose not to emit certain commits.

**What the spec defends against this:** **nothing direct.** SPEC.md §5.4 makes this explicit. No cryptographic system can force record creation.

**What an operator can layer on top:**
- Continuity expectations (contractual or regulatory)
- Counterparty reconciliation (when the event involves a second party)
- External attestation (the agent is monitored by an independent process that emits its own records)
- Sequence numbers in a namespaced extension, with gap detection downstream

**Residual risk:** real and significant for adversarial environments. A malicious agent operator can always omit. This is a fundamental property of any audit system, not a Context Passport-specific limitation.

### Adv-4: Backdating attacker

A party who creates a record but sets `event.timestamp` to an earlier time, claiming the event happened before it actually did.

**Capability:** controls record creation; controls the timestamp field.

**What the spec defends against this:** the embedded signature signs the timestamp (it's part of the canonical envelope). Modifying the timestamp after signing breaks the signature. But signing it with an early timestamp at creation time is permitted by the spec.

**What an operator must layer on top:** external anchoring at creation time. If the `payload_hash` is submitted to OpenTimestamps (or a TSA, or Sigstore Rekor) at the moment of creation, the anchor proves the hash existed at the externally-attested time. A backdated record cannot have an external anchor from before the time it was actually created.

**Residual risk:** without external anchoring, backdating is undetectable. With external anchoring at creation time, defeated.

### Adv-5: Replay attacker

A party who captures a legitimate record in transit and resubmits it, attempting to have it accepted as a fresh record.

**Capability:** network observation or compromised intermediate; cannot modify the record itself (would invalidate signature).

**What the spec defends against this:** the `id` field of a passport is unique (per the format `ctx_{unix_ms}_{6_hex_bytes}`). The receiving server SHOULD reject any commit with a duplicate `id`. This is operator-level defense, not strictly required by the spec, but every conformant implementation should do it.

**Residual risk:** if the receiving server does not deduplicate, a replayed record produces a duplicate entry. Mitigated by requiring all conformant servers to deduplicate by `id`.

### Adv-6: Compromised receiving server

The operator's receiving server is compromised by an external attacker or insider. The attacker can read, write, and delete records.

**Capability:** full control of stored records and the Witness Log signing process.

**What the spec defends against this — partially:**

- Past records that were already externally-anchored: cannot be modified without detection. The hash chain plus the external anchor make the historical record provable independent of the compromised server.
- Past records with client-side signatures: cannot be forged because the attacker doesn't have the client's private key.
- Future records: the compromised server can produce fraudulent records, signed with whatever key it controls. Detectable only if downstream consumers compare against a separately-witnessed chain (e.g., a customer-side mirror, a second Witness Log operator).

**What the spec adds with the Witness Log:** docs/witness-log.md §8's threat model. The Witness Log's append-only, externally-anchored chain makes long-term silent compromise detectable. A compromised server cannot rewrite history without producing a visible fork in the published chain.

**Residual risk:** real-time compromise of the receiving server allows producing fraudulent new records that may pass verification until the compromise is detected. Defense: multi-operator cross-witnessing (a second Witness Log operator countersigns or independently anchors).

### Adv-7: Compromised signing key

The agent's or operator's private signing key is exfiltrated. The attacker can produce records that verify as authentic.

**Capability:** indistinguishable from the legitimate key holder at the cryptographic layer.

**What the spec defends against this:** nothing at the cryptographic layer. A valid signature is valid.

**What the operator must layer on top:**

- Detection (anomaly detection on signing patterns, monitoring for unexpected key usage)
- Revocation (docs/key-management.md §6)
- Forward security through frequent rotation
- HSM-bound keys that cannot be exfiltrated in the first place (the strongest defense)

**Residual risk:** records produced between compromise and revocation are indistinguishable from legitimate records. Detection lag is the residual.

### Adv-8: Malicious agent operator

The operator who runs the agent is themselves the adversary. They want to produce records that look legitimate but represent a different reality than what the agent actually did.

**Capability:** controls the agent runtime, the SDK, the keys, the receiving server, and the records.

**What the spec defends against this — almost nothing:** if the operator controls all the parties, they can produce internally-consistent records that lie about what happened. This is the limit of any single-party verifiable-record system.

**What defeats this:**
- Counterparty records. If the action involves a second party (a payment processor, an MCP server operated by someone else, a regulator's witness), the second party's records are an independent witness.
- External anchoring at creation time. Even an operator-controlled chain that is anchored externally cannot be retroactively edited; if the lie is discovered later, the operator cannot cover it by rewriting history.
- Independent observation. A monitoring system (sandboxed, network-restricted) that observes the agent's actual behavior and produces its own records.

**Residual risk:** real. The standard cannot protect against an operator who controls everything. The mitigation is structural — counterparty reconciliation, regulatory presence, external observers — not cryptographic.

### Adv-9: Compromised OTS calendar or external anchoring service

The external anchoring service (OpenTimestamps calendar, RFC 3161 TSA, Sigstore Rekor) is compromised or colludes with the operator.

**Capability:** can claim a hash was anchored at a time other than when it actually was; can refuse to anchor; can publish anchors for hashes not submitted to it.

**What the spec defends against this:** the spec recommends multiple independent anchoring services (docs/external-anchoring.md). A single compromised calendar is detectable if its claims diverge from other calendars' claims for the same hash.

**For OpenTimestamps specifically:** the calendar is not the trust root. The Bitcoin blockchain is. A calendar can lie about timing only until its claimed anchor is checked against the actual Bitcoin block, at which point the lie is exposed. A calendar can refuse to anchor (denial of service), in which case operators should submit to multiple calendars.

**Residual risk:** very low. Multi-calendar submission plus the Bitcoin trust root make this adversary effectively defeated.

### Adv-10: Network attacker

A party who can read, drop, modify, or inject network traffic between the client and the receiving server.

**Capability:** full network control.

**What the spec defends against this:** modification is detectable via signature and hash chain. Injection of forged records is defeated by signature requirement. Dropping records is undetectable at the cryptographic layer but visible as a delayed-receipt anomaly at the operator.

**What every implementation must layer on top:**
- TLS for the client-to-server transport (out of scope for the spec but mandatory)
- Client-side persistence so dropped commits can be retried (docs/throughput-and-trust.md)
- Server-side acknowledgment so clients know a record was received

**Residual risk:** very low with TLS + retry semantics.

### Adv-11: Coercion attacker

A party with legal or physical power to compel the operator to produce or modify records on demand (subpoena, hostage situation, state-level pressure).

**Capability:** can force the operator to do anything the operator could technically do.

**What the spec defends against this — partially:**

- Past externally-anchored records cannot be modified by the operator, even under coercion. The Bitcoin chain does not respond to subpoenas.
- The operator can be compelled to produce records, but the records' integrity is independent of the operator's cooperation.

**What the spec does not defend against:**
- The operator can be compelled to stop producing records.
- The operator can be compelled to disclose past records (though regulators usually want this).
- The operator can be compelled to produce future records with a different schema or under duress, which downstream verifiers would have no way to distinguish from voluntary records.

**Residual risk:** specific to high-coercion environments. Operators in such environments may need to implement "warrant canaries" or use additional cryptographic constructions outside the scope of this spec.

---

## 4. Severity ratings

| Adversary | Spec defense | Severity if defense fails |
|---|---|---|
| Adv-1 Modification | Strong | Low (cryptographically defeated) |
| Adv-2 Forgery | Strong with signature | Medium (depends on key protection) |
| Adv-3 Omission | None | High (fundamental limit) |
| Adv-4 Backdating | Strong with external anchor | Medium (without anchor) |
| Adv-5 Replay | Operator-level deduplication | Low (mechanical defense) |
| Adv-6 Compromised server | Witness Log helps | High in real-time, low for history |
| Adv-7 Compromised key | None at crypto layer | High until revocation |
| Adv-8 Malicious operator | Structural only | High in single-party, low with counterparty |
| Adv-9 Compromised anchor | Multi-calendar defeats | Very low |
| Adv-10 Network | TLS + retry | Very low |
| Adv-11 Coercion | Partial (history preserved) | High for future records |

---

## 5. What Context Passport cannot defend against (concise)

Restated for clarity:

1. **Records the agent chose not to create.** Cryptography cannot reveal absence.
2. **A fully-controlling malicious operator with no counterparty involvement.** All parts can be controlled; the lie is self-consistent.
3. **Compromised signing keys, until revocation lands.** A valid signature is valid.
4. **Coerced future-record production.** The operator can be forced to produce records that misrepresent reality going forward, with no cryptographic remedy.
5. **Quantum-relevant adversaries.** Ed25519 and ECDSA are not post-quantum secure. Addressed in a future major version (docs/migration-and-versioning.md).

For each, the mitigation is layered: contractual, structural, procedural, or future-spec. Implementers in adversarial environments must layer accordingly.

---

## 6. Defense-in-depth recommendations

For implementers building production deployments, the following are not required by the spec but strongly recommended:

### 6.1 Always sign

Even though signature is optional in SPEC.md §3.2.7, treat it as required in production. The cost is small (a few hundred microseconds per commit); the benefit is defeating Adv-1, Adv-2, Adv-4 (with external anchor), and Adv-7's pre-compromise window.

### 6.2 Always anchor externally

OpenTimestamps is free. The latency is acceptable for almost all use cases (asynchronous; doesn't block commits). The defense against Adv-4 and Adv-6 is significant.

### 6.3 Use HSM-bound keys for signing

Defeats Adv-7's exfiltration vector. The key never leaves the secure enclave. The cost (KMS subscription or HSM hardware) is small relative to the threat reduction.

### 6.4 Run a Witness Log with cross-party witnessing

Defeats Adv-6 and reduces Adv-8 to "compromise the operator AND the cross-witness simultaneously," which is harder.

### 6.5 Deduplicate by `id` at the receiving server

Defeats Adv-5. Mechanical, low-cost, no excuse not to.

### 6.6 Implement key rotation on a schedule

Annual at minimum. Defeats long-term Adv-7 by limiting the window in which a compromised key can produce fraudulent records.

### 6.7 Monitor for anomalies

Pattern-based detection (signing rate, source IP, signing key, payload shape) catches Adv-7 faster than manual inspection. Out of scope for the spec; should be in every operator's runbook.

### 6.8 Establish continuity expectations contractually

Defeats Adv-3 by moving "omission" from "undetectable cryptographically" to "contractually auditable." Belongs in the operator's SLA with their customers and in customers' policies for their agents.

---

## 7. Threat-model assumptions stated explicitly

The above analysis assumes:

- **The hash function (SHA-256) is collision-resistant.** True today. If broken, the spec moves to a new hash in a major version (docs/migration-and-versioning.md).
- **The signature algorithm (Ed25519) is forgery-resistant.** True today against classical adversaries; not post-quantum secure.
- **TLS is configured correctly for client-to-server transport.** Out of scope; the operator's responsibility.
- **The operator's storage layer is honest about append-only semantics.** Should be enforced at the database level, not just the application level.
- **The operator's GPG key (for Witness Log signing) is not compromised.** If it is, see Adv-6.
- **The external anchoring service (Bitcoin via OTS) is not subverted at the protocol level.** Treating Bitcoin's security as adequate for record-timestamping purposes is a widely-accepted assumption.

If any of these assumptions fails in your environment, the corresponding defenses degrade. Operators are encouraged to document their own threat-model assumptions in their security documentation, referencing this document where helpful.

---

## 8. Comparison to related systems

To calibrate expectations, here is how Context Passport's threat model compares to adjacent systems:

| System | Defends modification | Defends forgery | Defends omission | Independent verification |
|---|---|---|---|---|
| Database audit log (no chain) | Operator-trusted only | Operator-trusted only | No | No |
| Append-only DB (e.g. immudb) | Yes | Operator-trusted | No | Requires server cooperation |
| Hash-chained log (e.g. AWS QLDB) | Yes | Operator-trusted | No | Requires AWS |
| Certificate Transparency | Yes | Yes | No | Yes (the entire point) |
| Sigstore Rekor | Yes | Yes | No | Yes |
| Blockchain (Bitcoin) | Yes | Yes | No | Yes |
| **Context Passport (this spec)** | **Yes** | **Yes (with signature)** | **No (fundamental)** | **Yes (with anchoring)** |

Context Passport sits in the same architectural family as Certificate Transparency and Sigstore Rekor. The defense properties are essentially the same; the domain is different (agent execution records vs. TLS certificates vs. software artifacts).

---

## 9. How to use this document

For a security review of a Context Passport deployment:

1. Identify which adversaries are in scope for the deployment.
2. For each in-scope adversary, confirm the corresponding defenses (cryptographic + operator-layered) are in place.
3. For adversaries where the spec offers no direct defense (Adv-3, Adv-8, Adv-11), confirm the operator has layered structural defenses.
4. Document the residual risk explicitly. Honest residual-risk documentation is itself a control.

For a regulator evaluating Context Passport-based pipelines:

1. The spec defends against the cryptographic adversaries (Adv-1, Adv-2, Adv-4, Adv-5, Adv-10) reliably.
2. Operator-layered defenses are required for the operational adversaries (Adv-3, Adv-6, Adv-7, Adv-8, Adv-11).
3. Verify both layers, not just the cryptographic one.

For an SDK or implementation reviewer:

1. Confirm the implementation does not introduce defects relative to the spec's defenses (e.g., a buggy canonicalization that weakens the hash chain).
2. Confirm the implementation makes the defense-in-depth recommendations easy to enable (signature on by default in production, anchoring as an SDK feature, etc.).

---

## 10. Reporting a vulnerability

If you discover a defect in the spec, a reference implementation, or this threat model, please report it privately to **security@contextpassport.com** per `SECURITY.md`. We follow coordinated disclosure.

---

*Context Passport — design notes for implementers and security reviewers. Released under CC0 along with the rest of the specification.*
