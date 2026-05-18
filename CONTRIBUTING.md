# Contributing to Context Passport

Thank you for considering a contribution. Context Passport is an open standard — every piece of feedback, from typo fixes to new event types, helps it become more useful.

**TL;DR:**
- Open an issue or a PR. We respond to everything.
- Want to become a maintainer? See [§5](#5-becoming-a-maintainer). We actively want more.
- Want to chat first? See [§7 — Getting in touch](#7-getting-in-touch).

---

## 1. Editorial improvements

Typos, clarifications, better examples, improved phrasing. Open a pull request directly. A maintainer will review and merge.

These are the lowest-friction contributions and often the most valuable. The spec gets read by regulators, compliance officers, and security architects who do not always have the patience to decode unclear sentences. Every edit that makes the spec easier to understand is welcome.

## 2. Extensions

New event types or new fields that solve a real-world problem. These do not require a spec change — they are registered in [`EXTENSIONS.md`](EXTENSIONS.md) with a namespace prefix (e.g. `acme.payment_authorized`).

Steps:
1. Pick a namespace prefix unique to your organization.
2. Implement and ship the extension in your own system.
3. Open a PR adding a row to `EXTENSIONS.md` so other implementers can discover and reuse it.

Approval of an extension registration is not endorsement — the registry exists to enable discovery, not to gate experimentation.

## 3. RFCs (substantive changes to the core spec)

Anything that changes the meaning of existing fields, adds a required field, or adds an event type to the core taxonomy. Open a GitHub issue labeled `rfc`. See [`GOVERNANCE.md`](GOVERNANCE.md) for the full process.

An RFC includes:
1. Problem statement
2. Proposed change to the spec
3. Backward compatibility analysis
4. At least one reference implementation (can be a sketch)

After 14 days of public discussion, maintainers either accept, request changes, or decline.

## 4. Reference implementations and ecosystem work

Spec changes are one path. Implementations are another. The Context Passport organization maintains:

- [`contextpassport/python`](https://github.com/contextpassport/python) — Python reference SDK
- [`contextpassport/typescript`](https://github.com/contextpassport/typescript) — TypeScript reference SDK
- [`contextpassport/conformance-tests`](https://github.com/contextpassport/conformance-tests) — vectors and runner
- [`contextpassport/verifiable-agent-template`](https://github.com/contextpassport/verifiable-agent-template) — starter template

Each repository accepts PRs independently. Common contribution areas:

- **Framework integrations.** LangChain, LlamaIndex, CrewAI, Bedrock Agents, ADK — each needs a callback / middleware that emits Context Passports. The `langgraph` integration in `contextpassport/python` is the reference pattern.
- **Language ports.** Rust, Go, Java, Ruby. Implementations targeting Core conformance can be added directly; signed conformance is a follow-up.
- **Operator-side tools.** Witness Log builders, inclusion-proof verifiers, anchor-bridging tools, compliance report generators.
- **Documentation and examples.** Real-world recipes, framework-specific guides, regulatory walkthroughs.

If you ship a third-party implementation, open a PR adding it to [`IMPLEMENTATIONS.md`](IMPLEMENTATIONS.md).

## 5. Becoming a maintainer

**Yes, we want more maintainers.** A standard with one maintainer is, in practice, a vendor schema. The credibility of Context Passport as a community standard grows with every additional independent maintainer.

The path:

1. **Make sustained contributions over time.** Typical bar: three substantive merged pull requests over three months, plus participation in spec discussions (RFCs, issues, conformance-test improvements).
2. **Demonstrate alignment with the spec's principles** — minimal core, forward compatibility, vendor neutrality, real conformance.
3. **An existing maintainer nominates you** by opening a PR adding you to `.github/CODEOWNERS`.
4. **Existing maintainers reach consensus** over a 14-day comment window.
5. **On approval, you get merge rights** on the canonical repository.

We are explicitly looking for maintainers who:
- Bring perspectives the current maintainers lack (regulated industry, non-Python/TS language ecosystems, non-US/EU regulatory contexts)
- Will engage steadily over time, not just contribute once
- Are willing to push back on bad ideas including ours

The goal in `GOVERNANCE.md` is to have at least three independent maintainers from at least two organizations within twelve months of v1.0 final. We are currently below that. Help us get there.

## 6. What kinds of issues are good first contributions

If you want to contribute but don't have a specific change in mind, look at GitHub issues labeled:

- `good-first-issue` — small, well-scoped, suitable for first-time contributors
- `help-wanted` — clear scope, larger scope, looking for someone to pick up
- `docs` — improvements to specification text, examples, or design notes

Don't see what you want? Open a discussion describing what you'd like to work on, and a maintainer will help shape it into a tractable issue.

## 7. Getting in touch

Multiple channels, in order of preference:

- **GitHub Discussions** — https://github.com/contextpassport/spec/discussions — best for open-ended questions about the spec or its intended use
- **GitHub Issues** — best for concrete bugs, proposed changes, or RFCs
- **Pull requests** — best for editorial improvements and ready-to-review changes
- **Email** — `maintainers@contextpassport.com` for things that don't fit the above (sensitive coordination, private feedback, partnership inquiries)
- **Security reports** — `security@contextpassport.com`. See [`SECURITY.md`](SECURITY.md).
- **Conduct concerns** — `conduct@contextpassport.com`. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

We try to respond to everything within a few days. If you don't hear back in a week, ping again — sometimes things slip.

## Pull request checklist

- [ ] Change is editorial OR is referenced from an accepted RFC OR is an extension registration
- [ ] If the change affects the schema, `schema/v1.json` is updated to match `SPEC.md`
- [ ] If the change affects examples, the example JSON validates against the schema
- [ ] If the change adds a new conformance requirement, the conformance test suite has been updated
- [ ] `SPEC.md` and `README.md` are kept in sync where they discuss the same concept

## License of contributions

By submitting a pull request, you agree that your contribution is dedicated to the public domain under CC0 1.0 (for specification content) or licensed under Apache-2.0 (for reference implementation code). You retain no copyright claim.

If your employer or another party may have claims on your contribution, please obtain authorization before submitting.

## Code of conduct

Be direct. Be specific. Critique the work, not the person. Disagreement is welcome; personal attacks are not. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for the full text.
