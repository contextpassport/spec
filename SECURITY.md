# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in the Context Passport specification or any maintainer-published reference implementation, please report it privately.

**Email:** security@contextpassport.com

Please include:

- A description of the vulnerability
- Steps to reproduce, or a proof of concept
- The affected component (spec, reference implementation, conformance tests)
- Your assessment of severity, if any

We will acknowledge receipt within 72 hours and aim to provide an initial response within 7 days. We will keep you informed as we investigate and prepare a fix.

## Scope

This policy covers:

- The Context Passport specification (`SPEC.md`, `schema/v2.json`, `schema/v1.json`)
- Reference implementations published under the `contextpassport` GitHub organization
- The conformance test suite

Vulnerabilities in third-party implementations should be reported to those projects directly.

## Disclosure

We follow coordinated disclosure. Once a fix is available, we publish an advisory crediting the reporter (unless anonymity is requested). We do not maintain a bug bounty program at this time.

## What counts as a vulnerability

Examples of issues we treat as security vulnerabilities:

- Schema definitions that allow forged or undetectably-modified passports
- Reference implementation bugs that produce invalid integrity hashes
- Canonicalization bugs that allow two distinct payloads to produce the same hash
- Signature verification flaws (in implementations claiming Signed conformance)

Examples that are **not** security vulnerabilities and should be filed as regular issues:

- Suggestions for new fields or event types
- Typos in documentation
- Compatibility issues with specific frameworks
