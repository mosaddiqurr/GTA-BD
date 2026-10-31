"""Bangladesh Open World: faceless fruit-people characters.

Usage (from the project root):
  blender --background --factory-startup --python tools/blender/build_characters.py -- [ids...] [flags]

  no ids       build every character in ROSTER
  --hi         skip bake and export, render the high-poly sculpt only (fast look-dev)
  --size N     texture size override
  --views a,b  preview yaw angles, default 0,-35,180
  --noexport   do not write the GLB
  --nopreview  skip the preview renders
  --pose       also render a test pose and print the stretch report
  --tag s      suffix for preview file names

Pipeline for each character: sculpt high-poly parts in world rest space with
numpy-driven fold fields, decimate each part to its budget, skin with capsule
distance weights, unwrap, bake high to low into one PBR set, export a skinned GLB.
"""

import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bo_common as bo  # noqa: E402

OUT_DIR = os.path.join(bo.PUBLIC_ASSETS, "characters")
SCRATCH = (
    r"C:\Users\User\AppData\Local\Temp\claude\E--1--Semester-Break-2604-GTA-BD"
    r"\d4e1c090-e9ae-4ccd-aa94-327eb0059626\scratchpad\characters"
)
BONES = [
    "root", "hips", "spine", "chest", "head",
    "upperarm.L", "forearm.L", "hand.L", "upperarm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R",
]
PI = math.pi
ARM_DROP = math.radians(35.0)
DUMP_TEXTURES = False


# ---------------------------------------------------------------------------
# Small numeric helpers
# ---------------------------------------------------------------------------


def lin(hexstr):
    """sRGB hex to linear RGB."""
    h = hexstr.lstrip("#")
    c = np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).tolist())


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mixc(a, b, t):
    t = np.asarray(t)[..., None]
    return np.asarray(a) * (1.0 - t) + np.asarray(b) * t


_NOISE_TABLE = np.random.RandomState(7).rand(64, 64, 64).astype(np.float32)


def vnoise(P, scale=1.0, seed=0):
    """Tiling value noise, vectorised, result in 0..1."""
    Q = np.asarray(P) * scale + seed * 17.13
    I = np.floor(Q).astype(np.int64)
    F = Q - I
    F = F * F * (3.0 - 2.0 * F)
    i0, i1 = I & 63, (I + 1) & 63
    T = _NOISE_TABLE
    c000 = T[i0[:, 0], i0[:, 1], i0[:, 2]]
    c100 = T[i1[:, 0], i0[:, 1], i0[:, 2]]
    c010 = T[i0[:, 0], i1[:, 1], i0[:, 2]]
    c110 = T[i1[:, 0], i1[:, 1], i0[:, 2]]
    c001 = T[i0[:, 0], i0[:, 1], i1[:, 2]]
    c101 = T[i1[:, 0], i0[:, 1], i1[:, 2]]
    c011 = T[i0[:, 0], i1[:, 1], i1[:, 2]]
    c111 = T[i1[:, 0], i1[:, 1], i1[:, 2]]
    x, y, z = F[:, 0], F[:, 1], F[:, 2]
    a = c000 * (1 - x) + c100 * x
    b = c010 * (1 - x) + c110 * x
    c = c001 * (1 - x) + c101 * x
    d = c011 * (1 - x) + c111 * x
    return (a * (1 - y) + b * y) * (1 - z) + (c * (1 - y) + d * y) * z


def fbm(P, scale=1.0, octaves=4, seed=0, gain=0.5):
    out = np.zeros(len(P))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += vnoise(P, scale * (2.03**o), seed + o) * amp
        total += amp
        amp *= gain
    return out / total


def spline(pts, n=8):
    """Catmull-Rom through control rows (any number of columns)."""
    p = np.asarray(pts, dtype=np.float64)
    if p.ndim == 1:
        p = p[:, None]
    q = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(q) - 2):
        p0, p1, p2, p3 = q[i - 1], q[i], q[i + 1], q[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3))
    out.append(p[-1])
    return np.array(out)


