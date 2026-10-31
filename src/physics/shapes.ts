/** Contact tests between flat shapes on the ground: a vehicle's outline is a box turned to its heading.
 *  Each test leaves its answer in `HIT`: which way to push the first shape, how far, and where they touch.
 *  They run many times a frame, so nothing here allocates. */
export const HIT = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };

/** Two turned boxes, by separating axes. `s` and `c` are the sine and cosine of the heading, so along
 *  the body is (s, c) and across it is (c, -s). The normal points from b towards a. */
export function obbVsObb(ax: number, az: number, as: number, ac: number, ahl: number, ahw: number, bx: number, bz: number, bs: number, bc: number, bhl: number, bhw: number): boolean {
  const dx = ax - bx, dz = az - bz;
  let best = Infinity, nx = 0, nz = 0, fromA = true;
  for (let i = 0; i < 4; i++) {
    const ux = i === 0 ? as : i === 1 ? ac : i === 2 ? bs : bc;
    const uz = i === 0 ? ac : i === 1 ? -as : i === 2 ? bc : -bs;
    const ra = ahl * Math.abs(ux * as + uz * ac) + ahw * Math.abs(ux * ac - uz * as);
    const rb = bhl * Math.abs(ux * bs + uz * bc) + bhw * Math.abs(ux * bc - uz * bs);
    const dist = dx * ux + dz * uz;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      const sign = dist >= 0 ? 1 : -1;
      nx = ux * sign;
      nz = uz * sign;
      fromA = i < 2;
    }
  }
  HIT.nx = nx;
  HIT.nz = nz;
  HIT.depth = best;
  // Where they touch: the corner driven furthest into the other one.
  if (fromA) {
    const sa = nx * bs + nz * bc >= 0 ? 1 : -1, sw = nx * bc - nz * bs >= 0 ? 1 : -1;
    HIT.px = bx + bs * bhl * sa + bc * bhw * sw;
    HIT.pz = bz + bc * bhl * sa - bs * bhw * sw;
  } else {
    const sa = nx * as + nz * ac >= 0 ? -1 : 1, sw = nx * ac - nz * as >= 0 ? -1 : 1;
    HIT.px = ax + as * ahl * sa + ac * ahw * sw;
    HIT.pz = az + ac * ahl * sa - as * ahw * sw;
  }
  return true;
}

/** A turned box against a box that lines up with the map. */
export function obbVsBox(ax: number, az: number, as: number, ac: number, ahl: number, ahw: number, x0: number, z0: number, x1: number, z1: number): boolean {
  return obbVsObb(ax, az, as, ac, ahl, ahw, (x0 + x1) / 2, (z0 + z1) / 2, 0, 1, (z1 - z0) / 2, (x1 - x0) / 2);
}

/** A turned box against a circle. The normal points away from the circle. */
export function obbVsCircle(ax: number, az: number, as: number, ac: number, ahl: number, ahw: number, cx: number, cz: number, r: number): boolean {
  const dx = cx - ax, dz = cz - az;
  const along = dx * as + dz * ac, across = dx * ac - dz * as;
  const qa = Math.max(-ahl, Math.min(ahl, along)), qw = Math.max(-ahw, Math.min(ahw, across));
  const px = ax + as * qa + ac * qw, pz = az + ac * qa - as * qw;
  const ex = px - cx, ez = pz - cz;
  const d = Math.hypot(ex, ez);
  if (d >= r) return false;
  HIT.px = px;
  HIT.pz = pz;
  if (d > 1e-5) {
    HIT.nx = ex / d;
    HIT.nz = ez / d;
    HIT.depth = r - d;
    return true;
  }
  // The circle's centre is inside the box: out by the nearest side.
  const toA = ahl - Math.abs(along), toW = ahw - Math.abs(across);
  if (toA < toW) {
    const sign = along >= 0 ? -1 : 1;
    HIT.nx = as * sign;
    HIT.nz = ac * sign;
    HIT.depth = toA + r;
  } else {
    const sign = across >= 0 ? -1 : 1;
    HIT.nx = ac * sign;
    HIT.nz = -as * sign;
    HIT.depth = toW + r;
  }
  return true;
}
