# Context Passport for MCP

**Status:** Draft proposal
**Authors:** DarkMatter (initial steward)
**Last updated:** 2026
**Target audience:** MCP working group, MCP server implementers, MCP client implementers, Anthropic MCP team
**Relationship to MCP:** Optional extension. No required changes to MCP itself.

---

## Summary

This proposal defines how MCP servers and clients can emit, exchange, and verify [Context Passport](../SPEC.md) records alongside MCP tool invocations. Context Passport is a CC0-licensed envelope format for structured, verifiable records of AI agent events. Adding it to MCP gives operators, regulators, and downstream consumers a vendor-independent way to verify what an MCP-mediated invocation actually did.

This proposal does not change MCP. It is an additive extension that MCP servers and clients can adopt independently. Servers and clients that ignore Context Passport headers and metadata continue to work exactly as before.

## Motivation

MCP standardizes how an AI agent invokes a tool exposed by a server. The protocol describes the request and response shapes. It does not describe how the *record* of that invocation is produced or how a third party can later verify what happened.

In practice, every MCP server today logs invocations to whatever audit infrastructure its operator chose — typically a database table inside the operator's own system. This works for the operator. It does not work for the regulator, the auditor, the counterparty, or the agent vendor who needs to prove that nothing was modified after the fact.

The gap matters increasingly as MCP gets used for actions with real consequences — payment approvals, customer data sharing, regulatory decisions. The model provider can prove what the model returned; the MCP server can claim what action it took; nobody has a credible vendor-independent record of the action itself.

Context Passport already exists as a CC0 standard for this exact problem. The work of this proposal is to define how it composes with MCP cleanly.

## Non-goals

- **This proposal does not specify storage.** Where Context Passport records are stored — locally, on a customer-controlled object store, on a vendor-operated witness log, on Sigstore-like transparency infrastructure — is out of scope.
- **This proposal does not specify identity.** How agents and servers obtain signing keys is out of scope. Context Passport's signature field (SPEC.md §3.2.7) is algorithm-agnostic and key-management-agnostic.
- **This proposal does not change MCP semantics.** A server that adopts Context Passport produces the same MCP responses as before, plus an additional record.

## Design

### Three integration points

Context Passport composes with MCP at three points: server-side emission, client-side emission, and transport-level header.

**1. Server-side emission.** An MCP server that adopts Context Passport emits one passport per tool invocation. The `event.type` is `commit`. The `payload.input` reflects the tool arguments. The `payload.output` reflects the tool result. The `created_by` block identifies the server. If the server runs inside a customer environment (typical for self-hosted MCP servers), the customer's signing key signs the envelope.

**2. Client-side emission.** An MCP client (typically the agent runtime) emits one passport per tool invocation, on its side of the boundary. The `event.type` is `spawn` if the agent is delegating, or `commit` if the agent is recording the decision to invoke. The `payload.input` reflects what the agent decided to send; `payload.output` reflects what the agent received. The client's signing key signs the envelope.

Server-side and client-side records together form a two-party record of the same invocation. Each is independently verifiable. Neither party can forge the other's record. This is the structural property that makes the record credible to a third party.

**3. Transport-level header.** Servers and clients that emit Context Passports include the passport's `id` as an HTTP header on MCP request and response messages:

```
X-Context-Passport-Id: ctx_1700000000000_abc123def456
```

This allows correlation across the boundary without bloating the MCP message body. Implementations that need the full passport can fetch it from a separate endpoint (defined by the implementation, not by this proposal).

### Schema mapping

The Context Passport `event` block maps to MCP semantics as follows:

| MCP concept | Context Passport field | Notes |
|---|---|---|
| MCP `tools/call` request | `event.type = "commit"` | Both client and server may emit. |
| MCP `tools/call` response | `event.type = "commit"` | Server emits; correlates with the request passport via `parent_id`. |
| MCP `tools/list` | (not emitted) | Read-only discovery; no event. |
| MCP resource invocation | `event.type = "commit"` | Same shape as tool calls. |
| MCP error response | `event.type = "error"` | `payload.output` may be null. |
| Agent decides to invoke tool | `event.type = "spawn"` | Emitted by the client agent before sending the MCP request. |

The `payload` block carries the tool name, the arguments, and the result:

```json
{
  "payload": {
    "input": {
      "tool":      "stripe_create_charge",
      "arguments": { "amount": 8400000, "currency": "usd", "customer": "cus_..." }
    },
    "output": {
      "id":     "ch_3OABCDEF...",
      "status": "succeeded"
    },
    "memory": {
      "mcp": {
        "server_name":    "stripe-mcp",
        "server_version": "1.4.2",
        "transport":      "stdio"
      }
    }
  }
}
```