def path_frames(path, ref=(0, -1, 0)):
    """Tangent T, U (ref projected off T), V = T x U for each path point."""
    p = np.asarray(path)
    T = np.gradient(p, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    ref = np.asarray(ref, dtype=np.float64)
    U = ref - T * (T @ ref)[:, None]
    bad = np.linalg.norm(U, axis=1) < 1e-3
    if bad.any():
        U[bad] = np.array([1.0, 0, 0]) - T[bad] * T[bad][:, [0]]
    U /= np.linalg.norm(U, axis=1, keepdims=True)
    V = np.cross(T, U)
    return T, U, V


# ---------------------------------------------------------------------------
# Mesh construction
# ---------------------------------------------------------------------------


def coords(obj):
    a = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_coords(obj, P):
    obj.data.vertices.foreach_set("co", np.asarray(P).ravel())
    obj.data.update()


def vnormals(obj):
    a = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertex_normals.foreach_get("vector", a)
    return a.reshape(-1, 3)


def orient_outward(obj, center):
    """Flip an open shell so its normals point away from `center`."""
    P, N = coords(obj), vnormals(obj)
    if ((P - np.asarray(center)) * N).sum() < 0:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    return obj


def tri_count(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def grid_obj(name, P, close_u=False, cap_start=False, cap_end=False, smooth=True):
    """Quad grid from a (rows, cols, 3) array of points."""
    P = np.asarray(P)
    nv, nu = P.shape[:2]
    idx = np.arange(nv * nu).reshape(nv, nu)
    if close_u:
        a, b = idx[:-1, :], np.roll(idx, -1, axis=1)[:-1, :]
        c, d = np.roll(idx, -1, axis=1)[1:, :], idx[1:, :]
    else:
        a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]
    faces = np.stack([a, b, c, d], -1).reshape(-1, 4).tolist()
    if cap_start:
        faces.append(idx[0].tolist()[::-1])
    if cap_end:
        faces.append(idx[-1].tolist())
    obj = bo.new_mesh_object(name, P.reshape(-1, 3).tolist(), faces, smooth=smooth)
    bo.recalc_normals(obj)
    return obj


def tube(name, ctrl, radii, segs=24, n=6, ref=(0, -1, 0), power=2.0, cap=True):
    """Lofted tube through control points. radii is r or (ru, rv) per control point."""
    r = np.asarray(radii, dtype=np.float64)
    if r.ndim == 1:
        r = np.stack([r, r], 1)
    both = spline(np.hstack([np.asarray(ctrl, dtype=np.float64), r]), n)
    path, rad = both[:, :3], np.maximum(both[:, 3:], 1e-4)
    T, U, V = path_frames(path, ref)
    th = 2 * PI * np.arange(segs) / segs
    e = 2.0 / power
    c = np.sign(np.cos(th)) * np.abs(np.cos(th)) ** e
    s = np.sign(np.sin(th)) * np.abs(np.sin(th)) ** e
    P = path[:, None, :] + U[:, None, :] * (rad[:, 0, None] * c)[..., None] + V[:, None, :] * (rad[:, 1, None] * s)[..., None]
    return grid_obj(name, P, close_u=True, cap_start=cap, cap_end=cap)


def capsule(name, a, b, r, r2=None, segs=16, rings=5):
    """Rounded capsule from a to b, optionally tapered."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    r2 = r if r2 is None else r2
    d = b - a
    L = np.linalg.norm(d)
    d = d / L
    pts, rad = [], []
    for i in range(rings + 1):
        t = i / rings
        ang = t * PI / 2
        pts.append(a - d * r * math.cos(ang))
        rad.append(max(r * math.sin(ang), 1e-4))
    for i in range(rings + 1):
        t = i / rings
        ang = t * PI / 2
        pts.append(b + d * r2 * math.sin(ang))
        rad.append(max(r2 * math.cos(ang), 1e-4))
    ref = (1, 0, 0) if abs(d[0]) < 0.9 else (0, 1, 0)
    return grid_rings(name, np.array(pts), np.array(rad), segs, ref)


def grid_rings(name, path, rad, segs, ref):
    T, U, V = path_frames(path, ref)
    th = 2 * PI * np.arange(segs) / segs
    P = path[:, None, :] + (U[:, None, :] * np.cos(th)[None, :, None] + V[:, None, :] * np.sin(th)[None, :, None]) * rad[:, None, None]
    return grid_obj(name, P, close_u=True, cap_start=True, cap_end=True)


def rounded_box(name, size, r, loc=(0, 0, 0), matrix=None, res=0.012):
    """Grid box with truly rounded corners."""
    hs = np.asarray(size, float) / 2
    r = min(r, float(hs.min()) * 0.98)
    counts = [max(3, int(s * 2 / res)) for s in hs]
    verts, faces = [], []

    def add_face(axis, sign):
        a1, a2 = [i for i in (0, 1, 2) if i != axis]
        n1, n2 = counts[a1], counts[a2]
        u = np.linspace(-hs[a1], hs[a1], n1 + 1)
        v = np.linspace(-hs[a2], hs[a2], n2 + 1)
        U, W = np.meshgrid(u, v)
        P = np.zeros(U.shape + (3,))
        P[..., a1], P[..., a2] = U, W
        P[..., axis] = sign * hs[axis]
        base = len(verts)
        verts.extend(P.reshape(-1, 3).tolist())
        for j in range(n2):
            for i in range(n1):
                q = (base + j * (n1 + 1) + i, base + j * (n1 + 1) + i + 1, base + (j + 1) * (n1 + 1) + i + 1, base + (j + 1) * (n1 + 1) + i)
                faces.append(q)

    for ax in (0, 1, 2):
        for sg in (-1, 1):
            add_face(ax, sg)
    obj = bo.new_mesh_object(name, verts, faces)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    P = coords(obj)
    core = hs - r
    C = np.clip(P, -core, core)
    D = P - C
    D /= np.maximum(np.linalg.norm(D, axis=1, keepdims=True), 1e-9)
    Q = C + D * r + np.asarray(loc, float)
    if matrix is not None:
        Q = transformed(Q, matrix)
    set_coords(obj, Q)
    obj.data.shade_smooth()
    return obj


def mirror_copy(obj, name=None):
    """World X mirror of an object (transforms applied), normals fixed."""
    bo.apply_modifiers(obj)
    bo.apply_transforms(obj)
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name or (obj.name + "_R")
    bpy.context.scene.collection.objects.link(new)
    P = coords(new)
    P[:, 0] *= -1
    set_coords(new, P)
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(new.data)
    bm.free()
    new.data.update()
    return new


def voxel(obj, size=0.004, smooth=4, factor=0.6):
    mod = obj.modifiers.new("r", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = size
    mod.adaptivity = 0.0
    mod.use_smooth_shade = True
    if smooth:
        sm = obj.modifiers.new("s", "SMOOTH")
        sm.factor = factor
        sm.iterations = smooth
    bo.apply_modifiers(obj)
    obj.data.shade_smooth()
    return obj


def union(name, objs, size=0.004, smooth=4, factor=0.6):
    return voxel(bo.join(objs, name), size, smooth, factor)


def refine(obj, levels=1):
    bo.subsurf(obj, levels)
    bo.apply_modifiers(obj)
    obj.data.shade_smooth()
    return obj


def transformed(P, matrix):
    M = np.array(matrix)
    return (np.c_[P, np.ones(len(P))] @ M.T)[:, :3]


# ---------------------------------------------------------------------------
# Fold and stamp fields: the sculpting layer. Everything is a scalar displacement
# along the vertex normal, accumulated then applied once.
# ---------------------------------------------------------------------------


def crease_field(P, pts, w, d, lobes=0.55, taper=True):
    """Pillowy fabric crease along a polyline: sharp valley with soft ridges beside it."""
    pts = np.asarray(pts, float)
    margin = w * 4.5
    lo, hi = pts.min(0) - margin, pts.max(0) + margin
    idx = np.where(np.all((P >= lo) & (P <= hi), axis=1))[0]
    out = np.zeros(len(P))
    if len(idx) == 0:
        return out
    Q = P[idx]
    a, b = pts[:-1], pts[1:]
    ab = b - a
    L2 = np.maximum((ab * ab).sum(1), 1e-12)
    seg = np.sqrt(L2)
    cum = np.concatenate([[0], np.cumsum(seg)])
    best = np.full(len(Q), 1e9)
    s = np.zeros(len(Q))
    for i in range(len(a)):
        t = np.clip(((Q - a[i]) * ab[i]).sum(1) / L2[i], 0, 1)
        dist = np.linalg.norm(Q - (a[i] + ab[i] * t[:, None]), axis=1)
        m = dist < best
        best[m] = dist[m]
        s[m] = (cum[i] + t[m] * seg[i]) / cum[-1]
    A = np.sin(PI * np.clip(s, 0, 1)) ** 0.6 if taper else 1.0
    x = best / w
    out[idx] = d * A * (lobes * np.exp(-((x / 2.3) ** 2)) - np.exp(-1.2 * x * x))
    return out


def snap_pts(P, pts, step=7):
    """Move polyline points onto the nearest surface vertex so a crease always bites."""
    S = P[::step]
    out = []
    for q in np.asarray(pts, float):
        out.append(S[((S - q) ** 2).sum(1).argmin()])
    return np.array(out)


def apply_field(obj, D):
    N = vnormals(obj)
    set_coords(obj, coords(obj) + N * np.asarray(D)[:, None])


class Limb:
    """Parametrises a tubular region: arc v along the axis, angle a around it."""

    def __init__(self, ctrl, radii, ref=(0, -1, 0), n=8):
        r = np.asarray(radii, dtype=np.float64).reshape(len(ctrl), -1)
        if r.shape[1] == 1:
            r = np.hstack([r, r])
        both = spline(np.hstack([np.asarray(ctrl, float), r]), n)
        self.path, self.rad = both[:, :3], both[:, 3:]
        self.T, self.U, self.V = path_frames(self.path, ref)
        seg = np.linalg.norm(np.diff(self.path, axis=0), axis=1)
        self.cum = np.concatenate([[0], np.cumsum(seg)])
        self.length = self.cum[-1]

    def locate(self, t):
        v = np.clip(t, 0, 1) * self.length
        i = np.clip(np.searchsorted(self.cum, v) - 1, 0, len(self.cum) - 2)
        f = (v - self.cum[i]) / np.maximum(self.cum[i + 1] - self.cum[i], 1e-9)
        return i, f

    def point(self, t, a_deg, off=0.0):
        i, f = self.locate(t)
        c = self.path[i] * (1 - f) + self.path[i + 1] * f
        ra = self.rad[i] * (1 - f) + self.rad[i + 1] * f
        a = math.radians(a_deg)
        U = self.U[i] * (1 - f) + self.U[i + 1] * f
        V = self.V[i] * (1 - f) + self.V[i + 1] * f
        return c + U * (ra[0] + off) * math.cos(a) + V * (ra[1] + off) * math.sin(a)

    def crease(self, t0, a0, t1, a1, w, d, n=9, lobes=0.55, off=0.0):
        pts = [self.point(t0 + (t1 - t0) * i / (n - 1), a0 + (a1 - a0) * i / (n - 1), off) for i in range(n)]
        return (np.array(pts), w, d, lobes)

    def scatter(self, rng, tc, ts, count, arc, slant, w, d, a_c=0.0, a_s=180.0, lobes=0.55):
        out = []
        for _ in range(count):
            t = tc + rng.uniform(-1, 1) * ts
            a = a_c + rng.uniform(-1, 1) * a_s
            arc_i = arc * rng.uniform(0.6, 1.25)
            dt = slant * rng.uniform(-1, 1)
            out.append(self.crease(t - dt / 2, a - arc_i / 2, t + dt / 2, a + arc_i / 2, w * rng.uniform(0.75, 1.25), d * rng.uniform(0.7, 1.2), lobes=lobes))
        return out

    def uv(self, P, step=4):
        """Returns v (metres along axis), a (radians, wrapped), radial distance."""
        keep = np.arange(0, len(self.path), step)
        if keep[-1] != len(self.path) - 1:
            keep = np.append(keep, len(self.path) - 1)
        a, ab = self.path[keep[:-1]], np.diff(self.path[keep], axis=0)
        L2 = (ab * ab).sum(1)
        best = np.full(len(P), 1e9)
        vv = np.zeros(len(P))
        rr = np.zeros((len(P), 3))
        for i in range(len(a)):
            t = np.clip(((P - a[i]) * ab[i]).sum(1) / L2[i], 0, 1)
            q = a[i] + ab[i] * t[:, None]
            dv = P - q
            dd = np.linalg.norm(dv, axis=1)
            m = dd < best
            best[m] = dd[m]
            vv[m] = (self.cum[keep[i]] + t[m] * (self.cum[keep[i + 1]] - self.cum[keep[i]]))
            rr[m] = dv[m]
        i = np.clip(np.searchsorted(self.cum, vv) - 1, 0, len(self.cum) - 1)
        ang = np.arctan2((rr * self.V[i]).sum(1), (rr * self.U[i]).sum(1))
        return vv, ang, best


class Profile:
    """Stacked superellipse: a torso or skirt described by rows (z, rx, ry, cy)."""

    def __init__(self, rows, power=2.3, n=6):
        d = spline(np.asarray(rows, float), n)
        self.z, self.rx, self.ry, self.cy = d[:, 0], d[:, 1], d[:, 2], d[:, 3]
        self.power = power
        order = np.argsort(self.z)
        self.z, self.rx, self.ry, self.cy = self.z[order], self.rx[order], self.ry[order], self.cy[order]

    def at(self, z):
        return np.interp(z, self.z, self.rx), np.interp(z, self.z, self.ry), np.interp(z, self.z, self.cy)

    def point(self, theta_deg, z, off=0.0):
        rx, ry, cy = self.at(z)
        t = np.radians(theta_deg)
        e = 2.0 / self.power
        c, s = np.cos(t), np.sin(t)
        return np.stack([np.sign(c) * np.abs(c) ** e * (rx + off), cy + np.sign(s) * np.abs(s) ** e * (ry + off), np.full_like(t, z) if np.ndim(t) else z], -1)

    def uv(self, P):
        """u metres around from the front centre (+ toward char left), v = z."""
        rx, ry, cy = self.at(P[:, 2])
        ang = np.arctan2((P[:, 1] - cy) / ry, P[:, 0] / rx)
        a = np.arctan2(np.cos(ang), -np.sin(ang))  # 0 at front, + toward +X
        return a * 0.5 * (rx + ry), P[:, 2], a


def rrect_sdf(u, v, cu, cv, hu, hv, r=0.01, rot=0.0):
    du, dv = u - cu, v - cv
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        du, dv = du * c + dv * s, -du * s + dv * c
    qu, qv = np.abs(du) - (hu - r), np.abs(dv) - (hv - r)
    return np.sqrt(np.maximum(qu, 0) ** 2 + np.maximum(qv, 0) ** 2) + np.minimum(np.maximum(qu, qv), 0) - r


def stamp(sdf, h=0.0, soft=0.006, crease=0.0, crease_w=0.0025):
    """Raised pad from a signed distance plus a sewn crease along its edge."""
    D = h * sstep(0.0, -soft, sdf)
    if crease:
        D = D - crease * np.exp(-((sdf / crease_w) ** 2))
    return D


def stitch_row(sdf, offset=0.004, pitch_coord=None, pitch=0.008, depth=0.0006, w=0.0012):
    """Row of stitches running parallel to a stamp edge."""
    line = np.exp(-(((sdf + offset) / w) ** 2))
    if pitch_coord is not None:
        line = line * (0.5 + 0.5 * np.cos(2 * PI * pitch_coord / pitch))
    return -depth * line


def ribs(a_metres, mask, pitch=0.009, depth=0.0016):
    return depth * mask * (0.5 + 0.5 * np.cos(2 * PI * a_metres / pitch))


def lumps(P, scale=7.0, amp=0.006, seed=3):
    return amp * (fbm(P, scale, 3, seed) - 0.5) * 2.0


def apply_creases(obj, creases, extra=None):
    P = coords(obj)
    D = np.zeros(len(P))
    for c in creases:
        pts, w, d, lobes = c
        D += crease_field(P, pts, w, d, lobes)
    if extra is not None:
        D += extra
    apply_field(obj, D)
    return obj


# ---------------------------------------------------------------------------
# Materials: procedural source shaders baked into the one final material
# ---------------------------------------------------------------------------


class Nodes:
    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.b = bo.bsdf_of(mat)

    def new(self, kind):
        return self.nt.nodes.new(kind)

    def link(self, a, b):
        self.nt.links.new(a, b)

    def put(self, inp, v):
        if hasattr(v, "is_linked") or hasattr(v, "links"):
            self.link(v, inp)
        else:
            inp.default_value = v

    def obj(self):
        return self.new("ShaderNodeTexCoord").outputs["Object"]

    def uv(self, name):
        n = self.new("ShaderNodeUVMap")
        n.uv_map = name
        return n.outputs["UV"]

    def attr(self, name, out="Color"):
        n = self.new("ShaderNodeAttribute")
        n.attribute_name = name
        return n.outputs[out]

    def noise(self, vec, scale, detail=3.0, rough=0.5):
        n = self.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        self.link(vec, n.inputs["Vector"])
        return n.outputs["Factor"]

    def voronoi(self, vec, scale, rand=1.0):
        n = self.new("ShaderNodeTexVoronoi")
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = rand
        self.link(vec, n.inputs["Vector"])
        return n.outputs["Distance"]

    def math(self, op, a, b=None, clamp=False):
        n = self.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self.put(n.inputs[0], a)
        if b is not None:
            self.put(n.inputs[1], b)
        return n.outputs[0]

    def remap(self, v, a, b, c=0.0, d=1.0):
        n = self.new("ShaderNodeMapRange")
        self.put(n.inputs[0], v)
        n.inputs[1].default_value = a
        n.inputs[2].default_value = b
        n.inputs[3].default_value = c
        n.inputs[4].default_value = d
        return n.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        n = self.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        self.put(n.inputs[0], fac)
        self.put(n.inputs[6], (*a, 1.0) if isinstance(a, tuple) else a)
        self.put(n.inputs[7], (*b, 1.0) if isinstance(b, tuple) else b)
        return n.outputs[2]

    def sep(self, vec):
        n = self.new("ShaderNodeSeparateXYZ")
        self.link(vec, n.inputs[0])
        return n.outputs

    def bump(self, h, strength=0.2, dist=0.002, normal=None):
        n = self.new("ShaderNodeBump")
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = dist
        self.link(h, n.inputs["Height"])
        if normal is not None:
            self.link(normal, n.inputs["Normal"])
        return n.outputs["Normal"]

    def base(self, v):
        self.put(self.b.inputs["Base Color"], (*v, 1.0) if isinstance(v, tuple) else v)

    def rough(self, v):
        self.put(self.b.inputs["Roughness"], v)

    def normal(self, v):
        self.link(v, self.b.inputs["Normal"])


def mat_cloth(name, color=None, rough=0.86, weave=240.0, weave_amp=0.22, mottle=0.08, cavity=0.3, attr=None, sheen=0.0, pattern=None):
    """Fabric: colour (flat, vertex attribute or pattern socket builder), mottling,
    pointiness driven cavity shading so folds read like a painted sculpt, weave bump."""
    m = bo.pbr(name, color or (0.5, 0.5, 0.5), rough)
    n = Nodes(m)
    p = n.obj()
    if pattern is not None:
        col = pattern(n)
    elif attr:
        col = n.attr(attr)
    else:
        col = color
    if mottle:
        f = n.remap(n.noise(p, 28.0, 4.0, 0.55), 0.3, 0.7, 1.0 - mottle, 1.0 + mottle)
        col = _mul_scalar(n, col, f)
    if cavity:
        pt = n.new("ShaderNodeNewGeometry").outputs["Pointiness"]
        f = n.remap(pt, 0.44, 0.56, 1.0 - cavity, 1.0 + cavity * 0.45)
        col = _mul_scalar(n, col, f)
    n.base(col)
    if weave_amp:
        h = n.noise(p, weave, 2.0, 0.5)
        n.normal(n.bump(h, weave_amp, 0.0012))
    if sheen:
        s = m.node_tree.nodes["Principled BSDF"].inputs.get("Sheen Weight")
        if s is not None:
            s.default_value = sheen
    return m


def _mul_scalar(n, col, f):
    node = n.new("ShaderNodeVectorMath")
    node.operation = "SCALE"
    n.put(node.inputs[0], (*col[:3],) if isinstance(col, tuple) else col)
    n.put(node.inputs["Scale"], f)
    return node.outputs[0]


def mat_attr(name, rough=0.5, bump_scale=0.0, bump_amp=0.0, bump_kind="noise", dist=0.0015, spec=None):
    """Colour from the vertex attribute `col`; used for fruit skin, shoes and printed panels."""
    m = bo.pbr(name, (0.5, 0.5, 0.5), rough)
    n = Nodes(m)
    n.base(n.attr("col"))
    if bump_amp:
        p = n.obj()
        h = n.voronoi(p, bump_scale) if bump_kind == "voronoi" else n.noise(p, bump_scale, 3.0, 0.55)
        n.normal(n.bump(h, bump_amp, dist))
    if spec is not None:
        n.b.inputs["Specular IOR Level"].default_value = spec
    return m


def set_col(obj, C):
    a = obj.data.color_attributes.new("col", "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(obj.data.vertices), 4), dtype=np.float32)
    rgba[:, :3] = C
    a.data.foreach_set("color", rgba.ravel())
    return obj


def mat_gloss(name, color, rough=0.25, metallic=0.0):
    return bo.pbr(name, color, rough, metallic)


# ---------------------------------------------------------------------------
# Body metrics and rig
# ---------------------------------------------------------------------------


class Body:
    """All sizes derive from the hero's body at scale k (chin height / 0.82)."""

    def __init__(self, height, head_h, hat=0.0, girth=1.0, arm=1.0):
        self.height = height
        self.head_h = head_h
        self.head_top = height - hat
        self.chin = self.head_top - head_h
        k = self.k = self.chin / 0.82
        g = self.g = girth * k**0.5
        self.ankle = 0.115 * k
        self.knee = 0.285 * k
        self.hip = 0.495 * k
        self.crotch = 0.445 * k
        self.waist = 0.585 * k
        self.mid = 0.675 * k
        self.neck = 0.82 * k
        self.sh_z = 0.785 * k
        self.sh_x = 0.178 * g
        self.hip_x = 0.098 * g
        self.up_len = 0.205 * k * arm
        self.fo_len = 0.190 * k * arm
        self.hand_len = 0.136
        c, s = math.cos(ARM_DROP), math.sin(ARM_DROP)
        self.arm_dir = np.array([c, 0.0, -s])
        self.bones = {}
        self._layout()

    def _layout(self):
        B = self.bones
        B["root"] = ((0, 0, 0), (0, 0, 0.12 * self.k))
        B["hips"] = ((0, 0, self.hip), (0, 0, self.waist))
        B["spine"] = ((0, 0, self.waist), (0, 0, self.mid))
        B["chest"] = ((0, 0, self.mid), (0, 0, self.neck))
        B["head"] = ((0, 0, self.neck), (0, 0, self.head_top))
        for sfx, sx in (("L", 1.0), ("R", -1.0)):
            d = self.arm_dir * np.array([sx, 1, 1])
            sh = np.array([sx * self.sh_x, 0, self.sh_z])
            el = sh + d * self.up_len
            wr = el + d * self.fo_len
            tip = wr + d * self.hand_len
            B[f"upperarm.{sfx}"] = (tuple(sh), tuple(el))
            B[f"forearm.{sfx}"] = (tuple(el), tuple(wr))
            B[f"hand.{sfx}"] = (tuple(wr), tuple(tip))
            hx = sx * self.hip_x
            B[f"thigh.{sfx}"] = ((hx, 0, self.hip), (hx, 0, self.knee))
            B[f"shin.{sfx}"] = ((hx, 0, self.knee), (hx, 0, self.ankle))
            B[f"foot.{sfx}"] = ((hx, 0, self.ankle), (hx, -0.14 * self.k, 0.035))
        k, g = self.k, self.g
        self.radius = {
            "hips": 0.165 * g, "spine": 0.175 * g, "chest": 0.19 * g, "head": 0.25,
            "upperarm.L": 0.085, "upperarm.R": 0.085, "forearm.L": 0.08, "forearm.R": 0.08,
            "hand.L": 0.06, "hand.R": 0.06,
            "thigh.L": 0.10 * g, "thigh.R": 0.10 * g, "shin.L": 0.09 * g, "shin.R": 0.09 * g,
            "foot.L": 0.07, "foot.R": 0.07, "root": 0.01,
        }

    def wrist(self, side):
        return np.array(self.bones[f"hand.{'L' if side > 0 else 'R'}"][0])


def build_rig(body):
    arm = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    parents = {
        "root": None, "hips": "root", "spine": "hips", "chest": "spine", "head": "chest",
        "upperarm.L": "chest", "forearm.L": "upperarm.L", "hand.L": "forearm.L",
        "upperarm.R": "chest", "forearm.R": "upperarm.R", "hand.R": "forearm.R",
        "thigh.L": "hips", "shin.L": "thigh.L", "foot.L": "shin.L",
        "thigh.R": "hips", "shin.R": "thigh.R", "foot.R": "shin.R",
    }
    for name in BONES:
        eb = arm.edit_bones.new(name)
        h, t = body.bones[name]
        eb.head, eb.tail = Vector(h), Vector(t)
        eb.use_deform = name != "root"
        # Local +Z is the character's forward for every bone except the foot, whose
        # +Y already runs forward; a +X rotation always swings the tail toward +Z.
        eb.align_roll(Vector((0, 0, 1)) if name.startswith("foot") else Vector((0, -1, 0)))
    for name, par in parents.items():
        if par:
            arm.edit_bones[name].parent = arm.edit_bones[par]
            arm.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def seg_dist(P, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def capsule_weights(body, P, allowed, power=6.0, radii=None, gate=True):
    """Inverse normalised capsule distance. Limited to `allowed`; .L bones cannot
    reach across the mid-plane, top 4 influences kept."""
    allowed = list(allowed)
    W = np.zeros((len(P), len(BONES)))
    for name in allowed:
        a, b = body.bones[name]
        r = (radii or {}).get(name, body.radius[name])
        d = seg_dist(P, a, b)
        w = (r / np.maximum(d, 1e-3)) ** power
        if gate and name.endswith(".L"):
            w = w * sstep(-0.03, 0.02, P[:, 0])
        elif gate and name.endswith(".R"):
            w = w * sstep(0.03, -0.02, P[:, 0])
        W[:, BONES.index(name)] = w
    return normalise_top4(W)


def normalise_top4(W):
    if W.shape[1] > 4:
        cut = np.partition(W, -4, axis=1)[:, -4][:, None]
        W = np.where(W < cut, 0.0, W)
    total = W.sum(1, keepdims=True)
    bad = total[:, 0] <= 0
    W = W / np.maximum(total, 1e-12)
    W[bad, BONES.index("hips")] = 1.0
    return W


def pants_weights(body, P, F):
    """Below the crotch the two legs are separate pieces of surface, so label each vertex
    by connected component. Folds can push inner surfaces across x = 0; an X test would
    then give a right-leg vertex left-shin weight and it would fly off in a stride."""
    W = capsule_weights(body, P, LEG_BONES, 6.0)
    free = capsule_weights(body, P, LEG_BONES, 6.0, gate=False)
    zcut = body.crotch - 0.02 * body.k
    low = P[:, 2] < zcut
    e = F[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2)
    keep = low[e[:, 0]] & low[e[:, 1]]
    labels = _propagate(np.arange(len(P)), e[keep, 0], e[keep, 1])
    fade = sstep(zcut - 0.06 * body.k, zcut, P[:, 2])
    for lab in np.unique(labels[low]):
        m = (labels == lab) & low
        other = "R" if P[m, 0].mean() > 0 else "L"
        W[m] = free[m]
        W[m, BONES.index(f"thigh.{other}")] *= fade[m]
        W[m, BONES.index(f"shin.{other}")] *= fade[m]
    return normalise_top4(W)


def skirt_weights(body, P, top=None, bottom=None):
    """Lungi or long panjabi hem: blends hips down into both thighs by height and
    side, never into the shins, so the tube stretches instead of tearing."""
    top = body.waist if top is None else top
    bottom = body.knee - 0.1 * body.k if bottom is None else bottom
    W = np.zeros((len(P), len(BONES)))
    fall = sstep(top, bottom, P[:, 2]) ** 0.65
    side = sstep(-0.07 * body.g, 0.07 * body.g, P[:, 0])
    W[:, BONES.index("hips")] = 1.0 - fall * 0.82
    W[:, BONES.index("thigh.L")] = fall * 0.82 * side
    W[:, BONES.index("thigh.R")] = fall * 0.82 * (1.0 - side)
    return normalise_top4(W)


# ---------------------------------------------------------------------------
# Character assembly: decimate, skin, unwrap, bake, export
# ---------------------------------------------------------------------------


class Part:
    def __init__(self, hi, budget, bones, density, lo, power, radii, gate, weight_fn, chart, ext, group, lo_smooth):
        self.hi, self.budget, self.bones, self.density = hi, budget, bones, density
        self.lo, self.power, self.radii, self.gate, self.weight_fn = lo, power, radii, gate, weight_fn
        self.chart, self.ext, self.group, self.lo_smooth = chart, ext, group, lo_smooth


class Character:
    def __init__(self, cid, body, tex=1024):
        self.id, self.b, self.tex = cid, body, tex
        self.parts = []
        self.fit = None
        self.head_center = None

    def add(self, hi, budget=None, bones=("chest",), density=1.0, lo=None, power=6.0, radii=None, gate=True, weight_fn=None, chart=0.07, ext=0.009, group=1, lo_smooth=0):
        self.parts.append(Part(hi, budget, bones, density, lo, power, radii, gate, weight_fn, chart, ext, group, lo_smooth))
        return hi

    def highs(self):
        return [p.hi for p in self.parts]


def dup_clean(src, name):
    new = src.copy()
    new.data = src.data.copy()
    new.name = name
    bpy.context.scene.collection.objects.link(new)
    new.modifiers.clear()
    me = new.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    while me.color_attributes:
        me.color_attributes.remove(me.color_attributes[0])
    me.materials.clear()
    return new


def decimate_to(obj, budget):
    t = tri_count(obj)
    if t <= budget:
        return obj
    mod = obj.modifiers.new("d", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = budget / t
    mod.use_collapse_triangulate = True
    bo.apply_modifiers(obj)
    return obj


def triangulate(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def assemble_low(C):
    lows, Ws, poly_counts, dens, charts, exts, groups = [], [], [], [], [], [], []
    for i, p in enumerate(C.parts):
        if p.budget is None:
            continue
        lo = dup_clean(p.lo or p.hi, f"lo_{i}")
        lo.hide_render = False
        bo.apply_modifiers(lo)
        bo.apply_transforms(lo)
        if p.lo_smooth:
            sm = lo.modifiers.new("s", "SMOOTH")
            sm.factor = 0.5
            sm.iterations = p.lo_smooth
            bo.apply_modifiers(lo)
        decimate_to(lo, p.budget)
        triangulate(lo)
        P = coords(lo)
        if p.weight_fn is not None:
            W = p.weight_fn(C.b, P)
        elif set(p.bones) == set(LEG_BONES):
            W = pants_weights(C.b, P, tri_arrays(lo)[1])
        elif len(p.bones) == 1:
            W = np.zeros((len(P), len(BONES)))
            W[:, BONES.index(p.bones[0])] = 1.0
        else:
            W = capsule_weights(C.b, P, p.bones, p.power, p.radii, p.gate)
        if p.lo is not None:
            bpy.data.objects.remove(p.lo, do_unlink=True)
            p.lo = None
        Ws.append(W)
        lows.append(lo)
        poly_counts.append(len(lo.data.polygons))
        dens.append(p.density)
        charts.append(p.chart)
        exts.append(p.ext)
        groups.append(p.group)
    vert_counts = np.array([len(o.data.vertices) for o in lows])
    body = bo.join(lows, "body")
    body.data.shade_smooth()
    return body, np.vstack(Ws), np.array(poly_counts), np.array(dens), charts, vert_counts, np.array(exts), np.array(groups)


def tri_arrays(obj):
    me = obj.data
    me.calc_loop_triangles()
    F = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", F)
    return coords(obj), F.reshape(-1, 3)


def _propagate(labels, a, b):
    """Connected components: minimum label flood along face adjacency pairs."""
    for _ in range(400):
        prev = labels.copy()
        m = np.minimum(labels[a], labels[b])
        np.minimum.at(labels, a, m)
        np.minimum.at(labels, b, m)
        labels = labels[labels]
        if np.array_equal(labels, prev):
            break
    return labels


def chart_labels(V, F, chart_area):
    """Segment a triangle mesh into compact, disk-like charts: k-means over position
    and a heavily smoothed normal, per connected component, then tiny fragments are
    merged into their neighbours. Replaces Smart UV, which shatters decimated meshes."""
    nf = len(F)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e.sort(axis=1)
    fid = np.tile(np.arange(nf), 3)
    order = np.lexsort((e[:, 1], e[:, 0]))
    es, fs = e[order], fid[order]
    same = np.all(es[1:] == es[:-1], axis=1)
    adj_a, adj_b = fs[:-1][same], fs[1:][same]
    comp = _propagate(np.arange(nf), adj_a, adj_b)

    # Smoothed normals.
    tn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    area = np.linalg.norm(tn, axis=1) / 2
    vn = np.zeros_like(V)
    for c in range(3):
        np.add.at(vn, F[:, c], tn)
    edges_uni = np.unique(e, axis=0)
    for _ in range(10):
        nb = np.zeros_like(V)
        np.add.at(nb, edges_uni[:, 0], vn[edges_uni[:, 1]])
        np.add.at(nb, edges_uni[:, 1], vn[edges_uni[:, 0]])
        vn = vn + nb * 0.5
        vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    fnrm = vn[F].sum(1)
    fnrm /= np.maximum(np.linalg.norm(fnrm, axis=1, keepdims=True), 1e-9)
    ctr = V[F].mean(1)

    labels = np.zeros(nf, dtype=np.int64)
    next_label = 0
    for cid in np.unique(comp):
        idx = np.where(comp == cid)[0]
        if len(idx) <= 8:
            labels[idx] = next_label
            next_label += 1
            continue
        k = int(np.clip(round(area[idx].sum() / chart_area), 2, 60))
        diag = max(np.linalg.norm(ctr[idx].max(0) - ctr[idx].min(0)), 1e-4)
        X = np.hstack([(ctr[idx] - ctr[idx].mean(0)) / diag * 1.2, fnrm[idx]])
        # Farthest-point seeding; the first seed faces the camera so seams avoid the front.
        seeds = [int(np.argmin(fnrm[idx, 1] - 0.2 * fnrm[idx, 2]))]
        d = ((X - X[seeds[0]]) ** 2).sum(1)
        for _ in range(k - 1):
            seeds.append(int(np.argmax(d)))
            d = np.minimum(d, ((X - X[seeds[-1]]) ** 2).sum(1))
        cen = X[seeds].copy()
        w = area[idx][:, None] + 1e-9
        lab = np.zeros(len(idx), dtype=np.int64)
        for _ in range(14):
            lab = ((X[:, None, :] - cen[None, :, :]) ** 2).sum(2).argmin(1)
            for j in range(k):
                m = lab == j
                if m.any():
                    cen[j] = (X[m] * w[m]).sum(0) / w[m].sum()
        labels[idx] = lab + next_label
        next_label += k

    # Merge fragments: keep the largest connected piece of each chart and hand the
    # other pieces to whichever neighbouring chart they touch the most.
    for _ in range(6):
        keep_same = labels[adj_a] == labels[adj_b]
        piece = _propagate(np.arange(nf), adj_a[keep_same], adj_b[keep_same])
        pids = np.unique(piece)
        best = {}
        for pid in pids:
            lab = labels[pid]
            ar = area[piece == pid].sum()
            if lab not in best or ar > best[lab][1]:
                best[lab] = (pid, ar)
        keep = {v[0] for v in best.values()}
        changed = False
        for pid in pids:
            if pid in keep:
                continue
            mask = piece == pid
            touching = np.concatenate([labels[adj_b[mask[adj_a] & ~mask[adj_b]]], labels[adj_a[mask[adj_b] & ~mask[adj_a]]]])
            if len(touching):
                vals, cnt = np.unique(touching, return_counts=True)
                labels[mask] = vals[cnt.argmax()]
                changed = True
        if not changed:
            break
    return labels


def uv_overlap(uv, labels, res=384):
    """Fraction of covered texels hit by more than one triangle, a folded chart shows up here."""
    grid = np.zeros((res, res), dtype=np.int32)
    tris = uv.reshape(-1, 3, 2) * res
    for t in tris:
        x0, y0 = np.floor(t.min(0)).astype(int)
        x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, res - 1), min(y1, res - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = np.cross(t[1] - t[0], t[2] - t[0])
        if abs(d) < 1e-9:
            continue
        pts = np.stack([xs, ys], -1) - t[0]
        w1 = np.cross(pts, t[2] - t[0]) / d
        w2 = np.cross(t[1] - t[0], pts) / d
        inside = (w1 >= 0) & (w2 >= 0) & (w1 + w2 <= 1)
        grid[y0 : y1 + 1, x0 : x1 + 1] += inside.astype(np.int32)
    return float((grid > 1).sum()) / max(float((grid > 0).sum()), 1.0)


def chart_self_overlap(uv_tri, res=96):
    """Overlap within one chart at a resolution fitted to the chart."""
    lo, hi = uv_tri.reshape(-1, 2).min(0), uv_tri.reshape(-1, 2).max(0)
    scale = res / max(float((hi - lo).max()), 1e-9)
    T = (uv_tri - lo) * scale
    grid = np.zeros((res + 2, res + 2), dtype=np.int32)
    for t in T:
        x0, y0 = np.floor(t.min(0)).astype(int)
        x1, y1 = np.ceil(t.max(0)).astype(int)
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = float(np.cross(t[1] - t[0], t[2] - t[0]))
        if abs(d) < 1e-9:
            continue
        q = np.stack([xs, ys], -1) - t[0]
        w1 = np.cross(q, t[2] - t[0]) / d
        w2 = np.cross(t[1] - t[0], q) / d
        inside = (w1 >= 0) & (w2 >= 0) & (w1 + w2 <= 1)
        grid[np.clip(y0, 0, res + 1) : np.clip(y1 + 1, 0, res + 2), np.clip(x0, 0, res + 1) : np.clip(x1 + 1, 0, res + 2)] += inside[: max(0, min(y1 + 1, res + 2) - max(y0, 0)), : max(0, min(x1 + 1, res + 2) - max(x0, 0))].astype(np.int32)
    covered = (grid > 0).sum()
    return float((grid > 1).sum()) / max(float(covered), 1.0)


def mark_and_unwrap(body, labels):
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    for edge in bm.edges:
        lf = edge.link_faces
        edge.seam = bool(len(lf) != 2 or labels[lf[0].index] != labels[lf[1].index])
    bm.to_mesh(body.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", fill_holes=True, correct_aspect=True, margin_method="SCALED", margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")


def read_uv(body):
    me = body.data
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    return uv.reshape(-1, 2)


def unwrap(body, poly_counts, densities, chart_areas):
    """Chart, mark seams, angle-based unwrap, split any chart that folded over itself,
    then a density-weighted tight pack."""
    V, F = tri_arrays(body)
    labels = np.zeros(len(F), dtype=np.int64)
    start, offset = 0, 0
    for count, ca in zip(poly_counts, chart_areas):
        fs = F[start : start + count]
        vids, inv = np.unique(fs, return_inverse=True)
        lab = chart_labels(V[vids], inv.reshape(-1, 3), ca)
        labels[start : start + count] = lab + offset
        offset += lab.max() + 1
        start += count
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for it in range(6):
        mark_and_unwrap(body, labels)
        uv = read_uv(body).reshape(-1, 3, 2)
        bad = []
        for lab in np.unique(labels):
            idx = np.where(labels == lab)[0]
            if len(idx) >= 6 and chart_self_overlap(uv[idx]) > 0.006:
                bad.append(lab)
        print(f"[char] unwrap pass {it}: {len(np.unique(labels))} charts, {len(bad)} folded")
        if not bad:
            break
        for lab in bad:
            idx = np.where(labels == lab)[0]
            fs = F[idx]
            vids, inv = np.unique(fs, return_inverse=True)
            tri_area = np.linalg.norm(np.cross(V[fs[:, 1]] - V[fs[:, 0]], V[fs[:, 2]] - V[fs[:, 0]]), axis=1).sum() / 2
            sub = chart_labels(V[vids], inv.reshape(-1, 3), tri_area / 2.0)
            uniq = np.unique(sub)
            for j, u in enumerate(uniq[1:], 1):
                labels[idx[sub == u]] = labels.max() + 1
    uv = read_uv(body)
    start = 0
    for count, d in zip(poly_counts, densities):
        uv[start * 3 : (start + count) * 3] *= math.sqrt(d)
        start += count
    me = body.data
    me.uv_layers.active.data.foreach_set("uv", uv.ravel())
    me.update()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", scale=True, margin_method="SCALED", margin=0.0062, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    uv2 = read_uv(body)
    fill = np.abs(np.cross(uv2[1::3] - uv2[0::3], uv2[2::3] - uv2[0::3])).sum() / 2
    print(f"[char] UV fill {fill:.2f}, overlap {uv_overlap(uv2, labels):.4f}")


def build_cage(body, poly_counts, vert_counts, exts, min_ext=0.0016):
    """Bake cage with a per-vertex extrusion: each part gets its own distance, and a
    vertex never reaches past a different part's surface, so parts cannot pick up
    each other's colour even where they touch."""
    V, F = tri_arrays(body)
    N = vnormals(body)
    vpart = np.repeat(np.arange(len(vert_counts)), vert_counts)
    fpart = np.repeat(np.arange(len(poly_counts)), poly_counts)
    verts = [Vector(v) for v in V.tolist()]
    bvh = BVHTree.FromPolygons(verts, F.tolist(), all_triangles=True)
    ext = exts[vpart].copy()
    limited = 0
    for i in range(len(V)):
        n = Vector(N[i])
        origin = verts[i] + n * 2e-4
        remaining = float(ext[i])
        travelled = 0.0
        for _ in range(5):
            hit = bvh.ray_cast(origin, n, remaining)
            if hit[0] is None:
                break
            step = hit[3] + 2e-4
            travelled += step
            if fpart[hit[2]] != vpart[i]:
                ext[i] = max(min_ext, travelled * 0.55)
                limited += 1
                break
            origin = hit[0] + n * 2e-4
            remaining -= step
            if remaining <= 0:
                break
    print(f"[char] cage: {limited}/{len(V)} vertices limited by a neighbour")
    cage = dup_clean(body, "cage")
    cage.hide_render = True
    while cage.vertex_groups:
        cage.vertex_groups.remove(cage.vertex_groups[0])
    set_coords(cage, V + N * ext[:, None])
    return cage


class _Mats:
    def __init__(self, mats):
        self.data = type("D", (), {"materials": mats})()


def subset_mesh(obj, mask, name):
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    bpy.context.scene.collection.objects.link(new)
    new.modifiers.clear()
    new.vertex_groups.clear()
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not mask[f.index]], context="FACES")
    bm.to_mesh(new.data)
    bm.free()
    new.data.update()
    return new


def uv_mask(uv, size):
    mask = np.zeros((size, size), dtype=bool)
    tris = uv.reshape(-1, 3, 2) * size
    for t in tris:
        x0, y0 = np.floor(t.min(0)).astype(int)
        x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0 - 1, 0), max(y0 - 1, 0), min(x1 + 1, size - 1), min(y1 + 1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = float(np.cross(t[1] - t[0], t[2] - t[0]))
        if abs(d) < 1e-9:
            continue
        q = np.stack([xs, ys], -1) - t[0]
        w1 = np.cross(q, t[2] - t[0]) / d
        w2 = np.cross(t[1] - t[0], q) / d
        e = 1.2 / max(np.sqrt(abs(d)), 1.0)
        inside = (w1 >= -e) & (w2 >= -e) & (w1 + w2 <= 1 + e)
        mask[y0 : y1 + 1, x0 : x1 + 1] |= inside
    return mask


def fill_gutter(img, mask, default=None, iters=16):
    """Bleed island colours into the empty atlas so mip maps never pick up black."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    col = px[:, :, :3].copy()
    valid = mask.copy()
    for _ in range(iters):
        c = np.zeros_like(col)
        n = np.zeros((h, w), dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            vs = np.roll(np.roll(valid, dy, 0), dx, 1)
            c += np.roll(np.roll(col, dy, 0), dx, 1) * vs[..., None]
            n += vs
        new = (~valid) & (n > 0)
        col[new] = c[new] / n[new][:, None]
        valid |= new
    col[~valid] = col[mask].mean(0) if default is None else default
    px[:, :, :3] = col
    px[:, :, 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.update()


def bake_high_to_low(body, C, size, cage, face_group, samples=4, ray=0.035):
    """Bake to one PBR set. Colour and normals run per group so clothes never see the
    head, hands or shoes (and vice versa); AO, roughness and metal run in one go.
    Every high-poly part stays visible for AO in each round."""
    name = C.id
    scene = bpy.context.scene
    bo.enable_gpu_cycles(scene, samples=samples)
    world = bpy.data.worlds.new("bake")
    world.light_settings.distance = 0.22
    scene.world = world
    target = bpy.data.materials.new("bake_target")
    tn = target.node_tree.nodes.new("ShaderNodeTexImage")
    uv_all = read_uv(body)

    def attach(o):
        o.data.materials.clear()
        o.data.materials.append(target)
        return o

    merged = {}
    for g in sorted({p.group for p in C.parts}):
        merged[g] = bo.join([p.hi for p in C.parts if p.group == g], f"hi_g{g}")
    every_high = list(merged.values())
    rounds = []
    for g in sorted(set(face_group.tolist())):
        mask = face_group == g
        lo_g = attach(subset_mesh(body, mask, f"lo_g{g}"))
        cg = subset_mesh(cage, mask, f"cage_g{g}")
        cg.hide_render = True
        highs = [merged[g]]
        rounds.append((lo_g, cg, highs))
    attach(body)
    all_round = (body, cage, every_high)
    subjects = [r[0] for r in rounds] + [body]
    scene.render.bake.margin = 3
    uniq = []
    for h in every_high:
        for m in h.data.materials:
            if m not in uniq:
                uniq.append(m)
    proxy = _Mats(uniq)
    any_metal = any(bo.bsdf_of(m).inputs["Metallic"].links or bo.bsdf_of(m).inputs["Metallic"].default_value > 0 for m in uniq)

    def run_one(kind, image, lo, cg, highs, clear, **kw):
        for o in subjects:
            o.hide_render = o is not lo
        bpy.ops.object.select_all(action="DESELECT")
        for h in every_high:
            h.hide_render = False
        for h in highs:
            h.select_set(True)
        lo.select_set(True)
        bpy.context.view_layer.objects.active = lo
        tn.image = image
        target.node_tree.nodes.active = tn
        for attempt in range(10):
            try:
                t0 = time.time()
                bpy.ops.object.bake(type=kind, use_selected_to_active=True, use_cage=True, cage_object=cg.name, max_ray_distance=ray, use_clear=clear, **kw)
                print(f"[char] bake {kind} {lo.name} {size}px {time.time() - t0:.1f}s")
                return
            except RuntimeError as exc:
                print(f"[char] bake {kind} failed ({exc}), retry {attempt + 1}")
                time.sleep(30)
        raise RuntimeError("bake failed after retries")

    def run_split(kind, image, **kw):
        for i, (lo, cg, highs) in enumerate(rounds):
            run_one(kind, image, lo, cg, highs, i == 0, **kw)

    def run_all(kind, image, **kw):
        run_one(kind, image, *all_round, True, **kw)

    albedo = bpy.data.images.new(f"{name}_albedo", size, size, alpha=False)
    saved = bo._neutralise_for_diffuse(proxy)
    run_split("DIFFUSE", albedo, pass_filter={"COLOR"})
    bo._restore_after_diffuse(saved)

    rough = bpy.data.images.new(f"{name}_rough", size, size, alpha=False)
    rough.colorspace_settings.name = "Non-Color"
    run_all("ROUGHNESS", rough)

    normal = bpy.data.images.new(f"{name}_normal", size, size, alpha=False)
    normal.colorspace_settings.name = "Non-Color"
    run_split("NORMAL", normal, normal_space="TANGENT")

    metal = None
    if any_metal:
        metal = bpy.data.images.new(f"{name}_metal", size, size, alpha=False)
        metal.colorspace_settings.name = "Non-Color"
        bo._swap_to_metal_emission(proxy)
        run_all("EMIT", metal)
        bo._restore_from_metal_emission(proxy)

    ao = bpy.data.images.new(f"{name}_ao", size, size, alpha=False)
    ao.colorspace_settings.name = "Non-Color"
    scene.cycles.samples = 32
    run_all("AO", ao)
    scene.cycles.samples = samples
    bo._multiply_ao_into(albedo, ao, strength=0.7)

    mask = uv_mask(uv_all, size)
    fill_gutter(albedo, mask)
    fill_gutter(rough, mask)
    fill_gutter(normal, mask, default=(0.5, 0.5, 1.0))
    if metal is not None:
        fill_gutter(metal, mask)

    for lo, cg, _ in rounds:
        bpy.data.objects.remove(lo, do_unlink=True)
        bpy.data.objects.remove(cg, do_unlink=True)
    for h in every_high:
        bpy.data.objects.remove(h, do_unlink=True)
    C.parts = []
    body.hide_render = False

    mat = bpy.data.materials.new(f"{name}_baked")
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    a = nt.nodes.new("ShaderNodeTexImage")
    a.image = albedo
    nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
    r = nt.nodes.new("ShaderNodeTexImage")
    r.image = rough
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    if metal is not None:
        m = nt.nodes.new("ShaderNodeTexImage")
        m.image = metal
        nt.links.new(m.outputs["Color"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = 0.0
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = normal
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    body.data.materials.clear()
    body.data.materials.append(mat)
    bpy.data.images.remove(ao)
    if DUMP_TEXTURES:
        for img in (albedo, rough, normal):
            img.filepath_raw = os.path.join(SCRATCH, f"tex_{img.name}.png")
            img.file_format = "PNG"
            img.save()
    return mat


def write_weights(body, rig, W):
    for name in BONES:
        body.vertex_groups.new(name=name)
    groups = {name: body.vertex_groups[name] for name in BONES}
    for j, name in enumerate(BONES):
        nz = np.nonzero(W[:, j] > 1e-4)[0]
        g = groups[name]
        for i in nz.tolist():
            g.add([i], float(W[i, j]), "REPLACE")
    body.parent = rig
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = rig


TEST_POSE = {
    "upperarm.L": (-40, 0, 0), "upperarm.R": (40, 0, 0),
    "forearm.L": (35, 0, 0), "forearm.R": (10, 0, 0),
    "thigh.L": (32, 0, 0), "thigh.R": (-30, 0, 0),
    "shin.L": (-30, 0, 0), "shin.R": (-12, 0, 0),
}
IDLE_POSE = {
    # Bring the arms from the 35 degree A-pose down beside the body.
    "upperarm.L": (0, 0, -40), "upperarm.R": (0, 0, 40),
    "forearm.L": (10, 0, 0), "forearm.R": (10, 0, 0),
}


def set_pose(rig, pose):
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
    for name, deg in pose.items():
        rig.pose.bones[name].rotation_euler = tuple(math.radians(x) for x in deg)
    bpy.context.view_layer.update()


def stretch_report(body, label):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    P = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", P)
    P = P.reshape(-1, 3)
    R = coords(body)
    e = np.empty(len(body.data.edges) * 2, dtype=np.int64)
    body.data.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    a = np.linalg.norm(R[e[:, 0]] - R[e[:, 1]], axis=1)
    b = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
    ok = a > 1e-4
    ratio = b[ok] / a[ok]
    print(f"[char] stretch {label}: max {ratio.max():.2f}, p99 {np.percentile(ratio, 99):.2f}, p999 {np.percentile(ratio, 99.9):.2f}, min {ratio.min():.2f}, edges>2x {(ratio > 2).sum()}")
    ev.to_mesh_clear()


def finish(C, opts):
    scene = bpy.context.scene
    tag = opts.get("tag", "")
    views = opts.get("views", (0, -35, 180))
    t = C.b.height * 0.5
    if opts.get("hi"):
        if not opts.get("nopreview"):
            bo.preview_render(os.path.join(SCRATCH, f"{C.id}_hi{tag}"), target=(0, 0, t), distance=3.3, angles=views, height=0.25, size=(600, 720), samples=24)
        return None
    t0 = time.time()
    body, W, pc, dens, charts, vc, exts, grp = assemble_low(C)
    print(f"[char] {C.id}: {tri_count(body)} tris low, {sum(tri_count(h) for h in C.highs())} high, assemble {time.time() - t0:.1f}s")
    unwrap(body, pc, dens, charts)
    size = opts.get("size") or C.tex
    cage = build_cage(body, pc, vc, exts)
    bake_high_to_low(body, C, size, cage, np.repeat(grp, pc))
    bpy.data.objects.remove(cage, do_unlink=True)
    rig = build_rig(C.b)
    write_weights(body, rig, W)
    if not opts.get("noexport"):
        bo.export_glb(os.path.join(OUT_DIR, f"{C.id}.glb"), objects=[rig, body])
    if not opts.get("nopreview"):
        set_pose(rig, {})
        bo.preview_render(os.path.join(SCRATCH, f"{C.id}_lo{tag}"), target=(0, 0, t), distance=3.3, angles=views, height=0.25, size=(600, 720), samples=24)
        set_pose(rig, IDLE_POSE)
        bo.preview_render(os.path.join(SCRATCH, f"{C.id}_idle{tag}"), target=(0, 0, t), distance=3.3, angles=(0,), height=0.25, size=(600, 720), samples=24)
    if opts.get("close"):
        set_pose(rig, IDLE_POSE)
        bo.preview_render(os.path.join(SCRATCH, f"{C.id}_close{tag}"), target=(0, 0, C.b.height * 0.68), distance=1.7, angles=(0, -40, 180), height=0.12, size=(640, 640), samples=28)
        if opts.get("legs"):
            bo.preview_render(os.path.join(SCRATCH, f"{C.id}_legs{tag}"), target=(0, 0, 0.32), distance=1.7, angles=(0, -40, 180), height=0.1, size=(640, 640), samples=28)
    if opts.get("pose"):
        set_pose(rig, TEST_POSE)
        stretch_report(body, f"{C.id} test pose")
        bo.preview_render(os.path.join(SCRATCH, f"{C.id}_pose{tag}"), target=(0, 0, t), distance=3.3, angles=(-30, 150), height=0.25, size=(600, 720), samples=24)
    set_pose(rig, {})
    return body


# ---------------------------------------------------------------------------
# Heads: every fruit is a (theta, v) surface so colour and displacement can be
# computed per vertex in numpy
# ---------------------------------------------------------------------------


def fruit_surface(name, fn, nu=420, nv=210):
    th = np.linspace(0, 2 * PI, nu, endpoint=False)
    v = np.linspace(0, 1, nv + 2)[1:-1]
    TH, VV = np.meshgrid(th, v)
    P = fn(TH, VV)
    bottom = fn(np.array([0.0]), np.array([0.0]))[0]
    top = fn(np.array([0.0]), np.array([1.0]))[0]
    verts = np.vstack([P.reshape(-1, 3), bottom, top])
    idx = np.arange(nv * nu).reshape(nv, nu)
    a, b = idx[:-1, :], np.roll(idx, -1, axis=1)[:-1, :]
    c, d = np.roll(idx, -1, axis=1)[1:, :], idx[1:, :]
    faces = np.stack([a, b, c, d], -1).reshape(-1, 4).tolist()
    ib, it = nv * nu, nv * nu + 1
    for s in range(nu):
        faces.append([ib, idx[0, (s + 1) % nu], idx[0, s]])
        faces.append([it, idx[-1, s], idx[-1, (s + 1) % nu]])
    obj = bo.new_mesh_object(name, verts.tolist(), faces)
    bo.recalc_normals(obj)
    return obj, np.append(TH.ravel(), [0.0, 0.0]), np.append(VV.ravel(), [0.0, 1.0])


def ellipsoid_fn(zc, hh, rx, ry, taper=0.0, sq=1.0, bend=0.0, lean=0.0):
    def f(th, v):
        ph = PI * v
        cz, sz = -np.cos(ph), np.sin(ph)
        rad = np.abs(sz) ** sq * (1.0 + taper * cz)
        return np.stack([rx * rad * np.cos(th) + lean * cz, ry * rad * np.sin(th) + bend * (cz * cz - 0.3), zc + hh * np.sign(cz) * np.abs(cz) ** (2.0 - sq)], -1)

    return f


def set_fit(C, fn):
    """Low-res smooth proxy used to fit hats and eyewear onto the head."""
    obj, _, _ = fruit_surface("fit", fn, 72, 48)
    verts = [Vector(v) for v in coords(obj).tolist()]
    tris = [tuple(p.vertices) for p in obj.data.polygons]
    C.fit = BVHTree.FromPolygons(verts, tris, all_triangles=False)
    bpy.data.objects.remove(obj, do_unlink=True)


def fit_cast(C, origin, direction, fallback=0.2):
    hit = C.fit.ray_cast(Vector(origin), Vector(direction))
    return hit[3] if hit[0] is not None else fallback


def head_y(C, x, z):
    """Front surface y of the head at (x, z), casting from the front."""
    hit = C.fit.ray_cast(Vector((x, -3.0, z)), Vector((0, 1, 0)))
    return hit[0].y if hit[0] is not None else None


def head_x(C, y, z, side=1):
    hit = C.fit.ray_cast(Vector((side * 3.0, y, z)), Vector((-side, 0, 0)))
    return hit[0].x if hit[0] is not None else None


def mango_head(C):
    b = C.b
    hh = b.head_h / 2
    zc = b.chin + hh
    fn = ellipsoid_fn(zc, hh, 0.228, 0.212, taper=-0.055, sq=0.94, bend=-0.014, lean=0.006)
    set_fit(C, fn)
    C.head_center = np.array([0, 0, zc])
    obj, th, v = fruit_surface("head", fn)
    P = coords(obj)
    n1 = fbm(P, 5.0, 3, 1)
    n2 = fbm(P, 18.0, 3, 2)
    apply_field(obj, (n1 - 0.5) * 0.009)
    h = (P[:, 2] - b.chin) / b.head_h
    q = (P - C.head_center)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    yel = np.array(lin("#F9B60A"))
    gold = np.array(lin("#F39A05"))
    org = np.array(lin("#E5620C"))
    red = np.array(lin("#B8290E"))
    grn = np.array(lin("#8C9A22"))
    col = mixc(yel, gold, sstep(0.25, 0.65, h + (n1 - 0.5) * 0.3))
    col = mixc(col, org, sstep(0.48, 0.82, h + (n1 - 0.5) * 0.35) * 0.9)
    blush_dir = np.array([-0.72, -0.1, 0.62])
    blush_dir /= np.linalg.norm(blush_dir)
    col = mixc(col, red, sstep(0.38, 0.95, q @ blush_dir + (n1 - 0.5) * 0.5) * 0.82)
    col = mixc(col, grn, sstep(0.86, 0.99, h + (n2 - 0.5) * 0.12) * 0.65)
    # Soft under-chin warmth, then the mango's faint lenticel speckle.
    col = mixc(col, np.array(lin("#E89A18")), sstep(0.18, 0.0, h) * 0.5)
    sp = vnoise(P, 130.0, 5)
    col = mixc(col, np.array(lin("#A8651A")), sstep(0.8, 0.9, sp) * 0.28)
    sp2 = vnoise(P, 62.0, 9)
    col = mixc(col, np.array(lin("#FFE27A")), sstep(0.82, 0.92, sp2) * 0.2)
    set_col(obj, col)
    m = mat_attr("mango_skin", 0.42, 150.0, 0.09, "noise", 0.0012)
    bo.assign(obj, m)
    return obj


def stem(C, base, tip, r0=0.016, r1=0.013, color="#5A4A22"):
    a, b = np.asarray(base, float), np.asarray(tip, float)
    mid = (a + b) / 2 + np.array([0.008, 0.004, 0.0])
    s = tube("stem", [a - (b - a) * 0.3, a, mid, b, b + (b - a) * 0.06], [r0 * 1.5, r0 * 1.2, r0, r1, r1 * 0.2], segs=10, n=4)
    refine(s, 1)
    P = coords(s)
    col = mixc(np.array(lin(color)), np.array(lin("#7F7A2C")), sstep(a[2], b[2], P[:, 2]))
    set_col(s, col)
    bo.assign(s, mat_attr("stem", 0.8, 300.0, 0.3, "noise", 0.001))
    return s


# ---------------------------------------------------------------------------
# Headwear
# ---------------------------------------------------------------------------


def cap_frame(center, yaw_deg, tilt_deg):
    """Local cap frame: +Y is where the brim points. Rotation order: tilt then yaw."""
    return Matrix.Translation(Vector(center)) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z") @ Matrix.Rotation(math.radians(tilt_deg), 4, "X")


def baseball_cap(C, band_h, yaw=165.0, tilt=12.0, color="#16171A", panel=True, arch=True, brim_len=0.135, name="cap", mat=None, crown_rx=0.21, crown_rz=0.165, clip_dome=False, cxy=(0.0, 0.0), brim_droop=0.05):
    """Six-panel cap fitted to the head by ray casting. Returns hi parts."""
    b = C.b
    frame = cap_frame((cxy[0], cxy[1], band_h), yaw, tilt)
    ctr = np.array(frame.translation)
    R = np.array(frame.to_3x3())
    ne, nt = 44, 240
    thetas = np.linspace(0, 2 * PI, nt, endpoint=False)
    es = np.linspace(0, 1, ne)
    arch_c = -PI / 2  # opposite the brim in local coords (local -Y)
    arch_half = math.radians(27.0)
    arch_e = math.radians(33.0)
    P = np.zeros((ne, nt, 3))
    for j, th in enumerate(thetas):
        rel = (th - arch_c + PI) % (2 * PI) - PI
        ex = abs(rel) / arch_half
        e0 = arch_e * math.sqrt(max(0.0, 1 - ex * ex)) if (arch and ex < 1) else 0.0
        for i, s in enumerate(es):
            e = e0 + (PI / 2 - e0) * s
            d_loc = np.array([math.cos(e) * math.cos(th), math.cos(e) * math.sin(th), math.sin(e)])
            d_w = R @ d_loc
            rho = fit_cast(C, ctr, d_w, 0.2)
            rho = min(rho, 0.26)
            elev = e / (PI / 2)
            clear = 0.0055 + 0.012 * sstep(0.08, 0.5, elev) + 0.006 * sstep(0.4, 1.0, elev)
            if panel:
                clear += 0.0035 * abs(math.sin(3 * (th - 0.26))) * sstep(0.12, 0.5, elev)
            # Fuller than the head: real caps hold a round dome however narrow the crown is.
            dome = 1.0 / math.sqrt((math.cos(e) / crown_rx) ** 2 + (math.sin(e) / crown_rz) ** 2)
            if clip_dome:
                rho = min(rho, dome)
            P[i, j] = ctr + d_w * max(rho + clear, dome * sstep(0.02, 0.28, elev) + (rho + clear) * (1 - sstep(0.02, 0.28, elev)))
    crown = grid_obj(name + "_crown", P, close_u=True, smooth=True)
    orient_outward(crown, ctr)
    # Pinch the top ring closed.
    Q = coords(crown)
    top_idx = np.arange((ne - 1) * nt, ne * nt)
    Q[top_idx] = Q[top_idx].mean(0)
    set_coords(crown, Q)
    N = vnormals(crown)
    D = np.zeros(len(Q))
    if panel:
        # Sewn panel seams from the button to the band.
        for k in range(6):
            a = 0.26 + k * PI / 3
            line = [ctr + R @ np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)]) * (fit_cast(C, ctr, R @ np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)]), 0.2) + 0.016) for e in np.linspace(0.05, 1.5, 12)]
            D += crease_field(Q, np.array(line), 0.0032, 0.0028, lobes=0.25, taper=False)
    # Sweat-band stitching just above the rim.
    Qloc = (Q - ctr) @ R
    D += -0.0012 * np.exp(-(((Qloc[:, 2] - 0.012) / 0.0016) ** 2))
    D += lumps(Q, 9.0, 0.0022, 5)
    set_coords(crown, Q + N * D[:, None])
    crown_lo = dup_clean(crown, "crown_lo_src")
    crown_lo.hide_render = True
    solid = crown.modifiers.new("sol", "SOLIDIFY")
    solid.thickness = 0.006
    solid.offset = -1.0
    solid.use_rim = True
    bo.apply_modifiers(crown)
    crown.data.shade_smooth()
    # Woven black cotton with a washed-out edge wear.
    def col_pattern(n):
        f = n.remap(n.noise(n.obj(), 16.0, 4.0, 0.6), 0.35, 0.7, 0.0, 1.0)
        base = lin(color)
        lighter = tuple(min(1.0, c * 1.9 + 0.006) for c in base)
        return n.mix(f, base, lighter)

    m_cap = mat or mat_cloth(name + "_fabric", lin(color), 0.82, 340.0, 0.28, 0.1, 0.0, pattern=col_pattern)
    bo.assign(crown, m_cap)
    parts = [(crown, crown_lo, 460)]

    # Brim, in the local frame it leaves the band along local +Y.
    na, nb = 60, 18
    A = np.linspace(-1, 1, na)
    Bb = np.linspace(0, 1, nb)
    G = np.zeros((nb, na, 3))
    for j, a in enumerate(A):
        th = PI / 2 + a * math.radians(68.0)
        e_root = 0.03
        d_loc = np.array([math.cos(e_root) * math.cos(th), math.cos(e_root) * math.sin(th), math.sin(e_root)])
        rho = min(fit_cast(C, ctr, R @ d_loc, 0.2), 0.26)
        root = d_loc * (rho + 0.002)
        L = brim_len * (1 - abs(a) ** 2.3) ** 0.55
        for i, t in enumerate(Bb):
            out = np.array([a * 0.085 * t, 1.0, 0.0])
            out /= np.linalg.norm(out)
            p = root + out * L * t
            p[2] += 0.012 * t - (brim_droop * a * a * (0.25 + 0.75 * t)) * 0.9
            G[i, j] = ctr + R @ p
    brim = grid_obj(name + "_brim", G, smooth=True)
    Q = coords(brim)
    N = vnormals(brim)
    D = np.zeros(len(Q))
    # Concentric stitch rows.
    ql = (Q - ctr) @ R
    for off in (0.02, 0.036, 0.052, 0.068):
        D += -0.0007 * np.exp(-(((np.linalg.norm(ql[:, :2] * np.array([1.0, 1.0]) - np.array([0.0, 0.17]), axis=1) - (0.17 + brim_len - off)) / 0.0018) ** 2))
    set_coords(brim, Q + N * D[:, None])
    brim_lo = dup_clean(brim, "brim_lo_src")
    brim_lo.hide_render = True
    # Keep the low-poly brim two sided so it reads from below.
    sol = brim_lo.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.007
    sol.offset = 0.0
    bo.apply_modifiers(brim_lo)
    sol = brim.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.008
    sol.offset = 0.0
    sol.use_rim = True
    bo.apply_modifiers(brim)
    refine(brim, 1)
    bo.assign(brim, m_cap)
    parts.append((brim, brim_lo, 240))

    if arch:
        # Snapback strap across the arch, on the forehead.
        nt2 = 30
        rel = np.linspace(-arch_half * 1.15, arch_half * 1.15, nt2)
        S = np.zeros((2, nt2, 3))
        for j, r_ in enumerate(rel):
            th = arch_c + r_
            for i, e in enumerate((0.004, 0.17)):
                d_loc = np.array([math.cos(e) * math.cos(th), math.cos(e) * math.sin(th), math.sin(e)])
                d_w = R @ d_loc
                rho = min(fit_cast(C, ctr, d_w, 0.2), 0.26)
                S[i, j] = ctr + d_w * (rho + 0.006)
        strap = grid_obj(name + "_strap", S, smooth=True)
        sol = strap.modifiers.new("sol", "SOLIDIFY")
        sol.thickness = 0.005
        sol.offset = -1.0
        bo.apply_modifiers(strap)
        refine(strap, 2)
        Q = coords(strap)
        ql = (Q - ctr) @ R
        ang = np.arctan2(ql[:, 1], ql[:, 0])
        apply_field(strap, 0.0015 * sstep(0.45, 0.65, np.cos(ang * 22.0)))
        bo.assign(strap, mat_gloss("snap_plastic", lin("#101114"), 0.45))
        parts.append((strap, None, 90))
    return parts


# ---------------------------------------------------------------------------
# Eyewear: opaque, sitting where eyes would be (about 62 percent up the head)
# ---------------------------------------------------------------------------


def lens_outline(style, n=72):
    """Unit outline of one lens around its centre, + is outward (away from the nose)."""
    t = np.linspace(0, 2 * PI, n, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    if style == "wayfarer":
        e = 0.62
        u = np.sign(c) * np.abs(c) ** e * (1.0 + 0.1 * s)
        w = np.sign(s) * np.abs(s) ** e
        u = u + 0.06 * s * np.sign(c)
    elif style == "round":
        u, w = c, s
    elif style == "rect":
        e = 0.32
        u, w = np.sign(c) * np.abs(c) ** e, np.sign(s) * np.abs(s) ** e
    elif style == "aviator":
        u = c * (1.0 + 0.12 * s)
        w = np.where(s > 0, s * 0.72, s * 1.15)
        u = u + 0.1 * np.minimum(s, 0) * -1
    else:
        u, w = c, s
    return np.stack([u, w], 1)


class Sheet:
    """Curved sheet in front of the head: (x, z) to world, following the face."""

    def __init__(self, C, z_e, half_w, clear=0.021, curve=0.74):
        self.z_e = z_e
        y0 = head_y(C, 0.0, z_e)
        ye = head_y(C, half_w * 0.97, z_e)
        if ye is None:
            ye = y0 + 0.14
        self.y0 = y0 - clear
        self.kap = curve * (ye - self.y0) / (half_w * half_w)
        up, dn = head_y(C, 0.0, z_e + 0.05), head_y(C, 0.0, z_e - 0.05)
        self.tau = 0.0
        if up is not None and dn is not None:
            self.tau = float(np.clip((up - dn) / 0.1, -0.3, 0.3))

    def at(self, x, z, off=0.0):
        x, z = np.asarray(x, float), np.asarray(z, float)
        y = self.y0 + self.kap * x * x + self.tau * (z - self.z_e) - off
        return np.stack([x, y, z], -1)


def frame_loop(name, sheet, cx, cz, outline, a, b, fw_fn, depth=0.009, sign=1.0):
    """Lens rim: closed loop of a rounded-rectangular section following the sheet."""
    n = len(outline)
    rings = []
    for i in range(n):
        u, w = outline[i]
        x_in, z_in = cx + sign * u * a, cz + w * b
        nrm = np.array([u / a, w / b])
        nrm /= max(np.linalg.norm(nrm), 1e-6)
        fw = fw_fn(w)
        x_out, z_out = x_in + sign * nrm[0] * fw, z_in + nrm[1] * fw
        rings.append([
            sheet.at(x_in, z_in, 0.0),
            sheet.at(x_out, z_out, 0.0),
            sheet.at(x_out, z_out, depth),
            sheet.at(x_in, z_in, depth),
        ])
    obj = grid_obj(name, np.array(rings).transpose(1, 0, 2), close_u=True, cap_start=False, cap_end=False)
    # Close the cross-section by bridging rows 0 and 3.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    for j in range(n):
        j2 = (j + 1) % n
        try:
            bm.faces.new((bm.verts[3 * n + j], bm.verts[3 * n + j2], bm.verts[j2], bm.verts[j]))
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def lens_plate(name, sheet, cx, cz, outline, a, b, sign=1.0, off=0.002, rings=8):
    n = len(outline)
    P = np.zeros((rings, n, 3))
    for r in range(rings):
        f = (r + 1) / rings
        for i in range(n):
            u, w = outline[i]
            P[r, i] = sheet.at(cx + sign * u * a * f, cz + w * b * f, off + 0.0012 * (1 - f * f))
    verts = P.reshape(-1, 3).tolist()
    verts.append(sheet.at(cx, cz, off + 0.0012).tolist())
    idx = np.arange(rings * n).reshape(rings, n)
    faces = []
    for r in range(rings - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((idx[r, i], idx[r, j], idx[r + 1, j], idx[r + 1, i]))
    ctr = rings * n
    for i in range(n):
        faces.append((ctr, idx[0, i], idx[0, (i + 1) % n]))
    obj = bo.new_mesh_object(name, verts, faces)
    bo.recalc_normals(obj)
    # Make normals face the camera (toward -Y).
    if vnormals(obj)[ctr][1] > 0:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
    return obj


def lens_material(name="lens", tint="#010203", rim="#0a1216", rough=0.14):
    m = bo.pbr(name, lin(tint), rough)
    n = Nodes(m)
    z = n.sep(n.obj())[2]
    # Very gentle vertical sheen in the albedo so the lens never reads flat in a baked map.
    wob = n.noise(n.obj(), 9.0, 2.0, 0.4)
    f = n.remap(n.math("ADD", n.math("FRACT", n.math("MULTIPLY", z, 7.0)), n.math("MULTIPLY", wob, 0.2)), 0.25, 1.1, 0.0, 1.0)
    n.base(n.mix(f, lin(tint), lin(rim)))
    return m


def eyewear(C, style="wayfarer", a=0.094, b=0.056, gap=0.012, fw=0.013, level=0.62, frame="#07080A", metal=False, lo_n=22):
    """Sunglasses with a real rim, recessed opaque lens, bridge and temples."""
    bb = C.b
    z_e = bb.chin + bb.head_h * level
    half_w = gap + 2 * a + fw
    sheet = Sheet(C, z_e, half_w)
    outline = lens_outline(style)
    m_frame = mat_gloss("frame_metal", lin(frame), 0.3, 1.0) if metal else mat_gloss("frame", lin(frame), 0.3)
    m_lens = lens_material()
    objs = []
    cx = gap + a
    top_heavy = {"wayfarer": 1.55, "rect": 0.8, "round": 1.0, "aviator": 1.5}.get(style, 1.0)

    def fw_fn(w):
        return fw * (0.75 + (top_heavy - 0.75) * max(0.0, w))

    depth = 0.0045 if metal else 0.009
    outline_lo = lens_outline(style, lo_n)
    for sign in (1.0, -1.0):
        rim = frame_loop(f"rim{sign}", sheet, sign * cx, z_e, outline, a, b, fw_fn, depth, sign)
        refine(rim, 2)
        bo.assign(rim, m_frame)
        rim_lo = frame_loop(f"rim_lo{sign}", sheet, sign * cx, z_e, outline_lo, a, b, fw_fn, depth, sign)
        rim_lo.hide_render = True
        objs.append((rim, 400, rim_lo))
        lens = lens_plate(f"lens{sign}", sheet, sign * cx, z_e, outline, a, b, sign, off=0.0035 if metal else 0.005)
        refine(lens, 1)
        bo.assign(lens, m_lens)
        objs.append((lens, 44, None))
        # Temple arm from the outer end of the rim back along the head.
        x0 = sign * (cx + a + fw * 0.6)
        z0 = z_e + b * 0.5
        p0 = sheet.at(x0, z0, 0.004)
        pts = [p0 + np.array([-sign * 0.002, 0.0, 0.0])]
        for yy in (p0[1] + 0.03, p0[1] + 0.07, p0[1] + 0.11, p0[1] + 0.16):
            hx = head_x(C, yy, z0, 1 if sign > 0 else -1)
            xx = (hx if hx is not None else pts[-1][0]) + sign * 0.002
            if abs(xx) < abs(pts[-1][0]) - 0.03:
                xx = pts[-1][0] - sign * 0.03
            pts.append(np.array([xx, yy, z0 + 0.002]))
        temple = tube(f"temple{sign}", pts, [(0.0045, 0.009)] * len(pts), segs=8, n=3, ref=(1, 0, 0))
        refine(temple, 1)
        bo.assign(temple, m_frame)
        objs.append((temple, 60, None))
    # Bridge.
    bx = cx - a * 0.95
    p1 = sheet.at(bx, z_e + b * 0.38, 0.004)
    p2 = sheet.at(0.0, z_e + b * 0.5, 0.004)
    p3 = sheet.at(-bx, z_e + b * 0.38, 0.004)
    bridge = tube("bridge", [p1, p2, p3], [(0.006, 0.006)] * 3, segs=8, n=4)
    refine(bridge, 1)
    bo.assign(bridge, m_frame)
    objs.append((bridge, 40, None))
    return objs


# ---------------------------------------------------------------------------
# Fruit heads. Paint functions work per vertex, so stripes, diamonds and spikes are
# real sculpted geometry on the high-poly and survive into the bake.
# ---------------------------------------------------------------------------


def head_from(C, name, fn, paint, mat, nu=420, nv=210):
    set_fit(C, fn)
    obj, th, v = fruit_surface("head_" + name, fn, nu, nv)
    P = coords(obj)
    D, col = paint(P, th, v)
    if D is not None:
        apply_field(obj, D)
    set_col(obj, col)
    bo.assign(obj, mat)
    return obj


def fibre(th, v, around=40.0, along=2.0, seed=0):
    """Noise stretched pole to pole, seamless around the fruit."""
    R = around / (2 * PI)
    q = np.c_[np.cos(th) * R, np.sin(th) * R, v * along]
    return fbm(q, 1.0, 3, seed)


def spike_cells(th, v, around=26, rows=20, jitter=0.28, seed=3):
    """Jittered hex lattice in (theta, v): returns distance to nearest cell centre, in
    units of cell radius. Rows near the poles get fewer cells."""
    rng = np.random.RandomState(seed)
    jit = rng.rand(rows + 4, 128, 2) - 0.5
    best = np.full(len(th), 9.0)
    tv = np.clip(v, 1e-3, 1 - 1e-3)
    base_r = np.floor(tv * rows).astype(np.int64)
    for dr in (-1, 0, 1):
        r = np.clip(base_r + dr, 0, rows - 1)
        cnt = np.maximum(np.round(around * np.sin(PI * (r + 0.5) / rows)).astype(np.int64), 3)
        off = 0.5 * (r % 2)
        for dc in (-1, 0, 1):
            c = np.floor(th / (2 * PI) * cnt + off).astype(np.int64) + dc
            jx = jit[r + 2, c % 128, 0] * jitter
            jy = jit[r + 2, c % 128, 1] * jitter
            ct = ((c + 0.5 - off + jx) / cnt) * 2 * PI
            cv = (r + 0.5 + jy) / rows
            dth = (th - ct + PI) % (2 * PI) - PI
            # Metric: both directions measured in units of one row height.
            sn = np.maximum(np.sin(PI * tv), 0.05)
            dx = dth * sn * rows / PI
            dy = (tv - cv) * rows
            best = np.minimum(best, np.sqrt(dx * dx + dy * dy))
    return best


def head_watermelon(C, rx=0.232, ry=0.222):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, sq=0.97)

    def paint(P, th, v):
        wob = (fbm(P, 6.0, 3, 1) - 0.5) * 1.3 + (fbm(P, 24.0, 2, 2) - 0.5) * 0.4
        s = np.sin(th * 10.0 + wob * 2.4 + 0.5)
        fray = (fbm(P, 58.0, 2, 3) - 0.5) * 0.75
        stripe = sstep(-0.1, 0.16, s + fray)
        light = np.array(lin("#9CC476"))
        mid = np.array(lin("#67A34E"))
        dark = np.array(lin("#17512A"))
        col = mixc(light, mid, sstep(0.3, 0.7, fbm(P, 12.0, 3, 4)))
        col = mixc(col, dark, stripe * 0.94)
        col = mixc(col, np.array(lin("#2C6E37")), sstep(0.55, 0.75, fbm(P, 30.0, 3, 7)) * stripe * 0.5)
        col = mixc(col, dark, sstep(0.66, 0.76, fbm(P, 95.0, 2, 5)) * 0.28 * (1 - stripe))
        # Pale ground spot low on one side, as on a field-grown melon.
        q = (P - np.array([0, 0, b.chin + hh]))
        q /= np.linalg.norm(q, axis=1, keepdims=True)
        spot = sstep(0.82, 0.96, q @ np.array([0.5, 0.45, -0.74]) + (fbm(P, 16.0, 2, 8) - 0.5) * 0.14)
        col = mixc(col, np.array(lin("#D9CF7E")), spot * 0.75)
        return (fbm(P, 5.0, 3, 6) - 0.5) * 0.009, col

    return head_from(C, "melon", fn, paint, mat_attr("melon_skin", 0.36, 210.0, 0.07, "noise", 0.001))


def banana_fn(z0, height, rmax, depth=0.92):
    table_s = np.array([0.0, 0.025, 0.07, 0.16, 0.3, 0.46, 0.62, 0.76, 0.86, 0.93, 0.975, 1.0])
    table_r = np.array([0.0, 0.42, 0.66, 0.86, 1.0, 0.96, 0.78, 0.5, 0.26, 0.13, 0.1, 0.0])

    def f(th, v):
        v_ = np.asarray(v)
        rad = np.interp(v_, table_s, table_r) * rmax
        # The tip bends back then a little forward as a banana's neck does.
        cy = 0.1 * np.sin(np.clip(v_, 0, 1) * PI * 0.62) ** 2 - 0.05 * np.clip((v_ - 0.72) / 0.28, 0, 1) ** 2
        cx = 0.1 * np.clip((v_ - 0.32) / 0.68, 0, 1) ** 1.8
        ridge = 1.0 + 0.035 * np.cos(5 * th + 0.3)
        x = cx + rad * ridge * np.cos(th)
        y = cy + rad * depth * ridge * np.sin(th)
        z = z0 + height * v_
        return np.stack([x, y, z], -1)

    return f


def head_banana(C, rmax=0.188):
    b = C.b
    fn = banana_fn(b.chin, b.head_h, rmax)

    def paint(P, th, v):
        h = (P[:, 2] - b.chin) / b.head_h
        base = np.array(lin("#F4C91C"))
        col = mixc(base, np.array(lin("#EDB410")), sstep(0.3, 0.7, fbm(P, 8.0, 3, 1)))
        col = mixc(col, np.array(lin("#8FA82A")), sstep(0.68, 0.84, h) * 0.65)
        col = mixc(col, np.array(lin("#4A3A1C")), sstep(0.905, 0.945, h))
        # Darker lines along the banana's facets, and sugar freckles.
        ridge = np.abs(np.cos(5 * th + 0.3))
        col = mixc(col, np.array(lin("#B58C12")), sstep(0.93, 1.0, ridge) * 0.32 * sstep(0.1, 0.25, h))
        # Scattered sugar freckles, sparse and everywhere, so they never gather into a line.
        fre = sstep(0.83, 0.88, vnoise(P, 90.0, 5)) * sstep(0.5, 0.62, fbm(P, 11.0, 2, 9))
        col = mixc(col, np.array(lin("#7A561F")), fre * 0.42)
        return (fbm(P, 5.0, 2, 3) - 0.5) * 0.006, col

    return head_from(C, "banana", fn, paint, mat_attr("banana_skin", 0.46, 190.0, 0.05, "noise", 0.001))


def head_papaya(C, rx=0.218, ry=0.205):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, taper=-0.2, sq=0.92)

    def paint(P, th, v):
        h = (P[:, 2] - b.chin) / b.head_h
        n = fbm(P, 6.0, 3, 1)
        streak = fibre(th, v, 26.0, 3.0, 2)
        col = mixc(np.array(lin("#F09A16")), np.array(lin("#E96E12")), sstep(0.25, 0.75, n))
        col = mixc(col, np.array(lin("#D9D12A")), sstep(0.48, 0.74, h + (streak - 0.5) * 0.5) * 0.7)
        col = mixc(col, np.array(lin("#577C22")), sstep(0.66, 0.9, h + (streak - 0.5) * 0.45) * 0.95)
        spots = sstep(0.74, 0.82, vnoise(P, 72.0, 6))
        col = mixc(col, np.array(lin("#8E6A1E")), spots * 0.22)
        D = 0.007 * np.cos(th * 5.0 + 0.7) * sstep(0.1, 0.55, h) * sstep(1.0, 0.75, h)
        D = D + (n - 0.5) * 0.008
        return D, col

    return head_from(C, "papaya", fn, paint, mat_attr("papaya_skin", 0.44, 180.0, 0.05, "noise", 0.001))


def head_lemon(C, rx=0.222, ry=0.212):
    b = C.b
    hh = b.head_h / 2
    base = ellipsoid_fn(b.chin + hh, hh * 0.94, rx, ry, sq=0.99)

    def fn(th, v):
        P = base(th, v)
        nip = np.exp(-(((1.0 - np.asarray(v)) / 0.1) ** 2)) * hh * 0.06 - np.exp(-((np.asarray(v) / 0.1) ** 2)) * hh * 0.05
        return P + np.stack([np.zeros_like(nip), np.zeros_like(nip), nip], -1)

    def paint(P, th, v):
        n = fbm(P, 6.0, 3, 1)
        col = mixc(np.array(lin("#F8D60C")), np.array(lin("#EFC100")), sstep(0.3, 0.7, n))
        col = mixc(col, np.array(lin("#BFC71E")), sstep(0.8, 0.98, (P[:, 2] - b.chin) / b.head_h) * 0.6)
        pores = sstep(0.62, 0.8, vnoise(P, 170.0, 3))
        col = mixc(col, np.array(lin("#D8A800")), pores * 0.22)
        return (n - 0.5) * 0.006 - pores * 0.0014, col

    return head_from(C, "lemon", fn, paint, mat_attr("lemon_skin", 0.4, 300.0, 0.16, "voronoi", 0.0012))


def head_guava(C, rx=0.225, ry=0.218):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, taper=0.06, sq=0.97)

    def paint(P, th, v):
        n = fbm(P, 7.0, 3, 1)
        col = mixc(np.array(lin("#BFD06E")), np.array(lin("#94B24F")), sstep(0.3, 0.7, n))
        col = mixc(col, np.array(lin("#E1DA8C")), sstep(0.55, 0.78, fbm(P, 4.0, 3, 2)) * 0.55)
        col = mixc(col, np.array(lin("#D9C06A")), sstep(0.75, 0.0, (P[:, 2] - b.chin) / b.head_h) * 0.18)
        dots = sstep(0.75, 0.84, vnoise(P, 88.0, 4))
        col = mixc(col, np.array(lin("#6E8A36")), dots * 0.34)
        return (n - 0.5) * 0.009 + dots * 0.0012 + (fbm(P, 42.0, 2, 5) - 0.5) * 0.0026, col

    return head_from(C, "guava", fn, paint, mat_attr("guava_skin", 0.5, 240.0, 0.07, "noise", 0.001))


def head_orange(C, rx=0.232, ry=0.228):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, sq=1.0)

    def paint(P, th, v):
        n = fbm(P, 5.0, 3, 1)
        col = mixc(np.array(lin("#F58D0A")), np.array(lin("#E36C05")), sstep(0.32, 0.72, n))
        col = mixc(col, np.array(lin("#FBAA2A")), sstep(0.55, 0.8, fbm(P, 9.0, 3, 2)) * 0.45)
        pores = sstep(0.55, 0.82, vnoise(P, 210.0, 3))
        col = mixc(col, np.array(lin("#C25A05")), pores * 0.2)
        return (n - 0.5) * 0.005 - pores * 0.0016, col

    return head_from(C, "orange", fn, paint, mat_attr("orange_skin", 0.38, 330.0, 0.24, "voronoi", 0.0015))


def leaf_blade(name, base, direction, length, width, up=(0, 0, 1), droop=0.25, thick=0.0035, rows=9, cols=5):
    """Curved pointed leaf with a folded midrib; closed so it has a real edge."""
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    u = np.asarray(up, float)
    side = np.cross(d, u)
    side /= max(np.linalg.norm(side), 1e-6)
    lift = np.cross(side, d)
    P = np.zeros((rows, cols, 3))
    for i in range(rows):
        s = i / (rows - 1)
        w = width * (np.sin(PI * min(s * 1.08 + 0.06, 1.0)) ** 0.75) * (1 - 0.2 * s)
        c = np.asarray(base, float) + d * length * s - lift * droop * length * s * s
        for j in range(cols):
            a = (j / (cols - 1) - 0.5) * 2
            P[i, j] = c + side * a * w + lift * (abs(a) * w * 0.28)
    obj = grid_obj(name, P)
    sol = obj.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = thick
    sol.offset = 0.0
    bo.apply_modifiers(obj)
    return obj


def head_pineapple(C, rx=0.2, ry=0.198):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, sq=0.86)

    def paint(P, th, v):
        a = th / (2 * PI) * 14.0 + v * 10.0
        c = th / (2 * PI) * 14.0 - v * 10.0
        ea = np.abs(a - np.floor(a) - 0.5) * 2
        eb = np.abs(c - np.floor(c) - 0.5) * 2
        cell = 1.0 - np.maximum(ea, eb)
        pad = sstep(0.0, 0.32, cell)
        # Each eye: pillow with a little sharp point in the middle.
        D = 0.012 * pad + 0.0045 * sstep(0.72, 0.98, cell) - 0.005
        h = (P[:, 2] - b.chin) / b.head_h
        tone = fbm(P, 5.0, 3, 1)
        gold = mixc(np.array(lin("#E7AE1E")), np.array(lin("#CF8A12")), sstep(0.3, 0.7, tone))
        gold = mixc(gold, np.array(lin("#A9A826")), sstep(0.25, 0.0, h) * 0.5 + sstep(0.72, 1.0, h) * 0.45)
        col = mixc(np.array(lin("#4F3410")), gold, sstep(0.02, 0.26, cell))
        col = mixc(col, np.array(lin("#6D4916")), sstep(0.76, 0.96, cell) * 0.9)
        return D, col

    head = head_from(C, "pine", fn, paint, mat_attr("pine_skin", 0.56, 260.0, 0.1, "noise", 0.001), 520, 260)
    # Crown: real blades in tiers, from a tight heart out to long drooping leaves.
    rng = np.random.RandomState(9)
    top = np.array([0.0, 0.0, b.chin + b.head_h - 0.02])
    leaves = []
    tiers = [(10, 0.17, 0.032, 0.08, 0.42, 0.22), (10, 0.225, 0.024, 0.15, 0.58, 0.34), (9, 0.25, 0.012, 0.27, 0.6, 0.52), (7, 0.22, 0.002, 0.42, 0.52, 0.68)]
    idx = 0
    for count, length, rise_base, spread, width_k, droop in tiers:
        for j in range(count):
            ang = (j + rng.uniform(-0.2, 0.2)) / count * 2 * PI + idx
            d = np.array([math.cos(ang) * spread, math.sin(ang) * spread, 1.0])
            base = top + np.array([math.cos(ang) * 0.03, math.sin(ang) * 0.03, rise_base])
            leaves.append(leaf_blade(f"leaf{idx}_{j}", base, d, length * rng.uniform(0.9, 1.1), 0.028 * (0.9 + width_k), droop=droop * rng.uniform(0.8, 1.2)))
        idx += 1
    crown = bo.join(leaves, "pine_crown")
    refine(crown, 1)
    Q = coords(crown)
    t = sstep(top[2] - 0.02, top[2] + 0.24, Q[:, 2])
    col = mixc(np.array(lin("#3F7A30")), np.array(lin("#A8C24C")), t)
    col = mixc(col, np.array(lin("#2C6128")), sstep(0.5, 0.75, fbm(Q, 42.0, 2, 3)) * 0.4)
    set_col(crown, col)
    bo.assign(crown, mat_attr("pine_leaf", 0.5, 400.0, 0.14, "noise", 0.0008))
    return head, crown


def head_coconut(C, rx=0.222, ry=0.216):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, taper=-0.03, sq=0.97)

    def paint(P, th, v):
        wav = (fbm(P, 12.0, 2, 8) - 0.5) * 0.55
        coarse = fibre(th + wav * 0.24, v, 74.0, 8.0, 1)
        fine = fibre(th + wav * 0.36, v, 230.0, 20.0, 2)
        mat = fbm(P, 34.0, 3, 4)
        fibres = coarse * 0.45 + fine * 0.33 + mat * 0.22
        patch = sstep(0.42, 0.62, fbm(P, 5.5, 3, 5))
        col = mixc(np.array(lin("#24160C")), np.array(lin("#5A3A1E")), sstep(0.32, 0.56, fibres))
        col = mixc(col, np.array(lin("#8E6A3C")), sstep(0.52, 0.68, fibres) * 0.75)
        col = mixc(col, np.array(lin("#1B110A")), patch * 0.42)
        D = (fibres - 0.5) * 0.022 + (fbm(P, 5.0, 3, 6) - 0.5) * 0.012
        return D, col

    return head_from(C, "coconut", fn, paint, mat_attr("coconut_husk", 0.86, 260.0, 0.22, "noise", 0.0012), 520, 260)


def head_jackfruit(C, rx=0.226, ry=0.22):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, taper=-0.03, sq=0.95)

    def paint(P, th, v):
        d = spike_cells(th, v, 60, 36, 0.24, 3)
        cone = np.clip(1.0 - d / 0.84, 0, 1)
        D = 0.0112 * cone**1.05 + (fbm(P, 5.0, 3, 6) - 0.5) * 0.012
        tone = fbm(P, 5.0, 3, 1)
        col = mixc(np.array(lin("#71882A")), np.array(lin("#98A636")), sstep(0.3, 0.72, tone))
        col = mixc(np.array(lin("#34441A")), col, sstep(0.04, 0.34, cone))
        col = mixc(col, np.array(lin("#BDB84C")), sstep(0.5, 0.82, cone) * 0.55)
        col = mixc(col, np.array(lin("#3A3414")), sstep(0.88, 0.98, cone) * 0.85)
        return D, col

    return head_from(C, "jack", fn, paint, mat_attr("jack_skin", 0.6, 280.0, 0.12, "noise", 0.001), 680, 340)


def head_lychee(C, rx=0.218, ry=0.21):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, taper=-0.05, sq=0.98)

    def paint(P, th, v):
        d = spike_cells(th, v, 62, 37, 0.32, 7)
        dome = np.clip(1.0 - (d / 0.96) ** 2, 0, 1)
        D = 0.0066 * dome**0.8 + 0.0018 * sstep(0.82, 1.0, dome) + (fbm(P, 5.0, 3, 6) - 0.5) * 0.008
        tone = fbm(P, 5.0, 3, 1)
        col = mixc(np.array(lin("#A81B32")), np.array(lin("#C62B3E")), sstep(0.3, 0.7, tone))
        col = mixc(col, np.array(lin("#E4737A")), sstep(0.5, 0.85, tone + (P[:, 2] - b.chin) / b.head_h * 0.25) * 0.18)
        col = mixc(np.array(lin("#4F0C1A")), col, sstep(0.03, 0.34, dome))
        col = mixc(col, np.array(lin("#E2747E")), sstep(0.78, 0.99, dome) * 0.2)
        return D, col

    return head_from(C, "lychee", fn, paint, mat_attr("lychee_skin", 0.46, 300.0, 0.08, "noise", 0.0008), 680, 340)


def head_date(C, rx=0.206, ry=0.198):
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, taper=-0.03, sq=0.84)

    def paint(P, th, v):
        Q = P * np.array([1.0, 1.0, 0.5])
        warp = np.c_[fbm(P, 7.0, 2, 11), fbm(P, 7.0, 2, 12), fbm(P, 7.0, 2, 13)] * 0.06
        big = 1.0 - np.abs(fbm(Q + warp, 8.5, 2, 1) - 0.5) * 2
        small = 1.0 - np.abs(fbm(Q + warp * 0.6, 24.0, 2, 2) - 0.5) * 2
        creases = sstep(0.86, 0.995, big)
        fine = sstep(0.86, 0.99, small)
        D = -0.011 * creases - 0.0028 * fine + (fbm(P, 4.5, 3, 6) - 0.5) * 0.016
        col = mixc(np.array(lin("#6E3012")), np.array(lin("#8A4318")), sstep(0.32, 0.72, fbm(P, 7.0, 3, 3)))
        col = mixc(col, np.array(lin("#A65E28")), sstep(0.58, 0.8, fbm(P, 13.0, 3, 5)) * 0.4)
        col = mixc(col, np.array(lin("#3F1B0B")), creases * 0.55)
        col = mixc(col, np.array(lin("#572610")), fine * 0.3)
        return D, col

    return head_from(C, "date", fn, paint, mat_attr("date_skin", 0.4, 200.0, 0.06, "noise", 0.0012), 460, 240)


def small_stem_leaf(C, leaf=True, stem_h=0.03, leaf_len=0.12, leaf_w=0.03, color="#3F7A2A"):
    b = C.b
    top = np.array([0.0, 0.0, b.head_top])
    if C.fit is not None:
        hit = C.fit.ray_cast(Vector((0, 0, 5.0)), Vector((0, 0, -1)))
        if hit[0] is not None:
            top = np.array(hit[0])
    stem_o = stem(C, top, top + np.array((0.004, 0.002, stem_h)), 0.012, 0.009, "#5A4A22")
    if not leaf:
        return stem_o, None
    blade = leaf_blade("leaf", top + np.array((0.004, 0.0, stem_h * 0.45)), (0.9, 0.2, 0.42), leaf_len, leaf_w, droop=0.32, thick=0.003, rows=12, cols=7)
    refine(blade, 1)
    Q = coords(blade)
    col = mixc(np.array(lin(color)), np.array(lin("#7AA63A")), sstep(0.3, 0.7, fbm(Q, 60.0, 2, 3)))
    set_col(blade, col)
    bo.assign(blade, mat_attr("orange_leaf", 0.42, 260.0, 0.1, "noise", 0.0006))
    return stem_o, blade


# ---------------------------------------------------------------------------
# More headwear
# ---------------------------------------------------------------------------


def _ring_rays(C, ctr, R, thetas, e=0.0):
    out = []
    for th in thetas:
        d_loc = np.array([math.cos(e) * math.cos(th), math.cos(e) * math.sin(th), math.sin(e)])
        d_w = R @ d_loc
        out.append(min(fit_cast(C, ctr, d_w, 0.2), 0.26))
    return np.array(out)


def peaked_cap(C, band_h, tilt=4.0, color="#2A2E2A", band_col="#101214"):
    """Police-style peaked cap with a plain crown, glossy visor and a plain strap. No insignia."""
    frame = cap_frame((0, 0, band_h), 180.0, tilt)
    ctr, R = np.array(frame.translation), np.array(frame.to_3x3())
    nt = 96
    th = np.linspace(0, 2 * PI, nt, endpoint=False)
    r0 = _ring_rays(C, ctr, R, th) + 0.006
    rows = [(0.0, 1.0), (0.012, 1.002), (0.036, 1.008), (0.046, 1.03), (0.066, 1.16), (0.084, 1.25), (0.098, 1.27), (0.108, 1.24), (0.118, 1.12), (0.127, 0.86), (0.132, 0.55), (0.135, 0.22), (0.1355, 0.02)]
    rows = spline(np.array(rows), 4)
    P = np.zeros((len(rows), nt, 3))
    for i, (zl, m) in enumerate(rows):
        for j, t in enumerate(th):
            # Crown lifts toward the front of the cap, local +Y.
            lift = 0.022 * (0.5 + 0.5 * math.sin(t)) * sstep(0.03, 0.11, zl)
            P[i, j] = ctr + R @ np.array([math.cos(t) * r0[j] * m, math.sin(t) * r0[j] * m, zl + lift])
    crown = grid_obj("peaked_crown", P, close_u=True, cap_start=True, cap_end=True)
    orient_outward(crown, ctr)
    refine(crown, 1)
    Q = coords(crown)
    ql = (Q - ctr) @ R
    is_band = sstep(0.043, 0.04, ql[:, 2])
    col = mixc(np.array(lin(color)), np.array(lin(band_col)), is_band)
    col = col * (0.9 + 0.2 * fbm(Q, 34.0, 2, 3))[:, None]
    D = lumps(Q, 13.0, 0.0022, 2) - 0.0014 * np.exp(-(((ql[:, 2] - 0.041) / 0.0016) ** 2))
    apply_field(crown, D)
    set_col(crown, col)
    bo.assign(crown, mat_cloth("peaked_fabric", None, 0.72, 340.0, 0.2, 0.05, 0.0, attr="col"))
    # Visor.
    na, nb = 40, 10
    G = np.zeros((nb, na, 3))
    A = np.linspace(-1, 1, na)
    for j, a in enumerate(A):
        t = PI / 2 + a * math.radians(62.0)
        rr = min(fit_cast(C, ctr, R @ np.array([math.cos(t), math.sin(t), 0.0]), 0.2), 0.26) + 0.008
        L = 0.078 * (1 - abs(a) ** 2.6) ** 0.5
        for i, s in enumerate(np.linspace(0, 1, nb)):
            rad = rr + L * s
            G[i, j] = ctr + R @ np.array([math.cos(t) * rad, math.sin(t) * rad, 0.008 - 0.042 * s - 0.018 * a * a * s])
    visor = grid_obj("peaked_visor", G)
    orient_outward(visor, ctr + np.array([0, 0, -0.3]))
    sol = visor.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.005
    sol.offset = 0.0
    bo.apply_modifiers(visor)
    visor_lo = dup_clean(visor, "visor_lo")
    visor_lo.hide_render = True
    refine(visor, 1)
    bo.assign(visor, mat_gloss("visor_gloss", lin("#08090B"), 0.14))
    # Plain strap bar across the front of the band.
    pts = []
    for t in np.linspace(PI / 2 - 1.05, PI / 2 + 1.05, 9):
        rr = min(fit_cast(C, ctr, R @ np.array([math.cos(t), math.sin(t), 0.0]), 0.2), 0.26) + 0.0095
        pts.append(ctr + R @ np.array([math.cos(t) * rr, math.sin(t) * rr, 0.017]))
    strap = tube("peaked_strap", pts, [(0.004, 0.0015)] * 9, segs=6, n=3, ref=(0, 0, 1))
    refine(strap, 1)
    bo.assign(strap, mat_gloss("strap_metal", lin("#8B8F94"), 0.34, 1.0))
    return [(crown, None, 520), (visor, visor_lo, 130), (strap, None, 36)]


def topi(C, band_h, height=0.082, color="#EFEBDF", pattern="#B9B3A2"):
    """Crocheted prayer cap: straight wall, soft crown, lattice embroidery as real relief."""
    ctr = np.array([0, 0, band_h])
    R = np.eye(3)
    nt = 128
    th = np.linspace(0, 2 * PI, nt, endpoint=False)
    r0 = _ring_rays(C, ctr, R, th) + 0.008
    rows = spline(np.array([(0.0, 1.0), (0.012, 1.012), (height * 0.8, 1.03), (height * 0.97, 1.0), (height * 1.1, 0.86), (height * 1.2, 0.55), (height * 1.26, 0.22), (height * 1.28, 0.02)]), 6)
    P = np.zeros((len(rows), nt, 3))
    for i, (zl, m) in enumerate(rows):
        for j, t in enumerate(th):
            P[i, j] = ctr + np.array([math.cos(t) * r0[j] * m, math.sin(t) * r0[j] * m, zl])
    cap = grid_obj("topi", P, close_u=True, cap_start=True, cap_end=True)
    orient_outward(cap, ctr)
    refine(cap, 2)
    Q = coords(cap)
    ang = np.arctan2(Q[:, 1], Q[:, 0])
    zl = Q[:, 2] - band_h
    a1 = ang * 18.0 / PI + zl * 56.0
    a2 = ang * 18.0 / PI - zl * 56.0
    d1 = np.abs(a1 - np.floor(a1) - 0.5) * 2
    d2 = np.abs(a2 - np.floor(a2) - 0.5) * 2
    lattice = np.maximum(sstep(0.82, 0.96, d1), sstep(0.82, 0.96, d2))
    holes = sstep(0.34, 0.14, np.minimum(d1, d2))
    wall = sstep(0.012, 0.02, zl) * sstep(height * 0.86, height * 0.8, zl)
    rim_band = sstep(0.0095, 0.0075, zl)
    crown_band = sstep(height * 0.85, height * 0.9, zl) * sstep(height * 1.06, height * 1.0, zl)
    D = lumps(Q, 12.0, 0.002, 5) + 0.0009 * lattice * wall - 0.0011 * holes * wall
    D += 0.0011 * sstep(0.0, 1.0, rim_band) + 0.0009 * crown_band
    # Radial needlework on the crown.
    top_mask = sstep(height * 1.0, height * 1.08, zl)
    rad = np.sqrt(Q[:, 0] ** 2 + Q[:, 1] ** 2)
    D += 0.0008 * top_mask * np.cos(ang * 36.0) + 0.0008 * top_mask * np.cos(rad * 240.0)
    apply_field(cap, D)
    col = np.tile(np.array(lin(color)), (len(Q), 1))
    col = mixc(col, np.array(lin(pattern)), (lattice * 0.55 + holes * 0.8) * wall)
    col = mixc(col, np.array(lin(pattern)), top_mask * (0.25 + 0.25 * np.cos(rad * 240.0)))
    col = col * (0.94 + 0.1 * fbm(Q, 30.0, 2, 3))[:, None]
    set_col(cap, col)
    bo.assign(cap, mat_cloth("topi_thread", None, 0.82, 420.0, 0.24, 0.02, 0.0, attr="col"))
    return cap


def plaid_socket(n, uvname, stops, pitch):
    """Woven check through the garment's own `cloth` UV in metres. stops: [(hex, width)...]."""
    uv = n.uv(uvname)
    sep = n.sep(uv)
    total = sum(w for _, w in stops)

    def band(axis):
        f = n.math("FRACT", n.math("MULTIPLY", axis, 1.0 / pitch))
        node = n.new("ShaderNodeValToRGB")
        ramp = node.color_ramp
        ramp.interpolation = "CONSTANT"
        ramp.elements[0].position = 0.0
        ramp.elements[0].color = (*lin(stops[0][0]), 1)
        ramp.elements[1].position = stops[0][1] / total
        ramp.elements[1].color = (*lin(stops[1 % len(stops)][0]), 1)
        pos = stops[0][1] / total
        for i in range(1, len(stops) - 1):
            pos += stops[i][1] / total
            el = ramp.elements.new(pos)
            el.color = (*lin(stops[i + 1][0]), 1)
        n.link(f, node.inputs[0])
        return node.outputs[0]

    return n.mix(0.5, band(sep[0]), band(sep[1]))


def mat_plaid(name, stops, pitch, rough=0.88, cavity=0.28, weave=320.0, amp=0.2, mottle=0.06):
    return mat_cloth(name, None, rough, weave, amp, mottle, cavity, pattern=lambda n: plaid_socket(n, "cloth", stops, pitch))


def mat_stripes(name, base, line, pitch, width=0.14, rough=0.86, cavity=0.26):
    def pat(n):
        sep = n.sep(n.uv("cloth"))
        f = n.math("FRACT", n.math("MULTIPLY", sep[0], 1.0 / pitch))
        m = n.math("LESS_THAN", f, width)
        return n.mix(m, lin(base), lin(line))

    return mat_cloth(name, None, rough, 340.0, 0.14, 0.04, cavity, pattern=pat)


def set_uv(obj, U, V, name="cloth"):
    me = obj.data
    lay = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    li = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", li)
    uv = np.stack([np.asarray(U)[li], np.asarray(V)[li]], 1)
    lay.data.foreach_set("uv", uv.ravel())


def cloth_strip(name, path, widths, segs=14, n=5, ref=(0, 0, 1), power=2.0, rows_out=None):
    """Ribbon or roll of cloth along a path with a `cloth` UV in metres, ready to subdivide."""
    r = np.asarray(widths, dtype=np.float64)
    both = spline(np.hstack([np.asarray(path, float), r]), n)
    pts, rad = both[:, :3], np.maximum(both[:, 3:], 1e-4)
    T, U, Vv = path_frames(pts, ref)
    th = 2 * PI * np.arange(segs) / segs
    e = 2.0 / power
    c = np.sign(np.cos(th)) * np.abs(np.cos(th)) ** e
    s = np.sign(np.sin(th)) * np.abs(np.sin(th)) ** e
    P = pts[:, None, :] + U[:, None, :] * (rad[:, 0, None] * c)[..., None] + Vv[:, None, :] * (rad[:, 1, None] * s)[..., None]
    obj = grid_obj(name, P, close_u=True, cap_start=True, cap_end=True)
    # UV by vertex index: along the strip and across it, both in metres.
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    along = np.concatenate([[0], np.cumsum(seg)])
    rows, cols = P.shape[:2]
    Uu = np.repeat(along, cols)
    acr = np.tile(np.abs(np.linspace(-1, 1, cols, endpoint=False)), rows) * np.repeat(rad[:, 0], cols) * 2.0
    set_uv(obj, Uu, acr)
    return obj


def turban(C, band_h, stops, pitch=0.03):
    """Gamcha tied as a head wrap: overlapping coils plus a soft crown and a tail."""
    ctr0 = np.array([0, 0, band_h])
    coils = []
    specs = [(0.0, 0.0, 0.0), (0.024, 14.0, 90.0), (0.05, -13.0, 240.0), (0.076, 11.0, 30.0)]
    for i, (dz, tilt, spin) in enumerate(specs):
        R = np.array(Matrix.Rotation(math.radians(spin), 3, "Z") @ Matrix.Rotation(math.radians(tilt), 3, "X"))
        ctr = ctr0 + np.array([0, 0, dz])
        pts = []
        for t in np.linspace(0, 2 * PI, 18):
            d = R @ np.array([math.cos(t), math.sin(t), 0.0])
            rho = min(fit_cast(C, ctr, d, 0.2), 0.26)
            pts.append(ctr + d * (rho + 0.024 - dz * 0.12))
        coil = cloth_strip(f"coil{i}", pts, [(0.03, 0.021)] * len(pts), segs=12, n=3, ref=(0, 0, 1))
        coils.append(coil)
    # Crown filling the top of the wrap.
    dome = bo.uv_sphere("turban_dome", 1.0, 32, 16)
    Q = coords(dome)
    hit = C.fit.ray_cast(Vector((0, 0, 5.0)), Vector((0, 0, -1)))
    ztop = hit[0].z if hit[0] is not None else band_h + 0.12
    cz = band_h + 0.07
    rad = max(min(fit_cast(C, ctr0 + np.array([0, 0, 0.07]), (1, 0, 0), 0.2), 0.24) + 0.004, 0.1)
    Q = Q * np.array([rad, rad, max(ztop - cz + 0.022, 0.05)]) + np.array([0, 0, cz])
    set_coords(dome, Q)
    set_uv(dome, np.arctan2(Q[:, 1], Q[:, 0]) * rad, Q[:, 2])
    coils.append(dome)
    # Tail tucked over the back.
    pts = [ctr0 + np.array([x, y, z]) for x, y, z in ((0.04, 0.22, 0.08), (0.06, 0.25, 0.03), (0.075, 0.26, -0.05), (0.082, 0.255, -0.12))]
    coils.append(cloth_strip("tail", pts, [(0.026, 0.01), (0.03, 0.009), (0.034, 0.008), (0.034, 0.007)], segs=10, n=4, ref=(1, 0, 0)))
    obj = bo.join(coils, "turban")
    refine(obj, 1)
    Q = coords(obj)
    D = lumps(Q, 22.0, 0.003, 4)
    rng = np.random.RandomState(4)
    for j in range(16):
        t = rng.uniform(0, 2 * PI)
        z = band_h + rng.uniform(0.0, 0.1)
        rr = 0.235
        pts = np.array([[math.cos(t + i * 0.09) * rr, math.sin(t + i * 0.09) * rr, z + i * 0.006] for i in range(6)])
        D += crease_field(Q, snap_pts(Q, pts), 0.006, 0.0045, lobes=0.4)
    apply_field(obj, D)
    bo.assign(obj, mat_plaid("turban_gamcha", stops, pitch))
    return obj


# ---------------------------------------------------------------------------
# More eyewear
# ---------------------------------------------------------------------------


def wrap_shades(C, level=0.62, half=82.0, h=0.05, off=0.016, style="wrap"):
    """Single curved opaque shield: `wrap` is the student's sleek futuristic pair, `visor`
    the commuter's plain opaque band."""
    b = C.b
    z_e = b.chin + b.head_h * level
    cy = 0.0
    y_front, y_back = head_y(C, 0.0, z_e), None
    hit_back = C.fit.ray_cast(Vector((0, 3.0, z_e)), Vector((0, -1, 0)))
    if hit_back[0] is not None and y_front is not None:
        cy = (y_front + hit_back[0].y) / 2
    nt, nz = 72, 14
    angs = np.linspace(-half, half, nt)
    P = np.zeros((nz, nt, 3))
    for j, a in enumerate(angs):
        t = a / half
        endc = np.sqrt(max(1 - abs(t) ** 6, 0.0))
        if style == "wrap":
            top = 0.56 * h * endc + 0.34 * h * (t * t) * endc * 0.4
            bot = -h * (1.0 - 0.72 * t * t) * endc
            bot += 0.024 * math.exp(-((a / 12.0) ** 2))
            top_z = top + 0.012 * t * t
            bot_z = bot + 0.012 * t * t
        else:
            top_z = h * 0.62 * endc
            bot_z = -h * 0.62 * endc
        d = np.array([math.sin(math.radians(a)), -math.cos(math.radians(a)), 0.0])
        for i, s in enumerate(np.linspace(0, 1, nz)):
            z = z_e + bot_z + (top_z - bot_z) * s
            origin = np.array([0, cy, z]) + d * 3.0
            hit = C.fit.ray_cast(Vector(origin), Vector(-d))
            base = np.array(hit[0]) if hit[0] is not None else np.array([0, cy, z]) + d * 0.2
            P[i, j] = base + d * off
    # Smooth the shield so it never copies head bumps.
    for _ in range(3):
        P[1:-1, :] = 0.5 * P[1:-1, :] + 0.25 * (P[:-2, :] + P[2:, :])
        P[:, 1:-1] = 0.5 * P[:, 1:-1] + 0.25 * (P[:, :-2] + P[:, 2:])
    shield = grid_obj("shield", P)
    orient_outward(shield, np.array([0, cy, z_e]))
    lo = dup_clean(shield, "shield_lo")
    lo.hide_render = True
    sol = shield.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.006
    sol.offset = -1.0
    sol.use_rim = True
    bo.apply_modifiers(shield)
    refine(shield, 1)
    bo.assign(shield, lens_material("shield_lens", "#030507", "#1F4552" if style == "wrap" else "#1A2A33", 0.14))
    parts = [(shield, 260, lo)]
    # A thin hard edge along the top of the shield, plus end clips that run into the head.
    edge = tube("shield_edge", P[-1][::6].tolist() + [P[-1][-1].tolist()], [(0.0028, 0.0028)] * (len(P[-1][::6]) + 1), segs=6, n=3)
    refine(edge, 1)
    frame_mat = mat_gloss("shield_frame", lin("#2A2D31"), 0.34)
    bo.assign(edge, frame_mat)
    parts.append((edge, 120, None))
    if style == "visor":
        # A visor is a framed band: lower rail too, and end clips where it meets the head.
        rail = tube("shield_rail", P[0][::6].tolist() + [P[0][-1].tolist()], [(0.0028, 0.0028)] * (len(P[0][::6]) + 1), segs=6, n=3)
        refine(rail, 1)
        bo.assign(rail, frame_mat)
        parts.append((rail, 110, None))
        clips = []
        for j in (2, nt - 3):
            a0, a1 = P[1, j], P[-2, j]
            clips.append(capsule("clip", a0, a1, 0.0075, 0.0075, segs=8, rings=2))
        cl = bo.join(clips, "shield_clips")
        cl.data.shade_smooth()
        bo.assign(cl, frame_mat)
        parts.append((cl, 60, None))
    return parts


# ---------------------------------------------------------------------------
# Beard: separate geometry below where a mouth would be, no gap, no mouth shape.
# ---------------------------------------------------------------------------


def beard(C, top_el=-30.0, bot_el=-82.0, half=88.0, thick=0.03, drop=0.02, narrow=0.0, color="#121113", light="#2C2A2C", rough=0.84, forward=0.0):
    b = C.b
    center = C.head_center
    nt, ne = 120, 52
    angs = np.linspace(-half, half, nt)
    P = np.zeros((ne, nt, 3))
    edge_side = np.zeros((ne, nt))
    for j, a in enumerate(angs):
        t = a / half
        # Top edge is one calm line that lifts toward the ears: it must not suggest a mouth.
        top_here = top_el + 16.0 * abs(t) ** 2.4
        for i, s in enumerate(np.linspace(0, 1, ne)):
            el = math.radians(top_here + (bot_el - top_here) * s)
            az = math.radians(a) * (1.0 - narrow * s * s)
            d = np.array([math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)])
            rho = min(fit_cast(C, center, d, 0.2), 0.34)
            tk = thick * (math.sin(PI * min(s * 0.92 + 0.08, 1.0)) ** 0.5) * (1 - abs(t) ** 3.2) + 0.002
            tk *= (1 + 1.3 * narrow * s * s)
            P[i, j] = center + d * (rho + tk - 0.002) + np.array([0, -forward * s * (1 - abs(t) ** 2), -drop * s * s])
            edge_side[i, j] = (1 - abs(t) ** 3) * math.sin(PI * min(s + 0.03, 1.0)) ** 0.4
    # Close the underside loosely by joining at the last row: it stays inside the collar.
    obj = grid_obj("beard", P)
    orient_outward(obj, center)
    lo = dup_clean(obj, "beard_lo")
    lo.hide_render = True
    set_uv(obj, edge_side.ravel(), np.zeros(edge_side.size), "edge")
    refine(obj, 1)
    Q = coords(obj)
    me = obj.data
    li = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", li)
    euv = np.empty(len(me.loops) * 2)
    me.uv_layers["edge"].data.foreach_get("uv", euv)
    fade = np.zeros(len(Q))
    fade[li] = euv[0::2]
    me.uv_layers.remove(me.uv_layers["edge"])
    ang = np.arctan2(Q[:, 0], -(Q[:, 1] - center[1])) + (fbm(Q, 13.0, 2, 7) - 0.5) * 0.3
    # Strands run down the beard, loose and uneven; tufts break up the outline.
    q = np.c_[ang * 17.0, Q[:, 2] * 6.0, Q[:, 1] * 3.0]
    strands = fbm(q, 1.0, 3, 2)
    q2 = np.c_[ang * 52.0, Q[:, 2] * 12.0, Q[:, 1] * 3.0]
    fine = fbm(q2, 1.0, 2, 3)
    tuft = fbm(Q, 24.0, 3, 5)
    D = ((strands - 0.5) * 0.014 + (fine - 0.5) * 0.007 + (tuft - 0.5) * 0.009) * (0.12 + 0.88 * fade)
    apply_field(obj, D)
    col = mixc(np.array(lin(color)), np.array(lin(light)), sstep(0.46, 0.68, fine * 0.6 + strands * 0.4))
    set_col(obj, col)
    bo.assign(obj, mat_attr("beard_hair", rough, 520.0, 0.3, "noise", 0.0012))
    return obj, lo


# ---------------------------------------------------------------------------
# Hands, feet, shoes
# ---------------------------------------------------------------------------


def hand_frame(body, side):
    """World matrix columns of the left-hand frame: X palm normal, Y along the bone, Z thumb."""
    Y = body.arm_dir.copy()
    Z = np.array([0, -1.0, 0])
    X = np.cross(Y, Z)
    return X, Y, Z


def hand_mesh(C, side, skin_mat, scale=1.18):
    """Chunky mitten hand: palm, three thick fingers, thumb. Built for the left, mirrored."""
    b = C.b
    X, Y, Z = hand_frame(b, 1)
    w = b.wrist(1)
    s = scale

    def L(x, y, z):
        return w + X * (x * s) + Y * (y * s) + Z * (z * s)

    parts = []
    # Wrist stub running back into the cuff.
    parts.append(tube("wrist", [L(0, -0.06, 0), L(0, -0.02, 0), L(0, 0.012, 0)], [(0.032, 0.036), (0.033, 0.037), (0.034, 0.04)], segs=16, n=3, ref=tuple(Z)))
    # Palm: a soft pillow.
    palm_ctr = [L(0.0, 0.0, 0.0), L(0.002, 0.02, 0.0), L(0.002, 0.05, 0.002), L(0.001, 0.078, 0.002), L(0.0, 0.092, 0.001)]
    palm_rad = [(0.036, 0.03), (0.046, 0.026), (0.05, 0.028), (0.05, 0.024), (0.034, 0.012)]
    parts.append(tube("palm", palm_ctr, [(rz, rx) for rz, rx in palm_rad], segs=20, n=4, ref=tuple(Z), power=2.3))
    # Three fat fingers with a slight relaxed curl toward the palm (+X).
    for i, zf in enumerate((0.031, 0.0, -0.031)):
        ln = (0.05, 0.056, 0.047)[i]
        r = (0.0188, 0.0198, 0.018)[i]
        base = (0.0, 0.082, zf)
        mid = (0.012, 0.082 + ln * 0.55, zf * 1.05)
        tip = (0.034, 0.082 + ln * 0.95, zf * 1.08)
        parts.append(tube(f"f{i}", [L(*base), L(*mid), L(*tip), L(tip[0] + 0.005, tip[1] + 0.008, tip[2])], [r * 1.05, r, r * 0.96, r * 0.45], segs=12, n=4, ref=tuple(Z)))
    # Thumb, set high on the palm and angled out.
    t0 = (0.008, 0.022, 0.034)
    t1 = (0.018, 0.05, 0.062)
    t2 = (0.028, 0.074, 0.07)
    parts.append(tube("th", [L(*t0), L(*t1), L(*t2), L(0.031, 0.082, 0.07)], [0.021, 0.0195, 0.0175, 0.006], segs=12, n=4, ref=tuple(Y)))
    hand = union("hand", parts, 0.0028, 5, 0.6)
    D = lumps(coords(hand), 40.0, 0.001, 4)
    apply_field(hand, D)
    if side < 0:
        new = mirror_copy(hand, "hand_R")
        bpy.data.objects.remove(hand, do_unlink=True)
        hand = new
    bo.assign(hand, skin_mat)
    return hand


class ShoeShape:
    """Foot-space shape shared by sneakers and formal shoes. s runs heel 0 to toe 1."""

    def __init__(self, x0, L=0.30, W=0.072, heel=0.088, sole=0.034, collar=0.135, vamp=0.066, toe_h=0.058):
        self.x0, self.L, self.W, self.heel, self.sole = x0, L, W, heel, sole
        self.collar, self.vamp, self.toe_h = collar, vamp, toe_h

    def y(self, s):
        return self.heel - self.L * s

    def width(self, s):
        s = np.asarray(s, float)
        body = np.interp(s, [0.0, 0.16, 0.32, 0.55, 0.72, 0.88, 1.0], [0.72, 0.86, 0.88, 1.0, 1.0, 0.86, 0.62]) * self.W
        heel_cap = np.sqrt(np.clip(1 - (np.clip(0.07 - s, 0, None) / 0.07) ** 2, 0.0, 1))
        toe_cap = np.sqrt(np.clip(1 - (np.clip(s - 0.84, 0, None) / 0.16) ** 2, 0.0, 1))
        return body * heel_cap * toe_cap + 1e-4

    def top(self, s):
        s = np.asarray(s, float)
        return np.interp(s, [0.0, 0.3, 0.42, 0.58, 0.8, 0.93, 1.0], [self.collar * 0.95, self.collar, self.collar * 0.82, self.vamp * 1.16, self.vamp * 0.98, self.toe_h, self.toe_h * 0.66])

    def upper_point(self, s, th_deg, off=0.0, power=2.5):
        """th 90 = top of the foot, 0 = outer-X side, 180 = -X side."""
        th = np.radians(th_deg)
        e = 2.0 / power
        c, sn = np.cos(th), np.sin(th)
        cx = np.sign(c) * np.abs(c) ** e
        sx = np.sign(sn) * np.abs(sn) ** e
        w = self.width(s)
        t = self.top(s)
        mid = (t + self.sole * 0.6) / 2
        half = (t - self.sole * 0.6) / 2
        return np.stack([self.x0 + cx * (w + off), self.y(s) + 0 * cx, mid + sx * (half + off)], -1)


def sneaker(C, side, name="sneaker", palette=None):
    """Chunky skate sneaker: layered panels, stitched, white midsole, real laces."""
    pal = dict(upper="#16171B", panel="#D8D6CE", toe="#ECEAE2", sole="#ECE9E0", outsole="#2A2B2E", lace="#E9E7E0", collar="#23252A", tongue="#2A2B30")
    if palette:
        pal.update(palette)
    b = C.b
    x0 = b.hip_x * side
    sh = ShoeShape(x0, L=0.325 * max(b.k, 0.92), W=0.08, heel=0.095, sole=0.038, collar=0.14, vamp=0.072, toe_h=0.064)
    ss = np.concatenate([np.linspace(0, 0.08, 8), np.linspace(0.09, 0.9, 34), np.linspace(0.91, 1.0, 10)])
    thetas = np.linspace(0, 360, 48, endpoint=False)
    P = np.array([[sh.upper_point(s, th) for th in thetas] for s in ss])
    upper = grid_obj("upper", P, close_u=True, cap_start=True, cap_end=True)
    # Ankle collar roll and padded tongue.
    collar = []
    cn = 24
    for i in range(cn):
        a = 2 * PI * i / cn
        collar.append((x0 + math.cos(a) * 0.063, sh.y(0.2) + math.sin(a) * 0.075, sh.collar + 0.006 + 0.008 * math.sin(a)))
    col_tube = tube("collar", collar + [collar[0], collar[1]], [0.017] * (cn + 2), segs=10, n=2, ref=(0, 0, 1), cap=True)
    tongue = tube("tongue", [(x0, sh.y(0.72), sh.vamp * 1.0), (x0, sh.y(0.56), sh.vamp * 1.2), (x0, sh.y(0.42), sh.collar * 0.93), (x0, sh.y(0.36), sh.collar * 1.1)], [(0.026, 0.008), (0.03, 0.011), (0.034, 0.012), (0.033, 0.011)], segs=12, n=4, ref=(1, 0, 0))
    upper = union("upper_v", [upper, col_tube, tongue], 0.0028, 4, 0.55)
    Q = coords(upper)
    s_q = np.clip((sh.heel - Q[:, 1]) / sh.L, 0, 1)
    rel_z = (Q[:, 2] - sh.sole) / np.maximum(sh.top(s_q) - sh.sole, 1e-3)
    across = np.abs(Q[:, 0] - x0) / np.maximum(sh.width(s_q), 1e-3)
    # Panel layout as signed fields (positive means inside the panel).
    heel_panel = 0.21 - s_q + 0.05 * rel_z
    mudguard = (s_q - 0.56) * 0.6 + (0.40 - rel_z) * 0.6 + 0.05
    eyestay = (0.58 - across) * 0.55 + (0.74 - s_q) * 0.1
    eyestay = np.minimum(eyestay, 0.78 - s_q)
    eyestay = np.minimum(eyestay, s_q - 0.28)
    side_stripe = 0.045 - np.abs(rel_z - 0.28 - (s_q - 0.45) * -0.9)
    side_stripe = np.minimum(side_stripe, 0.62 - s_q)
    side_stripe = np.minimum(side_stripe, s_q - 0.22)
    D = np.zeros(len(Q))
    col = np.tile(np.array(lin(pal["panel"])), (len(Q), 1))
    toe = sstep(0.0, 0.008, s_q - 0.6)
    col = mixc(col, np.array(lin(pal["toe"])), toe)
    for field, colour, h in (
        (side_stripe, pal["upper"], 0.0012),
        (eyestay, pal["upper"], 0.0018),
        (mudguard, pal["upper"], 0.0022),
        (heel_panel, pal["upper"], 0.002),
    ):
        mask = sstep(0.0, 0.006, field)
        col = mixc(col, np.array(lin(colour)), mask)
        D += h * sstep(0.0, 0.012, field) - 0.0007 * np.exp(-((field / 0.006) ** 2))
    # Perforated toe box.
    y_p = Q[:, 1] * 95.0
    x_p = (Q[:, 0] - x0) * 95.0
    dots = (np.cos(2 * PI * y_p) * np.cos(2 * PI * x_p) > 0.72) * sstep(0.74, 0.8, s_q) * sstep(0.95, 0.9, s_q) * sstep(0.68, 0.45, across) * sstep(0.45, 0.6, rel_z)
    D -= dots * 0.0009
    col = mixc(col, np.array(lin("#8A8A84")), dots * 0.7)
    # Collar and tongue textile.
    high = sstep(sh.collar * 0.86, sh.collar * 0.94, Q[:, 2]) * sstep(0.46, 0.4, s_q)
    col = mixc(col, np.array(lin(pal["collar"])), high)
    tong = sstep(0.33, 0.24, across) * sstep(0.32, 0.38, s_q) * sstep(0.74, 0.68, s_q)
    col = mixc(col, np.array(lin(pal["tongue"])), tong)
    # Wear: scuffed lighter on ridges, grime low down.
    wear = fbm(Q, 34.0, 3, 8)
    col = col * (0.88 + 0.24 * wear)[:, None]
    grime = sstep(0.28, 0.0, rel_z) * sstep(0.45, 0.65, fbm(Q, 22.0, 3, 6))
    col = mixc(col, np.array(lin("#6E655A")), grime * 0.28)
    D += (wear - 0.5) * 0.0012
    apply_field(upper, D)
    set_col(upper, col)
    bo.assign(upper, mat_attr("shoe_upper", 0.46, 240.0, 0.14, "noise", 0.0009))

    # Sole: wide cupsole, flat bottom, side grooves.
    sn = 48
    so = np.zeros((len(ss), sn, 3))
    for i, s in enumerate(ss):
        w = sh.width(s) + 0.0085
        sp = 0.016 * sstep(0.72, 1.0, s) ** 2
        for j in range(sn):
            a = 2 * PI * j / sn
            c, si = math.cos(a), math.sin(a)
            xx = np.sign(c) * abs(c) ** 0.42 * w
            zz = np.sign(si) * abs(si) ** 0.26
            so[i, j] = (x0 + xx, sh.y(s) + 0.006 * (1 - s) - 0.006 * s, 0.5 * sh.sole * 1.08 + zz * 0.5 * sh.sole * 1.08 + sp)
    sole = grid_obj("sole", so, close_u=True, cap_start=True, cap_end=True)
    sole = voxel(sole, 0.0022, 2, 0.5)
    Q = coords(sole)
    D = np.zeros(len(Q))
    rel = Q[:, 2] / (sh.sole * 1.08)
    side_mask = sstep(0.7, 0.9, np.abs(Q[:, 0] - x0) / np.maximum(sh.width(np.clip((sh.heel - Q[:, 1]) / sh.L, 0, 1)) + 0.0085, 1e-3))
    D -= 0.0016 * np.exp(-(((rel - 0.3) / 0.05) ** 2))
    D -= 0.0009 * np.exp(-(((rel - 0.7) / 0.03) ** 2))
    D -= 0.0012 * sstep(0.7, 1.0, np.cos(2 * PI * Q[:, 1] / 0.009)) * sstep(0.0, 0.03, rel) * sstep(0.28, 0.2, rel)
    apply_field(sole, D)
    col = np.tile(np.array(lin(pal["sole"])), (len(Q), 1))
    col = mixc(col, np.array(lin(pal["outsole"])), sstep(0.3, 0.26, rel))
    col = mixc(col, np.array(lin("#8C8678")), sstep(0.5, 0.75, fbm(Q, 45.0, 3, 12)) * 0.22)
    set_col(sole, col)
    bo.assign(sole, mat_attr("shoe_sole", 0.62, 300.0, 0.15, "noise", 0.0008))

    # Laces: flat bars across the tongue, each a little arched tube, plus a tied bow.
    bars = []
    lace_s = np.linspace(0.70, 0.40, 6)
    for i, s in enumerate(lace_s):
        arc = 34.0 - i * 1.5
        pts = [sh.upper_point(s + (th - 90) / 2000.0, th, 0.0038) for th in np.linspace(90 - arc, 90 + arc, 7)]
        bars.append(tube(f"lace{i}", pts, [(0.0046, 0.0025)] * 7, segs=6, n=2, ref=(0, 1, 0)))
    knot = sh.upper_point(0.385, 90, 0.008)
    for sgn in (-1, 1):
        lp = tube("bow", [knot, knot + np.array([sgn * 0.016, 0.004, 0.006]), knot + np.array([sgn * 0.032, 0.008, 0.0]), knot + np.array([sgn * 0.022, 0.014, -0.006]), knot], [0.0032] * 5, segs=6, n=3)
        bars.append(lp)
    laces = bo.join(bars, "laces")
    refine(laces, 1)
    Q = coords(laces)
    col = np.tile(np.array(lin(pal["lace"])), (len(Q), 1)) * (0.86 + 0.2 * fbm(Q, 80.0, 2, 3))[:, None]
    set_col(laces, col)
    bo.assign(laces, mat_attr("lace", 0.85, 500.0, 0.2, "noise", 0.0005))
    bone = "foot.L" if side > 0 else "foot.R"
    return [(upper, 760, bone), (sole, 320, bone), (laces, 220, bone)]


# ---------------------------------------------------------------------------
# The hero's clothing
# ---------------------------------------------------------------------------


def hoodie_profile(b):
    k, g = b.k, b.g
    rows = [
        (0.432, 0.178, 0.138, 0.000),
        (0.470, 0.182, 0.142, 0.000),
        (0.486, 0.198, 0.154, -0.002),
        (0.590, 0.204, 0.156, -0.004),
        (0.690, 0.202, 0.150, -0.002),
        (0.760, 0.186, 0.136, 0.002),
        (0.815, 0.142, 0.112, 0.006),
        (0.860, 0.096, 0.092, 0.010),
    ]
    return Profile([(z * k, rx * g, ry * g, cy * g) for z, rx, ry, cy in rows], power=2.25)


def open_front_rings(prof, zs, gap_fn, recess=0.03, n=64):
    rings = []
    for z in zs:
        gap = gap_fn(z)
        th = np.linspace(-90 + gap, 270 - gap, n)
        arc = np.array([prof.point(float(t), float(z)) for t in th])
        rx, ry, cy = prof.at(z)
        r_edge = prof.point(270 - gap, float(z), -recess)
        l_edge = prof.point(-90 + gap, float(z), -recess)
        mid = np.array([0.0, cy - ry * 0.25, z])
        rings.append(np.vstack([arc, r_edge, mid, l_edge]))
    return np.array(rings)


def build_hoodie(C, color="#17594F", seed=11, closed=False):
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    prof = hoodie_profile(b)
    hem0, hem1, top = prof.z[0], 0.47 * k, prof.z[-1]
    if closed:
        gap_fn = lambda z: float(np.interp(z, [hem0, 0.74 * k, 0.8 * k], [0.15, 0.15, 7.0]))
    else:
        gap_fn = lambda z: float(np.interp(z, [hem0, 0.62 * k, 0.8 * k], [36.0, 28.0, 26.0]))
    zs = np.concatenate([np.linspace(hem0, hem1, 4), np.linspace(hem1 + 0.004, top, 42)])
    torso = grid_obj("h_torso", open_front_rings(prof, zs, gap_fn), close_u=True, cap_start=True, cap_end=True)

    pieces = [torso]
    limbs = {}
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        d = b.arm_dir * np.array([side, 1, 1])
        sh = np.array(b.bones[f"upperarm.{sfx}"][0])
        length = b.up_len + b.fo_len
        ctrl, rad = [], []
        for t, ru, rv in [(-0.07, 0.07, 0.07), (0.0, 0.088, 0.092), (0.06, 0.09, 0.094), (0.14, 0.087, 0.09), (0.21, 0.084, 0.086), (0.29, 0.079, 0.08), (0.345, 0.081, 0.08), (0.368, 0.076, 0.074), (0.374, 0.058, 0.056), (0.402, 0.053, 0.052)]:
            ctrl.append(sh + d * t * (length / 0.395))
            rad.append((ru, rv))
        sleeve = tube(f"sleeve{sfx}", ctrl, rad, segs=30, n=6)
        pieces.append(sleeve)
        limbs[side] = Limb(ctrl, rad)
    # Hood: a thick collar roll around the neck plus the big sack hanging at the back.
    def collar_pts(sign):
        return [
            (sign * 0.062, -0.135, 0.70),
            (sign * 0.082, -0.128, 0.76),
            (sign * 0.128, -0.082, 0.84),
            (sign * 0.166, 0.012, 0.885),
            (sign * 0.128, 0.118, 0.93),
        ]
    half = collar_pts(1)
    path = [p for p in half] + [(0.0, 0.168, 0.948)] + [tuple(np.array(p) * np.array([-1, 1, 1])) for p in reversed(half)]
    rad = [(0.02, 0.016), (0.03, 0.022), (0.05, 0.036), (0.062, 0.048), (0.07, 0.06), (0.072, 0.066), (0.07, 0.06), (0.062, 0.048), (0.05, 0.036), (0.03, 0.022), (0.02, 0.016)]
    path = [(x * g, y * g, z * k) for x, y, z in path]
    collar = tube("h_collar", path, rad, segs=20, n=6, ref=(0, 0, 1))
    pieces.append(collar)
    if closed:
        # Smaller hood so a backpack can sit under it.
        sack = tube("h_sack", [(0, 0.15 * g, 0.945 * k), (0, 0.185 * g, 0.885 * k), (0, 0.2 * g, 0.825 * k), (0, 0.195 * g, 0.78 * k)], [(0.11, 0.05), (0.13, 0.058), (0.1, 0.05), (0.018, 0.014)], segs=28, n=6, ref=(1, 0, 0), power=2.2)
    else:
        sack = tube("h_sack", [(0, 0.15 * g, 0.945 * k), (0, 0.19 * g, 0.86 * k), (0, 0.21 * g, 0.76 * k), (0, 0.205 * g, 0.675 * k), (0, 0.19 * g, 0.625 * k)], [(0.13, 0.06), (0.165, 0.075), (0.168, 0.07), (0.11, 0.05), (0.018, 0.016)], segs=28, n=6, ref=(1, 0, 0), power=2.2)
    pieces.append(sack)
    # Placket: thick rounded zip tape down each open edge.
    plk = []
    for sign in ((1, -1) if not closed else ()):
        zz = np.linspace(hem0 + 0.002, 0.74 * k, 9)
        pts = [prof.point((-90 + gap_fn(z)) if sign > 0 else (270 - gap_fn(z)), float(z), -0.002) for z in zz]
        pieces.append(tube(f"plk{sign}", pts, [(0.0115, 0.0115)] * 9, segs=10, n=3, ref=(0, 0, 1)))

    hoodie = union("hoodie", pieces, 0.0042, 5, 0.6)
    P = coords(hoodie)
    creases = []
    for side in (1, -1):
        L = limbs[side]
        creases += L.scatter(rng, 0.52, 0.06, 5, 95, 0.24, 0.011, 0.015, a_c=0, a_s=170)
        creases += L.scatter(rng, 0.70, 0.08, 3, 80, 0.26, 0.011, 0.012, a_c=0, a_s=170)
        creases += L.scatter(rng, 0.85, 0.025, 4, 120, 0.05, 0.008, 0.012, a_c=0, a_s=170)
        creases += L.scatter(rng, 0.30, 0.10, 3, 70, 0.30, 0.011, 0.011, a_c=0, a_s=170)
    D = np.zeros(len(P))
    for c in creases:
        D += crease_field(P, c[0], c[1], c[2], c[3])
    # Torso: drag folds from the armpits toward the pockets and bunching over the hem.
    for side in (1, -1):
        for j in range(5):
            th0 = (-30 + j * 14 + rng.uniform(-5, 5))
            th0 = th0 if side > 0 else 180 - th0
            z0 = (0.75 - 0.018 * j) * k
            th1 = th0 - side * (42 + rng.uniform(-10, 14))
            z1 = (0.56 - j * 0.012 + rng.uniform(-0.01, 0.01)) * k
            pts = np.array([prof.point(th0 + (th1 - th0) * t, float(z0 + (z1 - z0) * t)) for t in np.linspace(0, 1, 7)])
            D += crease_field(P, snap_pts(P, pts), 0.014, 0.012)
    # Back: tension folds from the shoulder blades toward the far hip.
    for side in (1, -1):
        for j in range(4):
            th0 = 90 - side * (58 - j * 7)
            th1 = 90 - side * (14 + j * 5)
            z0, z1 = (0.74 - j * 0.03) * k, (0.56 - j * 0.02) * k
            pts = np.array([prof.point(th0 + (th1 - th0) * t, float(z0 + (z1 - z0) * t)) for t in np.linspace(0, 1, 7)])
            D += crease_field(P, snap_pts(P, pts), 0.015, 0.012)
    for j in range(16):
        th = rng.uniform(0, 360)
        z0 = rng.uniform(0.49, 0.51) * k
        pts = np.array([prof.point(th + i * 3, float(z0 + i * 0.012 * k)) for i in range(5)])
        D += crease_field(P, snap_pts(P, pts), 0.011, 0.011)
    D += lumps(P, 6.0, 0.007, 3)
    # Ribbed hem and cuffs.
    u, v, a = prof.uv(P)
    in_torso = np.abs(P[:, 0]) < 0.25
    hem_mask = sstep(hem1 + 0.003, hem1 - 0.003, P[:, 2]) * in_torso
    D += ribs(u, hem_mask, 0.0105, 0.0022)
    for side in (1, -1):
        L = limbs[side]
        vv, ang, rr = L.uv(P)
        cuff = sstep(L.length * 0.94, L.length * 0.948, vv) * (rr < 0.075) * (P[:, 0] * side > 0.25)
        D += ribs(ang * 0.055, cuff, 0.0095, 0.002)
        # Sleeve seam under the arm and the set-in shoulder seam.
        sh_v = 0.07
        seam = np.exp(-(((vv - sh_v) / 0.0028) ** 2)) * (rr < 0.13)
        D -= 0.0028 * seam
    if closed:
        front_c = np.abs(a) < PI / 2
        sd = rrect_sdf(u, P[:, 2], 0.0, 0.545 * k, 0.118, 0.056, 0.016)
        D += stamp(sd, 0.0115, 0.009, 0.0035, 0.003) * front_c
        D += stitch_row(sd, 0.0055, P[:, 2] + u, 0.008, 0.0005) * front_c
        for sgn in (1, -1):
            lip = rrect_sdf(u, P[:, 2], sgn * 0.105, 0.56 * k, 0.012, 0.05, 0.004, rot=sgn * 0.42)
            D += stamp(lip, 0.0035, 0.004, 0.0028, 0.0022) * front_c
    # Slanted hand pockets on the open fronts.
    for side in ((1, -1) if not closed else ()):
        cu = side * 0.135
        sd = rrect_sdf(u, P[:, 2], cu, 0.545 * k, 0.062, 0.05, 0.012, rot=side * 0.32)
        front = (a * side > 0) & (np.abs(a) < PI / 2)
        D += stamp(sd, 0.0095, 0.008, 0.003, 0.0028) * front
        D += stitch_row(sd, 0.0055, P[:, 2] + u, 0.008, 0.0005) * front
        lip = rrect_sdf(u, P[:, 2], cu + side * 0.058, 0.552 * k, 0.012, 0.05, 0.004, rot=side * 0.32)
        D += stamp(lip, 0.0045, 0.005, 0.002, 0.0022) * front
    # Hood seam down the middle of the sack.
    back = (P[:, 1] > 0.09 * g) & (P[:, 2] > 0.62 * k)
    D -= 0.0045 * np.exp(-((P[:, 0] / 0.0032) ** 2)) * back
    D += 0.0028 * np.exp(-((P[:, 0] / 0.016) ** 2)) * back
    for j in range(9):
        sg = 1 if j % 2 else -1
        x0 = sg * rng.uniform(0.03, 0.13)
        z0 = rng.uniform(0.68, 0.92) * k
        pts = np.array([(x0 + sg * i * 0.024, 0.28 * g, z0 - sg * rng.uniform(0.0, 0.02) - (i - 2) * 0.018) for i in range(6)])
        D += crease_field(P, snap_pts(P, pts), 0.016, 0.016)
    # The fold where the hood roll meets the sack.
    pts = np.array([(x, 0.24 * g, (0.875 - 0.9 * x * x) * k) for x in np.linspace(-0.15, 0.15, 11)])
    D += crease_field(P, snap_pts(P, pts), 0.013, 0.012)
    apply_field(hoodie, D)
    bo.assign(hoodie, mat_cloth("fleece", lin(color), 0.9, 300.0, 0.2, 0.09, 0.36))
    return hoodie, prof, limbs


def build_tee(C, prof, color="#E8E6DF", print_col="#9C2A20"):
    b = C.b
    k, g = b.k, b.g
    # Front panel plus a neckline band; hidden by the hoodie everywhere else.
    zs = np.linspace(0.447 * k, 0.835 * k, 34)
    rings = []
    n = 34
    for z in zs:
        rx, ry, cy = prof.at(z)
        th = np.linspace(-90 - 62, -90 + 62, n)
        arc = np.array([prof.point(float(t), float(z), -0.0125) for t in th])
        rings.append(np.vstack([arc, np.array([[arc[-1][0] * 0.8, cy + 0.02, z], [0, cy + 0.03, z], [arc[0][0] * 0.8, cy + 0.02, z]])]))
    tee = grid_obj("tee", np.array(rings), close_u=True, cap_start=True, cap_end=True)
    collar = tube("tee_collar", [(0.104 * g, -0.03 * g, 0.862 * k), (0.092 * g, -0.09 * g, 0.84 * k), (0.0, -0.128 * g, 0.795 * k), (-0.092 * g, -0.09 * g, 0.84 * k), (-0.104 * g, -0.03 * g, 0.862 * k)], [(0.012, 0.008)] * 5, segs=10, n=5, ref=(0, 0, 1))
    tee = voxel(tee, 0.0034, 3, 0.55)
    collar = voxel(collar, 0.0024, 2, 0.5)
    Qc = coords(collar)
    bo.assign(collar, mat_cloth("tee_rib", lin(color), 0.88, 320.0, 0.1, 0.03, 0.0))
    P = coords(tee)
    rng = np.random.RandomState(4)
    D = np.zeros(len(P))
    for j in range(10):
        x0 = rng.uniform(-0.11, 0.11)
        z0 = rng.uniform(0.47, 0.62) * k
        dx = rng.uniform(-0.03, 0.03)
        pts = np.array([(x0 + dx * i / 4, prof.at(z0)[2] - 0.14, z0 + i * 0.04 * k) for i in range(5)])
        pts[:, 1] = [float(prof.point(-90 + math.degrees(math.atan2(p[0], prof.at(p[2])[1])), float(p[2]), -0.0125)[1]) for p in pts]
        D += crease_field(P, pts, 0.012, 0.007)
    D += lumps(P, 8.0, 0.004, 9)
    # A little collar rib.
    apply_field(tee, D)
    # Abstract screen print: overlapping brush blocks, no lettering and nothing that could read as a face.
    x, z = P[:, 0], (P[:, 2] - 0.645 * k) / k
    warp = (fbm(P, 14.0, 3, 21) - 0.5) * 0.018
    disc = np.sqrt((x + warp) ** 2 + (z + warp * 0.7) ** 2) - 0.052
    mask = sstep(0.0015, -0.0015, disc)
    # Screen-print wear only; a plain red disc, no lettering and nothing face-like.
    mask = mask * (1.0 - sstep(0.66, 0.72, fbm(P, 110.0, 2, 13)) * 0.55)
    col = np.tile(np.array(lin(color)), (len(P), 1))
    col = mixc(col, np.array(lin(print_col)), mask)
    set_col(tee, col)
    bo.assign(tee, mat_cloth("tee_cotton", None, 0.88, 320.0, 0.14, 0.03, 0.22, attr="col"))
    return tee, collar


def cargo_pants(C, color="#3A3C2B", seed=23, cargo=True, cuff_z=0.098):
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    pieces = []
    limbs = {}
    x = b.hip_x
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        ctrl = [
            (side * x * 0.86, 0.0, 0.52 * k),
            (side * x * 0.98, 0.0, 0.46 * k),
            (side * x * 1.02, 0.0, 0.385 * k),
            (side * x * 1.0, -0.004, 0.29 * k),
            (side * x * 1.02, 0.0, 0.2 * k),
            (side * x * 1.05, 0.004, 0.135 * k),
            (side * x * 1.05, 0.006, cuff_z * k + 0.006),
            (side * x * 1.05, 0.006, cuff_z * k),
        ]
        rad = [(0.100, 0.096), (0.104, 0.094), (0.106, 0.092), (0.102, 0.09), (0.095, 0.086), (0.095, 0.088), (0.091, 0.084), (0.084, 0.078)]
        rad = [(a * g, c * g) for a, c in rad]
        pieces.append(tube(f"leg{sfx}", ctrl, rad, segs=30, n=6))
        limbs[side] = Limb(ctrl, rad)
    pelvis = tube("pelvis", [(0, 0, 0.445 * k), (0, 0, 0.47 * k), (0, 0, 0.52 * k), (0, 0, 0.575 * k)], [(0.09, 0.12), (0.105, 0.16), (0.108, 0.168), (0.102, 0.158)], segs=30, n=4, power=2.2)
    pieces.append(pelvis)
    pants = union("pants", pieces, 0.0042, 5, 0.6)
    P = coords(pants)
    D = np.zeros(len(P))
    for side in (1, -1):
        L = limbs[side]
        vv, ang, rr = L.uv(P)
        on = (P[:, 0] * side > 0) & (rr < 0.17)
        total = L.length
        for c in L.scatter(rng, 0.43, 0.07, 7, 130, 0.08, 0.014, 0.018, a_c=0, a_s=170):
            D += crease_field(P, c[0], c[1], c[2], c[3])
        for c in L.scatter(rng, 0.86, 0.05, 8, 145, 0.04, 0.014, 0.021, a_c=0, a_s=180):
            D += crease_field(P, c[0], c[1], c[2], c[3])
        for c in L.scatter(rng, 0.2, 0.06, 4, 80, 0.12, 0.013, 0.011, a_c=0, a_s=120):
            D += crease_field(P, c[0], c[1], c[2], c[3])
        for c in L.scatter(rng, 0.62, 0.06, 3, 80, 0.14, 0.012, 0.01, a_c=0, a_s=180):
            D += crease_field(P, c[0], c[1], c[2], c[3])
        # Hem band and side seam.
        hem = sstep(total * 0.965, total * 0.97, vv) * on
        D += hem * 0.0016
        ang_outer = -PI / 2 * side
        seam = np.abs(((ang - ang_outer + PI) % (2 * PI)) - PI) * 0.09
        if cargo:
            # Cargo pocket: pad on the outer thigh, top flap, button, box pleat.
            pu = ((ang - ang_outer + PI) % (2 * PI) - PI) * 0.095
            pad = rrect_sdf(pu, vv, 0.0, total * 0.46, 0.058, 0.07, 0.008) * 1.0
            D += stamp(pad, 0.016, 0.012, 0.0045, 0.003) * on
            D += stitch_row(pad, 0.0045, vv + pu, 0.008, 0.0006) * on
            flap = rrect_sdf(pu, vv, 0.0, total * 0.46 - 0.056, 0.063, 0.025, 0.006)
            D += stamp(flap, 0.0085, 0.004, 0.0045, 0.0028) * on
            D += stitch_row(flap, 0.004, vv + pu, 0.008, 0.0006) * on
            pleat = np.exp(-((pu / 0.0035) ** 2)) * sstep(0.012, -0.002, pad)
            D -= pleat * 0.002 * on
        D -= 0.0018 * np.exp(-((seam / 0.0028) ** 2)) * on
    D += lumps(P, 6.5, 0.006, 7)
    D *= 1.0 - 0.85 * sstep(0.036, 0.012, np.abs(P[:, 0])) * sstep(0.445 * k, 0.42 * k, P[:, 2])
    # Fly and waistband, mostly under the tee.
    fly = np.abs(P[:, 0])
    fmask = (P[:, 1] < 0) & (P[:, 2] > 0.44 * k) & (P[:, 2] < 0.575 * k)
    D -= 0.0018 * np.exp(-((fly / 0.003) ** 2)) * fmask
    apply_field(pants, D)
    bo.assign(pants, mat_cloth("cargo_twill", lin(color), 0.9, 380.0, 0.2, 0.1, 0.34))
    return pants, limbs


def crossbody_bag(C, prof, side=-1):
    """Black cross-body bag on the character's right hip, strap over the left shoulder."""
    b = C.b
    k, g = b.k, b.g
    # Strap across the front and the back, hugging the hoodie.
    z_top = 0.845 * k
    off = 0.0105
    front = []
    for t in np.linspace(0, 1, 12):
        z = z_top + (0.585 * k - z_top) * t
        # theta runs from the left shoulder (near +X top) across the chest to the right hip.
        th = -38 + (-136 - -38) * t
        front.append(prof.point(th, float(z), off))
    back = []
    for t in np.linspace(0, 1, 10):
        z = z_top + (0.555 * k - z_top) * t
        th = 38 + (165 - 38) * t
        # Over the hood sack near the top.
        p = prof.point(th, float(z), off + 0.02 * (1 - t) * (1 - t))
        back.append(p)
    top = [(0.085 * g, -0.01 * g, z_top + 0.03), ]
    path = list(reversed(front)) + top + back
    strap = tube("strap", path, [(0.017, 0.0034)] * len(path), segs=10, n=3, ref=(0, 0, 1), power=3.5)
    refine(strap, 1)
    bo.assign(strap, mat_cloth("webbing", lin("#121316"), 0.72, 500.0, 0.5, 0.05, 0.0))

    # Bag body: soft rounded leather box with flap, front pocket, tab and buckle.
    anchor = prof.point(-140.0 if side < 0 else -40.0, float(0.525 * k), 0.046)
    bx, by, bz = float(anchor[0]), float(anchor[1]), float(anchor[2])
    Rm = Matrix.Translation((bx, by, bz)) @ Matrix.Rotation(side * 0.72, 4, "Z") @ Matrix.Rotation(0.05, 4, "X")
    Rinv = Rm.inverted()
    bag = rounded_box("bag", (0.172, 0.074, 0.142), 0.03, matrix=Rm)
    flap = rounded_box("flap", (0.176, 0.016, 0.088), 0.0075, loc=(0, -0.038, 0.03), matrix=Rm)
    pocket = rounded_box("bag_pkt", (0.128, 0.012, 0.04), 0.005, loc=(0, -0.04, -0.043), matrix=Rm)
    tab = rounded_box("bag_tab", (0.03, 0.009, 0.062), 0.004, loc=(0, -0.05, -0.002), matrix=Rm)
    bag_u = union("bag_u", [bag, flap, pocket, tab], 0.0026, 2, 0.5)
    Q = coords(bag_u)
    L = transformed(Q, Rinv)
    D = (fbm(Q, 24.0, 3, 15) - 0.5) * 0.0036 + 0.0012 * (fbm(Q, 130.0, 3, 11) - 0.5)
    # Sewn line along the flap edge and top of the pocket.
    flap_sd = rrect_sdf(L[:, 0], L[:, 2], 0.0, 0.03, 0.082, 0.038, 0.008)
    front = L[:, 1] < -0.02
    D += stitch_row(flap_sd, 0.005, L[:, 0] + L[:, 2], 0.0085, 0.0007, 0.0014) * front
    apply_field(bag_u, D)
    edge = np.exp(-((flap_sd + 0.005) / 0.002) ** 2) * front
    col = np.tile(np.array(lin("#26272B")), (len(Q), 1))
    col = mixc(col, np.array(lin("#1A1B1E")), sstep(0.004, -0.002, flap_sd) * front)
    col = col * (0.8 + 0.5 * fbm(Q, 40.0, 3, 19))[:, None]
    col = mixc(col, np.array(lin("#6A6B70")), edge * 0.55)
    set_col(bag_u, col)
    bo.assign(bag_u, mat_attr("bag_leather", 0.46, 420.0, 0.2, "noise", 0.001))
    # Hardware: buckle frame and two D-rings where the strap meets the bag.
    buckle = rounded_box("buckle", (0.042, 0.007, 0.026), 0.0032, loc=(0, -0.056, 0.0), matrix=Rm)
    ring_l = rounded_box("ring_l", (0.022, 0.006, 0.02), 0.0028, loc=(-0.07, -0.014, 0.078), matrix=Rm)
    ring_r = rounded_box("ring_r", (0.022, 0.006, 0.02), 0.0028, loc=(0.07, -0.014, 0.078), matrix=Rm)
    hardware = bo.join([buckle, ring_l, ring_r], "bag_hw")
    hardware.data.shade_smooth()
    bo.assign(hardware, mat_gloss("buckle_metal", lin("#9A9EA3"), 0.36, 1.0))
    return strap, bag_u, hardware


# ---------------------------------------------------------------------------
# Characters
# ---------------------------------------------------------------------------


def skin_material(name, color, rough=0.5):
    return mat_cloth(name, lin(color), rough, 210.0, 0.05, 0.05, 0.1)


TORSO_BONES = ("hips", "spine", "chest", "upperarm.L", "forearm.L", "upperarm.R", "forearm.R")
LEG_BONES = ("hips", "thigh.L", "shin.L", "thigh.R", "shin.R")


# ---------------------------------------------------------------------------
# Shared clothing and body library for the NPC cast
# ---------------------------------------------------------------------------


def top_profile(b, hem=0.47, loose=1.0, belly=0.0, flare=0.0):
    """Torso of a shirt or tunic. `flare` opens the skirt of a long panjabi."""
    k, g = b.k, b.g
    rows = []
    if hem < 0.44:
        rows.append((hem, (0.205 + flare) * loose, (0.158 + flare) * loose, 0.0))
        rows.append((hem + 0.07, (0.197 + flare * 0.7) * loose, (0.15 + flare * 0.7) * loose, 0.0))
        rows.append((0.44, 0.183 * loose, 0.138 * loose, 0.0))
    elif hem >= 0.5:
        rows.append((hem, 0.146, 0.104, 0.0))
        rows.append((0.605, 0.15, 0.106, 0.0))
    else:
        rows.append((hem, 0.17 * loose, 0.128 * loose, 0.0))
        rows.append((hem + 0.03, 0.174 * loose, 0.131 * loose, 0.0))
    rows += [
        (0.635 if hem >= 0.5 else max(hem + 0.07, 0.56), (0.178 + belly) * loose, (0.133 + belly) * loose, -belly * 0.7),
        (0.65, (0.182 + belly * 0.5) * loose, (0.134 + belly * 0.5) * loose, -belly * 0.3),
        (0.73, 0.176 * loose, 0.126 * loose, 0.002),
        (0.785, 0.154 * loose, 0.112 * loose, 0.004),
        (0.825, 0.122, 0.096, 0.006),
        (0.868, 0.082, 0.078, 0.01),
    ]
    return Profile([(z * k, rx * g, ry * g, cy * g) for z, rx, ry, cy in rows], power=2.25)


def stacked_torso(name, prof, nz=44, nth=64, off=0.0):
    zs = np.linspace(prof.z[0], prof.z[-1], nz)
    th = np.linspace(0, 360, nth, endpoint=False)
    rx, ry, cy = prof.at(zs)
    t = np.radians(th)
    e = 2.0 / prof.power
    c = np.sign(np.cos(t)) * np.abs(np.cos(t)) ** e
    s = np.sign(np.sin(t)) * np.abs(np.sin(t)) ** e
    P = np.zeros((nz, nth, 3))
    P[..., 0] = c[None, :] * (rx[:, None] + off)
    P[..., 1] = cy[:, None] + s[None, :] * (ry[:, None] + off)
    P[..., 2] = zs[:, None]
    return grid_obj(name, P, close_u=True, cap_start=True, cap_end=True)


def sleeve_tube(b, side, kind, rad=1.0):
    """kind: 'short' ends above the elbow with an open, hollow end; 'long' ends in a cuff."""
    sfx = "L" if side > 0 else "R"
    d = b.arm_dir * np.array([side, 1, 1])
    sh = np.array(b.bones[f"upperarm.{sfx}"][0])
    L = b.up_len + b.fo_len
    if kind == "short":
        ctrl = [(-0.07, 0.066), (0.0, 0.078), (0.05, 0.08), (0.11, 0.077), (0.165, 0.076)]
        end = 0.165
    elif kind == "elbow":
        ctrl = [(-0.07, 0.066), (0.0, 0.078), (0.06, 0.08), (0.13, 0.076), (0.2, 0.073), (0.245, 0.074)]
        end = 0.245
    else:
        ctrl = [(-0.07, 0.066), (0.0, 0.078), (0.06, 0.08), (0.14, 0.075), (0.21, 0.07), (0.29, 0.066), (0.35, 0.066), (0.366, 0.063), (0.372, 0.052), (0.4, 0.049)]
        end = None
    ctrl = [(t * L / 0.395, r * rad) for t, r in ctrl]
    pts = [sh + d * t for t, _ in ctrl]
    radii = [(r, r * 1.02) for _, r in ctrl]
    both = spline(np.hstack([np.array(pts), np.array(radii)]), 5)
    path, rr = both[:, :3], both[:, 3:]
    if end is not None:
        # Fold the end back into the sleeve so the opening is a real dark hollow.
        tip = path[-1]
        ra = rr[-1]
        extra_p = [tip + d * 0.001, tip - d * 0.004, tip - d * 0.02, tip - d * 0.045]
        extra_r = [ra * 0.985, ra * 0.87, ra * 0.8, ra * 0.72]
        path = np.vstack([path, extra_p])
        rr = np.vstack([rr, extra_r])
    T, U, Vv = path_frames(path, (0, -1, 0))
    if end is not None:
        T[-5:] = d
        U[-5:] = U[-6]
        Vv[-5:] = Vv[-6]
    segs = 28
    th = 2 * PI * np.arange(segs) / segs
    P = path[:, None, :] + U[:, None, :] * (rr[:, 0, None] * np.cos(th))[..., None] + Vv[:, None, :] * (rr[:, 1, None] * np.sin(th))[..., None]
    obj = grid_obj(f"sleeve{sfx}", P, close_u=True, cap_start=True, cap_end=True)
    limb = Limb(pts, radii)
    return obj, limb


def shirt_collar(C, prof, name="collar", mat=None, depth=0.042, tip=0.062, spread=20.0, open_front=False):
    """Fold-over collar: a ruled surface around the neck with two pointed front leaves."""
    b = C.b
    k, g = b.k, b.g
    nt, ns = 96, 8
    # Angle runs from the front-left tip around the back to the front-right tip.
    angs = np.linspace(spread, 360 - spread, nt)  # 0 is front, measured toward +X
    z_neck = 0.862 * k
    P = np.zeros((ns, nt, 3))
    r_top = 0.091 * g
    for j, a in enumerate(angs):
        ar = math.radians(a)
        dirx, diry = math.sin(ar), -math.cos(ar)
        front = max(0.0, math.cos(ar)) ** 3
        drop = depth + tip * front
        for i, s in enumerate(np.linspace(0, 1, ns)):
            rad = r_top + 0.022 * s + 0.044 * s * front
            P[i, j] = (dirx * rad, 0.004 + diry * rad * 1.02, z_neck - 0.006 - drop * s + 0.012 * (1 - s) * (1 - front))
    col = grid_obj(name, P)
    orient_outward(col, (0, 0, z_neck - 0.12))
    sol = col.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.008
    sol.offset = -1.0
    bo.apply_modifiers(col)
    refine(col, 1)
    Q = coords(col)
    apply_field(col, lumps(Q, 30.0, 0.0012, 8))
    if mat is not None:
        bo.assign(col, mat)
    return col


def stand_collar(C, mat, height=0.04, gap=8.0):
    b = C.b
    k, g = b.k, b.g
    nt = 64
    angs = np.linspace(gap, 360 - gap, nt)
    rows = [(0.0, 0.102 * g), (height * 0.3, 0.1 * g), (height, 0.096 * g)]
    P = np.zeros((len(rows), nt, 3))
    z0 = 0.84 * k
    for i, (dz, rad) in enumerate(rows):
        for j, a in enumerate(angs):
            ar = math.radians(a)
            P[i, j] = (math.sin(ar) * rad, 0.006 - math.cos(ar) * rad * 1.02, z0 + dz)
    col = grid_obj("stand", P)
    orient_outward(col, (0, 0, z0))
    sol = col.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.008
    sol.offset = -1.0
    bo.apply_modifiers(col)
    refine(col, 2)
    bo.assign(col, mat)
    return col


def torso_fold_field(P, prof, rng, k, amp=1.0, drag=4, hem_folds=12, hem_z=None, back=3):
    D = np.zeros(len(P))
    hz = prof.z[0] if hem_z is None else hem_z
    for side in (1, -1):
        for j in range(drag):
            th0 = -30 + j * 15 + rng.uniform(-5, 5)
            th0 = th0 if side > 0 else 180 - th0
            th1 = th0 - side * (40 + rng.uniform(-10, 14))
            z0, z1 = (0.74 - j * 0.02) * k, (0.56 - j * 0.015 + rng.uniform(-0.01, 0.01)) * k
            pts = np.array([prof.point(th0 + (th1 - th0) * t, float(z0 + (z1 - z0) * t)) for t in np.linspace(0, 1, 7)])
            D += crease_field(P, snap_pts(P, pts), 0.012, 0.0085 * amp)
        for j in range(back):
            th0, th1 = 90 - side * (58 - j * 8), 90 - side * (14 + j * 6)
            z0, z1 = (0.74 - j * 0.035) * k, (0.56 - j * 0.02) * k
            pts = np.array([prof.point(th0 + (th1 - th0) * t, float(z0 + (z1 - z0) * t)) for t in np.linspace(0, 1, 7)])
            D += crease_field(P, snap_pts(P, pts), 0.013, 0.0085 * amp)
    for j in range(hem_folds):
        th = rng.uniform(0, 360)
        z0 = hz + rng.uniform(0.006, 0.03)
        pts = np.array([prof.point(th + i * 2.5, float(z0 + i * 0.016 * k)) for i in range(5)])
        D += crease_field(P, snap_pts(P, pts), 0.01, 0.009 * amp)
    return D


def garment_top(C, mat, sleeve="short", hem=0.47, seed=1, amp=1.0, loose=1.0, belly=0.0, flare=0.0, vox=0.0046, placket=True, pocket=True, button="#E8E4D8", rad=1.0, name="shirt", hem_fold=True, buttons=6, placket_col=None, attr_col=None, drape=0):
    """Shirt, tee or tunic as one seamless sculpted piece with real seams and stamped detail."""
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    prof = top_profile(b, hem, loose, belly, flare)
    pieces = [stacked_torso(name + "_t", prof)]
    limbs = {}
    if sleeve != "none":
        for side in (1, -1):
            o, L = sleeve_tube(b, side, sleeve, rad)
            pieces.append(o)
            limbs[side] = L
    top = union(name, pieces, vox, 5, 0.6)
    P = coords(top)
    D = torso_fold_field(P, prof, rng, k, amp, hem_z=hem * k if hem > 0.44 else None)
    D += lumps(P, 6.5, 0.0045 * amp, 3)
    for side, L in limbs.items():
        for tc, ts, cnt, arc, sl, w, d in ((0.2, 0.09, 3, 75, 0.3, 0.01, 0.009), (0.5, 0.1, 4, 90, 0.26, 0.01, 0.011), (0.78, 0.1, 3, 90, 0.2, 0.009, 0.009)):
            if sleeve == "short" and tc > 0.6:
                continue
            for c in L.scatter(rng, tc, ts, cnt, arc, sl, w, d * amp, a_c=0, a_s=170):
                D += crease_field(P, c[0], c[1], c[2], c[3])
        vv, ang, rr = L.uv(P)
        on = rr < 0.125
        D -= 0.0026 * np.exp(-(((vv - 0.075) / 0.0026) ** 2)) * on * (P[:, 0] * side > 0.11)
        if sleeve == "long":
            cuff = sstep(L.length * 0.93, L.length * 0.936, vv) * (rr < 0.075) * (P[:, 0] * side > 0.2)
            D -= 0.002 * np.exp(-(((vv - L.length * 0.93) / 0.0026) ** 2)) * (P[:, 0] * side > 0.2) * (rr < 0.09)
        else:
            end = L.length
            D -= 0.0012 * np.exp(-(((vv - end * 0.93) / 0.0018) ** 2)) * (P[:, 0] * side > 0.2) * (rr < 0.09)
    u, v, a = prof.uv(P)
    in_t = np.abs(P[:, 0]) < 0.22 * g
    # Hem and centre placket.
    D -= 0.0018 * np.exp(-(((P[:, 2] - (prof.z[0] + 0.014)) / 0.002) ** 2)) * in_t
    if drape:
        # Long skirt folds on a panjabi: hang straight, deeper toward the hem.
        for j in range(drape):
            th = rng.uniform(0, 360)
            z0, z1 = prof.z[0] + 0.005, (0.42 + rng.uniform(-0.03, 0.08)) * k
            pts = np.array([prof.point(th + rng.uniform(-3, 3), float(z0 + (z1 - z0) * t)) for t in np.linspace(0, 1, 6)])
            D += crease_field(P, snap_pts(P, pts), 0.013, 0.012 * amp, lobes=0.75)
    front = (np.abs(a) < PI / 2) & in_t
    if placket:
        pl = rrect_sdf(u, P[:, 2], 0.0, (prof.z[-1] * 0.5 + prof.z[0] * 0.5), 0.016, (prof.z[-1] - prof.z[0]) * 0.5, 0.002)
        D += stamp(pl, 0.0024, 0.0024, 0.0016, 0.0016) * front
        D += stitch_row(pl, 0.003, P[:, 2], 0.006, 0.0005) * front
    if pocket:
        pk = rrect_sdf(u, P[:, 2], 0.082, 0.69 * k, 0.04, 0.046, 0.005)
        D += stamp(pk, 0.0034, 0.004, 0.0018, 0.002) * front
        D += stitch_row(pk, 0.003, P[:, 2] + u, 0.006, 0.0005) * front
        pkf = rrect_sdf(u, P[:, 2], 0.082, 0.725 * k, 0.042, 0.012, 0.004)
        D += stamp(pkf, 0.0022, 0.002, 0.0014, 0.0016) * front
    apply_field(top, D)
    # Cloth UV for woven patterns: pattern runs around the torso and along each sleeve.
    Q = coords(top)
    u2, v2, a2 = prof.uv(Q)
    U, V = u2.copy(), Q[:, 2].copy()
    for side, L in limbs.items():
        vv, ang, rr = L.uv(Q)
        m = (rr < 0.13) & (Q[:, 0] * side > 0.13 * g) & (vv > 0.07)
        U[m] = ang[m] * 0.08 + 1.0
        V[m] = vv[m] + 2.0
    set_uv(top, U, V)
    if attr_col is not None:
        set_col(top, attr_col(Q, a2, u2))
    bo.assign(top, mat)
    btn = None
    if placket and buttons:
        items = []
        zs = np.linspace(0.8 * k, max(prof.z[0] + 0.05, 0.5 * k), buttons)
        for z in zs:
            pos = prof.point(-90.0, float(z), 0.0)
            items.append(bo.cylinder("btn", 0.0072, 0.0035, 12, loc=(float(pos[0]), float(pos[1]) - 0.006, float(z)), rot=(PI / 2, 0, 0)))
        for it in items:
            refine(it, 1)
        btn = bo.join(items, "buttons")
        btn.data.shade_smooth()
        bo.assign(btn, mat_gloss("button", lin(button), 0.32))
    return top, prof, limbs, btn


def bare_arm(C, side, skin_mat, kind="short"):
    b = C.b
    sfx = "L" if side > 0 else "R"
    d = b.arm_dir * np.array([side, 1, 1])
    sh = np.array(b.bones[f"upperarm.{sfx}"][0])
    L = b.up_len + b.fo_len
    start = 0.12 if kind == "short" else 0.2
    ts = [start, start + 0.05, b.up_len, b.up_len + 0.06, L - 0.03, L + 0.012]
    rs = [0.051, 0.053, 0.05, 0.05, 0.039, 0.037]
    arm = tube(f"arm{sfx}", [sh + d * t for t in ts], rs, segs=16, n=4)
    arm = voxel(arm, 0.0032, 2, 0.5)
    apply_field(arm, lumps(coords(arm), 14.0, 0.0014, 2))
    bo.assign(arm, skin_mat)
    return arm


def bare_leg(C, side, skin_mat, z_top=None):
    b = C.b
    x = side * b.hip_x
    k = b.k
    top = z_top if z_top is not None else 0.42 * k
    leg = tube(f"barelg{side}", [(x, 0, top), (x, 0, b.knee + 0.05), (x, 0.0, b.knee), (x, 0.002, b.knee - 0.06), (x, 0.004, b.ankle + 0.03), (x, 0.002, b.ankle - 0.03)], [0.068, 0.062, 0.059, 0.061, 0.05, 0.049], segs=18, n=4)
    leg = voxel(leg, 0.0032, 2, 0.5)
    apply_field(leg, lumps(coords(leg), 14.0, 0.0016, 2))
    bo.assign(leg, skin_mat)
    return leg


def bare_foot(C, side, skin_mat):
    """Chubby foot with a big toe and three soft toes, sitting in a sandal."""
    b = C.b
    x0 = side * b.hip_x
    sole = 0.022
    foot = tube("foot", [(x0, 0.078, 0.046 + sole), (x0, 0.052, 0.054 + sole), (x0, -0.01, 0.05 + sole), (x0, -0.07, 0.035 + sole), (x0, -0.132, 0.025 + sole), (x0, -0.154, 0.021 + sole)], [(0.034, 0.046), (0.044, 0.05), (0.046, 0.055), (0.033, 0.061), (0.022, 0.062), (0.01, 0.044)], segs=24, n=4, ref=(0, 0, 1))
    pieces = [foot]
    # Ankle stub up into the leg.
    pieces.append(tube("ank", [(x0, 0.018, 0.05), (x0, 0.012, b.ankle), (x0, 0.008, b.ankle + 0.05)], [0.047, 0.046, 0.046], segs=16, n=3))
    toes = [(-side * 0.038, 0.0205, 0.028), (-side * 0.007, 0.0165, 0.025), (side * 0.021, 0.0155, 0.021), (side * 0.047, 0.014, 0.017)]
    for i, (dx, r, ln) in enumerate(toes):
        pieces.append(capsule(f"toe{i}", (x0 + dx, -0.128, 0.021 + sole), (x0 + dx * 1.1, -0.142 - ln, 0.02 + sole), r, r * 0.95, segs=12, rings=3))
    obj = union("barefoot", pieces, 0.0028, 4, 0.55)
    apply_field(obj, lumps(coords(obj), 25.0, 0.001, 3))
    bo.assign(obj, skin_mat)
    return obj


def foot_outline(s, W=0.076):
    s = np.asarray(s, float)
    body = np.interp(s, [0.0, 0.14, 0.32, 0.6, 0.78, 0.92, 1.0], [0.62, 0.8, 0.82, 1.0, 1.0, 0.84, 0.5]) * W
    heel = np.sqrt(np.clip(1 - (np.clip(0.08 - s, 0, None) / 0.08) ** 2, 0.0, 1))
    toe = np.sqrt(np.clip(1 - (np.clip(s - 0.86, 0, None) / 0.14) ** 2, 0.0, 1))
    return body * heel * toe + 1e-4


def sandal(C, side, style="two", color="#6B4426", sole="#3A2A1E", strap=None):
    """style 'thong' is the rubber flip-flop; 'two' is the two-strap leather chappal."""
    b = C.b
    x0 = side * b.hip_x
    L = 0.27
    y_h, W = 0.098, 0.074
    ss = np.concatenate([np.linspace(0, 0.1, 6), np.linspace(0.12, 0.88, 22), np.linspace(0.9, 1.0, 8)])
    sn = 32
    S = np.zeros((len(ss), sn, 3))
    for i, s in enumerate(ss):
        w = foot_outline(s, W)
        for j in range(sn):
            a = 2 * PI * j / sn
            c, si = math.cos(a), math.sin(a)
            S[i, j] = (x0 + np.sign(c) * abs(c) ** 0.5 * w, y_h - L * s, 0.012 + np.sign(si) * abs(si) ** 0.3 * 0.012)
    so = grid_obj("sandal_sole", S, close_u=True, cap_start=True, cap_end=True)
    so = voxel(so, 0.0024, 2, 0.5)
    Q = coords(so)
    D = -0.0011 * np.exp(-(((Q[:, 2] - 0.012) / 0.0018) ** 2))
    top_mask = sstep(0.02, 0.023, Q[:, 2])
    fp = np.exp(-(((np.abs(Q[:, 0] - x0)) / 0.036) ** 2)) * top_mask * 0.0014
    D -= fp
    D -= 0.0008 * sstep(0.6, 1.0, np.sin(Q[:, 1] * 620.0)) * sstep(0.004, 0.0, Q[:, 2])
    apply_field(so, D)
    col = np.tile(np.array(lin(sole)), (len(Q), 1))
    col = mixc(col, np.array(lin(color)), sstep(0.016, 0.022, Q[:, 2]))
    col = col * (0.82 + 0.34 * fbm(Q, 36.0, 3, 4))[:, None]
    dirt = sstep(0.55, 0.75, fbm(Q, 12.0, 3, 8))
    col = mixc(col, np.array(lin("#7A6A58")), dirt * 0.16)
    set_col(so, col)
    bo.assign(so, mat_attr("sandal_sole", 0.8, 300.0, 0.18, "noise", 0.0008))
    # Straps.
    straps = []
    strap_col = lin(strap or color)
    if style == "thong":
        post = np.array((x0 - side * 0.02, -0.112, 0.024))
        for sg in (1, -1):
            pts = [post + np.array((0, 0, 0.036)), np.array((x0 + sg * 0.03 - side * 0.008, -0.066, 0.09)), np.array((x0 + sg * 0.058, -0.022, 0.074)), np.array((x0 + sg * 0.066, 0.016, 0.024))]
            straps.append(tube("thong", pts, [(0.0052, 0.012), (0.0052, 0.013), (0.0052, 0.012), (0.0052, 0.01)], segs=8, n=4, ref=(0, 0, 1), power=2.4))
        straps.append(tube("post", [post, post + np.array((0, 0, 0.036))], [0.0042, 0.0042], segs=6, n=1))
    else:
        for yy, height, wide in ((-0.068, 0.1, 0.02), (0.006, 0.128, 0.017)):
            hw = 0.069
            pts = [(x0 + hw * math.cos(a), yy, 0.02 + (height - 0.02) * math.sin(a)) for a in np.linspace(0, PI, 7)]
            straps.append(tube("strapb", pts, [(wide, 0.0042)] * 7, segs=8, n=3, ref=(0, 1, 0), power=2.6))
    st = bo.join(straps, "sandal_straps")
    refine(st, 1)
    Q = coords(st)
    col = np.tile(np.array(strap_col), (len(Q), 1)) * (0.82 + 0.36 * fbm(Q, 45.0, 3, 5))[:, None]
    set_col(st, col)
    bo.assign(st, mat_attr("sandal_strap", 0.6, 340.0, 0.18, "noise", 0.0007))
    bone = "foot.L" if side > 0 else "foot.R"
    return [(so, 210, bone), (st, 120, bone)]


def formal_shoe(C, side, color="#0E0E10", boot=False):
    """Polished derby, or a military-style boot with a raised shaft and a chunky tread."""
    b = C.b
    x0 = side * b.hip_x
    L = 0.292 if not boot else 0.305
    sh = ShoeShape(x0, L=L, W=0.07 if not boot else 0.076, heel=0.09, sole=0.03 if not boot else 0.042, collar=0.105 if not boot else 0.17, vamp=0.062 if not boot else 0.078, toe_h=0.058 if not boot else 0.068)
    ss = np.concatenate([np.linspace(0, 0.08, 7), np.linspace(0.09, 0.9, 30), np.linspace(0.91, 1.0, 10)])
    th = np.linspace(0, 360, 40, endpoint=False)
    P = np.array([[sh.upper_point(s, t, power=2.3) for t in th] for s in ss])
    upper = grid_obj("f_upper", P, close_u=True, cap_start=True, cap_end=True)
    collar = []
    for i in range(20):
        a = 2 * PI * i / 20
        collar.append((x0 + math.cos(a) * 0.058, sh.y(0.2) + math.sin(a) * 0.066, sh.collar + 0.002))
    roll = tube("f_roll", collar + collar[:2], [0.011] * 22, segs=8, n=2, ref=(0, 0, 1))
    upper = union("f_upper_v", [upper, roll], 0.0028, 4, 0.55)
    Q = coords(upper)
    s_q = np.clip((sh.heel - Q[:, 1]) / sh.L, 0, 1)
    rel = (Q[:, 2] - sh.sole) / np.maximum(sh.top(s_q) - sh.sole, 1e-3)
    across = np.abs(Q[:, 0] - x0) / np.maximum(sh.width(s_q), 1e-3)
    D = np.zeros(len(Q))
    # Toe-cap seam, quarter seam and lacing throat as sewn creases.
    D -= 0.0012 * np.exp(-(((s_q - 0.76 - 0.03 * across * across) / 0.006) ** 2))
    D -= 0.001 * np.exp(-(((s_q - 0.36 + 0.14 * rel) / 0.006) ** 2))
    D += 0.0016 * sstep(0.34, 0.26, across) * sstep(0.42, 0.46, s_q) * sstep(0.7, 0.66, s_q)
    D += (fbm(Q, 40.0, 3, 4) - 0.5) * 0.0012
    col = np.tile(np.array(lin(color)), (len(Q), 1))
    col = col * (0.75 + 0.5 * fbm(Q, 26.0, 3, 6))[:, None]
    apply_field(upper, D)
    set_col(upper, col)
    bo.assign(upper, mat_attr("leather_shoe", 0.26 if not boot else 0.38, 400.0, 0.06, "noise", 0.0006))
    # Sole.
    sn = 36
    so = np.zeros((len(ss), sn, 3))
    for i, s in enumerate(ss):
        w = sh.width(s) + 0.005
        for j in range(sn):
            a = 2 * PI * j / sn
            c, si = math.cos(a), math.sin(a)
            xx = np.sign(c) * abs(c) ** 0.42 * w
            zz = np.sign(si) * abs(si) ** 0.26
            heel_gap = 0.0 if s < 0.3 else 0.008 * sstep(0.28, 0.33, s) * (0.5 - 0.5 * zz) * sstep(0.68, 0.6, s)
            so[i, j] = (x0 + xx, sh.y(s), 0.5 * sh.sole + zz * 0.5 * sh.sole + heel_gap)
    sole = grid_obj("f_sole", so, close_u=True, cap_start=True, cap_end=True)
    sole = voxel(sole, 0.0024, 2, 0.5)
    Q = coords(sole)
    D = np.zeros(len(Q))
    if boot:
        D -= 0.0024 * sstep(0.2, 0.7, np.cos(2 * PI * Q[:, 1] / 0.016)) * sstep(sh.sole * 0.5, sh.sole * 0.3, Q[:, 2])
    apply_field(sole, D)
    col = np.tile(np.array(lin("#141214" if not boot else "#0C0C0E")), (len(Q), 1))
    if not boot:
        col = mixc(col, np.array(lin("#3A2A1C")), sstep(0.65, 0.95, Q[:, 2] / sh.sole))
    set_col(sole, col)
    bo.assign(sole, mat_attr("shoe_tread", 0.7, 300.0, 0.14, "noise", 0.0008))
    # Laces.
    bars = []
    rows = np.linspace(0.67, 0.44, 4 if not boot else 6)
    for i, s in enumerate(rows):
        pts = [sh.upper_point(float(s), t, 0.0028, power=2.3) for t in np.linspace(90 - 22, 90 + 22, 5)]
        bars.append(tube(f"f_lace{i}", pts, [(0.0028, 0.0018)] * 5, segs=6, n=2, ref=(0, 1, 0)))
    laces = bo.join(bars, "f_laces")
    refine(laces, 1)
    set_col(laces, np.tile(np.array(lin("#1A1A1C")), (len(laces.data.vertices), 1)))
    bo.assign(laces, mat_attr("f_lace", 0.8))
    bone = "foot.L" if side > 0 else "foot.R"
    return [(upper, 480, bone), (sole, 180, bone), (laces, 70, bone)]


def trousers(C, mat, style="dress", cuff=None, seed=31, amp=1.0, waist=0.595, vox=0.0046, attr=None, top_cut=None):
    """Legs and seat in one piece. style: dress, cargo, rolled (ends at the shin), pajama."""
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    cuff_z = cuff if cuff is not None else {"dress": 0.094, "cargo": 0.098, "rolled": 0.205, "pajama": 0.098}[style]
    r_table = {
        "dress": [(0.092, 0.09), (0.095, 0.09), (0.094, 0.088), (0.086, 0.08), (0.078, 0.074), (0.074, 0.072), (0.074, 0.07), (0.07, 0.066)],
        "cargo": [(0.1, 0.096), (0.104, 0.094), (0.106, 0.092), (0.102, 0.09), (0.095, 0.086), (0.095, 0.088), (0.091, 0.084), (0.084, 0.078)],
        "rolled": [(0.097, 0.092), (0.1, 0.09), (0.098, 0.088), (0.092, 0.084), (0.088, 0.08), (0.086, 0.08), (0.088, 0.08), (0.086, 0.078)],
        "pajama": [(0.102, 0.098), (0.106, 0.098), (0.108, 0.096), (0.106, 0.094), (0.102, 0.092), (0.096, 0.088), (0.09, 0.082), (0.072, 0.066)],
    }[style]
    x = b.hip_x
    pieces, limbs = [], {}
    z_rows = [0.52, 0.46, 0.385, 0.29, 0.2, 0.135, cuff_z + 0.006, cuff_z]
    if style == "rolled":
        z_rows = [0.52, 0.46, 0.4, 0.34, 0.29, 0.25, cuff_z + 0.006, cuff_z]
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        ctrl = [(side * x * m, 0.0, z * k) for m, z in zip((0.86, 0.98, 1.02, 1.0, 1.02, 1.04, 1.04, 1.04), z_rows)]
        rad = [(a * g, c * g) for a, c in r_table]
        pieces.append(tube(f"leg{sfx}", ctrl, rad, segs=28, n=6))
        limbs[side] = Limb(ctrl, rad)
    pelvis = tube("pelvis", [(0, 0, 0.445 * k), (0, 0, 0.47 * k), (0, 0, 0.52 * k), (0, 0, (waist - 0.02) * k), (0, 0, waist * k)], [(0.09, 0.12), (0.112, 0.16), (0.122, 0.17), (0.124, 0.17), (0.116, 0.162)], segs=30, n=4, power=2.2)
    pieces.append(pelvis)
    pants = union("trousers", pieces, vox, 5, 0.6)
    P = coords(pants)
    D = np.zeros(len(P))
    knee_t = (0.385 - 0.29) / (0.52 - cuff_z) + 0.3
    for side, L in limbs.items():
        vv, ang, rr = L.uv(P)
        on = (P[:, 0] * side > 0) & (rr < 0.17)
        total = L.length
        for tc, ts, cnt, arc, sl, w, d in ((0.44, 0.07, 6, 120, 0.1, 0.012, 0.012), (0.84, 0.06, 7, 130, 0.05, 0.011, 0.012), (0.2, 0.06, 4, 80, 0.16, 0.012, 0.01), (0.64, 0.06, 3, 80, 0.14, 0.012, 0.009)):
            scale = {"dress": 0.55, "cargo": 1.0, "rolled": 0.85, "pajama": 1.0}[style]
            for c in L.scatter(rng, tc, ts, cnt, arc, sl, w, d * amp * scale, a_c=0, a_s=175):
                D += crease_field(P, c[0], c[1], c[2], c[3])
        ang_outer = -PI / 2 * side
        seam = np.abs(((ang - ang_outer + PI) % (2 * PI)) - PI) * 0.09
        D -= 0.0016 * np.exp(-((seam / 0.0026) ** 2)) * on
        if style == "dress":
            # Pressed front crease.
            front_d = np.abs(((ang + PI) % (2 * PI)) - PI) * 0.08
            D += 0.0022 * np.exp(-((front_d / 0.0035) ** 2)) * on * sstep(total * 0.12, total * 0.22, vv)
        if style == "cargo":
            pu = ((ang - ang_outer + PI) % (2 * PI) - PI) * 0.095
            pad = rrect_sdf(pu, vv, 0.0, total * 0.46, 0.058, 0.07, 0.008)
            D += stamp(pad, 0.016, 0.012, 0.0045, 0.003) * on
            D += stitch_row(pad, 0.0045, vv + pu, 0.008, 0.0006) * on
            flap = rrect_sdf(pu, vv, 0.0, total * 0.46 - 0.056, 0.063, 0.025, 0.006)
            D += stamp(flap, 0.0085, 0.004, 0.0045, 0.0028) * on
        if style == "rolled":
            # Thick turned-up cuff.
            roll = sstep(total * 0.84, total * 0.85, vv)
            D += 0.012 * roll * on - 0.004 * np.exp(-(((vv - total * 0.845) / 0.0035) ** 2)) * on
            D -= 0.0018 * np.exp(-(((vv - total * 0.93) / 0.0024) ** 2)) * on
            D += (fbm(P, 60.0, 2, 4) - 0.5) * 0.0028 * roll * on
        if style == "pajama":
            gather = sstep(total * 0.86, total * 0.93, vv)
            D += ribs(ang * 0.07, gather * on, 0.012, 0.004)
        if style == "dress":
            D -= 0.0014 * np.exp(-(((vv - total * 0.968) / 0.002) ** 2)) * on
    D += lumps(P, 6.5, 0.0045 * amp, 7)
    D *= 1.0 - 0.85 * sstep(0.036, 0.012, np.abs(P[:, 0])) * sstep(0.445 * k, 0.42 * k, P[:, 2])
    D -= 0.0016 * np.exp(-((np.abs(P[:, 0]) / 0.003) ** 2)) * (P[:, 1] < 0) * (P[:, 2] > 0.44 * k) * (P[:, 2] < waist * k)
    # Waistband line.
    wb_z = (waist - 0.04) * k
    D -= 0.0022 * np.exp(-(((P[:, 2] - wb_z) / 0.0024) ** 2)) * (np.abs(P[:, 0]) < 0.2 * g)
    apply_field(pants, D)
    if top_cut:
        # Worn under a long tunic: the hidden top is removed so a stride cannot push it through.
        bm = bmesh.new()
        bm.from_mesh(pants.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > top_cut * k], context="VERTS")
        bm.to_mesh(pants.data)
        bm.free()
        pants.data.update()
    if attr is not None:
        set_col(pants, attr(coords(pants)))
    bo.assign(pants, mat)
    return pants, limbs


