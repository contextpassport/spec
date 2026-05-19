# Witness Log

**Status:** Non-normative design note
**Audience:** Operators building Context Passport receiving servers
**Companion to:** [docs/throughput-and-trust.md](throughput-and-trust.md), [docs/external-anchoring.md](external-anchoring.md)

---

## Why this document exists

The Context Passport spec defines what a record looks like and how integrity is computed at the client. It does not define how a receiving server stores those records, makes them publicly verifiable, or provides inclusion proofs to a third party. That's the operator's problem.

This document describes the Witness Log pattern — an operator-side architecture for turning incoming Context Passports into a public, append-only, externally-anchored record that a regulator, auditor, or counterparty can verify without trusting the operator.

The pattern borrows from [Certificate Transparency](https://certificate.transparency.dev/), [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/), and [Trillian](https://github.com/google/trillian). It is not novel. What's novel is applying it to AI agent execution records.

---

## 1. The three-tier model

A Witness Log has three tiers, each producing a different kind of evidence:

```
Tier 1: Local commits          (client → operator, real-time)
   ↓
Tier 2: Checkpoint batches     (operator → checkpoint repo, periodic)
   ↓
Tier 3: External anchors       (checkpoint repo → Bitcoin / Sigstore / TSA)
```

| Tier | What it proves | Latency | Who can verify |
|---|---|---|---|
| 1. Local commit | Record was received by the operator at time T | Real-time | Operator only (server logs) |
| 2. Checkpoint | Record was included in the public log at the checkpoint time | Seconds to minutes | Anyone with access to the checkpoint repo |
| 3. External anchor | The checkpoint itself existed at an external time | Hours (Bitcoin confirmation) | Anyone with access to the external chain |

A passport progresses through these tiers in order. Different verifiers care about different tiers depending on their trust posture. A regulator who trusts the operator may verify only at tier 1. A regulator who trusts no one waits for tier 3.

---

## 2. Tier 1 — Local commit reception

The receiving server accepts passports from clients (per `docs/throughput-and-trust.md` submission patterns), validates them, and stores them. Required validation at this tier:

- **Schema validation:** the incoming passport validates against the schema matching its `schema_version` (`schema/v2.json` for v2.0 records, `schema/v1.json` for v1.x records).
- **Hash validation:** `integrity.payload_hash` recomputed by the server matches the client-supplied value. If not, the passport is stored but flagged with `verification_status: rejected` and the reason recorded.
- **Chain validation:** if `parent_id` is set, the parent passport is fetched and `integrity.parent_hash` is verified to match its `integrity_hash`. Broken chains are flagged but stored.
- **Signature validation (if present):** the Ed25519 (or other algorithm) signature is verified against the embedded public key. Failures are flagged but stored.

Storage requirements:

- **Append-only.** The database table or storage layer MUST NOT permit `UPDATE` or `DELETE` on committed records. Use database-level constraints (Postgres triggers, table-level GRANT) to enforce this rather than relying on application code.
- **Indexed for chain traversal.** Lookups by `id`, `parent_id`, `trace_id` should be O(log n) at minimum.
- **Durable before ack.** The server MUST persist the passport before returning a receipt to the client. A receipt for a record not actually durable is a credibility hole.

Pattern: a Postgres `commits` table with `INSERT`-only row-level security policies and a constraint trigger preventing column modification is one well-tested implementation. Equivalent results can be achieved with object-storage-backed append-only logs, ledger databases like immudb, or any storage layer with hardware-enforced WORM semantics.

---

## 3. Tier 2 — Checkpoint construction

Every N seconds (or every M commits, whichever comes first), the server:

1. Selects all commits since the last checkpoint.
2. Computes a Merkle tree over their `integrity_hash` values.
3. Constructs a checkpoint envelope:

```json
{
  "schema_version":   "3",
  "checkpoint_id":    "ckpt_2026-05-18T14:30:00Z_abc123",
  "previous_id":      "ckpt_2026-05-18T14:20:00Z_xyz789",
  "merkle_root":      "sha256:...",
  "leaf_count":       1247,
  "first_leaf_id":    "ctx_...",
  "last_leaf_id":     "ctx_...",
  "first_leaf_time":  "2026-05-18T14:20:00.013Z",
  "last_leaf_time":   "2026-05-18T14:29:59.872Z",
  "checkpoint_time":  "2026-05-18T14:30:00.000Z"
}
```

4. Signs the checkpoint with the operator's signing key.
5. Publishes the signed checkpoint to a **public, append-only repository**. The reference implementation uses a public GitHub repo with one commit per checkpoint. Each checkpoint commit is signed with the operator's GPG key.

A few design choices worth being explicit about:

### Why a Merkle tree?

A Merkle tree over the batch lets a client request a compact proof that *their* commit is in *this* checkpoint without downloading the entire checkpoint contents. The proof is logarithmic in the size of the batch.

### Why a separate `schema_version`?

The checkpoint envelope is a different schema from the Context Passport itself. Mixing them creates ambiguity. One implementation pattern: use a distinct integer (e.g., `"3"`) for checkpoint envelopes so it cannot be confused with Context Passport `"1.0"` or with any operator-internal envelope versions.

### Why a public GitHub repo?

- Git itself is content-addressed and append-only by convention.
- GitHub provides free, durable hosting with global mirroring.
- Anyone can clone, fork, or audit the repo.
- GPG-signed commits add operator attestation without separate signing infrastructure.
- Tag-based releases let operators publish "checkpoint of checkpoints" for long-term archival.

Alternatives that work equally well: a write-only S3 bucket with object versioning, an IPFS pinning service, a self-hosted Git server with anonymous read access. The pattern requires public read access and append-only writes; the storage technology is implementation-defined.

### Checkpoint cadence

- **Real-time-critical workflows:** every 1 minute. High operational overhead but lowest latency to tier-2 proof.
- **Default:** every 10 minutes. Balances proof latency with checkpoint repo size growth.
- **Low-volume operators:** every hour. Acceptable when commits are infrequent.

The cadence is a per-operator policy. Clients SHOULD NOT assume any particular cadence and SHOULD request inclusion proofs explicitly rather than waiting for a specific elapsed time.

---

## 4. Tier 3 — External anchoring of checkpoints

Each published checkpoint's `merkle_root` is submitted to one or more external timestamping services (see `docs/external-anchoring.md`). The resulting proof files are stored alongside the checkpoint.

The key insight: **one external anchor per checkpoint, not per commit**. A single Bitcoin anchor (via OpenTimestamps) covers an entire batch of thousands of commits at no per-commit cost. The Merkle tree's logarithmic inclusion proofs do the rest.

Anchoring strategy:

```
Per checkpoint:
  1. ots stamp <merkle_root>          → ~/.ots-pending/<checkpoint_id>.ots
  2. Wait 1-6 hours for confirmation
  3. ots upgrade <checkpoint_id>.ots  → fully Bitcoin-anchored
  4. Commit upgraded proof to checkpoint repo
```

Operators MAY anchor to multiple services in parallel for redundancy:

- OpenTimestamps (Bitcoin)
- Sigstore Rekor (transparency log)
- An RFC 3161 TSA (compliance-mandated)
- A second OpenTimestamps calendar (independent operator)

Each anchor adds bytes (~1 KB per proof) to the checkpoint repo and one optional verification path for downstream consumers. Four anchors at near-zero marginal cost converts a single-witness pipeline into a four-witness one.

---

## 5. Inclusion proofs

The point of the whole architecture is that a client (or third party holding a passport) can ask: "is this passport included in your Witness Log?" and receive a verifiable answer that doesn't require trusting the server.

The inclusion-proof flow:

```
Client:  "Prove ctx_1700000000000_abc is in the log."
Server:  Returns {
           checkpoint_id:      "ckpt_2026-05-18T14:30:00Z_abc123",
           merkle_path:        [<hash>, <hash>, <hash>, ...],   // log(N) sibling hashes
           leaf_index:         527,
           checkpoint_url:     "https://github.com/.../checkpoints/.../ckpt_....json",
           ots_proof_url:      "https://github.com/.../checkpoints/.../ckpt_....ots"
         }

Client (or any third party):
  1. Fetch the checkpoint from checkpoint_url.
  2. Verify the checkpoint is signed by the operator's known key.
  3. Recompute the Merkle root from the passport's integrity_hash + the merkle_path.
  4. Confirm the recomputed root matches checkpoint.merkle_root.
  5. Optionally: download ots_proof_url and verify the merkle_root was Bitcoin-anchored.
```

If all steps pass, the client has cryptographic evidence that:

- The passport with that `integrity_hash` was included in a checkpoint at a specific time.
- The operator vouched for the checkpoint (signature).
- The checkpoint existed at the externally-anchored time (independent of the operator).

This is the same proof structure as Certificate Transparency's inclusion proofs and Sigstore Rekor's transparency log proofs. Verifier code from those projects can often be adapted with small changes.

---

## 6. Operator architecture (reference)

A reference operator-side architecture:

```
┌──────────────────────────────────────────────────────────────────┐
│                       Receiving server                           │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────────┐   │
│  │ POST /commit │───▶│ Validation    │───▶│ Postgres commits │   │
│  │              │    │ (hash, chain, │    │ (append-only)    │   │
│  │              │    │  signature)   │    │                  │   │
│  └──────────────┘    └───────────────┘    └──────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                              │
                       Every 10 minutes ──────┤
                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Checkpoint scheduler                            │
│  ┌────────────────────┐    ┌────────────────────────────────┐    │
│  │ Read new commits   │───▶│ Build Merkle tree              │    │
│  │ since last ckpt    │    │ Sign checkpoint envelope (GPG) │    │
│  └────────────────────┘    └────────────────────────────────┘    │
│                                              │                   │
│                                              ▼                   │
│                            ┌─────────────────────────────────┐   │
│                            │ git commit + push to            │   │
│                            │ github.com/<org>/witness-log    │   │
│                            └─────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                              │
                       Every checkpoint ──────┤
                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              External anchoring (async, can lag)                 │
│  ┌──────────────────┐    ┌───────────────────────────────┐       │
│  │ ots stamp        │───▶│ Wait for Bitcoin confirmation │       │
│  │ merkle_root      │    │ Upgrade .ots proof            │       │
│  └──────────────────┘    └───────────────────────────────┘       │
│                                              │                   │
│                                              ▼                   │
│                            ┌─────────────────────────────────┐   │
│                            │ git commit upgraded .ots files  │   │
│                            └─────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                  GET /api/inclusion-proof/:id                    │
│  Returns merkle_path + checkpoint reference + .ots URL.          │
│  Verifier needs no trust in the server.                          │
└──────────────────────────────────────────────────────────────────┘
```

Three independent processes:

1. **Receiving server** — the always-on API. Synchronous request/response. Low complexity. Failures here are user-visible.
2. **Checkpoint scheduler** — a periodic process. Can be a cron job, a separate worker, a Cloud Run scheduled task. Failures here delay checkpoint publication but do not affect commit ingestion.
3. **External anchoring worker** — fully asynchronous. Submits checkpoints to OTS, waits, upgrades proofs, publishes. Failures here delay external anchoring but do not affect anything else.

Each can be scaled, deployed, and operated independently. This is the standard separation-of-concerns pattern; the architecture is not novel.

---

## 7. Public verifier — what a third party runs

The operator publishes (in the witness-log repo or in docs):

- The schema for the checkpoint envelope
- The Merkle tree construction algorithm (left-right ordering, hash function, leaf encoding)
- The operator's signing public key
- A reference verifier in code

A complete verifier needs roughly 150 lines of code. Operators are encouraged to publish a reference verifier alongside their Witness Log so any third party can verify inclusion without operator cooperation. The verifier typically takes a passport `id` and returns "verified" / "broken" / "not yet anchored" along with the proof chain it followed.

Anyone can run the verifier offline given:

- The passport JSON
- The merkle_path from the inclusion-proof endpoint (or downloaded directly from the checkpoint repo)
- The checkpoint envelope and the operator's signing key
- (Optional) The OTS proof for the checkpoint's Merkle root

Network access is needed only to fetch the checkpoint repo contents (one HTTP GET) and to verify the Bitcoin block if the OTS proof is being checked.

---

## 8. Operational considerations

### Repo size growth

A checkpoint envelope is ~1-2 KB. A 10-minute cadence produces ~52,560 checkpoints per year, or ~100 MB of checkpoint envelopes. With .ots proofs (~1 KB each), about 200 MB/year. Manageable indefinitely in a single GitHub repo.

For very large operators (>1M commits/day), consider:

- Annual repo rollover (`witness-log-2026/`, `witness-log-2027/`)
- Sparse fetch for verifiers (Git supports fetching only specific directories)
- Mirror to IPFS or S3 for redundancy

### Operator key compromise

If the operator's GPG key (used to sign checkpoints) is compromised:

1. An attacker can sign forged checkpoints. The fraud is detectable because:
   - Existing checkpoints are immutable (already in git history).
   - External anchors (Bitcoin OTS) for past checkpoints cannot be forged retroactively.
   - The fraud surfaces as a forked checkpoint chain — a verifier seeing two checkpoints with the same `previous_id` knows something is wrong.

2. Operator response: publish a key rotation announcement, revoke the old GPG key, sign all subsequent checkpoints with the new key. Past records remain verifiable via the old key combined with their external anchors.

This is the same threat model and response pattern as Certificate Transparency log operator key compromise. Well-understood.

### What happens if the operator disappears

Every committed passport remains verifiable as long as:

- The passport JSON is held by the customer
- The checkpoint envelope is in the public repo (GitHub keeps repos indefinitely, but customers should also mirror the repo)
- The OTS proof file is in the public repo

The customer can verify offline using the same reference verifier code without needing the operator's server to be alive. This is the "even if the operator goes away, the records remain verifiable" property — the structural reason a Witness Log meaningfully differs from a vendor-controlled audit log.

### Latency budget for inclusion proofs

| Tier | Typical latency | Failure mode |
|---|---|---|
| Tier 1 (commit ack) | 10-100ms | Returns 503; client retries |
| Tier 2 (checkpoint published) | < cadence (10 min default) | Scheduler delayed; commits backlog briefly |
| Tier 3 (external anchor confirmed) | 1-6 hours (Bitcoin) | Anchor delayed; tier-2 proof remains usable |

Clients SHOULD treat tier-2 proofs as the primary evidence and tier-3 anchors as the long-term guarantee. The tier-3 anchor is what makes the proof regulator-grade; the tier-2 proof is what makes it real-time-useful.

---

## 9. Public-good vs. competitive infrastructure

The Witness Log is a public good. Once an operator publishes a checkpoint repo with anchored checkpoints, **anyone** can:

- Verify any passport that was committed to that operator's pipeline
- Audit the operator's claims about uptime, throughput, and chain integrity
- Build downstream tools that consume the checkpoint feed

This is intentional. A receiving server that doesn't publish a Witness Log is just a fancy database; what makes Context Passport credible is that the operator commits publicly and irrevocably to what they received.

Multiple operators can run independent Witness Logs. A customer using two operators can cross-reference: if both operators witnessed the same chain, the trust assumptions can be combined or relaxed. Operators that participate in cross-witnessing strengthen each other's credibility without coordination overhead.

---

## 10. Minimum viable Witness Log

For a new operator wanting to ship the smallest viable Witness Log:

1. Create a public GitHub repo: `github.com/<your-org>/witness-log`.
2. Commit a `README.md` explaining the operator's verification expectations and where to find verifier code.
3. Add a `checkpoints/` directory.
4. Stand up a scheduler that every N minutes:
   - Builds a Merkle tree over the new commits
   - Writes `checkpoints/<timestamp>.json` (the checkpoint envelope)
   - Writes `checkpoints/<timestamp>.sig` (the operator's signature)
   - `git commit && git push`
5. Add an async worker that:
   - Runs `ots stamp` on each new checkpoint's `merkle_root`
   - Periodically runs `ots upgrade` on pending proofs
   - Commits the upgraded `.ots` files
6. Add an HTTP endpoint that returns inclusion proofs from a passport `id`.
7. Publish (in the repo README) the verifier code that consumers should run.

That's the entire architecture. Total code: a few hundred lines per component. Total operational cost: a small Postgres database, a small worker, a public GitHub repo. The rest is policy and operational discipline.

---

## 11. What this document does not cover

- **The specific schema for the checkpoint envelope.** This is operator-defined. Different operators MAY use different schemas as long as they document them publicly so verifiers can interpret each operator's Witness Log.
- **Cross-operator interoperability.** Two operators with different checkpoint schemas cannot directly cross-verify each other's logs. Standardization here is a future spec work item.
- **Privacy-preserving Witness Logs.** Some operators may need to publish anchors without exposing which commits are in them (e.g., for confidential workflows). This requires a different cryptographic construction (e.g., a polynomial commitment or KZG-based proof) and is out of scope for v1.0.

---

*Context Passport — design notes for implementers. Released under CC0 along with the rest of the specification.*
