#!/usr/bin/env python3
"""
Generates the compliance-event examples in examples/ using the Python
reference SDK, so the integrity hashes are real rather than hand-written.

    pip install context-passport
    python tools/generate-compliance-examples.py

Identifiers and timestamps are then pinned to fixed, readable values. That is
safe: under SPEC.md 3.4 the integrity block covers the payload and the parent
hash only, so ids and timestamps are not inputs to any hash. Pinning them
keeps the files stable in review and in git history instead of churning on
every regeneration.

No real personal data appears anywhere here. Data subjects are referred to by
opaque pseudonymous handles, which is also what a real deployment should be
writing into a record that outlives the decision.
"""

from __future__ import annotations

import json
from pathlib import Path

from context_passport import make_passport

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"

# Keys the existing examples do not carry. make_passport emits lineage for
# every record; the committed examples omit it, so strip it to match.
DROP = ("lineage",)


def build(payload, *, agent_id, agent_name, event_type, role=None,
          provider=None, model=None, trace_id=None, parent=None):
    p = make_passport(
        agent_id=agent_id,
        agent_name=agent_name,
        payload=payload,
        parent=parent,
        role=role,
        provider=provider,
        model=model,
        event_type=event_type,
        trace_id=trace_id,
    )
    for key in DROP:
        p.pop(key, None)
    return p


def pin(passport, *, ctx_id, timestamp):
    """Fix the identifiers and timestamps. Hashes are unaffected."""
    passport["id"] = ctx_id
    passport["created_at"] = timestamp
    passport["event"]["timestamp"] = timestamp
    if passport["integrity"].get("verified_at") is not None:
        passport["integrity"]["verified_at"] = timestamp
    return passport


def relink(child, parent):
    """Point a pinned child at its pinned parent."""
    child["parent_id"] = parent["id"]
    return child


def write(name, data):
    path = EXAMPLES / name
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"  wrote examples/{name}")


# ---------------------------------------------------------------- consent

consent = pin(
    build(
        {
            "input": "Capture consent before automated assessment of application APP-4471.",
            "output": {
                "consent_captured": True,
                "subject_ref": "subject_8f2a41",
                "lawful_basis": "GDPR Art. 6(1)(a)",
                "scope": [
                    "automated_credit_assessment",
                    "retention_24_months",
                ],
                "method": "web form, double opt-in",
                "withdrawable": True,
                "withdrawal_route": "support portal, no conditions",
                "policy_version": "privacy-notice-2026-01",
            },
        },
        agent_id="consent-service-01",
        agent_name="Consent Service",
        event_type="consent",
        role="compliance",
        provider="internal",
        model=None,
        trace_id="trace_app_4471",
    ),
    ctx_id="ctx_1774358400000_c0e5a1b2c3d4",
    timestamp="2026-03-29T09:55:00Z",
)
write("consent.passport.json", consent)


# --------------------------------------------------------------- override
# An override only means something next to the decision it overrides, so this
# example is a two-record chain rather than a lone record.

override_decision = pin(
    build(
        {
            "input": "Assess application APP-4471 against the lending policy.",
            "output": {
                "decision": "decline",
                "confidence": 0.88,
                "policy_version": "lending-policy-2026-02",
                "reasons": [
                    "debt_to_income_above_threshold",
                    "thin_credit_file",
                ],
            },
        },
        agent_id="agent-underwriter-01",
        agent_name="Underwriting Agent",
        event_type="commit",
        role="executor",
        provider="example",
        model="demo-agent-v1",
        trace_id="trace_app_4471",
    ),
    ctx_id="ctx_1774358460000_d0c1de01a1b2",
    timestamp="2026-03-29T10:01:00Z",
)

override_event = pin(
    build(
        {
            "input": "Review declined application APP-4471.",
            "output": {
                "original_decision": "decline",
                "new_decision": "approve",
                "overridden_by_role": "senior_credit_officer",
                "reviewer_ref": "reviewer_2c9d",
                "reason": "Applicant supplied twelve months of verified rental payments, which the model does not ingest. Debt to income recomputed at 0.31.",
                "authority": "Credit Committee delegation CC-2026-07",
                "model_left_unchanged": True,
            },
        },
        agent_id="human:reviewer_2c9d",
        agent_name="Senior Credit Officer",
        event_type="override",
        role="compliance",
        provider=None,
        model=None,
        trace_id="trace_app_4471",
        parent=override_decision,
    ),
    ctx_id="ctx_1774358520000_0edd0e02c3d4",
    timestamp="2026-03-29T10:02:00Z",
)
relink(override_event, override_decision)
write("override.passports.json", [override_decision, override_event])


