# Context Passport Conformance Tests

A test suite that any Context Passport implementation can run against to verify v1.0 conformance.

> **Note:** This is a stub. The full suite will live at `github.com/contextpassport/conformance-tests` after the repository move. The vectors below are the initial set.

## What conformance means

An implementation is **Context Passport v1.0 conformant** if it passes every test in `vectors/required/`. Implementations may additionally pass tests in `vectors/recommended/` to claim stronger conformance levels.

## Conformance levels

| Level | Requirements |
|---|---|
| **Core** | All vectors in `vectors/required/` pass. The implementation can produce and consume passports that validate against `schema/v1.json` and compute integrity hashes correctly. |
| **Signed** | Core, plus all vectors in `vectors/signed/` pass. The implementation produces signed passports (section 3.2.7 of SPEC.md) and verifies signatures correctly. |
| **Full** | Signed, plus all vectors in `vectors/recommended/` pass. The implementation handles fork/merge lineage, extension namespacing, and forward compatibility correctly. |

## Test vectors

### Required (Core)

1. **`v01_root_commit.json`** — A valid root passport with no parent. Integrity hash MUST match `sha256(payload_hash + "root")`.
2. **`v02_chained_commit.json`** — A child passport with `parent_id` and `parent_hash` set. Integrity hash MUST match `sha256(payload_hash + parent_integrity_hash)`.
3. **`v03_canonical_payload.json`** — Two passports with the same payload in different key insertion orders. Both MUST produce identical `payload_hash` values.
4. **`v04_broken_chain.json`** — A chain where one passport's payload has been altered. Verification MUST detect the break and return `verification_status: broken`.
5. **`v05_schema_version.json`** — A passport with `schema_version: "1.0"`. Implementations MUST reject passports missing this field.
6. **`v06_unknown_extension.json`** — A passport with a namespaced extension field (`acme.custom_field`). Implementations MUST accept the passport and ignore the unknown field without error.

### Signed

7. **`v07_ed25519_valid.json`** — A passport with a valid Ed25519 signature. Signature verification MUST succeed.
8. **`v08_ed25519_tampered.json`** — A passport whose payload was modified after signing. Signature verification MUST fail.
9. **`v09_signature_canonicalization.json`** — Signature MUST be computed over the canonical envelope with `signature.signature` cleared.

### Recommended

10. **`v10_fork_lineage.json`** — A fork passport populates `lineage.fork_of`, `lineage.fork_point`, and `lineage.lineage_root` correctly.
11. **`v11_event_types.json`** — Implementations handle all developer and compliance event types without error.
12. **`v12_long_chain.json`** — A chain of 100 commits verifies correctly end-to-end.

## How to run

Each vector is a JSON file. An implementation under test reads the vector, performs the specified operation (produce, verify, hash), and compares output against the expected result also in the vector.

A reference test runner in Python is published alongside this suite.

## Conformance badge

Implementations that pass all required vectors may display:

```
Context Passport v1.0 Core Conformant
```

Implementations that pass signed vectors may display:

```
Context Passport v1.0 Signed Conformant
```

These claims are self-attestation. Independent verification is encouraged.
