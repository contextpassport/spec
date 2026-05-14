# Contributing to Context Passport

Thank you for considering a contribution. Context Passport is an open standard — every piece of feedback, from typo fixes to new event types, helps it become more useful.

## Three kinds of contributions

### 1. Editorial improvements
Typos, clarifications, better examples, improved phrasing. Open a pull request directly. A maintainer will review and merge.

### 2. Extensions
New event types or new fields that solve a real-world problem. These do not require a spec change — they are registered in `EXTENSIONS.md` with a namespace prefix (e.g. `acme.payment_authorized`). See `EXTENSIONS.md` for the registration process.

### 3. RFCs (substantive changes to the core spec)
Anything that changes the meaning of existing fields, adds a required field, or adds an event type to the core taxonomy. Open a GitHub issue labeled `rfc`. See `GOVERNANCE.md` for the full process.

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

Be direct. Be specific. Critique the work, not the person. Disagreement is welcome; personal attacks are not.

## Questions

Open a GitHub Discussion for general questions about the spec or its intended use. Open an Issue only for concrete bugs or proposed changes.
