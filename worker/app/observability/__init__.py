"""Operational observability.

Three independent surfaces:

  * Sentry - unhandled exception capture in the FastAPI app, the job
    worker, and the cron entry points. Configured via SENTRY_DSN.
  * Prometheus - counters / histograms / gauges describing every
    operationally-interesting event. Exposed on /metrics for the
    Prometheus scraper.
  * structlog - JSON structured logs with consistent field naming so
    Loki / Grafana queries are stable.

All three are no-ops when their respective configuration is absent, so
local dev and CI environments don't require any monitoring stack.
"""

from .sentry import init_sentry, capture_exception
from .metrics import (
    INGESTION_COUNTER,
    INGESTION_REJECTED_COUNTER,
    EXTRACTION_HISTOGRAM,
    EXTRACTION_CONFIDENCE_HISTOGRAM,
    EXTRACTION_FAILURE_COUNTER,
    QUEUE_DEPTH_GAUGE,
    INFLIGHT_GAUGE,
    AUDIT_LOG_SEQ_GAUGE,
    AUTH_OTP_COUNTER,
    ANCHOR_COUNTER,
    ANOMALY_COUNTER,
    metrics_response,
    observe_extraction,
)
from .logging_config import configure_logging

__all__ = [
    "init_sentry",
    "capture_exception",
    "INGESTION_COUNTER",
    "INGESTION_REJECTED_COUNTER",
    "EXTRACTION_HISTOGRAM",
    "EXTRACTION_CONFIDENCE_HISTOGRAM",
    "EXTRACTION_FAILURE_COUNTER",
    "QUEUE_DEPTH_GAUGE",
    "INFLIGHT_GAUGE",
    "AUDIT_LOG_SEQ_GAUGE",
    "AUTH_OTP_COUNTER",
    "ANCHOR_COUNTER",
    "ANOMALY_COUNTER",
    "metrics_response",
    "observe_extraction",
    "configure_logging",
]
