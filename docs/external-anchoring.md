# External Anchoring

**Status:** Non-normative design note
**Audience:** SDK implementers, operators of high-stakes audit pipelines
**Companion to:** [SPEC.md §5.4](../SPEC.md#54-completeness-vs-integrity), [docs/throughput-and-trust.md §4](throughput-and-trust.md#4-what-batching-preserves-and-what-it-delays)

---

## Why external anchoring exists

Context Passport's hash chain proves that a record was not modified after it was created. Client-side Ed25519 signatures (SPEC.md §3.2.7) prove who created it. Neither of those proves *when* the record was created — a malicious client could backdate a passport by setting an earlier `event.timestamp` and recomputing the chain to fit.

External anchoring closes that gap. The client submits the `payload_hash` (not the payload itself) to an independent timestamping service at the moment of creation. The service returns a cryptographic proof that the hash existed at a specific external time. Anyone holding the hash and the proof can later verify the existence claim without trusting the client, the receiving server, or the timestamping service.

This is the structural property that makes a record credible to a regulator who trusts none of the parties involved.

---

## What OpenTimestamps actually is

[OpenTimestamps](https://opentimestamps.org/) is a free, open, decentralized timestamping protocol that anchors hashes to the Bitcoin blockchain. The flow:

1. A client submits a hash to a public OTS calendar server.
2. The calendar aggregates many hashes into a Merkle tree.
3. The Merkle root is committed to the Bitcoin blockchain (typically within a few hours).
4. Once confirmed, the calendar returns a proof file (`.ots`) — a Merkle path from the original hash up to a Bitcoin block hash.
5. Anyone with the original data, the proof file, and a Bitcoin node (or block explorer) can verify the hash existed at the block's timestamp.

Properties relevant to Context Passport:

- **Decentralized:** no single OTS calendar can lie about when a hash was anchored, because the Bitcoin chain is the ground truth.
- **Free:** no per-anchor cost. Calendar operators absorb the Bitcoin transaction fees by batching thousands of hashes per block commit.
- **Asynchronous:** initial submission is instant (a few hundred ms); full Bitcoin confirmation takes hours. The proof file works in two stages — "pending calendar attestation" immediately, "upgraded with Bitcoin proof" once confirmed.
- **Privacy-preserving:** only the hash is submitted. The original payload never leaves the client.
- **Verifiable offline:** once the `.ots` file is upgraded with a Bitcoin proof, verification needs only the file and access to the Bitcoin block headers, which are public.

OpenTimestamps is the reference service in this document. Other anchoring services (RFC 3161 TSAs, Sigstore Rekor) are listed in §6.

---

## The integration pattern

The pattern is three steps, applied at passport creation time:

```
1. Create passport         → compute integrity.payload_hash
2. Submit to OTS calendar  → receive pending .ots proof
3. Store .ots alongside    → upgrade to Bitcoin proof when confirmed
```

The `.ots` file is a separate artifact from the passport itself. Passports remain valid Context Passport v1.0 records whether or not they have a companion `.ots` proof. Implementations choosing to anchor SHOULD store the `.ots` file in the same logical location as the passport — same database row, same directory, same Witness Log entry.

A namespaced extension field MAY be added to the passport to advertise that a proof exists:

```json
{
  "...": "...",
  "ots.proof_uri": "s3://my-bucket/passports/ctx_1700000000000_aaa111aaa111.ots",
  "ots.calendar":  "https://alice.btc.calendar.opentimestamps.org",
  "ots.submitted_at": "2026-05-18T14:32:00Z"
}
```

The `ots.*` namespace follows the EXTENSIONS.md convention. This is optional — the proof file alone is sufficient to verify; the extension field is a convenience for locating the proof.

---

## Python example

Using the canonical [`opentimestamps-client`](https://pypi.org/project/opentimestamps-client/) library.

Install:

```bash
pip install context-passport opentimestamps-client
```

Anchor a passport at creation time:

```python
import subprocess
import tempfile
from pathlib import Path
from context_passport import make_passport

def anchor_payload_hash(payload_hash_hex: str) -> bytes:
    """
    Submit a payload_hash to OpenTimestamps and return the pending .ots
    proof bytes. The hex string MUST be 64 chars (the raw SHA-256, no
    'sha256:' prefix).
    """
    raw = bytes.fromhex(payload_hash_hex)
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(raw)
        hash_file = f.name

    # ots stamp creates <input>.ots in the same directory
    subprocess.run(["ots", "stamp", hash_file], check=True)
    proof_path = Path(hash_file + ".ots")
    proof_bytes = proof_path.read_bytes()

    # Cleanup
    Path(hash_file).unlink()
    proof_path.unlink()
    return proof_bytes


# Create the passport
p = make_passport(
    agent_id="research-agent-01",
    agent_name="Research Agent",
    payload={"input": "Analyze Q1 earnings", "output": {"summary": "..."}},
)

# Anchor it. The raw hex (no prefix) is what OTS hashes.
hex_only = p["integrity"]["payload_hash"].removeprefix("sha256:")
proof = anchor_payload_hash(hex_only)

# Persist the proof alongside the passport.
# In production: write to S3, append to local log, etc.
proof_path = Path(f"./proofs/{p['id']}.ots")
proof_path.parent.mkdir(exist_ok=True)
proof_path.write_bytes(proof)

print(f"Passport {p['id']} created and anchored.")
print(f"Proof: {proof_path}")
print(f"Upgrade to Bitcoin proof later with: ots upgrade {proof_path}")
```

Upgrade the proof to a confirmed Bitcoin proof (run hours or days later):

```python
import subprocess
from pathlib import Path

def upgrade_proof(proof_path: Path) -> bool:
    """
    Upgrade a pending OTS proof to a Bitcoin-confirmed proof.
    Returns True if at least one calendar attestation has been upgraded.
    """
    result = subprocess.run(
        ["ots", "upgrade", str(proof_path)],
        capture_output=True, text=True,
    )
    return result.returncode == 0


# Run periodically (e.g., daily cron job over the proofs directory)
for proof in Path("./proofs").glob("*.ots"):
    if upgrade_proof(proof):
        print(f"Upgraded: {proof.name}")
```

Verify a proof — this is what a regulator or auditor would run:

```python
import subprocess
from pathlib import Path

def verify_proof(payload_hash_hex: str, proof_path: Path) -> bool:
    """
    Verify an OTS proof against a raw payload hash. Returns True if
    the proof is valid and confirmed by Bitcoin.
    """
    raw = bytes.fromhex(payload_hash_hex)
    target = proof_path.with_suffix("")  # ots verify needs the original file
    target.write_bytes(raw)
    try:
        result = subprocess.run(
            ["ots", "verify", str(proof_path)],
            capture_output=True, text=True,
        )
        return "Success!" in result.stdout
    finally:
        target.unlink()


# Usage by a third party
hex_only = "835d9bdaa3b54bf66362a7d85ce9b4bef1c177ba77ab7d87c98d8ae72903177e"
print(verify_proof(hex_only, Path("./proofs/ctx_1700000000000_aaa111aaa111.ots")))
```

---

## TypeScript example

Using [`javascript-opentimestamps`](https://www.npmjs.com/package/javascript-opentimestamps).

Install:

```bash
npm install @context-passport/core javascript-opentimestamps
```

Anchor at creation time:

```ts
import { makePassport } from "@context-passport/core";
import OpenTimestamps from "javascript-opentimestamps";

async function anchorPayloadHash(payloadHashHex: string): Promise<Buffer> {
  const raw = Buffer.from(payloadHashHex, "hex");
  const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
    new OpenTimestamps.Ops.OpSHA256(),
    raw,
  );
  // Submits to default calendar servers asynchronously.
  await OpenTimestamps.stamp(detached);
  return Buffer.from(detached.serializeToBytes());
}

// Create
const p = makePassport({
  agentId:   "research-agent-01",
  agentName: "Research Agent",
  payload:   { input: "Analyze Q1 earnings", output: { summary: "..." } },
});

// Anchor
const hexOnly = p.integrity.payload_hash.replace(/^sha256:/, "");
const proof = await anchorPayloadHash(hexOnly);

// Persist (filesystem here; production: object store, DB blob)
import * as fs from "node:fs";
fs.mkdirSync("./proofs", { recursive: true });
fs.writeFileSync(`./proofs/${p.id}.ots`, proof);

console.log(`Passport ${p.id} created and anchored.`);
```

Upgrade (run periodically):

```ts
import OpenTimestamps from "javascript-opentimestamps";
import * as fs from "node:fs";
import * as path from "node:path";

async function upgradeProof(proofPath: string): Promise<boolean> {
  const bytes = fs.readFileSync(proofPath);
  const detached = OpenTimestamps.DetachedTimestampFile.deserialize(bytes);
  const changed = await OpenTimestamps.upgrade(detached);
  if (changed) {
    fs.writeFileSync(proofPath, Buffer.from(detached.serializeToBytes()));
  }
  return changed;
}

for (const file of fs.readdirSync("./proofs")) {
  if (file.endsWith(".ots")) {
    const upgraded = await upgradeProof(path.join("./proofs", file));
    if (upgraded) console.log(`Upgraded: ${file}`);
  }
}
```

Verify:

```ts
import OpenTimestamps from "javascript-opentimestamps";
import * as fs from "node:fs";

async function verifyProof(payloadHashHex: string, proofPath: string): Promise<boolean> {
  const raw = Buffer.from(payloadHashHex, "hex");
  const proofBytes = fs.readFileSync(proofPath);
  const detached = OpenTimestamps.DetachedTimestampFile.fromBytes(
    new OpenTimestamps.Ops.OpSHA256(),
    raw,
  );
  const proof = OpenTimestamps.DetachedTimestampFile.deserialize(proofBytes);
  const verifyResult = await OpenTimestamps.verify(proof, detached);
  // verifyResult is a dict { bitcoin: <unix-timestamp> } if confirmed
  return Object.keys(verifyResult).length > 0;
}
```

---

## Storage: where the `.ots` file lives

A `.ots` proof file is independent of the passport — it can be stored anywhere and shared without exposing payload data. Common patterns:

| Pattern | Description | When to use |
|---|---|---|
| Filesystem alongside | `./passports/<id>.json` and `./passports/<id>.ots` in the same directory | Local dev, single-tenant deployments |
| Object store | Both blobs in S3/GCS with the same key prefix | Cloud-native production |
| Same database row | Passport JSON and proof as separate columns in one row | Easy joins, single transactional write |
| Witness Log entry | Both in the same checkpoint repo as separate files | When the Witness Log is itself the source of truth |
| Customer-controlled bundle | Both in a tarball exportable to the customer | Regulated environments where customer must hold the proof |

The reference implementation does not prescribe a pattern. The `ots.proof_uri` extension field MAY be used in the passport to record the canonical location.

---

## Operational considerations

### Latency

- **OTS submission:** typically 100-500ms (network round-trip to a calendar server)
- **Pending → Bitcoin confirmation:** 1-6 hours typical, occasionally longer if Bitcoin congestion is high
- **Cost:** $0. Calendar operators batch thousands of submissions per Bitcoin transaction.

Implementations that need synchronous "the record is anchored" semantics should treat the pending OTS receipt as sufficient evidence and upgrade to Bitcoin asynchronously. Pending receipts are already useful — they prove a calendar saw the hash before any specific timestamp later proven by Bitcoin.

### Reliability

The default OTS client submits to multiple independent calendars in parallel. A failure at any one calendar does not block stamping; partial proofs are accepted as long as at least one calendar succeeds.

For high-availability pipelines:

- Submit to 3+ calendars explicitly via the `--calendar` flag
- Persist the proof file before the calendar transaction is committed (the proof is valid even if the calendar later disappears, as long as the Bitcoin proof exists)
- Run the upgrade step periodically (daily is sufficient) — pending proofs become full proofs over time without operator intervention

### Privacy

Only the SHA-256 hash is submitted to the calendar. The hash leaks no information about the payload provided the payload has sufficient entropy. For low-entropy payloads (e.g., yes/no decisions), an implementation MAY salt the payload before hashing or rely on the integrity_hash (which already includes the parent chain) instead.

### Failure modes worth designing for

- **Calendar unreachable at creation time.** Treat as a soft failure — passport creation still succeeds; the proof is queued and submitted on the next successful network attempt.
- **Calendar returns invalid proof.** Should not happen with the canonical clients; if it does, retry against a different calendar.
- **Bitcoin chain reorganization.** OTS handles this — calendars retry attestation if the original block is orphaned.
- **Lost proof file.** Anchoring becomes unprovable. Mitigate by storing proofs in the same backup tier as the passports themselves.

---

## Alternative anchoring services

OpenTimestamps is the default recommendation because it's free, decentralized, and well-supported. Other options:

| Service | Mechanism | When to consider |
|---|---|---|
| [OpenTimestamps](https://opentimestamps.org) | Bitcoin-anchored, decentralized | Default. Most regulated environments accept it. |
| [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) | Public transparency log | When the broader software supply chain uses Sigstore (e.g., SLSA L3 environments). |
| RFC 3161 TSA | Centralized authorities (DigiCert, Sectigo, GlobalSign, government TSAs) | When a specific regulator (e.g., eIDAS-qualified TSA for EU) is required by law. |
| [Trillian](https://github.com/google/trillian) | Self-hostable Merkle-tree backend | When you operate your own transparency infrastructure. |
| Internal RFC 3161 | Your own TSA inside your security perimeter | When network egress is restricted and you accept reduced third-party trust. |

Implementations MAY support multiple anchoring providers simultaneously. The `ots.calendar` extension field becomes `tsa.url` or `rekor.uuid` etc. when other services are used.

---

## Cost-benefit of anchoring

When to enable external anchoring:

- **Regulated workflows** (financial, medical, legal) where post-hoc verification by a regulator must work without your involvement.
- **High-stakes single decisions** where backdating defense matters more than throughput cost.
- **Long-running batched submission** (see `docs/throughput-and-trust.md`) where the gap between creation time and server-receipt time would otherwise weaken trust.
- **Offline environments** where the receiving server is not available at creation time — anchoring becomes the only way to assert creation time.

When external anchoring is unnecessary:

- Local development and testing
- Workflows where trust in the receiving server is acceptable
- High-throughput pipelines where 100-500ms of extra latency per commit is prohibitive (though OTS submission can be done asynchronously and does not need to block the commit)

The marginal cost of anchoring is small — a few hundred milliseconds of network time, no monetary cost, a few hundred bytes of proof storage. The marginal benefit is large in any context where a third party will ever ask "prove this existed at the time you claim."

---

## What this document does not cover

- **Multi-hash anchoring.** Anchoring a single Merkle root over many passports at once (batch optimization). This is what most Witness Log implementations do internally; see `docs/witness-log.md` for the reference architecture.
- **Custom calendar operation.** Running a private OTS calendar for internal-only anchoring. Possible but rarely necessary.
- **Cross-chain anchoring.** Anchoring to chains other than Bitcoin. OTS supports Litecoin and a few others; the Bitcoin attestation is the canonical one for most verifiers.

---

*Context Passport — design notes for implementers. Released under CC0 along with the rest of the specification.*
