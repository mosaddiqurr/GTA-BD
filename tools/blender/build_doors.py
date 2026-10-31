"""Cuts opening doors out of already-built vehicles, without rebaking anything.

blender --background --factory-startup --python tools/blender/build_doors.py -- [ids]

Run after build_vehicles.py. Two ways of cutting, both keeping the paint exactly as baked:
- panels (car, microbus, truck): slices a door out of `body` and `glass` along straight planes, so the
  hole shows the real interior.
- islands (CNG, bus): those doors are already separate pieces of metal joined into `body`, so whole
  pieces lying inside a box are lifted out.
Each door becomes its own object with its origin on the hinge. The game knows them by name:
door_D and door_DL are the driver's doors on the right and left, door_P and door_PL the passengers'.
Blender axes: -Y is forward and -X is the vehicle's right. Running this again skips doors already cut.
"""

import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bo_common as bo

VEH_DIR = os.path.join(bo.PUBLIC_ASSETS, "vehicles")

# y0 is the front edge, where the hinge goes. Limits in metres, side is -1 for the right.
PANELS = {
    "car_sedan": {
        "door_D": dict(y0=-0.56, y1=0.5, z0=0.34, z1=1.2, side=-1, x_min=0.42, x_max=0.92),
        "door_PL": dict(y0=-0.56, y1=0.5, z0=0.34, z1=1.2, side=1, x_min=0.42, x_max=0.92),
    },
    "microbus": {
        "door_D": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=-1, x_min=0.55, x_max=0.92),
        "door_PL": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=1, x_min=0.55, x_max=0.92),
    },
    "police_car": {
        "door_D": dict(y0=-0.56, y1=0.5, z0=0.34, z1=1.2, side=-1, x_min=0.42, x_max=0.92),
        "door_PL": dict(y0=-0.56, y1=0.5, z0=0.34, z1=1.2, side=1, x_min=0.42, x_max=0.92),
    },
    "ambulance": {
        "door_D": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=-1, x_min=0.55, x_max=0.92),
        "door_PL": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=1, x_min=0.55, x_max=0.92),
    },
    "leguna": {
        "door_D": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=-1, x_min=0.55, x_max=0.92),
        "door_PL": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=1, x_min=0.55, x_max=0.92),
    },
    "garbage_truck": {
        "door_D": dict(y0=-3.32, y1=-2.2, z0=0.86, z1=2.55, side=-1, x_min=0.8, x_max=1.22),
    },
    "goods_van": {
        "door_D": dict(y0=-3.32, y1=-2.2, z0=0.86, z1=2.55, side=-1, x_min=0.8, x_max=1.22),
    },
    "wrecker": {
        "door_D": dict(y0=-3.32, y1=-2.2, z0=0.86, z1=2.55, side=-1, x_min=0.8, x_max=1.22),
    },
    "truck": {
        "door_D": dict(y0=-3.32, y1=-2.2, z0=0.86, z1=2.55, side=-1, x_min=0.8, x_max=1.22),
    },
}

# The CNG's mesh doors: x is the distance out from the centre line. The driver's are hinged at the
# front and the passengers' at the back, and the two meet at the middle pillar.
CNG_X = (0.625, 0.67)
CNG_Z = (0.47, 1.63)
CNG_DRIVER_Y = (-0.52, -0.11)
CNG_PASSENGER_Y = (-0.09, 0.64)
CNG_HINGE_X = 0.645
CNG_HINGE_Z = 1.05
ISLANDS = {
    "cng": {
        "door_D": dict(side=-1, y=CNG_DRIVER_Y, hinge_y=-0.515),
        "door_DL": dict(side=1, y=CNG_DRIVER_Y, hinge_y=-0.515),
        "door_P": dict(side=-1, y=CNG_PASSENGER_Y, hinge_y=0.635),
        "door_PL": dict(side=1, y=CNG_PASSENGER_Y, hinge_y=0.635),
    },
}