def belt(C, z, color="#1A1412", buckle="#A9ACB0"):
    b = C.b
    k, g = b.k, b.g
    rx, ry = 0.17 * g, 0.127 * g
    pts = [(math.cos(a) * (rx + 0.002), math.sin(a) * (ry + 0.002), z * k) for a in np.linspace(0, 2 * PI, 22)]
    bl = tube("belt", pts, [(0.016, 0.0034)] * 22, segs=8, n=2, ref=(0, 0, 1), power=3.0)
    refine(bl, 1)
    Q = coords(bl)
    apply_field(bl, (fbm(Q, 60.0, 2, 3) - 0.5) * 0.001)
    bo.assign(bl, mat_cloth("belt_leather", lin(color), 0.42, 420.0, 0.2, 0.15, 0.0))
    bk = rounded_box("belt_buckle", (0.044, 0.008, 0.034), 0.0035, loc=(0.0, -(ry + 0.006), z * k))
    bo.assign(bk, mat_gloss("belt_metal", lin(buckle), 0.3, 1.0))
    return bl, bk


def lungi(C, stops, pitch=0.11, hem=0.17, seed=5, wide=1.0, attr_top=0.585):
    """Wrapped tube of checked cotton: long vertical folds, the diagonal pull of the wrap,
    weighted between hips and both thighs by `skirt_weights`."""
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    rows = [
        (attr_top, 0.14, 0.108, 0.0),
        (0.52, 0.146, 0.112, 0.0),
        (0.46, 0.152, 0.118, 0.0),
        (0.41, 0.17, 0.132, 0.0),
        (0.34, 0.19 * wide, 0.15 * wide, 0.0),
        (0.25, 0.204 * wide, 0.164 * wide, 0.0),
        (hem, 0.212 * wide, 0.168 * wide, 0.0),
    ]
    prof = Profile([(z * k, a * g, c * g, d) for z, a, c, d in rows], power=2.15)
    nz, nth = 90, 180
    zs = np.linspace(prof.z[0], prof.z[-1], nz)
    th = np.linspace(0, 360, nth, endpoint=False)
    t = np.radians(th)
    rx, ry, cy = prof.at(zs)
    P = np.zeros((nz, nth, 3))
    e = 2.0 / prof.power
    c = np.sign(np.cos(t)) * np.abs(np.cos(t)) ** e
    s = np.sign(np.sin(t)) * np.abs(np.sin(t)) ** e
    P[..., 0] = c[None, :] * rx[:, None]
    P[..., 1] = cy[:, None] + s[None, :] * ry[:, None]
    P[..., 2] = zs[:, None]
    # Wavy hem; a little longer at the back, shorter where the wrap overlaps at the front.
    hemw = (np.sin(t * 5 + 1.0) * 0.006 + np.sin(t * 11 + 0.3) * 0.0035 + (-np.sin(t)) * -0.006)
    P[0, :, 2] += hemw
    fall = np.linspace(1, 0, nz) ** 3
    P[..., 2] += fall[:, None] * hemw[None, :]
    # Bottom row first in zs order, top last; rows run hem to waist.
    obj = grid_obj("lungi", P, close_u=True, cap_start=False, cap_end=True)
    orient_outward(obj, (0, 0, 0.4 * k))
    lo = dup_clean(obj, "lungi_lo")
    lo.hide_render = True
    Q = coords(obj)
    N = vnormals(obj)
    D = np.zeros(len(Q))
    # Long hanging folds, deepest at the hem.
    for j in range(24):
        a = rng.uniform(0, 360)
        z0, z1 = prof.z[0] + 0.004, rng.uniform(0.36, 0.56) * k
        pts = np.array([prof.point(a + rng.uniform(-2.5, 2.5), float(z0 + (z1 - z0) * x)) for x in np.linspace(0, 1, 6)])
        D += crease_field(Q, pts, rng.uniform(0.013, 0.021), rng.uniform(0.012, 0.021), lobes=0.8)
    # Diagonal pull from the waist knot.
    for j in range(7):
        a0 = -90 + rng.uniform(-12, 12)
        a1 = a0 + rng.uniform(40, 90) * (1 if j % 2 else -1)
        z0, z1 = 0.55 * k, rng.uniform(0.36, 0.45) * k
        pts = np.array([prof.point(a0 + (a1 - a0) * x, float(z0 + (z1 - z0) * x)) for x in np.linspace(0, 1, 6)])
        D += crease_field(Q, pts, 0.012, 0.01)
    D += lumps(Q, 7.0, 0.006, 2)
    # Rolled, stitched hem.
    hem_z = prof.z[0]
    D += 0.0026 * sstep(hem_z + 0.024, hem_z + 0.018, Q[:, 2])
    D -= 0.0016 * np.exp(-(((Q[:, 2] - (hem_z + 0.024)) / 0.0024) ** 2))
    set_coords(obj, Q + N * D[:, None])
    u, v, a = prof.uv(Q)
    # Wrap overlap: one straight vertical edge just right of front, the cloth tucks under it.
    edge_u = 0.05 * g
    Q2 = coords(obj)
    u2, v2, a2 = prof.uv(Q2)
    D2 = 0.0032 * sstep(edge_u + 0.008, edge_u - 0.006, u2) * (np.abs(a2) < 1.2) - 0.0025 * np.exp(-(((u2 - edge_u) / 0.0032) ** 2)) * (np.abs(a2) < 1.2)
    apply_field(obj, D2)
    set_uv(obj, u2 + 3.0, Q2[:, 2])
    sol = obj.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.005
    sol.offset = -1.0
    sol.use_rim = True
    bo.apply_modifiers(obj)
    obj.data.shade_smooth()
    bo.assign(obj, mat_plaid("lungi_cotton", stops, pitch, 0.9, 0.3, 340.0, 0.2, 0.06))
    # Low-poly follows the sculpted folds but stays clean: same grid, softened.
    Q3 = coords(obj)[: len(lo.data.vertices)]
    set_coords(lo, Q3)
    return obj, lo, prof


