"""Makes a light copy of every vehicle for use at a distance.

blender --background --factory-startup --python tools/blender/build_vehicle_lods.py -- [ids]

Reads public/assets/vehicles/<id>.glb and writes <id>_lod1.glb next to it, holding two meshes:
`body_lod`, the whole vehicle with the same UVs and far fewer triangles, and `wheels_lod`, plain
low-sided cylinders. Neither has a material: the game reuses the full model's paint.
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import bo_common as bo

VEHICLE_DIR = os.path.join(bo.PUBLIC_ASSETS, "vehicles")
TARGET = {
    "bicycle": 260, "motorbike": 420, "rickshaw": 800, "easybike": 800, "cng": 800,
    "car_sedan": 800, "microbus": 900, "bus_city": 1400, "truck": 1100, "police_car": 800, "ambulance": 900, "leguna": 900, "garbage_truck": 1100, "goods_van": 1000, "wrecker": 1000,
}


def build(vid):
    path = os.path.join(VEHICLE_DIR, f"{vid}.glb")
    bo.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    wheels = [o for o in meshes if o.name.startswith("wheel_")]
    drop = [o for o in meshes if o.name.startswith("glass") or o.name.endswith("_glass") or o.name == "crank"]
    keep = [o for o in meshes if o not in wheels and o not in drop]
    body = next(o for o in keep if o.name == "body")

    bpy.ops.object.select_all(action="DESELECT")
    for o in keep:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    if len(keep) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "body_lod"
    body.data.calc_loop_triangles()
    tris = len(body.data.loop_triangles)
    target = TARGET.get(vid, 800)
    if tris > target:
        dec = body.modifiers.new("dec", "DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = target / tris
        dec.use_collapse_triangulate = True
        bpy.ops.object.select_all(action="DESELECT")
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_apply(modifier="dec")
    body.data.materials.clear()
    body.data.calc_loop_triangles()

    # Wheels: a cylinder at each wheel's place, the same size as the real one.
    made = []
    for w in wheels:
        dims = w.dimensions
        radius = max(dims.y, dims.z) * 0.5
        width = max(dims.x, 0.03)
        location = w.matrix_world.translation.copy()
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=width, location=location, rotation=(0, math.pi / 2, 0))
        made.append(bpy.context.view_layer.objects.active)
    if made:
        bpy.ops.object.select_all(action="DESELECT")
        for o in made:
            o.select_set(True)
        bpy.context.view_layer.objects.active = made[0]
        if len(made) > 1:
            bpy.ops.object.join()
        wheel_obj = bpy.context.view_layer.objects.active
        wheel_obj.name = "wheels_lod"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    out = os.path.join(VEHICLE_DIR, f"{vid}_lod1.glb")
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    for o in bpy.context.scene.objects:
        if o.name == "wheels_lod":
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="NONE",
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[lod] {vid}: {tris} -> {len(body.data.loop_triangles)} tris, {len(wheels)} wheels, {os.path.getsize(out) // 1024} KB")


def main():
    ids = bo.script_args() or list(TARGET)
    for vid in ids:
        build(vid)


if __name__ == "__main__":
    main()
