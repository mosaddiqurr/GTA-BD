"""Makes extra outfits for the crowd: each character's albedo with the clothes recoloured.

The clothes are found from the model itself: any triangle moved by the body, arm or leg bones is
clothing, and the fruit, hands and shoes are left alone. So no eyes, faces or fruit skins ever change.

Usage: python tools/textures/build_outfits.py
Writes public/assets/characters/<id>__a_albedo.webp and __b_albedo.webp
"""
import colorsys
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

CHAR_DIR = Path("public/assets/characters")
CLOTH_BONES = {"hips", "spine", "chest", "upperarm.L", "forearm.L", "upperarm.R", "forearm.R", "thigh.L", "shin.L", "thigh.R", "shin.R"}

# Hue turn in degrees, saturation and brightness multipliers, what near-white cloth takes on, and what
# near-black cloth lifts towards. Chosen per character so a crowd doesn't repeat the same two palettes.
OUTFITS = {
    "npc_student_lemon": [(-105, 1.05, 1.0, (0.78, 0.86, 1.0), (0.04, 0.05, 0.12)), (115, 0.95, 1.0, (1.0, 0.86, 0.78), (0.11, 0.08, 0.04))],
    "npc_office_orange": [(170, 1.0, 1.0, (0.7, 0.84, 1.0), (0.03, 0.05, 0.13)), (60, 0.9, 1.0, (0.86, 0.96, 0.8), (0.1, 0.09, 0.06))],
    "npc_elder_date": [(30, 1.0, 1.0, (0.86, 0.94, 1.0), (0.05, 0.05, 0.08)), (-40, 1.0, 0.98, (1.0, 0.93, 0.76), (0.09, 0.07, 0.04))],
    "npc_shop_papaya": [(100, 1.1, 1.0, (0.8, 0.92, 1.0), (0.04, 0.05, 0.11)), (-120, 1.0, 1.0, (0.86, 1.0, 0.84), (0.1, 0.07, 0.05))],
    "npc_commuter_lychee": [(150, 1.0, 1.0, (0.76, 0.88, 1.0), (0.04, 0.06, 0.12)), (-70, 1.0, 1.0, (1.0, 0.82, 0.82), (0.1, 0.08, 0.05))],
    "npc_worker_jackfruit": [(80, 1.0, 1.0, (0.8, 0.9, 1.0), (0.05, 0.06, 0.1)), (-140, 0.95, 1.0, (1.0, 0.9, 0.7), (0.1, 0.08, 0.04))],
    "npc_vendor_pineapple": [(120, 1.05, 1.0, (0.82, 0.92, 1.0), (0.04, 0.06, 0.1)), (-80, 1.0, 1.0, (1.0, 0.88, 0.76), (0.09, 0.07, 0.04))],
    "npc_tea_banana": [(-130, 1.0, 1.0, (0.8, 0.9, 1.0), (0.04, 0.06, 0.11)), (70, 1.0, 1.0, (1.0, 0.86, 0.74), (0.1, 0.07, 0.04))],
    "npc_cng_guava": [(140, 1.0, 1.0, (0.78, 0.88, 1.0), (0.04, 0.06, 0.12)), (-60, 1.0, 1.0, (1.0, 0.9, 0.78), (0.1, 0.07, 0.05))],
    "npc_rickshaw_watermelon": [(90, 1.05, 1.0, (0.82, 0.94, 1.0), (0.04, 0.06, 0.1)), (-110, 1.0, 1.0, (1.0, 0.88, 0.72), (0.1, 0.08, 0.04))],
}


def read_glb(path):
    b = path.read_bytes()
    jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    bin_start = 20 + jlen + 8
    return j, b[bin_start:]


COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(j, data, index):
    a = j["accessors"][index]
    v = j["bufferViews"][a["bufferView"]]
    fmt, size = COMP[a["componentType"]]
    n = COUNT[a["type"]]
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", size * n)
    arr = np.zeros((a["count"], n), dtype=np.float64)
    dt = np.dtype(fmt).newbyteorder("<")
    for i in range(a["count"]):
        arr[i] = np.frombuffer(data, dtype=dt, count=n, offset=start + i * stride)
    if a.get("normalized"):
        arr = arr / {5121: 255.0, 5123: 65535.0}.get(a["componentType"], 1.0)
    return arr


