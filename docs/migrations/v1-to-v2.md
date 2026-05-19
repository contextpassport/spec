# Migrating from Context Passport v1.x to v2.0

This guide is for operators of pipelines and SDK consumers upgrading from the v1.x line to v2.0. If you only consume v2.0 records from day one, you don't need this guide.

## What changed

v2.0 adopts **RFC 8785 (JSON Canonicalization Scheme / JCS)** as the canonical-JSON algorithm used for `payload_hash`, `integrity_hash`, and the signing envelope. Nothing else in the envelope changes.

The fields, schema, and event types are unchanged. The semantics of `parent_id` linkage, `integrity_hash` derivation, and the signing block are unchanged. Only the byte-level serialization rule changed.

## What that means in practice

For payloads that are pure ASCII strings with integer values in `[-(2^53 − 1), 2^53 − 1]`, v1.x and v2.0 produce **identical bytes and identical hashes**. These records are byte-compatible across versions and need no migration.

For payloads containing **non-ASCII characters**, **emoji**, **floats**, or **integers outside the safe range**, v1.x and v2.0 produce different bytes. A v1.x record will have a `payload_hash` that a v2.0 verifier will not naturally recompute unless it knows to apply the v1.x algorithm.

## How to verify mixed-version chains

The reference SDKs ship a `compat.v1` module. The top-level `verify_chain` dispatches per-record on `schema_version`:

- `schema_version` starts with `"1."` → use the v1.x algorithm (via the compat shim).
- Anything else → use JCS.

This is automatic — no code change required for consumers who just call `verify_chain`. Mixed chains containing both v1.x and v2.0 records verify correctly.

### Python

```python
from context_passport import verify_chain
# Works for v1-only chains, v2-only chains, and mixed chains.
ok = verify_chain([passport1, passport2, ...])

# If you want explicit access to the v1 algorithm:
from context_passport.compat import v1
h = v1.payload_hash(legacy_payload)
```

### TypeScript

```ts
import { verifyChain } from "@contextpassport/core";
const ok = verifyChain([passport1, passport2, ...]);

import { payloadHash as v1PayloadHash } from "@contextpassport/core/compat/v1";
const h = v1PayloadHash(legacyPayload);
```

## Operator playbook

Follow the **chain reset** pattern from [`docs/migration-and-versioning.md`](../migration-and-versioning.md) §5.2.

### Phase 1 — upgrade SDKs (no behavior change yet)

Bump dependencies but pin to `schema_version: "1.0"` for newly produced records. The v2.x SDKs let you do this by passing the version explicitly if you need a freeze window. (In the default path, the SDK produces v2.0 records.) Verify that `verify_chain` over your existing v1.x records continues to return true. This proves the compat shim is wired up correctly.

### Phase 2 — start the new chain

Tag the v1.x → v2.0 boundary in your pipeline. For each agent, the next emitted record carries `schema_version: "2.0"` and `parent_id` pointing at the last v1.x record's `id`. Its `parent_hash` will be the v1.x record's `integrity_hash` — which was computed under v1.x rules and is preserved verbatim.

The first v2.0 record after a v1.x parent is the *only* place where two algorithms meet in one verification: the verifier computes the parent record's `payload_hash` with the v1.x algorithm and the new record's `payload_hash` with JCS. The chain still verifies.

### Phase 3 — drop v1.x writes

Once all producers in your pipeline ship records with `schema_version: "2.0"`, you can stop carrying the compat shim's encoding *for new writes*. You still need it for *verification* of any v1.x records you've archived. The compat shim is part of the v2.x SDK indefinitely.

### Phase 4 — re-anchor (optional)

If you publish witness-log checkpoints (see [`docs/witness-log.md`](../witness-log.md)), your v2.0 checkpoints will start a new Merkle-tree chain. Existing checkpoints anchoring v1.x records remain valid; they just can't be extended.

## What NOT to do

- **Don't re-hash v1.x records under v2.0 rules.** That changes the record's `payload_hash` and `integrity_hash`, which breaks any existing signatures and any downstream system that referenced the v1.x hash. Leave v1.x records as-is and verify them with the v1.x algorithm via the compat shim.
- **Don't bridge versions by recomputing.** If your archive contains a v1.x record with a non-ASCII payload, do not "translate" it to v2.0 by recomputing the hashes. The cryptographic chain anchors the bytes that were originally hashed.

## Numbers larger than 2^53 − 1

JCS specifies how numbers serialize but cannot widen the range of integers that JavaScript's `Number` type can represent. If your payloads contain identifiers larger than `Number.MAX_SAFE_INTEGER`, encode them as strings:

```json
{ "trade_id": "12345678901234567" }   // good — string
{ "trade_id": 12345678901234567 }     // bad — loses precision in JS
```

This is the only payload shape that crosses the v1.x → v2.0 boundary with new advice: the previous spec suggested the same workaround, but it's now mandatory for byte-equivalence under JCS rather than a recommendation under v1.x.

## Verification checklist

- [ ] SDKs upgraded to v2.x (`pip install "context-passport>=2.0"`, `npm install @contextpassport/core@^2.0`)
- [ ] Existing v1.x records still verify under `verify_chain` (compat shim wired up)
- [ ] New records carry `schema_version: "2.0"` and `$schema` pointing to `https://contextpassport.com/schema/v2.json`
- [ ] Polyglot conformance harness in your CI matrix returns exit 0
- [ ] Integer fields above 2^53 − 1 (if any) are encoded as strings
- [ ] If you sign records: signed v2.0 records verify in both Python and TypeScript SDKs

## References

- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785)
- [`proposals/canonical-json-jcs.md`](../../proposals/canonical-json-jcs.md) — original adoption proposal
- [`docs/migration-and-versioning.md`](../migration-and-versioning.md) — general versioning playbook
- [`contextpassport/conformance-tests`](https://github.com/contextpassport/conformance-tests) — polyglot harness
