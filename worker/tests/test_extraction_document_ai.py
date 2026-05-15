"""Tests for the Document AI extractor.

We bypass the HTTP path entirely and feed `_parse_response` synthetic
documents that match each of the two response shapes the extractor
handles (custom-processor entities and generic form-parser fields).
"""

from __future__ import annotations

import pytest

from app.extraction.document_ai import DocumentAIExtractor


@pytest.fixture
def extractor():
    return DocumentAIExtractor(project="test", processor="test")


def test_parses_custom_processor_entities(extractor):
    response = {
        "document": {
            "entities": [
                {"type": "pu_code", "mentionText": "25-11-04-007", "confidence": 0.98},
                {"type": "registered_voters", "mentionText": "500", "confidence": 0.96},
                {"type": "accredited_voters", "mentionText": "450", "confidence": 0.95},
                {"type": "candidate_APC", "mentionText": "142", "confidence": 0.97},
                {"type": "candidate_PDP", "mentionText": "89", "confidence": 0.96},
                {"type": "candidate_LP", "mentionText": "203", "confidence": 0.97},
                {"type": "total_valid_votes", "mentionText": "434", "confidence": 0.94},
                {"type": "rejected_ballots", "mentionText": "12", "confidence": 0.92},
                {"type": "total_votes_cast", "mentionText": "446", "confidence": 0.93},
                {"type": "agent_signatures_detected", "mentionText": "4", "confidence": 0.85},
            ]
        }
    }
    result = extractor._parse_response(response, "25-11-04-007", "https://x/y.jpg")
    assert result.backend_used == "document_ai"
    assert result.extracted.pu_code == "25-11-04-007"
    assert result.extracted.candidate_votes == {"APC": 142, "PDP": 89, "LP": 203}
    assert result.extracted.total_valid_votes == 434
    assert result.arithmetic.consistent is True
    assert 0.85 < result.confidence_score < 1.0
    assert result.per_field_confidence["candidate_votes.APC"] == 0.97


def test_strips_noise_from_integers(extractor):
    response = {
        "document": {
            "entities": [
                {"type": "registered_voters", "mentionText": "  412  ", "confidence": 0.9},
                {"type": "accredited_voters", "mentionText": "287 voters", "confidence": 0.9},
                {"type": "candidate_APC", "mentionText": "142 votes", "confidence": 0.9},
                {"type": "total_valid_votes", "mentionText": "142", "confidence": 0.9},
                {"type": "rejected_ballots", "mentionText": "", "confidence": 0.9},
            ]
        }
    }
    result = extractor._parse_response(response, "x", "https://x/y.jpg")
    assert result.extracted.registered_voters == 412
    assert result.extracted.accredited_voters == 287
    assert result.extracted.candidate_votes["APC"] == 142
    assert result.extracted.rejected_ballots == 0


def test_falls_back_to_form_fields(extractor):
    """When the response has no entities but does have generic form-parser
    formFields, we should still extract scalars via alias matching."""
    response = {
        "document": {
            "pages": [
                {
                    "formFields": [
                        {
                            "fieldName": {"mentionText": "Polling Unit Code"},
                            "fieldValue": {"mentionText": "25-11-04-007", "confidence": 0.91},
                        },
                        {
                            "fieldName": {"mentionText": "Total Registered Voters"},
                            "fieldValue": {"mentionText": "412", "confidence": 0.89},
                        },
                        {
                            "fieldName": {"mentionText": "Total Valid Votes"},
                            "fieldValue": {"mentionText": "434", "confidence": 0.88},
                        },
                    ]
                }
            ],
            # The custom processor MUST emit at least one candidate vote
            # for the extractor to produce a valid result. The fallback
            # path handles only scalar form fields. Provide a candidate
            # via the entity path so the test exercises both.
            "entities": [
                {"type": "candidate_APC", "mentionText": "142", "confidence": 0.95},
                {"type": "candidate_PDP", "mentionText": "89", "confidence": 0.95},
                {"type": "candidate_LP", "mentionText": "203", "confidence": 0.95},
            ],
        }
    }
    result = extractor._parse_response(response, "fallback", "https://x/y.jpg")
    assert result.extracted.registered_voters == 412
    assert result.extracted.total_valid_votes == 434
    assert result.extracted.candidate_votes == {"APC": 142, "PDP": 89, "LP": 203}


def test_raises_when_no_candidate_entities(extractor):
    response = {"document": {"entities": [
        {"type": "registered_voters", "mentionText": "412", "confidence": 0.9}
    ]}}
    with pytest.raises(RuntimeError, match="no candidate vote"):
        extractor._parse_response(response, "x", "https://x/y.jpg")


def test_arithmetic_inconsistency_surfaces_in_result(extractor):
    response = {
        "document": {
            "entities": [
                {"type": "candidate_APC", "mentionText": "142", "confidence": 0.97},
                {"type": "candidate_PDP", "mentionText": "89", "confidence": 0.97},
                {"type": "candidate_LP", "mentionText": "203", "confidence": 0.97},
                # 142+89+203 = 434, but we report 999. Arithmetic must fail.
                {"type": "total_valid_votes", "mentionText": "999", "confidence": 0.94},
            ]
        }
    }
    result = extractor._parse_response(response, "x", "https://x/y.jpg")
    assert result.arithmetic.consistent is False
    assert "candidate_votes_sum_neq_total_valid" in result.arithmetic.failed_checks
