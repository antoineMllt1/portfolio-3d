# Photoreal turntable for the scroll video (Blender 4.x, Cycles).
#
# Run with the official bpy module (pip install bpy==5.2.3, it ships OpenImageDenoise) or Blender:
#   python render/scene.py -- --variant wide --samples 64 --out render/out/wide
#   blender -b -P render/scene.py -- --variant wide --samples 64 --out render/out/wide
#   blender -b -P render/scene.py -- --variant tall --frames 1-120 --out render/out/tall
#   blender -b -P render/scene.py -- --variant wide --still 40 --out /tmp/test   (one frame)
#
# Beats (frames): 1 intro · 30 needle · 60 teardown · 90 numbers · 120 top-down (contact).
# Writes PNG frames plus anchors.json: where the labels and the record sit on screen for each frame.
import argparse
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--variant', default='wide', choices=['wide', 'tall'])
ap.add_argument('--samples', type=int, default=64)
ap.add_argument('--frames', default='1-120')
ap.add_argument('--still', type=int, default=0)
ap.add_argument('--scale', type=int, default=100)
ap.add_argument('--out', default='render/out/wide')
ap.add_argument('--anchors-only', action='store_true')
args = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'tex')
WIDE = args.variant == 'wide'
FRAMES = 120
BEATS = [1, 30, 60, 90, 120]  # intro · needle · teardown · numbers · top-down

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, FRAMES
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
scene.cycles.max_bounces = 6
scene.cycles.glossy_bounces = 3
scene.cycles.transmission_bounces = 2
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
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
scene.view_settings.exposure = 0.2

BG = (0.0018, 0.0036, 0.0095)  # matches the page background (#050A16) after the view transform
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*BG, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0


# ---------- Materials ----------
def mat(name, color, rough=0.4, metal=0.0, coat=0.0, aniso=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.06
    if aniso:
        b.inputs['Anisotropic'].default_value = aniso
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m


def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


M = {
    'lacquer': mat('Lacquer', srgb('#0A1F44'), 0.32, 0.0, coat=1.0),
    'plate': mat('Plate', srgb('#0F1B33'), 0.38, 0.85, aniso=0.5),
    'alu': mat('Aluminium', srgb('#D9DEE6'), 0.2, 1.0, aniso=0.7),
    'chrome': mat('Chrome', srgb('#E6EAF0'), 0.14, 1.0),
    'dark': mat('DarkMetal', srgb('#1A2234'), 0.3, 0.9),
    'rubber': mat('Rubber', srgb('#0A0C12'), 0.85),
    'amber': mat('Amber', srgb('#FFB547'), 0.35, 0.0, coat=0.5),
    'sky': mat('Sky', srgb('#2E66E8'), 0.3, 0.0, coat=0.6, emit=srgb('#2E66E8'), emit_strength=0.6),
    'led': mat('Led', (0.6, 0.75, 1), 0.3, emit=(0.6, 0.75, 1), emit_strength=8),
    'floor': mat('Floor', (0.0004, 0.0006, 0.0012), 0.6),
}
M['floor'].node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.18


def image_node(m, path, non_color=False):
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tc = nodes.new('ShaderNodeTexCoord')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path)
    if non_color:
        tex.image.colorspace_settings.name = 'Non-Color'
    links.new(tc.outputs['Generated'], tex.inputs['Vector'])
    return tex


# Vinyl: black, grooves as bump, glossier ridges.
vinyl = bpy.data.materials.new('Vinyl')
vinyl.use_nodes = True
vb = vinyl.node_tree.nodes['Principled BSDF']
vb.inputs['Base Color'].default_value = (0.006, 0.007, 0.01, 1)
vb.inputs['Coat Weight'].default_value = 0.35
vb.inputs['Coat Roughness'].default_value = 0.2
g = image_node(vinyl, os.path.join(TEX, 'grooves.png'), True)
rough = image_node(vinyl, os.path.join(TEX, 'rough.png'), True)
bump = vinyl.node_tree.nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.25
bump.inputs['Distance'].default_value = 0.002
vinyl.node_tree.links.new(g.outputs['Color'], bump.inputs['Height'])
vinyl.node_tree.links.new(bump.outputs['Normal'], vb.inputs['Normal'])
vinyl.node_tree.links.new(rough.outputs['Color'], vb.inputs['Roughness'])

