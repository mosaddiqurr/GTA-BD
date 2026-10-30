"""Generates the world's PBR textures with numpy/PIL. All original, no external images.

python tools/textures/build_textures.py

Output in public/assets/textures/:
  asphalt_detail.png   Babylon detail map (R grey, G normalY, B rough, A normalX), tiling
  paver_*.webp         footpath tile set
  facade_*.webp        trim atlas for all generated buildings (8 x 8 cells, see src/world/atlas.ts)
  marking.webp         worn road paint
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "textures")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1971)


# --- tiling noise ------------------------------------------------------------


def fbm(size, beta=2.0, seed=None, low=1):
    """Tileable fractal noise via spectral synthesis, normalised to 0..1."""
    r = np.random.default_rng(seed if seed is not None else rng.integers(1 << 30))
    freq = np.fft.fftfreq(size) * size
    fx, fy = np.meshgrid(freq, freq)
    k = np.sqrt(fx * fx + fy * fy)
    k[0, 0] = 1
    amp = k ** (-beta / 2.0)
    amp[k < low] = 0
    phase = r.uniform(0, 2 * np.pi, (size, size))
    img = np.fft.ifft2(amp * np.exp(1j * phase)).real
    img -= img.min()
    img /= max(img.max(), 1e-6)
    return img


def cellular(size, points=120, seed=None):
    """Tileable Worley noise: returns F1 and F2-F1 (crack/edge mask)."""
    r = np.random.default_rng(seed if seed is not None else rng.integers(1 << 30))
    px = r.uniform(0, size, points)
    py = r.uniform(0, size, points)
    yy, xx = np.mgrid[0:size, 0:size]
    d1 = np.full((size, size), 1e9)
    d2 = np.full((size, size), 1e9)
    for x, y in zip(px, py):
        dx = np.abs(xx - x)
        dx = np.minimum(dx, size - dx)
        dy = np.abs(yy - y)
        dy = np.minimum(dy, size - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        d1 = np.where(closer, d, d1)
    return d1 / d1.max(), (d2 - d1)


def blur(a, radius):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0


def normal_from_height(h, strength=2.0):
    """Tangent-space normal map (OpenGL +Y) from a height field, wrapped."""
    dx = np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)
    dy = np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.dstack((nx / length, ny / length, nz / length)) * 0.5 + 0.5


def save(path, arr, quality=88, lossless=False):
    arr = np.clip(arr, 0, 1)
    im = Image.fromarray((arr * 255).astype(np.uint8))
    full = os.path.join(OUT, path)
    if path.endswith(".webp"):
        im.save(full, quality=quality, method=5, lossless=lossless)
    else:
        im.save(full, optimize=True)
    print(f"{path}: {os.path.getsize(full) / 1024:.0f} KB")


def lerp(a, b, t):
    return a + (b - a) * t


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# --- road and footpath ----------------------------------------------------------


def build_asphalt():
    s = 1024
    # Aggregate: fine stones in bitumen.
    d1, edge = cellular(s, points=2600, seed=11)
    stones = sstep(0.0, 3.2, edge)
    fine = fbm(s, 0.9, seed=12)
    mid = fbm(s, 1.8, seed=13)
    big = fbm(s, 2.6, seed=14)
    height = stones * 0.55 + fine * 0.3 + mid * 0.15
    grey = 0.5 + (stones - 0.5) * 0.24 + (fine - 0.5) * 0.30 + (big - 0.5) * 0.16
    rough = 0.5 + (0.5 - stones) * 0.22 + (fine - 0.5) * 0.2 + (mid - 0.5) * 0.2
    n = normal_from_height(height, strength=3.0)
    out = np.dstack((grey, n[:, :, 1], rough, n[:, :, 0]))
    save("asphalt_detail.png", out)


def build_paver():
    """Worn interlocking footpath pavers, the usual Dhaka footpath, tiling at 2 m."""
    s = 1024
    n_tiles = 8
    cell = s // n_tiles
    yy, xx = np.mgrid[0:s, 0:s]
    # Running-bond offset every second row.
    row = yy // cell
    shift = (row % 2) * (cell // 2)
    u = (xx + shift) % cell
    v = yy % cell
    bevel = 7.0
    d = np.minimum(np.minimum(u, cell - 1 - u), np.minimum(v, cell - 1 - v))
    top = sstep(0.0, bevel, d)

    tile_id = ((xx + shift) // cell) + row * 97
    r = np.random.default_rng(5)
    tone = r.uniform(0.9, 1.05, tile_id.max() + 2)[tile_id]
    tilt_x = r.uniform(-0.015, 0.015, tile_id.max() + 2)[tile_id]
    tilt_y = r.uniform(-0.015, 0.015, tile_id.max() + 2)[tile_id]
    fine = fbm(s, 1.1, seed=21)
    blot = fbm(s, 2.4, seed=22)
    pores = sstep(0.72, 0.9, fbm(s, 0.6, seed=23))
    _, crack_edge = cellular(s, points=26, seed=24)
    cracks = 1.0 - sstep(0.0, 1.6, crack_edge)
    cracks *= sstep(0.55, 0.7, fbm(s, 2.0, seed=25))

    height = top * 0.65 + (fine - 0.5) * 0.12 - pores * 0.08 - cracks * 0.25 + tilt_x * (u / cell) * 8 + tilt_y * (v / cell) * 8
    # Sun-baked concrete under a film of city dust; joints fill with dirt rather than going black.
    base = np.dstack((0.56 * np.ones((s, s)), 0.515 * np.ones((s, s)), 0.46 * np.ones((s, s))))
    albedo = base * (tone * (0.8 + 0.3 * fine) * (0.8 + 0.34 * blot))[..., None]
    grime = (1 - top) * 0.5 + cracks * 0.55 + pores * 0.2
    albedo *= (1 - grime * 0.7)[..., None]
    rough = np.clip(0.88 + (fine - 0.5) * 0.15 - (1 - blot) * 0.1, 0, 1)
    orm = np.dstack((np.clip(0.55 + top * 0.45, 0, 1), rough, np.zeros((s, s))))
    save("paver_albedo.webp", albedo)
    save("paver_normal.webp", normal_from_height(height, 2.4))
    save("paver_orm.webp", orm)


def build_marking():
    """Worn road paint: white with scuffs. Alpha carries the wear so the asphalt shows through."""
    s = 512
    a = fbm(s, 1.5, seed=31)
    b = fbm(s, 2.8, seed=32)
    wear = sstep(0.3, 0.55, a * 0.6 + b * 0.5)
    color = np.dstack((np.full((s, s), 0.82), np.full((s, s), 0.80), np.full((s, s), 0.74)))
    color *= (0.82 + 0.25 * a)[..., None]
    out = np.dstack((color, wear * 0.95))
    save("marking.webp", out, quality=80)


# --- facade atlas ----------------------------------------------------------------

CELL = 512
GRID = 8
ATLAS = CELL * GRID


class Cell:
    """One atlas cell's layers, each a float array in 0..1."""

    def __init__(self, size=CELL):
        self.s = size
        self.albedo = np.ones((size, size, 3), np.float32) * 0.5
        self.alpha = np.ones((size, size), np.float32)
        self.height = np.zeros((size, size), np.float32)
        self.rough = np.ones((size, size), np.float32) * 0.8
        self.metal = np.zeros((size, size), np.float32)
        self.emit = np.zeros((size, size, 3), np.float32)
        self.ao = np.ones((size, size), np.float32)


