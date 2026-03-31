# Context Passport Implementations

A registry of known Context Passport compatible implementations.

To add your implementation: open a pull request editing this file.

## Reference Implementation

| Name | Language | License | Repository | Notes |
|---|---|---|---|---|
| DarkMatter | Node.js | MIT | github.com/darkmatter-hub/darkmatter | Full implementation: hash chain, storage, replay, fork, verify, export |

## Community Implementations

*None listed yet. Be the first.*

To list your implementation here:
1. Verify your implementation passes the conformance tests in `tests/`
2. Open a pull request adding a row to this table
3. Include: name, primary language, license, repository link, brief notes

## Conformance

An implementation is Context Passport v1.0 conformant if it:

1. Produces passports that validate against `schema/v1.json`
2. Correctly computes the integrity block as defined in SPEC.md section 3.4
3. Correctly links parent commits via `parent_id`
4. Correctly verifies chains by recomputing hashes
5. Sets `schema_version: "1.0"` on all produced passports
