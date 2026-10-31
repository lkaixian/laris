"""Built-in sample models so the quote studio works without a file: cube, cylinder, gear, vase, phone stand.
Each is a closed mesh (watertight, facing outward) built from a flat outline pushed up (extrude) or spun round an axis (lathe).
No brand shapes, nothing copied from anywhere. All sizes are millimetres."""
import math

from .stl import Tri, to_binary

Pt = tuple[float, float]


def _area(poly: list[Pt]) -> float:
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def _inside(p: Pt, a: Pt, b: Pt, c: Pt) -> bool:
    def side(p1, p2, p3): return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def triangulate(poly: list[Pt]) -> list[tuple[int, int, int]]:
    """Ear clipping for a simple polygon (counter-clockwise). Returns index triples, counter-clockwise."""
    idx = list(range(len(poly)))
    out: list[tuple[int, int, int]] = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-12:
                continue   # a reflex corner is not an ear
            if any(_inside(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            out.append((i0, i1, i2)); idx.pop(k)
            break
        else:
            raise ValueError("outline is not a simple polygon")
    out.append((idx[0], idx[1], idx[2]))
    return out


def extrude(poly: list[Pt], depth: float) -> list[Tri]:
    if _area(poly) < 0:
        poly = poly[::-1]
    tris: list[Tri] = []
    for i0, i1, i2 in triangulate(poly):
        a, b, c = poly[i0], poly[i1], poly[i2]
        tris.append((a[0], a[1], depth, b[0], b[1], depth, c[0], c[1], depth))       # top, faces up
        tris.append((a[0], a[1], 0.0, c[0], c[1], 0.0, b[0], b[1], 0.0))              # bottom, faces down
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        tris.append((p[0], p[1], 0.0, q[0], q[1], 0.0, q[0], q[1], depth))
        tris.append((p[0], p[1], 0.0, q[0], q[1], depth, p[0], p[1], depth))
    return tris


def lathe(profile: list[Pt], segments: int = 48) -> list[Tri]:
    """Spin an (r, z) outline round the z axis. The outline starts and ends on the axis (r = 0) and goes counter-clockwise,
    so the result is closed. Faces are turned to point outward at the end."""
    rings = [[(r * math.cos(2 * math.pi * j / segments), r * math.sin(2 * math.pi * j / segments), z) for j in range(segments)] if r > 0 else [(0.0, 0.0, z)]
             for r, z in profile]
    tris: list[Tri] = []
    for a, b in zip(rings, rings[1:]):
        for j in range(segments):
            j2 = (j + 1) % segments
            pa, pa2 = a[j % len(a)], a[j2 % len(a)]
            pb, pb2 = b[j % len(b)], b[j2 % len(b)]
            if len(a) == 1:
                tris.append(pa + pb2 + pb)
            elif len(b) == 1:
                tris.append(pa + pa2 + pb)
            else:
                tris.append(pa + pa2 + pb2)
                tris.append(pa + pb2 + pb)
    return tris if _signed_volume(tris) >= 0 else [t[:3] + t[6:9] + t[3:6] for t in tris]


def _signed_volume(tris: list[Tri]) -> float:
    return sum(t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) + t[2] * (t[3] * t[7] - t[4] * t[6]) for t in tris) / 6


def cube(size: float = 20.0) -> list[Tri]:
    return extrude([(0.0, 0.0), (size, 0.0), (size, size), (0.0, size)], size)


def cylinder(radius: float = 10.0, height: float = 20.0, segments: int = 64) -> list[Tri]:
    return extrude([(radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments)) for i in range(segments)], height)


def gear(teeth: int = 16, outer_radius: float = 25.0, root_radius: float = 21.0, thickness: float = 8.0) -> list[Tri]:
    p = 2 * math.pi / teeth
    pts: list[Pt] = []
    for i in range(teeth):
        a = i * p
        for off, r in ((0.0, root_radius), (0.18, outer_radius), (0.46, outer_radius), (0.64, root_radius)):
            pts.append((r * math.cos(a + off * p), r * math.sin(a + off * p)))
    return extrude(pts, thickness)


def vase(segments: int = 48) -> list[Tri]:
    # outside from the base up to the rim, then the inside back down to the floor of the hollow
    profile = [(0.0, 0.0), (25.0, 0.0), (30.0, 20.0), (36.0, 60.0), (26.0, 110.0), (30.0, 130.0),
               (27.0, 130.0), (23.0, 108.0), (33.0, 60.0), (27.0, 20.0), (0.0, 4.0)]
    return lathe(profile, segments)


def phone_stand(width: float = 60.0) -> list[Tri]:
    side = [(0.0, 0.0), (70.0, 0.0), (70.0, 14.0), (38.0, 14.0), (62.0, 80.0), (50.0, 84.0), (14.0, 24.0), (0.0, 24.0)]
    # extrude pushes along z, but the outline is a side view, so stand it up: (x, y, z) -> (x, z, y). Swapping two axes mirrors the
    # shape, which turns the faces inside out; _flip_if_inside_out turns them back.
    up = [(t[0], t[2], t[1], t[3], t[5], t[4], t[6], t[8], t[7]) for t in extrude(side, width)]
    return _flip_if_inside_out(up)


def _flip_if_inside_out(tris: list[Tri]) -> list[Tri]:
    return tris if _signed_volume(tris) >= 0 else [t[:3] + t[6:9] + t[3:6] for t in tris]


SAMPLES = {"cube": cube, "cylinder": cylinder, "gear": gear, "vase": vase, "phone_stand": phone_stand}


def sample(name: str) -> bytes:
    """A sample model as binary STL bytes."""
    if name not in SAMPLES:
        raise KeyError(f"unknown sample {name!r}; choose from {sorted(SAMPLES)}")
    return to_binary(SAMPLES[name]())