atlas = {}


def rect(c, x0, y0, x1, y1, color=None, h=None, r=None, m=None, e=None, a=None):
    """Fill a rectangle given in 0..1 cell coordinates (y down)."""
    s = c.s
    i0, i1 = int(y0 * s), int(y1 * s)
    j0, j1 = int(x0 * s), int(x1 * s)
    if color is not None:
        c.albedo[i0:i1, j0:j1] = color
    if h is not None:
        c.height[i0:i1, j0:j1] = h
    if r is not None:
        c.rough[i0:i1, j0:j1] = r
    if m is not None:
        c.metal[i0:i1, j0:j1] = m
    if e is not None:
        c.emit[i0:i1, j0:j1] = e
    if a is not None:
        c.alpha[i0:i1, j0:j1] = a


def wall_base(tint=(0.86, 0.85, 0.82), stain=0.0, grain=0.14, rough=0.9, seed=None):
    """Neutral plaster; buildings tint it with vertex colour. `stain` adds monsoon streaks."""
    c = Cell()
    s = c.s
    fine = fbm(s, 1.3, seed=seed)
    blot = fbm(s, 2.5)
    c.height = fine * 0.5 + blot * 0.2
    shade = 1 + (fine - 0.5) * grain + (blot - 0.5) * grain * 1.2
    if stain > 0:
        # Vertical streaks: stretch 1D noise down the wall and break them up.
        # Soft monsoon runs: broad bands, broken up by blotches and fading down the wall.
        streak = np.tile(fbm(s, 2.6, seed=(seed or 3) + 1)[0], (s, 1))
        breakup = fbm(s, 2.4, seed=(seed or 3) + 2)
        drip = sstep(0.5, 0.95, streak) * (0.25 + 0.75 * sstep(0.3, 0.75, breakup))
        fade = np.linspace(1.0, 0.5, s)[:, None]
        shade *= 1 - drip * fade * stain * 0.62
        mold = sstep(0.6, 0.86, fbm(s, 2.6)) * stain * 0.3
        shade *= 1 - mold
    c.albedo = np.dstack([np.full((s, s), t) * shade for t in tint]).astype(np.float32)
    c.rough = np.full((s, s), rough, np.float32) + (fine - 0.5) * 0.1
    return c


