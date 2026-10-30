"""Makes a light copy of every character for use at a distance.

blender --background --factory-startup --python tools/blender/build_lods.py -- [ids]

Reads public/assets/characters/<id>.glb and writes <id>_lod1.glb next to it: the same skeleton
and UVs with far fewer triangles and no textures (the game reuses the full model's material).
"""

import glob
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import bo_common as bo

TARGET_TRIS = 1300
CHAR_DIR = os.path.join(bo.PUBLIC_ASSETS, "characters")


def build(path):
    bo.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    # The importer also adds a helper shape for displaying bones; only the body and rig matter.
    objs = {o.name: o for o in bpy.context.scene.objects}
    rigs = [o for o in objs.values() if o.type == "ARMATURE"]
    if "body" not in objs or len(rigs) != 1:
        raise RuntimeError(f"{path}: expected a body mesh and one armature")
    body, rig = objs["body"], rigs[0]
    body.data.calc_loop_triangles()
    tris = len(body.data.loop_triangles)
    dec = body.modifiers.new("dec", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = min(1.0, TARGET_TRIS / tris)
    dec.use_collapse_triangulate = True
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    # The decimate has to run before the armature so it works on the rest pose.
    bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
    bpy.ops.object.modifier_apply(modifier="dec")
    body.data.calc_loop_triangles()
    out = path[:-4] + "_lod1.glb"
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="NONE",
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[lod] {os.path.basename(out)} {tris} -> {len(body.data.loop_triangles)} tris, {os.path.getsize(out) // 1024} KB")


def main():
    ids = bo.script_args()
    files = [os.path.join(CHAR_DIR, f"{i}.glb") for i in ids] if ids else sorted(glob.glob(os.path.join(CHAR_DIR, "*.glb")))
    for f in files:
        if not f.endswith("_lod1.glb"):
            build(f)


if __name__ == "__main__":
    main()
