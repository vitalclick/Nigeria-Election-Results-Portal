"""Ingestion pipeline.

Stages, in order:
  1. Payload shape validation (Pydantic at the API boundary)
  2. Size and hash sanity
  3. Geo-fence evaluation (soft warn / hard discard)
  4. EXIF metadata integrity flags
  5. Duplicate detection by (election_id, pu_code, party_code)
  6. Persistence with validation_flags JSON
  7. Enqueue extraction job

Each stage produces a flag rather than a hard error wherever possible.
The platform's policy is to publish evidence and let reviewers + the public
see ambiguity, rather than silently rejecting submissions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from ..models import IngestionPayload, SubmissionSource
from .exif import evaluate_exif
from .geofence import evaluate_geofence


class ValidationFlag(str, Enum):
    OK = "ok"
    IMAGE_TOO_SMALL = "image_too_small"
    IMAGE_TOO_LARGE = "image_too_large"
    HASH_MALFORMED = "hash_malformed"
    GPS_MISSING = "gps_missing"
    GPS_WARNING = "geofence_warning"
    GPS_VIOLATION = "geofence_violation"
    EXIF_MISSING = "exif_missing"
    EXIF_SOFTWARE_WARNING = "exif_software_warning"
    EXIF_DATETIME_MISMATCH = "exif_datetime_mismatch"
    DUPLICATE_PARTY_SUBMISSION = "duplicate_party_submission"


@dataclass
class IngestionContext:
    pu_lat: float
    pu_lng: float
    election_date: datetime | None
    min_image_bytes: int
    max_image_bytes: int
    gps_soft_metres: int
    gps_hard_metres: int
    existing_party_submission: bool


@dataclass
class IngestionResult:
    accepted: bool
    submission_id: UUID
    distance_metres: float | None
    flags: dict[str, Any] = field(default_factory=dict)
    rejected_reason: str | None = None


class IngestionPipeline:
    """Pure-function pipeline. Stateless; DB I/O is done by the caller.

    Splitting persistence out keeps the validation logic unit-testable
    without any database fixtures.
    """

    def run(
        self,
        payload: IngestionPayload,
        ctx: IngestionContext,
    ) -> IngestionResult:
        flags: dict[str, Any] = {}
        distance: float | None = None

        # 1. Hash shape
        if len(payload.image_sha256) != 64 or not all(
            c in "0123456789abcdef" for c in payload.image_sha256
        ):
            return IngestionResult(
                accepted=False,
                submission_id=uuid4(),
                distance_metres=None,
                flags={ValidationFlag.HASH_MALFORMED.value: True},
                rejected_reason="image_sha256 is not a valid lowercase hex digest",
            )

        # 2. Size sanity
        if payload.image_bytes < ctx.min_image_bytes:
            flags[ValidationFlag.IMAGE_TOO_SMALL.value] = True
        if payload.image_bytes > ctx.max_image_bytes:
            return IngestionResult(
                accepted=False,
                submission_id=uuid4(),
                distance_metres=None,
                flags={ValidationFlag.IMAGE_TOO_LARGE.value: True},
                rejected_reason="image exceeds max bytes",
            )

        # 3. Geofence
        if payload.gps is None:
            flags[ValidationFlag.GPS_MISSING.value] = True
        else:
            distance, decision = evaluate_geofence(
                capture_lat=payload.gps.lat,
                capture_lng=payload.gps.lng,
                pu_lat=ctx.pu_lat,
                pu_lng=ctx.pu_lng,
                soft_metres=ctx.gps_soft_metres,
                hard_metres=ctx.gps_hard_metres,
            )
            if decision == "geofence_warning":
                flags[ValidationFlag.GPS_WARNING.value] = True
            elif decision == "geofence_violation":
                return IngestionResult(
                    accepted=False,
                    submission_id=uuid4(),
                    distance_metres=distance,
                    flags={ValidationFlag.GPS_VIOLATION.value: True},
                    rejected_reason=(
                        f"submission location is {distance:.0f}m from the registered "
                        f"PU coordinates (hard limit {ctx.gps_hard_metres}m)"
                    ),
                )

        # 4. EXIF
        exif_flags = evaluate_exif(payload.exif_metadata, ctx.election_date)
        if not exif_flags["exif_present"]:
            flags[ValidationFlag.EXIF_MISSING.value] = True
        if exif_flags["exif_software_warning"]:
            flags[ValidationFlag.EXIF_SOFTWARE_WARNING.value] = True
        if exif_flags["exif_datetime_mismatch"]:
            flags[ValidationFlag.EXIF_DATETIME_MISMATCH.value] = True

        # 5. Duplicate party submission
        if (
            payload.source_type == SubmissionSource.PARTY_AGENT
            and ctx.existing_party_submission
        ):
            return IngestionResult(
                accepted=False,
                submission_id=uuid4(),
                distance_metres=distance,
                flags={ValidationFlag.DUPLICATE_PARTY_SUBMISSION.value: True},
                rejected_reason=(
                    "this party already has a submission for this polling unit. "
                    "Edits go through the consortium review queue."
                ),
            )

        return IngestionResult(
            accepted=True,
            submission_id=uuid4(),
            distance_metres=distance,
            flags=flags or {ValidationFlag.OK.value: True},
        )
