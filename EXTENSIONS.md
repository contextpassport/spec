# Context Passport Extensions

Extensions allow implementations to add new event types and new fields without modifying the core specification. This is the mechanism that lets Context Passport grow without breaking existing implementations.

## How extensions work

1. Pick a namespace prefix unique to your organization. Examples: `acme`, `bankco`, `fintechco`.
2. Use that prefix on every custom event type or field name: `acme.payment_authorized`, `bankco.kyc_event`, `fintechco.position_opened`.
3. Implementations that do not recognize the namespace MUST ignore the field or event without error. This is required for forward compatibility.
4. Register the extension in this file via pull request so other implementers can discover and reuse it.

## Promotion to core

An extension that meets all of the following is a candidate for promotion to the core specification in the next major version:

- Registered here for at least six months
- Implemented by at least three independent organizations
- Generalizable beyond the originating use case
- No conflicts with existing core fields

Promotion to core means the namespace prefix is dropped and the extension becomes part of `SPEC.md`. Existing namespaced uses remain valid as aliases for one major version.

## Registry

| Namespace | Type | Description | Maintainer | Status | Since |
|---|---|---|---|---|---|
| *(none registered yet)* | | | | | |

Implementations using namespaced extensions are encouraged to register them here via pull request.

## Submitting an extension

Open a pull request adding a row to the table above. Include in the PR description:

1. The namespace prefix and name
2. Whether it is an event type or a field
3. The shape of the data (schema fragment or JSON example)
4. The problem it solves
5. Link to at least one implementation (open-source preferred)

A maintainer will merge after a brief review confirming the namespace is unused and the extension is well-formed. Approval is not endorsement — the registry exists to enable discovery, not to gate experimentation.