def neck_wrap(C, stops, pitch=0.022, drop_l=0.2, drop_r=0.12, ring=0.15, thick=0.03, width=0.05, seed=2, fringe=True, name="gamcha", z_ring=0.835, flat=False, spread=0.0):
    """Gamcha or scarf: a bulky loop round the neck and two ends down the chest."""
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    z0 = z_ring * k
    parts = []
    combs = []
    loops = 1 if flat else 2
    for i in range(loops):
        pts = []
        wob = (i * 1.7, i * 0.9)
        for a in np.linspace(0, 2 * PI, 20):
            r = ring * g * (1 + 0.04 * math.sin(a * 3 + wob[0]))
            z = z0 + 0.013 * math.sin(a * 2 + wob[1]) + i * 0.012
            # Sits over the shoulders, lower at the front.
            pts.append((math.cos(a) * r * 1.04, math.sin(a) * r * 0.98 + 0.008, z - 0.02 * max(0.0, -math.sin(a)) ** 2))
        wid = thick * (1.0 - 0.12 * i)
        parts.append(cloth_strip(f"{name}_loop{i}", pts, [(wid, wid * 0.78)] * len(pts), segs=14, n=3, ref=(0, 0, 1)))
    # Two ends hanging down the chest.
    for sign, drop in ((1, drop_l), (-1, drop_r)):
        if drop <= 0:
            continue
        x0 = sign * (0.078 + spread) * g
        y0 = -(0.112 - spread * 0.55) * g
        path = [
            (x0 * 0.9, y0 + 0.012, z0 + 0.0),
            (x0 * 1.02, y0 - 0.012, z0 - 0.05),
            (x0 * 1.04, y0 - 0.026, z0 - drop * 0.55),
            (x0 * 1.03 + sign * 0.004, y0 - 0.03, z0 - drop),
        ]
        wd = [(thick * 0.8, 0.012), (width * 0.86, 0.0095), (width, 0.0075), (width * 1.04, 0.0065)]
        parts.append(cloth_strip(f"{name}_end{sign}", path, wd, segs=14, n=5, ref=(1, 0, 0), power=2.4))
        if fringe:
            zb = z0 - drop
            cx = x0 * 1.03 + sign * 0.004
            yy = y0 - 0.03
            hw = width * 1.0
            teeth = 7
            verts, faces = [], []
            for i in range(teeth + 1):
                xx = cx - hw + 2 * hw * i / teeth
                verts.append((xx, yy, zb + 0.006))
                verts.append((xx, yy - 0.0005, zb - 0.004))
            for i in range(teeth):
                a, c, b2, d = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
                faces.append((a, c, d, b2))
                tip = len(verts)
                xx = cx - hw + 2 * hw * (i + 0.5) / teeth + rng.uniform(-0.002, 0.002)
                verts.append((xx, yy - 0.001, zb - 0.022 - rng.uniform(0.0, 0.009)))
                faces.append((c, tip, d))
            comb = bo.new_mesh_object(f"{name}_comb{sign}", verts, faces)
            orient_outward(comb, (cx, yy + 0.2, zb))
            Qc = coords(comb)
            set_uv(comb, Qc[:, 2], Qc[:, 0])
            combs.append(comb)
    obj = bo.join(parts, name)
    refine(obj, 1)
    Q = coords(obj)
    D = lumps(Q, 24.0, 0.003, seed)
    for j in range(22):
        a = rng.uniform(0, 2 * PI)
        r = ring * g + thick * 0.6
        z = z0 + rng.uniform(-0.03, 0.03)
        pts = np.array([[math.cos(a + i * 0.1) * r, math.sin(a + i * 0.1) * r, z + i * 0.005 * (1 if j % 2 else -1)] for i in range(5)])
        D += crease_field(Q, snap_pts(Q, pts, 3), 0.007, 0.006, lobes=0.5)
    for sign, drop in ((1, drop_l), (-1, drop_r)):
        if drop <= 0:
            continue
        for j in range(5):
            xx = sign * 0.08 * g + rng.uniform(-0.03, 0.03)
            z1 = z0 - rng.uniform(0.04, 0.1)
            pts = np.array([[xx + i * 0.002, -0.14 * g, z1 - i * drop * 0.14] for i in range(6)])
            D += crease_field(Q, snap_pts(Q, pts, 3), 0.0075, 0.0052, lobes=0.6)
    apply_field(obj, D)
    m_wrap = mat_plaid(name + "_cloth", stops, pitch, 0.9, 0.26, 340.0, 0.22, 0.05)
    bo.assign(obj, m_wrap)
    comb = None
    if combs:
        comb = bo.join(combs, name + "_fringe")
        bo.assign(comb, m_wrap)
    return obj, comb


