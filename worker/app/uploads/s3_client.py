"""S3 / R2 / MinIO presigner.

boto3 is used for url generation (it's local computation, no network).
We pin the signature version to s3v4 so the URLs work on all three
providers (R2, MinIO, AWS S3). The same module also exposes a
head_object helper used by /v1/ingest to verify the uploaded bytes
actually landed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from botocore.config import Config

from ..config import settings

log = logging.getLogger(__name__)


@dataclass
class PresignResult:
    upload_url: str          # the URL the browser PUTs to
    object_key: str          # the canonical key inside the bucket
    public_url: str          # the URL the rest of the system uses
    expires_in_seconds: int


def _client():
    import boto3

    s = settings()
    return boto3.client(
        "s3",
        endpoint_url=s.storage_endpoint,
        aws_access_key_id=s.storage_access_key,
        aws_secret_access_key=s.storage_secret_key,
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )


def generate_upload_url(
    *,
    object_key: str,
    content_type: str,
    content_length: int,
    sha256_hex: str | None = None,
    expires_in_seconds: int = 300,
) -> PresignResult:
    """Mint a one-shot PUT URL.

    The URL is bound to:
      * the exact bucket + object key
      * Content-Type the browser must send
      * Content-Length (so an attacker cannot stream gigabytes through
        an URL meant for a 1 MB EC8A image)

    The browser must send those headers verbatim; the upload will be
    rejected by S3 / R2 / MinIO if anything is off.
    """
    s = settings()
    params: dict[str, Any] = {
        "Bucket": s.storage_bucket,
        "Key": object_key,
        "ContentType": content_type,
        "ContentLength": content_length,
    }
    if sha256_hex:
        import base64

        params["ChecksumSHA256"] = base64.b64encode(bytes.fromhex(sha256_hex)).decode("ascii")

    client = _client()
    upload_url = client.generate_presigned_url(
        ClientMethod="put_object",
        Params=params,
        ExpiresIn=expires_in_seconds,
        HttpMethod="PUT",
    )

    public_url = f"{s.storage_endpoint.rstrip('/')}/{s.storage_bucket}/{object_key}"
    return PresignResult(
        upload_url=upload_url,
        object_key=object_key,
        public_url=public_url,
        expires_in_seconds=expires_in_seconds,
    )


def head_object(object_key: str) -> dict | None:
    """Return the object metadata if it exists; None otherwise.

    Used by /v1/ingest to verify the agent actually uploaded before
    enqueueing the extraction job.
    """
    s = settings()
    client = _client()
    try:
        return client.head_object(Bucket=s.storage_bucket, Key=object_key)
    except client.exceptions.ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