# --------------------------------------------------------------- escalate

escalate_assessment = pin(
    build(
        {
            "input": "Classify transaction TXN-99183 for sanctions risk.",
            "output": {
                "classification": "possible_match",
                "confidence": 0.42,
                "below_auto_decision_threshold": True,
                "threshold": 0.90,
                "matched_list": "consolidated_sanctions_2026-03",
            },
        },
        agent_id="agent-screening-01",
        agent_name="Sanctions Screening Agent",
        event_type="commit",
        role="validator",
        provider="example",
        model="demo-agent-v1",
        trace_id="trace_txn_99183",
    ),
    ctx_id="ctx_1774362000000_5c0e0e03e5f6",
    timestamp="2026-03-29T11:00:00Z",
)

escalate_event = pin(
    build(
        {
            "input": "Confidence 0.42 is below the 0.90 auto-decision threshold.",
            "output": {
                "escalated_to": "financial_crime_team",
                "queue": "sanctions_manual_review",
                "reason": "below_auto_decision_threshold",
                "agent_action_taken": "none, transaction held pending human decision",
                "sla_hours": 4,
                "case_ref": "case_5b71e0",
            },
        },
        agent_id="agent-screening-01",
        agent_name="Sanctions Screening Agent",
        event_type="escalate",
        role="validator",
        provider="example",
        model="demo-agent-v1",
        trace_id="trace_txn_99183",
        parent=escalate_assessment,
    ),
    ctx_id="ctx_1774362060000_e5ca0a04a1b2",
    timestamp="2026-03-29T11:01:00Z",
)
relink(escalate_event, escalate_assessment)
write("escalate.passports.json", [escalate_assessment, escalate_event])


# ----------------------------------------------------------------- redact
# Note what this record does and does not do. It records that a redaction
# happened; it does not rewrite the earlier record. Editing a prior payload
# would change its payload_hash and break every record chained after it, which
# is the property the whole format exists to provide. So erasure is expressed
# as a new event that points at the affected record.

redact = pin(
    build(
        {
            "input": "Erasure request under GDPR Art. 17 from subject_8f2a41.",
            "output": {
                "target_record": "ctx_1774358460000_d0c1de01a1b2",
                "fields_removed": ["payload.output.reasons"],
                "storage_action": "field values deleted from the record store",
                "chain_action": "none, no prior record was rewritten",
                "note": "Rewriting the target payload would change its payload_hash and break verification for every record chained after it. The erasure is therefore recorded as a new event, and verifiers reading the target record will find the payload absent while the chain still verifies.",
                "approved_by_role": "data_protection_officer",
                "request_ref": "dsr_41c8",
            },
        },
        agent_id="privacy-service-01",
        agent_name="Privacy Service",
        event_type="redact",
        role="compliance",
        provider="internal",
        model=None,
        trace_id="trace_app_4471",
    ),
    ctx_id="ctx_1776950400000_dead0b05c3da",
    timestamp="2026-04-28T14:30:00Z",
)
write("redact.passport.json", redact)


# ------------------------------------------------------------------ audit

audit = pin(
    build(
        {
            "input": "Quarterly review of automated lending decisions, Q1 2026.",
            "output": {
                "period": {"from": "2026-01-01", "to": "2026-03-31"},
                "records_reviewed": 1284,
                "chain_verified": True,
                "verification_method": "recomputed payload_hash and integrity_hash for every record",
                "overrides_recorded": 37,
                "escalations_recorded": 112,
                "exceptions": 2,
                "exception_detail": [
                    {
                        "record": "ctx_1770000000000_e0a1b2c3d4e5",
                        "finding": "override recorded without a stated authority reference",
                        "severity": "low",
                        "remediation": "authority field made mandatory in the review form",
                    },
                    {
                        "record": "ctx_1771000000000_e0f6a7b8c9da",
                        "finding": "escalation resolved after the four hour SLA",
                        "severity": "low",
                        "remediation": "queue alerting threshold lowered",
                    },
                ],
                "conclusion": "No unrecorded automated decisions found in the period.",
                "auditor_ref": "internal_audit_2026_q1",
            },
        },
        agent_id="audit-service-01",
        agent_name="Audit Service",
        event_type="audit",
        role="validator",
        provider="internal",
        model=None,
        trace_id="trace_audit_2026_q1",
    ),
    ctx_id="ctx_1777593600000_a0d10c06e5f7",
    timestamp="2026-04-30T23:59:00Z",
)
write("audit.passport.json", audit)

print("\nRun `npm test` to validate these against schema/v2.json.")