def shell_vest(C, base, mat, off=0.0075, gap_top=30.0, gap_bot=3.0, gap_z=0.6, hem=0.53, seed=9, name="vest", vox=0.0046, recess=0.03, amp=0.7):
    """Sleeveless garment worn over a shirt. Shaped from the shirt's own profile, open V front."""
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    zs_src = np.linspace(hem * k, base.z[-1] * 0.99, 8)
    rows = []
    for z in zs_src:
        rx, ry, cy = base.at(z)
        rows.append((z, max(rx, 0.172 * g) + off if z < 0.72 * k else rx + off, max(ry, 0.129 * g) + off if z < 0.72 * k else ry + off, cy))
    prof = Profile(rows, power=base.power)
    gap_fn = lambda z: float(np.interp(z, [hem * k, gap_z * k, 0.82 * k], [gap_bot, gap_bot, gap_top]))
    zs = np.linspace(prof.z[0], prof.z[-1], 36)
    rings = open_front_rings(prof, zs, gap_fn, recess=recess, n=56)
    obj = voxel(grid_obj(name + "_shell", rings, close_u=True, cap_start=True, cap_end=True), vox, 4, 0.6)
    P = coords(obj)
    D = torso_fold_field(P, prof, rng, k, amp, drag=3, hem_folds=8, hem_z=hem * k, back=2)
    D += lumps(P, 7.0, 0.004, seed)
    D -= 0.0018 * np.exp(-(((P[:, 2] - (prof.z[0] + 0.012)) / 0.002) ** 2))
    apply_field(obj, D)
    bo.assign(obj, mat)
    return obj, prof, gap_fn


