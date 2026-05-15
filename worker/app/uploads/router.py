"""FastAPI router for presigned uploads.

POST /v1/uploads/presign
  Body:  { election_id, pu_code, content_type, content_length, sha256 }
  Auth:  agent JWT required
  Returns: { upload_url, image_url, object_key, expires_in_seconds }

The agent PWA calls this to obtain a one-shot PUT URL bound to a
specific size + content-type. The PUT happens directly browser->R2;
the worker never sees the image bytes until /v1/ingest fires.

Authorisation rules:
  * party_agent: can only request a URL for their assigned PU. If
    the JWT carries pu='25-11-04-007', a presign for any other
    pu_code is 403.
  * observer: can presign for any PU (observers cover multiple).
  * party_admin / consortium_reviewer / inec_liaison: cannot
    presign - they don't submit EC8As.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth.jwt_tokens import AgentClaims
from ..auth.router import require_agent
from ..config import settings
from . import s3_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/uploads", tags=["uploads"])


HEX_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"}


class PresignIn(BaseModel):
    election_id: str = Field(min_length=4, max_length=64)
    pu_code: str = Field(min_length=3, max_length=64)
    content_type: Literal[
        "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"
    ]
    content_length: int = Field(gt=0)
    sha256: str = Field(min_length=64, max_length=64)


class PresignOut(BaseModel):
    upload_url: str
    image_url: str
    object_key: str
    expires_in_seconds: int


@router.post("/presign", response_model=PresignOut)
async def presign(body: PresignIn, claims: AgentClaims = Depends(require_agent)):
    s = settings()

    if not HEX_SHA256_RE.match(body.sha256):
        raise HTTPException(status_code=400, detail={"code": "bad_sha256"})

    if body.content_length > s.max_image_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "image_too_large",
                "max_bytes": s.max_image_bytes,
                "given_bytes": body.content_length,
            },
        )
    if body.content_length < s.min_image_bytes:
        # Reject obvious thumbnails BEFORE minting a URL. An attacker
        # who already has a token can still send a small file via /ingest
        # and get flagged by the pipeline; this is just defence in depth.
        raise HTTPException(
            status_code=400,
            detail={"code": "image_too_small", "min_bytes": s.min_image_bytes},
        )

    if claims.role == "party_agent":
        if claims.pu != body.pu_code:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "pu_mismatch",
                    "message": "Party agents may only submit for their assigned PU.",
                },
            )
    elif claims.role == "observer":
        pass  # observers cover multiple PUs
    else:
        raise HTTPException(
            status_code=403,
            detail={"code": "role_cannot_submit", "role": claims.role},
        )

    # Object key encodes election + PU + agent + a uuid so re-submissions
    # don't collide with previous attempts. Agent ID rather than party
    # code so two APC agents (eg. observer + party_agent) don't clobber.
    object_key = (
        f"{body.election_id}/"
        f"{body.pu_code}/"
        f"{claims.sub}/"
        f"{uuid.uuid4().hex}.{_ext_for(body.content_type)}"
    )

    presigned = s3_client.generate_upload_url(
        object_key=object_key,
        content_type=body.content_type,
        content_length=body.content_length,
        sha256_hex=body.sha256,
        expires_in_seconds=300,    # 5 minutes - tight so URLs cannot be re-used
    )
    log.info(
        "uploads.presigned",
        extra={
            "agent_id": claims.sub,
            "election_id": body.election_id,
            "pu_code": body.pu_code,
            "size": body.content_length,
        },
    )
    return PresignOut(
        upload_url=presigned.upload_url,
        image_url=presigned.public_url,
        object_key=presigned.object_key,
        expires_in_seconds=presigned.expires_in_seconds,
    )


def _ext_for(content_type: str) -> str:
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/heic": "heic",
        "image/heif": "heif",
        "image/webp": "webp",
    }.get(content_type, "bin")
