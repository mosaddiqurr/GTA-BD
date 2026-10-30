"""Shared Blender helpers for the Bangladesh Open World asset pipeline.

Run assets headless:
  blender --background --factory-startup --python tools/blender/<script>.py -- <args>

World conventions (every asset must follow them):
  * 1 Blender unit = 1 metre. Blender Z is up.
  * Characters and vehicles face Blender -Y. The glTF exporter and Babylon's
    loader turn that into +Z forward in the game (Blender -X = game +X = the
    asset's own RIGHT side).
  * Origin on the ground plane (z = 0), centred on the asset.
  * Bangladesh drives on the LEFT, so the steering wheel sits on the vehicle's
    right side (Blender -X).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC_ASSETS = os.path.join(ROOT, "public", "assets")


def script_args():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def enable_gpu_cycles(scene, samples=16):
    """Use the RTX GPU for baking and renders when possible; CPU otherwise."""
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = backend
            except TypeError:
                continue
            prefs.get_devices()
            usable = [d for d in prefs.devices if d.type == backend]
            if usable:
                for d in prefs.devices:
                    d.use = d.type == backend
                scene.cycles.device = "GPU"
                print(f"[bo] Cycles device: {backend} ({usable[0].name})")
                return
    except Exception as exc:  # never fail an asset build over the device choice
        print("[bo] GPU setup failed, using CPU:", exc)
    print("[bo] Cycles device: CPU")


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def new_mesh_object(name, verts, faces, collection=None, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    return obj


def loft(name, rings, closed_start=True, closed_end=True, segments=None, collection=None):
    """Build a tube through cross-section rings. This is the workhorse for
    limbs, torsos, fruit bodies and clothes.

    rings: list of dicts {c: (x, y, z), rx, ry, [rot]} or explicit vertex lists.
           Elliptical ring in the XY plane unless `axis` says otherwise:
           axis='z' (default) ring lies in XY; axis='y' ring lies in XZ;
           axis='x' ring lies in YZ.
           Optional `power` makes the ring squarer (superellipse): 2 = ellipse,
           higher = boxier. Optional `fn(theta) -> radius multiplier` shapes it.
    """
    segs = segments or 16
    verts, faces = [], []
    for ring in rings:
        if isinstance(ring, (list, tuple)):
            verts.extend(ring)
            continue
        c = Vector(ring["c"])
        rx, ry = ring["rx"], ring.get("ry", ring["rx"])
        axis = ring.get("axis", "z")
        power = ring.get("power", 2.0)
        fn = ring.get("fn")
        rot = ring.get("rot", 0.0)
        for i in range(segs):
            t = 2 * math.pi * i / segs
            ct, st = math.cos(t), math.sin(t)
            e = 2.0 / power
            a = math.copysign(abs(ct) ** e, ct) * rx
            b = math.copysign(abs(st) ** e, st) * ry
            if fn:
                m = fn(t)
                a, b = a * m, b * m
            if rot:
                a, b = a * math.cos(rot) - b * math.sin(rot), a * math.sin(rot) + b * math.cos(rot)
            if axis == "z":
                verts.append(c + Vector((a, b, 0)))
            elif axis == "y":
                verts.append(c + Vector((a, 0, b)))
            else:
                verts.append(c + Vector((0, a, b)))
    n_rings = len(verts) // segs
    for r in range(n_rings - 1):
        for s in range(segs):
            a = r * segs + s
            b = r * segs + (s + 1) % segs
            c_ = (r + 1) * segs + (s + 1) % segs
            d = (r + 1) * segs + s
            faces.append((a, b, c_, d))
    if closed_start:
        faces.append(tuple(reversed(range(segs))))
    if closed_end:
        faces.append(tuple((n_rings - 1) * segs + i for i in range(segs)))
    obj = new_mesh_object(name, verts, faces, collection)
    recalc_normals(obj)
    return obj


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, bevel_segments=2, collection=None, smooth=None):
    """Axis-aligned box, optionally bevelled. Size is the full extent."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
             (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = new_mesh_object(name, verts, faces, collection, smooth=False)
    obj.location = loc
    obj.rotation_euler = rot
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = bevel_segments
        mod.limit_method = "ANGLE"
        mod.harden_normals = False
        set_smooth(obj, True)
    return obj


def cylinder(name, radius, depth, segments=16, loc=(0, 0, 0), rot=(0, 0, 0), radius_top=None, collection=None, smooth=True):
    """Z-aligned cylinder or cone, centred on loc."""
    rt = radius if radius_top is None else radius_top
    verts, faces = [], []
    for i in range(segments):
        t = 2 * math.pi * i / segments
        verts.append((math.cos(t) * radius, math.sin(t) * radius, -depth / 2))
    for i in range(segments):
        t = 2 * math.pi * i / segments
        verts.append((math.cos(t) * rt, math.sin(t) * rt, depth / 2))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, j + segments, i + segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(segments + i for i in range(segments)))
    obj = new_mesh_object(name, verts, faces, collection, smooth=smooth)
    obj.location = loc
    obj.rotation_euler = rot
    if smooth:
        # Keep the caps crisp while the side stays round.
        obj.data.polygons[-1].use_smooth = False
        obj.data.polygons[-2].use_smooth = False
    return obj


