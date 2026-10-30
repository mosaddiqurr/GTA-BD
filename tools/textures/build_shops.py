"""Paints the insides of Dhaka shops into one atlas: public/assets/textures/shops.webp

python tools/textures/build_shops.py

Everything is drawn from code, so there is nothing to license. No brand names and no text:
labels are abstract marks. Cells are laid out 3 x 3 and must match SHOP_CELLS in src/world/atlas.ts.
"""

import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 4096, 2048
COLS, ROWS = 3, 3
CW, CH = W // COLS, H // ROWS
SS = 2  # drawn at twice the size and scaled down, for clean edges

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "textures")


def vary(c, amount=18):
    return tuple(max(0, min(255, int(v + random.uniform(-amount, amount)))) for v in c)


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


SATURATED = [(198, 40, 40), (230, 120, 20), (240, 196, 40), (46, 125, 50), (25, 118, 170), (106, 60, 160), (214, 60, 120), (240, 240, 232), (30, 100, 90)]
PASTEL = [(240, 236, 224), (214, 230, 240), (222, 240, 222), (250, 226, 214), (232, 224, 244)]


class Cell:
    def __init__(self, wall):
        self.w, self.h = CW * SS, CH * SS
        self.img = Image.new("RGB", (self.w, self.h), wall)
        self.d = ImageDraw.Draw(self.img)

    def px(self, x, y):
        return x * self.w, y * self.h

    def rect(self, x0, y0, x1, y1, c, radius=0):
        box = (x0 * self.w, y0 * self.h, x1 * self.w, y1 * self.h)
        if radius:
            self.d.rounded_rectangle(box, radius * self.h, fill=c)
        else:
            self.d.rectangle(box, fill=c)

    def oval(self, x0, y0, x1, y1, c):
        self.d.ellipse((x0 * self.w, y0 * self.h, x1 * self.w, y1 * self.h), fill=c)

    def line(self, x0, y0, x1, y1, c, width=0.003):
        self.d.line((x0 * self.w, y0 * self.h, x1 * self.w, y1 * self.h), fill=c, width=max(1, int(width * self.h)))

    def shelf(self, y, thick=0.016, wood=(92, 64, 40)):
        """A plank with the shadow it throws on the wall beneath."""
        self.rect(0, y, 1, y + thick, wood)
        self.rect(0, y, 1, y + thick * 0.28, shade(wood, 1.35))
        for i in range(8):
            f = i / 8
            self.rect(0, y + thick + f * 0.018, 1, y + thick + (f + 0.13) * 0.018, shade(wood, 0.34 + 0.08 * i))

    def marks(self, x0, y0, x1, y1, c):
        """Lines that read as print on a label, without saying anything."""
        n = max(1, int((y1 - y0) / 0.008))
        for i in range(n):
            yy = y0 + (y1 - y0) * (i + 0.5) / n
            self.rect(x0, yy, x0 + (x1 - x0) * random.uniform(0.45, 1), yy + (y1 - y0) * 0.35 / n, c)

    def box(self, x0, y0, x1, y1, c):
        """A carton: front, lit top edge, darker right side, a label."""
        self.rect(x0, y0, x1, y1, c)
        self.rect(x1 - (x1 - x0) * 0.1, y0, x1, y1, shade(c, 0.68))
        self.rect(x0, y0, x1, y0 + (y1 - y0) * 0.06, shade(c, 1.25))
        lab = random.choice([(250, 248, 240), shade(c, 0.55), shade(c, 1.4)])
        self.rect(x0 + (x1 - x0) * 0.12, y0 + (y1 - y0) * 0.3, x1 - (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.72, lab)
        self.marks(x0 + (x1 - x0) * 0.18, y0 + (y1 - y0) * 0.36, x1 - (x1 - x0) * 0.26, y0 + (y1 - y0) * 0.66, shade(c, 0.5))

    def tin(self, x0, y0, x1, y1, c):
        w = x1 - x0
        self.rect(x0, y0 + 0.006, x1, y1 - 0.004, c)
        self.rect(x0, y0 + 0.006, x0 + w * 0.2, y1 - 0.004, shade(c, 0.76))
        self.rect(x1 - w * 0.22, y0 + 0.006, x1, y1 - 0.004, shade(c, 0.62))
        self.rect(x0 + w * 0.3, y0 + 0.006, x0 + w * 0.42, y1 - 0.004, shade(c, 1.3))
        self.oval(x0, y0, x1, y0 + 0.014, (196, 196, 196))
        self.rect(x0, y0 + (y1 - y0) * 0.38, x1, y0 + (y1 - y0) * 0.72, random.choice([(245, 242, 230), shade(c, 0.5)]))

    def bottle(self, x0, y0, x1, y1, c):
        w = x1 - x0
        neck = x0 + w * 0.34, x1 - w * 0.34
        self.rect(neck[0], y0, neck[1], y0 + (y1 - y0) * 0.3, shade(c, 0.85))
        self.rect(neck[0], y0, neck[1], y0 + (y1 - y0) * 0.08, (210, 40, 40))
        self.rect(x0, y0 + (y1 - y0) * 0.26, x1, y1, c, radius=(x1 - x0) * 0.1)
        self.rect(x0 + w * 0.14, y0 + (y1 - y0) * 0.32, x0 + w * 0.26, y1 - 0.01, shade(c, 1.45))
        self.rect(x0, y0 + (y1 - y0) * 0.56, x1, y0 + (y1 - y0) * 0.82, (240, 238, 226))

    def jar(self, x0, y0, x1, y1, fill):
        self.rect(x0, y0 + 0.01, x1, y1, (214, 224, 226), radius=0.008)
        self.rect(x0 + 0.003, y0 + (y1 - y0) * 0.25, x1 - 0.003, y1 - 0.004, fill, radius=0.006)
        # The biscuits or dal inside.
        for _ in range(26):
            cx = random.uniform(x0 + 0.004, x1 - 0.006)
            cy = random.uniform(y0 + (y1 - y0) * 0.28, y1 - 0.01)
            r = 0.0035
            self.oval(cx - r * 0.5, cy - r, cx + r * 0.5, cy + r, shade(fill, random.uniform(0.7, 1.25)))
        self.rect(x0 + (x1 - x0) * 0.14, y0 + 0.016, x0 + (x1 - x0) * 0.24, y1 - 0.008, (250, 252, 252))
        self.rect(x0 - 0.001, y0, x1 + 0.001, y0 + 0.018, (200, 60, 40))

    def finish(self):
        """Light from a tube near the ceiling: bright above, falling away to the floor and corners."""
        img = self.img.resize((CW, CH), Image.LANCZOS)
        a = np.asarray(img, dtype=np.float32) / 255
        y, x = np.mgrid[0:CH, 0:CW]
        fy = y / CH
        fx = x / CW
        light = 1.12 - 0.5 * fy**1.6
        light *= 1 - 0.34 * np.abs(fx * 2 - 1) ** 2.6
        a *= light[..., None]
        grime = np.random.default_rng(random.randrange(1 << 30)).normal(0, 0.012, a.shape[:2])[..., None]
        a = np.clip(a + grime, 0, 1)
        return Image.fromarray((a * 255).astype(np.uint8))


def grocery():
    c = Cell((188, 170, 138))
    # Foil snack strips hanging from the top shelf, the first thing you see in any mudi dokan.
    x = 0.015
    while x < 0.985:
        col = random.choice(SATURATED)
        for k in range(5):
            y = 0.012 + k * 0.058
            pc = vary(col, 14)
            c.rect(x, y, x + 0.05, y + 0.054, pc)
            c.rect(x, y, x + 0.05, y + 0.008, shade(pc, 1.3))
            c.oval(x + 0.012, y + 0.016, x + 0.038, y + 0.044, shade(pc, 1.5))
        x += random.uniform(0.058, 0.07)
    rows = [(0.30, 0.45), (0.45, 0.60), (0.60, 0.74)]
    for y0, y1 in rows:
        c.shelf(y1)
        x = 0.012
        family = random.choice(["tin", "box", "bottle", "jar"])
        col = random.choice(SATURATED)
        while x < 0.97:
            if random.random() < 0.22:
                family = random.choice(["tin", "box", "bottle", "jar"])
                col = random.choice(SATURATED)
            hh = random.uniform(0.7, 0.92) * (y1 - y0 - 0.02)
            if family == "tin":
                w = 0.028
                c.tin(x, y1 - hh, x + w, y1, vary(col))
            elif family == "box":
                w = random.uniform(0.03, 0.05)
                c.box(x, y1 - hh, x + w, y1, vary(col))
            elif family == "bottle":
                w = 0.021
                c.bottle(x, y1 - hh, x + w, y1, vary((214, 170, 40)))
            else:
                w = 0.044
                c.jar(x, y1 - hh, x + w, y1, vary((176, 118, 54)))
            x += w + random.uniform(0.002, 0.006)
    # Open sacks of rice, dal and sugar along the floor.
    x = 0.02
    while x < 0.9:
        w = random.uniform(0.1, 0.13)
        sack = vary((176, 150, 104), 10)
        c.rect(x, 0.82, x + w, 1, sack, radius=0.02)
        c.rect(x + w * 0.76, 0.82, x + w, 1, shade(sack, 0.72), radius=0.02)
        fill = random.choice([(238, 234, 222), (214, 150, 60), (244, 240, 236), (150, 96, 50), (230, 196, 70)])
        c.oval(x + 0.004, 0.785, x + w - 0.004, 0.86, fill)
        for _ in range(170):
            px = random.uniform(x + 0.012, x + w - 0.012)
            py = random.uniform(0.795, 0.85)
            c.oval(px, py, px + 0.0028, py + 0.005, shade(fill, random.uniform(0.74, 1.18)))
        x += w + 0.014
    return c.finish()


def pharmacy():
    c = Cell((226, 234, 232))
    # A plain green cross on a backlit panel. Pale shelves full of small boxes.
    c.rect(0.4, 0.015, 0.6, 0.12, (250, 252, 250))
    c.rect(0.482, 0.03, 0.518, 0.105, (20, 140, 80))
    c.rect(0.455, 0.05, 0.545, 0.085, (20, 140, 80))
    for row in range(5):
        y1 = 0.25 + row * 0.128
        c.shelf(y1, wood=(236, 238, 234))
        x = 0.012
        col = random.choice(PASTEL + [(40, 110, 170), (200, 60, 60), (40, 140, 110)])
        while x < 0.975:
            if random.random() < 0.14:
                col = random.choice(PASTEL + [(40, 110, 170), (200, 60, 60), (40, 140, 110), (240, 170, 40)])
            w = random.uniform(0.014, 0.03)
            hh = random.uniform(0.05, 0.1)
            c.box(x, y1 - hh, x + w, y1, vary(col, 8))
            x += w + 0.0015
    # Glass counter.
    c.rect(0, 0.86, 1, 1, (120, 150, 156))
    c.rect(0, 0.86, 1, 0.872, (230, 240, 240))
    x = 0.02
    while x < 0.96:
        w = random.uniform(0.02, 0.04)
        c.box(x, random.uniform(0.895, 0.93), x + w, 0.985, vary(random.choice(PASTEL), 8))
        x += w + 0.004
    # Reflection across the glass.
    c.d.polygon([c.px(0.1, 0.872), c.px(0.17, 0.872), c.px(0.11, 1), c.px(0.04, 1)], fill=(170, 196, 200))
    return c.finish()


def mobile():
    c = Cell((30, 38, 56))
    # LED strip, wall of bright phone cases, a poster, glass counter of handsets.
    c.rect(0, 0.012, 1, 0.03, (240, 248, 255))
    # Poster: an abstract phone on a colour field.
    c.rect(0.36, 0.06, 0.64, 0.48, (214, 50, 70))
    c.d.polygon([c.px(0.36, 0.48), c.px(0.64, 0.14), c.px(0.64, 0.48)], fill=(240, 140, 40))
    c.rect(0.455, 0.1, 0.545, 0.44, (24, 26, 34), radius=0.012)
    c.rect(0.462, 0.118, 0.538, 0.42, (70, 170, 230), radius=0.006)
    c.rect(0.47, 0.135, 0.53, 0.2, (240, 250, 255), radius=0.004)
    for side in ((0.012, 0.345), (0.655, 0.988)):
        for row in range(6):
            for k in range(11):
                x = side[0] + k * (side[1] - side[0]) / 11
                y = 0.05 + row * 0.072
                col = vary(random.choice(SATURATED), 26)
                c.rect(x + 0.002, y, x + 0.024, y + 0.062, col, radius=0.005)
                c.rect(x + 0.016, y + 0.006, x + 0.022, y + 0.02, (24, 24, 28), radius=0.002)
    # Boxes on a shelf.
    c.shelf(0.62, wood=(66, 72, 86))
    x = 0.015
    while x < 0.975:
        w = random.uniform(0.036, 0.05)
        c.box(x, 0.62 - random.uniform(0.08, 0.1), x + w, 0.62, random.choice([(236, 238, 240), (40, 44, 54), (60, 110, 190)]))
        x += w + 0.003
    # Glass counter of handsets with lit screens.
    c.rect(0, 0.7, 1, 1, (18, 22, 30))
    c.rect(0, 0.7, 1, 0.712, (214, 228, 240))
    x = 0.02
    while x < 0.96:
        c.rect(x, 0.745, x + 0.038, 0.87, (12, 12, 16), radius=0.006)
        top = vary(random.choice([(70, 170, 230), (240, 120, 80), (120, 220, 170), (200, 130, 230)]), 20)
        c.rect(x + 0.003, 0.752, x + 0.035, 0.862, top, radius=0.004)
        c.rect(x + 0.006, 0.82, x + 0.032, 0.84, shade(top, 1.5))
        x += 0.052
    c.rect(0, 0.88, 1, 1, (28, 32, 42))
    return c.finish()


def shirt(c, x, y, w, h, col):
    """A shirt on a hanger, seen from the front."""
    sleeve = w * 0.24
    c.line(x + w * 0.5, y - h * 0.09, x + w * 0.5, y, (150, 150, 150), 0.003)
    c.d.polygon([c.px(x, y + h * 0.04), c.px(x - sleeve * 0.7, y + h * 0.36), c.px(x, y + h * 0.42)], fill=shade(col, 0.82))
    c.d.polygon([c.px(x + w, y + h * 0.04), c.px(x + w + sleeve * 0.7, y + h * 0.36), c.px(x + w, y + h * 0.42)], fill=shade(col, 0.72))
    c.rect(x, y, x + w, y + h, col)
    c.rect(x + w * 0.76, y, x + w, y + h, shade(col, 0.8))
    c.rect(x + w * 0.47, y, x + w * 0.53, y + h, shade(col, 0.72))
    c.d.polygon([c.px(x + w * 0.28, y), c.px(x + w * 0.5, y + h * 0.13), c.px(x + w * 0.72, y)], fill=shade(col, 1.25))
    for k in range(4):
        c.oval(x + w * 0.49, y + h * (0.2 + k * 0.19), x + w * 0.51, y + h * (0.22 + k * 0.19), (240, 240, 232))


def clothes():
    c = Cell((202, 188, 170))
    for rail, hh in ((0.035, 0.34), (0.45, 0.32)):
        c.rect(0, rail, 1, rail + 0.01, (150, 150, 152))
        x = 0.012
        while x < 0.95:
            col = vary(random.choice(SATURATED + PASTEL), 20)
            w = random.uniform(0.05, 0.062)
            if random.random() < 0.28:
                # A lungi: checks on a long folded cloth.
                c.rect(x, rail + 0.01, x + w, rail + 0.01 + hh, col)
                for k in range(9):
                    c.rect(x + k * w / 9, rail + 0.01, x + (k + 0.3) * w / 9, rail + 0.01 + hh, shade(col, 0.62))
                for k in range(12):
                    yy = rail + 0.01 + k * hh / 12
                    c.rect(x, yy, x + w, yy + hh / 12 * 0.3, shade(col, 0.72))
            else:
                shirt(c, x + 0.01, rail + 0.03, w - 0.02, hh * 0.84, col)
            x += w + random.uniform(0.0, 0.008)
    # Folded piles on a table.
    c.rect(0, 0.82, 1, 1, (116, 86, 58))
    c.rect(0, 0.82, 1, 0.835, (150, 116, 80))
    x = 0.015
    while x < 0.93:
        w = random.uniform(0.075, 0.1)
        y = 0.82
        for _ in range(random.randint(3, 6)):
            hh = random.uniform(0.016, 0.026)
            col = vary(random.choice(SATURATED + PASTEL), 20)
            c.rect(x, y - hh, x + w, y, col, radius=0.003)
            c.rect(x, y - hh, x + w, y - hh * 0.8, shade(col, 1.25))
            y -= hh
        x += w + 0.012
    return c.finish()


def tea():
    c = Cell((96, 120, 112))
    c.shelf(0.25)
    x = 0.02
    while x < 0.93:
        c.jar(x, 0.09, x + 0.078, 0.25, vary(random.choice([(208, 160, 90), (176, 118, 54), (230, 196, 120), (200, 90, 60)]), 10))
        x += 0.09
    c.shelf(0.48)
    x = 0.015
    while x < 0.97:
        w = random.uniform(0.038, 0.06)
        c.box(x, 0.48 - random.uniform(0.11, 0.17), x + w, 0.48, vary(random.choice(SATURATED)))
        x += w + 0.004
    # Banana bunches hanging at the side.
    for bx in (0.06, 0.88):
        c.line(bx + 0.03, 0.26, bx + 0.03, 0.34, (120, 90, 60), 0.006)
        for k in range(16):
            yy = 0.33 + (k // 4) * 0.05
            xx = bx + (k % 4) * 0.018
            col = vary((226, 190, 50), 16)
            c.rect(xx, yy, xx + 0.016, yy + 0.066, col, radius=0.006)
            c.rect(xx + 0.011, yy, xx + 0.016, yy + 0.066, shade(col, 0.72), radius=0.002)
    # Counter with glasses, a kettle on a stove.
    c.rect(0, 0.66, 1, 1, (84, 64, 46))
    c.rect(0, 0.66, 1, 0.68, (158, 130, 96))
    for k in range(12):
        x = 0.28 + k * 0.03
        c.rect(x, 0.595, x + 0.022, 0.66, (216, 226, 222), radius=0.002)
        c.rect(x + 0.002, 0.615, x + 0.02, 0.655, (160, 92, 40))
    c.rect(0.72, 0.62, 0.9, 0.66, (50, 50, 54))
    c.oval(0.74, 0.5, 0.88, 0.63, (180, 180, 176))
    c.rect(0.775, 0.48, 0.845, 0.52, (160, 160, 156))
    c.d.polygon([c.px(0.87, 0.55), c.px(0.93, 0.5), c.px(0.93, 0.52), c.px(0.875, 0.59)], fill=(170, 170, 166))
    c.oval(0.76, 0.52, 0.8, 0.59, (226, 226, 222))
    # Crates under the counter.
    for k in range(4):
        x = 0.06 + k * 0.23
        c.rect(x, 0.75, x + 0.2, 0.97, (120, 96, 68))
        for j in range(4):
            c.rect(x, 0.76 + j * 0.055, x + 0.2, 0.774 + j * 0.055, (70, 54, 38))
    return c.finish()


def hardware():
    c = Cell((172, 168, 156))
    # Pegboard with tools hung out in rows.
    for i in range(48):
        for j in range(16):
            x = 0.01 + i * 0.0208
            y = 0.02 + j * 0.034
            c.oval(x, y, x + 0.0028, y + 0.0056, (124, 120, 110))
    x = 0.03
    while x < 0.95:
        y = 0.05
        kind = random.choice(["hammer", "wrench", "saw"])
        steel = vary((150, 156, 164), 12)
        if kind == "hammer":
            c.rect(x + 0.012, y + 0.03, x + 0.022, y + 0.2, vary((150, 102, 56), 10))
            c.rect(x, y + 0.012, x + 0.036, y + 0.05, steel)
        elif kind == "wrench":
            c.rect(x + 0.012, y + 0.04, x + 0.024, y + 0.2, steel)
            c.oval(x + 0.002, y + 0.004, x + 0.034, y + 0.06, steel)
            c.oval(x + 0.012, y + 0.002, x + 0.024, y + 0.03, (172, 168, 156))
        else:
            c.d.polygon([c.px(x, y + 0.02), c.px(x + 0.038, y + 0.02), c.px(x + 0.038, y + 0.22), c.px(x + 0.01, y + 0.22)], fill=steel)
            c.rect(x + 0.002, y, x + 0.034, y + 0.03, vary((190, 60, 40), 12))
        x += 0.058
    c.shelf(0.42, wood=(70, 70, 74))
    x = 0.015
    while x < 0.96:
        # Paint tins, stacked.
        col = vary(random.choice(SATURATED))
        c.tin(x, 0.3, x + 0.054, 0.42, col)
        if random.random() < 0.5:
            c.tin(x, 0.2, x + 0.054, 0.3, vary(col, 8))
        x += 0.06
    c.shelf(0.68, wood=(70, 70, 74))
    # Coils of wire and hose.
    x = 0.02
    while x < 0.95:
        col = vary(random.choice([(190, 60, 40), (40, 110, 180), (40, 40, 44), (230, 190, 50), (50, 140, 80)]), 14)
        c.oval(x, 0.5, x + 0.1, 0.68, col)
        for k in range(1, 5):
            f = k * 0.008
            c.oval(x + f, 0.5 + f * 1.8, x + 0.1 - f, 0.68 - f * 1.8, shade(col, 0.8 if k % 2 else 1.15))
        c.oval(x + 0.038, 0.565, x + 0.062, 0.615, (60, 56, 50))
        x += 0.112
    # Bundled pipes seen end-on.
    c.rect(0, 0.74, 1, 1, (86, 82, 76))
    for j in range(5):
        for i in range(30):
            x = 0.012 + i * 0.033 + (j % 2) * 0.016
            y = 0.76 + j * 0.046
            c.oval(x, y, x + 0.03, y + 0.06, (176, 180, 184))
            c.oval(x + 0.007, y + 0.014, x + 0.023, y + 0.046, (54, 54, 56))
    return c.finish()


def sweets():
    c = Cell((222, 186, 160))
    # Pink boxes up top, trays of sweets in a glass case below.
    x = 0.01
    while x < 0.97:
        w = random.uniform(0.07, 0.1)
        y = 0.27
        for _ in range(random.randint(3, 5)):
            hh = 0.045
            col = vary(random.choice([(232, 150, 170), (240, 226, 200), (226, 110, 110)]), 10)
            c.rect(x, y - hh, x + w, y, col)
            c.rect(x, y - hh, x + w, y - hh * 0.8, shade(col, 1.2))
            c.rect(x + w * 0.45, y - hh, x + w * 0.55, y, shade(col, 0.75))
            y -= hh
        x += w + 0.006
    c.shelf(0.28, wood=(150, 110, 70))
    for row, yy in enumerate((0.36, 0.54, 0.72)):
        tray = (206, 206, 204)
        for k in range(4):
            x0 = 0.015 + k * 0.245
            c.rect(x0, yy + 0.13, x0 + 0.232, yy + 0.16, shade(tray, 0.9))
            c.oval(x0, yy + 0.04, x0 + 0.232, yy + 0.16, tray)
            col = random.choice([(250, 246, 234), (246, 200, 200), (150, 80, 50), (232, 200, 120), (255, 240, 200), (214, 130, 60)])
            for j in range(4):
                for i in range(9 - j):
                    r = 0.012
                    cx = x0 + 0.03 + i * 0.022 + j * 0.011
                    cy = yy + 0.12 - j * 0.024
                    c.oval(cx - r, cy - r * 1.9, cx + r, cy + r * 1.9, vary(col, 8))
                    c.oval(cx - r * 0.5, cy - r * 1.5, cx, cy - r * 0.3, shade(col, 1.18))
    # Glass reflections and the case frame.
    for x in (0.12, 0.52, 0.8):
        c.d.polygon([c.px(x, 0.3), c.px(x + 0.05, 0.3), c.px(x - 0.09, 1), c.px(x - 0.14, 1)], fill=(240, 226, 214))
    c.rect(0, 0.3, 1, 0.31, (190, 190, 186))
    c.rect(0, 0.965, 1, 1, (120, 90, 60))
    return c.finish()


def books():
    c = Cell((70, 54, 40))
    for row in range(6):
        y1 = 0.155 + row * 0.16
        c.shelf(y1, wood=(58, 40, 26))
        x = 0.006
        col = random.choice(SATURATED + PASTEL)
        while x < 0.99:
            if random.random() < 0.16:
                col = random.choice(SATURATED + PASTEL)
            if random.random() < 0.05:
                # A pile lying flat.
                y = y1
                w = random.uniform(0.05, 0.075)
                for _ in range(random.randint(3, 6)):
                    hh = random.uniform(0.012, 0.02)
                    bc = vary(col, 26)
                    c.rect(x, y - hh, x + w, y, bc)
                    c.rect(x + w * 0.9, y - hh, x + w, y, (232, 226, 206))
                    y -= hh
                x += w + 0.003
                continue
            w = random.uniform(0.006, 0.017)
            hh = random.uniform(0.09, 0.135)
            bc = vary(col, 22)
            c.rect(x, y1 - hh, x + w, y1, bc)
            c.rect(x, y1 - hh, x + w * 0.22, y1, shade(bc, 1.25))
            c.rect(x + w * 0.8, y1 - hh, x + w, y1, shade(bc, 0.62))
            if w > 0.009:
                c.rect(x + w * 0.2, y1 - hh * 0.78, x + w * 0.8, y1 - hh * 0.5, shade(bc, 1.55))
                c.rect(x + w * 0.2, y1 - hh * 0.2, x + w * 0.8, y1 - hh * 0.13, shade(bc, 1.45))
            x += w + 0.0006
    return c.finish()


def plastics():
    c = Cell((186, 196, 200))
    # Buckets, mugs and basins: the bright stacks outside every Dhaka variety store.
    colours = [(30, 120, 190), (214, 50, 60), (240, 180, 40), (40, 160, 90), (240, 110, 40), (120, 70, 170), (20, 170, 170), (236, 236, 230)]
    x = 0.008
    while x < 0.94:
        w = random.uniform(0.09, 0.12)
        col = vary(random.choice(colours), 10)
        y = 0.98
        n = random.randint(4, 8)
        for k in range(n):
            hh = 0.135
            c.d.polygon([c.px(x, y - hh), c.px(x + w, y - hh), c.px(x + w * 0.88, y), c.px(x + w * 0.12, y)], fill=col)
            c.d.polygon([c.px(x + w * 0.74, y - hh), c.px(x + w, y - hh), c.px(x + w * 0.88, y), c.px(x + w * 0.66, y)], fill=shade(col, 0.72))
            c.d.polygon([c.px(x + w * 0.14, y - hh), c.px(x + w * 0.24, y - hh), c.px(x + w * 0.26, y), c.px(x + w * 0.2, y)], fill=shade(col, 1.3))
            c.rect(x - 0.002, y - hh, x + w + 0.002, y - hh + 0.016, shade(col, 1.18), radius=0.004)
            y -= 0.075
        x += w + 0.008
    # Mugs on hooks across the top.
    c.rect(0, 0.03, 1, 0.038, (120, 120, 124))
    for k in range(32):
        col = vary(random.choice(colours), 10)
        xx = 0.008 + k * 0.031
        c.rect(xx, 0.05, xx + 0.022, 0.13, col, radius=0.003)
        c.rect(xx + 0.015, 0.05, xx + 0.022, 0.13, shade(col, 0.72), radius=0.002)
        c.oval(xx - 0.006, 0.065, xx + 0.003, 0.11, shade(col, 0.82))
    return c.finish()


# Same order as SHOP_CELLS in src/world/atlas.ts.
PAINTERS = [grocery, pharmacy, mobile, clothes, tea, hardware, sweets, books, plastics]


def main():
    random.seed(1971)
    atlas = Image.new("RGB", (W, H))
    for i, paint in enumerate(PAINTERS):
        atlas.paste(paint(), ((i % COLS) * CW, (i // COLS) * CH))
    atlas = atlas.filter(ImageFilter.UnsharpMask(radius=1.2, percent=35, threshold=2))
    path = os.path.join(ROOT, "shops.webp")
    atlas.save(path, "WEBP", quality=88, method=5)
    print(path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
