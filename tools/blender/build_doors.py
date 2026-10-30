"""Cuts opening doors out of already-built vehicles, without rebaking anything.

blender --background --factory-startup --python tools/blender/build_doors.py -- [ids]

Run after build_vehicles.py. Slices the driver's door panel and its window out of `body` and `glass`
along straight planes, so the paint carries over exactly and the hole shows the real interior.
Each door becomes its own object with its origin on the hinge: door_D (body panel) and door_D_glass.
Blender axes: -Y is forward and -X is the vehicle's right, which is the driver's side here.
"""

import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bo_common as bo

VEH_DIR = os.path.join(bo.PUBLIC_ASSETS, "vehicles")

# y0 is the front edge, where the hinge goes. Limits in metres, side is -1 for the right.
DOORS = {
    "car_sedan": dict(y0=-0.56, y1=0.5, z0=0.34, z1=1.2, side=-1, x_min=0.42, x_max=0.92),
    "microbus": dict(y0=-1.12, y1=-0.1, z0=0.42, z1=1.84, side=-1, x_min=0.55, x_max=0.92),
    "truck": dict(y0=-3.32, y1=-2.2, z0=0.86, z1=2.55, side=-1, x_min=0.8, x_max=1.22),
}


def cut(obj, d):
    """Slices obj along the door rectangle and returns the indices of the door faces."""
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
    if not picked:
        bm.free()
        return None
    # Move the door faces into their own mesh, keeping UVs and materials.
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


def process(vid):
    d = DOORS[vid]
    path = os.path.join(VEH_DIR, f"{vid}.glb")
    bo.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    scene = bpy.context.scene
    objs = {o.name: o for o in scene.objects}
    body = objs["body"]
    if "door_D" in objs:
        print(f"[doors] {vid}: already has doors, skipping")
        return
    panel = cut(body, d)
    if panel is None:
        raise RuntimeError(f"{vid}: no door faces found")
    door = bpy.data.objects.new("door_D", panel)
    scene.collection.objects.link(door)
    created = [door]
    if "glass" in objs:
        pane = cut(objs["glass"], d)
        if pane is not None:
            gd = bpy.data.objects.new("door_D_glass", pane)
            scene.collection.objects.link(gd)
            created.append(gd)
    # Origin on the hinge, at the panel's own outer surface.
    edge = sorted(v.co.x for v in panel.vertices if abs(v.co.y - d["y0"]) < 0.06)
    hinge = Vector((edge[len(edge) // 2], d["y0"], (d["z0"] + d["z1"]) / 2))
    for o in created:
        o.data.transform(__import__("mathutils").Matrix.Translation(-hinge))
        o.location = hinge
        o.data.update()
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
    print(f"[doors] {vid}: door_D with {len(panel.polygons)} faces, hinge {tuple(round(v, 2) for v in hinge)}, file {os.path.getsize(path) // 1024} KB")
    preview = os.environ.get("BO_DOOR_PREVIEW")
    if preview:
        for o in created:
            o.rotation_euler[2] = -1.05 * d["side"] * -1
        bo.preview_render(os.path.join(preview, f"door_{vid}"), target=(0, 0, 0.8), distance=6.5, angles=(-125, -60), height=1.0, size=(640, 480), samples=20)


def main():
    for vid in bo.script_args() or list(DOORS):
        process(vid)


if __name__ == "__main__":
    main()
