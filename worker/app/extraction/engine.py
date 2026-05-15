"""Extraction engine.

Two backends run in sequence:

  1. Google Document AI (primary) - structured form extractor trained on
     EC8A samples. Returns a payload with per-field confidence.
  2. GPT-4o Vision (secondary) - invoked when any field's confidence falls
     below the floor, OR when arithmetic checks fail on the primary result.

Both backends sit behind a single `Extractor` protocol so the engine can be
exercised end-to-end against a deterministic stub backend in CI without
calling out to paid APIs.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from ..models import ExtractedEC8A
from .arithmetic import ArithmeticReport, arithmetic_consistent

log = logging.getLogger(__name__)


@dataclass
class ExtractionResult:
    extracted: ExtractedEC8A
    confidence_score: float
    per_field_confidence: dict[str, float]
    backend_used: str
    arithmetic: ArithmeticReport
    raw_response: dict[str, Any]


class Extractor(ABC):
    name: str = "abstract"

    @abstractmethod
    async def extract(self, image_url: str, pu_code: str) -> ExtractionResult: ...


class ExtractionEngine:
    def __init__(
        self,
        primary: Extractor,
        secondary: Extractor,
        confidence_floor: float = 0.85,
    ):
        self.primary = primary
        self.secondary = secondary
        self.confidence_floor = confidence_floor

    async def run(self, image_url: str, pu_code: str) -> ExtractionResult:
        primary = await self.primary.extract(image_url, pu_code)

        needs_fallback = (
            primary.confidence_score < self.confidence_floor
            or not primary.arithmetic.consistent
            or any(
                c < self.confidence_floor for c in primary.per_field_confidence.values()
            )
        )

        if not needs_fallback:
            return primary

        log.info(
            "extraction.fallback_triggered",
            extra={
                "pu_code": pu_code,
                "primary_confidence": primary.confidence_score,
                "primary_arithmetic_ok": primary.arithmetic.consistent,
            },
        )
        secondary = await self.secondary.extract(image_url, pu_code)

        # Prefer the result with higher confidence and consistent arithmetic.
        if (
            secondary.arithmetic.consistent
            and secondary.confidence_score >= primary.confidence_score
        ):
            return secondary
        return primary


# ─────────────────────────────────────────────────────────────────────────────
# Stub backend - deterministic, for development and CI.
# Real backends (DocumentAIExtractor, GPT4oVisionExtractor) live in separate
# modules and require API credentials.
# ─────────────────────────────────────────────────────────────────────────────


class StubExtractor(Extractor):
    """Returns a fixed, arithmetically-consistent payload. Useful for tests."""

    name = "stub"

    def __init__(self, name: str = "stub", confidence: float = 0.97):
        self.name = name
        self.confidence = confidence

    async def extract(self, image_url: str, pu_code: str) -> ExtractionResult:
        extracted = ExtractedEC8A(
            pu_code=pu_code,
            registered_voters=412,
            accredited_voters=287,
            candidate_votes={"APC": 142, "PDP": 89, "LP": 203},
            total_valid_votes=434,
            rejected_ballots=12,
            total_votes_cast=446,
            presiding_officer_signed=True,
            agent_signatures_detected=3,
            official_stamp_present=True,
        )
        # Stub's payload deliberately fails arithmetic so the secondary kicks
        # in during dev. Override to True in tests when needed.
        report = arithmetic_consistent(extracted)
        return ExtractionResult(
            extracted=extracted,
            confidence_score=self.confidence,
            per_field_confidence={
                "registered_voters": 0.99,
                "accredited_voters": 0.96,
                "candidate_votes": 0.97,
                "total_valid_votes": 0.95,
                "rejected_ballots": 0.94,
                "total_votes_cast": 0.96,
            },
            backend_used=self.name,
            arithmetic=report,
            raw_response={"image_url": image_url, "stub": True},
        )
