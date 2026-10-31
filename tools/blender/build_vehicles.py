"""Bangladesh Open World: driveable vehicle fleet.

  blender --background --factory-startup --python tools/blender/build_vehicles.py -- [ids] [flags]

No ids builds everything. Flags:
  --nobake        render procedural materials only, no bake or export (fast modelling loop)
  --preview       render review PNGs into VEH_TMP
  --views a,b     yaw angles for the previews (default -38,142)
  --tex N         override the bake size
  --novariants    skip the variant albedo bakes
  --pvariants     also render every saved variant albedo
  --dummy         put a mascot stand-in on every seat for previews
  --atlas         dump the baked albedo to VEH_TMP for inspection
  --tag name      suffix for preview file names
  --res, --dist, --pheight, --samples   preview camera and quality overrides

Pipeline for one vehicle: parts are authored with procedural materials, tagged with the
node they belong to, merged, UV packed into one atlas with per-part texel density, baked with
bo.bake_pbr, split back into the contract's nodes, and exported with the empties.
Wheels are baked away from the body so that no arch shadow gets painted into a spinning tyre,
and identical wheels share one UV island and one mesh.
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bo_common as bo  # noqa: E402

OUT_DIR = os.path.join(bo.PUBLIC_ASSETS, "vehicles")
TMP_DIR = os.environ.get(
    "VEH_TMP",
    r"C:\Users\User\AppData\Local\Temp\claude\E--1--Semester-Break-2604-GTA-BD"
    r"\d4e1c090-e9ae-4ccd-aa94-327eb0059626\scratchpad\vehicles",
)
WHEEL_BAKE_X = 40.0  # wheels live out here during the bake


def V3(x, y, z):
    return Vector((x, y, z))


# ---------------------------------------------------------------------------
# Colour
# ---------------------------------------------------------------------------


def srgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def C(hexstr):
    """#RRGGBB to linear RGB for shader nodes."""
    return tuple(lin(v) for v in srgb(hexstr))


# ---------------------------------------------------------------------------
# Geometry kit
# ---------------------------------------------------------------------------


def curve(points, n=6, closed=False):
    """Catmull-Rom through the points with n subdivisions per span."""
    pts = [Vector(p) for p in points]
    out = []
    count = len(pts)
    spans = count if closed else count - 1
    for i in range(spans):
        p0 = pts[(i - 1) % count] if (closed or i > 0) else pts[i]
        p1 = pts[i]
        p2 = pts[(i + 1) % count]
        p3 = pts[(i + 2) % count] if (closed or i + 2 < count) else pts[(i + 1) % count]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(pts[-1].copy())
    return out


def tube(name, points, r, seg=8, caps=True, rs=None, closed=False):
    """Round tube with parallel-transported frames, so it never twists. rs: radius per point."""
    pts = [Vector(p) for p in points]
    count = len(pts)
    verts, faces = [], []
    prev_x = None
    for i, p in enumerate(pts):
        if closed:
            d = pts[(i + 1) % count] - pts[(i - 1) % count]
        elif i == 0:
            d = pts[1] - pts[0]
        elif i == count - 1:
            d = pts[-1] - pts[-2]
        else:
            d = pts[i + 1] - pts[i - 1]
        d.normalize()
        if prev_x is None:
            ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            x = d.cross(ref).normalized()
        else:
            x = (prev_x - d * prev_x.dot(d)).normalized()
        prev_x = x
        y = d.cross(x).normalized()
        rad = rs[i] if rs else r
        for s in range(seg):
            t = 2 * math.pi * s / seg
            verts.append(p + (x * math.cos(t) + y * math.sin(t)) * rad)
    spans = count if closed else count - 1
    for r_i in range(spans):
        nxt = (r_i + 1) % count
        for s in range(seg):
            a = r_i * seg + s
            b = r_i * seg + (s + 1) % seg
            faces.append((a, b, nxt * seg + (s + 1) % seg, nxt * seg + s))
    if caps and not closed:
        faces.append(tuple(reversed(range(seg))))
        faces.append(tuple((count - 1) * seg + s for s in range(seg)))
    obj = bo.new_mesh_object(name, verts, faces)
    bo.recalc_normals(obj)
    return obj


def lathe(name, profile, seg=24, center=(0, 0, 0), axis="x", flip=False):
    """Revolve [(axial, radius), ...] around an axis. Radius 0 makes a pole."""
    c = Vector(center)
    verts, faces = [], []
    rows = []
    for ax, rad in profile:
        if rad <= 1e-6:
            idx = len(verts)
            if axis == "x":
                verts.append(c + Vector((ax, 0, 0)))
            elif axis == "y":
                verts.append(c + Vector((0, ax, 0)))
            else:
                verts.append(c + Vector((0, 0, ax)))
            rows.append([idx] * seg)
            continue
        row = []
        for s in range(seg):
            t = 2 * math.pi * s / seg
            a, b = math.cos(t) * rad, math.sin(t) * rad
            row.append(len(verts))
            if axis == "x":
                verts.append(c + Vector((ax, a, b)))
            elif axis == "y":
                verts.append(c + Vector((a, ax, b)))
            else:
                verts.append(c + Vector((a, b, ax)))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for s in range(seg):
            n = (s + 1) % seg
            f = [r0[s], r0[n], r1[n], r1[s]]
            uniq = []
            for v in f:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) >= 3:
                faces.append(tuple(uniq))
    obj = bo.new_mesh_object(name, verts, faces)
    bo.recalc_normals(obj)
    if flip:
        obj.data.flip_normals()
    return obj


def grid(name, rows, close_u=False, close_v=False, uv=False, smooth=True):
    """Quad surface through rows of points (rows[i][j]). close_u wraps j, close_v wraps i.
    uv=True writes a normalised 'art' UV map: u along j, v along i."""
    n_i, n_j = len(rows), len(rows[0])
    verts = [tuple(p) for row in rows for p in row]
    faces = []
    span_i = n_i if close_v else n_i - 1
    span_j = n_j if close_u else n_j - 1
    for i in range(span_i):
        ii = (i + 1) % n_i
        for j in range(span_j):
            jj = (j + 1) % n_j
            faces.append((i * n_j + j, i * n_j + jj, ii * n_j + jj, ii * n_j + j))
    obj = bo.new_mesh_object(name, verts, faces, smooth=smooth)
    if uv:
        layer = obj.data.uv_layers.new(name="art")
        for poly in obj.data.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                i, j = divmod(vi, n_j)
                layer.data[li].uv = (j / max(1, n_j - 1), i / max(1, n_i - 1))
    return obj


def sweep(name, path, section, up=(0, 0, 1), closed=False, caps=True, scales=None):
    """Extrude a 2D closed section [(side, upward), ...] along a path."""
    pts = [Vector(p) for p in path]
    count = len(pts)
    up_v = Vector(up)
    verts, faces = [], []
    m = len(section)
    for i, p in enumerate(pts):
        if closed:
            d = pts[(i + 1) % count] - pts[(i - 1) % count]
        elif i == 0:
            d = pts[1] - pts[0]
        elif i == count - 1:
            d = pts[-1] - pts[-2]
        else:
            d = pts[i + 1] - pts[i - 1]
        d.normalize()
        side = d.cross(up_v)
        if side.length < 1e-4:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        upward = side.cross(d).normalized()
        sc = scales[i] if scales else 1.0
        for a, b in section:
            verts.append(p + side * a * sc + upward * b * sc)
    spans = count if closed else count - 1
    for i in range(spans):
        nxt = (i + 1) % count
        for s in range(m):
            t = (s + 1) % m
            faces.append((i * m + s, i * m + t, nxt * m + t, nxt * m + s))
    if caps and not closed:
        faces.append(tuple(reversed(range(m))))
        faces.append(tuple((count - 1) * m + s for s in range(m)))
    obj = bo.new_mesh_object(name, verts, faces)
    bo.recalc_normals(obj)
    return obj


def rrect(w, h, r, n=3, cx=0.0, cy=0.0):
    """Rounded rectangle outline, counter-clockwise, as (u, v) points."""
    out = []
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    for (qx, qy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            t = math.radians(a0 + 90 * k / n)
            out.append((cx + qx + math.cos(t) * r, cy + qy + math.sin(t) * r))
    return out


def plate(name, outline, thick, origin=(0, 0, 0), u=(1, 0, 0), v=(0, 0, 1), bevel=0.0, bevel_segments=1):
    """Extrude a 2D (u, v) outline along u x v. Origin is the centre of the thickness."""
    o, uu, vv = Vector(origin), Vector(u), Vector(v)
    n = uu.cross(vv).normalized()
    m = len(outline)
    verts = []
    for sign in (-1, 1):
        for a, b in outline:
            verts.append(o + uu * a + vv * b + n * sign * thick / 2)
    faces = [tuple(reversed(range(m))), tuple(m + i for i in range(m))]
    for i in range(m):
        j = (i + 1) % m
        faces.append((i, j, m + j, m + i))
    obj = bo.new_mesh_object(name, verts, faces)
    bo.recalc_normals(obj)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = bevel_segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40)
    return obj


def rbox(name, size, loc=(0, 0, 0), rot=(0, 0, 0), r=0.01, seg=2):
    return bo.box(name, size, loc=loc, rot=rot, bevel=r, bevel_segments=seg)


def arc(center, r, a0, a1, n, plane="yz"):
    """Points on a circle. Angle 0 points to +first axis, 90 to +second axis."""
    c = Vector(center)
    out = []
    for i in range(n + 1):
        t = math.radians(a0 + (a1 - a0) * i / n)
        a, b = math.cos(t) * r, math.sin(t) * r
        if plane == "yz":
            out.append(c + Vector((0, a, b)))
        elif plane == "xz":
            out.append(c + Vector((a, 0, b)))
        else:
            out.append(c + Vector((a, b, 0)))
    return out


def fender(name, center, r, width, a0, a1, n=14, drop=0.012, thick=0.003):
    """Sheet-metal mudguard: shallow C section swept along an arc around X."""
    half = width / 2
    section = [(-half, -drop), (-half * 0.72, 0.0), (0.0, drop * 0.5), (half * 0.72, 0.0), (half, -drop)]
    rows = []
    c = Vector(center)
    for i in range(n + 1):
        t = math.radians(a0 + (a1 - a0) * i / n)
        radial = Vector((0, math.cos(t), math.sin(t)))
        row = []
        for a, b in section:
            row.append(c + Vector((a, 0, 0)) + radial * (r + b))
        rows.append(row)
    return orient_out(grid(name, rows), c)


def bolt_ring(name, center, r, n, bolt_r=0.006, depth=0.008, axis="x", seg=6):
    """Ring of small bolt heads on a disc facing +axis."""
    objs = []
    c = Vector(center)
    for i in range(n):
        t = 2 * math.pi * i / n
        if axis == "x":
            p = c + Vector((depth / 2, math.cos(t) * r, math.sin(t) * r))
            rot = (0, math.pi / 2, 0)
        else:
            p = c + Vector((math.cos(t) * r, depth / 2, math.sin(t) * r))
            rot = (math.pi / 2, 0, 0)
        objs.append(bo.cylinder(f"{name}{i}", bolt_r, depth, segments=seg, loc=p, rot=rot))
    return bo.join(objs, name)


def spring_coil(name, base, height, r, turns=4, wire=0.0035, seg=4, steps=8):
    pts = []
    total = int(turns * steps)
    for i in range(total + 1):
        t = 2 * math.pi * i / steps
        pts.append(Vector(base) + Vector((math.cos(t) * r, math.sin(t) * r, height * i / total)))
    return tube(name, pts, wire, seg=seg)


def orient_out(obj, inside):
    """Make an open surface's normals face away from a point. Open sheets have no inside for
    recalc_normals to find, and the AO bake needs them right."""
    me = obj.data
    me.update()
    c = Vector(inside)
    total = sum(p.normal.dot(p.center - c) * p.area for p in me.polygons)
    if total < 0:
        me.flip_normals()
    return obj


def split_grid(name, rows, tag_fn, close_u=False, close_v=False):
    """Surface grid split by a per-face tag. Returns {tag: object}; windows, lamps and pillars can
    then follow the same edge loops as the shell around them."""
    n_i, n_j = len(rows), len(rows[0])
    verts = [tuple(p) for row in rows for p in row]
    groups = {}
    for i in range(n_i if close_v else n_i - 1):
        ii = (i + 1) % n_i
        for j in range(n_j if close_u else n_j - 1):
            jj = (j + 1) % n_j
            groups.setdefault(tag_fn(i, j), []).append((i * n_j + j, i * n_j + jj, ii * n_j + jj, ii * n_j + j))
    out = {}
    for tag, faces in groups.items():
        used = sorted({v for f in faces for v in f})
        remap = {v: k for k, v in enumerate(used)}
        out[tag] = bo.new_mesh_object(f"{name}_{tag}", [verts[v] for v in used], [tuple(remap[v] for v in f) for f in faces])
    return out


def boundary_loops(obj):
    """Closed boundary polylines of an open mesh, in object space (used for rubber gaskets)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edges = [e for e in bm.edges if len(e.link_faces) == 1]
    nxt = {}
    for e in edges:
        a, b = e.verts
        nxt.setdefault(a.index, []).append(b.index)
        nxt.setdefault(b.index, []).append(a.index)
    pos = {v.index: v.co.copy() for v in bm.verts}
    bm.free()
    loops = []
    seen = set()
    for start in nxt:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            options = [v for v in nxt[cur] if v != prev]
            step = next((v for v in options if v not in seen), None)
            if step is None:
                break
            loop.append(step)
            seen.add(step)
            prev, cur = cur, step
        if len(loop) > 2:
            loops.append([pos[v] for v in loop])
    return loops


def mirror_x(pts):
    return [Vector((-p[0], p[1], p[2])) for p in pts]


# ---------------------------------------------------------------------------
# Shader DSL. Object coordinates equal world coordinates at bake time because
# parts are merged with transforms applied.
# ---------------------------------------------------------------------------


class G:
    def __init__(self, mat):
        self.m = mat
        self.nt = mat.node_tree
        self.b = bo.bsdf_of(mat)
        self._coord = None
        self._sep = None
        self._geo = None

    def new(self, t):
        return self.nt.nodes.new(t)

    def put(self, val, inp):
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, inp)
        elif isinstance(val, (tuple, list)):
            v = tuple(val)
            if len(inp.default_value) == 4 and len(v) == 3:
                v = (*v, 1.0)
            inp.default_value = v
        else:
            inp.default_value = val

    @property
    def pos(self):
        if self._coord is None:
            self._coord = self.new("ShaderNodeTexCoord")
        return self._coord.outputs["Object"]

    @property
    def uvw(self):
        if self._sep is None:
            self._sep = self.new("ShaderNodeSeparateXYZ")
            self.nt.links.new(self.pos, self._sep.inputs[0])
        return self._sep.outputs

    @property
    def normal(self):
        if self._geo is None:
            self._geo = self.new("ShaderNodeNewGeometry")
        return self._geo.outputs["Normal"]

    def split(self, vec):
        s = self.new("ShaderNodeSeparateXYZ")
        self.put(vec, s.inputs[0])
        return s.outputs

    def join3(self, x, y, z):
        c = self.new("ShaderNodeCombineXYZ")
        self.put(x, c.inputs[0])
        self.put(y, c.inputs[1])
        self.put(z, c.inputs[2])
        return c.outputs[0]

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self.put(a, n.inputs[0])
        if b is not None:
            self.put(b, n.inputs[1])
        if c is not None:
            self.put(c, n.inputs[2])
        return n.outputs[0]

    def add(self, a, b, clamp=False):
        return self.math("ADD", a, b, clamp=clamp)

    def sub(self, a, b, clamp=False):
        return self.math("SUBTRACT", a, b, clamp=clamp)

    def mul(self, a, b, clamp=False):
        return self.math("MULTIPLY", a, b, clamp=clamp)

    def div(self, a, b):
        return self.math("DIVIDE", a, b)

    def max(self, a, b):
        return self.math("MAXIMUM", a, b)

    def min(self, a, b):
        return self.math("MINIMUM", a, b)

    def smooth(self, x, e0, e1, lo=0.0, hi=1.0):
        n = self.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        self.put(x, n.inputs["Value"])
        n.inputs["From Min"].default_value = e0
        n.inputs["From Max"].default_value = e1
        n.inputs["To Min"].default_value = lo
        n.inputs["To Max"].default_value = hi
        return n.outputs[0]

    def noise(self, scale, detail=4.0, rough=0.5, vec=None, stretch=None):
        n = self.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        v = vec if vec is not None else self.pos
        if stretch:
            mp = self.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = stretch
            self.put(v, mp.inputs["Vector"])
            v = mp.outputs[0]
        self.put(v, n.inputs["Vector"])
        return n.outputs["Fac"]

    def voronoi(self, scale, vec=None, feature="F1"):
        n = self.new("ShaderNodeTexVoronoi")
        n.feature = feature
        n.inputs["Scale"].default_value = scale
        self.put(vec if vec is not None else self.pos, n.inputs["Vector"])
        return n.outputs["Distance"]

    def rgb(self, col, slot=None):
        n = self.new("ShaderNodeRGB")
        n.outputs[0].default_value = (*(C(col) if isinstance(col, str) else col), 1)
        if slot:
            CUR.slots.setdefault(slot, []).append(n)
        return n.outputs[0]

    def mixc(self, fac, a, b, blend="MIX"):
        n = self.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        n.clamp_factor = True
        self.put(fac, n.inputs[0])
        self.put(a, n.inputs[6])
        self.put(b, n.inputs[7])
        return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.new("ShaderNodeMix")
        n.data_type = "FLOAT"
        n.clamp_factor = True
        self.put(fac, n.inputs[0])
        self.put(a, n.inputs[2])
        self.put(b, n.inputs[3])
        return n.outputs[0]

    def edges(self, radius=0.012, samples=4):
        """Edge mask: where a bevel-rounded normal departs from the true one. Unlike an AO
        probe this stays clean on thin sheet and on tubes, and only lights up real corners."""
        bev = self.new("ShaderNodeBevel")
        bev.samples = samples
        bev.inputs["Radius"].default_value = radius
        dot = self.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        self.nt.links.new(bev.outputs[0], dot.inputs[0])
        self.nt.links.new(self.normal, dot.inputs[1])
        return self.smooth(self.sub(1.0, dot.outputs["Value"]), 0.015, 0.16)

    def image(self, img, vec, extension="EXTEND", interp="Linear"):
        t = self.new("ShaderNodeTexImage")
        t.image = img
        t.extension = extension
        t.interpolation = interp
        self.put(vec, t.inputs["Vector"])
        return t

    def uvmap(self, name="art"):
        n = self.new("ShaderNodeUVMap")
        n.uv_map = name
        return n.outputs["UV"]

    def project(self, axis, a0, a1, z0, z1, flip_u=False):
        """Planar image coordinates from object position. axis 'x' projects along X
        (u from Y, v from Z); axis 'y' projects along Y (u from X, v from Z)."""
        s = self.uvw
        src = s[1] if axis == "x" else s[0]
        u = self.div(self.sub(src, a0), a1 - a0)
        if flip_u:
            u = self.sub(1.0, u)
        v = self.div(self.sub(s[2], z0), z1 - z0)
        return self.join3(u, v, 0.0)

    def bump(self, height, strength=0.4, distance=0.004):
        n = self.new("ShaderNodeBump")
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = distance
        self.put(height, n.inputs["Height"])
        self.nt.links.new(n.outputs[0], self.b.inputs["Normal"])
        return n

    def out(self, base=None, rough=None, metal=None):
        if base is not None:
            self.put(base, self.b.inputs["Base Color"])
        if rough is not None:
            self.put(rough, self.b.inputs["Roughness"])
        if metal is not None:
            self.put(metal, self.b.inputs["Metallic"])


DUST = "#a8926f"


def paint(name, col, rough=0.36, metal=0.0, dust=0.3, chips=0.3, scratch=0.2, slot=None,
          edge=0.7, chip_col="#3b3027", grime=0.12, stain=0.0, extra_h=None):
    """Weathered enamel: base coat, grime, edge scuffs revealing primer, scratches, and
    dust that settles on upward faces and splashes up from the road."""
    m = bo.pbr(name, roughness=rough, metallic=metal)
    g = G(m)
    base = col(g) if callable(col) else g.rgb(col, slot)
    big = g.noise(1.9, 5.0)
    mid = g.noise(14.0, 5.0)
    fine = g.noise(90.0, 3.0)
    tinted = g.mixc(g.mul(g.sub(mid, 0.5), grime * 2.0), base, (0.02, 0.018, 0.015))
    s = g.uvw
    chip = 0.0
    if edge > 0 or chips > 0:
        wear = g.noise(46.0, 4.0)
        emask = g.mul(g.edges(), edge * 2.4)
        chip = g.smooth(g.add(g.mul(emask, g.smooth(wear, 0.35, 0.62)), g.mul(g.sub(g.noise(30.0, 5.0), 0.5), chips * 2.6)), 0.26, 0.42)
    if scratch > 0:
        sc1 = g.noise(26.0, 2.0, stretch=(1.0, 0.5, 18.0))
        sc2 = g.noise(30.0, 2.0, stretch=(0.5, 16.0, 1.0))
        scr = g.smooth(g.max(sc1, sc2), 0.76, 0.80)
        scr = g.mul(scr, scratch * 1.6)
        chip = g.max(chip, scr) if chip != 0.0 else scr
    col_out = tinted
    if chip != 0.0:
        col_out = g.mixc(chip, col_out, g.rgb(chip_col))
    dust_up = g.mul(g.smooth(g.split(g.normal)[2], -0.2, 0.9, 0.25, 1.0), g.smooth(big, 0.42, 0.68))
    dust_low = g.mul(g.smooth(s[2], 0.75, 0.08, 0.0, 0.8), g.smooth(g.noise(5.5, 5.0), 0.34, 0.62))
    dust_f = g.mul(g.add(dust_up, dust_low), dust, clamp=True)
    col_out = g.mixc(dust_f, col_out, g.rgb(DUST))
    r = g.add(rough, g.mul(dust_f, 0.45))
    if chip != 0.0:
        r = g.add(r, g.mul(chip, 0.3))
    r = g.add(r, g.mul(g.sub(mid, 0.5), 0.12))
    met = metal
    if metal > 0:
        met = g.mul(metal, g.sub(1.0, dust_f))
        if chip != 0.0:
            met = g.mul(met, g.sub(1.0, g.mul(chip, 0.7)))
    g.out(col_out, g.math("MINIMUM", r, 1.0), met)
    h = g.mul(fine, 0.12)
    if chip != 0.0:
        h = g.sub(h, g.mul(chip, 0.5))
    if extra_h is not None:
        h = g.add(h, g.mul(extra_h(g), 3.0))
    g.bump(h, 0.5, 0.0025)
    return m


def chrome(name="chrome", rough=0.14, tint="#d9dbde", dust=0.2, slot=None):
    return paint(name, tint, rough=rough, metal=1.0, dust=dust, chips=0.05, scratch=0.25, edge=0.1, chip_col="#6e6a64", grime=0.25, slot=slot)


def steel(name="steel", tint="#8d8e8f", rough=0.48, dust=0.3):
    return paint(name, tint, rough=rough, metal=1.0, dust=dust, chips=0.15, scratch=0.2, edge=0.4, chip_col="#4a3524", grime=0.4)


def rubber(name="rubber", col="#191919", rough=0.82, dust=0.25):
    m = bo.pbr(name, roughness=rough)
    g = G(m)
    big = g.noise(5.0, 4.0)
    dust_f = g.mul(g.smooth(big, 0.42, 0.7), dust)
    g.out(g.mixc(dust_f, g.rgb(col), g.rgb(DUST)), g.add(rough, g.mul(dust_f, 0.15)))
    g.bump(g.noise(160.0, 3.0), 0.2, 0.0015)
    return m


def plastic(name, col, rough=0.5, dust=0.2, slot=None):
    return paint(name, col, rough=rough, dust=dust, chips=0.05, scratch=0.08, edge=0.15, chip_col="#777777", grime=0.2, slot=slot)


def vinyl(name, col, rough=0.42, slot=None, tuft=0.0, dust=0.12):
    """Shiny seat vinyl, with optional tufting."""
    m = bo.pbr(name, roughness=rough)
    g = G(m)
    base = g.rgb(col, slot)
    crease = g.noise(38.0, 4.0)
    shade = g.mixc(g.mul(g.sub(crease, 0.45), 0.45), base, (0.01, 0.005, 0.005))
    dust_f = g.mul(g.smooth(g.noise(4.0, 4.0), 0.5, 0.74), dust)
    g.out(g.mixc(dust_f, shade, g.rgb(DUST)), g.add(rough, g.mul(dust_f, 0.4)))
    h = g.mul(crease, 0.2)
    if tuft > 0:
        vor = g.voronoi(tuft)
        h = g.add(h, g.mul(g.smooth(vor, 0.0, 0.42), 1.0))
    g.bump(h, 0.65, 0.008)
    return m


def quilted(name, col, plane="xz", k=26.0, rough=0.36, slot=None, piping="#f4c21a", dust=0.1):
    """Diamond-tufted seat vinyl with buttons, computed in object space."""
    m = bo.pbr(name, roughness=rough)
    g = G(m)
    s = g.uvw
    a_ax, b_ax = s[0], s[2] if plane == "xz" else s[1]
    d1 = g.math("SINE", g.mul(g.add(a_ax, b_ax), k))
    d2 = g.math("SINE", g.mul(g.sub(a_ax, b_ax), k))
    h = g.mul(g.math("POWER", g.math("ABSOLUTE", d1), 0.45), g.math("POWER", g.math("ABSOLUTE", d2), 0.45))
    valley = g.smooth(h, 0.0, 0.4)
    base = g.mixc(valley, g.rgb("#4a040e") if slot is None else g.mixc(0.72, g.rgb(col, slot), (0.0, 0.0, 0.0)), g.rgb(col, slot))
    btn = g.smooth(g.add(g.math("ABSOLUTE", d1), g.math("ABSOLUTE", d2)), 0.34, 0.2)
    base = g.mixc(btn, base, g.rgb(piping))
    dust_f = g.mul(g.smooth(g.noise(4.0, 4.0), 0.5, 0.74), dust)
    g.out(g.mixc(dust_f, base, g.rgb(DUST)), g.add(rough, g.mul(dust_f, 0.4)))
    g.bump(g.add(h, g.mul(g.noise(60.0, 3.0), 0.08)), 0.9, 0.014)
    return m


def fabric(name, col, weave=170.0, rough=0.92, slot=None, dust=0.2, col2=None):
    m = bo.pbr(name, roughness=rough)
    g = G(m)
    base = g.rgb(col, slot)
    if col2:
        base = g.mixc(g.smooth(g.noise(6.0, 4.0), 0.42, 0.62), base, g.rgb(col2))
    s = g.uvw
    w1 = g.math("SINE", g.mul(g.add(s[0], s[2]), weave))
    w2 = g.math("SINE", g.mul(g.add(s[1], s[2]), weave))
    h = g.mul(w1, w2)
    dust_f = g.mul(g.smooth(g.noise(3.0, 5.0), 0.42, 0.72), dust)
    shade = g.mixc(g.mul(g.sub(g.noise(30.0, 4.0), 0.5), 0.4), base, (0.01, 0.01, 0.01))
    g.out(g.mixc(dust_f, shade, g.rgb(DUST)), rough)
    g.bump(h, 0.35, 0.002)
    return m


def wood(name, col="#7a5230", col2="#4b2f18", rough=0.72, grain_axis="y", dust=0.3, slot=None, slot2=None):
    m = bo.pbr(name, roughness=rough)
    g = G(m)
    st = {"y": (40.0, 1.5, 40.0), "x": (1.5, 40.0, 40.0), "z": (40.0, 40.0, 1.5)}[grain_axis]
    grain = g.noise(5.0, 7.0, 0.6, stretch=st)
    base = g.mixc(g.smooth(grain, 0.34, 0.66), g.rgb(col, slot), g.rgb(col2, slot2))
    dust_f = g.mul(g.smooth(g.noise(3.0, 5.0), 0.42, 0.72), dust)
    g.out(g.mixc(dust_f, base, g.rgb(DUST)), rough)
    g.bump(grain, 0.6, 0.004)
    return m


def lens_red(name="lens_red", col="#c4101c"):
    """Moulded tail-lamp plastic: deep colour, faceted bump, glossy."""
    m = bo.pbr(name, roughness=0.14)
    g = G(m)
    s = g.uvw
    facets = g.mul(g.math("SINE", g.mul(s[0], 300.0)), g.math("SINE", g.mul(s[2], 300.0)))
    g.out(g.mixc(g.mul(g.add(facets, 1.0), 0.18), g.rgb(col), g.rgb("#ff3b2c")))
    g.bump(facets, 0.3, 0.002)
    return m


def lens_amber(name="lens_amber"):
    return lens_red(name, "#e8820c")


def reflector(name="reflector", tint="#e8ebef"):
    """Lamp reflector bowl: bright metal with a faceted bump, reads under a clear lens."""
    m = bo.pbr(name, roughness=0.22, metallic=0.12)
    g = G(m)
    s = g.uvw
    facets = g.mul(g.math("SINE", g.mul(s[0], 300.0)), g.math("SINE", g.mul(s[2], 300.0)))
    g.out(g.mixc(g.mul(g.add(facets, 1.0), 0.25), g.rgb(tint), (1.0, 1.0, 1.0)), 0.22, 0.12)
    g.bump(facets, 0.3, 0.002)
    return m


def tyre_mat(name, center, r, width, lugs=30, kind="road"):
    """Tyre with radial tread blocks and sidewall ribs, computed from the wheel's own centre."""
    m = bo.pbr(name, roughness=0.86)
    g = G(m)
    cx, cy, cz = center
    s = g.uvw
    rx = g.sub(s[0], cx)
    ry = g.sub(s[1], cy)
    rz = g.sub(s[2], cz)
    ang = g.math("ARCTAN2", rz, ry)
    rad = g.math("SQRT", g.add(g.mul(ry, ry), g.mul(rz, rz)))
    crown = g.smooth(rad, r - 0.016 * max(1.0, r / 0.3), r - 0.009)
    ax = g.math("ABSOLUTE", rx)
    if kind == "knob":
        chev = g.add(g.mul(ang, lugs), g.mul(ax, 90.0))
        blocks = g.smooth(g.math("SINE", chev), -0.1, 0.25)
    elif kind == "bike":
        chev = g.add(g.mul(ang, lugs * 1.6), g.mul(ax, 340.0))
        blocks = g.smooth(g.math("SINE", chev), -0.15, 0.2)
    else:
        chev = g.add(g.mul(ang, lugs * 1.7), g.mul(ax, 44.0))
        blocks = g.smooth(g.math("SINE", chev), -0.72, -0.5)
        ribs = g.smooth(g.math("SINE", g.mul(rx, 360.0 / max(0.05, width) * 0.18)), -0.86, -0.68)
        blocks = g.mul(blocks, ribs)
    wall = g.mul(g.math("SINE", g.mul(rad, 900.0)), 0.04)
    band = g.mul(g.smooth(rad, r * 0.78, r * 0.79), g.smooth(rad, r * 0.84, r * 0.83))
    h = g.mixf(crown, g.add(wall, g.mul(band, 0.35)), g.mul(blocks, 1.0))
    base = g.mixc(g.mul(g.sub(1.0, blocks), crown), g.rgb("#1d1c1b"), g.rgb("#0b0b0b"))
    dust_big = g.smooth(g.noise(6.0, 5.0), 0.35, 0.7)
    dust_f = g.mul(dust_big, g.mixf(crown, 0.16, 0.34))
    dust_f = g.mul(dust_f, g.mixf(crown, 1.0, blocks))
    base = g.mixc(dust_f, base, g.rgb("#6d6050"))
    g.out(base, g.add(0.82, g.mul(dust_f, 0.15)))
    g.bump(h, 0.9, 0.0035 if r < 0.45 else 0.006)
    return m


# ---------------------------------------------------------------------------
# Painted art: anti-aliased signed-distance painter over a numpy canvas (sRGB).
# ---------------------------------------------------------------------------


class Canvas:
    def __init__(self, w, h, bg="#ffffff"):
        self.w, self.h = w, h
        self.c = np.ones((h, w, 3), np.float32) * np.array(srgb(bg), np.float32)
        self.alpha = np.ones((h, w), np.float32)
        self.height = np.zeros((h, w), np.float32)

    def _win(self, x0, y0, x1, y1):
        ix0, iy0 = max(0, int(math.floor(x0)) - 2), max(0, int(math.floor(y0)) - 2)
        ix1, iy1 = min(self.w, int(math.ceil(x1)) + 2), min(self.h, int(math.ceil(y1)) + 2)
        if ix1 <= ix0 or iy1 <= iy0:
            return None
        ys, xs = np.mgrid[iy0:iy1, ix0:ix1]
        return (slice(iy0, iy1), slice(ix0, ix1)), xs + 0.5, ys + 0.5

    def _blend(self, slc, mask, col, alpha=1.0, h=None, a=None):
        m = (mask * alpha)[..., None]
        self.c[slc] = self.c[slc] * (1 - m) + np.array(srgb(col) if isinstance(col, str) else col, np.float32) * m
        if h is not None:
            self.height[slc] = self.height[slc] * (1 - m[..., 0]) + h * m[..., 0]
        if a is not None:
            self.alpha[slc] = self.alpha[slc] * (1 - m[..., 0]) + a * m[..., 0]

    def rect(self, x0, y0, x1, y1, col, alpha=1.0, h=None, a=None):
        w = self._win(x0, y0, x1, y1)
        if w is None:
            return
        slc, xs, ys = w
        mask = np.clip(xs - x0 + 0.5, 0, 1) * np.clip(x1 - xs + 0.5, 0, 1) * np.clip(ys - y0 + 0.5, 0, 1) * np.clip(y1 - ys + 0.5, 0, 1)
        self._blend(slc, mask, col, alpha, h, a)

    def vgrad(self, y0, y1, c0, c1):
        a, b = np.array(srgb(c0), np.float32), np.array(srgb(c1), np.float32)
        for y in range(max(0, int(y0)), min(self.h, int(y1))):
            t = (y - y0) / max(1, y1 - y0)
            self.c[y, :] = a * (1 - t) + b * t

    def ellipse(self, cx, cy, rx, ry, col, rot=0.0, alpha=1.0, outline=None, ow=1.5, h=None, a=None):
        big = max(rx, ry) + ow + 2
        w = self._win(cx - big, cy - big, cx + big, cy + big)
        if w is None:
            return
        slc, xs, ys = w
        dx, dy = xs - cx, ys - cy
        if rot:
            c, s = math.cos(rot), math.sin(rot)
            dx, dy = dx * c + dy * s, -dx * s + dy * c
        q = np.sqrt((dx / max(rx, 1e-3)) ** 2 + (dy / max(ry, 1e-3)) ** 2)
        d = (q - 1.0) * min(rx, ry)
        if outline:
            self._blend(slc, np.clip(0.5 - (d - ow), 0, 1), outline, alpha)
        self._blend(slc, np.clip(0.5 - d, 0, 1), col, alpha, h, a)

    def circle(self, cx, cy, r, col, **kw):
        self.ellipse(cx, cy, r, r, col, **kw)

    def ring(self, cx, cy, r, width, col, alpha=1.0):
        big = r + width + 2
        w = self._win(cx - big, cy - big, cx + big, cy + big)
        if w is None:
            return
        slc, xs, ys = w
        d = np.abs(np.hypot(xs - cx, ys - cy) - r) - width / 2
        self._blend(slc, np.clip(0.5 - d, 0, 1), col, alpha)

    def poly(self, pts, col, alpha=1.0, outline=None, ow=1.5, h=None, a=None):
        p = np.array([(float(x), float(y)) for x, y in pts], np.float32)
        w = self._win(p[:, 0].min() - ow - 1, p[:, 1].min() - ow - 1, p[:, 0].max() + ow + 1, p[:, 1].max() + ow + 1)
        if w is None:
            return
        slc, xs, ys = w
        n = len(p)
        inside = np.zeros(xs.shape, bool)
        dist = np.full(xs.shape, 1e9, np.float32)
        for i in range(n):
            a0, b0 = p[i], p[(i + 1) % n]
            e = b0 - a0
            l2 = max(float(e @ e), 1e-6)
            t = np.clip(((xs - a0[0]) * e[0] + (ys - a0[1]) * e[1]) / l2, 0, 1)
            dist = np.minimum(dist, np.hypot(xs - (a0[0] + t * e[0]), ys - (a0[1] + t * e[1])))
            cond = (a0[1] > ys) != (b0[1] > ys)
            with np.errstate(divide="ignore", invalid="ignore"):
                xint = a0[0] + (ys - a0[1]) * e[0] / (e[1] if abs(e[1]) > 1e-6 else 1e-6)
            inside ^= cond & (xs < xint)
        d = np.where(inside, -dist, dist)
        if outline:
            self._blend(slc, np.clip(0.5 - (d - ow), 0, 1), outline, alpha)
        self._blend(slc, np.clip(0.5 - d, 0, 1), col, alpha, h, a)

    def stroke(self, pts, width, col, width_end=None, alpha=1.0):
        """Thick polyline, optionally tapered."""
        p = np.array([(float(x), float(y)) for x, y in pts], np.float32)
        we = width if width_end is None else width_end
        big = max(width, we)
        w = self._win(p[:, 0].min() - big, p[:, 1].min() - big, p[:, 0].max() + big, p[:, 1].max() + big)
        if w is None:
            return
        slc, xs, ys = w
        best = np.full(xs.shape, 1e9, np.float32)
        n = len(p)
        for i in range(n - 1):
            a0, b0 = p[i], p[i + 1]
            e = b0 - a0
            l2 = max(float(e @ e), 1e-6)
            t = np.clip(((xs - a0[0]) * e[0] + (ys - a0[1]) * e[1]) / l2, 0, 1)
            rad = (width + (we - width) * (i + t) / max(1, n - 1)) / 2
            best = np.minimum(best, np.hypot(xs - (a0[0] + t * e[0]), ys - (a0[1] + t * e[1])) - rad)
        self._blend(slc, np.clip(0.5 - best, 0, 1), col, alpha)

    def line(self, x0, y0, x1, y1, width, col, alpha=1.0):
        self.stroke([(x0, y0), (x1, y1)], width, col, alpha=alpha)

    def petal(self, cx, cy, length, width, ang, col, outline=None, ow=1.2):
        """Pointed leaf from (cx, cy) in direction ang (radians, 0 = +x, y down)."""
        ca, sa = math.cos(ang), math.sin(ang)
        pts = []
        steps = 7
        for i in range(steps + 1):
            t = i / steps
            pts.append((t * length, math.sin(t * math.pi) ** 0.8 * width / 2))
        for i in range(steps - 1, 0, -1):
            t = i / steps
            pts.append((t * length, -math.sin(t * math.pi) ** 0.8 * width / 2))
        self.poly([(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts], col, outline=outline, ow=ow)

    def flower(self, cx, cy, r, petals=7, c1="#ff2d86", c2="#ffd21f", centre="#e3182d", outline="#3a0d24", rot=0.0):
        for i in range(petals):
            a = rot + 2 * math.pi * i / petals
            self.ellipse(cx + math.cos(a) * r * 0.58, cy + math.sin(a) * r * 0.58, r * 0.46, r * 0.3, c1, rot=a, outline=outline, ow=max(0.8, r * 0.05))
        for i in range(petals):
            a = rot + 2 * math.pi * (i + 0.5) / petals
            self.ellipse(cx + math.cos(a) * r * 0.32, cy + math.sin(a) * r * 0.32, r * 0.24, r * 0.15, c2, rot=a)
        self.circle(cx, cy, r * 0.2, centre, outline=outline, ow=max(0.8, r * 0.04))
        self.circle(cx, cy, r * 0.08, "#fff3c4")

    def lotus(self, cx, cy, r, c1="#ff4f9a", c2="#ffc2dc", outline="#7a0f45"):
        for ang, l in ((-150, 0.92), (-30, 0.92), (-125, 1.0), (-55, 1.0)):
            self.petal(cx, cy, r * l, r * 0.46, math.radians(ang), c1, outline=outline)
        for ang, l in ((-105, 1.08), (-75, 1.08), (-90, 1.18)):
            self.petal(cx, cy, r * l, r * 0.46, math.radians(ang), c2, outline=outline)
        self.ellipse(cx, cy + r * 0.05, r * 0.52, r * 0.13, "#3d9d43", outline="#143d1e", ow=1)

    def leaf_spray(self, cx, cy, ang, n, l, w, col="#2fa84f", outline="#10401f", spread=0.5):
        for i in range(n):
            a = ang + (i - (n - 1) / 2) * spread
            self.petal(cx, cy, l * (1 - 0.1 * abs(i - (n - 1) / 2)), w, a, col, outline=outline)

    def speckle(self, amount=0.05, seed=3, scale=1.0):
        """Hand-painted mottling so flat fields do not look digital."""
        rng = np.random.default_rng(seed)
        small = rng.random((self.h // 8 + 2, self.w // 8 + 2), dtype=np.float32)
        yi = np.linspace(0, small.shape[0] - 1.001, self.h)
        xi = np.linspace(0, small.shape[1] - 1.001, self.w)
        y0, x0 = yi.astype(int), xi.astype(int)
        fy, fx = (yi - y0)[:, None], (xi - x0)[None, :]
        n = small[y0][:, x0] * (1 - fy) * (1 - fx) + small[y0 + 1][:, x0] * fy * (1 - fx) + small[y0][:, x0 + 1] * (1 - fy) * fx + small[y0 + 1][:, x0 + 1] * fy * fx
        self.c *= (1 - amount * scale + 2 * amount * scale * n)[..., None]
        self.c = np.clip(self.c, 0, 1)

    def to_image(self, name, data=None, non_color=False, use_alpha=False):
        arr = self.c if data is None else data
        img = bpy.data.images.new(name, self.w, self.h, alpha=True)
        if non_color:
            img.colorspace_settings.name = "Non-Color"
        flat = np.ones((self.h, self.w, 4), np.float32)
        if arr.ndim == 2:
            flat[..., 0] = flat[..., 1] = flat[..., 2] = arr
        else:
            flat[..., :3] = arr
        if use_alpha:
            flat[..., 3] = self.alpha
        img.pixels.foreach_set(flat[::-1].ravel())
        img.pack()
        return img

    def height_image(self, name):
        return self.to_image(name, data=self.height, non_color=True)

    def update_image(self, img, data=None, use_alpha=False):
        arr = self.c if data is None else data
        flat = np.ones((self.h, self.w, 4), np.float32)
        if arr.ndim == 2:
            flat[..., 0] = flat[..., 1] = flat[..., 2] = arr
        else:
            flat[..., :3] = arr
        if use_alpha:
            flat[..., 3] = self.alpha
        img.pixels.foreach_set(flat[::-1].ravel())
        img.pack()
        img.update()


def painted(name, img, rough=0.45, vec=None, bump_img=None, bump_strength=0.8, metal_img=None, metal=0.0,
            dust=0.2, wear=0.0, wear_col="#4a3f35"):
    """Material from a painted image, with dust and flaking over it. vec is the UV input."""
    m = bo.pbr(name, roughness=rough, metallic=metal)
    g = G(m)
    v = vec(g) if callable(vec) else g.uvmap("art")
    t = g.image(img, v)
    col = t.outputs["Color"]
    if wear > 0:
        flake = g.smooth(g.add(g.mul(g.sub(g.noise(36.0, 6.0), 0.5), wear * 3.0), g.mul(g.edges(), 1.6)), 0.30, 0.42)
        col = g.mixc(flake, col, g.rgb(wear_col))
    dust_f = g.mul(g.smooth(g.noise(4.0, 5.0), 0.4, 0.72), dust)
    col = g.mixc(dust_f, col, g.rgb(DUST))
    r = g.add(rough, g.mul(dust_f, 0.35))
    if metal_img is not None:
        met = g.mul(g.image(metal_img, v).outputs["Color"], g.sub(1.0, dust_f))
        g.out(col, r, met)
    else:
        g.out(col, r)
    if bump_img is not None:
        bt = g.image(bump_img, v)
        g.bump(bt.outputs["Color"], bump_strength, 0.012)
    return m


# ---------------------------------------------------------------------------
# Wheels. Built with the axle along X; the outer face points to +X.
# ---------------------------------------------------------------------------


def tyre_profile(r, width, section_h, crown=0.12, grooves=0):
    """(axial, radius) tyre cross-section from the inner bead over the crown to the other bead."""
    w = width / 2
    rb = r - section_h
    pts = [(-w * 0.78, rb), (-w * 0.92, rb + section_h * 0.18), (-w * 1.0, rb + section_h * 0.46),
           (-w * 0.97, rb + section_h * 0.72), (-w * 0.86, rb + section_h * 0.92)]
    pts.append((-w * 0.74, r - section_h * crown * 0.25))
    if grooves:
        step = 1.48 * w / (grooves + 1)
        for i in range(grooves):
            x = -w * 0.74 + step * (i + 1)
            pts += [(x - 0.004, r), (x - 0.0035, r - 0.006), (x + 0.0035, r - 0.006), (x + 0.004, r)]
    else:
        pts.append((0.0, r))
    pts.append((w * 0.74, r - section_h * crown * 0.25))
    pts += [(w * 0.86, rb + section_h * 0.92), (w * 0.97, rb + section_h * 0.72), (w * 1.0, rb + section_h * 0.46),
            (w * 0.92, rb + section_h * 0.18), (w * 0.78, rb)]
    return pts


def round_tyre_profile(r, width, n=9):
    """Near-round bicycle tyre section."""
    h = width / 2
    rc = r - h * 1.08
    out = []
    for i in range(n):
        a = math.radians(-118 + 236 * i / (n - 1))
        out.append((math.sin(a) * h, rc + math.cos(a) * h * 1.08))
    return out


def wheel_spoked(b, c, r, width, spokes=36, rim_mat=None, seg=36, hub_r=0.024, hub_w=0.05, flange=0.032, lugs=34, tyre_kind="bike", den=1.0, hub_mat=None, spoke_r=0.0024):
    """Bicycle, rickshaw and motorbike wire wheels."""
    node = b.current_wheel
    rim_mat = rim_mat or b.mat("rimchrome", lambda: chrome("rimchrome", rough=0.26, tint="#aeb0b4", dust=0.3))
    hub_mat = hub_mat or b.mat("steel", lambda: steel())
    tm = tyre_mat(f"tyre_{node}", c, r, width, lugs=lugs, kind=tyre_kind)
    b.add(lathe("tyre", round_tyre_profile(r, width), seg, c), tm, node, den=den)
    rr = r - width * 1.04
    rim_w = min(width * 0.5, 0.018)
    prof = [(-rim_w, rr - 0.012), (-rim_w * 1.05, rr + 0.002), (-rim_w * 0.82, rr + 0.012), (-rim_w * 0.6, rr + 0.008), (rim_w * 0.6, rr + 0.008),
            (rim_w * 0.82, rr + 0.012), (rim_w * 1.05, rr + 0.002), (rim_w, rr - 0.012), (0.0, rr - 0.02)]
    b.add(lathe("rim", prof + [prof[0]], seg, c), rim_mat, node, den=den)
    b.add(lathe("hub", [(-hub_w, 0.0), (-hub_w, 0.012), (-flange, hub_r * 0.62), (-flange, hub_r * 1.25), (-flange * 0.8, hub_r * 1.25), (-flange * 0.6, hub_r * 0.8), (flange * 0.6, hub_r * 0.8), (flange * 0.8, hub_r * 1.25), (flange, hub_r * 1.25), (flange, hub_r * 0.62), (hub_w, 0.012), (hub_w, 0.0)], 12, c), hub_mat, node, den=den)
    objs = []
    cv = Vector(c)
    for i in range(spokes):
        side = 1 if i % 2 == 0 else -1
        lace = 1 if i % 4 < 2 else -1
        a_rim = 2 * math.pi * i / spokes
        a_hub = a_rim + lace * math.radians(58)
        p0 = cv + Vector((side * flange, math.cos(a_hub) * hub_r * 1.2, math.sin(a_hub) * hub_r * 1.2))
        p1 = cv + Vector((side * width * 0.1, math.cos(a_rim) * (rr - 0.012), math.sin(a_rim) * (rr - 0.012)))
        objs.append(tube(f"sp{i}", [p0, p1], spoke_r, seg=3, caps=False))
    b.add(bo.join(objs, "spokes"), rim_mat, node, den=0)


def wheel_small(b, c, r, width, rim_r, bolts=4, seg=20, den=1.0, disc_col="#e4e4e0", lugs=18, holes=6):
    """Light steel wheel for three-wheelers, about 650 tris: tyre, one-piece dished disc, nuts."""
    node = b.current_wheel
    tm = tyre_mat(f"tyre_{node}", c, r, width, lugs=lugs, kind="road") if node != "body" else b.mat("rubber", lambda: rubber())
    w = width / 2
    rb = rim_r
    prof = [(-w * 0.8, rb), (-w * 1.0, rb + (r - rb) * 0.45), (-w * 0.92, rb + (r - rb) * 0.82), (-w * 0.62, r - 0.002), (0.0, r), (w * 0.62, r - 0.002), (w * 0.92, rb + (r - rb) * 0.82), (w * 1.0, rb + (r - rb) * 0.45), (w * 0.8, rb)]
    b.add(lathe("tyre", prof, seg, c), tm, node, den=den)
    st = paint(f"disc_{node}", disc_col, rough=0.42, metal=0.1, dust=0.45, chips=0.45, scratch=0.25, edge=0.7, chip_col="#5a3f2a", grime=0.5)
    x0 = w * 0.55
    disc = [(w * 0.82, rb + 0.002), (w * 0.72, rb - 0.012), (x0 * 0.5, rb * 0.82), (x0, rb * 0.62), (x0 * 0.82, rb * 0.42), (x0 * 1.2, rb * 0.34), (x0 * 1.22, 0.0)]
    b.add(lathe("disc", disc, seg, c), st, node, den=den)
    cv = Vector(c)
    dark = b.mat("holes", lambda: bo.pbr("holes", C("#0c0c0c"), 0.8))
    objs = []
    for i in range(holes):
        a = 2 * math.pi * (i + 0.5) / holes
        objs.append(lathe("h", [(0.0, rb * 0.07), (0.0, 0.0)], 6, cv + Vector((x0 * 0.82 + 0.006, math.cos(a) * rb * 0.6, math.sin(a) * rb * 0.6))))
    b.add(bo.join(objs, "vents"), dark, node, den=den * 0.3)
    b.add(bolt_ring("nuts", cv + Vector((x0 * 1.2, 0, 0)), rb * 0.22, bolts, bolt_r=max(0.006, rb * 0.075), depth=0.012, seg=5), b.mat("chrome", lambda: chrome()), node, den=den)


def wheel_truck(b, c, r, width, rim_r, bolts=8, seg=24, den=1.0, disc_col="#d9d7cf", lugs=26, holes=8, dual=False, slot=None):
    """Heavy steel wheel: real tyre section, dished disc, vent holes, hub boss and lug nuts.
    About 1100 tris, or 1700 with dual tyres."""
    node = b.current_wheel
    tm = tyre_mat(f"tyre_{node}", c, r, width, lugs=lugs, kind="road")
    cv = Vector(c)
    prof = tyre_profile(r, width, r - rim_r, grooves=0)
    if dual:
        b.add(lathe("tyre", prof, seg, cv + Vector((-width * 0.56, 0, 0))), tm, node, den=den * 0.8)
        b.add(lathe("tyre", prof, seg, cv + Vector((width * 0.56, 0, 0))), tm, node, den=den)
        out_x = width * 0.56
    else:
        b.add(lathe("tyre", prof, seg, c), tm, node, den=den)
        out_x = 0.0
    st = paint(f"disc_{node}", disc_col, rough=0.42, metal=0.1, dust=0.5, chips=0.5, scratch=0.3, edge=0.9, chip_col="#5a3f2a", grime=0.6, slot=slot)
    w = width / 2
    x0 = out_x + w * 0.45
    disc = [(out_x + w * 0.9, rim_r + 0.006), (out_x + w * 0.78, rim_r - 0.008), (x0 * 0.75 if not dual else x0 - 0.02, rim_r * 0.88), (x0, rim_r * 0.7), (x0 - 0.008, rim_r * 0.52), (x0 + 0.012, rim_r * 0.44), (x0 + 0.018, rim_r * 0.26), (x0 + 0.018, 0.0)]
    b.add(lathe("disc", disc, seg, c), st, node, den=den)
    dark = b.mat("holes", lambda: bo.pbr("holes", C("#0c0c0c"), 0.8))
    objs = []
    for i in range(holes):
        a = 2 * math.pi * (i + 0.5) / holes
        objs.append(lathe("h", [(0.0, rim_r * 0.075), (0.0, 0.0)], 6, cv + Vector((x0 + 0.002, math.cos(a) * rim_r * 0.62, math.sin(a) * rim_r * 0.62))))
    b.add(bo.join(objs, "vents"), dark, node, den=den * 0.3)
    nut = b.mat("chrome", lambda: chrome())
    b.add(bolt_ring("nuts", cv + Vector((x0 + 0.014, 0, 0)), rim_r * 0.33, bolts, bolt_r=max(0.009, rim_r * 0.04), depth=0.018, seg=5), nut, node, den=den)
    b.add(lathe("cap", [(x0 + 0.018, rim_r * 0.2), (x0 + 0.036, rim_r * 0.17), (x0 + 0.048, rim_r * 0.09), (x0 + 0.05, 0.0)], 12, c), nut, node, den=den)


def wheel_alloy(b, c, r, width, rim_r, spokes=5, seg=40, den=1.0, paint_col="#d4d6d9", lugs=38, double=True, bolts=4):
    """Car alloy: real tyre section, barrel, split spokes, hub with lug nuts."""
    node = b.current_wheel
    tm = tyre_mat(f"tyre_{node}", c, r, width, lugs=lugs, kind="road")
    b.add(lathe("tyre", tyre_profile(r, width, r - rim_r, grooves=0), seg, c), tm, node, den=den)
    al = paint(f"alloy_{node}", paint_col, rough=0.3, metal=0.75, dust=0.2, chips=0.1, scratch=0.2, edge=0.5, chip_col="#4f4f4f", grime=0.35)
    dk = paint(f"barrel_{node}", "#232425", rough=0.55, metal=0.4, dust=0.2, chips=0, scratch=0, edge=0)
    w = width / 2
    barrel = [(-w * 0.86, rim_r), (-w * 0.74, rim_r - 0.012), (w * 0.5, rim_r - 0.022), (w * 0.74, rim_r - 0.002), (w * 0.92, rim_r + 0.008), (w * 0.86, rim_r)]
    b.add(lathe("barrel", barrel, seg, c), al, node, den=den)
    b.add(lathe("wellback", [(-w * 0.72, rim_r - 0.015), (-w * 0.2, rim_r * 0.5), (w * 0.05, 0.035), (w * 0.05, 0.0)], 14, c), dk, node, den=den * 0.5)
    hub_x = w * 0.42
    b.add(lathe("hub", [(hub_x - 0.03, 0.078), (hub_x, 0.075), (hub_x + 0.006, 0.066), (hub_x + 0.008, 0.034), (hub_x + 0.018, 0.03), (hub_x + 0.02, 0.0)], 14, c), al, node, den=den)
    objs = []
    cv = Vector(c)
    for i in range(spokes):
        a0 = 2 * math.pi * i / spokes
        for off in ((-0.1, 0.1) if double else (0.0,)):
            a = a0 + off
            d0 = Vector((0, math.cos(a0), math.sin(a0)))
            d1 = Vector((0, math.cos(a), math.sin(a)))
            perp0 = Vector((0, -d0.z, d0.y))
            perp1 = Vector((0, -d1.z, d1.y))
            wh = 0.018 if double else 0.032
            wr = 0.012 if double else 0.022
            rows = []
            for t, wd, depth in ((0.0, wh, 0.0), (0.45, (wh + wr) * 0.5, -0.006), (1.0, wr, -0.022)):
                rad = 0.06 + (rim_r - 0.012 - 0.06) * t
                base = (d0 * (1 - t) + d1 * t).normalized() * rad
                perp = perp0 * (1 - t) + perp1 * t
                p = cv + Vector((hub_x + depth, 0, 0)) + base
                rows.append([p - perp * wd, p + perp * wd, p + perp * wd - Vector((0.026, 0, 0)), p - perp * wd - Vector((0.026, 0, 0))])
            s = grid("sp", rows, close_u=True)
            objs.append(s)
    sp = bo.join(objs, "alloyspokes")
    bo.recalc_normals(sp)
    b.add(sp, al, node, den=den)
    b.add(bolt_ring("lugs", cv + Vector((hub_x + 0.006, 0, 0)), 0.05, bolts, bolt_r=0.009, depth=0.01), b.mat("chrome", lambda: chrome()), node, den=den)


def wheel_steel(b, c, r, width, rim_r, bolts=6, seg=36, den=1.0, disc_col="#e8e8e6", lugs=26, cap=True, dish=0.5, tyre_kind="road", grooves=2, holes=8, slot=None, nut_mat=None):
    """Pressed steel wheel for vans, buses, trucks and CNGs: dished disc, vent holes, lug nuts."""
    node = b.current_wheel
    tm = tyre_mat(f"tyre_{node}", c, r, width, lugs=lugs, kind=tyre_kind) if node != "body" else b.mat("rubber", lambda: rubber())
    b.add(lathe("tyre", tyre_profile(r, width, r - rim_r, grooves=grooves), seg, c), tm, node, den=den)
    st = paint(f"disc_{node}", disc_col, rough=0.42, metal=0.1, dust=0.45, chips=0.45, scratch=0.25, edge=0.9, chip_col="#5a3f2a", grime=0.5, slot=slot)
    w = width / 2
    x0 = w * dish
    prof = [(-w * 0.86, rim_r), (-w * 0.92, rim_r + 0.008), (-w * 0.78, rim_r - 0.003), (-w * 0.5, rim_r - 0.02), (x0 * 0.4, rim_r * 0.92), (x0, rim_r * 0.82),
            (x0 * 1.05, rim_r * 0.72), (x0 * 0.7, rim_r * 0.55), (x0 * 0.9, rim_r * 0.42), (x0 * 1.18, rim_r * 0.40), (x0 * 1.22, rim_r * 0.32), (x0 * 1.22, 0.0)]
    b.add(lathe("disc", prof, seg, c), st, node, den=den)
    b.add(lathe("lip", [(w * 0.5, rim_r - 0.02), (w * 0.78, rim_r - 0.003), (w * 0.92, rim_r + 0.008), (w * 0.86, rim_r)], seg, c), st, node, den=den)
    cv = Vector(c)
    dark = b.mat("holes", lambda: bo.pbr("holes", C("#0c0c0c"), 0.8))
    objs = []
    for i in range(holes):
        a = 2 * math.pi * (i + 0.5) / holes
        p = cv + Vector((x0 * 0.74, math.cos(a) * rim_r * 0.68, math.sin(a) * rim_r * 0.68))
        objs.append(bo.cylinder("h", rim_r * 0.085, 0.006, segments=8, loc=p + Vector((0.012, 0, 0)), rot=(0, math.pi / 2, 0)))
    b.add(bo.join(objs, "vents"), dark, node, den=den * 0.3)
    nut = nut_mat or b.mat("chrome", lambda: chrome())
    b.add(bolt_ring("nuts", cv + Vector((x0 * 1.18, 0, 0)), rim_r * 0.3, bolts, bolt_r=max(0.008, rim_r * 0.034), depth=0.018), nut, node, den=den)
    if cap:
        b.add(lathe("cap", [(x0 * 1.2, rim_r * 0.2), (x0 * 1.2 + 0.018, rim_r * 0.17), (x0 * 1.2 + 0.03, rim_r * 0.08), (x0 * 1.2 + 0.032, 0.0)], 14, c), nut, node, den=den)


# ---------------------------------------------------------------------------
# Build: collects parts, makes the atlas, bakes, splits, exports
# ---------------------------------------------------------------------------

CUR = None


class Build:
    def __init__(self, vid, opts):
        self.vid = vid
        self.opts = opts
        self.parts = []
        self.glass_parts = []
        self.empties = []
        self.materials = {}
        self.slots = {}
        self.wheels = []  # dicts: master tag, centres
        self.current_wheel = None
        self.steer = None  # dict(origin, rake_deg)
        self.crank = None
        self.spec = {}
        self.variants = {}  # name -> dict(slot -> colour) plus "_fn" for painted images
        self.tex = 1024
        self.tex_detail = None  # smaller size for normal/roughness (bus and truck)
        self.ao_distance = 0.7
        self.chart_cell = 0.9
        self.ss = 2
        self.quality = 86
        self.preview = dict(target=(0, 0, 0.8), distance=6.0, height=1.3)
        self.ground = 0.0

    # -- authoring ------------------------------------------------------------------

    def mat(self, key, factory):
        if key not in self.materials:
            self.materials[key] = factory()
        return self.materials[key]

    def add(self, obj, mat, node="body", den=1.0, flat=False):
        """den is a texel density multiplier; 0 maps the part to a tiny shared colour patch."""
        bo.assign(obj, mat)
        obj["node"] = node
        obj["den"] = float(den)
        obj["flat"] = bool(flat)
        self.parts.append(obj)
        return obj

    def tube(self, pts, r, mat, node="body", den=1.0, seg=8, caps=True, rs=None, closed=False):
        return self.add(tube("t", pts, r, seg=seg, caps=caps, rs=rs, closed=closed), mat, node, den)

    def both(self, fn):
        """Call fn(sign) for sign in (+1, -1); sign multiplies X."""
        fn(1)
        fn(-1)

    def glass(self, obj):
        self.glass_parts.append(obj)
        return obj

    def empty(self, name, loc, parent=None, yaw=0.0):
        """yaw in degrees about Z, for seats that do not face forward."""
        self.empties.append((name, Vector(loc), parent, yaw))

    def add_wheels(self, entries, builder):
        """entries: [(node, centre, mirror)]. builder(b, c) builds one wheel with its axle at c.
        All entries share one UV island and mesh; mirror=True flips it for the far side."""
        idx = len(self.wheels)
        tag = f"__wheel{idx}"
        r_hint = entries[0][1][2]
        c = (WHEEL_BAKE_X + idx * 4.0, 0.0, r_hint)
        self.current_wheel = tag
        builder(self, c)
        self.current_wheel = None
        self.wheels.append(dict(tag=tag, bake_c=Vector(c), entries=entries))

    def set_steer(self, origin, rake_deg):
        self.steer = dict(origin=Vector(origin), rake=math.radians(rake_deg))

    def variant(self, name, slots=None, fn=None):
        self.variants[name] = dict(slots=slots or {}, fn=fn)

    # -- pipeline -------------------------------------------------------------------

    def _merge(self):
        """Merge all parts into one mesh with per-face node id and density."""
        node_names = []
        materials = []
        bm = bmesh.new()
        layer_node = bm.faces.layers.int.new("bo_node")
        layer_den = bm.faces.layers.float.new("bo_den")
        layer_chart = bm.faces.layers.int.new("bo_chart")
        cell = self.chart_cell
        chart_ids = {}
        for o in self.parts:
            bo.apply_modifiers(o)
            bo.apply_transforms(o)
            mesh = o.data
            if o["flat"]:
                for e in mesh.edges:
                    e.use_edge_sharp = True
            nid = node_names.index(o["node"]) if o["node"] in node_names else len(node_names)
            if nid == len(node_names):
                node_names.append(o["node"])
            mat = mesh.materials[0]
            if mat not in materials:
                materials.append(mat)
            mi = materials.index(mat)
            start = len(bm.faces)
            bm.from_mesh(mesh)
            bm.faces.ensure_lookup_table()
            layer_node = bm.faces.layers.int["bo_node"]
            layer_den = bm.faces.layers.float["bo_den"]
            layer_chart = bm.faces.layers.int["bo_chart"]
            new_faces = bm.faces[start:]
            cos = [v.co for f in new_faces for v in f.verts]
            big = False
            if cos:
                dims = [max(c[i] for c in cos) - min(c[i] for c in cos) for i in range(3)]
                big = max(dims) > cell * 1.15
            for f in new_faces:
                f.material_index = mi
                f[layer_node] = nid
                f[layer_den] = o["den"]
                if big:
                    # Long surfaces are cut into charts so one island cannot limit the whole atlas.
                    c = f.calc_center_median()
                    key = (nid, mi, math.floor(c.x / cell), math.floor(c.y / cell), math.floor(c.z / cell))
                    f[layer_chart] = chart_ids.setdefault(key, len(chart_ids) + 1)
                else:
                    f[layer_chart] = 0
        limit = math.radians(62)
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.smooth and e.calc_face_angle(0.0) > limit:
                e.smooth = False
        out = bpy.data.meshes.new("merged")
        bm.to_mesh(out)
        bm.free()
        for m in materials:
            out.materials.append(m)
        obj = bpy.data.objects.new("__merged", out)
        bpy.context.scene.collection.objects.link(obj)
        for o in self.parts:
            bpy.data.objects.remove(o, do_unlink=True)
        self.parts = []
        self.node_names = node_names
        self._weighted_normals(obj)
        return obj

    def _weighted_normals(self, obj):
        mod = obj.modifiers.new("wn", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
        mod.weight = 50
        bo.apply_modifiers(obj)

    def _atlas(self, obj):
        """Smart-project, rescale islands by density, reserve a strip for flat colour patches, pack."""
        me = obj.data
        art = me.uv_layers.get("art")
        atlas = me.uv_layers.new(name="UVMap")
        me.uv_layers.active = atlas
        atlas.active_render = True
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.context.tool_settings.use_uv_select_sync = True
        bm = bmesh.from_edit_mesh(me)
        chart_layer = bm.faces.layers.int["bo_chart"]
        den = bm.faces.layers.float["bo_den"]
        charts = sorted({f[chart_layer] for f in bm.faces if f[den] > 0})
        for chart in charts:
            bm = bmesh.from_edit_mesh(me)
            chart_layer = bm.faces.layers.int["bo_chart"]
            den = bm.faces.layers.float["bo_den"]
            for f in bm.faces:
                f.select = f[den] > 0 and f[chart_layer] == chart
            bmesh.update_edit_mesh(me)
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, area_weight=0.0, scale_to_bounds=False)
        bm = bmesh.from_edit_mesh(me)
        uv = bm.loops.layers.uv["UVMap"]
        den = bm.faces.layers.float["bo_den"]
        for f in bm.faces:
            f.select = f[den] > 0
        faces = [f for f in bm.faces if f.select]
        # Each projection call used its own scale, so set every island's density from its true area.
        for isl in _uv_islands(faces, uv):
            area3d = sum(f.calc_area() for f in isl)
            area_uv = 0.0
            for f in isl:
                pts = [l[uv].uv for l in f.loops]
                area_uv += abs(sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y for i in range(len(pts)))) / 2
            if area_uv < 1e-14 or area3d < 1e-12:
                continue
            k = math.sqrt(area3d / area_uv) * max(f[den] for f in isl)
            us = [l[uv].uv.copy() for f in isl for l in f.loops]
            cu = sum((p.x for p in us)) / len(us)
            cv = sum((p.y for p in us)) / len(us)
            for f in isl:
                for l in f.loops:
                    l[uv].uv.x = cu + (l[uv].uv.x - cu) * k
                    l[uv].uv.y = cv + (l[uv].uv.y - cv) * k
        bmesh.update_edit_mesh(me)
        bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="SCALED", margin=0.0035, shape_method="CONCAVE", udim_source="CLOSEST_UDIM")
        bm = bmesh.from_edit_mesh(me)
        uv = bm.loops.layers.uv["UVMap"]
        den = bm.faces.layers.float["bo_den"]
        # Squeeze the packed atlas, then give each flat material a small patch in the free strip.
        keep = 0.978
        patch = 0.016
        cells = {}
        for f in bm.faces:
            if f[den] > 0:
                for l in f.loops:
                    l[uv].uv *= keep
            else:
                key = f.material_index
                if key not in cells:
                    n = len(cells)
                    cells[key] = (0.004 + (n % 48) * (patch + 0.0045), keep + 0.002)
                ox, oy = cells[key]
                k = len(f.loops)
                for i, l in enumerate(f.loops):
                    t = 2 * math.pi * i / k
                    l[uv].uv = (ox + patch * (0.5 + 0.5 * math.cos(t)), oy + patch * (0.5 + 0.5 * math.sin(t)))
        bmesh.update_edit_mesh(me)
        bpy.ops.object.mode_set(mode="OBJECT")
        return art

    def _bake(self, obj):
        scene = bpy.context.scene
        world = bpy.data.worlds.new("bake")
        scene.world = world
        world.light_settings.distance = self.ao_distance
        # Glass is alpha blended in the game, so AO rays must pass through it to the
        # lamps and cabin behind; otherwise they bake black.
        for o in self.glass_parts:
            o.hide_render = True
        ground = None
        if self.ground is not None:
            ext = 14.0
            gm = bpy.data.meshes.new("__g")
            gm.from_pydata([(-ext, -ext, self.ground), (ext, -ext, self.ground), (ext, ext, self.ground), (-ext, ext, self.ground)], [], [(0, 1, 2, 3)])
            ground = bpy.data.objects.new("__ground", gm)
            scene.collection.objects.link(ground)
            gm.materials.append(bo.pbr("__gm", (0.3, 0.3, 0.3), 0.9))
        # Keep a procedural copy: variants re-bake albedo from it with the same UVs.
        src = obj.copy()
        src.data = obj.data.copy()
        src.name = "__src"
        tex = self.opts.get("tex") or self.tex
        t0 = time.time()
        # Cycles samples each baked texel at one spot, so thin lines and fine noise alias.
        # Baking at twice the size and box-filtering down gives clean seams and art.
        size = tex * self.ss
        baked = bo.bake_pbr(obj, size=size, name=self.vid, samples=8, margin=6 * self.ss)
        for suffix in ("_albedo", "_rough", "_normal", "_metal"):
            shrink_image(bpy.data.images[self.vid + suffix], tex)
        print(f"[veh] bake {self.vid} {size}px to {tex}px in {time.time() - t0:.1f}s")
        if ground is not None:
            bpy.data.objects.remove(ground, do_unlink=True)
        for o in self.glass_parts:
            o.hide_render = False
        return baked, src

    def _bake_variants(self, src):
        """Re-bake only albedo for every variant. The GLB itself embeds the first variant."""
        scene = bpy.context.scene
        names = [n for n in self.variants]
        if not names or self.opts.get("novariants"):
            return
        scene.collection.objects.link(src)
        ao = bpy.data.images.get(f"{self.vid}_ao")
        tex = self.opts.get("tex") or self.tex
        for name in names:
            if name == "default":
                continue
            v = self.variants[name]
            self._apply_variant(v)
            img = bpy.data.images.new(f"{self.vid}__{name}", tex * self.ss, tex * self.ss, alpha=False)
            bpy.ops.object.select_all(action="DESELECT")
            bpy.context.view_layer.objects.active = src
            src.select_set(True)
            bo._bake_target(src, img)
            saved = bo._neutralise_for_diffuse(src)
            t0 = time.time()
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
            bo._restore_after_diffuse(saved)
            if ao is not None:
                bo._multiply_ao_into(img, ao, strength=0.75)
            shrink_image(img, tex)
            path = os.path.join(OUT_DIR, f"{self.vid}__{name}_albedo.webp")
            os.makedirs(OUT_DIR, exist_ok=True)
            save_webp(img, path, 84)
            print(f"[veh] variant {name}: {os.path.getsize(path) / 1024:.0f} KB in {time.time() - t0:.1f}s")
        bpy.data.objects.remove(src, do_unlink=True)

    def _apply_variant(self, v):
        for slot, col in v["slots"].items():
            for node in self.slots.get(slot, []):
                node.outputs[0].default_value = (*(C(col) if isinstance(col, str) else col), 1)
        if v.get("fn"):
            v["fn"]()

    def _split(self, merged):
        """Split the merged mesh into final node objects."""
        result = {}
        me = merged.data
        if not self.opts.get("nobake"):
            for uv in list(me.uv_layers):
                if uv.name != "UVMap":
                    me.uv_layers.remove(uv)
        for nid, name in enumerate(self.node_names):
            bm = bmesh.new()
            bm.from_mesh(me)
            layer = bm.faces.layers.int["bo_node"]
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != nid], context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
            bm.faces.layers.int.remove(layer)
            d = bm.faces.layers.float.get("bo_den")
            if d:
                bm.faces.layers.float.remove(d)
            ch_l = bm.faces.layers.int.get("bo_chart")
            if ch_l:
                bm.faces.layers.int.remove(ch_l)
            mesh = bpy.data.meshes.new(name)
            bm.to_mesh(mesh)
            bm.free()
            for m in me.materials:
                mesh.materials.append(m)
            result[name] = mesh
        bpy.data.objects.remove(merged, do_unlink=True)
        return result

    def _nodes(self, meshes):
        """Create the contract's node hierarchy from split meshes."""
        scene = bpy.context.scene
        nodes = {}
        body = bpy.data.objects.new("body", meshes["body"])
        scene.collection.objects.link(body)
        nodes["body"] = body

        steer_obj = None
        if self.steer:
            o, rake = self.steer["origin"], self.steer["rake"]
            mount = bpy.data.objects.new("steer_axis", None)
            scene.collection.objects.link(mount)
            mount.location = o
            mount.rotation_euler = (-rake, 0, 0)
            nodes["steer_axis"] = mount
            world = Matrix.Translation(o) @ Matrix.Rotation(-rake, 4, "X")
            me = meshes["steer"]
            me.transform(world.inverted())
            steer_obj = bpy.data.objects.new("steer", me)
            scene.collection.objects.link(steer_obj)
            steer_obj.parent = mount
            nodes["steer"] = steer_obj
            self.steer_world = world

        if "crank" in meshes:
            me = meshes["crank"]
            me.transform(Matrix.Translation(-Vector(self.crank)))
            crank = bpy.data.objects.new("crank", me)
            scene.collection.objects.link(crank)
            crank.location = self.crank
            nodes["crank"] = crank

        for w in self.wheels:
            base = meshes[w["tag"]]
            base.transform(Matrix.Translation(-w["bake_c"]))
            mirrored = None
            for name, centre, mirror in w["entries"]:
                if mirror:
                    if mirrored is None:
                        mirrored = base.copy()
                        mirrored.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
                        mirrored.flip_normals()
                    data = mirrored
                else:
                    data = base
                obj = bpy.data.objects.new(name, data)
                scene.collection.objects.link(obj)
                c = Vector(centre)
                if name == "wheel_F" and steer_obj is not None:
                    obj.parent = steer_obj
                    obj.location = self.steer_world.inverted() @ c
                else:
                    obj.location = c
                nodes[name] = obj
        return nodes

    def _glass_node(self, nodes):
        if not self.glass_parts:
            return
        g = bo.join(self.glass_parts, "glass")
        g.data.name = "glass"
        for p in g.data.polygons:
            p.use_smooth = True
        mat = bo.pbr("glass", C(self.spec.get("glass_col", "#2f3d40")), 0.04, 0.0)
        bsdf = bo.bsdf_of(mat)
        bsdf.inputs["Alpha"].default_value = float(self.spec.get("glass_alpha", 0.22))
        mat.surface_render_method = "BLENDED"
        mat.blend_method = "BLEND"
        mat.use_backface_culling = False
        bo.assign(g, mat)
        nodes["glass"] = g

    def _empties(self, nodes):
        scene = bpy.context.scene
        for name, loc, parent, yaw in self.empties:
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.08
            scene.collection.objects.link(e)
            if yaw:
                e.rotation_euler = (0, 0, math.radians(yaw))
            if parent == "steer" and "steer" in nodes:
                e.parent = nodes["steer"]
                e.location = self.steer_world.inverted() @ loc
            else:
                e.location = loc
            nodes[name] = e

    def _dummy(self):
        """Mascot stand-in for checking seat fit. 1.4 m figure: hips to crown about 0.9 m."""
        skin = bo.pbr("dummy", C("#f2b01e"), 0.5)
        shirt = bo.pbr("dummy2", C("#2e6fd6"), 0.6)
        objs = []
        for name, loc, parent, yaw in self.empties:
            if not name.startswith("seat_"):
                continue
            o = Vector(loc)
            torso = bo.uv_sphere("t", 0.17, 12, 8, loc=o + Vector((0, 0, 0.16)), scale=(1.0, 0.8, 1.15))
            head = bo.uv_sphere("h", 0.3, 16, 10, loc=o + Vector((0, 0, 0.62)), scale=(1.0, 0.95, 0.93))
            thighL = tube("l", [o + Vector((0.1, 0, -0.02)), o + Vector((0.12, -0.26, -0.04)), o + Vector((0.12, -0.3, -0.34))], 0.06)
            thighR = tube("r", [o + Vector((-0.1, 0, -0.02)), o + Vector((-0.12, -0.26, -0.04)), o + Vector((-0.12, -0.3, -0.34))], 0.06)
            bo.assign(torso, shirt)
            bo.assign(head, skin)
            bo.assign(thighL, shirt)
            bo.assign(thighR, shirt)
            objs += [torso, head, thighL, thighR]
        return objs

    def finish(self):
        opts = self.opts
        nobake = opts.get("nobake")
        merged = self._merge()
        tris = {}
        me = merged.data
        me.calc_loop_triangles()
        layer = me.attributes["bo_node"].data
        for t in me.loop_triangles:
            n = self.node_names[layer[t.polygon_index].value]
            tris[n] = tris.get(n, 0) + 1
        if nobake:
            meshes = self._split(merged)
            nodes = self._nodes(meshes)
            self._glass_node(nodes)
            self._empties(nodes)
        else:
            self._atlas(merged)
            baked, src = self._bake(merged)
            baked.use_backface_culling = False
            if opts.get("atlas"):
                dump = bpy.data.images.get(f"{self.vid}_albedo")
                save_webp(dump, os.path.join(TMP_DIR, f"{self.vid}_atlas.webp"), 90)
            if self.tex_detail:
                for suffix in ("_normal", "_rough", "_metal"):
                    img = bpy.data.images.get(self.vid + suffix)
                    if img is not None:
                        shrink_image(img, self.tex_detail)
            self._bake_variants(src)
            meshes = self._split(merged)
            nodes = self._nodes(meshes)
            self._glass_node(nodes)
            self._empties(nodes)
            path = os.path.join(OUT_DIR, f"{self.vid}.glb")
            bo.export_glb(path, objects=list(nodes.values()), quality=self.quality)
            self._manifest(nodes)
        total = sum(self._node_tris(n) for n in nodes.values())
        print(f"[veh] {self.vid}: total tris {total}; merged by node {tris}")
        if opts.get("preview"):
            extra = self._dummy() if opts.get("dummy") else []
            tag = opts.get("tag") or ("draft" if nobake else "baked")
            p = self.preview
            bo.preview_render(os.path.join(TMP_DIR, f"{self.vid}_{tag}"), target=p["target"], distance=opts.get("dist") or p["distance"], angles=opts.get("views") or (-38, 142), height=opts.get("pheight") if opts.get("pheight") is not None else p["height"], size=opts.get("size") or (620, 620), samples=opts.get("samples") or 24)
            for o in extra:
                bpy.data.objects.remove(o, do_unlink=True)
            if opts.get("pvariants") and not nobake:
                self._preview_variants(nodes)

    def _preview_variants(self, nodes):
        """Swap each saved variant albedo onto the exported material and render it, so what gets
        reviewed is the same file the game loads."""
        mat = nodes["body"].data.materials[0]
        node = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name == f"{self.vid}_albedo")
        p = self.preview
        for name in self.variants:
            path = os.path.join(OUT_DIR, f"{self.vid}__{name}_albedo.webp")
            if name == "default" or not os.path.exists(path):
                continue
            node.image = bpy.data.images.load(path)
            bo.preview_render(os.path.join(TMP_DIR, f"{self.vid}_var_{name}"), target=p["target"], distance=p["distance"], angles=(-38, 142), height=p["height"], size=(420, 420), samples=16)

    @staticmethod
    def _node_tris(o):
        if o.type != "MESH":
            return 0
        o.data.calc_loop_triangles()
        return len(o.data.loop_triangles)

    def _manifest(self, nodes):
        path = os.path.join(OUT_DIR, "manifest.json")
        data = {}
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        lo = [1e9, 1e9, 1e9]
        hi = [-1e9, -1e9, -1e9]
        bpy.context.view_layer.update()
        for o in nodes.values():
            if o.type != "MESH":
                continue
            m = o.matrix_world
            for v in o.data.vertices:
                w = m @ v.co
                for i in range(3):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
        data[self.vid] = {
            "length": self.spec.get("length", round(hi[1] - lo[1], 3)),
            "width": self.spec.get("width", round(hi[0] - lo[0], 3)),
            "height": self.spec.get("height", round(hi[2] - lo[2], 3)),
            "wheelbase": self.spec["wheelbase"],
            "wheelRadius": self.spec["wheelRadius"],
            "seatPose": self.spec["seatPose"],
            "variants": list(self.variants.keys()) or ["default"],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)


def _uv_islands(faces, uv):
    """Connected UV charts among the given faces."""
    index = {f.index: i for i, f in enumerate(faces)}
    parent = list(range(len(faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in faces:
        for l in f.loops:
            other = l.link_loop_radial_next
            if other is l or other.face.index not in index:
                continue
            if (l[uv].uv - other.link_loop_next[uv].uv).length < 1e-5 and (l.link_loop_next[uv].uv - other[uv].uv).length < 1e-5:
                ra, rb = find(index[f.index]), find(index[other.face.index])
                if ra != rb:
                    parent[ra] = rb
    groups = {}
    for i, f in enumerate(faces):
        groups.setdefault(find(i), []).append(f)
    return list(groups.values())


def shrink_image(img, size):
    """Exact box filter down to size x size, in place, keeping every material link valid."""
    w, h = img.size
    if w == size and h == size:
        return
    f = w // size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    a = a[: size * f, : size * f].reshape(size, f, size, f, 4).mean(axis=(1, 3))
    img.scale(size, size)
    img.pixels.foreach_set(a.astype(np.float32).ravel())
    img.update()


def save_webp(img, path, quality=85):
    """Write an image as WEBP without changing what later steps see."""
    img.file_format = "WEBP"
    img.save(filepath=path, quality=quality, save_copy=True)


# ===========================================================================
# VEHICLES (registered below)
# ===========================================================================

VEHICLES = {}


def vehicle(fn):
    VEHICLES[fn.__name__.replace("build_", "")] = fn
    return fn


# ---------------------------------------------------------------------------
# Rickshaw folk art: original paintings, generated here, in the spirit of Dhaka's
# hand-painted rickshaw backs. Flat bright fields, bold dark outlines.
# ---------------------------------------------------------------------------

INK = "#2b0f24"


def _bez(p0, p1, p2, n=16):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def _bez3(p0, p1, p2, p3, n=20):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def _sun(cv, x, y, r, rays=20, c_ray="#ffd21f", c_disc="#ff7a1a", c_rim="#ffe36a", ray_len=2.2):
    for i in range(rays):
        a = 2 * math.pi * i / rays
        l = r * (ray_len if i % 2 == 0 else ray_len * 0.72)
        s = math.pi / rays * 0.55
        cv.poly([(x + math.cos(a - s) * r, y + math.sin(a - s) * r), (x + math.cos(a) * l, y + math.sin(a) * l), (x + math.cos(a + s) * r, y + math.sin(a + s) * r)], c_ray, outline=INK, ow=1.2)
    cv.circle(x, y, r, c_disc, outline=INK, ow=2.5)
    cv.circle(x, y, r * 0.8, c_rim, alpha=0.35)


def _art_border(cv, c_band="#e3182d", c_dot="#ffd21f", c_line="#fff3d6", c_corner="#ff2d86"):
    W, H = cv.w, cv.h
    m = int(H * 0.06)
    cv.rect(0, 0, W, m, c_band)
    cv.rect(0, H - m, W, H, c_band)
    cv.rect(0, 0, m, H, c_band)
    cv.rect(W - m, 0, W, H, c_band)
    k = m * 0.34
    for x in np.arange(m * 1.4, W - m, m * 0.95):
        cv.circle(x, m * 0.5, k * 0.62, c_dot, outline=INK, ow=1)
        cv.circle(x, H - m * 0.5, k * 0.62, c_dot, outline=INK, ow=1)
    for y in np.arange(m * 1.4, H - m, m * 0.95):
        cv.circle(m * 0.5, y, k * 0.62, c_dot, outline=INK, ow=1)
        cv.circle(W - m * 0.5, y, k * 0.62, c_dot, outline=INK, ow=1)
    cv.rect(m, m, W - m, m + 4, c_line)
    cv.rect(m, H - m - 4, W - m, H - m, c_line)
    cv.rect(m, m, m + 4, H - m, c_line)
    cv.rect(W - m - 4, m, W - m, H - m, c_line)
    for cx, cy in ((m, m), (W - m, m), (m, H - m), (W - m, H - m)):
        cv.flower(cx, cy, m * 0.98, 8, c_corner, "#ffd21f", "#00a79d", outline=INK)


def _feather(cv, x0, y0, ang, L, eye=True):
    ca, sa = math.cos(ang), math.sin(ang)
    x1, y1 = x0 + ca * L, y0 + sa * L
    cv.line(x0, y0, x1, y1, max(2.0, L * 0.016), "#14652f")
    cv.petal(x0 + ca * L * 0.32, y0 + sa * L * 0.32, L * 0.74, L * 0.24, ang, "#20a84e", outline="#0c3d1e", ow=1.2)
    if eye:
        ex, ey = x0 + ca * L * 0.84, y0 + sa * L * 0.84
        cv.ellipse(ex, ey, L * 0.135, L * 0.105, "#ffd21f", rot=ang, outline=INK, ow=1.5)
        cv.ellipse(ex, ey, L * 0.1, L * 0.075, "#00a79d", rot=ang)
        cv.ellipse(ex, ey, L * 0.062, L * 0.05, "#1a2fb0", rot=ang)
        cv.ellipse(ex + ca * L * 0.012, ey + sa * L * 0.012, L * 0.026, L * 0.024, "#0a0c30", rot=ang)


def art_peacock(W=1024, H=620):
    """Peacock with an open tail in front of a rising sun, lotus water below."""
    cv = Canvas(W, H, "#ff2d86")
    cv.vgrad(0, H * 0.74, "#e01673", "#ff9f2e")
    _sun(cv, W * 0.5, H * 0.60, H * 0.28, rays=28, ray_len=2.4)
    for cx in (W * 0.16, W * 0.84):
        cv.ellipse(cx, H * 0.22, W * 0.075, H * 0.05, "#fff3d6", outline=INK, ow=1.5)
        cv.ellipse(cx + W * 0.05, H * 0.19, W * 0.05, H * 0.04, "#fff3d6", outline=INK, ow=1.5)
    cv.rect(0, H * 0.74, W, H, "#00a79d")
    for i in range(36):
        x = (i * 137) % W
        y = H * 0.76 + (i * 53) % int(H * 0.2)
        cv.ellipse(x, y, 26, 3, "#bff5ec", alpha=0.85)
    # tail fan, outer to inner
    fx, fy = W * 0.5, H * 0.73
    for L, n, a0, a1 in ((H * 0.62, 19, 185, 355), (H * 0.48, 15, 192, 348), (H * 0.33, 11, 200, 340)):
        for i in range(n):
            a = math.radians(a0 + (a1 - a0) * i / (n - 1))
            _feather(cv, fx, fy, a, L * (1.0 if abs(math.sin(a)) > 0.3 else 0.96))
    # body
    cv.ellipse(fx, fy + H * 0.015, W * 0.058, H * 0.1, "#1433b8", outline=INK, ow=2.5)
    for i in range(5):
        for j in range(4):
            cv.ellipse(fx - W * 0.03 + i * W * 0.015, fy - H * 0.035 + j * H * 0.035, 7, 9, "#00c2b2", outline="#0a1f6e", ow=1)
    # neck, head, crest
    neck = _bez3((fx + 2, fy - H * 0.04), (fx + W * 0.012, fy - H * 0.14), (fx - W * 0.035, fy - H * 0.2), (fx - W * 0.01, fy - H * 0.31))
    cv.stroke(neck, H * 0.082, INK, width_end=H * 0.05)
    cv.stroke(neck, H * 0.07, "#1a48e0", width_end=H * 0.04)
    hx, hy = fx - W * 0.01, fy - H * 0.325
    cv.circle(hx, hy, H * 0.035, "#1a48e0", outline=INK, ow=2)
    for dx, dy in ((-0.016, -0.09), (0.0, -0.1), (0.016, -0.09)):
        ex, ey = hx + W * dx, hy + H * dy
        cv.line(hx, hy - H * 0.03, ex, ey, 2.5, INK)
        cv.circle(ex, ey, 5.5, "#ffd21f", outline=INK, ow=1.2)
    cv.poly([(hx - H * 0.032, hy - H * 0.008), (hx - H * 0.078, hy + H * 0.008), (hx - H * 0.03, hy + H * 0.018)], "#ff8a1a", outline=INK, ow=1.2)
    cv.circle(hx - H * 0.012, hy - H * 0.006, 6, "#ffffff", outline=INK, ow=1.2)
    cv.circle(hx - H * 0.014, hy - H * 0.006, 2.8, "#101010")
    # legs on a green mound
    cv.ellipse(fx, H * 0.95, W * 0.2, H * 0.06, "#2fa84f", outline="#10401f", ow=2)
    for dx in (-W * 0.022, W * 0.022):
        cv.line(fx + dx, fy + H * 0.1, fx + dx * 1.2, H * 0.915, 6, "#ff8a1a")
        cv.line(fx + dx * 1.2, H * 0.915, fx + dx * 1.2 - 16, H * 0.93, 4, "#ff8a1a")
        cv.line(fx + dx * 1.2, H * 0.915, fx + dx * 1.2 + 14, H * 0.93, 4, "#ff8a1a")
    # lotus and leaves in the corners of the water
    for side in (0, 1):
        x = W * (0.17 if side == 0 else 0.83)
        cv.ellipse(x, H * 0.885, W * 0.11, H * 0.038, "#1f8e45", outline="#0b3a1a", ow=2)
        cv.lotus(x, H * 0.865, H * 0.13)
        cv.lotus(x + (1 if side == 0 else -1) * W * 0.085, H * 0.895, H * 0.075, c1="#ffffff", c2="#ffd9ea")
    # flowering sprays in the sky corners
    for sx, ang in ((W * 0.105, 0.5), (W * 0.895, math.pi - 0.5)):
        cv.leaf_spray(sx, H * 0.34, ang, 3, H * 0.13, H * 0.05)
        cv.flower(sx, H * 0.34, H * 0.1, 7, "#ffe11f", "#ff7a1a", "#e3182d", outline=INK)
        cv.flower(sx + (W * 0.05 if sx < W / 2 else -W * 0.05), H * 0.46, H * 0.065, 6, "#ffffff", "#ff8fc0", "#ffd21f", outline=INK)
    _art_border(cv)
    cv.speckle(0.035)
    return cv


def art_river(W=1024, H=620):
    """Sun over a river: a sailing boat, palms, huts and paddy fields."""
    cv = Canvas(W, H, "#ffd21f")
    cv.vgrad(0, H * 0.56, "#00b5d8", "#ffe07a")
    _sun(cv, W * 0.68, H * 0.32, H * 0.13, rays=22, c_disc="#e8201e", c_rim="#ff9a3a", ray_len=2.1)
    for cx, cy, s in ((0.2, 0.17, 1.0), (0.36, 0.1, 0.7), (0.9, 0.14, 0.8)):
        for dx in (-1, 0, 1):
            cv.ellipse(W * cx + dx * W * 0.038 * s, H * cy - (dx == 0) * H * 0.02, W * 0.05 * s, H * 0.04 * s, "#ffffff", outline=INK, ow=1.2)
    for i, x in enumerate((0.12, 0.17, 0.22, 0.3)):
        cv.stroke(_bez((W * x, H * (0.26 + i * 0.012)), (W * (x + 0.012), H * (0.235 + i * 0.012)), (W * (x + 0.024), H * (0.26 + i * 0.012)), 8), 3, INK)
    # far bank
    bank = [(0, H * 0.56)] + [(W * t, H * (0.5 - 0.03 * math.sin(t * 7.3))) for t in np.linspace(0, 1, 18)] + [(W, H * 0.56)]
    cv.poly(bank, "#2fa84f", outline="#0f4a22", ow=2)
    for t in (0.08, 0.16, 0.42, 0.53, 0.86, 0.93):
        x = W * t
        cv.ellipse(x, H * 0.47, W * 0.03, H * 0.045, "#16823a", outline="#0b3a1a", ow=1.5)
    # huts
    for x, s in ((0.3, 1.0), (0.39, 0.8)):
        hx = W * x
        cv.rect(hx - 34 * s, H * 0.44, hx + 34 * s, H * 0.515, "#d99a4a")
        cv.rect(hx - 8 * s, H * 0.47, hx + 8 * s, H * 0.515, "#5a2f12")
        cv.poly([(hx - 50 * s, H * 0.445), (hx, H * 0.375), (hx + 50 * s, H * 0.445)], "#8a5a22", outline=INK, ow=1.5)
    # river with shimmer
    cv.vgrad(H * 0.555, H, "#0fb8ae", "#056b8f")
    for i in range(46):
        x = (i * 163) % W
        y = H * 0.58 + (i * 37) % int(H * 0.34)
        cv.ellipse(x, y, 22 + i % 22, 2.6, "#d7fff5", alpha=0.8)
    for i in range(10):
        cv.ellipse(W * 0.68 + (i % 3 - 1) * 12, H * 0.58 + i * H * 0.03, 40 - i * 2, 3.5, "#ffb13a", alpha=0.9)
    # boat
    bx, by = W * 0.42, H * 0.74
    hull = _bez((bx - 170, by - 24), (bx, by + 62), (bx + 170, by - 30), 18) + [(bx + 118, by + 26), (bx - 112, by + 30)]
    cv.poly(hull, "#7a3d14", outline=INK, ow=2.5)
    cv.stroke(_bez((bx - 160, by - 16), (bx, by + 42), (bx + 160, by - 22), 18), 6, "#ffd21f")
    cv.poly([(bx - 58, by - 2), (bx - 44, by - 46), (bx + 48, by - 46), (bx + 62, by)], "#c9792e", outline=INK, ow=2)
    cv.line(bx + 8, by - 42, bx + 8, by - 230, 6, "#3b1d08")
    cv.poly(_bez((bx + 12, by - 225), (bx + 120, by - 150), (bx + 22, by - 58), 14), "#fff3d6", outline=INK, ow=2.5)
    cv.poly([(bx + 16, by - 200), (bx + 60, by - 150), (bx + 18, by - 150)], "#ff2d86", alpha=0.85)
    cv.poly([(bx - 2, by - 200), (bx - 68, by - 72), (bx - 2, by - 66)], "#ffd21f", outline=INK, ow=2)
    # palms
    for px, py, s, lean in ((W * 0.13, H * 0.9, 1.0, 26), (W * 0.87, H * 0.88, 1.1, -30), (W * 0.21, H * 0.88, 0.7, 10)):
        top = (px + lean * s, py - H * 0.56 * s)
        trunk = _bez((px, py), (px - lean * 0.6 * s, py - H * 0.3 * s), top)
        cv.stroke(trunk, 20 * s, INK, width_end=11 * s)
        cv.stroke(trunk, 16 * s, "#8c5a2a", width_end=8 * s)
        for k in range(8):
            a = math.radians(-180 + 180 * k / 7)
            cv.petal(top[0], top[1], H * 0.24 * s, H * 0.05 * s, a + math.sin(k) * 0.1, "#1e9f46", outline="#0b3a1a", ow=1.5)
        for k in range(3):
            cv.circle(top[0] - 9 * s + k * 9 * s, top[1] + 7 * s, 7 * s, "#7a3d14", outline=INK, ow=1)
    # foreground water plants
    cv.ellipse(W * 0.5, H * 0.965, W * 0.5, H * 0.05, "#1f8e45", outline="#0b3a1a", ow=2)
    for x, s, c in ((0.3, 0.09, "#ff4f9a"), (0.62, 0.11, "#ff4f9a"), (0.74, 0.075, "#ffffff")):
        cv.lotus(W * x, H * 0.94, H * s, c1=c, c2="#ffd9ea")
    _art_border(cv, c_band="#ff2d86", c_dot="#ffffff", c_corner="#ffd21f")
    cv.speckle(0.035, seed=5)
    return cv


def art_swans(W=1024, H=620):
    """Two swans under a full moon among big flowers, on deep teal."""
    cv = Canvas(W, H, "#06486b")
    cv.vgrad(0, H * 0.72, "#2a0d6e", "#00a79d")
    cv.circle(W * 0.5, H * 0.33, H * 0.23, "#fff0b0", outline="#ffd21f", ow=6)
    cv.circle(W * 0.5, H * 0.33, H * 0.17, "#ffe36a", alpha=0.5)
    for i in range(30):
        x, y = (i * 211) % W, (i * 89) % int(H * 0.5)
        cv.circle(x, y, 2 + i % 3, "#ffffff", alpha=0.85)
    cv.rect(0, H * 0.7, W, H, "#0fb8ae")
    for i in range(30):
        x = (i * 149) % W
        y = H * 0.73 + (i * 41) % int(H * 0.2)
        cv.ellipse(x, y, 24, 2.8, "#d7fff5", alpha=0.8)
    for side in (-1, 1):
        cx = W * 0.5 + side * W * 0.15
        body = _bez3((cx + side * W * 0.1, H * 0.74), (cx + side * W * 0.05, H * 0.56), (cx - side * W * 0.09, H * 0.56), (cx - side * W * 0.12, H * 0.76), 14)
        tail = [(cx - side * W * 0.12, H * 0.76), (cx + side * W * 0.0, H * 0.82), (cx + side * W * 0.1, H * 0.74)]
        cv.poly(body + tail[1:2], "#ffffff", outline=INK, ow=2.5)
        cv.petal(cx + side * W * 0.075, H * 0.72, W * 0.16, H * 0.1, math.pi if side > 0 else 0.0, "#e9f3ff", outline=INK, ow=1.8)
        neck = _bez3((cx + side * W * 0.095, H * 0.70), (cx + side * W * 0.17, H * 0.55), (cx - side * W * 0.05, H * 0.46), (cx - side * W * 0.03, H * 0.34), 18)
        neck = [(p[0], p[1]) for p in neck]
        cv.stroke(neck, 30, INK, width_end=19)
        cv.stroke(neck, 25, "#ffffff", width_end=14)
        hx, hy = neck[-1]
        cv.ellipse(hx - side * 10, hy - 6, 24, 18, "#ffffff", outline=INK, ow=2)
        cv.poly([(hx - side * 28, hy - 12), (hx - side * 62, hy + 2), (hx - side * 28, hy + 6)], "#ff8a1a", outline=INK, ow=1.5)
        cv.circle(hx - side * 16, hy - 10, 4, "#101010")
    # heart medallion between the beaks
    cv.circle(W * 0.5 - 13, H * 0.3, 15, "#e3182d", outline=INK, ow=1.5)
    cv.circle(W * 0.5 + 13, H * 0.3, 15, "#e3182d", outline=INK, ow=1.5)
    cv.poly([(W * 0.5 - 27, H * 0.31), (W * 0.5, H * 0.38), (W * 0.5 + 27, H * 0.31), (W * 0.5, H * 0.29)], "#e3182d")
    # flower banks
    for side in (0, 1):
        x = W * (0.13 if side == 0 else 0.87)
        cv.leaf_spray(x, H * 0.5, -math.pi / 2, 5, H * 0.3, H * 0.09, spread=0.46)
        cv.flower(x, H * 0.42, H * 0.12, 8, "#ff2d86", "#ffd21f", "#e3182d", outline=INK)
        cv.flower(x + (1 if side == 0 else -1) * W * 0.055, H * 0.6, H * 0.09, 7, "#ffd21f", "#ff7a1a", "#e3182d", outline=INK)
        cv.flower(x - (1 if side == 0 else -1) * W * 0.03, H * 0.25, H * 0.07, 6, "#ffffff", "#ff8fc0", "#ffd21f", outline=INK)
    cv.ellipse(W * 0.5, H * 0.96, W * 0.52, H * 0.055, "#1f8e45", outline="#0b3a1a", ow=2)
    for x, s, c in ((0.08, 0.09, "#ff4f9a"), (0.3, 0.1, "#ffffff"), (0.5, 0.13, "#ff4f9a"), (0.7, 0.1, "#ffffff"), (0.92, 0.09, "#ff4f9a")):
        cv.lotus(W * x, H * 0.945, H * s, c1=c, c2="#ffd9ea")
    _art_border(cv, c_band="#00a79d", c_dot="#ffd21f", c_corner="#ff2d86")
    cv.speckle(0.035, seed=8)
    return cv


HOOD_SCHEMES = {
    "default": [("#e3182d", "#ffd21f"), ("#ff2d86", "#ffd21f"), ("#00a79d", "#ff7a1a"), ("#ffd21f", "#e3182d"), ("#1a48e0", "#ffffff"), ("#ff2d86", "#00a79d"), ("#e3182d", "#ffd21f")],
    "art2": [("#00a79d", "#ffd21f"), ("#ff7a1a", "#ffffff"), ("#1a48e0", "#ffd21f"), ("#ff2d86", "#ffffff"), ("#27a844", "#ffd21f"), ("#ffd21f", "#e3182d"), ("#00a79d", "#ff2d86")],
    "art3": [("#4b1fa8", "#ffd21f"), ("#ffd21f", "#4b1fa8"), ("#ff2d86", "#ffffff"), ("#00a79d", "#ffd21f"), ("#e3182d", "#ffd21f"), ("#27a844", "#ffffff"), ("#4b1fa8", "#ff7a1a")],
}


def hood_canvas(scheme="default", W=1024, H=1024):
    """Quilted canopy cloth. u runs across the arch; v runs front to rear (canvas y = (1 - v) * H)."""
    cv = Canvas(W, H, "#e3182d")
    bands = HOOD_SCHEMES[scheme]
    n = len(bands)
    for k, (c1, c2) in enumerate(bands):
        y1 = H * (1 - k / n)
        y0 = H * (1 - (k + 1) / n)
        cv.rect(0, y0, W, y1, c1)
        ym = (y0 + y1) / 2
        bh = y1 - y0
        count = 7 if k % 2 == 0 else 8
        for i in range(count):
            x = W * (i + 0.5) / count
            kind = (k + i) % 3
            if kind == 0:
                cv.flower(x, ym, bh * 0.36, 8, c2, "#ffffff", c1, outline=INK)
            elif kind == 1:
                d = bh * 0.38
                cv.poly([(x - d, ym), (x, ym - d), (x + d, ym), (x, ym + d)], c2, outline=INK, ow=2)
                cv.poly([(x - d * 0.55, ym), (x, ym - d * 0.55), (x + d * 0.55, ym), (x, ym + d * 0.55)], c1)
                cv.circle(x, ym, d * 0.22, "#ffffff", outline=INK, ow=1.2)
            else:
                pts = []
                for j in range(16):
                    a = math.pi * 2 * j / 16 - math.pi / 2
                    r = bh * (0.4 if j % 2 == 0 else 0.2)
                    pts.append((x + math.cos(a) * r, ym + math.sin(a) * r))
                cv.poly(pts, c2, outline=INK, ow=2)
                cv.circle(x, ym, bh * 0.1, c1, outline=INK, ow=1)
            xm = W * (i + 1) / count
            if i < count - 1:
                cv.circle(xm, ym - bh * 0.3, 6, "#fff3d6", outline=INK, ow=1)
                cv.circle(xm, ym + bh * 0.3, 6, "#fff3d6", outline=INK, ow=1)
        # gold piping between bands, with stitches
        cv.rect(0, y0 - 5, W, y0 + 5, "#f6c21c", h=None)
        for x in np.arange(0, W, 22):
            cv.rect(x, y0 - 1.5, x + 12, y0 + 1.5, INK, alpha=0.7)
    # quilting height: pillow per band and vertical tuck lines
    yy, xx = np.mgrid[0:H, 0:W]
    v = (yy + 0.5) / H * n
    puff = np.abs(np.sin(v * math.pi)) ** 0.55
    tucks = np.abs(np.sin((xx + 0.5) / W * math.pi * 7.5)) ** 0.28
    cv.height = (puff * (0.55 + 0.45 * tucks)).astype(np.float32)
    cv.c *= (0.72 + 0.28 * (puff * (0.65 + 0.35 * tucks)))[..., None]
    cv.speckle(0.05, seed=11)
    return cv


def valance_canvas(c1="#ff2d86", c2="#ffd21f", c3="#00a79d", W=1024, H=160):
    cv = Canvas(W, H, c1)
    cv.rect(0, 0, W, 26, c2)
    for x in np.arange(0, W, 34):
        cv.circle(x + 17, 13, 7, "#e3182d", outline=INK, ow=1)
    for i in range(9):
        x = W * (i + 0.5) / 9
        if i % 2 == 0:
            cv.flower(x, H * 0.58, H * 0.3, 7, c2, "#ffffff", "#e3182d", outline=INK)
        else:
            d = H * 0.3
            cv.poly([(x - d, H * 0.58), (x, H * 0.58 - d), (x + d, H * 0.58), (x, H * 0.58 + d)], c3, outline=INK, ow=2)
            cv.circle(x, H * 0.58, d * 0.34, c2, outline=INK, ow=1)
    cv.speckle(0.05, seed=2)
    return cv


def side_panel_canvas(W=512, H=380, c1="#ff2d86", c2="#00a79d"):
    """Side sheet: bright metal field (alpha = metallic) with a painted flower band and pressed stars."""
    cv = Canvas(W, H, "#dfe2e6")
    cv.alpha[:] = 1.0
    # pressed rosettes
    for j in range(5):
        for i in range(7):
            x = W * (i + 0.5) / 7
            y = H * (j + 0.5) / 5
            cv.ring(x, y, 19, 3, "#a8abb0")
            cv.circle(x, y, 7, "#c5c8cc")
    yy, xx = np.mgrid[0:H, 0:W]
    fx = ((xx + 0.5) / W * 7) % 1 - 0.5
    fy = ((yy + 0.5) / H * 5) % 1 - 0.5
    d = np.hypot(fx * W / 7, fy * H / 5)
    cv.height = np.clip(1 - np.abs(d - 19) / 6, 0, 1).astype(np.float32) * 0.6 + np.clip(1 - d / 9, 0, 1).astype(np.float32) * 0.6
    # painted band
    y0, y1 = H * 0.36, H * 0.70
    cv.rect(0, y0, W, y1, c1, a=0.0)
    cv.rect(0, y0 - 9, W, y0, "#ffd21f", a=0.0)
    cv.rect(0, y1, W, y1 + 9, "#ffd21f", a=0.0)
    for i in range(5):
        x = W * (i + 0.5) / 5
        cv.leaf_spray(x, (y0 + y1) / 2, 0, 1, 56, 24)
        cv.leaf_spray(x, (y0 + y1) / 2, math.pi, 1, 56, 24)
        cv.flower(x, (y0 + y1) / 2, (y1 - y0) * 0.36, 7, "#ffd21f" if i % 2 else c2, "#ffffff", "#e3182d", outline=INK)
    cv.height[int(y0 - 9) : int(y1 + 9), :] = 0.15
    return cv


def front_panel_canvas(W=720, H=240):
    cv = Canvas(W, H, "#00a79d")
    cv.rect(0, 0, W, 16, "#ffd21f")
    cv.rect(0, H - 16, W, H, "#ffd21f")
    cv.rect(0, 16, W, 22, INK)
    cv.rect(0, H - 22, W, H - 16, INK)
    cv.leaf_spray(W * 0.5, H * 0.5, 0, 3, H * 0.62, H * 0.2, spread=0.4)
    cv.leaf_spray(W * 0.5, H * 0.5, math.pi, 3, H * 0.62, H * 0.2, spread=0.4)
    cv.flower(W * 0.5, H * 0.5, H * 0.33, 9, "#ff2d86", "#ffd21f", "#e3182d", outline=INK)
    for x, c in ((0.16, "#ffd21f"), (0.84, "#ffd21f"), (0.3, "#ffffff"), (0.7, "#ffffff")):
        cv.flower(W * x, H * 0.5, H * 0.24, 7, c, "#ff2d86", "#e3182d", outline=INK)
    cv.speckle(0.04, seed=4)
    return cv


def gear(name, r, teeth, thick, center, tooth=0.006):
    """Sprocket: toothed disc in the YZ plane."""
    outline = []
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        s = math.pi / teeth
        outline.append((math.cos(a - s * 0.45) * (r + tooth), math.sin(a - s * 0.45) * (r + tooth)))
        outline.append((math.cos(a + s * 0.45) * (r + tooth), math.sin(a + s * 0.45) * (r + tooth)))
        outline.append((math.cos(a + s) * (r - tooth * 0.3), math.sin(a + s) * (r - tooth * 0.3)))
    return plate(name, outline, thick, origin=center, u=(0, 1, 0), v=(0, 0, 1))


def tassel(b, p, length, mat_cord, mat_tuft, node="body"):
    """Hanging tassel: cord plus a small cone tuft."""
    p = Vector(p)
    b.add(tube("tc", [p, p + Vector((0, 0, -length * 0.45))], 0.0022, seg=3, caps=False), mat_cord, node, den=0)
    b.add(lathe("tt", [(-length * 0.45, 0.0), (-length * 0.45, 0.006), (-length * 0.55, 0.008), (-length, 0.012), (-length, 0.0)], 5, p, axis="z"), mat_tuft, node, den=0)


def saddle_mesh(name, y0, y1, z, wide=0.125):
    """Sprung leather saddle, loft along Y."""
    span = y1 - y0
    keys = [(0.0, 0.028, 0.018, -0.006), (0.25, 0.032, 0.022, 0.0), (0.5, 0.062, 0.03, 0.002), (0.75, wide * 0.95, 0.036, 0.004), (0.95, wide, 0.034, 0.006), (1.0, wide * 0.9, 0.022, 0.006)]
    rings = [dict(c=(0, y0 + span * t, z + dz), rx=rx, ry=ry, axis="y", power=2.6) for t, rx, ry, dz in keys]
    return bo.loft(name, rings, segments=14)


@vehicle
def build_rickshaw(b):
    R = 0.335
    fy, ry, rx = -0.915, 0.60, 0.505
    rake = 20.0
    tan_r = math.tan(math.radians(rake))
    b.spec = dict(wheelbase=round(ry - fy, 3), wheelRadius=R, seatPose="pedal_rickshaw")
    b.preview = dict(target=(0, 0.0, 0.92), distance=6.6, height=1.1)
    b.tex = 1024
    b.ao_distance = 0.4

    def A(z):
        return Vector((0, fy + 0.05 + (z - R) * tan_r, z))

    frame = paint("frame", "#d9a214", rough=0.34, dust=0.3, chips=0.35, scratch=0.25, slot="frame", chip_col="#5b4318")
    accent = paint("accent", "#d9142b", rough=0.36, dust=0.3, chips=0.3, scratch=0.3, slot="accent")
    gold = paint("gold", "#f4c21a", rough=0.3, dust=0.2, chips=0.3, scratch=0.15, slot="trim", chip_col="#6b4b16")
    ch = b.mat("chrome", lambda: chrome())
    st = b.mat("steel", lambda: steel())
    blk = paint("blk", "#1b1b1c", rough=0.5, dust=0.35, chips=0.25, scratch=0.2, chip_col="#5a5a5a")
    rub = b.mat("rubber", lambda: rubber())
    leather = vinyl("leather", "#3a2416", rough=0.5, dust=0.15)

    # ---- steering: fork, mudguard, stem, bars. Rotates about the raked head tube axis.
    b.set_steer(A(0.85), rake)
    crown = A(0.752)
    b.tube([crown + Vector((-0.05, 0, 0)), crown + Vector((0.05, 0, 0))], 0.017, frame, "steer", seg=8)
    b.tube([crown, A(1.03)], 0.0125, ch, "steer", seg=8)

    def fork(s):
        pts = curve([crown + Vector((s * 0.048, 0, 0)), (s * 0.052, fy + 0.035, 0.56), (s * 0.058, fy + 0.012, 0.42), (s * 0.06, fy, R)], 3)
        n = len(pts)
        b.tube(pts, 0.012, frame, "steer", seg=7, rs=[0.0145 - 0.0055 * i / (n - 1) for i in range(n)])
        b.add(rbox("drop", (0.006, 0.03, 0.03), (s * 0.06, fy, R), r=0.003, seg=1), st, "steer")

    b.both(fork)
    b.add(fender("fg", (0, fy, R), R + 0.022, 0.062, 8, 172, n=16), accent, "steer", den=1.0)
    b.add(fender("fg2", (0, fy, R), R + 0.0235, 0.012, 62, 172, n=9), gold, "steer", den=0.5)
    b.both(lambda s: b.tube([(s * 0.06, fy, R), (s * 0.034, fy + 0.31, R + 0.17)], 0.0035, st, "steer", seg=4, den=0))
    b.both(lambda s: b.tube([(s * 0.06, fy, R), (s * 0.034, fy - 0.29, R + 0.19)], 0.0035, st, "steer", seg=4, den=0))
    stem_top = A(1.03) + Vector((0, 0, 0.035))
    clamp = stem_top + Vector((0, -0.075, 0.035))
    b.tube([A(1.0), stem_top, clamp], 0.0125, ch, "steer", seg=8)
    bar = curve([(0.30, clamp.y + 0.24, clamp.z + 0.075), (0.235, clamp.y + 0.20, clamp.z + 0.07), (0.12, clamp.y + 0.075, clamp.z + 0.03), (0.04, clamp.y + 0.005, clamp.z), (-0.04, clamp.y + 0.005, clamp.z), (-0.12, clamp.y + 0.075, clamp.z + 0.03), (-0.235, clamp.y + 0.20, clamp.z + 0.07), (-0.30, clamp.y + 0.24, clamp.z + 0.075)], 4)
    b.tube(bar, 0.0115, ch, "steer", seg=8)

    def grip(s):
        g0 = Vector((s * 0.20, clamp.y + 0.165, clamp.z + 0.063))
        g1 = Vector((s * 0.305, clamp.y + 0.243, clamp.z + 0.076))
        b.tube([g0, g1], 0.017, rub, "steer", seg=8)
        b.add(lathe("gflange", [(-0.003, 0.0), (-0.003, 0.021), (0.003, 0.021), (0.003, 0.0)], 8, g0, axis="x"), accent, "steer", den=0.4)
        b.empty("grip_L" if s > 0 else "grip_R", (g0 + g1) / 2, parent="steer")

    b.both(grip)
    # bell on the rider's left
    bp = Vector((0.13, clamp.y + 0.08, clamp.z + 0.052))
    b.tube([bp + Vector((0, 0, -0.02)), bp], 0.004, st, "steer", seg=5, den=0.5)
    b.add(lathe("bell", [(0.0, 0.031), (0.004, 0.031), (0.016, 0.026), (0.03, 0.014), (0.036, 0.0)], 14, bp, axis="z"), ch, "steer")
    b.add(rbox("thumb", (0.03, 0.008, 0.005), bp + Vector((0.03, -0.02, 0.0)), r=0.0018, seg=1), st, "steer", den=0.4)
    # head lamp on the crown
    lp = crown + Vector((0, -0.08, 0.03))
    b.tube([crown, lp], 0.006, st, "steer", seg=5)
    b.add(lathe("lamp", [(0.055, 0.0), (0.04, 0.032), (0.0, 0.047), (-0.02, 0.05), (-0.032, 0.049)], 14, lp, axis="y"), ch, "steer")
    b.add(lathe("lamp_lens", [(-0.033, 0.046), (-0.038, 0.03), (-0.04, 0.0)], 14, lp, axis="y"), bo.pbr("lamp_lens", C("#fff3c4"), 0.08), "steer")
    b.empty("light_FL", lp + Vector((0.02, -0.04, 0)))
    b.empty("light_FR", lp + Vector((-0.02, -0.04, 0)))
    # decorative tassels on the bars
    tm = fabric("tuft_pink", "#ff2d86", dust=0.05)
    tm2 = fabric("tuft_yel", "#ffd21f", dust=0.05)
    for i, x in enumerate((-0.12, -0.08, -0.04, 0.0, 0.04, 0.08, 0.12)):
        tassel(b, (x, clamp.y + 0.02 + abs(x) * 0.4, clamp.z - 0.01), 0.1, st, tm if i % 2 else tm2, "steer")
    b.empty("plate_F", A(0.86) + Vector((0, -0.08, 0)))

    # ---- frame
    BB = Vector((0, -0.30, 0.47))
    head_top, head_bot = A(0.945), A(0.775)
    b.tube([head_bot, head_top], 0.022, frame, seg=10)
    b.add(lathe("hr1", [(-0.006, 0.0255), (0.006, 0.0255)], 10, head_top, axis="z"), ch, den=0.3)
    b.add(lathe("hr2", [(-0.006, 0.0255), (0.006, 0.0255)], 10, head_bot, axis="z"), ch, den=0.3)
    seat_lug = Vector((0, -0.135, 0.845))
    b.tube([A(0.92), seat_lug], 0.0165, frame)
    b.tube([A(0.875), seat_lug + Vector((0, 0.0, -0.075))], 0.0145, frame)
    b.tube([A(0.81), BB], 0.0185, frame)
    b.tube([BB, seat_lug + Vector((0, 0.003, 0.02))], 0.0165, frame)
    b.tube([seat_lug, seat_lug + Vector((0, 0.012, 0.055))], 0.0115, ch, seg=8)
    b.add(lathe("bb", [(-0.042, 0.0), (-0.042, 0.022), (-0.034, 0.026), (0.034, 0.026), (0.042, 0.022), (0.042, 0.0)], 12, BB), frame)

    # rails from the bottom bracket out to the passenger box
    def rails(s):
        b.tube(curve([BB + Vector((s * 0.02, 0.01, 0)), (s * 0.13, -0.12, 0.47), (s * 0.3, 0.05, 0.495), (s * 0.385, 0.2, 0.505), (s * 0.385, 0.6, 0.505), (s * 0.385, 0.8, 0.505)], 3), 0.015, frame, seg=8)
        b.tube(curve([seat_lug + Vector((0, 0.005, -0.09)), (s * 0.16, -0.03, 0.74), (s * 0.33, 0.07, 0.735), (s * 0.405, 0.16, 0.76)], 3), 0.013, frame, seg=8)
        b.tube([(s * 0.405, 0.16, 0.76), (s * 0.385, 0.16, 0.505)], 0.013, frame, seg=8)

    b.both(rails)
    for y in (0.16, 0.62, 0.8):
        b.tube([(-0.39, y, 0.505), (0.39, y, 0.505)], 0.012, frame, seg=7, den=0.6)
    # rear axle, hangers and leaf springs
    b.tube([(-0.535, ry, R), (0.535, ry, R)], 0.0125, st, seg=8)

    def springs(s):
        x = s * 0.385
        for k, (half, lift) in enumerate(((0.235, 0.0), (0.17, -0.008), (0.1, -0.016))):
            path = []
            for i in range(7):
                t = -1 + 2 * i / 6
                y = ry + t * half
                z = R + 0.038 + lift + 0.125 * (t * half / 0.235) ** 2
                path.append((x, y, z))
            b.add(sweep("leaf", path, [(-0.018, -0.003), (0.018, -0.003), (0.018, 0.003), (-0.018, 0.003)], up=(0, 0, 1)), st, den=0.5)
        b.add(rbox("ubolt", (0.05, 0.06, 0.05), (x, ry, R + 0.012), r=0.006, seg=1), st, den=0.5)
        b.tube([(x, ry - 0.235, R + 0.163), (x, ry - 0.235, 0.505)], 0.008, st, seg=5, den=0.4)
        b.tube([(x, ry + 0.235, R + 0.163), (x, ry + 0.235, 0.505)], 0.008, st, seg=5, den=0.4)

    b.both(springs)

    # rear guards
    def guards(s):
        c = (s * rx, ry, R)
        b.add(fender("rg", c, R + 0.024, 0.07, 14, 158, n=18), accent, den=1.0)
        b.add(fender("rg2", c, R + 0.0255, 0.014, 14, 158, n=12), gold, den=0.5)
        b.tube([(s * (rx - 0.03), ry, R), (s * (rx - 0.033), ry + 0.3, R + 0.16)], 0.0035, st, seg=4, den=0)
        b.tube([(s * (rx - 0.03), ry, R), (s * (rx - 0.033), ry - 0.32, R + 0.1)], 0.0035, st, seg=4, den=0)
        b.tube([(s * (rx - 0.035), ry, R + 0.36), (s * 0.43, ry, 0.74)], 0.006, st, seg=5, den=0.3)

    b.both(guards)

    # ---- drive: sprockets, cranks (own node so they can turn with pedalling) and chain
    chain_x = 0.058
    b.crank = BB
    b.add(gear("ring", 0.098, 30, 0.004, BB + Vector((chain_x, 0, 0))), blk, "crank", den=0.8)
    b.add(lathe("spider", [(chain_x - 0.004, 0.0), (chain_x - 0.004, 0.05), (chain_x + 0.006, 0.05), (chain_x + 0.006, 0.0)], 12, BB), ch, "crank", den=0.5)

    def crank(s):
        ang = math.radians(35 if s > 0 else 215)
        tip = BB + Vector((s * 0.095, math.cos(ang) * 0.15, math.sin(ang) * 0.15))
        b.tube([BB + Vector((s * 0.05, 0, 0)), tip], 0.011, ch, "crank", seg=6, rs=[0.014, 0.0095])
        ped = tip + Vector((s * 0.06, 0, 0))
        b.tube([tip, ped + Vector((s * 0.05, 0, 0))], 0.006, st, "crank", seg=5, den=0.3)
        b.add(rbox("ped", (0.09, 0.05, 0.018), ped, r=0.005, seg=1), rub, "crank", den=0.6)

    b.both(crank)
    rear_sp = Vector((chain_x, ry, R))
    b.add(gear("sprk", 0.052, 18, 0.004, rear_sp), blk, den=0.5)
    b.add(lathe("freewheel", [(-0.012, 0.0), (-0.012, 0.03), (0.012, 0.03), (0.012, 0.0)], 12, rear_sp), st, den=0.4)
    chain_m = bo.pbr("chain", C("#3a3a3c"), 0.5, 0.8)
    gg = G(chain_m)
    links = gg.math("SINE", gg.mul(gg.uvw[1], 500.0))
    gg.bump(links, 0.8, 0.003)
    for z0, z1 in ((0.47 + 0.1, R + 0.054), (0.47 - 0.1, R - 0.054)):
        b.add(sweep("chain", [(chain_x, BB.y, z0), (chain_x, ry, z1)], [(-0.0045, -0.005), (0.0045, -0.005), (0.0045, 0.005), (-0.0045, 0.005)], up=(0, 0, 1)), chain_m, den=0.4)

    # ---- saddle
    sad_y0, sad_y1 = -0.30, -0.05
    sad_z = 0.90
    b.add(saddle_mesh("saddle", sad_y0, sad_y1, sad_z), leather)
    for s in (1, -1):
        b.add(spring_coil("coil", (s * 0.062, -0.085, sad_z - 0.085), 0.075, 0.016, turns=4), ch, den=0)
        b.tube([(s * 0.062, -0.085, sad_z - 0.09), (s * 0.02, -0.12, sad_z - 0.1), (s * 0.012, -0.12, sad_z - 0.1)], 0.005, ch, seg=5, den=0.3)
    b.tube([(0.03, sad_y0 + 0.02, sad_z - 0.024), (0.015, -0.13, sad_z - 0.085), (-0.015, -0.13, sad_z - 0.085), (-0.03, sad_y0 + 0.02, sad_z - 0.024)], 0.004, ch, seg=5, den=0.3)
    b.empty("seat_driver", (0, -0.165, sad_z + 0.045))
    b.empty("exit_L", (0.62, -0.165, 0))
    b.empty("exit_R", (-0.62, -0.165, 0))

    # ---- foot board
    foot = paint("foot", "#0e8a78", rough=0.5, dust=0.6, chips=0.5, scratch=0.5, edge=1.0, chip_col="#4a3a2a", grime=0.5, slot="foot")
    fo = [(-0.1, -0.13), (0.1, -0.13), (0.355, 0.16), (-0.355, 0.16)]
    b.add(plate("fb", fo, 0.012, origin=(0, 0, 0.525), u=(1, 0, 0), v=(0, 1, 0), bevel=0.003), foot, den=1.1)
    for y, hw in ((-0.05, 0.13), (0.02, 0.2), (0.09, 0.27)):
        b.add(rbox("rib", (hw * 2, 0.016, 0.006), (0, y, 0.534), r=0.002, seg=1), rub, den=0.6)
    for s in (1, -1):
        b.tube([(s * 0.1, -0.13, 0.535), (s * 0.355, 0.16, 0.535)], 0.0065, ch, seg=6, den=0.5)

    # ---- passenger box
    fp_cv = front_panel_canvas()
    fp_img = fp_cv.to_image("front_panel")
    fp_mat = painted("front_panel", fp_img, rough=0.42, vec=lambda g: g.project("y", -0.41, 0.41, 0.52, 0.76), dust=0.25, wear=0.25)
    b.add(plate("fpanel", rrect(0.82, 0.24, 0.012), 0.01, origin=(0, 0.165, 0.64), u=(1, 0, 0), v=(0, 0, 1), bevel=0.002), fp_mat, den=1.6)
    sheet = paint("sheet", "#c8cacd", rough=0.32, metal=0.9, dust=0.3, chips=0.2, scratch=0.3, chip_col="#5b4a3a")
    b.add(rbox("pan", (0.86, 0.66, 0.018), (0, 0.49, 0.52), r=0.004, seg=1), st, den=0.5)
    b.add(rbox("deck", (0.88, 0.56, 0.02), (0, 0.44, 0.775), r=0.006, seg=1), sheet, den=0.5)

    side_cv = side_panel_canvas()
    side_img = side_cv.to_image("side_panel")
    side_h = side_cv.height_image("side_panel_h")
    side_m = side_cv.to_image("side_panel_m", data=side_cv.alpha, non_color=True)
    side_out = [(0.10, 0.52), (0.82, 0.52), (0.82, 1.04), (0.77, 1.10), (0.62, 1.03), (0.42, 0.93), (0.25, 0.87), (0.14, 0.84), (0.10, 0.79)]

    def side(s):
        x = s * 0.435
        m = painted(f"side_panel_{s}", side_img, rough=0.2, vec=lambda g: g.project("x", 0.10, 0.82, 0.52, 1.09, flip_u=s < 0), bump_img=side_h, bump_strength=0.5, metal_img=side_m, dust=0.15, wear=0.08, wear_col="#6b5a48")
        b.add(plate("sp", side_out, 0.008, origin=(x, 0, 0), u=(0, 1, 0), v=(0, 0, 1), bevel=0.002), m, den=1.5)
        rim = curve([(x + s * 0.006, 0.10, 0.80), (x + s * 0.006, 0.14, 0.845), (x + s * 0.006, 0.25, 0.875), (x + s * 0.006, 0.42, 0.935), (x + s * 0.006, 0.62, 1.035), (x + s * 0.006, 0.76, 1.095)], 3)
        b.tube(rim, 0.0115, ch, seg=7)
        b.tube([(x, 0.10, 0.52), (x, 0.10, 0.80)], 0.009, gold, seg=6, den=0.4)
        b.add(lathe("pivot", [(-0.012, 0.0), (-0.012, 0.03), (0.012, 0.028), (0.016, 0.0)], 10, (x + s * 0.01, 0.72, 1.04)), ch, den=0.5)

    b.both(side)

    # seat and back cushions
    seat_m = quilted("seat", "#d0142c", plane="xy", k=30.0, slot="seat")
    back_m = quilted("seatback", "#d0142c", plane="xz", k=30.0, slot="seat")
    b.add(rbox("seat", (0.82, 0.54, 0.105), (0, 0.42, 0.83), rot=(math.radians(-3), 0, 0), r=0.04, seg=3), seat_m, den=1.2)
    b.add(rbox("back", (0.80, 0.10, 0.42), (0, 0.705, 1.09), rot=(math.radians(14), 0, 0), r=0.04, seg=3), back_m, den=1.2)
    b.tube(curve([(-0.40, 0.16, 0.88), (0.40, 0.16, 0.88)], 1), 0.009, gold, seg=6, den=0.4)
    b.add(rbox("backwall", (0.86, 0.02, 0.5), (0, 0.775, 1.03), rot=(math.radians(10), 0, 0), r=0.004, seg=1), sheet, den=0.4)
    b.add(rbox("lid", (0.86, 0.1, 0.012), (0, 0.8, 1.0), r=0.003, seg=1), gold, den=0.4)
    b.empty("seat_p1", (0.215, 0.50, 0.90))
    b.empty("seat_p2", (-0.215, 0.50, 0.90))

    # ---- painted back panel: the signature of the Dhaka rickshaw
    x_half, z0, z1 = 0.42, 0.53, 1.0
    art_cv = art_peacock()
    art_img = art_cv.to_image("art_back")
    art_mat = painted("art_back", art_img, rough=0.38, vec=lambda g: g.project("y", x_half, -x_half, z0, z1), dust=0.1, wear=0.05, wear_col="#5c4a3a")
    b.add(plate("artp", rrect(x_half * 2, z1 - z0, 0.02), 0.008, origin=(0, 0.84, (z0 + z1) / 2), u=(-1, 0, 0), v=(0, 0, 1), bevel=0.0015), art_mat, den=5.0)
    frame_pts = [Vector((p[0], 0.846, (z0 + z1) / 2 + p[1])) for p in rrect(x_half * 2 + 0.01, z1 - z0 + 0.01, 0.02, n=2)]
    b.tube(frame_pts, 0.007, gold, seg=6, closed=True, den=0.5)
    b.add(rbox("artback", (x_half * 2, 0.012, z1 - z0), (0, 0.832, (z0 + z1) / 2), r=0.002, seg=1), st, den=0.3)
    for s in (1, -1):
        b.tube([(s * 0.385, 0.8, 0.505), (s * 0.385, 0.83, 0.56)], 0.008, st, seg=5, den=0.3)
        b.tube([(s * 0.40, 0.76, 1.0), (s * 0.40, 0.83, 0.98)], 0.007, st, seg=5, den=0.3)
    # reflectors and the rear plate bracket
    red = lens_red("reflector_red")
    for s in (1, -1):
        p = (s * 0.30, 0.852, 0.50)
        b.add(lathe("refl", [(-0.006, 0.0), (-0.006, 0.034), (0.004, 0.034), (0.008, 0.02), (0.009, 0.0)], 12, p, axis="y"), red, den=0.8)
        b.empty("light_RL" if s > 0 else "light_RR", p)
    b.empty("plate_R", (0, 0.856, 0.46))
    b.add(rbox("platebkt", (0.34, 0.006, 0.17), (0, 0.848, 0.46), r=0.002, seg=1), blk, den=0.3)

    # ---- hood: fan of bows from a pivot on each side of the seat
    py, pz, base_w, top_w = 0.72, 1.04, 0.435, 0.468
    keys_phi = [-31.0, -10.0, 13.0, 41.0, 72.0]
    keys_rho = [0.875, 0.875, 0.80, 0.64, 0.45]

    def interp(keys, s):
        f = s * (len(keys) - 1)
        i = min(int(f), len(keys) - 2)
        t = f - i
        p0 = keys[max(i - 1, 0)]
        p1, p2 = keys[i], keys[i + 1]
        p3 = keys[min(i + 2, len(keys) - 1)]
        return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)

    def hood_pt(s, t, inset=0.0):
        phi = math.radians(interp(keys_phi, s))
        rho = interp(keys_rho, s)
        f = s * (len(keys_phi) - 1)
        sag = 1.0 - 0.035 * math.sin(math.pi * (f % 1.0)) ** 2
        a = math.pi * t
        ca, sa = math.cos(a), math.sin(a)
        e = 0.52
        w = base_w + (top_w - base_w) * sa
        x = -math.copysign(abs(ca) ** e, ca) * w
        r = (sa ** e) * rho * sag - inset
        return Vector((x * (1 - inset * 1.1), py + max(r, 0) * math.sin(phi), pz + max(r, 0) * math.cos(phi)))

    N_s, N_t = 28, 26
    rows = [[hood_pt(i / N_s, j / N_t) for j in range(N_t + 1)] for i in range(N_s + 1)]
    h_cv = hood_canvas("default")
    h_img = h_cv.to_image("hood_art")
    h_bump = h_cv.height_image("hood_h")
    hood_mat = painted("hood", h_img, rough=0.78, bump_img=h_bump, bump_strength=0.9, dust=0.18)
    b.add(orient_out(grid("hood", rows, uv=True), (0, py, pz)), hood_mat, den=1.7)
    lining = fabric("lining", "#b3173f", weave=120.0, slot="lining", dust=0.05)
    N2s, N2t = 14, 16
    rows2 = [[hood_pt(i / N2s, j / N2t, inset=0.012) for j in range(N2t + 1)] for i in range(N2s + 1)]
    hl = orient_out(grid("hood_in", rows2), (0, py, pz))
    hl.data.flip_normals()
    b.add(hl, lining, den=0.45)
    # bows
    for k in range(len(keys_phi)):
        s = k / (len(keys_phi) - 1)
        pts = [hood_pt(s, 0.03 + 0.94 * j / 14, inset=0.016) for j in range(15)]
        b.tube(pts, 0.0085, st if k else ch, seg=5, den=0.3)
    # gold cord along the front rim
    b.tube([hood_pt(0, 0.01 + 0.98 * j / 22) + Vector((0, -0.004, 0)) for j in range(23)], 0.0125, gold, seg=6, den=0.5)

    # stay struts holding the hood up
    def stay(s):
        low = Vector((s * 0.445, 0.14, 0.86))
        hip = hood_pt(0, 0.12 if s < 0 else 0.88, inset=0.01)
        knee = (low + hip) * 0.5 + Vector((s * 0.015, -0.02, 0.0))
        b.tube([low, knee, hip], 0.0065, ch, seg=5, den=0.3)
        b.add(lathe("kn", [(-0.008, 0.0), (-0.008, 0.012), (0.008, 0.012), (0.008, 0.0)], 8, knee), st, den=0.3)

    b.both(stay)

    # ---- front valance with scallops and tassels
    v_cv = valance_canvas()
    v_img = v_cv.to_image("valance")
    val = painted("valance", v_img, rough=0.8, dust=0.08)
    t0, t1 = 0.13, 0.87
    n_v = 30
    drop = 0.16
    r_top = [hood_pt(0, t0 + (t1 - t0) * j / n_v) + Vector((0, -0.008, 0)) for j in range(n_v + 1)]
    r_bot = []
    scallops = 9
    for j in range(n_v + 1):
        u = j / n_v
        d = drop * (0.82 + 0.18 * abs(math.sin(u * scallops * math.pi)))
        p = r_top[j]
        r_bot.append(p + Vector((0, 0.0, -d)))
    vm = orient_out(grid("valance", [r_bot, r_top], uv=True), (0, py, pz))
    b.add(vm, val, den=1.3)
    for i in range(scallops * 2 + 1):
        u = i / (scallops * 2)
        p0 = hood_pt(0, t0 + (t1 - t0) * u) + Vector((0, -0.01, 0))
        d = drop * (0.82 + 0.18 * abs(math.sin(u * scallops * math.pi)))
        tassel(b, p0 + Vector((0, 0, -d)), 0.075 if i % 2 else 0.1, gold, tm if i % 2 else tm2)

    # ---- wheels
    def rick_wheel(bb, c):
        wheel_spoked(bb, c, R, 0.052, spokes=36, seg=36, lugs=30, tyre_kind="bike", hub_r=0.024)

    b.add_wheels([("wheel_F", (0, fy, R), False), ("wheel_RL", (rx, ry, R), False), ("wheel_RR", (-rx, ry, R), False)], rick_wheel)

    # ---- variants: new back painting and new canopy cloth, same UVs
    def scheme_fn(name, art_fn, val_cols):
        def f():
            hood_canvas(name).update_image(h_img)
            art_fn().update_image(art_img)
            valance_canvas(*val_cols).update_image(v_img)

        return f

    b.variant("default")
    b.variant("art2", {"frame": "#0d6f60", "accent": "#ff7a1a", "seat": "#0e7f6f", "lining": "#14587f", "trim": "#ffd21f", "foot": "#e0651c"}, scheme_fn("art2", art_river, ("#00a79d", "#ffd21f", "#ff2d86")))
    b.variant("art3", {"frame": "#16468f", "accent": "#ff7a1a", "seat": "#6a18a8", "lining": "#4a1cae", "trim": "#ffd21f", "foot": "#00a79d"}, scheme_fn("art3", art_swans, ("#4b1fa8", "#ffd21f", "#ff2d86")))


# ---------------------------------------------------------------------------
# Shared hard-surface helpers for motor vehicles
# ---------------------------------------------------------------------------


def wall_loft(name, half, z_bot, z_top, rows_v, offset):
    """Closed vertical wall from a half plan outline [(x, y)] running nose centre to tail centre
    with x >= 0. z_bot(y), z_top(y) bound each column; offset(v, y) pushes along the plan normal.
    Door openings and arches come from the bound functions, so edge loops follow them."""
    pts = [Vector((x, y)) for x, y in half]
    full = list(pts) + [Vector((-p.x, p.y)) for p in reversed(pts[1:-1])]
    n = len(full)
    columns = []
    for i, p in enumerate(full):
        t = (full[(i + 1) % n] - full[(i - 1) % n]).normalized()
        nrm = Vector((t.y, -t.x))
        if nrm.dot(p - Vector((0, 0.0))) < 0 and abs(p.x) > 1e-4:
            nrm = -nrm
        if abs(p.x) < 1e-4:
            nrm = Vector((0, -1 if p.y < 0 else 1))
        columns.append((p, nrm))
    rows = []
    for v in rows_v:
        row = []
        for p, nrm in columns:
            z0, z1 = z_bot(p.y), z_top(p.y)
            o = offset(v, p.y)
            row.append(Vector((p.x + nrm.x * o, p.y + nrm.y * o, z0 + (z1 - z0) * v)))
        rows.append(row)
    return orient_out(grid(name, rows, close_u=True), (0, 0, 0.8)), rows, columns


def livery(name, canv, bounds, **kw):
    """Paint from side, front and rear canvases projected along X and Y, picked by face direction.
    canv: dict with Blender images side, front, rear, plus optional side_h, front_h, rear_h heights.
    bounds: dict(y0, y1, x0, x1, z0, z1)."""
    B = bounds

    def tex(g, key):
        if key.startswith("side"):
            return g.image(canv[key], g.project("x", B["y0"], B["y1"], B["z0"], B["z1"])).outputs["Color"]
        if key.startswith("front"):
            return g.image(canv[key], g.project("y", B["x0"], B["x1"], B["z0"], B["z1"])).outputs["Color"]
        return g.image(canv[key], g.project("y", B["x1"], B["x0"], B["z0"], B["z1"])).outputs["Color"]

    def col(g):
        ny = g.split(g.normal)[1]
        c = tex(g, "side")
        c = g.mixc(g.smooth(ny, -0.74, -0.70, 1.0, 0.0), c, tex(g, "front"))
        c = g.mixc(g.smooth(ny, 0.70, 0.74), c, tex(g, "rear"))
        return c

    def height(g):
        ny = g.split(g.normal)[1]
        h = tex(g, "side_h") if "side_h" in canv else 0.5
        if "front_h" in canv:
            h = g.mixf(g.smooth(ny, -0.74, -0.70, 1.0, 0.0), h, tex(g, "front_h"))
        if "rear_h" in canv:
            h = g.mixf(g.smooth(ny, 0.70, 0.74), h, tex(g, "rear_h"))
        return h

    kw.setdefault("rough", 0.34)
    return paint(name, col, extra_h=height, **kw)


def seam(cv, pts, width=3.0, dark="#101410", alpha=0.85):
    """Panel gap: dark line plus a groove in the height channel, plus a thin highlight lip."""
    cv.stroke(pts, width + 1.2, "#ffffff", alpha=0.10)
    cv.stroke(pts, width, dark, alpha=alpha)
    p = np.array([(float(x), float(y)) for x, y in pts], np.float32)
    win = cv._win(p[:, 0].min() - width - 3, p[:, 1].min() - width - 3, p[:, 0].max() + width + 3, p[:, 1].max() + width + 3)
    if win is None:
        return
    slc, xs, ys = win
    best = np.full(xs.shape, 1e9, np.float32)
    for i in range(len(p) - 1):
        a0, b0 = p[i], p[i + 1]
        e = b0 - a0
        l2 = max(float(e @ e), 1e-6)
        t = np.clip(((xs - a0[0]) * e[0] + (ys - a0[1]) * e[1]) / l2, 0, 1)
        best = np.minimum(best, np.hypot(xs - (a0[0] + t * e[0]), ys - (a0[1] + t * e[1])))
    m = np.clip((width * 1.2 - best) / (width * 1.2), 0, 1)
    cv.height[slc] = np.minimum(cv.height[slc], 0.5 - 0.5 * m)


def round_lamp(b, center, r, lens="clear", node="body", axis="y", direction=-1, depth=0.016, den=1.0, bezel=None, glass=True):
    """Lamp pod: bezel ring, reflector bowl and bulb under a domed lens. Clear lenses go in the
    glass node so the reflector shows through; coloured ones stay opaque in the body."""
    c = Vector(center)
    d = direction
    bez = bezel or b.mat("chrome", lambda: chrome())
    lamp_seg = max(12, min(20, int(r * 220)))
    b.add(lathe("bezel", [(d * -depth, r * 0.92), (d * 0.006, r * 1.12), (d * 0.012, r * 1.04), (d * -0.002, r * 0.94)], lamp_seg, c, axis=axis), bez, node, den=den * 0.7)
    if lens == "clear":
        rf = b.mat("reflector", lambda: reflector())
        b.add(lathe("bowl", [(d * -depth, 0.0), (d * -depth * 0.8, r * 0.45), (d * -depth * 0.3, r * 0.8), (d * 0.0, r * 0.95)], lamp_seg, c, axis=axis), rf, node, den=den)
        bulb = bo.uv_sphere("bulb", r * 0.16, 8, 5, loc=c + Vector((0, d * -depth * 0.2, 0)) if axis == "y" else c)
        b.add(bulb, b.mat("bulb", lambda: bo.pbr("bulb", C("#fff7dd"), 0.25)), node, den=0.3)
        if glass:
            b.glass(lathe("lens", [(d * 0.0, r * 0.96), (d * 0.014, r * 0.8), (d * 0.024, r * 0.42), (d * 0.026, 0.0)], lamp_seg, c, axis=axis))
    else:
        m = b.mat(f"lens_{lens}", lambda: lens_red(f"lens_{lens}", {"red": "#c4101c", "amber": "#e8820c", "white": "#d9dde0"}[lens]))
        b.add(lathe("lens", [(d * 0.0, r * 0.96), (d * 0.016, r * 0.78), (d * 0.028, 0.0)], lamp_seg, c, axis=axis), m, node, den=den)


def mirror_stalk(b, base, tip, r=0.06, mat=None, node="body"):
    """Round rear-view mirror on a stalk, chrome-backed glass facing the driver."""
    m = mat or b.mat("blackgloss", lambda: paint("blackgloss", "#121213", rough=0.3, dust=0.2, chips=0.1, scratch=0.1, edge=0.2))
    b.tube([base, (Vector(base) + Vector(tip)) * 0.5 + Vector((0, 0, 0.03)), tip], 0.006, b.mat("chrome", lambda: chrome()), node, seg=5, den=0.3)
    t = Vector(tip)
    b.add(lathe("mirrorback", [(-0.018, 0.0), (-0.012, r * 0.8), (0.0, r), (0.006, r * 0.98), (0.006, 0.0)], 14, t, axis="y"), m, node, den=0.5)
    b.add(lathe("mirrorface", [(0.0068, 0.0), (0.0068, r * 0.9)], 14, t, axis="y"), b.mat("mirrorface", lambda: bo.pbr("mirrorface", C("#c9d6df"), 0.05, 1.0)), node, den=0.3)


def seat_block(b, pos, w, depth, h_cush, h_back, mat, trim=None, lean=12, node="body", den=1.0, frame_h=0.0):
    """Cushion plus backrest. pos is the front-centre top of the cushion's underside."""
    x, y, z = pos
    b.add(rbox("cush", (w, depth, h_cush), (x, y + depth / 2, z + h_cush / 2), r=min(0.035, h_cush * 0.4), seg=2), mat, node, den)
    lr = math.radians(lean)
    by = y + depth + math.sin(lr) * h_back / 2 - 0.02
    bz = z + h_cush * 0.8 + math.cos(lr) * h_back / 2
    b.add(rbox("back", (w, 0.08, h_back), (x, by, bz), rot=(lr, 0, 0), r=0.03, seg=2), mat, node, den)
    if frame_h > 0:
        leg = trim or b.mat("steel", lambda: steel())
        b.add(rbox("seatbase", (w * 0.6, depth * 0.6, frame_h), (x, y + depth / 2, z - frame_h / 2), r=0.008, seg=1), leg, node, den * 0.4)


def mesh_panel(b, y0, y1, z0, z1, x, mat, node="body", spacing=0.092, wire=0.003):
    """Welded diamond mesh in the plane x = const."""
    objs = []
    w, h = y1 - y0, z1 - z0
    n = int((w + h) / spacing) + 1
    for i in range(1, n):
        c = i * spacing
        # direction /
        pts = []
        for (ya, za) in ((c - h if c > h else 0.0, h if c > h else c), (c if c < w else w, 0.0 if c < w else c - w)):
            pts.append((x, y0 + ya, z0 + za))
        if (Vector(pts[0]) - Vector(pts[1])).length > 0.01:
            objs.append(tube("w", pts, wire, seg=3, caps=False))
        # direction \
        pts = []
        for (ya, za) in ((c - h if c > h else 0.0, 0.0 if c > h else h - c), (c if c < w else w, h if c < w else h - (c - w))):
            pts.append((x, y0 + ya, z0 + za))
        if (Vector(pts[0]) - Vector(pts[1])).length > 0.01:
            objs.append(tube("w", pts, wire, seg=3, caps=False))
    b.add(bo.join(objs, "mesh"), mat, node, den=0)


def door_frame(b, y0, y1, z0, z1, x, mat, node="body", r=0.012, den=0.5):
    pts = [(x, y0 + 0.02, z0), (x, y1 - 0.02, z0), (x, y1, z0 + 0.02), (x, y1, z1 - 0.02), (x, y1 - 0.02, z1), (x, y0 + 0.02, z1), (x, y0, z1 - 0.02), (x, y0, z0 + 0.02)]
    b.tube(pts, r, mat, node, seg=6, closed=True, den=den)


def transform_parts(b, start, mat):
    """Move parts added since index `start`; used to stand a spare wheel up."""
    for o in b.parts[start:]:
        bo.apply_modifiers(o)
        bo.apply_transforms(o)
        o.data.transform(mat)
        o.data.update()


# ---------------------------------------------------------------------------
# CNG auto-rickshaw
# ---------------------------------------------------------------------------


def cng_canvases(main="#0d9440", lower="#0a7a35", accent="#f8c919", W=2048, H=1024):
    """Side, front and rear paint for the CNG: Bangladesh green with yellow accents, panel seams."""
    y0, y1, x0, x1, z0, z1 = -1.36, 1.36, -0.72, 0.72, 0.0, 1.80

    def U(y):
        return (y - y0) / (y1 - y0) * W

    def Vz(z, h=H):
        return (1 - (z - z0) / (z1 - z0)) * h

    side = Canvas(W, H, main)
    side.height[:] = 0.5
    side.rect(0, Vz(0.56), W, H, lower)
    # yellow belt, white pinstripe, red hairline
    side.rect(0, Vz(0.74), W, Vz(0.66), accent)
    side.rect(0, Vz(0.765), W, Vz(0.752), "#ffffff")
    side.rect(0, Vz(0.655), W, Vz(0.645), "#c9142a")
    # rear quarter graphics: flowers, a yellow sweep and a vent
    for i, (y, z, r, c) in enumerate(((0.80, 0.86, 26, "#ffd21f"), (0.92, 0.88, 19, "#ff2d86"), (1.03, 0.85, 23, "#ffffff"))):
        side.flower(U(y), Vz(z), r, 7, c, "#ff7a1a", "#c9142a", outline="#06301a")
    side.poly([(U(0.68), Vz(0.97)), (U(1.2), Vz(0.97)), (U(1.2), Vz(0.94)), (U(0.74), Vz(0.94))], accent)
    # cowl flash
    side.poly([(U(-1.28), Vz(0.98)), (U(-0.62), Vz(0.98)), (U(-0.58), Vz(0.93)), (U(-1.28), Vz(0.93))], accent)
    side.flower(U(-0.82), Vz(0.84), 24, 7, "#ffd21f", "#ffffff", "#c9142a", outline="#06301a")
    # shut lines
    for pts in (
        [(U(-0.52), Vz(1.02)), (U(-0.54), Vz(0.8)), (U(-0.56), Vz(0.4))],
        [(U(0.66), Vz(0.98)), (U(0.66), Vz(0.5))],
        [(U(0.66), Vz(0.5)), (U(1.2), Vz(0.5))],
        [(U(-1.3), Vz(0.56)), (U(-0.5), Vz(0.56))],
    ):
        seam(side, pts, 2.5)
    # fuel flap and rivets
    side.ring(U(1.06), Vz(0.70) - 40, 15, 2.0, "#0a2412")
    for y in np.arange(-0.46, 0.62, 0.075):
        side.circle(U(y), Vz(0.335), 2.6, "#d6d6d6", alpha=0.7)

    front = Canvas(1024, H, main)
    front.height[:] = 0.5

    def Ux(x):
        return (x - x0) / (x1 - x0) * 1024

    front.rect(0, Vz(0.56), 1024, H, lower)
    front.rect(0, Vz(0.74), 1024, Vz(0.66), accent)
    front.rect(0, Vz(0.765), 1024, Vz(0.752), "#ffffff")
    front.rect(0, Vz(0.655), 1024, Vz(0.645), "#c9142a")
    # centre V-badge of plain shapes, and flowers
    front.poly([(Ux(-0.16), Vz(0.98)), (Ux(0.16), Vz(0.98)), (Ux(0.03), Vz(0.64)), (Ux(-0.03), Vz(0.64))], accent, outline="#06301a", ow=1.5)
    front.flower(Ux(-0.34), Vz(0.60), 24, 7, "#ffd21f", "#ffffff", "#c9142a", outline="#06301a")
    front.flower(Ux(0.34), Vz(0.60), 24, 7, "#ffd21f", "#ffffff", "#c9142a", outline="#06301a")
    seam(front, [(0, Vz(0.56)), (1024, Vz(0.56))], 2.5)

    rear = Canvas(1024, H, main)
    rear.height[:] = 0.5
    rear.rect(0, Vz(0.56), 1024, H, lower)
    rear.rect(0, Vz(0.74), 1024, Vz(0.66), accent)
    rear.rect(0, Vz(0.765), 1024, Vz(0.752), "#ffffff")
    rear.rect(0, Vz(0.655), 1024, Vz(0.645), "#c9142a")
    rear.poly([(Ux(-0.46), Vz(0.98)), (Ux(0.46), Vz(0.98)), (Ux(0.0), Vz(0.8))], accent)
    for x in (-0.46, 0.46):
        rear.flower(Ux(x), Vz(0.52), 26, 7, "#ffd21f", "#ff2d86", "#c9142a", outline="#06301a")
    seam(rear, [(Ux(-0.42), Vz(0.98)), (Ux(-0.42), Vz(0.42)), (Ux(0.42), Vz(0.42)), (Ux(0.42), Vz(0.98))], 2.5)
    for cv in (side, front, rear):
        cv.speckle(0.03, seed=9)
    bounds = dict(y0=y0, y1=y1, x0=x0, x1=x1, z0=z0, z1=z1)
    return dict(side=side.to_image("cng_side"), side_h=side.height_image("cng_side_h"), front=front.to_image("cng_front"), front_h=front.height_image("cng_front_h"), rear=rear.to_image("cng_rear"), rear_h=rear.height_image("cng_rear_h")), bounds


@vehicle
def build_cng(b):
    R = 0.205
    fy, ry, rx = -1.0, 0.86, 0.565
    rake = 22.0
    tan_r = math.tan(math.radians(rake))
    b.spec = dict(wheelbase=round(ry - fy, 3), wheelRadius=R, seatPose="sit_drive", width=1.3)
    b.preview = dict(target=(0, 0.0, 0.85), distance=6.4, height=0.8)
    b.tex = 1024
    b.ao_distance = 0.45

    def A(z):
        return Vector((0, fy + 0.05 + (z - R) * tan_r, z))

    canv, bounds = cng_canvases()
    green = livery("green", canv, bounds, dust=0.22, chips=0.12, scratch=0.12, edge=0.8, chip_col="#3f3a2c", grime=0.14)
    trim_g = paint("trim_green", "#0b8a3b", rough=0.34, dust=0.3, chips=0.3, scratch=0.25, edge=0.9, chip_col="#3f3a2c")
    yellow = paint("yellow", "#f8c919", rough=0.34, dust=0.3, chips=0.3, scratch=0.2, chip_col="#574016")
    ch = b.mat("chrome", lambda: chrome())
    st = b.mat("steel", lambda: steel())
    rub = b.mat("rubber", lambda: rubber())
    blk = paint("blk", "#17181a", rough=0.5, dust=0.35, chips=0.2, scratch=0.2, edge=0.5, chip_col="#55504a")
    mesh_m = paint("meshsteel", "#0c5e2b", rough=0.45, dust=0.2, chips=0.1, scratch=0, edge=0)
    door_m = paint("doorframe", "#0b8a3b", rough=0.36, dust=0.3, chips=0.45, scratch=0.25, edge=0.5, chip_col="#3f3a2c")

    # ---- lower wall: plan outline from nose to tail
    nose = [(0.0, -1.24), (0.17, -1.225), (0.33, -1.17), (0.46, -1.07), (0.545, -0.94), (0.595, -0.80), (0.618, -0.66)]
    nose_pts = curve(nose, 3)
    half = [(p.x, p.y) for p in nose_pts]
    side_ys = [-0.60, -0.57, -0.545, -0.52, -0.50, -0.42, -0.26, -0.10, 0.08, 0.26, 0.44, 0.56, 0.60, 0.635, 0.66, 0.68, 0.72, 0.78, 0.84, 0.90, 0.96, 1.02, 1.07, 1.10]
    half += [(0.625 + 0.004 * math.sin((y + 0.6) / 1.7 * math.pi), y) for y in side_ys]
    tail = [(0.625, 1.10), (0.61, 1.15), (0.565, 1.195), (0.46, 1.215), (0.24, 1.225), (0.0, 1.23)]
    half += [(p.x, p.y) for p in curve(tail, 2)][1:]

    arch_r, arch_c = R + 0.095, (ry, R + 0.005)

    def z_top(y):
        if y < -0.545:
            return 1.045 - 0.05 * max(0.0, (-y - 0.6) / 0.64) ** 2
        if y < -0.50:
            return 1.045 + (0.47 - 1.045) * (y + 0.545) / 0.045
        if y < 0.635:
            return 0.47
        if y < 0.68:
            return 0.47 + (1.0 - 0.47) * (y - 0.635) / 0.045
        return 1.0 + 0.012 * math.sin((y - 0.68) / 0.55 * math.pi)

    def z_bot(y):
        if y < -0.58:
            t = min(1.0, (-y - 0.58) / 0.66)
            return 0.34 + 0.16 * t ** 0.7
        dy = abs(y - arch_c[0])
        if dy < arch_r:
            return arch_c[1] + math.sqrt(max(0.0, arch_r ** 2 - dy ** 2))
        return 0.31 + (0.05 if y > 1.1 else 0.0)

    def off(v, y):
        lean = 0.15 if y < -1.05 else (0.15 * max(0.0, (-y - 0.5) / 0.55) if y < -0.5 else 0.03)
        if y > 1.05:
            lean = 0.05
        bulge = 0.012 * math.sin(math.pi * min(1.0, v / 0.62)) - 0.022 * max(0.0, 0.1 - v) / 0.1
        crease = 0.007 if 0.44 < v < 0.5 else 0.0
        return bulge + crease - lean * max(0.0, v - 0.45) ** 1.6 * 2.2

    vs = [0.0, 0.05, 0.16, 0.3, 0.44, 0.5, 0.62, 0.76, 0.9, 1.0]
    wall, rows, cols = wall_loft("wall", half, z_bot, z_top, vs, off)
    b.add(wall, green, den=2.2)

    # arch lip, cowl lid, firewall and rear bulkhead
    def arch_lip(s):
        pts = []
        for i in range(15):
            a = math.radians(180 - 180 * i / 14)
            pts.append((s * 0.633, arch_c[0] + math.cos(a) * arch_r, arch_c[1] + math.sin(a) * arch_r))
        b.tube(pts, 0.009, rub, seg=5, den=0.3)
        b.add(fender("hs", (s * 0.53, ry, R), arch_r - 0.004, 0.18, 0, 180, n=12), blk, den=0.35)
        b.add(plate("hswall", [(ry + math.cos(math.radians(a)) * arch_r, R + math.sin(math.radians(a)) * arch_r) for a in range(0, 181, 15)], 0.006, origin=(s * 0.44, 0, 0), u=(0, 1, 0), v=(0, 0, 1)), blk, den=0.25)

    b.both(arch_lip)
    top_ring = rows[-1]
    # lid outline: the front half of the top ring, as a continuous arc from -X side to +X side
    idx = [i for i, p in enumerate(top_ring) if p.y < -0.56]
    order = sorted(idx, key=lambda i: math.atan2(top_ring[i].x, top_ring[i].y + 0.56))
    lid = [(top_ring[i].x, top_ring[i].y) for i in order]
    b.add(plate("cowl_lid", lid, 0.012, origin=(0, 0, 1.03), u=(1, 0, 0), v=(0, 1, 0)), green, den=0.9)
    # firewall/dash
    dash_m = paint("dashpaint", "#2a2b2d", rough=0.55, dust=0.2, chips=0.05, scratch=0.05, edge=0.2)
    b.add(plate("firewall", [(-0.615, 0.30), (0.615, 0.30), (0.615, 1.05), (-0.615, 1.05)], 0.012, origin=(0, -0.565, 0), u=(1, 0, 0), v=(0, 0, 1)), trim_g, den=0.5)
    b.add(rbox("dash", (1.14, 0.10, 0.11), (0, -0.59, 1.075), r=0.018, seg=2), dash_m, den=0.7)
    b.add(lathe("cluster", [(0.0, 0.08), (-0.02, 0.09), (-0.03, 0.085), (-0.03, 0.0)], 14, (0.0, -0.53, 1.09), axis="y"), blk, den=0.5)
    gauge = bo.pbr("gauge", C("#e7e4d4"), 0.2)
    b.add(lathe("gauge", [(-0.0305, 0.0), (-0.0305, 0.072)], 14, (0.0, -0.53, 1.09), axis="y"), gauge, den=0.6)
    b.add(plate("bulkhead", [(-0.615, 0.30), (0.615, 0.30), (0.615, 1.0), (-0.615, 1.0)], 0.012, origin=(0, 0.70, 0), u=(1, 0, 0), v=(0, 0, 1)), trim_g, den=0.5)
    b.add(rbox("deck", (1.24, 0.53, 0.012), (0, 0.965, 1.006), r=0.003, seg=1), trim_g, den=0.4)
    # floor, sills and step
    floor_m = paint("floor", "#35373a", rough=0.65, dust=0.55, chips=0.25, scratch=0.3, edge=0.4)
    b.add(rbox("floor", (1.23, 1.74, 0.02), (0, 0.33, 0.31), r=0.004, seg=1), floor_m, den=0.5)
    b.add(rbox("cabinmat", (0.74, 0.45, 0.012), (0, -0.28, 0.326), r=0.003, seg=1), rub, den=0.5)
    def sills(s):
        b.tube([(s * 0.63, -0.50, 0.475), (s * 0.63, 0.635, 0.475)], 0.012, ch, seg=6, den=0.5)
        b.add(rbox("step", (0.03, 1.1, 0.012), (s * 0.635, 0.06, 0.305), r=0.003, seg=1), st, den=0.4)
    b.both(sills)

    # ---- interior: driver's seat, rear bench, handbar guard
    seatv = vinyl("seatv", "#7a1420", rough=0.42, tuft=9.0, dust=0.1)
    drv = vinyl("drv", "#26211d", rough=0.48, tuft=0.0, dust=0.1)
    seat_block(b, (0, -0.42, 0.56), 0.62, 0.40, 0.09, 0.36, drv, lean=9, frame_h=0.24)
    seat_block(b, (0, 0.20, 0.46), 1.12, 0.42, 0.12, 0.46, seatv, lean=12, frame_h=0.14, den=1.1)
    b.empty("seat_driver", (0, -0.235, 0.70))
    b.empty("seat_p1", (0.29, 0.40, 0.63))
    b.empty("seat_p2", (-0.29, 0.40, 0.63))
    b.empty("exit_L", (0.95, -0.23, 0))
    b.empty("exit_R", (-0.95, -0.23, 0))

    # ---- roof, posts, upper rear
    roof_z = 1.69
    roof_half, ry0, ry1 = 0.635, -0.84, 1.22
    roof_ol = rrect(roof_half * 2, ry1 - ry0, 0.17, n=4, cy=(ry0 + ry1) / 2)

    def ring_at(scale, z, ol=roof_ol, cy=(ry0 + ry1) / 2):
        return [Vector((p[0] * scale, cy + (p[1] - cy) * scale, z)) for p in ol]

    canvas_m = fabric("roofcanvas", "#23272a", weave=150.0, rough=0.86, dust=0.4)
    r_rows = [ring_at(1.0, roof_z - 0.075), ring_at(1.0, roof_z - 0.03), ring_at(0.995, roof_z - 0.01), ring_at(0.965, roof_z + 0.012), ring_at(0.82, roof_z + 0.03), ring_at(0.5, roof_z + 0.04), ring_at(0.12, roof_z + 0.042)]
    b.add(orient_out(grid("roof", r_rows, close_u=True), (0, 0.2, 1.0)), canvas_m, den=0.9)
    b.add(rbox("roofcap", (0.25, 0.4, 0.004), (0, (ry0 + ry1) / 2, roof_z + 0.041), r=0.001, seg=1), canvas_m, den=0.2)
    fascia = [ring_at(1.008, roof_z - 0.082), ring_at(1.008, roof_z - 0.02)]
    b.add(orient_out(grid("fascia", fascia, close_u=True), (0, 0.2, 1.0)), trim_g, den=0.6)
    b.tube(ring_at(1.012, roof_z - 0.062), 0.0055, yellow, seg=4, closed=True, den=0.3)
    b.tube(ring_at(1.012, roof_z - 0.02), 0.006, ch, seg=4, closed=True, den=0.3)
    liner = fabric("liner", "#b9b19a", weave=40, dust=0.1)
    b.add(plate("liner", roof_ol, 0.008, origin=(0, 0, roof_z - 0.07), u=(1, 0, 0), v=(0, 1, 0)), liner, den=0.35)

    # windscreen
    ws_top, ws_bot = 1.615, 1.06
    w_b, w_t = 0.565, 0.555

    def ws(u, v):
        half_w = w_b + (w_t - w_b) * v
        x = half_w * u
        yy = -0.64 + 0.09 * v - 0.17 * (1 - u * u) * (1 - 0.15 * v)
        return Vector((x, yy, ws_bot + (ws_top - ws_bot) * v))

    ws_rows = [[ws(-1 + 2 * j / 12, i / 4) for j in range(13)] for i in range(5)]
    b.glass(grid("ws", ws_rows))
    gasket = [ws(-1 + 2 * j / 12, 0) for j in range(13)] + [ws(1, i / 4) for i in range(1, 5)] + [ws(1 - 2 * j / 12, 1) for j in range(1, 13)] + [ws(-1, 1 - i / 4) for i in range(1, 4)]
    b.tube([p for p in gasket], 0.011, rub, seg=5, closed=True, den=0.35)
    # A pillars and posts
    def posts(s):
        b.tube(curve([ws(s, 0) + Vector((s * 0.018, 0.0, -0.05)), ws(s, 0.5) + Vector((s * 0.018, 0.012, 0)), ws(s, 1) + Vector((s * 0.018, 0.01, 0.07))], 2), 0.024, door_m, seg=8, den=0.6)
        b.tube([(s * 0.622, -0.10, 0.42), (s * 0.622, -0.10, 1.63)], 0.022, door_m, seg=8, den=0.6)
        mesh_panel(b, 0.75, 1.07, 1.03, 1.56, s * 0.626, mesh_m, spacing=0.07)

    b.both(posts)
    # upper rear: one curved shell following the tail outline, with real window openings
    cols = [(0.622, 0.655), (0.622, 0.745), (0.622, 1.075), (0.606, 1.145), (0.56, 1.19), (0.46, 1.212), (0.42, 1.216), (0.2, 1.224), (0.0, 1.228)]
    cols = cols + [(-x, y) for x, y in reversed(cols[:-1])]
    zs = [1.0, 1.05, 1.56, 1.625]
    shell_rows = [[V3(x * (1 - 0.02 * (z - 1.0)), y - 0.012 * (z - 1.0), z) for x, y in cols] for z in zs]
    n_c = len(cols)
    windows = {1, n_c - 3, 6, 7, n_c - 8, n_c - 9}

    def shell_tag(i, j):
        return "win" if i == 1 and j in windows else "solid"

    parts = split_grid("uppershell", shell_rows, shell_tag)
    b.add(orient_out(parts["solid"], (0, 0.6, 1.3)), green, den=1.6)
    win = orient_out(parts["win"], (0, 0.6, 1.3))
    for loop in boundary_loops(win):
        b.tube(loop, 0.0085, rub, seg=4, closed=True, den=0.25)
    b.glass(win)
    b.add(plate("bulktop", [(-0.62, 1.0), (0.62, 1.0), (0.62, 1.66), (-0.62, 1.66)], 0.008, origin=(0, 0.74, 0), u=(1, 0, 0), v=(0, 0, 1)), liner, den=0.3)

    # ---- mesh doors, the Dhaka signature: one each side for the driver, one for passengers
    def doors(s):
        x = s * 0.645
        # driver's door
        door_frame(b, -0.50, -0.13, 0.50, 1.60, x, door_m, r=0.013)
        mesh_panel(b, -0.49, -0.14, 0.51, 1.59, x, mesh_m)
        # passenger door
        door_frame(b, -0.07, 0.62, 0.50, 1.60, x, door_m, r=0.013)
        mesh_panel(b, -0.06, 0.61, 0.51, 1.59, x, mesh_m)
        b.tube([(x, -0.07, 0.86), (x, 0.62, 0.86)], 0.009, door_m, seg=5, den=0.3)
        b.tube([(x, -0.50, 0.92), (x, -0.13, 0.92)], 0.009, door_m, seg=5, den=0.3)
        # hinges, latch and padlock
        for z in (0.68, 1.42):
            b.add(rbox("hinge", (0.02, 0.05, 0.05), (x, 0.635, z), r=0.004, seg=1), st, den=0.25)
            b.add(rbox("hinge", (0.02, 0.05, 0.05), (x, -0.515, z), r=0.004, seg=1), st, den=0.25)
        b.add(rbox("latch", (0.03, 0.10, 0.03), (x + s * 0.012, -0.10, 0.90), r=0.005, seg=1), st, den=0.3)
        b.add(rbox("lock", (0.03, 0.05, 0.06), (x + s * 0.03, -0.10, 0.855), r=0.006, seg=1), b.mat("brass", lambda: paint("brass", "#a8842c", rough=0.34, metal=1.0, dust=0.2, chips=0.1, scratch=0.25, edge=0.3)), den=0.3)
        b.tube([(x + s * 0.03, -0.115, 0.885), (x + s * 0.03, -0.115, 0.905), (x + s * 0.03, -0.085, 0.905), (x + s * 0.03, -0.085, 0.885)], 0.003, ch, seg=4, den=0)

    b.both(doors)

    # ---- nose: headlamp, indicators, guard and mirrors
    round_lamp(b, (0, -1.19, 0.83), 0.098, "clear", den=1.3)
    b.add(lathe("headpod", [(0.06, 0.128), (0.015, 0.128), (0.0, 0.112)], 16, (0, -1.19, 0.83), axis="y"), trim_g, den=0.5)
    for s in (1, -1):
        round_lamp(b, (s * 0.455, -1.03, 0.885), 0.062, "amber", den=0.9, bezel=b.mat("blackgloss", lambda: paint("blackgloss", "#121213", rough=0.3, dust=0.2, chips=0.1, scratch=0.1, edge=0.2)))
        b.empty("light_FL" if s > 0 else "light_FR", (s * 0.30, -1.2, 0.82))
        mirror_stalk(b, (s * 0.60, -0.68, 1.05), (s * 0.76, -0.74, 1.30), r=0.062)
    b.tube(curve([(-0.52, -0.98, 0.50), (-0.3, -1.20, 0.50), (0.3, -1.20, 0.50), (0.52, -0.98, 0.50)], 4), 0.014, ch, seg=7, den=0.6)
    b.empty("plate_F", (0, -1.232, 0.64))
    # cooling slats in the apron, a sun visor and a painted header board
    for i in range(4):
        z = 0.555 + i * 0.028
        hw = 0.17 - i * 0.012
        b.add(bo.box("slat", (hw * 2, 0.012, 0.014), loc=(0, -1.222 + (0.555 - z) * 0.03, z)), blk, den=0.3)
    hdr = Canvas(960, 66, "#f8c919")
    for i in range(13):
        x = 960 * (i + 0.5) / 13
        if i % 2 == 0:
            hdr.flower(x, 33, 26, 7, "#c9142a", "#ffffff", "#0d9440", outline="#0a2412")
        else:
            hdr.poly([(x - 26, 33), (x, 9), (x + 26, 33), (x, 57)], "#0d9440", outline="#0a2412", ow=1.5)
    hdr.speckle(0.04, seed=14)
    hdr_img = hdr.to_image("cng_header")
    hdr_m = painted("cng_header", hdr_img, rough=0.42, vec=lambda g: g.project("y", -0.48, 0.48, 1.635, 1.70), dust=0.2, wear=0.12)
    b.add(plate("header", rrect(0.96, 0.065, 0.012), 0.008, origin=(0, -0.848, 1.667), u=(1, 0, 0), v=(0, 0, 1), bevel=0.002), hdr_m, den=1.3)
    # wiper
    b.tube([(0.1, -0.815, 1.075), (-0.05, -0.81, 1.30)], 0.0035, blk, seg=4, den=0)
    b.tube([(-0.14, -0.83, 1.20), (0.04, -0.79, 1.40)], 0.004, rub, seg=4, den=0)

    # ---- tail: lamps, bumper, spare wheel
    for s in (1, -1):
        round_lamp(b, (s * 0.50, 1.222, 0.76), 0.058, "red", direction=1, den=0.9, bezel=blk)
        round_lamp(b, (s * 0.37, 1.226, 0.76), 0.042, "amber", direction=1, den=0.7, bezel=blk)
        b.empty("light_RL" if s > 0 else "light_RR", (s * 0.50, 1.25, 0.76))
    b.tube(curve([(-0.60, 1.14, 0.44), (-0.5, 1.285, 0.44), (0.5, 1.285, 0.44), (0.60, 1.14, 0.44)], 4), 0.016, blk, seg=7, den=0.5)
    b.empty("plate_R", (0, 1.232, 0.52))
    b.add(rbox("platebkt", (0.34, 0.008, 0.17), (0, 1.228, 0.52), r=0.002, seg=1), blk, den=0.2)

    # spare wheel on the tail, axle along Y
    start = len(b.parts)
    b.current_wheel = "body"
    spare_c = (0, 0, 0)
    wheel_small(b, spare_c, R, 0.105, 0.105, den=0.7)
    b.current_wheel = None
    m = Matrix.Translation((0, 1.305, 0.78)) @ Matrix.Rotation(math.radians(90), 4, "Z")
    transform_parts(b, start, m)
    b.add(rbox("sparebkt", (0.05, 0.1, 0.05), (0, 1.25, 0.78), r=0.006, seg=1), st, den=0.3)
    b.tube([(-0.2, 1.232, 0.92), (0, 1.262, 0.8), (0.2, 1.232, 0.92)], 0.01, st, seg=5, den=0.3)

    # ---- chassis glimpses: engine box, exhaust, suspension
    b.add(rbox("engine", (0.46, 0.46, 0.26), (0.0, 0.9, 0.40), r=0.03, seg=1), b.mat("enginepaint", lambda: paint("enginepaint", "#3a3a3a", rough=0.55, metal=0.5, dust=0.55, chips=0.3, scratch=0.2, edge=0.5)), den=0.35)
    b.tube([(-0.2, 0.8, 0.27), (-0.34, 1.0, 0.25), (-0.38, 1.2, 0.26)], 0.024, blk, seg=7, den=0.35)
    b.add(lathe("muffler", [(0.0, 0.0), (0.0, 0.05), (0.26, 0.05), (0.26, 0.02), (0.3, 0.02), (0.3, 0.0)], 10, (-0.38, 1.0, 0.255), axis="y"), st, den=0.35)
    b.tube([(-0.5, ry, R), (0.5, ry, R)], 0.02, blk, seg=7, den=0.3)
    b.both(lambda s: b.tube([(s * 0.42, ry - 0.42, 0.32), (s * 0.5, ry, R + 0.01)], 0.022, blk, seg=7, den=0.3))
    b.both(lambda s: b.add(spring_coil("shock", (s * 0.46, ry + 0.12, R + 0.02), 0.2, 0.03, turns=5, wire=0.005), yellow, den=0))

    # ---- steering: bars inside the cab, column through the cowl, single-sided fork with spring
    b.set_steer(A(0.8), rake)
    b.tube([A(0.42), A(1.13)], 0.018, st, "steer", seg=8)
    bar_c = A(1.13)
    bar = curve([(0.34, bar_c.y + 0.21, bar_c.z + 0.055), (0.24, bar_c.y + 0.17, bar_c.z + 0.05), (0.12, bar_c.y + 0.05, bar_c.z + 0.02), (0.0, bar_c.y, bar_c.z), (-0.12, bar_c.y + 0.05, bar_c.z + 0.02), (-0.24, bar_c.y + 0.17, bar_c.z + 0.05), (-0.34, bar_c.y + 0.21, bar_c.z + 0.055)], 3)
    b.tube(bar, 0.0115, ch, "steer", seg=7)
    def grip(s):
        g0, g1 = Vector((s * 0.235, bar_c.y + 0.165, bar_c.z + 0.05)), Vector((s * 0.345, bar_c.y + 0.213, bar_c.z + 0.056))
        b.tube([g0, g1], 0.017, rub, "steer", seg=7, den=0.5)
        b.empty("grip_L" if s > 0 else "grip_R", (g0 + g1) / 2, parent="steer")
    b.both(grip)
    b.add(rbox("barhub", (0.09, 0.05, 0.05), bar_c + Vector((0, 0.0, -0.005)), r=0.012, seg=1), blk, "steer", den=0.4)
    fx = 0.075
    top = A(0.56) + Vector((fx, 0, 0))
    b.tube([A(0.56), top], 0.02, st, "steer", seg=7, den=0.4)
    b.tube(curve([top, top + Vector((0.01, -0.03, -0.14)), (fx + 0.01, fy - 0.01, R + 0.06), (fx + 0.005, fy, R)], 3), 0.021, trim_g, "steer", seg=8, den=0.6)
    b.add(spring_coil("frontspring", top + Vector((0.075, -0.015, -0.28)), 0.24, 0.027, turns=6, wire=0.0045, seg=4), yellow, "steer", den=0)
    b.tube([top + Vector((0.0, 0, -0.02)), top + Vector((0.075, -0.015, -0.03))], 0.012, st, "steer", seg=5, den=0.3)
    b.add(lathe("hubboss", [(fx - 0.05, 0.0), (fx - 0.05, 0.035), (fx + 0.012, 0.042), (fx + 0.012, 0.0)], 12, (0, fy, R)), blk, "steer", den=0.4)
    # front mudguard
    b.add(fender("fguard", (0, fy, R), R + 0.035, 0.155, 18, 172, n=14, drop=0.03), trim_g, "steer", den=1.1)
    b.add(fender("fguardy", (0, fy, R), R + 0.038, 0.03, 40, 172, n=9, drop=0.003), yellow, "steer", den=0.5)

    # ---- wheels
    def cng_wheel(bb, c):
        wheel_small(bb, c, R, 0.105, 0.105, den=1.3)

    b.add_wheels([("wheel_F", (0, fy, R), True), ("wheel_RL", (rx, ry, R), False), ("wheel_RR", (-rx, ry, R), True)], cng_wheel)
    b.variant("default")


# ---------------------------------------------------------------------------
# Ring-lofted bodies for cars, vans, the bus and the truck cab
# ---------------------------------------------------------------------------


def table(keys):
    """Smooth 1D function through (x, y) keys, cubic Hermite, clamped at the ends."""
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        x0, x1, y0, y1 = xs[i], xs[i + 1], ys[i], ys[i + 1]
        h = x1 - x0
        t = (x - x0) / h
        m0 = (y1 - ys[i - 1]) / (x1 - xs[i - 1]) if i > 0 else (y1 - y0) / h
        m1 = (ys[i + 2] - y0) / (xs[i + 2] - x0) if i + 2 < len(xs) else (y1 - y0) / h
        t2, t3 = t * t, t * t * t
        return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1

    return f


class RingBody:
    """Shell lofted through rings along Y. Half ring, x >= 0, indices:
    0-3 top surface (centre to edge), 3-4 pillar strip, 4-6 side glass, 6-7 shoulder,
    7-11 lower side, 11-12 sill lip, 12-13 inner wall, 13-14 floor.
    Windows are faces tagged by station and ring index, so openings follow the edge loops."""

    N_HALF = 15
    N_FULL = 28

    def __init__(self, stations, zt, zb, xb, xt, sill, arches=(), floor=0.3, inner=0.62, crown=0.05, shoulder=0.035, pillar=0.05, belt_in=0.018, wall_bulge=0.004):
        self.st = sorted(set(round(s, 4) for s in stations))
        self.zt, self.zb, self.xb, self.xt, self.sill, self.arches = zt, zb, xb, xt, sill, arches
        self.floor, self.inner, self.crown, self.shoulder, self.pillar = floor, inner, crown, shoulder, pillar
        self.belt_in = belt_in
        self.wall_bulge = wall_bulge
        self.rows = [self.ring(y) for y in self.st]
        verts = [tuple(p) for row in self.rows for p in row]
        n = self.N_FULL
        faces = []
        for i in range(len(self.rows) - 1):
            for j in range(n):
                jj = (j + 1) % n
                faces.append((i * n + j, i * n + jj, (i + 1) * n + jj, (i + 1) * n + j))
        faces.append(tuple(range(n)))
        faces.append(tuple((len(self.rows) - 1) * n + j for j in range(n)))
        from mathutils.bvhtree import BVHTree

        self.bvh = BVHTree.FromPolygons(verts, faces, all_triangles=False)

    def low(self, y):
        z = self.sill(y)
        for yc, zc, r in self.arches:
            d = abs(y - yc)
            if d < r:
                z = max(z, zc + math.sqrt(max(0.0, r * r - d * d)))
        return z

    def half(self, y):
        zt, zb, xb, xt = self.zt(y), self.zb(y), self.xb(y), self.xt(y)
        crown = self.crown(y) if callable(self.crown) else self.crown
        edge = max(zb + 0.012, zt - crown)
        edge = min(edge, zt)
        gh = edge - zb
        xbelt = xb - self.belt_in
        zlow = self.low(y)
        strip = min(self.pillar, gh * 0.22)
        p = [
            (0.0, zt),
            (xt * 0.42, zt - (zt - edge) * 0.14),
            (xt * 0.78, zt - (zt - edge) * 0.52),
            (xt, edge),
            (xt + (xbelt - xt) * min(0.18, strip / max(gh, 1e-3)), edge - strip),
        ]
        p.append(((p[4][0] + xbelt) / 2, (p[4][1] + zb) / 2))
        p.append((xbelt, zb))
        z7 = zb - self.shoulder
        p.append((xb, z7))
        b = self.wall_bulge
        p += [(xb + b, z7 + (zlow - z7) * 0.34), (xb + b * 0.6, z7 + (zlow - z7) * 0.66), (xb - 0.012, z7 + (zlow - z7) * 0.9), (xb - 0.032, zlow)]
        p.append((xb - 0.075, zlow))
        p.append((min(xb - 0.11, self.inner), self.floor))
        p.append((0.0, self.floor))
        return p

    def ring(self, y):
        h = self.half(y)
        full = [V3(x, y, z) for x, z in h] + [V3(-x, y, z) for x, z in reversed(h[1:-1])]
        return full

    @staticmethod
    def seg(j):
        """Half-ring segment index and side (+1 at +X, -1 at -X) for full-ring face j."""
        if j < 14:
            return j, 1
        return 27 - j, -1

    def build(self, name, tag_fn):
        def t(i, j):
            s, side = self.seg(j)
            return tag_fn((self.st[i] + self.st[i + 1]) / 2, s, side, i)

        parts = split_grid(name, self.rows, t, close_u=True)
        c = V3(0, (self.st[0] + self.st[-1]) / 2, (self.floor + self.zb(0)) / 2)
        for o in parts.values():
            orient_out(o, c)
        return parts

    def caps(self, name):
        n = self.N_FULL
        v0 = [tuple(p) for p in self.rows[0]]
        v1 = [tuple(p) for p in self.rows[-1]]
        a = bo.new_mesh_object(name + "_f", v0, [tuple(range(n))])
        c = bo.new_mesh_object(name + "_r", v1, [tuple(range(n))])
        orient_out(a, V3(0, 0, 0.7))
        orient_out(c, V3(0, 0, 0.7))
        return a, c

    def hit(self, origin, direction):
        loc, nrm, _, _ = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized())
        return loc, nrm

    def patch(self, name, outline, direction, offset=0.005, rows=4, origin_at=-6.0):
        """Conformal patch from a 2D outline projected onto the shell along a ray direction.
        direction 'y+' shoots from the front along +Y (outline is x,z), 'y-' from the rear,
        'x-' from +X along -X (outline is y,z), 'x+' from -X along +X."""
        dirs = {"y+": V3(0, 1, 0), "y-": V3(0, -1, 0), "x-": V3(-1, 0, 0), "x+": V3(1, 0, 0)}
        d = dirs[direction]

        def origin(a, b):
            if direction[0] == "y":
                return V3(a, -d.y * 8.0, b)
            return V3(-d.x * 8.0, a, b)

        cx = sum(p[0] for p in outline) / len(outline)
        cy = sum(p[1] for p in outline) / len(outline)
        out_rows = []
        for k in range(rows + 1):
            f = 0.02 + 0.98 * (k / rows) ** 0.8
            row = []
            for px, py in outline:
                loc, nrm = self.hit(origin(cx + (px - cx) * f, cy + (py - cy) * f), d)
                if loc is None:
                    loc = out_rows[-1][len(row)] if out_rows else origin(px, py)
                    nrm = -d
                if nrm.dot(d) > 0:
                    nrm = -nrm
                row.append(loc + nrm * offset)
            out_rows.append(row)
        obj = grid(name, out_rows, close_u=True)
        # shut the centre
        me_verts = [tuple(p) for p in out_rows[0]]
        cap = bo.new_mesh_object(name + "c", me_verts, [tuple(range(len(me_verts)))])
        res = bo.join([obj, cap], name)
        orient_out(res, origin(cx, cy) + d * 12.0)
        return res, out_rows[-1]


def car_canvases(W=2048):
    """Panel-gap map for the sedan: multiply mask (white with dark gaps) plus a groove height map."""
    y0, y1, x0, x1, z0, z1 = -2.25, 2.25, -0.95, 0.95, 0.2, 1.5
    H = int(W * (z1 - z0) / (y1 - y0))

    def U(y):
        return (y - y0) / (y1 - y0) * W

    def Vz(z):
        return (1 - (z - z0) / (z1 - z0)) * H

    side = Canvas(W, H, "#ffffff")
    side.height[:] = 0.5

    def line(*pts):
        seam(side, [(U(a), Vz(b)) for a, b in pts], 3.0)

    # front door, B pillar, rear door hugging the arch, sills
    line((-0.53, 0.97), (-0.56, 0.72), (-0.57, 0.36))
    line((-0.57, 0.36), (0.30, 0.34))
    line((0.31, 0.98), (0.30, 0.34))
    line((0.30, 0.34), (0.82, 0.34))
    curve_pts = _bez3((1.08, 0.98), (1.08, 0.74), (0.92, 0.72), (0.84, 0.34), 10)
    line(*curve_pts)
    # hood and trunk shut lines on the shoulder
    line((-2.18, 0.70), (-1.72, 0.82), (-0.74, 0.90))
    line((1.52, 0.97), (2.18, 0.92))
    # bumper cuts behind the wheels
    line((-1.68, 0.52), (-2.25, 0.52))
    line((1.58, 0.56), (2.25, 0.56))
    # rub strip
    side.rect(U(-0.5), Vz(0.60), U(1.0), Vz(0.565), "#26282a", alpha=0.92)
    side.rect(U(-1.62), Vz(0.60), U(-1.02), Vz(0.565), "#26282a", alpha=0.92)
    side.rect(U(1.52), Vz(0.60), U(1.9), Vz(0.565), "#26282a", alpha=0.92)
    # fuel flap
    fp = [(U(1.48 + 0.07 * math.cos(a)), Vz(0.86 + 0.06 * math.sin(a))) for a in np.linspace(0, 2 * math.pi, 14)]
    seam(side, fp, 2.5)
    # black door frames below the glass
    side.rect(U(-0.46), Vz(0.965), U(1.0), Vz(0.948), "#1c1d1f", alpha=0.85)

    top = Canvas(W, int(W * (x1 - x0) / (y1 - y0)), "#ffffff")
    top.height[:] = 0.5
    TH = top.h

    def Vx(x):
        return (1 - (x - x0) / (x1 - x0)) * TH

    def tline(*pts):
        seam(top, [(U(a), Vx(b)) for a, b in pts], 3.0)

    tline((-2.16, -0.62), (-1.9, -0.76), (-0.75, -0.76))
    tline((-2.16, 0.62), (-1.9, 0.76), (-0.75, 0.76))
    tline((-0.75, -0.76), (-0.75, 0.76))
    tline((1.5, -0.72), (2.14, -0.66))
    tline((1.5, 0.72), (2.14, 0.66))
    tline((1.5, -0.72), (1.5, 0.72))
    tline((2.14, -0.66), (2.14, 0.66))
    # cowl vent ahead of the windscreen
    top.rect(U(-0.74), Vx(0.68), U(-0.665), Vx(-0.68), "#17181a")

    front = Canvas(1024, int(1024 * (z1 - z0) / (x1 - x0)), "#ffffff")
    front.height[:] = 0.5
    FH = front.h

    def Ux(x):
        return (x - x0) / (x1 - x0) * 1024

    def Vf(z):
        return (1 - (z - z0) / (z1 - z0)) * FH

    seam(front, [(Ux(-0.9), Vf(0.50)), (Ux(0.9), Vf(0.50))], 3.0)
    rear = Canvas(1024, FH, "#ffffff")
    rear.height[:] = 0.5
    seam(rear, [(Ux(-0.9), Vf(0.56)), (Ux(0.9), Vf(0.56))], 3.0)
    seam(rear, [(Ux(-0.62), Vf(0.98)), (Ux(-0.60), Vf(0.62)), (Ux(0.60), Vf(0.62)), (Ux(0.62), Vf(0.98))], 3.0)
    return dict(side=side.to_image("sedan_side", non_color=False), side_h=side.height_image("sedan_side_h"), front=front.to_image("sedan_front"), front_h=front.height_image("sedan_front_h"), rear=rear.to_image("sedan_rear"), rear_h=rear.height_image("sedan_rear_h"), top=top.to_image("sedan_top"), top_h=top.height_image("sedan_top_h")), dict(y0=y0, y1=y1, x0=x0, x1=x1, z0=z0, z1=z1)


def tinted_livery(name, canv, bounds, col, slot, **kw):
    """Paint colour (variant slot) multiplied by a panel-gap canvas set."""
    B = bounds

    def tex(g, key):
        if key.startswith("side"):
            return g.image(canv[key], g.project("x", B["y0"], B["y1"], B["z0"], B["z1"])).outputs["Color"]
        if key.startswith("front"):
            return g.image(canv[key], g.project("y", B["x0"], B["x1"], B["z0"], B["z1"])).outputs["Color"]
        if key.startswith("rear"):
            return g.image(canv[key], g.project("y", B["x1"], B["x0"], B["z0"], B["z1"])).outputs["Color"]
        s = g.uvw
        u = g.div(g.sub(s[1], B["y0"]), B["y1"] - B["y0"])
        v = g.div(g.sub(s[0], B["x0"]), B["x1"] - B["x0"])
        return g.image(canv[key], g.join3(u, v, 0.0)).outputs["Color"]

    def pick(g, base, keysuffix=""):
        n = g.split(g.normal)
        c = tex(g, "side" + keysuffix)
        c = g.mixc(g.smooth(n[1], -0.74, -0.70, 1.0, 0.0), c, tex(g, "front" + keysuffix))
        c = g.mixc(g.smooth(n[1], 0.70, 0.74), c, tex(g, "rear" + keysuffix))
        if "top" + keysuffix in canv:
            c = g.mixc(g.smooth(n[2], 0.60, 0.66), c, tex(g, "top" + keysuffix))
        return c

    def col_fn(g):
        return g.mixc(1.0, g.rgb(col, slot), pick(g, None), blend="MULTIPLY")

    def height(g):
        s = g.split(pick(g, None, "_h"))
        return s[0]

    kw.setdefault("rough", 0.24)
    return paint(name, col_fn, extra_h=height, **kw)


def car_mirror(b, x, y, z, s, mat, node="body"):
    """Door mirror: arm plus a rounded housing."""
    rings = []
    for t, w, h in ((0.0, 0.03, 0.03), (0.2, 0.07, 0.05), (0.75, 0.085, 0.058), (1.0, 0.07, 0.05)):
        rings.append(dict(c=(x + s * (0.03 + t * 0.17), y, z + 0.015 + t * 0.02), rx=0.03 + 0.015 * math.sin(t * 3.14), ry=h, axis="x", power=2.8))
    b.add(bo.loft("mir", rings, segments=10), mat, node, den=0.7)
    b.add(rbox("miarm", (0.05, 0.05, 0.03), (x + s * 0.015, y, z), r=0.008, seg=1), mat, node, den=0.3)
    face = plate("mirf", rrect(0.15, 0.09, 0.03, n=2), 0.002, origin=(x + s * 0.13, y + 0.046, z + 0.025), u=(1, 0, 0), v=(0, 0, 1))
    b.add(face, b.mat("mirrorface", lambda: bo.pbr("mirrorface", C("#c9d6df"), 0.05, 1.0)), node, den=0.3)


def gasket_loops(b, obj, r, mat, node="body", seg=4, den=0.25):
    for loop in boundary_loops(obj):
        b.tube(loop, r, mat, node, seg=seg, closed=True, den=den)


def conform_lamp(b, body, name, outline, direction, lens_mat=None, back_mat=None, off_back=0.004, off_lens=0.012, gasket=None, den=1.0, clear=False, rows=3):
    """Lamp flush with the shell: opaque backing patch plus a lens patch, optionally a clear one in
    the glass node, with a rubber gasket around it."""
    back, edge = body.patch(name + "_b", outline, direction, offset=off_back, rows=rows)
    b.add(back, back_mat or lens_mat, den=den)
    if clear:
        lens, edge2 = body.patch(name + "_l", outline, direction, offset=off_lens, rows=rows)
        b.glass(lens)
    if gasket is not None:
        b.tube(edge, 0.006, gasket, seg=4, closed=True, den=0.25)
    return edge


def interior_trim():
    return paint("trim_int", "#3c3a37", rough=0.62, dust=0.15, chips=0.02, scratch=0.05, edge=0.2, grime=0.2)


def steering_wheel(b, center, r=0.17, tilt=22, mat=None):
    """Steering wheel in a plane tilted back, centre at `center`, column running forward."""
    c = Vector(center)
    m = mat or b.mat("wheelrub", lambda: rubber("wheelrub", "#151515", 0.6, 0.05))
    rot = Matrix.Rotation(math.radians(90 - tilt), 4, "X")
    pts = [c + rot @ Vector((math.cos(a) * r, math.sin(a) * r, 0)) for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
    b.tube(pts, 0.016, m, seg=6, closed=True, den=0.5)
    for a in (math.pi / 2 * 3, 0.15, math.pi - 0.15):
        b.tube([c, c + rot @ Vector((math.cos(a) * r, math.sin(a) * r, 0))], 0.012, m, seg=4, den=0.3)
    b.add(lathe("swhub", [(-0.02, 0.05), (0.015, 0.052), (0.022, 0.0)], 10, c, axis="z"), m, den=0.4)
    b.tube([c, c + rot @ Vector((0, 0, -0.28))], 0.024, b.mat("trim_int", interior_trim), seg=6, den=0.3)


@vehicle
def build_car_sedan(b):
    R = 0.30
    yf, yr, tx = -1.32, 1.23, 0.725
    b.spec = dict(wheelbase=round(yr - yf, 3), wheelRadius=R, seatPose="sit_drive", glass_alpha=0.24, width=1.71, height=1.45)
    b.preview = dict(target=(0, 0.0, 0.62), distance=9.5, height=1.2)
    b.tex = 1024
    b.ao_distance = 0.5

    zt = table([(-2.2, 0.60), (-2.17, 0.67), (-2.08, 0.735), (-1.8, 0.80), (-1.25, 0.885), (-0.74, 0.965), (-0.42, 1.155), (-0.03, 1.395), (0.35, 1.45), (0.85, 1.415), (1.1, 1.27), (1.5, 1.06), (1.85, 1.05), (2.12, 1.025), (2.2, 0.93)])
    zb = table([(-2.2, 0.58), (-2.12, 0.69), (-1.7, 0.80), (-0.74, 0.905), (0.0, 0.94), (1.0, 0.98), (1.5, 0.99), (2.12, 0.975), (2.2, 0.89)])
    xb = table([(-2.2, 0.56), (-2.15, 0.68), (-2.0, 0.78), (-1.7, 0.835), (-1.0, 0.85), (0.3, 0.855), (1.5, 0.845), (1.9, 0.815), (2.1, 0.74), (2.2, 0.62)])
    xt = table([(-2.2, 0.5), (-2.1, 0.62), (-1.7, 0.74), (-0.74, 0.76), (-0.42, 0.685), (-0.03, 0.60), (0.35, 0.595), (0.85, 0.60), (1.12, 0.66), (1.5, 0.73), (2.0, 0.72), (2.2, 0.56)])
    sill = table([(-2.2, 0.36), (-2.1, 0.30), (-1.7, 0.27), (1.65, 0.28), (2.0, 0.33), (2.2, 0.42)])
    stations = [-2.2, -2.185, -2.165, -2.13, -2.08, -2.0, -1.9, -1.8, -0.74, -0.665, -0.58, -0.5, -0.42, -0.3, -0.16, -0.03, 0.12, 0.3, 0.39, 0.6, 0.85, 0.98, 1.08, 1.5, 1.65, 1.85, 2.0, 2.1, 2.16, 2.2]
    for yc in (yf, yr):
        stations += [yc + (R + 0.05) * math.cos(a) for a in np.linspace(0, math.pi, 10)]
    body = RingBody(stations, zt, zb, xb, xt, sill, arches=[(yf, R + 0.005, R + 0.05), (yr, R + 0.005, R + 0.05)], floor=0.26, inner=0.6, crown=0.045, pillar=0.05)

    def tag(y, s, side, i):
        if s in (0, 1, 2) and -0.72 < y < -0.03:
            return "windshield"
        if s in (0, 1, 2) and 0.86 < y < 1.48:
            return "backlight"
        if s in (4, 5):
            if -0.42 < y < 0.30 or 0.39 < y < 1.08:
                return "side"
            if 0.30 < y < 0.39:
                return "bpillar"
        if s >= 11:
            return "under"
        return "paint"

    parts = body.build("shell", tag)
    canv, bounds = car_canvases()
    paintm = tinted_livery("carpaint", canv, bounds, "#eeeeea", "paint", dust=0.12, chips=0.02, scratch=0.06, edge=0.1, grime=0.03, rough=0.2, chip_col="#55504a")
    b.add(parts["paint"], paintm, den=1.9)
    cf, cr = body.caps("cap")
    b.add(cf, paintm, den=1.2)
    b.add(cr, paintm, den=1.2)
    rub = b.mat("rubber", lambda: rubber())
    ch = b.mat("chrome", lambda: chrome())
    blk = b.mat("blackplastic", lambda: plastic("blackplastic", "#141517", rough=0.55, dust=0.25))
    b.add(parts["under"], b.mat("undercoat", lambda: paint("undercoat", "#0f0f10", rough=0.8, dust=0.45, chips=0, scratch=0, edge=0)), den=0.3)
    b.add(parts["bpillar"], b.mat("gloss_black", lambda: paint("gloss_black", "#0d0e10", rough=0.2, dust=0.1, chips=0.02, scratch=0.05, edge=0.1)), den=0.6)
    for key in ("windshield", "backlight", "side"):
        gasket_loops(b, parts[key], 0.0085, rub)
        b.glass(parts[key])

    # ---- interior
    trim = b.mat("trim_int", interior_trim)
    cloth = fabric("seatcloth", "#3f3c38", weave=110.0, dust=0.04, col2="#4f4a43")
    light = fabric("linercloth", "#a9a497", weave=60.0, dust=0.02)
    b.add(rbox("firewall", (1.5, 0.03, 0.62), (0, -0.72, 0.60), r=0.005, seg=1), trim, den=0.3)
    b.add(rbox("dash", (1.46, 0.36, 0.18), (0, -0.52, 0.86), r=0.04, seg=1), trim, den=0.6)
    b.add(rbox("centreconsole", (0.2, 0.7, 0.16), (0, -0.2, 0.36), r=0.02, seg=1), trim, den=0.4)
    b.add(rbox("cluster", (0.3, 0.08, 0.1), (-0.33, -0.35, 0.95), r=0.02, seg=1), blk, den=0.4)
    for s in (1, -1):
        b.add(rbox("doorcard", (0.04, 1.5, 0.56), (s * 0.79, 0.27, 0.66), r=0.012, seg=1), trim, den=0.4)
    b.add(rbox("parcel", (1.46, 0.45, 0.03), (0, 1.26, 0.97), r=0.006, seg=1), trim, den=0.3)
    b.add(rbox("rearwall", (1.5, 0.03, 0.72), (0, 1.1, 0.62), r=0.006, seg=1), trim, den=0.25)
    b.add(rbox("carpet", (1.5, 1.85, 0.015), (0, 0.2, 0.275), r=0.003, seg=1), fabric("carpet", "#29282a", weave=120, dust=0.3), den=0.35)
    lrows = [[p + V3(0, 0, -0.018) for p in body.rows[i][:4]] for i in range(len(body.st)) if -0.05 <= body.st[i] <= 0.87]
    lrows = [list(reversed([V3(-p.x, p.y, p.z) for p in r[1:]])) + r for r in lrows]
    b.add(orient_out(grid("liner", lrows), (0, 0.4, 2.0)), light, den=0.35)

    def seat(x, y, z):
        b.add(rbox("cu", (0.5, 0.5, 0.13), (x, y, z), r=0.045, seg=1), cloth, den=0.55)
        b.add(rbox("ba", (0.48, 0.13, 0.52), (x, y + 0.27, z + 0.3), rot=(math.radians(14), 0, 0), r=0.045, seg=1), cloth, den=0.55)

    seat(-0.33, 0.05, 0.37)
    seat(0.33, 0.05, 0.37)
    b.add(rbox("headr", (0.22, 0.09, 0.14), (-0.33, 0.42, 0.97), r=0.03, seg=1), cloth, den=0.4)
    b.add(rbox("headl", (0.22, 0.09, 0.14), (0.33, 0.42, 0.97), r=0.03, seg=1), cloth, den=0.4)
    b.add(rbox("rbench", (1.36, 0.46, 0.14), (0, 0.84, 0.36), r=0.045, seg=1), cloth, den=0.55)
    b.add(rbox("rback", (1.36, 0.12, 0.52), (0, 1.07, 0.66), rot=(math.radians(14), 0, 0), r=0.04, seg=1), cloth, den=0.55)
    steering_wheel(b, (-0.33, -0.27, 0.86), r=0.17, tilt=24)
    b.empty("seat_driver", (-0.33, 0.1, 0.47))
    b.empty("seat_p1", (0.33, 0.1, 0.47))
    b.empty("seat_p2", (-0.33, 0.85, 0.46))
    b.empty("seat_p3", (0.33, 0.85, 0.46))
    b.empty("exit_L", (1.25, 0.1, 0))
    b.empty("exit_R", (-1.25, 0.1, 0))

    # ---- front: conformal lamps, grille, intake
    bright = b.mat("reflector", lambda: reflector())
    for s in (1, -1):
        out = [(s * a, c) for a, c in curve([(0.40, 0.655), (0.415, 0.725), (0.62, 0.765), (0.79, 0.775), (0.83, 0.725), (0.76, 0.665), (0.56, 0.645)], 2, closed=True)]
        edge = conform_lamp(b, body, f"head{s}", out, "y+", back_mat=bright, gasket=blk, clear=True, off_lens=0.018, den=1.2)
        # two flat projector rings between the backing and the lens
        for cx, r in ((0.5, 0.042), (0.665, 0.05)):
            loc, nrm = body.hit(V3(s * cx, -8, 0.71), V3(0, 1, 0))
            if loc:
                b.add(lathe("proj", [(-0.012, r), (-0.012, r * 0.72), (-0.008, r * 0.55), (-0.008, 0.0)], 12, loc, axis="y"), ch, den=0.5)
        b.empty("light_FL" if s > 0 else "light_FR", (s * 0.6, -2.16, 0.72))
        amber = [(s * a, c) for a, c in rrect(0.16, 0.05, 0.02, n=2, cx=0.62, cy=0.585)]
        conform_lamp(b, body, f"ind{s}", amber, "y+", lens_mat=b.mat("lens_amber", lambda: lens_amber()), gasket=blk, den=0.5, rows=1)
        fog = [(s * (0.62 + 0.055 * math.cos(a)), 0.41 + 0.05 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
        conform_lamp(b, body, f"fog{s}", fog, "y+", back_mat=bright, gasket=blk, clear=True, den=0.5, rows=2)
    # grille
    gr = rrect(0.72, 0.105, 0.04, n=3, cy=0.70)
    grm = paint("grille", "#101112", rough=0.45, dust=0.25, chips=0.02, scratch=0.05, edge=0.1)
    gedge = conform_lamp(b, body, "grille", gr, "y+", back_mat=grm, den=0.9)
    b.tube(gedge, 0.009, ch, seg=5, closed=True, den=0.45)
    for z in (0.675, 0.70, 0.725):
        hit, _ = body.hit(V3(0, -8, z), V3(0, 1, 0))
        if hit:
            b.add(rbox("gbar", (0.66, 0.012, 0.01), (0, hit.y - 0.012, z), r=0.003, seg=1), ch, den=0.35)
    intake = conform_lamp(b, body, "intake", rrect(0.86, 0.1, 0.035, n=3, cy=0.405), "y+", back_mat=grm, den=0.7)
    b.tube(intake, 0.006, blk, seg=4, closed=True, den=0.25)
    hitp, _ = body.hit(V3(0, -8, 0.50), V3(0, 1, 0))
    b.empty("plate_F", (0, hitp.y - 0.012, 0.515))
    b.add(rbox("platefbkt", (0.36, 0.012, 0.13), (0, hitp.y - 0.004, 0.515), r=0.003, seg=1), blk, den=0.2)

    # ---- rear: wrap-around lamps
    lred = b.mat("lens_red", lambda: lens_red())
    for s in (1, -1):
        out = [(s * a, c) for a, c in curve([(0.42, 0.89), (0.66, 0.925), (0.78, 0.915), (0.79, 0.80), (0.62, 0.76), (0.42, 0.79)], 2, closed=True)]
        conform_lamp(b, body, f"tail{s}", out, "y-", lens_mat=lred, gasket=blk, den=1.0)
        amb = [(s * a, c) for a, c in rrect(0.11, 0.07, 0.015, n=1, cx=0.52, cy=0.84)]
        conform_lamp(b, body, f"tailind{s}", amb, "y-", lens_mat=b.mat("lens_amber", lambda: lens_amber()), off_back=0.007, den=0.35, rows=1)
        wht = [(s * a, c) for a, c in rrect(0.09, 0.07, 0.015, n=1, cx=0.66, cy=0.85)]
        conform_lamp(b, body, f"tailrev{s}", wht, "y-", lens_mat=b.mat("lens_white", lambda: lens_red("lens_white", "#d7d9db")), off_back=0.007, den=0.35, rows=1)
        b.empty("light_RL" if s > 0 else "light_RR", (s * 0.62, 2.15, 0.85))
        hitr, _ = body.hit(V3(s * 0.6, 8, 0.44), V3(0, -1, 0))
        if hitr:
            b.add(rbox("refl", (0.14, 0.008, 0.03), (s * 0.6, hitr.y + 0.003, 0.44), r=0.003, seg=1), lred, den=0.25)
    hitp, _ = body.hit(V3(0, 8, 0.70), V3(0, -1, 0))
    b.empty("plate_R", (0, hitp.y + 0.012, 0.70))
    b.add(rbox("platerbkt", (0.36, 0.012, 0.17), (0, hitp.y + 0.003, 0.70), r=0.003, seg=1), blk, den=0.2)
    b.tube([(-0.5, 2.0, 0.30), (-0.5, 2.27, 0.30)], 0.028, ch, seg=8, den=0.35)
    b.add(rbox("rearapron", (1.3, 0.06, 0.1), (0, 2.1, 0.34), r=0.012, seg=1), blk, den=0.3)

    # ---- body details: mirrors, handles, wipers, aerial, side skirts
    def sidepieces(s):
        car_mirror(b, s * 0.84, -0.40, 0.985, s, paintm)
        for y in (0.1, 0.84):
            hit, _ = body.hit(V3(s * 2, y, 0.86), V3(-s, 0, 0))
            if hit:
                b.add(rbox("handle", (0.018, 0.13, 0.024), (hit.x + s * 0.008, y, 0.86), r=0.006, seg=1), ch, den=0.3)
        b.add(rbox("skirt", (0.03, 2.1, 0.04), (s * 0.82, -0.05, 0.285), r=0.008, seg=1), blk, den=0.3)
        b.add(lathe("ind", [(-0.005, 0.0), (-0.005, 0.02), (0.005, 0.016), (0.008, 0.0)], 8, (s * 0.848, -1.0, 0.76)), b.mat("lens_amber", lambda: lens_amber()), den=0.2)

    b.both(sidepieces)
    for x0 in (-0.36, 0.30):
        b.tube([(x0, -0.70, 0.985), (x0 + 0.05, -0.655, 0.99), (x0 - 0.30, -0.615, 1.035)], 0.0045, blk, seg=4, den=0)
    b.tube([(-0.5, 0.95, 1.39), (-0.5, 1.15, 1.62)], 0.0028, blk, seg=3, den=0, caps=False)

    def car_wheel(bb, c):
        wheel_alloy(bb, c, R, 0.185, 0.178, spokes=5, seg=28, den=1.5, lugs=34)

    b.add_wheels([("wheel_FL", (tx, yf, R), False), ("wheel_RL", (tx, yr, R), False), ("wheel_FR", (-tx, yf, R), True), ("wheel_RR", (-tx, yr, R), True)], car_wheel)
    b.variant("white", {"paint": "#eeeeea"})
    b.variant("silver", {"paint": "#b3b6ba"})
    b.variant("red", {"paint": "#a3121c"})
    b.variant("black", {"paint": "#121316"})
    b.variant("taxi", {"paint": "#efb90c"})


def gap_canvases(prefix, B, side_lines, top_lines=(), front_lines=(), rear_lines=(), side_extra=None, width=2048):
    """Multiply mask plus groove height for a van or cab. Lines are polylines in world units:
    side (y, z), top (y, x), front and rear (x, z)."""
    y0, y1, x0, x1, z0, z1 = B["y0"], B["y1"], B["x0"], B["x1"], B["z0"], B["z1"]
    H = int(width * (z1 - z0) / (y1 - y0))
    side = Canvas(width, H, "#ffffff")
    side.height[:] = 0.5
    U = lambda y: (y - y0) / (y1 - y0) * width
    V = lambda z: (1 - (z - z0) / (z1 - z0)) * H
    for ln in side_lines:
        seam(side, [(U(a), V(b_)) for a, b_ in ln], 3.5)
    if side_extra:
        side_extra(side, U, V)
    TH = int(width * (x1 - x0) / (y1 - y0))
    top = Canvas(width, TH, "#ffffff")
    top.height[:] = 0.5
    Vx = lambda x: (1 - (x - x0) / (x1 - x0)) * TH
    for ln in top_lines:
        seam(top, [(U(a), Vx(b_)) for a, b_ in ln], 3.5)
    FW = 1024
    FH = int(FW * (z1 - z0) / (x1 - x0))
    front = Canvas(FW, FH, "#ffffff")
    rear = Canvas(FW, FH, "#ffffff")
    front.height[:] = 0.5
    rear.height[:] = 0.5
    Ux = lambda x: (x - x0) / (x1 - x0) * FW
    Vf = lambda z: (1 - (z - z0) / (z1 - z0)) * FH
    for ln in front_lines:
        seam(front, [(Ux(a), Vf(b_)) for a, b_ in ln], 3.5)
    for ln in rear_lines:
        seam(rear, [(Ux(a), Vf(b_)) for a, b_ in ln], 3.5)
    return dict(side=side.to_image(prefix + "_side"), side_h=side.height_image(prefix + "_side_h"), front=front.to_image(prefix + "_front"), front_h=front.height_image(prefix + "_front_h"), rear=rear.to_image(prefix + "_rear"), rear_h=rear.height_image(prefix + "_rear_h"), top=top.to_image(prefix + "_top"), top_h=top.height_image(prefix + "_top_h"))


@vehicle
def build_microbus(b):
    R = 0.30
    yf, yr, tx = -1.42, 1.18, 0.72
    b.spec = dict(wheelbase=round(yr - yf, 3), wheelRadius=R, seatPose="sit_drive", glass_alpha=0.2, width=1.72)
    b.preview = dict(target=(0, 0.0, 0.9), distance=8.2, height=0.9)
    b.tex = 1024
    b.ao_distance = 0.55
    Y0, Y1 = -2.35, 2.35
    zt = table([(Y0, 0.86), (-2.33, 0.92), (-2.27, 0.99), (-2.15, 1.045), (-1.82, 1.145), (-1.75, 1.17), (-1.4, 1.58), (-1.02, 1.985), (-0.75, 2.07), (0.0, 2.1), (1.5, 2.085), (2.18, 2.05), (2.3, 1.95), (2.34, 1.5), (Y1, 1.32)])
    zb = table([(Y0, 0.84), (-2.25, 0.95), (-1.75, 1.13), (-1.0, 1.2), (0.5, 1.22), (2.2, 1.24), (2.32, 1.2), (Y1, 1.1)])
    xb = table([(Y0, 0.6), (-2.32, 0.72), (-2.2, 0.80), (-1.9, 0.84), (-1.2, 0.855), (1.8, 0.855), (2.2, 0.84), (2.3, 0.78), (Y1, 0.7)])
    xt = table([(Y0, 0.5), (-2.25, 0.68), (-1.75, 0.76), (-1.02, 0.70), (0.0, 0.70), (2.18, 0.70), (2.3, 0.68), (Y1, 0.58)])
    sill = table([(Y0, 0.42), (-2.25, 0.34), (-1.8, 0.31), (1.6, 0.31), (2.1, 0.36), (Y1, 0.42)])
    windows = [(-1.34, -0.56), (-0.44, 0.40), (0.48, 1.26), (1.34, 2.14)]
    stations = [Y0, -2.335, -2.3, -2.25, -2.18, -2.05, -1.82, -1.75, -1.4, -1.34, -1.02, -0.75, -0.56, -0.44, 0.0, 0.40, 0.48, 0.9, 1.26, 1.34, 1.74, 2.14, 2.18, 2.22, 2.28, 2.32, Y1]
    for yc in (yf, yr):
        stations += [yc + (R + 0.055) * math.cos(a) for a in np.linspace(0, math.pi, 10)]
    body = RingBody(stations, zt, zb, xb, xt, sill, arches=[(yf, R + 0.005, R + 0.055), (yr, R + 0.005, R + 0.055)], floor=0.3, inner=0.62, crown=0.05, pillar=0.055, belt_in=0.03)

    def tag(y, s, side, i):
        if s in (0, 1, 2) and -1.74 < y < -1.02:
            return "windshield"
        if s in (0, 1, 2) and 2.24 < y < 2.345:
            return "backlight"
        if s in (4, 5):
            for a, c in windows:
                if a < y < c:
                    return "side"
            if -0.56 < y < -0.44:
                return "bpillar"
        if s >= 11:
            return "under"
        return "paint"

    parts = body.build("shell", tag)
    B = dict(y0=-2.4, y1=2.4, x0=-0.95, x1=0.95, z0=0.2, z1=2.2)

    def extras(cv, U, V):
        cv.rect(U(-1.05), V(0.62), U(0.9), V(0.585), "#26282a", alpha=0.9)
        cv.rect(U(1.55), V(0.62), U(2.3), V(0.585), "#26282a", alpha=0.9)
        cv.rect(U(-0.5), V(1.0), U(0.5), V(0.985), "#26282a", alpha=0.25)
        # slide-door rail
        cv.rect(U(0.42), V(0.99), U(1.4), V(0.955), "#141516", alpha=0.95)
        cv.circle(U(1.55), V(0.93), 15, "#ffffff")
        cv.ring(U(1.55), V(0.93), 15, 2.2, "#222222")

    canv = gap_canvases("van", B,
        side_lines=[[(-1.40, 1.24), (-1.42, 0.8), (-1.2, 0.36)], [(-0.5, 1.26), (-0.5, 0.34)], [(-1.2, 0.36), (-0.5, 0.34)], [(-0.5, 0.34), (0.44, 0.34)], [(0.44, 1.26), (0.44, 0.34)],
                    [(-1.8, 1.13), (-2.28, 0.97)], [(-1.84, 0.56), (-2.35, 0.56)], [(1.58, 0.6), (2.35, 0.6)], [(2.2, 1.24), (2.22, 0.62)]],
        top_lines=[[(-2.28, -0.62), (-1.8, -0.72)], [(-2.28, 0.62), (-1.8, 0.72)], [(-1.8, -0.72), (-1.8, 0.72)]] + [[(-0.75, x), (2.1, x)] for x in (-0.62, -0.48, -0.32, -0.16, 0.0, 0.16, 0.32, 0.48, 0.62)],
        front_lines=[[(-0.9, 0.58), (0.9, 0.58)]],
        rear_lines=[[(-0.72, 1.9), (-0.72, 0.62), (0.72, 0.62), (0.72, 1.9)], [(-0.9, 0.6), (0.9, 0.6)]],
        side_extra=extras)
    paintm = tinted_livery("vanpaint", canv, B, "#eeeeea", "paint", dust=0.14, chips=0.03, scratch=0.08, edge=0.12, grime=0.04, rough=0.24, chip_col="#55504a")
    b.add(parts["paint"], paintm, den=1.9)
    cf, cr = body.caps("cap")
    b.add(cf, paintm, den=1.1)
    b.add(cr, paintm, den=1.1)
    rub = b.mat("rubber", lambda: rubber())
    ch = b.mat("chrome", lambda: chrome())
    blk = b.mat("blackplastic", lambda: plastic("blackplastic", "#141517", rough=0.55, dust=0.25))
    b.add(parts["under"], b.mat("undercoat", lambda: paint("undercoat", "#0f0f10", rough=0.8, dust=0.45, chips=0, scratch=0, edge=0)), den=0.3)
    b.add(parts["bpillar"], b.mat("gloss_black", lambda: paint("gloss_black", "#0d0e10", rough=0.2, dust=0.1, chips=0.02, scratch=0.05, edge=0.1)), den=0.5)
    for key in ("windshield", "backlight", "side"):
        gasket_loops(b, parts[key], 0.0095, rub)
        b.glass(parts[key])

    # ---- interior
    trim = b.mat("trim_int", interior_trim)
    cloth = fabric("seatcloth", "#4a4640", weave=100.0, dust=0.04, col2="#5a5349")
    light = fabric("linercloth", "#b5b0a2", weave=50.0, dust=0.02)
    b.add(rbox("firewall", (1.56, 0.03, 0.8), (0, -1.76, 0.72), r=0.005, seg=1), trim, den=0.25)
    b.add(rbox("dash", (1.54, 0.42, 0.22), (0, -1.5, 1.05), r=0.05, seg=2), trim, den=0.55)
    b.add(rbox("doghouse", (0.5, 0.75, 0.4), (0, -1.2, 0.66), r=0.05, seg=1), trim, den=0.3)
    for sd in (1, -1):
        b.add(rbox("wallcard", (0.03, 3.9, 0.82), (sd * 0.81, 0.15, 0.82), r=0.008, seg=1), trim, den=0.3)
    b.add(rbox("floorv", (1.58, 4.1, 0.02), (0, 0.15, 0.345), r=0.004, seg=1), fabric("carpet", "#2a2a2c", weave=100, dust=0.3), den=0.3)
    lrows = [[p + V3(0, 0, -0.022) for p in body.rows[i][:4]] for i in range(len(body.st)) if -1.03 <= body.st[i] <= 2.19]
    lrows = [list(reversed([V3(-p.x, p.y, p.z) for p in r[1:]])) + r for r in lrows]
    b.add(orient_out(grid("liner", lrows), (0, 0.4, 3.0)), light, den=0.3)

    def seat(x, y, z, w=0.52):
        b.add(rbox("cu", (w, 0.48, 0.13), (x, y, z), r=0.04, seg=1), cloth, den=0.5)
        b.add(rbox("ba", (w - 0.02, 0.12, 0.6), (x, y + 0.27, z + 0.34), rot=(math.radians(10), 0, 0), r=0.04, seg=1), cloth, den=0.5)
        b.add(rbox("he", (0.26, 0.09, 0.15), (x, y + 0.345, z + 0.72), r=0.03, seg=1), cloth, den=0.3)

    seat(-0.40, -0.72, 0.68)
    seat(0.40, -0.72, 0.68)
    for y, xs in ((0.1, (-0.46, 0.0, 0.46)), (1.0, (-0.46, 0.0, 0.46)), (1.72, (-0.46, 0.0, 0.46))):
        for x in xs:
            seat(x, y, 0.62, w=0.44)
    steering_wheel(b, (-0.40, -1.12, 1.08), r=0.185, tilt=28)
    b.empty("seat_driver", (-0.40, -0.68, 0.78))
    b.empty("seat_p1", (0.40, -0.68, 0.78))
    b.empty("seat_p2", (-0.46, 0.14, 0.72))
    b.empty("seat_p3", (0.46, 0.14, 0.72))
    b.empty("exit_L", (1.25, -0.68, 0))
    b.empty("exit_R", (-1.25, -0.68, 0))
    # route board inside the top of the windscreen
    hit, _ = body.hit(V3(0, -8, 1.82), V3(0, 1, 0))
    b.empty("route_F", (0, hit.y + 0.03, 1.82))
    b.add(rbox("routeboard", (1.26, 0.012, 0.27), (0, hit.y + 0.05, 1.82), r=0.003, seg=1), blk, den=0.25)

    # ---- front
    bright = b.mat("reflector", lambda: reflector())
    grm = paint("grille", "#101112", rough=0.45, dust=0.25, chips=0.02, scratch=0.05, edge=0.1)
    for s in (1, -1):
        out = [(s * a, c) for a, c in rrect(0.30, 0.17, 0.035, n=3, cx=0.60, cy=0.86)]
        conform_lamp(b, body, f"head{s}", out, "y+", back_mat=bright, gasket=blk, clear=True, off_lens=0.016, den=1.2)
        loc, _ = body.hit(V3(s * 0.56, -8, 0.86), V3(0, 1, 0))
        if loc:
            b.add(lathe("proj", [(-0.011, 0.055), (-0.011, 0.04), (-0.007, 0.03), (-0.007, 0.0)], 12, loc, axis="y"), ch, den=0.5)
        amber = [(s * a, c) for a, c in rrect(0.12, 0.07, 0.02, n=2, cx=0.70, cy=0.68)]
        conform_lamp(b, body, f"ind{s}", amber, "y+", lens_mat=b.mat("lens_amber", lambda: lens_amber()), gasket=blk, den=0.5, rows=1)
        b.empty("light_FL" if s > 0 else "light_FR", (s * 0.6, -2.34, 0.86))
    gedge = conform_lamp(b, body, "grille", rrect(0.78, 0.14, 0.03, n=2, cy=0.86), "y+", back_mat=grm, den=0.8)
    b.tube(gedge, 0.009, ch, seg=5, closed=True, den=0.4)
    for z in (0.82, 0.86, 0.90):
        hit, _ = body.hit(V3(0, -8, z), V3(0, 1, 0))
        if hit:
            b.add(rbox("gbar", (0.72, 0.012, 0.012), (0, hit.y - 0.012, z), r=0.003, seg=1), ch, den=0.3)
    hit, _ = body.hit(V3(0, -8, 0.48), V3(0, 1, 0))
    b.add(rbox("bumper", (1.6, 0.14, 0.2), (0, hit.y + 0.015, 0.47), r=0.035, seg=2), b.mat("bumperg", lambda: plastic("bumperg", "#55585c", rough=0.5, dust=0.35)), den=0.6)
    b.empty("plate_F", (0, hit.y - 0.062, 0.47))
    intake = conform_lamp(b, body, "intake", rrect(1.0, 0.09, 0.03, n=2, cy=0.68), "y+", back_mat=grm, den=0.4, rows=1)

    # ---- rear
    lred = b.mat("lens_red", lambda: lens_red())
    for s in (1, -1):
        out = [(s * a, c) for a, c in rrect(0.13, 0.42, 0.03, n=2, cx=0.73, cy=1.0)]
        conform_lamp(b, body, f"tail{s}", out, "y-", lens_mat=lred, gasket=blk, den=0.9)
        amb = [(s * a, c) for a, c in rrect(0.10, 0.1, 0.015, n=1, cx=0.73, cy=1.13)]
        conform_lamp(b, body, f"tailind{s}", amb, "y-", lens_mat=b.mat("lens_amber", lambda: lens_amber()), off_back=0.007, den=0.3, rows=1)
        b.empty("light_RL" if s > 0 else "light_RR", (s * 0.73, 2.36, 1.0))
    hit, _ = body.hit(V3(0, 8, 0.8), V3(0, -1, 0))
    b.empty("plate_R", (0, hit.y + 0.012, 0.8))
    b.add(rbox("platerbkt", (0.36, 0.012, 0.17), (0, hit.y + 0.003, 0.8), r=0.003, seg=1), blk, den=0.2)
    hit, _ = body.hit(V3(0, 8, 0.48), V3(0, -1, 0))
    b.add(rbox("rbumper", (1.6, 0.12, 0.18), (0, hit.y - 0.01, 0.46), r=0.03, seg=2), b.mat("bumperg", lambda: plastic("bumperg", "#55585c", rough=0.5, dust=0.35)), den=0.5)
    b.tube([(0.52, 2.2, 0.3), (0.52, 2.42, 0.3)], 0.028, ch, seg=8, den=0.3)
    b.add(rbox("hatchhandle", (0.22, 0.02, 0.05), (0, 2.355, 1.28), r=0.008, seg=1), ch, den=0.3)

    # ---- sides: mirrors, handles, roof rails, wipers
    def sides(s):
        b.tube([(s * 0.83, -1.38, 1.2), (s * 0.98, -1.42, 1.28)], 0.012, blk, seg=5, den=0.25)
        b.add(rbox("mir", (0.11, 0.05, 0.21), (s * 1.02, -1.42, 1.28), r=0.02, seg=2), blk, den=0.5)
        for y in (-0.7, 0.3):
            hit, _ = body.hit(V3(s * 2, y, 0.98), V3(-s, 0, 0))
            if hit:
                b.add(rbox("handle", (0.022, 0.15, 0.028), (hit.x + s * 0.01, y, 0.98), r=0.007, seg=1), ch, den=0.3)
        for y in (-0.5, 0.75, 1.95):
            b.add(rbox("rrf", (0.05, 0.08, 0.05), (s * 0.60, y, 2.095), r=0.01, seg=1), blk, den=0.2)
        b.tube([(s * 0.60, -0.55, 2.12), (s * 0.60, 2.05, 2.12)], 0.013, st_m, seg=5, den=0.3)
        b.add(rbox("step", (0.14, 1.1, 0.03), (s * 0.88, -0.75, 0.36), r=0.008, seg=1), blk, den=0.25)

    st_m = b.mat("steel", lambda: steel())
    b.both(sides)
    for x0 in (-0.46, 0.18):
        b.tube([(x0, -1.75, 1.2), (x0 + 0.05, -1.72, 1.205), (x0 - 0.28, -1.62, 1.33)], 0.0048, blk, seg=4, den=0)

    def van_wheel(bb, c):
        wheel_truck(bb, c, R, 0.19, 0.178, bolts=5, seg=24, den=1.4, disc_col="#d7d8d6", lugs=30, holes=6)

    b.add_wheels([("wheel_FL", (tx, yf, R), False), ("wheel_RL", (tx, yr, R), False), ("wheel_FR", (-tx, yf, R), True), ("wheel_RR", (-tx, yr, R), True)], van_wheel)
    b.variant("white", {"paint": "#eeeeea"})
    b.variant("silver", {"paint": "#aeb1b5"})


# ---------------------------------------------------------------------------
# Dhaka local bus
# ---------------------------------------------------------------------------

BUS_PALETTES = {
    "default": dict(low="#c5151c", band="#0c7a3b", top="#f3efe2", trim="#f4c20d", pillar="#1b1c1e", sw1="#f3efe2", sw2="#f4c20d", sw3="#0c7a3b"),
    "blue": dict(low="#1450a6", band="#f2bf0d", top="#efefe8", trim="#e0231f", pillar="#17191d", sw1="#efefe8", sw2="#e0231f", sw3="#f2bf0d"),
    "yellow": dict(low="#efb00d", band="#b3121a", top="#f6f1dc", trim="#0d6f3a", pillar="#1b1c1e", sw1="#b3121a", sw2="#f6f1dc", sw3="#0d6f3a"),
}
BUS_B = dict(y0=-4.85, y1=4.85, x0=-1.3, x1=1.3, z0=0.0, z1=3.25)


def _bus_side(pal, W=3072, seed=4):
    B = BUS_B
    H = int(W * (B["z1"] - B["z0"]) / (B["y1"] - B["y0"]))
    U = lambda y: (y - B["y0"]) / (B["y1"] - B["y0"]) * W
    V = lambda z: (1 - (z - B["z0"]) / (B["z1"] - B["z0"])) * H
    cv = Canvas(W, H, pal["top"])
    cv.height[:] = 0.5
    rng = np.random.default_rng(seed)
    cv.rect(0, V(1.16), W, H, pal["low"])
    cv.rect(0, V(1.34), W, V(1.16), pal["band"])
    cv.rect(0, V(1.40), W, V(1.34), pal["trim"])
    cv.rect(0, V(2.68), W, V(1.46), pal["pillar"])
    cv.rect(0, V(2.9), W, V(2.68), pal["band"])
    cv.rect(0, V(2.94), W, V(2.9), pal["trim"])
    # the long swoosh along the lower body, three bold ribbons
    def ribbon(y0, y1, z0, amp, thick, col, phase=0.0):
        n = 40
        top = [(U(y0 + (y1 - y0) * i / n), V(z0 + amp * math.sin(i / n * 3.3 + phase) + thick * 0.5 * (1 - abs(2 * i / n - 1)) ** 0.5)) for i in range(n + 1)]
        bot = [(U(y0 + (y1 - y0) * i / n), V(z0 + amp * math.sin(i / n * 3.3 + phase) - thick * 0.5 * (1 - abs(2 * i / n - 1)) ** 0.5)) for i in reversed(range(n + 1))]
        cv.poly(top + bot, col)

    ribbon(-3.2, 4.8, 0.86, 0.18, 0.34, pal["sw1"])
    ribbon(-2.6, 4.8, 0.88, 0.18, 0.2, pal["sw2"], phase=0.15)
    ribbon(-1.8, 4.8, 0.90, 0.18, 0.09, pal["sw3"], phase=0.3)
    # bold diagonal chevrons behind the front door
    for i in range(4):
        y = -3.3 + i * 0.26
        cv.poly([(U(y), V(1.14)), (U(y + 0.13), V(1.14)), (U(y + 0.34), V(0.56)), (U(y + 0.21), V(0.56))], pal["sw2"] if i % 2 else pal["sw1"], alpha=0.95)
    # folk flowers on the rear quarter and a painted sun
    for y, z, r, c in ((3.95, 1.0, 40, pal["sw2"]), (4.28, 0.84, 30, pal["sw1"]), (4.45, 1.06, 26, pal["trim"]), (3.62, 0.74, 28, "#ff2d86")):
        cv.flower(U(y), V(z), r, 8, c, "#ffffff", "#c9142a", outline="#1a0d12")
    cv.leaf_spray(U(3.95), V(1.0), -0.5, 3, 80, 26)
    # panel joints with rivet lines
    for y in (-3.42, -2.50, -1.58, -0.66, 0.26, 1.18, 2.10, 3.02, 3.94):
        seam(cv, [(U(y), V(1.44)), (U(y), V(0.52))], 2.4)
        for z in np.arange(0.58, 1.42, 0.08):
            cv.circle(U(y - 0.018), V(z), 2.4, "#ffffff", alpha=0.45)
            cv.circle(U(y + 0.018), V(z), 2.4, "#111111", alpha=0.35)
    seam(cv, [(0, V(1.16)), (W, V(1.16))], 2.4)
    seam(cv, [(0, V(0.86)), (W, V(0.86))], 2.0)
    seam(cv, [(0, V(2.68)), (W, V(2.68))], 2.4)
    # hard life: repainted patches, scrapes, rust streaks, road grime
    for _ in range(9):
        y = rng.uniform(-4.4, 4.4)
        z = rng.uniform(0.62, 1.06)
        w, h = rng.uniform(0.2, 0.6), rng.uniform(0.1, 0.26)
        base = np.array(srgb(pal["low"]))
        cv.rect(U(y), V(z + h), U(y + w), V(z), tuple(np.clip(base * rng.uniform(0.82, 1.16), 0, 1)), alpha=0.8)
    for _ in range(38):
        y = rng.uniform(-4.6, 4.6)
        z = rng.uniform(0.56, 1.42)
        ln = rng.uniform(0.15, 1.1)
        c = "#d8d5cc" if rng.random() < 0.65 else "#2a2522"
        cv.stroke([(U(y), V(z)), (U(y + ln * 0.5), V(z + rng.uniform(-0.01, 0.01))), (U(y + ln), V(z + rng.uniform(-0.03, 0.03)))], rng.uniform(1.0, 3.2), c, alpha=rng.uniform(0.35, 0.8))
    for _ in range(60):
        y = rng.uniform(-4.6, 4.6)
        z = rng.uniform(0.9, 1.46)
        cv.stroke([(U(y), V(z)), (U(y + rng.uniform(-0.01, 0.01)), V(z - rng.uniform(0.08, 0.34)))], rng.uniform(1.5, 6.0), "#3e2413", width_end=0.6, alpha=rng.uniform(0.25, 0.6))
    for _ in range(46):
        y = rng.uniform(-4.7, 4.7)
        z = rng.uniform(0.56, 1.3)
        cv.ellipse(U(y), V(z), rng.uniform(2, 9), rng.uniform(2, 7), "#47321f", alpha=rng.uniform(0.5, 0.9))
    # dents in the height map
    yy, xx = np.mgrid[0:H, 0:W]
    for _ in range(26):
        cx, cy = rng.uniform(0, W), V(rng.uniform(0.6, 1.4))
        rx, ry = rng.uniform(16, 90), rng.uniform(12, 44)
        g = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2))
        cv.height -= (0.34 * g).astype(np.float32)
        cv.c *= (1 - 0.14 * g)[..., None]
    cv.speckle(0.03, seed=seed)
    return cv


def _bus_end(pal, front=True, seed=6, W=1024):
    B = BUS_B
    H = int(W * (B["z1"] - B["z0"]) / (B["x1"] - B["x0"]))
    U = lambda x: (x - B["x0"]) / (B["x1"] - B["x0"]) * W
    V = lambda z: (1 - (z - B["z0"]) / (B["z1"] - B["z0"])) * H
    cv = Canvas(W, H, pal["top"])
    cv.height[:] = 0.5
    rng = np.random.default_rng(seed)
    cv.rect(0, V(1.16), W, H, pal["low"])
    cv.rect(0, V(1.34), W, V(1.16), pal["band"])
    cv.rect(0, V(1.40), W, V(1.34), pal["trim"])
    cv.rect(0, V(2.9), W, V(2.62), pal["band"])
    cv.rect(0, V(2.94), W, V(2.9), pal["trim"])
    if front:
        # chevrons down the nose
        for i in range(3):
            d = i * 0.13
            cv.poly([(U(-0.9 + d), V(1.3)), (U(-0.75 + d), V(1.3)), (U(0.0), V(0.84 + d * 0.6)), (U(0.75 - d), V(1.3)), (U(0.9 - d), V(1.3)), (U(0.0), V(0.70 + d * 0.6))], pal["sw2"] if i % 2 else pal["sw1"])
        cv.flower(U(0), V(1.24), 34, 8, pal["trim"], "#ffffff", "#c9142a", outline="#1a0d12")
    else:
        for i in range(5):
            x = -1.05 + i * 0.525
            cv.poly([(U(x - 0.18), V(1.14)), (U(x + 0.18), V(1.14)), (U(x + 0.05), V(0.6)), (U(x - 0.05), V(0.6))], pal["sw2"] if i % 2 else pal["sw1"])
        cv.flower(U(0), V(1.0), 70, 9, pal["sw2"], "#ffffff", "#c9142a", outline="#1a0d12")
        cv.leaf_spray(U(0), V(1.0), 0.0, 3, 120, 40, spread=0.5)
        cv.leaf_spray(U(0), V(1.0), math.pi, 3, 120, 40, spread=0.5)
        cv.flower(U(0), V(1.0), 70, 9, pal["sw2"], "#ffffff", "#c9142a", outline="#1a0d12")
        seam(cv, [(U(-0.98), V(1.12)), (U(0.98), V(1.12))], 2.6)
    seam(cv, [(0, V(1.16)), (W, V(1.16))], 2.5)
    for _ in range(26):
        x = rng.uniform(-1.2, 1.2)
        z = rng.uniform(0.55, 1.35)
        ln = rng.uniform(0.08, 0.5)
        c = "#d8d5cc" if rng.random() < 0.6 else "#2a2522"
        cv.stroke([(U(x), V(z)), (U(x + ln), V(z + rng.uniform(-0.03, 0.03)))], rng.uniform(1.0, 3.0), c, alpha=rng.uniform(0.35, 0.8))
    for _ in range(24):
        cv.ellipse(U(rng.uniform(-1.2, 1.2)), V(rng.uniform(0.55, 1.3)), rng.uniform(2, 9), rng.uniform(2, 7), "#47321f", alpha=rng.uniform(0.5, 0.9))
    yy, xx = np.mgrid[0:H, 0:W]
    for _ in range(9):
        cx, cy = rng.uniform(0, W), V(rng.uniform(0.6, 1.4))
        rx, ry = rng.uniform(20, 60), rng.uniform(12, 40)
        g = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2))
        cv.height -= (0.34 * g).astype(np.float32)
        cv.c *= (1 - 0.14 * g)[..., None]
    cv.speckle(0.03, seed=seed)
    return cv


def dented_bar(name, x_half, y_mid, z_mid, depth, height, seed=1, curve_back=0.1, n=16):
    """Bumper: a wrap-around steel bar with soft dents pushed into it."""
    rng = np.random.default_rng(seed)
    dents = [(rng.uniform(-x_half, x_half), rng.uniform(-0.5, 0.5), rng.uniform(0.06, 0.2), rng.uniform(0.012, 0.035)) for _ in range(7)]
    section = [(-0.5, -0.9), (-0.5, 0.0), (-0.42, 0.9), (0.0, 1.0), (0.0, -1.0)]
    rows = []
    for i in range(n + 1):
        x = -x_half + 2 * x_half * i / n
        t = (x / x_half) ** 2
        y = y_mid + curve_back * t * t * t
        row = []
        for a, b in section:
            d = 0.0
            for dx, dz, r, amt in dents:
                dist = math.hypot(x - dx, (b * height * 0.5 - dz * height * 0.5))
                d += amt * math.exp(-((dist / r) ** 2))
            row.append(V3(x, y + (a * depth + (d if a < 0 else 0.0)) * (-1 if y_mid < 0 else 1), z_mid + b * height * 0.5))
        rows.append(row)
    return orient_out(grid(name, rows, close_u=True), (0, 0, z_mid))


@vehicle
def build_bus_city(b):
    R = 0.47
    yf, yr, tx = -2.85, 1.95, 0.98
    b.spec = dict(wheelbase=round(yr - yf, 3), wheelRadius=R, seatPose="sit_bus", glass_alpha=0.13, glass_col="#26363a", width=2.42)
    b.preview = dict(target=(0, 0.0, 1.5), distance=15.5, height=1.5)
    b.tex = 2048
    b.tex_detail = 1024
    b.ao_distance = 0.8
    b.quality = 80
    b.chart_cell = 1.7
    Y0, Y1 = -4.75, 4.75
    zt = table([(Y0, 1.32), (-4.74, 1.44), (-4.70, 1.72), (-4.62, 2.24), (-4.56, 2.60), (-4.49, 2.82), (-4.34, 2.95), (-3.8, 3.03), (3.8, 3.03), (4.34, 2.95), (4.5, 2.82), (4.6, 2.56), (4.68, 2.02), (4.735, 1.62), (Y1, 1.5)])
    zb = table([(Y0, 1.26), (-4.68, 1.38), (-4.42, 1.46), (4.42, 1.46), (4.68, 1.40), (Y1, 1.3)])
    xb = table([(Y0, 1.07), (-4.72, 1.13), (-4.6, 1.18), (-4.2, 1.2), (4.2, 1.2), (4.6, 1.18), (4.72, 1.13), (Y1, 1.07)])
    xt = table([(Y0, 1.0), (-4.62, 1.06), (-4.34, 1.09), (-3.8, 1.09), (3.8, 1.09), (4.34, 1.09), (4.62, 1.06), (Y1, 1.0)])
    sill = table([(Y0, 0.56), (-4.5, 0.52), (4.5, 0.54), (Y1, 0.62)])

    def crown(y):
        if -4.5 < y < 4.5:
            return 0.25
        return 0.07 + 0.18 * max(0.0, min(1.0, (abs(y) - 4.34) / -0.16 + 1.0)) if abs(y) < 4.5 else 0.07

    pillars = [-3.42, -2.50, -1.58, -0.66, 0.26, 1.18, 2.10, 3.02, 3.94]
    windows = [(pillars[i] + 0.045, pillars[i + 1] - 0.045) for i in range(len(pillars) - 1)]
    windows.append((3.985, 4.26))
    door1 = (-4.40, -3.50)
    door2 = (3.06, 3.90)
    drv_win = (-4.34, -3.52)
    stations = [Y0, -4.74, -4.70, -4.66, -4.62, -4.56, -4.49, -4.42, -4.34, 4.26, 4.34, 4.42, 4.5, 4.6, 4.68, 4.735, Y1, door1[0], door1[1], door2[0], door2[1], drv_win[0], drv_win[1]]
    for a, c in windows:
        stations += [a, c]
    for yc in (yf, yr):
        stations += [yc + (R + 0.085) * math.cos(a) for a in np.linspace(0, math.pi, 9)]
    body = RingBody(stations, zt, zb, xb, xt, sill, arches=[(yf, R + 0.0, R + 0.085), (yr, R + 0.0, R + 0.085)], floor=0.54, inner=1.0, crown=crown, pillar=0.13, shoulder=0.02, belt_in=0.012, wall_bulge=0.006)

    def tag(y, s, side, i):
        if s in (0, 1, 2) and -4.735 < y < -4.56:
            return "windshield"
        if s in (0, 1, 2) and 4.6 < y < 4.71:
            return "backlight"
        if side > 0 and s in (4, 5, 6, 7, 8, 9, 10):
            if door1[0] < y < door1[1] or door2[0] < y < door2[1]:
                return "door"
        if s in (4, 5):
            for a, c in windows:
                if a < y < c:
                    return "side"
            if side < 0 and drv_win[0] < y < drv_win[1]:
                return "side"
        if s >= 11:
            return "under"
        return "paint"

    parts = body.build("shell", tag)
    bpy.data.objects.remove(parts.pop("door"), do_unlink=True)
    pal = BUS_PALETTES["default"]
    side_cv = _bus_side(pal)
    front_cv = _bus_end(pal, True)
    rear_cv = _bus_end(pal, False)
    canv = dict(side=side_cv.to_image("bus_side"), side_h=side_cv.height_image("bus_side_h"), front=front_cv.to_image("bus_front"), front_h=front_cv.height_image("bus_front_h"), rear=rear_cv.to_image("bus_rear"), rear_h=rear_cv.height_image("bus_rear_h"))
    busp = livery("buspaint", canv, BUS_B, dust=0.42, chips=0.26, scratch=0.34, edge=1.0, chip_col="#4a3a2c", grime=0.3, rough=0.4)
    b.add(parts["paint"], busp, den=1.6)
    cf, cr = body.caps("cap")
    b.add(cf, busp, den=1.1)
    b.add(cr, busp, den=1.1)
    rub = b.mat("rubber", lambda: rubber())
    ch = b.mat("chrome", lambda: chrome(dust=0.3))
    st = b.mat("steel", lambda: steel())
    blk = b.mat("blackplastic", lambda: paint("blackplastic", "#141517", rough=0.55, dust=0.4, chips=0.2, scratch=0.2, edge=0.5, chip_col="#55504a"))
    b.add(parts["under"], b.mat("undercoat", lambda: paint("undercoat", "#141210", rough=0.85, dust=0.6, chips=0, scratch=0, edge=0)), den=0.25)
    for key in ("windshield", "backlight", "side"):
        gasket_loops(b, parts[key], 0.014, rub, den=0.2)
        b.glass(parts[key])

    # centre post of the two-piece windscreen and an upper sliding-pane rail in every window
    hit0, _ = body.hit(V3(0, -8, 1.6), V3(0, 1, 0))
    hit1, _ = body.hit(V3(0, -8, 2.5), V3(0, 1, 0))
    b.tube([hit0 + V3(0, -0.012, 0), hit1 + V3(0, -0.012, 0)], 0.022, rub, seg=5, den=0.3)
    wr = paint("winframe", "#8f9194", rough=0.42, metal=0.8, dust=0.3, chips=0.15, scratch=0.15, edge=0.3)

    def window_bits(s):
        x = s * (body.xb(0) - 0.012)
        for a, c in windows:
            if s > 0 and a > 3.0:
                continue
            b.tube([(x, a, 2.1), (x, c, 2.1)], 0.012, wr, seg=4, den=0)
            b.tube([(x + s * 0.02, a, 1.8), (x + s * 0.02, c, 1.8)], 0.0085, st, seg=4, den=0)
            m = (a + c) / 2
            b.tube([(x, m, 1.47), (x, m, 2.1)], 0.008, wr, seg=4, den=0)

    b.both(window_bits)

    # ---- interior
    trim = b.mat("trim_int", interior_trim)
    wallm = paint("wallcard", "#7f9aa0", rough=0.5, dust=0.2, chips=0.15, scratch=0.25, edge=0.2, chip_col="#3a3f40")
    liner = fabric("linerb", "#d9d5c6", weave=26.0, dust=0.08)
    floorm = paint("busfloor", "#5a4631", rough=0.75, dust=0.7, chips=0.3, scratch=0.5, edge=0.2, chip_col="#2a2118")
    b.add(rbox("floor", (2.3, 9.0, 0.03), (0, 0.0, 0.95), r=0.006, seg=1), floorm, den=0.35)
    b.add(rbox("wall", (0.02, 7.7, 0.5), (-1.17, 0.42, 1.2), r=0.004, seg=1), wallm, den=0.25)
    b.add(rbox("wall", (0.02, 6.44, 0.5), (1.17, -0.2, 1.2), r=0.004, seg=1), wallm, den=0.25)
    b.add(rbox("wall", (0.02, 0.55, 0.5), (1.17, 4.2, 1.2), r=0.004, seg=1), wallm, den=0.15)
    b.add(rbox("wallfront", (0.02, 0.9, 0.5), (-1.17, -3.95, 1.2), r=0.004, seg=1), wallm, den=0.2)
    lrows = [[p + V3(0, 0, -0.03) for p in body.rows[i][:5]] for i in range(len(body.st)) if -4.42 <= body.st[i] <= 4.42]
    keep = [lrows[i] for i in range(0, len(lrows), max(1, len(lrows) // 12))] + [lrows[-1]]
    keep = [list(reversed([V3(-p.x, p.y, p.z) for p in r[1:]])) + r for r in keep]
    b.add(orient_out(grid("linerb", keep), (0, 0.0, 4.5)), liner, den=0.25)
    seat_cols = ["#8c1d22", "#23507f", "#7a6a2b"]
    seatms = [vinyl(f"busseat{i}", c, rough=0.46, dust=0.25) for i, c in enumerate(seat_cols)]
    ys = np.arange(-3.0, 4.2, 0.74)
    for i, y in enumerate(ys):
        for x in (-0.73, 0.73):
            if x > 0 and (door2[0] - 0.5 < y < door2[1]):
                continue
            m = seatms[(i + (x > 0)) % 3]
            b.add(rbox("c", (0.82, 0.42, 0.1), (x, y, 1.26), r=0.025, seg=1), m, den=0.3)
            b.add(rbox("b", (0.82, 0.08, 0.5), (x, y + 0.23, 1.55), rot=(math.radians(8), 0, 0), r=0.025, seg=1), m, den=0.3)
            b.add(bo.box("l", (0.7, 0.04, 0.3), loc=(x, y, 1.06)), st, den=0.15)
    # wheel-house humps, aisle rails and poles
    for yc in (yf, yr):
        for s_ in (1, -1):
            b.add(rbox("hump", (0.42, 1.2, 0.2), (s_ * 0.96, yc, 1.05), r=0.03, seg=1), floorm, den=0.2)
    for x in (-0.32, 0.32):
        b.tube([(x, -3.4, 2.34), (x, 4.2, 2.34)], 0.014, ch, seg=5, den=0.2)
    for y in (-3.3, -1.0, 1.4, 2.9):
        b.tube([(0.32, y, 0.96), (0.32, y, 2.34)], 0.014, ch, seg=5, den=0.2)
    # driver's bay, on the right
    b.add(rbox("drvseat", (0.5, 0.48, 0.12), (-0.68, -3.72, 1.38), r=0.04, seg=1), seatms[1], den=0.4)
    b.add(rbox("drvback", (0.48, 0.1, 0.62), (-0.68, -3.46, 1.74), rot=(math.radians(10), 0, 0), r=0.04, seg=1), seatms[1], den=0.4)
    b.add(rbox("drvbase", (0.36, 0.4, 0.34), (-0.68, -3.72, 1.14), r=0.012, seg=1), st, den=0.2)
    b.add(rbox("doghouse", (0.62, 0.86, 0.44), (0.02, -3.92, 1.18), r=0.06, seg=2), trim, den=0.3)
    b.add(rbox("busdash", (2.26, 0.34, 0.34), (0, -4.45, 1.3), r=0.05, seg=1), trim, den=0.35)
    steering_wheel(b, (-0.68, -4.14, 1.56), r=0.235, tilt=45)
    b.empty("seat_driver", (-0.68, -3.72, 1.48))
    for i, (x, y) in enumerate(((-0.9, -3.0), (-0.53, -3.0), (0.53, -3.0), (0.9, -3.0), (-0.9, -1.52), (0.9, -1.52), (-0.53, 0.70), (0.53, 0.70))):
        b.empty(f"seat_p{i + 1}", (x, y, 1.36))
    b.empty("exit_L", (1.65, -3.95, 0))
    b.empty("exit_R", (-1.65, -3.72, 0))

    # ---- doors: steps, frame, folded leaf, hand rail
    stepm = paint("busstep", "#3a3b3d", rough=0.7, dust=0.7, chips=0.4, scratch=0.5, edge=0.8, chip_col="#7c7468")
    for (a, c) in (door1, door2):
        ym = (a + c) / 2
        for k, (z, dx) in enumerate(((0.62, 1.04), (0.80, 0.86))):
            b.add(rbox("tread", (0.34, c - a - 0.04, 0.03), (dx, ym, z), r=0.006, seg=1), stepm, den=0.25)
            b.add(rbox("riser", (0.02, c - a - 0.04, 0.2), (dx - 0.16, ym, z - 0.1), r=0.003, seg=1), stepm, den=0.15)
        fr = [(1.205, a, 0.6), (1.205, c, 0.6), (1.205, c, 2.62), (1.205, a, 2.62)]
        b.tube(fr, 0.02, rub, seg=5, closed=True, den=0.2)
        b.tube([(1.13, a + 0.1, 0.84), (1.2, a + 0.05, 1.3), (1.18, a + 0.05, 2.2)], 0.014, ch, seg=5, den=0.25)
        b.tube([(1.13, c - 0.1, 0.84), (1.2, c - 0.05, 1.3), (1.18, c - 0.05, 2.2)], 0.014, ch, seg=5, den=0.25)
    # folded door leaf at the front opening, slightly ajar
    leaf_col = paint("leafpaint", "#b8bbb0", rough=0.45, dust=0.5, chips=0.5, scratch=0.5, edge=0.9, chip_col="#4a3a2c", grime=0.5)
    for k in range(2):
        yl = door1[1] - 0.05 - k * 0.04
        xl = 1.13 - k * 0.05
        b.add(rbox("leaf", (0.03, 0.34, 0.88), (xl, yl, 1.08), r=0.006, seg=1), leaf_col, den=0.3)
        b.add(rbox("leaf2", (0.03, 0.34, 0.2), (xl, yl, 2.5), r=0.006, seg=1), leaf_col, den=0.2)
        b.glass(grid("leafg", [[V3(xl, yl - 0.15, 1.55), V3(xl, yl + 0.15, 1.55)], [V3(xl, yl - 0.15, 2.38), V3(xl, yl + 0.15, 2.38)]]))
        b.tube([(xl, yl - 0.16, 1.54), (xl, yl + 0.16, 1.54), (xl, yl + 0.16, 2.4), (xl, yl - 0.16, 2.4)], 0.012, leaf_col, seg=4, closed=True, den=0.2)

    # ---- front end: lamps in bezels, grille, bumper, wipers, route board, mirrors
    bez = paint("bezel", "#111214", rough=0.4, dust=0.35, chips=0.2, scratch=0.15, edge=0.3)
    hitc, _ = body.hit(V3(0, -8, 0.95), V3(0, 1, 0))
    yfront = hitc.y
    for s in (1, -1):
        b.add(rbox("lampbox", (0.56, 0.05, 0.24), (s * 0.72, yfront - 0.01, 1.0), r=0.02, seg=2), bez, den=0.5)
        round_lamp(b, (s * 0.86, yfront - 0.035, 1.0), 0.085, "clear", den=0.8)
        round_lamp(b, (s * 0.60, yfront - 0.035, 1.0), 0.075, "clear", den=0.8)
        round_lamp(b, (s * 0.98, yfront - 0.02, 1.22), 0.045, "amber", den=0.5, bezel=bez)
        b.empty("light_FL" if s > 0 else "light_FR", (s * 0.74, yfront - 0.06, 1.0))
    b.add(rbox("grillebox", (0.78, 0.04, 0.3), (0, yfront - 0.01, 1.02), r=0.02, seg=2), bez, den=0.5)
    for i in range(5):
        b.add(rbox("gbar", (0.72, 0.014, 0.018), (0, yfront - 0.036, 0.91 + i * 0.055), r=0.004, seg=1), ch, den=0.25)
    bum = paint("busbumper", "#f4c20d", rough=0.46, dust=0.5, chips=0.55, scratch=0.65, edge=1.0, chip_col="#3a3026", grime=0.5, slot="bumper")
    b.add(dented_bar("bumper", 1.13, yfront - 0.05, 0.66, 0.12, 0.26, seed=3), bum, den=0.95)
    b.add(rbox("bumpbk", (2.1, 0.12, 0.05), (0, yfront + 0.03, 0.54), r=0.012, seg=1), blk, den=0.2)
    b.empty("plate_F", (0, yfront - 0.13, 0.66))
    # route board above the windscreen
    hitr, _ = body.hit(V3(0, -8, 2.74), V3(0, 1, 0))
    b.add(rbox("routebox", (1.34, 0.05, 0.33), (0, hitr.y - 0.01, 2.78), r=0.012, seg=1), bez, den=0.35)
    b.empty("route_F", (0, hitr.y - 0.04, 2.78))
    for x0 in (-0.5, 0.5):
        b.tube([(x0, hit1.y - 0.01, 2.5), (x0 - 0.04, hit1.y + 0.02 - 0.06, 2.1), (x0 + 0.05, hit0.y - 0.02, 1.68)], 0.006, blk, seg=4, den=0)
    for s in (1, -1):
        b.tube([(s * 1.1, -4.44, 2.64), (s * 1.36, -4.54, 2.6), (s * 1.38, -4.56, 2.3)], 0.013, blk, seg=5, den=0.25)
        b.add(rbox("mir", (0.15, 0.05, 0.36), (s * 1.38, -4.56, 2.14), r=0.022, seg=1), blk, den=0.4)
        b.add(plate("mirf", rrect(0.13, 0.33, 0.02, n=1), 0.002, origin=(s * 1.38, -4.533, 2.14), u=(1, 0, 0), v=(0, 0, 1)), b.mat("mirrorface", lambda: bo.pbr("mirrorface", C("#c9d6df"), 0.05, 1.0)), den=0.25)
    # roof-edge marker lamps
    for x in (-0.82, -0.32, 0.32, 0.82):
        b.add(lathe("marker", [(0.0, 0.0), (0.0, 0.03), (0.018, 0.022), (0.022, 0.0)], 8, (x, -4.42, 2.905), axis="z"), b.mat("lens_amber", lambda: lens_amber()), den=0.25)

    # ---- tail: lamps, ladder, plate, bumper
    hitt, _ = body.hit(V3(0, 8, 0.95), V3(0, -1, 0))
    yrear = hitt.y
    for s in (1, -1):
        b.add(rbox("taillbox", (0.34, 0.03, 0.36), (s * 0.86, yrear + 0.005, 1.16), r=0.016, seg=1), bez, den=0.4)
        round_lamp(b, (s * 0.92, yrear + 0.018, 1.25), 0.06, "red", direction=1, den=0.5, bezel=bez)
        round_lamp(b, (s * 0.92, yrear + 0.018, 1.08), 0.06, "red", direction=1, den=0.5, bezel=bez)
        round_lamp(b, (s * 0.78, yrear + 0.018, 1.25), 0.05, "amber", direction=1, den=0.4, bezel=bez)
        b.empty("light_RL" if s > 0 else "light_RR", (s * 0.92, yrear + 0.05, 1.16))
    b.add(dented_bar("rbumper", 1.1, yrear + 0.05, 0.68, 0.1, 0.22, seed=8), bum, den=0.8)
    b.empty("plate_R", (0, yrear + 0.11, 0.68))
    for x in (0.72, 0.98):
        b.tube([(x, yrear + 0.05, 1.4), (x, yrear + 0.07, 2.2), (x, 4.62, 2.82), (x, 4.42, 3.02)], 0.012, st, seg=5, den=0.2)
    for z in np.arange(1.5, 2.8, 0.22):
        yl = yrear + 0.05 + (4.62 - yrear - 0.05) * max(0.0, (z - 2.2) / 0.62) if z > 2.2 else yrear + 0.06
        b.tube([(0.72, yl, z), (0.98, yl, z)], 0.008, st, seg=4, den=0)

    # ---- roof: luggage rail, vents, a bit of tarp
    railz = 3.14
    rail_pts = [(1.0, -3.6, railz), (1.0, 3.9, railz), (-1.0, 3.9, railz), (-1.0, -3.6, railz)]
    b.tube(rail_pts, 0.018, st, seg=6, closed=True, den=0.25)
    for y in np.arange(-3.6, 3.95, 1.5):
        for x in (-1.0, 1.0):
            b.tube([(x, y, 2.86 if abs(x) > 0 else 3.0), (x, y, railz)], 0.013, st, seg=5, den=0)
        b.tube([(-1.0, y, railz), (1.0, y, railz)], 0.011, st, seg=5, den=0.15)
    for y in (-2.6, 0.0, 2.6):
        rings = [dict(c=(0, y, 3.02), rx=0.36, ry=0.30, axis="z", power=4), dict(c=(0, y, 3.10), rx=0.34, ry=0.28, axis="z", power=4), dict(c=(0, y - 0.02, 3.13), rx=0.26, ry=0.2, axis="z", power=4)]
        b.add(bo.loft("vent", rings, segments=12), b.mat("ventcol", lambda: paint("ventcol", "#d8d6cd", rough=0.5, dust=0.7, chips=0.3, scratch=0.2, edge=0.7, grime=0.5)), den=0.5)
    for y in (-1.3, 1.3):
        for x in (-0.55, 0.55):
            b.add(lathe("mush", [(0.0, 0.05), (0.05, 0.05), (0.055, 0.08), (0.075, 0.08), (0.09, 0.0)], 10, (x, y, 3.0), axis="z"), st, den=0.25)

    # ---- running gear visible under the skirt
    for yc in (yf, yr):
        b.tube([(-0.9, yc, R), (0.9, yc, R)], 0.05, blk, seg=7, den=0.2)
    b.tube([(-0.5, -4.2, 0.62), (-0.5, 4.3, 0.62)], 0.05, blk, seg=5, den=0.15)
    b.tube([(0.5, -4.2, 0.62), (0.5, 4.3, 0.62)], 0.05, blk, seg=5, den=0.15)
    b.tube([(-0.62, 0.4, 0.56), (-0.62, 3.8, 0.56), (-0.8, 4.45, 0.5)], 0.038, blk, seg=6, den=0.2)
    b.add(rbox("tank", (0.5, 0.8, 0.44), (-0.84, 0.0, 0.62), r=0.05, seg=1), blk, den=0.25)
    # mud flaps
    for s in (1, -1):
        for yc in (yf, yr):
            b.add(rbox("flap", (0.34, 0.012, 0.3), (s * 1.0, yc + R + 0.12, 0.44), r=0.004, seg=1), rub, den=0.2)

    def bus_front(bb, c):
        wheel_truck(bb, c, R, 0.24, 0.285, bolts=8, seg=24, den=1.2, disc_col="#d6d2c2", lugs=26, holes=8)

    def bus_rear(bb, c):
        wheel_truck(bb, c, R, 0.22, 0.285, bolts=8, seg=24, den=1.0, disc_col="#d6d2c2", lugs=26, holes=8, dual=True)

    b.add_wheels([("wheel_FL", (tx + 0.03, yf, R), False), ("wheel_FR", (-tx - 0.03, yf, R), True)], bus_front)
    b.add_wheels([("wheel_RL", (tx - 0.13, yr, R), False), ("wheel_RR", (-tx + 0.13, yr, R), True)], bus_rear)

    def paint_fn(name):
        def f():
            pal_v = BUS_PALETTES[name]
            s_cv = _bus_side(pal_v)
            s_cv.update_image(canv["side"])
            _bus_end(pal_v, True).update_image(canv["front"])
            _bus_end(pal_v, False).update_image(canv["rear"])

        return f

    b.variant("default")
    b.variant("blue", {"bumper": "#e9e7dd"}, paint_fn("blue"))
    b.variant("yellow", {"bumper": "#26282a"}, paint_fn("yellow"))


# ---------------------------------------------------------------------------
# Truck: painted cab, tall wooden cargo body
# ---------------------------------------------------------------------------

TRUCK_CARGO_B = dict(y0=-1.85, y1=3.85, x0=-1.25, x1=1.25, z0=1.1, z1=3.4)
TRUCK_CAB_B = dict(y0=-3.9, y1=-1.7, x0=-1.25, x1=1.25, z0=0.5, z1=2.9)


def truck_cargo_side(W=3072, seed=12):
    B = TRUCK_CARGO_B
    H = int(W * (B["z1"] - B["z0"]) / (B["y1"] - B["y0"]))
    U = lambda y: (y - B["y0"]) / (B["y1"] - B["y0"]) * W
    V = lambda z: (1 - (z - B["z0"]) / (B["z1"] - B["z0"])) * H
    cv = Canvas(W, H, "#f2b705")
    cv.height[:] = 0.5
    rng = np.random.default_rng(seed)
    cv.rect(0, V(3.3), W, V(2.93), "#c9142a")
    cv.rect(0, V(2.93), W, V(2.88), "#ffffff")
    cv.rect(0, V(2.22), W, V(2.08), "#0d8a4a")
    cv.rect(0, V(1.42), W, H, "#144fb0")
    cv.rect(0, V(1.46), W, V(1.42), "#ffffff")
    # scallops and triangles
    for y in np.arange(-1.8, 3.8, 0.24):
        cv.circle(U(y), V(2.93), 26, "#ffd21f", outline="#2b0f24", ow=2)
        cv.circle(U(y), V(2.93), 11, "#c9142a")
        cv.poly([(U(y), V(1.42)), (U(y + 0.12), V(1.24)), (U(y + 0.24), V(1.42))], "#ffd21f", outline="#2b0f24", ow=1.5)
    posts = [-1.72, -0.82, 0.08, 0.98, 1.88, 2.78, 3.70]
    cols = ["#ff2d86", "#00a79d", "#e3182d", "#1a48e0", "#ff7a1a", "#00a79d"]
    for i in range(6):
        ym = (posts[i] + posts[i + 1]) / 2
        # lower panel: medallion
        d = 92
        zm = V(1.76)
        cv.ellipse(U(ym), zm, 130, 96, cols[i], outline="#2b0f24", ow=4)
        if i % 3 == 0:
            cv.flower(U(ym), zm, 74, 8, "#ffd21f", "#ffffff", "#c9142a", outline="#2b0f24")
        elif i % 3 == 1:
            _sun(cv, U(ym), zm, 36, rays=16, ray_len=2.1)
        else:
            cv.lotus(U(ym), zm + 34, 80)
        # upper panel: diamond and flowers
        zu = V(2.56)
        cv.poly([(U(ym) - 170, zu), (U(ym), zu - 90), (U(ym) + 170, zu), (U(ym), zu + 90)], cols[(i + 2) % 6], outline="#2b0f24", ow=4)
        cv.flower(U(ym), zu, 58, 8, "#ffffff", "#ffd21f", "#c9142a", outline="#2b0f24")
        for dx in (-210, 210):
            cv.leaf_spray(U(ym) + dx, zu, 0 if dx < 0 else math.pi, 3, 70, 26, spread=0.6)
            cv.flower(U(ym) + dx, zu, 30, 6, "#e3182d", "#ffffff", "#ffd21f", outline="#2b0f24")
    # planks
    for z in np.arange(1.22, 3.3, 0.205):
        seam(cv, [(0, V(z)), (W, V(z))], 2.4, dark="#2a1b0e", alpha=0.65)
    # wear
    for _ in range(46):
        y = rng.uniform(-1.8, 3.8)
        z = rng.uniform(1.25, 3.25)
        ln = rng.uniform(0.1, 0.6)
        cv.stroke([(U(y), V(z)), (U(y + ln), V(z + rng.uniform(-0.02, 0.02)))], rng.uniform(1.2, 4.0), "#6b4a2a", alpha=rng.uniform(0.3, 0.7))
    for _ in range(50):
        y = rng.uniform(-1.8, 3.8)
        cv.stroke([(U(y), V(1.5)), (U(y), V(1.5 - rng.uniform(0.05, 0.3)))], rng.uniform(1.5, 5), "#3e2413", width_end=0.6, alpha=rng.uniform(0.2, 0.5))
    cv.speckle(0.05, seed=seed)
    return cv


def truck_tail(W=1024):
    """Wooden tailgate: planks with a painted panel."""
    B = TRUCK_CARGO_B
    H = int(W * (B["z1"] - B["z0"]) / (B["x1"] - B["x0"]))
    U = lambda x: (x - B["x0"]) / (B["x1"] - B["x0"]) * W
    V = lambda z: (1 - (z - B["z0"]) / (B["z1"] - B["z0"])) * H
    cv = Canvas(W, H, "#c9142a")
    cv.height[:] = 0.5
    cv.rect(0, V(3.3), W, V(3.04), "#1a48e0")
    cv.rect(0, V(1.42), W, H, "#0d8a4a")
    for x in np.arange(-1.2, 1.2, 0.2):
        cv.circle(U(x + 0.1), V(3.04), 18, "#ffd21f", outline="#2b0f24", ow=2)
        cv.poly([(U(x), V(1.42)), (U(x + 0.1), V(1.26)), (U(x + 0.2), V(1.42))], "#ffd21f", outline="#2b0f24", ow=1.5)
    for z in np.arange(1.22, 3.3, 0.205):
        seam(cv, [(0, V(z)), (W, V(z))], 2.4, dark="#2a1b0e", alpha=0.6)
    cv.speckle(0.05, seed=31)
    return cv


def truck_cab_canvases(W=2048):
    B = TRUCK_CAB_B
    H = int(W * (B["z1"] - B["z0"]) / (B["y1"] - B["y0"]))
    U = lambda y: (y - B["y0"]) / (B["y1"] - B["y0"]) * W
    V = lambda z: (1 - (z - B["z0"]) / (B["z1"] - B["z0"])) * H
    side = Canvas(W, H, "#134fb0")
    side.height[:] = 0.5
    side.rect(0, V(1.5), W, V(1.34), "#ffd21f")
    side.rect(0, V(1.34), W, V(1.28), "#c9142a")
    side.rect(0, V(2.9), W, V(2.46), "#c9142a")
    side.rect(0, V(2.46), W, V(2.42), "#ffd21f")
    # door panel art
    side.ellipse(U(-2.72), V(1.03), 130, 72, "#ff2d86", outline="#2b0f24", ow=3)
    side.flower(U(-2.72), V(1.03), 56, 8, "#ffd21f", "#ffffff", "#c9142a", outline="#2b0f24")
    side.leaf_spray(U(-2.72) - 150, V(1.03), math.pi, 3, 60, 22, spread=0.6)
    side.leaf_spray(U(-2.72) + 150, V(1.03), 0, 3, 60, 22, spread=0.6)
    # shut lines
    for ln in ([(-3.28, 2.42), (-3.28, 1.0)], [(-2.18, 2.42), (-2.18, 1.0)], [(-3.28, 1.0), (-2.18, 1.0)], [(-1.9, 2.5), (-1.9, 1.0)]):
        seam(side, [(U(a), V(b_)) for a, b_ in ln], 3.5)
    for y in np.arange(-3.6, -1.9, 0.09):
        side.circle(U(y), V(1.56), 3.0, "#ffffff", alpha=0.6)
    side.speckle(0.04, seed=21)

    FW = 1024
    FH = int(FW * (B["z1"] - B["z0"]) / (B["x1"] - B["x0"]))
    Ux = lambda x: (x - B["x0"]) / (B["x1"] - B["x0"]) * FW
    Vf = lambda z: (1 - (z - B["z0"]) / (B["z1"] - B["z0"])) * FH
    front = Canvas(FW, FH, "#134fb0")
    front.height[:] = 0.5
    front.rect(0, Vf(1.5), FW, Vf(1.34), "#ffd21f")
    front.rect(0, Vf(1.34), FW, Vf(1.28), "#c9142a")
    front.rect(0, Vf(0.72), FW, FH, "#101112")
    # truck-art panels on the nose: chevrons, flowers and peacock-eye medallions by the lamps
    for s_ in (-1, 1):
        for k in range(4):
            x = s_ * (0.32 + k * 0.1)
            front.poly([(Ux(x), Vf(1.27)), (Ux(x + s_ * 0.07), Vf(1.27)), (Ux(x + s_ * 0.17), Vf(0.76)), (Ux(x + s_ * 0.1), Vf(0.76))], "#ffd21f" if k % 2 else "#c9142a", outline="#2b0f24", ow=1.5)
        for r, c in ((46, "#ffd21f"), (34, "#00a79d"), (20, "#1a2fb0")):
            front.circle(Ux(s_ * 0.92), Vf(1.2), r, c, outline="#2b0f24", ow=1.5)
    front.flower(Ux(0), Vf(1.2), 56, 9, "#ff2d86", "#ffd21f", "#c9142a", outline="#2b0f24")
    front.speckle(0.04, seed=22)
    rear = Canvas(FW, FH, "#134fb0")
    rear.height[:] = 0.5
    return dict(side=side.to_image("cab_side"), side_h=side.height_image("cab_side_h"), front=front.to_image("cab_front"), front_h=front.height_image("cab_front_h"), rear=rear.to_image("cab_rear")), B


def leaf_pack(b, x, y, half, z, mat, n=4):
    """Stack of leaf springs on an axle."""
    for k in range(n):
        h = half * (1 - k * 0.2)
        path = []
        for i in range(5):
            t = -1 + 2 * i / 4
            path.append((x, y + t * h, z - k * 0.014 + 0.10 * (t * h / half) ** 2 * 0.9))
        b.add(sweep("leaf", path, [(-0.035, -0.006), (0.035, -0.006), (0.035, 0.006), (-0.035, 0.006)], up=(0, 0, 1)), mat, den=0.25)


def truck_front(b):
    """Cab, chassis and wheels: what every sort of lorry here has in common."""
    R = 0.50
    yf, yr = -2.62, 1.72
    txf, txr = 0.96, 0.82
    b.spec = dict(wheelbase=round(yr - yf, 3), wheelRadius=R, seatPose="sit_bus", glass_alpha=0.2, width=2.36)
    b.preview = dict(target=(0, 0.0, 1.5), distance=13.5, height=1.4)
    b.tex = 2048
    b.tex_detail = 1024
    b.ao_distance = 0.8
    b.chart_cell = 1.6
    b.quality = 80
    Y0, Y1 = -3.75, -1.85
    zt = table([(Y0, 1.32), (-3.74, 1.5), (-3.68, 1.9), (-3.58, 2.36), (-3.52, 2.56), (-3.4, 2.66), (-3.0, 2.69), (-1.95, 2.66), (-1.88, 2.5), (Y1, 2.3)])
    zb = table([(Y0, 1.3), (-3.62, 1.44), (-3.4, 1.5), (-1.95, 1.52), (Y1, 1.48)])
    xb = table([(Y0, 0.98), (-3.72, 1.06), (-3.55, 1.11), (-3.2, 1.13), (-1.95, 1.13), (Y1, 1.1)])
    xt = table([(Y0, 0.9), (-3.58, 0.98), (-3.4, 1.02), (-1.95, 1.02), (Y1, 0.98)])
    sill = table([(Y0, 0.72), (-3.5, 0.72), (-2.1, 0.95), (Y1, 0.95)])
    win = (-3.14, -2.28)
    stations = [Y0, -3.74, -3.68, -3.62, -3.58, -3.52, -3.4, win[0], win[1], -2.1, -1.95, -1.88, Y1]
    stations += [yf + (R + 0.1) * math.cos(a) for a in np.linspace(0, math.pi, 9)]
    body = RingBody(stations, zt, zb, xb, xt, sill, arches=[(yf, R, R + 0.1)], floor=0.86, inner=0.9, crown=0.06, pillar=0.09, shoulder=0.02, belt_in=0.012)

    def tag(y, s, side, i):
        if s in (0, 1, 2) and -3.735 < y < -3.52:
            return "windshield"
        if s in (4, 5) and win[0] < y < win[1]:
            return "side"
        if s >= 11:
            return "under"
        return "paint"

    parts = body.build("cab", tag)
    canv, cb = truck_cab_canvases()
    cabp = livery("cabpaint", canv, cb, dust=0.35, chips=0.2, scratch=0.25, edge=1.0, chip_col="#3f3a2c", grime=0.25, rough=0.34)
    b.add(parts["paint"], cabp, den=1.8)
    cf, cr = body.caps("cabcap")
    b.add(cf, cabp, den=1.1)
    b.add(cr, cabp, den=0.5)
    rub = b.mat("rubber", lambda: rubber())
    ch = b.mat("chrome", lambda: chrome(dust=0.28))
    st = b.mat("steel", lambda: steel())
    blk = b.mat("blackplastic", lambda: paint("blackplastic", "#141517", rough=0.55, dust=0.45, chips=0.2, scratch=0.2, edge=0.5, chip_col="#55504a"))
    under = b.mat("undercoat", lambda: paint("undercoat", "#141210", rough=0.85, dust=0.65, chips=0, scratch=0, edge=0))
    b.add(parts["under"], under, den=0.25)
    for key in ("windshield", "side"):
        gasket_loops(b, parts[key], 0.014, rub, den=0.2)
        b.glass(parts[key])

    # ---- cab interior
    trim = b.mat("trim_int", interior_trim)
    seatv = vinyl("cabseat", "#5e1f24", rough=0.46, dust=0.2, tuft=8.0)
    b.add(rbox("cabfloor", (2.1, 1.7, 0.03), (0, -2.75, 1.14), r=0.006, seg=1), under, den=0.2)
    b.add(rbox("bench", (2.0, 0.5, 0.14), (0, -2.42, 1.48), r=0.04, seg=1), seatv, den=0.35)
    b.add(rbox("benchbase", (1.9, 0.42, 0.32), (0, -2.42, 1.27), r=0.01, seg=1), trim, den=0.15)
    b.add(rbox("benchback", (2.0, 0.1, 0.72), (0, -2.1, 1.84), rot=(math.radians(8), 0, 0), r=0.04, seg=1), seatv, den=0.35)
    b.add(rbox("cabdash", (2.1, 0.34, 0.26), (0, -3.42, 1.42), r=0.05, seg=1), trim, den=0.35)
    b.add(rbox("hump", (0.62, 0.9, 0.3), (0, -3.0, 1.28), r=0.06, seg=1), trim, den=0.25)
    steering_wheel(b, (-0.55, -3.0, 1.72), r=0.22, tilt=42)
    for s_ in (1, -1):
        b.add(rbox("doorcard", (0.02, 1.7, 0.42), (s_ * 1.1, -2.75, 1.32), r=0.004, seg=1), trim, den=0.2)
    lrows = [[p + V3(0, 0, -0.025) for p in body.rows[i][:4]] for i in range(len(body.st)) if -3.53 <= body.st[i] <= -1.94]
    lrows = [list(reversed([V3(-p.x, p.y, p.z) for p in r[1:]])) + r for r in lrows[:: max(1, len(lrows) // 5)]]
    b.add(orient_out(grid("cabliner", lrows), (0, -2.7, 3.5)), fabric("cabliner", "#c7c1ad", weave=30.0, dust=0.1), den=0.2)
    b.empty("seat_driver", (-0.55, -2.38, 1.6))
    b.empty("seat_p1", (0.55, -2.38, 1.6))
    b.empty("exit_L", (1.6, -2.45, 0))
    b.empty("exit_R", (-1.6, -2.45, 0))
    for s_ in (1, -1):
        hit, _ = body.hit(V3(s_ * 3, -2.75, 1.52), V3(-s_, 0, 0))
        if hit:
            b.tube([(hit.x + s_ * 0.02, -2.3, 1.3), (hit.x + s_ * 0.045, -2.28, 1.42), (hit.x + s_ * 0.045, -2.28, 1.96), (hit.x + s_ * 0.02, -2.26, 2.06)], 0.012, ch, seg=5, den=0.2)
            b.add(rbox("dhandle", (0.03, 0.16, 0.035), (hit.x + s_ * 0.012, -3.1, 1.52), r=0.008, seg=1), ch, den=0.2)
        b.add(rbox("cabstep", (0.26, 0.5, 0.03), (s_ * 1.0, -2.05, 0.74), r=0.006, seg=1), st, den=0.2)
        b.add(rbox("cabstep", (0.26, 0.5, 0.03), (s_ * 1.0, -2.05, 1.0), r=0.006, seg=1), st, den=0.2)

    # ---- face: round lamps, grille, bumper, wipers, mirrors
    bez = b.mat("bezelc", lambda: paint("bezelc", "#e8e4d8", rough=0.28, metal=0.8, dust=0.25, chips=0.15, scratch=0.2, edge=0.4))
    hitc, _ = body.hit(V3(0, -8, 1.0), V3(0, 1, 0))
    yfront = hitc.y
    for s in (1, -1):
        round_lamp(b, (s * 0.72, yfront - 0.03, 0.92), 0.115, "clear", den=0.9, bezel=bez)
        round_lamp(b, (s * 0.44, yfront - 0.025, 0.92), 0.075, "clear", den=0.7, bezel=bez)
        round_lamp(b, (s * 0.94, yfront + 0.0, 1.12), 0.05, "amber", den=0.5, bezel=blk)
        b.empty("light_FL" if s > 0 else "light_FR", (s * 0.72, yfront - 0.07, 0.92))
    b.add(rbox("grillepanel", (0.56, 0.03, 0.42), (0, yfront - 0.008, 1.0), r=0.02, seg=1), blk, den=0.4)
    for i in range(7):
        x = -0.24 + i * 0.08
        b.add(rbox("gbar", (0.022, 0.02, 0.38), (x, yfront - 0.03, 1.0), r=0.005, seg=1), ch, den=0.15)
    bum = paint("truckbumper", "#d9d4c4", rough=0.42, metal=0.5, dust=0.45, chips=0.55, scratch=0.6, edge=1.0, chip_col="#3a3026", grime=0.45)
    b.add(dented_bar("bumper", 1.14, yfront - 0.06, 0.66, 0.12, 0.26, seed=11), bum, den=0.8)
    b.empty("plate_F", (0, yfront - 0.14, 0.66))
    for s in (1, -1):
        b.add(rbox("hook", (0.05, 0.08, 0.06), (s * 0.5, yfront - 0.14, 0.53), r=0.012, seg=1), st, den=0.15)
    hw0, _ = body.hit(V3(0, -8, 1.62), V3(0, 1, 0))
    hw1, _ = body.hit(V3(0, -8, 2.44), V3(0, 1, 0))
    b.tube([hw0 + V3(0, -0.012, 0), hw1 + V3(0, -0.012, 0)], 0.018, rub, seg=4, den=0.2)
    for x0 in (-0.5, 0.5):
        b.tube([(x0, hw0.y - 0.02, 1.56), (x0 - 0.12, hw0.y - 0.03, 1.92)], 0.005, blk, seg=4, den=0)
    for s in (1, -1):
        b.tube([(s * 1.1, -3.45, 2.36), (s * 1.34, -3.56, 2.32), (s * 1.36, -3.58, 1.95)], 0.012, blk, seg=5, den=0.2)
        b.add(rbox("mir", (0.17, 0.05, 0.38), (s * 1.36, -3.58, 1.8), r=0.02, seg=1), blk, den=0.3)
        b.add(plate("mirf", rrect(0.15, 0.35, 0.02, n=1), 0.002, origin=(s * 1.36, -3.553, 1.8), u=(1, 0, 0), v=(0, 0, 1)), b.mat("mirrorface", lambda: bo.pbr("mirrorface", C("#c9d6df"), 0.05, 1.0)), den=0.2)

    # ---- chassis
    b.add(bo.box("railL", (0.09, 6.9, 0.2), loc=(0.42, 0.2, 0.92)), under, den=0.2)
    b.add(bo.box("railR", (0.09, 6.9, 0.2), loc=(-0.42, 0.2, 0.92)), under, den=0.2)
    for y in (-1.8, -0.5, 0.8, 2.4, 3.4):
        b.add(bo.box("xm", (0.84, 0.08, 0.14), loc=(0, y, 0.94)), under, den=0.12)
    b.tube([(-0.95, yf, R), (0.95, yf, R)], 0.05, blk, seg=7, den=0.15)
    b.tube([(-0.85, yr, R), (0.85, yr, R)], 0.06, blk, seg=7, den=0.15)
    b.add(lathe("diff", [(-0.2, 0.0), (-0.2, 0.08), (-0.1, 0.17), (0.1, 0.17), (0.2, 0.08), (0.2, 0.0)], 12, (0, yr, R), axis="x"), blk, den=0.2)
    for s_ in (1, -1):
        leaf_pack(b, s_ * 0.5, yf, 0.5, R + 0.1, st)
        leaf_pack(b, s_ * 0.42, yr, 0.62, R + 0.1, st)
    b.add(lathe("fueltank", [(0.0, 0.0), (0.0, 0.22), (0.02, 0.26), (0.68, 0.26), (0.7, 0.22), (0.7, 0.0)], 14, (-0.7, -1.6, 0.68), axis="y"), b.mat("tankm", lambda: paint("tankm", "#2a2b2d", rough=0.5, metal=0.5, dust=0.6, chips=0.35, scratch=0.3, edge=0.6)), den=0.35)
    b.add(rbox("battbox", (0.42, 0.5, 0.36), (0.7, -1.3, 0.68), r=0.02, seg=1), blk, den=0.25)
    b.tube([(-0.28, -2.4, 0.75), (-0.5, -1.0, 0.62), (-0.55, 0.9, 0.62), (-0.95, 1.05, 0.62)], 0.045, st, seg=6, den=0.15)
    # spare wheel slung under the tail
    start = len(b.parts)
    b.current_wheel = "body"
    wheel_small(b, (0, 0, 0), R, 0.2, 0.28, bolts=6, seg=20, den=0.5, disc_col="#c9c4b4")
    b.current_wheel = None
    transform_parts(b, start, Matrix.Translation((0, 3.0, 0.72)) @ Matrix.Rotation(math.radians(90), 4, "Y"))

    def tail(postm):
        # Tail lamps, plate and mud flaps on a bar under the bed.
        b.add(rbox("tailbar", (2.2, 0.08, 0.14), (0, 3.68, 1.06), r=0.012, seg=1), blk, den=0.25)
        for s in (1, -1):
            round_lamp(b, (s * 0.9, 3.725, 1.06), 0.058, "red", direction=1, den=0.45, bezel=blk)
            round_lamp(b, (s * 0.74, 3.725, 1.06), 0.046, "amber", direction=1, den=0.35, bezel=blk)
            b.empty("light_RL" if s > 0 else "light_RR", (s * 0.9, 3.77, 1.06))
        b.empty("plate_R", (0, 3.732, 1.06))
        mudm = paint("mudflap", "#101010", rough=0.8, dust=0.5, chips=0, scratch=0.2, edge=0)
        for s in (1, -1):
            b.add(rbox("flap", (0.48, 0.015, 0.46), (s * 0.85, 2.42, 0.42), r=0.004, seg=1), mudm, den=0.25)
            b.add(fender("rfender", (s * 0.83, yr, R), R + 0.09, 0.56, 8, 172, n=12, drop=0.03), postm, den=0.7)

        def t_front(bb, c):
            wheel_truck(bb, c, R, 0.25, 0.30, bolts=8, seg=24, den=1.1, disc_col="#d6d2c2", lugs=26, holes=8)

        def t_rear(bb, c):
            wheel_truck(bb, c, R, 0.235, 0.30, bolts=8, seg=24, den=0.95, disc_col="#d6d2c2", lugs=26, holes=8, dual=True)

        b.add_wheels([("wheel_FL", (txf, yf, R), False), ("wheel_FR", (-txf, yf, R), True)], t_front)
        b.add_wheels([("wheel_RL", (txr, yr, R), False), ("wheel_RR", (-txr, yr, R), True)], t_rear)
        b.variant("default")

    return dict(st=st, ch=ch, blk=blk, tail=tail)


@vehicle
def build_truck(b):
    f = truck_front(b)
    st, ch, blk = f["st"], f["ch"], f["blk"]
    # ---- wooden cargo body
    x_side, y0c, y1c, zf, ztop = 1.15, -1.75, 3.75, 1.2, 3.28
    side_cv = truck_cargo_side()
    side_img = side_cv.to_image("cargo_side")
    side_h = side_cv.height_image("cargo_side_h")
    tail_cv = truck_tail()
    tail_img = tail_cv.to_image("cargo_tail")
    tail_h = tail_cv.height_image("cargo_tail_h")
    art_cv = art_swans(W=900, H=560)
    art_img = art_cv.to_image("cargo_art")
    cargo_canv = dict(side=side_img, side_h=side_h, front=tail_img, front_h=tail_h, rear=tail_img, rear_h=tail_h)
    cargo = livery("cargo", cargo_canv, TRUCK_CARGO_B, dust=0.28, chips=0.2, scratch=0.25, edge=1.0, chip_col="#6d4a26", grime=0.25, rough=0.5)
    woodm = wood("timber", "#8a5a30", "#54331a", rough=0.74, dust=0.4)
    postm = paint("posts", "#c9142a", rough=0.46, dust=0.3, chips=0.5, scratch=0.4, edge=1.0, chip_col="#6d4a26", grime=0.3)
    capm = paint("rail", "#0d8a4a", rough=0.46, dust=0.35, chips=0.5, scratch=0.35, edge=1.0, chip_col="#6d4a26", grime=0.3)
    b.add(rbox("cargofloor", (2.3, 5.5, 0.08), (0, 1.0, zf + 0.0), r=0.008, seg=1), woodm, den=0.35)

    def cargo_side(s):
        b.add(plate("cside", [(y0c, zf), (y1c, zf), (y1c, ztop), (y0c, ztop)], 0.03, origin=(s * x_side, 0, 0), u=(0, 1, 0), v=(0, 0, 1)), cargo, den=1.55)
        b.add(rbox("cinner", (0.02, y1c - y0c - 0.06, ztop - zf - 0.02), (s * (x_side - 0.03), 1.0, (zf + ztop) / 2), r=0.003, seg=1), woodm, den=0.3)
        for y in (-1.72, -0.82, 0.08, 0.98, 1.88, 2.78, 3.70):
            b.add(rbox("post", (0.055, 0.09, ztop - zf + 0.1), (s * (x_side + 0.028), y, (zf + ztop) / 2 + 0.02), r=0.012, seg=1), postm, den=0.45)
        for z, h in ((ztop + 0.04, 0.08), (2.15, 0.06), (zf + 0.02, 0.1)):
            b.add(rbox("rail", (0.05, y1c - y0c + 0.06, h), (s * (x_side + 0.03), 1.0, z), r=0.01, seg=1), capm, den=0.4)
        for y in (-0.3, 1.45, 3.2):
            b.add(rbox("hook", (0.05, 0.06, 0.09), (s * (x_side + 0.05), y, zf - 0.08), r=0.008, seg=1), st, den=0.12)

    b.both(cargo_side)
    # head board, taller than the sides, and the painted canopy running forward over the cab
    b.add(plate("headboard", [(-x_side, zf), (x_side, zf), (x_side, ztop), (-x_side, ztop)], 0.03, origin=(0, y0c, 0), u=(1, 0, 0), v=(0, 0, 1)), cargo, den=1.0)
    canvasz = hood_canvas("default", W=768, H=768)
    can_img = canvasz.to_image("canopy_art")
    can_h = canvasz.height_image("canopy_h")
    can_m = painted("canopy", can_img, rough=0.5, bump_img=can_h, bump_strength=0.5, dust=0.3, wear=0.12, wear_col="#6d4a26")

    def can_pt(u, v):
        half = 1.14 - 0.14 * v ** 1.4
        y = y0c - v * 1.86
        arch = 0.12 * (1 - (2 * u - 1) ** 2)
        zedge = ztop - 0.02 - 0.52 * v ** 0.9
        return V3((2 * u - 1) * half, y, zedge + arch * (1 - 0.3 * v))

    rows = [[can_pt(j / 12, i / 9) for j in range(13)] for i in range(10)]
    b.add(orient_out(grid("canopy", rows, uv=True), (0, -2.6, 1.0)), can_m, den=1.0)
    und = [[can_pt(j / 6, i / 3) + V3(0, 0, -0.03) for j in range(7)] for i in range(4)]
    undg = orient_out(grid("canopyu", und), (0, -2.6, 6.0))
    b.add(undg, woodm, den=0.15)
    # visor edge with hanging decorations: the signature of a painted truck
    apron_rows = [[can_pt(j / 16, 1.0) + V3(0, -0.006, 0.0) for j in range(17)], [can_pt(j / 16, 1.0) + V3(0, -0.006, -0.10) for j in range(17)]]
    b.add(orient_out(grid("canapron", apron_rows), (0, -2.6, 2.8)), capm, den=0.5)
    def can_side(s):
        rows_s = [[can_pt(0.5 + s * 0.5, i / 9), can_pt(0.5 + s * 0.5, i / 9) + V3(0, 0, -0.10)] for i in range(10)]
        b.add(orient_out(grid("canside", rows_s), (0, -2.6, 2.8)), capm, den=0.4)
    b.both(can_side)
    visor_edge = [can_pt(j / 16, 1.0) + V3(0, -0.012, -0.102) for j in range(17)]
    b.tube(visor_edge, 0.018, ch, seg=6, den=0.25)
    tm = fabric("tuft_pink", "#ff2d86", dust=0.05)
    tm2 = fabric("tuft_yel", "#ffd21f", dust=0.05)
    tm3 = fabric("tuft_teal", "#00a79d", dust=0.05)
    ms = (tm, tm2, tm3)
    for i in range(1, 16):
        p = can_pt(i / 16, 1.0) + V3(0, -0.02, -0.12)
        L = 0.17 if i % 2 else 0.25
        tassel(b, p, L, ch, ms[i % 3])
    for s in (1, -1):
        b.tube([can_pt(0.5 + s * 0.46, 1.0) + V3(0, 0.08, -0.02), (s * 0.92, -3.44, 2.68)], 0.012, st, seg=5, den=0.12)
        b.add(lathe("topmarker", [(0.0, 0.0), (0.0, 0.05), (0.03, 0.04), (0.04, 0.0)], 10, can_pt(0.5 + s * 0.44, 0.95) + V3(0, 0, 0.0), axis="z"), b.mat("lens_amber", lambda: lens_amber()), den=0.2)

    # tail gate with the painted panel, hinge straps and chains
    b.add(plate("tailgate", [(-x_side, zf), (x_side, zf), (x_side, ztop), (-x_side, ztop)], 0.03, origin=(0, y1c, 0), u=(-1, 0, 0), v=(0, 0, 1)), cargo, den=1.0)
    art_m = painted("cargo_art", art_img, rough=0.42, vec=lambda g: g.project("y", 0.82, -0.82, 1.62, 2.62), dust=0.18, wear=0.12, wear_col="#6d4a26")
    b.add(plate("artpanel", rrect(1.64, 1.0, 0.03, n=2), 0.01, origin=(0, y1c + 0.021, 2.12), u=(-1, 0, 0), v=(0, 0, 1), bevel=0.002), art_m, den=2.0)
    fr_pts = [V3(p[0], y1c + 0.03, 2.12 + p[1]) for p in rrect(1.67, 1.03, 0.03, n=1)]
    b.tube(fr_pts, 0.014, capm, seg=5, closed=True, den=0.25)
    for s in (1, -1):
        b.tube([(s * 1.16, y1c + 0.03, 3.1), (s * 1.0, y1c + 0.06, 2.8), (s * 1.16, y1c + 0.03, 2.5)], 0.006, st, seg=4, den=0)
    for z in (1.42, 2.82):
        b.add(rbox("strap", (2.26, 0.024, 0.07), (0, y1c + 0.02, z), r=0.006, seg=1), st, den=0.3)
    f["tail"](postm)


@vehicle
def build_garbage_truck(b):
    """The city corporation's: a dented steel bin on the back, heaped well past the top."""
    f = truck_front(b)
    st = f["st"]
    bin_m = paint("binpaint", "#3d5a44", rough=0.6, dust=0.55, chips=0.7, scratch=0.7, edge=1.0, chip_col="#3a3026", grime=0.7)
    post = paint("binrib", "#2c4232", rough=0.6, dust=0.5, chips=0.5, scratch=0.4, edge=1.0, chip_col="#3a3026", grime=0.5)
    x, y0, y1, zf, zt = 1.14, -1.7, 3.7, 1.2, 2.75
    b.add(rbox("binfloor", (2.3, 5.45, 0.1), (0, 1.0, zf), r=0.01, seg=1), bin_m, den=0.25)

    def side(s_):
        b.add(plate("binside", [(y0, zf), (y1, zf), (y1, zt), (y0, zt)], 0.03, origin=(s_ * x, 0, 0), u=(0, 1, 0), v=(0, 0, 1)), bin_m, den=0.9)
        for y in np.arange(y0 + 0.2, y1, 0.8):
            b.add(rbox("binrib", (0.05, 0.1, zt - zf), (s_ * (x + 0.03), y, (zf + zt) / 2), r=0.012, seg=1), post, den=0.25)

    b.both(side)
    b.add(plate("binhead", [(-x, zf), (x, zf), (x, zt + 0.35), (-x, zt + 0.35)], 0.03, origin=(0, y0, 0), u=(1, 0, 0), v=(0, 0, 1)), bin_m, den=0.6)
    b.add(plate("bingate", [(-x, zf), (x, zf), (x, zt), (-x, zt)], 0.03, origin=(0, y1, 0), u=(-1, 0, 0), v=(0, 0, 1)), bin_m, den=0.6)
    # The load.
    rubbish = ("#4a4538", "#6a5a44", "#2e2c28", "#7c7a6a", "#58603a", "#3c3a44", "#8a7a5a", "#384a58")
    mats = [paint(f"rub{i}", c, rough=0.9, dust=0.6, chips=0, scratch=0, edge=0) for i, c in enumerate(rubbish)]
    rng = np.random.RandomState(3)
    for i in range(70):
        px, py = rng.uniform(-0.95, 0.95), rng.uniform(y0 + 0.3, y1 - 0.3)
        hump = 0.32 * (1 - (px / 1.1) ** 2) * (1 - ((py - 1) / 2.8) ** 2)
        o = bo.uv_sphere("rub", rng.uniform(0.14, 0.3), 7, 5, (px, py, zt - 0.08 + hump + rng.uniform(-0.1, 0.12)), (rng.uniform(0.9, 1.5), rng.uniform(0.9, 1.5), rng.uniform(0.5, 0.9)))
        b.add(o, mats[i % len(mats)], den=0.1)
    f["tail"](post)


@vehicle
def build_goods_van(b):
    """A covered van: a tall tin box on a lorry's chassis, for whatever needs keeping dry."""
    f = truck_front(b)
    st = f["st"]
    box_m = paint("boxpaint", "#d7d4c8", rough=0.46, dust=0.4, chips=0.3, scratch=0.45, edge=0.8, chip_col="#7a6a50", grime=0.45, slot="box")
    band = paint("boxband", "#20529a", rough=0.46, dust=0.35, chips=0.3, scratch=0.3, edge=0.8, chip_col="#7a6a50", grime=0.3, slot="band")
    x, y0, y1, zf, zt = 1.16, -1.75, 3.72, 1.2, 3.35
    b.add(rbox("boxfloor", (2.34, 5.5, 0.1), (0, 0.98, zf), r=0.01, seg=1), box_m, den=0.25)
    b.add(rbox("boxroof", (2.36, 5.52, 0.06), (0, 0.98, zt), r=0.02, seg=1), box_m, den=0.35)

    def side(s_):
        b.add(plate("boxside", [(y0, zf), (y1, zf), (y1, zt), (y0, zt)], 0.03, origin=(s_ * x, 0, 0), u=(0, 1, 0), v=(0, 0, 1)), box_m, den=0.9)
        b.add(rbox("boxband", (0.02, y1 - y0, 0.42), (s_ * (x + 0.02), (y0 + y1) / 2, 2.1), r=0.004, seg=1), band, den=0.3)
        for y in np.arange(y0 + 0.1, y1, 0.92):
            b.add(rbox("boxrib", (0.03, 0.05, zt - zf), (s_ * (x + 0.02), y, (zf + zt) / 2), r=0.008, seg=1), st, den=0.15)

    b.both(side)
    b.add(plate("boxhead", [(-x, zf), (x, zf), (x, zt), (-x, zt)], 0.03, origin=(0, y0, 0), u=(1, 0, 0), v=(0, 0, 1)), box_m, den=0.5)
    for s_ in (1, -1):
        b.add(plate("boxdoor", [(0, zf), (x, zf), (x, zt), (0, zt)] if s_ > 0 else [(-x, zf), (0, zf), (0, zt), (-x, zt)], 0.03, origin=(0, y1, 0), u=(-1, 0, 0), v=(0, 0, 1)), box_m, den=0.5)
        b.tube([(s_ * 0.18, y1 + 0.04, zf + 0.1), (s_ * 0.18, y1 + 0.04, zt - 0.1)], 0.018, st, seg=5, den=0.1)
    f["tail"](band)
    b.variant("green", {"box": "#3f8a5a", "band": "#e8e2c8"})
    b.variant("red", {"box": "#b03a2e", "band": "#e8e2c8"})


@vehicle
def build_wrecker(b):
    """The police's tow lorry: a flat bed, a short crane at the back, a lamp bar on the cab."""
    f = truck_front(b)
    st, blk = f["st"], f["blk"]
    bed = paint("wreckbed", "#c6c3b6", rough=0.5, dust=0.5, chips=0.6, scratch=0.6, edge=1.0, chip_col="#3a3026", grime=0.5)
    boom = paint("wreckboom", "#c7a11c", rough=0.42, dust=0.4, chips=0.5, scratch=0.45, edge=1.0, chip_col="#3a3026", grime=0.4)
    b.add(rbox("wbed", (2.3, 4.8, 0.14), (0, 0.65, 1.22), r=0.015, seg=1), bed, den=0.6)
    for s_ in (1, -1):
        b.add(rbox("wrail", (0.06, 4.8, 0.12), (s_ * 1.13, 0.65, 1.34), r=0.012, seg=1), boom, den=0.25)
    b.add(rbox("wpost", (0.5, 0.5, 1.5), (0, 3.2, 2.0), r=0.04, seg=1), boom, den=0.4)
    b.tube([(0, 3.2, 2.7), (0, 4.1, 3.2), (0, 4.5, 2.9)], 0.09, boom, seg=8, den=0.4)
    b.tube([(0, 4.5, 2.85), (0, 4.5, 1.4)], 0.014, st, seg=4, den=0.1)
    b.add(rbox("whook", (0.12, 0.05, 0.16), (0, 4.5, 1.32), r=0.012, seg=1), st, den=0.1)
    siren_bar(b, -2.75, 2.76, wide=1.5)
    f["tail"](boom)


def siren_bar(b, y, z, wide=1.1, red=True):
    """The lamp bar on a roof, for anyone with somewhere urgent to be."""
    bar = paint("sirenbase", "#22242a", rough=0.5, dust=0.2, chips=0.1, scratch=0.1, edge=0.3)
    r_ = paint("sirenred", "#d81c28", rough=0.26, dust=0.05, chips=0, scratch=0, edge=0)
    bl = paint("sirenblue", "#1c4ed8", rough=0.26, dust=0.05, chips=0, scratch=0, edge=0)
    b.add(rbox("sbar", (wide, 0.3, 0.05), (0, y, z), r=0.01, seg=1), bar, den=0.2)
    b.add(rbox("slampL", (wide * 0.44, 0.26, 0.11), (wide * 0.25, y, z + 0.08), r=0.03, seg=1), r_, den=0.2)
    b.add(rbox("slampR", (wide * 0.44, 0.26, 0.11), (-wide * 0.25, y, z + 0.08), r=0.03, seg=1), bl if not red else r_, den=0.2)


@vehicle
def build_ambulance(b):
    """The microbus, in white with a red band and a cross on each side."""
    build_microbus(b)
    b.variants = {}
    b.variant("default", {"paint": "#f0f0ea"})
    red = paint("ambred", "#c8202c", rough=0.34, dust=0.15, chips=0.15, scratch=0.15, edge=0.3)
    white = paint("ambwhite", "#f2f2ec", rough=0.34, dust=0.2, chips=0.2, scratch=0.2, edge=0.4)
    hw = b.spec.get("width", 1.85) / 2 + 0.004
    for s_ in (1, -1):
        b.add(rbox("ambband", (0.012, 3.6, 0.2), (s_ * hw, 0.25, 0.92), r=0.002, seg=1), red, den=0.3)
        b.add(rbox("ambsq", (0.012, 0.74, 0.74), (s_ * (hw + 0.002), 0.75, 1.42), r=0.002, seg=1), white, den=0.2)
        b.add(rbox("crossv", (0.012, 0.18, 0.58), (s_ * (hw + 0.006), 0.75, 1.42), r=0.001, seg=1), red, den=0.2)
        b.add(rbox("crossh", (0.012, 0.58, 0.18), (s_ * (hw + 0.006), 0.75, 1.42), r=0.001, seg=1), red, den=0.2)
    siren_bar(b, -0.8, b.spec.get("height", 2.06) + 0.02)


@vehicle
def build_police_car(b):
    """A sedan in blue and white with a lamp bar. No badge: nothing here copies a real force's markings."""
    build_car_sedan(b)
    b.variants = {}
    b.variant("default", {"paint": "#eeeeea"})
    blue = paint("polband", "#17356e", rough=0.3, dust=0.12, chips=0.12, scratch=0.12, edge=0.3)
    hw = b.spec.get("width", 1.71) / 2 - 0.002
    for s_ in (1, -1):
        b.add(rbox("polband", (0.012, 2.9, 0.22), (s_ * hw, 0.0, 0.62), r=0.002, seg=1), blue, den=0.3)
    siren_bar(b, 0.1, 1.45, wide=1.05, red=False)


@vehicle
def build_leguna(b):
    """A human hauler: a small van run on a fixed route, green and yellow, roof rack and all, a helper on the step."""
    build_microbus(b)
    b.variants = {}
    b.variant("default", {"paint": "#1f8a4c"})
    b.variant("yellow", {"paint": "#d8a71c"})
    st = b.mat("steel", lambda: steel())
    yellow = paint("legband", "#e8c02a", rough=0.38, dust=0.25, chips=0.3, scratch=0.3, edge=0.6)
    hw = b.spec.get("width", 1.85) / 2 + 0.004
    top = b.spec.get("height", 2.06) + 0.04
    for s_ in (1, -1):
        b.add(rbox("legband", (0.012, 3.9, 0.14), (s_ * hw, 0.2, 0.88), r=0.002, seg=1), yellow, den=0.25)
        b.tube([(s_ * 0.72, -1.2, top), (s_ * 0.72, 1.9, top)], 0.016, st, seg=5, den=0.1)
    for y in np.arange(-1.2, 1.95, 0.5):
        b.tube([(-0.72, y, top), (0.72, y, top)], 0.012, st, seg=4, den=0.05)
    # The step at the back the helper rides on, and the rail he hangs from.
    b.add(rbox("legstep", (1.4, 0.3, 0.05), (0, 2.3, 0.42), r=0.008, seg=1), st, den=0.15)
    for s_ in (1, -1):
        b.tube([(s_ * 0.74, 2.14, 0.9), (s_ * 0.74, 2.26, 1.05), (s_ * 0.74, 2.2, 1.7)], 0.014, st, seg=5, den=0.1)


# ---------------------------------------------------------------------------
# Battery rickshaw (easybike)
# ---------------------------------------------------------------------------


def ebike_canvases(main="#d3202a", lower="#7c0f15", accent="#ffd21f", flower="#00a79d", W=2048, H=1024, seed=17):
    y0, y1, x0, x1, z0, z1 = -1.45, 1.45, -0.72, 0.72, 0.0, 1.8
    U = lambda y: (y - y0) / (y1 - y0) * W
    V = lambda z: (1 - (z - z0) / (z1 - z0)) * H
    side = Canvas(W, H, main)
    side.height[:] = 0.5
    side.rect(0, V(0.5), W, H, lower)
    side.rect(0, V(0.71), W, V(0.65), accent)
    side.rect(0, V(0.64), W, V(0.625), "#ffffff")
    for y, z, r, c in ((-0.86, 0.88, 26, accent), (0.30, 0.56, 22, "#ffffff"), (0.56, 0.56, 22, accent), (0.82, 0.56, 22, "#ffffff")):
        side.flower(U(y), V(z), r, 7, c, flower, "#7c0f15", outline="#2b0f24")
    for y in (-0.2, -0.05, 0.1):
        side.circle(U(y), V(0.57), 9, accent, outline="#2b0f24", ow=1)
    for ln in ([(-0.60, 1.0), (-0.60, 0.42)], [(-1.25, 0.5), (1.3, 0.5)], [(1.08, 0.78), (1.08, 0.42)]):
        seam(side, [(U(a), V(b_)) for a, b_ in ln], 3.0)
    for y in np.arange(-0.55, 1.05, 0.08):
        side.circle(U(y), V(0.46), 2.6, "#d6d6d6", alpha=0.7)

    FW = 1024
    Ux = lambda x: (x - x0) / (x1 - x0) * FW
    front = Canvas(FW, H, main)
    front.height[:] = 0.5
    front.rect(0, V(0.5), FW, H, lower)
    front.rect(0, V(0.71), FW, V(0.65), accent)
    front.rect(0, V(0.64), FW, V(0.625), "#ffffff")
    front.flower(Ux(0), V(0.92), 34, 8, accent, "#ffffff", "#7c0f15", outline="#2b0f24")
    seam(front, [(0, V(0.5)), (FW, V(0.5))], 3.0)

    rear = Canvas(FW, H, main)
    rear.height[:] = 0.5
    rear.rect(0, V(0.5), FW, H, lower)
    rear.rect(0, V(0.71), FW, V(0.65), accent)
    rear.rect(0, V(0.64), FW, V(0.625), "#ffffff")
    for i, x in enumerate((-0.3, -0.1, 0.1, 0.3)):
        rear.flower(Ux(x), V(0.54), 24, 7, accent if i % 2 else "#ffffff", flower, "#7c0f15", outline="#2b0f24")
    for cv in (side, front, rear):
        cv.speckle(0.03, seed=seed)
    return side, front, rear, dict(y0=y0, y1=y1, x0=x0, x1=x1, z0=z0, z1=z1)


@vehicle
def build_easybike(b):
    R = 0.245
    fy, ry, rx = -1.02, 0.78, 0.455
    rake = 22.0
    tan_r = math.tan(math.radians(rake))
    b.spec = dict(wheelbase=round(ry - fy, 3), wheelRadius=R, seatPose="sit_drive", glass_alpha=0.2, width=1.1)
    b.preview = dict(target=(0, 0.0, 0.85), distance=6.6, height=0.85)
    b.tex = 1024
    b.ao_distance = 0.45

    def A(z):
        return Vector((0, fy + 0.05 + (z - R) * tan_r, z))

    side_cv, front_cv, rear_cv, bounds = ebike_canvases()
    canv = dict(side=side_cv.to_image("eb_side"), side_h=side_cv.height_image("eb_side_h"), front=front_cv.to_image("eb_front"), front_h=front_cv.height_image("eb_front_h"), rear=rear_cv.to_image("eb_rear"), rear_h=rear_cv.height_image("eb_rear_h"))
    bodyp = livery("ebpaint", canv, bounds, dust=0.2, chips=0.12, scratch=0.14, edge=0.8, chip_col="#3f3a2c", grime=0.14)
    trim = paint("ebtrim", "#d3202a", rough=0.34, dust=0.25, chips=0.25, scratch=0.2, edge=0.8, slot="main", chip_col="#3f3a2c")
    yellow = paint("ebyellow", "#ffd21f", rough=0.34, dust=0.25, chips=0.25, scratch=0.15, chip_col="#574016", slot="accent")
    gold_m = paint("ebcord", "#f4c21a", rough=0.5, dust=0.05, chips=0, scratch=0, edge=0)
    ch = b.mat("chrome", lambda: chrome())
    st = b.mat("steel", lambda: steel())
    rub = b.mat("rubber", lambda: rubber())
    blk = paint("blk", "#17181a", rough=0.5, dust=0.35, chips=0.2, scratch=0.2, edge=0.5, chip_col="#55504a")

    # ---- boxy lower wall
    half = [(p.x, p.y) for p in curve([(0.0, -1.30), (0.16, -1.285), (0.30, -1.22), (0.40, -1.11), (0.47, -0.96), (0.50, -0.80), (0.505, -0.68)], 3)]
    half += [(0.505, y) for y in (-0.60, -0.57, -0.54, -0.50, -0.40, -0.2, 0.0, 0.2, 0.40, 0.46, 0.52, 0.58, 0.64, 0.70, 0.76, 0.82, 0.88, 0.94, 1.0, 1.06, 1.12)]
    half += [(p.x, p.y) for p in curve([(0.505, 1.12), (0.5, 1.2), (0.46, 1.255), (0.36, 1.275), (0.18, 1.28), (0.0, 1.285)], 2)][1:]
    arch_r, arch_c = R + 0.07, (ry, R)

    def z_top(y):
        if y < -0.60:
            return 1.03
        if y < -0.54:
            return 1.03 + (0.72 - 1.03) * (y + 0.60) / 0.06
        return 0.73

    def z_bot(y):
        if y < -0.62:
            t = min(1.0, (-y - 0.62) / 0.68)
            return 0.36 + 0.14 * t
        d = abs(y - arch_c[0])
        if d < arch_r:
            return arch_c[1] + math.sqrt(max(0.0, arch_r ** 2 - d ** 2))
        return 0.34

    def off(v, y):
        lean = 0.12 * max(0.0, (-y - 0.55) / 0.75) if y < -0.55 else 0.0
        return 0.008 * math.sin(math.pi * min(1.0, v / 0.7)) - 0.018 * max(0.0, 0.08 - v) / 0.08 - lean * max(0.0, v - 0.4) ** 1.5 * 2.4

    vs = [0.0, 0.06, 0.2, 0.4, 0.46, 0.62, 0.8, 1.0]
    wall, rows, cols = wall_loft("wall", half, z_bot, z_top, vs, off)
    b.add(wall, bodyp, den=2.2)
    # lid over the cowl and over the wall top
    ring = rows[-1]
    idx = [i for i, p in enumerate(ring) if p.y < -0.585]
    order = sorted(idx, key=lambda i: math.atan2(ring[i].x, ring[i].y + 0.585))
    b.add(plate("cowl_lid", [(ring[i].x, ring[i].y) for i in order], 0.012, origin=(0, 0, 1.022), u=(1, 0, 0), v=(0, 1, 0)), trim, den=0.8)

    def tops(s):
        b.tube([(s * 0.505, -0.54, 0.735), (s * 0.505, 1.14, 0.735), (s * 0.47, 1.26, 0.735)], 0.012, ch, seg=6, den=0.45)
        pts = [(s * 0.515, ry + math.cos(math.radians(a)) * arch_r, arch_c[1] + math.sin(math.radians(a)) * arch_r) for a in range(0, 181, 15)]
        b.tube(pts, 0.008, rub, seg=4, den=0.25)
        b.add(fender("hs", (s * 0.43, ry, R), arch_r - 0.004, 0.16, 0, 180, n=10), blk, den=0.3)

    b.both(tops)
    b.add(rbox("floor", (0.98, 1.9, 0.02), (0, 0.32, 0.345), r=0.004, seg=1), paint("floor", "#35373a", rough=0.65, dust=0.55, chips=0.25, scratch=0.3, edge=0.4), den=0.45)
    b.add(rbox("firewall", (0.98, 0.012, 0.68), (0, -0.585, 0.70), r=0.003, seg=1), trim, den=0.4)
    b.add(rbox("dash", (0.92, 0.1, 0.09), (0, -0.60, 1.07), r=0.02, seg=1), blk, den=0.5)
    b.add(lathe("cluster", [(-0.028, 0.0), (-0.028, 0.075), (-0.012, 0.08), (0.0, 0.08)], 12, (0, -0.54, 1.11), axis="y"), blk, den=0.4)
    b.add(lathe("gauge", [(-0.0285, 0.0), (-0.0285, 0.066)], 12, (0, -0.54, 1.11), axis="y"), bo.pbr("gauge", C("#e7e4d4"), 0.2), den=0.4)
    b.add(rbox("battery", (0.86, 0.42, 0.24), (0, 0.32, 0.47), r=0.02, seg=1), blk, den=0.35)
    for i in range(4):
        b.add(rbox("cell", (0.17, 0.32, 0.03), (-0.3 + i * 0.2, 0.32, 0.6), r=0.005, seg=1), b.mat("cellp", lambda: paint("cellp", "#2a3a4a", rough=0.4, dust=0.4, chips=0.1, scratch=0.1, edge=0.3)), den=0.25)

    # ---- seats: driver up front, then two benches facing each other
    drv = vinyl("drv", "#26211d", rough=0.48, dust=0.1)
    sea = vinyl("sea", "#a51522", rough=0.4, tuft=10.0, dust=0.1, slot="seat")
    seat_block(b, (0, -0.46, 0.58), 0.54, 0.34, 0.09, 0.34, drv, lean=8, frame_h=0.22)
    b.add(rbox("bench1", (0.92, 0.36, 0.1), (0, 0.30, 0.60), r=0.03, seg=2), sea, den=1.0)
    b.add(rbox("bench1b", (0.92, 0.07, 0.42), (0, 0.075, 0.85), rot=(math.radians(-8), 0, 0), r=0.025, seg=2), sea, den=1.0)
    b.add(rbox("bench2", (0.92, 0.36, 0.1), (0, 0.98, 0.60), r=0.03, seg=2), sea, den=1.0)
    b.add(rbox("bench2b", (0.92, 0.07, 0.42), (0, 1.205, 0.85), rot=(math.radians(8), 0, 0), r=0.025, seg=2), sea, den=1.0)
    b.add(rbox("bench2base", (0.86, 0.3, 0.24), (0, 0.98, 0.45), r=0.012, seg=1), blk, den=0.3)
    b.empty("seat_driver", (0, -0.27, 0.72))
    b.empty("exit_L", (0.85, -0.27, 0))
    b.empty("exit_R", (-0.85, -0.27, 0))
    b.empty("seat_p1", (0.24, 0.30, 0.68), yaw=180)
    b.empty("seat_p2", (-0.24, 0.30, 0.68), yaw=180)
    b.empty("seat_p3", (0.24, 0.98, 0.68))
    b.empty("seat_p4", (-0.24, 0.98, 0.68))

    # ---- roof on four posts, windscreen, rolled rain curtains
    roof_z = 1.70
    roof_half, ry0, ry1 = 0.54, -0.86, 1.33
    ol = rrect(roof_half * 2, ry1 - ry0, 0.12, n=4, cy=(ry0 + ry1) / 2)
    cy = (ry0 + ry1) / 2

    def ringr(k, z):
        return [V3(p[0] * k, cy + (p[1] - cy) * k, z) for p in ol]

    roofm = paint("ebroof", "#1d1f22", rough=0.5, dust=0.55, chips=0.25, scratch=0.25, edge=0.8, chip_col="#7c6d58", grime=0.3)
    r_rows = [ringr(1.0, roof_z - 0.05), ringr(1.0, roof_z - 0.015), ringr(0.97, roof_z + 0.008), ringr(0.8, roof_z + 0.024), ringr(0.45, roof_z + 0.032), ringr(0.1, roof_z + 0.034)]
    b.add(orient_out(grid("roof", r_rows, close_u=True), (0, 0.2, 1.0)), roofm, den=0.9)
    b.add(rbox("roofcap", (0.14, 0.3, 0.004), (0, cy, roof_z + 0.033), r=0.001, seg=1), roofm, den=0.1)
    b.add(orient_out(grid("fascia", [ringr(1.012, roof_z - 0.06), ringr(1.012, roof_z - 0.015)], close_u=True), (0, 0.2, 1.0)), trim, den=0.5)
    b.tube(ringr(1.016, roof_z - 0.03), 0.005, ch, seg=4, closed=True, den=0.25)
    b.add(plate("liner", ol, 0.008, origin=(0, 0, roof_z - 0.055), u=(1, 0, 0), v=(0, 1, 0)), fabric("liner", "#b9b19a", weave=40, dust=0.1), den=0.3)

    def ws(u, v):
        hw = 0.475 - 0.01 * v
        return V3(hw * u, -0.665 + 0.09 * v - 0.11 * (1 - u * u), 1.05 + (1.625 - 1.05) * v)

    b.glass(grid("ws", [[ws(-1 + 2 * j / 10, i / 3) for j in range(11)] for i in range(4)]))
    gas = [ws(-1 + 2 * j / 10, 0) for j in range(11)] + [ws(1, i / 3) for i in range(1, 4)] + [ws(1 - 2 * j / 10, 1) for j in range(1, 11)] + [ws(-1, 1 - i / 3) for i in range(1, 3)]
    b.tube(gas, 0.01, rub, seg=4, closed=True, den=0.25)

    def posts(s):
        b.tube(curve([ws(s, 0) + V3(s * 0.016, 0, -0.04), ws(s, 0.5) + V3(s * 0.016, 0.01, 0), ws(s, 1) + V3(s * 0.016, 0.01, 0.06)], 2), 0.019, trim, seg=7, den=0.5)
        b.tube([(s * 0.502, 1.19, 0.72), (s * 0.502, 1.20, roof_z - 0.05)], 0.019, trim, seg=7, den=0.5)
        b.tube([(s * 0.50, 0.0, 0.72), (s * 0.50, 0.0, roof_z - 0.05)], 0.016, ch, seg=6, den=0.3)
        b.tube([(s * 0.502, 0.0, 0.96), (s * 0.502, 1.19, 0.96)], 0.011, ch, seg=5, den=0.3)
        # rolled-up rain curtain under the roof edge
        b.tube([(s * 0.53, -0.05, roof_z - 0.095), (s * 0.53, 1.25, roof_z - 0.095)], 0.034, curtain, seg=7, den=0.45)
        for y in (0.15, 0.6, 1.05):
            b.tube([(s * 0.527, y, roof_z - 0.06), (s * 0.565, y, roof_z - 0.095), (s * 0.527, y, roof_z - 0.13)], 0.005, st, seg=4, den=0)

    curtain = fabric("curtain", "#2d6d9e", weave=150, dust=0.25, col2="#245a84", slot="curtain")
    b.both(posts)
    b.tube([(-0.5, 1.2, 0.96), (0.5, 1.2, 0.96)], 0.011, ch, seg=5, den=0.3)
    b.tube([(-0.5, 1.285, 0.74), (-0.5, 1.33, 0.74), (0.5, 1.33, 0.74), (0.5, 1.285, 0.74)], 0.011, ch, seg=5, den=0.3)
    b.add(rbox("rearstep", (0.92, 0.2, 0.02), (0, 1.36, 0.38), r=0.004, seg=1), st, den=0.35)
    b.add(rbox("stepholder", (0.92, 0.1, 0.04), (0, 1.27, 0.37), r=0.006, seg=1), blk, den=0.2)

    # ---- nose: twin lamps, indicators, mudguard, mirrors
    for s in (1, -1):
        round_lamp(b, (s * 0.20, -1.292, 0.76), 0.075, "clear", den=1.1)
        b.add(lathe("pod", [(0.06, 0.1), (0.012, 0.1), (0.0, 0.088)], 14, (s * 0.20, -1.292, 0.76), axis="y"), trim, den=0.4)
        round_lamp(b, (s * 0.37, -1.145, 0.90), 0.045, "amber", den=0.7, bezel=blk)
        b.empty("light_FL" if s > 0 else "light_FR", (s * 0.20, -1.33, 0.76))
        mirror_stalk(b, (s * 0.48, -0.70, 1.03), (s * 0.63, -0.76, 1.26), r=0.055)
        round_lamp(b, (s * 0.40, 1.274, 0.66), 0.05, "red", direction=1, den=0.6, bezel=blk)
        round_lamp(b, (s * 0.28, 1.28, 0.66), 0.036, "amber", direction=1, den=0.4, bezel=blk)
        b.empty("light_RL" if s > 0 else "light_RR", (s * 0.40, 1.31, 0.66))
    b.empty("plate_F", (0, -1.292, 0.60))
    b.empty("plate_R", (0, 1.292, 0.52))
    b.add(rbox("platebkt", (0.34, 0.008, 0.17), (0, 1.288, 0.52), r=0.002, seg=1), blk, den=0.2)
    b.tube(curve([(-0.40, -1.06, 0.49), (-0.2, -1.31, 0.47), (0.2, -1.31, 0.47), (0.40, -1.06, 0.49)], 4), 0.012, ch, seg=6, den=0.45)
    b.tube([(0.1, -0.79, 1.06), (-0.05, -0.77, 1.28)], 0.0035, blk, seg=4, den=0)
    b.tube([(-0.14, -0.79, 1.18), (0.04, -0.76, 1.38)], 0.004, rub, seg=4, den=0)

    # ---- rear axle and motor
    b.tube([(-0.42, ry, R), (0.42, ry, R)], 0.02, blk, seg=7, den=0.25)
    b.add(lathe("motor", [(-0.09, 0.0), (-0.09, 0.09), (-0.05, 0.115), (0.05, 0.115), (0.09, 0.09), (0.09, 0.0)], 12, (0, ry, R), axis="x"), b.mat("motorp", lambda: paint("motorp", "#3a3a3a", rough=0.5, metal=0.6, dust=0.5, chips=0.2, scratch=0.15, edge=0.5)), den=0.35)
    b.both(lambda s: b.add(spring_coil("shock", (s * 0.34, ry + 0.06, R + 0.03), 0.17, 0.028, turns=5, wire=0.0045), yellow, den=0))

    # ---- steering
    b.set_steer(A(0.8), rake)
    b.tube([A(0.42), A(1.13)], 0.017, st, "steer", seg=8, den=0.6)
    bc = A(1.13)
    bar = curve([(0.31, bc.y + 0.19, bc.z + 0.05), (0.22, bc.y + 0.15, bc.z + 0.045), (0.1, bc.y + 0.05, bc.z + 0.018), (0.0, bc.y, bc.z), (-0.1, bc.y + 0.05, bc.z + 0.018), (-0.22, bc.y + 0.15, bc.z + 0.045), (-0.31, bc.y + 0.19, bc.z + 0.05)], 3)
    b.tube(bar, 0.0115, ch, "steer", seg=7)

    def grip(s):
        g0, g1 = V3(s * 0.21, bc.y + 0.145, bc.z + 0.044), V3(s * 0.315, bc.y + 0.193, bc.z + 0.05)
        b.tube([g0, g1], 0.017, rub, "steer", seg=7, den=0.5)
        b.empty("grip_L" if s > 0 else "grip_R", (g0 + g1) / 2, parent="steer")

    b.both(grip)
    b.add(rbox("barhub", (0.09, 0.05, 0.05), bc + V3(0, 0, -0.005), r=0.012, seg=1), blk, "steer", den=0.4)
    crown = A(0.56)

    def fork(s):
        b.tube(curve([crown + V3(s * 0.078, 0, 0), crown + V3(s * 0.08, -0.04, -0.14), (s * 0.08, fy + 0.01, R + 0.05), (s * 0.08, fy, R)], 3), 0.017, ch, "steer", seg=7, den=0.5)
        b.add(lathe("forkboot", [(-0.04, 0.02), (0.08, 0.027), (0.1, 0.02)], 8, (s * 0.08, fy + 0.03, R + 0.10), axis="z"), rub, "steer", den=0.3)

    b.both(fork)
    b.tube([crown + V3(-0.09, 0, 0), crown + V3(0.09, 0, 0)], 0.02, trim, "steer", seg=7, den=0.4)
    b.add(fender("fguard", (0, fy, R), R + 0.03, 0.135, 22, 170, n=14, drop=0.025), trim, "steer", den=1.1)
    b.add(fender("fguardy", (0, fy, R), R + 0.033, 0.026, 40, 170, n=9, drop=0.003), yellow, "steer", den=0.5)

    def eb_wheel(bb, c):
        wheel_truck(bb, c, R, 0.095, 0.145, bolts=4, seg=22, den=1.4, disc_col="#d8d9d6", lugs=20, holes=6)

    b.add_wheels([("wheel_F", (0, fy, R), True), ("wheel_RL", (rx, ry, R), False), ("wheel_RR", (-rx, ry, R), True)], eb_wheel)

    # tasselled fringe along the roof edge, as on the decorated ones in Mirpur
    tm = fabric("tuft_pink", "#ff2d86", dust=0.05)
    tm2 = fabric("tuft_yel", "#ffd21f", dust=0.05)
    ring_f = ringr(1.012, roof_z - 0.062)
    n_f = len(ring_f)
    count = 0
    for i in range(n_f):
        a, c = ring_f[i], ring_f[(i + 1) % n_f]
        seg_len = (c - a).length
        steps = max(1, int(seg_len / 0.13))
        for k in range(steps):
            q = a.lerp(c, k / steps)
            if q.y > 1.0 or (abs(q.x) > 0.5 and -0.05 < q.y < 1.0):
                continue
            tassel(b, q, 0.065 if count % 2 else 0.09, gold_m, tm if count % 2 else tm2)
            count += 1
    # small grab handles on the posts
    def grabs(s):
        b.tube([(s * 0.47, -0.02, 1.32), (s * 0.44, 0.02, 1.32), (s * 0.44, 0.02, 1.08), (s * 0.47, -0.02, 1.08)], 0.009, ch, seg=5, den=0.25)
        b.tube([(s * 0.47, 1.17, 1.32), (s * 0.44, 1.13, 1.32), (s * 0.44, 1.13, 1.08), (s * 0.47, 1.17, 1.08)], 0.009, ch, seg=5, den=0.25)

    b.both(grabs)

    def repaint(*args, **kw):
        def f():
            sc, fc, rc, _ = ebike_canvases(*args, **kw)
            sc.update_image(canv["side"])
            fc.update_image(canv["front"])
            rc.update_image(canv["rear"])

        return f

    b.variant("default")
    b.variant("blue", {"main": "#1457b8", "seat": "#a57a15", "curtain": "#b22a2f"}, repaint("#1457b8", "#0b2f66", "#ffd21f", "#ff2d86"))
    b.variant("green", {"main": "#128a4a", "seat": "#a51522", "curtain": "#d08a1d"}, repaint("#128a4a", "#0a5230", "#ffd21f", "#ff2d86"))


# ---------------------------------------------------------------------------
# Motorbike: 150 cc sport commuter
# ---------------------------------------------------------------------------


def wheel_moto(b, c, r, width, rim_r, rotor=True, sprocket=False, seg=30, den=1.2):
    """Symmetric alloy wheel: tyre, rim, Y spokes, hub, disc and sprocket."""
    node = b.current_wheel
    tm = tyre_mat(f"tyre_{node}", c, r, width, lugs=26, kind="road")
    h = width / 2
    prof = [(-h * 0.62, rim_r), (-h * 0.98, rim_r + (r - rim_r) * 0.45), (-h * 0.88, rim_r + (r - rim_r) * 0.82), (-h * 0.5, r - 0.006), (0.0, r), (h * 0.5, r - 0.006), (h * 0.88, rim_r + (r - rim_r) * 0.82), (h * 0.98, rim_r + (r - rim_r) * 0.45), (h * 0.62, rim_r)]
    b.add(lathe("tyre", prof, seg, c), tm, node, den=den)
    al = paint(f"alloy_{node}", "#1f2022", rough=0.34, metal=0.4, dust=0.25, chips=0.15, scratch=0.15, edge=0.7, chip_col="#b8b8b8", grime=0.3)
    rim = [(-h * 0.66, rim_r + 0.006), (-h * 0.6, rim_r - 0.012), (0.0, rim_r - 0.02), (h * 0.6, rim_r - 0.012), (h * 0.66, rim_r + 0.006)]
    b.add(lathe("rim", rim, seg, c), al, node, den=den)
    cv = Vector(c)
    objs = []
    for i in range(3):
        a0 = 2 * math.pi * i / 3 + 0.3
        for off in (-0.26, 0.26):
            a = a0 + off
            d0 = V3(0, math.cos(a0), math.sin(a0))
            d1 = V3(0, math.cos(a), math.sin(a))
            p0, p1 = d0 * 0.052, d1 * (rim_r - 0.014)
            perp0 = V3(0, -d0.z, d0.y)
            perp1 = V3(0, -d1.z, d1.y)
            rows = []
            for t, wd, th in ((0.0, 0.016, 0.022), (1.0, 0.01, 0.012)):
                pm = p0 * (1 - t) + p1 * t
                perp = perp0 * (1 - t) + perp1 * t
                rows.append([cv + pm - perp * wd + V3(-th, 0, 0), cv + pm + perp * wd + V3(-th, 0, 0), cv + pm + perp * wd + V3(th, 0, 0), cv + pm - perp * wd + V3(th, 0, 0)])
            objs.append(grid("s", rows, close_u=True))
    sp = bo.join(objs, "mspokes")
    bo.recalc_normals(sp)
    b.add(sp, al, node, den=den)
    b.add(lathe("hub", [(-0.05, 0.0), (-0.05, 0.03), (-0.03, 0.055), (0.03, 0.055), (0.05, 0.03), (0.05, 0.0)], 14, c), al, node, den=den)
    if rotor:
        rm = paint(f"rotor_{node}", "#b4b6b8", rough=0.3, metal=1.0, dust=0.2, chips=0, scratch=0.15, edge=0, grime=0.4)
        b.add(lathe("rotor", [(-0.002, 0.075), (-0.002, 0.118), (0.002, 0.118), (0.002, 0.075)], 22, cv + V3(-0.058, 0, 0)), rm, node, den=den * 0.7)
        b.add(bolt_ring("rotb", cv + V3(-0.06, 0, 0), 0.066, 5, bolt_r=0.006, depth=0.006, seg=5), al, node, den=den * 0.4)
    if sprocket:
        b.add(gear("sprocket", 0.088, 20, 0.005, cv + V3(0.078, 0, 0), tooth=0.007), b.mat("blackteeth", lambda: paint("blackteeth", "#232325", rough=0.45, metal=0.5, dust=0.3, chips=0.2, scratch=0.1, edge=0.5)), node, den=den * 0.6)


def bike_paint(name, col, slot):
    """Sport-commuter bodywork: base colour with a dark lower tone and a clean pinstripe decal."""

    def fn(g):
        s = g.uvw
        base = g.rgb(col, slot)
        dark = g.smooth(s[2], 0.76, 0.72)
        out = g.mixc(g.mul(dark, 0.82), base, (0.01, 0.01, 0.012))
        d = g.add(g.mul(s[1], 0.55), s[2])
        stripe = g.mul(g.smooth(d, 0.905, 0.915), g.smooth(d, 0.955, 0.945))
        out = g.mixc(stripe, out, (0.85, 0.85, 0.82))
        return out

    return paint(name, fn, rough=0.2, dust=0.1, chips=0.04, scratch=0.08, edge=0.3, chip_col="#555555", grime=0.05)


@vehicle
def build_motorbike(b):
    R = 0.305
    fy, ry = -0.66, 0.66
    rake = 26.0
    tan_r = math.tan(math.radians(rake))
    b.spec = dict(wheelbase=round(ry - fy, 3), wheelRadius=R, seatPose="ride_motorbike")
    b.preview = dict(target=(0, 0.0, 0.62), distance=4.6, height=0.65)
    b.tex = 1024
    b.ao_distance = 0.35

    def A(z):
        return Vector((0, fy + 0.035 + (z - R) * tan_r, z))

    bp = bike_paint("bikepaint", "#c0141c", "paint")
    blk = paint("framep", "#17181a", rough=0.38, dust=0.2, chips=0.15, scratch=0.15, edge=0.6, chip_col="#7a7a7a", grime=0.1)
    ch = b.mat("chrome", lambda: chrome())
    st = b.mat("steel", lambda: steel())
    rub = b.mat("rubber", lambda: rubber())
    seatm = vinyl("seatm", "#1b1b1d", rough=0.5, dust=0.08)
    alu = paint("alu", "#a8abae", rough=0.4, metal=0.85, dust=0.25, chips=0.1, scratch=0.15, edge=0.4, grime=0.3)
    motor = paint("motorcase", "#34363a", rough=0.46, metal=0.65, dust=0.35, chips=0.1, scratch=0.1, edge=0.5, chip_col="#a0a0a0", grime=0.3)

    # ---- steering: forks, clamps, bars, lamp, mudguard
    b.set_steer(A(0.93), rake)
    top_c, bot_c = A(1.02), A(0.84)

    def L(x, z):
        p = A(z)
        return V3(x, p.y - 0.035, z)

    b.tube([bot_c, top_c], 0.018, st, "steer", seg=7, den=0.3)

    def fork(s):
        x = s * 0.078
        b.tube([L(x, 1.03), L(x, 0.60)], 0.0165, ch, "steer", seg=9)
        b.tube([L(x, 0.62), L(x, R + 0.02)], 0.024, blk, "steer", seg=9, rs=[0.0255, 0.0225], den=0.9)
        b.add(lathe("seal", [(-0.012, 0.0185), (-0.012, 0.026), (0.012, 0.024), (0.012, 0.0185)], 9, L(x, 0.625), axis="z"), rub, "steer", den=0.3)
        b.add(rbox("axle_lug", (0.03, 0.055, 0.05), (x, fy, R), r=0.008, seg=1), blk, "steer", den=0.4)

    b.both(fork)
    for z, h in ((1.02, 0.03), (0.84, 0.035)):
        b.add(rbox("clamp", (0.21, 0.07, h), L(0, z) + V3(0, 0.018, 0), r=0.012, seg=1), blk, "steer", den=0.6)
    b.tube([(-0.098, fy, R), (0.098, fy, R)], 0.009, st, "steer", seg=6, den=0.2)
    # brake caliper
    b.add(rbox("caliper", (0.03, 0.09, 0.07), (-0.062, fy + 0.085, R + 0.075), r=0.012, seg=1), b.mat("calip", lambda: paint("calip", "#b0171d", rough=0.35, dust=0.25, chips=0.1, scratch=0.1, edge=0.3)), "steer", den=0.4)
    # mudguard with brace
    b.add(fender("fguard", (0, fy, R), R + 0.03, 0.115, 28, 158, n=14, drop=0.024), bp, "steer", den=1.2)
    b.both(lambda s: b.tube([(s * 0.056, fy + 0.2, R + 0.21), (s * 0.075, fy + 0.03, R + 0.06)], 0.006, blk, "steer", seg=4, den=0.15))
    # head lamp cowl
    lc = A(0.97) + V3(0, -0.15, 0.0)
    rings = [dict(c=(0, lc.y + 0.13, lc.z + 0.01), rx=0.09, ry=0.10, axis="y", power=2.8), dict(c=(0, lc.y + 0.06, lc.z + 0.012), rx=0.118, ry=0.128, axis="y", power=2.8), dict(c=(0, lc.y - 0.02, lc.z + 0.006), rx=0.115, ry=0.12, axis="y", power=2.8), dict(c=(0, lc.y - 0.075, lc.z + 0.006), rx=0.09, ry=0.095, axis="y", power=2.6)]
    b.add(bo.loft("cowl", rings, segments=16), bp, "steer", den=1.3)
    round_lamp(b, (0, lc.y - 0.075, lc.z + 0.006), 0.078, "clear", node="steer", den=1.0, bezel=blk)
    b.empty("light_FL", (0.02, lc.y - 0.11, lc.z), parent="steer")
    b.empty("light_FR", (-0.02, lc.y - 0.11, lc.z), parent="steer")
    # flyscreen, a small tinted tab above the lamp
    fly = plate("flyscreen", rrect(0.16, 0.11, 0.03, n=2), 0.003, origin=(0, lc.y - 0.035, lc.z + 0.145), u=(1, 0, 0), v=(0, 0.45, 0.89))
    b.add(fly, b.mat("smoke", lambda: bo.pbr("smoke", C("#141a1e"), 0.08, 0.1)), "steer", den=0.4)
    # indicators
    for s in (1, -1):
        b.tube([(s * 0.09, lc.y + 0.07, lc.z - 0.02), (s * 0.17, lc.y + 0.06, lc.z - 0.02)], 0.006, blk, "steer", seg=4, den=0.15)
        b.add(bo.loft("ind", [dict(c=(s * 0.17, lc.y + 0.06 - i * 0.035, lc.z - 0.02), rx=0.022 - i * 0.004, ry=0.016 - i * 0.002, axis="y", power=2) for i in range(3)], segments=8), b.mat("lens_amber", lambda: lens_amber()), "steer", den=0.35)
    # speedo pod
    sc = A(1.03) + V3(0, -0.035, 0.05)
    b.add(lathe("speedo", [(-0.03, 0.0), (-0.03, 0.05), (0.0, 0.058), (0.035, 0.052), (0.035, 0.0)], 14, sc, axis="y"), blk, "steer", den=0.6)
    b.add(lathe("dial", [(0.0355, 0.0), (0.0355, 0.046)], 14, sc, axis="y"), bo.pbr("dial", C("#d8d9d2"), 0.25), "steer", den=0.5)
    # bars
    bc = A(1.03)
    bar = curve([(0.37, bc.y + 0.13, bc.z + 0.085), (0.24, bc.y + 0.08, bc.z + 0.075), (0.09, bc.y + 0.015, bc.z + 0.055), (-0.09, bc.y + 0.015, bc.z + 0.055), (-0.24, bc.y + 0.08, bc.z + 0.075), (-0.37, bc.y + 0.13, bc.z + 0.085)], 3)
    b.tube(bar, 0.011, ch, "steer", seg=7)
    b.both(lambda s: b.add(rbox("riser", (0.03, 0.035, 0.05), (s * 0.04, bc.y + 0.01, bc.z + 0.03), r=0.006, seg=1), blk, "steer", den=0.2))

    def grips(s):
        g0, g1 = V3(s * 0.25, bc.y + 0.083, bc.z + 0.075), V3(s * 0.375, bc.y + 0.135, bc.z + 0.086)
        b.tube([g0, g1], 0.0165, rub, "steer", seg=7, den=0.6)
        b.empty("grip_L" if s > 0 else "grip_R", (g0 + g1) / 2, parent="steer")
        # switch pod and lever
        b.add(rbox("switch", (0.05, 0.05, 0.04), g0 + V3(-s * 0.03, -0.01, 0), r=0.008, seg=1), blk, "steer", den=0.3)
        b.tube([g0 + V3(-s * 0.02, -0.03, 0.005), g0 + V3(s * 0.07, -0.075, -0.005), g0 + V3(s * 0.15, -0.055, -0.005)], 0.0055, alu, "steer", seg=5, den=0.25)
        # mirror
        mb = g0 + V3(-s * 0.04, 0.0, 0.02)
        mt = mb + V3(s * 0.085, -0.02, 0.165)
        b.tube([mb, mt], 0.005, ch, "steer", seg=4, den=0.15)
        b.add(lathe("mirb", [(-0.012, 0.0), (-0.008, 0.052), (0.004, 0.055), (0.004, 0.0)], 12, mt, axis="y"), blk, "steer", den=0.4)
        b.add(lathe("mirf", [(0.0045, 0.0), (0.0045, 0.048)], 12, mt, axis="y"), b.mat("mirrorface", lambda: bo.pbr("mirrorface", C("#c9d6df"), 0.05, 1.0)), "steer", den=0.2)

    b.both(grips)
    b.empty("plate_F", (0, L(0, 0.72).y - 0.04, 0.72), parent="steer")

    # ---- frame
    head_t, head_b = A(1.015), A(0.855)
    b.tube([head_b, head_t], 0.026, blk, seg=9, den=0.8)
    spine = curve([A(0.99), (0, -0.14, 0.965), (0, 0.06, 0.92), (0, 0.21, 0.88)], 3)
    b.tube(spine, 0.021, blk, seg=8, den=0.7)
    down = curve([A(0.88), (0, -0.33, 0.60), (0, -0.27, 0.32), (0, 0.12, 0.27), (0, 0.22, 0.43)], 3)
    b.tube(down, 0.016, blk, seg=7, den=0.6)
    b.tube([(0, 0.21, 0.88), (0, 0.22, 0.43)], 0.018, blk, seg=7, den=0.5)

    def rearsub(s):
        b.tube(curve([(s * 0.02, 0.21, 0.88), (s * 0.09, 0.45, 0.885), (s * 0.075, 0.82, 0.94)], 3), 0.012, blk, seg=6, den=0.4)
        # swing arm
        b.add(sweep("swing", [(s * 0.075, 0.225, 0.435), (s * 0.085, 0.45, 0.37), (s * 0.095, ry, R)], [(-0.016, -0.025), (0.016, -0.025), (0.016, 0.025), (-0.016, 0.025)], up=(0, 0, 1)), blk, den=0.7)
        b.add(rbox("adj", (0.012, 0.08, 0.05), (s * 0.104, ry, R), r=0.005, seg=1), alu, den=0.3)
        # twin shocks
        p0 = V3(s * 0.11, ry - 0.08, R + 0.05)
        p1 = V3(s * 0.11, 0.42, 0.80)
        b.tube([p0, p1], 0.008, ch, seg=5, den=0.2)
        b.add(lathe("sbody", [(0.0, 0.0), (0.0, 0.024), (0.15, 0.024), (0.15, 0.0)], 8, p1 + V3(0, 0.012, -0.17), axis="z"), blk, den=0.3)
        dv = (p1 - p0)
        coil = []
        n = 34
        d = dv.normalized()
        xv = d.cross(V3(1, 0, 0)).normalized()
        yv = d.cross(xv).normalized()
        for i in range(n + 1):
            t = i / n
            a = t * 6 * 2 * math.pi
            coil.append(p0 + dv * (0.1 + 0.8 * t) + (xv * math.cos(a) + yv * math.sin(a)) * 0.027)
        b.tube(coil, 0.0045, spring_m, seg=4, den=0)
        # foot pegs and pillion pegs
        b.tube([(s * 0.05, 0.13, 0.34), (s * 0.2, 0.13, 0.34)], 0.011, rub, seg=6, den=0.35)
        b.tube([(s * 0.08, 0.44, 0.47), (s * 0.18, 0.44, 0.47)], 0.009, rub, seg=5, den=0.25)
        b.tube([(s * 0.075, 0.22, 0.44), (s * 0.08, 0.3, 0.42), (s * 0.08, 0.44, 0.47)], 0.009, alu, seg=5, den=0.2)

    spring_m = paint("springm", "#d0171f", rough=0.32, dust=0.1, chips=0, scratch=0, edge=0)
    b.both(rearsub)
    b.tube([(-0.09, 0.225, 0.435), (0.09, 0.225, 0.435)], 0.014, st, seg=7, den=0.25)
    b.tube([(-0.11, ry, R), (0.11, ry, R)], 0.009, st, seg=6, den=0.2)

    # ---- engine: crankcase, finned cylinder, clutch cover, kick lever, carb
    cc = V3(0, -0.04, 0.40)
    b.add(lathe("crank", [(-0.115, 0.0), (-0.115, 0.095), (-0.1, 0.125), (0.1, 0.125), (0.115, 0.095), (0.115, 0.0)], 18, cc), motor, den=1.1)
    b.add(lathe("magneto", [(0.115, 0.0), (0.115, 0.08), (0.135, 0.07), (0.145, 0.03), (0.145, 0.0)], 14, cc), alu, den=0.7)
    b.add(lathe("clutch", [(-0.115, 0.0), (-0.115, 0.098), (-0.142, 0.085), (-0.155, 0.04), (-0.155, 0.0)], 14, cc + V3(0, 0.06, -0.005)), alu, den=0.7)
    b.add(bolt_ring("casebolts", cc + V3(-0.142, 0.06, -0.005), 0.06, 6, bolt_r=0.005, depth=0.012, seg=5), blk, den=0.15)
    b.add(rbox("sump", (0.2, 0.3, 0.11), (0, 0.06, 0.32), r=0.03, seg=1), motor, den=0.5)
    tilt = math.radians(-18)
    for i in range(7):
        zz = 0.06 + i * 0.024
        cen = cc + V3(0, math.sin(tilt) * (0.1 + zz), math.cos(tilt) * (0.1 + zz))
        w = 0.17 if i < 6 else 0.14
        b.add(rbox("fin", (w, w * 0.92, 0.009), cen, rot=(tilt, 0, 0), r=0.003, seg=1), alu, den=0.35)
    head = cc + V3(0, math.sin(tilt) * 0.37, math.cos(tilt) * 0.37)
    b.add(rbox("rocker", (0.135, 0.135, 0.06), head, rot=(tilt, 0, 0), r=0.018, seg=1), motor, den=0.5)
    core = cc + V3(0, math.sin(tilt) * 0.24, math.cos(tilt) * 0.24)
    b.add(lathe("bore", [(-0.1, 0.0), (-0.1, 0.05), (0.1, 0.05), (0.1, 0.0)], 10, core, axis="z"), blk, den=0.3)
    b.add(rbox("carb", (0.07, 0.11, 0.07), (0.0, 0.14, 0.62), r=0.016, seg=1), alu, den=0.4)
    b.add(rbox("airbox", (0.14, 0.14, 0.12), (0.0, 0.28, 0.69), r=0.018, seg=1), blk, den=0.35)
    b.tube([(-0.17, 0.13, 0.38), (-0.20, 0.17, 0.32), (-0.20, 0.27, 0.34)], 0.009, alu, seg=5, den=0.25)
    b.tube([(0.155, 0.02, 0.36), (0.17, 0.14, 0.33)], 0.007, blk, seg=4, den=0.15)
    # exhaust: header round the engine, sporty silencer on the right
    exh = curve([head + V3(-0.01, -0.07, -0.05), (-0.04, -0.235, 0.56), (-0.09, -0.24, 0.36), (-0.15, -0.1, 0.25), (-0.19, 0.2, 0.27), (-0.2, 0.46, 0.38)], 3)
    b.tube(exh, 0.0165, st, seg=8, den=0.7)
    muf = curve([(-0.2, 0.46, 0.38), (-0.205, 0.62, 0.44), (-0.205, 0.80, 0.51), (-0.205, 0.97, 0.575)], 2)
    nm = len(muf)
    b.tube(muf, 0.05, ch, seg=12, rs=[0.024 + 0.024 * min(1, i / 2) - 0.012 * max(0, i - nm + 3) / 3 for i in range(nm)], den=1.0)
    b.add(rbox("heatshield", (0.012, 0.22, 0.09), (-0.262, 0.70, 0.47), rot=(math.radians(20), 0, 0), r=0.004, seg=1), blk, den=0.4)
    # chain and guard on the left
    chain_x = 0.082
    fs = V3(chain_x, 0.0, 0.36)
    b.add(gear("frontsprk", 0.038, 14, 0.005, fs, tooth=0.005), blk, den=0.3)
    chain_m = bo.pbr("chain", C("#3a3a3c"), 0.5, 0.8)
    gg = G(chain_m)
    gg.bump(gg.math("SINE", gg.mul(gg.uvw[1], 380.0)), 0.8, 0.003)
    for z0, z1 in ((fs.z + 0.042, R + 0.094), (fs.z - 0.042, R - 0.094)):
        b.add(sweep("chain", [(chain_x, fs.y, z0), (chain_x, ry, z1)], [(-0.005, -0.005), (0.005, -0.005), (0.005, 0.005), (-0.005, 0.005)], up=(0, 0, 1)), chain_m, den=0.3)
    b.add(plate("chainguard", [(0.1, 0.42), (0.62, 0.38), (0.66, 0.36), (0.62, 0.34), (0.1, 0.39)], 0.004, origin=(chain_x + 0.005, 0, 0), u=(0, 1, 0), v=(0, 0, 1)), blk, den=0.4)
    # side stand
    b.tube([(0.1, 0.18, 0.31), (0.2, 0.2, 0.04)], 0.01, blk, seg=5, den=0.2)
    b.add(rbox("standfoot", (0.03, 0.05, 0.012), (0.2, 0.2, 0.02), r=0.004, seg=1), blk, den=0.1)

    # ---- tank, shrouds, seat, tail
    tk = [(-0.30, 0.05, 0.05, 0.965), (-0.26, 0.115, 0.085, 0.985), (-0.19, 0.152, 0.105, 0.995), (-0.10, 0.168, 0.113, 0.995), (0.0, 0.155, 0.105, 0.975), (0.08, 0.125, 0.085, 0.95), (0.135, 0.08, 0.055, 0.93)]
    rings = [dict(c=(0, y, zc), rx=rx, ry=rz, axis="y", power=2.5) for y, rx, rz, zc in tk]
    b.add(bo.loft("tank", rings, segments=20), bp, den=1.7)
    b.add(lathe("cap", [(0.0, 0.0), (0.0, 0.034), (0.012, 0.034), (0.014, 0.0)], 12, (0, -0.1, 1.105), axis="z"), alu, den=0.35)

    def shroud(s):
        x = s * 0.165
        # shrouds are curved shells that wrap the tank's flanks rather than flat cut-outs
        def shroud_pt(u, v):
            y_b, z_b = -0.31 + 0.25 * u, 0.79 - 0.09 * math.sin(u * 2.2)
            y_t, z_t = -0.31 + 0.28 * u, 0.82 + 0.12 * math.sin(min(1.0, u * 1.6) * 1.57)
            y, z = y_b + (y_t - y_b) * v, z_b + (z_t - z_b) * v
            bow = 0.016 * math.sin(math.pi * v) + 0.03 * (1 - (2 * u - 1) ** 2)
            return V3(s * (0.138 + bow), y, z)

        srows = [[shroud_pt(i / 6, j / 3) for j in range(4)] for i in range(7)]
        b.add(orient_out(grid("shroud", srows), (0, -0.2, 0.85)), bp, den=1.4)
        # under-seat side cover, same treatment
        def cover_pt(u, v):
            y = 0.2 + 0.23 * u
            z_b, z_t = 0.70 - 0.02 * u + 0.1 * max(0.0, u - 0.6), 0.82 + 0.06 * u
            z = z_b + (z_t - z_b) * v
            return V3(s * (0.1 + 0.018 * math.sin(math.pi * v)), y, z)

        crows = [[cover_pt(i / 3, j / 2) for j in range(3)] for i in range(4)]
        b.add(orient_out(grid("sidecover", crows), (0, 0.3, 0.78)), bp, den=1.1)

    b.both(shroud)
    rider = [(0.09, 0.06, 0.035, 0.905), (0.14, 0.115, 0.045, 0.91), (0.26, 0.145, 0.05, 0.92), (0.40, 0.145, 0.05, 0.925), (0.48, 0.14, 0.06, 0.93)]
    b.add(bo.loft("seat1", [dict(c=(0, y, z), rx=rx, ry=rz, axis="y", power=2.8) for y, rx, rz, z in rider], segments=16), seatm, den=1.2)
    pil = [(0.47, 0.12, 0.04, 0.965), (0.56, 0.125, 0.05, 0.975), (0.70, 0.105, 0.045, 0.99), (0.80, 0.07, 0.03, 1.0)]
    b.add(bo.loft("seat2", [dict(c=(0, y, z), rx=rx, ry=rz, axis="y", power=2.8) for y, rx, rz, z in pil], segments=14), seatm, den=1.0)
    tail = [(0.42, 0.115, 0.05, 0.88), (0.60, 0.11, 0.055, 0.915), (0.78, 0.085, 0.05, 0.945), (0.90, 0.055, 0.035, 0.965), (0.96, 0.03, 0.02, 0.975)]
    b.add(bo.loft("tailcowl", [dict(c=(0, y, z), rx=rx, ry=rz, axis="y", power=2.6) for y, rx, rz, z in tail], segments=14), bp, den=1.2)
    b.add(bo.loft("taillamp", [dict(c=(0, 0.945, 0.97), rx=0.045, ry=0.024, axis="y", power=2.6), dict(c=(0, 0.975, 0.972), rx=0.038, ry=0.018, axis="y", power=2.4), dict(c=(0, 0.985, 0.972), rx=0.02, ry=0.009, axis="y", power=2)], segments=10), b.mat("lens_red", lambda: lens_red()), den=0.6)
    b.empty("light_RL", (0.03, 0.99, 0.97))
    b.empty("light_RR", (-0.03, 0.99, 0.97))
    b.both(lambda s: b.tube(curve([(s * 0.1, 0.62, 0.93), (s * 0.13, 0.78, 0.96), (s * 0.08, 0.9, 0.975), (0.0, 0.92, 0.975)], 3), 0.0095, alu, seg=5, den=0.3))
    # hugger, plate hanger, rear indicators
    b.add(fender("hug", (0, ry, R), R + 0.035, 0.13, 70, 156, n=8, drop=0.022), blk, den=0.6)
    hanger = [(0, 0.86, 0.94), (0, 0.97, 0.82), (0, 1.0, 0.72)]
    b.add(sweep("hanger", hanger, [(-0.075, -0.003), (0.075, -0.003), (0.075, 0.003), (-0.075, 0.003)], up=(0, 1, 0)), blk, den=0.4)
    b.empty("plate_R", (0, 1.012, 0.74))
    b.add(rbox("platebkt", (0.33, 0.006, 0.17), (0, 1.002, 0.74), r=0.002, seg=1), blk, den=0.25)
    for s in (1, -1):
        b.tube([(s * 0.05, 0.93, 0.88), (s * 0.15, 0.93, 0.87)], 0.0055, blk, seg=4, den=0.1)
        b.add(bo.loft("rind", [dict(c=(s * 0.15, 0.93 + i * 0.035, 0.87), rx=0.02 - i * 0.003, ry=0.015 - i * 0.002, axis="y", power=2) for i in range(3)], segments=8), b.mat("lens_amber", lambda: lens_amber()), den=0.3)
    b.empty("seat_driver", (0, 0.27, 0.99))
    b.empty("seat_p1", (0, 0.62, 1.05))
    b.empty("exit_L", (0.72, 0.27, 0))
    b.empty("exit_R", (-0.72, 0.27, 0))

    def wf(bb, c):
        wheel_moto(bb, c, R, 0.09, 0.218, rotor=True, sprocket=False, den=1.3)

    def wr(bb, c):
        wheel_moto(bb, c, R, 0.115, 0.218, rotor=False, sprocket=True, den=1.3)

    b.add_wheels([("wheel_F", (0, fy, R), False)], wf)
    b.add_wheels([("wheel_R", (0, ry, R), False)], wr)
    b.variant("red", {"paint": "#c0141c"})
    b.variant("black", {"paint": "#1b1c1f"})
    b.variant("blue", {"paint": "#124aa8"})
    b.variant("rideshare", {"paint": "#1b8f54"})
    b.empty("seat_p1", (0, 0.36, 0.86))


# ---------------------------------------------------------------------------
# Bicycle: Bangladeshi roadster
# ---------------------------------------------------------------------------


@vehicle
def build_bicycle(b):
    R = 0.34
    fy, ry = -0.56, 0.56
    rake = 22.0
    tan_r = math.tan(math.radians(rake))
    b.spec = dict(wheelbase=round(ry - fy, 3), wheelRadius=R, seatPose="ride_bicycle")
    b.preview = dict(target=(0, 0.0, 0.52), distance=3.9, height=0.65)
    b.tex = 1024
    b.ao_distance = 0.3

    def A(z):
        return Vector((0, fy + 0.055 + (z - R) * tan_r, z))

    frame = paint("frame", "#141519", rough=0.28, dust=0.22, chips=0.25, scratch=0.25, edge=0.9, slot="frame", chip_col="#6f6a60", grime=0.08)
    ch = b.mat("chrome", lambda: chrome())
    st = b.mat("steel", lambda: steel())
    rub = b.mat("rubber", lambda: rubber())
    gold = paint("pin", "#d7ae3a", rough=0.34, metal=0.5, dust=0.15, chips=0.1, scratch=0.05, edge=0.2, slot="pin")
    leather = vinyl("leather", "#2d1c12", rough=0.48, dust=0.12)

    # ---- steering
    b.set_steer(A(0.76), rake)
    crown = A(0.665)
    b.tube([crown, A(0.86)], 0.0125, ch, "steer", seg=8)
    b.tube([crown + V3(-0.042, 0, 0), crown + V3(0.042, 0, 0)], 0.016, frame, "steer", seg=8)

    def fork(s):
        pts = curve([crown + V3(s * 0.04, 0, 0), (s * 0.044, fy + 0.06, 0.52), (s * 0.05, fy + 0.018, 0.41), (s * 0.052, fy, R)], 3)
        n = len(pts)
        b.tube(pts, 0.011, frame, "steer", seg=7, rs=[0.0135 - 0.0055 * i / (n - 1) for i in range(n)])
        b.add(rbox("drop", (0.005, 0.026, 0.026), (s * 0.052, fy, R), r=0.002, seg=1), st, "steer", den=0.3)

    b.both(fork)
    b.tube([(-0.066, fy, R), (0.066, fy, R)], 0.0055, st, "steer", seg=5, den=0)
    b.add(fender("fg", (0, fy, R), R + 0.022, 0.056, -8, 176, n=18), frame, "steer", den=1.0)
    b.add(fender("fg2", (0, fy, R), R + 0.0235, 0.008, 60, 176, n=9), gold, "steer", den=0.3)
    b.both(lambda s: b.tube([(s * 0.052, fy, R), (s * 0.031, fy + 0.31, R + 0.205)], 0.0028, st, "steer", seg=3, den=0, caps=False))
    b.both(lambda s: b.tube([(s * 0.052, fy, R), (s * 0.031, fy - 0.24, R + 0.26)], 0.0028, st, "steer", seg=3, den=0, caps=False))
    stem_top = A(0.86) + V3(0, 0, 0.09)
    clamp = stem_top + V3(0, -0.07, 0.03)
    b.tube([A(0.84), stem_top, clamp], 0.0115, ch, "steer", seg=8)
    bar = curve([(0.29, clamp.y + 0.22, clamp.z + 0.06), (0.22, clamp.y + 0.195, clamp.z + 0.06), (0.1, clamp.y + 0.07, clamp.z + 0.025), (0.03, clamp.y + 0.005, clamp.z), (-0.03, clamp.y + 0.005, clamp.z), (-0.1, clamp.y + 0.07, clamp.z + 0.025), (-0.22, clamp.y + 0.195, clamp.z + 0.06), (-0.29, clamp.y + 0.22, clamp.z + 0.06)], 4)
    b.tube(bar, 0.0105, ch, "steer", seg=7)

    def grip(s):
        g0, g1 = V3(s * 0.185, clamp.y + 0.16, clamp.z + 0.052), V3(s * 0.295, clamp.y + 0.225, clamp.z + 0.062)
        b.tube([g0, g1], 0.0155, rub, "steer", seg=7)
        b.empty("grip_L" if s > 0 else "grip_R", (g0 + g1) / 2, parent="steer")
        # rod-brake lever and rod, the roadster giveaway
        b.tube([g0 + V3(-s * 0.015, -0.015, -0.006), g0 + V3(s * 0.05, -0.075, -0.012), g0 + V3(s * 0.12, -0.065, -0.012)], 0.0048, ch, "steer", seg=5, den=0.2)
        b.tube([clamp + V3(s * 0.04, 0.008, -0.01), V3(s * 0.04, A(0.72).y - 0.016, 0.72)], 0.0032, ch, "steer", seg=4, den=0, caps=False)

    b.both(grip)
    # brake shoe
    b.add(rbox("caliper", (0.075, 0.018, 0.018), (0, fy + 0.03, R + 0.31), r=0.004, seg=1), ch, "steer", den=0.2)
    # bell
    bp = V3(0.135, clamp.y + 0.1, clamp.z + 0.05)
    b.tube([bp + V3(0, 0, -0.02), bp], 0.0035, st, "steer", seg=4, den=0.3)
    b.add(lathe("bell", [(0.0, 0.03), (0.004, 0.03), (0.016, 0.025), (0.028, 0.013), (0.034, 0.0)], 14, bp, axis="z"), ch, "steer")
    b.add(rbox("thumb", (0.03, 0.008, 0.005), bp + V3(0.03, -0.02, 0), r=0.0018, seg=1), st, "steer", den=0.3)
    # lamp bracket and head lamp
    lp = crown + V3(0, -0.085, 0.045)
    b.tube([crown + V3(0, -0.01, 0.01), lp], 0.005, st, "steer", seg=5, den=0.3)
    b.add(lathe("lamp", [(0.05, 0.0), (0.035, 0.028), (0.0, 0.04), (-0.018, 0.043), (-0.028, 0.042)], 14, lp, axis="y"), ch, "steer")
    b.add(lathe("lens", [(-0.029, 0.04), (-0.034, 0.026), (-0.036, 0.0)], 14, lp, axis="y"), bo.pbr("lamp_lens", C("#fff3c4"), 0.08), "steer")
    b.empty("light_FL", lp + V3(0.015, -0.04, 0), parent="steer")
    b.empty("light_FR", lp + V3(-0.015, -0.04, 0), parent="steer")
    b.empty("plate_F", lp + V3(0, -0.05, -0.08), parent="steer")

    # ---- diamond frame, tall roadster proportions
    BB = V3(0, 0.03, 0.305)
    seat_cl = V3(0, 0.155, 0.70)
    head_top, head_bot = A(0.825), A(0.68)
    b.tube([head_bot, head_top], 0.0185, frame, seg=9)
    for p in (head_top, head_bot):
        b.add(lathe("cup", [(-0.006, 0.022), (0.006, 0.022)], 10, p, axis="z"), ch, den=0.2)
    b.tube([A(0.8), seat_cl], 0.0145, frame)
    b.tube([A(0.72), BB], 0.0155, frame)
    b.tube([BB, seat_cl + V3(0, 0.006, 0.02)], 0.0145, frame)
    b.tube([seat_cl, seat_cl + V3(0, 0.022, 0.07)], 0.0105, ch, seg=7)
    for t in (0.08, 0.15):
        p = head_top.lerp(seat_cl, t)
        b.add(lathe("band", [(-0.006, 0.0165), (0.006, 0.0165)], 8, p, axis="y"), gold, den=0.15)
    b.add(lathe("bb", [(-0.036, 0.0), (-0.036, 0.021), (-0.03, 0.024), (0.03, 0.024), (0.036, 0.021), (0.036, 0.0)], 12, BB), frame, den=0.5)

    def stays(s):
        b.tube(curve([BB + V3(s * 0.025, 0.02, 0), (s * 0.05, 0.3, 0.325), (s * 0.058, ry, R)], 2), 0.0085, frame, seg=6, den=0.7)
        b.tube(curve([seat_cl + V3(s * 0.016, 0.01, -0.01), (s * 0.05, 0.36, 0.52), (s * 0.058, ry, R)], 2), 0.008, frame, seg=6, den=0.7)
        b.add(rbox("drop", (0.005, 0.03, 0.028), (s * 0.058, ry, R), r=0.002, seg=1), st, den=0.25)

    b.both(stays)
    b.tube([(-0.072, ry, R), (0.072, ry, R)], 0.0055, st, seg=5, den=0)

    # ---- rear guard, carrier
    b.add(fender("rg", (0, ry, R), R + 0.022, 0.056, 2, 170, n=18), frame, den=1.0)
    b.add(fender("rg2", (0, ry, R), R + 0.0235, 0.008, 2, 170, n=12), gold, den=0.3)
    refl = lens_red("reflector_red")
    b.add(lathe("refl", [(-0.004, 0.0), (-0.004, 0.026), (0.003, 0.026), (0.006, 0.0)], 12, (0, ry + R + 0.02, R + 0.1), axis="y"), refl, den=0.4)
    b.empty("light_RL", (0.015, ry + R + 0.03, R + 0.1))
    b.empty("light_RR", (-0.015, ry + R + 0.03, R + 0.1))
    b.empty("plate_R", (0, ry + R + 0.04, R + 0.26))
    cz = 0.745
    carrier = paint("carrier", "#232427", rough=0.4, metal=0.3, dust=0.3, chips=0.3, scratch=0.3, edge=0.5, chip_col="#8a8a8a", slot="frame2")
    outline = [(-0.07, 0.26, cz), (0.07, 0.26, cz), (0.075, 0.88, cz), (-0.075, 0.88, cz)]
    b.tube(outline, 0.0065, carrier, seg=5, closed=True, den=0.4)
    for y in (0.36, 0.46, 0.56, 0.66, 0.76):
        b.tube([(-0.072, y, cz + 0.002), (0.072, y, cz + 0.002)], 0.0045, carrier, seg=4, den=0)
    b.tube([(0, 0.3, cz), (0, 0.84, cz)], 0.0055, carrier, seg=4, den=0.2)
    for s in (1, -1):
        b.tube([(s * 0.058, ry, R), (s * 0.07, 0.42, cz)], 0.005, carrier, seg=4, den=0.15)
        b.tube([(s * 0.058, ry, R), (s * 0.072, 0.76, cz)], 0.005, carrier, seg=4, den=0.15)
    b.tube([seat_cl + V3(0, 0.01, -0.01), (0, 0.27, cz - 0.003)], 0.004, carrier, seg=4, den=0.15)
    b.add(rbox("caliper", (0.075, 0.018, 0.018), (0, ry - 0.03, R + 0.31), r=0.004, seg=1), ch, den=0.2)
    b.tube([(-0.04, 0.18, 0.72), (0, 0.42, 0.68)], 0.003, ch, seg=4, den=0, caps=False)

    # ---- drive on the right (-X): cranks in their own node, chain and the big guard
    chain_x = -0.052
    b.crank = BB
    b.add(gear("ring", 0.092, 30, 0.004, BB + V3(chain_x, 0, 0)), b.mat("blackteeth", lambda: paint("blackteeth", "#232325", rough=0.45, metal=0.5, dust=0.3, chips=0.2, scratch=0.1, edge=0.5)), "crank", den=0.5)
    b.add(lathe("spider", [(chain_x - 0.005, 0.0), (chain_x - 0.005, 0.045), (chain_x + 0.005, 0.045), (chain_x + 0.005, 0.0)], 12, BB), ch, "crank", den=0.3)

    def crank(s):
        ang = math.radians(25 if s > 0 else 205)
        tip = BB + V3(s * 0.085, math.cos(ang) * 0.165, math.sin(ang) * 0.165)
        b.tube([BB + V3(s * 0.04, 0, 0), tip], 0.0095, ch, "crank", seg=6, rs=[0.0125, 0.0085])
        ped = tip + V3(s * 0.055, 0, 0)
        b.tube([tip, ped + V3(s * 0.04, 0, 0)], 0.0055, st, "crank", seg=5, den=0.2)
        b.add(rbox("ped", (0.09, 0.05, 0.016), ped, r=0.004, seg=1), rub, "crank", den=0.5)

    b.both(crank)
    rear_sp = V3(chain_x, ry, R)
    b.add(gear("sprk", 0.042, 16, 0.004, rear_sp), carrier, den=0.25)
    chain_m = bo.pbr("chain", C("#3a3a3c"), 0.5, 0.8)
    gg = G(chain_m)
    gg.bump(gg.math("SINE", gg.mul(gg.uvw[1], 480.0)), 0.8, 0.003)
    for z0, z1 in ((BB.z + 0.094, R + 0.044), (BB.z - 0.094, R - 0.044)):
        b.add(sweep("chain", [(chain_x, BB.y, z0), (chain_x, ry, z1)], [(-0.004, -0.004), (0.004, -0.004), (0.004, 0.004), (-0.004, 0.004)], up=(0, 0, 1)), chain_m, den=0.25)
    cg = []
    for a in np.linspace(90, 270, 8):
        t = math.radians(a)
        cg.append((BB.y + math.cos(t) * 0.118, BB.z + math.sin(t) * 0.118))
    cg_rear = []
    for a in np.linspace(-90, 90, 6):
        t = math.radians(a)
        cg_rear.append((ry + math.cos(t) * 0.062, R + math.sin(t) * 0.062))
    guard = cg + cg_rear
    gm = paint("chainguardp", "#141519", rough=0.26, dust=0.16, chips=0.12, scratch=0.2, edge=0.3, slot="frame", chip_col="#8a8a8a")
    b.add(plate("guardside", guard, 0.003, origin=(chain_x - 0.022, 0, 0), u=(0, 1, 0), v=(0, 0, 1), bevel=0.001), gm, den=0.9)
    # raised gold pinstripe on the guard
    pl = [(chain_x - 0.0245, p[0], p[1]) for p in guard]
    inner = [(chain_x - 0.0245, BB.y + (p[1] - BB.y) * 0.84, BB.z + (p[2] - BB.z) * 0.84) for p in pl[:8]] + [(chain_x - 0.0245, ry + (p[1] - ry) * 0.72, R + (p[2] - R) * 0.72) for p in pl[8:]]
    b.tube(inner, 0.0014, gold, seg=3, closed=True, den=0)
    # kick stand
    b.tube([BB + V3(0.05, 0.03, -0.02), (0.13, 0.08, 0.02)], 0.0065, st, seg=5, den=0.2)
    # frame pump on the seat tube, tool roll behind the saddle, dynamo on the fork, mud flap
    b.tube([BB + V3(0.024, 0.01, 0.05), seat_cl + V3(0.024, -0.02, -0.07)], 0.0115, b.mat("pump", lambda: paint("pump", "#a9abad", rough=0.42, metal=0.6, dust=0.3, chips=0.2, scratch=0.25, edge=0.2)), seg=7, den=0.35)
    for t in (0.0, 1.0):
        b.add(rbox("pumpclip", (0.03, 0.03, 0.012), (BB + V3(0.024, 0.01, 0.05)).lerp(seat_cl + V3(0.024, -0.02, -0.07), t), r=0.004, seg=1), rub, den=0.15)
    rolls = lathe("toolroll", [(-0.075, 0.0), (-0.075, 0.03), (-0.06, 0.038), (0.06, 0.038), (0.075, 0.03), (0.075, 0.0)], 10, (0, seat_cl.y + 0.17, 0.745))
    b.add(rolls, leather, den=0.5)
    for x in (-0.04, 0.04):
        b.tube(arc((x, seat_cl.y + 0.17, 0.745), 0.041, 0, 360, 10)[:-1], 0.0035, rub, seg=3, closed=True, den=0)
    dy = V3(0.075, fy + 0.03, R + 0.15)
    b.add(lathe("dynamo", [(0.0, 0.0), (0.0, 0.016), (0.02, 0.022), (0.075, 0.019), (0.09, 0.011), (0.1, 0.0)], 10, dy, axis="z"), ch, "steer", den=0.4)
    b.tube([dy + V3(0, 0, 0.09), crown + V3(0.01, -0.05, 0.03)], 0.0018, rub, "steer", seg=3, den=0, caps=False)
    b.add(rbox("mudflap", (0.06, 0.004, 0.09), (0, fy - 0.12, R - 0.36 + 0.09), rot=(math.radians(16), 0, 0), r=0.001, seg=1), rub, "steer", den=0.25)

    # ---- sprung saddle
    sad_z = 0.815
    sad_y = seat_cl.y + 0.025
    b.add(saddle_mesh("saddle", sad_y - 0.16, sad_y + 0.12, sad_z, wide=0.12), leather, den=1.2)
    for s in (1, -1):
        b.add(spring_coil("coil", (s * 0.058, sad_y + 0.07, sad_z - 0.085), 0.07, 0.016, turns=4, wire=0.0032), ch, den=0)
        b.tube([(s * 0.058, sad_y + 0.07, sad_z - 0.088), (s * 0.018, sad_y + 0.01, sad_z - 0.09), (s * 0.008, sad_y + 0.01, sad_z - 0.09)], 0.004, ch, seg=4, den=0.2)
    b.tube([(0.024, sad_y - 0.14, sad_z - 0.02), (0.012, sad_y, sad_z - 0.085), (-0.012, sad_y, sad_z - 0.085), (-0.024, sad_y - 0.14, sad_z - 0.02)], 0.0035, ch, seg=4, den=0.2)
    b.empty("seat_driver", (0, sad_y + 0.02, sad_z + 0.05))
    b.empty("seat_p1", (0, 0.58, cz + 0.06))
    b.empty("exit_L", (0.55, sad_y, 0))
    b.empty("exit_R", (-0.55, sad_y, 0))

    def wh(bb, c):
        wheel_spoked(bb, c, R, 0.04, spokes=36, seg=36, lugs=30, tyre_kind="bike", hub_r=0.022, flange=0.028, hub_w=0.042, den=1.2)

    b.add_wheels([("wheel_F", (0, fy, R), False), ("wheel_R", (0, ry, R), False)], wh)
    b.variant("default")
    b.variant("green", {"frame": "#0d3f2b", "frame2": "#0d3f2b", "pin": "#d7ae3a"})




# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_one(vid, opts):
    global CUR
    bo.reset_scene()
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    b = Build(vid, opts)
    CUR = b
    t0 = time.time()
    VEHICLES[vid](b)
    b.finish()
    print(f"[veh] {vid} done in {time.time() - t0:.1f}s")


def main():
    args = bo.script_args()
    opts = {}
    ids = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--nobake":
            opts["nobake"] = True
        elif a == "--preview":
            opts["preview"] = True
        elif a == "--novariants":
            opts["novariants"] = True
        elif a == "--dummy":
            opts["dummy"] = True
        elif a == "--atlas":
            opts["atlas"] = True
        elif a == "--pvariants":
            opts["pvariants"] = True
        elif a == "--tex":
            i += 1
            opts["tex"] = int(args[i])
        elif a == "--views":
            i += 1
            opts["views"] = tuple(int(v) for v in args[i].split(","))
        elif a == "--tag":
            i += 1
            opts["tag"] = args[i]
        elif a == "--res":
            i += 1
            opts["size"] = (int(args[i]), int(args[i]))
        elif a == "--dist":
            i += 1
            opts["dist"] = float(args[i])
        elif a == "--pheight":
            i += 1
            opts["pheight"] = float(args[i])
        elif a == "--samples":
            i += 1
            opts["samples"] = int(args[i])
        else:
            ids.append(a)
        i += 1
    for vid in ids:
        if vid not in VEHICLES:
            raise SystemExit(f"unknown vehicle id {vid}; known: {', '.join(VEHICLES)}")
    for vid in ids or list(VEHICLES):
        for attempt in range(6):
            try:
                build_one(vid, opts)
                break
            except RuntimeError as exc:
                # The GPU is shared: wait for the other bakes on out-of-memory errors.
                print(f"[veh] {vid} attempt {attempt + 1} failed: {exc}")
                if attempt == 5:
                    raise
                time.sleep(45)


if __name__ == "__main__":
    main()
