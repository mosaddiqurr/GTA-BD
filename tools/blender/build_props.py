"""Street props and landmarks for Bangladesh Open World.

Run headless:
  blender --background --factory-startup --python tools/blender/build_props.py -- [ids...] [--preview-dir=<dir>]

No ids builds everything in priority order. Output goes to public/assets/props and
public/assets/landmarks. Preview PNGs are written only when --preview-dir is given.
Never writes .blend files.

Metro line constants every metro asset agrees on (see METRO_* below). Piers stand every
35 m along Y; a span is centred between two piers; rail head and walkway tops are at z=13.5.
"""

import math
import os
import random
import sys
import time
import traceback

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bo_common as bo  # noqa: E402

# ---------------------------------------------------------------------------
# Metro line levels, shared by pier, span, station and train
# ---------------------------------------------------------------------------
METRO_RAIL_Z = 13.5  # rail head and walkway top ("deck top")
METRO_BED_Z = 13.2  # concrete track bed between the walkways
METRO_SOFFIT_Z = 11.25  # underside of the box girders
METRO_CAP_Z = 10.85  # top of the pier hammerhead
METRO_TRACK_X = 2.4  # track centres at +/- this
METRO_SPAN = 35.0
METRO_BEARING_X = (1.2, 3.6)
METRO_BEARING_Y = 0.75  # bearing row distance from the pier centre line
METRO_HALF_WIDTH = 4.85


def rgb(hex_str):
    """sRGB hex to linear RGB tuple."""
    h = hex_str.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def mul3(a, k):
    return tuple(c * k for c in a)


# ---------------------------------------------------------------------------
# Tiny shader-graph language: everything below bakes down to one texture set
# ---------------------------------------------------------------------------
class G:
    """Shader node helper. Values may be sockets, numbers or RGB tuples."""

    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.bsdf = bo.bsdf_of(mat)
        self._coord = None
        self._sep = None
        self._geo = None

    # plumbing
    def _node(self, kind):
        return self.nt.nodes.new(kind)

    def _put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        elif isinstance(v, (int, float)):
            if sock.type in ("RGBA", "VECTOR"):
                dv = sock.default_value
                sock.default_value = (v, v, v, 1) if len(dv) == 4 else (v, v, v)
            else:
                sock.default_value = v
        else:
            if sock.type == "RGBA":
                sock.default_value = (v[0], v[1], v[2], 1)
            else:
                sock.default_value = tuple(v)

    # coordinates
    @property
    def co(self):
        if self._coord is None:
            self._coord = self._node("ShaderNodeTexCoord").outputs["Object"]
        return self._coord

    def _xyz(self):
        if self._sep is None:
            self._sep = self._node("ShaderNodeSeparateXYZ")
            self.nt.links.new(self.co, self._sep.inputs[0])
        return self._sep

    @property
    def x(self):
        return self._xyz().outputs[0]

    @property
    def y(self):
        return self._xyz().outputs[1]

    @property
    def z(self):
        return self._xyz().outputs[2]

    @property
    def geo(self):
        if self._geo is None:
            self._geo = self._node("ShaderNodeNewGeometry")
        return self._geo

    def normal_xyz(self):
        sep = self._node("ShaderNodeSeparateXYZ")
        self.nt.links.new(self.geo.outputs["True Normal"], sep.inputs[0])
        return sep.outputs[0], sep.outputs[1], sep.outputs[2]

    # maths
    def m(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self._node("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self._put(n.inputs[0], a)
        if len(n.inputs) > 1:
            self._put(n.inputs[1], b)
        if len(n.inputs) > 2:
            self._put(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b):
        return self.m("ADD", a, b)

    def sub(self, a, b):
        return self.m("SUBTRACT", a, b)

    def mul(self, a, b):
        return self.m("MULTIPLY", a, b)

    def mulc(self, a, b):
        return self.m("MULTIPLY", a, b, clamp=True)

    def div(self, a, b):
        return self.m("DIVIDE", a, b)

    def maxi(self, a, b):
        return self.m("MAXIMUM", a, b)

    def mini(self, a, b):
        return self.m("MINIMUM", a, b)

    def absv(self, a):
        return self.m("ABSOLUTE", a)

    def fract(self, a):
        return self.m("FRACT", a)

    def floor(self, a):
        return self.m("FLOOR", a)

    def gt(self, a, b):
        return self.m("GREATER_THAN", a, b)

    def lt(self, a, b):
        return self.m("LESS_THAN", a, b)

    def inv(self, a):
        return self.m("SUBTRACT", 1.0, a, clamp=True)

    def smooth(self, v, lo, hi):
        """0 at lo, 1 at hi (smoothstep). lo > hi gives a falling edge."""
        n = self._node("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        self._put(n.inputs[0], v)
        self._put(n.inputs[1], lo)
        self._put(n.inputs[2], hi)
        n.inputs[3].default_value = 0.0
        n.inputs[4].default_value = 1.0
        return n.outputs[0]

    def line(self, v, period, width):
        """1 on thin lines every `period` metres along v, 0 elsewhere."""
        fr = self.fract(self.div(v, period))
        d = self.mul(self.mini(fr, self.sub(1.0, fr)), period)
        return self.smooth(d, width, width * 0.4)

    # vectors
    def vscale(self, s, offset=(0.0, 0.0, 0.0), vec=None):
        n = self._node("ShaderNodeVectorMath")
        n.operation = "MULTIPLY"
        self._put(n.inputs[0], vec if vec is not None else self.co)
        n.inputs[1].default_value = s
        if any(offset):
            a = self._node("ShaderNodeVectorMath")
            a.operation = "ADD"
            self.nt.links.new(n.outputs[0], a.inputs[0])
            a.inputs[1].default_value = offset
            return a.outputs[0]
        return n.outputs[0]

    def combine(self, x, y, z):
        n = self._node("ShaderNodeCombineXYZ")
        self._put(n.inputs[0], x)
        self._put(n.inputs[1], y)
        self._put(n.inputs[2], z)
        return n.outputs[0]

    def length2(self, a, b):
        return self.m("SQRT", self.add(self.mul(a, a), self.mul(b, b)))

    # textures
    def noise(self, scale=1.0, detail=4.0, rough=0.5, dist=0.0, vec=None):
        n = self._node("ShaderNodeTexNoise")
        self._put(n.inputs["Vector"], vec if vec is not None else self.co)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = dist
        return n.outputs[0]

    def voronoi(self, scale=1.0, metric="EUCLIDEAN", vec=None, rand=1.0):
        n = self._node("ShaderNodeTexVoronoi")
        n.distance = metric
        self._put(n.inputs["Vector"], vec if vec is not None else self.co)
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = rand
        return n.outputs["Distance"], n.outputs["Color"]

    def white(self, vec):
        n = self._node("ShaderNodeTexWhiteNoise")
        n.noise_dimensions = "3D"
        self._put(n.inputs["Vector"], vec)
        return n.outputs["Value"], n.outputs["Color"]

    def ramp(self, f, stops):
        """Colour ramp from [(pos, rgb), ...]."""
        n = self._node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = (*stops[0][1], 1)
        cr.elements[1].position = stops[-1][0]
        cr.elements[1].color = (*stops[-1][1], 1)
        for pos, col in stops[1:-1]:
            el = cr.elements.new(pos)
            el.color = (*col, 1)
        self._put(n.inputs[0], f)
        return n.outputs[0]

    def mix(self, a, b, f, blend="MIX"):
        n = self._node("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        n.clamp_factor = True
        self._put(n.inputs[0], f)
        self._put(n.inputs[6], a)
        self._put(n.inputs[7], b)
        return n.outputs[2]

    def rgbf(self, col):
        """Colour socket to value (luminance-free, just the first channel)."""
        sep = self._node("ShaderNodeSeparateXYZ")
        self.nt.links.new(col, sep.inputs[0])
        return sep.outputs[0]

    # outputs
    def color(self, v):
        self._put(self.bsdf.inputs["Base Color"], v)

    def rough(self, v):
        self._put(self.bsdf.inputs["Roughness"], v)

    def metal(self, v):
        self._put(self.bsdf.inputs["Metallic"], v)

    def edge_mask(self, radius=0.02):
        """1 on convex or concave edges, read from a Bevel node (bake-time only)."""
        bev = self._node("ShaderNodeBevel")
        bev.samples = 4
        bev.inputs["Radius"].default_value = radius
        dot = self._node("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        self.nt.links.new(bev.outputs[0], dot.inputs[0])
        self.nt.links.new(self.geo.outputs["True Normal"], dot.inputs[1])
        return self.smooth(dot.outputs["Value"], 0.995, 0.86)

    def surface(self, height=None, strength=0.5, distance=0.02, bevel=0.0):
        """Wire the normal: Bevel rounds hard edges in the normal bake, Bump adds height."""
        out = None
        if bevel > 0:
            bev = self._node("ShaderNodeBevel")
            bev.samples = 4
            bev.inputs["Radius"].default_value = bevel
            out = bev.outputs[0]
        if height is not None:
            bump = self._node("ShaderNodeBump")
            bump.inputs["Strength"].default_value = strength
            bump.inputs["Distance"].default_value = distance
            self._put(bump.inputs["Height"], height)
            if out is not None:
                self.nt.links.new(out, bump.inputs["Normal"])
            out = bump.outputs[0]
        if out is not None:
            self.nt.links.new(out, self.bsdf.inputs["Normal"])


def _face_tangent_u(g):
    """World-aligned running coordinate along a face: X on +/-Y faces, Y on +/-X and flat faces."""
    nx, ny, _ = g.normal_xyz()
    pick = g.gt(g.absv(ny), g.absv(nx))
    return g.add(g.mul(g.x, pick), g.mul(g.y, g.sub(1.0, pick)))


# ---------------------------------------------------------------------------
# Material library
# ---------------------------------------------------------------------------
def concrete(name, c1=None, c2=None, seam_h=1.8, seam_w=2.4, seam_line=0.012, ties=None, drip=0.7, drip_top=None,
             drip_band=3.0, grime=0.7, grime_h=1.4, soot=0.35, dust=0.35, panel_tone=0.16, posters=0.0, rough=0.86,
             bevel=0.02, bump=0.5, mottled=1.0, moss=0.0, joint_weep=0.0):
    """Cast concrete: formwork panels with per-panel tone, seams and tie holes, rain drips,
    road grime low down, soot on soffits, dust on top faces. All in object space."""
    c1 = c1 or rgb("#b9ab92")
    c2 = c2 or rgb("#938672")
    mat = bo.pbr(name, c1, rough)
    g = G(mat)
    nx, ny, nz = g.normal_xyz()
    u = _face_tangent_u(g)
    # broad blotches then tighter mottling
    col = g.mix(c1, c2, g.smooth(g.noise(scale=0.55, detail=6.0, rough=0.55), 0.34, 0.66))
    col = g.mix(col, mul3(c2, 0.82), g.mul(g.smooth(g.noise(scale=4.5, detail=6.0, rough=0.6), 0.52, 0.72), 0.4 * mottled))
    col = g.mix(col, lerp3(c1, (1, 1, 1), 0.18), g.mul(g.smooth(g.noise(scale=11.0, detail=4.0), 0.58, 0.72), 0.22 * mottled))
    height = g.mul(g.noise(scale=26.0, detail=5.0, rough=0.6), 0.25)
    if seam_h:
        ucell = g.floor(g.div(u, seam_w))
        zcell = g.floor(g.div(g.z, seam_h))
        tone, _ = g.white(g.combine(ucell, zcell, g.mul(nz, 0.0)))
        col = g.mix(col, mul3(c2, 0.8), g.mul(tone, panel_tone))
        lines = g.maxi(g.line(u, seam_w, seam_line), g.mul(g.line(g.z, seam_h, seam_line), g.sub(1.0, g.absv(nz))))
        col = g.mix(col, mul3(c2, 0.42), g.mul(lines, 0.78))
        height = g.sub(height, g.mul(lines, 1.2))
    if joint_weep > 0 and seam_h:
        # segment joints leak: white lime crust and dark wet line around each joint
        band = g.line(u, seam_w, 0.3)
        n = g.smooth(g.noise(scale=3.2, detail=6.0, rough=0.6), 0.42, 0.62)
        col = g.mix(col, rgb("#d9d4c2"), g.mulc(g.mul(band, n), joint_weep))
        wet = g.line(u, seam_w, 0.5)
        col = g.mix(col, rgb("#4d483e"), g.mul(g.mul(wet, g.smooth(g.noise(scale=1.1, detail=5.0), 0.5, 0.66)), joint_weep * 0.8))
    if ties:
        pu, pz, r = ties
        fu = g.sub(g.fract(g.div(u, pu)), 0.5)
        fz = g.sub(g.fract(g.div(g.z, pz)), 0.5)
        d = g.length2(g.mul(fu, pu), g.mul(fz, pz))
        holes = g.mul(g.smooth(d, r, r * 0.55), g.sub(1.0, g.absv(nz)))
        col = g.mix(col, mul3(c2, 0.4), holes)
        height = g.sub(height, g.mul(holes, 1.3))
    # rain drips on vertical faces, strongest under a ledge when drip_top is known
    if drip > 0:
        vertical = g.smooth(g.absv(nz), 0.8, 0.3)
        d1 = g.smooth(g.noise(vec=g.vscale((4.2, 4.2, 0.26)), scale=1.0, detail=5.0, rough=0.62), 0.5, 0.67)
        d2 = g.smooth(g.noise(vec=g.vscale((1.1, 1.1, 0.13), (7.0, 3.0, 1.0)), scale=1.0, detail=4.0), 0.52, 0.7)
        mask = g.maxi(g.mul(d1, 0.8), g.mul(d2, 0.65))
        if drip_top is not None:
            band = g.smooth(g.z, drip_top - drip_band, drip_top)
            mask = g.mul(mask, g.add(0.32, g.mul(band, 0.95)))
        mask = g.mulc(g.mul(mask, vertical), drip)
        col = g.mix(col, rgb("#4b463d"), g.mul(mask, 0.72))
        # pale lime weep lines between the dark streaks
        weep = g.smooth(g.noise(vec=g.vscale((6.5, 6.5, 0.35), (2.0, 9.0, 4.0)), scale=1.0, detail=3.0), 0.64, 0.74)
        col = g.mix(col, lerp3(c1, (1, 1, 0.94), 0.45), g.mul(g.mul(weep, vertical), 0.38 * drip))
    # road splash and dust around the foot
    if grime > 0:
        low = g.smooth(g.z, grime_h, 0.05)
        n = g.smooth(g.noise(vec=g.vscale((2.2, 2.2, 1.0)), scale=1.0, detail=5.0), 0.3, 0.62)
        col = g.mix(col, rgb("#4a4034"), g.mulc(g.mul(low, g.add(0.32, g.mul(n, 0.68))), grime))
    if moss > 0:
        n = g.smooth(g.noise(scale=1.6, detail=6.0), 0.5, 0.68)
        low = g.smooth(g.z, grime_h * 2.0, 0.0)
        col = g.mix(col, rgb("#39402a"), g.mulc(g.mul(n, low), moss))
    if soot > 0:
        under = g.smooth(nz, -0.25, -0.8)
        n = g.smooth(g.noise(scale=0.9, detail=5.0), 0.3, 0.7)
        col = g.mix(col, rgb("#3c3831"), g.mulc(g.mul(under, g.add(0.35, g.mul(n, 0.65))), soot))
    if dust > 0:
        top = g.smooth(nz, 0.45, 0.85)
        n = g.smooth(g.noise(scale=3.0, detail=4.0), 0.35, 0.7)
        col = g.mix(col, rgb("#b4a68c"), g.mulc(g.mul(top, g.add(0.3, g.mul(n, 0.7))), dust))
    if posters > 0:
        dist, cell = g.voronoi(scale=1.9, metric="CHEBYCHEV", vec=g.vscale((1.0, 1.0, 0.62)))
        pick = g.rgbf(cell)
        band = g.mul(g.smooth(g.z, 0.95, 1.2), g.smooth(g.z, 2.9, 2.5))
        tear = g.smooth(g.noise(scale=6.0, detail=6.0), 0.36, 0.5)
        present = g.mul(g.mul(g.smooth(pick, 0.46, 0.5), band), tear)
        tint = g.ramp(g.fract(g.mul(pick, 7.3)), [(0.0, rgb("#b98d7a")), (0.34, rgb("#cdb981")), (0.67, rgb("#8ca2a4")), (1.0, rgb("#c9c3b4"))])
        col = g.mix(col, tint, g.mul(present, posters))
    g.color(col)
    g.rough(g.add(rough - 0.06, g.mul(g.noise(scale=3.0, detail=3.0), 0.12)))
    g.surface(height, strength=bump, distance=0.03, bevel=bevel)
    return mat


def painted(name, color, under=None, wear=0.35, fade=0.3, dirt=0.4, rust=0.0, rough=0.55, metallic=0.0, bevel=0.006,
            grain=None, drip=0.4, scale=1.0, edge=0.012):
    """Old paint: sun-faded blotches, chips that open on edges, dirt runs, optional rust bleed."""
    mat = bo.pbr(name, color, rough, metallic)
    g = G(mat)
    _, _, nz = g.normal_xyz()
    faded = lerp3(color, rgb("#c9c2b2"), 0.55)
    col = g.mix(color, faded, g.mulc(g.smooth(g.noise(scale=1.3 * scale, detail=5.0, rough=0.6), 0.34, 0.72), fade))
    col = g.mix(col, mul3(color, 0.78), g.mul(g.smooth(g.noise(scale=9.0 * scale, detail=5.0), 0.5, 0.72), 0.32))
    height = g.mul(g.noise(scale=70.0 * scale, detail=3.0), 0.1)
    if grain is not None:
        # paint over wood: grain shows through and raises the surface
        axis = {"x": (1.5, 34.0, 34.0), "y": (34.0, 1.5, 34.0), "z": (34.0, 34.0, 1.5)}[grain]
        gr = g.noise(vec=g.vscale(axis), scale=1.0, detail=6.0, rough=0.65, dist=0.4)
        col = g.mix(col, mul3(color, 0.62), g.mul(g.smooth(gr, 0.42, 0.62), 0.5))
        height = g.add(height, g.mul(gr, 0.5))
    if wear > 0:
        n1 = g.noise(scale=7.0 * scale, detail=7.0, rough=0.65)
        edge_m = g.edge_mask(edge)
        chips = g.smooth(g.add(n1, g.mul(edge_m, 0.45)), 0.86 - wear * 0.5, 0.9 - wear * 0.5)
        under_c = under if under is not None else rgb("#7c6a55")
        col = g.mix(col, under_c, chips)
        height = g.sub(height, g.mul(chips, 0.4))
        if metallic > 0:
            g.metal(g.mul(g.sub(1.0, chips), metallic))
    if rust > 0:
        n = g.noise(scale=4.0 * scale, detail=7.0, rough=0.65)
        spots = g.mulc(g.smooth(n, 0.56, 0.68), rust)
        rust_c = g.ramp(g.noise(scale=30.0, detail=4.0), [(0.3, rgb("#5a2f18")), (0.55, rgb("#8c4b22")), (0.75, rgb("#b0682f"))])
        col = g.mix(col, rust_c, spots)
        streak = g.smooth(g.noise(vec=g.vscale((14.0, 14.0, 0.9)), scale=1.0, detail=4.0), 0.55, 0.68)
        col = g.mix(col, rgb("#6b3d1f"), g.mul(g.mul(streak, rust), 0.5))
        height = g.add(height, g.mul(spots, 0.5))
    if drip > 0:
        streak = g.smooth(g.noise(vec=g.vscale((9.0, 9.0, 0.7), (3.0, 1.0, 2.0)), scale=1.0, detail=4.0), 0.52, 0.68)
        col = g.mix(col, rgb("#3f3a31"), g.mulc(g.mul(streak, g.smooth(g.absv(nz), 0.8, 0.3)), drip * 0.8))
    if dirt > 0:
        top = g.smooth(nz, 0.5, 0.9)
        col = g.mix(col, rgb("#a2937a"), g.mulc(g.mul(top, g.smooth(g.noise(scale=6.0, detail=4.0), 0.3, 0.6)), dirt))
        low = g.smooth(g.z, 0.5, 0.0)
        col = g.mix(col, rgb("#5a4f3e"), g.mulc(low, dirt * 0.8))
    g.color(col)
    g.rough(g.add(rough - 0.08, g.mul(g.noise(scale=5.0, detail=3.0), 0.18)))
    g.surface(height, strength=0.35, distance=0.008, bevel=bevel)
    return mat


def steel(name, color=None, rust=0.25, rough=0.5, metallic=0.75, bevel=0.0, scale=1.0, drip=0.5, wear=0.2):
    """Galvanised or bare weathered steel."""
    color = color or rgb("#8e9091")
    return painted(name, color, under=rgb("#5d4630"), wear=wear, fade=0.15, dirt=0.3, rust=rust, rough=rough, metallic=metallic,
                   bevel=bevel, drip=drip, scale=scale)


def galv(name, color=None, rough=0.42, rust=0.1, scale=1.0):
    """Galvanised sheet: spangled grey, dull with dust."""
    color = color or rgb("#a3a7a6")
    mat = bo.pbr(name, color, rough, 0.85)
    g = G(mat)
    d, c = g.voronoi(scale=26.0 * scale)
    span = g.rgbf(c)
    col = g.mix(color, mul3(color, 0.74), g.mul(span, 0.6))
    col = g.mix(col, rgb("#5c5a55"), g.mul(g.smooth(g.noise(scale=2.0, detail=5.0), 0.45, 0.72), 0.55))
    if rust > 0:
        n = g.smooth(g.noise(scale=5.0 * scale, detail=7.0, rough=0.65), 0.6, 0.7)
        col = g.mix(col, rgb("#7e4522"), g.mulc(n, rust * 2.0))
        g.metal(g.sub(0.85, g.mulc(n, rust * 2.0)))
    g.color(col)
    g.rough(g.add(rough, g.mul(span, 0.15)))
    return mat


def wood(name, color=None, dark=None, axis="x", rough=0.72, scale=1.0, wear=0.3, bevel=0.005, plank=0.0):
    """Sawn timber with grain along `axis`, soft dark knots and grubby wear."""
    color = color or rgb("#8b6b47")
    dark = dark or mul3(color, 0.55)
    mat = bo.pbr(name, color, rough)
    g = G(mat)
    s = {"x": (1.2, 26.0, 26.0), "y": (26.0, 1.2, 26.0), "z": (26.0, 26.0, 1.2)}[axis]
    gr = g.noise(vec=g.vscale(tuple(v * scale for v in s)), scale=1.0, detail=7.0, rough=0.62, dist=0.5)
    col = g.mix(color, dark, g.smooth(gr, 0.38, 0.66))
    col = g.mix(col, mul3(dark, 0.7), g.mul(g.smooth(g.noise(scale=2.5, detail=5.0), 0.56, 0.74), 0.5))
    col = g.mix(col, lerp3(color, (1, 1, 1), 0.2), g.mul(g.smooth(g.noise(scale=1.2, detail=4.0), 0.5, 0.72), wear))
    height = g.mul(gr, 0.7)
    if plank > 0:
        coord = {"x": g.z, "y": g.z, "z": g.x}[axis]
        lines = g.line(coord, plank, 0.006)
        col = g.mix(col, rgb("#1f1712"), g.mul(lines, 0.8))
        height = g.sub(height, g.mul(lines, 1.5))
    g.color(col)
    g.rough(g.add(rough - 0.1, g.mul(gr, 0.25)))
    g.surface(height, strength=0.5, distance=0.006, bevel=bevel)
    return mat


def fabric(name, color, fade=0.45, dirt=0.4, weave=240.0, sag_dirt=0.3, rough=0.92, second=None):
    """Canvas, tarp or cotton: weave bump, sun bleach, water marks and dark seams of dirt."""
    mat = bo.pbr(name, color, rough)
    g = G(mat)
    _, _, nz = g.normal_xyz()
    faded = lerp3(color, rgb("#d2cbb9"), 0.5)
    col = g.mix(color, faded, g.mulc(g.smooth(g.noise(scale=1.2, detail=5.0, rough=0.6), 0.32, 0.7), fade))
    if second is not None:
        col = g.mix(col, second, g.smooth(g.noise(scale=2.4, detail=3.0), 0.52, 0.56))
    col = g.mix(col, mul3(color, 0.55), g.mul(g.smooth(g.noise(vec=g.vscale((8.0, 8.0, 1.3)), scale=1.0, detail=5.0), 0.54, 0.7), dirt))
    col = g.mix(col, rgb("#3d362b"), g.mul(g.smooth(g.noise(scale=3.5, detail=6.0), 0.6, 0.74), sag_dirt))
    wx = g.m("SINE", g.mul(g.x, weave))
    wy = g.m("SINE", g.mul(g.y, weave))
    wz = g.m("SINE", g.mul(g.z, weave))
    height = g.add(g.mul(g.add(wx, wy), 0.5), g.mul(wz, 0.5))
    g.color(col)
    g.rough(rough)
    g.surface(height, strength=0.22, distance=0.003)
    return mat


def plastic(name, color, rough=0.42, scuff=0.35, dirt=0.35, bevel=0.0):
    mat = bo.pbr(name, color, rough)
    g = G(mat)
    _, _, nz = g.normal_xyz()
    col = g.mix(color, lerp3(color, rgb("#cfc8ba"), 0.55), g.mul(g.smooth(g.noise(scale=4.0, detail=4.0), 0.4, 0.7), scuff))
    col = g.mix(col, mul3(color, 0.62), g.mul(g.smooth(g.noise(scale=40.0, detail=4.0), 0.62, 0.72), scuff))
    if dirt > 0:
        col = g.mix(col, rgb("#6c6050"), g.mulc(g.smooth(g.z, 0.35, 0.0), dirt))
        col = g.mix(col, rgb("#8d8066"), g.mulc(g.mul(g.smooth(nz, 0.5, 0.9), g.smooth(g.noise(scale=5.0, detail=4.0), 0.35, 0.6)), dirt))
    g.color(col)
    g.rough(g.add(rough, g.mul(g.noise(scale=25.0, detail=3.0), 0.2)))
    g.surface(None, bevel=bevel)
    return mat


def flat(name, color, rough=0.6, metallic=0.0):
    """Simple solid material for tiny things (bakes to solid colour with a little noise)."""
    mat = bo.pbr(name, color, rough, metallic)
    g = G(mat)
    g.color(g.mix(color, mul3(color, 0.75), g.mul(g.noise(scale=30.0, detail=3.0), 0.5)))
    return mat


def glass_opaque(name, color=None, rough=0.08, dirt=0.25, sky=0.0):
    """Dark tinted glazing baked into the single opaque material: glossy, with dirt film low down."""
    color = color or rgb("#28404a")
    mat = bo.pbr(name, color, rough)
    g = G(mat)
    col = g.mix(color, lerp3(color, rgb("#8fb4c0"), 0.5), g.mul(g.smooth(g.noise(vec=g.vscale((0.35, 0.35, 1.1)), scale=1.0, detail=3.0), 0.42, 0.68), 0.5))
    col = g.mix(col, rgb("#6d6657"), g.mul(g.smooth(g.noise(vec=g.vscale((5.0, 5.0, 0.8)), scale=1.0, detail=4.0), 0.5, 0.7), dirt))
    g.color(col)
    g.rough(g.add(rough, g.mul(g.smooth(g.noise(scale=4.0, detail=4.0), 0.5, 0.7), 0.22)))
    return mat


def aluminium(name, color=None, soot_top=None, soot_low=0.0, rough=0.34):
    """Beaten aluminium pots: soft dents, scratches, soot climbing from the base."""
    color = color or rgb("#c1c3c2")
    mat = bo.pbr(name, color, rough, 0.95)
    g = G(mat)
    col = g.mix(color, mul3(color, 0.7), g.mul(g.smooth(g.noise(scale=18.0, detail=5.0), 0.45, 0.7), 0.5))
    if soot_top is not None:
        n = g.mul(g.noise(scale=26.0, detail=5.0), 0.12)
        mask = g.smooth(g.add(g.z, n), soot_top, soot_low)
        col = g.mix(col, rgb("#191614"), mask)
        g.metal(g.sub(0.95, g.mul(mask, 0.8)))
    g.color(col)
    g.rough(g.add(rough, g.mul(g.noise(scale=30.0, detail=4.0), 0.25)))
    g.surface(g.noise(scale=14.0, detail=3.0), strength=0.25, distance=0.01)
    return mat


def bamboo(name, color=None, node=0.42):
    color = color or rgb("#b49a58")
    mat = bo.pbr(name, color, 0.6)
    g = G(mat)
    s = g.add(g.add(g.x, g.y), g.z)
    rings = g.line(s, node, 0.012)
    wide = g.line(s, node, 0.05)
    col = g.mix(color, rgb("#7a6233"), g.smooth(g.noise(vec=g.vscale((40.0, 40.0, 1.2)), scale=1.0, detail=5.0), 0.38, 0.68))
    col = g.mix(col, rgb("#5c4623"), g.mul(wide, 0.5))
    col = g.mix(col, rgb("#2d2212"), rings)
    col = g.mix(col, rgb("#4d4a42"), g.mul(g.smooth(g.z, 0.7, 0.0), 0.6))
    g.color(col)
    g.rough(0.55)
    g.surface(g.mul(rings, 1.0), strength=0.8, distance=0.008)
    return mat


def ribbed_sheet(name, color, period=0.2, axis="z", rust=0.1, drip=0.6, rough=0.5, metallic=0.2, depth=1.0, fade=0.25):
    """Corrugated or trapezoidal metal sheet with faded paint and rust runs."""
    mat = bo.pbr(name, color, rough, metallic)
    g = G(mat)
    s = {"x": g.x, "y": g.y, "z": g.z}[axis]
    wave = g.m("SINE", g.mul(s, 2 * math.pi / period))
    col = g.mix(color, mul3(color, 0.72), g.mul(g.smooth(wave, 0.2, -0.6), 0.6))
    col = g.mix(col, lerp3(color, rgb("#d1cbbb"), 0.5), g.mulc(g.smooth(g.noise(scale=1.2, detail=5.0), 0.35, 0.7), fade))
    if rust > 0:
        n = g.smooth(g.noise(scale=4.0, detail=7.0, rough=0.65), 0.58, 0.7)
        col = g.mix(col, rgb("#804a25"), g.mulc(n, rust * 1.6))
        streak = g.smooth(g.noise(vec=g.vscale((12.0, 12.0, 0.6)), scale=1.0, detail=4.0), 0.56, 0.68)
        col = g.mix(col, rgb("#6b3f22"), g.mulc(streak, rust * 1.5))
    if drip > 0:
        streak = g.smooth(g.noise(vec=g.vscale((5.0, 5.0, 0.4), (3.0, 1.0, 2.0)), scale=1.0, detail=4.0), 0.5, 0.68)
        col = g.mix(col, rgb("#47423a"), g.mulc(streak, drip * 0.7))
    g.color(col)
    g.rough(rough)
    g.surface(wave, strength=0.7 * depth, distance=period * 0.18)
    return mat


def jaali(name, color=None, hole=None, period=0.62, rough=0.45):
    """Perforated metal screen with a diamond lattice, a nod to Bengali jali work. No text or symbols."""
    color = color or rgb("#d9d8cf")
    hole = hole or rgb("#2e3336")
    mat = bo.pbr(name, color, rough, 0.2)
    g = G(mat)
    u = _face_tangent_u(g)
    a = g.fract(g.div(g.add(u, g.z), period))
    b = g.fract(g.div(g.sub(u, g.z), period))
    d = g.mini(g.mini(a, g.sub(1.0, a)), g.mini(b, g.sub(1.0, b)))
    mask = g.smooth(d, 0.06, 0.11)
    col = g.mix(color, hole, g.mul(mask, 0.92))
    col = g.mix(col, rgb("#4a453b"), g.mul(g.smooth(g.noise(vec=g.vscale((4.0, 4.0, 0.5)), scale=1.0, detail=4.0), 0.5, 0.68), 0.5))
    g.color(col)
    g.rough(rough)
    g.surface(g.mul(mask, -1.0), strength=0.8, distance=0.03)
    return mat


def hazard(name, a=None, b=None, period=0.5, wear=0.5, axis_scale=(1.0, 1.0, 1.0), rough=0.65, bevel=0.01):
    """Worn diagonal hazard stripes in object space."""
    a = a or rgb("#d6ad22")
    b = b or rgb("#1e1d1b")
    mat = bo.pbr(name, a, rough)
    g = G(mat)
    s = g.add(g.add(g.mul(g.x, axis_scale[0]), g.mul(g.y, axis_scale[1])), g.mul(g.z, axis_scale[2]))
    band = g.smooth(g.fract(g.div(s, period)), 0.48, 0.52)
    col = g.mix(a, b, band)
    n = g.noise(scale=5.0, detail=7.0, rough=0.65)
    chips = g.smooth(g.add(n, g.mul(g.edge_mask(0.02), 0.35)), 0.68 - wear * 0.25, 0.73 - wear * 0.25)
    col = g.mix(col, rgb("#9a917f"), chips)
    col = g.mix(col, rgb("#4a4034"), g.mul(g.smooth(g.z, 0.5, 0.0), 0.65))
    g.color(col)
    g.rough(rough)
    g.surface(g.mul(chips, -0.5), strength=0.3, distance=0.01, bevel=bevel)
    return mat


def banded(name, a, b, period, axis="z", wear=0.45, offset=0.0, rough=0.5, metallic=0.0, rust=0.0, bevel=0.005, duty=0.5):
    """Painted bands along one axis (pole bands, kerb stones)."""
    mat = bo.pbr(name, a, rough, metallic)
    g = G(mat)
    s = {"x": g.x, "y": g.y, "z": g.z}[axis]
    band = g.gt(g.fract(g.div(g.add(s, offset), period)), duty)
    col = g.mix(a, b, band)
    col = g.mix(col, rgb("#c6bda9"), g.mul(g.smooth(g.noise(scale=1.6, detail=5.0), 0.38, 0.72), 0.35))
    n = g.noise(scale=7.0, detail=7.0, rough=0.65)
    chips = g.smooth(g.add(n, g.mul(g.edge_mask(0.01), 0.4)), 0.8 - wear * 0.3, 0.84 - wear * 0.3)
    col = g.mix(col, rgb("#6f5b45"), chips)
    if rust > 0:
        spots = g.mulc(g.smooth(g.noise(scale=4.0, detail=7.0), 0.56, 0.68), rust)
        col = g.mix(col, rgb("#7e4522"), spots)
    col = g.mix(col, rgb("#4a4034"), g.mul(g.smooth(g.z, 0.5, 0.0), 0.6))
    g.color(col)
    g.rough(rough)
    g.surface(g.mul(chips, -0.5), strength=0.3, distance=0.006, bevel=bevel)
    return mat


# ---------------------------------------------------------------------------
# Kit: collects parts, joins, unwraps, bakes and exports one asset
# ---------------------------------------------------------------------------
PREVIEW_DIR = None


def _section_area(section):
    a = 0.0
    for i, (x0, z0) in enumerate(section):
        x1, z1 = section[(i + 1) % len(section)]
        a += x0 * z1 - x1 * z0
    return a * 0.5


def rrect(w, h, r, n=3, cx=0.0, cz=0.0):
    """Round-cornered rectangle section as (x, z) points, counter-clockwise."""
    hw, hh = w / 2 - r, h / 2 - r
    pts = []
    for (qx, qz, a0) in ((hw, -hh, -90), (hw, hh, 0), (-hw, hh, 90), (-hw, -hh, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + qx + math.cos(a) * r, cz + qz + math.sin(a) * r))
    return pts


class Kit:
    def __init__(self, asset_id, folder="props"):
        self.id = asset_id
        self.folder = folder
        self.parts = []  # (object, weight, instance group or None, uv ready)
        self.inst_stack = None
        self.inst_defs = {}
        self.empties = []
        self.separate = []  # finished objects kept out of the bake and exported as they are
        self.previews = []
        self.ao_ground = True
        self.loose = []

    # ---- primitives ----
    def _add(self, obj, mat, w, uv_ready=False):
        bo.assign(obj, mat)
        self.parts.append((obj, w, self.inst_stack, uv_ready))
        return obj

    def begin_instances(self, matrices, key=None):
        """Parts added until end_instances() share one set of UV islands. The geometry is
        duplicated once per matrix after packing, so every copy reuses the same texels."""
        key = key or f"inst{len(self.inst_defs)}"
        self.inst_defs[key] = list(matrices)
        self.inst_stack = key
        return key

    def end_instances(self):
        self.inst_stack = None

    def box(self, size, loc, mat, bevel=0.0, seg=1, rot=(0, 0, 0), w=1.0):
        return self._add(bo.box("p", size, loc, rot, bevel=bevel, bevel_segments=seg), mat, w)

    def cyl(self, r, depth, loc, mat, seg=12, rot=(0, 0, 0), rt=None, w=1.0):
        return self._add(bo.cylinder("p", r, depth, seg, loc, rot, radius_top=rt), mat, w)

    def tube(self, pts, r, mat, seg=6, w=1.0):
        return self._add(bo.tube_path("p", pts, r, seg), mat, w)

    def rod(self, a, b, r, mat, seg=6, w=1.0):
        return self.tube([a, b], r, mat, seg, w)

    def loft(self, rings, mat, seg=16, w=1.0, start=True, end=True):
        return self._add(bo.loft("p", rings, closed_start=start, closed_end=end, segments=seg), mat, w)

    def sphere(self, r, loc, mat, seg=10, rings=7, scale=(1, 1, 1), w=1.0):
        return self._add(bo.uv_sphere("p", r, seg, rings, loc, scale), mat, w)

    def mesh(self, verts, faces, mat, w=1.0, smooth=True):
        obj = bo.new_mesh_object("p", verts, faces, smooth=smooth)
        bo.recalc_normals(obj)
        return self._add(obj, mat, w)

    def boxes(self, items, mat, w=1.0):
        """Many unbevelled boxes as one object: items = [(size, loc), ...]. Fast for hundreds."""
        verts, faces = [], []
        for size, loc in items:
            sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
            b = len(verts)
            lx, ly, lz = loc
            verts += [(lx - sx, ly - sy, lz - sz), (lx + sx, ly - sy, lz - sz), (lx + sx, ly + sy, lz - sz), (lx - sx, ly + sy, lz - sz),
                      (lx - sx, ly - sy, lz + sz), (lx + sx, ly - sy, lz + sz), (lx + sx, ly + sy, lz + sz), (lx - sx, ly + sy, lz + sz)]
            faces += [(b + 3, b + 2, b + 1, b), (b + 4, b + 5, b + 6, b + 7), (b, b + 1, b + 5, b + 4),
                      (b + 1, b + 2, b + 6, b + 5), (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]
        obj = bo.new_mesh_object("p", verts, faces, smooth=False)
        return self._add(obj, mat, w)

    def section_loft(self, stations, mat, w=1.0, cap0=True, cap1=True, smooth=False, closed=True):
        """stations = [(y, [(x, z), ...]), ...]; each section same length, CCW seen looking along +Y.
        closed=False leaves the last-to-first edge open (saves hidden faces)."""
        verts, faces = [], []
        n = len(stations[0][1])
        flip = _section_area(stations[0][1]) < 0
        for y, sec in stations:
            s = list(reversed(sec)) if flip else sec
            verts.extend((x, y, z) for x, z in s)
        for r in range(len(stations) - 1):
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                a, b = r * n + i, r * n + j
                faces.append((a, a + n, b + n, b))
        if cap0:
            faces.append(tuple(range(n)))
        if cap1:
            faces.append(tuple((len(stations) - 1) * n + i for i in reversed(range(n))))
        obj = bo.new_mesh_object("p", verts, faces, smooth=smooth)
        return self._add(obj, mat, w)

    def prism(self, section, y0, y1, mat, chunks=1, w=1.0, caps=True, closed=True):
        """Section extruded along Y, split into loose chunks so no UV island spans the whole length."""
        for c in range(chunks):
            a = y0 + (y1 - y0) * c / chunks
            b = y0 + (y1 - y0) * (c + 1) / chunks
            self.section_loft([(a, section), (b, section)], mat, w, cap0=caps and c == 0, cap1=caps and c == chunks - 1, closed=closed)

    def prism_x(self, section, x0, x1, mat, w=1.0, caps=True):
        """Section [(y, z), ...] extruded along X."""
        if _section_area(section) < 0:
            section = list(reversed(section))
        n = len(section)
        verts = [(x0, y, z) for y, z in section] + [(x1, y, z) for y, z in section]
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, j + n, i + n))
        if caps:
            faces.append(tuple(reversed(range(n))))
            faces.append(tuple(n + i for i in range(n)))
        obj = bo.new_mesh_object("p", verts, faces, smooth=False)
        return self._add(obj, mat, w)

    def grid(self, fn, nu, nv, mat, w=1.0, chunks=4, flip=False):
        """Connected quad grid from fn(u, v) with u,v in [-1, 1]. Smooth across chunk borders,
        while UV islands break every nv/chunks rows so long shells pack well."""
        verts = []
        for r in range(nv + 1):
            v = -1.0 + 2.0 * r / nv
            for c in range(nu + 1):
                verts.append(tuple(fn(-1.0 + 2.0 * c / nu, v)))
        faces = []
        for r in range(nv):
            for c in range(nu):
                a = r * (nu + 1) + c
                f = (a, a + 1, a + nu + 2, a + nu + 1)
                faces.append(tuple(reversed(f)) if flip else f)
        obj = bo.new_mesh_object("p", verts, faces, smooth=True)
        mesh = obj.data
        uv = mesh.uv_layers.new(name="UVMap").data
        vv = [Vector(p) for p in verts]
        rows_per = max(1, nv // chunks)
        mid = nu // 2
        for pi, poly in enumerate(mesh.polygons):
            r = pi // nu
            chunk = r // rows_per
            r0 = chunk * rows_per
            for li, vi in zip(poly.loop_indices, poly.vertices):
                vr, vc = vi // (nu + 1), vi % (nu + 1)
                # arc length along u on this row, along v at the mid column
                ux = sum((vv[vr * (nu + 1) + i + 1] - vv[vr * (nu + 1) + i]).length for i in range(vc))
                uy = sum((vv[(i + 1) * (nu + 1) + mid] - vv[i * (nu + 1) + mid]).length for i in range(r0, vr))
                uv[li].uv = (ux, uy)
        return self._add(obj, mat, w, uv_ready=True)

    def sweep(self, pts, radii, mat, seg=6, w=1.0, fn=None, end_cap=True):
        """Tapered tube along a curve, twist-free. fn(theta, i) multiplies the radius (root flare)."""
        P = [Vector(q) for q in pts]
        n = len(P)
        tangents = []
        for i in range(n):
            a = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            tangents.append(a.normalized())
        ref = Vector((1, 0, 0)) if abs(tangents[0].x) < 0.9 else Vector((0, 1, 0))
        u = tangents[0].cross(ref).normalized()
        verts, faces = [], []
        for i in range(n):
            if i:
                axis = tangents[i - 1].cross(tangents[i])
                if axis.length > 1e-6:
                    ang = tangents[i - 1].angle(tangents[i])
                    u.rotate(Matrix.Rotation(ang, 3, axis.normalized()))
                u = (u - tangents[i] * u.dot(tangents[i])).normalized()
            v = tangents[i].cross(u)
            r = radii[i]
            for sg in range(seg):
                th = 2 * math.pi * sg / seg
                m = fn(th, i) if fn else 1.0
                verts.append(P[i] + (u * math.cos(th) + v * math.sin(th)) * r * m)
        for i in range(n - 1):
            for sg in range(seg):
                a = i * seg + sg
                b = i * seg + (sg + 1) % seg
                faces.append((a, b, b + seg, a + seg))
        faces.append(tuple(reversed(range(seg))))
        if end_cap:
            faces.append(tuple((n - 1) * seg + j for j in range(seg)))
        obj = bo.new_mesh_object("p", [tuple(q) for q in verts], faces)
        bo.recalc_normals(obj)
        return self._add(obj, mat, w)

    def lathe(self, profile, mat, seg=48, chunks=6, w=1.0, wobble=None, a0=0.0, a1=2 * math.pi):
        """Revolve [(r, z), ...] around Z. Order the profile outer-bottom, up, inward, down the inner
        side so normals face out. wobble(a, i) optionally adds a height offset."""
        nu = len(profile) - 1

        def fn(u, v):
            i = int(round((u + 1) * 0.5 * nu))
            r, z = profile[i]
            a = a0 + (a1 - a0) * (v + 1) * 0.5
            if wobble:
                r, z = wobble(a, i, r, z)
            return (r * math.cos(a), r * math.sin(a), z)
        return self.grid(fn, nu, seg, mat, w=w, chunks=chunks, flip=True)

    def rotated(self, obj, angle_z, pivot=(0, 0, 0)):
        """Rotate an already-added part around a vertical axis through pivot."""
        p = Vector(pivot)
        m = Matrix.Translation(p) @ Matrix.Rotation(angle_z, 4, "Z") @ Matrix.Translation(-p)
        obj.matrix_basis = m @ obj.matrix_basis
        return obj

    def empty(self, name, loc, rot=(0, 0, 0)):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.3
        e.location = loc
        e.rotation_euler = rot
        bpy.context.scene.collection.objects.link(e)
        self.empties.append(e)
        return e

    def preview(self, cam, target, lens=35, tag=None):
        self.previews.append((cam, target, lens, tag or f"v{len(self.previews)}"))

    # ---- finish ----
    def _join(self, objs, name):
        """Fast join: evaluates only objects that carry modifiers, keeps UV layers."""
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        bm = bmesh.new()
        materials = []
        for o in objs:
            if o.modifiers:
                mesh = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
            else:
                mesh = o.data.copy()
            mesh.transform(o.matrix_world)
            remap = {}
            for i, mat in enumerate(mesh.materials):
                if mat not in materials:
                    materials.append(mat)
                remap[i] = materials.index(mat)
            start = len(bm.faces)
            bm.from_mesh(mesh)
            bm.faces.ensure_lookup_table()
            for f in bm.faces[start:]:
                f.material_index = remap.get(f.material_index, 0)
            bpy.data.meshes.remove(mesh)
        out = bpy.data.meshes.new(name)
        bm.to_mesh(out)
        bm.free()
        for m in materials:
            out.materials.append(m)
        obj = bpy.data.objects.new(name, out)
        bpy.context.scene.collection.objects.link(obj)
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        return obj

    def _normalise_uv(self, obj, weight):
        """Scale an unwrapped group so its texel density is `weight` (in shared units)."""
        mesh = obj.data
        uv = mesh.uv_layers.active.data
        a3 = a2 = 0.0
        for poly in mesh.polygons:
            a3 += poly.area
            idx = poly.loop_indices
            pts = [uv[i].uv for i in idx]
            s = 0.0
            for i in range(len(pts)):
                p, q = pts[i], pts[(i + 1) % len(pts)]
                s += p.x * q.y - q.x * p.y
            a2 += abs(s) * 0.5
        if a2 <= 0:
            return
        k = math.sqrt(a3 / a2) * weight
        for l in uv:
            l.uv = l.uv * k

    def finish(self, size=1024, normal=None, rm=None, ao=None, samples=10, ao_dist=0.8, ao_strength=0.75, angle=52.0,
               margin=0.004, name="body", cull=True, ao_samples=48, packed=False, split=None):
        """Join parts, shade, unwrap and bake to one material. Call export() and run_previews() after."""
        t0 = time.time()
        keys = sorted({(p[1], p[2] or "", p[3]) for p in self.parts}, key=str)
        if len(keys) == 1 and not packed and not self.inst_defs and not keys[0][2]:
            obj = self._join([p[0] for p in self.parts], name)
            _face_weighted(obj, angle)
            bo.smart_uv(obj, margin=margin)
        else:
            groups = []
            ranges = {}
            start = 0
            for wt, inst, ready in keys:
                g = self._join([p[0] for p in self.parts if (p[1], p[2] or "", p[3]) == (wt, inst, ready)], f"grp{len(groups)}")
                if not ready:
                    bo.smart_uv(g, margin=0.002)
                self._normalise_uv(g, wt)
                n = len(g.data.polygons)
                if inst:
                    ranges.setdefault(inst, []).append((start, n))
                start += n
                groups.append(g)
            obj = self._join(groups, name)
            _pack_all(obj, margin)
            _duplicate_instances(obj, ranges, self.inst_defs)
            _face_weighted(obj, angle)
        _report_density(obj, size)
        print(f"[props] {self.id}: joined and unwrapped in {time.time() - t0:.1f}s")
        t0 = time.time()
        tagged = {}
        for prefix, new_name in (split or {}).items():
            slots = {i for i, m in enumerate(obj.data.materials) if m and m.name.startswith(prefix)}
            tagged[new_name] = [poly.index for poly in obj.data.polygons if poly.material_index in slots]
        mat = bake_set(obj, size=size, normal=normal or size, rm=rm or max(size // 2, 256), ao=ao or max(size // 2, 256),
                       samples=samples, ao_dist=ao_dist, ao_strength=ao_strength, ao_samples=ao_samples, ground=self.ao_ground,
                       name=self.id)
        mat.use_backface_culling = cull
        print(f"[props] {self.id}: baked in {time.time() - t0:.1f}s")
        self.result = obj
        for new_name, faces in tagged.items():
            _split_faces(obj, faces, new_name)
        return obj

    def export(self, quality=84):
        path = os.path.join(bo.PUBLIC_ASSETS, self.folder, f"{self.id}.glb")
        bo.export_glb(path, quality=quality)
        self.path = path
        return path

    def run_previews(self, size=(640, 480), samples=28, ground=True, ground_size=400):
        if not PREVIEW_DIR:
            return
        shots(self.id, self.previews, size=size, samples=samples, ground=ground, ground_size=ground_size)


def _face_weighted(obj, angle=52.0):
    """Sharp edges by angle, smooth the rest, then area-weighted normals so big flats stay flat."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    limit = math.radians(angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if e.is_manifold:
            e.smooth = e.calc_face_angle(0.0) <= limit
        else:
            e.smooth = True
    bm.to_mesh(obj.data)
    bm.free()
    mod = obj.modifiers.new("wn", "WEIGHTED_NORMAL")
    mod.mode = "FACE_AREA"
    mod.weight = 60
    mod.keep_sharp = True
    bo.apply_modifiers(obj)


def _split_faces(obj, faces, new_name):
    """Move faces to a new object that shares the baked material (e.g. an optional attachment)."""
    keep = set(bpy.data.objects)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    want = set(faces)
    for poly in obj.data.polygons:
        poly.select = poly.index in want
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in bpy.data.objects:
        if o not in keep:
            o.name = new_name
            o.data.name = new_name


def _report_density(obj, size):
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    a3 = a2 = 0.0
    for poly in mesh.polygons:
        a3 += poly.area
        pts = [uv[i].uv for i in poly.loop_indices]
        s_ = 0.0
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            s_ += p.x * q.y - q.x * p.y
        a2 += abs(s_) * 0.5
    print(f"[props]   area {a3:.0f} m2, uv area sum {a2:.2f}, mean density {size * math.sqrt(a2 / max(a3, 1e-6)):.0f} px/m, {len(mesh.polygons)} faces")


def _duplicate_instances(obj, ranges, defs):
    """Copy the instanced face ranges with their UVs intact. Mirrored matrices get reversed winding."""
    if not ranges:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    work = []
    for inst, spans in ranges.items():
        faces = []
        for start, n in spans:
            faces += [bm.faces[i] for i in range(start, start + n)]
        work.append((faces, defs[inst]))
    for faces, matrices in work:
        vset, eset = set(), set()
        for f in faces:
            vset.update(f.verts)
            eset.update(f.edges)
        geom = list(vset) + list(eset) + list(faces)
        for mat in matrices:
            ret = bmesh.ops.duplicate(bm, geom=geom)
            new_v = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
            new_f = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace)]
            bmesh.ops.transform(bm, matrix=mat, verts=new_v)
            if mat.to_3x3().determinant() < 0:
                bmesh.ops.reverse_faces(bm, faces=new_f)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _pack_all(obj, margin, shape="CONCAVE"):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True, merge_overlap=False,
                            margin_method="SCALED", margin=margin, shape_method=shape)
    bpy.ops.object.mode_set(mode="OBJECT")


def _retrying_bake(kind, **kw):
    """Bake with patience: the 4 GB GPU is shared, so wait out out-of-memory errors."""
    for attempt in range(8):
        try:
            bpy.ops.object.bake(type=kind, **kw)
            return
        except RuntimeError as exc:
            print(f"[props] bake {kind} failed ({exc}); waiting, attempt {attempt + 1}")
            time.sleep(25 + attempt * 15)
    bpy.context.scene.cycles.device = "CPU"
    bpy.ops.object.bake(type=kind, **kw)


def bake_set(obj, size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.8, ao_strength=0.75, ao_samples=48, ground=True, name=None,
             margin=None):
    """Same result as bo.bake_pbr, with per-map sizes and a low-res soft AO so noise does not bloat the WEBP."""
    scene = bpy.context.scene
    name = name or obj.name
    bo.enable_gpu_cycles(scene, samples=samples)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    margin = margin if margin is not None else max(4, size // 170)
    scene.render.bake.margin = margin
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake")
    scene.world.light_settings.distance = ao_dist

    def run(kind, image, spp=None, **kw):
        t = time.time()
        scene.cycles.samples = spp or samples
        bo._bake_target(obj, image)
        _retrying_bake(kind, **kw)
        print(f"[props]   {kind} {image.size[0]}px {spp or samples}spp {time.time() - t:.1f}s")

    # Bevel in the normal chain is only worth its cost in the normal pass.
    normal_links = []

    def strip_normals():
        for m in obj.data.materials:
            inp = bo.bsdf_of(m).inputs["Normal"]
            if inp.links:
                normal_links.append((m, inp.links[0].from_socket, inp))
                m.node_tree.links.remove(inp.links[0])

    def restore_normals():
        for m, sock, inp in normal_links:
            m.node_tree.links.new(sock, inp)
        normal_links.clear()

    strip_normals()
    albedo = bpy.data.images.new(f"{name}_albedo", size, size, alpha=False)
    saved = bo._neutralise_for_diffuse(obj)
    run("DIFFUSE", albedo, pass_filter={"COLOR"})
    bo._restore_after_diffuse(saved)

    rough = bpy.data.images.new(f"{name}_rough", rm, rm, alpha=False)
    rough.colorspace_settings.name = "Non-Color"
    scene.render.bake.margin = max(4, rm // 170)
    run("ROUGHNESS", rough, spp=3)

    metal = bpy.data.images.new(f"{name}_metal", rm, rm, alpha=False)
    metal.colorspace_settings.name = "Non-Color"
    bo._swap_to_metal_emission(obj)
    run("EMIT", metal, spp=2)
    bo._restore_from_metal_emission(obj)

    restore_normals()
    nrm = bpy.data.images.new(f"{name}_normal", normal, normal, alpha=False)
    nrm.colorspace_settings.name = "Non-Color"
    scene.render.bake.margin = max(4, normal // 170)
    run("NORMAL", nrm, normal_space="TANGENT")
    strip_normals()

    # soft AO: bake small with extra samples, scale up, multiply into albedo
    plane = None
    if ground:
        mesh = bpy.data.meshes.new("bake_ground")
        s = 500.0
        mesh.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        plane = bpy.data.objects.new("bake_ground", mesh)
        scene.collection.objects.link(plane)
    aoi = bpy.data.images.new(f"{name}_ao", ao, ao, alpha=False)
    aoi.colorspace_settings.name = "Non-Color"
    scene.render.bake.margin = max(4, ao // 64)
    run("AO", aoi, spp=ao_samples)
    scene.cycles.samples = samples
    if plane is not None:
        bpy.data.objects.remove(plane, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    if ao != size:
        aoi.scale(size, size)
    bo._multiply_ao_into(albedo, aoi, strength=ao_strength)
    bpy.data.images.remove(aoi)

    mat = bpy.data.materials.new(f"{name}_baked")
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    a = nt.nodes.new("ShaderNodeTexImage")
    a.image = albedo
    nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
    r = nt.nodes.new("ShaderNodeTexImage")
    r.image = rough
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    m = nt.nodes.new("ShaderNodeTexImage")
    m.image = metal
    nt.links.new(m.outputs["Color"], bsdf.inputs["Metallic"])
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = nrm
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    old = list(obj.data.materials)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for o in old:
        if o is not None and o.users == 0:
            bpy.data.materials.remove(o)
    return mat


def shots(asset_id, views, size=(640, 480), samples=28, ground=True, ground_size=400):
    """Render preview views with a warm Dhaka-daylight setup. Files land in PREVIEW_DIR."""
    scene = bpy.context.scene
    bo.enable_gpu_cycles(scene, samples=samples)
    scene.cycles.use_denoising = True
    scene.cycles.transparent_max_bounces = 64
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.58, 0.72, 0.95, 1)
    bg.inputs[1].default_value = 1.0
    scene.world = world
    made = []
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.6
    sun_data.angle = math.radians(5)
    sun_data.color = (1.0, 0.93, 0.82)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-38))
    made.append(sun)
    if ground:
        g = bpy.data.meshes.new("ground")
        s = ground_size / 2
        g.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        g.materials.append(bo.pbr("ground", rgb("#6d6a64"), 0.9))
        go = bpy.data.objects.new("ground", g)
        scene.collection.objects.link(go)
        made.append(go)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.clip_end = 2000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    made.append(cam)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    for view in views:
        loc, tgt, lens, tag = view
        cam_data.lens = lens
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW_DIR, f"{asset_id}_{tag}.png")
        bpy.ops.render.render(write_still=True)
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    scene.world = None


# ---------------------------------------------------------------------------
# Asset registry
# ---------------------------------------------------------------------------
REGISTRY = {}


def asset(asset_id, folder="props"):
    def deco(fn):
        REGISTRY[asset_id] = (fn, folder)
        return fn
    return deco


# === ASSETS BEGIN ===


@asset("metro_pier", "landmarks")
def build_metro_pier():
    k = Kit("metro_pier", "landmarks")
    conc = concrete("pier_conc", seam_h=2.1, seam_w=2.45, seam_line=0.014, ties=(0.61, 0.7, 0.016), drip=0.85, drip_top=METRO_CAP_Z,
                    drip_band=4.0, grime=0.8, grime_h=1.7, soot=0.3, posters=1.0, bevel=0.03)
    cap_conc = concrete("cap_conc", seam_h=1.1, seam_w=1.8, seam_line=0.014, ties=(0.9, 0.55, 0.016), drip=1.0, drip_top=METRO_CAP_Z,
                        drip_band=1.6, grime=0.0, soot=0.35, bevel=0.03)
    collar = hazard("collar_paint", period=0.62, wear=0.75, axis_scale=(1.0, 1.0, 1.0))
    plinth = concrete("plinth", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.5, dust=0.7, bevel=0.03)
    pad = plastic("bearing_pad", rgb("#232220"), rough=0.75, scuff=0.15, dirt=0.0)
    plate = painted("sole_plate", rgb("#5f6264"), wear=0.3, rust=0.45, metallic=0.5, drip=0.3, bevel=0.005)
    pipe = plastic("downpipe", rgb("#4e5350"), rough=0.5, scuff=0.45, dirt=0.3)
    clamp = galv("clamp", rust=0.3)

    # low kerbed plinth on the median, clear of the 1.5 m golchattar radius
    k.loft([{"c": (0, 0, 0.0), "rx": 1.44, "ry": 1.2, "power": 3.0}, {"c": (0, 0, 0.16), "rx": 1.44, "ry": 1.2, "power": 3.0},
            {"c": (0, 0, 0.2), "rx": 1.39, "ry": 1.15, "power": 3.0}], plinth, seg=24)
    # crash collar with worn hazard stripes
    k.loft([{"c": (0, 0, 0.16), "rx": 1.25, "ry": 1.06, "power": 3.2}, {"c": (0, 0, 0.92), "rx": 1.2, "ry": 1.01, "power": 3.2},
            {"c": (0, 0, 1.0), "rx": 1.13, "ry": 0.97, "power": 3.2}], collar, seg=28, start=False)

    # column
    col_rings = []
    for z, rx, ry, p in [(0.9, 1.1, 0.95, 3.4), (2.1, 1.09, 0.94, 3.4), (4.2, 1.06, 0.93, 3.4), (6.3, 1.03, 0.92, 3.4), (7.6, 1.01, 0.92, 3.5)]:
        col_rings.append({"c": (0, 0, z), "rx": rx, "ry": ry, "power": p})
    k.loft(col_rings, conc, seg=32, start=False, end=False)

    # flared hammerhead: horizontal rings whose plan grows into a long rounded bar
    rings = []
    z0, z1 = 7.6, 9.72
    steps = 11
    for i in range(steps + 1):
        z = z0 + (z1 - z0) * i / steps
        t = (2 / math.pi) * math.asin(min(1.0, (z - z0) / (z1 - z0)))
        t = t ** 1.35
        rx = 1.01 + (4.98 - 1.01) * t
        ry = 0.92 + (1.42 - 0.92) * (t ** 0.8)
        p = 3.5 + (7.5 - 3.5) * t
        rings.append({"c": (0, 0, z), "rx": rx, "ry": ry, "power": p})
    rings.append({"c": (0, 0, 10.72), "rx": 4.98, "ry": 1.42, "power": 7.5})
    rings.append({"c": (0, 0, METRO_CAP_Z - 0.02), "rx": 4.92, "ry": 1.37, "power": 7.5})
    rings.append({"c": (0, 0, METRO_CAP_Z), "rx": 4.86, "ry": 1.33, "power": 7.5})
    k.loft(rings, cap_conc, seg=48, start=False)

    # bearing pedestals, elastomeric pads, sole plates and a shear key between the rows
    top = METRO_CAP_Z
    for sx in (-1, 1):
        for bx in METRO_BEARING_X:
            for sy in (-1, 1):
                x, y = sx * bx, sy * METRO_BEARING_Y
                k.box((0.86, 0.72, 0.16), (x, y, top + 0.08), plinth, bevel=0.012)
                k.box((0.66, 0.54, 0.09), (x, y, top + 0.205), pad, bevel=0.008)
                k.box((0.74, 0.62, 0.04), (x, y, top + 0.27), plate, bevel=0.004)
        # rust stain source: anchor stubs on the cap top
        k.box((0.5, 0.5, 0.26), (sx * 2.4, 0, top + 0.13), plinth, bevel=0.02)
    k.box((0.7, 0.42, 0.3), (0, 0, top + 0.15), plinth, bevel=0.02)

    # rainwater downpipe clamped up the +Y face, picks up the span drain
    path = [(0.42, 0.28, top + 0.36), (0.42, 0.9, top + 0.3), (0.42, 1.52, top + 0.2), (0.42, 1.56, top - 0.3), (0.42, 1.54, 9.8), (0.42, 1.42, 9.3),
            (0.42, 1.2, 8.75), (0.42, 1.07, 8.1), (0.42, 1.03, 7.2), (0.42, 1.05, 1.1), (0.42, 1.23, 0.85), (0.42, 1.3, 0.3), (0.42, 1.42, 0.14)]
    k.tube(path, 0.075, pipe, seg=8)
    for z in (1.6, 3.2, 4.8, 6.4, 8.0, 9.5, 10.5):
        y = 1.04 if z < 8.1 else (1.17 if z < 9 else 1.54)
        k.cyl(0.095, 0.05, (0.42, y, z), clamp, seg=10)
        k.box((0.28, 0.09, 0.035), (0.42, y - 0.06, z), clamp)
    # blank pier-number plate
    k.box((0.52, 0.03, 0.3), (0, -0.955, 3.3), painted("plate", rgb("#d9d5c6"), wear=0.3, fade=0.2, rust=0.15, drip=0.5), bevel=0.004)

    k.preview((14, -24, 3), (0, 0, 7.2), 32, "street")
    k.preview((-3.5, -10, 1.5), (0, 0, 8.5), 22, "under")
    k.preview((22, 10, 15), (0, 0, 8.5), 40, "high")
    k.finish(size=2048, normal=2048, rm=1024, ao=1024, samples=10, ao_dist=2.5, ao_strength=0.7, angle=50.0, margin=0.003)
    k.export(quality=84)
    k.run_previews()


def _mirror_section(right):
    """right: points from the centre line outward along the bottom. Returns the whole lower chain, left to right."""
    left = [(-x, z) for x, z in reversed(right) if abs(x) > 1e-6]
    return left + right


GIRDER_RIGHT = [
    (0.0, 12.72), (0.52, 12.72), (0.70, 12.56), (0.82, 11.40), (0.96, 11.25), (3.84, 11.25), (4.00, 11.40),
    (4.42, 12.60), (4.52, 12.70), (4.85, 12.84), (4.88, 13.10), (4.74, 13.2),
]


def metro_track_furniture(k, y0, y1, chunks, conc, w=0.25):
    """Rails, plinths and walkways: rail head and walkway tops are at METRO_RAIL_Z exactly."""
    rail = steel("rail", rgb("#5c5550"), rust=0.7, rough=0.5, metallic=0.6, drip=0.0, wear=0.0)
    head = METRO_RAIL_Z
    rail_sec = [(-0.07, 13.33), (0.07, 13.33), (0.07, 13.35), (0.02, 13.37), (0.02, 13.46), (0.036, 13.47), (0.036, head), (-0.036, head), (-0.036, 13.47), (-0.02, 13.46), (-0.02, 13.37), (-0.07, 13.35)]
    for t in (-METRO_TRACK_X, METRO_TRACK_X):
        for s in (-0.72, 0.72):
            k.prism(rrect(0.5, 0.14, 0.02, 1, t + s, 13.27), y0, y1, conc, chunks, w=w, caps=False)
            k.prism([(x + t + s, z) for x, z in rail_sec], y0, y1, rail, chunks, w=w, caps=False)
    # centre and side walkways with cable-trough lids
    for x0, x1 in ((-0.9, 0.9), (3.72, 4.32), (-4.32, -3.72)):
        cx = (x0 + x1) / 2
        k.prism(rrect(x1 - x0, 0.32, 0.015, 1, cx, METRO_RAIL_Z - 0.16), y0, y1, conc, chunks, w=w, caps=False)


@asset("metro_span", "landmarks")
def build_metro_span():
    k = Kit("metro_span", "landmarks")
    half = METRO_SPAN / 2 - 0.03  # 6 cm expansion gap at each pier
    girder = concrete("girder", seam_h=40.0, seam_w=2.9, seam_line=0.016, ties=(1.45, 40.0, 0.03), drip=0.9, drip_top=12.9, drip_band=1.6,
                      grime=0.0, soot=0.28, dust=0.0, joint_weep=0.7, panel_tone=0.2, bevel=0.03)
    parapet = concrete("parapet", seam_h=40.0, seam_w=2.9, seam_line=0.012, drip=1.0, drip_top=14.45, drip_band=1.4, grime=0.0, soot=0.2, dust=0.5, bevel=0.025)
    deck = concrete("deck", c1=rgb("#8f8775"), c2=rgb("#6f6757"), seam_h=0, drip=0, grime=0, soot=0, dust=0.3, bevel=0)
    barrier = ribbed_sheet("barrier", rgb("#b9b8ab"), period=0.16, axis="z", rust=0.15, drip=1.0)
    post = painted("barrier_post", rgb("#5d6668"), wear=0.3, rust=0.5, metallic=0.4, drip=0.8, bevel=0.0)
    mast = painted("ocs_mast", rgb("#7f8785"), wear=0.2, rust=0.35, metallic=0.5, drip=0.5, bevel=0.0)
    insulator = plastic("insulator", rgb("#6d3c24"), rough=0.3, scuff=0.2, dirt=0.0)
    wire = flat("wire", rgb("#3a2f22"), rough=0.5, metallic=0.5)
    pipe = plastic("drain", rgb("#50554f"), rough=0.5, scuff=0.45, dirt=0.0)
    tray = galv("cable_tray", rust=0.25)
    plate = painted("sole", rgb("#55585a"), wear=0.3, rust=0.6, metallic=0.5, drip=0.3)
    cable = flat("cable", rgb("#171614"), rough=0.6)
    glaze = glass_opaque("barrier_glaze", rgb("#5e7680"))

    # --- twin-box girder, chunked so no UV island is longer than ~9 m ---
    lower = _mirror_section(GIRDER_RIGHT)
    k.prism(lower, -half, half, girder, chunks=4, closed=False, w=1.0)
    k.prism([(-4.74, 13.12), (4.74, 13.12), (4.74, METRO_BED_Z), (-4.74, METRO_BED_Z)], -half, half, deck, chunks=2, caps=False, w=0.2)

    # thicker end blocks over the bearings, with sole plates
    for sy in (-1, 1):
        y = sy * (half - 1.2)
        for sx in (-1, 1):
            k.box((3.18, 2.4, 0.11), (sx * 2.4, y, 11.195), girder, bevel=0.02, w=1.0)
            for bx in METRO_BEARING_X:
                k.box((0.74, 0.62, 0.03), (sx * bx, sy * (half + 0.03 - METRO_BEARING_Y), 11.13), plate)
    # transverse ribs under the wings: strong rhythm from the street
    ribs = int(METRO_SPAN / 2.9)
    for i in range(ribs + 1):
        y = -METRO_SPAN / 2 + 1.45 + i * 2.9
        if abs(y) > half - 0.25:
            continue
        for sx in (-1, 1):
            sec = [(sx * 4.08, 11.72), (sx * 4.8, 12.84), (sx * 4.2, 12.66)]
            k.section_loft([(y - 0.11, sec), (y + 0.11, sec)], girder, w=1.0)
    # drip spouts along the box soffits
    for sx in (-1, 1):
        for i in range(-2, 3):
            k.cyl(0.05, 0.1, (sx * 2.4, i * 5.8 + 1.45, 11.22), cable, seg=8)

    # --- parapet with coping, noise-barrier posts and panels ---
    for sx in (-1, 1):
        sec = [(4.3, 13.2), (4.3, 14.32), (4.37, 14.42), (4.62, 14.42), (4.72, 14.3), (4.78, 13.6), (4.93, 13.26), (4.93, 13.02), (4.7, 13.0)]
        sec = [(sx * x, z) for x, z in sec]
        k.prism(sec, -half, half, parapet, chunks=4, w=0.8)
        # panels at 2.5 m bays
        bays = 14
        bay = METRO_SPAN / bays
        items = []
        for i in range(bays + 1):
            y = -METRO_SPAN / 2 + i * bay
            y = max(-half + 0.1, min(half - 0.1, y))
            k.box((0.1, 0.16, 1.16), (sx * 4.5, y, 14.98), post)
            k.box((0.22, 0.28, 0.03), (sx * 4.5, y, 14.435), post)
        for i in range(bays):
            y = -METRO_SPAN / 2 + (i + 0.5) * bay
            # lower ribbed sheet, mid band, top rail
            k.box((0.05, bay - 0.17, 0.72), (sx * 4.5, y, 14.82), barrier, w=0.6)
            k.box((0.035, bay - 0.17, 0.26), (sx * 4.5, y, 15.34), glaze, w=0.6)
            k.box((0.09, bay - 0.17, 0.05), (sx * 4.5, y, 15.5), post, w=0.6)
            k.box((0.08, bay - 0.17, 0.04), (sx * 4.5, y, 15.19), post, w=0.6)

    metro_track_furniture(k, -half, half, 4, deck)

    # --- drainage and services in the recess between the boxes ---
    k.tube([(0.42, -half + 0.2, 12.42), (0.42, -8.0, 12.42)], 0.08, pipe, seg=8, w=0.7)
    k.tube([(0.42, -8.0, 12.42), (0.42, 4.0, 12.42)], 0.08, pipe, seg=8, w=0.7)
    k.tube([(0.42, 4.0, 12.42), (0.42, 16.9, 12.42), (0.42, 17.25, 12.1), (0.42, 17.6, 11.45), (0.42, 17.78, 11.28)], 0.08, pipe, seg=8, w=0.7)
    for j in range(4):
        y0 = -half + j * (2 * half / 4)
        y1 = y0 + 2 * half / 4
        k.box((0.34, y1 - y0 - 0.02, 0.02), (-0.28, (y0 + y1) / 2, 12.34), tray, w=0.7)
        for sx in (-0.45, -0.11):
            k.box((0.015, y1 - y0 - 0.02, 0.09), (sx, (y0 + y1) / 2, 12.385), tray, w=0.7)
        for cx in (-0.36, -0.28, -0.2):
            k.rod((cx, y0, 12.39), (cx, y1, 12.39), 0.022, cable, seg=5, w=0.7)
    for i in range(12):
        y = -half + 1.4 + i * 2.9
        k.box((0.05, 0.05, 0.34), (0.42, y, 12.56), tray, w=0.7)
        k.box((1.0, 0.05, 0.03), (0.0, y, 12.32), tray, w=0.7)
        k.box((0.05, 0.05, 0.42), (-0.5, y, 12.52), tray, w=0.7)
    # scuppers dropping through the wings, with conduit along one outer web
    for sx in (-1, 1):
        for y in (-13.0, -4.35, 4.35, 13.0):
            k.tube([(sx * 4.62, y, 13.0), (sx * 4.62, y, 12.62), (sx * 4.66, y, 12.5)], 0.045, cable, seg=6, w=0.7)
    for j in range(4):
        y0 = -half + j * (2 * half / 4)
        y1 = y0 + 2 * half / 4
        k.rod((4.26, y0, 12.1), (4.26, y1, 12.1), 0.03, pipe, seg=6, w=0.7)
    for i in range(10):
        y = -half + 1.8 + i * 3.5
        k.box((0.1, 0.05, 0.12), (4.22, y, 12.1), tray, w=0.7)

    # --- overhead catenary: one mast pair mid span, cantilevers over each track ---
    wz, mz = 17.75, 18.75
    for sx in (-1, 1):
        x = sx * 4.56
        k.loft([{"c": (x, 0.42, 14.42), "rx": 0.15, "ry": 0.12, "power": 4}, {"c": (x, 0.42, 19.55), "rx": 0.09, "ry": 0.08, "power": 4}], mast, seg=8, w=0.5)
        k.box((0.5, 0.45, 0.04), (x, 0.42, 14.44), mast, w=0.5)
        tx = sx * METRO_TRACK_X
        # upper tie and lower tube, registration arm
        k.rod((x, 0.42, 19.2), (tx, 0.42, mz + 0.06), 0.035, mast, seg=6, w=0.5)
        k.rod((x, 0.42, 18.15), (tx - sx * 0.3, 0.42, 18.2), 0.04, mast, seg=6, w=0.5)
        k.rod((tx - sx * 0.3, 0.42, 18.2), (tx, 0.42, wz + 0.03), 0.018, mast, seg=5, w=0.5)
        k.rod((tx, 0.42, mz + 0.06), (tx, 0.42, wz + 0.03), 0.012, wire, seg=4, w=0.5)
        for t in (0.12, 0.2):
            px = x + (tx - x) * t
            pz = 19.2 + (mz + 0.06 - 19.2) * t
            k.cyl(0.075, 0.05, (px, 0.42, pz), insulator, seg=8, rot=(0, math.radians(90 - 10 * sx), 0), w=0.5)
            qz = 18.15 + (18.2 - 18.15) * t
            k.cyl(0.075, 0.05, (x + (tx - sx * 0.3 - x) * t, 0.42, qz), insulator, seg=8, rot=(0, math.radians(90), 0), w=0.5)
        # contact and messenger wires, chunked for UVs, droppers every ~4.4 m
        for j in range(4):
            y0 = -METRO_SPAN / 2 + j * METRO_SPAN / 4
            y1 = y0 + METRO_SPAN / 4
            k.rod((tx, y0, wz), (tx, y1, wz), 0.014, wire, seg=4, w=0.5)
            k.rod((tx, y0, mz), (tx, y1, mz), 0.012, wire, seg=4, w=0.5)
        for i in range(8):
            y = -METRO_SPAN / 2 + (i + 0.5) * 4.375
            k.rod((tx, y, mz), (tx, y, wz), 0.005, wire, seg=3, w=0.3)

    k.preview((9, -31, 1.6), (0, 2, 12.5), 24, "under")
    k.preview((-1.5, -6, 1.5), (0, 12, 12.0), 20, "belly")
    k.preview((30, -32, 8), (0, 0, 13.5), 32, "side")
    k.preview((3, -28, 21), (0, 8, 14.5), 30, "deck")
    k.finish(size=2048, normal=2048, rm=1024, ao=1024, samples=8, ao_dist=3.0, ao_strength=0.65, angle=50.0, margin=0.0025, packed=True)
    k.export(quality=84)
    k.run_previews()


def _mirror_x():
    return Matrix.Scale(-1, 4, (1, 0, 0))


def _mirror_y():
    return Matrix.Scale(-1, 4, (0, 1, 0))


def _ty(y):
    return Matrix.Translation((0, y, 0))


STATION_ROOF_CROWN = 23.8


def _station_roof_point(u, v, off=0.0):
    """Boat-shaped thin shell: ridge and eaves both droop towards the ends, a quiet echo of the
    curved Bengal roof line. u across, v along, both in [-1, 1]."""
    y = v * (72.5 - 3.0 * u * u)
    w = 13.4 * (1.0 - 0.06 * abs(v) ** 3)
    crown = STATION_ROOF_CROWN - 1.35 * v * v
    eave = 19.7 - 0.9 * v * v
    a = max(0.0, 1.0 - abs(u) ** 2.2)
    return (u * w, y, eave + (crown - eave) * a ** 0.85 + off)


def _station_roof_at(u, y, off=0.0):
    v = y / (72.5 - 3.0 * u * u)
    return _station_roof_point(u, max(-1.0, min(1.0, v)), off)


def _station_stair(k, conc, conc_dark, canopy, steel_c, rail_c, tread, belt, skirt, pale):
    """Template stair and escalator block on the +X, +Y side, running down away from the middle of the station."""
    x0, x1 = 14.3, 18.7
    ytop, y1, y2, yend = 29.5, 33.0, 46.0, 50.0
    run = y2 - y1
    rise = 7.5

    def floor(y):
        if y <= y1:
            return rise
        if y >= y2:
            return 0.0
        return rise * (y2 - y) / run

    # stepped flight (one mesh)
    steps = 44
    pts = [(ytop, rise), (y1, rise)]
    for i in range(steps):
        y = y1 + i * run / steps
        z = rise - i * rise / steps
        pts.append((y, z - rise / steps))
        pts.append((y + run / steps, z - rise / steps))
    pts += [(yend, 0.0), (yend, -0.05), (y2, -0.05), (y1 + 0.6, 7.0), (ytop, 7.0)]
    k.prism_x(pts, 14.55, 16.42, tread, w=1.0, caps=False)
    # escalator: smooth ramp, dark belt with pale step edges, steel skirts
    belt_sec = [(ytop, rise), (y1, rise), (y2, 0.0), (yend - 2.0, 0.0), (yend - 2.0, -0.05), (y2, -0.05), (y1 + 0.6, 7.0), (ytop, 7.0)]
    k.prism_x(belt_sec, 16.62, 18.4, belt, w=0.8, caps=False)
    for x in (16.62, 17.5, 18.42):
        sec = [(ytop + 0.3, rise + 0.92), (y1, rise + 0.92), (y2, 0.92), (y2 + 1.3, 0.92), (y2 + 1.3, 0.0), (y2, 0.0), (y1, rise), (ytop + 0.3, rise)]
        k.prism_x(sec, x - 0.05, x + 0.05, skirt, w=0.6)
    # side stringer walls and a centre dividing wall
    for xa, xb in ((x0, 14.55), (16.42, 16.62), (18.42, x1)):
        high = 1.05 if xa != 16.42 else 0.95
        sec = [(ytop, rise + high), (y1, rise + high), (y2, high), (y2 + 1.2, high), (y2 + 1.2, 0.0), (y2, -0.05), (y1 + 0.6, 6.9), (ytop, 6.9)]
        k.prism_x(sec, xa, xb, conc, w=1.0)
    # handrails
    for x in (x0 + 0.13, 16.52, x1 - 0.13):
        k.tube([(x, ytop + 0.1, rise + 1.2), (x, y1, rise + 1.2), (x, y2, 1.2), (x, y2 + 1.15, 1.2)], 0.028, rail_c, seg=6, w=0.5)
    # head landing
    k.box((x1 - x0, ytop - 29.0 + 0.8, 0.6), ((x0 + x1) / 2, ytop - 0.1, 7.2), conc, bevel=0.02, w=0.7)
    k.box((0.14, 4.5, 1.05), (x1 - 0.07, ytop + 1.3, 8.0), conc, w=0.7)
    # columns and head beam
    for (cx, cy, r, top) in ((15.0, 31.0, 0.36, 6.5), (18.0, 31.0, 0.36, 6.5), (16.5, 39.5, 0.42, floor(39.5) - 0.45)):
        k.loft([{"c": (cx, cy, 0.0), "rx": r + 0.1, "ry": r + 0.1}, {"c": (cx, cy, 0.25), "rx": r + 0.1, "ry": r + 0.1}, {"c": (cx, cy, 0.3), "rx": r, "ry": r}, {"c": (cx, cy, top), "rx": r, "ry": r}], conc, seg=14, w=0.9)
    k.box((x1 - x0, 1.1, 0.62), ((x0 + x1) / 2, 31.0, 6.7), conc_dark, bevel=0.03, w=0.7)
    # posts carrying the canopy
    for y in (30.0, 34.0, 38.0, 42.0, 46.0, 49.4):
        for x in (x0 + 0.13, x1 - 0.13):
            base = floor(y) + (1.0 if y < 47 else 0.1)
            k.rod((x, y, base), (x, y, floor(y) + (3.05 if y < 47 else 3.2)), 0.05, steel_c, seg=8, w=0.5)
    # vaulted metal canopy following the flight
    stations = []
    for y, zb in ((29.0, rise + 3.0), (y1, rise + 3.0), (y1 + run * 0.33, rise * 0.67 + 3.0), (y1 + run * 0.66, rise * 0.34 + 3.0), (y2, 3.1), (yend + 0.5, 3.2)):
        sec = []
        n = 10
        for i in range(n + 1):
            a = math.pi * i / n
            sec.append((16.5 + 2.62 * math.cos(a), zb + 0.72 * math.sin(a)))
        for i in range(n, -1, -1):
            a = math.pi * i / n
            sec.append((16.5 + 2.56 * math.cos(a), zb - 0.05 + 0.66 * math.sin(a)))
        stations.append((y, sec))
    k.section_loft(stations, canopy, w=0.6)
    # entry fascia with a blank board, low kerb and bollards
    k.box((5.1, 0.08, 0.5), (16.5, yend + 0.5, 3.0), pale, bevel=0.01, w=0.7)
    k.box((5.0, 0.3, 0.14), (16.5, yend + 0.12, 0.07), conc_dark, bevel=0.01, w=0.5)
    for x in (15.0, 16.5, 18.0):
        k.cyl(0.075, 0.7, (x, yend + 1.2, 0.35), steel_c, seg=8, w=0.3)
        k.sphere(0.078, (x, yend + 1.2, 0.71), steel_c, seg=8, rings=4, w=0.3)
    # stacked service conduit up one stringer
    k.tube([(x1 + 0.05, y2, 0.2), (x1 + 0.05, y1, rise - 0.2), (x1 + 0.05, ytop, rise - 0.2)], 0.035, steel_c, seg=5, w=0.3)


@asset("metro_station", "landmarks")
def build_metro_station():
    k = Kit("metro_station", "landmarks")
    conc = concrete("st_conc", seam_h=1.8, seam_w=2.2, seam_line=0.018, ties=(1.1, 0.9, 0.022), drip=0.85, drip_top=7.2, drip_band=2.6, grime=0.85, grime_h=1.8,
                    soot=0.3, posters=1.0, bevel=0.05)
    conc_dark = concrete("st_conc2", c1=rgb("#bfb5a1"), c2=rgb("#9d9380"), seam_h=0, seam_w=3.5, drip=0.5, grime=0.3, soot=0.22, dust=0.2, bevel=0.03)
    slab = concrete("st_slab", c1=rgb("#d6d0c0"), c2=rgb("#b5af9f"), seam_h=40.0, seam_w=3.5, seam_line=0.02, drip=0.8, drip_top=7.5, drip_band=0.6, grime=0.0, soot=0.18, dust=0.0, joint_weep=0.35, bevel=0.03)
    girder = concrete("st_girder", seam_h=40.0, seam_w=2.9, seam_line=0.018, drip=0.9, drip_top=12.9, drip_band=1.6, grime=0.0, soot=0.28, dust=0.0, joint_weep=0.6, bevel=0.03)
    deck = concrete("st_deck", c1=rgb("#8f8775"), c2=rgb("#6f6757"), seam_h=0, drip=0, grime=0, soot=0, dust=0.3, bevel=0)
    tile = painted("st_platform", rgb("#b9b5a7"), wear=0.0, fade=0.1, dirt=0.2, rust=0, drip=0, rough=0.5, bevel=0)
    tactile = flat("st_tactile", rgb("#c9a02a"), rough=0.6)
    glass = glass_opaque("st_glass", rgb("#2c4a50"), dirt=0.3)
    glass_hi = glass_opaque("st_glass_hi", rgb("#3b6068"), dirt=0.15)
    fin = painted("st_fin", rgb("#d5d4cb"), under=rgb("#8a8a84"), wear=0.15, fade=0.1, dirt=0.25, rust=0.05, rough=0.42, metallic=0.25, drip=0.7, bevel=0)
    panel = painted("st_panel", rgb("#c4c6bf"), under=rgb("#8a8a84"), wear=0.12, fade=0.2, dirt=0.3, rust=0.05, rough=0.45, metallic=0.25, drip=0.9, bevel=0, scale=0.6)
    dark = painted("st_dark", rgb("#3f4649"), wear=0.2, rust=0.15, rough=0.5, metallic=0.4, drip=0.3, bevel=0)
    screen = jaali("st_jaali", rgb("#d3d1c6"), rgb("#47535a"), period=0.46)
    band_green = painted("st_band_g", rgb("#17654a"), under=rgb("#70705f"), wear=0.15, fade=0.35, dirt=0.2, rust=0.0, rough=0.42, metallic=0.1, drip=0.7, bevel=0)
    band_red = painted("st_band_r", rgb("#b52d2b"), under=rgb("#70705f"), wear=0.15, fade=0.35, dirt=0.2, rust=0.0, rough=0.42, metallic=0.1, drip=0.5, bevel=0)
    roof_mat = bo.pbr("st_roof", rgb("#a9aeae"), 0.42, 0.55)
    g = G(roof_mat)
    col = g.mix(rgb("#c9c9c2"), rgb("#aeb0aa"), g.smooth(g.noise(scale=0.1, detail=4.0), 0.34, 0.66))
    col = g.mix(col, rgb("#857f70"), g.mul(g.smooth(g.noise(vec=g.vscale((0.25, 0.9, 2.5)), scale=1.0, detail=4.0), 0.55, 0.72), 0.45))
    seams = g.line(g.y, 1.4, 0.05)
    col = g.mix(col, rgb("#50534f"), g.mul(seams, 0.6))
    g.color(col)
    g.rough(0.45)
    g.surface(g.mul(seams, 1.0), strength=0.8, distance=0.06)
    roof_under = painted("st_roof_u", rgb("#e0ddd2"), under=rgb("#a0a097"), wear=0.05, fade=0.1, dirt=0.0, rust=0.05, rough=0.6, drip=0.3, bevel=0, scale=0.3)
    rib = painted("st_rib", rgb("#e7e5da"), under=rgb("#a9a79c"), wear=0.2, fade=0.1, dirt=0.3, rust=0.1, rough=0.42, metallic=0.1, drip=0.6, bevel=0)
    canopy = ribbed_sheet("st_canopy", rgb("#d3d4ca"), period=0.8, axis="y", rust=0.05, drip=0.35, depth=0.25)
    steel_c = painted("st_steel", rgb("#6a7071"), wear=0.25, rust=0.3, rough=0.5, metallic=0.45, drip=0.4, bevel=0)
    rail_c = galv("st_rail", rust=0.1)
    tread = concrete("st_tread", c1=rgb("#8f8a7f"), c2=rgb("#6c675c"), seam_h=0, drip=0, grime=0.2, soot=0, dust=0.5, bevel=0.015)
    belt_m = bo.pbr("st_belt", rgb("#2b2c2d"), 0.5, 0.4)
    g = G(belt_m)
    g.color(g.mix(rgb("#26282a"), rgb("#b69a2b"), g.line(g.y, 0.4, 0.018)))
    skirt = galv("st_skirt", rgb("#b3b6b4"), rust=0.02)
    pale = painted("st_pale", rgb("#dfdccf"), wear=0.2, rust=0.1, drip=0.7, bevel=0)
    lamp_box = flat("st_lamp", rgb("#f3ecd8"), rough=0.3)
    pipe = plastic("st_pipe", rgb("#5a5e58"), rough=0.5, scuff=0.45, dirt=0)
    wire = flat("st_wire", rgb("#3a2f22"), rough=0.5, metallic=0.5)
    collar = hazard("st_collar", period=0.62, wear=0.7)
    plinth = concrete("st_plinth", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.5, dust=0.7, bevel=0.03)

    half = 70.0 - 0.03

    # ---- portal frames straddling the road: seven frames share one set of texels ----
    frames = (-63.0, -42.0, -21.0, 21.0, 42.0, 63.0)
    k.begin_instances([_ty(y) for y in frames], "portal")
    sec = [(14.0, 0.0), (14.0, 7.2), (-14.0, 7.2), (-14.0, 0.0), (-11.9, 0.0), (-11.9, 4.1)]
    arc = []
    for i in range(1, 8):
        t = i / 7
        arc.append((11.9 - 2.7 * (1 - math.cos(t * math.pi / 2)), 4.1 + 2.15 * math.sin(t * math.pi / 2)))
    sec += [(-x, z) for x, z in arc]
    sec += list(reversed(arc))
    sec += [(11.9, 4.1), (11.9, 0.0)]
    k.section_loft([(-1.1, sec), (1.1, sec)], conc, w=1.0)
    for sx in (-1, 1):
        x = sx * 12.95
        k.box((2.5, 2.6, 0.2), (x, 0, 0.1), plinth, bevel=0.03, w=0.8)
        k.box((2.26, 2.36, 0.85), (x, 0, 0.62), collar, bevel=0.03, w=0.8)
    # upper columns to the platform level
    for sx in (-1, 1):
        k.loft([{"c": (sx * 6.5, 0, 7.2), "rx": 0.72, "ry": 0.72, "power": 2.6}, {"c": (sx * 6.5, 0, 10.0), "rx": 0.62, "ry": 0.62, "power": 2.6}, {"c": (sx * 6.5, 0, 10.75), "rx": 1.0, "ry": 0.85, "power": 3.2}], conc_dark, seg=18, w=0.5)
    k.box((12.4, 1.4, 0.62), (0, 0, 10.94), conc_dark, bevel=0.03, w=0.5)
    # rainwater pipes down the legs
    for sx in (-1, 1):
        k.tube([(sx * 14.08, 1.0, 7.2), (sx * 14.08, 1.0, 0.25), (sx * 14.3, 1.0, 0.08)], 0.07, pipe, seg=7, w=0.4)
    k.end_instances()

    # ---- concourse: floor, beams, walls ----
    secs = rrect(28.4, 0.32, 0.03, 1, 0, 7.36)
    k.prism(secs, -46.0, 46.0, slab, chunks=8, w=0.55)
    for x in (-9.6, -4.4, 4.4, 9.6):
        k.prism(rrect(0.75, 0.68, 0.04, 1, x, 6.86), -46.0, 46.0, conc_dark, chunks=7, w=0.55, caps=True)
    # underside light boxes and service runs, repeated bay by bay
    k.begin_instances([_ty(y) for y in (-63.0, -42.0, -21.0, 21.0, 42.0)], "soffit")
    for x in (-7.0, -2.0, 2.0, 7.0):
        for y in (3.0, 7.5, 12.0, 16.5):
            if y == 7.5 and abs(x) < 3:
                continue
            k.box((0.32, 1.7, 0.07), (x, y + 0.0, 7.16), lamp_box, w=0.3)
    k.rod((11.0, 1.2, 6.92), (11.0, 19.8, 6.92), 0.09, pipe, seg=7, w=0.3)
    k.rod((-11.0, 1.2, 6.92), (-11.0, 19.8, 6.92), 0.09, pipe, seg=7, w=0.3)
    k.rod((10.6, 1.2, 6.98), (10.6, 19.8, 6.98), 0.04, dark, seg=6, w=0.3)
    k.end_instances()
    k.box((28.5, 0.34, 0.5), (0, -46.12, 7.3), slab, bevel=0.02, w=0.5)
    k.box((28.5, 0.34, 0.5), (0, 46.12, 7.3), slab, bevel=0.02, w=0.5)

    # Curtain-wall module: four bays, 23 m long, on the +X side
    L = 23.0
    conc_mats = [_ty(L * i) for i in range(1, 4)] + [_mirror_x()] + [_ty(L * i) @ _mirror_x() for i in range(1, 4)]
    k.begin_instances(conc_mats, "concourse_wall")
    x = 14.2
    y0 = -46.0
    for b in range(4):
        ya = y0 + b * L / 4
        yb = ya + L / 4
        ym = (ya + yb) / 2
        k.box((0.06, yb - ya, 1.1), (x - 0.03, ym, 8.05), panel, w=0.5)
        k.box((0.05, yb - ya, 3.0), (x - 0.03, ym, 10.1), glass if b % 2 else glass_hi, w=0.5)
        k.box((0.05, yb - ya, 1.1), (x - 0.01, ym, 12.15), screen, w=0.7)
        for t in (1 / 3, 2 / 3):
            k.box((0.08, 0.07, 3.0), (x + 0.01, ya + (yb - ya) * t, 10.1), dark, w=0.3)
        k.box((0.08, yb - ya, 0.08), (x + 0.01, ym, 8.62), dark, w=0.3)
        k.box((0.08, yb - ya, 0.08), (x + 0.01, ym, 11.6), dark, w=0.3)
        k.box((0.5, 0.15, 5.3), (x + 0.22, ya, 10.15), fin, bevel=0.01, w=0.5)
    k.box((0.5, 0.15, 5.3), (x + 0.22, y0 + L, 10.15), fin, bevel=0.01, w=0.5)
    k.box((0.52, L, 0.42), (x + 0.16, y0 + L / 2, 12.98), band_green, w=0.5)
    k.box((0.54, L, 0.13), (x + 0.17, y0 + L / 2, 12.72), band_red, w=0.5)
    k.end_instances()

    # concourse ends over the road, carrying the station sign boards
    k.begin_instances([_mirror_y()], "concourse_end")
    y = -46.0
    for i in range(-3, 3):
        xa = i * 14.2 / 3
        xb = xa + 14.2 / 3
        xm = (xa + xb) / 2
        k.box((xb - xa, 0.06, 1.1), (xm, y, 8.05), panel, w=0.5)
        k.box((xb - xa, 0.05, 3.0), (xm, y, 10.1), glass_hi if i % 2 else glass, w=0.5)
        k.box((xb - xa, 0.05, 1.1), (xm, y, 12.15), screen, w=0.6)
        k.box((0.15, 0.5, 5.3), (xa, y - 0.22, 10.15), fin, bevel=0.01, w=0.5)
    k.box((0.15, 0.5, 5.3), (14.2, y - 0.22, 10.15), fin, bevel=0.01, w=0.5)
    k.box((28.6, 0.52, 0.42), (0, y - 0.16, 12.98), band_green, w=0.5)
    k.box((28.6, 0.54, 0.13), (0, y - 0.17, 12.72), band_red, w=0.5)
    # sign board: blank dark green panel with a steel frame, the game lays its Bangla name on sign_1/sign_2
    k.box((11.2, 0.16, 2.6), (0, y - 0.46, 10.2), band_green, bevel=0.02, w=0.8)
    k.box((11.5, 0.1, 0.14), (0, y - 0.46, 11.53), dark, w=0.5)
    k.box((11.5, 0.1, 0.14), (0, y - 0.46, 8.87), dark, w=0.5)
    k.end_instances()
    k.empty("sign_1", (0, -46.0 - 0.56, 10.2))
    k.empty("sign_2", (0, 46.0 + 0.56, 10.2), (0, 0, math.pi))

    # wing roofs over the concourse, either side of the platform hall
    for sx in (-1, 1):
        secw = rrect(3.8, 0.12, 0.02, 1, sx * 12.5, 12.74)
        k.prism(secw, -46.0, 46.0, panel, chunks=5, w=0.2)
    # ---- platform level ----
    k.prism([(-10.85, 12.6), (10.85, 12.6), (10.85, 13.2), (-10.85, 13.2)], -46.0, 46.0, deck, chunks=4, w=0.12)
    for sy in (-1, 1):
        ya, yb = (46.0, half) if sy > 0 else (-half, -46.0)
        k.prism(_mirror_section(GIRDER_RIGHT), ya, yb, girder, chunks=3, closed=False, w=0.8)
        k.prism([(-4.74, 13.12), (4.74, 13.12), (4.74, METRO_BED_Z), (-4.74, METRO_BED_Z)], ya, yb, deck, chunks=1, caps=False, w=0.12)
    for sx in (-1, 1):
        k.prism([(sx * 3.86, 13.2), (sx * 10.85, 13.2), (sx * 10.85, METRO_RAIL_Z + 1.1), (sx * 3.86, METRO_RAIL_Z + 1.1)], -half, half, tile, chunks=12, w=0.2)
        k.prism(rrect(0.42, 0.02, 0.005, 1, sx * 4.2, METRO_RAIL_Z + 1.11), -half, half, tactile, chunks=12, w=0.08, caps=False)
    # wing soffits and struts beyond the concourse
    for sy in (-1, 1):
        ya, yb = (46.0, half) if sy > 0 else (-half, -46.0)
        for sx in (-1, 1):
            k.prism([(sx * 4.86, 12.85), (sx * 11.0, 13.55), (sx * 11.0, 13.75), (sx * 4.86, 13.5)], ya, yb, slab, chunks=2, w=0.5)
    metro_track_furniture(k, -half, half, 16, deck, w=0.1)

    # hall wall modules, full length
    H = 140.0 / 6
    hall_mats = [_ty(H * i) for i in range(1, 6)] + [_mirror_x()] + [_ty(H * i) @ _mirror_x() for i in range(1, 6)]
    k.begin_instances(hall_mats, "hall_wall")
    x = 10.8
    y0 = -70.0
    for b in range(4):
        ya = y0 + b * H / 4
        yb = ya + H / 4
        ym = (ya + yb) / 2
        k.box((0.1, yb - ya, 1.9), (x, ym, 13.7), panel, w=0.35)
        if b % 2 == 0:
            k.box((0.05, yb - ya, 4.6), (x, ym, 16.95), glass, w=0.35)
            for t in (0.25, 0.5, 0.75):
                k.box((0.09, 0.06, 4.6), (x + 0.02, ya + (yb - ya) * t, 16.95), dark, w=0.2)
            k.box((0.09, yb - ya, 0.07), (x + 0.02, ym, 16.0), dark, w=0.2)
        else:
            k.box((0.06, yb - ya, 4.6), (x, ym, 16.95), screen, w=0.6)
        k.box((0.4, 0.14, 6.6), (x + 0.15, ya, 15.95), fin, w=0.35)
    k.box((0.4, 0.14, 6.6), (x + 0.15, y0 + H, 15.95), fin, w=0.35)
    k.box((0.26, H, 0.28), (x + 0.05, y0 + H / 2, 19.3), dark, w=0.25)
    k.box((0.3, H, 0.1), (x + 0.05, y0 + H / 2, 14.72), fin, w=0.25)
    k.end_instances()

    # platform columns and half-height platform doors
    plat_z = METRO_RAIL_Z + 1.1
    k.begin_instances([_ty(H * i) for i in range(1, 6)] + [_mirror_x()] + [_ty(H * i) @ _mirror_x() for i in range(1, 6)], "platform")
    for b in range(2):
        y = -70.0 + (b + 0.5) * H / 2
        k.cyl(0.28, 21.2 - plat_z, (7.6, y, (21.2 + plat_z) / 2), roof_under, seg=12, w=0.1)
    k.box((0.06, H, 1.3), (3.92, -70.0 + H / 2, plat_z + 0.65), glass_hi, w=0.08)
    k.box((0.1, H, 0.06), (3.92, -70.0 + H / 2, plat_z + 1.33), steel_c, w=0.08)
    k.end_instances()

    # ---- the big roof ----
    k.grid(lambda u, v: _station_roof_point(u, v), 28, 20, roof_mat, w=0.32, chunks=5)
    k.grid(lambda u, v: _station_roof_point(u, v, -0.42), 28, 20, roof_under, w=0.42, chunks=5, flip=True)
    # fascia strips close the shell, deep at the eaves and bowed along the ends
    for sx, fl in ((1, True), (-1, False)):
        k.grid(lambda a, b, s=sx: _station_roof_point(s * 1.0, b, (a - 1.0) * 0.32), 1, 20, fin, w=0.6, chunks=4, flip=fl)
    for sv, fl in ((1, False), (-1, True)):
        k.grid(lambda a, b, s=sv: _station_roof_point(b, s * 1.0, (a - 1.0) * 0.32), 1, 28, fin, w=0.6, chunks=2, flip=not fl)
    # arched exposed ribs landing on the concourse roof: the station's silhouette rhythm
    for i in range(-6, 7):
        y = i * 10.5
        pts = []
        for j in range(15):
            u = -1.015 + 2.03 * j / 14
            pts.append(_station_roof_at(u, y, 0.2))
        base_l = (-11.3, y, 12.86)
        base_r = (11.3, y, 12.86)
        edge_l = (-13.0, y, pts[0][2] - 1.3)
        edge_r = (13.0, y, pts[-1][2] - 1.3)
        k.tube([base_l, edge_l] + pts + [edge_r, base_r], 0.17, rib, seg=4, w=0.4)
        for sx in (-1, 1):
            k.box((0.9, 0.7, 0.14), (sx * 11.3, y, 12.9), steel_c, bevel=0.01, w=0.2)
    # ridge skylight following the crown
    for c in range(8):
        ya = -66.0 + c * 16.5
        stations = []
        for j in range(3):
            y = ya + j * 8.25
            zc = _station_roof_at(0.0, y)[2]
            ze = _station_roof_at(1.9 / 13.2, y)[2]
            stations.append((y, [(-1.9, ze - 0.02), (1.9, ze - 0.02), (1.6, zc + 0.28), (-1.6, zc + 0.28)]))
        k.section_loft(stations, glass_hi, w=0.3)
    for i in range(-11, 12):
        y = i * 5.5 + 0.0
        zc = _station_roof_at(0.0, y)[2]
        k.box((3.5, 0.08, 0.1), (0, y, zc + 0.3), rib, w=0.15)

    # glazed tympanums at both ends
    k.begin_instances([_mirror_y()], "gable")
    y = -70.0
    cols = 16
    vert, face = [], []
    for i in range(cols + 1):
        xx = -10.8 + 21.6 * i / cols
        zr = _station_roof_at(xx / 13.3, y, -0.45)[2]
        vert.append((xx, y, 19.15))
        vert.append((xx, y, zr))
        if i:
            b = i * 2
            face.append((b - 2, b, b + 1, b - 1))
    k.mesh(vert, face, glass_hi, w=0.5, smooth=False)
    for i in range(cols + 1):
        xx = -10.8 + 21.6 * i / cols
        zr = _station_roof_at(xx / 13.3, y, -0.42)[2]
        k.box((0.1, 0.14, zr - 19.15), (xx, y - 0.05, (zr + 19.15) / 2), fin, w=0.25)
    k.box((21.8, 0.5, 0.5), (0, y, 19.05), dark, bevel=0.015, w=0.4)
    for sx in (-1, 1):
        cx = sx * 7.75
        k.box((6.1, 0.08, 4.3), (cx, y, 16.75), screen, w=0.6)
        k.box((6.1, 0.14, 0.14), (cx, y, 14.67), dark, w=0.3)
        k.box((0.28, 0.4, 5.0), (sx * 4.7, y, 16.4), fin, bevel=0.01, w=0.4)
    k.end_instances()

    # stair blocks: one template, mirrored to all four corners
    k.begin_instances([_mirror_x(), _mirror_y(), _mirror_x() @ _mirror_y()], "stairs")
    _station_stair(k, conc, conc_dark, canopy, steel_c, rail_c, tread, belt_m, skirt, pale)
    k.end_instances()

    # catenary hung from the roof through the hall, same heights as the spans
    wz, mz = 17.75, 18.75
    for sx in (-1, 1):
        tx = sx * METRO_TRACK_X
        for j in range(16):
            ya = -70.0 + j * 140.0 / 16
            yb = ya + 140.0 / 16
            k.rod((tx, ya, wz), (tx, yb, wz), 0.014, wire, seg=4, w=0.1)
            k.rod((tx, ya, mz), (tx, yb, mz), 0.012, wire, seg=4, w=0.1)
        for i in range(-6, 7):
            y = i * 10.5
            k.rod((tx, y, mz), (tx, y, 22.0), 0.03, steel_c, seg=5, w=0.1)

    k.preview((8, -105, 1.7), (0, 0, 13), 28, "road")
    k.preview((48, -95, 8), (0, -10, 14), 32, "corner")
    k.preview((3, -30, 1.6), (0, 8, 7.2), 22, "under")
    k.preview((27, -66, 1.7), (16, -44, 4), 30, "foot")
    k.preview((80, -60, 45), (0, 0, 14), 32, "high")
    k.finish(size=2048, normal=2048, rm=1024, ao=1024, samples=8, ao_dist=4.0, ao_strength=0.65, angle=50.0, margin=0.002, packed=True)
    k.export(quality=84)
    k.run_previews(size=(800, 500), ground_size=800)



def _kettle(k, cx, cy, z0, scale, alu, handle, soot_col=None):
    """Big round-bellied tea kettle with long spout and over-the-top wire handle. About 240 tris."""
    s = scale
    rings = [(0.0, 0.11), (0.05, 0.172), (0.13, 0.18), (0.2, 0.145), (0.255, 0.092), (0.272, 0.098)]
    k.loft([{"c": (cx, cy, z0 + z * s), "rx": r * s, "ry": r * s} for z, r in rings], alu, seg=12)
    k.loft([{"c": (cx, cy, z0 + 0.272 * s), "rx": 0.096 * s, "ry": 0.096 * s}, {"c": (cx, cy, z0 + 0.3 * s), "rx": 0.04 * s, "ry": 0.04 * s}], alu, seg=8, start=False)
    k.cyl(0.02 * s, 0.03 * s, (cx, cy, z0 + 0.315 * s), handle, seg=5)
    spout = [(cx + 0.14 * s, cy, z0 + 0.09 * s), (cx + 0.215 * s, cy, z0 + 0.15 * s), (cx + 0.275 * s, cy, z0 + 0.25 * s), (cx + 0.35 * s, cy, z0 + 0.3 * s)]
    k.sweep(spout, [0.03 * s, 0.021 * s, 0.021 * s, 0.027 * s], alu, seg=6)
    hoop = []
    for i in range(7):
        a = math.pi * i / 6
        hoop.append((cx + math.cos(a) * 0.15 * s, cy, z0 + 0.25 * s + math.sin(a) * 0.17 * s))
    k.tube(hoop, 0.009 * s, handle, seg=4)


def _jar(k, x, y, z0, r, h, body, lid):
    rings = [(0.0, 0.92), (h - 0.05, 1.0), (h, 0.76)]
    k.loft([{"c": (x, y, z0 + a), "rx": r * b, "ry": r * b} for a, b in rings], body, seg=8)
    k.loft([{"c": (x, y, z0 + h - 0.002), "rx": r * 0.82, "ry": r * 0.82}, {"c": (x, y, z0 + h + 0.034), "rx": r * 0.8, "ry": r * 0.8}], lid, seg=8, start=False)


def _biscuit_glass(name, tone_a, tone_b, cell=38.0):
    """Opaque stand-in for a glass jar packed with biscuits: golden cells under a glossy surface."""
    mat = bo.pbr(name, tone_a, 0.14)
    g = G(mat)
    d, c = g.voronoi(scale=cell)
    pick = g.rgbf(c)
    col = g.mix(tone_a, tone_b, pick)
    col = g.mix(col, mul3(tone_b, 0.6), g.smooth(d, 0.36, 0.52))
    # pale band of empty glass at the shoulder, dark edge at the base
    col = g.mix(col, rgb("#cdd6d2"), g.mul(g.smooth(g.noise(vec=g.vscale((4.0, 4.0, 1.5)), scale=1.0, detail=2.0), 0.6, 0.7), 0.35))
    g.color(col)
    g.rough(0.13)
    return mat


def _banana_bunch(k, x, y, z, ripe, stem_mat, count=12, spread=1.0):
    """Hanging bunch: bent stalk with three short hands of curved fingers."""
    k.sweep([(x, y, z + 0.28), (x + 0.01, y, z + 0.02), (x, y, z - 0.2)], [0.012, 0.018, 0.014], stem_mat, seg=5)
    rows = 3
    per = count // rows
    for row in range(rows):
        h = z + 0.09 - row * 0.095
        for i in range(per):
            a = 2 * math.pi * i / per + row * 0.55
            ca, sa = math.cos(a), math.sin(a)
            pts, rad = [], []
            for t, rr, dz in ((0.0, 0.022, 0.0), (0.42, 0.08, -0.04), (0.75, 0.1, -0.092), (1.0, 0.104, -0.15)):
                pts.append((x + ca * rr * spread, y + sa * rr * spread, h + dz))
                rad.append(0.008 + 0.012 * math.sin(min(1.0, t * 1.15) * math.pi) ** 0.5)
            k.sweep(pts, rad, ripe, seg=5, end_cap=False)


def _pillow_packs(k, positions, mat, size=(0.1, 0.018, 0.13), w=1.0):
    """Hanging foil snack packets: crimped top and bottom edges, puffed middle, 8 tris each."""
    verts, faces = [], []
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    for x, y, z, tilt in positions:
        b = len(verts)
        ox = math.sin(tilt) * sz
        verts += [(x + ox - sx, y, z + sz), (x + ox + sx, y, z + sz),
                  (x - sx, y - sy, z), (x + sx, y - sy, z),
                  (x - ox - sx, y, z - sz), (x - ox + sx, y, z - sz),
                  (x - sx, y + sy, z), (x + sx, y + sy, z)]
        faces += [(b + 2, b + 3, b + 1, b), (b + 4, b + 5, b + 3, b + 2), (b, b + 1, b + 7, b + 6), (b + 6, b + 7, b + 5, b + 4)]
    obj = bo.new_mesh_object("p", verts, faces, smooth=False)
    return k._add(obj, mat, w)


def _foil(name, color, rough=0.25):
    """Glossy snack foil with a contrasting printed block, no text."""
    mat = bo.pbr(name, color, rough, 0.3)
    g = G(mat)
    band = g.gt(g.fract(g.mul(g.z, 8.0)), 0.62)
    col = g.mix(color, lerp3(color, (1, 1, 0.88), 0.55), g.mul(band, 0.85))
    col = g.mix(col, rgb("#d6d6d2"), g.smooth(g.fract(g.mul(g.z, 8.0)), 0.92, 0.97))
    g.color(col)
    g.rough(rough)
    return mat


def tarp_cloth(name, color, stripe_col, stripe=0.5, fade=0.7):
    """Sun-faded tarp: broad stripes along X, bleached cloud blotches, dark runs and a few repairs."""
    mat = bo.pbr(name, color, 0.9)
    g = G(mat)
    band = g.gt(g.fract(g.div(g.x, stripe)), 0.86)
    base = g.mix(color, lerp3(stripe_col, rgb("#d8cfb4"), 0.25), band)
    col = g.mix(base, lerp3(color, rgb("#ddd2bb"), 0.55), g.mulc(g.smooth(g.noise(scale=1.1, detail=5.0, rough=0.6), 0.3, 0.68), fade))
    col = g.mix(col, mul3(color, 0.5), g.mul(g.smooth(g.noise(vec=g.vscale((1.0, 7.0, 7.0)), scale=1.0, detail=5.0), 0.52, 0.7), 0.45))
    col = g.mix(col, rgb("#3d362b"), g.mul(g.smooth(g.noise(scale=4.0, detail=6.0), 0.62, 0.75), 0.3))
    wx = g.m("SINE", g.mul(g.x, 260.0))
    wy = g.m("SINE", g.mul(g.y, 260.0))
    g.color(col)
    g.rough(0.92)
    g.surface(g.add(wx, wy), strength=0.15, distance=0.003)
    return mat


def _rope(k, pts, mat, r=0.006):
    k.tube(pts, r, mat, seg=4)


def _lash(k, loc, r, mat, h=0.07):
    """Rope lashing on a pole joint: a chunky ribbed collar."""
    for i in range(3):
        k.cyl(r + 0.006, 0.02, (loc[0], loc[1], loc[2] - h / 2 + i * h / 3), mat, seg=8)


@asset("tea_stall")
def build_tea_stall():
    """Budget under 4500 tris: boxes stay unbevelled (the Bevel shader rounds them in the normal
    bake) and round things drop to 5-12 sides. Every recognisable item is still there."""
    k = Kit("tea_stall", "props")
    teal = painted("ts_teal", rgb("#2f7f7c"), under=rgb("#8f7654"), wear=0.42, fade=0.7, dirt=0.5, grain="z", drip=0.8, rough=0.62, edge=0.012, scale=2.4)
    teal2 = painted("ts_teal2", rgb("#3f9389"), under=rgb("#84694a"), wear=0.48, fade=0.8, dirt=0.5, grain="z", drip=0.9, rough=0.62, edge=0.012, scale=2.1)
    red_panel = painted("ts_red", rgb("#b23a2a"), under=rgb("#8f7654"), wear=0.4, fade=0.7, dirt=0.4, grain="x", drip=0.6, rough=0.6, scale=2.4)
    yellow = painted("ts_yellow", rgb("#d8a42a"), under=rgb("#8f7654"), wear=0.4, fade=0.6, dirt=0.4, grain="x", drip=0.5, rough=0.6, scale=2.4)
    top_wood = wood("ts_top", rgb("#7a5b3a"), axis="x", wear=0.5, plank=0.21)
    plank = wood("ts_plank", rgb("#8d6b45"), axis="x", wear=0.4)
    leg_wood = wood("ts_leg", rgb("#6a4e33"), axis="z", wear=0.25)
    bench_wood = wood("ts_bench", rgb("#92704a"), axis="x", wear=0.55)
    bench_wood2 = wood("ts_bench2", rgb("#7b5c3b"), axis="y", wear=0.5)
    tin = galv("ts_tin", rust=0.25, scale=2.0)
    alu = aluminium("ts_alu", soot_top=1.36, soot_low=1.22)
    alu2 = aluminium("ts_alu2", soot_top=1.08, soot_low=1.0)
    handle = steel("ts_handle", rgb("#5a544a"), rust=0.4, metallic=0.6, drip=0.0)
    stove_tin = painted("ts_stove", rgb("#403c36"), under=rgb("#6c4524"), wear=0.5, fade=0.1, dirt=0.3, rust=0.7, metallic=0.2, drip=0.2)
    coal = bo.pbr("ts_coal", rgb("#1a1715"), 0.9)
    gc = G(coal)
    gc.color(gc.mix(rgb("#14110f"), rgb("#c44a12"), gc.smooth(gc.noise(scale=45.0, detail=3.0), 0.52, 0.62)))
    tarp = tarp_cloth("ts_tarp", rgb("#a93524"), rgb("#d9a23a"), stripe=0.46, fade=0.5)
    bam = bamboo("ts_bamboo")
    rope = flat("ts_rope", rgb("#7d6c52"), rough=0.9)
    tea_glass = bo.pbr("ts_glass", rgb("#7a3c12"), 0.1)
    gg = G(tea_glass)
    gg.color(gg.mix(rgb("#6c300d"), rgb("#dfe4df"), gg.smooth(gg.z, 1.03, 1.045)))
    gg.rough(0.08)
    jar_b = _biscuit_glass("ts_jar1", rgb("#e2b672"), rgb("#bd8444"))
    jar_r = _biscuit_glass("ts_jar2", rgb("#dba662"), rgb("#ab7338"), cell=24.0)
    jar_c = _biscuit_glass("ts_jar3", rgb("#efd596"), rgb("#cfa45c"), cell=52.0)
    lid_r = plastic("ts_lid_r", rgb("#c42f27"), rough=0.35, dirt=0.0)
    lid_b = plastic("ts_lid_b", rgb("#2864a8"), rough=0.35, dirt=0.0)
    lid_y = plastic("ts_lid_y", rgb("#dfa920"), rough=0.35, dirt=0.0)
    ripe = bo.pbr("ts_banana", rgb("#d9b82b"), 0.5)
    gb = G(ripe)
    gb.color(gb.mix(gb.mix(rgb("#dcbc2e"), rgb("#9fa832"), gb.smooth(gb.noise(scale=7.0, detail=3.0), 0.42, 0.62)), rgb("#3a2a14"), gb.smooth(gb.noise(scale=65.0, detail=3.0), 0.66, 0.72)))
    stem = flat("ts_stem", rgb("#58662c"), rough=0.7)
    packs = [_foil("ts_f1", rgb("#c8202a")), _foil("ts_f2", rgb("#e3b312")), _foil("ts_f3", rgb("#1f62b4")), _foil("ts_f4", rgb("#1f8a4c")), _foil("ts_f5", rgb("#c9c9c6"), rough=0.2)]
    string = flat("ts_string", rgb("#c8c2b0"), rough=0.9)
    wire = flat("ts_wire", rgb("#141312"), rough=0.5)
    bulb = flat("ts_bulb", rgb("#f4e7bf"), rough=0.2)
    tray_m = aluminium("ts_tray", rgb("#a6a8a6"))
    can_m = painted("ts_can", rgb("#d7c9a0"), wear=0.25, fade=0.2, rust=0.3, metallic=0.3, drip=0.0)
    bucket = plastic("ts_bucket", rgb("#2f6fb2"), rough=0.45, scuff=0.5)
    stool = plastic("ts_stool", rgb("#b52f2a"), rough=0.45, scuff=0.5)
    cloth = fabric("ts_rag", rgb("#b9ac8f"), fade=0.4, dirt=0.7, sag_dirt=0.5)

    # ---- counter box: plank front and sides over a frame ----
    k.box((2.14, 0.72, 0.84), (0, 0, 0.5), plank)
    for i in range(6):
        x = -1.08 + (i + 0.5) * 2.16 / 6
        k.box((2.16 / 6 - 0.012, 0.022, 0.84), (x, -0.372, 0.5), teal if i % 2 else teal2)
    # a faded painted panel across the front: bands only, no lettering
    k.box((1.5, 0.018, 0.2), (0.0, -0.39, 0.72), red_panel)
    k.box((1.5, 0.018, 0.045), (0.0, -0.39, 0.585), yellow)
    for sx in (-1, 1):
        k.box((0.022, 0.72, 0.84), (sx * 1.081, 0, 0.5), teal)
        for sy in (-1, 1):
            k.box((0.06, 0.06, 0.96), (sx * 1.07, sy * 0.36, 0.48), leg_wood)
    k.box((2.2, 0.04, 0.05), (0, -0.39, 0.1), leg_wood)
    k.box((2.2, 0.04, 0.05), (0, -0.39, 0.92), leg_wood)
    # counter top with worn tin edge
    k.box((2.3, 0.84, 0.05), (0, 0, 0.965), top_wood, bevel=0.006)
    k.box((2.31, 0.012, 0.055), (0, -0.425, 0.965), tin)
    k.box((2.31, 0.012, 0.055), (0, 0.425, 0.965), tin)
    Z = 0.99
    # back side: open shelves for the vendor
    k.box((1.92, 0.2, 0.03), (0, 0.45, 0.5), plank)
    k.box((1.92, 0.2, 0.03), (0, 0.45, 0.2), plank)
    for x, m, h in ((-0.7, can_m, 0.13), (-0.2, lid_b, 0.2), (0.3, can_m, 0.14), (0.72, tin, 0.18)):
        k.cyl(0.055, h, (x, 0.46, 0.515 + h / 2), m, seg=6)
    for x, m in ((-0.4, lid_r), (0.3, tin)):
        k.cyl(0.08, 0.14, (x, 0.46, 0.285), m, seg=6)

    # ---- coal stove and big kettle ----
    sx0, sy0 = -0.72, -0.03
    k.loft([{"c": (sx0, sy0, Z + 0.04), "rx": 0.13, "ry": 0.13}, {"c": (sx0, sy0, Z + 0.23), "rx": 0.19, "ry": 0.19}], stove_tin, seg=10)
    k.cyl(0.14, 0.012, (sx0, sy0, Z + 0.236), coal, seg=8)
    for a in (0.5, 2.6, 4.7):
        k.rod((sx0 + math.cos(a) * 0.11, sy0 + math.sin(a) * 0.11, Z), (sx0 + math.cos(a) * 0.15, sy0 + math.sin(a) * 0.15, Z + 0.12), 0.012, handle, seg=3)
    k.box((0.09, 0.012, 0.06), (sx0, sy0 - 0.158, Z + 0.1), coal)
    for a in (0.2, 2.3, 4.4):
        k.box((0.09, 0.02, 0.02), (sx0 + math.cos(a) * 0.15, sy0 + math.sin(a) * 0.15, Z + 0.25), handle, rot=(0, 0, a))
    _kettle(k, sx0, sy0, Z + 0.26, 1.15, alu, handle)
    # second pan with milk on a low burner
    k.cyl(0.11, 0.06, (-0.3, 0.14, Z + 0.03), stove_tin, seg=8)
    k.loft([{"c": (-0.3, 0.14, Z + 0.06), "rx": 0.1, "ry": 0.1}, {"c": (-0.3, 0.14, Z + 0.17), "rx": 0.128, "ry": 0.128}], alu2, seg=10, end=False)
    k.cyl(0.122, 0.004, (-0.3, 0.14, Z + 0.158), bulb, seg=8)
    k.rod((-0.17, 0.14, Z + 0.15), (0.02, 0.14, Z + 0.17), 0.009, handle, seg=3)

    # ---- tray with the row of small tea glasses ----
    k.box((0.72, 0.2, 0.012), (0.08, -0.26, Z + 0.006), tray_m)
    for row, yo in enumerate((-0.31, -0.21)):
        for i in range(6 - row):
            x = -0.2 + i * 0.1 + row * 0.05
            k.cyl(0.025, 0.08, (x, yo, Z + 0.052), tea_glass, seg=6, rt=0.033)
    # spoon glass, can, sugar tin, folded rag
    k.cyl(0.03, 0.1, (0.56, -0.28, Z + 0.05), tea_glass, seg=6, rt=0.036)
    k.rod((0.56, -0.28, Z + 0.03), (0.6, -0.26, Z + 0.17), 0.004, handle, seg=3)
    k.cyl(0.042, 0.1, (0.72, -0.28, Z + 0.05), can_m, seg=8)
    k.cyl(0.07, 0.09, (0.88, -0.25, Z + 0.045), tin, seg=8)
    k.box((0.26, 0.17, 0.025), (-0.3, -0.27, Z + 0.012), cloth, rot=(0, 0, 0.3))

    # ---- biscuit and rusk jars ----
    _jar(k, 0.16, 0.2, Z, 0.09, 0.26, jar_b, lid_r)
    _jar(k, 0.40, 0.2, Z, 0.09, 0.26, jar_r, lid_b)
    _jar(k, 0.64, 0.2, Z, 0.09, 0.26, jar_c, lid_y)
    _jar(k, 0.88, 0.2, Z, 0.09, 0.26, jar_b, lid_r)
    _jar(k, 0.28, -0.02, Z, 0.075, 0.2, jar_c, lid_y)
    _jar(k, 0.5, -0.02, Z, 0.075, 0.2, jar_r, lid_r)

    # ---- bamboo frame ----
    fx, fy, fz = 1.28, -0.8, 2.2
    bx, by, bz = 1.22, 0.92, 2.52
    for sx in (-1, 1):
        k.loft([{"c": (sx * fx, fy, 0.0), "rx": 0.042, "ry": 0.042}, {"c": (sx * fx, fy, fz + 0.1), "rx": 0.033, "ry": 0.033}], bam, seg=6)
        k.loft([{"c": (sx * bx, by, 0.0), "rx": 0.044, "ry": 0.044}, {"c": (sx * bx, by, bz + 0.1), "rx": 0.034, "ry": 0.034}], bam, seg=6)
        k.rod((sx * fx, fy, fz - 0.03), (sx * bx, by, bz - 0.03), 0.026, bam, seg=5)
        k.cyl(0.042, 0.06, (sx * fx, fy, fz - 0.03), rope, seg=6)
        k.cyl(0.043, 0.06, (sx * bx, by, bz - 0.03), rope, seg=6)
        # bracing lashed to the counter
        k.rod((sx * fx, fy, 0.92), (sx * 1.07, -0.36, 0.92), 0.018, bam, seg=3)
        k.rod((sx * bx, by, 0.92), (sx * 1.07, 0.36, 0.92), 0.018, bam, seg=3)
    k.rod((-1.45, fy, fz), (1.45, fy, fz), 0.028, bam, seg=5)
    k.rod((-1.4, by, bz), (1.4, by, bz), 0.028, bam, seg=5)
    k.rod((-1.3, 0.05, 2.36), (1.3, 0.05, 2.36), 0.022, bam, seg=5)

    # ---- faded tarp with sag and a scalloped front valance ----
    def tarp_pt(u, v):
        x = u * 1.62
        t = (v + 1) / 2
        hem = 0.125
        if t < hem:
            f = t / hem
            y = -1.1 + 0.02 * math.sin(u * 19.0)
            scallop = 0.055 * abs(math.sin(u * 3.0 * math.pi)) * (1 - f)
            z = 2.03 + f * 0.21 + scallop
            return (x, y, z)
        f = (t - hem) / (1 - hem)
        y = -1.1 + f * 2.34
        base = 2.24 + f * 0.42
        sag = -0.055 * (1 - u * u) * math.sin(f * math.pi)
        wrinkle = 0.012 * math.sin(u * 11.0 + f * 7.0)
        return (x, y, base + sag + wrinkle + 0.012)
    k.grid(tarp_pt, 24, 8, tarp, w=0.9, chunks=1)
    for sx in (-1, 1):
        k.tube([(sx * 1.6, -1.05, 2.15), (sx * 1.45, -0.9, 2.1), (sx * fx, fy, 2.02)], 0.006, rope, seg=3)
        k.tube([(sx * 1.6, 1.2, 2.6), (sx * 1.42, 1.05, 2.52), (sx * bx, by, 2.4)], 0.006, rope, seg=3)

    # ---- hanging banana bunch, snack strips, bare bulb ----
    k.rod((-0.8, fy, fz), (-0.8, fy, 1.88), 0.006, string, seg=3)
    _banana_bunch(k, -0.8, fy, 1.6, ripe, stem, count=12, spread=1.25)
    for x, mats, n in ((-0.28, (0, 1, 0, 1, 0, 1), 6), (-0.08, (2, 2, 4, 2, 2, 4), 6), (0.14, (1, 3, 1, 3, 1), 5), (0.36, (4, 0, 4, 0, 4, 0), 6), (0.6, (3, 3, 2, 3, 3), 5), (0.82, (0, 2, 1, 3, 0), 5)):
        top = fz - 0.04
        k.rod((x, fy - 0.012, fz + 0.02), (x, fy - 0.012, top - n * 0.125), 0.0035, string, seg=3)
        by_mat = {}
        for i in range(n):
            wob = 0.05 * math.sin(i * 2.3 + x * 9.0)
            by_mat.setdefault(mats[i], []).append((x, fy - 0.012, top - 0.07 - i * 0.125, wob))
        for mi, pos in by_mat.items():
            _pillow_packs(k, pos, packs[mi])
    k.tube([(bx, 0.3, 2.42), (0.6, 0.15, 2.39), (0.05, -0.02, 2.34), (0.05, -0.02, 2.0)], 0.005, wire, seg=3)
    k.sphere(0.035, (0.05, -0.02, 1.96), bulb, seg=6, rings=4)
    k.cyl(0.018, 0.04, (0.05, -0.02, 2.0), wire, seg=6)

    # ---- two low benches ----
    def bench(cx, cy, length, axis):
        top = 0.36
        if axis == "x":
            k.box((length, 0.27, 0.04), (cx, cy, top - 0.02), bench_wood)
            for s in (-1, 1):
                k.box((0.05, 0.25, 0.32), (cx + s * (length / 2 - 0.12), cy, 0.16), leg_wood)
            k.box((length - 0.25, 0.03, 0.05), (cx, cy, 0.16), leg_wood)
        else:
            k.box((0.27, length, 0.04), (cx, cy, top - 0.02), bench_wood2)
            for s in (-1, 1):
                k.box((0.25, 0.05, 0.32), (cx, cy + s * (length / 2 - 0.12), 0.16), leg_wood)
            k.box((0.03, length - 0.25, 0.05), (cx, cy, 0.16), leg_wood)
    bench(0.1, -1.2, 1.5, "x")
    bench(-1.8, -0.4, 1.4, "y")
    seat_z = 0.42
    k.empty("seat_1", (-0.26, -1.2, seat_z), (0, 0, math.pi))
    k.empty("seat_2", (0.46, -1.2, seat_z), (0, 0, math.pi))
    k.empty("seat_3", (-1.8, -0.72, seat_z), (0, 0, math.pi / 2))
    k.empty("seat_4", (-1.8, -0.08, seat_z), (0, 0, math.pi / 2))
    k.empty("vendor", (0.25, 0.86, 0.0))

    # ---- vendor-side clutter: bucket, stool ----
    k.loft([{"c": (1.12, 0.72, 0.0), "rx": 0.13, "ry": 0.13}, {"c": (1.12, 0.72, 0.3), "rx": 0.17, "ry": 0.17}], bucket, seg=8, end=False)
    k.cyl(0.158, 0.01, (1.12, 0.72, 0.26), tin, seg=8)
    k.tube([(0.955, 0.72, 0.28), (1.12, 0.72, 0.46), (1.285, 0.72, 0.28)], 0.005, handle, seg=3)
    k.loft([{"c": (-0.55, 0.84, 0.0), "rx": 0.13, "ry": 0.13, "power": 3}, {"c": (-0.55, 0.84, 0.33), "rx": 0.15, "ry": 0.15, "power": 3}], stool, seg=8)

    k.preview((1.4, -4.2, 1.65), (0, 0, 1.15), 34, "front")
    k.preview((-3.6, -3.2, 2.1), (0, 0, 1.1), 34, "left")
    k.preview((0.3, -1.9, 1.35), (-0.1, 0, 1.25), 28, "close")
    k.preview((2.4, 3.8, 2.2), (0, 0, 1.1), 34, "back")
    k.finish(size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.5, ao_strength=0.8, angle=75.0, cull=False, margin=0.004, packed=True)
    k.export(quality=84)
    k.run_previews()


def _lens_object(name, loc, radius, color):
    """Separate dark traffic lens with its own material, origin on the lens: a shallow front dome."""
    mat = bo.pbr(name, color, 0.22)
    verts, faces = [], []
    seg = 12
    verts.append((0.0, -radius * 0.32, 0.0))
    for f, y in ((0.62, -radius * 0.24), (1.0, 0.0)):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append((math.cos(a) * radius * f, y, math.sin(a) * radius * f))
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((0, 1 + j, 1 + i))
        faces.append((1 + i, 1 + j, 1 + seg + j, 1 + seg + i))
    obj = bo.new_mesh_object(name, verts, faces)
    bo.assign(obj, mat)
    obj.location = loc
    return obj


@asset("traffic_light")
def build_traffic_light():
    """Budget under 900 tris. Lenses, hoods and bezels keep their shape with fewer sides."""
    k = Kit("traffic_light", "props")
    pole = banded("tl_pole", rgb("#e0ddd0"), rgb("#1c1b1a"), 0.42, axis="z", wear=0.4, rust=0.2, rough=0.5, metallic=0.1)
    pole_up = painted("tl_pole2", rgb("#42484a"), wear=0.3, rust=0.3, rough=0.5, metallic=0.4, drip=0.5)
    housing = painted("tl_house", rgb("#2a2f2e"), under=rgb("#55524a"), wear=0.3, fade=0.3, dirt=0.3, rust=0.12, rough=0.42, drip=0.5, bevel=0.004)
    board = painted("tl_board", rgb("#1b1e1d"), under=rgb("#55524a"), wear=0.25, fade=0.25, dirt=0.25, rust=0.1, rough=0.45, drip=0.7, bevel=0.003)
    trim = painted("tl_trim", rgb("#d9b62a"), under=rgb("#55524a"), wear=0.4, fade=0.4, dirt=0.3, drip=0.5, bevel=0.002)
    base = concrete("tl_base", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.3, grime=1.0, grime_h=0.4, dust=0.6, bevel=0.015)
    steel_c = steel("tl_steel", rgb("#6a6b68"), rust=0.5, metallic=0.6, drip=0.3)
    box_m = painted("tl_box", rgb("#8d918c"), wear=0.3, rust=0.3, fade=0.3, metallic=0.2, drip=0.8, bevel=0.005)
    wire = flat("tl_wire", rgb("#151413"), rough=0.5)

    k.box((0.56, 0.56, 0.18), (0, 0, 0.09), base)
    k.cyl(0.13, 0.03, (0, 0, 0.195), steel_c, seg=6)
    k.loft([{"c": (0, 0, 0.19), "rx": 0.062, "ry": 0.062}, {"c": (0, 0, 1.68), "rx": 0.056, "ry": 0.056}], pole, seg=8, start=False, end=False)
    k.loft([{"c": (0, 0, 1.68), "rx": 0.056, "ry": 0.056}, {"c": (0, 0, 3.47), "rx": 0.05, "ry": 0.05}], pole_up, seg=8, start=False)
    k.box((0.16, 0.1, 0.28), (0, -0.1, 1.28), box_m)
    k.tube([(0, -0.1, 1.42), (0.0, -0.075, 1.8), (0.09, -0.06, 2.42)], 0.008, wire, seg=3)

    # head: housing with backboard, visors and bezels; faces -Y
    cz = 3.02
    pitch = 0.285
    k.box((0.36, 0.2, 0.92), (0, -0.2, cz), housing, bevel=0.012, seg=1)
    k.box((0.6, 0.025, 1.14), (0, -0.095, cz), board)
    for sz in (-1, 1):
        k.box((0.61, 0.012, 0.03), (0, -0.112, cz + sz * 0.56), trim)
    for sx in (-1, 1):
        k.box((0.03, 0.012, 1.14), (sx * 0.295, -0.112, cz), trim)
    for z in (cz - 0.3, cz + 0.3):
        k.box((0.12, 0.12, 0.05), (0, -0.05, z), steel_c)
    lamps = (("lamp_red", cz + pitch, rgb("#4a0b08")), ("lamp_amber", cz, rgb("#4f3206")), ("lamp_green", cz - pitch, rgb("#06371f")))
    for name, z, col in lamps:
        y = -0.3
        # bezel ring, drawn as a raised flat washer
        k.loft([{"c": (0, y + 0.005, z), "rx": 0.122, "ry": 0.122, "axis": "y"}, {"c": (0, y - 0.012, z), "rx": 0.116, "ry": 0.116, "axis": "y"}, {"c": (0, y - 0.012, z), "rx": 0.102, "ry": 0.102, "axis": "y"}], housing, seg=12, start=False, end=False)
        # hood: open at the bottom, projecting from the housing
        sec_out, sec_in = [], []
        n = 7
        for i in range(n + 1):
            a = math.radians(-20) + math.radians(220) * i / n
            sec_out.append((0.125 * math.cos(a), z + 0.125 * math.sin(a)))
            sec_in.append((0.118 * math.cos(a), z + 0.118 * math.sin(a)))
        sec = sec_out + list(reversed(sec_in))
        k.section_loft([(y - 0.2, sec), (y, sec)], housing, cap1=False)
        k.separate.append(_lens_object(name, (0, y - 0.004, z), 0.1, col))
    k.preview((1.6, -5.2, 1.9), (0, 0, 1.9), 34, "front")
    k.preview((0.45, -1.3, 3.1), (0, -0.2, 3.02), 35, "head")
    k.preview((-1.6, 2.6, 2.0), (0, 0, 1.9), 42, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.3, ao_strength=0.75, angle=62.0)
    k.export(quality=84)
    k.run_previews()


@asset("police_box")
def build_police_box():
    k = Kit("police_box", "props")
    blue = painted("pb_blue", rgb("#1d5fa6"), under=rgb("#8d8678"), wear=0.5, fade=0.6, dirt=0.4, rust=0.05, drip=0.7, rough=0.5, bevel=0.008, edge=0.02)
    white = painted("pb_white", rgb("#e4e2d8"), under=rgb("#8d8678"), wear=0.45, fade=0.15, dirt=0.4, rust=0.05, drip=0.9, rough=0.5, bevel=0.008, edge=0.02)
    conc = concrete("pb_conc", c1=rgb("#a89f8d"), c2=rgb("#81786a"), seam_h=0, drip=0.3, grime=1.0, grime_h=0.5, dust=0.7, bevel=0.015)
    floor_m = concrete("pb_floor", c1=rgb("#8d8778"), c2=rgb("#6f6a5d"), seam_h=0, drip=0, grime=0, dust=0.5, bevel=0.01)
    rail = painted("pb_rail", rgb("#e8e6db"), under=rgb("#70675a"), wear=0.55, rust=0.25, metallic=0.2, drip=0.2, rough=0.45, bevel=0.0)
    post_m = banded("pb_post", rgb("#e6e4d9"), rgb("#1d5fa6"), 0.34, axis="z", wear=0.45, rust=0.2, rough=0.45)
    roof_w = painted("pb_roof_w", rgb("#e4e2d8"), under=rgb("#70675a"), wear=0.2, fade=0.15, dirt=0.45, rust=0.15, metallic=0.1, drip=0.9, rough=0.5, bevel=0.0)
    roof_b = painted("pb_roof_b", rgb("#1d5fa6"), under=rgb("#70675a"), wear=0.2, fade=0.6, dirt=0.45, rust=0.15, metallic=0.1, drip=0.9, rough=0.5, bevel=0.0)
    under = painted("pb_under", rgb("#cfcdc2"), wear=0.05, fade=0.2, dirt=0.0, rust=0.12, drip=0.3, rough=0.6, bevel=0.0)
    steel_c = galv("pb_steel", rust=0.2)
    plate = painted("pb_plate", rgb("#efece0"), wear=0.3, fade=0.1, dirt=0.3, rust=0.1, drip=0.5, bevel=0.002)

    def hexr(r, z, rot=0.0):
        return {"c": (0, 0, z), "rx": r, "ry": r, "rot": rot}

    # six-sided drum: base kerb, blue lower wall, white upper wall, floor overhang
    R = 1.12
    rot = 0.0
    k.loft([hexr(R + 0.1, 0.0, rot), hexr(R + 0.1, 0.13, rot), hexr(R + 0.04, 0.16, rot)], conc, seg=6)
    k.loft([hexr(R, 0.14, rot), hexr(R - 0.01, 0.58, rot)], blue, seg=6, end=False)
    k.loft([hexr(R - 0.01, 0.58, rot), hexr(R - 0.04, 0.6, rot), hexr(R - 0.04, 0.92, rot)], white, seg=6, start=False)
    k.loft([hexr(R + 0.08, 0.92, rot), hexr(R + 0.1, 0.96, rot), hexr(R + 0.1, 1.0, rot), hexr(R + 0.06, 1.03, rot)], floor_m, seg=6)
    # sunken panels on the blue faces
    for i in range(6):
        a = math.radians(60 * i)
        ap = (R - 0.008) * math.cos(math.radians(30))
        cx, cy = math.sin(a) * ap, -math.cos(a) * ap
        if i == 3:
            continue
        o = k.box((0.72, 0.016, 0.26), (0, 0, 0), white, bevel=0.003)
        o.rotation_euler = (0, 0, a)
        o.location = (cx, cy, 0.36)
    # blank front plate, left empty for a runtime sign
    o = k.box((0.78, 0.015, 0.2), (0, -(R - 0.04) * math.cos(math.radians(30)) - 0.008, 0.76), plate, bevel=0.003)
    # rear steps
    for i, (z, y) in enumerate(((0.13, 1.56), (0.39, 1.36), (0.65, 1.2))):
        k.box((0.8, 0.28 + i * 0.05, z * 2), (0, y, z), conc, bevel=0.012)
    # railing posts, two rails with a gap at the steps
    rail_z = (1.42, 1.86)
    corners = []
    Rr = R + 0.02
    for i in range(6):
        a = math.radians(60 * i)
        corners.append((math.cos(a) * Rr, math.sin(a) * Rr))
    # i=1,2 flank the +Y steps; i=4,5 flank the front. Tall posts leave the front view open.
    open_edge = {1, 2}
    for i, (x, y) in enumerate(corners):
        h = 2.86 if i in (0, 1, 2, 3) else 1.9
        k.cyl(0.03, h - 1.0, (x, y, (h + 1.0) / 2), post_m, seg=8)
    for i in range(6):
        j = (i + 1) % 6
        if i in open_edge and j in open_edge:
            continue
        for z in rail_z:
            k.rod((corners[i][0], corners[i][1], z), (corners[j][0], corners[j][1], z), 0.021, rail, seg=6)
    # short flat mesh of uprights on the three front bays
    for i in range(6):
        j = (i + 1) % 6
        if i in open_edge and j in open_edge:
            continue
        for t in (0.2, 0.4, 0.6, 0.8):
            x = corners[i][0] + (corners[j][0] - corners[i][0]) * t
            y = corners[i][1] + (corners[j][1] - corners[i][1]) * t
            k.rod((x, y, 1.03), (x, y, 1.42), 0.009, rail, seg=5)
    # canopy: six alternating sheet panels with a deep edge and a pale ceiling
    Rt = 1.5
    ez, az = 2.82, 3.32
    for i in range(6):
        a0 = math.radians(60 * i)
        a1 = a0 + math.radians(60)
        p0 = (math.cos(a0) * Rt, math.sin(a0) * Rt, ez)
        p1 = (math.cos(a1) * Rt, math.sin(a1) * Rt, ez)
        m = roof_b if i % 2 else roof_w
        k.mesh([p0, p1, (0, 0, az)], [(0, 1, 2)], m, smooth=False)
        k.mesh([p0, p1, (p1[0], p1[1], ez - 0.13), (p0[0], p0[1], ez - 0.13)], [(0, 1, 2, 3)], m, smooth=False)
        k.mesh([(p0[0], p0[1], ez - 0.13), (p1[0], p1[1], ez - 0.13), (0, 0, az - 0.3)], [(0, 1, 2)], under, smooth=False)
        k.rod((p0[0] * 0.98, p0[1] * 0.98, ez + 0.012), (0, 0, az + 0.012), 0.016, steel_c, seg=5)
    k.loft([{"c": (0, 0, az - 0.06), "rx": 0.09, "ry": 0.09}, {"c": (0, 0, az + 0.05), "rx": 0.07, "ry": 0.07}, {"c": (0, 0, az + 0.1), "rx": 0.03, "ry": 0.03}], roof_w, seg=10)
    k.sphere(0.04, (0, 0, az + 0.13), steel_c, seg=8, rings=5)
    k.empty("stand", (0, 0, 1.03))

    k.preview((2.4, -5.5, 2.0), (0, 0, 1.6), 38, "front")
    k.preview((-4.5, -3.0, 3.6), (0, 0, 1.5), 38, "above")
    k.preview((3.5, 4.5, 1.4), (0, 0, 1.6), 38, "back")
    k.finish(size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.6, ao_strength=0.75, angle=40.0, cull=False)
    k.export(quality=84)
    k.run_previews()


@asset("lamp_post")
def build_lamp_post():
    k = Kit("lamp_post", "props")
    pole = bo.pbr("lp_pole", rgb("#8e9495"), 0.45, 0.7)
    g = G(pole)
    col = g.mix(rgb("#9ea3a2"), rgb("#6f7373"), g.smooth(g.noise(vec=g.vscale((6.0, 6.0, 0.5)), scale=1.0, detail=5.0), 0.38, 0.66))
    col = g.mix(col, rgb("#6e4a2c"), g.mul(g.smooth(g.z, 1.0, 0.1), g.smooth(g.noise(scale=7.0, detail=6.0), 0.42, 0.6)))
    # sticker and poster scraps at reach height, no text
    d, cell = g.voronoi(scale=4.2, metric="CHEBYCHEV", vec=g.vscale((1.0, 1.0, 0.55)))
    pick = g.rgbf(cell)
    band = g.mul(g.smooth(g.z, 0.9, 1.1), g.smooth(g.z, 2.6, 2.2))
    tint = g.ramp(g.fract(g.mul(pick, 5.7)), [(0.0, rgb("#c49a7f")), (0.5, rgb("#dcd6c4")), (1.0, rgb("#7d9aa0"))])
    col = g.mix(col, tint, g.mul(g.mul(g.smooth(pick, 0.55, 0.58), band), 0.9))
    g.color(col)
    g.rough(0.5)
    base = concrete("lp_base", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.3, grime=1.0, grime_h=0.45, dust=0.6, bevel=0.012)
    arm = painted("lp_arm", rgb("#8a8f90"), wear=0.15, rust=0.1, metallic=0.6, drip=0.5, bevel=0)
    head = painted("lp_head", rgb("#5e6364"), wear=0.15, rust=0.05, metallic=0.5, drip=0.6, bevel=0.004)
    glow = flat("lp_lens", rgb("#e6e2d2"), rough=0.2)
    steel_c = steel("lp_steel", rgb("#6d6c68"), rust=0.6, metallic=0.5, drip=0.2)

    k.cyl(0.34, 0.26, (0, 0, 0.13), base, seg=16)
    k.cyl(0.19, 0.02, (0, 0, 0.27), steel_c, seg=8)
    for a in (0.785, 2.356, 3.927, 5.498):
        k.cyl(0.02, 0.05, (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.3), steel_c, seg=6)
    # tapered octagon pole, with a raised access door
    pr = [(0.27, 0.098), (2.5, 0.084), (5.2, 0.068), (8.65, 0.046)]
    for (z0, r0), (z1, r1) in zip(pr, pr[1:]):
        k.loft([{"c": (0, 0, z0), "rx": r0, "ry": r0}, {"c": (0, 0, z1), "rx": r1, "ry": r1}], pole, seg=8, start=False, end=False)
    k.sphere(0.046, (0, 0, 8.65), arm, seg=8, rings=4, scale=(1, 1, 0.4))
    k.box((0.1, 0.012, 0.36), (0, -0.098, 0.9), arm, bevel=0.003)
    # arm sweeps over the road on -Y, slightly rising
    k.tube([(0, 0, 8.55), (0, -0.02, 8.8), (0, -0.16, 9.05), (0, -0.55, 9.22), (0, -1.1, 9.3), (0, -1.74, 9.34)], 0.036, arm, seg=8)
    # slim LED head with a flat lens underneath
    k.box((0.25, 0.68, 0.07), (0, -2.04, 9.36), head, bevel=0.016, seg=2, rot=(math.radians(-5), 0, 0))
    k.box((0.11, 0.24, 0.085), (0, -1.76, 9.345), head, bevel=0.014, rot=(math.radians(-5), 0, 0))
    k.box((0.19, 0.44, 0.008), (0, -2.12, 9.32), glow, rot=(math.radians(-5), 0, 0))
    k.empty("lamp", (0, -2.12, 9.28))
    k.preview((5.2, -14.0, 2.0), (0, -0.8, 4.9), 34, "full")
    k.preview((1.3, -3.4, 9.0), (0, -1.5, 9.3), 34, "head")
    k.preview((0.7, -1.8, 1.0), (0, 0, 0.9), 32, "base")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.4, ao_strength=0.7, angle=50.0)
    k.export(quality=84)
    k.run_previews()


def _insulator(k, x, y, z, por, tall=0.16):
    """Pin insulator: a glazed skirted stack, 26 tris. Returns the wire-tie point."""
    rings = [(0.01, 0.018), (0.05, 0.07), (0.1, 0.05), (tall + 0.018, 0.024)]
    k.loft([{"c": (x, y, z + a), "rx": b, "ry": b} for a, b in rings], por, seg=5)
    return (x, y, z + tall + 0.012)


def _cable_coil(k, c, radius, turns, mat, rng, r=0.012, tilt=0.5, n_per=7):
    """A messy hanging loop of spare cable: wobbling turns, not a clean ring."""
    pts = []
    n = int(turns * n_per)
    ca, sa = math.cos(tilt), math.sin(tilt)
    for i in range(n + 1):
        a = 2 * math.pi * i / n_per + rng.random() * 0.25
        rr = radius * (0.82 + 0.28 * math.sin(i * 0.61) + rng.random() * 0.14)
        px, pz = math.cos(a) * rr, math.sin(a) * rr
        y = c[1] + rng.uniform(-0.04, 0.04) + i * 0.002
        pts.append((c[0] + px * ca, y + px * sa * 0.5, c[2] + pz))
    k.tube(pts, r, mat, seg=3)


@asset("electric_pole")
def build_electric_pole():
    """Budget under 1400 tris including the optional transformer: this prop is instanced 250+ times.
    Nearly all detail lives in the bake; geometry only carries the silhouette."""
    k = Kit("electric_pole", "props")
    rng = random.Random(7)
    conc = concrete("ep_conc", c1=rgb("#a9a290"), c2=rgb("#7f7866"), seam_h=0, drip=1.0, drip_top=10.0, drip_band=4.0, grime=1.0, grime_h=1.5, soot=0.2, dust=0.0, posters=1.0, bevel=0.02, mottled=1.2)
    arm_m = steel("ep_arm", rgb("#65696a"), rust=0.75, metallic=0.55, drip=0.9, wear=0.3)
    por = plastic("ep_por", rgb("#7c3a1e"), rough=0.22, scuff=0.15, dirt=0.0)
    por_w = plastic("ep_por_w", rgb("#c9c6b8"), rough=0.25, scuff=0.25, dirt=0.0)
    box_a = painted("ep_box", rgb("#8c9188"), under=rgb("#6c5238"), wear=0.5, rust=0.65, fade=0.35, metallic=0.2, drip=1.0, bevel=0.006)
    box_b = painted("ep_box2", rgb("#b7b39a"), under=rgb("#6c5238"), wear=0.45, rust=0.45, fade=0.35, metallic=0.1, drip=1.0, bevel=0.006)
    black = flat("ep_cable", rgb("#121110"), rough=0.55)
    grey = flat("ep_cable2", rgb("#3a3b3a"), rough=0.6)
    rung = steel("ep_rung", rgb("#584f43"), rust=0.85, metallic=0.4, drip=0.0)
    base = concrete("ep_base", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.45, dust=0.7, bevel=0.015)
    tx_tank = painted("tx_tank", rgb("#7f8a84"), under=rgb("#6a4a30"), wear=0.3, rust=0.7, fade=0.3, metallic=0.2, drip=1.0, bevel=0.008)
    tx_fin = ribbed_sheet("tx_fin", rgb("#6d756f"), period=0.05, axis="x", rust=0.5, drip=0.6, depth=1.0)
    tx_steel = steel("tx_steel", rgb("#5e6060"), rust=0.7, metallic=0.5, drip=0.5)
    tx_por = plastic("tx_por", rgb("#7c3a1e"), rough=0.22, scuff=0.15, dirt=0.0)
    tx_black = flat("tx_black", rgb("#121110"), rough=0.55)

    # tapered concrete pole, a rounded rectangle section
    rings = []
    for z, rx, ry in ((0.0, 0.17, 0.12), (5.0, 0.125, 0.095), (10.0, 0.08, 0.066)):
        rings.append({"c": (0, 0, z), "rx": rx, "ry": ry, "power": 5.0})
    k.loft(rings, conc, seg=8, start=False)
    k.loft([{"c": (0, 0, 0.0), "rx": 0.36, "ry": 0.3, "power": 3.5}, {"c": (0, 0, 0.16), "rx": 0.3, "ry": 0.24, "power": 3.5}], base, seg=8, start=False)
    # climbing rungs on both faces
    for i in range(6):
        z = 2.5 + i * 0.95
        sx = -1 if i % 2 else 1
        half_w = 0.17 - z * 0.009
        k.rod((sx * half_w, 0.0, z), (sx * (half_w + 0.09), 0.0, z + 0.01), 0.011, rung, seg=3)

    # two crossarms with braces and clamp bands
    def crossarm(z, half):
        k.box((2 * half, 0.07, 0.07), (0, -0.12, z), arm_m)
        k.box((0.12, 0.2, 0.15), (0, -0.04, z), arm_m)
        for s in (-1, 1):
            k.rod((s * half * 0.72, -0.1, z - 0.02), (s * 0.08, -0.08, z - 0.55), 0.016, arm_m, seg=3)
        k.box((0.26, 0.16, 0.05), (0, -0.05, z - 0.56), arm_m)
    z1, z2 = 9.72, 8.72
    crossarm(z1, 1.02)
    crossarm(z2, 0.82)
    # third wire of each circuit stands off the pole so the triangle reads well
    k.box((0.08, 0.34, 0.06), (0, -0.2, 9.98), arm_m)
    k.box((0.08, 0.28, 0.05), (0, -0.2, z2 + 0.03), arm_m)
    p = {}
    p[1] = _insulator(k, -0.94, -0.12, z1 + 0.035, por)
    p[2] = _insulator(k, 0.0, -0.3, 10.01, por)
    p[3] = _insulator(k, 0.94, -0.12, z1 + 0.035, por)
    p[4] = _insulator(k, -0.74, -0.12, z2 + 0.035, por, tall=0.15)
    p[5] = _insulator(k, 0.0, -0.3, z2 + 0.055, por, tall=0.15)
    p[6] = _insulator(k, 0.74, -0.12, z2 + 0.035, por, tall=0.15)
    for i in range(1, 7):
        k.empty(f"wire_{i}", p[i])
    # low-tension rack and white shackle insulators
    z3 = 7.35
    k.box((1.14, 0.06, 0.06), (0, -0.12, z3), arm_m)
    for x in (-0.48, 0.0, 0.48):
        k.cyl(0.042, 0.13, (x, -0.14, z3 - 0.1), por_w, seg=5)
    # strapped cable run down the pole
    for ox, m in ((-0.03, black), (0.04, grey)):
        pts = []
        for j in range(5):
            z = 7.2 - j * 1.05
            pts.append((ox + rng.uniform(-0.012, 0.012), -(0.12 - z * 0.006) - 0.02, z))
        k.tube(pts, 0.012, m, seg=3)
    # junction boxes
    k.box((0.34, 0.14, 0.44), (-0.02, -0.2, 4.72), box_a)
    k.box((0.26, 0.012, 0.36), (-0.02, -0.276, 4.72), box_a)
    k.box((0.24, 0.12, 0.3), (0.06, -0.19, 3.28), box_b)
    k.tube([(-0.1, -0.2, 4.5), (-0.13, -0.21, 4.2), (-0.05, -0.19, 3.8)], 0.01, black, seg=3)
    # the tangled coils of spare cable: one big messy pair, one small
    _cable_coil(k, (0.24, -0.2, 6.25), 0.27, 3.2, black, rng, r=0.012)
    _cable_coil(k, (-0.27, -0.2, 5.75), 0.22, 2.4, grey, rng, r=0.011, tilt=-0.6)
    _cable_coil(k, (0.2, -0.26, 3.85), 0.16, 1.8, black, rng, r=0.01, tilt=0.3)
    # drooping service drops
    for (x0, dx, dy, dz, m) in ((-0.48, -1.2, -0.7, -1.3, black), (0.48, 1.0, -0.8, -1.1, black), (0.0, 1.3, 0.5, -1.4, grey)):
        pts = []
        for j in range(4):
            t = j / 3
            pts.append((x0 + dx * t, -0.14 + dy * t, z3 - 0.15 + dz * t - 0.35 * math.sin(t * math.pi)))
        k.tube(pts, 0.008, m, seg=3)

    # optional transformer on the +Y side; hide node `transformer` on most poles
    tz = 5.75
    k.box((0.72, 0.1, 0.08), (0, 0.2, tz + 0.5), tx_steel)
    k.box((0.86, 0.5, 0.06), (0, 0.42, tz - 0.66), tx_steel)
    k.box((0.72, 0.1, 0.08), (0, 0.2, tz - 0.62), tx_steel)
    k.loft([{"c": (0, 0.44, tz - 0.62), "rx": 0.28, "ry": 0.28}, {"c": (0, 0.44, tz + 0.14), "rx": 0.28, "ry": 0.28}, {"c": (0, 0.44, tz + 0.2), "rx": 0.3, "ry": 0.3}, {"c": (0, 0.44, tz + 0.27), "rx": 0.2, "ry": 0.2}], tx_tank, seg=10)
    k.box((0.72, 0.1, 0.56), (0, 0.44, tz - 0.22), tx_fin)
    k.box((0.1, 0.72, 0.56), (0, 0.44, tz - 0.22), tx_fin)
    for x in (-0.14, 0.0, 0.14):
        k.loft([{"c": (x, 0.44, tz + 0.24), "rx": 0.035, "ry": 0.035}, {"c": (x, 0.44, tz + 0.32), "rx": 0.05, "ry": 0.05}, {"c": (x, 0.44, tz + 0.5), "rx": 0.018, "ry": 0.018}], tx_por, seg=5)
        k.tube([(x, 0.44, tz + 0.5), (x * 1.2, 0.3, tz + 1.3), (x * 2.5, -0.05, 8.65)], 0.007, tx_black, seg=3)

    k.preview((4.4, -15.0, 2.0), (0, 0, 5.3), 32, "full")
    k.preview((1.5, -3.8, 7.2), (0, 0, 8.6), 38, "top")
    k.preview((1.0, -3.0, 4.0), (0, 0, 5.2), 34, "mid")
    k.preview((-3.5, 6.0, 4.2), (0, 0.2, 6.0), 36, "back")
    k.finish(size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.4, ao_strength=0.7, angle=75.0, split={"tx_": "transformer"})
    k.export(quality=84)
    k.run_previews()


# ---------------------------------------------------------------------------
# Foliage: numpy-painted RGBA leaf atlases and fluffy-normal card canopies
# ---------------------------------------------------------------------------
def srgb(hex_str):
    h = hex_str.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


class Canvas:
    """RGBA float canvas, row 0 at the bottom like Blender images."""

    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.rgb = np.empty((h, w, 3), dtype=np.float32)
        self.rgb[:] = bg
        self.a = np.zeros((h, w), dtype=np.float32)

    def stamp(self, cx, cy, length, width, angle, color, rib=0.25, side=0.14, clip=None):
        """Pointed leaf: length and width are half sizes in pixels."""
        ext = length + width + 1.5
        x0 = int(max(cx - ext, clip[0] if clip else 0))
        x1 = int(min(cx + ext + 1, clip[2] if clip else self.w))
        y0 = int(max(cy - ext, clip[1] if clip else 0))
        y1 = int(min(cy + ext + 1, clip[3] if clip else self.h))
        if x1 <= x0 or y1 <= y0:
            return
        ys, xs = np.mgrid[y0:y1, x0:x1]
        dx, dy = xs + 0.5 - cx, ys + 0.5 - cy
        ca, sa = math.cos(angle), math.sin(angle)
        u = (dx * ca + dy * sa) / max(length, 0.5)
        v = -dx * sa + dy * ca
        prof = np.clip(1.0 - u * u, 0.0, 1.0) ** 0.75 * width
        cov = np.clip(prof - np.abs(v) + 0.5, 0.0, 1.0)
        cov[np.abs(u) >= 1.0] = 0.0
        if not cov.any():
            return
        shade = 1.0 + side * np.sign(v) - rib * np.exp(-(v * v) / max(0.35, width * 0.1))
        col = np.array(color, dtype=np.float32)
        for c in range(3):
            self.rgb[y0:y1, x0:x1, c] = self.rgb[y0:y1, x0:x1, c] * (1 - cov) + np.clip(col[c] * shade, 0, 1) * cov
        self.a[y0:y1, x0:x1] = np.maximum(self.a[y0:y1, x0:x1], cov)

    def to_image(self, name):
        img = bpy.data.images.new(name, self.w, self.h, alpha=True)
        img.alpha_mode = "STRAIGHT"
        out = np.dstack((self.rgb, self.a)).astype(np.float32).ravel()
        img.pixels.foreach_set(out)
        img.update()
        img.pack()
        return img


def _tone(rng, base, spread=0.06, warm=0.0):
    k_ = 1.0 + rng.uniform(-spread, spread)
    t = base * k_
    t = t + np.array([warm, warm * 0.6, -warm * 0.3]) * rng.uniform(-1, 1)
    return np.clip(t, 0, 1)


def _spray(cv, x, y, ang, length, leaf_len, leaf_w, tone, rng, pairs, clip, droop=0.0, tone_spread=0.08):
    """Pinnate twig: a thin rachis with paired leaflets."""
    dx, dy = math.cos(ang), math.sin(ang)
    cv.stamp(x + dx * length * 0.5, y + dy * length * 0.5, length * 0.52, max(0.55, leaf_w * 0.3), ang, tone * 0.5, rib=0.0, side=0.0, clip=clip)
    for i in range(pairs):
        t = (i + 0.6) / pairs
        px, py = x + dx * length * t, y + dy * length * t
        L = leaf_len * (1.0 - 0.45 * t ** 2) * rng.uniform(0.85, 1.15)
        for sd in (-1, 1):
            a = ang + sd * rng.uniform(0.85, 1.25) * (1.0 - 0.3 * t) + droop
            cv.stamp(px + math.cos(a) * L, py + math.sin(a) * L, L, leaf_w, a, _tone(rng, tone, tone_spread, 0.02), clip=clip)
    cv.stamp(x + dx * (length + leaf_len * 0.5), y + dy * (length + leaf_len * 0.5), leaf_len, leaf_w, ang, _tone(rng, tone, tone_spread), clip=clip)


def _lobes(rng, cx, cy, radius, n=6):
    """Lumpy clump outline as overlapping circles (the clump never reaches the cell edge)."""
    out = [(cx, cy, radius * 0.62)]
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.35, 0.35)
        d = radius * rng.uniform(0.42, 0.62)
        out.append((cx + math.cos(a) * d, cy + math.sin(a) * d, radius * rng.uniform(0.3, 0.42)))
    return out


def _pinnate_clump(cv, rect, tones, counts, rng, leaf_len, leaf_w, spray_len, pairs):
    """Back to front layers of sprays: dark core, mid mass, bright tips on the outside."""
    x0, y0, w_, h_ = rect
    clip = (x0 + 2, y0 + 2, x0 + w_ - 2, y0 + h_ - 2)
    cx, cy = x0 + w_ / 2, y0 + h_ / 2
    lobes = _lobes(rng, cx, cy, min(w_, h_) * 0.45)
    for layer, (tone, count) in enumerate(zip(tones, counts)):
        out_bias = layer / max(1, len(tones) - 1)
        for _ in range(count):
            lx, ly, lr = lobes[rng.randrange(len(lobes))]
            a = rng.uniform(0, 2 * math.pi)
            d = lr * math.sqrt(rng.random()) * (0.55 + 0.45 * out_bias)
            x, y = lx + math.cos(a) * d, ly + math.sin(a) * d
            ang = math.atan2(y - cy, x - cx) + rng.uniform(-0.8, 0.8)
            _spray(cv, x, y, ang, spray_len * rng.uniform(0.7, 1.2), leaf_len, leaf_w, _tone(rng, tone, 0.1, 0.03), rng, pairs, clip)


def _flower_mass(cv, rect, rng, reds, count, green=None, green_count=0, flower=9.0):
    """Delonix flower masses: packed five-petal blooms with a few yellow-white flecks."""
    x0, y0, w_, h_ = rect
    clip = (x0 + 2, y0 + 2, x0 + w_ - 2, y0 + h_ - 2)
    cx, cy = x0 + w_ / 2, y0 + h_ / 2
    lobes = _lobes(rng, cx, cy, min(w_, h_) * 0.45, n=7)
    if green is not None:
        for _ in range(green_count):
            lx, ly, lr = lobes[rng.randrange(len(lobes))]
            a, d = rng.uniform(0, 6.283), lr * math.sqrt(rng.random())
            x, y = lx + math.cos(a) * d, ly + math.sin(a) * d
            _spray(cv, x, y, math.atan2(y - cy, x - cx) + rng.uniform(-1, 1), w_ * 0.09, 3.2, 1.3, _tone(rng, green, 0.1, 0.03), rng, 9, clip)
    deep = reds[0]
    # trusses of bloom with sky gaps between them; the first few are dark for depth
    trusses = []
    for _ in range(max(10, count // 11)):
        lx, ly, lr = lobes[rng.randrange(len(lobes))]
        a, d = rng.uniform(0, 6.283), lr * math.sqrt(rng.random())
        trusses.append((lx + math.cos(a) * d, ly + math.sin(a) * d, flower * rng.uniform(3.0, 4.8)))
    for tx, ty, tr in trusses:
        for _ in range(12):
            a, d = rng.uniform(0, 6.283), tr * math.sqrt(rng.random()) * 0.85
            cv.stamp(tx + math.cos(a) * d, ty + math.sin(a) * d, flower * rng.uniform(0.8, 1.2), flower * rng.uniform(0.45, 0.65), rng.uniform(0, 3.14), _tone(rng, deep, 0.12), rib=0.1, clip=clip)
    for _ in range(count):
        tx, ty, tr = trusses[rng.randrange(len(trusses))]
        a, d = rng.uniform(0, 6.283), tr * math.sqrt(rng.random())
        x, y = tx + math.cos(a) * d, ty + math.sin(a) * d
        tone = reds[rng.randrange(len(reds))]
        rot = rng.uniform(0, 6.283)
        for i in range(5):
            pa = rot + i * 6.283 / 5
            L = flower * rng.uniform(0.42, 0.62)
            cv.stamp(x + math.cos(pa) * L, y + math.sin(pa) * L, L, L * 0.62, pa, _tone(rng, tone, 0.1), rib=0.05, side=0.05, clip=clip)
        if rng.random() < 0.3:
            pa = rot + 1.0
            cv.stamp(x + math.cos(pa) * flower * 0.45, y + math.sin(pa) * flower * 0.45, flower * 0.42, flower * 0.26, pa, srgb("#f6e6c0"), rib=0.0, clip=clip)


def leaf_material(name, canvas):
    """Alpha-clip leaf material. The exporter reads MASK from the Greater Than node."""
    img = canvas.to_image(name + "_tex")
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Alpha"], gt.inputs[0])
    nt.links.new(gt.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.62
    mat.blend_method = "CLIP"
    mat.use_backface_culling = False
    return mat


def canopy_cards(name, mat, blobs, cells, n_total, rng, card=(2.0, 3.0), cell_fn=None, canopy_c=None, radial_mix=0.5, interior=0.16):
    """Quads scattered over overlapping ellipsoid blobs, with normals bent outward so the
    crown shades like one soft mass. blobs = [(centre, (rx, ry, rz))]; cells = [(u0, v0, u1, v1), ...]."""
    canopy_c = Vector(canopy_c)
    zs = [b[0][2] - b[1][2] for b in blobs] + [b[0][2] + b[1][2] for b in blobs]
    zlo, zhi = min(zs), max(zs)
    vols = [b[1][0] * b[1][1] + b[1][1] * b[1][2] + b[1][0] * b[1][2] for b in blobs]
    tot = sum(vols)
    verts, faces, uvs, normals = [], [], [], []

    def inside_other(p, skip):
        for i, (c, r) in enumerate(blobs):
            if i == skip:
                continue
            d = ((p.x - c[0]) / r[0]) ** 2 + ((p.y - c[1]) / r[1]) ** 2 + ((p.z - c[2]) / r[2]) ** 2
            if d < 0.42:
                return True
        return False

    placed = 0
    for bi, (c, r) in enumerate(blobs):
        c_ = Vector(c)
        count = int(n_total * vols[bi] / tot + 0.5)
        tries = 0
        made = 0
        while made < count and tries < count * 6:
            tries += 1
            while True:
                d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
                if d.length > 1e-3:
                    d.normalize()
                    break
            is_inner = rng.random() < interior
            shell = rng.uniform(0.2, 0.6) if is_inner else rng.uniform(0.72, 1.03)
            q = Vector((d.x * r[0], d.y * r[1], d.z * r[2])) * shell
            pos = c_ + q
            if not is_inner and inside_other(pos, bi):
                continue
            size = rng.uniform(*card) * (1.2 if is_inner else 1.0)
            nrm = Vector((d.x + rng.uniform(-0.75, 0.75), d.y + rng.uniform(-0.75, 0.75), d.z + rng.uniform(-0.55, 0.75)))
            if nrm.length < 0.2:
                nrm = d.copy()
            nrm.normalize()
            if nrm.dot(d) < 0.1:
                nrm = (nrm + d * 0.6).normalized()
            up = Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 1.0))
            t = up.cross(nrm)
            if t.length < 1e-3:
                t = Vector((1, 0, 0))
            t.normalize()
            b = nrm.cross(t)
            roll = rng.uniform(-1.0, 1.0)
            ct, st = math.cos(roll), math.sin(roll)
            t, b = t * ct + b * st, b * ct - t * st
            h = (pos.z - zlo) / max(zhi - zlo, 0.01)
            cell = cell_fn(pos, h, is_inner, rng) if cell_fn else cells[rng.randrange(len(cells))]
            u0, v0, u1, v1 = cell
            base = len(verts)
            for sx, sy, uu, vv in ((-1, -1, u0, v0), (1, -1, u1, v0), (1, 1, u1, v1), (-1, 1, u0, v1)):
                vp = pos + (t * sx + b * sy) * (size * 0.5)
                verts.append(tuple(vp))
                uvs.append((uu, vv))
                radial = (vp - c_)
                radial = Vector((radial.x / max(r[0], 0.01), radial.y / max(r[1], 0.01), radial.z / max(r[2], 0.01)))
                whole = vp - canopy_c
                n = radial.normalized() * radial_mix + whole.normalized() * (1 - radial_mix) + Vector((0, 0, 0.18))
                normals.append(tuple(n.normalized()))
            faces.append((base, base + 1, base + 2, base + 3))
            made += 1
            placed += 1
    return _card_mesh(name, verts, faces, uvs, normals, mat), placed


def _card_mesh(name, verts, faces, uvs, normals, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap").data
    for poly in mesh.polygons:
        poly.use_smooth = True
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uv_layer[li].uv = uvs[vi]
    if normals is not None:
        mesh.normals_split_custom_set_from_vertices(normals)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bark(name, c1, c2, c3=None, stretch=(16.0, 16.0, 1.6), plates=7.0, depth=1.0, moss=0.25, rough=0.9, rings=0.0):
    """Furrowed bark: stretched noise plus stretched cells for plates and fissures."""
    c3 = c3 or mul3(c2, 0.45)
    mat = bo.pbr(name, c1, rough)
    g = G(mat)
    n = g.noise(vec=g.vscale(stretch), scale=1.0, detail=7.0, rough=0.62, dist=0.5)
    d, cell = g.voronoi(vec=g.vscale((stretch[0] * 0.55, stretch[1] * 0.55, stretch[2] * 0.55)), scale=plates * 0.3)
    fissure = g.smooth(d, 0.1, 0.34)
    col = g.mix(c1, c2, g.smooth(n, 0.36, 0.66))
    col = g.mix(c3, col, fissure)
    col = g.mix(col, lerp3(c1, (1, 1, 1), 0.25), g.mul(g.smooth(g.noise(scale=3.0, detail=4.0), 0.55, 0.75), 0.3))
    height = g.add(g.mul(n, 0.7), g.mul(fissure, depth))
    if rings > 0:
        ln = g.line(g.z, rings, 0.03)
        col = g.mix(col, mul3(c3, 0.8), g.mul(ln, 0.85))
        height = g.sub(height, g.mul(ln, 1.1))
    if moss > 0:
        m = g.smooth(g.noise(scale=1.4, detail=6.0), 0.5, 0.66)
        low = g.smooth(g.z, 2.6, 0.2)
        col = g.mix(col, rgb("#4d5a2c"), g.mulc(g.mul(m, low), moss))
    col = g.mix(col, rgb("#4a4034"), g.mul(g.smooth(g.z, 0.6, 0.0), 0.5))
    g.color(col)
    g.rough(rough)
    g.surface(height, strength=0.9, distance=0.04)
    return mat


def _bend(a, b, sag, n, rng, jitter=0.0):
    """Curved limb points from a to b, sag lifts or droops the middle."""
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(n):
        t = i / (n - 1)
        q = a.lerp(b, t)
        q.z += sag * math.sin(t * math.pi)
        if 0 < i < n - 1 and jitter:
            q += Vector((rng.uniform(-jitter, jitter), rng.uniform(-jitter, jitter), rng.uniform(-jitter, jitter)))
        pts.append(q)
    return pts


def _taper(r0, r1, n):
    return [r0 + (r1 - r0) * (i / (n - 1)) ** 0.85 for i in range(n)]


def _flare(strength, levels, lobes=5, seed=0.7):
    """Root flare: bulges low on the trunk, fading with ring index."""
    def fn(th, i):
        if i >= levels:
            return 1.0
        f = 1.0 - i / levels
        return 1.0 + strength * f * f * (0.55 + 0.45 * math.sin(th * lobes + seed))
    return fn


def _tree_finish(k, leaves_fn, size=768, normal=768, leaf_quality=86):
    k.finish(size=size, normal=normal, rm=256, ao=256, samples=10, ao_dist=1.2, ao_strength=0.7, angle=95.0, name="trunk", ao_samples=32)
    leaves_fn()
    k.export(quality=leaf_quality)
    k.run_previews(size=(640, 560))


def _cells_2x2(pad=0.0):
    return [(0.0 + pad, 0.0 + pad, 0.5 - pad, 0.5 - pad), (0.5 + pad, 0.0 + pad, 1.0 - pad, 0.5 - pad), (0.0 + pad, 0.5 + pad, 0.5 - pad, 1.0 - pad), (0.5 + pad, 0.5 + pad, 1.0 - pad, 1.0 - pad)]


@asset("tree_raintree")
def build_tree_raintree():
    k = Kit("tree_raintree", "props")
    rng = random.Random(11)
    trunk_m = bark("rt_bark", rgb("#6d5c49"), rgb("#4c3f33"), stretch=(15.0, 15.0, 1.3), moss=0.4)
    limb_m = bark("rt_limb", rgb("#655543"), rgb("#4a3e31"), stretch=(7.0, 7.0, 7.0), moss=0.15, depth=0.6)

    fork = Vector((0.15, -0.1, 3.3))
    tp = _bend((0, 0, 0), fork, 0.0, 6, rng, 0.05)
    k.sweep(tp, [0.82, 0.62, 0.52, 0.5, 0.5, 0.52], trunk_m, seg=9, fn=_flare(0.65, 3, lobes=5))
    # wide spreading limbs from a short bole, each forking towards a canopy lump
    ends = []
    prim = 6
    for i in range(prim):
        a = 2 * math.pi * i / prim + rng.uniform(-0.2, 0.2)
        r1 = rng.uniform(3.4, 4.6)
        p1 = Vector((math.cos(a) * r1, math.sin(a) * r1, rng.uniform(5.2, 6.4)))
        pts = _bend(fork + Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, -0.1)), p1, 0.45, 5, rng, 0.08)
        k.sweep(pts, _taper(0.34, 0.15, 5), limb_m, seg=6)
        for j in range(3):
            b = a + (j - 1) * rng.uniform(0.45, 0.65)
            r2 = r1 + rng.uniform(2.0, 3.7)
            p2 = Vector((math.cos(b) * r2, math.sin(b) * r2, p1.z + rng.uniform(0.6, 2.4)))
            q = _bend(p1, p2, 0.3, 4, rng, 0.1)
            k.sweep(q, _taper(0.13, 0.045, len(q)), limb_m, seg=4)
            ends.append(p2)
            for m in range(2):
                c = b + (m - 0.5) * 0.9
                p3 = p2 + Vector((math.cos(c) * rng.uniform(1.0, 1.7), math.sin(c) * rng.uniform(1.0, 1.7), rng.uniform(-0.2, 0.7)))
                k.sweep([p2, p3], [0.045, 0.012], limb_m, seg=3, end_cap=False)
    # centre leader limbs
    for i in range(3):
        a = 1.0 + i * 2.1
        p1 = Vector((math.cos(a) * 1.6, math.sin(a) * 1.6, rng.uniform(7.6, 8.6)))
        k.sweep(_bend(fork, p1, 0.2, 4, rng, 0.08), _taper(0.26, 0.08, 4), limb_m, seg=6)

    k.preview((15.5, -25.0, 2.2), (0, 0, 6.6), 30, "far")
    k.preview((5.5, -9.5, 1.6), (0, 0, 7.5), 26, "under")
    k.preview((-20, -18, 13), (0, 0, 7.5), 30, "high")

    def leaves():
        cv = Canvas(1024, 1024, srgb("#3a5f2a"))
        rects = [(0, 0, 512, 512), (512, 0, 512, 512), (0, 512, 512, 512), (512, 512, 512, 512)]
        sets = [
            ((srgb("#2f5a26"), srgb("#4b8034"), srgb("#79a846"), srgb("#9abf58")), (46, 80, 70, 36)),  # sunlit top
            ((srgb("#2a5124"), srgb("#3f7230"), srgb("#5f963c"), srgb("#7cac48")), (46, 80, 70, 30)),  # mid
            ((srgb("#1f3f1e"), srgb("#2d5a26"), srgb("#40762e"), srgb("#528a36")), (50, 80, 60, 20)),  # underside
            ((srgb("#33602a"), srgb("#5a8a38"), srgb("#8cae4e"), srgb("#adc765")), (46, 80, 70, 34)),  # yellow-green flush
        ]
        for rect, (tones, counts) in zip(rects, sets):
            _pinnate_clump(cv, rect, tones, counts, rng, 5.2, 2.0, 40.0, 11)
        mat = leaf_material("tree_raintree_leaf", cv)
        cells = _cells_2x2()

        def pick(pos, h, inner, r_):
            if inner or h < 0.3:
                return cells[2]
            if h < 0.62:
                return cells[1] if r_.random() < 0.75 else cells[2]
            return cells[3] if r_.random() < 0.3 else cells[0]
        blobs = [((0, 0, 9.7), (5.0, 5.0, 2.25))]
        for i in range(7):
            a = 2 * math.pi * i / 7 + 0.3
            blobs.append(((math.cos(a) * 5.9, math.sin(a) * 5.9, rng.uniform(8.3, 9.3)), (3.9, 3.9, 2.0)))
        for i in range(5):
            a = 2 * math.pi * i / 5 + 0.9
            blobs.append(((math.cos(a) * 3.0, math.sin(a) * 3.0, rng.uniform(9.6, 10.2)), (3.1, 3.1, 1.75)))
        obj, n = canopy_cards("leaves", mat, blobs, cells, 1950, rng, card=(2.1, 3.1), cell_fn=pick, canopy_c=(0, 0, 7.4))
        print(f"[props]   raintree cards: {n}")
    _tree_finish(k, leaves)


@asset("tree_krishnachura")
def build_tree_krishnachura():
    k = Kit("tree_krishnachura", "props")
    rng = random.Random(23)
    trunk_m = bark("kc_bark", rgb("#8b806f"), rgb("#6a6054"), stretch=(9.0, 9.0, 2.2), depth=0.45, moss=0.3)
    limb_m = bark("kc_limb", rgb("#847967"), rgb("#62584c"), stretch=(5.0, 5.0, 5.0), moss=0.05, depth=0.3)
    fork = Vector((-0.1, 0.1, 2.6))
    k.sweep(_bend((0, 0, 0), fork, 0.0, 5, rng, 0.04), [0.56, 0.42, 0.36, 0.36, 0.38], trunk_m, seg=10, fn=_flare(0.7, 3, lobes=6, seed=0.2))
    for i in range(5):
        a = 2 * math.pi * i / 5 + rng.uniform(-0.25, 0.25)
        r1 = rng.uniform(2.6, 3.4)
        p1 = Vector((math.cos(a) * r1, math.sin(a) * r1, rng.uniform(4.6, 5.4)))
        k.sweep(_bend(fork, p1, 0.3, 5, rng, 0.08), _taper(0.27, 0.12, 5), limb_m, seg=7)
        for j in range(3):
            b = a + (j - 1) * 0.6
            r2 = r1 + rng.uniform(1.6, 2.8)
            p2 = Vector((math.cos(b) * r2, math.sin(b) * r2, p1.z + rng.uniform(0.7, 1.8)))
            k.sweep(_bend(p1, p2, 0.25, 3, rng, 0.08), _taper(0.1, 0.035, 3), limb_m, seg=4)
            for m in range(2):
                c = b + (m - 0.5) * 1.0
                p3 = p2 + Vector((math.cos(c) * 1.3, math.sin(c) * 1.3, rng.uniform(0.0, 0.7)))
                k.sweep([p2, p3], [0.035, 0.01], limb_m, seg=3, end_cap=False)
        # hanging flat bean pods, the tree's other signature
        for j in range(2):
            b = a + rng.uniform(-1, 1)
            r3 = rng.uniform(3.8, 6.0)
            top = Vector((math.cos(b) * r3, math.sin(b) * r3, rng.uniform(5.4, 6.2)))
            k.box((0.05, 0.012, 0.5), tuple(top - Vector((0, 0, 0.25))), limb_m, rot=(rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(0, 3.14)))

    k.preview((12, -21, 2.0), (0, 0, 5.8), 30, "far")
    k.preview((3.5, -7.5, 1.6), (0, 0, 7.0), 26, "under")
    k.preview((-15, -15, 11), (0, 0, 6.5), 30, "high")

    def leaves():
        cv = Canvas(1024, 1024, srgb("#b23c18"))
        reds = [srgb("#a4220e"), srgb("#d23212"), srgb("#e64410"), srgb("#de2a12"), srgb("#ee5a14")]
        rects = [(0, 0, 512, 512), (512, 0, 512, 512), (0, 512, 512, 512), (512, 512, 512, 512)]
        # flower mass, flower mass over green, fern green, darker green
        _flower_mass(cv, rects[0], rng, reds, 1300, green=srgb("#4f7f2e"), green_count=60, flower=7.5)
        _flower_mass(cv, rects[1], rng, reds[:4], 620, green=srgb("#4f8a2e"), green_count=240, flower=7.0)
        _pinnate_clump(cv, rects[2], (srgb("#2e5b24"), srgb("#467c2e"), srgb("#6fa23c"), srgb("#8fbb4a")), (40, 70, 70, 30), rng, 3.6, 1.45, 42.0, 15)
        _pinnate_clump(cv, rects[3], (srgb("#21431d"), srgb("#315f26"), srgb("#487c2e"), srgb("#5b9136")), (46, 80, 60, 16), rng, 3.6, 1.45, 42.0, 15)
        mat = leaf_material("tree_krishnachura_leaf", cv)
        cells = _cells_2x2()

        def pick(pos, h, inner, r_):
            if inner:
                return cells[3]
            # broad patches of flower over the crown, thinning underneath
            patch = 0.5 + 0.2 * math.sin(pos.x * 0.8 + 1.3) * math.cos(pos.y * 0.75 - 0.4) + 0.12 * math.sin(pos.z * 1.3 + pos.x * 0.3)
            f = patch + (h - 0.3) * 0.8 + r_.uniform(-0.18, 0.18)
            if f > 0.62:
                return cells[0] if r_.random() < 0.8 else cells[1]
            if f > 0.42:
                return cells[1] if r_.random() < 0.75 else cells[0]
            if f > 0.26:
                return cells[1] if r_.random() < 0.4 else cells[2]
            return cells[3] if h < 0.3 else cells[2]
        blobs = [((0, 0, 8.4), (4.2, 4.2, 1.7))]
        for i in range(7):
            a = 2 * math.pi * i / 7 + 0.1
            blobs.append(((math.cos(a) * 4.8, math.sin(a) * 4.8, rng.uniform(7.1, 7.9)), (3.0, 3.0, 1.75)))
        for i in range(4):
            a = 2 * math.pi * i / 4 + 0.7
            blobs.append(((math.cos(a) * 2.4, math.sin(a) * 2.4, rng.uniform(8.2, 8.7)), (2.5, 2.5, 1.35)))
        obj, n = canopy_cards("leaves", mat, blobs, cells, 1950, rng, card=(1.5, 2.3), cell_fn=pick, canopy_c=(0, 0, 6.0))
        print(f"[props]   krishnachura cards: {n}")
    _tree_finish(k, leaves)


@asset("tree_mehgoni")
def build_tree_mehgoni():
    k = Kit("tree_mehgoni", "props")
    rng = random.Random(31)
    trunk_m = bark("mg_bark", rgb("#5d4a3a"), rgb("#3d3027"), stretch=(18.0, 18.0, 2.2), plates=11.0, moss=0.35)
    limb_m = bark("mg_limb", rgb("#5a4939"), rgb("#3f332a"), stretch=(8.0, 8.0, 8.0), moss=0.05, depth=0.5)
    tp = [(0, 0, 0), (0.02, 0, 1.2), (0.05, 0.03, 3.0), (0.03, 0.05, 5.0), (0, 0.02, 7.0), (0.0, 0.0, 9.2)]
    k.sweep(tp, [0.42, 0.3, 0.27, 0.22, 0.15, 0.05], trunk_m, seg=10, fn=_flare(0.45, 2, lobes=5))
    for i in range(12):
        z = 3.6 + i * 0.5
        a = i * 2.4 + rng.uniform(-0.2, 0.2)
        rr = 2.1 - abs(z - 5.8) * 0.28
        p1 = Vector((math.cos(a) * rr, math.sin(a) * rr, z + rng.uniform(1.1, 1.8)))
        k.sweep(_bend((0, 0, z), p1, 0.1, 3, rng, 0.05), [0.09 - i * 0.004, 0.045, 0.015], limb_m, seg=5)
    k.preview((7.5, -19, 2.0), (0, 0, 5.8), 30, "far")
    k.preview((2.2, -6.0, 1.6), (0, 0, 5.5), 28, "under")
    k.preview((-11, -12, 10), (0, 0, 6.0), 30, "high")

    def leaves():
        cv = Canvas(1024, 1024, srgb("#23451f"))
        rects = [(0, 0, 512, 512), (512, 0, 512, 512), (0, 512, 512, 512), (512, 512, 512, 512)]
        sets = [
            (srgb("#1b3a1b"), srgb("#2c5a26"), srgb("#3f7a30"), srgb("#5a953c")),
            (srgb("#183418"), srgb("#264e22"), srgb("#366a2a"), srgb("#478035")),
            (srgb("#122a14"), srgb("#1c3f1b"), srgb("#2a5523"), srgb("#346428")),
            (srgb("#1e401d"), srgb("#335f27"), srgb("#4e8432"), srgb("#76a644")),
        ]
        for rect, tones in zip(rects, sets):
            _pinnate_clump(cv, rect, tones, (22, 34, 34, 18), rng, 12.0, 4.2, 50.0, 5)
        mat = leaf_material("tree_mehgoni_leaf", cv)
        cells = _cells_2x2()

        def pick(pos, h, inner, r_):
            if inner or h < 0.22:
                return cells[2]
            if h < 0.55:
                return cells[1]
            return cells[3] if r_.random() < 0.28 else cells[0]
        blobs = [((0.1, 0, 9.5), (1.3, 1.3, 1.5)), ((-0.1, 0.1, 7.8), (2.05, 2.05, 2.0)), ((0, -0.1, 5.9), (2.3, 2.3, 2.1)), ((0.1, 0, 4.5), (1.9, 1.9, 1.4))]
        for i in range(8):
            a = i * 2.4 + 0.4
            z = 3.9 + i * 0.75
            rr = 1.75 - abs(z - 6.0) * 0.26
            blobs.append(((math.cos(a) * rr, math.sin(a) * rr, z), (1.2, 1.2, 1.25)))
        obj, n = canopy_cards("leaves", mat, blobs, cells, 1750, rng, card=(0.95, 1.5), cell_fn=pick, canopy_c=(0, 0, 6.4), radial_mix=0.45)
        print(f"[props]   mehgoni cards: {n}")
    _tree_finish(k, leaves)


def _paint_frond(cv, rect, rng, tones, dry=False):
    """One coconut frond in a tall cell: rachis up the middle, base at the bottom, long pinnae raked to the tip."""
    x0, y0, w_, h_ = rect
    clip = (x0 + 1, y0 + 1, x0 + w_ - 1, y0 + h_ - 1)
    cx = x0 + w_ / 2
    steps = 72
    for i in range(steps):
        t = (i + 2) / (steps + 2)
        y = y0 + h_ * (0.02 + 0.94 * t)
        env = math.sin(math.pi * (t * 0.8 + 0.13)) ** 0.65
        for sd in (-1, 1):
            L = (w_ * 0.5 - 3) * env * rng.uniform(0.88, 1.0)
            ang_from = rng.uniform(0.95, 1.15) - 0.55 * t
            a = math.pi / 2 - sd * ang_from
            hl = L / max(math.sin(ang_from), 0.25) * 0.5
            hl = min(hl, h_ * 0.16)
            ex, ey = cx + math.cos(a) * hl, y + math.sin(a) * hl
            tone = tones[rng.randrange(len(tones))]
            cv.stamp(ex, ey, hl, rng.uniform(2.5, 3.4), a, _tone(rng, tone, 0.1, 0.02), rib=0.16, side=0.08, clip=clip)
    # rachis on top
    for i in range(24):
        t = i / 24
        y = y0 + h_ * (0.0 + 0.95 * t)
        cv.stamp(cx, y + h_ * 0.02, h_ * 0.03, 3.2 - 2.2 * t, math.pi / 2, srgb("#a9a15a") if not dry else srgb("#8c7040"), rib=0.0, side=0.1, clip=clip)


def _frond_card(verts, faces, uvs, base, direction, length, droop, width, cell, nseg, rng):
    """Curved V-section frond: two wings either side of an arcing spine."""
    u0, v0, u1, v1 = cell
    um = (u0 + u1) * 0.5
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    roll = rng.uniform(-0.25, 0.25)
    spine = Vector(base)
    step = length / nseg
    heading = d.copy()
    start = len(verts)
    for i in range(nseg + 1):
        t = i / nseg
        wd = width * (0.5 + 0.5 * min(1.0, t * 2.4))
        lift = 0.34 * wd * (1.0 - t * 0.6)
        s = side * math.cos(roll) + Vector((0, 0, 1)) * math.sin(roll)
        verts.append(tuple(spine - s * wd + Vector((0, 0, -lift))))
        verts.append(tuple(spine))
        verts.append(tuple(spine + s * wd + Vector((0, 0, -lift))))
        vv = v0 + (v1 - v0) * t
        uvs += [(u0, vv), (um, vv), (u1, vv)]
        spine = spine + heading * step
        heading = (heading + Vector((0, 0, -droop / nseg))).normalized()
    for i in range(nseg):
        a = start + i * 3
        faces.append((a, a + 3, a + 4, a + 1))
        faces.append((a + 1, a + 4, a + 5, a + 2))


@asset("tree_coconut")
def build_tree_coconut():
    k = Kit("tree_coconut", "props")
    rng = random.Random(5)
    trunk_m = bark("cn_bark", rgb("#857a68"), rgb("#6a604f"), rgb("#3e372c"), stretch=(24.0, 24.0, 4.0), plates=6.0, depth=0.35, moss=0.35, rings=0.24)
    sheath = bark("cn_sheath", rgb("#7b6547"), rgb("#54422c"), stretch=(30.0, 30.0, 1.5), depth=0.4, moss=0.0)
    nut = painted("cn_nut", rgb("#6f8a2e"), under=rgb("#8a7a3a"), wear=0.2, fade=0.4, dirt=0.0, drip=0.0, rough=0.42, bevel=0.0, scale=3.0)
    nut2 = painted("cn_nut2", rgb("#b39b34"), under=rgb("#8a6a2a"), wear=0.25, fade=0.3, dirt=0.0, drip=0.0, rough=0.45, bevel=0.0, scale=3.0)

    # gently S-curved leaning trunk
    pts, radii = [], []
    n = 16
    top = None
    for i in range(n):
        t = i / (n - 1)
        z = 11.1 * t
        x = 1.15 * math.sin(t * math.pi * 0.62) ** 1.2 - 0.25 * t
        y = 0.42 * math.sin(t * math.pi * 1.1)
        pts.append((x, y, z))
        radii.append(0.17 + 0.09 * (1 - t) ** 2 + 0.1 * math.exp(-t * 22) + (0.04 if t > 0.94 else 0))
    top = Vector(pts[-1])
    k.sweep(pts, radii, trunk_m, seg=9, fn=_flare(0.45, 2, lobes=7))
    # sheath boots and crown cone
    for i in range(9):
        a = i * 2.39
        c = top + Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, -0.1 + i * 0.05))
        tip = c + Vector((math.cos(a) * 0.65, math.sin(a) * 0.65, 0.5 + rng.uniform(-0.1, 0.25)))
        k.sweep([c, c.lerp(tip, 0.5), tip], [0.11, 0.075, 0.03], sheath, seg=5)
    k.sweep([top + Vector((0, 0, -0.2)), top + Vector((0, 0, 0.45)), top + Vector((0, 0, 1.0))], [0.21, 0.14, 0.03], sheath, seg=7)
    # nut bunches under the crown
    for i in range(14):
        a = rng.uniform(0, 6.283)
        d = rng.uniform(0.26, 0.42)
        c = top + Vector((math.cos(a) * d, math.sin(a) * d, rng.uniform(-0.55, -0.12)))
        m = nut if rng.random() < 0.72 else nut2
        r = rng.uniform(0.105, 0.13)
        k.sphere(r, tuple(c), m, seg=8, rings=5, scale=(1, 1, 1.15))
    k.preview((6.5, -17.0, 2.0), (0.4, 0, 6.8), 34, "far")
    k.preview((3.0, -5.6, 1.7), (0.8, 0.2, 10.0), 28, "under")
    k.preview((-8.5, -9, 15), (0.9, 0.1, 10.5), 34, "crown")

    def leaves():
        cv = Canvas(1024, 1024, srgb("#4d7f30"))
        rects = [(0, 0, 340, 1024), (342, 0, 340, 1024), (684, 0, 340, 1024)]
        _paint_frond(cv, rects[0], rng, [srgb("#2f6a22"), srgb("#3f7f28"), srgb("#5c9632"), srgb("#3a7526")])
        _paint_frond(cv, rects[1], rng, [srgb("#245419"), srgb("#2f6a22"), srgb("#3f7a26"), srgb("#4c8530")])
        _paint_frond(cv, rects[2], rng, [srgb("#a39446"), srgb("#8c7a3a"), srgb("#b7a650"), srgb("#7f6c34")], dry=True)
        mat = leaf_material("tree_coconut_leaf", cv)
        cells = [(0.0, 0.0, 340 / 1024, 1.0), (342 / 1024, 0.0, 682 / 1024, 1.0), (684 / 1024, 0.0, 1.0, 1.0)]
        verts, faces, uvs = [], [], []
        layers = ((11, 0.62, 3.9, 0.95, 0), (13, 0.22, 4.6, 1.5, 0), (9, -0.25, 4.2, 2.1, 1), (4, -0.75, 3.0, 2.6, 2))
        for count, rise, length, droop, tone in layers:
            for i in range(count):
                a = 2 * math.pi * i / count + rng.uniform(-0.22, 0.22) + rise
                d = Vector((math.cos(a), math.sin(a), rise + rng.uniform(-0.12, 0.12)))
                L = length * rng.uniform(0.86, 1.1)
                cell = cells[tone if rng.random() > 0.15 or tone == 2 else 1 - tone]
                _frond_card(verts, faces, uvs, top + Vector((0, 0, 0.3 + rng.uniform(-0.1, 0.25))), d, L, droop, 0.92, cell, 8, rng)
        obj = _card_mesh("leaves", verts, faces, uvs, None, mat)
        print(f"[props]   coconut fronds: {sum(l[0] for l in layers)}")
    _tree_finish(k, leaves, size=512, normal=512)


def _paint_banana_leaf(cv, rect, rng, base, dark, rib_col, tears, burn=0.25, seed=0.0):
    """One big banana leaf, base at the bottom: pale midrib, fine side veins, wind-torn slits, burnt edges."""
    x0, y0, w_, h_ = rect
    ys, xs = np.mgrid[0:h_, 0:w_]
    t = (ys + 0.5) / h_
    u = (xs + 0.5) / w_ * 2 - 1
    half = (np.sin(np.pi * np.clip(t * 0.98 + 0.012, 0, 1) ** 0.72) ** 0.42) * 0.97
    edge = np.abs(u) / np.maximum(half, 1e-3)
    alpha = (edge < 1.0).astype(np.float32)
    for (tk, dep, wid, side) in tears:
        along = np.abs(t - tk - (1.0 - edge) * 0.05)
        cut = (np.sign(u) == side) & (edge > (1.0 - dep)) & (along < wid * (edge - (1.0 - dep)) / max(dep, 1e-3) + 0.0012)
        alpha[cut] = 0.0
    noise = np.sin(ys * 0.41 + np.sin(xs * 0.09) * 3.0) * 0.5 + 0.5
    veins = 0.5 + 0.5 * np.sin(t * h_ * 1.05 + u * 8.0 + seed)
    col = np.empty((h_, w_, 3), dtype=np.float32)
    mottling = 0.5 + 0.5 * np.sin(u * 7.0 + t * 19.0 + seed) * np.sin(t * 31.0 - u * 4.0)
    for c in range(3):
        col[:, :, c] = base[c] * (0.88 + 0.16 * veins) * (0.9 + 0.14 * mottling) * (0.8 + 0.2 * np.abs(u))
    # lighter strip down the rib, darker in the fold beside it
    near = np.abs(u)
    col *= (0.82 + 0.18 * np.clip(near / 0.1, 0, 1))[:, :, None]
    rib = near < (0.03 + 0.015 * (1 - t))
    col[rib] = rib_col
    # burnt, papery edges and tips
    burn_mask = np.clip((edge - (1.0 - burn * (0.35 + 0.65 * noise))) / max(burn * 0.5, 1e-3), 0, 1) * (edge < 1.2)
    burn_col = srgb("#7d6a34")
    for c in range(3):
        col[:, :, c] = col[:, :, c] * (1 - burn_mask) + burn_col[c] * burn_mask
    cv.rgb[y0:y0 + h_, x0:x0 + w_] = col
    cv.a[y0:y0 + h_, x0:x0 + w_] = alpha


def _banana_leaf_mesh(verts, faces, uvs, base, azim, rise, length, width, droop, cell, rng, nv=9, nu=4):
    """Arched leaf blade with a folded midrib and a slight twist."""
    u0, v0, u1, v1 = cell
    ca, sa = math.cos(azim), math.sin(azim)
    d = Vector((ca, sa, 0))
    side = Vector((-sa, ca, 0))
    pos = Vector(base)
    pitch = rise
    step = length / nv
    twist = rng.uniform(-0.25, 0.25)
    start = len(verts)
    for i in range(nv + 1):
        t = i / nv
        tilt = twist * t
        hw = width * 0.5
        for j in range(nu + 1):
            a = -1.0 + 2.0 * j / nu
            fold = abs(a) * 0.2 * hw * (1 - 0.3 * t)
            wave = 0.02 * math.sin(t * 11.0 + a * 3.0) * abs(a)
            q = pos + side * (a * hw * math.cos(tilt)) + Vector((0, 0, fold * 1.2 + a * hw * math.sin(tilt) + wave - abs(a) ** 3 * 0.06))
            verts.append(tuple(q))
            uvs.append((u0 + (u1 - u0) * (a + 1) * 0.5, v0 + (v1 - v0) * t))
        pos = pos + (d * math.cos(pitch) + Vector((0, 0, math.sin(pitch)))) * step
        pitch -= droop / nv
    row = nu + 1
    for i in range(nv):
        for j in range(nu):
            a = start + i * row + j
            faces.append((a, a + 1, a + row + 1, a + row))


@asset("tree_banana")
def build_tree_banana():
    k = Kit("tree_banana", "props")
    rng = random.Random(9)
    stem_m = bark("bn_stem", rgb("#8d8f55"), rgb("#6b6b3e"), rgb("#4b4426"), stretch=(32.0, 32.0, 1.1), plates=4.0, depth=0.5, moss=0.0, rough=0.7)
    brown = bark("bn_brown", rgb("#7b6240"), rgb("#54422a"), stretch=(30.0, 30.0, 1.2), depth=0.4, moss=0.0)
    fruit = bo.pbr("bn_fruit", rgb("#6d9a3a"), 0.5)
    g = G(fruit)
    g.color(g.mix(rgb("#6d9a3a"), rgb("#94a23c"), g.smooth(g.noise(scale=8.0, detail=3.0), 0.4, 0.62)))
    bud = painted("bn_bud", rgb("#5d1f33"), wear=0.0, fade=0.2, dirt=0.0, drip=0.0, rough=0.4, bevel=0.0)
    stalk = flat("bn_stalk", rgb("#6c7a35"), rough=0.7)
    z_top = 2.3
    k.sweep([(0, 0, 0), (0.01, 0, 0.5), (0.03, 0.01, 1.2), (0.05, 0.02, 1.9), (0.06, 0.02, z_top)], [0.17, 0.135, 0.115, 0.095, 0.07], stem_m, seg=9, fn=_flare(0.35, 2, lobes=4))
    # dead sheath strips hugging the lower stem and two young suckers
    for i in range(4):
        a = i * 2.3
        z = 0.2 + i * 0.3
        k.sweep([(math.cos(a) * 0.145, math.sin(a) * 0.145, z - 0.2), (math.cos(a) * 0.15, math.sin(a) * 0.15, z + 0.35)], [0.05, 0.03], brown, seg=4)
    for (x, y, h) in ((0.42, 0.2, 0.6), (-0.34, 0.33, 0.42)):
        k.sweep([(x, y, 0.0), (x, y, h)], [0.075, 0.03], stem_m, seg=5)
    # fruit stalk with a bunch and the dark purple bud
    a0 = 0.9
    px, py = math.cos(a0), math.sin(a0)
    fr = [(0.06, 0.02, z_top - 0.1), (0.2 * px, 0.2 * py, z_top + 0.02), (0.42 * px, 0.42 * py, z_top - 0.16), (0.5 * px, 0.5 * py, z_top - 0.55), (0.5 * px, 0.5 * py, z_top - 1.0)]
    k.tube(fr, 0.024, stalk, seg=6)
    for row in range(5):
        z = z_top - 0.2 - row * 0.15
        n_f = 7 - row // 2
        for i in range(n_f):
            a = 2 * math.pi * i / n_f + row * 0.4
            base = Vector((0.5 * px + math.cos(a) * 0.04, 0.5 * py + math.sin(a) * 0.04, z))
            pts = [base, base + Vector((math.cos(a) * 0.08, math.sin(a) * 0.08, -0.03)), base + Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, 0.04)), base + Vector((math.cos(a) * 0.16, math.sin(a) * 0.16, 0.13))]
            k.sweep(pts, [0.014, 0.021, 0.021, 0.009], fruit, seg=5)
    k.loft([{"c": (0.5 * px, 0.5 * py, z_top - 1.0), "rx": 0.02, "ry": 0.02}, {"c": (0.5 * px, 0.5 * py, z_top - 1.1), "rx": 0.058, "ry": 0.058}, {"c": (0.5 * px, 0.5 * py, z_top - 1.26), "rx": 0.05, "ry": 0.05}, {"c": (0.5 * px, 0.5 * py, z_top - 1.42), "rx": 0.008, "ry": 0.008}], bud, seg=7)
    k.preview((2.4, -6.6, 1.5), (0, 0, 1.9), 34, "far")
    k.preview((1.3, -3.0, 1.2), (0.1, 0, 2.4), 30, "under")
    k.preview((-3.8, -4.0, 4.6), (0, 0, 2.3), 34, "high")

    def leaves():
        cv = Canvas(1024, 1024, srgb("#4f8f38"))
        rects = [(0, 0, 340, 1024), (342, 0, 340, 1024), (684, 0, 340, 1024)]
        def tears(n):
            return [(rng.uniform(0.15, 0.92), rng.uniform(0.3, 0.85), rng.uniform(0.002, 0.006), rng.choice((-1, 1))) for _ in range(n)]
        _paint_banana_leaf(cv, rects[0], rng, srgb("#5da23c"), srgb("#2c5d24"), srgb("#c5cd7a"), tears(5), burn=0.1, seed=0.3)
        _paint_banana_leaf(cv, rects[1], rng, srgb("#4a8d34"), srgb("#2c5d24"), srgb("#b5c26e"), tears(9), burn=0.2, seed=2.1)
        _paint_banana_leaf(cv, rects[2], rng, srgb("#8c7c3a"), srgb("#5a4a24"), srgb("#a8985e"), tears(14), burn=0.7, seed=4.4)
        mat = leaf_material("tree_banana_leaf", cv)
        cells = [(0.0, 0.0, 340 / 1024, 1.0), (342 / 1024, 0.0, 682 / 1024, 1.0), (684 / 1024, 0.0, 1.0, 1.0)]
        verts, faces, uvs = [], [], []
        base = (0.06, 0.02, z_top)
        # a young rolled spear plus an arching crown; two old leaves hang against the stem
        specs = [(0.2, 1.45, 1.3, 0.34, 0.25, 0), (1.5, 1.15, 1.95, 0.78, 0.85, 0), (3.0, 1.05, 2.1, 0.82, 1.0, 0), (4.3, 1.0, 2.1, 0.82, 1.05, 1), (5.5, 0.92, 2.15, 0.84, 1.15, 0),
                 (0.9, 0.78, 2.0, 0.8, 1.3, 1), (2.3, 0.7, 2.05, 0.8, 1.45, 1), (3.7, 0.65, 2.0, 0.78, 1.6, 1), (4.95, 0.6, 1.95, 0.76, 1.75, 0), (1.57, 0.25, 1.6, 0.6, 2.2, 2)]
        for azim, rise, length, width, droop, cell in specs:
            _banana_leaf_mesh(verts, faces, uvs, base, azim, rise, length, width, droop, cells[cell], rng)
        for (x, y, h, az) in ((0.42, 0.2, 0.6, 0.5), (0.42, 0.2, 0.6, 3.0), (-0.34, 0.33, 0.42, 2.2), (-0.34, 0.33, 0.42, 5.0)):
            _banana_leaf_mesh(verts, faces, uvs, (x, y, h), az, 0.95, 0.65, 0.28, 0.9, cells[0], rng, nv=3, nu=2)
        obj = _card_mesh("leaves", verts, faces, uvs, None, mat)
        print(f"[props]   banana leaves: {len(specs)}, {len(faces)} quads")
    _tree_finish(k, leaves, size=512, normal=512)



# ---------------------------------------------------------------------------
# Shared bits for the remaining props
# ---------------------------------------------------------------------------
def plaid(name, colors, period=0.09, rough=0.85, fade=0.3):
    """Woven check in object space for lungi and gamcha."""
    mat = bo.pbr(name, colors[0], rough)
    g = G(mat)

    def bands(v):
        return g.ramp(g.fract(g.div(v, period)), [(i / len(colors), c) for i, c in enumerate(colors)] + [(1.0, colors[-1])])
    col = g.mix(bands(g.x), bands(g.z), 0.5)
    col = g.mix(col, rgb("#d6cfbd"), g.mul(g.smooth(g.noise(scale=1.3, detail=4.0), 0.35, 0.7), fade))
    g.color(col)
    g.rough(rough)
    g.surface(g.m("SINE", g.mul(g.z, 300.0)), strength=0.1, distance=0.002)
    return mat


def folk_paint(name, base, petal, centre, line_col, period=0.24, wear=0.3, rough=0.5):
    """Rickshaw-art style painted band: repeating rosettes between ruled lines, never lettering."""
    mat = bo.pbr(name, base, rough)
    g = G(mat)
    u = _face_tangent_u(g)
    fu = g.sub(g.fract(g.div(u, period)), 0.5)
    fz = g.sub(g.fract(g.div(g.z, period)), 0.5)
    r = g.length2(fu, fz)
    ang = g.m("ARCTAN2", fz, fu)
    petals = g.add(0.27, g.mul(g.m("COSINE", g.mul(ang, 6.0)), 0.13))
    flower = g.smooth(r, g.add(petals, 0.012), g.sub(petals, 0.012))
    heart = g.smooth(r, 0.115, 0.095)
    ring = g.mul(g.smooth(r, 0.46, 0.44), g.smooth(r, 0.4, 0.42))
    col = g.mix(base, line_col, ring)
    col = g.mix(col, petal, flower)
    col = g.mix(col, centre, heart)
    col = g.mix(col, lerp3(base, rgb("#d6cfbd"), 0.5), g.mul(g.smooth(g.noise(scale=2.0, detail=5.0), 0.38, 0.72), 0.45))
    chips = g.smooth(g.add(g.noise(scale=16.0, detail=6.0, rough=0.62), g.mul(g.edge_mask(0.01), 0.3)), 0.82 - wear * 0.3, 0.86 - wear * 0.3)
    col = g.mix(col, rgb("#7f6d55"), chips)
    g.color(col)
    g.rough(rough)
    g.surface(g.mul(chips, -0.4), strength=0.3, distance=0.004, bevel=0.005)
    return mat


def newsprint(name, tint=None, mast=None):
    """Off-white paper with grey column blocks and picture rectangles. Reads as print, has no glyphs."""
    tint = tint or rgb("#d6cfba")
    mat = bo.pbr(name, tint, 0.85)
    g = G(mat)
    u = _face_tangent_u(g)
    col_lines = g.smooth(g.fract(g.div(u, 0.055)), 0.1, 0.16)
    rows = g.smooth(g.fract(g.div(g.z, 0.009)), 0.2, 0.5)
    text_tone = g.mul(g.mul(col_lines, rows), 0.45)
    col = g.mix(tint, rgb("#3c3a36"), text_tone)
    dist, cell = g.voronoi(scale=7.0, metric="CHEBYCHEV", vec=g.vscale((1.0, 1.0, 0.8)))
    pick = g.rgbf(cell)
    col = g.mix(col, rgb("#54504a"), g.smooth(pick, 0.72, 0.74))
    col = g.mix(col, rgb("#9c8f7b"), g.mul(g.smooth(g.noise(scale=3.0, detail=4.0), 0.5, 0.7), 0.35))
    if mast is not None:
        band = g.gt(g.fract(g.div(g.z, 0.34)), 0.9)
        col = g.mix(col, mast, band)
    g.color(col)
    g.rough(0.88)
    return mat


def plaster(name, c1=None, c2=None, drip=0.7, drip_top=None, grime=0.8, grime_h=1.6, moss=0.4, rough=0.82, bevel=0.03, scale=1.0):
    """Lime-washed plaster: chalky white, rain stains under ledges, green-black damp low down."""
    c1 = c1 or rgb("#e9e6da")
    c2 = c2 or rgb("#d2cdbc")
    mat = bo.pbr(name, c1, rough)
    g = G(mat)
    _, _, nz = g.normal_xyz()
    col = g.mix(c1, c2, g.smooth(g.noise(scale=0.9 * scale, detail=6.0, rough=0.6), 0.32, 0.68))
    col = g.mix(col, mul3(c2, 0.85), g.mul(g.smooth(g.noise(scale=7.0 * scale, detail=5.0), 0.55, 0.72), 0.3))
    if drip > 0:
        d1 = g.smooth(g.noise(vec=g.vscale((5.0, 5.0, 0.32)), scale=1.0, detail=5.0, rough=0.6), 0.5, 0.67)
        d2 = g.smooth(g.noise(vec=g.vscale((1.3, 1.3, 0.16), (5.0, 2.0, 7.0)), scale=1.0, detail=4.0), 0.52, 0.7)
        mask = g.maxi(g.mul(d1, 0.75), g.mul(d2, 0.6))
        if drip_top is not None:
            mask = g.mul(mask, g.add(0.35, g.mul(g.smooth(g.z, drip_top - 2.5, drip_top), 0.9)))
        vertical = g.smooth(g.absv(nz), 0.8, 0.3)
        col = g.mix(col, rgb("#6e6858"), g.mulc(g.mul(mask, vertical), drip * 0.7))
    if grime > 0:
        low = g.smooth(g.z, grime_h, 0.1)
        n = g.smooth(g.noise(vec=g.vscale((2.0, 2.0, 0.9)), scale=1.0, detail=5.0), 0.3, 0.62)
        col = g.mix(col, rgb("#5a5444"), g.mulc(g.mul(low, g.add(0.25, g.mul(n, 0.75))), grime))
    if moss > 0:
        m = g.smooth(g.noise(scale=1.3, detail=6.0), 0.52, 0.68)
        low = g.smooth(g.z, grime_h * 1.8, 0.2)
        col = g.mix(col, rgb("#3e4630"), g.mulc(g.mul(m, low), moss))
    height = g.mul(g.noise(scale=38.0, detail=5.0, rough=0.6), 0.5)
    g.color(col)
    g.rough(rough)
    g.surface(height, strength=0.3, distance=0.015, bevel=bevel)
    return mat


def fruit_skin(name, a, b, c=None, speck=0.3, rough=0.48):
    mat = bo.pbr(name, a, rough)
    g = G(mat)
    col = g.mix(a, b, g.smooth(g.noise(scale=7.0, detail=4.0), 0.38, 0.62))
    if c is not None:
        col = g.mix(col, c, g.smooth(g.noise(scale=4.0, detail=3.0, vec=g.vscale((1, 1, 1), (3.1, 1.3, 7.7))), 0.56, 0.68))
    col = g.mix(col, rgb("#3c2c18"), g.mul(g.smooth(g.noise(scale=90.0, detail=2.0), 0.68, 0.72), speck))
    g.color(col)
    g.rough(rough)
    return mat


def flower_bed(name, colors, leaf, density=70.0, leaf_share=0.45):
    """Mass of small blooms on low foliage, one lumpy mound of texture."""
    mat = bo.pbr(name, colors[0], 0.7)
    g = G(mat)
    d, cell = g.voronoi(scale=density)
    pick = g.rgbf(cell)
    stops = [(i / len(colors), c) for i, c in enumerate(colors)] + [(1.0, colors[-1])]
    bloom = g.ramp(g.fract(g.mul(pick, 3.7)), stops)
    shadow = g.smooth(d, 0.55, 0.28)
    is_leaf = g.smooth(pick, leaf_share - 0.02, leaf_share + 0.02)
    col = g.mix(mul3(leaf, 0.6), g.mix(leaf, bloom, is_leaf), shadow)
    g.color(col)
    g.rough(0.75)
    g.surface(g.mul(shadow, 1.0), strength=0.9, distance=0.05)
    return mat


def _spoked_wheel(k, cx, cy, cz, radius, tyre_m, spoke_m, hub_m, spokes=8, ring_pts=16, tyre_r=0.022):
    """Bicycle-style cart wheel in the XZ plane: tube tyre ring, wire spokes, stubby hub."""
    pts = []
    for i in range(ring_pts + 1):
        a = 2 * math.pi * i / ring_pts
        pts.append((cx + math.cos(a) * radius, cy, cz + math.sin(a) * radius))
    k.tube(pts, tyre_r, tyre_m, seg=4)
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        k.rod((cx, cy, cz), (cx + math.cos(a) * radius, cy, cz + math.sin(a) * radius), 0.006, spoke_m, seg=3)
    k.cyl(0.04, 0.12, (cx, cy, cz), hub_m, seg=6, rot=(math.pi / 2, 0, 0))


def _heap_positions(rng, n, cx, cy, rx, ry, z0, h):
    out = []
    for i in range(n):
        a = rng.uniform(0, 6.283)
        d = math.sqrt(rng.random())
        dx, dy = math.cos(a) * d, math.sin(a) * d
        z = z0 + h * (1.0 - d * d) * rng.uniform(0.75, 1.05)
        out.append((cx + dx * rx, cy + dy * ry, z))
    return out


# ---------------------------------------------------------------------------
# Stalls and street furniture
# ---------------------------------------------------------------------------
@asset("food_cart")
def build_food_cart():
    k = Kit("food_cart", "props")
    rng = random.Random(3)
    wood_m = wood("fc_wood", rgb("#7a5b3a"), axis="x", wear=0.45)
    leg_m = wood("fc_leg", rgb("#664b31"), axis="z", wear=0.25)
    red = painted("fc_red", rgb("#ba2f26"), under=rgb("#8f7654"), wear=0.3, fade=0.5, dirt=0.4, rust=0.05, drip=0.6, rough=0.42, scale=2.0, bevel=0.005)
    teal = painted("fc_teal", rgb("#1f8078"), under=rgb("#8f7654"), wear=0.3, fade=0.5, dirt=0.4, rust=0.05, drip=0.6, rough=0.42, scale=2.0, bevel=0.005)
    yellow = painted("fc_yellow", rgb("#e2ad2c"), under=rgb("#8f7654"), wear=0.3, fade=0.5, dirt=0.3, drip=0.4, rough=0.42, scale=2.0, bevel=0.004)
    panel = folk_paint("fc_folk", rgb("#1f6f7a"), rgb("#e9b12f"), rgb("#c83524"), rgb("#ede5cf"), period=0.2)
    panel2 = folk_paint("fc_folk2", rgb("#bb2f28"), rgb("#f1d9a0"), rgb("#1c7b6f"), rgb("#e3b22f"), period=0.15)
    tin = galv("fc_tin", rust=0.15, scale=2.0)
    alu = aluminium("fc_alu", soot_top=1.0, soot_low=0.96)
    tyre = flat("fc_tyre", rgb("#1b1a18"), rough=0.8)
    spoke = steel("fc_spoke", rgb("#6d6c68"), rust=0.3, metallic=0.7, drip=0.0)
    fuchka = fruit_skin("fc_fuchka", rgb("#d9a955"), rgb("#bd8638"), speck=0.2, rough=0.7)
    chana = fruit_skin("fc_chana", rgb("#c79544"), rgb("#8f5f24"), speck=0.2, rough=0.65)
    tomato = fruit_skin("fc_tomato", rgb("#c63020"), rgb("#a22418"), rough=0.3, speck=0.0)
    cuke = fruit_skin("fc_cuke", rgb("#4f7f2d"), rgb("#3a6522"), rough=0.4, speck=0.0)
    oil = plastic("fc_oil", rgb("#a8821c"), rough=0.15, scuff=0.1, dirt=0.0)
    cloth = fabric("fc_cloth", rgb("#d1c7ad"), fade=0.3, dirt=0.5, sag_dirt=0.3)

    # chassis, wheels on +/-Y, resting legs, handles on +X
    k.box((1.72, 0.76, 0.05), (0, 0, 0.42), wood_m)
    _spoked_wheel(k, 0.0, -0.46, 0.44, 0.44, tyre, spoke, spoke)
    _spoked_wheel(k, 0.0, 0.46, 0.44, 0.44, tyre, spoke, spoke)
    k.rod((0, -0.5, 0.44), (0, 0.5, 0.44), 0.016, spoke, seg=4)
    for x in (-0.76, 0.76):
        for y in (-0.32, 0.32):
            k.box((0.05, 0.05, 0.42), (x, y, 0.21), leg_m)
    for y in (-0.3, 0.3):
        k.rod((0.86, y, 0.43), (1.42, y, 0.56), 0.02, wood_m, seg=5)
        k.cyl(0.024, 0.14, (1.48, y, 0.57), tyre, seg=6, rot=(0, math.radians(78), 0))
    k.rod((1.3, -0.3, 0.53), (1.3, 0.3, 0.53), 0.016, wood_m, seg=4)
    # painted lower cabinet with a folk-art front
    k.box((1.66, 0.72, 0.38), (0, 0, 0.635), teal)
    k.box((1.5, 0.012, 0.24), (0, -0.366, 0.64), panel)
    k.box((1.6, 0.012, 0.03), (0, -0.366, 0.79), yellow)
    k.box((1.6, 0.012, 0.03), (0, -0.366, 0.48), yellow)
    # worktop with tin edge
    k.box((1.76, 0.82, 0.04), (0, 0, 0.845), tin)
    Z = 0.865
    # glass case frame, shelf and painted pediment
    cx0, cy0, w_, d_, h_ = 0.0, 0.08, 1.36, 0.48, 0.56
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((0.035, 0.035, h_), (cx0 + sx * w_ / 2, cy0 + sy * d_ / 2, Z + h_ / 2), red)
    for z in (Z + 0.012, Z + h_):
        k.box((w_ + 0.03, d_ + 0.03, 0.025), (cx0, cy0, z), red)
    k.box((w_ - 0.04, d_ - 0.04, 0.012), (cx0, cy0, Z + 0.28), tin)
    # arched pediment with its own painted face
    ped = [(-0.72, 0.0), (0.72, 0.0), (0.72, 0.1), (0.5, 0.16), (0.26, 0.24), (0.0, 0.28), (-0.26, 0.24), (-0.5, 0.16), (-0.72, 0.1)]
    ped = [(x, z + Z + h_ + 0.012) for x, z in ped]
    k.section_loft([(cy0 - d_ / 2 - 0.02, ped), (cy0 - d_ / 2 + 0.012, ped)], panel2)
    # fuchka heaped on the lower shelf, chickpea bowl and tins above
    for (x, y, z) in _heap_positions(rng, 16, -0.3, cy0, 0.3, 0.16, Z + 0.06, 0.13):
        k.sphere(0.042, (x, y, z), fuchka, seg=5, rings=3)
    k.loft([{"c": (0.32, cy0, Z + 0.03), "rx": 0.14, "ry": 0.14}, {"c": (0.32, cy0, Z + 0.13), "rx": 0.22, "ry": 0.17}], alu, seg=8, end=False)
    k.sphere(0.2, (0.32, cy0, Z + 0.12), chana, seg=8, rings=4, scale=(1, 0.8, 0.2))
    for x, r, h in ((-0.42, 0.075, 0.16), (-0.2, 0.06, 0.14), (0.05, 0.07, 0.12)):
        k.cyl(r, h, (x, cy0, Z + 0.3 + h / 2), tin, seg=8)
    # the big tin pots on the counter, with ladle, oil bottle, salad tray
    k.loft([{"c": (-0.56, -0.27, Z), "rx": 0.12, "ry": 0.12}, {"c": (-0.56, -0.27, Z + 0.14), "rx": 0.135, "ry": 0.135}, {"c": (-0.56, -0.27, Z + 0.2), "rx": 0.11, "ry": 0.11}], alu, seg=10, end=False)
    k.cyl(0.108, 0.01, (-0.56, -0.27, Z + 0.185), chana, seg=8)
    k.tube([(-0.56, -0.27, Z + 0.16), (-0.5, -0.27, Z + 0.3), (-0.44, -0.27, Z + 0.34)], 0.006, spoke, seg=3)
    k.cyl(0.075, 0.26, (0.0, -0.28, Z + 0.13), tin, seg=8)
    k.cyl(0.08, 0.02, (0.0, -0.28, Z + 0.27), red, seg=8)
    k.cyl(0.03, 0.14, (0.28, -0.3, Z + 0.07), oil, seg=6)
    k.cyl(0.012, 0.05, (0.28, -0.3, Z + 0.165), oil, seg=5)
    k.box((0.3, 0.14, 0.02), (0.54, -0.27, Z + 0.01), tin)
    for i, (x, y) in enumerate(((0.46, -0.3), (0.53, -0.25), (0.6, -0.3), (0.5, -0.25))):
        k.sphere(0.03, (x, y, Z + 0.05), tomato if i % 2 else cuke, seg=5, rings=3)
    k.box((0.22, 0.14, 0.015), (0.22, -0.2, Z + 0.008), cloth)
    k.empty("vendor", (0.1, 0.72, 0.0))
    k.preview((1.2, -3.8, 1.45), (0, 0, 0.95), 34, "front")
    k.preview((-2.6, -2.6, 1.8), (0, 0, 0.9), 34, "left")
    k.preview((2.4, 2.8, 1.5), (0.2, 0, 0.8), 34, "back")
    k.finish(size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.4, ao_strength=0.75, angle=75.0)
    # alpha-blended panes as their own mesh and material, like the vehicles' glass
    gm = bpy.data.materials.new("glass")
    gb = gm.node_tree.nodes.get("Principled BSDF")
    gb.inputs["Base Color"].default_value = (0.82, 0.9, 0.9, 1)
    gb.inputs["Roughness"].default_value = 0.05
    gb.inputs["Alpha"].default_value = 0.16
    gm.use_backface_culling = False
    z0, z1 = Z + 0.024, Z + h_ - 0.012
    x0, x1, y0, y1 = cx0 - w_ / 2, cx0 + w_ / 2, cy0 - d_ / 2, cy0 + d_ / 2
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 3, 7, 4), (1, 5, 6, 2)]
    gl = bo.new_mesh_object("glass", verts, faces, smooth=False)
    bo.assign(gl, gm)
    k.export(quality=84)
    k.run_previews()


@asset("fruit_cart")
def build_fruit_cart():
    k = Kit("fruit_cart", "props")
    rng = random.Random(4)
    bed = wood("fr_bed", rgb("#83623f"), axis="y", wear=0.5, plank=0.0)
    rail = wood("fr_rail", rgb("#6d5136"), axis="x", wear=0.4)
    handle_w = wood("fr_handle", rgb("#6a4e33"), axis="y", wear=0.35)
    tyre = flat("fr_tyre", rgb("#1b1a18"), rough=0.8)
    spoke = steel("fr_spoke", rgb("#6d6c68"), rust=0.4, metallic=0.7, drip=0.0)
    burlap = fabric("fr_burlap", rgb("#a68a5b"), fade=0.25, dirt=0.5, sag_dirt=0.5, weave=380.0)
    mound_m = fabric("fr_mound", rgb("#6d5a3c"), fade=0.1, dirt=0.3, sag_dirt=0.4)
    mango = fruit_skin("fr_mango", rgb("#e2a52a"), rgb("#c98a1e"), rgb("#7f9a32"), speck=0.25)
    mango2 = fruit_skin("fr_mango2", rgb("#b3b13a"), rgb("#7f9a32"), rgb("#d9601e"), speck=0.25)
    guava = fruit_skin("fr_guava", rgb("#b5c56a"), rgb("#9cb257"), rgb("#d9dc8f"), speck=0.3, rough=0.55)
    coco = fruit_skin("fr_coco", rgb("#4e7f2c"), rgb("#3d6923"), rgb("#8a9a3c"), speck=0.15, rough=0.38)
    coco_cap = flat("fr_cap", rgb("#6d5a30"), rough=0.7)
    ripe = bo.pbr("fr_banana", rgb("#d9b82b"), 0.5)
    g = G(ripe)
    g.color(g.mix(g.mix(rgb("#dcbc2e"), rgb("#9fa832"), g.smooth(g.noise(scale=7.0, detail=3.0), 0.42, 0.62)), rgb("#3a2a14"), g.smooth(g.noise(scale=65.0, detail=3.0), 0.66, 0.72)))
    stem = flat("fr_stem", rgb("#58662c"), rough=0.7)

    # bed and side rails; wheels on +/-X, handles to +Y where the vendor stands
    bz = 0.72
    k.box((1.14, 2.0, 0.05), (0, 0, bz), bed)
    for sx in (-1, 1):
        k.box((0.05, 2.04, 0.11), (sx * 0.58, 0, bz + 0.05), rail)
    k.box((1.2, 0.05, 0.11), (0, -1.0, bz + 0.05), rail)
    k.box((1.2, 0.05, 0.11), (0, 1.0, bz + 0.05), rail)
    # handles and prop stand
    for sx in (-1, 1):
        k.box((0.05, 1.0, 0.05), (sx * 0.33, 1.42, bz - 0.04), handle_w)
        k.box((0.05, 0.05, 0.68), (sx * 0.5, -0.92, 0.34), handle_w)
    k.rod((-0.33, 1.72, bz - 0.04), (0.33, 1.72, bz - 0.04), 0.018, handle_w, seg=4)
    # big wheels on an axle
    for sx in (-1, 1):
        wx = sx * 0.68
        pts = []
        for i in range(17):
            a = 2 * math.pi * i / 16
            pts.append((wx, 0.1 + math.cos(a) * 0.46, 0.46 + math.sin(a) * 0.46))
        k.tube(pts, 0.024, tyre, seg=4)
        for i in range(8):
            a = 2 * math.pi * i / 8
            k.rod((wx, 0.1, 0.46), (wx, 0.1 + math.cos(a) * 0.46, 0.46 + math.sin(a) * 0.46), 0.006, spoke, seg=3)
        k.cyl(0.04, 0.12, (wx, 0.1, 0.46), spoke, seg=6, rot=(0, math.pi / 2, 0))
    k.rod((-0.72, 0.1, 0.46), (0.72, 0.1, 0.46), 0.016, spoke, seg=4)
    k.box((0.06, 0.28, 0.24), (-0.48, 0.1, 0.6), rail)
    k.box((0.06, 0.28, 0.24), (0.48, 0.1, 0.6), rail)

    # burlap over a low mound so no bare gaps show between fruit
    def mound(u, v):
        x = u * 0.56
        y = v * 0.98
        d = max(abs(u), abs(v))
        return (x, y, bz + 0.03 + 0.2 * (1 - d ** 2.4) + 0.012 * math.sin(u * 11 + v * 7))
    k.grid(mound, 6, 10, burlap, w=0.9, chunks=1)

    # green coconuts piled at the handle end
    z_ = bz + 0.15
    for (x, y, z) in [(-0.33, 0.72, z_ + 0.03), (0.0, 0.76, z_ + 0.03), (0.33, 0.72, z_ + 0.03), (-0.2, 0.46, z_ + 0.1), (0.17, 0.48, z_ + 0.1), (-0.14, 0.7, z_ + 0.28), (0.18, 0.66, z_ + 0.28), (0.0, 0.42, z_ + 0.3)]:
        k.sphere(0.145, (x, y, z), coco, seg=7, rings=4, scale=(1, 1, 1.12))
        k.sphere(0.04, (x, y, z + 0.155), coco_cap, seg=5, rings=2, scale=(1, 1, 0.35))
    # mangoes in a big heap, then guavas beside them
    for (x, y, z) in _heap_positions(rng, 32, -0.17, -0.02, 0.36, 0.36, z_ + 0.02, 0.24):
        k.sphere(0.078, (x, y, z), mango if rng.random() < 0.7 else mango2, seg=6, rings=3, scale=(0.82, 0.82, 1.14))
    for (x, y, z) in _heap_positions(rng, 20, 0.33, -0.08, 0.2, 0.36, z_ + 0.0, 0.2):
        k.sphere(0.056, (x, y, z), guava, seg=6, rings=3)
    for (x, y, z) in _heap_positions(rng, 16, -0.14, -0.72, 0.38, 0.2, z_ - 0.02, 0.16):
        k.sphere(0.066, (x, y, z), mango, seg=6, rings=3, scale=(0.82, 0.82, 1.1))
    # banana hands lying at the front corner
    for hand in range(3):
        hx, hy, hz = 0.3 - hand * 0.08, -0.72 + hand * 0.1, z_ + 0.05 + hand * 0.04
        for i in range(5):
            off = (i - 2) * 0.042
            pts = [(hx + off, hy + 0.07, hz + 0.02), (hx + off * 1.1, hy - 0.02, hz + 0.05), (hx + off * 1.25, hy - 0.11, hz + 0.03), (hx + off * 1.4, hy - 0.17, hz - 0.01)]
            k.sweep(pts, [0.009, 0.018, 0.018, 0.008], ripe, seg=5, end_cap=False)
        k.box((0.2, 0.03, 0.03), (hx, hy + 0.08, hz + 0.02), stem)
    k.empty("vendor", (0.0, 2.05, 0.0))
    k.preview((1.6, -3.8, 1.8), (0, 0, 0.85), 34, "front")
    k.preview((-3.0, 0.9, 1.9), (0, 0.1, 0.8), 36, "side")
    k.preview((1.0, 4.2, 1.6), (0, 0.3, 0.8), 36, "back")
    k.finish(size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.25, ao_strength=0.8, angle=75.0, packed=True)
    k.export(quality=84)
    k.run_previews()


@asset("umbrella_stall")
def build_umbrella_stall():
    k = Kit("umbrella_stall", "props")
    rng = random.Random(6)
    red = fabric("us_red", rgb("#b8322a"), fade=0.65, dirt=0.4, sag_dirt=0.35)
    blue = fabric("us_blue", rgb("#2a5f97"), fade=0.65, dirt=0.4, sag_dirt=0.35)
    pole_m = galv("us_pole", rust=0.3)
    rib = steel("us_rib", rgb("#6d6c68"), rust=0.3, metallic=0.6, drip=0.0)
    table_w = wood("us_table", rgb("#8a6a45"), axis="x", wear=0.55)
    leg_w = wood("us_leg", rgb("#6a4e33"), axis="z", wear=0.3)
    cloth = fabric("us_cloth", rgb("#b9aa8f"), fade=0.4, dirt=0.5, sag_dirt=0.4)
    stool_m = plastic("us_stool", rgb("#2e6db0"), rough=0.45, scuff=0.5)
    base_m = concrete("us_base", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.3, dust=0.7, bevel=0.01)
    goods = [plastic(f"us_g{i}", rgb(c), rough=0.4, scuff=0.3, dirt=0.0) for i, c in enumerate(("#d62b2b", "#e7b018", "#1f7ec2", "#22a15a", "#e36a1e", "#d7d3c4", "#8a3fa1"))]

    # concrete-filled tin base and the pole
    k.loft([{"c": (0, 0, 0.0), "rx": 0.18, "ry": 0.18}, {"c": (0, 0, 0.22), "rx": 0.16, "ry": 0.16}], base_m, seg=10)
    k.loft([{"c": (0, 0, 0.2), "rx": 0.024, "ry": 0.024}, {"c": (0, 0, 2.62), "rx": 0.018, "ry": 0.018}], pole_m, seg=6)
    # big beach-style canopy: eight alternating panels with a scalloped edge
    n = 8
    R, zc, ze = 1.5, 2.56, 2.08
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = 2 * math.pi * (i + 1) / n
        m = red if i % 2 else blue

        def pt(u, v, a0=a0, a1=a1):
            # v radial from crown to rim, u across the panel
            t = (v + 1) * 0.5
            a = a0 + (a1 - a0) * (u + 1) * 0.5
            sag = (1 - u * u) * 0.04 * math.sin(t * math.pi)
            r = R * t * (1.0 - 0.1 * (1 - abs(u)) * (t ** 6))
            z = zc + (ze - zc) * t ** 1.5 - sag
            return (math.cos(a) * r, math.sin(a) * r, z)
        k.grid(pt, 2, 3, m, w=0.9, chunks=1)
        # hem drop
        ar = 2 * math.pi * i / n
        k.rod((0, 0, 2.3), (math.cos(ar) * R * 0.98, math.sin(ar) * R * 0.98, ze - 0.005), 0.007, rib, seg=3)
        k.rod((0, 0, 1.95), (math.cos(ar) * 0.72, math.sin(ar) * 0.72, 2.26), 0.005, rib, seg=3)
    k.cyl(0.025, 0.1, (0, 0, 2.62), rib, seg=5)
    k.cyl(0.03, 0.05, (0, 0, 1.95), rib, seg=5)
    # table in front of the pole with a cloth and piles of small goods
    tx, ty = 0.05, -0.5
    k.box((1.1, 0.62, 0.03), (tx, ty, 0.72), table_w)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((0.04, 0.04, 0.7), (tx + sx * 0.5, ty + sy * 0.26, 0.35), leg_w)
    k.box((1.14, 0.66, 0.012), (tx, ty, 0.74), cloth)
    k.box((1.14, 0.012, 0.14), (tx, ty - 0.33, 0.67), cloth)
    Z = 0.746
    for i in range(16):
        x = tx + rng.uniform(-0.48, 0.48)
        y = ty + rng.uniform(-0.25, 0.25)
        sx, sy, sz = rng.uniform(0.05, 0.13), rng.uniform(0.05, 0.1), rng.uniform(0.02, 0.09)
        k.box((sx, sy, sz), (x, y, Z + sz / 2), goods[i % len(goods)], rot=(0, 0, rng.uniform(-0.5, 0.5)))
    for i in range(4):
        k.cyl(0.035, 0.12, (tx + 0.34 - i * 0.075, ty + 0.2, Z + 0.06), goods[i], seg=6)
    # hanging strips on the pole
    k.box((0.14, 0.008, 0.44), (0, -0.035, 1.5), goods[3])
    k.box((0.14, 0.008, 0.36), (0, 0.035, 1.46), goods[0])
    # plastic stool
    k.loft([{"c": (0.25, 0.48, 0.0), "rx": 0.13, "ry": 0.13, "power": 3}, {"c": (0.25, 0.48, 0.3), "rx": 0.13, "ry": 0.13, "power": 3}, {"c": (0.25, 0.48, 0.33), "rx": 0.155, "ry": 0.155, "power": 3}], stool_m, seg=8)
    k.empty("vendor", (0.25, 0.48, 0.0))
    k.preview((1.6, -4.8, 1.6), (0, -0.1, 1.2), 34, "front")
    k.preview((-3.5, -3.0, 3.2), (0, 0, 1.2), 36, "above")
    k.preview((1.0, -2.3, 0.6), (0, -0.2, 1.3), 30, "under")
    k.finish(size=1024, normal=1024, rm=256, ao=512, samples=10, ao_dist=0.3, ao_strength=0.75, angle=75.0, cull=False, packed=True)
    k.export(quality=84)
    k.run_previews()


@asset("newspaper_stand")
def build_newspaper_stand():
    k = Kit("newspaper_stand", "props")
    frame = wood("ns_frame", rgb("#7a5b3a"), axis="z", wear=0.35)
    board = wood("ns_board", rgb("#8a6a45"), axis="x", wear=0.5)
    paint = painted("ns_paint", rgb("#2f6f92"), under=rgb("#7f6a50"), wear=0.4, fade=0.65, dirt=0.4, grain="x", drip=0.6, scale=2.0, bevel=0.005)
    tin = ribbed_sheet("ns_tin", rgb("#a9a79a"), period=0.12, axis="x", rust=0.45, drip=0.6)
    paper = newsprint("ns_paper")
    paper_r = newsprint("ns_paper_r", rgb("#d9d2bc"), mast=rgb("#b5302a"))
    paper_b = newsprint("ns_paper_b", rgb("#cfc8b2"), mast=rgb("#264f92"))
    mag = [plastic(f"ns_m{i}", rgb(c), rough=0.3, scuff=0.2, dirt=0.0) for i, c in enumerate(("#c23a33", "#2f79a6", "#e0ad27", "#3d9a6a"))]
    rope = flat("ns_rope", rgb("#cfc8b5"), rough=0.9)
    stool_m = plastic("ns_stool", rgb("#b52f2a"), rough=0.45, scuff=0.5)

    # sloped trestle rack: lower counter for stacks, upper tilted board for display
    W = 1.3
    for sx in (-1, 1):
        k.box((0.05, 0.05, 1.05), (sx * W / 2, -0.28, 0.525), frame)
        k.box((0.05, 0.05, 2.1), (sx * W / 2, 0.3, 1.05), frame)
        k.box((0.04, 0.62, 0.04), (sx * W / 2, 0.0, 0.8), frame)
        k.box((0.04, 0.62, 0.04), (sx * W / 2, 0.0, 0.25), frame)
    k.box((W + 0.08, 0.64, 0.03), (0, 0.0, 0.82), board)
    k.box((W + 0.08, 0.018, 0.5), (0, -0.33, 0.52), paint)
    # tilted display board
    o = k.box((W, 0.02, 0.8), (0, 0.2, 1.44), board, rot=(math.radians(14), 0, 0))
    # stacks: thick folded papers on the counter
    Z = 0.835
    k.box((0.42, 0.3, 0.11), (-0.38, -0.08, Z + 0.055), paper_r)
    k.box((0.42, 0.3, 0.08), (0.08, -0.08, Z + 0.04), paper_b)
    k.box((0.34, 0.24, 0.05), (0.46, -0.1, Z + 0.025), paper)
    k.box((0.4, 0.3, 0.05), (-0.37, 0.18, Z + 0.025), paper)
    # papers and magazines clipped on the display board and on a string
    for i in range(4):
        x = -0.45 + i * 0.3
        k.box((0.27, 0.006, 0.36), (x, 0.1, 1.6), paper_r if i % 2 else paper_b, rot=(math.radians(14), 0, 0))
    for i in range(4):
        x = -0.45 + i * 0.3
        k.box((0.22, 0.006, 0.3), (x, 0.0, 1.22), mag[i], rot=(math.radians(14), 0, 0))
    k.rod((-W / 2, 0.28, 1.98), (W / 2, 0.28, 1.98), 0.004, rope, seg=3)
    # tin roof
    k.box((W + 0.5, 0.95, 0.018), (0, 0.02, 2.14), tin, rot=(math.radians(-7), 0, 0))
    k.box((0.04, 0.04, 0.32), (-W / 2, -0.32, 2.0 - 0.1), frame)
    k.box((0.04, 0.04, 0.32), (W / 2, -0.32, 2.0 - 0.1), frame)
    k.box((W + 0.08, 0.04, 0.04), (0, -0.32, 2.06), frame)
    k.box((W + 0.08, 0.04, 0.04), (0, 0.3, 2.14), frame)
    # stool for the vendor
    k.loft([{"c": (0.55, 0.72, 0.0), "rx": 0.13, "ry": 0.13, "power": 3}, {"c": (0.55, 0.72, 0.33), "rx": 0.15, "ry": 0.15, "power": 3}], stool_m, seg=8)
    k.empty("vendor", (0.0, 0.78, 0.0))
    k.preview((1.0, -3.6, 1.5), (0, 0, 1.1), 34, "front")
    k.preview((-2.6, -2.2, 2.1), (0, 0, 1.1), 34, "left")
    k.finish(size=768, normal=768, rm=256, ao=256, samples=10, ao_dist=0.3, ao_strength=0.75, angle=60.0, cull=False)
    k.export(quality=84)
    k.run_previews()


@asset("crates")
def build_crates():
    k = Kit("crates", "props")
    rng = random.Random(12)
    red = plastic("cr_red", rgb("#b22e27"), rough=0.5, scuff=0.55)
    blue = plastic("cr_blue", rgb("#245f9e"), rough=0.5, scuff=0.55)
    slot = bo.pbr("cr_slot", rgb("#b22e27"), 0.5)
    g = G(slot)
    u = _face_tangent_u(g)
    holes = g.mul(g.smooth(g.fract(g.div(u, 0.05)), 0.12, 0.18), g.smooth(g.fract(g.div(g.z, 0.055)), 0.25, 0.3))
    g.color(g.mix(rgb("#a82a23"), rgb("#1b0e0b"), holes))
    g.rough(0.5)
    g.surface(g.mul(holes, -1.0), strength=0.8, distance=0.01)
    slot_b = bo.pbr("cr_slot_b", rgb("#245f9e"), 0.5)
    g = G(slot_b)
    u = _face_tangent_u(g)
    holes = g.mul(g.smooth(g.fract(g.div(u, 0.05)), 0.12, 0.18), g.smooth(g.fract(g.div(g.z, 0.055)), 0.25, 0.3))
    g.color(g.mix(rgb("#225a96"), rgb("#0b1320"), holes))
    g.rough(0.5)
    g.surface(g.mul(holes, -1.0), strength=0.8, distance=0.01)
    timber = wood("cr_timber", rgb("#a98a5f"), axis="x", wear=0.55)
    timber_d = wood("cr_timber_d", rgb("#7b5e3e"), axis="z", wear=0.35)
    sack = fabric("cr_sack", rgb("#a58b5c"), fade=0.25, dirt=0.45, sag_dirt=0.45, weave=420.0)
    sack2 = fabric("cr_sack2", rgb("#8d7650"), fade=0.25, dirt=0.5, sag_dirt=0.45, weave=420.0)
    rope = flat("cr_rope", rgb("#5a4c35"), rough=0.9)

    def crate(cx, cy, cz, sl, rim, rot=0.0, w=0.54, d=0.38, h=0.3):
        parts = []
        parts.append(k.box((w, d, 0.02), (0, 0, 0.01), rim))
        parts.append(k.box((w, 0.012, h), (0, -d / 2, h / 2), sl))
        parts.append(k.box((w, 0.012, h), (0, d / 2, h / 2), sl))
        parts.append(k.box((0.012, d, h), (-w / 2, 0, h / 2), sl))
        parts.append(k.box((0.012, d, h), (w / 2, 0, h / 2), sl))
        parts.append(k.box((w + 0.03, 0.02, 0.04), (0, -d / 2, h), rim))
        parts.append(k.box((w + 0.03, 0.02, 0.04), (0, d / 2, h), rim))
        parts.append(k.box((0.02, d + 0.03, 0.04), (-w / 2, 0, h), rim))
        parts.append(k.box((0.02, d + 0.03, 0.04), (w / 2, 0, h), rim))
        m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rot, 4, "Z")
        for o in parts:
            o.matrix_basis = m @ o.matrix_basis

    def wood_crate(cx, cy, cz, rot=0.0, w=0.62, d=0.42, h=0.36):
        items = []
        for z in (0.05, 0.18, 0.31):
            items.append(k.box((w, 0.012, 0.09), (0, -d / 2, z), timber))
            items.append(k.box((w, 0.012, 0.09), (0, d / 2, z), timber))
            items.append(k.box((0.012, d, 0.09), (-w / 2, 0, z), timber))
            items.append(k.box((0.012, d, 0.09), (w / 2, 0, z), timber))
        items.append(k.box((w, d, 0.012), (0, 0, 0.006), timber_d))
        for sx in (-1, 1):
            for sy in (-1, 1):
                items.append(k.box((0.03, 0.03, h), (sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), h / 2), timber_d))
        m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rot, 4, "Z")
        for o in items:
            o.matrix_basis = m @ o.matrix_basis

    crate(-0.32, -0.1, 0.0, slot, red, 0.05)
    crate(0.28, -0.15, 0.0, slot_b, blue, -0.08)
    crate(-0.3, -0.12, 0.32, slot_b, blue, -0.12)
    crate(0.26, -0.12, 0.32, slot, red, 0.2)
    wood_crate(-0.05, 0.42, 0.0, 0.1)
    # jute sacks lean against the stack
    def sack_mesh(cx, cy, cz, sx, sy, sz, tilt, m):
        rings = []
        for i, (t, f) in enumerate(((0.0, 0.8), (0.12, 1.0), (0.45, 1.05), (0.8, 0.95), (1.0, 0.45))):
            rings.append({"c": (0, 0, sz * t), "rx": sx * f, "ry": sy * f, "power": 2.6})
        o = k.loft(rings, m, seg=8)
        o.rotation_euler = (tilt, 0.0, rng.uniform(-0.4, 0.4))
        o.location = (cx, cy, cz)
    sack_mesh(0.92, -0.05, 0.0, 0.27, 0.2, 0.68, 0.14, sack)
    sack_mesh(0.86, 0.42, 0.0, 0.25, 0.2, 0.62, -0.1, sack2)
    sack_mesh(-0.98, 0.08, 0.0, 0.26, 0.2, 0.6, 0.12, sack)
    k.rod((0.92, -0.05, 0.56), (0.92, -0.05, 0.72), 0.03, rope, seg=4)
    k.preview((1.2, -3.2, 1.2), (0, 0, 0.42), 34, "front")
    k.preview((-2.4, -2.0, 1.6), (0, 0, 0.42), 34, "left")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.25, ao_strength=0.75, angle=60.0)
    k.export(quality=84)
    k.run_previews()


@asset("plastic_chair")
def build_plastic_chair():
    k = Kit("plastic_chair", "props")
    m = plastic("pc_red", rgb("#b52e29"), rough=0.42, scuff=0.55, dirt=0.4)
    # back panel with slots painted in, baked from a dark mask
    backm = bo.pbr("pc_back", rgb("#b52e29"), 0.42)
    g = G(backm)
    fx = g.fract(g.div(g.add(g.x, 0.5), 0.075))
    slots = g.mul(g.mul(g.smooth(fx, 0.36, 0.42), g.smooth(fx, 0.66, 0.6)), g.mul(g.smooth(g.z, 0.6, 0.62), g.smooth(g.z, 0.8, 0.78)))
    slots = g.mul(slots, g.smooth(g.absv(g.x), 0.17, 0.15))
    col = g.mix(rgb("#b52e29"), lerp3(rgb("#b52e29"), rgb("#d0c8b8"), 0.5), g.mul(g.smooth(g.noise(scale=5.0, detail=4.0), 0.4, 0.72), 0.5))
    g.color(g.mix(col, rgb("#2a0d0a"), g.mul(slots, 0.92)))
    g.rough(0.42)
    g.surface(g.mul(slots, -1.0), strength=0.7, distance=0.01, bevel=0.01)
    # dished seat
    k.loft([{"c": (0, 0, 0.415), "rx": 0.225, "ry": 0.205, "power": 3.2}, {"c": (0, 0, 0.44), "rx": 0.235, "ry": 0.215, "power": 3.2}, {"c": (0, 0, 0.45), "rx": 0.222, "ry": 0.205, "power": 3.2}], m, seg=12)
    # legs: flat, splayed, tapered
    for sx in (-1, 1):
        k.sweep([(sx * 0.2, -0.17, 0.43), (sx * 0.24, -0.21, 0.2), (sx * 0.265, -0.245, 0.0)], [0.038, 0.032, 0.024], m, seg=6)
        k.sweep([(sx * 0.2, 0.17, 0.43), (sx * 0.235, 0.22, 0.2), (sx * 0.26, 0.265, 0.0)], [0.038, 0.032, 0.024], m, seg=6)
        # arm rest sweeping from the front leg into the back
        k.sweep([(sx * 0.21, -0.17, 0.44), (sx * 0.27, -0.13, 0.6), (sx * 0.27, 0.03, 0.645), (sx * 0.22, 0.19, 0.66)], [0.024, 0.022, 0.024, 0.024], m, seg=5)
    # curved back
    def back_pt(u, v):
        t = (v + 1) * 0.5
        x = u * 0.23 * (1.0 - 0.14 * t ** 5)
        z = 0.45 + t * 0.44 - 0.035 * abs(u) ** 2.4 * t
        y = 0.2 + 0.05 * (v + 1) * 0.5 - 0.035 * (1 - u * u)
        return (x, y, z)
    k.grid(back_pt, 6, 4, backm, chunks=1)
    k.grid(lambda u, v: (back_pt(u, v)[0], back_pt(u, v)[1] + 0.012, back_pt(u, v)[2]), 6, 4, backm, chunks=1, flip=True)
    k.rod((-0.21, 0.26, 0.875), (0.21, 0.26, 0.875), 0.016, m, seg=5)
    k.preview((0.9, -1.9, 0.9), (0, 0, 0.45), 34, "front")
    k.preview((-1.5, 1.4, 0.9), (0, 0, 0.45), 34, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.15, ao_strength=0.7, angle=75.0, cull=False)
    k.export(quality=84)
    k.run_previews()


@asset("bench")
def build_bench():
    k = Kit("bench", "props")
    conc = concrete("bn_conc", c1=rgb("#aaa18e"), c2=rgb("#847b6a"), seam_h=0, drip=0.5, grime=1.0, grime_h=0.5, dust=0.5, bevel=0.012)
    slat = wood("bn_slat", rgb("#7f6242"), axis="x", wear=0.6, bevel=0.004)
    bolt = steel("bn_bolt", rgb("#5a5550"), rust=0.7, metallic=0.4, drip=0.0)
    # two chunky cast-concrete frames carrying seat and back slats
    for sx in (-1, 1):
        x = sx * 0.78
        prof = [(-0.26, 0.0), (0.24, 0.0), (0.22, 0.38), (0.24, 0.42), (0.3, 0.88), (0.21, 0.9), (0.15, 0.48), (-0.24, 0.44)]
        k.prism_x(prof, x - 0.06, x + 0.06, conc)
    for i, y in enumerate((-0.2, -0.08, 0.04, 0.16)):
        k.box((1.86, 0.1, 0.035), (0, y, 0.46), slat)
    for z, y in ((0.66, 0.235), (0.8, 0.262)):
        k.box((1.86, 0.028, 0.1), (0, y, z), slat, rot=(math.radians(-7), 0, 0))
    for sx in (-1, 1):
        for y in (-0.2, 0.16):
            k.cyl(0.012, 0.01, (sx * 0.78, y, 0.481), bolt, seg=5)
    k.preview((1.3, -3.0, 1.1), (0, 0, 0.45), 34, "front")
    k.preview((-2.2, 1.9, 1.2), (0, 0, 0.45), 34, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.75, angle=50.0)
    k.export(quality=84)
    k.run_previews()


@asset("dustbin")
def build_dustbin():
    k = Kit("dustbin", "props")
    body = painted("db_body", rgb("#1f7a58"), under=rgb("#6c5238"), wear=0.4, fade=0.55, dirt=0.5, rust=0.45, metallic=0.1, drip=1.0, rough=0.5, scale=2.2, bevel=0.012)
    hood = painted("db_hood", rgb("#d6ad2e"), under=rgb("#6c5238"), wear=0.35, fade=0.5, dirt=0.5, rust=0.35, metallic=0.1, drip=0.9, rough=0.5, scale=2.2, bevel=0.012)
    trim = painted("db_trim", rgb("#e3e0d3"), under=rgb("#6c5238"), wear=0.35, fade=0.1, dirt=0.3, rust=0.2, drip=0.7, bevel=0.004)
    dark = flat("db_dark", rgb("#0e0d0c"), rough=0.9)
    conc = concrete("db_conc", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.25, dust=0.7, bevel=0.012)
    steel_c = steel("db_steel", rgb("#5d5a55"), rust=0.7, metallic=0.4, drip=0.2)
    k.box((0.84, 0.72, 0.1), (0, 0, 0.05), conc)
    for sx in (-1, 1):
        k.box((0.05, 0.5, 0.1), (sx * 0.26, 0, 0.14), steel_c)
    # rounded body, hood with a dark throat, little peak
    k.loft([{"c": (0, 0, 0.18), "rx": 0.32, "ry": 0.26, "power": 4.0}, {"c": (0, 0, 0.86), "rx": 0.35, "ry": 0.29, "power": 4.0}], body, seg=14, end=False)
    k.loft([{"c": (0, 0, 0.86), "rx": 0.36, "ry": 0.3, "power": 4.0}, {"c": (0, 0, 1.28), "rx": 0.36, "ry": 0.3, "power": 4.0}, {"c": (0, 0, 1.38), "rx": 0.29, "ry": 0.24, "power": 3.2}, {"c": (0, 0, 1.44), "rx": 0.12, "ry": 0.1, "power": 2.4}], hood, seg=14, start=False)
    k.box((0.48, 0.015, 0.3), (0, -0.295, 1.06), dark)
    k.box((0.56, 0.05, 0.04), (0, -0.3, 1.24), trim)
    k.box((0.56, 0.05, 0.03), (0, -0.3, 0.9), trim)
    # blank painted plate on the belly and a bottom door
    k.box((0.36, 0.01, 0.2), (0, -0.295, 0.62), trim)
    k.box((0.42, 0.012, 0.26), (0, -0.292, 0.32), hood)
    k.box((0.1, 0.03, 0.02), (0, -0.305, 0.34), steel_c)
    k.preview((1.0, -2.8, 1.2), (0, 0, 0.72), 34, "front")
    k.preview((-1.8, 1.7, 1.2), (0, 0, 0.72), 34, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.75, angle=55.0)
    k.export(quality=84)
    k.run_previews()


@asset("cone")
def build_cone():
    k = Kit("cone", "props")
    m = bo.pbr("cn_cone", rgb("#d9531e"), 0.55)
    g = G(m)
    col = g.mix(rgb("#d9531e"), rgb("#e7e3d6"), g.mul(g.smooth(g.z, 0.285, 0.29), g.smooth(g.z, 0.5, 0.495)))
    col = g.mix(col, rgb("#a4401a"), g.mul(g.smooth(g.noise(scale=4.0, detail=5.0), 0.42, 0.66), 0.55))
    col = g.mix(col, rgb("#3c3a35"), g.mul(g.smooth(g.noise(vec=g.vscale((14.0, 14.0, 2.0)), scale=1.0, detail=5.0), 0.56, 0.72), 0.75))
    col = g.mix(col, rgb("#4a4034"), g.mul(g.smooth(g.z, 0.26, 0.04), 0.7))
    g.color(col)
    g.rough(0.55)
    base = plastic("cn_base", rgb("#1f1e1c"), rough=0.75, scuff=0.45, dirt=0.5)
    k.box((0.36, 0.36, 0.03), (0, 0, 0.015), base, bevel=0.012)
    k.loft([{"c": (0, 0, 0.03), "rx": 0.125, "ry": 0.125}, {"c": (0, 0, 0.68), "rx": 0.03, "ry": 0.03}, {"c": (0, 0, 0.7), "rx": 0.022, "ry": 0.022}], m, seg=10, start=False)
    k.preview((0.5, -1.4, 0.7), (0, 0, 0.32), 34, "front")
    k.finish(size=256, normal=256, rm=128, ao=128, samples=10, ao_dist=0.12, ao_strength=0.7, angle=50.0)
    k.export(quality=84)
    k.run_previews()


@asset("road_divider")
def build_road_divider():
    k = Kit("road_divider", "props")
    rng = random.Random(21)
    m = bo.pbr("rd_paint", rgb("#d6ad22"), 0.7)
    g = G(m)
    _, _, nz = g.normal_xyz()
    conc_c = g.mix(rgb("#9e9584"), rgb("#7c7464"), g.smooth(g.noise(scale=7.0, detail=6.0), 0.35, 0.68))
    band = g.gt(g.fract(g.div(g.add(g.y, 1.0), 1.0)), 0.5)
    paint = g.mix(rgb("#cda51f"), rgb("#1e1d1b"), band)
    paint = g.mix(paint, rgb("#a39f8b"), g.mul(g.smooth(g.noise(scale=2.2, detail=5.0), 0.34, 0.7), 0.5))
    chips = g.smooth(g.add(g.noise(scale=6.5, detail=7.0, rough=0.65), g.mul(g.edge_mask(0.03), 0.32)), 0.56, 0.6)
    col = g.mix(paint, conc_c, chips)
    streak = g.smooth(g.noise(vec=g.vscale((9.0, 9.0, 1.0)), scale=1.0, detail=5.0), 0.52, 0.68)
    col = g.mix(col, rgb("#3d382f"), g.mul(streak, 0.5))
    col = g.mix(col, rgb("#3f382d"), g.mul(g.smooth(g.z, 0.34, 0.0), 0.85))
    col = g.mix(col, rgb("#a8997e"), g.mul(g.smooth(nz, 0.5, 0.9), 0.55))
    height = g.add(g.mul(g.noise(scale=30.0, detail=5.0), 0.35), g.mul(chips, -0.6))
    g.color(col)
    g.rough(g.add(0.68, g.mul(chips, 0.2)))
    g.surface(height, strength=0.7, distance=0.02, bevel=0.018)
    rebar = steel("rd_rebar", rgb("#54402c"), rust=1.0, metallic=0.3, drip=0.0)
    sec = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.07), (0.14, 0.32), (0.09, 0.78), (0.06, 0.82), (-0.06, 0.82), (-0.09, 0.78), (-0.14, 0.32), (-0.3, 0.07)]

    def nicked(section, amp):
        return [(x + rng.uniform(-amp, amp) * (1 if abs(x) < 0.25 else 0.3), z + (rng.uniform(-amp, 0) * 1.6 if z > 0.3 else 0)) for x, z in section]
    # chipped ends and a bitten top corner, the middle stays true
    stations = [(-1.0, nicked(sec, 0.018)), (-0.92, nicked(sec, 0.006)), (0.0, sec), (0.9, nicked(sec, 0.006)), (1.0, nicked(sec, 0.022))]
    k.section_loft(stations, m)
    k.rod((0.03, 1.0, 0.56), (0.05, 1.08, 0.59), 0.007, rebar, seg=3)
    k.rod((-0.04, 1.0, 0.3), (-0.03, 1.06, 0.27), 0.007, rebar, seg=3)
    k.preview((1.6, -2.8, 1.2), (0, 0, 0.42), 34, "front")
    k.preview((-2.2, 2.2, 1.0), (0, 0, 0.42), 34, "end")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.7, angle=40.0)
    k.export(quality=84)
    k.run_previews()


@asset("barrier")
def build_barrier():
    k = Kit("barrier", "props")
    band_x = banded("br_x", rgb("#c22d26"), rgb("#e6e3d8"), 0.42, axis="x", wear=0.55, rust=0.3, rough=0.45, metallic=0.2)
    band_z = banded("br_z", rgb("#c22d26"), rgb("#e6e3d8"), 0.3, axis="z", wear=0.55, rust=0.3, rough=0.45, metallic=0.2)
    steel_c = steel("br_steel", rgb("#4f514f"), rust=0.65, metallic=0.5, drip=0.2)
    W, H = 2.3, 1.05
    # top and bottom rails, end posts, a row of uprights, flat foot bars
    k.rod((-W / 2, 0, H), (W / 2, 0, H), 0.024, band_x, seg=6)
    k.rod((-W / 2, 0, 0.22), (W / 2, 0, 0.22), 0.02, band_x, seg=6)
    for sx in (-1, 1):
        k.rod((sx * W / 2, 0, 0.04), (sx * W / 2, 0, H), 0.024, band_z, seg=6)
        k.rod((sx * (W / 2 - 0.02), -0.3, 0.02), (sx * (W / 2 - 0.02), 0.3, 0.02), 0.018, steel_c, seg=5)
    for i in range(1, 9):
        x = -W / 2 + i * W / 9
        k.rod((x, 0, 0.22), (x, 0, H), 0.0105, band_z, seg=4)
    k.rod((-W / 2, 0, 0.62), (W / 2, 0, 0.62), 0.012, band_x, seg=5)
    # interlocking hook and eye
    k.tube([(W / 2, 0, 0.9), (W / 2 + 0.05, 0, 0.9), (W / 2 + 0.05, 0, 0.84)], 0.007, steel_c, seg=3)
    k.preview((1.5, -4.2, 1.2), (0, 0, 0.55), 34, "front")
    k.preview((-2.6, 2.4, 1.2), (0, 0, 0.55), 34, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.15, ao_strength=0.65, angle=60.0)
    k.export(quality=84)
    k.run_previews()


@asset("electric_box")
def build_electric_box():
    k = Kit("electric_box", "props")
    body = painted("eb_body", rgb("#9fa294"), under=rgb("#6c5238"), wear=0.3, fade=0.45, dirt=0.5, rust=0.45, metallic=0.1, drip=1.0, rough=0.52, scale=1.8, bevel=0.01)
    door = painted("eb_door", rgb("#a7aa9b"), under=rgb("#6c5238"), wear=0.35, fade=0.45, dirt=0.4, rust=0.4, metallic=0.1, drip=1.0, rough=0.5, scale=1.8, bevel=0.006)
    conc = concrete("eb_conc", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.25, dust=0.7, bevel=0.012)
    steel_c = steel("eb_steel", rgb("#4f514f"), rust=0.6, metallic=0.5, drip=0.1)
    cable = flat("eb_cable", rgb("#121110"), rough=0.55)
    vent = bo.pbr("eb_vent", rgb("#9fa294"), 0.5)
    g = G(vent)
    louvre = g.smooth(g.fract(g.div(g.z, 0.028)), 0.45, 0.6)
    g.color(g.mix(rgb("#9b9e90"), rgb("#1d1c1a"), g.mul(louvre, 0.85)))
    g.rough(0.5)
    g.surface(louvre, strength=0.8, distance=0.008)
    paper = [flat("eb_p1", rgb("#d6c9a9"), rough=0.85), flat("eb_p2", rgb("#b8a7a0"), rough=0.85)]
    W, D, H = 0.92, 0.42, 1.34
    k.box((W + 0.2, D + 0.2, 0.14), (0, 0, 0.07), conc)
    k.box((W, D, H), (0, 0, 0.14 + H / 2), body)
    k.box((W + 0.05, D + 0.05, 0.03), (0, 0, 0.14 + H + 0.015), door)
    # double doors with lock, hinges and top vents
    for sx in (-1, 1):
        k.box((W / 2 - 0.025, 0.014, H - 0.26), (sx * (W / 4), -D / 2 - 0.006, 0.14 + (H - 0.26) / 2 + 0.05), door)
        k.box((W / 2 - 0.1, 0.008, 0.1), (sx * (W / 4), -D / 2 - 0.009, 0.14 + H - 0.1), vent)
        for z in (0.45, 1.1):
            k.box((0.03, 0.02, 0.06), (sx * (W / 2 - 0.01), -D / 2 - 0.008, z), steel_c)
    k.box((0.022, 0.024, 0.12), (0.03, -D / 2 - 0.016, 0.82), steel_c)
    # pasted scraps of paper, blank and weathered
    k.box((0.2, 0.002, 0.28), (-0.2, -D / 2 - 0.014, 0.74), paper[0], rot=(0, 0.06, 0))
    k.box((0.16, 0.002, 0.2), (0.25, -D / 2 - 0.014, 0.58), paper[1], rot=(0, -0.09, 0))
    # cables leaving the base into the ground and up the back
    for x, y in ((-0.25, 0.26), (0.0, 0.3), (0.25, 0.26)):
        k.tube([(x, 0.2, 0.3), (x, y, 0.18), (x * 1.3, y + 0.1, 0.0)], 0.018, cable, seg=4)
    k.preview((0.9, -2.8, 1.4), (0, 0, 0.75), 34, "front")
    k.preview((-1.9, 1.8, 1.4), (0, 0, 0.75), 34, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.75, angle=50.0)
    k.export(quality=84)
    k.run_previews()


@asset("bus_stop")
def build_bus_stop():
    k = Kit("bus_stop", "props")
    roof = ribbed_sheet("bs_roof", rgb("#b4b6aa"), period=0.14, axis="x", rust=0.28, drip=0.5, metallic=0.3, depth=0.9)
    frame = painted("bs_frame", rgb("#256b55"), under=rgb("#5e4630"), wear=0.4, fade=0.5, dirt=0.3, rust=0.45, metallic=0.25, drip=0.8, rough=0.48, scale=2.0, bevel=0.008)
    panel = ribbed_sheet("bs_panel", rgb("#c8c4b3"), period=0.1, axis="z", rust=0.2, drip=0.8, metallic=0.1, depth=0.6)
    sign = painted("bs_sign", rgb("#245f4a"), under=rgb("#5e4630"), wear=0.2, fade=0.35, dirt=0.2, rust=0.2, drip=0.6, rough=0.45, bevel=0.005)
    blank = painted("bs_blank", rgb("#e0ddcf"), wear=0.2, fade=0.1, dirt=0.2, rust=0.15, drip=0.7, rough=0.5, bevel=0.003)
    slat = wood("bs_slat", rgb("#7f6242"), axis="x", wear=0.55)
    conc = concrete("bs_conc", c1=rgb("#a89f8d"), c2=rgb("#81786a"), seam_h=0, drip=0, grime=0.8, grime_h=0.2, dust=0.8, bevel=0.012)
    steel_c = steel("bs_steel", rgb("#5a5c58"), rust=0.5, metallic=0.5, drip=0.3)
    L = 4.2
    # paved slab
    k.box((L + 0.6, 2.0, 0.1), (0, 0.1, 0.05), conc)
    # three frames: rear post, curved rafter overhanging the front
    for x in (-L / 2 + 0.1, 0.0, L / 2 - 0.1):
        k.box((0.09, 0.09, 2.6), (x, 0.62, 1.35), frame)
        k.tube([(x, 0.72, 2.56), (x, 0.3, 2.68), (x, -0.25, 2.72), (x, -0.85, 2.66)], 0.04, frame, seg=5)
        k.rod((x, 0.62, 1.95), (x, 0.0, 2.68), 0.025, frame, seg=4)
    # curved metal roof
    k.grid(lambda u, v: (v * (L / 2 + 0.15), 0.0 - u * 0.95, 2.74 - 0.14 * u * u + 0.03 * u), 6, 4, roof, w=0.8, chunks=1)
    # rear wall panel and front fascia with a blank sign
    k.box((L - 0.2, 0.03, 1.15), (0, 0.62, 1.55), panel)
    k.box((L - 0.2, 0.03, 0.42), (0, 0.62, 0.42), panel)
    k.box((L - 0.2, 0.05, 0.07), (0, 0.62, 0.98), frame)
    k.box((2.5, 0.05, 0.5), (0, -0.92, 2.88), sign)
    k.box((2.36, 0.012, 0.38), (0, -0.948, 2.88), blank)
    k.empty("sign", (0, -0.96, 2.88))
    # bench on steel brackets
    for x in (-1.1, 1.1):
        k.box((0.05, 0.4, 0.05), (x, 0.3, 0.46), steel_c)
        k.box((0.05, 0.05, 0.36), (x, 0.42, 0.26), steel_c)
    for y in (0.14, 0.27, 0.4):
        k.box((2.8, 0.1, 0.03), (0, y, 0.5), slat)
    # dropped litter bin
    k.loft([{"c": (1.75, 0.32, 0.1), "rx": 0.14, "ry": 0.14}, {"c": (1.75, 0.32, 0.72), "rx": 0.16, "ry": 0.16}], frame, seg=8, end=False)
    k.preview((2.0, -6.5, 1.8), (0, 0, 1.5), 34, "front")
    k.preview((-5.0, -2.5, 2.6), (0, 0, 1.4), 34, "left")
    k.preview((3.8, 3.8, 2.0), (0, 0, 1.4), 34, "back")
    k.finish(size=1024, normal=1024, rm=256, ao=512, samples=10, ao_dist=0.5, ao_strength=0.75, angle=60.0, cull=False, packed=True)
    k.export(quality=84)
    k.run_previews()


@asset("billboard")
def build_billboard():
    k = Kit("billboard", "props")
    leg = painted("bb_leg", rgb("#55636a"), under=rgb("#5e4630"), wear=0.3, fade=0.3, dirt=0.3, rust=0.55, metallic=0.4, drip=0.9, rough=0.5, bevel=0.0)
    frame = painted("bb_frame", rgb("#4d565b"), wear=0.3, fade=0.25, dirt=0.3, rust=0.6, metallic=0.4, drip=0.8, rough=0.5, bevel=0.0)
    face = bo.pbr("bb_face", rgb("#d6d3c6"), 0.6)
    g = G(face)
    col = g.mix(rgb("#dbd8ca"), rgb("#bcb9aa"), g.smooth(g.noise(scale=0.8, detail=5.0), 0.34, 0.68))
    seams = g.maxi(g.line(g.x, 2.0, 0.012), g.line(g.z, 2.0, 0.012))
    col = g.mix(col, rgb("#6d6a60"), g.mul(seams, 0.8))
    col = g.mix(col, rgb("#54493a"), g.mul(g.smooth(g.noise(vec=g.vscale((6.0, 6.0, 0.5)), scale=1.0, detail=5.0), 0.5, 0.7), 0.55))
    g.color(col)
    g.rough(0.6)
    rail = galv("bb_rail", rust=0.3)
    conc = concrete("bb_conc", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.3, grime=1.0, grime_h=0.5, dust=0.6, bevel=0.02)
    lamp = painted("bb_lamp", rgb("#3e4244"), wear=0.2, rust=0.3, metallic=0.4, drip=0.3, bevel=0.0)
    W, H = 8.0, 4.0
    z0 = 7.2
    fy = -0.1
    # concrete feet and two steel legs with a tie
    for sx in (-1, 1):
        x = sx * 2.3
        k.box((1.1, 1.1, 0.5), (x, 0.35, 0.25), conc, bevel=0.03)
        k.box((0.72, 0.72, 0.03), (x, 0.35, 0.51), frame)
        k.loft([{"c": (x, 0.35, 0.5), "rx": 0.2, "ry": 0.2}, {"c": (x, 0.35, z0 + H - 0.2), "rx": 0.14, "ry": 0.14}], leg, seg=10)
    k.rod((-2.3, 0.35, 5.5), (2.3, 0.35, 5.5), 0.055, frame, seg=5)
    k.rod((-2.3, 0.35, 3.1), (2.3, 0.35, 5.5), 0.045, frame, seg=5)
    k.rod((2.3, 0.35, 3.1), (-2.3, 0.35, 5.5), 0.045, frame, seg=5)
    # back truss of the frame
    for z in (z0, z0 + H / 2, z0 + H):
        k.box((W + 0.1, 0.09, 0.09), (0, 0.22, z), frame)
    for i in range(9):
        x = -W / 2 + i
        k.box((0.06, 0.06, H), (x, 0.22, z0 + H / 2), frame)
    for i in range(8):
        x0 = -W / 2 + i
        a, b = (z0, z0 + H / 2) if i % 2 else (z0 + H / 2, z0)
        k.rod((x0, 0.26, a), (x0 + 1, 0.26, b), 0.022, frame, seg=4)
        k.rod((x0, 0.26, a + H / 2), (x0 + 1, 0.26, b + H / 2), 0.022, frame, seg=4)
    # blank display face, thin sheet with a raised edge
    k.box((W, 0.05, H), (0, fy, z0 + H / 2), face, w=1.0)
    for sz in (-1, 1):
        k.box((W + 0.14, 0.12, 0.07), (0, fy, z0 + H / 2 + sz * (H / 2 + 0.03)), frame)
    for sx in (-1, 1):
        k.box((0.07, 0.12, H + 0.14), (sx * (W / 2 + 0.03), fy, z0 + H / 2), frame)
    k.empty("face", (0, fy - 0.03, z0 + H / 2))
    # walkway and rail in front of the bottom edge, lamp arms above it
    k.box((W + 0.3, 0.72, 0.03), (0, -0.55, z0 - 0.26), rail)
    for i in range(9):
        x = -W / 2 + i
        k.box((0.04, 0.8, 0.06), (x, -0.55, z0 - 0.29), frame)
        k.rod((x, -0.88, z0 - 0.26), (x, -0.88, z0 + 0.72), 0.014, rail, seg=4)
    for z in (z0 + 0.25, z0 + 0.72):
        k.rod((-W / 2 - 0.1, -0.88, z), (W / 2 + 0.1, -0.88, z), 0.016, rail, seg=4)
    for x in (-3.0, -1.0, 1.0, 3.0):
        k.tube([(x, fy, z0 - 0.05), (x, -0.5, z0 - 0.12), (x, -0.95, z0 + 0.05)], 0.016, lamp, seg=4)
        k.box((0.32, 0.12, 0.08), (x, -0.98, z0 + 0.08), lamp)
    # a ladder up the back of the left leg
    for sx in (-0.17, 0.17):
        k.rod((-2.3 + sx, 0.58, 0.6), (-2.3 + sx, 0.58, z0), 0.012, rail, seg=3)
    for i in range(12):
        z = 0.9 + i * 0.52
        k.rod((-2.47, 0.58, z), (-2.13, 0.58, z), 0.009, rail, seg=3)
    k.preview((8, -17, 2.0), (0, 0, 6.6), 40, "front")
    k.preview((-8, 13, 3.0), (0, 0, 6.4), 40, "back")
    k.preview((3, -4.5, 1.7), (0, -0.3, 7.2), 24, "under")
    k.finish(size=1024, normal=1024, rm=512, ao=512, samples=10, ao_dist=0.8, ao_strength=0.7, angle=55.0, margin=0.003)
    k.export(quality=84)
    k.run_previews()


# ---------------------------------------------------------------------------
# Rooftop clutter
# ---------------------------------------------------------------------------
@asset("water_tank")
def build_water_tank():
    k = Kit("water_tank", "props")
    poly = bo.pbr("wt_poly", rgb("#1b1c1d"), 0.55)
    g = G(poly)
    _, _, nz = g.normal_xyz()
    col = g.mix(rgb("#1a1b1c"), rgb("#2e2f30"), g.smooth(g.noise(scale=2.0, detail=5.0), 0.35, 0.7))
    col = g.mix(col, rgb("#4a463c"), g.mul(g.smooth(g.noise(vec=g.vscale((5.0, 5.0, 0.8)), scale=1.0, detail=5.0), 0.5, 0.7), 0.4))
    col = g.mix(col, rgb("#7f7560"), g.mulc(g.mul(g.smooth(nz, 0.55, 0.95), g.smooth(g.noise(scale=4.0, detail=4.0), 0.35, 0.65)), 0.6))
    col = g.mix(col, rgb("#5c5344"), g.mul(g.smooth(g.z, 0.3, 0.0), 0.7))
    g.color(col)
    g.rough(0.6)
    lid = plastic("wt_lid", rgb("#1e1f20"), rough=0.5, scuff=0.45, dirt=0.3)
    pipe = plastic("wt_pipe", rgb("#c7c3b4"), rough=0.5, scuff=0.45, dirt=0.3)
    brass = aluminium("wt_valve", rgb("#9b7d3c"))
    block = concrete("wt_block", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=0.8, grime_h=0.2, dust=0.7, bevel=0.012)
    # about 1000 litres: 1.1 m across, 1.2 m tall, with moulded ribs
    rings = [(0.0, 0.46), (0.05, 0.5)]
    z = 0.12
    for i in range(5):
        rings.append((z, 0.55))
        rings.append((z + 0.08, 0.575))
        z += 0.16
    rings += [(z + 0.02, 0.56), (z + 0.15, 0.47), (z + 0.26, 0.3), (z + 0.3, 0.25)]
    zb = 0.12
    k.loft([{"c": (0, 0, zb + a), "rx": b, "ry": b} for a, b in rings], poly, seg=14)
    ztop = zb + rings[-1][0]
    k.loft([{"c": (0, 0, ztop), "rx": 0.26, "ry": 0.26}, {"c": (0, 0, ztop + 0.07), "rx": 0.26, "ry": 0.26}, {"c": (0, 0, ztop + 0.1), "rx": 0.2, "ry": 0.2}], lid, seg=10)
    # on two strip blocks, outlet with valve, inlet pipe to the lid
    for x in (-0.3, 0.3):
        k.box((0.2, 1.1, 0.12), (x, 0, 0.06), block)
    k.tube([(0.5, 0.0, 0.32), (0.72, 0.0, 0.32), (0.74, 0.0, 0.1)], 0.021, pipe, seg=6)
    k.cyl(0.032, 0.09, (0.62, 0, 0.32), brass, seg=6, rot=(0, math.pi / 2, 0))
    k.tube([(-0.72, -0.1, 0.1), (-0.72, -0.1, ztop - 0.18), (-0.36, -0.1, ztop - 0.04), (-0.2, -0.1, ztop + 0.04)], 0.016, pipe, seg=5)
    k.preview((1.2, -3.2, 1.8), (0, 0, 0.72), 34, "front")
    k.preview((-2.0, -1.8, 2.8), (0, 0, 0.72), 34, "above")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.7, angle=60.0)
    k.export(quality=84)
    k.run_previews()


@asset("ac_unit")
def build_ac_unit():
    k = Kit("ac_unit", "props")
    body = painted("ac_body", rgb("#d2cebd"), under=rgb("#74583a"), wear=0.2, fade=0.2, dirt=0.5, rust=0.3, drip=1.2, rough=0.55, scale=2.5, bevel=0.01, edge=0.015)
    grille = bo.pbr("ac_grille", rgb("#2b2b2a"), 0.5)
    g = G(grille)
    cz = 0.40
    r = g.length2(g.x, g.sub(g.z, cz))
    rings = g.smooth(g.fract(g.div(r, 0.024)), 0.32, 0.46)
    ang = g.m("ARCTAN2", g.sub(g.z, cz), g.x)
    bars = g.smooth(g.absv(g.m("SINE", g.mul(ang, 2.0))), 0.04, 0.07)
    blades = g.smooth(g.m("SINE", g.add(g.mul(ang, 4.0), g.mul(r, 18.0))), -0.1, 0.25)
    under = g.mix(rgb("#0f0f0e"), rgb("#3b3b39"), g.mul(blades, g.smooth(r, 0.06, 0.09)))
    wire = g.mul(rings, bars)
    col = g.mix(rgb("#a5a294"), under, wire)
    col = g.mix(col, rgb("#6b6450"), g.mul(g.smooth(g.noise(scale=9.0, detail=4.0), 0.5, 0.7), 0.5))
    g.color(col)
    g.rough(0.5)
    g.surface(g.mul(wire, -1.0), strength=0.9, distance=0.012)
    fin = bo.pbr("ac_fin", rgb("#8e8d82"), 0.5, 0.3)
    g = G(fin)
    f = g.smooth(g.fract(g.div(g.z, 0.012)), 0.45, 0.6)
    g.color(g.mix(rgb("#8c8b80"), rgb("#272723"), f))
    g.rough(0.5)
    bracket = steel("ac_bracket", rgb("#4f4d48"), rust=0.8, metallic=0.5, drip=0.3)
    pipe = plastic("ac_pipe", rgb("#c9c5b5"), rough=0.7, scuff=0.5, dirt=0.3)
    cu = aluminium("ac_cu", rgb("#a06a3a"))
    W, D, H = 0.84, 0.32, 0.56
    zb = 0.12
    k.box((W, D, H), (0, 0, zb + H / 2), body)
    k.cyl(0.215, 0.012, (-0.1, -D / 2 - 0.004, cz), grille, seg=14, rot=(math.pi / 2, 0, 0))
    # vented right-hand service corner, rear fins, top plate
    k.box((0.2, 0.006, 0.3), (0.28, -D / 2 - 0.002, cz - 0.04), fin)
    k.box((W - 0.05, 0.006, H - 0.06), (0, D / 2 + 0.002, zb + H / 2), fin)
    k.box((W + 0.02, D + 0.02, 0.012), (0, 0, zb + H + 0.006), body)
    # L-brackets and feet, copper pipes wrapped at one side, drain stub
    for sx in (-1, 1):
        k.box((0.04, D + 0.06, 0.04), (sx * 0.3, 0, zb - 0.02), bracket)
        k.box((0.04, 0.04, 0.1), (sx * 0.3, D / 2 + 0.01, 0.05), bracket)
    k.tube([(W / 2 + 0.005, 0.0, 0.3), (W / 2 + 0.05, 0.0, 0.26), (W / 2 + 0.06, 0.06, 0.06)], 0.02, pipe, seg=5)
    k.rod((W / 2, -0.06, 0.22), (W / 2 + 0.03, -0.06, 0.22), 0.009, cu, seg=4)
    k.tube([(0.3, 0.0, zb), (0.3, -0.03, zb - 0.05), (0.32, -0.06, 0.0)], 0.007, pipe, seg=3)
    k.preview((0.7, -1.9, 0.75), (0, 0, 0.42), 34, "front")
    k.preview((-1.3, 1.3, 0.9), (0, 0, 0.42), 34, "back")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.12, ao_strength=0.7, angle=60.0)
    k.export(quality=84)
    k.run_previews()


@asset("dish")
def build_dish():
    k = Kit("dish", "props")
    dish_m = painted("ds_dish", rgb("#d9d7ca"), under=rgb("#75593b"), wear=0.25, fade=0.15, dirt=0.25, rust=0.4, rough=0.45, drip=0.8, scale=2.4, bevel=0.0)
    arm = steel("ds_arm", rgb("#73736d"), rust=0.6, metallic=0.5, drip=0.3)
    lnb = plastic("ds_lnb", rgb("#27282a"), rough=0.45, scuff=0.35, dirt=0.0)
    block = concrete("ds_block", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=0.8, grime_h=0.15, dust=0.7, bevel=0.012)
    cable = flat("ds_cable", rgb("#121110"), rough=0.5)
    # weighted base, short mast
    k.box((0.44, 0.44, 0.1), (0, 0, 0.05), block)
    k.rod((0, 0, 0.09), (0, 0, 0.8), 0.022, arm, seg=6)
    k.box((0.28, 0.28, 0.012), (0, 0, 0.1), arm)
    # dish faces -Y and looks up about 40 degrees. Built on the local Y axis, then tilted.
    R = 0.3
    tilt = math.radians(-50)
    cy, cz = -0.09, 0.86
    rings = []
    for i, t in enumerate((0.0, 0.4, 0.75, 1.0)):
        r = R * t
        d = 0.1 * t * t
        rings.append({"c": (0, d, 0), "rx": max(r, 0.002), "ry": max(r, 0.002) * 0.94, "axis": "y"})
    # a little rolled rim so the dish has thickness
    rings.append({"c": (0, 0.103, 0), "rx": R + 0.005, "ry": (R + 0.005) * 0.94, "axis": "y"})
    rings.append({"c": (0, 0.085, 0), "rx": R + 0.002, "ry": (R + 0.002) * 0.94, "axis": "y"})
    o = k.loft(rings, dish_m, seg=14, start=False, end=False)
    m = Matrix.Translation((0, cy, cz)) @ Matrix.Rotation(tilt, 4, "X") @ Matrix.Rotation(math.pi, 4, "Z")
    o.matrix_basis = m
    # feed arm from the rim up to the LNB at the focus
    focus = m @ Vector((0, 0.33, 0))
    foot = m @ Vector((0, 0.02, -R * 0.72))
    k.rod(tuple(foot), tuple(focus), 0.009, arm, seg=4)
    k.cyl(0.03, 0.08, tuple(focus), lnb, seg=6, rot=(math.pi / 2 + tilt, 0, 0))
    k.tube([tuple(foot), (0.0, -0.02, 0.72), (0.02, 0.0, 0.4), (0.02, 0.0, 0.1)], 0.005, cable, seg=3)
    # back clamp plate
    k.box((0.12, 0.05, 0.14), (0, -0.02, 0.84), arm)
    k.preview((0.8, -2.2, 1.05), (0, 0, 0.62), 34, "front")
    k.preview((-1.4, 1.3, 1.25), (0, 0, 0.62), 34, "back")
    k.finish(size=256, normal=256, rm=128, ao=128, samples=10, ao_dist=0.12, ao_strength=0.65, angle=60.0, cull=False)
    k.export(quality=84)
    k.run_previews()


@asset("laundry")
def build_laundry():
    k = Kit("laundry", "props")
    rng = random.Random(14)
    post = steel("ln_post", rgb("#5a5c58"), rust=0.6, metallic=0.4, drip=0.2)
    rope = flat("ln_rope", rgb("#c4bda8"), rough=0.9)
    lungi = plaid("ln_lungi", [rgb("#27508e"), rgb("#1b3564"), rgb("#c7c0ab"), rgb("#27508e")], period=0.09)
    gamcha = plaid("ln_gamcha", [rgb("#b5322c"), rgb("#e0d9c6"), rgb("#b5322c"), rgb("#2b7d51")], period=0.07)
    lungi2 = plaid("ln_lungi2", [rgb("#2c6e49"), rgb("#17472d"), rgb("#d6cfb6"), rgb("#8a2f2a")], period=0.11)
    shirt = fabric("ln_shirt", rgb("#dfe0da"), fade=0.25, dirt=0.3, sag_dirt=0.2)
    shirt2 = fabric("ln_shirt2", rgb("#3779a9"), fade=0.5, dirt=0.3, sag_dirt=0.2)
    shirt3 = fabric("ln_shirt3", rgb("#c58b2c"), fade=0.5, dirt=0.3, sag_dirt=0.2)
    peg = flat("ln_peg", rgb("#6a4e33"), rough=0.7)
    Hz = 2.05
    L = 1.9

    def line_z(x):
        return Hz - 0.09 * (1 - (x / L) ** 2)
    # two short steel posts with a slack line
    for sx in (-1, 1):
        k.loft([{"c": (sx * L, 0, 0.0), "rx": 0.025, "ry": 0.025}, {"c": (sx * L, 0, Hz + 0.07), "rx": 0.02, "ry": 0.02}], post, seg=5)
        k.box((0.16, 0.16, 0.012), (sx * L, 0, 0.006), post)
    for i in range(6):
        x0, x1 = -L + i * 2 * L / 6, -L + (i + 1) * 2 * L / 6
        k.rod((x0, 0, line_z(x0)), (x1, 0, line_z(x1)), 0.005, rope, seg=3)

    def cloth_pt(cx, width, length, phase, sway):
        def fn(u, v):
            t = 1.0 - (v + 1) * 0.5  # t = 0 at the line, 1 at the hem
            x = cx + u * width * 0.5 * (1.0 - 0.06 * t) + sway * t * t
            y = 0.035 * math.sin(u * 5.5 + phase) * (0.3 + t) + 0.03 * math.sin(u * 2.3 + phase * 2.0 + t * 3.0) * t
            top = line_z(cx + u * width * 0.5) - 0.012 * math.sin(u * 3.14 + phase)
            z = top - length * t
            return (x, y, z)
        return fn
    garments = [(-1.45, 0.62, 1.05, lungi, 0.4), (-0.78, 0.46, 0.92, gamcha, 1.3), (0.72, 0.92, 1.12, lungi2, 3.1), (1.45, 0.42, 0.8, shirt3, 4.0)]
    for cx, wd, ln, m, ph in garments:
        k.grid(cloth_pt(cx, wd, ln, ph, rng.uniform(-0.03, 0.03)), 6, 4, m, w=0.9, chunks=1)
    # shirts hanging by the hem, with short sleeves dropping at each side
    for cx, m, ph in ((-0.15, shirt, 2.1), (0.22, shirt2, 5.2)):
        w_, l_ = 0.44, 0.7
        k.grid(cloth_pt(cx, w_, l_, ph, 0.01), 4, 4, m, w=0.9, chunks=1)
        for sd in (-1, 1):
            k.grid(cloth_pt(cx + sd * (w_ * 0.5 + 0.06), 0.13, 0.34, ph + sd, sd * 0.02), 1, 2, m, w=0.9, chunks=1)
    # pegs
    for x in (-1.72, -1.2, -0.98, -0.6, -0.34, 0.03, 0.08, 0.41, 0.3, 1.14, 1.27, 1.63):
        z = line_z(x)
        k.box((0.012, 0.02, 0.06), (x, 0, z - 0.012), peg)
    k.preview((1.0, -5.2, 1.6), (0, 0, 1.3), 34, "front")
    k.preview((-3.6, 3.0, 1.8), (0, 0, 1.3), 34, "back")
    k.finish(size=768, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.5, angle=75.0, cull=False, packed=True)
    k.export(quality=84)
    k.run_previews()


@asset("planter")
def build_planter():
    k = Kit("planter", "props")
    rng = random.Random(16)
    conc = concrete("pl_conc", c1=rgb("#aaa18e"), c2=rgb("#847b6a"), seam_h=0, drip=0.9, drip_top=0.62, drip_band=0.5, grime=0.8, grime_h=0.25, dust=0.5, moss=0.5, bevel=0.012)
    soil = concrete("pl_soil", c1=rgb("#3e2f22"), c2=rgb("#2b2017"), seam_h=0, drip=0, grime=0, soot=0, dust=0, bevel=0, mottled=1.5)
    bark_m = wood("pl_stem", rgb("#5d4c34"), axis="z", wear=0.2)
    leaf = bo.pbr("pl_leaf", rgb("#3f8034"), 0.5)
    g = G(leaf)
    col = g.mix(rgb("#2f6a2b"), rgb("#62a23d"), g.smooth(g.noise(scale=6.0, detail=3.0), 0.36, 0.64))
    col = g.mix(col, rgb("#a4b354"), g.mul(g.smooth(g.noise(scale=24.0, detail=3.0), 0.62, 0.7), 0.6))
    g.color(col)
    g.rough(0.5)
    W, H = 0.9, 0.62
    # square tub: outer wall with a lip and a soil fill
    k.box((W, W, H), (0, 0, H / 2), conc, bevel=0.015)
    k.box((W + 0.06, W + 0.06, 0.06), (0, 0, H + 0.03), conc, bevel=0.012)
    k.box((W - 0.1, W - 0.1, 0.02), (0, 0, H + 0.06), soil)
    k.box((W + 0.02, W + 0.02, 0.05), (0, 0, 0.025), conc, bevel=0.01)
    # a small plant: one stem, branching, blade leaves as bent quads
    Zs = H + 0.07
    k.sweep([(0, 0, Zs), (0.02, 0, Zs + 0.28), (0.0, 0.02, Zs + 0.5)], [0.018, 0.012, 0.006], bark_m, seg=5)
    verts, faces = [], []
    for i in range(30):
        a = i * 2.4 + rng.uniform(-0.2, 0.2)
        h = rng.uniform(0.2, 0.72)
        ln = rng.uniform(0.18, 0.3)
        wd = rng.uniform(0.045, 0.07)
        ca, sa = math.cos(a), math.sin(a)
        st = 0.03 + 0.08 * h
        p0 = Vector((ca * st, sa * st, Zs + h * 0.8))
        d = Vector((ca, sa, rng.uniform(0.15, 0.7))).normalized()
        side = Vector((-sa, ca, 0))
        p1 = p0 + d * ln * 0.5 + Vector((0, 0, 0.02))
        p2 = p0 + d * ln + Vector((0, 0, -0.04))
        b = len(verts)
        verts += [tuple(p0), tuple(p1 - side * wd), tuple(p1 + side * wd), tuple(p2)]
        faces += [(b, b + 2, b + 1), (b + 1, b + 2, b + 3)]
    k.mesh(verts, faces, leaf, w=1.0, smooth=False)
    k.preview((1.2, -2.8, 1.5), (0, 0, 0.72), 34, "front")
    k.preview((-2.0, -1.6, 2.2), (0, 0, 0.72), 34, "above")
    k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=0.2, ao_strength=0.7, angle=75.0, cull=False)
    k.export(quality=84)
    k.run_previews()



# ---------------------------------------------------------------------------
# Remaining landmarks
# ---------------------------------------------------------------------------
def _arch_outline(cx, w, z0, zs, za, n=6):
    """Pointed arch outline as (x, z), from bottom-left, up, over the apex, down to bottom-right."""
    left, right = [(cx - w / 2, z0)], []
    for i in range(n + 1):
        u = 1.0 - i / n
        x_off = u * w / 2
        z = zs + (za - zs) * (1.0 - u) ** 0.62
        left.append((cx - x_off, z))
        if i < n:
            right.append((cx + x_off, z))
    return left + list(reversed(right)) + [(cx + w / 2, z0)]


def _arch_ring(cx, w, z0, zs, za, band, n=6):
    """Closed trim band that follows an arch: outer outline then the inner one reversed."""
    outer = _arch_outline(cx, w + band * 2, z0, zs, za + band * 1.2, n)
    inner = _arch_outline(cx, w, z0, zs, za, n)
    return outer + list(reversed(inner))


def _bulb_rings(cx, cy, z0, r, profile):
    return [{"c": (cx, cy, z0 + a * r), "rx": b * r, "ry": b * r} for a, b in profile]


DOME_PROFILE = [(0.0, 0.94), (0.2, 1.03), (0.45, 1.06), (0.72, 1.0), (1.0, 0.84), (1.26, 0.58), (1.44, 0.33), (1.56, 0.14), (1.66, 0.045)]


def _finial(k, cx, cy, z0, r, mat):
    """Plain stacked ball and spire: dignified, no crescent."""
    k.loft([{"c": (cx, cy, z0 - 0.05 * r), "rx": 0.09 * r, "ry": 0.09 * r}, {"c": (cx, cy, z0 + 0.04 * r), "rx": 0.13 * r, "ry": 0.13 * r}, {"c": (cx, cy, z0 + 0.13 * r), "rx": 0.05 * r, "ry": 0.05 * r}, {"c": (cx, cy, z0 + 0.25 * r), "rx": 0.095 * r, "ry": 0.095 * r}, {"c": (cx, cy, z0 + 0.37 * r), "rx": 0.03 * r, "ry": 0.03 * r}, {"c": (cx, cy, z0 + 0.72 * r), "rx": 0.006 * r, "ry": 0.006 * r}], mat, seg=8)


@asset("mosque", "landmarks")
def build_mosque():
    k = Kit("mosque", "landmarks")
    white = plaster("mq_white", drip=0.8, drip_top=7.0, grime=0.8, grime_h=1.5, moss=0.45, bevel=0.04)
    white2 = plaster("mq_white2", c1=rgb("#ece8dc"), c2=rgb("#d9d4c3"), drip=0.7, drip_top=5.5, grime=0.5, grime_h=1.5, moss=0.35, bevel=0.03)
    green = plaster("mq_green", c1=rgb("#a9cdb0"), c2=rgb("#8fb698"), drip=0.5, grime=0.3, grime_h=1.6, moss=0.2, bevel=0.015)
    green_dark = plaster("mq_green2", c1=rgb("#6d9e7f"), c2=rgb("#5a8a6c"), drip=0.4, grime=0.3, grime_h=1.0, moss=0.0, bevel=0.012)
    dome_m = plaster("mq_dome", c1=rgb("#b6d8bf"), c2=rgb("#9cc5a8"), drip=0.8, grime=0.0, moss=0.0, bevel=0.0, scale=0.7)
    dark = plaster("mq_dark", c1=rgb("#1f2a28"), c2=rgb("#171f1e"), drip=0.0, grime=0.0, moss=0.0, bevel=0.0)
    wood_door = wood("mq_door", rgb("#50361f"), axis="z", wear=0.2, plank=0.0)
    step = concrete("mq_step", c1=rgb("#bcb6a6"), c2=rgb("#9f9988"), seam_h=0, seam_w=0.6, drip=0.1, grime=0.5, grime_h=0.4, dust=0.5, bevel=0.015)
    floor_m = concrete("mq_floor", c1=rgb("#a9a595"), c2=rgb("#8f8a7a"), seam_h=0, drip=0, grime=0, soot=0, dust=0.1, bevel=0.0)
    brass = aluminium("mq_brass", rgb("#b09244"))
    rail = painted("mq_rail", rgb("#d9d6c8"), wear=0.3, rust=0.2, drip=0.2, bevel=0.0)

    FY = -8.0
    # raised plinth and front steps
    k.box((20.6, 16.6, 0.5), (0, 0, 0.25), step, bevel=0.02)
    for i in range(3):
        k.box((9.0 + i * 0.5, 0.42, 0.17 * (3 - i)), (0, FY - 0.5 - (2 - i) * 0.42 + 0.21, 0.085 * (3 - i)), step, bevel=0.012)
    # hall walls
    k.box((18.0, 11.6, 6.5), (0, 2.2, 3.75), white, bevel=0.03)
    # green dado on the outside and a deep cornice
    k.box((18.1, 11.7, 1.0), (0, 2.2, 1.0), green, bevel=0.012)
    k.box((18.5, 12.1, 0.3), (0, 2.2, 6.75), white, bevel=0.03)
    k.box((18.3, 11.9, 0.16), (0, 2.2, 6.52), green_dark, bevel=0.012)
    # verandah: floor and ceiling behind the arcade
    k.box((19.6, 4.4, 0.04), (0, -5.8, 0.52), floor_m)
    k.box((19.6, 4.4, 0.5), (0, -5.8, 5.25), white2, bevel=0.02)
    # arcade wall as one comb-shaped section so the arches have true depth
    widths = [2.7, 2.7, 3.4, 2.7, 2.7]
    pier = (20.0 - sum(widths)) / 6
    x = -10.0 + pier
    sec = [(-10.0, 0.5)]
    centres = []
    for wd in widths:
        cx = x + wd / 2
        za = 4.65 if wd > 3 else 4.2
        centres.append((cx, wd, za))
        sec += _arch_outline(cx, wd, 0.5, 3.0, za, n=6)
        x += wd + pier
    sec += [(10.0, 0.5), (10.0, 5.5), (-10.0, 5.5)]
    k.section_loft([(FY, sec), (FY + 0.85, sec)], white2, w=1.0)
    # arch trims, spandrel medallions, and engaged colonnettes on the piers
    for cx, wd, za in centres:
        ring = _arch_ring(cx, wd, 2.95, 3.0, za, 0.14, n=6)
        k.section_loft([(FY - 0.05, ring), (FY + 0.02, ring)], green)
        k.cyl(0.14, 0.04, (cx, FY - 0.02, 4.95), green_dark, seg=8, rot=(math.pi / 2, 0, 0))
    for i in range(6):
        xc = -10.0 + pier / 2 + sum(widths[:i]) + pier * i
        k.box((0.28, 0.12, 2.5), (xc, FY - 0.05, 1.75), green)
        k.box((0.44, 0.16, 0.14), (xc, FY - 0.06, 3.02), green_dark)
    # string course and battlemented parapet along the front
    k.box((20.3, 1.0, 0.18), (0, FY + 0.4, 5.5), green_dark, bevel=0.012)
    merlons = []
    for i in range(21):
        merlons.append(((0.62, 0.22, 0.46), (-10.0 + i, FY + 0.05, 5.82)))
    k.boxes(merlons, white2)
    k.boxes([((0.3, 0.24, 0.12), (-10.0 + i, FY + 0.05, 6.11)) for i in range(21)], green)
    # hall front wall: dark door and window arches under the verandah
    for cx, wd, za in centres:
        w_ = wd * 0.52
        zb = 0.54
        zsp = 2.5
        zt = 3.5 if wd > 3 else 3.2
        door = _arch_outline(cx, w_, zb, zsp, zt, n=5)
        k.section_loft([(-3.68, door), (-3.62, door)], dark if wd < 3 else wood_door)
        ring = _arch_ring(cx, w_, zb, zsp, zt, 0.1, n=5)
        k.section_loft([(-3.71, ring), (-3.62, ring)], green)
    # flat roof over the hall with a low green-edged parapet
    k.box((17.6, 11.2, 0.05), (0, 2.2, 7.0), floor_m, w=0.4)
    for sy, y in ((1, 7.95), (-1, -3.55)):
        k.box((18.4, 0.22, 0.38), (0, y, 7.08), white2, bevel=0.012)
    for x_ in (-9.0, 9.0):
        k.box((0.22, 11.6, 0.38), (x_, 2.2, 7.08), white2, bevel=0.012)

    # side and rear windows: one blind arched window, instanced around the hall
    wins = []
    for y in (2.2, 5.5):
        wins.append(Matrix.Translation((0, y + 1.1, 0)))
    for y in (-1.1, 2.2, 5.5):
        wins.append(Matrix.Translation((0, y + 1.1, 0)) @ _mirror_x())
    # rear wall: same window rotated to look along +Y
    for x_ in (-6.0, -2.0, 2.0, 6.0):
        wins.append(Matrix.Translation((x_ - 1.1, 8.0 - 9.0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z"))
    k.begin_instances(wins, "window")
    outline = _arch_outline(0.0, 1.3, 1.65, 3.9, 5.15, n=5)
    frame_o = _arch_ring(0.0, 1.3, 1.65, 3.9, 5.15, 0.14, n=5)

    def side_part(section, y0, y1, mat, shift):
        o = k.section_loft([(y0, section), (y1, section)], mat)
        o.matrix_basis = Matrix.Translation((9.0 + shift, -1.1, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
    side_part(outline, -0.01, 0.03, dark, 0.0)
    side_part(frame_o, -0.04, 0.03, green, 0.0)
    side_part(rrect(1.75, 0.12, 0.01, 1, 0.0, 1.58), -0.1, 0.04, green_dark, 0.0)
    k.end_instances()

    # central drum and big dome
    cx, cy = 0.0, 2.2
    R = 4.25
    k.loft([{"c": (cx, cy, 7.0), "rx": R + 0.28, "ry": R + 0.28}, {"c": (cx, cy, 7.15), "rx": R + 0.28, "ry": R + 0.28}, {"c": (cx, cy, 7.25), "rx": R + 0.1, "ry": R + 0.1}, {"c": (cx, cy, 8.55), "rx": R + 0.08, "ry": R + 0.08}, {"c": (cx, cy, 8.72), "rx": R + 0.26, "ry": R + 0.26}, {"c": (cx, cy, 8.82), "rx": R + 0.26, "ry": R + 0.26}], white2, seg=28, start=False)
    for i in range(12):
        a = 2 * math.pi * i / 12
        o = k.section_loft([(-0.01, _arch_outline(0, 0.62, 7.38, 7.95, 8.42, n=3)), (0.03, _arch_outline(0, 0.62, 7.38, 7.95, 8.42, n=3))], dark)
        o.matrix_basis = Matrix.Translation((cx + math.cos(a) * (R + 0.075), cy + math.sin(a) * (R + 0.075), 0)) @ Matrix.Rotation(a + math.pi / 2, 4, "Z")
    k.loft(_bulb_rings(cx, cy, 8.82, R, DOME_PROFILE), dome_m, seg=28, start=False)
    # raised ribs are subtle thin bands
    for i in range(12):
        a = 2 * math.pi * i / 12
        pts, radii = [], []
        for pz, pr in DOME_PROFILE[:-1]:
            rr = pr * R + 0.015
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr, 8.82 + pz * R))
            radii.append(0.05 - 0.03 * pz / 1.6)
        k.sweep(pts, radii, green_dark, seg=4, w=0.6)
    _finial(k, cx, cy, 8.82 + 1.66 * R, 2.3, brass)
    # two small domes on octagonal drums either side
    for sx in (-1, 1):
        dx = sx * 6.5
        r = 1.72
        k.loft([{"c": (dx, cy, 7.0), "rx": r + 0.1, "ry": r + 0.1}, {"c": (dx, cy, 8.15), "rx": r + 0.04, "ry": r + 0.04}, {"c": (dx, cy, 8.3), "rx": r + 0.16, "ry": r + 0.16}, {"c": (dx, cy, 8.38), "rx": r + 0.16, "ry": r + 0.16}], white2, seg=16, start=False)
        k.loft(_bulb_rings(dx, cy, 8.38, r, DOME_PROFILE), dome_m, seg=18, start=False)
        _finial(k, dx, cy, 8.38 + 1.66 * r, 1.3, brass)
        for i in range(8):
            a = 2 * math.pi * i / 8
            o = k.box((0.32, 0.03, 0.74), (dx + math.cos(a) * (r + 0.09), cy + math.sin(a) * (r + 0.09), 7.6), dark)
            o.rotation_euler = (0, 0, a + math.pi / 2)

    # tall minaret at the front right corner, three tiers with balconies
    mx, my = 8.7, -6.7

    def tier(z0, z1, r0, r1, mat=white2):
        k.loft([{"c": (mx, my, z0), "rx": r0, "ry": r0}, {"c": (mx, my, z1), "rx": r1, "ry": r1}], mat, seg=12, start=False, end=False)

    def balcony(z, r, r_out):
        # corbel flare, deck, slim parapet ring with a green cap
        k.loft([{"c": (mx, my, z - 0.55), "rx": r, "ry": r}, {"c": (mx, my, z - 0.25), "rx": (r + r_out) * 0.5, "ry": (r + r_out) * 0.5}, {"c": (mx, my, z), "rx": r_out, "ry": r_out}], green, seg=12, start=False, end=False)
        k.loft([{"c": (mx, my, z), "rx": r_out, "ry": r_out}, {"c": (mx, my, z + 0.82), "rx": r_out, "ry": r_out}, {"c": (mx, my, z + 0.9), "rx": r_out + 0.05, "ry": r_out + 0.05}, {"c": (mx, my, z + 0.96), "rx": r_out - 0.12, "ry": r_out - 0.12}], white2, seg=12, start=False)
        k.loft([{"c": (mx, my, z + 0.94), "rx": r_out + 0.0, "ry": r_out + 0.0}, {"c": (mx, my, z + 1.0), "rx": r_out + 0.02, "ry": r_out + 0.02}], green_dark, seg=12, start=False, end=False)

    # square base rising beside the arcade, then octagons
    k.box((2.6, 2.6, 6.5), (mx, my, 3.75), white2, bevel=0.03)
    k.box((2.68, 2.68, 1.0), (mx, my, 1.0), green, bevel=0.012)
    k.box((2.9, 2.9, 0.28), (mx, my, 7.1), green_dark, bevel=0.02)
    k.box((2.72, 2.72, 0.18), (mx, my, 6.0), green_dark, bevel=0.012)
    tier(7.2, 13.0, 1.02, 0.92)
    balcony(13.2, 0.92, 1.36)
    tier(13.2, 18.6, 0.74, 0.66)
    balcony(18.8, 0.66, 1.08)
    tier(18.8, 21.8, 0.54, 0.5)
    k.loft([{"c": (mx, my, 21.8), "rx": 0.5, "ry": 0.5}, {"c": (mx, my, 22.0), "rx": 0.72, "ry": 0.72}, {"c": (mx, my, 22.1), "rx": 0.72, "ry": 0.72}], green_dark, seg=12, start=False, end=False)
    k.loft(_bulb_rings(mx, my, 22.1, 0.62, DOME_PROFILE), dome_m, seg=12, start=False)
    _finial(k, mx, my, 22.1 + 1.66 * 0.62, 1.0, brass)
    # dark arched slits on the top tier and shaft
    for i in range(6):
        a = 2 * math.pi * i / 6
        o = k.section_loft([(-0.01, _arch_outline(0, 0.3, 19.9, 20.8, 21.2, n=2)), (0.02, _arch_outline(0, 0.3, 19.9, 20.8, 21.2, n=2))], dark)
        o.matrix_basis = Matrix.Translation((mx + math.cos(a) * 0.51, my + math.sin(a) * 0.51, 0)) @ Matrix.Rotation(a + math.pi / 2, 4, "Z")
    for z in (9.0, 15.2):
        for a in (math.pi * 1.5, 0.0):
            r_ = 0.97 if z < 12 else 0.7
            o = k.section_loft([(-0.01, _arch_outline(0, 0.32, z, z + 0.85, z + 1.25, n=2)), (0.02, _arch_outline(0, 0.32, z, z + 0.85, z + 1.25, n=2))], dark)
            o.matrix_basis = Matrix.Translation((mx + math.cos(a) * r_, my + math.sin(a) * r_, 0)) @ Matrix.Rotation(a + math.pi / 2, 4, "Z")
    # pinnacle at the other front corner keeps the facade balanced without a second minaret
    px, py = -9.55, -7.65
    k.loft([{"c": (px, py, 5.5), "rx": 0.3, "ry": 0.3}, {"c": (px, py, 7.1), "rx": 0.24, "ry": 0.24}, {"c": (px, py, 7.25), "rx": 0.34, "ry": 0.34}, {"c": (px, py, 7.32), "rx": 0.34, "ry": 0.34}, {"c": (px, py, 7.85), "rx": 0.2, "ry": 0.2}, {"c": (px, py, 8.25), "rx": 0.03, "ry": 0.03}], white2, seg=8)
    # steps railing
    for sx in (-1, 1):
        k.rod((sx * 4.75, FY - 1.6, 0.7), (sx * 4.75, FY - 0.3, 1.2), 0.03, rail, seg=5)
        k.rod((sx * 4.75, FY - 1.55, 0.05), (sx * 4.75, FY - 1.55, 0.7), 0.025, rail, seg=5)
        k.rod((sx * 4.75, FY - 0.32, 0.5), (sx * 4.75, FY - 0.32, 1.2), 0.025, rail, seg=5)

    k.preview((14.0, -36.0, 2.0), (0, 0, 8.5), 34, "front")
    k.preview((-26.0, -28.0, 12.0), (0, 0, 8.5), 34, "corner")
    k.preview((3.2, -13.5, 1.6), (0.5, -6.0, 3.0), 28, "arcade")
    k.preview((26.0, 26.0, 8.0), (0, 0, 8.0), 34, "back")
    k.finish(size=2048, normal=2048, rm=1024, ao=1024, samples=10, ao_dist=1.5, ao_strength=0.75, angle=45.0, margin=0.002, packed=True)
    k.export(quality=84)
    k.run_previews(size=(720, 540))


@asset("footbridge", "landmarks")
def build_footbridge():
    k = Kit("footbridge", "landmarks")
    paint = painted("fb_paint", rgb("#3c6f70"), under=rgb("#5d4630"), wear=0.4, fade=0.5, dirt=0.4, rust=0.6, rough=0.5, metallic=0.25, drip=1.0, bevel=0.0, scale=1.6)
    paint2 = painted("fb_paint2", rgb("#2f5d60"), under=rgb("#5d4630"), wear=0.4, fade=0.45, dirt=0.4, rust=0.55, rough=0.5, metallic=0.25, drip=0.9, bevel=0.0, scale=1.6)
    mesh_m = steel("fb_mesh", rgb("#7b7f7d"), rust=0.6, metallic=0.5, drip=0.6, wear=0.2)
    rail = steel("fb_rail", rgb("#8a8c88"), rust=0.4, metallic=0.55, drip=0.3, wear=0.3)
    deck = bo.pbr("fb_deck", rgb("#6f6d66"), 0.6, 0.4)
    g = G(deck)
    tread_lines = g.line(g.x, 0.08, 0.008)
    col = g.mix(rgb("#6f6d66"), rgb("#4c4a44"), g.smooth(g.noise(scale=2.0, detail=5.0), 0.4, 0.7))
    col = g.mix(col, rgb("#7c5a39"), g.mul(g.smooth(g.noise(scale=5.0, detail=6.0), 0.55, 0.68), 0.6))
    g.color(g.mix(col, rgb("#2e2c28"), g.mul(tread_lines, 0.5)))
    g.rough(0.6)
    g.surface(g.mul(tread_lines, -1.0), strength=0.5, distance=0.006)
    conc = concrete("fb_conc", c1=rgb("#a89f8d"), c2=rgb("#81786a"), seam_h=1.2, seam_w=1.5, drip=0.7, grime=1.0, grime_h=1.2, dust=0.5, posters=1.0, bevel=0.03)
    step_m = concrete("fb_step", c1=rgb("#8d8778"), c2=rgb("#6c6759"), seam_h=0, drip=0.1, grime=0.3, dust=0.6, bevel=0.012)
    blank = painted("fb_blank", rgb("#d9d6c9"), wear=0.2, fade=0.1, dirt=0.2, rust=0.3, drip=1.0, rough=0.5, bevel=0.003)
    cable = flat("fb_cable", rgb("#121110"), rough=0.5)

    H = 6.0  # deck top
    half = 13.2
    bay = 2 * half / 10
    # side truss bay template on the -Y side at the far -X end
    mats = [Matrix.Translation((bay * i, 0, 0)) for i in range(1, 10)]
    mats += [Matrix.Translation((bay * i, 0, 0)) @ _mirror_y() for i in range(0, 10)]
    k.begin_instances(mats, "truss")
    y = -1.45
    x0 = -half
    x1 = x0 + bay
    tz = H + 2.15
    # bottom chord, top chord, end post, diagonal, handrail
    k.box((bay, 0.16, 0.24), ((x0 + x1) / 2, y, H - 0.14), paint)
    k.box((bay, 0.12, 0.14), ((x0 + x1) / 2, y, tz), paint)
    k.box((0.14, 0.14, tz - H + 0.2), (x0, y, (tz + H) / 2 - 0.1), paint2)
    k.rod((x0 + 0.05, y, H), (x1 - 0.05, y, tz - 0.04), 0.05, paint2, seg=4)
    k.box((bay, 0.05, 0.05), ((x0 + x1) / 2, y + 0.05, H + 1.08), rail)
    k.box((bay, 0.05, 0.03), ((x0 + x1) / 2, y + 0.03, H + 0.2), rail)
    # mesh infill: thin square bars, floor to top chord
    items = []
    for i in range(1, 12):
        xb = x0 + i * bay / 12
        items.append(((0.012, 0.012, tz - H), (xb, y, (tz + H) / 2)))
    for z in (H + 0.5, H + 1.6):
        items.append(((bay, 0.012, 0.012), ((x0 + x1) / 2, y, z)))
    k.boxes(items, mesh_m)
    k.end_instances()
    # the far end post closes each truss
    for sy in (-1, 1):
        k.box((0.14, 0.14, tz - H + 0.2), (half, sy * 1.45, (tz + H) / 2 - 0.1), paint2)

    # deck bay template: tread plate and cross girder
    k.begin_instances([Matrix.Translation((bay * i, 0, 0)) for i in range(1, 10)], "deck")
    k.box((bay, 2.8, 0.05), (x0 + bay / 2, 0, H - 0.025), deck, w=0.8)
    k.box((0.14, 2.9, 0.26), (x0 + bay / 2, 0, H - 0.2), paint)
    # top lacing across the walkway
    k.box((0.07, 2.9, 0.07), (x0, 0, tz), paint2)
    k.end_instances()
    k.box((0.07, 2.9, 0.07), (half, 0, tz), paint2)
    # services and a sagging cable bundle under the deck
    for j in range(4):
        xa = -half + j * 2 * half / 4
        xb = xa + 2 * half / 4
        k.rod((xa, 0.9, H - 0.42), (xb, 0.9, H - 0.42), 0.03, cable, seg=4, w=0.4)
        k.rod((xa, 0.82, H - 0.4), (xb, 0.82, H - 0.4), 0.018, cable, seg=4, w=0.4)

    # sign board on the -Y truss, blank, for a runtime Bangla sign
    k.box((7.4, 0.08, 1.5), (0, -1.6, H + 1.1), blank, bevel=0.01)
    k.box((7.6, 0.1, 0.09), (0, -1.6, H + 1.88), paint2)
    k.box((7.6, 0.1, 0.09), (0, -1.6, H + 0.32), paint2)
    for x_ in (-3.8, 3.8):
        k.box((0.09, 0.1, 1.65), (x_, -1.6, H + 1.1), paint2)
    k.empty("sign_1", (0, -1.66, H + 1.1))

    # end towers, stair flights: one template rotated to the opposite end
    rot180 = Matrix.Rotation(math.pi, 4, "Z")
    k.begin_instances([rot180], "end")
    # column frame carrying the bridge end, on concrete feet
    cols_x = half + 0.05
    for yc in (-1.3, 1.3):
        k.box((0.9, 0.9, 0.7), (cols_x, yc, 0.35), conc, bevel=0.03)
        k.loft([{"c": (cols_x, yc, 0.68), "rx": 0.2, "ry": 0.2}, {"c": (cols_x, yc, H - 0.3), "rx": 0.16, "ry": 0.16}], paint2, seg=10)
    k.box((0.3, 3.1, 0.34), (cols_x, 0, H - 0.34), paint, bevel=0.01)
    k.rod((cols_x, -1.3, 2.4), (cols_x, 1.3, 4.9), 0.04, paint2, seg=5)
    k.rod((cols_x, 1.3, 2.4), (cols_x, -1.3, 4.9), 0.04, paint2, seg=5)
    # landing at deck level, then two flights running +Y along the footpath
    lx0, lx1 = half, half + 2.2
    k.box((lx1 - lx0, 3.0, 0.1), ((lx0 + lx1) / 2, 0.1, H - 0.05), deck)
    k.box((lx1 - lx0 + 0.1, 0.14, 0.24), ((lx0 + lx1) / 2, -1.45, H - 0.14), paint)
    k.box((0.14, 3.1, 0.24), (lx1, 0.1, H - 0.14), paint)
    steps = 18
    run = 0.29
    rise = (H / 2) / steps
    ys = 1.6

    def flight(y0, z_top):
        pts = [(y0, z_top)]
        for i in range(steps):
            y_ = y0 + i * run
            z_ = z_top - i * rise
            pts.append((y_, z_ - rise))
            pts.append((y_ + run, z_ - rise))
        endy = y0 + steps * run
        endz = z_top - steps * rise
        pts += [(endy, endz - 0.26), (y0 + 0.2, z_top - 0.42), (y0, z_top - 0.26)]
        k.prism_x(pts, lx0 + 0.05, lx1 - 0.05, step_m, caps=False)
        # steel stringers and posts with mesh
        for x_ in (lx0 + 0.02, lx1 - 0.02):
            sec = [(y0, z_top - 0.02), (endy, endz - 0.02), (endy, endz - 0.28), (y0, z_top - 0.28)]
            k.prism_x(sec, x_ - 0.05, x_ + 0.05, paint)
            for t in range(4):
                f = t / 3
                py_, pz_ = y0 + f * (endy - y0), z_top + f * (endz - z_top)
                k.box((0.05, 0.05, 1.12), (x_, py_, pz_ + 0.56), paint2)
            k.tube([(x_, y0, z_top + 1.1), (x_, endy, endz + 1.1)], 0.024, rail, seg=5)
            k.tube([(x_, y0, z_top + 0.58), (x_, endy, endz + 0.58)], 0.012, rail, seg=4)
        return endy, endz
    y1, z1 = flight(ys, H)
    # half landing with its own legs
    k.box((lx1 - lx0, 1.4, 0.14), ((lx0 + lx1) / 2, y1 + 0.7, z1 - 0.07), deck)
    k.box((lx1 - lx0 + 0.1, 0.12, 0.26), ((lx0 + lx1) / 2, y1 + 1.4, z1 - 0.2), paint)
    for x_ in (lx0 + 0.1, lx1 - 0.1):
        k.loft([{"c": (x_, y1 + 0.7, 0.0), "rx": 0.11, "ry": 0.11}, {"c": (x_, y1 + 0.7, z1 - 0.1), "rx": 0.09, "ry": 0.09}], paint2, seg=8)
        k.box((0.5, 0.5, 0.2), (x_, y1 + 0.7, 0.1), conc, bevel=0.015)
    y2, z2 = flight(y1 + 1.4, z1)
    k.box((lx1 - lx0 + 0.5, 0.6, 0.12), ((lx0 + lx1) / 2, y2 + 0.2, 0.06), conc, bevel=0.012)
    for x_ in (lx0 + 0.1, lx1 - 0.1):
        k.tube([(x_, ys + 0.3, H - 0.2), (x_, ys + 0.5, 0.2)], 0.06, paint2, seg=6)
    k.end_instances()

    k.preview((19.0, -21.0, 1.7), (0, 0, 5.4), 30, "street")
    k.preview((0.5, -22.0, 1.7), (0, 0, 6.4), 42, "front")
    k.preview((16.5, -4.0, 1.7), (14.2, 4.0, 3.5), 34, "stairs")
    k.preview((3.0, 0.0, 7.6), (-8.0, 0.0, 7.0), 30, "deck")
    k.finish(size=2048, normal=1024, rm=512, ao=1024, samples=10, ao_dist=1.0, ao_strength=0.7, angle=50.0, margin=0.002, packed=True)
    k.export(quality=84)
    k.run_previews(size=(720, 480))


@asset("golchattar", "landmarks")
def build_golchattar():
    """Round island 14 m across. A metro pier stands in the middle: the central well is open out to r=1.6."""
    k = Kit("golchattar", "landmarks")
    rng = random.Random(10)
    kerb = bo.pbr("gc_kerb", rgb("#d6d3c6"), 0.75)
    g = G(kerb)
    _, _, nz = g.normal_xyz()
    ang = g.m("ARCTAN2", g.y, g.x)
    blocks = g.gt(g.fract(g.mul(g.add(ang, math.pi), 36.0 / (2 * math.pi))), 0.5)
    col = g.mix(rgb("#d7d3c5"), rgb("#2a2826"), blocks)
    col = g.mix(col, rgb("#8c8473"), g.mul(g.smooth(g.noise(scale=3.0, detail=6.0), 0.42, 0.66), 0.65))
    col = g.mix(col, rgb("#3f382d"), g.mul(g.smooth(g.z, 0.26, 0.0), 0.75))
    g.color(col)
    g.rough(0.75)
    g.surface(g.mul(g.noise(scale=22.0, detail=5.0), 0.5), strength=0.5, distance=0.02, bevel=0.02)
    soil = bo.pbr("gc_soil", rgb("#4a3a28"), 0.9)
    g = G(soil)
    grass = g.smooth(g.noise(scale=3.0, detail=6.0, rough=0.62), 0.32, 0.55)
    col = g.mix(rgb("#4c3b28"), g.mix(rgb("#4f7230"), rgb("#6b8a3a"), g.smooth(g.noise(scale=28.0, detail=4.0), 0.4, 0.62)), grass)
    g.color(col)
    g.rough(0.92)
    g.surface(g.noise(scale=40.0, detail=4.0), strength=0.8, distance=0.03)
    marigold = flower_bed("gc_marigold", [rgb("#ef9a1a"), rgb("#f4b91f"), rgb("#e77a12")], rgb("#3f6f2a"), density=44.0, leaf_share=0.28)
    salvia = flower_bed("gc_salvia", [rgb("#c8231e"), rgb("#e03a2a"), rgb("#a81c2e")], rgb("#2f5c26"), density=48.0, leaf_share=0.32)
    white_f = flower_bed("gc_white", [rgb("#efeadc"), rgb("#f0d9e0"), rgb("#ead67a")], rgb("#3a6a2c"), density=52.0, leaf_share=0.4)
    hedge = flower_bed("gc_hedge", [rgb("#3f7a30"), rgb("#4f8a36"), rgb("#2f6428")], rgb("#2a5525"), density=60.0, leaf_share=0.2)
    stone = concrete("gc_stone", c1=rgb("#c8c2b1"), c2=rgb("#a6a091"), seam_h=0.0, drip=0.7, grime=0.7, grime_h=0.9, dust=0.6, moss=0.35, bevel=0.012, mottled=0.7)
    stone_t = concrete("gc_stone_t", c1=rgb("#a9c3ad"), c2=rgb("#8fae97"), seam_h=0.0, drip=0.5, grime=0.2, dust=0.5, bevel=0.01, mottled=0.7)
    rail_m = painted("gc_rail", rgb("#2d6b4f"), under=rgb("#5d4630"), wear=0.35, fade=0.45, dirt=0.3, rust=0.5, rough=0.45, metallic=0.2, drip=0.4, bevel=0.0, scale=2.0)
    post_m = painted("gc_post", rgb("#e3e0d3"), under=rgb("#5d4630"), wear=0.4, fade=0.1, dirt=0.3, rust=0.4, rough=0.45, metallic=0.2, drip=0.4, bevel=0.0, scale=2.0)

    # kerb, planting bed, flower rings
    k.lathe([(7.0, 0.0), (7.0, 0.3), (6.95, 0.34), (6.62, 0.34), (6.58, 0.28)], kerb, seg=72, chunks=9, w=1.0)

    def bed_wob(a, i, r, z):
        return r, z + 0.018 * math.sin(a * 13.0 + r * 3.0) + 0.012 * math.sin(a * 37.0)
    k.lathe([(6.6, 0.29), (6.05, 0.44), (5.1, 0.5), (4.3, 0.52), (3.5, 0.55), (3.05, 0.56)], soil, seg=56, chunks=7, w=0.8, wobble=bed_wob)

    def mound(rc, wd, h, mat, seg=64, seedv=1.0, chunks=8):
        def wob(a, i, r, z):
            lump = 0.5 + 0.5 * math.sin(a * 21.0 + seedv) * math.sin(a * 7.0 + seedv * 2.0)
            return r + 0.03 * math.sin(a * 17.0 + seedv), z + (0.03 + 0.05 * lump) * (1 if 0 < i < 4 else 0)
        z0 = 0.5
        prof = [(rc + wd, z0 - 0.03), (rc + wd * 0.75, z0 + h * 0.65), (rc + wd * 0.25, z0 + h), (rc - wd * 0.25, z0 + h), (rc - wd * 0.75, z0 + h * 0.65), (rc - wd, z0 - 0.03)]
        k.lathe(prof, mat, seg=seg, chunks=chunks, w=0.9, wobble=wob)
    mound(5.75, 0.36, 0.18, marigold, 64, 0.3)
    mound(4.95, 0.3, 0.3, hedge, 56, 1.9)
    mound(4.2, 0.34, 0.2, salvia, 56, 3.1)
    mound(3.42, 0.25, 0.16, white_f, 44, 4.2, chunks=6)
    # eight clipped balls set into the hedge line
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        k.sphere(0.36, (math.cos(a) * 4.95, math.sin(a) * 4.95, 0.86), hedge, seg=8, rings=5, scale=(1, 1, 0.9), w=0.6)

    # low railing: one bay rotated all the way round, sharing texels
    n = 32
    mats = [Matrix.Rotation(2 * math.pi * i / n, 4, "Z") for i in range(1, n)]
    k.begin_instances(mats, "rail")
    r = 6.32
    a0, a1 = 0.0, 2 * math.pi / n
    p0 = (r * math.cos(a0), r * math.sin(a0))
    p1 = (r * math.cos(a1), r * math.sin(a1))
    k.box((0.07, 0.07, 0.62), (p0[0], p0[1], 0.62), post_m)
    k.sphere(0.05, (p0[0], p0[1], 0.95), post_m, seg=6, rings=3)
    k.rod((p0[0], p0[1], 0.84), (p1[0], p1[1], 0.84), 0.02, rail_m, seg=4)
    k.rod((p0[0], p0[1], 0.56), (p1[0], p1[1], 0.56), 0.014, rail_m, seg=4)
    for t in (0.33, 0.66):
        x_, y_ = p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t
        k.rod((x_, y_, 0.56), (x_, y_, 0.84), 0.008, rail_m, seg=3)
    k.end_instances()

    # stepped round monument base with an open well for the metro pier
    well = 1.6
    prof = [(3.05, 0.42), (3.05, 0.76), (3.0, 0.8), (2.62, 0.8), (2.62, 1.12), (2.57, 1.16), (2.2, 1.16), (2.2, 1.48), (2.15, 1.52), (1.78, 1.52), (1.74, 1.46), (well, 1.46), (well, 0.0)]
    k.lathe(prof, stone, seg=48, chunks=6, w=1.0)
    # thin green inlay rings on the steps
    k.lathe([(2.87, 0.8), (2.87, 0.81), (2.72, 0.81), (2.72, 0.8)], stone_t, seg=48, chunks=4, w=0.6)
    k.lathe([(2.42, 1.16), (2.42, 1.17), (2.3, 1.17), (2.3, 1.16)], stone_t, seg=48, chunks=4, w=0.6)
    # eight small bollards round the upper step, plain
    for i in range(8):
        a = 2 * math.pi * i / 8
        x_, y_ = math.cos(a) * 2.42, math.sin(a) * 2.42
        k.loft([{"c": (x_, y_, 1.16), "rx": 0.09, "ry": 0.09}, {"c": (x_, y_, 1.48), "rx": 0.075, "ry": 0.075}, {"c": (x_, y_, 1.56), "rx": 0.03, "ry": 0.03}], stone, seg=8, w=0.5)

    k.preview((15.0, -22.0, 2.0), (0, 0, 0.8), 34, "street")
    k.preview((-11.0, -11.0, 12.0), (0, 0, 0.4), 34, "above")
    k.preview((3.5, -7.8, 1.5), (0, 0, 0.9), 30, "close")
    k.finish(size=2048, normal=1024, rm=512, ao=1024, samples=10, ao_dist=0.6, ao_strength=0.7, angle=50.0, margin=0.002, packed=True)
    k.export(quality=84)
    k.run_previews(size=(720, 480))


@asset("metro_train", "landmarks")
def build_metro_train():
    """One intermediate car: 22 m over the gangways, origin at rail level on the car centre, length along Y."""
    _metro_car("metro_train", cab=False)


@asset("metro_train_cab", "landmarks")
def build_metro_train_cab():
    """Same car with a driving nose on the -Y end, for the head and (turned 180 degrees) the tail of a train."""
    _metro_car("metro_train_cab", cab=True)


def _metro_car(asset_id, cab):
    k = Kit(asset_id, "landmarks")
    body_m = bo.pbr("mt_body", rgb("#e6e6e0"), 0.32, 0.1)
    g = G(body_m)
    z_ = g.z
    col = g.mix(rgb("#ecebe5"), rgb("#d4d3cc"), g.smooth(g.noise(scale=0.7, detail=4.0), 0.36, 0.68))
    green_band = g.mul(g.smooth(z_, 1.2, 1.205), g.smooth(z_, 1.52, 1.515))
    red_band = g.mul(g.smooth(z_, 1.52, 1.525), g.smooth(z_, 1.68, 1.675))
    col = g.mix(col, rgb("#0f7a4a"), green_band)
    col = g.mix(col, rgb("#d01f2b"), red_band)
    # thin pinstripes at cantrail height
    col = g.mix(col, rgb("#0f7a4a"), g.mul(g.smooth(z_, 2.92, 2.925), g.smooth(z_, 3.0, 2.995)))
    streak = g.smooth(g.noise(vec=g.vscale((8.0, 8.0, 0.8)), scale=1.0, detail=4.0), 0.54, 0.72)
    col = g.mix(col, rgb("#6d6a60"), g.mul(streak, 0.3))
    # roof and skirt pick up brake dust and grime
    col = g.mix(col, rgb("#5c5a52"), g.mul(g.smooth(z_, 1.15, 0.95), 0.7))
    col = g.mix(col, rgb("#8d8a80"), g.mul(g.smooth(z_, 3.2, 3.5), 0.65))
    g.color(col)
    g.rough(0.34)
    g.surface(None, bevel=0.012)
    glass = glass_opaque("mt_glass", rgb("#1d2c33"), rough=0.06, dirt=0.15)
    door_m = painted("mt_door", rgb("#d8d7cf"), wear=0.1, fade=0.1, dirt=0.3, rust=0.0, drip=0.7, rough=0.34, bevel=0.006)
    seam = flat("mt_seam", rgb("#191918"), rough=0.5)
    dark = painted("mt_dark", rgb("#2c2e30"), wear=0.15, rust=0.05, rough=0.55, metallic=0.2, drip=0.4, bevel=0.012)
    bogie_m = painted("mt_bogie", rgb("#25272a"), under=rgb("#5d4630"), wear=0.25, fade=0.1, dirt=0.5, rust=0.25, rough=0.6, metallic=0.3, drip=0.4, bevel=0.01)
    wheel_m = steel("mt_wheel", rgb("#54504a"), rust=0.4, rough=0.42, metallic=0.75, drip=0.0, wear=0.0)
    roof_box = painted("mt_roofbox", rgb("#c6c6bf"), wear=0.1, fade=0.15, dirt=0.4, rust=0.05, drip=0.8, rough=0.48, bevel=0.012)
    vent = bo.pbr("mt_vent", rgb("#8d8e88"), 0.5)
    g = G(vent)
    f = g.smooth(g.fract(g.div(g.y, 0.06)), 0.4, 0.55)
    g.color(g.mix(rgb("#a6a6a0"), rgb("#242422"), f))
    g.rough(0.5)
    g.surface(f, strength=0.8, distance=0.012)
    rubber = bo.pbr("mt_rubber", rgb("#181818"), 0.8)
    g = G(rubber)
    g.color(g.mix(rgb("#1c1c1b"), rgb("#0c0c0c"), g.smooth(g.fract(g.div(g.y, 0.05)), 0.4, 0.6)))
    g.surface(g.smooth(g.fract(g.div(g.y, 0.05)), 0.4, 0.6), strength=1.0, distance=0.02)
    band_tail = flat("mt_tail", rgb("#8c1a18"), rough=0.3)
    pg_steel = steel("pg_steel", rgb("#55595a"), rust=0.1, metallic=0.5, drip=0.0, wear=0.05)
    pg_head = flat("pg_head", rgb("#2d2c2a"), rough=0.5)
    pg_ins = plastic("pg_ins", rgb("#7c3a1e"), rough=0.3, scuff=0.15, dirt=0.0)

    half = 10.84
    # body shell: slight tumblehome, softly rounded cantrail and roof
    right = [(1.3, 0.98), (1.42, 1.02), (1.45, 1.3), (1.45, 2.2), (1.42, 2.92), (1.3, 3.22), (1.0, 3.42), (0.55, 3.53), (0.0, 3.57)]
    sec = [(0.0, 0.98)] + right[:] + [(-x, z) for x, z in reversed(right[:-1])]
    tail_y = -10.0 if cab else -half
    k.prism(sec, tail_y, half, body_m, chunks=4, w=1.0)
    if cab:
        # the nose: the same section drawn in as it runs forward, ending in a raked face
        def drawn(fx, top, low):
            return [(x * fx, low + (z - 0.98) * (top - low) / (3.57 - 0.98)) for x, z in sec]
        k.section_loft([(-10.0, sec), (-10.55, drawn(0.985, 3.5, 0.98)), (-10.85, drawn(0.93, 3.3, 1.0)), (-11.0, drawn(0.82, 3.05, 1.06))], body_m, w=1.0, cap0=False, smooth=False)
        k.box((1.9, 0.05, 1.05), (0, -10.95, 2.4), glass, rot=(math.radians(-14), 0, 0), w=0.9)
        k.box((0.05, 0.07, 1.05), (0, -10.97, 2.4), seam, rot=(math.radians(-14), 0, 0), w=0.3)
        k.box((1.5, 0.04, 0.2), (0, -10.9, 3.03), seam, rot=(math.radians(-14), 0, 0), w=0.4)
        lamp_m = flat("mt_lamp", rgb("#efe9d6"), rough=0.2)
        for sx in (-1, 1):
            k.box((0.34, 0.03, 0.12), (sx * 0.8, -11.02, 1.32), lamp_m, w=0.3)
            k.box((0.14, 0.03, 0.08), (sx * 0.8, -11.02, 1.15), band_tail, w=0.3)
        k.box((2.1, 0.4, 0.34), (0, -10.8, 0.82), bogie_m, w=0.4)

    # door and window layout, one side template, mirrored across X
    doors = (-8.25, -2.75, 2.75, 8.25)
    windows = ((-7.3, -3.7), (-1.8, 1.8), (3.7, 7.3), (9.2, 10.3))
    if not cab:
        windows = ((-10.3, -9.2),) + windows
    k.begin_instances([_mirror_x()], "side")
    x = 1.455
    for y0, y1 in windows:
        k.box((0.012, y1 - y0, 1.0), (x, (y0 + y1) / 2, 2.25), glass, bevel=0.0, w=0.9)
        k.box((0.008, y1 - y0 + 0.08, 0.05), (x, (y0 + y1) / 2, 1.73), seam, w=0.3)
        k.box((0.008, y1 - y0 + 0.08, 0.05), (x, (y0 + y1) / 2, 2.77), seam, w=0.3)
        for m in range(1, int((y1 - y0) // 1.8) + 1):
            k.box((0.016, 0.05, 1.0), (x + 0.002, y0 + m * (y1 - y0) / (int((y1 - y0) // 1.8) + 1), 2.25), seam, w=0.2)
    for yc in doors:
        # double-leaf door with a tall window in each leaf and a dark centre seam
        for sd in (-1, 1):
            yl = yc + sd * 0.36
            k.box((0.014, 0.7, 2.04), (x, yl, 2.04), door_m, w=0.9)
            k.box((0.008, 0.48, 1.16), (x + 0.006, yl, 2.4), glass, w=0.6)
        k.box((0.02, 0.016, 2.06), (x, yc, 2.04), seam, w=0.2)
        k.box((0.016, 1.5, 0.04), (x, yc, 3.08), seam, w=0.2)
        k.box((0.016, 0.04, 2.08), (x, yc - 0.74, 2.04), seam, w=0.2)
        k.box((0.016, 0.04, 2.08), (x, yc + 0.74, 2.04), seam, w=0.2)
        k.box((0.05, 1.5, 0.04), (x + 0.02, yc, 3.12), dark, w=0.2)
    k.end_instances()

    # gangway bellows and end frame at both ends
    if not cab:
        k.begin_instances([_mirror_y()], "end")
    for y, rx, rz in ((half, 1.14, 1.32), (half + 0.075, 1.0, 1.2), (11.0, 1.1, 1.28)):
        k.loft([{"c": (0, y - 0.045, 2.07), "rx": rx, "ry": rz, "power": 6.0, "axis": "y"}, {"c": (0, y + 0.0, 2.07), "rx": rx, "ry": rz, "power": 6.0, "axis": "y"}], rubber, seg=14, w=0.3)
    # coupler
    k.box((0.2, 0.5, 0.2), (0, 10.75, 0.85), bogie_m, w=0.3)
    if not cab:
        k.end_instances()

    # roof: two air-conditioning units with vents and a central ribbed walkway
    k.begin_instances([_mirror_y()], "ac")
    ay = 6.3
    k.box((1.9, 3.2, 0.2), (0, ay, 3.6), roof_box, bevel=0.03, w=0.7)
    k.box((1.2, 2.5, 0.04), (0, ay, 3.71), vent, w=0.5)
    k.box((0.16, 2.8, 0.14), (0.85, ay, 3.56), vent, w=0.3)
    k.box((0.16, 2.8, 0.14), (-0.85, ay, 3.56), vent, w=0.3)
    k.end_instances()
    k.box((1.0, 3.8, 0.1), (0, 0.0, 3.56), roof_box, bevel=0.015, w=0.6)
    # underframe equipment, boxy and grimy
    for y0, y1, wd in ((-5.2, -3.2, 2.2), (-2.9, -0.8, 2.4), (-0.4, 1.8, 2.2), (2.2, 4.0, 2.3), (4.3, 5.2, 1.9)):
        k.box((wd, y1 - y0, 0.48), (0, (y0 + y1) / 2, 0.72), bogie_m, w=0.4)
    k.box((2.55, 21.2, 0.06), (0, 0, 0.965), dark, w=0.2)

    # bogie template, one instance per truck
    k.begin_instances([_ty(14.8)], "bogie")
    by = -7.4
    k.box((2.0, 3.0, 0.22), (0, by, 0.62), bogie_m, w=0.6)
    k.box((2.5, 0.5, 0.26), (0, by, 0.7), bogie_m, w=0.6)
    k.box((1.4, 2.1, 0.2), (0, by, 0.87), dark, w=0.3)
    for sy in (-1, 1):
        for sx in (-1, 1):
            k.cyl(0.43, 0.13, (sx * 0.72, by + sy * 1.15, 0.43), wheel_m, seg=14, rot=(0, math.pi / 2, 0), w=0.6)
        k.rod((-0.8, by + sy * 1.15, 0.43), (0.8, by + sy * 1.15, 0.43), 0.08, wheel_m, seg=6, w=0.3)
    for sx in (-1, 1):
        k.cyl(0.22, 0.24, (sx * 0.95, by, 0.92), dark, seg=8, w=0.3)
        k.box((0.14, 2.8, 0.14), (sx * 0.95, by, 0.65), bogie_m, w=0.3)
        k.box((0.2, 0.5, 0.3), (sx * 1.0, by, 0.42), bogie_m, w=0.3)
    k.end_instances()

    # raised pantograph as its own node `pantograph`: reaches the contact wire at +4.25 m
    # hide it on most cars in a train
    base_z = 3.57
    head_z = 4.25
    k.box((1.3, 0.9, 0.08), (0, 0.0, base_z + 0.1), pg_steel)
    for sx in (-0.5, 0.5):
        for sy in (-0.35, 0.35):
            k.cyl(0.05, 0.14, (sx, sy, base_z + 0.02), pg_ins, seg=6)
    # scissor arms: lower arm rises away, upper arm folds back to the head
    knee = (0.0, 0.42, base_z + 0.42)
    for sx in (-0.22, 0.22):
        k.rod((sx, -0.25, base_z + 0.14), (sx * 0.8, knee[1], knee[2]), 0.025, pg_steel, seg=4)
        k.rod((sx * 0.8, knee[1], knee[2]), (sx * 0.5, 0.0, head_z - 0.08), 0.018, pg_steel, seg=4)
    k.box((1.5, 0.05, 0.03), (0, 0.0, head_z - 0.015), pg_head)
    k.box((0.6, 0.12, 0.04), (0, 0.0, head_z - 0.06), pg_steel)
    for sx in (-1, 1):
        k.rod((sx * 0.75, 0.0, head_z - 0.015), (sx * 0.93, 0.0, head_z - 0.12), 0.012, pg_steel, seg=3)

    k.preview((11.0, -24.0, 2.6), (0, 0, 1.9), 28, "side")
    k.preview((7.0, 2.0, 7.5), (0, 0, 3.2), 26, "roof")
    k.preview((3.5, -8.0, 0.5), (0.6, -6.0, 1.0), 34, "bogie")
    k.finish(size=2048, normal=1024, rm=512, ao=1024, samples=10, ao_dist=0.5, ao_strength=0.7, angle=48.0, margin=0.002, packed=True, split={"pg_": "pantograph"})
    k.export(quality=84)
    k.run_previews(size=(720, 480))


# ---------------------------------------------------------------------------
# Pavement hawkers, building-site clutter and overhead wires
# ---------------------------------------------------------------------------
def rusty_tin(name, base, rust=0.6, fade=0.4, rough=0.62, metallic=0.2, drip=0.7, mud=0.6):
    """Old corrugated iron: bleached paint or zinc, rust continents, streaks down the ribs, mud at the foot."""
    mat = bo.pbr(name, base, rough, metallic)
    g = G(mat)
    col = g.mix(base, lerp3(base, rgb("#cdc7b6"), 0.5), g.mulc(g.smooth(g.noise(scale=1.1, detail=5.0, rough=0.6), 0.34, 0.7), fade))
    col = g.mix(col, mul3(base, 0.72), g.mul(g.smooth(g.noise(scale=6.0, detail=5.0), 0.5, 0.72), 0.35))
    n = g.noise(scale=1.6, detail=7.0, rough=0.64, dist=0.25)
    edge = 0.62 - rust * 0.2
    patch = g.smooth(n, edge, edge + 0.04)
    halo = g.smooth(n, edge - 0.11, edge + 0.02)
    rust_c = g.ramp(g.noise(scale=22.0, detail=5.0), [(0.28, rgb("#35211a")), (0.48, rgb("#573423")), (0.66, rgb("#74482d")), (0.8, rgb("#8d5c39"))])
    col = g.mix(col, rgb("#6b4c36"), g.mul(halo, 0.55))
    col = g.mix(col, rust_c, patch)
    streak = g.smooth(g.noise(vec=g.vscale((10.0, 10.0, 0.45)), scale=1.0, detail=5.0), 0.5, 0.66)
    col = g.mix(col, rgb("#4d3022"), g.mulc(streak, rust * 0.75))
    if drip > 0:
        runs = g.smooth(g.noise(vec=g.vscale((5.0, 5.0, 0.35), (3.0, 1.0, 2.0)), scale=1.0, detail=4.0), 0.5, 0.68)
        col = g.mix(col, rgb("#3f3a31"), g.mulc(runs, drip * 0.6))
    if mud > 0:
        low = g.smooth(g.add(g.z, g.mul(g.noise(scale=7.0, detail=4.0), 0.25)), 0.55, 0.12)
        col = g.mix(col, rgb("#4f4436"), g.mulc(low, mud))
    g.color(col)
    g.metal(g.mul(g.sub(1.0, patch), metallic))
    g.rough(g.add(rough, g.mul(patch, 0.25)))
    g.surface(g.add(g.mul(patch, 0.5), g.mul(g.noise(scale=40.0, detail=3.0), 0.2)), strength=0.35, distance=0.004)
    return mat


def jute(name, color, dirt=0.5):
    """Coarse hessian: slubby crossing threads, sun-bleached folds, dark hand grime and damp stains."""
    mat = bo.pbr(name, color, 0.95)
    g = G(mat)
    a = g.noise(vec=g.vscale((2.0, 48.0, 48.0)), scale=1.0, detail=3.0)
    b = g.noise(vec=g.vscale((48.0, 2.0, 48.0)), scale=1.0, detail=3.0)
    c = g.noise(vec=g.vscale((48.0, 48.0, 2.0)), scale=1.0, detail=3.0)
    slub = g.maxi(g.maxi(a, b), c)
    col = g.mix(mul3(color, 0.62), color, g.smooth(slub, 0.44, 0.66))
    col = g.mix(col, lerp3(color, rgb("#d5c9ac"), 0.55), g.mul(g.smooth(g.noise(scale=1.6, detail=5.0, rough=0.6), 0.42, 0.72), 0.6))
    col = g.mix(col, rgb("#3f3324"), g.mul(g.smooth(g.noise(scale=3.2, detail=6.0, rough=0.62), 0.54, 0.72), dirt))
    col = g.mix(col, rgb("#4a3f30"), g.mulc(g.smooth(g.z, 0.34, 0.08), dirt))
    g.color(col)
    g.rough(0.95)
    g.surface(slub, strength=0.55, distance=0.012)
    return mat


def _brick_tones(g, f):
    return g.ramp(f, [(0.0, rgb("#4e2a1c")), (0.18, rgb("#7d3a22")), (0.5, rgb("#a54b2b")), (0.82, rgb("#bf6238")), (1.0, rgb("#c98a63"))])


def brick_stack(name, course=0.072, length=0.24):
    """A dry-stacked face of bricks: a tone per brick, dark gaps, cement dust, mud at the foot."""
    mat = bo.pbr(name, rgb("#a4492a"), 0.86)
    g = G(mat)
    u = _face_tangent_u(g)
    row = g.floor(g.div(g.z, course))
    ushift = g.add(u, g.mul(g.fract(g.mul(row, 0.5)), length))
    cell = g.floor(g.div(ushift, length))
    tone, _ = g.white(g.combine(cell, row, 0.0))
    col = _brick_tones(g, tone)
    col = g.mix(col, rgb("#6d3a24"), g.mul(g.smooth(g.noise(scale=30.0, detail=4.0), 0.5, 0.7), 0.35))
    lines = g.maxi(g.line(ushift, length, 0.007), g.line(g.z, course, 0.006))
    col = g.mix(col, rgb("#231510"), g.mul(lines, 0.85))
    col = g.mix(col, rgb("#b9ab90"), g.mul(g.smooth(g.noise(scale=2.4, detail=5.0), 0.5, 0.7), 0.35))
    col = g.mix(col, rgb("#54473a"), g.mulc(g.smooth(g.z, 0.28, 0.0), 0.75))
    g.color(col)
    g.rough(0.88)
    g.surface(g.add(g.mul(lines, -1.0), g.mul(g.noise(scale=40.0, detail=4.0), 0.3)), strength=0.7, distance=0.008)
    return mat


def brick_loose(name):
    """Individual bricks: tone blocks about one brick across, chips and cement dust."""
    mat = bo.pbr(name, rgb("#a4492a"), 0.86)
    g = G(mat)
    _, cell = g.voronoi(scale=5.0)
    col = _brick_tones(g, g.rgbf(cell))
    col = g.mix(col, rgb("#6d3a24"), g.mul(g.smooth(g.noise(scale=30.0, detail=4.0), 0.5, 0.7), 0.35))
    col = g.mix(col, rgb("#b9ab90"), g.mul(g.smooth(g.noise(scale=3.0, detail=5.0), 0.52, 0.72), 0.4))
    g.color(col)
    g.rough(0.88)
    g.surface(g.noise(scale=40.0, detail=4.0), strength=0.4, distance=0.006, bevel=0.006)
    return mat


def terracotta(name, color=None, salt=0.5, moss=0.25):
    """Unglazed clay pot: blotchy firing, white salts and a little moss."""
    color = color or rgb("#b4623a")
    mat = bo.pbr(name, color, 0.85)
    g = G(mat)
    col = g.mix(color, mul3(color, 0.72), g.smooth(g.noise(scale=9.0, detail=5.0), 0.38, 0.66))
    col = g.mix(col, rgb("#cfc6b2"), g.mulc(g.smooth(g.noise(scale=7.0, detail=6.0, rough=0.62), 0.5, 0.64), salt))
    col = g.mix(col, rgb("#39402a"), g.mulc(g.smooth(g.noise(scale=5.0, detail=6.0), 0.58, 0.7), moss))
    g.color(col)
    g.rough(0.88)
    g.surface(g.noise(scale=60.0, detail=3.0), strength=0.3, distance=0.004)
    return mat


def net_cloth(name, color=None, mesh=0.1):
    """Faded shade netting. Opaque: the open weave reads as a dark lattice at game distance."""
    color = color or rgb("#5d7d5a")
    mat = bo.pbr(name, color, 0.85)
    g = G(mat)
    faded = lerp3(color, rgb("#c9c8ad"), 0.55)
    col = g.mix(color, faded, g.mulc(g.smooth(g.noise(vec=g.vscale((1.4, 1.4, 0.35)), scale=1.0, detail=5.0, rough=0.6), 0.34, 0.68), 0.8))
    a = g.fract(g.div(g.add(g.x, g.z), mesh))
    b = g.fract(g.div(g.sub(g.x, g.z), mesh))
    d = g.mini(g.mini(a, g.sub(1.0, a)), g.mini(b, g.sub(1.0, b)))
    holes = g.smooth(d, 0.05, 0.16)
    col = g.mix(col, rgb("#2b382a"), g.mul(holes, 0.38))
    col = g.mix(col, rgb("#4a4436"), g.mul(g.smooth(g.noise(vec=g.vscale((5.0, 5.0, 0.5)), scale=1.0, detail=4.0), 0.5, 0.68), 0.45))
    g.color(col)
    g.rough(0.9)
    g.surface(g.mul(holes, -1.0), strength=0.5, distance=0.01)
    return mat


def paper(name, color, fade=0.4):
    """Thin coloured paper left out in the sun: bleached patches and soft creases."""
    mat = bo.pbr(name, color, 0.75)
    g = G(mat)
    col = g.mix(color, lerp3(color, rgb("#e8e0cc"), 0.5), g.mulc(g.smooth(g.noise(scale=3.0, detail=4.0), 0.36, 0.7), fade))
    col = g.mix(col, mul3(color, 0.7), g.mul(g.smooth(g.noise(scale=14.0, detail=4.0), 0.55, 0.72), 0.35))
    g.color(col)
    g.rough(0.7)
    g.surface(g.noise(scale=18.0, detail=3.0), strength=0.25, distance=0.004)
    return mat


def leafy(name, a, b, fleck=None, rough=0.5, stretch=None):
    """Opaque leaf colour. stretch=(x, y, z) pulls the blotches into bands (snake plant)."""
    mat = bo.pbr(name, a, rough)
    g = G(mat)
    vec = g.vscale(stretch) if stretch else None
    col = g.mix(a, b, g.smooth(g.noise(scale=1.0 if stretch else 6.0, detail=3.0, vec=vec), 0.36, 0.64))
    if fleck is not None:
        col = g.mix(col, fleck, g.mul(g.smooth(g.noise(scale=24.0, detail=3.0), 0.58, 0.68), 0.7))
    g.color(col)
    g.rough(rough)
    return mat


def shoe_leather(name, color, gloss=0.38, tiers=(0.504, 0.724)):
    """Cheap leather or rubber with dust, and a dark sole line at the height of each display tier."""
    sole = rgb("#17140f")
    mat = bo.pbr(name, color, gloss)
    g = G(mat)
    col = g.mix(color, mul3(color, 0.6), g.smooth(g.noise(scale=45.0, detail=4.0), 0.45, 0.68))
    col = g.mix(col, lerp3(color, rgb("#cfc4ad"), 0.4), g.mul(g.smooth(g.noise(scale=14.0, detail=4.0), 0.55, 0.72), 0.5))
    mask = None
    for t in tiers:
        band = g.mul(g.smooth(g.z, t + 0.018, t + 0.013), g.smooth(g.z, t - 0.02, t - 0.01))
        mask = band if mask is None else g.maxi(mask, band)
    g.color(g.mix(col, sole, mask))
    g.rough(g.add(gloss, g.mul(g.noise(scale=20.0, detail=3.0), 0.2)))
    return mat


def _corrugated(k, corner, s_dir, h_dir, width, height, mat, pitch=0.13, amp=0.012, n_per=4, nv=1, w=1.0, skew=0.0, curl=0.0, phase=0.0):
    """Corrugated sheet as a real thin surface. Ribs run along h_dir and repeat along s_dir.
    The face normal is s_dir x h_dir, so pick the pair that looks outward. skew slopes the far
    edge along the ribs (a wall under a sloping roof); curl peels the far corner away."""
    c = Vector(corner)
    s = Vector(s_dir).normalized()
    h = Vector(h_dir).normalized()
    n = s.cross(h).normalized()
    ribs = max(2, round(width / pitch))

    def fn(u, v):
        a = (u + 1) * 0.5
        b = (v + 1) * 0.5
        wave = math.sin(2 * math.pi * ribs * a + phase) * amp
        peel = curl * max(0.0, (a - 0.6) / 0.4) ** 2 * b * b
        return tuple(c + s * (a * width) + h * (b * (height + skew * (a - 0.5))) + n * (wave + peel))
    return k.grid(fn, ribs * n_per, nv, mat, w=w, chunks=1)


def _ring(k, x0, x1, y0, y1, z0, z1, mat, w=1.0):
    """Four outward-facing walls with no top or bottom: hidden caps would only waste texels."""
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return k._add(bo.new_mesh_object("p", verts, faces, smooth=False), mat, w)


def _sack(k, c, length, width, height, yaw, mat, rng, roll=0.0, pitch=0.0, seg=8):
    """A filled sack lying on its belly: pillow body, flat sewn ends, lumpy and flat underneath.
    Length runs along local X; c is the centre of the underside."""
    stations = [(-1.0, 0.92, 0.12), (-0.86, 1.0, 0.72), (-0.45, 1.05, 1.0), (0.4, 1.06, 1.02), (0.86, 1.0, 0.7), (1.0, 0.9, 0.12)]
    rings = [{"c": (t * length / 2, 0, 0), "rx": width / 2 * fy, "ry": height / 2 * fz, "axis": "x", "power": 3.0} for t, fy, fz in stations]
    o = k.loft(rings, mat, seg=seg)
    a, b = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    lift = 0.75 * height / 2
    for v in o.data.vertices:
        p = v.co
        if p.z < 0:
            p.z *= 0.75
        else:
            p.z += 0.016 * math.sin(p.x * 7.0 + a) + 0.012 * math.sin(p.y * 11.0 + b)
        p.y += 0.012 * math.sin(p.x * 5.0 + b)
        p.z += lift
    o.data.update()
    o.matrix_basis = Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(roll, 4, "X") @ Matrix.Rotation(pitch, 4, "Y")
    return o


def _wheel_yz(k, cx, cy, cz, radius, tyre_m, spoke_m, hub_m, spokes=8, ring_pts=18, tyre_r=0.022):
    """Bicycle-style wheel rolling along Y, axle on X. Returns its parts."""
    parts = []
    pts = []
    for i in range(ring_pts + 1):
        a = 2 * math.pi * i / ring_pts
        pts.append((cx, cy + math.cos(a) * radius, cz + math.sin(a) * radius))
    parts.append(k.tube(pts, tyre_r, tyre_m, seg=4))
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        parts.append(k.rod((cx, cy, cz), (cx, cy + math.cos(a) * radius, cz + math.sin(a) * radius), 0.005, spoke_m, seg=3, w=3.0))
    parts.append(k.cyl(0.035, 0.09, (cx, cy, cz), hub_m, seg=6, rot=(0, math.pi / 2, 0)))
    return parts


def _drape(k, cx, y, ztop, width, length, mat, rng, nu=5, nv=3, w=1.0, shoulder=0.0, taper=0.06):
    """Cloth hanging straight down from a rail, in the XZ plane, with soft vertical folds."""
    ph = rng.uniform(0, 6.28)
    sway = rng.uniform(-0.025, 0.025)

    def fn(u, v):
        t = 1.0 - (v + 1) * 0.5  # 0 at the top, 1 at the hem
        x = cx + u * width * 0.5 * (1.0 - taper * t) + sway * t * t
        yy = y + 0.03 * math.sin(u * 5.2 + ph) * (0.25 + t) + 0.018 * math.sin(u * 2.3 + ph * 2.0 + t * 3.0) * t
        z = ztop - shoulder * u * u - length * t - 0.012 * math.sin(u * 9.0 + ph) * t
        return (x, yy, z)
    return k.grid(fn, nu, nv, mat, w=w, chunks=1)


def _shirt(k, cx, y, ztop, mat, rng, hook_m, rail_z, width=0.44, length=0.7, sleeve=0.24, w=1.0):
    """Shirt on a hanger: body with sloping shoulders, two short sleeves and the hook. Returns its parts."""
    parts = [_drape(k, cx, y, ztop, width, length, mat, rng, nu=4, nv=3, w=w, shoulder=0.05, taper=0.05)]
    for sd in (-1, 1):
        def fn(u, v, sd=sd):
            t = 1.0 - (v + 1) * 0.5
            a = (u + 1) * 0.5
            x = cx + sd * (width * 0.5 - 0.012 + a * 0.12 + t * 0.045)
            z = ztop - 0.05 - a * 0.035 - t * sleeve * (1.0 - a * 0.1)
            return (x, y + 0.012 * t * sd, z)
        parts.append(k.grid(fn, 1, 2, mat, w=w, chunks=1))
    parts.append(k.rod((cx, y, ztop - 0.01), (cx, y, rail_z), 0.004, hook_m, seg=3))
    return parts


def _leaf(verts, faces, p0, d, side, ln, wd, droop=0.04):
    """One blade: two triangles bent along the midrib."""
    p0 = Vector(p0)
    d = Vector(d).normalized()
    side = Vector(side).normalized()
    p1 = p0 + d * ln * 0.5 + Vector((0, 0, 0.015))
    p2 = p0 + d * ln + Vector((0, 0, -droop))
    b = len(verts)
    verts += [tuple(p0), tuple(p1 - side * wd), tuple(p1 + side * wd), tuple(p2)]
    faces += [(b, b + 2, b + 1), (b + 1, b + 2, b + 3)]


def _bush(verts, faces, cx, cy, z, h, n, ln, wd, rng, spread=0.05, droop=0.04):
    """Spiral of blades around a stem, smaller towards the crown."""
    for i in range(n):
        a = i * 2.4 + rng.uniform(-0.2, 0.2)
        f = rng.uniform(0.2, 1.0)
        ca, sa = math.cos(a), math.sin(a)
        st = 0.01 + spread * f
        p0 = (cx + ca * st, cy + sa * st, z + h * f * 0.85)
        lf = ln * rng.uniform(0.75, 1.1) * (1.1 - 0.35 * f)
        _leaf(verts, faces, p0, (ca, sa, rng.uniform(0.1, 0.8)), (-sa, ca, 0), lf, wd * rng.uniform(0.85, 1.15), droop)


def _pot(k, x, y, z, r, h, mat, soil, seg=8):
    """Clay pot with a rim and a soil disc."""
    rings = [{"c": (x, y, z), "rx": r * 0.62, "ry": r * 0.62}, {"c": (x, y, z + h * 0.78), "rx": r * 0.94, "ry": r * 0.94},
             {"c": (x, y, z + h * 0.79), "rx": r, "ry": r}, {"c": (x, y, z + h), "rx": r * 0.98, "ry": r * 0.98}]
    k.loft(rings, mat, seg=seg, start=False, end=False)
    disc = [(x + math.cos(2 * math.pi * i / seg) * r * 0.95, y + math.sin(2 * math.pi * i / seg) * r * 0.95, z + h - 0.012) for i in range(seg)]
    k._add(bo.new_mesh_object("p", disc, [tuple(range(seg))], smooth=False), soil, 1.0)


def _tatter(k, x0, x1, ztop, length, y, mat, rng, nu=4, nv=5, w=1.0, holes=0.2):
    """A torn strip hanging from a rail: ragged edges and diagonal rips, with real gaps between the cells."""
    ph = rng.uniform(0, 6.28)
    cw, ch = (x1 - x0) / nu, length / nv
    verts = []
    for r in range(nv + 1):
        t = r / nv  # 0 at the top, which stays tied on
        loose = min(1.0, t * 2.5)
        for c in range(nu + 1):
            a = c / nu
            x = x0 + (x1 - x0) * a + rng.uniform(-0.38, 0.38) * cw * loose
            yy = y + 0.03 * math.sin(a * 7.0 + ph) * (0.3 + t) + 0.02 * math.sin(t * 5.0 + ph)
            z = ztop - 0.04 * math.sin(a * math.pi * 2.0) ** 2 - length * t + rng.uniform(-0.35, 0.35) * ch * loose
            verts.append((x, yy, z))
    faces = []
    for r in range(nv):
        for c in range(nu):
            gone = holes * (0.2 + 0.5 * r / nv)
            if c in (0, nu - 1):
                gone += holes * 0.5 * (r / nv)
            if r == nv - 1:
                gone += 0.3
            roll = rng.random()
            if roll < gone:
                continue
            a = r * (nu + 1) + c
            q = (a, a + nu + 1, a + nu + 2, a + 1)
            if roll < gone * 2.6:
                # a diagonal rip keeps one corner of the cell
                drop = rng.randrange(4)
                faces.append(tuple(q[(drop + i) % 4] for i in range(1, 4)))
            else:
                faces.append(q)
    used = sorted({i for f in faces for i in f})
    remap = {old: new for new, old in enumerate(used)}
    return k._add(bo.new_mesh_object("p", [verts[i] for i in used], [tuple(remap[i] for i in f) for f in faces], smooth=True), mat, w)


def _wire(k, pts, r, mat, seg=4, w=0.3, chunks=5):
    """Long thin cable with its own unwrap: one island per chunk, wrapped all the way round, so that
    even a wire a centimetre thick covers whole texels. Open ended and smooth all along."""
    P = [Vector(p) for p in pts]
    n = len(P)

    def fn(u, v):
        i = int(round((v + 1) * 0.5 * (n - 1)))
        d = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        ref = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        x = d.cross(ref).normalized()
        y = d.cross(x).normalized()
        a = (u + 1) * math.pi
        return tuple(P[i] + (x * math.cos(a) + y * math.sin(a)) * r)
    return k.grid(fn, seg, n - 1, mat, w=w, chunks=chunks)


def _coil_path(c, radius, turns, rng, tilt=0.5, n_per=10):
    """Path of a messy hanging loop of spare cable: wobbling turns, not a clean ring."""
    pts = []
    n = int(turns * n_per)
    ca, sa = math.cos(tilt), math.sin(tilt)
    for i in range(n + 1):
        a = 2 * math.pi * i / n_per + rng.random() * 0.2
        rr = radius * (0.82 + 0.24 * math.sin(i * 0.43) + rng.random() * 0.1)
        px, pz = math.cos(a) * rr, math.sin(a) * rr
        y = c[1] + rng.uniform(-0.03, 0.03) + i * 0.002
        pts.append((c[0] + px * ca, y + px * sa * 0.5, c[2] + pz))
    return pts


def _person_ref(x, y):
    """Plain 1.7 m capsule for judging scale. Added after export, so it only shows in previews."""
    o = bo.uv_sphere("scale_ref", 1.0, 12, 8, (x, y, 0.85), (0.2, 0.2, 0.85))
    bo.assign(o, bo.pbr("scale_ref", (0.82, 0.82, 0.82), 0.6))
    return o


def _finish_small(k, ao_dist=0.25, ao_strength=0.75, angle=75.0, cull=True, ground=True, ref=None):
    """Same texture sizes as the small street props, then export and optional previews."""
    obj = k.finish(size=512, normal=512, rm=256, ao=256, samples=10, ao_dist=ao_dist, ao_strength=ao_strength, angle=angle, cull=cull, packed=True, margin=0.006)
    lo = [min(v.co[i] for v in obj.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in obj.data.vertices) for i in range(3)]
    print(f"[props]   {k.id} bounds x {lo[0]:.3f}..{hi[0]:.3f}  y {lo[1]:.3f}..{hi[1]:.3f}  z {lo[2]:.3f}..{hi[2]:.3f}")
    k.export(quality=84)
    if ref is not None:
        _person_ref(*ref)
    k.run_previews(ground=ground)


@asset("van_cart")
def build_van_cart():
    """Dhaka's pedal van: bicycle front, flat wooden deck over two rear wheels, parked with jute sacks on.
    Front faces -Y; the front wheel is turned a little."""
    k = Kit("van_cart", "props")
    rng = random.Random(21)
    frame = painted("vc_frame", rgb("#2c6a86"), under=rgb("#5d4630"), wear=0.65, fade=0.65, dirt=0.5, rust=0.55, rough=0.5, metallic=0.2, bevel=0.0, drip=0.5, scale=2.0)
    iron = steel("vc_iron", rgb("#55534d"), rust=0.7, metallic=0.5, drip=0.3)
    deck = wood("vc_deck", rgb("#8a6b47"), axis="y", wear=0.6)
    tyre = flat("vc_tyre", rgb("#1b1a18"), rough=0.85)
    spoke = steel("vc_spoke", rgb("#7a7974"), rust=0.35, metallic=0.7, drip=0.0)
    seat = plastic("vc_seat", rgb("#2b2623"), rough=0.6, scuff=0.5, dirt=0.2)
    rope = flat("vc_rope", rgb("#7a6a4b"), rough=0.9)
    sacks = [jute("vc_sack", rgb("#a58b5c")), jute("vc_sack2", rgb("#8d7650"), dirt=0.6), jute("vc_sack3", rgb("#b39a6c"))]
    DZ, Y0, Y1, AX, R = 0.76, -0.175, 1.475, 0.8, 0.33
    C = R + 0.017  # axle height: the tyre rests on the ground
    midy = (Y0 + Y1) / 2
    # deck boards on three bearers, two long rails and a low lip
    for i in range(6):
        k.box((0.18, Y1 - Y0 - rng.uniform(0, 0.03), 0.03), (-0.475 + i * 0.19, midy, DZ - 0.015), deck)
    for y in (Y0 + 0.04, 0.65, Y1 - 0.04):
        k.box((1.16, 0.05, 0.04), (0, y, DZ - 0.05), iron)
    for sx in (-1, 1):
        k.box((0.05, Y1 - Y0, 0.05), (sx * 0.42, midy, DZ - 0.095), frame)
        k.box((0.025, Y1 - Y0, 0.07), (sx * 0.59, midy, DZ), frame)
        k.rod((sx * 0.42, AX - 0.13, DZ - 0.12), (sx * 0.42, AX, C), 0.012, frame, seg=4)
        k.rod((sx * 0.42, AX + 0.13, DZ - 0.12), (sx * 0.42, AX, C), 0.012, frame, seg=4)
    k.box((1.2, 0.025, 0.07), (0, Y1, DZ), frame)
    # rear wheels and axle
    k.rod((-0.55, AX, C), (0.55, AX, C), 0.014, iron, seg=4)
    for sx in (-1, 1):
        _wheel_yz(k, sx * 0.52, AX, C, R, tyre, spoke, iron)
    # bicycle front: seat tube, top tube, down tube, head tube, sub-frame back to the deck
    BB, ST, H1, H2, F = (0, -0.5, 0.36), (0, -0.38, 0.93), (0, -1.0, 0.96), (0, -1.03, 0.78), (0, -1.12, C)
    k.rod(BB, ST, 0.016, frame, seg=5)
    k.rod((0, -0.98, 0.92), (0, -0.39, 0.88), 0.016, frame, seg=5)
    k.rod((0, -1.02, 0.8), BB, 0.018, frame, seg=5)
    for sx in (-1, 1):
        k.rod((sx * 0.42, Y0, DZ - 0.095), BB, 0.014, frame, seg=4)
        k.rod((sx * 0.42, Y0, DZ - 0.095), (0, -0.4, 0.74), 0.014, frame, seg=4)
    k.rod(ST, (0, -0.37, 1.02), 0.012, iron, seg=4)
    k.loft([{"c": (0, -0.52, 1.035), "rx": 0.03, "ry": 0.02, "axis": "y"}, {"c": (0, -0.42, 1.04), "rx": 0.06, "ry": 0.03, "axis": "y"},
            {"c": (0, -0.3, 1.05), "rx": 0.115, "ry": 0.04, "axis": "y"}], seat, seg=6)
    # the parts that turn with the steering
    steer = _wheel_yz(k, 0, F[1], C, R, tyre, spoke, iron)
    steer.append(k.rod(H1, H2, 0.022, frame, seg=5))
    steer.append(k.box((0.11, 0.035, 0.03), (0, -1.04, 0.75), frame))
    for sx in (-1, 1):
        steer.append(k.rod((sx * 0.045, -1.04, 0.74), (sx * 0.045, F[1], C), 0.011, frame, seg=4))
    steer.append(k.rod(H1, (0, -0.985, 1.1), 0.013, iron, seg=4))
    steer.append(k.tube([(-0.29, -0.9, 1.12), (-0.2, -0.96, 1.12), (0, -0.985, 1.1), (0.2, -0.96, 1.12), (0.29, -0.9, 1.12)], 0.011, iron, seg=4))
    for sx in (-1, 1):
        steer.append(k.rod((sx * 0.2, -0.96, 1.12), (sx * 0.31, -0.885, 1.12), 0.017, tyre, seg=5))
    arc = [(0, F[1] + math.cos(math.radians(a)) * (R + 0.045), C + math.sin(math.radians(a)) * (R + 0.045)) for a in (25, 60, 95, 130, 165)]
    steer.append(k.tube(arc, 0.018, iron, seg=4))
    steer.append(k.rod((0, -1.04, 0.74), arc[2], 0.008, iron, seg=3))
    for o in steer:
        k.rotated(o, 0.3, (0, -1.03, 0))
    # chain drive and pedals
    k.cyl(0.085, 0.008, (0.06, BB[1], BB[2]), iron, seg=10, rot=(0, math.pi / 2, 0))
    k.cyl(0.05, 0.008, (0.06, AX, C), iron, seg=8, rot=(0, math.pi / 2, 0))
    k.rod((0.06, BB[1], BB[2] + 0.085), (0.06, AX, C + 0.05), 0.005, tyre, seg=3, w=2.0)
    k.rod((0.06, BB[1], BB[2] - 0.085), (0.06, AX, C - 0.05), 0.005, tyre, seg=3, w=2.0)
    for sx, dy, dz in ((1, 0.08, -0.14), (-1, -0.08, 0.14)):
        k.rod((sx * 0.07, BB[1], BB[2]), (sx * 0.09, BB[1] + dy, BB[2] + dz), 0.009, iron, seg=4)
        k.box((0.1, 0.07, 0.02), (sx * 0.15, BB[1] + dy, BB[2] + dz), tyre)
    # the load: jute sacks across the deck, roped down
    Z = DZ
    for i, y in enumerate((0.1, 0.62, 1.14)):
        _sack(k, (rng.uniform(-0.02, 0.02), y, Z), 1.04, 0.5, 0.26, rng.uniform(-0.05, 0.05), sacks[i], rng)
    for i, (y, yaw) in enumerate(((0.36, 0.09), (0.9, -0.07))):
        _sack(k, (rng.uniform(-0.04, 0.04), y, Z + 0.205), 1.0, 0.5, 0.26, yaw, sacks[(i + 1) % 3], rng)
    _sack(k, (0.03, 0.62, Z + 0.41), 0.96, 0.48, 0.25, 0.22, sacks[0], rng)
    for x in (-0.27, 0.3):
        # the rope lies over the load in soft spans, not around every step
        k.tube([(x, Y0 + 0.02, DZ + 0.03), (x, -0.1, DZ + 0.17), (x, 0.1, DZ + 0.25), (x, 0.3, DZ + 0.41), (x, 0.52, DZ + 0.625), (x, 0.72, DZ + 0.625),
                (x, 0.94, DZ + 0.41), (x, 1.14, DZ + 0.25), (x, 1.36, DZ + 0.17), (x, 1.46, DZ + 0.03)], 0.007, rope, seg=3, w=1.6)
    k.preview((2.4, -4.4, 1.9), (0, 0, 0.75), 34, "front")
    k.preview((-3.8, 1.6, 1.8), (0, 0.1, 0.75), 34, "side")
    _finish_small(k, ao_dist=0.25, ao_strength=0.75, ref=(-1.15, 0.2))


@asset("sack_pile")
def build_sack_pile():
    """Jute sacks stacked in interlocking courses on a wooden pallet."""
    k = Kit("sack_pile", "props")
    rng = random.Random(22)
    slat = wood("sp_slat", rgb("#8d7250"), axis="x", wear=0.6)
    runner = wood("sp_runner", rgb("#6d5438"), axis="y", wear=0.35)
    sacks = [jute("sp_sack", rgb("#a58b5c")), jute("sp_sack2", rgb("#8d7650"), dirt=0.6), jute("sp_sack3", rgb("#b39a6c"))]
    for x in (-0.52, 0.0, 0.52):
        k.box((0.1, 1.0, 0.09), (x, 0, 0.045), runner)
    for i in range(7):
        k.box((1.2, 0.115, 0.022), (rng.uniform(-0.01, 0.01), -0.42 + i * 0.14, 0.101), slat)
    Z, step = 0.112, 0.205
    for course in range(4):
        z = Z + course * step
        if course % 2 == 0:
            for i, x in enumerate((-0.385, 0.0, 0.385)):
                _sack(k, (x + rng.uniform(-0.012, 0.012), rng.uniform(-0.02, 0.02), z), 0.98, 0.41, 0.26, math.pi / 2 + rng.uniform(-0.04, 0.04), sacks[(i + course) % 3], rng, seg=10)
        else:
            for i, y in enumerate((-0.235, 0.235)):
                _sack(k, (rng.uniform(-0.02, 0.02), y + rng.uniform(-0.012, 0.012), z), 1.15, 0.47, 0.26, rng.uniform(-0.04, 0.04), sacks[(i + course + 1) % 3], rng, seg=10)
    _sack(k, (0.06, 0.03, Z + 4 * step), 1.0, 0.46, 0.25, 0.32, sacks[2], rng, seg=10)
    k.preview((1.7, -3.3, 1.5), (0, 0, 0.58), 34, "front")
    k.preview((-2.8, 1.4, 2.2), (0, 0, 0.58), 34, "back")
    _finish_small(k, ao_dist=0.22, ao_strength=0.8, ref=(1.15, -0.3))


@asset("flexi_kiosk")
def build_flexi_kiosk():
    """Tiny pavement mobile-recharge booth. Front faces -Y. The body is 1.4 x 1.2 m; the tin roof overhangs it.
    The fascia is blank paint: any sign is added at runtime at the `sign` empty."""
    k = Kit("flexi_kiosk", "props")
    rng = random.Random(23)
    green = painted("fk_green", rgb("#43785a"), under=rgb("#8f7654"), wear=0.58, fade=0.75, dirt=0.55, rust=0.16, rough=0.5, drip=0.9, scale=1.2, bevel=0.004)
    red = painted("fk_red", rgb("#a43f33"), under=rgb("#8f7654"), wear=0.58, fade=0.7, dirt=0.45, rust=0.14, rough=0.5, drip=0.8, scale=1.2, bevel=0.004)
    tin_a = rusty_tin("fk_tin", rgb("#8f918c"), rust=0.75, metallic=0.3, mud=0.0)
    tin_b = rusty_tin("fk_tin2", rgb("#7d5f47"), rust=0.95, mud=0.0)
    edge = galv("fk_edge", rust=0.3, scale=2.0)
    top = wood("fk_top", rgb("#8a6a45"), axis="x", wear=0.6)
    ply = wood("fk_ply", rgb("#6d5438"), axis="x", wear=0.35)
    iron = steel("fk_iron", rgb("#55534d"), rust=0.7, metallic=0.5, drip=0.3)
    base = concrete("fk_base", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.3, grime=1.0, grime_h=0.25, dust=0.6, bevel=0.01)
    black = flat("fk_black", rgb("#141312"), rough=0.5)
    brick = brick_loose("fk_brick")
    goods = [plastic(f"fk_g{i}", rgb(c), rough=0.4, scuff=0.6, dirt=0.0) for i, c in enumerate(("#b5403a", "#c9a032", "#3a6f9e", "#3f8a60", "#c0693a", "#c9c5b6", "#75528f"))]
    HX, HY = 0.7, 0.6
    # plinth and the banded lower body
    _ring(k, -HX - 0.02, HX + 0.02, -HY - 0.02, HY + 0.02, 0.0, 0.1, base)
    _ring(k, -HX, HX, -HY, HY, 0.1, 0.52, green)
    _ring(k, -HX - 0.003, HX + 0.003, -HY - 0.003, HY + 0.003, 0.52, 0.66, red)
    _ring(k, -HX, HX, -HY, HY, 0.66, 0.92, green)
    k.box((2 * HX - 0.04, 2 * HY - 0.04, 0.02), (0, 0, 0.12), ply, w=0.3)
    # corner trims and battens on the lower panel
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((0.035, 0.035, 1.96), (sx * HX, sy * HY, 1.08), edge)
        k.box((0.04, 0.012, 0.82), (sx * 0.24, -HY - 0.006, 0.51), red)
    # upper walls, open at the front above the counter
    for sx in (-1, 1):
        k.box((0.025, 2 * HY, 0.96), (sx * (HX - 0.012), 0, 1.4), green)
    k.box((2 * HX, 0.025, 0.96), (0, HY - 0.012, 1.4), green)
    # blank fascia band and the wedge up to the sloping roof
    _ring(k, -HX - 0.004, HX + 0.004, -HY - 0.004, HY + 0.004, 1.88, 2.02, red)
    _ring(k, -HX, HX, -HY, HY, 2.02, 2.06, green)
    k.box((2 * HX, 0.02, 0.11), (0, -HY, 2.115), green)
    for sx in (-1, 1):
        k.mesh([(sx * HX, -HY, 2.06), (sx * HX, HY, 2.06), (sx * HX, -HY, 2.17)], [(0, 1, 2)], green, smooth=False)
    k.box((2 * HX, 2 * HY, 0.015), (0, 0, 2.065), ply, w=0.3)
    # counter on brackets, tin nosing
    k.box((2 * HX + 0.1, 0.46, 0.035), (0, -0.59, 0.94), top)
    k.box((2 * HX + 0.12, 0.012, 0.05), (0, -0.826, 0.94), edge)
    for sx in (-1, 1):
        k.rod((sx * 0.52, -0.8, 0.92), (sx * 0.52, -HY, 0.7), 0.012, iron, seg=4)
    # sloping tin roof: two sheets, overhanging on all sides
    run, drop = 2 * HY + 0.46, 0.14
    L = math.hypot(run, drop)
    h_dir = (0, run, -drop)
    _corrugated(k, (-HX - 0.17, -HY - 0.24, 2.188), (1, 0, 0), h_dir, 0.92, L, tin_a, curl=0.0)
    _corrugated(k, (-0.05, -HY - 0.24, 2.192), (1, 0, 0), h_dir, 0.92, L, tin_b, curl=0.05)
    k.box((2 * HX + 0.34, 0.02, 0.05), (0, -HY - 0.235, 2.16), ply)
    # bricks and a bamboo offcut holding the roof down
    k.box((0.22, 0.11, 0.07), (-0.4, 0.15, 2.17), brick, rot=(0.08, 0, 0.3))
    k.box((0.22, 0.11, 0.07), (0.42, -0.25, 2.2), brick, rot=(0.08, 0, -0.5))
    # shelves and small unbranded packets
    for z in (1.22, 1.58):
        k.box((2 * HX - 0.08, 0.2, 0.02), (0, HY - 0.12, z), ply)
        x = -0.58
        while x < 0.58:
            sx_, sy_, sz_ = rng.uniform(0.06, 0.13), rng.uniform(0.06, 0.12), rng.uniform(0.06, 0.2)
            k.box((sx_, sy_, sz_), (x + sx_ / 2, HY - 0.13, z + 0.01 + sz_ / 2), goods[rng.randrange(len(goods))], rot=(0, 0, rng.uniform(-0.15, 0.15)))
            x += sx_ + rng.uniform(0.03, 0.14)
    # strips of plain pouches hanging from the fascia
    for i, x in enumerate((-0.54, -0.36, -0.2, 0.22, 0.4, 0.56)):
        count = rng.randint(4, 6)
        k.rod((x, -0.5, 1.88), (x, -0.5, 1.88 - 0.04 - (count - 1) * 0.098), 0.003, black, seg=3)
        for j in range(count):
            k.box((0.078, 0.006, 0.086), (x + rng.uniform(-0.006, 0.006), -0.503, 1.84 - j * 0.098), goods[i % len(goods)], rot=(0, 0, rng.uniform(-0.2, 0.2)))
    # on the counter: a cash tin, a keypad phone and two sweet jars
    k.box((0.2, 0.14, 0.09), (-0.35, -0.5, 1.0), edge)
    k.box((0.055, 0.11, 0.016), (0.02, -0.58, 0.966), black)
    k.cyl(0.05, 0.14, (0.36, -0.46, 1.03), goods[5], seg=6)
    k.cyl(0.05, 0.11, (0.48, -0.5, 1.015), goods[1], seg=6)
    # a tail of spare cable off the back corner
    _wire(k, _coil_path((HX + 0.03, 0.34, 1.62), 0.11, 2.0, rng, tilt=1.57, n_per=8), 0.006, black, seg=3, w=0.8, chunks=1)
    k.empty("vendor", (0.0, 0.12, 0.0))
    k.empty("sign", (0.0, -0.61, 1.95))
    k.preview((1.6, -4.0, 1.6), (0, -0.1, 1.15), 34, "front")
    k.preview((-3.2, 2.4, 2.1), (0, 0, 1.15), 34, "back")
    _finish_small(k, ao_dist=0.3, ao_strength=0.75, cull=False, ref=(-1.25, -0.5))


@asset("clothes_rack")
def build_clothes_rack():
    """Pavement hawker's stall: bamboo frame, blue tarp roof, rows of hanging shirts and lungis, folded stock on a table."""
    k = Kit("clothes_rack", "props")
    rng = random.Random(24)
    pole = bamboo("cl_pole", rgb("#a8915a"))
    rope = flat("cl_rope", rgb("#6b5a3e"), rough=0.95)
    tarp = tarp_cloth("cl_tarp", rgb("#2a62a6"), rgb("#3f7cc0"), stripe=0.6, fade=0.65)
    table = wood("cl_table", rgb("#8a6a45"), axis="x", wear=0.55)
    leg = wood("cl_leg", rgb("#6a4e33"), axis="z", wear=0.3)
    hook = steel("cl_hook", rgb("#6d6c68"), rust=0.3, metallic=0.6, drip=0.0)
    shirts = [fabric("cl_s0", rgb("#d9dad4"), fade=0.2, dirt=0.25, sag_dirt=0.15), fabric("cl_s1", rgb("#3779a9"), fade=0.45, dirt=0.25, sag_dirt=0.15),
              fabric("cl_s2", rgb("#c58b2c"), fade=0.45, dirt=0.25, sag_dirt=0.15), fabric("cl_s3", rgb("#8a2f33"), fade=0.45, dirt=0.25, sag_dirt=0.15),
              fabric("cl_s4", rgb("#2f7a57"), fade=0.45, dirt=0.25, sag_dirt=0.15), plaid("cl_s5", [rgb("#c2c4c0"), rgb("#34507f"), rgb("#c2c4c0")], period=0.06)]
    lungis = [plaid("cl_l0", [rgb("#27508e"), rgb("#1b3564"), rgb("#c7c0ab"), rgb("#27508e")], period=0.09),
              plaid("cl_l1", [rgb("#2c6e49"), rgb("#17472d"), rgb("#d6cfb6"), rgb("#8a2f2a")], period=0.11),
              plaid("cl_l2", [rgb("#7c2f4a"), rgb("#3b1a2e"), rgb("#d6cfb6"), rgb("#c58b2c")], period=0.1)]
    PX, PY, RAIL = 1.2, 0.54, 1.96
    # six uprights, three clothes rails, cross-beams and a low ridge for the tarp
    for x in (-PX, 0.0, PX):
        for y in (-PY, PY):
            k.rod((x + rng.uniform(-0.012, 0.012), y, 0.0), (x, y, 2.06), 0.03, pole, seg=5)
        k.rod((x, -PY - 0.05, RAIL + 0.06), (x, PY + 0.05, RAIL + 0.06), 0.024, pole, seg=4)
    for sx in (-1, 1):
        k.rod((sx * PX, 0, RAIL + 0.08), (sx * PX, 0, 2.3), 0.022, pole, seg=4)
    k.rod((-1.28, 0, 2.3), (1.28, 0, 2.3), 0.024, pole, seg=5)
    for y in (-PY + 0.04, 0.0, PY - 0.04):
        k.rod((-1.25, y, RAIL), (1.25, y, RAIL), 0.02, pole, seg=5)
    for x in (-PX, PX):
        for y in (-PY + 0.04, PY - 0.04):
            k.cyl(0.042, 0.07, (x, y, RAIL), rope, seg=3)
    for y, sd in ((-PY, 1), (PY, -1)):
        k.rod((-PX, y, 0.55), (-PX + 0.5, y, 0.05), 0.016, pole, seg=4)
        k.rod((PX, y, 0.55), (PX - 0.5, y, 0.05), 0.016, pole, seg=4)

    # the blue tarp sags between the frame members and hangs a little past the eaves
    def roof(u, v):
        x = u * 1.36
        y = v * 0.72
        fall = abs(v) ** 1.25 * 0.3
        sag = 0.035 * (1.0 - abs(v * 2.0 - round(v * 2.0)) * 2.0 * 0) * math.sin((abs(v)) * math.pi) * (0.5 + 0.5 * math.cos(u * math.pi * 2.0))
        lip = 0.09 * max(0.0, abs(v) - 0.84) / 0.16
        return (x, y + 0.012 * math.sin(u * 13.0) * abs(v), 2.335 - fall - sag - lip)
    k.grid(roof, 10, 6, tarp, w=0.8, chunks=1)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        k.rod((sx * 1.35, sy * 0.71, 1.95), (sx * PX, sy * PY, 1.6), 0.005, rope, seg=3)
    # front row and middle row of shirts, a rear row mostly of lungis
    front = (-1.0, -0.6, -0.2, 0.2, 0.6, 1.0)
    for i, x in enumerate(front):
        y = -PY + 0.04 + (0.022 if i % 2 else -0.022)
        if i in (2,):
            _drape(k, x, y, RAIL, 0.5, 1.12, lungis[0], rng, nu=5, nv=3)
        else:
            _shirt(k, x, y, RAIL - 0.09, shirts[i % len(shirts)], rng, hook, RAIL, length=0.72)
    for i, x in enumerate((-0.82, -0.28, 0.28, 0.82)):
        _shirt(k, x, 0.022 if i % 2 else -0.022, RAIL - 0.09, shirts[(i + 3) % len(shirts)], rng, hook, RAIL, length=0.7)
    for i, x in enumerate((-0.95, -0.38, 0.2, 0.78)):
        _drape(k, x, PY - 0.04 + (0.02 if i % 2 else -0.02), RAIL, 0.52, 1.18 - 0.05 * (i % 2), lungis[(i + 1) % 3], rng, nu=5, nv=3)
    # one lungi hung on each end beam, facing out sideways
    for sx, m in ((-1, lungis[1]), (1, lungis[2])):
        o = _drape(k, 0.0, 0.0, RAIL + 0.03, 0.55, 1.0, m, rng, nu=4, nv=2)
        o.matrix_basis = Matrix.Translation((sx * (PX + 0.035), 0.12 * sx, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
    # table with folded stock in the shade underneath
    k.box((1.5, 0.46, 0.025), (0, 0.02, 0.62), table)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((0.035, 0.035, 0.6), (sx * 0.7, 0.02 + sy * 0.19, 0.3), leg)
    for x, m, n_ in ((-0.52, lungis[0], 3), (-0.12, shirts[1], 2), (0.28, lungis[1], 4), (0.56, shirts[3], 2)):
        for j in range(n_):
            k.box((0.32 + rng.uniform(-0.02, 0.02), 0.26, 0.038), (x + rng.uniform(-0.012, 0.012), 0.02 + rng.uniform(-0.012, 0.012), 0.652 + j * 0.04), m, rot=(0, 0, rng.uniform(-0.05, 0.05)))
    k.empty("vendor", (0.0, 0.92, 0.0))
    k.preview((1.6, -5.0, 1.7), (0, 0, 1.2), 34, "front")
    k.preview((-4.0, -2.2, 2.7), (0, 0, 1.15), 34, "above")
    k.preview((2.6, 3.8, 1.5), (0, 0, 1.15), 34, "back")
    _finish_small(k, ao_dist=0.25, ao_strength=0.6, cull=False, ref=(1.6, -0.9))


@asset("shoe_stall")
def build_shoe_stall():
    """Low table with rows of shoes and sandals under a big faded umbrella. Toes point at the customer (-Y)."""
    k = Kit("shoe_stall", "props")
    rng = random.Random(25)
    Z1, Z2 = 0.504, 0.724
    canopy_a = fabric("ss_can_a", rgb("#d9a63a"), fade=0.85, dirt=0.45, sag_dirt=0.4)
    canopy_b = fabric("ss_can_b", rgb("#3f6f9e"), fade=0.85, dirt=0.45, sag_dirt=0.4)
    pole_m = galv("ss_pole", rust=0.35)
    rib = steel("ss_rib", rgb("#6d6c68"), rust=0.35, metallic=0.6, drip=0.0)
    base_m = concrete("ss_base", c1=rgb("#a39a88"), c2=rgb("#7e7565"), seam_h=0, drip=0.2, grime=1.0, grime_h=0.3, dust=0.7, bevel=0.01)
    table = wood("ss_table", rgb("#8a6a45"), axis="x", wear=0.55)
    leg = wood("ss_leg", rgb("#6a4e33"), axis="z", wear=0.3)
    cloth = fabric("ss_cloth", rgb("#6b3a34"), fade=0.5, dirt=0.55, sag_dirt=0.45)
    dark = flat("ss_dark", rgb("#120f0c"), rough=0.9)
    stool_m = plastic("ss_stool", rgb("#2e6db0"), rough=0.45, scuff=0.5)
    leather = [shoe_leather("ss_black", rgb("#1f1c1a")), shoe_leather("ss_brown", rgb("#5a3620")), shoe_leather("ss_tan", rgb("#96683a")), shoe_leather("ss_oxblood", rgb("#4f1f1c"))]
    rubber = [shoe_leather("ss_r0", rgb("#2a64a8"), gloss=0.5), shoe_leather("ss_r1", rgb("#b5362d"), gloss=0.5), shoe_leather("ss_r2", rgb("#2f8452"), gloss=0.5), shoe_leather("ss_r3", rgb("#d6cfbb"), gloss=0.5)]
    # table top, a raised rear step, legs and a cloth skirt on the customer's side
    k.box((1.6, 1.0, 0.03), (0, 0, Z1 - 0.019), table)
    k.box((1.56, 0.32, Z2 - Z1), (0, 0.32, (Z1 + Z2) / 2), table)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box((0.05, 0.05, 0.47), (sx * 0.74, sy * 0.44, 0.235), leg)
        k.box((0.03, 0.82, 0.05), (sx * 0.74, 0, 0.2), leg)
    k.box((1.62, 0.68, 0.006), (0, -0.16, Z1 - 0.003), cloth)
    k.box((1.58, 0.34, 0.006), (0, 0.33, Z2 - 0.003), cloth)

    def skirt(u, v):
        return (u * 0.81, -0.5 - 0.012 * math.sin(u * 17.0) - 0.008 * (1 - v) * math.sin(u * 9.0), Z1 - 0.09 + 0.09 * v - 0.006 * math.sin(u * 23.0) * (1 - v))
    k.grid(skirt, 8, 1, cloth, chunks=1)

    tops_v, tops_f = [], []

    def shoe(x, y, z, yaw, m):
        rings = [{"c": (0, 0.13, 0.032), "rx": 0.028, "ry": 0.028, "axis": "y"}, {"c": (0, 0.075, 0.05), "rx": 0.04, "ry": 0.05, "axis": "y"},
                 {"c": (0, -0.03, 0.032), "rx": 0.044, "ry": 0.032, "axis": "y"}, {"c": (0, -0.125, 0.018), "rx": 0.03, "ry": 0.017, "axis": "y"}]
        o = k.loft(rings, m, seg=5, w=1.4)
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, "Z")
        o.matrix_basis = M
        # dark foot opening on the top of the ankle
        b = len(tops_v)
        for px, py in ((0.0, 0.125), (0.026, 0.085), (0.0, 0.03), (-0.026, 0.085)):
            tops_v.append(tuple(M @ Vector((px, py, 0.094))))
        tops_f.append((b, b + 1, b + 2, b + 3))

    def sandal(x, y, z, yaw, m):
        ca, sa = math.cos(yaw), math.sin(yaw)
        # foot-shaped sole: an outline with a flat top, no hidden underside
        outline = ((0.0, 0.125), (-0.033, 0.095), (-0.036, 0.02), (-0.042, -0.07), (-0.028, -0.12), (0.028, -0.12), (0.042, -0.07), (0.036, 0.02), (0.033, 0.095))
        vs = []
        for h_ in (0.0, 0.016):
            vs += [(x + px * ca - py * sa, y + px * sa + py * ca, z + h_) for px, py in outline]
        n_ = len(outline)
        fs = [(i, (i + 1) % n_, (i + 1) % n_ + n_, i + n_) for i in range(n_)] + [tuple(n_ + i for i in range(n_))]
        k._add(bo.new_mesh_object("p", vs, fs, smooth=False), m, 1.4)

        def at(px, py, pz):
            return (x + px * ca - py * sa, y + px * sa + py * ca, z + pz)
        post = at(0, -0.065, 0.02)
        for sd in (-1, 1):
            k.rod(post, at(sd * 0.036, 0.03, 0.03), 0.006, m, seg=3, w=1.4)

    xs = [-0.66 + i * 0.22 for i in range(7)]
    # front row: rubber sandals; middle row: leather; raised rear row: leather and canvas
    for i, x in enumerate(xs):
        m = rubber[(i * 3) % len(rubber)]
        for sd in (-1, 1):
            sandal(x + sd * 0.052, -0.34 + rng.uniform(-0.012, 0.012), Z1, sd * 0.06 + rng.uniform(-0.04, 0.04), m)
    for i, x in enumerate(xs):
        m = leather[(i * 5) % len(leather)]
        for sd in (-1, 1):
            shoe(x + sd * 0.052, -0.01 + rng.uniform(-0.012, 0.012), Z1, sd * 0.04 + rng.uniform(-0.04, 0.04), m)
    for i, x in enumerate(xs):
        m = leather[(i * 3 + 1) % len(leather)] if i % 3 else rubber[3]
        for sd in (-1, 1):
            shoe(x + sd * 0.052, 0.31 + rng.uniform(-0.01, 0.01), Z2, sd * 0.04 + rng.uniform(-0.04, 0.04), m)
    k._add(bo.new_mesh_object("p", tops_v, tops_f, smooth=False), dark, 0.5)

    # concrete-filled tin, leaning pole and a big eight-panel canopy, tilted over the goods
    bx, by, tx, ty, tz = 0.0, 0.67, 0.0, 0.18, 2.55
    k.loft([{"c": (bx, by, 0.0), "rx": 0.17, "ry": 0.17}, {"c": (bx, by, 0.2), "rx": 0.15, "ry": 0.15}], base_m, seg=8)
    k.rod((bx, by, 0.15), (tx, ty, tz), 0.022, pole_m, seg=5)
    tilt = math.atan2(by - ty, tz - 0.15)
    M = Matrix.Translation((tx, ty, tz)) @ Matrix.Rotation(tilt, 4, "X")
    R, ze = 1.32, -0.46

    def ca(p):
        return tuple(M @ Vector(p))
    for i in range(8):
        a0, a1 = 2 * math.pi * i / 8, 2 * math.pi * (i + 1) / 8

        def pt(u, v, a0=a0, a1=a1):
            t = (v + 1) * 0.5
            a = a0 + (a1 - a0) * (u + 1) * 0.5
            sag = (1 - u * u) * 0.04 * math.sin(t * math.pi)
            r = R * t * (1.0 - 0.1 * (1 - abs(u)) * (t ** 6))
            return ca((math.cos(a) * r, math.sin(a) * r, ze * t ** 1.5 - sag))
        k.grid(pt, 2, 3, canopy_a if i % 2 else canopy_b, w=0.8, chunks=1)
        ar = a0
        k.rod(ca((0, 0, -0.24)), ca((math.cos(ar) * R * 0.98, math.sin(ar) * R * 0.98, ze - 0.005)), 0.006, rib, seg=3)
        k.rod(ca((0, 0, -0.62)), ca((math.cos(ar) * 0.66, math.sin(ar) * 0.66, -0.21)), 0.005, rib, seg=3)
    k.cyl(0.03, 0.05, ca((0, 0, -0.62)), rib, seg=5, rot=(tilt, 0, 0))
    # the seller's stool
    k.loft([{"c": (0.55, 0.82, 0.0), "rx": 0.13, "ry": 0.13, "power": 3}, {"c": (0.55, 0.82, 0.3), "rx": 0.13, "ry": 0.13, "power": 3}, {"c": (0.55, 0.82, 0.33), "rx": 0.155, "ry": 0.155, "power": 3}], stool_m, seg=6)
    k.empty("vendor", (0.55, 0.82, 0.0))
    k.preview((1.3, -4.6, 1.8), (0, 0, 1.05), 34, "front")
    k.preview((-2.0, -2.0, 1.5), (0, -0.05, 0.7), 34, "goods")
    k.preview((3.0, 3.2, 3.2), (0, 0, 1.2), 36, "above")
    _finish_small(k, ao_dist=0.2, ao_strength=0.7, cull=False, ref=(1.15, -0.7))


@asset("tin_shed")
def build_tin_shed():
    """Rusty corrugated-tin shack: a door, a small awning, a shuttered window, bricks and an old tyre on the roof.
    Front faces -Y. Real ribbed sheets, one material."""
    k = Kit("tin_shed", "props")
    rng = random.Random(26)
    tins = [rusty_tin("ts_a", rgb("#7d5f47"), rust=0.9, fade=0.3), rusty_tin("ts_b", rgb("#8f918c"), rust=0.6, metallic=0.3), rusty_tin("ts_c", rgb("#6d5540"), rust=1.0, fade=0.25), rusty_tin("ts_d", rgb("#4f6f7e"), rust=0.65, fade=0.6)]
    roofs = [rusty_tin("ts_r0", rgb("#7d6450"), rust=0.95, mud=0.0), rusty_tin("ts_r1", rgb("#8c8e89"), rust=0.7, metallic=0.3, mud=0.0)]
    door_m = rusty_tin("ts_door", rgb("#46708c"), rust=0.5, fade=0.55)
    post = bamboo("ts_post", rgb("#8d7a4d"))
    timber = wood("ts_timber", rgb("#6d5438"), axis="z", wear=0.4)
    batten = wood("ts_batten", rgb("#7a5f40"), axis="x", wear=0.45)
    shutter = painted("ts_shutter", rgb("#35525a"), under=rgb("#5a4530"), wear=0.75, fade=0.35, grain="z", dirt=0.7, rust=0.2, scale=2.0, bevel=0.004)
    base = concrete("ts_base", c1=rgb("#9a9180"), c2=rgb("#716858"), seam_h=0, drip=0.4, grime=1.0, grime_h=0.3, dust=0.6, moss=0.4, bevel=0.012)
    dark = flat("ts_dark", rgb("#14110e"), rough=0.95)
    iron = steel("ts_iron", rgb("#4f4d48"), rust=0.7, metallic=0.5, drip=0.2)
    brick = brick_loose("ts_brick")
    tyre = flat("ts_tyre", rgb("#1f1e1c"), rough=0.85)
    HX, HY, Z0, ZF, ZR = 1.5, 1.25, 0.12, 2.26, 2.02
    SL = (ZF - ZR) / (2 * HY)  # fall of the roof per metre towards the back

    def ztop(y):
        return ZF - SL * (y + HY)
    _ring(k, -HX - 0.03, HX + 0.03, -HY - 0.03, HY + 0.03, 0.0, Z0 + 0.03, base)
    k.box((2 * HX - 0.06, 2 * HY - 0.06, 1.88), (0, 0, 0.96), dark, w=0.1)
    # side walls: three sheets each, tops following the roof
    w_, lap = 0.88, 0.07
    for i in range(3):
        y1 = HY - i * (w_ - lap)
        _corrugated(k, (-HX - 0.008 * (i % 2), y1, Z0), (0, -1, 0), (0, 0, 1), w_, ztop(y1 - w_ / 2) - Z0, tins[(i * 2) % 3], skew=SL * w_, phase=i * 0.7)
        y0 = -HY + i * (w_ - lap)
        _corrugated(k, (HX + 0.008 * (i % 2), y0, Z0), (0, 1, 0), (0, 0, 1), w_, ztop(y0 + w_ / 2) - Z0, tins[(i + 1) % 4], skew=-SL * w_, phase=i * 1.3, curl=0.04 if i == 1 else 0.0)
    # back wall
    wb = 0.81
    for i in range(4):
        _corrugated(k, (HX - i * (wb - lap), HY + 0.008 * (i % 2), Z0), (-1, 0, 0), (0, 0, 1), wb, ZR - Z0, tins[(i + 2) % 4], phase=i * 0.9)
    # front wall around the door opening (x 0.14 to 1.0)
    fy = -HY
    _corrugated(k, (-HX, fy, Z0), (1, 0, 0), (0, 0, 1), w_, ZF - Z0, tins[0])
    _corrugated(k, (-0.69, fy - 0.008, Z0), (1, 0, 0), (0, 0, 1), 0.86, ZF - Z0, tins[2], phase=0.8)
    _corrugated(k, (1.0, fy, Z0), (1, 0, 0), (0, 0, 1), 0.5, ZF - Z0, tins[3], phase=1.6)
    _corrugated(k, (0.1, fy - 0.006, 1.96), (1, 0, 0), (0, 0, 1), 0.94, ZF - 1.96, tins[1], phase=0.3)
    # patches over old holes
    _corrugated(k, (-0.42, fy - 0.022, 0.5), (1, 0, 0), (0, 0, 1), 0.52, 0.62, tins[1], phase=0.4)
    _corrugated(k, (-HX - 0.024, 0.55, 0.32), (0, -1, 0), (0, 0, 1), 0.52, 0.55, tins[3], phase=1.1)
    # corner posts: bamboo at the back, timber at the front
    for sx in (-1, 1):
        k.box((0.055, 0.055, ZF - 0.04), (sx * (HX + 0.012), -HY - 0.012, (ZF - 0.04) / 2 + 0.02), timber)
        k.rod((sx * (HX + 0.012), HY + 0.012, 0.0), (sx * (HX + 0.012), HY + 0.012, ZR), 0.035, post, seg=5)
    # door: frame, tin leaf, Z-battens, hinges, hasp and padlock
    for x in (0.14, 1.0):
        k.box((0.055, 0.06, 1.87), (x, fy - 0.01, 1.015), timber)
    k.box((0.92, 0.06, 0.055), (0.57, fy - 0.01, 1.96), timber)
    _corrugated(k, (0.17, fy - 0.03, 0.14), (1, 0, 0), (0, 0, 1), 0.8, 1.79, door_m, amp=0.009, phase=0.5)
    for z in (0.42, 1.12, 1.74):
        k.box((0.8, 0.018, 0.07), (0.57, fy - 0.05, z), batten)
    k.box((0.8, 0.018, 0.06), (0.57, fy - 0.05, 0.77), batten, rot=(0, -0.72, 0))
    for z in (0.46, 1.7):
        k.box((0.16, 0.012, 0.03), (0.22, fy - 0.062, z), iron)
    k.box((0.12, 0.012, 0.03), (0.92, fy - 0.062, 1.08), iron)
    k.box((0.04, 0.022, 0.05), (0.97, fy - 0.075, 1.05), iron)
    # small plank-shuttered window on the front
    for x in (-1.1, -0.79):
        k.box((0.3, 0.026, 0.5), (x, fy - 0.034, 1.32), shutter)
    for x in (-1.27, -0.62):
        k.box((0.035, 0.04, 0.58), (x, fy - 0.032, 1.32), timber)
    for z in (1.04, 1.6):
        k.box((0.68, 0.04, 0.035), (-0.945, fy - 0.032, z), timber)
    # roof: four sheets running down the slope, overhanging all round
    OV = 0.17
    run = 2 * HY + 2 * OV
    drop = SL * run
    L = math.hypot(run, drop)
    h_dir = (0, run, -drop)
    z_front = ztop(-HY - OV) + 0.06
    wr, x = 0.88, -HX - 0.15
    for i in range(4):
        _corrugated(k, (x, -HY - OV, z_front + 0.006 * (i % 2)), (1, 0, 0), h_dir, wr, L, roofs[i % 2], amp=0.014, phase=i * 0.5, curl=0.05 if i == 3 else 0.0)
        x += wr - lap

    def zr(y):
        return ztop(y) + 0.06
    k.rod((-1.6, -0.75, zr(-0.75) + 0.04), (1.6, -0.75, zr(-0.75) + 0.04), 0.03, post, seg=5)
    k.box((0.22, 0.11, 0.07), (-1.05, -0.75, zr(-0.75) + 0.095), brick, rot=(0.1, 0, 0.1))
    k.box((0.22, 0.11, 0.07), (0.3, 0.5, zr(0.5) + 0.05), brick, rot=(0.1, 0, -0.4))
    k.box((0.22, 0.11, 0.07), (0.36, 0.62, zr(0.62) + 0.12), brick, rot=(0.1, 0, 0.5))
    tyre_pts = [(-0.72 + math.cos(2 * math.pi * i / 10) * 0.24, 0.42 + math.sin(2 * math.pi * i / 10) * 0.24, zr(0.42) + 0.05 - 0.096 * math.sin(2 * math.pi * i / 10) * 0.24) for i in range(11)]
    k.tube(tyre_pts, 0.05, tyre, seg=4)
    # awning over the door on two bamboo struts
    aw_run, aw_drop = 0.62, 0.2
    _corrugated(k, (-0.02, fy - aw_run, 1.91), (1, 0, 0), (0, aw_run, aw_drop), 1.2, math.hypot(aw_run, aw_drop), roofs[1], amp=0.011, phase=0.2)
    k.box((1.22, 0.03, 0.04), (0.58, fy - aw_run + 0.015, 1.9), batten)
    k.box((1.22, 0.04, 0.05), (0.58, fy - 0.025, 2.1), batten)
    for x_ in (0.04, 1.12):
        k.rod((x_, fy - aw_run + 0.03, 1.89), (x_, fy - 0.02, 1.4), 0.018, post, seg=4)
    k.preview((3.6, -6.6, 2.4), (0, 0, 1.2), 34, "front")
    k.preview((-5.0, 3.8, 3.6), (0, 0, 1.2), 34, "back")
    _finish_small(k, ao_dist=0.3, ao_strength=0.75, cull=False, ref=(-2.1, -1.5))


@asset("scaffold_bamboo")
def build_scaffold_bamboo():
    """Lashed bamboo scaffold panel, 6 m wide and 9 m tall. Its back is the plane Blender y = 0 (game local z = 0)
    and it stands in front of that plane, towards -Y, so it can go straight against a wall. Spliced poles, one
    set of texels per pole; geometry is all thin, nothing uses alpha."""
    k = Kit("scaffold_bamboo", "props")
    rng = random.Random(27)
    pole = bamboo("sb_pole", rgb("#a8915a"))
    rail = bamboo("sb_rail", rgb("#978350"), node=0.37)
    brace = bamboo("sb_brace", rgb("#8a7a52"), node=0.39)
    rope = flat("sb_rope", rgb("#6b5a3e"), rough=0.95)
    board = wood("sb_board", rgb("#8f7350"), axis="x", wear=0.6)
    nets = [net_cloth("sb_net", rgb("#5b7d58")), net_cloth("sb_net2", rgb("#6f8c63"))]
    YI, YO = -0.06, -0.84
    XS = (-2.95, -1.5, 0.02, 1.5, 2.95)
    LEVELS = (1.45, 2.95, 4.45, 5.95, 7.45, 8.8)
    UP = 3.5

    def about(target, angle, master, sz=1.0):
        return Matrix.Translation(target) @ Matrix.Rotation(angle, 4, "Z") @ Matrix.Diagonal((1, 1, sz, 1)) @ Matrix.Translation(tuple(-c for c in master))

    # uprights: three lengths spliced side by side up each line, inner and outer rows
    m0 = (XS[0], YI, 0.0)
    mats = []
    for row, y in enumerate((YI, YO)):
        for c, x in enumerate(XS):
            side = 1 if x < 0 else -1
            top = 9.0 if (row, c) == (1, 2) else 9.0 - rng.uniform(0.0, 0.4)
            for j, (z, dx, sz) in enumerate(((0.0, 0.0, 1.0), (3.1, side * 0.075, 1.0), (6.2, 0.0, (top - 6.2) / UP))):
                if (row, c, j) == (0, 0, 0):
                    continue
                mats.append(about((x + dx, y, z), rng.choice((0.0, math.pi / 2, math.pi, -math.pi / 2)), m0, sz))
    k.begin_instances(mats, "upright")
    k.tube([m0, (m0[0] + 0.012, m0[1] + 0.006, UP * 0.5), (m0[0], m0[1], UP)], 0.04, pole, seg=4, w=1.5)
    k.end_instances()
    # ledgers along X: two lengths per run, lashed to the room side of each row
    LL = 3.2
    m1 = (-1.4, YI - 0.073, LEVELS[0])
    mats = []
    for ry, y in enumerate((YI - 0.073, YO - 0.073)):
        for lvl in LEVELS:
            for half, cx in enumerate((-1.4, 1.4)):
                if (ry, lvl, half) == (0, LEVELS[0], 0):
                    continue
                mats.append(about((cx, y, lvl + rng.uniform(-0.03, 0.03) + 0.07 * half), rng.choice((0.0, math.pi)), m1))
    k.begin_instances(mats, "ledger")
    k.tube([(m1[0] - LL / 2, m1[1], m1[2]), (m1[0], m1[1] + 0.01, m1[2] + 0.012), (m1[0] + LL / 2, m1[1], m1[2])], 0.034, rail, seg=4, w=1.5)
    k.end_instances()
    # transoms between the rows, on most joints
    m2 = (XS[0] + 0.08, -0.49, LEVELS[0] + 0.06)
    mats = []
    for lvl in LEVELS:
        for c, x in enumerate(XS):
            if lvl == LEVELS[0] and c == 0:
                continue
            if c in (0, 4) and lvl in (LEVELS[1], LEVELS[3]):
                continue
            if c == 2 and lvl == LEVELS[4]:
                continue
            mats.append(about((x + (0.08 if x < 0 else -0.08), -0.49, lvl + 0.06), 0.0, m2))
    k.begin_instances(mats, "transom")
    k.rod((m2[0], -0.03, m2[2]), (m2[0], -0.95, m2[2]), 0.028, rail, seg=4, w=1.5)
    k.end_instances()
    # long diagonal braces on the outer face
    yb = YO - 0.073 - 0.062
    for (x0, z0), (x1, z1) in (((-2.9, 0.3), (-0.1, 4.3)), ((2.9, 0.6), (0.2, 4.1)), ((-0.15, 4.25), (2.85, 8.4)), ((0.15, 4.0), (-2.8, 8.2))):
        k.tube([(x0, yb, z0), ((x0 + x1) / 2 + 0.02, yb + 0.012, (z0 + z1) / 2), (x1, yb, z1)], 0.028, brace, seg=4, w=0.9)
    # coir lashings: chunky collars on the joints
    m3 = (XS[0], YO - 0.04, LEVELS[0])
    mats = []
    for row, y in enumerate((YO - 0.04, YI - 0.04)):
        for ci, x in enumerate(XS):
            for li, lvl in enumerate(LEVELS):
                if (row, ci, li) == (0, 0, 0) or (row == 1 and (ci + li) % 2):
                    continue
                mats.append(Matrix.Translation((x, y, lvl)) @ Matrix.Rotation(rng.uniform(0, 3.14), 4, "Y") @ Matrix.Translation(tuple(-c for c in m3)))
    for x in XS:
        for z in (3.3, 6.42):
            mats.append(Matrix.Translation((x, YO, z)) @ Matrix.Rotation(rng.uniform(-0.3, 0.3), 4, "X") @ Matrix.Translation(tuple(-c for c in m3)))
    k.begin_instances(mats, "lash")
    k.cyl(0.058, 0.09, m3, rope, seg=3, w=1.4)
    k.end_instances()
    # a few plank platforms across the transoms
    bays = ((0, 1), (2, 2), (1, 3), (3, 4))
    def bay_x(b):
        return sum(x + (0.08 if x < 0 else -0.08) for x in (XS[b], XS[b + 1])) / 2
    m4 = (bay_x(bays[0][0]), -0.22, LEVELS[bays[0][1]] + 0.105)
    mats = []
    for b, l in bays:
        cx = bay_x(b)
        for y in (-0.22, -0.47, -0.72):
            if (b, l, y) == (bays[0][0], bays[0][1], -0.22):
                continue
            mats.append(about((cx + rng.uniform(-0.04, 0.04), y, LEVELS[l] + 0.105), rng.uniform(-0.025, 0.025), m4))
    k.begin_instances(mats, "plank")
    k.box((1.6, 0.24, 0.03), m4, board, w=1.2)
    k.end_instances()
    # strips of faded netting tied to the outer ledgers, torn, with real gaps
    yn = YO - 0.073 - 0.11
    strips = ((-2.85, -2.05, 8.8, 3.4), (-1.7, -1.0, 8.8, 2.2), (-0.7, 0.25, 7.45, 3.6), (0.7, 1.35, 7.45, 2.4), (1.5, 2.6, 5.95, 3.0), (-2.5, -1.6, 4.45, 2.6), (0.15, 1.05, 2.95, 2.0), (-1.2, -0.5, 2.95, 1.6))
    for i, (x0, x1, zt, ln) in enumerate(strips):
        _tatter(k, x0, x1, zt, ln, yn, nets[i % 2], rng, nu=4, nv=5, w=0.55)
    k.preview((6.5, -15.0, 4.8), (0, -0.5, 4.5), 34, "front")
    k.preview((-2.6, -5.0, 1.6), (-0.4, -0.5, 2.7), 30, "close")
    k.preview((-13.0, -5.0, 6.0), (0, -0.5, 4.5), 34, "side")
    _finish_small(k, ao_dist=0.15, ao_strength=0.6, angle=100.0, cull=False, ref=(1.0, -1.7))


@asset("brick_pile")
def build_brick_pile():
    """Neat dry stack of red bricks: thirteen courses carried by the texture on real stepped faces,
    the top two courses as real bricks with some already taken, a few loose ones at the foot."""
    k = Kit("brick_pile", "props")
    rng = random.Random(28)
    face = brick_stack("bp_face")
    loose = brick_loose("bp_loose")
    core_m = flat("bp_core", rgb("#2a1a14"), rough=0.95)
    HX, HY, C, N = 0.75, 0.5, 0.072, 12
    verts, faces = [], []
    for i in range(N):
        e = [rng.uniform(0.0, 0.012) for _ in range(4)]
        z0, z1 = i * C, (i + 1) * C
        x0, x1, y0, y1 = -HX + e[0], HX - e[1], -HY + e[2], HY - e[3]
        b = len(verts)
        verts += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces += [(b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5), (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]
    k._add(bo.new_mesh_object("p", verts, faces, smooth=False), face, 1.0)
    k.box((2 * HX - 0.05, 2 * HY - 0.05, N * C), (0, 0, N * C / 2), core_m, w=0.1)
    # first real course: rows along X, a corner already carried away
    BL, BW, BH = 0.24, 0.115, 0.07
    z = N * C + BH / 2
    items = []
    for r in range(8):
        y = -HY + 0.0625 + r * 0.125
        for c in range(6):
            x = -HX + 0.125 + c * 0.25
            drop = C if x > 0.3 and y < -0.1 and (x - 0.3) * 0.8 + (-0.1 - y) > 0.22 else 0.0
            items.append(((BL, BW, BH), (x + rng.uniform(-0.004, 0.004), y + rng.uniform(-0.003, 0.003), z - drop + (0.003 if drop else 0.0))))
    # second course, part laid, bricks turned across the first
    z += C
    for c in range(6):
        x = -HX + 0.0625 + c * 0.125
        for r in range(4):
            y = -HY + 0.125 + r * 0.25
            if c >= 4 and r <= 1:
                continue
            items.append(((BW, BL, BH), (x + rng.uniform(-0.003, 0.003), y + rng.uniform(-0.004, 0.004), z)))
    k.boxes(items, loose, w=1.0)
    # strays at the foot
    for x, y, zz, yaw, tilt in ((0.98, -0.22, 0.035, 0.5, 0.0), (0.92, 0.1, 0.035, 2.2, 0.0), (-0.95, -0.28, 0.035, -0.4, 0.0), (0.62, -0.72, 0.035, 0.15, 0.0), (0.85, -0.42, 0.07, 1.1, 0.42)):
        k.box((BL, BW, BH), (x, y, zz), loose, rot=(tilt, 0, yaw))
    k.box((0.12, BW, BH), (-0.42, -0.68, 0.035), loose, rot=(0, 0, 0.9))
    k.preview((1.9, -3.5, 1.6), (0, 0, 0.5), 34, "front")
    k.preview((-2.9, 1.5, 2.1), (0, 0, 0.5), 34, "back")
    _finish_small(k, ao_dist=0.18, ao_strength=0.8, angle=60.0, ref=(1.3, 0.75))


@asset("tin_hoarding")
def build_tin_hoarding():
    """Construction-site fence: 6 m of patchy corrugated sheets nailed to bamboo posts and rails.
    Runs along X, centred on the origin. The street side faces -Y."""
    k = Kit("tin_hoarding", "props")
    rng = random.Random(29)
    tins = [rusty_tin("th_rust", rgb("#7d5f47"), rust=0.95, fade=0.3), rusty_tin("th_zinc", rgb("#9a9c98"), rust=0.5, metallic=0.3), rusty_tin("th_blue", rgb("#3f6f94"), rust=0.5, fade=0.6),
            rusty_tin("th_green", rgb("#55795a"), rust=0.6, fade=0.6), rusty_tin("th_red", rgb("#a0503a"), rust=0.65, fade=0.55)]
    post = bamboo("th_post", rgb("#9c8650"))
    rail = bamboo("th_rail", rgb("#8c7a4e"), node=0.37)
    lash = flat("th_lash", rgb("#6a5a3f"), rough=0.95)
    Y = -0.02  # shifts the whole fence so it stays centred on the origin in depth
    # bamboo first: rails behind the tin, posts behind the rails
    for x in (-2.95, -1.47, 0.0, 1.48, 2.95):
        top = 2.2 - rng.uniform(0.0, 0.08)
        k.tube([(x, Y + 0.075, 0.0), (x + rng.uniform(-0.012, 0.012), Y + 0.075 + rng.uniform(-0.01, 0.01), top * 0.5), (x, Y + 0.075, top)], 0.042, post, seg=5)
        for z in (0.42, 1.24, 2.0):
            k.cyl(0.07, 0.08, (x, Y + 0.03, z), lash, seg=3, rot=(rng.uniform(-0.5, 0.5), 0, 0))
    for z in (0.42, 1.24, 2.0):
        k.rod((-3.0, Y, z), (0.2, Y, z + rng.uniform(-0.015, 0.015)), 0.028, rail, seg=5)
        k.rod((-0.2, Y, z + 0.02), (3.0, Y, z + 0.02), 0.028, rail, seg=5)
    # seven sheets, each a different age, hung a little unevenly
    order = (0, 1, 0, 2, 4, 1, 3)
    w_, lap = 0.9, 0.05
    tallest = 3
    for i, m in enumerate(order):
        x0 = -3.0 + i * (w_ - lap)
        z0 = rng.uniform(0.01, 0.05)
        h = 2.2 - z0 if i == tallest else 2.2 - z0 - rng.uniform(0.02, 0.17)
        _corrugated(k, (x0, Y - 0.05 - 0.012 * (i % 2), z0), (1, 0, 0), (rng.uniform(-0.006, 0.006), 0, 1), w_, h, tins[m], pitch=0.115, amp=0.012,
                    phase=rng.uniform(0, 3.0), curl=0.07 if i in (2, 5) else 0.0, skew=rng.uniform(-0.02, 0.02))
    # patches where sheets have rusted through
    _corrugated(k, (-1.35, Y - 0.082, 0.28), (1, 0, 0), (0, 0, 1), 0.46, 0.58, tins[1], pitch=0.115, amp=0.011, phase=0.5)
    _corrugated(k, (1.05, Y - 0.082, 1.2), (1, 0, 0), (0, 0, 1), 0.46, 0.5, tins[0], pitch=0.115, amp=0.011, phase=1.5)
    k.preview((2.2, -8.2, 2.0), (0, 0, 1.1), 34, "front")
    k.preview((-3.2, 4.2, 1.7), (-0.4, 0, 1.1), 34, "back")
    _finish_small(k, ao_dist=0.2, ao_strength=0.3, cull=False, ref=(1.4, -0.9))


@asset("bunting")
def build_bunting():
    """Festive paper pennants on two sagging strings across a street: -10 to +10 m along X, string ends
    at 6.5 m above the origin, about 0.8 m of sag, a pennant every 0.6 m. Double-sided material."""
    k = Kit("bunting", "props")
    rng = random.Random(31)
    colors = ("#c8322b", "#e3a51f", "#2a7f4f", "#2a5fa8", "#d9612a", "#b53a8a", "#e8d44a", "#2f9fb0")
    mats = [paper(f"bt_p{i}", rgb(c)) for i, c in enumerate(colors)]
    twine = flat("bt_twine", rgb("#b8ad94"), rough=0.9)
    L, Z, PW, PH = 10.0, 6.5, 0.3, 0.36
    bins = [([], []) for _ in mats]
    for si, (y0, sag, off) in enumerate(((-0.42, 0.8, 0.0), (0.42, 0.74, 0.3))):
        def sz(x, sag=sag):
            return Z - sag * (1.0 - (x / L) ** 2)

        def sy(x, y0=y0, si=si):
            return y0 + 0.05 * math.sin(x * 0.31 + si * 2.0)
        pts = [(-L + i * 2 * L / 24, sy(-L + i * 2 * L / 24), sz(-L + i * 2 * L / 24)) for i in range(25)]
        _wire(k, pts, 0.006, twine, seg=3, w=0.5, chunks=8)
        for i in range(33):
            x = -L + 0.3 + off + i * 0.6
            if x > L - 0.1:
                continue
            j = (i * 3 + si * 5 + (1 if rng.random() < 0.15 else 0)) % len(mats)
            vs, fs = bins[j]
            fl = rng.uniform(-0.05, 0.05)
            tip = rng.uniform(-0.03, 0.03)
            ph = PH * rng.uniform(0.95, 1.05)
            b = len(vs)
            vs += [(x - PW / 2, sy(x - PW / 2), sz(x - PW / 2) - 0.004), (x + PW / 2, sy(x + PW / 2), sz(x + PW / 2) - 0.004),
                   (x + PW * 0.26 + tip * 0.5, sy(x) + fl * 0.45, sz(x) - ph * 0.5), (x - PW * 0.26 + tip * 0.5, sy(x) + fl * 0.45, sz(x) - ph * 0.5),
                   (x + tip, sy(x) + fl, sz(x) - ph)]
            fs += [(b, b + 1, b + 2, b + 3), (b + 3, b + 2, b + 4)]
    for m, (vs, fs) in zip(mats, bins):
        k._add(bo.new_mesh_object("p", vs, fs, smooth=True), m, 1.0)
    k.preview((3.0, -19.0, 1.7), (0, 0, 5.6), 34, "street")
    k.preview((3.5, -5.0, 3.6), (1.5, 0, 5.8), 34, "close")
    _finish_small(k, ao_dist=0.12, ao_strength=0.3, cull=False, ref=(0.0, -0.5))


@asset("plant_nursery")
def build_plant_nursery():
    """Pavement plant seller's row: clay pots on a low two-step wooden bench, leafy plants of several kinds and heights."""
    k = Kit("plant_nursery", "props")
    rng = random.Random(33)
    plank = wood("pn_plank", rgb("#8a6a45"), axis="x", wear=0.6)
    leg = wood("pn_leg", rgb("#6a4e33"), axis="z", wear=0.3)
    clay = terracotta("pn_clay", rgb("#b4623a"), salt=0.45, moss=0.25)
    clay2 = terracotta("pn_clay2", rgb("#9c5230"), salt=0.6, moss=0.35)
    soil = concrete("pn_soil", c1=rgb("#3e2f22"), c2=rgb("#2b2017"), seam_h=0, drip=0, grime=0, soot=0, dust=0, bevel=0, mottled=1.5)
    stem_m = wood("pn_stem", rgb("#5d4c34"), axis="z", wear=0.2)
    fern = leafy("pn_fern", rgb("#2f6a2b"), rgb("#62a23d"), rgb("#a4b354"))
    palm = leafy("pn_palm", rgb("#3b7a33"), rgb("#7aa83f"), rgb("#b4ba5a"))
    croton = leafy("pn_croton", rgb("#3d6b2b"), rgb("#c9a32c"), rgb("#a8372a"), rough=0.4)
    snake = leafy("pn_snake", rgb("#2b5a35"), rgb("#6e8f4a"), rough=0.45, stretch=(4.0, 4.0, 40.0))
    marigold = leafy("pn_mari", rgb("#e08a1c"), rgb("#efb61f"), rough=0.7)
    rose = leafy("pn_rose", rgb("#c3302c"), rgb("#de5a4a"), rough=0.6)
    leaf_sets = {m.name: ([], [], m) for m in (fern, palm, croton, snake)}
    # low two-step bench
    F, B = 0.22, 0.44
    for y in (-0.38, -0.14):
        k.box((3.0, 0.22, 0.024), (rng.uniform(-0.01, 0.01), y, F - 0.012), plank)
    for y in (0.14, 0.38):
        k.box((3.0, 0.22, 0.024), (rng.uniform(-0.01, 0.01), y, B - 0.012), plank)
    for x in (-1.42, -0.48, 0.48, 1.42):
        k.box((0.05, 0.05, F - 0.024), (x, -0.42, (F - 0.024) / 2), leg)
        k.box((0.05, 0.05, B - 0.024), (x, 0.0, (B - 0.024) / 2), leg)
        k.box((0.05, 0.05, B - 0.024), (x, 0.42, (B - 0.024) / 2), leg)
        k.box((0.04, 0.84, 0.03), (x, 0.0, 0.12), leg)

    def leaves(key):
        return leaf_sets[key.name][0], leaf_sets[key.name][1]

    def bush(x, y, z, h, n, ln, wd, m, spread=0.05):
        k.rod((x, y, z - 0.01), (x + rng.uniform(-0.02, 0.02), y + rng.uniform(-0.02, 0.02), z + h * 0.8), 0.008 + h * 0.008, stem_m, seg=3)
        vs, fs = leaves(m)
        _bush(vs, fs, x, y, z, h, n, ln, wd, rng, spread=spread)

    def areca(x, y, z, h, fronds=9):
        vs, fs = leaves(palm)
        for i in range(fronds):
            a = i * 2.4 + rng.uniform(-0.25, 0.25)
            ca, sa = math.cos(a), math.sin(a)
            base = Vector((x + ca * 0.025, y + sa * 0.025, z))
            ln = h * rng.uniform(0.7, 1.05)
            out = rng.uniform(0.24, 0.5)
            prev = None
            for j in range(7):
                t = j / 6.0
                p = base + Vector((ca * ln * out * t * t, sa * ln * out * t * t, ln * (t - 0.14 * t * t)))
                if prev is not None and j >= 2:
                    d = (p - prev)
                    side = Vector((-sa, ca, 0))
                    wl = 0.13 * (1.15 - t)
                    for sd in (-1, 1):
                        b = len(vs)
                        tip = prev + d * 0.7 + side * sd * wl + Vector((0, 0, -0.018))
                        vs += [tuple(prev), tuple(p), tuple(tip)]
                        fs += [(b, b + 1, b + 2)]
                prev = p
            if i % 3 == 0:
                k.rod(tuple(base), tuple(base + Vector((ca * 0.03, sa * 0.03, ln * 0.36))), 0.008, stem_m, seg=3)

    def sansevieria(x, y, z, h, n=10):
        vs, fs = leaves(snake)
        for i in range(n):
            a = i * 2.4
            ca, sa = math.cos(a), math.sin(a)
            r0 = 0.015 + 0.05 * (i / n)
            b0 = Vector((x + ca * r0, y + sa * r0, z))
            ht = h * rng.uniform(0.6, 1.0)
            lean = Vector((ca, sa, 0)) * rng.uniform(0.03, 0.12)
            side = Vector((-sa, ca, 0)) * rng.uniform(0.018, 0.026)
            mid = b0 + lean * 0.4 + Vector((0, 0, ht * 0.55))
            tip = b0 + lean + Vector((0, 0, ht))
            b = len(vs)
            vs += [tuple(b0 - side * 0.7), tuple(b0 + side * 0.7), tuple(mid + side), tuple(mid - side), tuple(tip)]
            fs += [(b, b + 1, b + 2, b + 3), (b + 3, b + 2, b + 4)]

    def flowers(x, y, z, h, count, m):
        bush(x, y, z, h * 0.9, 18, 0.1, 0.028, fern, spread=0.06)
        for i in range(count):
            a = i * 2.4 + rng.uniform(-0.3, 0.3)
            r = rng.uniform(0.02, 0.09)
            k.sphere(0.028, (x + math.cos(a) * r, y + math.sin(a) * r, z + h * rng.uniform(0.72, 1.06)), m, seg=4, rings=2)

    # rear step: the taller plants
    for x, pr, ph, kind, h, cl in ((-1.22, 0.13, 0.22, "palm", 0.95, clay), (-0.66, 0.11, 0.18, "snake", 0.62, clay2), (-0.14, 0.13, 0.22, "palm", 1.2, clay2),
                                   (0.42, 0.11, 0.18, "snake", 0.72, clay), (0.92, 0.12, 0.2, "croton", 0.72, clay), (1.32, 0.09, 0.15, "fern", 0.4, clay2)):
        y = 0.26 + rng.uniform(-0.03, 0.03)
        _pot(k, x, y, B, pr, ph, cl, soil)
        z = B + ph - 0.012
        if kind == "palm":
            areca(x, y, z, h)
        elif kind == "snake":
            sansevieria(x, y, z, h)
        elif kind == "croton":
            bush(x, y, z, h * 0.85, 34, 0.2, 0.06, croton, spread=0.09)
        else:
            bush(x, y, z, h, 24, 0.18, 0.036, fern, spread=0.07)
    # front step: smaller pots
    for x, pr, ph, kind, h, cl in ((-1.3, 0.085, 0.14, "fern", 0.28, clay2), (-0.9, 0.095, 0.15, "croton", 0.42, clay), (-0.5, 0.085, 0.13, "marigold", 0.3, clay),
                                   (-0.12, 0.095, 0.15, "fern", 0.36, clay), (0.3, 0.09, 0.14, "rose", 0.34, clay2), (0.7, 0.095, 0.15, "croton", 0.36, clay2), (1.12, 0.085, 0.13, "marigold", 0.26, clay)):
        y = -0.27 + rng.uniform(-0.04, 0.04)
        _pot(k, x, y, F, pr, ph, cl, soil)
        z = F + ph - 0.012
        if kind == "croton":
            bush(x, y, z, h, 24, 0.16, 0.05, croton, spread=0.06)
        elif kind == "fern":
            bush(x, y, z, h, 24, 0.18, 0.032, fern, spread=0.06)
        elif kind == "marigold":
            flowers(x, y, z, h, 7, marigold)
        else:
            flowers(x, y, z, h, 6, rose)
    for vs, fs, m in leaf_sets.values():
        k.mesh(vs, fs, m, smooth=False)
    k.empty("vendor", (0.0, 0.85, 0.0))
    k.preview((1.2, -4.2, 1.5), (0, 0, 0.62), 34, "front")
    k.preview((-3.0, -2.4, 2.1), (0, 0, 0.6), 34, "above")
    _finish_small(k, ao_dist=0.2, ao_strength=0.7, cull=False, ref=(1.85, -0.2))


@asset("cable_bundle")
def build_cable_bundle():
    """Dhaka's tangled overhead wires: eight black cables with different sag, one coil, one junction box and
    one more coil hanging on them. The origin is the first pole's attachment point and every cable ends at
    height 0. They run along the game's local +X for 28 m, which is Blender -X: the glTF loader mirrors X."""
    k = Kit("cable_bundle", "props")
    k.ao_ground = False
    rng = random.Random(37)
    black = flat("cb_black", rgb("#131211"), rough=0.55)
    black2 = flat("cb_black2", rgb("#1d1c1a"), rough=0.62)
    dusty = flat("cb_dusty", rgb("#2c2a27"), rough=0.7)
    box_m = painted("cb_box", rgb("#8c9188"), under=rgb("#6c5238"), wear=0.5, rust=0.65, fade=0.35, metallic=0.2, drip=1.0, bevel=0.006, scale=3.0)
    L, SEGS, CHUNK = 28.0, 20, 5
    sags = (0.85, 0.98, 1.1, 1.2, 1.32, 1.45, 1.6, 1.8)
    paths = []
    for i, s in enumerate(sags):
        ph = rng.uniform(0, 6.28)
        a = rng.uniform(0.08, 0.26) * (1 if i % 2 else -1)
        e0, e1 = rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04)
        skew = rng.uniform(0.82, 1.2)
        pts = []
        for j in range(SEGS + 1):
            t = j / SEGS
            bump = math.sin(math.pi * t)
            tq = t ** skew
            z = -s * 4.0 * tq * (1.0 - tq) * (1.0 + 0.05 * math.sin(t * 6.28 + ph))
            y = e0 * (1 - t) + e1 * t + a * bump + 0.035 * math.sin(t * 11.0 + ph) * bump
            pts.append((-L * t, y, z))
        paths.append(pts)
        m = dusty if i == 3 else (black2 if i % 3 == 0 else black)
        r = 0.018 if i in (2, 6) else (0.014 if i % 2 else 0.011)
        _wire(k, pts, r, m, seg=4, w=0.3, chunks=CHUNK)

    def on(i, t):
        p = paths[i][round(t * SEGS)]
        return Vector(p)
    # things that hang on the wires
    a = on(7, 0.3)
    _wire(k, _coil_path((a.x, a.y, a.z - 0.17), 0.2, 2.6, rng, tilt=0.5), 0.009, black, seg=3, w=0.6, chunks=1)
    b = on(5, 0.55)
    k.box((0.16, 0.09, 0.22), (b.x, b.y, b.z - 0.11), box_m, w=3.0)
    k.box((0.13, 0.012, 0.18), (b.x, b.y - 0.05, b.z - 0.11), box_m, w=3.0)
    k.tube([(b.x + 0.04, b.y, b.z - 0.22), (b.x + 0.06, b.y + 0.02, b.z - 0.38), (b.x + 0.015, b.y + 0.01, b.z - 0.5)], 0.007, black, seg=3, w=2.0)
    k.tube([(b.x - 0.04, b.y, b.z - 0.22), (b.x - 0.09, b.y - 0.02, b.z - 0.32), (b.x - 0.14, b.y - 0.01, b.z - 0.3)], 0.007, black2, seg=3, w=2.0)
    c = on(6, 0.8)
    _wire(k, _coil_path((c.x, c.y, c.z - 0.13), 0.15, 2.2, rng, tilt=-0.6), 0.008, black2, seg=3, w=0.6, chunks=1)
    k.preview((-14.0, -21.0, -4.5), (-14.0, 0, -0.8), 34, "span")
    k.preview((-4.0, -5.5, -3.0), (-9.0, 0, -1.0), 34, "close")
    _finish_small(k, ao_dist=0.08, ao_strength=0.35, angle=100.0, ground=False)


# === ASSETS END ===


def main():
    global PREVIEW_DIR
    args = bo.script_args()
    ids = []
    for a in args:
        if a.startswith("--preview-dir="):
            PREVIEW_DIR = a.split("=", 1)[1]
        elif not a.startswith("--"):
            ids.append(a)
    if not ids:
        ids = list(REGISTRY)
    unknown = [i for i in ids if i not in REGISTRY]
    if unknown:
        print("[props] unknown ids:", unknown, " known:", sorted(REGISTRY))
    failures = []
    for i in ids:
        if i not in REGISTRY:
            continue
        fn, _folder = REGISTRY[i]
        bo.reset_scene()
        t0 = time.time()
        random.seed(hash_id(i))
        print(f"[props] === {i} ===")
        try:
            fn()
            print(f"[props] {i} done in {time.time() - t0:.0f}s")
        except Exception:
            traceback.print_exc()
            failures.append(i)
    print("[props] finished. failures:", failures)


def hash_id(s):
    return sum((n + 1) * ord(c) for n, c in enumerate(s))


if __name__ == "__main__":
    main()
