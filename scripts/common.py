"""Shared helpers for due-diligence data collection.

All network access targets public, authoritative government endpoints:
  - Texas StratMap statewide parcels (TxGIO / county appraisal rollup)
  - FEMA National Flood Hazard Layer (NFHL)
  - USGS 3DEP Elevation Point Query Service (EPQS)
  - USDA NRCS Soil Data Access (SDA)
  - US Census geocoder + ACS
"""
import json
import math
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def fetch(url, data=None, timeout=60, retries=3, headers=None):
    """GET/POST with retry. Returns decoded body or raises."""
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed {url[:110]}: {last}")


def jfetch(url, **kw):
    return json.loads(fetch(url, **kw))


def save(name, obj):
    p = os.path.join(DATA, name)
    with open(p, "w") as f:
        json.dump(obj, f, indent=1, default=str)
    return p


def load(name, default=None):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p) as f:
        return json.load(f)


# ---------------------------------------------------------------- geometry
def ring_area_acres(ring):
    """Geodesic-ish area of a lon/lat ring, in acres (equirectangular at centroid)."""
    if len(ring) < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i][0] * k, ring[i][1]
        x2, y2 = ring[(i + 1) % len(ring)][0] * k, ring[(i + 1) % len(ring)][1]
        s += x1 * y2 - x2 * y1
    deg2m = 111320.0
    return abs(s / 2.0) * deg2m * deg2m / 4046.8564224


def ring_centroid(ring):
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    a = 0.0
    cx = cy = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i][0] * k, ring[i][1]
        x2, y2 = ring[(i + 1) % len(ring)][0] * k, ring[(i + 1) % len(ring)][1]
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    if abs(a) < 1e-14:
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    a *= 0.5
    return (cx / (6 * a) / k, cy / (6 * a))


def haversine_ft(a, b):
    """a,b = (lon,lat). Returns feet."""
    R = 20902231.0  # earth radius in feet
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-18) + x1):
            inside = not inside
    return inside


def oriented_extent(ring):
    """Longest axis length/bearing + perpendicular width, in feet.
    Approximates 'lot dimensions' for an irregular polygon."""
    best = (0.0, None, None)
    for i in range(len(ring)):
        for j in range(i + 1, len(ring)):
            d = haversine_ft(ring[i], ring[j])
            if d > best[0]:
                best = (d, ring[i], ring[j])
    length, p, q = best
    if p is None:
        return {"length_ft": 0, "width_ft": 0, "bearing_deg": None}
    lat0 = sum(c[1] for c in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    ax, ay = (q[0] - p[0]) * k, q[1] - p[1]
    n = math.hypot(ax, ay) or 1e-18
    ax, ay = ax / n, ay / n
    perp = []
    for c in ring:
        vx, vy = (c[0] - p[0]) * k, c[1] - p[1]
        perp.append(vx * (-ay) + vy * ax)
    width_deg = (max(perp) - min(perp)) if perp else 0
    bearing = (math.degrees(math.atan2(ax, ay)) + 360) % 360
    return {
        "length_ft": round(length, 1),
        "width_ft": round(width_deg * 111320.0 * 3.280839895, 1),
        "bearing_deg": round(bearing, 1),
    }