label = bpy.data.materials.new('Label')
label.use_nodes = True
lb = label.node_tree.nodes['Principled BSDF']
lb.inputs['Roughness'].default_value = 0.5
lt = image_node(label, os.path.join(TEX, 'label.png'))
label.node_tree.links.new(lt.outputs['Color'], lb.inputs['Base Color'])


# ---------- Geometry helpers ----------
def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
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
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35)) if hasattr(bpy.ops.object, 'shade_smooth_by_angle') else bpy.ops.object.shade_smooth()
        if hasattr(o.data, 'use_auto_smooth'):
            o.data.use_auto_smooth = True
            o.data.auto_smooth_angle = math.radians(35)
    return o


def box(name, size, loc, material, parent, bevel=0.0, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
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


def world_loc(o, loc):
    """Location given in world space, stored relative to the (unmoved) parent."""
    return Vector(loc) - (o.matrix_world.translation if o else Vector())


# ---------- Turntable (Z up, front = -Y) ----------
PT = 0.54  # plinth top
DT = PT + 0.15  # record top
root = empty('Turntable')
base = empty('L_Base', parent=root)
platter_l = empty('L_Platter', parent=root)
record_l = empty('L_Record', parent=root)
arm_l = empty('L_Arm', (1.85, 1.05, PT), parent=root)

box('Plinth', (4.6, 3.5, 0.42), (0, 0, 0.33), M['lacquer'], base, bevel=0.06, segs=5)
for x, y in [(-1.95, -1.45), (1.95, -1.45), (-1.95, 1.45), (1.95, 1.45)]:
    cyl('Foot', 0.21, 0.12, (x, y, 0.06), M['dark'], base, bevel=0.02, verts=48)
box('TopPlate', (4.36, 3.26, 0.012), (0, 0, PT + 0.006), M['plate'], base, bevel=0.004, segs=2)
bpy.ops.mesh.primitive_torus_add(major_radius=1.58, minor_radius=0.022, location=(0, 0, PT + 0.014), major_segments=128, minor_segments=12)
finish(bpy.context.object, M['dark'], base)
box('StartStop', (0.52, 0.3, 0.06), (-1.78, -1.32, PT + 0.04), M['dark'], base, bevel=0.015)
box('Led', (0.08, 0.06, 0.02), (-1.6, -1.32, PT + 0.075), M['led'], base, bevel=0.005, segs=2)
cyl('Knob', 0.11, 0.1, (-1.2, -1.34, PT + 0.06), M['sky'], base, bevel=0.015, verts=48, r2=0.1)
cyl('Knob2', 0.11, 0.1, (-0.85, -1.34, PT + 0.06), M['dark'], base, bevel=0.015, verts=48, r2=0.1)
box('PitchTrack', (0.07, 1.25, 0.02), (1.98, -0.45, PT + 0.02), M['rubber'], base, bevel=0.005, segs=2)
box('Pitch', (0.24, 0.13, 0.08), (1.98, -0.6, PT + 0.055), M['amber'], base, bevel=0.02)
cyl('ArmRest', 0.05, 0.14, (1.6, -1.12, PT + 0.07), M['dark'], base, bevel=0.01, verts=32)

cyl('Platter', 1.5, 0.12, (0, 0, PT + 0.07), M['alu'], platter_l, bevel=0.012)
cyl('SlipMat', 1.44, 0.012, (0, 0, PT + 0.136), M['rubber'], platter_l, verts=128)
cyl('Spindle', 0.03, 0.1, (0, 0, DT + 0.03), M['chrome'], platter_l, bevel=0.006, verts=32)

spin = empty('RecordSpin', parent=record_l)
cyl('Record', 1.42, 0.02, (0, 0, DT - 0.01), vinyl, spin, bevel=0.004, verts=192)
cyl('Label', 0.47, 0.004, (0, 0, DT + 0.002), label, spin, verts=128)
# Spin with the scroll: two and a bit turns over the whole film.
drv = spin.driver_add('rotation_euler', 2).driver
drv.type = 'SCRIPTED'
drv.expression = '-frame * 0.11'
pdrv = platter_l.driver_add('rotation_euler', 2).driver
pdrv.type = 'SCRIPTED'
pdrv.expression = '-frame * 0.11'

# Tonearm: pivot base, then the swinging part (pointing to the front, -Y).
cyl('ArmBase', 0.28, 0.1, (1.85, 1.05, PT + 0.05), M['dark'], arm_l, bevel=0.02, verts=64)
arm_l.location = (1.85, 1.05, PT)
for o in [o for o in arm_l.children]:
    o.location = Vector(o.location) - Vector((1.85, 1.05, PT))
cyl('Gimbal', 0.14, 0.18, (0, 0, 0.18), M['chrome'], arm_l, bevel=0.015, verts=48, r2=0.12)
swing = empty('Swing', (0, 0, 0.25), parent=arm_l)
cyl('Tube', 0.032, 2.1, (0, -1.0, 0), M['chrome'], swing, verts=32, rot=(math.pi / 2, 0, 0))
cyl('Counterweight', 0.13, 0.3, (0, 0.32, 0), M['dark'], swing, bevel=0.02, verts=48, rot=(math.pi / 2, 0, 0))
shell = box('Headshell', (0.17, 0.34, 0.035), (-0.02, -2.17, -0.01), M['amber'], swing, bevel=0.01)
shell.rotation_euler = (0, 0, -0.28)
box('Cartridge', (0.1, 0.13, 0.07), (-0.04, -2.2, -0.06), M['dark'], swing, bevel=0.01)
cyl('Needle', 0.012, 0.04, (-0.04, -2.22, -0.11), M['chrome'], swing, verts=12, rot=(math.pi, 0, 0), r2=0.0)

# Floor that melts into the background.
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
floor = bpy.context.object
floor.data.materials.append(M['floor'])

# Points the HTML labels follow (one per layer) and the record centre / rim (click target).
anchors = {
    'base': empty('A_base', world_loc(base, (-2.3, -1.2, 0.33)), base),
    'platter': empty('A_platter', world_loc(platter_l, (-1.5, -0.25, PT + 0.07)), platter_l),
    'disc': empty('A_disc', world_loc(record_l, (-1.42, -0.2, DT)), record_l),
    'arm': empty('A_arm', (-0.95, -2.0, 0.25), arm_l),
    'record': empty('A_record', world_loc(record_l, (0, 0, DT)), record_l),
    'rim': empty('A_rim', world_loc(record_l, (1.42, 0, DT)), record_l),
}

# ---------- Lights ----------
def area(name, loc, rot, size, power, color, shape='RECTANGLE', size_y=None):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy = power
    l.color = color
    l.shape = shape
    l.size = size
    if size_y:
        l.size_y = size_y
    o = bpy.data.objects.new(name, l)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    return o


area('Key', (-3.5, -4.5, 7.5), (math.radians(35), 0, math.radians(-35)), 5, 1600, (1, 0.95, 0.88))
area('Strip', (0.5, 2.5, 6.5), (math.radians(-20), 0, 0), 7, 600, (0.9, 0.95, 1), size_y=0.6)
area('Rim', (5.5, 6.0, 3.0), (math.radians(-70), 0, math.radians(140)), 4, 2200, (0.32, 0.5, 1))
area('Warm', (-3.4, -2.6, 2.2), (math.radians(62), 0, math.radians(-52)), 0.8, 120, (1, 0.7, 0.3))


# Softboxes: bright panels seen only in reflections (chrome and lacquer need something to reflect).
def softbox(name, loc, rot, size, strength, color=(1, 1, 1)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], 1)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs['Emission'], nt.nodes['Material Output'].inputs['Surface'])
    o.data.materials.append(m)
    o.visible_camera = False
    o.visible_diffuse = False
    o.visible_shadow = False
    return o