# The bus's front door on its left side: the model has two folded leaves, which become one leaf each
# side of the opening, stretched a little to meet in the middle. Each swings inwards.
BUS_OPENING = (-4.40, -3.50)
BUS_LEAF_FACE_X = 1.19
BUS_LEAF_WIDE = 0.45
BUS_LEAVES = {
    "door_P": dict(x=1.13, y=-3.55, hinge_y=BUS_OPENING[1], centre=BUS_OPENING[1] - BUS_LEAF_WIDE / 2),
    "door_P2": dict(x=1.08, y=-3.59, hinge_y=BUS_OPENING[0], centre=BUS_OPENING[0] + BUS_LEAF_WIDE / 2),
}
BUS_LEAF_Y = 0.17


def cut(obj, d):
    """Slices obj along the door rectangle and returns the door faces as a new mesh."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    planes = [(Vector((0, d["y0"], 0)), Vector((0, 1, 0))), (Vector((0, d["y1"], 0)), Vector((0, 1, 0))), (Vector((0, 0, d["z0"])), Vector((0, 0, 1))), (Vector((0, 0, d["z1"])), Vector((0, 0, 1)))]

    def side_geom():
        faces = [f for f in bm.faces if f.calc_center_median().x * d["side"] > d["x_min"] * 0.8]
        verts = list({v for f in faces for v in f.verts})
        edges = list({e for f in faces for e in f.edges})
        return verts + edges + faces

    for co, no in planes:
        bmesh.ops.bisect_plane(bm, geom=side_geom(), plane_co=co, plane_no=no, clear_inner=False, clear_outer=False, dist=1e-4)
    bm.faces.ensure_lookup_table()
    picked = []
    for f in bm.faces:
        c = f.calc_center_median()
        if not d["x_min"] <= c.x * d["side"] <= d["x_max"]:
            continue
        if d["y0"] < c.y < d["y1"] and d["z0"] < c.z < d["z1"]:
            picked.append(f)
    return lift(obj, bm, picked)


def lift(obj, bm, picked):
    """Moves the picked faces out of obj into a new mesh, keeping UVs and materials."""
    if not picked:
        bm.free()
        return None
    bm.faces.index_update()
    new_bm = bm.copy()
    new_bm.faces.ensure_lookup_table()
    keep = {f.index for f in picked}
    bmesh.ops.delete(new_bm, geom=[f for f in new_bm.faces if f.index not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=picked, context="FACES_ONLY")
    bm.to_mesh(obj.data)
    bm.free()
    mesh = bpy.data.meshes.new(obj.name + "_door")
    new_bm.to_mesh(mesh)
    new_bm.free()
    for m in obj.data.materials:
        mesh.materials.append(m)
    return mesh


def pieces(bm):
    """Groups faces into the separate connected pieces of the mesh."""
    seen = set()
    out = []
    for start in bm.faces:
        if start.index in seen:
            continue
        seen.add(start.index)
        stack = [start]
        piece = []
        while stack:
            f = stack.pop()
            piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        out.append(piece)
    return out


def cut_pieces(obj, inside):
    """Lifts out every whole piece whose vertices all pass the test."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.index_update()
    picked = []
    for piece in pieces(bm):
        if all(inside(v.co) for f in piece for v in f.verts):
            picked.extend(piece)
    return lift(obj, bm, picked)


def add_door(scene, created, name, mesh, hinge):
    o = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(o)
    mesh.transform(Matrix.Translation(-hinge))
    o.location = hinge
    mesh.update()
    created.append(o)
    return o