def cloth_mask(j, data, w, h):
    prim = j["meshes"][0]["primitives"][0]
    attrs = prim["attributes"]
    uv = accessor(j, data, attrs["TEXCOORD_0"])
    joints = accessor(j, data, attrs["JOINTS_0"]).astype(int)
    weights = accessor(j, data, attrs["WEIGHTS_0"])
    idx = accessor(j, data, prim["indices"]).astype(int).ravel()
    names = [j["nodes"][n]["name"] for n in j["skins"][0]["joints"]]
    is_cloth = np.array([n in CLOTH_BONES for n in names], dtype=np.float64)
    score = (is_cloth[joints] * weights).sum(axis=1) / np.maximum(weights.sum(axis=1), 1e-6)
    mask = np.zeros((h, w), dtype=np.uint8)
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t + 1], idx[t + 2]
        if (score[a] + score[b] + score[c]) / 3 < 0.72:
            continue
        pa, pb, pc = uv[a] * (w, h), uv[b] * (w, h), uv[c] * (w, h)
        x0, y0 = np.floor(np.minimum(np.minimum(pa, pb), pc)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(pa, pb), pc)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px, py = xs + 0.5, ys + 0.5
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-9:
            continue
        l0 = ((pb[1] - pc[1]) * (px - pc[0]) + (pc[0] - pb[0]) * (py - pc[1])) / d
        l1 = ((pc[1] - pa[1]) * (px - pc[0]) + (pa[0] - pc[0]) * (py - pc[1])) / d
        l2 = 1 - l0 - l1
        inside = (l0 >= -0.01) & (l1 >= -0.01) & (l2 >= -0.01)
        mask[y0:y1 + 1, x0:x1 + 1][inside] = 255
    # Grown by a couple of pixels so the seams between pieces of cloth don't show the old colour.
    return np.array(Image.fromarray(mask).filter(ImageFilter.MaxFilter(5)))


def recolour(rgb, mask, outfit):
    hue, sat, val, wash, lift = outfit
    a = rgb.astype(np.float32) / 255
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = d > 1e-6
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h = (h / 6 + hue / 360) % 1
    s2 = np.clip(s * sat, 0, 1)
    v2 = np.clip(mx * val, 0, 1)
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v2 * (1 - s2), v2 * (1 - f * s2), v2 * (1 - (1 - f) * s2)
    out = np.zeros_like(a)
    for k, (cr, cg, cb) in enumerate([(v2, t, p), (q, v2, p), (p, v2, t), (p, q, v2), (t, p, v2), (v2, p, q)]):
        sel = i == k
        out[..., 0][sel], out[..., 1][sel], out[..., 2][sel] = cr[sel], cg[sel], cb[sel]
    # Colourless cloth doesn't turn with the hue: white takes a wash of colour, and black lifts a little.
    grey = np.clip(1 - s / 0.28, 0, 1)
    light = grey * np.clip((mx - 0.42) / 0.3, 0, 1)
    dark = grey * np.clip((0.42 - mx) / 0.3, 0, 1)
    for c in range(3):
        out[..., c] = out[..., c] * (1 - light + light * wash[c]) + dark * lift[c]
    done = a.copy()
    sel = mask > 0
    done[sel] = np.clip(out[sel], 0, 1)
    return (done * 255 + 0.5).astype(np.uint8)


def main():
    for cid, outfits in OUTFITS.items():
        path = CHAR_DIR / f"{cid}.glb"
        j, data = read_glb(path)
        mat = j["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
        tex = j["textures"][mat]
        src = tex.get("source")
        if src is None:
            src = next(iter(tex.get("extensions", {}).values()))["source"]
        view = j["bufferViews"][j["images"][src]["bufferView"]]
        raw = data[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        rgb = np.array(img)
        mask = cloth_mask(j, data, img.width, img.height)
        for tag, outfit in zip("ab", outfits):
            out = recolour(rgb, mask, outfit)
            Image.fromarray(out).save(CHAR_DIR / f"{cid}__{tag}_albedo.webp", quality=84, method=5)
        print(cid, img.size, f"{(mask > 0).mean():.0%} cloth")
    print("done")


if __name__ == "__main__":
    colorsys  # kept for reference when picking palettes by hand
    main()