softbox('BoxTop', (0, 0, 9), (0, 0, 0), (9, 5), 2.5)
softbox('BoxLeft', (-8, -1, 4), (0, math.radians(70), 0), (4, 10), 1.2, (1, 0.92, 0.82))
softbox('BoxBack', (0, 9, 3), (math.radians(90), 0, 0), (12, 3), 1.0, (0.45, 0.6, 1))

# ---------- Camera ----------
cam_data = bpy.data.cameras.new('Cam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_height = 24
cam_data.lens = 41.8 if WIDE else 33
cam_data.clip_start, cam_data.clip_end = 0.05, 200
cam_data.dof.use_dof = True
cam = bpy.data.objects.new('Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = empty('Target')
track = cam.constraints.new('TRACK_TO')
track.target = target
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'
cam_data.dof.focus_object = target

# Beats: camera position, look-at, sideways shift (object right of the text on wide screens),
# layers apart (0–1), needle on the record (0–1), aperture.
V = Vector
KEYS = [
    (BEATS[0], dict(pos=V((1.7, -8.4, 4.0)), tgt=V((0, 0, 0.3)), shift=1.55, explode=0, arm=0, f=5.6)),
    (BEATS[1], dict(pos=V((2.55, -2.85, 1.5)), tgt=V((0.95, -0.95, 0.68)), shift=0.55, explode=0, arm=1, f=2.0)),
    (BEATS[2], dict(pos=V((7.6, -8.6, 4.4)), tgt=V((0, 0, 1.6)), shift=1.1, explode=1, arm=0, f=6.0)),
    (BEATS[3], dict(pos=V((-6.2, -5.2, 3.2)), tgt=V((0.4, 0, 0.9)), shift=-1.9, explode=0.3, arm=0.4, f=4.0)),
    (BEATS[4], dict(pos=V((0.02, -1.1, 8.6)), tgt=V((0, 0, 0)), shift=1.7, explode=0, arm=1, f=8.0)),
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


def key(obj, path, frame, value, index=-1):
    setattr(obj, path, value) if index < 0 else getattr(obj, path).__setitem__(index, value)
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
    key(arm_l, 'location', frame, V((1.85 + e * 0.5, 1.05, PT + e * 2.75)))
    key(arm_l, 'rotation_euler', frame, -e * 0.06, 1)
    a = k['arm'] * (1 - min(1, e * 1.4))
    key(swing, 'rotation_euler', frame, -0.46 * a, 2)
    key(swing, 'location', frame, V((0, 0, 0.25 + (1 - a) * 0.07)))
# The needle drops just before the close-up and lifts before the teardown.
key(swing, 'rotation_euler', 16, 0, 2)
key(swing, 'location', 16, V((0, 0, 0.32)))
key(swing, 'rotation_euler', 44, 0, 2)
key(swing, 'location', 44, V((0, 0, 0.32)))

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

# ---------- Anchors (screen positions per frame) ----------
os.makedirs(args.out, exist_ok=True)
data = {'frames': FRAMES, 'beats': BEATS, 'width': scene.render.resolution_x, 'height': scene.render.resolution_y, 'points': {}}
for name in anchors:
    data['points'][name] = []
for f in range(1, FRAMES + 1):
    scene.frame_set(f)
    for name, a in anchors.items():
        p = world_to_camera_view(scene, cam, a.matrix_world.translation)
        data['points'][name].append([round(p.x, 4), round(1 - p.y, 4)])
with open(os.path.join(args.out, 'anchors.json'), 'w') as fh:
    json.dump(data, fh)
if args.anchors_only:
    sys.exit(0)

# ---------- Render ----------
if args.still:
    scene.frame_set(args.still)
    scene.render.filepath = os.path.join(args.out, f'still-{args.still:04d}.png')
    bpy.ops.render.render(write_still=True)
else:
    a, b = (int(x) for x in args.frames.split('-'))
    scene.frame_start, scene.frame_end = a, b
    scene.render.filepath = os.path.join(args.out, 'f_')
    scene.render.use_overwrite = False  # resume where a stopped run left off
    bpy.ops.render.render(animation=True)
