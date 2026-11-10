# Photoreal turntable + record crate for the scroll film (Blender 5.x / Cycles, via the bpy module).
#
#   python render/scene.py -- --variant wide --samples 32 --out render/out/wide           # main film
#   python render/scene.py -- --variant wide --loop --samples 32 --out render/out/wide    # crate loop
#   python render/scene.py -- --variant wide --still 120 --scale 50 --out /tmp/test       # one frame
#
# Main film, 150 frames, beats: 1 intro · 30 needle · 60 teardown · 90 numbers · 120 crate · 150 top-down.
# Crate loop, 48 frames (201–248): the front sleeve is lifted out, turned to the camera, the record
# slides out, then everything goes back; frame 248 equals frame 201 so the loop plays once per project.
# The lifted sleeve's front face is plain white: the browser multiplies the project cover onto it, using
# the face corners exported in anchors.json.
import argparse
import json
import math
import os
import random
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--variant', default='wide', choices=['wide', 'tall'])
ap.add_argument('--samples', type=int, default=32)
ap.add_argument('--frames', default='')
ap.add_argument('--loop', action='store_true')
ap.add_argument('--still', type=int, default=0)
ap.add_argument('--scale', type=int, default=100)
ap.add_argument('--out', default='render/out/wide')
ap.add_argument('--anchors-only', action='store_true')
args = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'tex')
ASSETS = os.path.join(HERE, 'assets')
WIDE = args.variant == 'wide'
FRAMES = 150
BEATS = [1, 30, 60, 90, 120, 150]
LOOP_START, LOOP_LEN = 201, 48
V = Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, LOOP_START + LOOP_LEN
scene.render.fps = 30

# ---------- Render settings ----------
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except TypeError:
    print('[scene] no OpenImageDenoise in this build: raise --samples')
    scene.cycles.use_denoising = False
scene.cycles.max_bounces = 8
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 2
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.blur_glossy = 0.5
scene.render.resolution_x, scene.render.resolution_y = (1600, 900) if WIDE else (720, 1280)
scene.render.resolution_percentage = args.scale
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.view_settings.view_transform = 'AgX'
for look in ('AgX - Medium High Contrast', 'Medium High Contrast'):
    try:
        scene.view_settings.look = look
        break
    except TypeError:
        pass
scene.view_settings.exposure = 0.15

# ---------- World: a real studio HDRI (Poly Haven, CC0) for reflections ----------
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
env = wn.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(ASSETS, 'studio_small_09_2k.hdr'))
mapping = wn.new('ShaderNodeMapping')
mapping.inputs['Rotation'].default_value = (0, 0, math.radians(215))
tc = wn.new('ShaderNodeTexCoord')
wl.new(tc.outputs['Generated'], mapping.inputs['Vector'])
wl.new(mapping.outputs['Vector'], env.inputs['Vector'])
bg = wn['Background']
bg.inputs['Strength'].default_value = 0.16
wl.new(env.outputs['Color'], bg.inputs['Color'])
# The camera sees a plain dark backdrop, not the HDRI.
lp = wn.new('ShaderNodeLightPath')
mix = wn.new('ShaderNodeMixShader')
dark = wn.new('ShaderNodeBackground')
dark.inputs['Color'].default_value = (0.0012, 0.0018, 0.004, 1)
wl.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
wl.new(bg.outputs['Background'], mix.inputs[1])
wl.new(dark.outputs['Background'], mix.inputs[2])
wl.new(mix.outputs['Shader'], wn['World Output'].inputs['Surface'])


# ---------- Materials ----------
def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, color, rough=0.4, metal=0.0, coat=0.0, coat_rough=0.06, aniso=0.0, emit=None, emit_strength=0.0, spec=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = coat_rough
    if aniso:
        b.inputs['Anisotropic'].default_value = aniso
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if spec is not None:
        b.inputs['Specular IOR Level'].default_value = spec
    return m


def nodes_of(m):
    return m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes['Principled BSDF']


def image_node(m, path, non_color=False, coords='Generated', scale=None):
    nodes, links, _ = nodes_of(m)
    tc = nodes.new('ShaderNodeTexCoord')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path, check_existing=True)
    if non_color:
        tex.image.colorspace_settings.name = 'Non-Color'
    out = tc.outputs[coords]
    if scale:
        mp = nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = scale
        links.new(out, mp.inputs['Vector'])
        out = mp.outputs['Vector']
    links.new(out, tex.inputs['Vector'])
    return tex


