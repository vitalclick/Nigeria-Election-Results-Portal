"""Presigned upload endpoint.

The agent PWA does NOT upload EC8A images through the worker. That
would put a 1 MB payload on every HTTP request and saturate the
worker's bandwidth + memory at election-day scale.

Instead, the PWA:
  1. Calls POST /v1/uploads/presign with the image metadata (size,
     sha256, election, PU). The worker validates the request against
     the agent's JWT role + PU assignment, constructs an object key,
     and returns a presigned PUT URL that the browser can use to
     upload DIRECTLY to R2 / MinIO / S3.
  2. PUTs the image bytes to that URL from the browser.
  3. Calls POST /v1/ingest with the returned `image_url` + the same
     sha256 + the size. The worker verifies (via HEAD on the object)
     that the bytes actually landed and that the sha256 matches.

This pattern is the standard for any platform that ingests user
uploads at scale. It also gives us defence in depth: the worker is
the only thing that can mint upload URLs, and each URL is one-shot,
short-lived, and bound to a specific size + content-type.
"""

from .router import router as uploads_router

__all__ = ["uploads_router"]