def uv_sphere(name, radius=1.0, segments=24, rings=16, loc=(0, 0, 0), scale=(1, 1, 1), collection=None):
    verts, faces = [], []
    verts.append((0, 0, radius))
    for r in range(1, rings):
        phi = math.pi * r / rings
        for s in range(segments):
            t = 2 * math.pi * s / segments
            verts.append((radius * math.sin(phi) * math.cos(t), radius * math.sin(phi) * math.sin(t), radius * math.cos(phi)))
    verts.append((0, 0, -radius))
    for s in range(segments):
        faces.append((0, 1 + s, 1 + (s + 1) % segments))
    for r in range(rings - 2):
        for s in range(segments):
            a = 1 + r * segments + s
            b = 1 + r * segments + (s + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    last = len(verts) - 1
    base = 1 + (rings - 2) * segments
    for s in range(segments):
        faces.append((last, base + (s + 1) % segments, base + s))
    obj = new_mesh_object(name, verts, faces, collection)
    obj.location = loc
    obj.scale = scale
    return obj


def tube_path(name, points, radius, segments=8, collection=None, close_ends=True):
    """Round tube along a polyline (frames, handlebars, grills, wires)."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        if i == 0:
            d = pts[1] - pts[0]
        elif i == len(pts) - 1:
            d = pts[-1] - pts[-2]
        else:
            d = pts[i + 1] - pts[i - 1]
        d.normalize()
        ref = up if abs(d.dot(up)) < 0.95 else Vector((1, 0, 0))
        x = d.cross(ref).normalized()
        y = d.cross(x).normalized()
        for s in range(segments):
            t = 2 * math.pi * s / segments
            verts.append(p + (x * math.cos(t) + y * math.sin(t)) * radius)
    for r in range(len(pts) - 1):
        for s in range(segments):
            a = r * segments + s
            b = r * segments + (s + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    if close_ends:
        faces.append(tuple(reversed(range(segments))))
        faces.append(tuple((len(pts) - 1) * segments + s for s in range(segments)))
    obj = new_mesh_object(name, verts, faces, collection)
    recalc_normals(obj)
    return obj


def set_smooth(obj, smooth=True):
    for poly in obj.data.polygons:
        poly.use_smooth = smooth


def recalc_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def subsurf(obj, levels=2, crease_ends=False):
    mod = obj.modifiers.new("subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    return mod


def solidify(obj, thickness=0.01, offset=1.0):
    mod = obj.modifiers.new("solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    return mod


def apply_modifiers(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    obj.modifiers.clear()
    old = obj.data
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)


def apply_transforms(obj):
    mat = obj.matrix_world.copy()
    obj.data.transform(mat)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()


def join(objects, name):
    """Join objects (modifiers and transforms applied) into a single mesh."""
    objs = [o for o in objects if o is not None]
    for o in objs:
        apply_modifiers(o)
        apply_transforms(o)
    bm = bmesh.new()
    target_materials = []
    for o in objs:
        mesh = o.data
        remap = {}
        for i, mat in enumerate(mesh.materials):
            if mat not in target_materials:
                target_materials.append(mat)
            remap[i] = target_materials.index(mat)
        start = len(bm.faces)
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[start:]:
            f.material_index = remap.get(f.material_index, 0)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    for m in target_materials:
        out.materials.append(m)
    obj = bpy.data.objects.new(name, out)
    bpy.context.scene.collection.objects.link(obj)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return obj


def assign(obj, mat):
    """Give every face of obj a single material."""
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


# ---------------------------------------------------------------------------
# Procedural materials (these get baked down to a single texture set)
# ---------------------------------------------------------------------------


def pbr(name, color=(0.8, 0.8, 0.8), roughness=0.6, metallic=0.0, emission=None, emission_strength=0.0):
    """Plain Principled material. Colour is linear RGB."""
    mat = bpy.data.materials.new(name)
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF") or nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def bsdf_of(mat):
    return mat.node_tree.nodes.get("Principled BSDF")


def add_noise_color(mat, color_a, color_b, scale=40.0, detail=6.0, mapping="object"):
    """Mottled base colour: mixes two colours with noise. Good for skin and dust."""
    nt = mat.node_tree
    bsdf = bsdf_of(mat)
    tex = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[0].color = (*color_a, 1)
    ramp.color_ramp.elements[1].color = (*color_b, 1)
    nt.links.new(tex.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def add_bump(mat, scale=120.0, strength=0.15, distance=0.01, kind="noise"):
    """Fine surface detail (fabric, pores, cast iron). Captured in the normal bake."""
    nt = mat.node_tree
    bsdf = bsdf_of(mat)
    tex = nt.nodes.new("ShaderNodeTexCoord")
    if kind == "wave":
        src = nt.nodes.new("ShaderNodeTexWave")
        src.inputs["Scale"].default_value = scale
        out = src.outputs["Fac"]
    elif kind == "voronoi":
        src = nt.nodes.new("ShaderNodeTexVoronoi")
        src.inputs["Scale"].default_value = scale
        out = src.outputs["Distance"]
    else:
        src = nt.nodes.new("ShaderNodeTexNoise")
        src.inputs["Scale"].default_value = scale
        src.inputs["Detail"].default_value = 8.0
        out = src.outputs["Fac"]
    nt.links.new(tex.outputs["Object"], src.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = distance
    nt.links.new(out, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def add_plaid(mat, colors, scale=14.0, base=None):
    """Woven check for lungi and gamcha: crossing bands of colour in object space."""
    nt = mat.node_tree
    bsdf = bsdf_of(mat)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs[0])

    def bands(axis_out):
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = scale
        nt.links.new(axis_out, mul.inputs[0])
        fr = nt.nodes.new("ShaderNodeMath")
        fr.operation = "FRACT"
        nt.links.new(mul.outputs[0], fr.inputs[0])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        n = len(colors)
        ramp.color_ramp.elements[0].color = (*colors[0], 1)
        ramp.color_ramp.elements[1].position = 1 / n
        ramp.color_ramp.elements[1].color = (*colors[1 % n], 1)
        for i in range(2, n):
            el = ramp.color_ramp.elements.new(i / n)
            el.color = (*colors[i], 1)
        nt.links.new(fr.outputs[0], ramp.inputs["Fac"])
        return ramp.outputs["Color"]

    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[0].default_value = 0.5
    nt.links.new(bands(sep.outputs["X"]), mix.inputs[6])
    nt.links.new(bands(sep.outputs["Z"]), mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


# ---------------------------------------------------------------------------
# Bake everything to one PBR set, then export
# ---------------------------------------------------------------------------


def smart_uv(obj, margin=0.006, angle=66.0):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def _bake_target(obj, image):
    for mat in obj.data.materials:
        nt = mat.node_tree
        node = nt.nodes.get("bo_bake") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "bo_bake"
        node.image = image
        nt.nodes.active = node


def bake_pbr(obj, size=1024, name=None, samples=12, with_ao=True, margin=8, keep_alpha=False):
    """Bake the object's many procedural materials into one material with
    albedo (AO multiplied in), normal and roughness/metallic textures.
    Returns the new material. Needs Cycles, an active UV map and a linked object.
    """
    scene = bpy.context.scene
    name = name or obj.name
    enable_gpu_cycles(scene, samples=samples)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    scene.render.bake.margin = margin
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False

    def run(kind, image, **kw):
        _bake_target(obj, image)
        bpy.ops.object.bake(type=kind, **kw)

    albedo = bpy.data.images.new(f"{name}_albedo", size, size, alpha=False)
    # Cycles reports black diffuse colour for metal and glass, so neutralise both
    # for this pass only. Roughness and metallic bakes below still see real values.
    saved = _neutralise_for_diffuse(obj)
    run("DIFFUSE", albedo, pass_filter={"COLOR"})
    _restore_after_diffuse(saved)

    rough = bpy.data.images.new(f"{name}_rough", size, size, alpha=False, float_buffer=False)
    rough.colorspace_settings.name = "Non-Color"
    run("ROUGHNESS", rough)

    normal = bpy.data.images.new(f"{name}_normal", size, size, alpha=False, float_buffer=False)
    normal.colorspace_settings.name = "Non-Color"
    run("NORMAL", normal, normal_space="TANGENT")

    # Metallic is read through emission because Cycles has no metallic pass.
    metal = bpy.data.images.new(f"{name}_metal", size, size, alpha=False)
    metal.colorspace_settings.name = "Non-Color"
    _swap_to_metal_emission(obj)
    run("EMIT", metal)
    _restore_from_metal_emission(obj)

    if with_ao:
        ao = bpy.data.images.new(f"{name}_ao", size, size, alpha=False)
        ao.colorspace_settings.name = "Non-Color"
        scene.cycles.samples = max(samples, 32)
        run("AO", ao)
        scene.cycles.samples = samples
        _multiply_ao_into(albedo, ao, strength=0.75)

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
    n.image = normal
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def _neutralise_for_diffuse(obj):
    saved = []
    for mat in obj.data.materials:
        bsdf = bsdf_of(mat)
        for socket in ("Metallic", "Transmission Weight"):
            inp = bsdf.inputs.get(socket)
            if inp is None:
                continue
            link_from = inp.links[0].from_socket if inp.links else None
            saved.append((mat, inp, inp.default_value, link_from))
            if inp.links:
                mat.node_tree.links.remove(inp.links[0])
            inp.default_value = 0.0
    return saved


def _restore_after_diffuse(saved):
    for mat, inp, value, link_from in saved:
        inp.default_value = value
        if link_from is not None:
            mat.node_tree.links.new(link_from, inp)


def _swap_to_metal_emission(obj):
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = bsdf_of(mat)
        output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if output is None:
            continue
        mat["bo_surface_from"] = output.inputs["Surface"].links[0].from_node.name if output.inputs["Surface"].links else ""
        emit = nt.nodes.new("ShaderNodeEmission")
        emit.name = "bo_metal_emit"
        inp = bsdf.inputs["Metallic"]
        if inp.links:
            nt.links.new(inp.links[0].from_socket, emit.inputs["Color"])
        else:
            v = inp.default_value
            emit.inputs["Color"].default_value = (v, v, v, 1)
        nt.links.new(emit.outputs["Emission"], output.inputs["Surface"])


def _restore_from_metal_emission(obj):
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = bsdf_of(mat)
        output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        emit = nt.nodes.get("bo_metal_emit")
        if output is not None:
            nt.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
        if emit is not None:
            nt.nodes.remove(emit)


def _multiply_ao_into(albedo, ao, strength=0.75):
    import numpy as np

    w, h = albedo.size
    a = np.empty(w * h * 4, dtype=np.float32)
    b = np.empty(w * h * 4, dtype=np.float32)
    albedo.pixels.foreach_get(a)
    ao.pixels.foreach_get(b)
    k = 1.0 - strength * (1.0 - b[0::4])
    a[0::4] *= k
    a[1::4] *= k
    a[2::4] *= k
    albedo.pixels.foreach_set(a)
    albedo.update()


def export_glb(path, objects=None, animations=False, image_format="WEBP", quality=88):
    """Export selected objects (or everything) to a game-ready GLB."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    use_sel = objects is not None
    if use_sel:
        for o in objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=use_sel,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format=image_format,
        export_image_quality=quality,
        export_animations=animations,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    size_kb = os.path.getsize(path) / 1024
    tris = 0
    for o in objects or bpy.context.scene.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    print(f"[bo] exported {os.path.relpath(path, ROOT)}  {size_kb:.0f} KB  {tris} tris")


# ---------------------------------------------------------------------------
# Preview render for visual review
# ---------------------------------------------------------------------------


def preview_render(path, target=(0, 0, 0.7), distance=3.5, angles=(-30,), height=1.2, size=(720, 720), samples=32):
    """Render one PNG per yaw angle (degrees, 0 = looking at the asset's front)
    with a neutral warm-daylight studio. Writes path_<angle>.png.
    """
    scene = bpy.context.scene
    enable_gpu_cycles(scene, samples=samples)
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("preview")
    scene.world = world
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.62, 0.72, 0.9, 1)
    bg.inputs[1].default_value = 0.9
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.5
    sun_data.angle = math.radians(6)
    sun_data.color = (1.0, 0.92, 0.8)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    ground = bpy.data.meshes.new("ground")
    ground.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    ground_obj = bpy.data.objects.new("ground", ground)
    scene.collection.objects.link(ground_obj)
    ground.materials.append(pbr("ground", (0.32, 0.31, 0.3), 0.9))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    t = Vector(target)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for yaw in angles:
        a = math.radians(yaw)
        cam.location = (t.x + math.sin(a) * distance, t.y - math.cos(a) * distance, t.z + height)
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{path}_{yaw}.png"
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground_obj, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)