def radial_tangent(m):
    nodes, links, b = nodes_of(m)
    t = nodes.new('ShaderNodeTangent')
    t.direction_type = 'RADIAL'
    t.axis = 'Z'
    links.new(t.outputs['Tangent'], b.inputs['Tangent'])


def noise_bump(m, scale, strength, distance=0.002, detail=4.0):
    nodes, links, b = nodes_of(m)
    n = nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = distance
    links.new(n.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return bump


def pbr_textures(m, diff, rough, normal, scale=(1, 1, 1), coords='Generated'):
    nodes, links, b = nodes_of(m)
    d = image_node(m, diff, coords=coords, scale=scale)
    links.new(d.outputs['Color'], b.inputs['Base Color'])
    r = image_node(m, rough, True, coords=coords, scale=scale)
    links.new(r.outputs['Color'], b.inputs['Roughness'])
    n = image_node(m, normal, True, coords=coords, scale=scale)
    nm = nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 0.8
    links.new(n.outputs['Color'], nm.inputs['Color'])
    links.new(nm.outputs['Normal'], b.inputs['Normal'])


M = {
    'lacquer': mat('Lacquer', srgb('#0A1F44'), 0.3, 0.0, coat=1.0, coat_rough=0.04),
    'plate': mat('Plate', srgb('#0F1B33'), 0.35, 0.9, aniso=0.6),
    'alu': mat('Aluminium', srgb('#D9DEE6'), 0.22, 1.0, aniso=0.8),
    'chrome': mat('Chrome', srgb('#E6EAF0'), 0.12, 1.0),
    'dark': mat('DarkMetal', srgb('#1A2234'), 0.3, 0.9),
    'rubber': mat('Rubber', srgb('#0A0C12'), 0.85),
    'felt': mat('Felt', (0.012, 0.013, 0.018), 0.95, spec=0.2),
    'amber': mat('Amber', srgb('#FFB547'), 0.35, 0.0, coat=0.5),
    'sky': mat('Sky', srgb('#2E66E8'), 0.3, 0.0, coat=0.6, emit=srgb('#2E66E8'), emit_strength=0.5),
    'led': mat('Led', (0.6, 0.75, 1), 0.3, emit=(0.6, 0.75, 1), emit_strength=8),
    'paper': mat('Paper', (0.86, 0.85, 0.82), 0.62, spec=0.35),
    'cream': mat('Cream', (0.8, 0.74, 0.6), 0.65, spec=0.3),
    'kraft': mat('Kraft', (0.36, 0.24, 0.13), 0.7, spec=0.3),
    'navysleeve': mat('NavySleeve', srgb('#0A1F44'), 0.55, spec=0.35),
    'blacksleeve': mat('BlackSleeve', (0.02, 0.02, 0.022), 0.5, spec=0.35),
    'white': mat('WhiteFace', (0.93, 0.93, 0.92), 0.58, spec=0.35),
    'steel': mat('Steel', (0.35, 0.36, 0.38), 0.45, 1.0),
    'table': mat('Table', (0.2, 0.15, 0.1), 0.4),
    'plywood': mat('Plywood', (0.6, 0.45, 0.28), 0.6),
}
noise_bump(M['lacquer'], 400, 0.02, 0.001)  # orange peel on the lacquer
noise_bump(M['felt'], 900, 0.35, 0.002, 6)
noise_bump(M['paper'], 600, 0.08, 0.001)
noise_bump(M['white'], 600, 0.08, 0.001)
radial_tangent(M['plate'])
radial_tangent(M['alu'])
pbr_textures(M['table'], os.path.join(ASSETS, 'wood_table_001_diff_2k.jpg'), os.path.join(ASSETS, 'wood_table_001_rough_2k.jpg'), os.path.join(ASSETS, 'wood_table_001_nor_gl_2k.jpg'), scale=(7, 7, 7))
tn, tl, tb = nodes_of(M['table'])
tb.inputs['Coat Weight'].default_value = 0.3
tb.inputs['Coat Roughness'].default_value = 0.22
# The table reads darker than the photo: a dark stained wood.
darken = tn.new('ShaderNodeMix')
darken.data_type = 'RGBA'
darken.blend_type = 'MULTIPLY'
darken.inputs['Factor'].default_value = 1.0
darken.inputs[7].default_value = (0.22, 0.17, 0.13, 1)
tl.new(tb.inputs['Base Color'].links[0].from_socket, darken.inputs[6])
tl.new(darken.outputs[2], tb.inputs['Base Color'])
pbr_textures(M['plywood'], os.path.join(ASSETS, 'plywood_diff_1k.jpg'), os.path.join(ASSETS, 'plywood_rough_1k.jpg'), os.path.join(ASSETS, 'plywood_nor_gl_1k.jpg'), scale=(0.8, 0.8, 0.8), coords='Object')

# Vinyl: grooves as bump, radial anisotropy (the star-shaped highlight), micro-scratches.
vinyl = bpy.data.materials.new('Vinyl')
vinyl.use_nodes = True
vn, vl, vb = nodes_of(vinyl)
vb.inputs['Base Color'].default_value = (0.005, 0.006, 0.009, 1)
vb.inputs['Coat Weight'].default_value = 0.4
vb.inputs['Coat Roughness'].default_value = 0.18
vb.inputs['Anisotropic'].default_value = 0.75
radial_tangent(vinyl)
g = image_node(vinyl, os.path.join(TEX, 'grooves.png'), True)
rough = image_node(vinyl, os.path.join(TEX, 'rough.png'), True)
bump = vn.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.22
bump.inputs['Distance'].default_value = 0.002
vl.new(g.outputs['Color'], bump.inputs['Height'])
vl.new(bump.outputs['Normal'], vb.inputs['Normal'])
scratch = vn.new('ShaderNodeTexNoise')
scratch.inputs['Scale'].default_value = 60
scratch.inputs['Detail'].default_value = 8
scratch.inputs['Roughness'].default_value = 0.8
mixr = vn.new('ShaderNodeMix')
mixr.data_type = 'FLOAT'
mixr.inputs['Factor'].default_value = 0.25
vl.new(rough.outputs['Color'], mixr.inputs[2])
vl.new(scratch.outputs['Fac'], mixr.inputs[3])
vl.new(mixr.outputs[0], vb.inputs['Roughness'])

label = bpy.data.materials.new('Label')
label.use_nodes = True
_, ll, lb = nodes_of(label)
lb.inputs['Roughness'].default_value = 0.55
lb.inputs['Specular IOR Level'].default_value = 0.3
lt = image_node(label, os.path.join(TEX, 'label.png'))
ll.new(lt.outputs['Color'], lb.inputs['Base Color'])
noise_bump(label, 500, 0.06, 0.001)

sleeveback = bpy.data.materials.new('SleeveBack')
sleeveback.use_nodes = True
_, sl, sb = nodes_of(sleeveback)
sb.inputs['Roughness'].default_value = 0.6
sb.inputs['Specular IOR Level'].default_value = 0.35
st = image_node(sleeveback, os.path.join(TEX, 'sleeve-back.png'), coords='UV')
sl.new(st.outputs['Color'], sb.inputs['Base Color'])
noise_bump(sleeveback, 600, 0.08, 0.001)


# ---------- Geometry helpers ----------
def link(o):
    scene.collection.objects.link(o)
    return o


def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)):
    e = link(bpy.data.objects.new(name, None))
    e.location = loc
    e.rotation_euler = rot
    e.parent = parent
    return e