def ribbon_on(prof, name, points, width, thick=0.0028, off=0.003, ref=(0, 0, 1), n=4):
    """Flat strip following a profile: points are (theta, z) pairs."""
    path = [prof.point(float(t), float(z), off) for t, z in points]
    return tube(name, path, [(width / 2, thick / 2)] * len(path), segs=8, n=n, ref=ref, power=3.5)


def apron(C, prof, color="#E2D3B6", seed=4):
    """Tea-stall apron: bib, skirt panel, neck strap and waist ties, stained and well used."""
    b = C.b
    k, g = b.k, b.g
    rng = np.random.RandomState(seed)
    nx, nz = 34, 56
    z_top, z_bot = 0.755 * k, 0.215 * k
    zs = np.linspace(z_bot, z_top, nz)
    P = np.zeros((nz, nx, 3))
    for i, z in enumerate(zs):
        t = (z - z_bot) / (z_top - z_bot)
        hw = float(np.interp(t, [0.0, 0.5, 0.62, 0.76, 1.0], [0.17, 0.165, 0.14, 0.092, 0.088])) * g
        rx, ry, cy = prof.at(max(z, prof.z[0]))
        for j, s in enumerate(np.linspace(-1, 1, nx)):
            x = s * hw
            sx = np.clip(x / (rx + 0.008), -0.99, 0.99)
            y = cy - (ry + 0.006) * (1 - abs(sx) ** 2.25) ** (1 / 2.25)
            below = max(0.0, (prof.z[0] + 0.03 - z))
            y = y - 0.014 - 0.10 * below + (0.01 * math.sin(s * 6 + z * 9)) * sstep(0.45, 0.1, t)
            P[i, j] = (x, y, z)
    panel = grid_obj("apron_panel", P)
    orient_outward(panel, (0, 0.2, 0.5 * k))
    Q = coords(panel)
    N = vnormals(panel)
    D = np.zeros(len(Q))
    for j in range(13):
        x = rng.uniform(-0.15, 0.15)
        z1 = rng.uniform(0.36, 0.5) * k
        pts = np.array([[x + rng.uniform(-0.006, 0.006) * i, 0.0, z_bot + (z1 - z_bot) * i / 5] for i in range(6)])
        pts[:, 1] = -0.2
        D += crease_field(Q, snap_pts(Q, pts, 2), 0.013, 0.013, lobes=0.7)
    D += lumps(Q, 9.0, 0.005, 3)
    # Tie gathers just under the waist, and a sewn hem around the edge.
    D -= 0.003 * np.exp(-(((Q[:, 2] - 0.545 * k) / 0.004) ** 2))
    set_coords(panel, Q + N * D[:, None])
    lo = dup_clean(panel, "apron_lo")
    lo.hide_render = True
    sol = panel.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.0046
    sol.offset = 0.0
    sol.use_rim = True
    bo.apply_modifiers(panel)
    refine(panel, 1)
    Q = coords(panel)
    n1 = fbm(Q, 8.0, 3, 1)
    n2 = fbm(Q, 26.0, 3, 2)
    n3 = fbm(Q, 70.0, 2, 3)
    col = np.tile(np.array(lin(color)), (len(Q), 1))
    col = col * (0.9 + 0.22 * n2)[:, None]
    # Tea stains: soft brown blooms with darker rims, plus grime low on the skirt.
    bloom = sstep(0.56, 0.66, n1 + (n2 - 0.5) * 0.28)
    rim = sstep(0.54, 0.585, n1 + (n2 - 0.5) * 0.28) * sstep(0.66, 0.595, n1 + (n2 - 0.5) * 0.28)
    col = mixc(col, np.array(lin("#AD8450")), bloom * 0.68)
    col = mixc(col, np.array(lin("#7A5428")), rim * 0.6)
    grime = sstep(0.34 * k, 0.215 * k, Q[:, 2]) * sstep(0.35, 0.6, n2)
    col = mixc(col, np.array(lin("#6E5B42")), grime * 0.45)
    spat = sstep(0.73, 0.79, n3) * sstep(0.46, 0.62, n1)
    col = mixc(col, np.array(lin("#5E3E1C")), spat * 0.62)
    set_col(panel, col)
    bo.assign(panel, mat_cloth("apron_canvas", None, 0.92, 300.0, 0.26, 0.02, 0.28, attr="col"))
    # Straps: over the neck and round the waist to a tied bow at the back.
    m_strap = mat_cloth("apron_strap", lin("#B8A583"), 0.9, 320.0, 0.3, 0.1, 0.0)
    pieces = []
    for sg in (1, -1):
        pts = [(sg * 0.08 * g, float(prof.point(-90 + sg * 30, float(z_top))[1]) - 0.008, z_top), (sg * 0.094 * g, -0.082 * g, 0.815 * k), (sg * 0.105 * g, -0.02 * g, 0.87 * k), (sg * 0.075 * g, 0.082 * g, 0.885 * k), (0.0, 0.105 * g, 0.89 * k)]
        pieces.append(tube("ap_neck", pts, [(0.0098, 0.0028)] * 5, segs=8, n=4, ref=(0, 0, 1), power=3.0))
    zb = 0.56 * k
    for sg in (1, -1):
        path = []
        for a in np.linspace(0, 90, 9):
            rx, ry, cy = prof.at(zb)
            ang = math.radians(a)
            path.append((sg * math.cos(ang) * (rx + 0.006), cy + math.sin(ang) * (ry + 0.006), zb))
        pieces.append(tube("ap_tie", path, [(0.0098, 0.0028)] * 9, segs=8, n=3, ref=(0, 0, 1), power=3.0))
    back = np.array([0.0, float(prof.at(zb)[1]) + 0.01, zb])
    for sg in (1, -1):
        pieces.append(tube("ap_bow", [back, back + np.array([sg * 0.03, 0.012, 0.012]), back + np.array([sg * 0.055, 0.005, 0.0]), back + np.array([sg * 0.03, 0.012, -0.012]), back], [0.006] * 5, segs=8, n=3))
        pieces.append(tube("ap_tail", [back, back + np.array([sg * 0.02, 0.012, -0.04]), back + np.array([sg * 0.03, 0.008, -0.09])], [(0.0095, 0.0026)] * 3, segs=8, n=3, ref=(1, 0, 0), power=3.0))
    straps = bo.join(pieces, "apron_straps")
    straps.data.shade_smooth()
    bo.assign(straps, m_strap)
    return panel, lo, straps