def cell_concrete():
    c = wall_base((0.56, 0.55, 0.53), stain=0.7, grain=0.26, seed=41)
    s = c.s
    # Formwork lines and tie holes.
    for k in range(1, 4):
        y = int(k * s / 4)
        c.albedo[y - 1 : y + 1] *= 0.72
        c.height[y - 1 : y + 1] -= 0.2
    for k in range(1, 4):
        x = int(k * s / 4)
        c.albedo[:, x - 1 : x + 1] *= 0.82
    return c


def cell_brick():
    c = Cell()
    s = c.s
    rows, cols = 22, 11
    yy, xx = np.mgrid[0:s, 0:s]
    bh, bw = s / rows, s / cols
    row = (yy / bh).astype(int)
    shift = (row % 2) * bw / 2
    u = (xx + shift) % bw
    v = yy % bh
    mortar = np.minimum(np.minimum(u, bw - u), np.minimum(v, bh - v))
    face = sstep(1.0, 3.0, mortar)
    brick_id = ((xx + shift) / bw).astype(int) + row * 53
    r = np.random.default_rng(7)
    tone = r.uniform(0.74, 1.15, brick_id.max() + 2)[brick_id]
    fine = fbm(s, 1.0, seed=42)
    col = np.array([0.46, 0.20, 0.13]) * (tone * (0.8 + 0.4 * fine))[..., None]
    mort = np.array([0.52, 0.5, 0.46])
    c.albedo = lerp(mort[None, None], col, face[..., None]).astype(np.float32)
    c.height = face * 0.8 + fine * 0.2
    c.rough[:] = 0.92
    return c


