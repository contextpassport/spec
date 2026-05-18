# Throughput and Trust

**Status:** Non-normative design note
**Audience:** SDK implementers, reviewers, regulators, sophisticated customers
**Companion to:** [SPEC.md](../SPEC.md), [SPEC.md §5 — Security considerations](../SPEC.md#5-security-considerations)

---

## Why this document exists

A common question from implementers and reviewers:

> An AI agent in a long-running session can produce many Context Passports in a short time. How does a client capture them all? How can the client prove the records they meant to create were actually captured? Can a client batch records locally and transmit later, or must every record be a synchronous call to the receiving server?

This document answers those questions. It is non-normative — implementations may choose any pattern that satisfies the integrity guarantees of [SPEC.md](../SPEC.md). The patterns described here are the ones the maintainers have found work in practice.

---

## 1. The constraint nothing can fix

No verifiable-record system can force a client to *create* a record they choose not to create. This is true of Context Passport, Sigstore, certificate transparency, all blockchain-based systems, and every traditional audit log. The client controls what gets emitted.

What cryptographic record systems *can* guarantee:

| Guarantee | Mechanism |
|---|---|
| Records cannot be modified after creation | Hash chain + optional signature |
| Missing records are detectable when continuity is expected | Chain linkage via `parent_id` |
| Records cannot be backdated | Anchoring `payload_hash` to an external timestamping service |
| Records cannot be silently re-ordered | `parent_id` enforces partial order |
| Records cannot be forged by the receiving server | Client-side signing (SPEC.md §3.2.7) |

What they *cannot* guarantee:

- Completeness without external context. If an agent makes a decision and chooses not to emit a passport for it, no cryptographic system reveals the omission. Detection of omission requires either (a) a continuity expectation set by contract, regulation, or convention, or (b) reconciliation against a counterparty's records.

Once this constraint is internalized, the architecture question becomes clearer: how do we make the records that *are* created as verifiable as possible, with the lowest cost to the agent's throughput?

---

## 2. Three timestamps, three trust properties

Every Context Passport has three timing moments worth distinguishing:

### 2.1 Creation time

When the client SDK computes the integrity hash and (if applicable) the signature. This is the moment the passport's bytes are sealed.

`event.timestamp` and `created_at` reflect creation time as claimed by the client. If the client signs the passport, the timestamp is part of the signed envelope — modifying it breaks the signature.

**Trust property:** The client controls this timestamp. A trustworthy client tells the truth. A regulator who wants stronger evidence than "the client claims it was 10:03" can require external anchoring at creation time (see §4).

### 2.2 Server-receipt time

When the receiving server (a hosted Context Passport implementation, a self-hosted implementation, or an audit aggregator) acknowledges receipt. The server records its own timestamp.

**Trust property:** Independently verifiable. The server's timestamp is a different party's claim, and the gap between client-claimed creation time and server-claimed receipt time is itself an audit signal.

### 2.3 Witness-inclusion time

When the passport's hash is included in a published checkpoint anchored to an external witness — a public log repository, a transparency service, an OpenTimestamps anchor on the Bitcoin chain.

**Trust property:** Strongest. Once a hash is in a published witness anchor, the existence of the passport at that time is provable to any third party without trusting the client *or* the server. This is what makes the record credible to a regulator who trusts neither party.

A passport progresses through these three timestamps in order. The gap between them is implementation-defined. **Submission strategy affects how much these timestamps diverge.**

---

## 3. Submission strategies

### 3.1 Synchronous per-event

Every `dm.commit()` blocks until the server acknowledges receipt.

```
agent ──[commit]──> SDK ──[HTTP]──> server ──[ack]──> SDK ──> agent
                                       ↓
                                    persists
```

**Pros:**
- Smallest gap between creation and server-receipt time
- Client immediately knows whether the server received the commit
- Simplest mental model

**Cons:**
- Agent blocks on network latency for every commit
- Network failure surfaces as agent failure unless the SDK retries
- Unsuitable for high-throughput agents (every commit adds 10-100ms)

**When to use:** low-frequency, high-stakes single decisions (e.g., approving a multi-million-dollar trade). The cost of blocking is acceptable when the rate is low and the stakes are high.

### 3.2 Asynchronous per-event

`dm.commit()` returns immediately. A background thread sends to the server.

```
agent ──[commit]──> SDK ──> agent          (returns instantly)
                     │
                     ▼
                  buffer
                     │
                     ▼ (async, separate thread)
                  server
```

**Pros:**
- Agent does not block on network
- Good throughput for moderate volumes

**Cons:**
- If the SDK process crashes before the background sender flushes, in-memory commits are lost
- No durable evidence the commit existed at creation time until the server receives it
- Out-of-order receipt is possible if the background sender uses multiple connections

**When to use:** moderate-throughput agents where occasional crash-on-network-failure is acceptable. Improved by adding a local append-only persistence layer (see §3.3).

### 3.3 Batched with local persistence (recommended default)

The SDK computes hashes synchronously and writes to a local append-only log (SQLite, JSON Lines, WAL file). A separate process flushes new entries to the server in batches.

```
agent ──[commit]──> SDK ──[hash+sign]──> local-log ──> agent          (returns in ms)
                                              │
                                              ▼ (async, batch)
                                            server ──> ack ──> mark-acked in local-log
```

This is the pattern used by OpenTelemetry collectors, Sigstore's `cosign` for batch mode, and most production audit systems.

**Pros:**
- Agent does not block on network
- Crash-resistant: commits survive process restart because they're on disk before the agent gets control back
- Network failures surface as retry attempts, not as commit losses
- Batching amortizes per-request server overhead

**Cons:**
- Larger gap between creation time and server-receipt time (typically 100ms to a few seconds; can be longer)
- Larger gap to witness-inclusion time (one full checkpoint period)
- More code to write in the SDK

**When to use:** default for most agents. The trust properties are equivalent to synchronous submission *as long as the client signs at creation time* (see §4).

### 3.4 Fully offline with bulk upload

The client operates without network access. All passports are signed and chained locally. When network access is restored, the entire backlog uploads.

```
agent ──[commit]──> SDK ──[hash+sign+OTS-anchor]──> local-log
                                                       │
                                                       │  (hours/days later)
                                                       ▼
                                                    server ──> ack
```

**Pros:**
- Works in regulated, airgapped, or intermittent-network environments
- Forces strong client-side signing and external anchoring (because the server is not available to provide a server-side timestamp at creation time)

**Cons:**
- Largest gap between creation time and server-receipt time
- Requires external anchoring at creation time to be trustworthy
- Server cannot deduplicate or detect chain breaks until the bulk upload arrives

**When to use:** regulated environments with restricted egress (financial settlement systems, medical devices, classified workflows), or any workflow that cannot tolerate network dependencies.

---

## 4. What batching preserves and what it delays

Understanding what each strategy gives up matters more than picking the "right" strategy.

### Preserved regardless of submission strategy

- **Hash chain integrity.** Each commit's `integrity_hash` is computed at creation. Reading the chain later does not change the bytes. Verification is identical whether the chain is read from the server, from a local log, from a backup, or from a regulator's PDF export.
- **Client-side signature** (SPEC.md §3.2.7). Once signed, the envelope cannot be modified without breaking the signature. Submission timing has no effect.
- **Chain linkage.** `parent_id` enforces partial order. Sending commits in a different order than they were created does not corrupt the chain — verifier just walks the links.

### Delayed by batching, in proportion to batch size

- **Server-side timestamp.** Server records "received at" only when the batch arrives. A 60-second batch interval means server-receipt timestamps lag creation timestamps by up to 60 seconds.
- **Witness-inclusion time.** A passport is provably-existed-at-time-T to a third party only after time T's checkpoint is published. Batching delays this by `batch_interval + checkpoint_interval`.
- **Server-side validation feedback.** If the client computed a hash incorrectly, the client learns about it at batch-flush time, not at commit time. For test environments, this is a meaningful debugging gap.

### Defeated entirely by batching unless mitigated

- **Real-time third-party verification.** A regulator asking "show me all records as of right now" gets only the records already uploaded. Records still in the local buffer are not yet evidence.

  *Mitigation:* the client can satisfy the regulator by exporting the local buffer with its hash chain and signatures. This is what the spec calls a "proof bundle." Combined with client-side signing, the regulator can verify the bundle without needing the server to have seen it.

- **Server-side rate limiting and abuse detection.** A client batching for an hour and then dumping 100k records appears identical to a client backfilling falsified records. Servers need to distinguish.

  *Mitigation:* client-side signature with a stable `key_id` plus monotonic `event.timestamp` values plus external OTS anchoring at creation time (not at upload time). With those three properties, an hour-old batch is verifiable as legitimate. Without them, the server has no way to distinguish.

---

## 5. Defenses against client-side malicious behavior

Batching opens a window during which a malicious client could:

- **Omit** a commit they created but don't want recorded.
- **Modify** a commit before transmission.
- **Reorder** commits to misrepresent causality.
- **Backdate** a commit to claim it was made at an earlier time.

Each has a specific defense, in decreasing order of strength:

### 5.1 Client-side signing at creation time

If `signature.signature` is computed over the canonical envelope at creation time (SPEC.md §3.2.7), modification after creation breaks the signature. The client cannot tamper with a passport they've already signed without invalidating it.

This defeats *modification* and *reordering* (the chain linkage is signed), but not *omission* or *backdating* alone.

### 5.2 External anchoring at creation time

The client submits `payload_hash` (not the payload itself) to an external timestamping service — OpenTimestamps (Bitcoin), an RFC 3161 TSA, a public transparency log — at the moment of creation. The service returns a proof that the hash existed at a particular external time.

This defeats *backdating*: even if the commit is uploaded to the receiving server hours later, the OTS proof shows the hash existed at the earlier time. A backdated commit cannot have an OTS proof from before the time it was actually created.

### 5.3 Continuity expectations

If a contract, regulation, SLA, or service definition says "every customer interaction MUST produce a Context Passport," then a gap in the chain is a contract breach independent of cryptography.

This defeats *omission* by changing it from a cryptographic question (can't detect) to a contractual question (auditable through other means).

Implementations that need to enforce continuity expectations:

- Use sequence numbers in the `event` block (extension field; namespace e.g. `acme.sequence_no`).
- Use monotonic `event.timestamp` with bounded gap expectations.
- Require client-side commits even for "no-op" decisions ("agent declined to act") so absence-of-record carries information.

### 5.4 Counterparty reconciliation

If the agent's action involves a second party (MCP server, payment processor, API target), both parties have records. Reconciliation between the two records detects omissions on either side.

This is the strongest defense against omission but requires cooperation from the counterparty. The Context Passport for MCP proposal (`proposals/context-passport-for-mcp.md`) makes this explicit by recommending both client and server emit passports for the same invocation.

---

## 6. SDK implementation guidance

A Context Passport SDK that wants to support the recommended batched-with-local-persistence pattern should provide:

1. **Synchronous commit API.** `commit()` returns in milliseconds, having computed the hash and signature and persisted the passport locally. The caller is not exposed to async.

2. **Pluggable local store.** Default to an append-only log file or embedded SQLite. Allow operators to override with a custom backend (Kafka, Redis Streams, etc.) for high-volume environments.

3. **Background sender.** A separate thread (or process) that drains the local store to the receiving server. Configurable batch size, batch interval, retry policy. Marks entries as acknowledged only after server confirms.

4. **Receipt API.** `commit()` returns immediately with the local passport. A separate `await_receipt(passport_id)` or callback API lets callers who care about server confirmation wait for it without blocking the agent loop.

5. **Failure semantics.** On network failure, retry indefinitely with exponential backoff. Surface persistent failure through metrics and logs, not by failing the agent's commit call. The local log is the source of truth.

6. **Offline export.** A bundle-export API that produces a self-contained verifiable record set from the local store, for handing to a regulator or auditor regardless of whether the records have reached the server.

7. **Optional external anchoring.** A hook for sending each `payload_hash` to an external timestamping service at creation time. Should not block commit unless explicitly configured to.

Reference implementations: `contextpassport/python` provides the synchronous commit API and signature support. The background sender and pluggable store are an SDK-level concern not a spec concern; implementations are encouraged to ship them.

---

## 7. Recommended pattern, by use case

| Use case | Strategy | Why |
|---|---|---|
| Solo developer prototype | Async per-event, in-memory buffer | Simplest. Acceptable to lose commits on crash during dev. |
| Production agent, moderate throughput (< 10/sec) | Batched with local persistence | Default. Survives crashes, doesn't block agent. |
| Production agent, high throughput (> 100/sec) | Batched with local persistence + external anchoring | Add OTS anchoring so server-receipt-time delay doesn't compromise trust. |
| Single high-stakes decision (e.g., large trade approval) | Synchronous per-event | Latency cost acceptable. Strongest immediate confirmation. |
| Regulated airgapped environment | Fully offline + OTS anchoring + bulk upload | Network not available. External anchoring carries the trust burden. |
| Multi-party MCP invocation | Both parties emit, both batch independently | See `proposals/context-passport-for-mcp.md`. Counterparty reconciliation is the strongest defense. |

---

## 8. What this does not cover

This document deliberately stays out of:

- **Storage architecture.** Where passports live after the receiving server has them (object storage, append-only DB, blockchain). Implementation-specific.
- **Key management.** How clients obtain and rotate signing keys. Out of scope for the spec; addressed by DID-based or PKI-based implementations.
- **Network protocol.** How the SDK talks to the server (HTTP, gRPC, MQTT). Implementation-specific.
- **Specific external anchoring providers.** OpenTimestamps is mentioned as an example; the spec does not prescribe any specific service.

---

*Context Passport — design notes for implementers. Released under CC0 along with the rest of the specification.*