def backpack(C, body_col="#1B1D21", accent="#2A2D33"):
    b = C.b
    k, g = b.k, b.g
    Rm = Matrix.Translation((0, 0.205 * g, 0.655 * k))
    main = rounded_box("pack_main", (0.27 * g, 0.115, 0.32 * k), 0.052, matrix=Rm)
    pocket = rounded_box("pack_pocket", (0.2 * g, 0.042, 0.14 * k), 0.022, loc=(0, 0.072, -0.07 * k), matrix=Rm)
    top_h = tube("pack_handle", [(-0.03, 0.2 * g, 0.81 * k), (-0.024, 0.2 * g, 0.84 * k), (0.024, 0.2 * g, 0.84 * k), (0.03, 0.2 * g, 0.81 * k)], [(0.009, 0.0045)] * 4, segs=8, n=4, ref=(0, 1, 0))
    pack = union("backpack", [main, pocket, top_h], 0.0034, 2, 0.5)
    Q = coords(pack)
    L = Q - np.array([0, 0.205 * g, 0.655 * k])
    D = (fbm(Q, 16.0, 3, 3) - 0.5) * 0.006 + (fbm(Q, 120.0, 2, 4) - 0.5) * 0.001
    # Zip lines: one over the top of the main body, one across the pocket.
    D -= 0.002 * np.exp(-((L[:, 1] - 0.0) ** 2 / 0.0028**2)) * (L[:, 2] > 0.0)
    D -= 0.0018 * np.exp(-(((L[:, 2] - (-0.012 * k)) / 0.0022) ** 2)) * (L[:, 1] > 0.07)
    apply_field(pack, D)
    col = np.tile(np.array(lin(body_col)), (len(Q), 1)) * (0.8 + 0.5 * fbm(Q, 40.0, 3, 8))[:, None]
    col = mixc(col, np.array(lin(accent)), sstep(0.056, 0.06, L[:, 1]) * 0.7)
    set_col(pack, col)
    bo.assign(pack, mat_attr("pack_nylon", 0.68, 480.0, 0.26, "noise", 0.0008))
    straps = []
    for sg in (1, -1):
        pts = [
            (sg * 0.075 * g, 0.15 * g, 0.84 * k),
            (sg * 0.095 * g, 0.03 * g, 0.885 * k),
            (sg * 0.115 * g, -0.09 * g, 0.84 * k),
            (sg * 0.125 * g, -0.155 * g, 0.72 * k),
            (sg * 0.145 * g, -0.165 * g, 0.6 * k),
            (sg * 0.18 * g, -0.09 * g, 0.54 * k),
        ]
        straps.append(tube("pack_strap", pts, [(0.024, 0.006)] * 6, segs=10, n=4, ref=(1, 0, 0), power=3.0))
    st = bo.join(straps, "pack_straps")
    refine(st, 1)
    Q = coords(st)
    set_col(st, np.tile(np.array(lin(body_col)), (len(Q), 1)) * (0.82 + 0.4 * fbm(Q, 60.0, 2, 3))[:, None])
    bo.assign(st, mat_attr("pack_strap", 0.7, 520.0, 0.3, "noise", 0.0008))
    return pack, st


def side_bag(C, prof, side=-1, size=(0.26, 0.095, 0.2), z=0.47, color="#191A1D", strap_col="#111214", across=False, angle=-156.0, push=0.058, strap_w=0.022):
    """Shoulder bag on a long strap. across=True runs the strap over the opposite shoulder."""
    b = C.b
    k, g = b.k, b.g
    z_bag = z * k
    th = angle if side < 0 else -180 - angle
    anchor = prof.point(th, float(max(z_bag, prof.z[0])), push)
    anchor[2] = z_bag
    if abs(anchor[0]) < 0.17 * g:
        anchor[0] = side * 0.19 * g
    yaw = side * math.radians(62.0)
    Rm = Matrix.Translation(tuple(anchor)) @ Matrix.Rotation(yaw, 4, "Z")
    Rinv = Rm.inverted()
    sx, sy, sz = size
    main = rounded_box("sb_main", size, min(0.03, sy * 0.4), matrix=Rm)
    flap = rounded_box("sb_flap", (sx * 1.02, 0.014, sz * 0.62), 0.007, loc=(0, -sy / 2 - 0.002, sz * 0.19), matrix=Rm)
    bag = union("side_bag", [main, flap], 0.0032, 2, 0.5)
    Q = coords(bag)
    L = transformed(Q, Rinv)
    D = (fbm(Q, 20.0, 3, 15) - 0.5) * 0.0046 + (fbm(Q, 140.0, 3, 11) - 0.5) * 0.0011
    fl = rrect_sdf(L[:, 0], L[:, 2], 0.0, sz * 0.19, sx * 0.49, sz * 0.3, 0.008)
    D += stitch_row(fl, 0.006, L[:, 0] + L[:, 2], 0.009, 0.0007, 0.0015) * (L[:, 1] < -sy * 0.3)
    apply_field(bag, D)
    col = np.tile(np.array(lin(color)), (len(Q), 1)) * (0.78 + 0.5 * fbm(Q, 36.0, 3, 19))[:, None]
    set_col(bag, col)
    bo.assign(bag, mat_attr("sb_leather", 0.5, 420.0, 0.2, "noise", 0.001))
    hw_items = [
        rounded_box("sb_b1", (0.036, 0.008, 0.022), 0.003, loc=(-sx * 0.22, -sy / 2 - 0.012, sz * 0.0), matrix=Rm),
        rounded_box("sb_b2", (0.036, 0.008, 0.022), 0.003, loc=(sx * 0.22, -sy / 2 - 0.012, sz * 0.0), matrix=Rm),
        rounded_box("sb_r1", (0.02, 0.007, 0.024), 0.0028, loc=(-sx * 0.46, 0.0, sz * 0.5), matrix=Rm),
        rounded_box("sb_r2", (0.02, 0.007, 0.024), 0.0028, loc=(sx * 0.46, 0.0, sz * 0.5), matrix=Rm),
    ]
    hw = bo.join(hw_items, "sb_hw")
    hw.data.shade_smooth()
    bo.assign(hw, mat_gloss("sb_metal", lin("#8E9196"), 0.36, 1.0))
    # Strap.
    z_sh = 0.86 * k
    bag_top = np.array(Rm @ Vector((sx * 0.46 * (1 if side < 0 else -1), 0, sz * 0.5)))
    bag_top2 = np.array(Rm @ Vector((-sx * 0.46 * (1 if side < 0 else -1), 0, sz * 0.5)))
    shoulder_x = (-side if across else side) * 0.098 * g
    s_off = 0.012
    front, back = [], []
    front.append(bag_top)
    back.append(bag_top2)
    fth0 = -90 + (35 if shoulder_x > 0 else -35)
    bth0 = 90 - (35 if shoulder_x > 0 else -35)
    for t in np.linspace(0.14, 0.9, 7):
        zz = bag_top[2] + (z_sh - bag_top[2]) * t
        if across:
            th_ = (-90 + 62 * side) + (fth0 - (-90 + 62 * side)) * t
        else:
            th_ = (-90 + side * 72) + (fth0 - (-90 + side * 72)) * t
        front.append(prof.point(th_, float(min(zz, prof.z[-1] - 0.01)), s_off))
    for t in np.linspace(0.14, 0.9, 7):
        zz = bag_top2[2] + (z_sh - bag_top2[2]) * t
        if across:
            th_ = (90 - 62 * side) + (bth0 - (90 - 62 * side)) * t
        else:
            th_ = (90 - side * 72) + (bth0 - (90 - side * 72)) * t
        back.append(prof.point(th_, float(min(zz, prof.z[-1] - 0.01)), s_off))
    top = np.array([shoulder_x, 0.005, z_sh + 0.022])
    path = front + [top] + back[::-1]
    st = tube("sb_strap", path, [(strap_w, 0.0034)] * len(path), segs=8, n=3, ref=(0, 0, 1), power=3.2)
    refine(st, 1)
    bo.assign(st, mat_cloth("sb_webbing", lin(strap_col), 0.7, 500.0, 0.46, 0.06, 0.0))
    return bag, hw, st


def lanyard(C, prof, ribbon="#26476E"):
    """Neck ribbon and a blank ID card in a clear holder. No text, logo or photo."""
    b = C.b
    k, g = b.k, b.g
    card_z = 0.625 * k
    ctop = prof.point(-90.0, float(card_z + 0.055), 0.0)
    y0 = float(ctop[1]) - 0.012
    pieces = []
    for sg in (1, -1):
        path = [(sg * 0.082 * g, -0.03 * g, 0.872 * k), (sg * 0.09 * g, -0.082 * g, 0.84 * k), (sg * 0.055 * g, float(prof.at(0.76 * k)[1]) * -1.0 - 0.012, 0.76 * k), (sg * 0.012, y0, card_z + 0.082), (0.0, y0, card_z + 0.058)]
        pieces.append(tube("lany", path, [(0.0058, 0.0016)] * 5, segs=6, n=4, ref=(0, 0, 1), power=3.0))
    rib = bo.join(pieces, "lanyard")
    rib.data.shade_smooth()
    bo.assign(rib, mat_cloth("lanyard_ribbon", lin(ribbon), 0.6, 500.0, 0.2, 0.04, 0.0))
    holder = rounded_box("id_holder", (0.07, 0.005, 0.098), 0.0045, loc=(0.0, y0, card_z))
    Q = coords(holder)
    D = np.zeros(len(Q))
    apply_field(holder, D)
    col = np.tile(np.array(lin("#F2F1EC")), (len(Q), 1))
    # Blank card: plain coloured header band, nothing on it.
    head = sstep(card_z + 0.024, card_z + 0.028, Q[:, 2])
    col = mixc(col, np.array(lin(ribbon)), head)
    set_col(holder, col)
    bo.assign(holder, mat_attr("id_card", 0.2))
    clip = rounded_box("id_clip", (0.012, 0.006, 0.016), 0.002, loc=(0.0, y0, card_z + 0.056))
    bo.assign(clip, mat_gloss("clip_metal", lin("#A6A9AD"), 0.3, 1.0))
    return rib, holder, clip


def sweater_vest(C, base, color="#2E3A5E", accent="#E5E2D8"):
    """Knit vest over a formal shirt: V neck, ribbed hem and armholes, cable-free plain knit."""
    b = C.b
    k, g = b.k, b.g
    obj, prof, gap_fn = shell_vest(C, base, bo.pbr("tmp_sv", (0.5, 0.5, 0.5), 0.9), off=0.008, gap_top=31.0, gap_bot=0.2, gap_z=0.69, hem=0.49, seed=12, name="sweatervest", amp=0.55, recess=0.015)
    P = coords(obj)
    u, v, a = prof.uv(P)
    D = np.zeros(len(P))
    hem_band = sstep(0.532 * k, 0.528 * k, P[:, 2])
    D += ribs(u, hem_band, 0.0095, 0.0024)
    D -= 0.0022 * np.exp(-(((P[:, 2] - 0.532 * k) / 0.002) ** 2))
    # V-neck rib follows the opening.
    neck_edge = np.array([gap_fn(z) for z in P[:, 2]])
    a_deg = np.abs(np.degrees(a))
    near_v = sstep(9.0, 6.0, a_deg - neck_edge) * (P[:, 2] > 0.68 * k) * (P[:, 1] < 0)
    D += ribs(P[:, 2], near_v, 0.0085, 0.002)
    # Fine knit texture as real relief so it survives into the bake.
    knit = 0.0006 * np.cos(u * 2 * PI / 0.0065)
    apply_field(obj, D + knit)
    col = np.tile(np.array(lin(color)), (len(P), 1)) * (0.9 + 0.2 * fbm(P, 30.0, 2, 2))[:, None]
    set_col(obj, col)
    bo.assign(obj, mat_cloth("knit_wool", None, 0.94, 300.0, 0.3, 0.02, 0.32, attr="col"))
    return obj, prof


def drawcords(C, color="#E2DED2"):
    b = C.b
    k, g = b.k, b.g
    cords = []
    for sg, drop in ((1, 0.15), (-1, 0.12)):
        pts = [(sg * 0.052 * g, -0.138 * g, 0.79 * k), (sg * 0.058 * g, -0.152 * g, 0.72 * k), (sg * 0.054 * g, -0.158 * g, 0.79 * k - drop)]
        cords.append(tube("cord", pts, [0.0034, 0.0034, 0.0034], segs=6, n=4))
        p = np.array(pts[-1])
        cords.append(capsule("aglet", p, p + np.array([0, 0, -0.016]), 0.0046, 0.0046, segs=8, rings=2))
    c = bo.join(cords, "cords")
    c.data.shade_smooth()
    bo.assign(c, mat_cloth("cord", lin(color), 0.86, 500.0, 0.3, 0.06, 0.0))
    return c


# ---------------------------------------------------------------------------
# Convenience wrappers used by the character builders
# ---------------------------------------------------------------------------


def add_eyewear(C, style, a=0.094, b_=0.056, gap=0.012, fw=0.013, level=0.61, frame="#07080A", metal=False, bud_scale=1.0):
    for obj, bud, lo in eyewear(C, style, a=a, b=b_, gap=gap, fw=fw, level=level, frame=frame, metal=metal, lo_n=16):
        C.add(obj, int(bud * bud_scale), ("head",), density=1.2, lo=lo, chart=0.012, ext=0.0025)


def add_wrap(C, **kw):
    for obj, bud, lo in wrap_shades(C, **kw):
        C.add(obj, bud, ("head",), density=1.2, lo=lo, chart=0.02, ext=0.0025)


def add_hands(C, color, budget=340, scale=1.18):
    m = skin_material("hand_skin", color, 0.48)
    for side in (1, -1):
        C.add(hand_mesh(C, side, m, scale), budget, (f"hand.{'L' if side > 0 else 'R'}",), chart=0.018, ext=0.005)


def add_shoes(C, make, density=1.1, **kw):
    for side in (1, -1):
        for obj, bud, bone in make(C, side, **kw):
            C.add(obj, bud, (bone,), density=density, chart=0.03, ext=0.005)


def add_bare_feet(C, skin):
    m = skin if not isinstance(skin, str) else skin_material("foot_skin", skin, 0.5)
    for side in (1, -1):
        C.add(bare_foot(C, side, m), 260, (f"foot.{'L' if side > 0 else 'R'}",), chart=0.02, ext=0.004)
    return m


def add_bare_legs(C, m, z_top=None, budget=170):
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        C.add(bare_leg(C, side, m, z_top), budget, (f"thigh.{sfx}", f"shin.{sfx}"), gate=False, chart=0.03, ext=0.004)


def add_bare_arms(C, m, kind="short", budget=170):
    for side in (1, -1):
        sfx = "L" if side > 0 else "R"
        C.add(bare_arm(C, side, m, kind), budget, (f"upperarm.{sfx}", f"forearm.{sfx}"), gate=False, chart=0.03, ext=0.004)


def add_wrap_cloth(C, wrap, budget, **kw):
    obj, comb = wrap
    C.add(obj, budget, ("chest",), chart=0.03, ext=0.009, density=1.35, **kw)
    if comb is not None:
        C.add(comb, 200, ("chest",), chart=0.012, ext=0.002)


def add_top(C, top, btn, budget=2200, bones=TORSO_BONES, **kw):
    C.add(top, budget, bones, ext=0.012, group=0, lo_smooth=8, **kw)
    if btn is not None:
        C.add(btn, None, ("chest",), group=0)


def lower_blend_weights(b, P):
    """Long garment: upper part follows spine and arms by capsule distance, the skirt below
    the hips blends hips and both thighs so it stretches rather than tears."""
    top = capsule_weights(b, P, TORSO_BONES, 6.0)
    skirt = skirt_weights(b, P, top=b.hip + 0.02, bottom=b.knee - 0.05 * b.k)
    t = sstep(b.hip + 0.05, b.hip - 0.02, P[:, 2])[:, None]
    return normalise_top4(top * (1 - t) + skirt * t)


GAMCHA_RED = [("#C4252B", 2.0), ("#F1EBE0", 1.2), ("#C4252B", 0.7), ("#F1EBE0", 0.6), ("#8E1A20", 1.0), ("#F1EBE0", 1.2)]
LUNGI_BLUE = [("#1E4F7C", 3.2), ("#E5DFC9", 0.35), ("#1F7D74", 2.2), ("#D9682B", 0.4), ("#16385E", 2.6), ("#E5DFC9", 0.35), ("#3A7FA8", 1.6)]
LUNGI_GREEN = [("#1F6A47", 3.0), ("#EFE9D2", 0.3), ("#23506F", 2.4), ("#D4A62C", 0.32), ("#174A36", 2.6), ("#EFE9D2", 0.3), ("#4E9767", 1.5)]
SHIRT_CHECK = [("#F0EDE2", 2.0), ("#6C87A6", 0.7), ("#F0EDE2", 1.0), ("#B64A3A", 0.42), ("#F0EDE2", 1.0), ("#6C87A6", 0.7)]
SHIRT_BROWN = [("#5C4230", 1.8), ("#C7B79A", 0.45), ("#3A2A1E", 1.3), ("#8A6A48", 0.75), ("#3A2A1E", 0.6)]
SHIRT_VENDOR = [("#E9E2CF", 2.0), ("#8A7A52", 0.32), ("#E9E2CF", 1.2), ("#4E6D5C", 0.5), ("#E9E2CF", 1.0)]
SCARF_PLAID = [("#B72A2C", 2.2), ("#20242A", 0.9), ("#B72A2C", 0.9), ("#E8DEC4", 0.32), ("#20242A", 1.3)]
SHAWL_GREY = [("#8E8D88", 2.0), ("#5B5A57", 0.9), ("#B5B4AE", 0.5), ("#5B5A57", 0.9), ("#8E8D88", 1.2), ("#3F3E3C", 0.36)]


def npc_rickshaw_watermelon(opts):
    C = Character("npc_rickshaw_watermelon", Body(1.40, 0.5, hat=0.0, girth=1.0), tex=1024)
    b = C.b
    C.add(head_watermelon(C), 1100, ("head",), density=1.5, chart=0.2, ext=0.005)
    # No eyewear: owner's decision, only some of the cast wear glasses. Plain fruit, still no face.
    top, prof, limbs, btn = garment_top(C, mat_plaid("check_shirt", SHIRT_CHECK, 0.092), "short", hem=0.452, seed=3, amp=1.1, loose=1.02, button="#D8D2C2")
    add_top(C, top, btn, 2100)
    add_wrap_cloth(C, neck_wrap(C, GAMCHA_RED, 0.056, 0.24, 0.13, seed=2), 740)
    lg, lg_lo, _ = lungi(C, LUNGI_BLUE, 0.15, hem=0.165, seed=5)
    C.add(lg, 1050, ("hips", "thigh.L", "thigh.R"), lo=lg_lo, weight_fn=skirt_weights, group=0, ext=0.014, lo_smooth=3, chart=0.09)
    m = add_bare_feet(C, "#6F9F4E")
    add_bare_legs(C, m, 0.34 * b.k)
    add_bare_arms(C, m, "short")
    add_hands(C, "#6F9F4E")
    add_shoes(C, sandal, style="thong", color="#2C4F7A", sole="#1E2B3A", strap="#2F5C8E")
    return C


