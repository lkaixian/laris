import math
import struct

import pytest

from src.print3d import samples
from src.print3d.stl import MAX_TRIANGLES, StlError, analyse, fits, parse_stl, to_binary


def approx(x, rel=1e-6):
    return pytest.approx(x, rel=rel)


def test_cube_known_numbers():
    a = analyse(parse_stl(samples.sample("cube")))
    assert a.volume_mm3 == approx(8000.0)          # 20 x 20 x 20
    assert a.area_mm2 == approx(2400.0)            # 6 faces of 400
    assert a.size_mm == approx((20.0, 20.0, 20.0))
    assert a.triangles == 12
    assert a.watertight and not a.warnings and not a.inverted


def test_cylinder_matches_the_polygon_formula():
    n, r, h = 64, 10.0, 20.0
    a = analyse(parse_stl(to_binary(samples.cylinder(r, h, n))))
    base = 0.5 * n * r * r * math.sin(2 * math.pi / n)                     # area of the regular 64-gon
    side = n * 2 * r * math.sin(math.pi / n) * h
    assert a.volume_mm3 == approx(base * h, 1e-5)
    assert a.area_mm2 == approx(2 * base + side, 1e-5)
    assert a.size_mm[2] == approx(20.0)
    assert a.watertight


@pytest.mark.parametrize("name", sorted(samples.SAMPLES))
def test_every_sample_is_closed_and_faces_outward(name):
    a = analyse(parse_stl(samples.sample(name)))
    assert a.watertight, (name, a.open_edges, a.non_manifold_edges, a.flipped_faces)
    assert not a.inverted and a.volume_mm3 > 0 and a.warnings == []
    assert a.degenerate_triangles == 0


def test_vase_is_hollow():
    solid_guess = analyse(parse_stl(samples.sample("vase")))
    box = solid_guess.size_mm[0] * solid_guess.size_mm[1] * solid_guess.size_mm[2]
    assert solid_guess.volume_mm3 < 0.5 * box      # a cavity inside, not a lump


def test_ascii_and_binary_agree():
    tris = samples.cube(10.0)
    lines = ["solid t"]
    for t in tris:
        lines += ["facet normal 0 0 0", "outer loop"] + [f"vertex {t[i]} {t[i + 1]} {t[i + 2]}" for i in (0, 3, 6)] + ["endloop", "endfacet"]
    lines.append("endsolid t")
    a1 = analyse(parse_stl("\n".join(lines).encode()))
    a2 = analyse(parse_stl(to_binary(tris)))
    assert a1.volume_mm3 == approx(a2.volume_mm3) == approx(1000.0)
    assert a1.size_mm == approx(a2.size_mm)


def test_binary_with_solid_in_header_is_still_binary():
    data = bytearray(to_binary(samples.cube(10.0)))
    data[:5] = b"solid"
    assert analyse(parse_stl(bytes(data))).volume_mm3 == approx(1000.0)


def test_a_missing_triangle_is_reported_as_holes():
    tris = samples.cube(20.0)[:-1]
    a = analyse(tris)
    assert not a.watertight and a.open_edges >= 3 and "holes" in a.warnings


def test_flipped_face_is_reported_not_trusted():
    tris = samples.cube(20.0)
    t = tris[3]
    tris[3] = t[:3] + t[6:9] + t[3:6]
    a = analyse(tris)
    assert not a.watertight and a.flipped_faces and "bad_faces" in a.warnings


def test_inside_out_mesh_still_gets_a_positive_volume():
    inv = [t[:3] + t[6:9] + t[3:6] for t in samples.cube(20.0)]
    a = analyse(inv)
    assert a.volume_mm3 == approx(8000.0) and a.inverted and a.watertight


def test_units_scale_every_result():
    tris = samples.cube(2.0)                        # a 2 unit cube
    a_in = analyse(tris, unit="in")
    assert a_in.size_mm == approx((50.8, 50.8, 50.8))
    assert a_in.volume_mm3 == approx(50.8 ** 3)
    assert a_in.area_mm2 == approx(6 * 50.8 ** 2)
    assert analyse(tris, unit="cm").volume_mm3 == approx(8000.0)
    assert analyse(tris, unit="mm").volume_mm3 == approx(8.0)


def test_tiny_and_huge_models_ask_for_a_unit_check():
    tiny = analyse(samples.cube(2.0))
    assert "check_unit" in tiny.warnings and tiny.unit_candidates["in"] == approx((50.8, 50.8, 50.8))
    assert "check_unit" in analyse(samples.cube(3000.0)).warnings
    assert "check_unit" not in analyse(samples.cube(40.0)).warnings


def test_bad_unit_and_empty_mesh():
    with pytest.raises(StlError) as e:
        analyse(samples.cube(), unit="furlong")
    assert e.value.code == "bad_unit"
    with pytest.raises(StlError):
        analyse([])


@pytest.mark.parametrize("data,code", [
    (b"", "empty"), (b"too short", "empty"), (b"hello world, this is not a model at all", "not_stl"),
    (b"solid x\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendfacet\nendsolid", "bad_ascii"),
])
def test_unusable_files_fail_with_a_code(data, code):
    with pytest.raises(StlError) as e:
        parse_stl(data)
    assert e.value.code == code


def test_nan_vertex_is_refused():
    t = list(samples.cube(10.0)[0])
    t[0] = float("nan")
    with pytest.raises(StlError) as e:
        parse_stl(to_binary([tuple(t)] + samples.cube(10.0)[1:]))
    assert e.value.code == "bad_number"


def test_triangle_cap_stops_a_huge_header():
    head = b"x" * 80 + struct.pack("<I", MAX_TRIANGLES + 1)
    with pytest.raises(StlError) as e:
        parse_stl(head + b"\0" * (50 * (MAX_TRIANGLES + 1)))
    assert e.value.code == "too_many_triangles"


def test_zero_triangle_binary_is_refused():
    with pytest.raises(StlError) as e:
        parse_stl(b"x" * 80 + struct.pack("<I", 0))
    assert e.value.code == "no_triangles"


def test_fit_check_rotates_then_gives_up():
    assert fits((100, 100, 100), (220, 220, 250))["as_is"]
    r = fits((240, 100, 100), (220, 220, 250))        # 240 is too long for the 220 bed, so stand the long side up the 250 tall axis
    assert r["fits"] and not r["as_is"] and r["rotated"] == "yzx"   # printer x gets model y, printer y gets model z, printer z gets model x
    big = fits((400, 400, 400), (220, 220, 250))
    assert not big["fits"] and big["split"]
