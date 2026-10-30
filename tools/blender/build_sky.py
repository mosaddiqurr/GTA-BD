"""Renders the sky panoramas used for the sky dome and image-based lighting.

blender --background --factory-startup --python tools/blender/build_sky.py -- [key ...]

Each key writes public/assets/sky/<key>.webp (dome, tone mapped) and <key>.hdr
(small linear panorama for lighting). The panorama centre looks north (game +Z,
Blender +Y) and east is on its right. The sun disc is left out because the game
draws it itself, so it can move smoothly between the keyframes.
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import bo_common as bo

SKY_DIR = os.path.join(bo.PUBLIC_ASSETS, "sky")

# elevation/azimuth in degrees; azimuth measured clockwise from north, seen from above.
PRESETS = {
    "morning": dict(el=22, az=108, air=1.4, dust=4.0, ozone=1.0, cloud=0.52, cloud_col=(1.0, 0.93, 0.84), strength=0.28),
    "noon": dict(el=66, az=175, air=1.2, dust=3.2, ozone=1.0, cloud=0.50, cloud_col=(1.0, 0.99, 0.97), strength=0.30),
    "golden": dict(el=9, az=258, air=1.9, dust=6.5, ozone=1.3, cloud=0.49, cloud_col=(1.0, 0.64, 0.36), strength=0.5),
    "dusk": dict(el=1.5, az=272, air=1.8, dust=6.0, ozone=1.6, cloud=0.52, cloud_col=(0.95, 0.42, 0.34), strength=0.65),
    "night": None,
}


def noise_clouds(nt, coord_out, threshold, color, sky_out, sun_azimuth):
    """Layered cirrus and cumulus, projected on a plane above the camera so they
    converge realistically at the horizon."""
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord_out, sep.inputs[0])
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "ADD"
    add.inputs[1].default_value = 0.08
    nt.links.new(sep.outputs["Z"], add.inputs[0])
    px = nt.nodes.new("ShaderNodeMath")
    px.operation = "DIVIDE"
    nt.links.new(sep.outputs["X"], px.inputs[0])
    nt.links.new(add.outputs[0], px.inputs[1])
    py = nt.nodes.new("ShaderNodeMath")
    py.operation = "DIVIDE"
    nt.links.new(sep.outputs["Y"], py.inputs[0])
    nt.links.new(add.outputs[0], py.inputs[1])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(px.outputs[0], comb.inputs[0])
    nt.links.new(py.outputs[0], comb.inputs[1])

    big = nt.nodes.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 0.85
    big.inputs["Detail"].default_value = 12.0
    big.inputs["Roughness"].default_value = 0.58
    big.inputs["Distortion"].default_value = 0.35
    nt.links.new(comb.outputs[0], big.inputs["Vector"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = threshold
    ramp.color_ramp.elements[1].position = threshold + 0.14
    nt.links.new(big.outputs["Fac"], ramp.inputs["Fac"])

    # Fade clouds out near the horizon, where the haze swallows them.
    horizon = nt.nodes.new("ShaderNodeMapRange")
    horizon.inputs["From Min"].default_value = 0.0
    horizon.inputs["From Max"].default_value = 0.16
    nt.links.new(sep.outputs["Z"], horizon.inputs["Value"])
    mask = nt.nodes.new("ShaderNodeMath")
    mask.operation = "MULTIPLY"
    nt.links.new(ramp.outputs["Color"], mask.inputs[0])
    nt.links.new(horizon.outputs["Result"], mask.inputs[1])
    op = nt.nodes.new("ShaderNodeMath")
    op.operation = "MULTIPLY"
    op.inputs[1].default_value = 0.92
    nt.links.new(mask.outputs[0], op.inputs[0])

    # Two-sample lighting: compare the density here against a point towards the sun,
    # which gives the clouds a lit edge and a shaded belly instead of a flat tint.
    az = math.radians(sun_azimuth)
    offset = nt.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (math.sin(az) * 0.09, math.cos(az) * 0.09, 0.0)
    nt.links.new(comb.outputs[0], offset.inputs[0])
    towards_sun = nt.nodes.new("ShaderNodeTexNoise")
    towards_sun.inputs["Scale"].default_value = 0.85
    towards_sun.inputs["Detail"].default_value = 12.0
    towards_sun.inputs["Roughness"].default_value = 0.58
    towards_sun.inputs["Distortion"].default_value = 0.35
    nt.links.new(offset.outputs[0], towards_sun.inputs["Vector"])
    diff = nt.nodes.new("ShaderNodeMath")
    diff.operation = "SUBTRACT"
    nt.links.new(big.outputs["Fac"], diff.inputs[0])
    nt.links.new(towards_sun.outputs["Fac"], diff.inputs[1])
    lit = nt.nodes.new("ShaderNodeMapRange")
    lit.inputs["From Min"].default_value = -0.06
    lit.inputs["From Max"].default_value = 0.06
    nt.links.new(diff.outputs[0], lit.inputs["Value"])
    shade_mix = nt.nodes.new("ShaderNodeMix")
    shade_mix.data_type = "RGBA"
    nt.links.new(lit.outputs["Result"], shade_mix.inputs[0])
    shade_mix.inputs[6].default_value = (color[0] * 0.42, color[1] * 0.46, color[2] * 0.58, 1)
    shade_mix.inputs[7].default_value = (*color, 1)

    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(op.outputs[0], mix.inputs[0])
    nt.links.new(sky_out, mix.inputs[6])
    nt.links.new(shade_mix.outputs[2], mix.inputs[7])
    return mix.outputs[2]


def add_ground_bounce(nt, coord_out, sky_out, color):
    """Below the horizon the panorama is dark, which starves undersides of light.
    Replace it with the warm dusty bounce you get off a Dhaka street."""
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord_out, sep.inputs[0])
    gate = nt.nodes.new("ShaderNodeMapRange")
    gate.inputs["From Min"].default_value = -0.012
    gate.inputs["From Max"].default_value = 0.002
    nt.links.new(sep.outputs["Z"], gate.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(gate.outputs["Result"], mix.inputs[0])
    mix.inputs[6].default_value = (*color, 1)
    nt.links.new(sky_out, mix.inputs[7])
    return mix.outputs[2]


def build_day_world(cfg):
    world = bpy.data.worlds.new("sky")
    nt = world.node_tree
    bg = nt.nodes["Background"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sky = nt.nodes.new("ShaderNodeTexSky")
    # Blender 5 renamed the sky models; take the best one this build offers.
    available = [i.identifier for i in sky.bl_rna.properties["sky_type"].enum_items]
    for wanted in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "NISHITA"):
        if wanted in available:
            sky.sky_type = wanted
            break
    print("[sky] model", sky.sky_type, "from", available)
    sky.sun_disc = False
    sky.sun_elevation = math.radians(cfg["el"])
    # Blender's rotation is clockwise from +Y looking down, matching our azimuth.
    sky.sun_rotation = math.radians(cfg["az"])
    sky.air_density = cfg["air"]
    sky.aerosol_density = cfg["dust"]
    sky.ozone_density = cfg["ozone"]
    # Clouds lit roughly by sky brightness: scale the cloud colour to match.
    scale = nt.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 1.0
    nt.links.new(sky.outputs["Color"], scale.inputs[0])
    b = cfg["strength"]
    color = tuple(c * b * 10.0 for c in cfg["cloud_col"])
    out = noise_clouds(nt, coord.outputs["Generated"], cfg["cloud"], color, scale.outputs[0], cfg["az"])
    # Bounce is authored before the world strength, so divide it back out.
    bounce = (0.30 / b, 0.25 / b, 0.20 / b) if cfg["el"] > 8 else (0.12 / b, 0.09 / b, 0.08 / b)
    out = add_ground_bounce(nt, coord.outputs["Generated"], out, bounce)
    nt.links.new(out, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = b
    return world


def build_night_world():
    """Dhaka night: sodium-orange haze at the horizon, deep blue above, a few stars."""
    world = bpy.data.worlds.new("sky")
    nt = world.node_tree
    bg = nt.nodes["Background"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (0.17, 0.10, 0.06, 1)
    els[1].position = 0.45
    els[1].color = (0.006, 0.010, 0.026, 1)
    mid = els.new(0.09)
    mid.color = (0.05, 0.035, 0.05, 1)
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])

    stars = nt.nodes.new("ShaderNodeTexVoronoi")
    stars.inputs["Scale"].default_value = 260.0
    nt.links.new(coord.outputs["Generated"], stars.inputs["Vector"])
    gate = nt.nodes.new("ShaderNodeMapRange")
    gate.inputs["From Min"].default_value = 0.035
    gate.inputs["From Max"].default_value = 0.0
    gate.inputs["To Max"].default_value = 0.5
    nt.links.new(stars.outputs["Distance"], gate.inputs["Value"])
    high = nt.nodes.new("ShaderNodeMapRange")
    high.inputs["From Min"].default_value = 0.2
    high.inputs["From Max"].default_value = 0.5
    nt.links.new(sep.outputs["Z"], high.inputs["Value"])
    mult = nt.nodes.new("ShaderNodeMath")
    mult.operation = "MULTIPLY"
    nt.links.new(gate.outputs["Result"], mult.inputs[0])
    nt.links.new(high.outputs["Result"], mult.inputs[1])
    add = nt.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    nt.links.new(ramp.outputs["Color"], add.inputs[0])
    nt.links.new(mult.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    return world


def render(key, cfg):
    scene = bo.reset_scene()
    bo.enable_gpu_cycles(scene, samples=48)
    scene.cycles.use_denoising = False
    scene.world = build_night_world() if cfg is None else build_day_world(cfg)

    cam_data = bpy.data.cameras.new("pano")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("pano", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Looks along +Y (north) with +Z up, so the image centre faces north and +X is on the right.
    cam.rotation_euler = (math.radians(90), 0, 0)

    os.makedirs(SKY_DIR, exist_ok=True)
    # Linear panorama for image-based lighting.
    scene.render.resolution_x, scene.render.resolution_y = 512, 256
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "HDR"
    scene.render.filepath = os.path.join(SKY_DIR, f"{key}.hdr")
    bpy.ops.render.render(write_still=True)

    # Display panorama for the dome.
    scene.render.resolution_x, scene.render.resolution_y = 4096, 2048
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy" if cfg is not None else "None"
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 90
    scene.render.filepath = os.path.join(SKY_DIR, f"{key}.webp")
    bpy.ops.render.render(write_still=True)
    print(f"[sky] wrote {key}")


def main():
    keys = bo.script_args() or list(PRESETS)
    for key in keys:
        render(key, PRESETS[key])


if __name__ == "__main__":
    main()
