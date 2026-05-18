# Regulatory Mapping

**Status:** Non-normative reference
**Audience:** Compliance officers, legal counsel, audit teams, sales engineers explaining Context Passport to regulated buyers
**Disclaimer:** This document describes how Context Passport's technical properties align with specific regulatory requirements. It is not legal advice. Compliance is determined by your legal counsel and any applicable notified body or auditor, not by this document.

---

## Why this document exists

Compliance teams evaluating Context Passport need to know which of their existing regulatory obligations the standard helps satisfy and which it does not. Engineers building Context Passport-based pipelines need to know which fields are load-bearing for compliance use cases. This document is the field-by-field bridge between regulatory text and the spec.

Each section follows the same structure:

1. **What the regulation requires** — direct quote or close paraphrase of the operative text
2. **How Context Passport satisfies it** — which fields and properties map to the requirement
3. **What is still on the operator** — gaps the spec does not fill, which the operator must address through other means

---

## 1. EU AI Act — Article 12 (Logging) and Article 26 (Provider obligations)

### What the regulation requires

Article 12 of [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) (the EU AI Act) requires providers of high-risk AI systems to ensure their systems **"technically allow for the automatic recording of events ('logs') over the lifetime of the system."** The recording must be sufficient to:

- (a) Identify situations that may result in the AI system presenting a risk under Article 79(1), or in a substantial modification of the system
- (b) Facilitate post-market monitoring as referenced in Article 72
- (c) Monitor the operation of high-risk AI systems referred to in Article 26(5)

The Commission's interpretive guidance treats **"traceability"** as a structural property of the record itself, not merely a claim by the provider that records exist.

### How Context Passport satisfies it

| Article 12 requirement | Context Passport mechanism |
|---|---|
| Automatic recording of events | `dm.commit()` (or equivalent SDK call) at decision time produces one passport per agent action. Every action that may bear on risk identification, post-market monitoring, or operational monitoring is captured. |
| Records sufficient to identify risk situations | `payload.input`, `payload.output`, `created_by.agent_id`, `created_by.model`, `event.type`, `event.timestamp` together provide the inputs, outputs, identity, and timing necessary for risk-situation reconstruction. |
| Records sufficient to facilitate post-market monitoring | `parent_id` chaining permits replay of the full decision history of a single trace. `trace_id` groups related decisions into a single monitored pipeline. |
| Records sufficient to monitor operation | The hash chain (`integrity_hash`, `parent_hash`) makes any tampering with historical records detectable by the operator or by any auditor. |
| Traceability as a structural property | `integrity_hash` + optional Ed25519 signature (SPEC.md §3.2.7) + external anchoring (docs/external-anchoring.md) make the record verifiable by a third party with no trust in the operator. This is the structural difference between a self-reported log and a traceable record. |

### What is still on the operator

- **Retention period.** Article 12 implies logs must be kept "over the lifetime of the system." Context Passport does not specify retention; the operator must implement durable storage with appropriate retention policies.
- **Risk-situation identification.** Determining which events constitute a "risk situation under Article 79(1)" is the provider's substantive judgment, not a property of the record format.
- **System-level documentation.** Article 11 (technical documentation) requires extensive system documentation that Context Passport does not address.
- **Notified-body interaction.** The notified body's interpretation of "sufficient" for a specific deployment is determined case-by-case.

---

## 2. EU AI Act — Article 79 (Procedure for AI systems presenting a risk)

### What the regulation requires

Article 79 establishes the procedure for handling AI systems that present a risk to health, safety, or fundamental rights. When competent authorities investigate, the provider must furnish "all the information and documentation necessary to demonstrate the conformity" of the system.

### How Context Passport satisfies it

