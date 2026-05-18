# Key Management

**Status:** Non-normative design note
**Audience:** SDK implementers, security architects, operators of signed-passport pipelines
**Companion to:** [SPEC.md §3.2.7 — Signature](../SPEC.md#327-signature-optional), [SPEC.md §5.3 — Agent identity](../SPEC.md#53-agent-identity)

---

## Why this document exists

The Context Passport specification defines the `signature` block (SPEC.md §3.2.7) but is deliberately silent on how clients obtain, store, rotate, and revoke the keys used to produce those signatures. That silence is correct — key management is a deep field with many valid patterns and no universal answer. But it leaves implementers with the practical question: *what should I actually do?*

This document describes three patterns the maintainers have seen work in practice, with concrete guidance on when to use each. None are normative. An implementation may choose any approach that produces verifiable signatures over canonical envelopes.

---

## 1. The three patterns

| Pattern | Key location | Identity proof | When to use |
|---|---|---|---|
| File-based | Local keyfile or env var | Implicit (operator vouches) | Solo dev, single-tenant prototypes, fixed-agent deployments |
| PKI / X.509 | Hardware token, HSM, KMS | X.509 certificate chain | Enterprise environments with existing PKI |
| DID-based | DID document at a resolvable URL | DID document signed by a public key | Multi-party agent ecosystems, cross-organization workflows |

These are not mutually exclusive. A production deployment can have file-based keys for development, PKI keys for staging, and DID-based identity for production agents — the spec doesn't care which is in use at signing time, only that the resulting signature verifies against the embedded public key.

---

## 2. File-based keys

The simplest pattern. A keypair is generated once and persisted to a file readable only by the agent's process.

### Generation

```python
from context_passport.signing import generate_keypair, public_key_to_base64
from cryptography.hazmat.primitives import serialization

private, public = generate_keypair()

# Persist private key (PEM-encoded, encrypted with a passphrase)
with open("agent-key.pem", "wb") as f:
    f.write(private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.BestAvailableEncryption(b"passphrase-from-secret-store"),
    ))

# The public key (base64, raw 32 bytes) is what goes into passport.signature.public_key
print("public_key:", public_key_to_base64(public))
```

### Loading at signing time

```python
from cryptography.hazmat.primitives import serialization
from context_passport.signing import sign_passport

with open("agent-key.pem", "rb") as f:
    private = serialization.load_pem_private_key(f.read(), password=b"passphrase-from-secret-store")

signed = sign_passport(passport, private, key_id="agent-key-2026-05")
```

### Operational rules

- **Never check keyfiles into version control.** Use `.gitignore` plus repository-level secret scanning.
- **Store the passphrase in a real secret manager** — environment variable injected from AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, 1Password CLI, etc. Never hardcode.
- **Lock down file permissions** — `chmod 400 agent-key.pem`. On Windows, restrict ACL to the service account that runs the agent.
- **Rotate annually at minimum**, or whenever the operator who knows the passphrase leaves the team. See §5.

### When file-based breaks down

- More than one agent process needs the same key. Now you have a secrets-distribution problem.
- The key is needed inside an environment where you don't control filesystem access (some serverless platforms, sandboxed compute).
- A regulator requires that key material be held in a certified module (FIPS 140-2 Level 3 or similar).

For any of those, move to §3 or §4.

---

## 3. PKI / X.509-based keys

Used by organizations with an existing internal certificate authority or a relationship with a commercial CA. The signing key lives in an HSM, a YubiKey, or a cloud KMS; the public key is wrapped in an X.509 certificate that chains to a trusted root.

### Why this pattern

- Key material never leaves the secure enclave. The agent process calls `sign(bytes)` and receives a signature; the private key bytes are never seen.
- Identity verification is built in — the X.509 chain provides agent identity (subject DN), validity period (notBefore/notAfter), and revocation status (CRL/OCSP).
- Compliance teams already understand this model. PKI has been the audited backbone of enterprise authentication for decades.

### Adapting to Context Passport

Context Passport's `signature` block expects an Ed25519, ECDSA-P256, or RSA-PSS-SHA256 signature with a raw public key. X.509 wraps an RSA or EC key with metadata. Two integration patterns:

**Pattern A — pass the raw public key, store the cert separately.**

```python
# At signing time
cert = load_x509_cert("/etc/agent-certs/agent.pem")
raw_public_key = cert.public_key()
# Use signing.sign_passport() with algorithm matching the cert's key type
```

The passport contains the raw public key. The X.509 certificate is stored alongside the passport for verifiers who want to see the chain. A namespaced extension MAY record the cert location:

```json
{
  "...": "...",
  "x509.cert_uri": "https://certs.example.com/agents/agent-2026-05.pem",
  "x509.subject":  "CN=research-agent-01,OU=AI,O=Example,C=US"
}
```

**Pattern B — embed the full cert chain in the signature block.**

This makes each passport self-contained but bloats every record. Practical only when individual passports are exchanged out-of-band (e.g., a single high-stakes record sent to a regulator).

```json
{
  "signature": {
    "algorithm":  "ecdsa-p256",
    "key_id":     "agent-2026-05",
    "public_key": "<base64 raw key>",
    "signature":  "<base64 signature>",
    "x509.chain": ["<base64 cert>", "<base64 intermediate>", "<base64 root>"]
  }
}
```

The `x509.chain` field is a namespaced extension — verifiers that don't understand it ignore it (per the extension model, EXTENSIONS.md). Verifiers that do, validate the chain in addition to the raw signature.

### Key storage backends

| Backend | Cost | Best for |
|---|---|---|
| AWS KMS / GCP KMS / Azure Key Vault | $1-$3/key/month | Cloud-native workloads. Key never leaves the KMS. |
| YubiKey or other USB HSM | One-time hardware cost | Solo developers needing FIPS-grade key storage |
| Network HSM (Thales Luna, AWS CloudHSM) | $$$ | Regulated industries with FIPS 140-2 Level 3 requirements |
| Software keystore (PKCS#11 token) | Free | When the OS provides one (macOS Keychain, Windows Credential Store) |

The signing API in each case looks the same to the Context Passport SDK — the SDK calls a `sign(bytes)` function; the backend handles where the key actually lives.

### When PKI breaks down

- Multi-organization workflows where no shared CA exists. Two parties cannot agree on a root.
- Highly dynamic agents (created and destroyed in seconds) where issuing an X.509 cert per agent is operational overhead.
- Public agent ecosystems where identity needs to be globally resolvable, not chain-trusted.

For these, move to §4.

---

## 4. DID-based identity

[W3C Decentralized Identifiers](https://www.w3.org/TR/did-core/) (DIDs) decouple identity from any single authority. An agent has a DID like `did:web:example.com:agents:research-01`. The DID resolves (via HTTP for `did:web`, via a registry for `did:key`, `did:ion`, etc.) to a DID Document containing the agent's current public keys.

### Why this pattern

- No central CA. Identity is resolvable by anyone with the DID and an internet connection.
- Key rotation is built-in — the DID stays stable while the keys in the DID Document change.
- Cross-organization workflows work without trust agreements at the CA level.
- The DID can carry rich metadata: agent type, capabilities, service endpoints, controllers.

### Adapting to Context Passport

The passport's `created_by.agent_id` is set to the DID:

```json
{
  "created_by": {
    "agent_id":   "did:web:example.com:agents:research-01",
    "agent_name": "Research Agent",
    "role":       "researcher",
    "provider":   "anthropic",
    "model":      "claude-opus-4-6"
  }
}
```

The `signature` block carries the verification key:

```json
{
  "signature": {
    "algorithm":   "ed25519",
    "key_id":      "did:web:example.com:agents:research-01#key-2026-05",
    "public_key":  "<base64 raw key>",
    "signature":   "<base64 signature>"
  }
}
```

The `key_id` uses the DID URL syntax: `<did>#<key-fragment>`. A verifier:

1. Reads `signature.key_id`, parses out the DID.
2. Resolves the DID to its DID Document.
3. Looks up the key fragment in the DID Document's `verificationMethod` array.
4. Compares the resolved public key with `signature.public_key`. If they match, the binding is verified.
5. Verifies the signature with the public key.

If steps 4 or 5 fail, the passport is not trustworthy regardless of how the integrity chain checks out.

### `did:web` is the recommended starting point

Of the dozens of DID methods, `did:web` is the practical choice for almost all Context Passport users:

- No blockchain dependency.
- The DID Document is just a JSON file hosted at a well-known URL: `https://example.com/.well-known/did.json` (for `did:web:example.com`).
- Rotation = update the JSON file.
- Revocation = remove the key from the JSON file (or remove the entire DID Document).
- Identity is tied to a domain you already control.

A minimal DID Document for an agent:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:example.com:agents:research-01",
  "verificationMethod": [{
    "id":                 "did:web:example.com:agents:research-01#key-2026-05",
    "type":               "Ed25519VerificationKey2020",
    "controller":         "did:web:example.com:agents:research-01",
    "publicKeyMultibase": "z6Mk..."
  }],
  "assertionMethod": ["did:web:example.com:agents:research-01#key-2026-05"]
}
```

Hosted at `https://example.com/agents/research-01/did.json`. The DID resolver fetches that URL when asked to resolve `did:web:example.com:agents:research-01`.

### When DID-based breaks down

- Air-gapped environments where DID resolution requires network access verifiers don't have.
- Highly regulated environments where the regulator does not yet accept DIDs as identity evidence.

In either case, fall back to PKI (§3) or operate the DID Document on an internal-only domain that the regulator can resolve.

---

## 5. Key rotation

Rotation is the act of replacing the active signing key while keeping the agent's identity stable. Three rotation patterns, in order of common preference:

### 5.1 Hard cutover

At time T:
1. Generate new key.
2. Publish new public key (in the DID Document, or in the KMS, or in the keyfile path agents read).
3. From T forward, all new passports are signed with the new key.
4. Old passports remain verifiable because the old public key is embedded in each passport's `signature.public_key`.

Simplest. Used by most production agents. Requires no special infrastructure beyond "make the new key available to the signing process."

### 5.2 Overlap window

At time T0, both old and new keys are active. The agent signs with the new key but the old key remains valid for verification. At time T1 (typically T0 + days/weeks), the old key is deactivated.

Useful when:
- Different agents in a fleet roll over at different times.
- Verifiers cache key material and need time to refresh.
- A bad rotation needs to be quickly reversed.

In a DID-based model: both keys appear in the DID Document's `verificationMethod` array during the overlap window. In a file-based model: the agent reads both keyfiles and uses the newer one for new signatures while keeping the old one resolvable.

### 5.3 Forward-secret rotation

A new key per passport (or per session). The current public key is published; previous keys are not retained. Maximum security; only used when extreme compromise resistance is needed and the operational cost is acceptable.

Rarely the right tradeoff for Context Passport — the passport itself carries the public key, so per-passport keys produce verifiable records, but verifying retrospectively requires retrieving each per-passport key from somewhere.

### Recommendation

For most deployments: **annual hard cutover, with monthly overlap windows during the rotation event**. Schedule the rotation; announce it; execute. Aligns with most compliance frameworks' key-rotation expectations.

---

## 6. Key revocation

Revocation is the act of declaring a previously-valid key no longer trusted. Distinct from rotation: rotation says "use this new key going forward," revocation says "do not trust anything signed by that key, including past records."

Context Passport does not have a native revocation mechanism (a passport signed with a revoked key still verifies cryptographically; the spec leaves revocation to the identity layer). Three patterns:

### 6.1 DID Document removal

Remove the key from the DID Document's `verificationMethod` array. Verifiers who resolve the DID will not find the key, and verification fails at the binding step (step 4 in §4).

This is *prospective* — verifiers caching the old DID Document still verify the signature until their cache expires. Use short TTLs (`Cache-Control: max-age=300` on the DID Document JSON) if revocation timeliness matters.

### 6.2 X.509 CRL / OCSP

The X.509 ecosystem already has Certificate Revocation Lists and Online Certificate Status Protocol. Verifiers check revocation status at verification time. Adds latency to verification (one extra HTTP call) but is well-understood.

Useful when the certs are issued by a CA that publishes a CRL.

### 6.3 Revocation extension field

A namespaced extension carrying the URL of a public revocation list maintained by the operator:

```json
{
  "signature": {
    "...": "...",
    "revocation.list_uri": "https://example.com/.well-known/cp-revoked-keys.json"
  }
}
```

The verifier fetches the list and checks whether `signature.key_id` appears in it. If yes, verification fails regardless of cryptographic validity.

This is implementation-specific and not part of the spec. The pattern is documented here so multiple implementations can converge on the same extension name if useful.

### Revocation does not invalidate the chain

A revoked key does not retroactively invalidate the hash chain. Other passports in the chain remain verifiable. What revocation does is invalidate trust in the signer's attestation — the record "exists" and "was created at a specific time" remain provable; "was authorized by this agent" no longer is.

---

## 7. Multi-agent and multi-key scenarios

### Per-agent keys

Each agent in a multi-agent system has its own keypair. The chain of passports across the system contains signatures from multiple agents, each with their own `signature.key_id`. Verifiers process each passport with its embedded public key.

This is the default and recommended pattern. It localizes compromise (one agent's key compromised doesn't affect others), it scales (no shared key to rotate), and it matches the natural identity model (one agent = one identity).

### Per-key-per-agent rotation

A single agent over time has multiple keys (key-2026-04, key-2026-05, etc.) as it rotates. Each passport embeds the key that signed it. Verifiers do not need to know about the agent's full key history — the passport carries everything they need.

### Shared keys across agents

Anti-pattern in most contexts. If multiple agents share a key:
- Compromise of one agent compromises all
- Attribution is impossible (which agent actually signed?)
- Rotation requires coordinated update across all agents

Only acceptable when the agents are functionally one process (e.g., a horizontally-scaled stateless worker pool where every worker is interchangeable).

### Operator-signed vs. agent-signed

Two interpretations of "the signer":

- **Agent-signed:** the AI agent itself has a key. Most secure attribution.
- **Operator-signed:** the operator's signing infrastructure signs on behalf of the agent. Easier to centralize key management; loses some of the "what the agent actually said" property.

Both produce valid Context Passports. The choice depends on threat model: do you need to prove the agent itself produced the record, or is "the operator vouches that this is what the agent produced" sufficient?

---

## 8. Threat model and what signing actually prevents

Signing is necessary for some properties and irrelevant to others. To set expectations:

**Signing prevents:**
- Modification of the envelope after creation (modification breaks the signature)
- Forgery of records by parties without the private key
- Repudiation by the signer ("I never signed this") — the signature is non-repudiable

**Signing does not prevent:**
- Omission of records the signer chose not to create
- Backdating — the signer can set `event.timestamp` to any value before signing (see external-anchoring.md)
- A malicious operator who controls both the agent and the signing key from producing whatever record they want
- A compromised key from signing fraudulent records

Threat models that require defense against the last two require either: (a) HSM-bound keys the operator cannot extract, (b) multi-party signing (M-of-N), or (c) auxiliary attestation from a non-collaborating party.

The spec deliberately does not address (a)-(c). Implementations can layer them on without modifying the wire format.

---

## 9. Recommended pattern by deployment context

| Context | Pattern | Key storage | Rotation cadence |
|---|---|---|---|
| Solo developer prototype | File-based | Local keyfile + passphrase in env var | Manual, when needed |
| Single-tenant production agent | File-based or KMS | Cloud KMS | Annual |
| Multi-agent within one org | Per-agent file-based or KMS | KMS recommended | Annual |
| Enterprise with PKI | X.509 | HSM or CloudHSM | Per cert validity (1-3 years) |
| Multi-org agent ecosystem | DID-based (`did:web`) | KMS holds key, DID Document points to it | Per-key annually |
| Public ecosystem / standards play | DID-based, multiple key methods | Whatever the ecosystem agrees on | Per DID Document policy |

---

## 10. What this document does not cover

- **Specific HSM vendor integration.** Each vendor has its own SDK. The Context Passport SDK should expose a `sign(bytes) -> bytes` callback that operators wire to whatever signing backend they use.
- **Multi-party signing (threshold/MPC).** Possible but not standardized for Context Passport. The signature block as defined assumes a single signer. Implementations can use namespaced extensions to carry multi-party metadata.
- **Post-quantum migration.** Ed25519 and ECDSA are not post-quantum secure. When NIST-standardized post-quantum signatures (ML-DSA, SLH-DSA) become widely available, a future major version of the spec may add them as supported `algorithm` values. Until then, accept the assumption that quantum-relevant adversaries are not in the threat model.

---

*Context Passport — design notes for implementers. Released under CC0 along with the rest of the specification.*