def finish(o, material, parent, bevel=0.0, segs=3, smooth=True):
    o.data.materials.append(material)
    o.parent = parent
    if bevel:
        mod = o.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = 'ANGLE'
    if smooth:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return o


def box(name, size, loc, material, parent, bevel=0.0, segs=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, material, parent, bevel, segs)


def cyl(name, r, depth, loc, material, parent, bevel=0.0, verts=128, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    return finish(o, material, parent, bevel)


def plane(name, size, loc, material, parent, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    o.parent = parent
    return o


# ---------- Turntable (Z up, front = -Y) ----------
PT = 0.54  # plinth top
DT = PT + 0.15  # record top
root = empty('Turntable')
base = empty('L_Base', parent=root)
platter_l = empty('L_Platter', parent=root)
record_l = empty('L_Record', parent=root)
ARM_AT = V((1.85, 1.05, PT))
arm_l = empty('L_Arm', ARM_AT, parent=root)

box('Plinth', (4.6, 3.5, 0.42), (0, 0, 0.33), M['lacquer'], base, bevel=0.06, segs=6)
for x, y in [(-1.95, -1.45), (1.95, -1.45), (-1.95, 1.45), (1.95, 1.45)]:
    cyl('Foot', 0.21, 0.12, (x, y, 0.06), M['rubber'], base, bevel=0.02, verts=48)
box('TopPlate', (4.36, 3.26, 0.012), (0, 0, PT + 0.006), M['plate'], base, bevel=0.004, segs=2)
bpy.ops.mesh.primitive_torus_add(major_radius=1.58, minor_radius=0.022, location=(0, 0, PT + 0.014), major_segments=160, minor_segments=12)
finish(bpy.context.object, M['dark'], base)
box('StartStop', (0.52, 0.3, 0.06), (-1.78, -1.32, PT + 0.04), M['dark'], base, bevel=0.015)
box('Led', (0.08, 0.06, 0.02), (-1.6, -1.32, PT + 0.075), M['led'], base, bevel=0.005, segs=2)
cyl('Knob', 0.11, 0.1, (-1.2, -1.34, PT + 0.06), M['sky'], base, bevel=0.015, verts=48, r2=0.1)
cyl('Knob2', 0.11, 0.1, (-0.85, -1.34, PT + 0.06), M['dark'], base, bevel=0.015, verts=48, r2=0.1)
for x in (-1.2, -0.85):
    cyl('KnobRing', 0.13, 0.015, (x, -1.34, PT + 0.012), M['chrome'], base, verts=48)
box('PitchTrack', (0.07, 1.25, 0.02), (1.98, -0.45, PT + 0.02), M['rubber'], base, bevel=0.005, segs=2)
box('Pitch', (0.24, 0.13, 0.08), (1.98, -0.6, PT + 0.055), M['amber'], base, bevel=0.02)
cyl('ArmRest', 0.05, 0.14, (1.6, -1.12, PT + 0.07), M['dark'], base, bevel=0.01, verts=32)
box('CueLever', (0.06, 0.22, 0.03), (1.45, 0.72, PT + 0.08), M['chrome'], base, bevel=0.008)
cyl('AntiSkate', 0.09, 0.05, (2.05, 0.6, PT + 0.03), M['dark'], base, bevel=0.01, verts=48)
cyl('Adapter45', 0.18, 0.09, (-1.9, 1.2, PT + 0.05), M['alu'], base, bevel=0.015, verts=64)
for x in (-1.6, 1.6):
    box('Hinge', (0.5, 0.18, 0.16), (x, 1.68, PT + 0.08), M['dark'], base, bevel=0.02)

cyl('Platter', 1.5, 0.12, (0, 0, PT + 0.07), M['alu'], platter_l, bevel=0.012)
cyl('SlipMat', 1.44, 0.012, (0, 0, PT + 0.136), M['felt'], platter_l, verts=160)
cyl('Spindle', 0.03, 0.1, (0, 0, DT + 0.03), M['chrome'], platter_l, bevel=0.006, verts=32)
# Strobe dots around the platter rim: one mesh of 144 small studs.
import bmesh

bm = bmesh.new()
for i in range(144):
    a = i * 2 * math.pi / 144
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.016, radius2=0.016, depth=0.01)
    bmesh.ops.rotate(bm, verts=geom['verts'], cent=(0, 0, 0), matrix=Euler((0, math.pi / 2, a)).to_matrix())
    bmesh.ops.translate(bm, verts=geom['verts'], vec=(1.5 * math.cos(a), 1.5 * math.sin(a), PT + 0.045))
strobe_mesh = bpy.data.meshes.new('Strobe')
bm.to_mesh(strobe_mesh)
bm.free()
strobe = link(bpy.data.objects.new('Strobe', strobe_mesh))
strobe.data.materials.append(M['dark'])
strobe.parent = platter_l

spin = empty('RecordSpin', parent=record_l)
cyl('Record', 1.42, 0.02, (0, 0, DT - 0.01), vinyl, spin, bevel=0.004, verts=256)
cyl('Label', 0.47, 0.004, (0, 0, DT + 0.002), label, spin, verts=128)
for obj in (spin, platter_l):
    drv = obj.driver_add('rotation_euler', 2).driver
    drv.type = 'SCRIPTED'
    drv.expression = '-frame * 0.11'

cyl('ArmBase', 0.28, 0.1, (0, 0, 0.05), M['dark'], arm_l, bevel=0.02, verts=64)
cyl('Gimbal', 0.14, 0.18, (0, 0, 0.18), M['chrome'], arm_l, bevel=0.015, verts=48, r2=0.12)
swing = empty('Swing', (0, 0, 0.25), parent=arm_l)
cyl('Tube', 0.032, 2.1, (0, -1.0, 0), M['chrome'], swing, verts=32, rot=(math.pi / 2, 0, 0))
cyl('Counterweight', 0.13, 0.3, (0, 0.32, 0), M['dark'], swing, bevel=0.02, verts=48, rot=(math.pi / 2, 0, 0))
cyl('CwRing', 0.135, 0.02, (0, 0.2, 0), M['chrome'], swing, verts=48, rot=(math.pi / 2, 0, 0))
shell = box('Headshell', (0.17, 0.34, 0.035), (-0.02, -2.17, -0.01), M['amber'], swing, bevel=0.01)
shell.rotation_euler = (0, 0, -0.28)
box('Cartridge', (0.1, 0.13, 0.07), (-0.04, -2.2, -0.06), M['dark'], swing, bevel=0.01)
for dy in (-0.06, 0.06):
    cyl('Screw', 0.012, 0.01, (-0.04, -2.2 + dy, -0.01), M['chrome'], swing, verts=12)
box('FingerLift', (0.02, 0.16, 0.02), (0.08, -2.3, 0.0), M['chrome'], swing, bevel=0.005)
cyl('Needle', 0.012, 0.04, (-0.04, -2.22, -0.11), M['chrome'], swing, verts=12, rot=(math.pi, 0, 0), r2=0.0)

# Table: a real dark wood surface.
table = plane('Table', (80, 80), (0, 0, 0), M['table'], None)

# ---------- Record crate ----------
CRATE_AT = V((-6.2, 1.3, 0))
CRATE_YAW = math.radians(14)
crate = empty('Crate', CRATE_AT, rot=(0, 0, CRATE_YAW))
IW, ID, IH, T = 3.3, 4.4, 2.2, 0.12  # inner width, depth, height, wall thickness
box('CrateFloor', (IW + 2 * T, ID + 2 * T, T), (0, 0, T / 2), M['plywood'], crate, bevel=0.01)
box('CrateLeft', (T, ID + 2 * T, IH), (-(IW + T) / 2, 0, IH / 2), M['plywood'], crate, bevel=0.01)
box('CrateRight', (T, ID + 2 * T, IH), ((IW + T) / 2, 0, IH / 2), M['plywood'], crate, bevel=0.01)
box('CrateBack', (IW, T, IH), (0, (ID + T) / 2, IH / 2), M['plywood'], crate, bevel=0.01)
box('CrateFront', (IW, T, 1.55), (0, -(ID + T) / 2, 1.55 / 2), M['plywood'], crate, bevel=0.01)
for sx in (-1, 1):
    for sy in (-1, 1):
        h = IH if sy > 0 else 1.55
        x = sx * (IW / 2 + T)
        y = sy * (ID / 2 + T)
        box('Bracket', (0.3, 0.025, 0.5), (x - sx * 0.14, y + sy * 0.013, h - 0.26), M['steel'], crate, bevel=0.004)
        box('Bracket', (0.025, 0.3, 0.5), (x + sx * 0.013, y - sy * 0.14, h - 0.26), M['steel'], crate, bevel=0.004)
        box('Bracket', (0.3, 0.025, 0.4), (x - sx * 0.14, y + sy * 0.013, 0.2), M['steel'], crate, bevel=0.004)
        box('Bracket', (0.025, 0.3, 0.4), (x + sx * 0.013, y - sy * 0.14, 0.2), M['steel'], crate, bevel=0.004)
# Stencil on the front wall.
font = bpy.data.fonts.load('/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf')
tcurve = bpy.data.curves.new('Stencil', 'FONT')
tcurve.body = 'A.M. RECORDS'
tcurve.font = font
tcurve.size = 0.28
tcurve.extrude = 0.004
tcurve.align_x = 'CENTER'
stencil = link(bpy.data.objects.new('Stencil', tcurve))
stencil.data.materials.append(M['navysleeve'])
stencil.parent = crate
stencil.location = (0, -(ID / 2 + T) - 0.002, 0.55)
stencil.rotation_euler = (math.pi / 2, 0, 0)

SL = 2.94  # 12" sleeve
rng = random.Random(4)
SLOT0_Y = -ID / 2 + 0.3
SLOT_D = 0.155
sleeve_mats = [M['paper']] * 6 + [M['cream']] * 3 + [M['navysleeve'], M['blacksleeve'], M['kraft'], M['paper'], M['cream']]
for i in range(1, 26):
    lean = math.radians(-10 - rng.uniform(-2.5, 2.5))
    m = rng.choice(sleeve_mats)
    s = box(f'Sleeve{i}', (SL, 0.034, SL), (rng.uniform(-0.03, 0.03), SLOT0_Y + i * SLOT_D, SL / 2 + 0.07), m, crate, bevel=0.006, segs=2)
    s.rotation_euler = (lean, 0, rng.uniform(-0.01, 0.01))

# The sleeve that gets lifted: a hand empty carries sleeve body, white front face and the record.
hand = empty('Hand', parent=crate)
body = box('LiftSleeve', (SL, 0.034, SL), (0, 0, SL / 2), sleeveback, hand, bevel=0.006, segs=2)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.cube_project(cube_size=SL, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')
uv = body.data.uv_layers.active.data
for poly in body.data.polygons:
    if poly.normal.y > 0.5:  # the side seen at rest: un-mirror the print
        for li in poly.loop_indices:
            uv[li].uv.x = 1 - uv[li].uv.x
face = plane('SleeveFace', (SL - 0.01, SL - 0.01), (0, -0.0175, SL / 2), M['white'], hand, rot=(math.pi / 2, 0, 0))
disc = empty('DiscSlide', (0, 0, SL / 2), parent=hand)
cyl('LiftRecord', 1.42, 0.02, (0, 0, 0), vinyl, disc, bevel=0.004, verts=256, rot=(math.pi / 2, 0, 0))
cyl('LiftLabel', 0.47, 0.004, (0, -0.012, 0), label, disc, verts=128, rot=(math.pi / 2, 0, 0))
cyl('LiftLabelB', 0.47, 0.004, (0, 0.012, 0), label, disc, verts=128, rot=(-math.pi / 2, 0, 0))

REST = dict(loc=V((0, SLOT0_Y, 0.07)), rot=Euler((math.radians(-10), 0, math.pi)))
# Hero pose: out of the crate, turned round so the white face (-Y side) looks at the camera.
HERO = dict(loc=V((1.3, -3.6, 0.85)), rot=Euler((math.radians(-7), 0, 0.22)))


def key(obj, path, frame, value):
    setattr(obj, path, value)
    obj.keyframe_insert(path, frame=frame)


def pose(frame, loc, rot):
    key(hand, 'location', frame, loc)
    key(hand, 'rotation_euler', frame, rot)


L0 = LOOP_START
pose(1, REST['loc'], REST['rot'])
pose(FRAMES, REST['loc'], REST['rot'])
pose(L0, REST['loc'], REST['rot'])
pose(L0 + 9, V((0.3, SLOT0_Y - 0.6, 2.7)), Euler((math.radians(-4), 0, 2.4)))
pose(L0 + 18, HERO['loc'], HERO['rot'])
pose(L0 + 30, HERO['loc'] + V((0.05, -0.1, 0.05)), Euler((math.radians(-5), 0, 0.34)))
pose(L0 + 39, V((0.3, SLOT0_Y - 0.6, 2.7)), Euler((math.radians(-4), 0, 2.4)))
pose(L0 + LOOP_LEN - 1, REST['loc'], REST['rot'])
for f in (1, FRAMES, L0, L0 + 16, L0 + 36, L0 + LOOP_LEN - 1):
    key(disc, 'location', f, V((0, 0, SL / 2)))
key(disc, 'location', L0 + 26, V((0, 0, SL / 2 + 0.98)))
key(disc, 'location', L0 + 31, V((0, 0, SL / 2 + 0.92)))


# ---------- Lights (on top of the HDRI) ----------
def area(name, loc, rot, size, power, color, size_y=None):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy = power
    l.color = color
    l.shape = 'RECTANGLE' if size_y else 'SQUARE'
    l.size = size
    if size_y:
        l.size_y = size_y
    o = link(bpy.data.objects.new(name, l))
    o.location = loc
    o.rotation_euler = rot
    return o


area('Key', (-3.5, -4.5, 7.5), (math.radians(35), 0, math.radians(-35)), 5, 650, (1, 0.95, 0.88))
area('Strip', (0.5, 2.5, 6.5), (math.radians(-20), 0, 0), 7, 400, (0.9, 0.95, 1), size_y=0.6)
area('Rim', (5.5, 6.0, 3.0), (math.radians(-70), 0, math.radians(140)), 4, 1500, (0.32, 0.5, 1))
area('Warm', (-3.4, -2.6, 2.2), (math.radians(62), 0, math.radians(-52)), 0.8, 90, (1, 0.7, 0.3))
area('CrateKey', (-8.5, -5.0, 6.5), (math.radians(40), 0, math.radians(-25)), 3, 380, (1, 0.93, 0.85))

# ---------- Camera ----------
cam_data = bpy.data.cameras.new('Cam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_height = 24
cam_data.lens = 41.8 if WIDE else 33
cam_data.clip_start, cam_data.clip_end = 0.05, 200
cam_data.dof.use_dof = True
cam = link(bpy.data.objects.new('Camera', cam_data))
scene.camera = cam
target = empty('Target')
track = cam.constraints.new('TRACK_TO')
track.target = target
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'
cam_data.dof.focus_object = target

crate_world = lambda v: CRATE_AT + Euler((0, 0, CRATE_YAW)).to_matrix() @ v
CRATE_TGT = crate_world(V((0.7, -1.6, 1.9)))
CRATE_POS = crate_world(V((1.4, -12.0, 5.4)))

# Beats: camera position, look-at, sideways shift (object right (+) or left (−) of the text on wide
# screens), layers apart (0–1), needle on the record (0–1), aperture.
KEYS = [
    (BEATS[0], dict(pos=V((1.7, -8.4, 4.0)), tgt=V((0, 0, 0.3)), shift=1.55, explode=0, arm=0, f=5.6)),
    (BEATS[1], dict(pos=V((2.55, -2.85, 1.5)), tgt=V((0.95, -0.95, 0.68)), shift=0.55, explode=0, arm=1, f=2.0)),
    (BEATS[2], dict(pos=V((7.6, -8.6, 4.4)), tgt=V((0, 0, 1.6)), shift=1.1, explode=1, arm=0, f=6.0)),
    (BEATS[3], dict(pos=V((-6.2, -5.2, 3.2)), tgt=V((0.4, 0, 0.9)), shift=-1.9, explode=0.3, arm=0.4, f=4.0)),
    (BEATS[4], dict(pos=CRATE_POS, tgt=CRATE_TGT, shift=2.6, explode=0, arm=0, f=4.5)),
    (BEATS[5], dict(pos=V((0.02, -1.1, 8.6)), tgt=V((0, 0, 0)), shift=1.7, explode=0, arm=1, f=8.0)),
    (L0, dict(pos=CRATE_POS, tgt=CRATE_TGT, shift=2.6, explode=0, arm=0, f=4.5)),
    (L0 + LOOP_LEN - 1, dict(pos=CRATE_POS, tgt=CRATE_TGT, shift=2.6, explode=0, arm=0, f=4.5)),
]


def shot(k):
    pos, tgt = k['pos'].copy(), k['tgt'].copy()
    fwd = (tgt - pos).normalized()
    right = fwd.cross(V((0, 0, 1))).normalized()
    if WIDE:
        pos -= right * k['shift']
        tgt -= right * k['shift']
    else:
        # Portrait: step back, and push the object into the top half (the text sits below).
        pos = tgt + (pos - tgt) * 1.35
        up = right.cross(fwd).normalized()
        lift = (pos - tgt).length * 0.1
        pos -= up * lift
        tgt -= up * lift
    return pos, tgt


def key_idx(obj, path, frame, value, index):
    getattr(obj, path).__setitem__(index, value)
    obj.keyframe_insert(path, frame=frame, index=index)


for frame, k in KEYS:
    pos, tgt = shot(k)
    key(cam, 'location', frame, pos)
    key(target, 'location', frame, tgt)
    cam_data.dof.aperture_fstop = k['f']
    cam_data.dof.keyframe_insert('aperture_fstop', frame=frame)
    e = k['explode']
    key(platter_l, 'location', frame, V((0, 0, e * 0.95)))
    key(record_l, 'location', frame, V((0, 0, e * 1.95)))
    key(arm_l, 'location', frame, ARM_AT + V((e * 0.5, 0, e * 2.75)))
    key_idx(arm_l, 'rotation_euler', frame, -e * 0.06, 1)
    a = k['arm'] * (1 - min(1, e * 1.4))
    key_idx(swing, 'rotation_euler', frame, -0.46 * a, 2)
    key(swing, 'location', frame, V((0, 0, 0.25 + (1 - a) * 0.07)))
# The needle drops just before the close-up and lifts before the teardown.
for f in (16, 44):
    key_idx(swing, 'rotation_euler', f, 0, 2)
    key(swing, 'location', f, V((0, 0, 0.32)))


def fcurves(idb):
    """F-curves of a datablock's action (Blender 4 flat actions and Blender 5 layered ones)."""
    ad = idb.animation_data
    if not ad or not ad.action:
        return []
    act = ad.action
    if getattr(act, 'layers', None):
        return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    return list(act.fcurves)


for idb in [*bpy.data.objects, cam_data]:
    for fc in fcurves(idb):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        fc.update()

# ---------- Anchors: screen positions per frame ----------
anchors = {
    'base': empty('A_base', (-2.3, -1.2, 0.33), base),
    'platter': empty('A_platter', (-1.5, -0.25, PT + 0.07), platter_l),
    'disc': empty('A_disc', (-1.42, -0.2, DT), record_l),
    'arm': empty('A_arm', (-0.95, -2.0, 0.25), arm_l),
    'record': empty('A_record', (0, 0, DT), record_l),
    'rim': empty('A_rim', (1.42, 0, DT), record_l),
    'sleeve': empty('A_sleeve', (0, -0.6, SL / 2), hand),
}
HALF = SL / 2 - 0.005
FACE_CORNERS = [V((-HALF, HALF, 0)), V((HALF, HALF, 0)), V((HALF, -HALF, 0)), V((-HALF, -HALF, 0))]  # top-left, top-right, bottom-right, bottom-left in face space


def screen(v):
    p = world_to_camera_view(scene, cam, v)
    return [round(p.x, 4), round(1 - p.y, 4)]


def sample(frames):
    pts = {n: [] for n in anchors}
    faces = []
    for f in frames:
        scene.frame_set(f)
        for n, a in anchors.items():
            pts[n].append(screen(a.matrix_world.translation))
        mw = face.matrix_world
        normal = (mw.to_3x3() @ V((0, 0, 1))).normalized()
        centre = mw.translation
        facing = normal.dot((cam.matrix_world.translation - centre).normalized())
        faces.append({'c': [screen(mw @ c) for c in FACE_CORNERS], 'v': round(facing, 3)})
    return pts, faces


os.makedirs(args.out, exist_ok=True)
main_pts, main_faces = sample(range(1, FRAMES + 1))
loop_pts, loop_faces = sample(range(L0, L0 + LOOP_LEN))
with open(os.path.join(args.out, 'anchors.json'), 'w') as fh:
    json.dump(
        {
            'frames': FRAMES,
            'beats': BEATS,
            'loop': LOOP_LEN,
            'width': scene.render.resolution_x,
            'height': scene.render.resolution_y,
            'points': main_pts,
            'faces': main_faces,
            'loopPoints': loop_pts,
            'loopFaces': loop_faces,
        },
        fh,
    )
if args.anchors_only:
    sys.exit(0)

# ---------- Render ----------
if args.still:
    scene.frame_set(args.still)
    scene.render.filepath = os.path.join(args.out, f'still-{args.still:04d}.png')
    bpy.ops.render.render(write_still=True)
else:
    if args.frames:
        a, b = (int(x) for x in args.frames.split('-'))
    elif args.loop:
        a, b = L0, L0 + LOOP_LEN - 1
    else:
        a, b = 1, FRAMES
    scene.frame_start, scene.frame_end = a, b
    scene.render.filepath = os.path.join(args.out, 'l_' if args.loop else 'f_')
    scene.render.use_overwrite = False  # resume where a stopped run left off
    bpy.ops.render.render(animation=True)
