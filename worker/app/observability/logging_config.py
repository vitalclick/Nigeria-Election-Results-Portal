"""Structured logging via structlog.

In production we emit JSON-per-line so Loki / CloudWatch / GCP Logs
can parse cleanly. In development we render the pretty console
formatter so the logs are human-friendly.

The processor chain is set once at app startup and reused across the
FastAPI app, the worker, and any cron entrypoints.
"""

from __future__ import annotations

import logging
import os
import sys

import structlog


def configure_logging(*, json_output: bool | None = None) -> None:
    if json_output is None:
        json_output = os.environ.get("ENVIRONMENT", "development") != "development"

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.stdlib.add_logger_name,
        timestamper,
        structlog.processors.StackInfoRenderer(),
    ]

    if json_output:
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, os.environ.get("LOG_LEVEL", "INFO"))
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Tame chatty third-party loggers.
    for noisy in ("httpx", "httpcore", "asyncio", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
