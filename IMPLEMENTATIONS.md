# Context Passport Implementations

A registry of known Context Passport compatible implementations.

To add your implementation: open a pull request editing this file.

## Reference Implementation

| Name | Language | License | Repository | Conformance | Notes |
|---|---|---|---|---|---|
| DarkMatter | Node.js | Apache-2.0 | github.com/darkmatter-hub/darkmatter | Core (Signed pending) | Hash chain, storage, replay, fork, verify, export, Witness Log anchoring |

## Community Implementations

*None listed yet. Be the first.*

To list your implementation here:
1. Verify your implementation passes the required vectors in `conformance-tests/`
2. Open a pull request adding a row to this table
3. Include: name, primary language, license, repository link, conformance level, brief notes

## Conformance levels

See `conformance-tests/README.md` for the full test suite. Three levels:

- **Core** — passes `vectors/required/`. Produces and verifies plain (unsigned) passports correctly.
- **Signed** — Core plus `vectors/signed/`. Produces and verifies Ed25519-signed passports.
- **Full** — Signed plus `vectors/recommended/`. Handles fork lineage, extensions, and long chains.

An implementation is **Context Passport v1.0 Core conformant** if it:

1. Produces passports that validate against `schema/v1.json`
2. Correctly computes the integrity block as defined in SPEC.md section 3.4
3. Correctly links parent commits via `parent_id`
4. Correctly verifies chains by recomputing hashes
5. Sets `schema_version: "1.0"` on all produced passports
6. Accepts and ignores unknown namespaced extensions without error