def panel_doors(vid, scene, objs, created):
    for name, d in PANELS[vid].items():
        if name in objs:
            continue
        panel = cut(objs["body"], d)
        if panel is None:
            raise RuntimeError(f"{vid}: no faces found for {name}")
        # Origin on the hinge, at the panel's own outer surface.
        edge = sorted(v.co.x for v in panel.vertices if abs(v.co.y - d["y0"]) < 0.06)
        hinge = Vector((edge[len(edge) // 2], d["y0"], (d["z0"] + d["z1"]) / 2))
        add_door(scene, created, name, panel, hinge)
        if "glass" in objs:
            pane = cut(objs["glass"], d)
            if pane is not None:
                add_door(scene, created, name + "_glass", pane, hinge)


def island_doors(vid, scene, objs, created):
    for name, d in ISLANDS[vid].items():
        if name in objs:
            continue
        s, ylo, yhi = d["side"], d["y"][0], d["y"][1]

        def inside(co, s=s, ylo=ylo, yhi=yhi):
            return CNG_X[0] <= co.x * s <= CNG_X[1] and ylo <= co.y <= yhi and CNG_Z[0] <= co.z <= CNG_Z[1]

        panel = cut_pieces(objs["body"], inside)
        if panel is None:
            raise RuntimeError(f"{vid}: no pieces found for {name}")
        add_door(scene, created, name, panel, Vector((s * CNG_HINGE_X, d["hinge_y"], CNG_HINGE_Z)))


def bus_doors(scene, objs, created):
    for name, d in BUS_LEAVES.items():
        if name in objs:
            continue
        xl, yl = d["x"], d["y"]

        def inside(co, xl=xl, yl=yl):
            return abs(co.x - xl) < 0.035 and abs(co.y - yl) < BUS_LEAF_Y + 0.02 and 0.6 <= co.z <= 2.65

        hinge = Vector((BUS_LEAF_FACE_X, d["hinge_y"], 1.6))
        # Unfolded: moved out to the side of the bus and stretched to half the opening.
        unfold = Matrix.Translation((BUS_LEAF_FACE_X - xl, d["centre"], 0)) @ Matrix.Diagonal((1, BUS_LEAF_WIDE / (BUS_LEAF_Y * 2), 1, 1)) @ Matrix.Translation((0, -yl, 0))
        panel = cut_pieces(objs["body"], inside)
        if panel is None:
            raise RuntimeError(f"bus: no pieces found for {name}")
        panel.transform(unfold)
        add_door(scene, created, name, panel, hinge)
        pane = cut_pieces(objs["glass"], inside)
        if pane is not None:
            pane.transform(unfold)
            add_door(scene, created, name + "_glass", pane, hinge)


def process(vid):
    path = os.path.join(VEH_DIR, f"{vid}.glb")
    bo.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    scene = bpy.context.scene
    # What a bad earlier run may have left behind on a lorry: it has no bus doors.
    if vid in ("garbage_truck", "goods_van", "wrecker"):
        for o in list(scene.objects):
            if o.name.startswith("door_P"):
                bpy.data.objects.remove(o, do_unlink=True)
    objs = {o.name: o for o in scene.objects}
    created = []
    if vid in PANELS:
        panel_doors(vid, scene, objs, created)
    elif vid in ISLANDS:
        island_doors(vid, scene, objs, created)
    else:
        bus_doors(scene, objs, created)
    if not created:
        print(f"[doors] {vid}: already has its doors, skipping")
        return
    for o in created:
        print(f"[doors] {vid}: {o.name} {len(o.data.polygons)} faces, hinge {tuple(round(v, 2) for v in o.location)}")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=92,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[doors] {vid}: file {os.path.getsize(path) // 1024} KB")
    preview = os.environ.get("BO_DOOR_PREVIEW")
    if preview:
        for o in created:
            # Opens outwards for side doors; the bus leaves fold inwards.
            base = o.name.replace("_glass", "")
            sign = {"door_D": 1, "door_DL": -1, "door_P": -1, "door_PL": 1, "door_P2": 1}[base]
            if vid == "bus_city":
                sign = -1 if base == "door_P" else 1
            o.rotation_euler[2] = 1.1 * sign
        bo.preview_render(os.path.join(preview, f"door_{vid}"), target=(0, 0, 1.0), distance=9 if vid == "bus_city" else 6, angles=(-140, -40, 40, 140), height=1.2, size=(640, 480), samples=20)


def main():
    for vid in bo.script_args() or [*PANELS, *ISLANDS, "bus_city"]:
        process(vid)


if __name__ == "__main__":
    main()