def npc_tea_banana(opts):
    C = Character("npc_tea_banana", Body(1.5, 0.66, hat=0.0), tex=1024)
    b = C.b
    C.add(head_banana(C), 1100, ("head",), density=1.5, chart=0.2, ext=0.005)
    for hi, lo, bud in baseball_cap(C, b.chin + b.head_h * 0.5, yaw=180.0, tilt=10.0, color="#3A352E", arch=False, brim_len=0.085, name="flat", crown_rx=0.2, crown_rz=0.098, clip_dome=True, cxy=(0.006, 0.066), brim_droop=0.018):
        C.add(hi, bud, ("head",), lo=lo, chart=0.08, ext=0.004)
    # No eyewear: owner's decision, only some of the cast wear glasses. Plain fruit, still no face.
    top, prof, limbs, btn = garment_top(C, mat_plaid("brown_check", SHIRT_BROWN, 0.05), "short", hem=0.47, seed=7, amp=1.05, loose=1.02, pocket=False, button="#C6B79E")
    add_top(C, top, btn, 1750)
    C.add(shirt_collar(C, prof, mat=mat_plaid("brown_collar", SHIRT_BROWN, 0.05)), 170, ("chest",), chart=0.02, ext=0.004)
    panel, lo, straps = apron(C, prof)
    C.add(panel, 700, ("hips", "spine", "chest", "thigh.L", "thigh.R"), lo=lo, weight_fn=lower_blend_weights, chart=0.08, ext=0.008, group=0)
    C.add(straps, 170, ("hips", "spine", "chest"), chart=0.02, ext=0.003)
    pants, _ = trousers(C, mat_cloth("dark_trousers", lin("#2C2A28"), 0.9, 380.0, 0.2, 0.08, 0.32), "dress", seed=8, amp=1.2)
    C.add(pants, 1500, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    m = add_bare_feet(C, "#F2C21C")
    add_bare_arms(C, m, "short")
    add_hands(C, "#F2C21C")
    add_shoes(C, sandal, style="two", color="#6B4426", sole="#2F221A")
    return C


def npc_shop_papaya(opts):
    C = Character("npc_shop_papaya", Body(1.54, 0.56, hat=0.0, girth=1.0), tex=1024)
    b = C.b
    C.add(head_papaya(C), 1000, ("head",), density=1.5, chart=0.2, ext=0.005)
    C.head_center = np.array([0.0, 0.0, b.chin + b.head_h * 0.5])
    br, br_lo = beard(C, top_el=-36.0, bot_el=-86.0, half=86.0, thick=0.026, drop=0.012)
    C.add(br, 520, ("head",), lo=br_lo, chart=0.04, ext=0.016)
    st, lf = small_stem_leaf(C, leaf=False, stem_h=0.03)
    C.add(st, 50, ("head",), ext=0.004)
    # No eyewear: owner's decision, only some of the cast wear glasses. Plain fruit, still no face.
    m_panj = mat_cloth("panjabi_white", lin("#E9E5D8"), 0.9, 320.0, 0.16, 0.04, 0.3)
    top, prof, limbs, btn = garment_top(C, m_panj, "long", hem=0.3, seed=4, amp=1.0, flare=0.03, loose=1.02, pocket=False, placket=True, button="#BFAE86", drape=14, buttons=5)
    C.add(top, 2100, TORSO_BONES + ("thigh.L", "thigh.R"), weight_fn=lower_blend_weights, ext=0.012, group=0, lo_smooth=8)
    C.add(btn, None, ("chest",), group=0)
    C.add(stand_collar(C, mat_cloth("collar_white", lin("#DCD7C8"), 0.9, 320.0, 0.14, 0.03, 0.0)), 150, ("chest",), chart=0.02, ext=0.003)
    v, vprof, _ = shell_vest(C, prof, mat_cloth("waistcoat", lin("#4A3120"), 0.84, 420.0, 0.26, 0.08, 0.34), off=0.009, gap_top=32.0, gap_bot=8.0, gap_z=0.6, hem=0.5, seed=5)
    C.add(v, 1050, ("hips", "spine", "chest"), ext=0.01, group=1, lo_smooth=5, chart=0.05)
    gm = neck_wrap(C, [("#B02A2E", 2.0), ("#D9CFBF", 0.34), ("#7F1B20", 0.9), ("#E3B24A", 0.2)], 0.056, 0.34, 0.0, ring=0.14, thick=0.018, width=0.042, flat=True, seed=3, z_ring=0.85)
    add_wrap_cloth(C, gm, 540)
    pants, _ = trousers(C, mat_cloth("pajama_white", lin("#DCD8CB"), 0.9, 320.0, 0.16, 0.04, 0.3), "pajama", seed=6, cuff=0.105, top_cut=0.41)
    C.add(pants, 1000, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    m = add_bare_feet(C, "#EC9A1E")
    add_hands(C, "#EEA11E")
    add_shoes(C, sandal, style="two", color="#5F3D22", sole="#2B1F18")
    return C


def npc_student_lemon(opts):
    C = Character("npc_student_lemon", Body(1.32, 0.48, hat=0.05), tex=1024)
    b = C.b
    C.add(head_lemon(C), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    for hi, lo, bud in baseball_cap(C, b.chin + b.head_h * 0.72, yaw=172.0 + 180.0, tilt=10.0, color="#1C1E22", brim_len=0.13, crown_rx=0.2, crown_rz=0.15):
        C.add(hi, bud, ("head",), lo=lo, chart=0.08, ext=0.004)
    add_wrap(C, level=0.6, half=78.0, h=0.044, style="wrap", off=0.017)
    hd, prof, limbs = build_hoodie(C, "#1E6E64", 17, closed=True)
    C.add(hd, 2350, TORSO_BONES, ext=0.012, group=0, lo_smooth=8)
    C.add(drawcords(C), 90, ("chest",), chart=0.01, ext=0.002)
    pk, st = backpack(C)
    C.add(pk, 540, ("chest", "spine"), chart=0.05, ext=0.005)
    C.add(st, 280, ("chest", "spine"), chart=0.02, ext=0.003)
    pants, _ = cargo_pants(C, "#4A4B3A", seed=33)
    C.add(pants, 1500, LEG_BONES, ext=0.018, group=0, lo_smooth=9)
    add_hands(C, "#F2CC10")
    add_shoes(C, sneaker, density=1.25, palette=dict(upper="#121316", panel="#E3E1D8", toe="#E9E7DE", lace="#EDEBE3"))
    return C


def npc_cng_guava(opts):
    C = Character("npc_cng_guava", Body(1.44, 0.5, hat=0.05), tex=1024)
    b = C.b
    C.add(head_guava(C), 1000, ("head",), density=1.5, chart=0.2, ext=0.005)
    for hi, lo, bud in baseball_cap(C, b.chin + b.head_h * 0.72, yaw=180.0, tilt=8.0, color="#4F4A42", arch=False, brim_len=0.115, name="cng", crown_rx=0.21, crown_rz=0.14):
        C.add(hi, bud, ("head",), lo=lo, chart=0.08, ext=0.004)
    add_eyewear(C, "wayfarer", a=0.09, b_=0.05, gap=0.012, level=0.6, bud_scale=0.7)
    m_khaki = mat_cloth("khaki", lin("#B8A67C"), 0.88, 340.0, 0.2, 0.08, 0.32)
    top, prof, limbs, btn = garment_top(C, m_khaki, "short", hem=0.47, seed=9, amp=1.0, loose=1.03, button="#7A6A4A")
    add_top(C, top, btn, 1800)
    C.add(shirt_collar(C, prof, mat=m_khaki), 170, ("chest",), chart=0.02, ext=0.004)
    add_wrap_cloth(C, neck_wrap(C, SCARF_PLAID, 0.066, 0.3, 0.22, seed=4, width=0.052), 740)
    pants, _ = cargo_pants(C, "#5B5C58", seed=44)
    C.add(pants, 1500, LEG_BONES, ext=0.018, group=0, lo_smooth=9)
    m = add_bare_feet(C, "#B5C866")
    add_bare_arms(C, m, "short")
    add_hands(C, "#A9BE5E")
    add_shoes(C, sandal, style="two", color="#55381F", sole="#241A14")
    return C


def npc_office_orange(opts):
    C = Character("npc_office_orange", Body(1.48, 0.47, hat=0.05), tex=1024)
    b = C.b
    C.add(head_orange(C), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    st, lf = small_stem_leaf(C, leaf=True, stem_h=0.022, leaf_len=0.12, leaf_w=0.034)
    C.add(st, 50, ("head",), ext=0.003)
    C.add(lf, 90, ("head",), chart=0.012, ext=0.003)
    add_eyewear(C, "rect", a=0.078, b_=0.03, gap=0.012, fw=0.0062, level=0.62, bud_scale=0.6)
    m_blue = mat_cloth("pale_blue", lin("#A9C2DE"), 0.84, 340.0, 0.12, 0.03, 0.32)
    top, prof, limbs, btn = garment_top(C, m_blue, "long", hem=0.55, seed=10, amp=0.85, loose=1.0, pocket=True, button="#EFEDE6", buttons=5)
    add_top(C, top, btn, 2100)
    C.add(shirt_collar(C, prof, mat=m_blue), 180, ("chest",), chart=0.02, ext=0.004)
    pants, _ = trousers(C, mat_cloth("black_trousers", lin("#141518"), 0.82, 380.0, 0.16, 0.08, 0.34), "dress", seed=11, amp=0.8, waist=0.605)
    C.add(pants, 1450, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    bl, bk = belt(C, 0.585, "#16110E")
    C.add(bl, 150, ("hips",), chart=0.02, ext=0.003)
    C.add(bk, 24, ("hips",), ext=0.002)
    rib, card, clip = lanyard(C, prof)
    C.add(rib, 110, ("chest",), chart=0.01, ext=0.002)
    C.add(card, 40, ("chest",), density=2.0, chart=0.01, ext=0.002)
    C.add(clip, None, ("chest",))
    bag, hw, strap = side_bag(C, prof, side=-1, size=(0.27, 0.09, 0.2), z=0.5, across=False)
    C.add(bag, 460, ("hips",), density=1.1, chart=0.05, ext=0.005)
    C.add(hw, 60, ("hips",), ext=0.002)
    C.add(strap, 190, ("hips", "spine", "chest"), chart=0.02, ext=0.003)
    add_hands(C, "#EE8C10")
    add_shoes(C, formal_shoe, density=1.1, color="#0D0D0F")
    return C


def npc_elder_date(opts):
    C = Character("npc_elder_date", Body(1.3, 0.46, hat=0.075, girth=0.96), tex=1024)
    b = C.b
    C.add(head_date(C), 1100, ("head",), density=1.5, chart=0.2, ext=0.006)
    C.head_center = np.array([0.0, 0.0, b.chin + b.head_h * 0.5])
    C.add(topi(C, b.chin + b.head_h * 0.81), 420, ("head",), density=1.3, chart=0.05, ext=0.003)
    br, br_lo = beard(C, top_el=-30.0, bot_el=-84.0, half=66.0, thick=0.03, drop=0.17, narrow=0.68, color="#E8E5DD", light="#FFFFFF", rough=0.9, forward=0.045)
    C.add(br, 560, ("head",), lo=br_lo, chart=0.04, ext=0.016)
    # No eyewear: owner's decision, only some of the cast wear glasses. Plain fruit, still no face.
    m_panj = mat_cloth("panjabi_white", lin("#ECE8DC"), 0.9, 320.0, 0.16, 0.04, 0.3)
    top, prof, limbs, btn = garment_top(C, m_panj, "long", hem=0.22, seed=13, amp=1.0, flare=0.03, loose=1.03, pocket=True, placket=True, button="#C8BE9E", drape=16, buttons=5)
    C.add(top, 2200, TORSO_BONES + ("thigh.L", "thigh.R"), weight_fn=lower_blend_weights, ext=0.012, group=0, lo_smooth=8)
    C.add(btn, None, ("chest",), group=0)
    C.add(stand_collar(C, mat_cloth("collar_white", lin("#DED9CB"), 0.9, 320.0, 0.14, 0.03, 0.0)), 150, ("chest",), chart=0.02, ext=0.003)
    sh = neck_wrap(C, SHAWL_GREY, 0.07, 0.36, 0.33, ring=0.15, thick=0.022, width=0.05, seed=7, flat=True, z_ring=0.846, name="shawl", spread=0.04)
    add_wrap_cloth(C, sh, 780)
    pants, _ = trousers(C, mat_cloth("pajama_white", lin("#E2DED2"), 0.9, 320.0, 0.16, 0.04, 0.3), "pajama", seed=14, cuff=0.105, top_cut=0.33)
    C.add(pants, 800, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    m = add_bare_feet(C, "#5A2A14")
    add_hands(C, "#5E2C16")
    add_shoes(C, sandal, style="two", color="#4A2F1C", sole="#241911")
    return C


def npc_vendor_pineapple(opts):
    C = Character("npc_vendor_pineapple", Body(1.52, 0.46, hat=0.27), tex=1024)
    b = C.b
    h, crown = head_pineapple(C)
    C.add(h, 1300, ("head",), density=1.5, chart=0.2, ext=0.006)
    C.add(crown, 760, ("head",), density=1.2, chart=0.012, ext=0.0035)
    # No eyewear: owner's decision, only some of the cast wear glasses. Plain fruit, still no face.
    top, prof, limbs, btn = garment_top(C, mat_plaid("vendor_shirt", SHIRT_VENDOR, 0.088), "short", hem=0.455, seed=15, amp=1.05, loose=1.02, button="#C8B88E")
    add_top(C, top, btn, 1800)
    C.add(shirt_collar(C, prof, mat=mat_plaid("vendor_collar", SHIRT_VENDOR, 0.088)), 160, ("chest",), chart=0.02, ext=0.004)
    add_wrap_cloth(C, neck_wrap(C, GAMCHA_RED, 0.056, 0.26, 0.2, seed=5), 600)
    lg, lg_lo, _ = lungi(C, LUNGI_GREEN, 0.15, hem=0.175, seed=8)
    C.add(lg, 950, ("hips", "thigh.L", "thigh.R"), lo=lg_lo, weight_fn=skirt_weights, group=0, ext=0.014, lo_smooth=3, chart=0.09)
    m = add_bare_feet(C, "#E2A524")
    add_bare_legs(C, m, 0.36 * b.k)
    add_bare_arms(C, m, "short")
    add_hands(C, "#E2A524")
    add_shoes(C, sandal, style="two", color="#6C4A2A", sole="#2E2118")
    return C


def npc_police_coconut(opts):
    C = Character("npc_police_coconut", Body(1.58, 0.5, hat=0.075, girth=1.02), tex=1024)
    b = C.b
    k, g = b.k, b.g
    C.add(head_coconut(C), 1000, ("head",), density=1.5, chart=0.2, ext=0.006)
    for hi, lo, bud in peaked_cap(C, b.chin + b.head_h * 0.79):
        C.add(hi, bud, ("head",), lo=lo, chart=0.06, ext=0.003)
    add_eyewear(C, "aviator", a=0.082, b_=0.05, gap=0.016, fw=0.0056, level=0.6, frame="#3B3D40", metal=True, bud_scale=0.8)
    m_olive = mat_cloth("light_olive", lin("#8D9068"), 0.86, 340.0, 0.2, 0.06, 0.32)
    top, prof, limbs, btn = garment_top(C, m_olive, "long", hem=0.53, seed=16, amp=0.85, loose=1.03, pocket=False, button="#3E3E30", buttons=4, rad=1.03)
    add_top(C, top, None, 1650)
    C.add(btn, None, ("chest",), group=0)
    C.add(shirt_collar(C, prof, mat=m_olive), 160, ("chest",), chart=0.02, ext=0.004)
    # Hi-vis vest with silver reflective bands: plain panels, no words or badges.
    def vest_mat():
        return mat_cloth("hivis", lin("#C6DA19"), 0.74, 380.0, 0.3, 0.05, 0.3)

    vest, vp, gapf = shell_vest(C, prof, vest_mat(), off=0.012, gap_top=26.0, gap_bot=2.5, gap_z=0.62, hem=0.505, seed=18, name="hivis_vest", amp=0.8)
    C.add(vest, 1000, ("hips", "spine", "chest"), ext=0.012, group=1, lo_smooth=5, chart=0.05, density=1.25)
    bands = []
    for zz in (0.575, 0.635):
        z = zz * k
        gap = gapf(z) + 2.0
        bands.append(ribbon_on(vp, "band_f1", [(-90 + gap + t * (180 - gap * 2), z) for t in np.linspace(0, 1, 12)], 0.026 * k, off=0.0035))
        bands.append(ribbon_on(vp, "band_f2", [(90 + t * (180 - gap), z) for t in np.linspace(0, 1, 8)], 0.026 * k, off=0.0035))
    for sg in (1, -1):
        th_f = -90 + sg * 44
        th_b = 90 - sg * 44
        pts_f = [(th_f, z * k) for z in np.linspace(0.65, 0.8, 7)]
        pts_b = [(th_b, z * k) for z in np.linspace(0.8, 0.65, 7)]
        bands.append(ribbon_on(vp, "band_v1", pts_f, 0.026 * k, off=0.0035, ref=(1, 0, 0)))
        bands.append(ribbon_on(vp, "band_v2", pts_b, 0.026 * k, off=0.0035, ref=(1, 0, 0)))
    bnd = bo.join(bands, "bands")
    bnd.data.shade_smooth()
    m_band = mat_cloth("reflective", lin("#C6CACE"), 0.28, 520.0, 0.3, 0.05, 0.0)
    m_band.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.55
    bo.assign(bnd, m_band)
    C.add(bnd, None, ("chest",))
    pants, _ = trousers(C, mat_cloth("dark_uniform", lin("#22251F"), 0.84, 380.0, 0.2, 0.08, 0.32), "dress", seed=19, amp=0.9, cuff=0.15)
    C.add(pants, 1300, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    # White gloves in place of bare hands.
    add_hands(C, "#EFEEE9", budget=380)
    add_shoes(C, formal_shoe, density=1.1, color="#0B0B0D", boot=True)
    return C


def npc_worker_jackfruit(opts):
    C = Character("npc_worker_jackfruit", Body(1.48, 0.5, hat=0.05, girth=1.06), tex=1024)
    b = C.b
    C.add(head_jackfruit(C), 1400, ("head",), density=1.5, chart=0.2, ext=0.007)
    C.add(turban(C, b.chin + b.head_h * 0.735, GAMCHA_RED, 0.056), 780, ("head",), chart=0.03, ext=0.012, density=1.45)
    # No eyewear: owner's decision, only some of the cast wear glasses. Plain fruit, still no face.

    def faded(Q, a, u):
        base = np.array(lin("#7E8F8C"))
        n = fbm(Q, 9.0, 3, 2)
        col = mixc(base, np.array(lin("#A3B0AB")), sstep(0.35, 0.72, n))
        col = mixc(col, np.array(lin("#5E6B68")), sstep(0.6, 0.8, fbm(Q, 30.0, 3, 3)) * 0.35)
        sweat = sstep(0.62 * b.k, 0.8 * b.k, Q[:, 2]) * sstep(0.46, 0.66, fbm(Q, 16.0, 3, 5))
        col = mixc(col, np.array(lin("#57635F")), sweat * 0.3)
        dust = sstep(0.55, 0.75, fbm(Q, 20.0, 3, 7))
        col = mixc(col, np.array(lin("#B3A486")), dust * 0.24)
        return col

    m_tee = mat_cloth("faded_tee", None, 0.92, 300.0, 0.2, 0.03, 0.3, attr="col")
    top, prof, limbs, btn = garment_top(C, m_tee, "short", hem=0.455, seed=20, amp=1.15, loose=1.04, belly=0.006, placket=False, pocket=False, attr_col=faded, rad=1.04)
    add_top(C, top, None, 2000)
    # Crew neck rib.
    pts = []
    for th_ in np.linspace(0, 360, 22):
        front = max(0.0, -math.sin(math.radians(th_))) ** 2
        pts.append(prof.point(float(th_), float((0.848 - 0.042 * front) * b.k), 0.0012))
    neck = tube("crew", pts, [(0.0092, 0.0058)] * 22, segs=8, n=2, ref=(0, 0, 1))
    refine(neck, 1)
    bo.assign(neck, mat_cloth("crew_rib", lin("#6F7F7C"), 0.92, 300.0, 0.2, 0.03, 0.0))
    C.add(neck, 120, ("chest",), chart=0.02, ext=0.003)

    def dusty(Q):
        base = np.array(lin("#6E5F49"))
        n = fbm(Q, 8.0, 3, 2)
        col = mixc(base, np.array(lin("#8C7A5E")), sstep(0.32, 0.72, n))
        col = mixc(col, np.array(lin("#B5A684")), sstep(0.5, 0.74, fbm(Q, 22.0, 3, 4)) * 0.3 * sstep(0.4 * b.k, 0.15 * b.k, Q[:, 2]))
        return col

    pants, _ = trousers(C, mat_cloth("work_trousers", None, 0.92, 340.0, 0.24, 0.03, 0.34, attr="col"), "rolled", seed=21, amp=1.15, attr=dusty)
    C.add(pants, 1450, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    m = add_bare_feet(C, "#8FA532")
    add_bare_legs(C, m, 0.28 * b.k, budget=120)
    add_bare_arms(C, m, "short")
    add_hands(C, "#92A838")
    add_shoes(C, sandal, style="thong", color="#3F3A32", sole="#20201E", strap="#54504A")
    return C


def npc_commuter_lychee(opts):
    C = Character("npc_commuter_lychee", Body(1.26, 0.46, hat=0.0, girth=0.96), tex=1024)
    b = C.b
    C.add(head_lychee(C), 1250, ("head",), density=1.5, chart=0.2, ext=0.006)
    st, lf = small_stem_leaf(C, leaf=False, stem_h=0.024)
    C.add(st, 50, ("head",), ext=0.003)
    # Two separate lenses: a single dark band on this round head read like a wide mouth.
    add_eyewear(C, "rect", a=0.084, b_=0.038, gap=0.014, fw=0.009, level=0.64, bud_scale=0.7)
    m_st = mat_stripes("striped_formal", "#EEF0F2", "#4F6A92", 0.021, 0.2)
    top, prof, limbs, btn = garment_top(C, m_st, "long", hem=0.53, seed=22, amp=0.9, loose=1.0, pocket=False, button="#D9D9D4", buttons=2)
    add_top(C, top, None, 1650)
    C.add(btn, None, ("chest",), group=0)
    C.add(shirt_collar(C, prof, mat=mat_stripes("striped_collar", "#EEF0F2", "#4F6A92", 0.021, 0.2)), 170, ("chest",), chart=0.02, ext=0.004)
    sv, sp = sweater_vest(C, prof)
    C.add(sv, 950, ("hips", "spine", "chest"), ext=0.01, group=1, lo_smooth=4, chart=0.05)
    pants, _ = trousers(C, mat_cloth("grey_trousers", lin("#4B4D52"), 0.86, 380.0, 0.18, 0.07, 0.32), "dress", seed=23, amp=0.85)
    C.add(pants, 1250, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    bag, hw, strap = side_bag(C, sp, side=1, size=(0.22, 0.08, 0.17), z=0.5, color="#3A2A20", strap_col="#2A2019", across=True, strap_w=0.018)
    C.add(bag, 360, ("hips",), density=1.1, chart=0.05, ext=0.005)
    C.add(hw, 60, ("hips",), ext=0.002)
    C.add(strap, 170, ("hips", "spine", "chest"), chart=0.02, ext=0.003)
    add_hands(C, "#C2343C")
    add_shoes(C, formal_shoe, density=1.1, color="#24150D")
    return C


def build_hero_mango(opts):
    C = Character("hero_mango", Body(1.40, 0.53, hat=0.05), tex=1024)
    b = C.b
    head = mango_head(C)
    C.add(head, 1500, ("head",), density=1.4, chart=0.2, ext=0.005)
    # Cap: band plane near the top third, tilted back, brim behind and a little to the side.
    for hi, lo, bud in baseball_cap(C, b.chin + b.head_h * 0.735, yaw=-15.0, tilt=9.0, crown_rx=0.205, crown_rz=0.165):
        C.add(hi, bud, ("head",), density=1.0, lo=lo, chart=0.08, ext=0.004)
    top = np.array((-0.004, 0.012, b.chin + b.head_h * 0.735 + 0.17))
    C.add(stem(C, top, top + np.array((0.006, 0.004, 0.03)), 0.015, 0.012), 60, ("head",), ext=0.004)
    for obj, bud, lo in eyewear(C, "wayfarer", a=0.094, b=0.056, gap=0.012, level=0.60):
        C.add(obj, bud, ("head",), density=1.3, lo=lo, chart=0.012, ext=0.0025)
    hoodie, prof, arm_limbs = build_hoodie(C)
    C.add(hoodie, 4000, TORSO_BONES, density=1.0, ext=0.018, group=0, lo_smooth=10)
    tee, tee_collar = build_tee(C, prof)
    C.add(tee, 400, ("hips", "spine", "chest"), density=1.0)
    C.add(tee_collar, 110, ("chest",), density=1.0, ext=0.003)
    pants, leg_limbs = cargo_pants(C)
    C.add(pants, 2600, LEG_BONES, density=0.9, ext=0.02, group=0, lo_smooth=9)
    m_hand = skin_material("hand_skin", "#F2AF14", 0.46)
    for side in (1, -1):
        C.add(hand_mesh(C, side, m_hand), 480, (f"hand.{'L' if side > 0 else 'R'}",), density=1.0, chart=0.018, ext=0.005)
        for obj, bud, bone in sneaker(C, side):
            C.add(obj, bud, (bone,), density=1.5, chart=0.03, ext=0.005)
    strap, bag, buckle = crossbody_bag(C, prof, side=-1)
    C.add(strap, 240, ("hips", "spine", "chest"), chart=0.02, ext=0.003)
    C.add(bag, 460, ("hips",), density=1.3, chart=0.03, ext=0.005)
    C.add(buckle, 48, ("hips",), ext=0.002)
    return C


# ---------------------------------------------------------------------------
# More of the city: women and girls, a child, and more trades. Plain fruit faces, as everywhere.
# ---------------------------------------------------------------------------


def plain_fruit(C, name, base, deep, light, rx=0.222, ry=0.214, sq=1.0, taper=0.0, pore="#000000", scale=210.0, rough=0.42, bump=0.16):
    """A round fruit head in the same manner as the rest of the cast."""
    b = C.b
    hh = b.head_h / 2
    fn = ellipsoid_fn(b.chin + hh, hh, rx, ry, sq=sq, taper=taper)

    def paint(P, th, v):
        n = fbm(P, 5.0, 3, 1)
        col = mixc(np.array(lin(base)), np.array(lin(deep)), sstep(0.32, 0.72, n))
        col = mixc(col, np.array(lin(light)), sstep(0.55, 0.8, fbm(P, 9.0, 3, 2)) * 0.5)
        pores = sstep(0.6, 0.84, vnoise(P, scale, 3))
        col = mixc(col, np.array(lin(pore)), pores * 0.08)
        return (n - 0.5) * 0.005 - pores * 0.0012, col

    return head_from(C, name, fn, paint, mat_attr(name + "_skin", rough, 300.0, bump, "voronoi", 0.0013))


def head_scarf(C, color, rx=0.232, ry=0.224, front=62.0, low=0.2, name="scarf", drape=0.1):
    """Cloth over the top and back of the head and round the neck. The fruit shows in the opening."""
    b = C.b
    hh = b.head_h / 2
    cz = b.chin + hh
    rows, cols = 22, 44
    P = np.zeros((rows, cols, 3))
    for i in range(rows):
        v = i / (rows - 1)
        el = math.radians(-78 + 170 * v)
        for j in range(cols):
            # From the opening's edge, round the back, to the other edge. Front is -Y.
            a = math.radians(front + (360 - 2 * front) * j / (cols - 1))
            ce, se = math.cos(el), math.sin(el)
            grow = 1 + 0.03 * math.sin(a * 3 + el * 2) + 0.02 * (1 - v)
            x = math.sin(a) * rx * ce * grow
            y = -math.cos(a) * ry * ce * grow
            P[i, j] = (x, y, cz + se * hh * 1.03)
            if v < low:
                P[i, j, 2] -= (low - v) * drape * 3
    obj = grid_obj(name, P)
    obj.data.materials.append(mat_cloth(name, lin(color), 0.86, 340.0, 0.14, 0.05, 0.3))
    return obj


def long_top(C, mat, hem=0.2, seed=21, flare=0.05, loose=1.05, name="kameez"):
    top, prof, limbs, btn = garment_top(C, mat, "long", hem=hem, seed=seed, amp=1.0, flare=flare, loose=loose, pocket=False, placket=False, name=name)
    C.add(top, 2200, TORSO_BONES + ("thigh.L", "thigh.R"), weight_fn=lower_blend_weights, ext=0.012, group=0, lo_smooth=8)
    return prof


def wrap_skirt(C, stops, pitch=0.1, seed=7):
    b = C.b
    lg, lg_lo, _ = lungi(C, stops, pitch, hem=0.11, seed=seed, wide=1.06)
    C.add(lg, 950, ("hips", "thigh.L", "thigh.R"), lo=lg_lo, weight_fn=skirt_weights, group=0, ext=0.014, lo_smooth=3, chart=0.09)


SARI_RED = [("#A81C3A", 2.6), ("#E6B83C", 0.5), ("#7A1230", 1.8), ("#E6B83C", 0.35)]
SARI_WHITE = [("#EAE6DC", 2.4), ("#3D6E58", 0.3), ("#DDD8CC", 1.8)]
SARI_BLUE = [("#1D5F8C", 2.4), ("#F0D070", 0.4), ("#14476E", 1.8)]
ORNA_PINK = [("#D6588A", 2.0), ("#F1D6E0", 0.5), ("#B83F70", 1.2)]


def npc_woman_apple(opts):
    """In a sari, the end of it over her head."""
    C = Character("npc_woman_apple", Body(1.36, 0.47, hat=0.03, girth=0.94), tex=1024)
    C.add(plain_fruit(C, "apple", "#C5232C", "#9C1720", "#E2574A", sq=0.98), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    C.add(head_scarf(C, "#A81C3A"), 700, ("head",), chart=0.06, ext=0.005)
    m = mat_plaid("sari_top", SARI_RED, 0.1)
    prof = long_top(C, m, hem=0.3, seed=22, name="sari_blouse")
    add_wrap_cloth(C, neck_wrap(C, SARI_RED, 0.1, 0.4, 0.3, ring=0.14, thick=0.02, width=0.07, seed=3, flat=True, z_ring=0.84, name="anchal"), 760)
    wrap_skirt(C, SARI_RED, seed=31)
    add_bare_feet(C, "#B5202A")
    add_hands(C, "#C42A32")
    add_shoes(C, sandal, style="two", color="#5A2A1C", sole="#241911")
    return C


def npc_woman_peach(opts):
    """Salwar kameez and an orna over the shoulders."""
    C = Character("npc_woman_peach", Body(1.38, 0.47, hat=0.02, girth=0.92), tex=1024)
    C.add(plain_fruit(C, "peach", "#F2A77A", "#E68A5C", "#F9C9A0", sq=1.0), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    st, lf = small_stem_leaf(C, leaf=True, stem_h=0.022, leaf_len=0.1, leaf_w=0.03)
    C.add(st, 50, ("head",), ext=0.003)
    C.add(lf, 90, ("head",), chart=0.012, ext=0.003)
    m = mat_cloth("kameez_teal", lin("#1F7E7A"), 0.84, 340.0, 0.14, 0.04, 0.3)
    long_top(C, m, hem=0.24, seed=23)
    add_wrap_cloth(C, neck_wrap(C, ORNA_PINK, 0.05, 0.42, 0.34, ring=0.15, thick=0.018, width=0.06, seed=6, flat=True, z_ring=0.835, name="orna"), 760)
    pants, _ = trousers(C, mat_cloth("salwar", lin("#E9E2CE"), 0.88, 320.0, 0.16, 0.04, 0.3), "pajama", seed=24, cuff=0.09, top_cut=0.33)
    C.add(pants, 800, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    add_bare_feet(C, "#E89B70")
    add_hands(C, "#EFA57A")
    add_shoes(C, sandal, style="two", color="#8A3A3C", sole="#2C1A18")
    return C


def npc_woman_plum(opts):
    """In a long dark coat and scarf."""
    C = Character("npc_woman_plum", Body(1.42, 0.47, hat=0.03, girth=0.95), tex=1024)
    C.add(plain_fruit(C, "plum", "#5E2A6E", "#431C50", "#8A4C96", sq=1.0), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    C.add(head_scarf(C, "#26282E", front=58.0), 700, ("head",), chart=0.06, ext=0.005)
    m = mat_cloth("borka", lin("#22242A"), 0.8, 360.0, 0.16, 0.05, 0.3)
    long_top(C, m, hem=0.14, seed=25, flare=0.07, loose=1.08, name="borka")
    add_bare_feet(C, "#4D2358")
    add_hands(C, "#5A2A68")
    add_shoes(C, sandal, style="two", color="#1E1E22", sole="#121214")
    return C


def npc_girl_pear(opts):
    """In school uniform: white top, blue dress, a bag on her back."""
    C = Character("npc_girl_pear", Body(1.12, 0.42, hat=0.03, girth=0.86), tex=1024)
    C.add(plain_fruit(C, "pear", "#C4CF4E", "#A9B63C", "#DEE37C", sq=0.96, taper=0.18), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    st, lf = small_stem_leaf(C, leaf=True, stem_h=0.026, leaf_len=0.09, leaf_w=0.028)
    C.add(st, 50, ("head",), ext=0.003)
    C.add(lf, 90, ("head",), chart=0.012, ext=0.003)
    m = mat_cloth("uniform_blue", lin("#274F8F"), 0.84, 340.0, 0.14, 0.04, 0.3)
    long_top(C, m, hem=0.3, seed=26, flare=0.06, name="pinafore")
    add_wrap_cloth(C, neck_wrap(C, [("#F2F0EA", 2.0), ("#DAD7CF", 0.6)], 0.05, 0.28, 0.22, ring=0.13, thick=0.016, width=0.05, seed=9, flat=True, z_ring=0.835, name="sash"), 500)
    pk, stp = backpack(C, "#B5324C", "#7E2036")
    C.add(pk, 460, ("chest", "spine"), chart=0.05, ext=0.005)
    C.add(stp, 200, ("chest", "spine"), chart=0.02, ext=0.003)
    m2 = add_bare_feet(C, "#BDC74B")
    add_bare_legs(C, m2, 0.36 * C.b.k)
    add_hands(C, "#C4CF4E")
    add_shoes(C, formal_shoe, color="#111114")
    return C


def npc_kid_berry(opts):
    """A boy in a tee shirt and shorts, always on his way to a game."""
    C = Character("npc_kid_berry", Body(1.02, 0.42, hat=0.02, girth=0.84), tex=1024)
    C.add(plain_fruit(C, "berry", "#B02A3E", "#8C1E30", "#D44A5A", sq=1.0), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    st, lf = small_stem_leaf(C, leaf=True, stem_h=0.02, leaf_len=0.08, leaf_w=0.03)
    C.add(st, 50, ("head",), ext=0.003)
    C.add(lf, 90, ("head",), chart=0.012, ext=0.003)
    top, prof, limbs, btn = garment_top(C, mat_cloth("kid_tee", lin("#2E7FB8"), 0.86, 340.0, 0.12, 0.04, 0.3), "short", hem=0.47, seed=27, amp=0.9, loose=1.02, pocket=False, placket=False)
    add_top(C, top, btn, 1600)
    pants, _ = cargo_pants(C, "#3E3F3A", seed=28, cargo=False, cuff_z=0.26)
    C.add(pants, 1100, LEG_BONES, ext=0.018, group=0, lo_smooth=9)
    m = add_bare_feet(C, "#A92A3C")
    add_bare_legs(C, m, 0.3 * C.b.k)
    add_bare_arms(C, m, "short")
    add_hands(C, "#B02A3E")
    add_shoes(C, sandal, style="two", color="#2B6A9E", sole="#1A1D20")
    return C


def npc_granny_fig(opts):
    """An old woman in a white sari, the end of it over her hair."""
    C = Character("npc_granny_fig", Body(1.24, 0.45, hat=0.03, girth=0.92), tex=1024)
    C.add(plain_fruit(C, "fig", "#6D4C62", "#4F3548", "#8F6C84", sq=1.02, taper=0.12), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    C.add(head_scarf(C, "#E9E5DA"), 700, ("head",), chart=0.06, ext=0.005)
    long_top(C, mat_plaid("granny_top", SARI_WHITE, 0.1), hem=0.3, seed=29, name="granny_blouse")
    add_wrap_cloth(C, neck_wrap(C, SARI_WHITE, 0.1, 0.36, 0.28, ring=0.14, thick=0.02, width=0.07, seed=8, flat=True, z_ring=0.84, name="anchal"), 760)
    wrap_skirt(C, SARI_WHITE, seed=33)
    add_bare_feet(C, "#5E4054")
    add_hands(C, "#6D4C62")
    add_shoes(C, sandal, style="two", color="#3F3028", sole="#1E1812")
    return C


def npc_doctor_kiwi(opts):
    C = Character("npc_doctor_kiwi", Body(1.46, 0.47, hat=0.02), tex=1024)
    C.add(plain_fruit(C, "kiwi", "#8A6D3B", "#6D552C", "#A68A52", sq=1.0, scale=330.0, rough=0.7, bump=0.3), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    add_eyewear(C, "rect", a=0.078, b_=0.032, gap=0.012, fw=0.006, level=0.62, bud_scale=0.6)
    m = mat_cloth("white_coat", lin("#EEF0EE"), 0.82, 340.0, 0.12, 0.03, 0.28)
    long_top(C, m, hem=0.34, seed=30, flare=0.03, loose=1.06, name="white_coat")
    pants, _ = trousers(C, mat_cloth("dr_trousers", lin("#23303F"), 0.82, 380.0, 0.16, 0.08, 0.34), "dress", seed=34, amp=0.8, waist=0.605)
    C.add(pants, 1100, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    add_wrap_cloth(C, neck_wrap(C, [("#1F2226", 1.0)], 0.05, 0.3, 0.3, ring=0.14, thick=0.012, width=0.022, seed=2, flat=False, fringe=False, z_ring=0.82, name="stethoscope"), 300)
    add_hands(C, "#8A6D3B")
    add_shoes(C, formal_shoe, color="#141418")
    return C


def npc_guard_melon(opts):
    C = Character("npc_guard_melon", Body(1.5, 0.48, hat=0.075, girth=1.04), tex=1024)
    b = C.b
    C.add(plain_fruit(C, "melon", "#C9C46A", "#A8A44E", "#E0DC8C", sq=1.0, scale=120.0), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    for hi, lo, bud in peaked_cap(C, b.chin + b.head_h * 0.79, color="#2B3A5A", band_col="#141C2E"):
        C.add(hi, bud, ("head",), lo=lo, chart=0.06, ext=0.003)
    m = mat_cloth("guard_shirt", lin("#3D5478"), 0.84, 340.0, 0.16, 0.05, 0.3)
    top, prof, limbs, btn = garment_top(C, m, "short", hem=0.53, seed=35, amp=0.85, loose=1.03, pocket=True, button="#D8C894", buttons=5)
    add_top(C, top, btn, 1800)
    C.add(shirt_collar(C, prof, mat=m), 160, ("chest",), chart=0.02, ext=0.004)
    pants, _ = trousers(C, mat_cloth("guard_pants", lin("#1E2838"), 0.82, 380.0, 0.16, 0.08, 0.34), "dress", seed=36, amp=0.8, waist=0.605)
    C.add(pants, 1200, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    bl, bk = belt(C, 0.585, "#101014")
    C.add(bl, 150, ("hips",), chart=0.02, ext=0.003)
    C.add(bk, 24, ("hips",), ext=0.002)
    ma = add_bare_feet(C, "#C0BB62")
    add_bare_arms(C, ma, "short")
    add_hands(C, "#C9C46A")
    add_shoes(C, formal_shoe, color="#0E0E10", boot=True)
    return C


def npc_sweeper_tamarind(opts):
    C = Character("npc_sweeper_tamarind", Body(1.4, 0.45, hat=0.05), tex=1024)
    C.add(plain_fruit(C, "tamarind", "#7A5230", "#5C3C22", "#9A7044", sq=1.04, taper=0.1, rough=0.7), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    C.add(head_scarf(C, "#E0701C", front=120.0, low=0.5, name="headcloth", rx=0.226, ry=0.218), 450, ("head",), chart=0.05, ext=0.004)
    m = mat_cloth("work_shirt", lin("#6E705E"), 0.88, 340.0, 0.18, 0.08, 0.32)
    top, prof, limbs, btn = garment_top(C, m, "short", hem=0.47, seed=37, amp=1.05, loose=1.03, pocket=False, placket=False)
    add_top(C, top, btn, 1500)
    vest, vp, gapf = shell_vest(C, prof, mat_cloth("hivis_orange", lin("#E0701C"), 0.74, 380.0, 0.3, 0.05, 0.3), off=0.012, gap_top=26.0, gap_bot=2.5, gap_z=0.62, hem=0.505, seed=38, name="work_vest")
    C.add(vest, 700, ("chest", "spine"), ext=0.01, group=0, lo_smooth=6)
    pants, _ = cargo_pants(C, "#4B4A44", seed=39, cargo=False)
    C.add(pants, 1100, LEG_BONES, ext=0.018, group=0, lo_smooth=9)
    ma = add_bare_feet(C, "#6C4728")
    add_bare_arms(C, ma, "short")
    add_hands(C, "#7A5230")
    add_shoes(C, sandal, style="two", color="#2E2A24", sole="#191612")
    return C


def npc_boss_quince(opts):
    """A man in a suit, hurrying between towers."""
    C = Character("npc_boss_quince", Body(1.5, 0.47, hat=0.02, girth=1.02), tex=1024)
    C.add(plain_fruit(C, "quince", "#E2C84A", "#C4AC36", "#F0E07A", sq=1.02, taper=0.08), 900, ("head",), density=1.5, chart=0.2, ext=0.005)
    add_eyewear(C, "aviator", a=0.082, b_=0.05, gap=0.016, fw=0.0056, level=0.6, frame="#2B2D30", metal=True, bud_scale=0.8)
    m = mat_cloth("suit", lin("#232B3C"), 0.8, 380.0, 0.14, 0.05, 0.3)
    top, prof, limbs, btn = garment_top(C, m, "long", hem=0.45, seed=41, amp=0.8, loose=1.04, pocket=True, button="#101014", buttons=3)
    add_top(C, top, btn, 2100)
    C.add(shirt_collar(C, prof, mat=mat_cloth("suit_collar", lin("#EEF0EE"), 0.84, 340.0, 0.12, 0.03, 0.28)), 180, ("chest",), chart=0.02, ext=0.004)
    pants, _ = trousers(C, mat_cloth("suit_pants", lin("#20283A"), 0.82, 380.0, 0.16, 0.08, 0.34), "dress", seed=42, amp=0.8, waist=0.605)
    C.add(pants, 1200, LEG_BONES, ext=0.012, group=0, lo_smooth=8)
    add_hands(C, "#E2C84A")
    add_shoes(C, formal_shoe, color="#0E0E10")
    return C


ROSTER = {
    "npc_woman_apple": npc_woman_apple,
    "npc_woman_peach": npc_woman_peach,
    "npc_woman_plum": npc_woman_plum,
    "npc_girl_pear": npc_girl_pear,
    "npc_kid_berry": npc_kid_berry,
    "npc_granny_fig": npc_granny_fig,
    "npc_doctor_kiwi": npc_doctor_kiwi,
    "npc_guard_melon": npc_guard_melon,
    "npc_sweeper_tamarind": npc_sweeper_tamarind,
    "npc_boss_quince": npc_boss_quince,
    "hero_mango": build_hero_mango,
    "npc_rickshaw_watermelon": npc_rickshaw_watermelon,
    "npc_tea_banana": npc_tea_banana,
    "npc_shop_papaya": npc_shop_papaya,
    "npc_student_lemon": npc_student_lemon,
    "npc_cng_guava": npc_cng_guava,
    "npc_office_orange": npc_office_orange,
    "npc_elder_date": npc_elder_date,
    "npc_vendor_pineapple": npc_vendor_pineapple,
    "npc_police_coconut": npc_police_coconut,
    "npc_worker_jackfruit": npc_worker_jackfruit,
    "npc_commuter_lychee": npc_commuter_lychee,
}


def parse(argv):
    opts, ids = {}, []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--hi":
            opts["hi"] = True
        elif a == "--noexport":
            opts["noexport"] = True
        elif a == "--nopreview":
            opts["nopreview"] = True
        elif a == "--pose":
            opts["pose"] = True
        elif a == "--close":
            opts["close"] = True
        elif a == "--legs":
            opts["legs"] = True
        elif a == "--dump":
            global DUMP_TEXTURES
            DUMP_TEXTURES = True
        elif a == "--size":
            i += 1
            opts["size"] = int(argv[i])
        elif a == "--views":
            i += 1
            opts["views"] = tuple(int(x) for x in argv[i].split(","))
        elif a == "--tag":
            i += 1
            opts["tag"] = "_" + argv[i]
        else:
            ids.append(a)
        i += 1
    return ids, opts


def main():
    ids, opts = parse(bo.script_args())
    for cid in ids or list(ROSTER):
        t0 = time.time()
        bo.reset_scene()
        C = ROSTER[cid](opts)
        finish(C, opts)
        print(f"[char] {cid} done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