### Chain linkage across boundaries

Both the client and the server passport for a single MCP invocation set `event.to_agent_id` to identify the other party. Server-side passports may set `parent_id` to the client-side passport's `id` when the client passport is known. This produces a verifiable cross-system chain: a record of "the agent decided to call this tool, the server received the call, the server returned this result, the agent received this result."

A third-party verifier holding the chain can reconstruct exactly what was invoked, when, by whom, with what arguments, and what result was returned. None of the parties involved is required to be online for verification.

### Custom MCP-namespaced extensions

Context Passport's extension model (SPEC.md §2.6, EXTENSIONS.md) allows MCP-specific fields. Recommended namespace: `mcp.*`.

Initial extensions for the MCP registry:

- `mcp.server_name` — name of the MCP server
- `mcp.server_version` — version string
- `mcp.transport` — `stdio`, `sse`, `streamable-http`, or implementation-specific
- `mcp.session_id` — for session-bound MCP transports

These are registered as namespaced extensions in `EXTENSIONS.md` and may be promoted to core in a future major version of the spec.

## Conformance

An MCP implementation is **Context Passport for MCP v0.1 conformant** if it:

1. Emits one Context Passport per tool invocation (server side or client side).
2. The emitted passports validate against `schema/v1.json`.
3. Includes the `X-Context-Passport-Id` header on every MCP message it sends, where the header value is the `id` of the passport corresponding to that message.
4. Correctly sets `event.type` according to the schema mapping table above.
5. Passes the relevant subset of the Context Passport v1.0 conformance test suite.

Additional conformance levels (signed, chain-linked) follow the Context Passport spec's conformance levels.

## Implementation guidance

### For MCP server implementers

The simplest path: wrap the existing tool-handler dispatch with a Context Passport emission. Pseudo-code:

```python
from context_passport import make_passport

def handle_tool_call(name, args, parent_id=None):
    passport = make_passport(
        agent_id    = f"mcp-server:{SERVER_NAME}",
        agent_name  = SERVER_NAME,
        payload     = {"input": {"tool": name, "arguments": args}, "output": None},
        parent      = lookup_parent(parent_id),
        event_type  = "commit",
        provider    = "mcp",
        model       = None,
    )
    result = dispatch_tool(name, args)
    final = make_passport(
        agent_id    = f"mcp-server:{SERVER_NAME}",
        agent_name  = SERVER_NAME,
        payload     = {"input": {"tool": name, "arguments": args}, "output": result},
        parent      = passport,
        event_type  = "commit",
    )
    return result, final["id"]
```

### For MCP client implementers (agent runtimes)

The recommended hook point is wherever the runtime decides to send an MCP `tools/call`. Emit a `spawn` passport before sending the request, then a `commit` passport when the response is received. The reference Python implementation's LangGraph callback handler (`context_passport.integrations.langgraph`) shows the pattern; an MCP-specific version is a near-direct port.

## Open questions

1. **Is `X-Context-Passport-Id` the right header name?** Alternative considered: `Context-Passport-Id`. Argument for `X-` prefix: signals "non-standard extension" clearly. Argument against: `X-` prefixes are discouraged by RFC 6648. The MCP working group should decide.
2. **Should the proposal define how to fetch a passport by id?** Currently out of scope (implementation-defined endpoint). Argument for defining: cross-implementation interop. Argument against: scope creep into storage and identity decisions Context Passport explicitly stays out of.
3. **Should server-side and client-side passports be required to chain?** Currently optional via `parent_id`. Argument for required: stronger evidence chain. Argument against: requires session-level coordination that not all MCP transports support.

## Process

This is a draft proposal published for community discussion. The intended next steps:

1. **Solicit feedback** from MCP working group, MCP server implementers (Stripe, Cloudflare, Sentry, GitHub, others), and agent runtime maintainers (Anthropic, OpenAI, LangGraph).
2. **Update based on feedback** through pull requests against this document.
3. **Submit to MCP working group** as a formal extension proposal once feedback has been incorporated.
4. **Reference implementations** in both `contextpassport/python` and `contextpassport/typescript` once the proposal stabilizes.

Issues and pull requests welcome at `github.com/contextpassport/spec`.

---

*Context Passport is CC0. This proposal is CC0. Implementations released under Apache-2.0.*
