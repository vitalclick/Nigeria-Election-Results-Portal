#!/usr/bin/env python3
"""Fetch Nigerian admin-level=8 ward polygons from OpenStreetMap via
the Overpass API. Use this to fill ward-boundary gaps for states where
GRID3 coverage is incomplete (e.g. Lagos, FCT, Rivers).

In Nigeria's OSM tagging convention:
    admin_level=4  -> state
    admin_level=6  -> LGA
    admin_level=8  -> ward

The script queries both LGA and ward relations inside a given state,
then assigns each ward to its parent LGA via centroid containment
(point-in-polygon ray-casting in pure Python - no shapely required).
The resulting GeoJSON FeatureCollection ships properties named so
that the existing load_ward_boundaries.py pipeline reconciles each
ward to its INEC code without further code changes.

Usage:
    python scripts/fetch_osm_wards.py "Lagos" \\
        data/ward_boundaries/lagos_osm.geojson

Then run the loader as usual:
    python scripts/load_ward_boundaries.py \\
        data/ward_boundaries/lagos_osm.geojson

Coverage caveat: OSM admin_level=8 is community-mapped and quality
varies state-by-state. Lagos and FCT are well-mapped; rural northern
states are patchy. Inspect data/ward_boundaries/load_report.csv after
the load to see what matched.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
)

QUERY_TEMPLATE = """
[out:json][timeout:180];
relation["name"="{state}"]["admin_level"="4"]["boundary"="administrative"];
map_to_area->.state;
(
  relation(area.state)["admin_level"="6"]["boundary"="administrative"];
  relation(area.state)["admin_level"="8"]["boundary"="administrative"];
);
out body geom;
"""


def query_overpass(state: str) -> dict[str, Any]:
    body = urllib.parse.urlencode({"data": QUERY_TEMPLATE.format(state=state)}).encode()
    last_err: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        print(f"  trying {endpoint} ...", file=sys.stderr)
        try:
            req = urllib.request.Request(
                endpoint,
                data=body,
                headers={"User-Agent": "OpenBallot/ward-fetcher"},
            )
            with urllib.request.urlopen(req, timeout=200) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"    {type(e).__name__}: {e}", file=sys.stderr)
            last_err = e
    raise RuntimeError(f"all Overpass endpoints failed: {last_err}")


def _assemble_rings(members: list[dict[str, Any]]) -> list[list[list[list[float]]]]:
    """Reduce a multipolygon relation's outer/inner members into a list
    of polygons, where each polygon is [outer_ring, *inner_rings] and
    each ring is a list of [lon, lat] pairs. The naive single-outer
    case (one outer way, no inner ways) is by far the most common."""
    outers: list[list[list[float]]] = []
    inners: list[list[list[float]]] = []
    for m in members:
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        ring = [[p["lon"], p["lat"]] for p in m["geometry"]]
        if len(ring) < 4:
            continue
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        role = m.get("role") or ""
        (inners if role == "inner" else outers).append(ring)
    # Simple model: every outer is its own polygon, all inners are
    # holes of the first outer. Sufficient for nearly all admin areas.
    polygons: list[list[list[list[float]]]] = []
    for i, outer in enumerate(outers):
        rings = [outer] + (inners if i == 0 else [])
        polygons.append(rings)
    return polygons


def _centroid(rings: list[list[list[float]]]) -> tuple[float, float] | None:
    """Centroid of the first (outer) ring via the shoelace formula."""
    if not rings or len(rings[0]) < 3:
        return None
    pts = rings[0]
    a = cx = cy = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if a == 0:
        return pts[0][0], pts[0][1]
    return cx / (6 * a), cy / (6 * a)


def _point_in_ring(pt: tuple[float, float], ring: list[list[float]]) -> bool:
    """Ray casting: count crossings to the right of the test point."""
    x, y = pt
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _point_in_polygons(pt: tuple[float, float], polys: list[list[list[list[float]]]]) -> bool:
    for poly in polys:
        if not poly:
            continue
        if _point_in_ring(pt, poly[0]):
            if any(_point_in_ring(pt, hole) for hole in poly[1:]):
                continue
            return True
    return False


def osm_to_geojson(osm: dict[str, Any], state: str) -> dict[str, Any]:
    elements = osm.get("elements", [])
    # First pass: bucket LGA (admin_level=6) polygons by name.
    lgas: list[tuple[str, list[list[list[list[float]]]]]] = []
    for el in elements:
        if el.get("type") != "relation":
            continue
        tags = el.get("tags") or {}
        if tags.get("admin_level") != "6":
            continue
        polys = _assemble_rings(el.get("members") or [])
        if polys and tags.get("name"):
            lgas.append((tags["name"], polys))
    print(f"  found {len(lgas)} LGA polygons", file=sys.stderr)

    # Second pass: build ward features, tag each with its LGA via
    # centroid-in-polygon lookup against the LGA bucket above.
    features = []
    skipped = 0
    for el in elements:
        if el.get("type") != "relation":
            continue
        tags = el.get("tags") or {}
        if tags.get("admin_level") != "8":
            continue
        ward_name = tags.get("name") or ""
        if not ward_name:
            skipped += 1
            continue
        polys = _assemble_rings(el.get("members") or [])
        if not polys:
            skipped += 1
            continue

        # Prefer explicit is_in:* tags; fall back to spatial lookup.
        lga_name = (
            tags.get("is_in:district")
            or tags.get("is_in:county")
            or tags.get("is_in:lga")
            or ""
        )
        if not lga_name:
            c = _centroid(polys[0])
            if c is not None:
                for name, lga_polys in lgas:
                    if _point_in_polygons(c, lga_polys):
                        lga_name = name
                        break

        geometry = {
            "type": "MultiPolygon",
            "coordinates": polys,
        }
        # Property names match what reconcile_ward_names.py SOURCE_PROPS
        # already understands: GRID3 v1 keys (statename / lganame /
        # wardname) double as fine OSM keys via the `name`-style
        # tagging convention.
        features.append({
            "type": "Feature",
            "properties": {
                "wardname":  ward_name,
                "lganame":   lga_name,
                "statename": state,
                "wardcode":  f"OSM-{el.get('id')}",
                "source":    "OSM",
            },
            "geometry": geometry,
        })

    if skipped:
        print(f"  skipped {skipped} relations missing name or geometry", file=sys.stderr)
    print(f"  emitted {len(features)} ward features", file=sys.stderr)
    return {"type": "FeatureCollection", "features": features}


def main(state: str, out_path: str) -> int:
    print(f"Fetching OSM admin_level=8 for {state}...", file=sys.stderr)
    osm = query_overpass(state)
    geojson = osm_to_geojson(osm, state)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f)
    print(f"Wrote {len(geojson['features'])} features -> {out_path}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: fetch_osm_wards.py <STATE NAME> <OUT.geojson>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
