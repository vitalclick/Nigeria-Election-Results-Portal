"""GPS geofence check.

Submissions are flagged - not blocked - if the capture point falls outside
the soft fence. They are discarded outright only if the point is implausibly
far from the registered PU coordinates (e.g. submission from a different
state, which strongly suggests fraud or device-clock spoofing).
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt


def haversine_metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two WGS84 points in metres."""
    r = 6_371_000.0
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlmb = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlmb / 2) ** 2
    return 2 * r * asin(sqrt(a))


def evaluate_geofence(
    capture_lat: float,
    capture_lng: float,
    pu_lat: float,
    pu_lng: float,
    soft_metres: int,
    hard_metres: int,
) -> tuple[float, str]:
    """Return (distance_metres, decision).

    decision ∈ {"ok", "geofence_warning", "geofence_violation"}
    """
    d = haversine_metres(capture_lat, capture_lng, pu_lat, pu_lng)
    if d <= soft_metres:
        return d, "ok"
    if d <= hard_metres:
        return d, "geofence_warning"
    return d, "geofence_violation"