def cell_tile(size_px=32, grout=(0.5, 0.5, 0.48), tone=(0.86, 0.86, 0.84), jitter=0.06, rough=0.45):
    c = Cell()
    s = c.s
    yy, xx = np.mgrid[0:s, 0:s]
    u, v = xx % size_px, yy % size_px
    d = np.minimum(np.minimum(u, size_px - u), np.minimum(v, size_px - v))
    face = sstep(1.0, 2.5, d)
    tid = (xx // size_px) + (yy // size_px) * 131
    r = np.random.default_rng(size_px)
    t = r.uniform(1 - jitter, 1 + jitter, tid.max() + 2)[tid]
    col = np.array(tone) * t[..., None]
    c.albedo = lerp(np.array(grout)[None, None], col, face[..., None]).astype(np.float32)
    c.height = face
    c.rough = lerp(0.9, rough, face).astype(np.float32)
    return c


def cell_acp():
    """Aluminium composite cladding, the shiny look of newer Mirpur commercial buildings."""
    c = wall_base((0.82, 0.82, 0.82), stain=0.12, grain=0.04, rough=0.32, seed=44)
    s = c.s
    for k in range(0, 3):
        p = int((k + 0.5) * s / 3)
        c.albedo[p - 2 : p + 2] *= 0.35
        c.height[p - 3 : p + 3] = -0.4
        c.albedo[:, p - 2 : p + 2] *= 0.35
        c.height[:, p - 3 : p + 3] = -0.4
    c.metal[:] = 0.55
    return c


def glass_layer(c, x0, y0, x1, y1, base=(0.05, 0.07, 0.08), curtain=None, lit=None):
    """Glass pane: dark and glossy so it picks up sky reflections; curtains sit behind it."""
    s = c.s
    i0, i1, j0, j1 = int(y0 * s), int(y1 * s), int(x0 * s), int(x1 * s)
    h, w = i1 - i0, j1 - j0
    g = np.tile(np.array(base, np.float32), (h, w, 1))
    if curtain is not None:
        folds = np.sin(np.linspace(0, 34, w))[None, :] * 0.5 + 0.5
        drape = 0.6 + 0.4 * folds
        cc = np.array(curtain, np.float32)[None, None] * drape[..., None]
        split = int(w * 0.5)
        gap = int(w * rng.uniform(0.0, 0.1))
        mask = np.ones((h, w), bool)
        if gap > 0:
            mask[:, split - gap : split + gap] = False
        g = np.where(mask[..., None], cc, g)
    c.albedo[i0:i1, j0:j1] = g
    c.rough[i0:i1, j0:j1] = 0.06 if curtain is None else 0.22
    c.height[i0:i1, j0:j1] = 0.0
    if lit is not None:
        c.emit[i0:i1, j0:j1] = g * np.array(lit, np.float32)


def window_cell(kind):
    c = Cell()
    s = c.s
    frame_col = {"grill_a": (0.26, 0.28, 0.27), "grill_b": (0.18, 0.28, 0.25), "slide_a": (0.62, 0.62, 0.6), "slide_b": (0.52, 0.5, 0.46), "dark": (0.34, 0.33, 0.31), "curtain_a": (0.72, 0.7, 0.66), "curtain_b": (0.3, 0.3, 0.3), "office": (0.2, 0.22, 0.24)}[kind]
    c.albedo[:] = np.array(frame_col) * 0.9
    c.height[:] = 1.0
    c.rough[:] = 0.5
    c.metal[:] = 0.3 if kind in ("slide_a", "slide_b", "office") else 0.0
    curtains = {
        "grill_a": ((0.62, 0.48, 0.36), (2.6, 2.1, 1.5)),
        "grill_b": ((0.3, 0.42, 0.52), (2.2, 2.2, 2.0)),
        "slide_a": (None, None),
        "slide_b": ((0.72, 0.68, 0.62), (2.8, 2.5, 1.9)),
        "dark": (None, None),
        "curtain_a": ((0.55, 0.28, 0.24), (2.8, 1.6, 1.2)),
        "curtain_b": ((0.76, 0.72, 0.56), (3.0, 2.6, 1.7)),
        "office": (None, (1.6, 1.8, 2.0)),
    }
    curtain, lit = curtains[kind]
    m = 0.055
    if kind == "office":
        c.albedo[:] = (0.1, 0.14, 0.16)
        glass_layer(c, 0.03, 0.03, 0.97, 0.97, base=(0.06, 0.09, 0.1), lit=(1.4, 1.5, 1.6))
        rect(c, 0.485, 0, 0.515, 1, color=(0.18, 0.2, 0.22), h=1.0, r=0.4, m=0.8, e=(0, 0, 0))
        rect(c, 0, 0.485, 1, 0.515, color=(0.18, 0.2, 0.22), h=1.0, r=0.4, m=0.8, e=(0, 0, 0))
    else:
        glass_layer(c, m, m, 0.5 - 0.012, 1 - m, curtain=curtain, lit=lit)
        glass_layer(c, 0.5 + 0.012, m, 1 - m, 1 - m, curtain=curtain, lit=lit)
    # Burglar grill: the single strongest Dhaka facade signature, painted across the window.
    if kind in ("grill_a", "grill_b"):
        col = (0.09, 0.1, 0.1) if kind == "grill_a" else (0.11, 0.2, 0.17)
        for k in range(1, 8):
            x = k / 8
            rect(c, x - 0.007, 0.03, x + 0.007, 0.97, color=col, h=1.2, r=0.55, m=0.5, e=(0, 0, 0))
        for k in range(1, 6):
            y = k / 6
            rect(c, 0.03, y - 0.007, 0.97, y + 0.007, color=col, h=1.2, r=0.55, m=0.5, e=(0, 0, 0))
    return c


GOODS_PALETTES = {
    "grocery": [(0.8, 0.2, 0.12), (0.9, 0.72, 0.12), (0.12, 0.45, 0.25), (0.9, 0.85, 0.75), (0.15, 0.3, 0.65), (0.75, 0.45, 0.1)],
    "pharmacy": [(0.9, 0.9, 0.92), (0.65, 0.82, 0.92), (0.15, 0.5, 0.75), (0.2, 0.65, 0.45), (0.85, 0.85, 0.7)],
    "mobile": [(0.1, 0.12, 0.16), (0.2, 0.25, 0.4), (0.82, 0.82, 0.88), (0.85, 0.2, 0.3), (0.2, 0.6, 0.85)],
    "clothes": [(0.75, 0.2, 0.35), (0.2, 0.3, 0.6), (0.9, 0.82, 0.6), (0.35, 0.6, 0.45), (0.6, 0.25, 0.6), (0.92, 0.5, 0.25)],
    "tea": [(0.55, 0.32, 0.14), (0.75, 0.55, 0.3), (0.9, 0.85, 0.7), (0.35, 0.2, 0.1), (0.8, 0.3, 0.12)],
    "hardware": [(0.35, 0.36, 0.38), (0.6, 0.6, 0.62), (0.8, 0.5, 0.15), (0.2, 0.3, 0.5), (0.5, 0.2, 0.15)],
    "sweets": [(0.95, 0.9, 0.75), (0.95, 0.75, 0.35), (0.92, 0.55, 0.6), (0.85, 0.85, 0.85), (0.72, 0.42, 0.16)],
    "books": [(0.2, 0.3, 0.55), (0.75, 0.2, 0.18), (0.9, 0.86, 0.72), (0.2, 0.5, 0.35), (0.85, 0.65, 0.2)],
}


def shop_cell(kind, seed):
    """A shop's interior wall, painted to read as packed shelves behind the shutter line."""
    r = np.random.default_rng(seed)
    c = Cell()
    s = c.s
    wall = np.array({"pharmacy": (0.82, 0.86, 0.86), "mobile": (0.74, 0.76, 0.8), "sweets": (0.88, 0.84, 0.72)}.get(kind, (0.55, 0.48, 0.38)))
    c.albedo[:] = wall * 0.6
    c.rough[:] = 0.7
    palette = GOODS_PALETTES[kind]
    shelf_rows = 8
    for row in range(shelf_rows):
        y0 = 0.02 + row * (0.94 / shelf_rows)
        y1 = y0 + 0.94 / shelf_rows
        shelf = 0.016
        # Each shelf is mostly one product family, the way a real shopkeeper stacks stock.
        family = palette[r.integers(len(palette))]
        x = 0.006
        while x < 0.99:
            w = r.uniform(0.008, 0.026)
            h = r.uniform(0.62, 0.95) * (y1 - y0 - shelf)
            base = family if r.random() < 0.72 else palette[r.integers(len(palette))]
            col = np.array(base) * r.uniform(0.55, 1.0)
            x1 = min(x + w, 1.0)
            rect(c, x, y1 - shelf - h, x1, y1 - shelf, color=col * 0.72, h=r.uniform(0.3, 0.8), r=r.uniform(0.25, 0.7))
            # Lit front face, a label stripe and a dark gap give a packed, dimensional read.
            rect(c, x + w * 0.15, y1 - shelf - h, x + w * 0.6, y1 - shelf, color=col)
            if r.random() < 0.6:
                rect(c, x, y1 - shelf - h * 0.62, x1, y1 - shelf - h * 0.34, color=np.clip(col * 0.6 + 0.35, 0, 1))
            x += w + r.uniform(0.0, 0.003)
        rect(c, 0.0, y1 - shelf, 1.0, y1, color=(0.2, 0.14, 0.09), h=0.9, r=0.6)
        rect(c, 0.0, y0, 1.0, y0 + 0.008, color=(0.03, 0.03, 0.03))
    if kind == "clothes":
        # Hanging garments replace the upper shelves.
        for k in range(30):
            x = k / 30
            col = np.array(palette[r.integers(len(palette))]) * r.uniform(0.6, 1.0)
            rect(c, x + 0.002, 0.02, x + 0.032, r.uniform(0.3, 0.55), color=col, h=0.8, r=0.85)
            rect(c, x + 0.016, 0.02, x + 0.022, r.uniform(0.3, 0.55), color=col * 0.6)
    # Darkens towards the corners, because the back of a shop never sees the sun.
    yy, xx = np.mgrid[0:s, 0:s] / s
    vig = 0.62 + 0.38 * np.minimum(1, 4 * xx * (1 - xx) * 1.2) * np.minimum(1, 3.6 * yy * (1.15 - yy))
    c.albedo = (c.albedo * vig[..., None]).astype(np.float32)
    # Fluorescent tube-light wash for night; the top of the room is brightest.
    wash = np.linspace(1.3, 0.7, s)[:, None, None]
    c.emit = c.albedo * wash * 0.9
    return c


def cell_shutter(painted=False):
    c = Cell()
    s = c.s
    yy = np.arange(s)
    ribs = np.sin(yy / s * 2 * math.pi * 26) * 0.5 + 0.5
    c.height = np.tile(ribs[:, None], (1, s)) * 0.8
    base = np.array((0.52, 0.53, 0.54) if not painted else (0.26, 0.38, 0.5))
    rust = sstep(0.55, 0.75, fbm(s, 1.9, seed=61))
    streak = np.tile(fbm(s, 1.2, seed=62)[0], (s, 1))
    dirt = 0.72 + 0.3 * streak + (ribs[:, None] - 0.5) * 0.3
    c.albedo = (base[None, None] * dirt[..., None]).astype(np.float32)
    c.albedo = lerp(c.albedo, np.array((0.28, 0.14, 0.07))[None, None], (rust * 0.7)[..., None]).astype(np.float32)
    c.rough = (0.55 + rust * 0.4).astype(np.float32)
    c.metal = ((1 - rust) * 0.6).astype(np.float32)
    return c


def cell_awning():
    c = Cell()
    s = c.s
    xx = np.arange(s)
    stripe = ((xx / s * 6).astype(int) % 2).astype(np.float32)
    cols = lerp(np.array((0.92, 0.92, 0.9))[None], np.array((0.62, 0.62, 0.62))[None], stripe[:, None])
    fine = fbm(s, 1.5, seed=63)
    streak = np.tile(fbm(s, 1.2, seed=64)[0], (s, 1))
    c.albedo = (cols[None, :, :] * (0.72 + 0.3 * fine + 0.2 * streak)[..., None]).astype(np.float32)
    c.height = fine * 0.3
    c.rough[:] = 0.85
    return c


def cell_tarp():
    c = Cell()
    s = c.s
    fine = fbm(s, 1.8, seed=65)
    weave = (np.sin(np.arange(s) * 1.6)[None, :] * np.sin(np.arange(s) * 1.6)[:, None]) * 0.5 + 0.5
    col = np.array((0.08, 0.24, 0.52))
    c.albedo = (col[None, None] * (0.6 + 0.7 * fine)[..., None] * (0.92 + 0.1 * weave)[..., None]).astype(np.float32)
    c.height = fine * 0.8 + weave * 0.1
    c.rough[:] = 0.55
    return c


def cell_metal(tint=(0.8, 0.8, 0.8), rust=0.15):
    c = wall_base(tint, stain=0.2, grain=0.1, rough=0.45, seed=66)
    s = c.s
    rm = sstep(0.66 - rust * 0.5, 0.9 - rust * 0.5, fbm(s, 2.1, seed=67))
    c.albedo = lerp(c.albedo, np.array((0.27, 0.13, 0.06))[None, None], (rm * 0.85)[..., None]).astype(np.float32)
    c.rough = (0.42 + rm * 0.5).astype(np.float32)
    c.metal = ((1 - rm) * 0.55).astype(np.float32)
    return c


def cell_wood():
    c = Cell()
    s = c.s
    grain = np.tile(fbm(s, 1.0, seed=68)[:, s // 3][:, None], (1, s))
    grain = lerp(grain, fbm(s, 1.4, seed=69), 0.35)
    col = lerp(np.array((0.20, 0.11, 0.06))[None, None], np.array((0.46, 0.29, 0.16))[None, None], grain[..., None])
    c.albedo = col.astype(np.float32)
    c.height = grain
    c.rough[:] = 0.75
    for k in range(1, 5):
        x = int(k * s / 5)
        c.albedo[:, x - 1 : x + 2] *= 0.3
        c.height[:, x - 1 : x + 2] = -0.5
    return c


def cell_door():
    c = cell_metal((0.26, 0.2, 0.15), rust=0.08)
    rect(c, 0.08, 0.06, 0.92, 0.44, color=(0.3, 0.23, 0.17), h=0.6)
    rect(c, 0.08, 0.5, 0.92, 0.94, color=(0.3, 0.23, 0.17), h=0.6)
    rect(c, 0.82, 0.46, 0.88, 0.5, color=(0.8, 0.75, 0.55), h=1.0, r=0.3, m=1.0)
    return c


def cell_ac():
    c = cell_metal((0.82, 0.82, 0.79), rust=0.1)
    s = c.s
    yy, xx = np.mgrid[0:s, 0:s]
    d = np.sqrt((xx - s * 0.38) ** 2 + (yy - s * 0.5) ** 2)
    fan = d < s * 0.31
    rings = np.sin(d * 0.55) > 0.1
    c.albedo[fan] = np.where(rings[fan][..., None], 0.12, 0.3) * np.array((1, 1, 1))
    c.height[fan] = rings[fan] * 0.5
    rect(c, 0.78, 0.1, 0.94, 0.9, color=(0.6, 0.6, 0.58), h=0.5)
    return c


def cell_roof():
    c = wall_base((0.34, 0.33, 0.31), stain=0.5, grain=0.3, rough=0.95, seed=71)
    return c


def cell_curtainwall():
    c = Cell()
    # Reflective tinted glass reflects the sky; metallic with a mid value keeps it from going black.
    c.albedo[:] = (0.34, 0.47, 0.52)
    c.rough[:] = 0.07
    c.metal[:] = 0.92
    c.height[:] = 0.0
    wash = fbm(c.s, 2.8, seed=72)
    c.emit = (sstep(0.55, 0.72, wash)[..., None] * np.array((0.7, 0.8, 0.9))).astype(np.float32) * 0.5
    for k in range(0, 4):
        p = k / 4
        rect(c, 0, p, 1, p + 0.012, color=(0.2, 0.22, 0.24), h=1.0, r=0.4, m=0.9, e=(0, 0, 0))
        rect(c, p, 0, p + 0.012, 1, color=(0.2, 0.22, 0.24), h=1.0, r=0.4, m=0.9, e=(0, 0, 0))
    return c


def cell_vinyl(color_a, color_b, seed):
    """Printed vinyl banner with blurred blocks, used where no Bangla text is needed."""
    c = Cell()
    s = c.s
    r = np.random.default_rng(seed)
    t = np.tile(np.linspace(0, 1, s)[:, None], (1, s))
    c.albedo = lerp(np.array(color_a)[None, None], np.array(color_b)[None, None], t[..., None]).astype(np.float32)
    for _ in range(9):
        x0, y0 = r.uniform(0, 0.8), r.uniform(0, 0.85)
        rect(c, x0, y0, x0 + r.uniform(0.1, 0.4), y0 + r.uniform(0.05, 0.14), color=np.clip(np.array(color_b) + r.uniform(0.2, 0.6), 0, 1))
    streak = np.tile(fbm(s, 1.2, seed=seed + 1)[0], (s, 1))
    c.albedo *= (0.8 + 0.3 * streak)[..., None]
    c.rough[:] = 0.6
    return c


def alpha_rail(ornate=False):
    c = Cell()
    s = c.s
    c.alpha[:] = 0
    col = (0.1, 0.11, 0.1) if not ornate else (0.14, 0.2, 0.2)
    # Rails occupy the cell's bottom half pattern: top and bottom bars with balusters.
    rect(c, 0, 0.02, 1, 0.07, color=col, a=1, r=0.5, m=0.4, h=1)
    rect(c, 0, 0.93, 1, 0.98, color=col, a=1, r=0.5, m=0.4, h=1)
    n = 16 if not ornate else 12
    for k in range(n):
        x = (k + 0.5) / n
        rect(c, x - 0.009, 0.05, x + 0.009, 0.95, color=col, a=1, r=0.5, m=0.4, h=1)
    if ornate:
        for k in range(n):
            x = (k + 0.5) / n
            yy, xx = np.mgrid[0:s, 0:s]
            d = np.sqrt((xx - x * s) ** 2 + (yy - 0.5 * s) ** 2)
            ring = np.abs(d - s * 0.032) < 3
            c.alpha[ring] = 1
            c.albedo[ring] = col
    return c


def alpha_laundry(seed):
    """Clothes on a line, a daily-life signature on every Dhaka balcony."""
    r = np.random.default_rng(seed)
    c = Cell()
    s = c.s
    c.alpha[:] = 0
    rect(c, 0, 0.02, 1, 0.03, color=(0.1, 0.1, 0.1), a=1)
    palette = [(0.75, 0.15, 0.15), (0.15, 0.25, 0.55), (0.9, 0.88, 0.8), (0.25, 0.5, 0.3), (0.85, 0.55, 0.15), (0.55, 0.2, 0.5), (0.2, 0.2, 0.22)]
    x = 0.02
    while x < 0.95:
        w = r.uniform(0.09, 0.2)
        h = r.uniform(0.35, 0.8)
        col = np.array(palette[r.integers(len(palette))])
        im = Image.new("L", (s, s), 0)
        d = ImageDraw.Draw(im)
        px0, px1 = int(x * s), int((x + w) * s)
        d.polygon([(px0, int(0.03 * s)), (px1, int(0.03 * s)), (px1 - int(r.uniform(0, 0.03) * s), int(h * s)), (px0 + int(r.uniform(0, 0.03) * s), int(h * s))], fill=255)
        m = np.asarray(im) > 0
        fold = np.tile(np.sin(np.arange(s) / s * r.uniform(40, 90))[None, :] * 0.14 + 0.92, (s, 1))
        c.albedo[m] = (col[None, None] * fold[..., None])[m]
        c.alpha[m] = 1
        c.height[m] = fold[m]
        c.rough[m] = 0.9
        x += w + r.uniform(0.01, 0.05)
    return c


def alpha_plants(seed=81):
    r = np.random.default_rng(seed)
    c = Cell()
    s = c.s
    c.alpha[:] = 0
    im = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(im)
    for _ in range(900):
        x, y = r.uniform(0.02, 0.98) * s, r.uniform(0.05, 0.72) * s
        a = r.uniform(0, 6.28)
        l = r.uniform(6, 20)
        d.line([(x, y), (x + math.cos(a) * l, y + math.sin(a) * l)], fill=255, width=int(r.uniform(3, 6)))
    m = np.asarray(im) > 0
    tone = fbm(s, 1.4, seed=seed)
    c.albedo = lerp(np.array((0.05, 0.2, 0.05))[None, None], np.array((0.25, 0.5, 0.12))[None, None], tone[..., None]).astype(np.float32)
    c.alpha[m] = 1
    c.height = tone
    # Pots along the bottom.
    for k in range(5):
        x = 0.04 + k * 0.2
        rect(c, x, 0.72, x + 0.14, 0.98, color=(0.42, 0.2, 0.12), a=1, r=0.85)
    return c


def alpha_mesh():
    c = Cell()
    s = c.s
    c.alpha[:] = 0
    yy, xx = np.mgrid[0:s, 0:s]
    a = ((xx + yy) % 26) < 3
    b = ((xx - yy) % 26) < 3
    m = a | b
    c.alpha[m] = 1
    c.albedo[m] = (0.3, 0.3, 0.3)
    c.metal[m] = 0.7
    c.rough[m] = 0.5
    return c


def cell_far(seed, win_col, frame_col, balcony=False):
    """Whole facade painted flat for far buildings: 4 bays by 6 floors on neutral plaster."""
    r = np.random.default_rng(seed)
    c = wall_base(stain=0.55, grain=0.2, seed=seed)
    s = c.s
    for fl in range(6):
        y0 = fl / 6
        rect(c, 0, y0 + 0.002, 1, y0 + 0.012, color=np.array((0.5, 0.48, 0.45)), h=0.2)
        for b in range(4):
            x0 = b / 4
            lit = r.random()
            col = np.array(win_col) * r.uniform(0.6, 1.25)
            rect(c, x0 + 0.04, y0 + 0.045, x0 + 0.21, y0 + 0.13, color=np.array(frame_col))
            e = (2.2, 1.8, 1.2) if lit < 0.45 else (0, 0, 0)
            rect(c, x0 + 0.05, y0 + 0.052, x0 + 0.2, y0 + 0.124, color=col, h=0.0, r=0.2, e=col * np.array(e))
            # Shade band under the sun-shade lip, a cheap stand-in for real relief.
            rect(c, x0 + 0.03, y0 + 0.036, x0 + 0.22, y0 + 0.045, color=np.array((0.3, 0.29, 0.28)))
            if balcony and b % 2 == 1:
                rect(c, x0 + 0.02, y0 + 0.11, x0 + 0.23, y0 + 0.155, color=np.array((0.42, 0.42, 0.4)))
    return c


def compose():
    cells = {
        (0, 0): wall_base(stain=0.15, seed=101),
        (1, 0): wall_base(stain=0.5, seed=102),
        (2, 0): wall_base(stain=0.95, grain=0.22, seed=103),
        (3, 0): cell_concrete(),
        (4, 0): cell_brick(),
        (5, 0): cell_tile(16, tone=(0.75, 0.75, 0.74), jitter=0.12, rough=0.4),
        (6, 0): cell_tile(64, tone=(0.86, 0.86, 0.84), jitter=0.03, rough=0.25),
        (7, 0): cell_acp(),
        (0, 1): window_cell("grill_a"),
        (1, 1): window_cell("grill_b"),
        (2, 1): window_cell("slide_a"),
        (3, 1): window_cell("slide_b"),
        (4, 1): window_cell("dark"),
        (5, 1): window_cell("curtain_a"),
        (6, 1): window_cell("curtain_b"),
        (7, 1): window_cell("office"),
        (0, 2): shop_cell("grocery", 1),
        (1, 2): shop_cell("pharmacy", 2),
        (2, 2): shop_cell("mobile", 3),
        (3, 2): shop_cell("clothes", 4),
        (4, 2): shop_cell("tea", 5),
        (5, 2): shop_cell("hardware", 6),
        (6, 2): shop_cell("sweets", 7),
        (7, 2): shop_cell("books", 8),
        (0, 3): cell_shutter(False),
        (1, 3): cell_shutter(True),
        (2, 3): cell_awning(),
        (3, 3): cell_tarp(),
        (4, 3): cell_metal((0.82, 0.82, 0.82), 0.1),
        (5, 3): cell_metal((0.34, 0.2, 0.12), 0.5),
        (6, 3): cell_wood(),
        (7, 3): cell_door(),
        (0, 4): cell_ac(),
        (1, 4): cell_tile(40, tone=(0.6, 0.5, 0.4), jitter=0.12, rough=0.5),
        (2, 4): cell_roof(),
        (3, 4): wall_base((0.2, 0.2, 0.2), stain=0.3, grain=0.25, rough=0.9, seed=105),
        (4, 4): cell_curtainwall(),
        (5, 4): cell_vinyl((0.72, 0.1, 0.12), (0.92, 0.5, 0.1), 91),
        (6, 4): cell_vinyl((0.05, 0.3, 0.55), (0.05, 0.6, 0.45), 92),
        (7, 4): cell_vinyl((0.92, 0.82, 0.25), (0.8, 0.25, 0.2), 93),
        (0, 5): alpha_rail(False),
        (1, 5): alpha_rail(True),
        (2, 5): alpha_laundry(201),
        (3, 5): alpha_laundry(202),
        (4, 5): alpha_plants(),
        (5, 5): alpha_mesh(),
        (6, 5): cell_far(301, (0.09, 0.12, 0.13), (0.4, 0.4, 0.38)),
        (7, 5): cell_far(302, (0.18, 0.15, 0.13), (0.28, 0.27, 0.26), balcony=True),
    }
    albedo = np.zeros((ATLAS, ATLAS, 4), np.float32)
    height = np.zeros((ATLAS, ATLAS), np.float32)
    orm = np.zeros((ATLAS, ATLAS, 3), np.float32)
    emit = np.zeros((ATLAS, ATLAS, 3), np.float32)
    orm[..., 0] = 1
    orm[..., 1] = 0.9
    albedo[..., 3] = 1
    for (cx, cy), c in cells.items():
        y0, x0 = cy * CELL, cx * CELL
        albedo[y0 : y0 + CELL, x0 : x0 + CELL, :3] = np.clip(c.albedo, 0, 1)
        albedo[y0 : y0 + CELL, x0 : x0 + CELL, 3] = c.alpha
        height[y0 : y0 + CELL, x0 : x0 + CELL] = c.height
        orm[y0 : y0 + CELL, x0 : x0 + CELL, 0] = c.ao
        orm[y0 : y0 + CELL, x0 : x0 + CELL, 1] = np.clip(c.rough, 0.03, 1)
        orm[y0 : y0 + CELL, x0 : x0 + CELL, 2] = np.clip(c.metal, 0, 1)
        emit[y0 : y0 + CELL, x0 : x0 + CELL] = np.clip(c.emit, 0, 1)
    save("facade_albedo.webp", albedo, quality=86)
    n = normal_from_height(height, 2.2)
    half = lambda a: np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS)).astype(np.float32) / 255
    save("facade_normal.webp", half(n), quality=84)
    save("facade_orm.webp", half(orm), quality=82)
    save("facade_emissive.webp", np.asarray(Image.fromarray((emit * 255).astype(np.uint8)).resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS)).astype(np.float32) / 255, quality=78)


if __name__ == "__main__":
    import sys

    # Pass names to rebuild only some sets; the asphalt alone takes a few minutes.
    wanted = sys.argv[1:] or ["asphalt", "paver", "marking", "facade"]
    if "asphalt" in wanted:
        build_asphalt()
    if "paver" in wanted:
        build_paver()
    if "marking" in wanted:
        build_marking()
    if "facade" in wanted:
        compose()