| Requirement | Context Passport mechanism |
|---|---|
| Demonstrate conformity post-incident | The hash chain of historical records, combined with external anchoring of checkpoints, lets the provider produce evidence that survives independent verification by the competent authority. |
| Demonstrate records were not modified after the incident was discovered | External anchoring (Bitcoin via OpenTimestamps) proves the records' hashes existed at the externally-attested time. Modifying records after the incident is detectable because the new hashes would not match the anchored ones. |
| Reconstruct the decision lineage of the relevant action | `parent_id` and `trace_id` permit walking the full chain backward from the incident to first cause. |

### What is still on the operator

- **Article 79 reporting timelines.** The operator must produce evidence within the procedural timelines. Slow Witness Log retrieval is the operator's problem, not the spec's.
- **Identifying which records are relevant.** Context Passport supports searching, but the operator must build the search index and the case-specific filters.

---

## 3. FINRA 17a-4 (Books and records requirements for broker-dealers)

### What the regulation requires

[SEC Rule 17a-4](https://www.sec.gov/rules-regulations/2022/10/electronic-recordkeeping-requirements-broker-dealers-security-based-swap-dealers-major) (as amended in 2022) requires broker-dealers to preserve records in either a **write-once, read-many (WORM)** format or an **audit-trail-based** format. The audit-trail option requires the system to:

- Maintain a complete, time-stamped audit trail of all modifications, including original records, modified records, the identity of the modifier, the date and time of each modification
- Verify the integrity, accuracy, and reliability of the recordkeeping system
- Permit re-creation of the original record without alteration

### How Context Passport satisfies it

| 17a-4 requirement | Context Passport mechanism |
|---|---|
| WORM-equivalent integrity | The append-only constraint in operator storage (docs/witness-log.md §2) plus the hash chain prevents modification. Records cannot be silently altered. |
| Audit trail of modifications | Context Passport does not modify records — every change is a new commit chained to the previous. The chain is itself the audit trail. |
| Identity of modifier | `created_by.agent_id`, optionally with Ed25519 signature, provides authoritative attribution. |
| Time-stamped modifications | `event.timestamp` (client-side) plus server-receipt timestamp plus optional external anchor provide three independently-verifiable time properties. |
| Verify integrity, accuracy, reliability | The hash chain + signature provide cryptographic verification. The reference verifier (open source) lets any party check independently. |
| Re-create the original record | Records are immutable. The original is always available; there is no "modified" version to distinguish from. |

### What is still on the operator

- **Designated Third-Party Downloader (D3P).** 17a-4 requires the firm to designate an independent third party able to download records to satisfy SEC requests. The operator must designate and contract with such a party; Context Passport provides the data format but not the personnel arrangement.
- **Retention period.** SEC mandates 3-6 years depending on record type. Retention is operator policy.
- **Pre-production attestation.** The firm must file a notice with the SEC before adopting the audit-trail-based option. The notice is the firm's responsibility.

---

## 4. HIPAA — 45 CFR §164.312(b) (Audit controls)

### What the regulation requires

The HIPAA Security Rule's [Audit Controls standard](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C/section-164.312#p-164.312(b)) requires covered entities to "implement hardware, software, and/or procedural mechanisms that record and examine activity in information systems that contain or use electronic protected health information."

§164.308(a)(1)(ii)(D) further requires regular review of records of information-system activity to identify potential security violations.

### How Context Passport satisfies it

| HIPAA requirement | Context Passport mechanism |
|---|---|
| Record activity in systems handling PHI | `payload` records the activity; `event.type` distinguishes commit / access / share / consent events. |
| Examine activity | The hash chain plus the verifier permit independent examination. The structured payload allows automated analysis. |
| Identify potential security violations | Continuity expectations (see docs/throughput-and-trust.md §5.3) + chain breaks + signature failures all surface as machine-detectable signals. |

### What is still on the operator

- **Encryption of PHI.** The Security Rule's encryption requirements are separate. Context Passport's payload is not encrypted by default; operators handling PHI MUST encrypt the payload before committing (BYOK pattern; see SPEC.md §5.2).
- **Access controls.** §164.312(a) requires unique user identification and access controls. Context Passport provides the audit trail; access controls live at the application layer.
- **Breach notification.** A breach involving Context Passport records still triggers breach-notification rules. The fact that the records are tamper-evident may inform the harm assessment but does not eliminate the obligation.

---

## 5. SOX § 404 (Internal control over financial reporting)

### What the regulation requires

Section 404 of the [Sarbanes-Oxley Act of 2002](https://www.govinfo.gov/content/pkg/PLAW-107publ204/pdf/PLAW-107publ204.pdf) requires public companies to:

- Establish and maintain internal control over financial reporting (ICFR)
- Annual management assessment of ICFR effectiveness
- External auditor attestation on ICFR (for accelerated filers)

PCAOB Auditing Standard 2201 elaborates the auditor's requirements, including evaluation of the integrity of financial-reporting data.

### How Context Passport satisfies it

When AI agents are involved in financial-reporting workflows (transaction approval, journal-entry generation, reconciliation), Context Passport provides:

| SOX/ICFR concern | Context Passport mechanism |
|---|---|
| Authorization controls | `created_by.agent_id` + signature establish who authorized each agent action. |
| Segregation of duties | Records of multi-agent workflows show which agent did which step; combined with role-based controls upstream, this supports SoD enforcement. |
| Audit trail for material transactions | Every commit is part of an immutable, signed chain. Auditors can recompute and verify the chain independently. |
| Change detection | The hash chain makes any post-hoc modification of an agent's recorded decision detectable. |

### What is still on the operator

- **Risk assessment scoping.** Determining which agent actions are "material" to financial reporting and therefore in-scope for ICFR is the management's substantive judgment.
- **Control documentation.** SOX requires documented control descriptions. Context Passport is a control component; the description of the broader control environment is the operator's.
- **Independent testing.** SOX requires independent testing of controls. The auditor will test Context Passport-based controls; the operator must provide access and explanation.

---

## 6. GDPR — Article 30 (Records of processing activities)

### What the regulation requires

Article 30 of the [General Data Protection Regulation](https://gdpr.eu/article-30-records-of-processing-activities/) requires controllers and processors to maintain records of processing activities, including:

- Categories of data subjects and personal data
- Categories of recipients
- Transfers to third countries
- Time limits for erasure
- Description of technical and organizational security measures

Article 32 separately requires "the ability to ensure the ongoing confidentiality, integrity, availability and resilience of processing systems and services."

### How Context Passport satisfies it

| GDPR concern | Context Passport mechanism |
|---|---|
| Demonstrate processing activities | Each `commit` event captures one processing activity by an AI agent. The chain provides the longitudinal record. |
| Demonstrate integrity (Art. 32) | The hash chain + signature + external anchoring jointly provide integrity guarantees. |
| Support data-subject access requests (Art. 15) | `payload.input` and `payload.output` may contain personal data; `trace_id` groups activities affecting a single data subject. |
| Support erasure requests (Art. 17) — see caveat | The append-only design conflicts with literal erasure. Operators must address this through pseudonymization or by separating personal data from the immutable record. |

### What is still on the operator

- **Right to erasure conflict.** The append-only chain cannot literally erase records. Two operator approaches:
  - **Pseudonymization.** Store personal data with pseudonymous identifiers in the passport; maintain the mapping in a separate, deletable store. When a data subject requests erasure, delete the mapping. The passport remains but is no longer linkable to a person.
  - **Off-chain personal data.** Store personal data outside the passport entirely; include only a content hash. Erasure deletes the off-chain data; the passport becomes a record-of-the-record that no longer exposes personal information.
- **Lawful basis.** Article 6 requires a lawful basis for processing. Recording activity does not establish a lawful basis for the activity itself.
- **Data Protection Impact Assessment (DPIA).** Article 35 may require a DPIA for high-risk AI processing. Context Passport supports the assessment but does not perform it.

---

## 7. PCI DSS — Requirement 10 (Track and monitor all access to network resources and cardholder data)

### What the regulation requires

[PCI DSS v4.0](https://www.pcisecuritystandards.org/document_library/) Requirement 10 mandates audit trails for all individual access to cardholder data, with specific data elements: user identification, type of event, date and time, success/failure indication, origination, identity of affected data/system. Audit trail files must be protected from modification.

### How Context Passport satisfies it

| PCI DSS 10 element | Context Passport mechanism |
|---|---|
| 10.2 — Implement automated audit trails for all system components | `dm.commit()` per access event. |
| 10.3.1 — User identification | `created_by.agent_id`. |
| 10.3.2 — Type of event | `event.type`. |
| 10.3.3 — Date and time | `event.timestamp` + `created_at` + server-receipt time. |
| 10.3.4 — Success or failure indication | `event.type` may be `commit` (success) or `error` (failure); `payload.output` distinguishes. |
| 10.3.5 — Origination of event | `created_by` block. |
| 10.3.6 — Identity or name of affected data, system component | `payload` content. |
| 10.5 — Protect audit trail files from modification | Hash chain + append-only storage + external anchoring. |

### What is still on the operator

- **Cardholder data must not appear in passport payloads in plaintext.** Encrypt or tokenize PAN/CVV before committing; store the encrypted form in the payload.
- **Daily log review.** Requirement 10.6 requires daily review of audit logs. Context Passport provides the data; the review process is operator policy.

---

## 8. ISO/IEC 42001 (Artificial Intelligence Management System)

### What the regulation requires

[ISO/IEC 42001:2023](https://www.iso.org/standard/81230.html) is the first international management-system standard for AI. Annex A includes controls for AI system lifecycle management, including A.6.2.5 (AI system documentation), A.7.4 (data quality records), and A.9.2 (system operation monitoring).

### How Context Passport satisfies it

| 42001 control | Context Passport mechanism |
|---|---|
| A.6.2.5 — System documentation | The full chain of agent decisions is documentation of system behavior. |
| A.7.4 — Data quality records | `payload.input` and `payload.output` together document the data each agent saw and produced. |
| A.9.2 — System operation monitoring | The continuous append-only chain is the operational monitoring artifact. |
| Continuous improvement | The chain enables retrospective analysis of agent decisions; patterns of poor outcomes can be identified and remediated. |

### What is still on the operator

- **Management commitment, policy, and roles.** 42001 requires a formal AI management system with documented commitment, policy, and assigned roles. Context Passport is a technical component; the management system around it is the operator's work.
- **Risk and impact assessments.** 42001 requires AI risk and impact assessments. Records produced by Context Passport inform these but do not perform them.

---

## 9. NIST AI Risk Management Framework (AI RMF 1.0)

### What the regulation requires

[NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework) is a voluntary framework with four functions: Govern, Map, Measure, Manage. Within Measure 2.7, AI systems should produce data sufficient for accountability tracing.

### How Context Passport satisfies it

| AI RMF function | Context Passport mechanism |
|---|---|
| Measure 2.7 — Accountability traceability | The chain provides traceability from outcome backward through the agent's decisions. |
| Manage 1.3 — Risk monitoring | The append-only record supports post-hoc analysis when risks materialize. |
| Govern 1.4 — Documentation | The chain is itself documentation of AI system behavior. |

### What is still on the operator

- **Map function.** Identifying the AI system's risks requires substantive analysis; Context Passport supports it but does not perform it.
- **Stakeholder engagement.** NIST emphasizes engaging affected communities; this is process, not data.

---

## 10. State-level proposals (US)

Several US states have proposed AI auditing requirements. Notable examples:

- **California SB 1047 (vetoed September 2024)** — would have required model developers to implement safety and security protocols, including incident reporting.
- **New York City Local Law 144** — requires bias audits for automated employment decision tools, with publicly-available audit results.
- **Colorado AI Act (SB24-205)** — effective February 2026, requires developers and deployers of high-risk AI systems to provide impact assessments.

Context Passport's audit-trail properties support compliance with the recordkeeping aspects of these regimes. Each has specific procedural requirements that the spec does not address.

---

## 11. Sector-specific frameworks

### Banking — Federal Reserve SR 11-7 (Model Risk Management)

The Federal Reserve's [SR 11-7](https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm) guidance requires banks to validate models, document their development and use, and track ongoing performance. When AI agents make modeled decisions:

- Context Passport's commit chain documents each model invocation, including model version (`created_by.model`).
- Performance tracking can be built on top of the queryable record.

### Aviation — FAA Part 121 (cockpit voice recorder / flight data recorder analogy)

Aviation's "black box" requirements are an instructive analogy: independent recording of operational events, tamper-evident, retained for post-incident analysis. Context Passport provides equivalent properties for AI agent operations. No formal FAA regulation maps to AI agents yet, but the conceptual mapping is direct.

### Healthcare — FDA Software as a Medical Device (SaMD) audit trail expectations

The FDA's [SaMD framework](https://www.fda.gov/medical-devices/digital-health-center-excellence/software-medical-device-samd) expects manufacturers to maintain documentation of software behavior in the field. For AI-based SaMD, this includes the decisions the AI made and the inputs it considered. Context Passport supports both.

---

## 12. Mapping summary table

| Framework | Primary Context Passport mechanism | Operator additional work |
|---|---|---|
| EU AI Act Art. 12 | Automatic commits + hash chain + external anchoring | Risk-situation identification, retention policy |
| EU AI Act Art. 79 | Externally-anchored chain provides post-incident evidence | Reporting timelines, evidence retrieval infrastructure |
| FINRA 17a-4 | Append-only storage + hash chain satisfies audit-trail option | D3P designation, SEC notice filing |
| HIPAA §164.312(b) | Activity recording + verification | Encryption of PHI in payload, access controls |
| SOX § 404 | Authorization records + audit trail | Materiality determination, control documentation |
| GDPR Art. 30 | Processing activity records + integrity | Erasure handling (pseudonymization or off-chain personal data) |
| PCI DSS 10 | Audit trail elements + tamper protection | Encrypt cardholder data, daily log review |
| ISO/IEC 42001 | System documentation via chain | Management system around the technical component |
| NIST AI RMF | Accountability traceability | Risk identification, stakeholder engagement |

---

## 13. How to use this document

For a compliance officer evaluating Context Passport:

1. Identify your applicable frameworks (most operators face 2-4).
2. Read the relevant sections to understand the mapping.
3. Build the operator-side controls and documentation listed under "What is still on the operator."
4. Engage your legal counsel and (where applicable) your notified body or external auditor to confirm the mapping satisfies their interpretation.

For a sales engineer responding to a buyer's compliance question:

1. Confirm the buyer's framework.
2. Point them at the relevant section of this doc.
3. Be honest about gaps — Context Passport is a technical component; it does not constitute compliance on its own.
4. Offer to introduce them to operator-side patterns documented in `docs/witness-log.md` and `docs/key-management.md`.

For a regulator or auditor:

1. The spec is open (CC0). You can inspect every aspect of it without vendor cooperation.
2. The conformance test suite is publicly runnable. You can verify any claim of conformance.
3. The reference implementations are open-source. You can run them yourself.
4. Cross-implementation verification is supported by the conformance vectors.

---

## 14. What this document is not

- **Legal advice.** This is a technical mapping, not a legal opinion.
- **A compliance audit.** Mapping a spec to a regulation is not the same as auditing an operator's deployment.
- **A guarantee of regulatory acceptance.** Specific regulators may have specific interpretations that differ from the analysis here.
- **Static.** Regulations evolve. This document is non-normative and will be updated as significant new regulations emerge.

If you find an error or omission in this mapping, please open a PR or issue at `github.com/contextpassport/spec`.

---

*Context Passport — design notes for implementers and compliance teams. Released under CC0 along with the rest of the specification.*
