"""STL reading and measuring for the 3D printing quote studio. Pure Python, no numpy, no database.
The upload is untrusted: size and triangle caps stop a huge file from hogging the server, and every number is checked.
Results are mesh facts (volume, area, size, closed or not). Print time and weight are estimated elsewhere (pricing.py)."""
import math
import re
import struct
from dataclasses import dataclass, field

MAX_BYTES = 80 * 1024 * 1024
MAX_TRIANGLES = 600_000
UNITS = {"mm": 1.0, "cm": 10.0, "in": 25.4, "m": 1000.0}   # what one model unit is, in millimetres
_QUANT = 1000  # vertices closer than 1 micron count as the same point when pairing edges
_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
_VERTEX = re.compile(rb"vertex\s+(" + _NUM.encode() + rb")\s+(" + _NUM.encode() + rb")\s+(" + _NUM.encode() + rb")", re.I)


class StlError(ValueError):
    """A file that is not a usable STL. `code` is stable so the UI can translate the message."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Analysis:
    triangles: int
    volume_mm3: float
    area_mm2: float
    size_mm: tuple[float, float, float]           # x, y, z extents of the bounding box
    min_mm: tuple[float, float, float]
    max_mm: tuple[float, float, float]
    watertight: bool                               # every edge shared by exactly two faces, facing consistently
    open_edges: int = 0                            # edges used once: holes
    non_manifold_edges: int = 0                    # edges used three or more times
    flipped_faces: bool = False                    # faces disagree about which way is out
    degenerate_triangles: int = 0
    inverted: bool = False                         # normals point inward (volume was negative)
    unit: str = "mm"
    warnings: list[str] = field(default_factory=list)
    unit_candidates: dict[str, tuple[float, float, float]] = field(default_factory=dict)

    @property
    def volume_cm3(self) -> float:
        return self.volume_mm3 / 1000.0

    def to_dict(self) -> dict:
        d = {k: getattr(self, k) for k in ("triangles", "volume_mm3", "area_mm2", "size_mm", "min_mm", "max_mm", "watertight",
                                           "open_edges", "non_manifold_edges", "flipped_faces", "degenerate_triangles",
                                           "inverted", "unit", "warnings", "unit_candidates")}
        d["volume_cm3"] = self.volume_cm3
        return d


Tri = tuple[float, float, float, float, float, float, float, float, float]


def _finite(tris: list[Tri]) -> None:
    for t in tris:
        for v in t:
            if not math.isfinite(v):
                raise StlError("bad_number", "The file has a vertex that is not a number.")


def parse_stl(data: bytes) -> list[Tri]:
    """Binary or ASCII STL to a list of triangles (9 floats each). Raises StlError for anything unusable."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 15:
        raise StlError("empty", "The file is empty or too short to be an STL.")
    if len(data) > MAX_BYTES:
        raise StlError("too_big", f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    data = bytes(data)
    # A binary file says how many triangles follow; if the size matches exactly it is binary even when its 80-byte header starts with "solid".
    if len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if len(data) == 84 + 50 * n:
            if n == 0:
                raise StlError("no_triangles", "The file has no triangles.")
            if n > MAX_TRIANGLES:
                raise StlError("too_many_triangles", f"The model has {n:,} triangles; the limit is {MAX_TRIANGLES:,}. Simplify it first.")
            tris = [r[3:12] for r in struct.iter_unpack("<12fH", data[84:])]
            _finite(tris)
            return tris
    head = data[:2000].lstrip().lower()
    if head.startswith(b"solid") and b"facet" in data[:20000].lower():
        coords = _VERTEX.findall(data)
        if len(coords) % 3 or not coords:
            raise StlError("bad_ascii", "The text STL is damaged: vertices do not come in threes.")
        if len(coords) // 3 > MAX_TRIANGLES:
            raise StlError("too_many_triangles", f"The model has more than {MAX_TRIANGLES:,} triangles. Simplify it first.")
        flat = [float(x) for c in coords for x in c]
        tris = [tuple(flat[i:i + 9]) for i in range(0, len(flat), 9)]
        _finite(tris)
        return tris
    raise StlError("not_stl", "This does not look like an STL file (binary or text).")


def to_binary(tris: list[Tri]) -> bytes:
    """Triangles back to a binary STL (used by the sample shapes and the tests)."""
    out = bytearray(b"LARIS sample".ljust(80, b" ") + struct.pack("<I", len(tris)))
    for t in tris:
        nx, ny, nz = _normal(t)
        out += struct.pack("<12fH", nx, ny, nz, *t, 0)
    return bytes(out)


def _normal(t: Tri) -> tuple[float, float, float]:
    ax, ay, az, bx, by, bz, cx, cy, cz = t
    ux, uy, uz, vx, vy, vz = bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    ln = math.sqrt(nx * nx + ny * ny + nz * nz)
    return (0.0, 0.0, 0.0) if ln == 0 else (nx / ln, ny / ln, nz / ln)


def analyse(tris: list[Tri], unit: str = "mm") -> Analysis:
    """Measure a mesh. `unit` is what one model unit means; every result is in millimetres."""
    if unit not in UNITS:
        raise StlError("bad_unit", f"Unit must be one of {sorted(UNITS)}.")
    if not tris:
        raise StlError("no_triangles", "The file has no triangles.")
    s = UNITS[unit]
    vol6 = 0.0
    area2 = 0.0
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    edges: dict[tuple[int, int], int] = {}
    degenerate = 0
    for t in tris:
        ax, ay, az, bx, by, bz, cx, cy, cz = t
        # signed volume of the tetrahedron against the origin: dot(a, cross(b, c)); the sum over a closed surface is 6 x volume
        vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
        ux, uy, uz, vx, vy, vz = bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        area2 += math.sqrt(nx * nx + ny * ny + nz * nz)
        for i, v in enumerate((ax, ay, az)):
            lo[i] = min(lo[i], v); hi[i] = max(hi[i], v)
        for i, v in enumerate((bx, by, bz)):
            lo[i] = min(lo[i], v); hi[i] = max(hi[i], v)
        for i, v in enumerate((cx, cy, cz)):
            lo[i] = min(lo[i], v); hi[i] = max(hi[i], v)
        ka = (round(ax * _QUANT), round(ay * _QUANT), round(az * _QUANT))
        kb = (round(bx * _QUANT), round(by * _QUANT), round(bz * _QUANT))
        kc = (round(cx * _QUANT), round(cy * _QUANT), round(cz * _QUANT))
        if ka == kb or kb == kc or ka == kc:
            degenerate += 1
            continue
        for e in ((ka, kb), (kb, kc), (kc, ka)):
            edges[e] = edges.get(e, 0) + 1
    volume = vol6 / 6.0
    seen: set = set()
    open_e = non_manifold = 0
    flipped = False
    for (a, b), fwd in edges.items():
        if (a, b) in seen:
            continue
        back = edges.get((b, a), 0)
        seen.add((a, b)); seen.add((b, a))
        total = fwd + back
        if total == 1:
            open_e += 1
        elif total > 2:
            non_manifold += 1
        elif fwd == 2 or back == 2:
            flipped = True
    watertight = open_e == 0 and non_manifold == 0 and not flipped and degenerate < len(tris)
    size = tuple((hi[i] - lo[i]) * s for i in range(3))
    a = Analysis(
        triangles=len(tris), volume_mm3=abs(volume) * s ** 3, area_mm2=area2 / 2.0 * s ** 2, size_mm=size,
        min_mm=tuple(v * s for v in lo), max_mm=tuple(v * s for v in hi), watertight=watertight, open_edges=open_e,
        non_manifold_edges=non_manifold, flipped_faces=flipped, degenerate_triangles=degenerate, inverted=volume < 0 and not flipped, unit=unit,
    )
    big = max(size)
    if not watertight:
        a.warnings.append("holes" if open_e else "bad_faces")   # the UI says "model may have holes"
    if big < 6.0 or big > 2000.0:
        a.warnings.append("check_unit")
        a.unit_candidates = {u: tuple(d / s * f for d in size) for u, f in UNITS.items() if u != unit}
    return a


def fits(size_mm: tuple[float, float, float], build_mm: tuple[float, float, float]) -> dict:
    """Does the model fit a printer's build volume, turning it in 90 degree steps if needed?
    Returns {fits, as_is, rotated, split}. `rotated` is three letters: which model axis lies along the printer's x, y and z in turn
    (so 'yzx' puts model y on printer x, model z on printer y and model x on printer z, standing a long part up). `split` means no turn will do."""
    sx, sy, sz = size_mm
    bx, by, bz = build_mm
    as_is = sx <= bx and sy <= by and sz <= bz
    if as_is:
        return {"fits": True, "as_is": True, "rotated": None, "split": False}
    dims = {"x": sx, "y": sy, "z": sz}
    for order in ("xzy", "yxz", "yzx", "zxy", "zyx"):
        if dims[order[0]] <= bx and dims[order[1]] <= by and dims[order[2]] <= bz:
            return {"fits": True, "as_is": False, "rotated": order, "split": False}
    return {"fits": False, "as_is": False, "rotated": None, "split": True}
