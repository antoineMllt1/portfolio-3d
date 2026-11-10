# The film: a turntable and a crate of records on a sideboard, in a real room (Blender 5.x / Cycles,
# run with the bpy module). Real-world scale, scanned props and textures from Poly Haven (CC0).
#
#   python3 render/fetch_assets.py && node scripts/covers/covers.cjs     # inputs
#   python render/scene.py -- --seq f --out render/out/wide              # travel between the floors
#   python render/scene.py -- --seq c --out render/out/wide              # riffling through the crate
#   python render/scene.py -- --holds --scale 160 --samples 128 --out render/out/wide   # HD rest frames
#   python render/scene.py -- --still 31 --scale 50 --out /tmp/test      # one test frame
#
# Sequence f, 121 frames: beats 1 intro · 31 stylus · 61 controls · 91 crate · 121 the whole room.
# Sequence c, 116 frames (301–416): starts on the crate beat; record k is pulled up at frame
# 306 + 10k, then flipped forward while the next one comes up, like someone going through a crate.
import argparse
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import parts as P  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--variant', default='wide', choices=['wide', 'tall'])
ap.add_argument('--seq', default='', choices=['', 'f', 'c'])
ap.add_argument('--frames', default='')
ap.add_argument('--holds', action='store_true')
ap.add_argument('--still', type=int, default=0)
ap.add_argument('--samples', type=int, default=24)
ap.add_argument('--scale', type=int, default=100)
ap.add_argument('--out', default='render/out/wide')
ap.add_argument('--anchors-only', action='store_true')
args = ap.parse_args(argv)
WIDE = args.variant == 'wide'
V = Vector
BEATS = [1, 31, 61, 91, 121]
C0 = 301
with open(os.path.join(P.COVERS, 'order.json')) as fh:
    ORDER = json.load(fh)
NP = len(ORDER)
C_LEN = 6 + 10 * (NP - 1)
hold_of = lambda k: C0 + 5 + 10 * k

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, C0 + C_LEN
scene.render.fps = 30
scene.unit_settings.system = 'METRIC'

# ---------------------------------------------------------------- render settings
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.03
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.max_bounces = 8
scene.cycles.glossy_bounces = 4
scene.cycles.diffuse_bounces = 3
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.blur_glossy = 0.3
scene.cycles.sample_clamp_indirect = 6
scene.render.resolution_x, scene.render.resolution_y = (1600, 900) if WIDE else (1080, 1920)
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
scene.view_settings.exposure = 0.0

# ---------------------------------------------------------------- world
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
env = wn.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(P.ASSETS, 'lythwood_room.hdr'))
mp = wn.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, 0, math.radians(110))
tc = wn.new('ShaderNodeTexCoord')
wl.new(tc.outputs['Generated'], mp.inputs['Vector'])
wl.new(mp.outputs['Vector'], env.inputs['Vector'])
wl.new(env.outputs['Color'], wn['Background'].inputs['Color'])
wn['Background'].inputs['Strength'].default_value = 0.1

# ---------------------------------------------------------------- scene
M = P.materials()
TOP = P.build_room(M)
T = V((0.0, -0.02, TOP))  # turntable
C = V((0.72, -0.02, TOP))  # crate
tt_root = P.empty('TT', T)
tt = P.build_turntable(M, tt_root)
cr_root = P.empty('CR', C)
crate = P.build_crate(M, cr_root, ORDER)

plant = P.append_collection('potted_plant_02')
P.place(plant, (1.12, -0.05, TOP), rot=(0, 0, math.radians(40)), scale=0.4)
lamp = P.append_collection('desk_lamp_arm_01')
P.place(lamp, (1.07, 0.2, TOP), rot=(0, 0, math.radians(-8)))


def light(name, kind, loc, aim, power, color, **kw):
    l = bpy.data.lights.new(name, kind)
    l.energy = power
    l.color = color
    for k, v in kw.items():
        setattr(l, k, v)
    o = P.link(bpy.data.objects.new(name, l))
    o.location = loc
    d = V(aim) - V(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o


# A window out of frame to the left (cool daylight, soft), the desk lamp (warm), a faint fill.
light('Window', 'AREA', (-2.9, -0.55, 1.9), (0.1, -0.05, 0.8), 520, (0.8, 0.89, 1.0), shape='RECTANGLE', size=1.1, size_y=1.5)
light('Lamp', 'SPOT', (0.94, 0.18, TOP + 0.66), (0.68, -0.12, TOP + 0.2), 40, (1.0, 0.64, 0.34), spot_size=math.radians(125), spot_blend=0.6, shadow_soft_size=0.035)
light('Fill', 'AREA', (0.6, -2.6, 1.6), (0.2, 0, 0.8), 14, (1.0, 0.85, 0.7), size=2.0)

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new('Cam')
cam_data.sensor_width = 36
cam_data.sensor_height = 24
cam_data.sensor_fit = 'HORIZONTAL' if WIDE else 'VERTICAL'
cam_data.clip_start, cam_data.clip_end = 0.02, 50
cam_data.dof.use_dof = True
cam_data.dof.aperture_blades = 7
cam = P.link(bpy.data.objects.new('Camera', cam_data))
scene.camera = cam
target = P.empty('Target')
focus = P.empty('Focus')
track = cam.constraints.new('TRACK_TO')
track.target = target
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'
cam_data.dof.focus_object = focus

# The stylus on the record: needed for the close-up and the arm animation.
ARM_PLAY = P.arm_angle_for(tt, 0.141)
tt['swing'].rotation_euler = (0, 0, ARM_PLAY)
bpy.context.view_layer.update()
STYLUS = tt['tip'].matrix_world.translation.copy()
tt['swing'].rotation_euler = (0, 0, 0)

DECK = V((T.x, T.y, TOP + P.PLATE_Z))
# Beats: camera position, look-at, lens (mm), f-stop, focus point.
if WIDE:
    SHOTS = [
        dict(pos=V((-0.60, -1.46, 1.27)), tgt=V((-0.235, -0.02, 0.80)), lens=50, f=4.0, focus=V((0.0, -0.1, 0.8))),
        dict(pos=STYLUS + V((-0.17, -0.21, 0.085)), tgt=STYLUS + V((-0.028, 0.012, -0.004)), lens=85, f=4.0, focus=STYLUS),
        dict(pos=V((-0.56, -0.46, 0.905)), tgt=V((-0.245, -0.125, 0.782)), lens=70, f=4.5, focus=V((-0.178, -0.16, 0.775))),
        dict(pos=V((0.48, -1.58, 1.40)), tgt=V((0.51, -0.02, 0.955)), lens=50, f=5.0, focus=C + V((0, -0.06, 0.4))),
        dict(pos=V((-0.02, -2.4, 1.14)), tgt=V((0.1, 0.0, 0.95)), lens=40, f=4.0, focus=T + V((0, 0, 0.1))),
    ]
else:
    SHOTS = [
        dict(pos=V((-0.35, -1.75, 1.55)), tgt=V((0.0, -0.02, 0.56)), lens=55, f=4.0, focus=V((0.0, -0.1, 0.8))),
        dict(pos=STYLUS + V((-0.16, -0.30, 0.13)), tgt=STYLUS + V((0.0, 0.01, -0.07)), lens=85, f=3.2, focus=STYLUS),
        dict(pos=V((-0.50, -0.62, 0.90)), tgt=V((-0.13, -0.13, 0.68)), lens=70, f=2.8, focus=V((-0.17, -0.165, 0.775))),
        dict(pos=V((0.58, -1.25, 1.42)), tgt=V((0.58, -0.02, 0.62)), lens=55, f=4.5, focus=C + V((0, -0.06, 0.26))),
        dict(pos=V((0.2, -2.9, 1.35)), tgt=V((0.2, 0.0, 0.45)), lens=45, f=4.0, focus=T + V((0, 0, 0.1))),
    ]


def key(obj, path, frame, value, index=-1):
    if index < 0:
        setattr(obj, path, value)
    else:
        getattr(obj, path)[index] = value
    obj.keyframe_insert(path, frame=frame, index=index)


for frame, s in list(zip(BEATS, SHOTS)) + [(C0, SHOTS[3]), (C0 + C_LEN - 1, SHOTS[3])]:
    key(cam, 'location', frame, s['pos'])
    key(target, 'location', frame, s['tgt'])
    key(focus, 'location', frame, s['focus'])
    key(cam_data, 'lens', frame, s['lens'])
    key(cam_data.dof, 'aperture_fstop', frame, s['f'])

# Tonearm: at rest on the intro, cued over the record and lowered on the way to the close-up.
sw = tt['swing']
CUE = math.radians(2.6)
for frame, ang, cue in ((1, 0.0, CUE), (6, 0.0, CUE), (19, ARM_PLAY, CUE), (27, ARM_PLAY, 0.0)):
    key(sw, 'rotation_euler', frame, ang, 2)
    key(sw, 'rotation_euler', frame, cue, 0)

# Crate: record k comes up at hold_of(k); on the way to the next one it drops and flips forward.
LIFT = 0.262
theta_f = crate['theta_f']
for k in range(NP):
    s = crate['sleeves'][k]
    piv, F = s['pivot'], hold_of(k)
    x = piv.location.x

    def pose(frame, y, z, lean):
        key(piv, 'location', frame, V((x, y, z)))
        key(piv, 'rotation_euler', frame, lean, 0)

    pose(F - 5, s['y0'], crate['floor'], s['lean'])
    pose(F, s['y0'] - 0.014, crate['floor'] + LIFT, math.radians(-4))
    if k < NP - 1:
        pose(F + 4, s['y0'] - 0.02, crate['floor'] + 0.015, math.radians(-1.5))
        pose(F + 9, crate['y_front'] + 0.05 + (k + 1) * crate['pitch'] / math.cos(theta_f), crate['floor'], theta_f)


def fcurves(idb):
    ad = idb.animation_data
    if not ad or not ad.action:
        return []
    act = ad.action
    if getattr(act, 'layers', None):
        return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    return list(act.fcurves)


for idb in [*bpy.data.objects, *bpy.data.cameras]:
    for fc in fcurves(idb):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        fc.update()

# ---------------------------------------------------------------- anchors
H = P.SLEEVE


def screen(v):
    p = world_to_camera_view(scene, cam, v)
    return [round(p.x, 4), round(1 - p.y, 4)]


def cover_quad(k):
    """Screen corners (TL, TR, BR, BL) of record k's front cover at its hold frame."""
    scene.frame_set(hold_of(k))
    mw = crate['sleeves'][k]['pivot'].matrix_world
    y = -P.SLEEVE_T / 2
    return [screen(mw @ V(c)) for c in ((-H / 2, y, H), (H / 2, y, H), (H / 2, y, 0), (-H / 2, y, 0))]


os.makedirs(args.out, exist_ok=True)
with open(os.path.join(args.out, 'anchors.json'), 'w') as fh:
    json.dump(
        {
            'width': scene.render.resolution_x,
            'height': scene.render.resolution_y,
            'frames': BEATS[-1],
            'beats': BEATS,
            'crate': {'frames': C_LEN, 'first': 5, 'step': 10, 'order': ORDER, 'quads': [cover_quad(k) for k in range(NP)]},
        },
        fh,
    )
if args.anchors_only:
    sys.exit(0)

# ---------------------------------------------------------------- render
def render_frame(frame, path):
    if os.path.exists(path):
        return
    scene.frame_set(frame)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if args.still:
    render_frame(args.still, os.path.join(args.out, f'still-{args.still:04d}.png'))
elif args.holds:
    # The frames the page rests on, rendered bigger and cleaner (no motion blur).
    for i, f in enumerate(BEATS):
        render_frame(f, os.path.join(args.out, f'h_f_{f:04d}.png'))
    for k in range(NP):
        render_frame(hold_of(k), os.path.join(args.out, f'h_c_{hold_of(k) - C0 + 1:04d}.png'))
elif args.seq:
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    first, last = (1, BEATS[-1]) if args.seq == 'f' else (C0, C0 + C_LEN - 1)
    if args.frames:
        a, b = (int(x) for x in args.frames.split('-'))
        first, last = first + a - 1, first + b - 1
    base = 1 if args.seq == 'f' else C0
    for f in range(first, last + 1):
        render_frame(f, os.path.join(args.out, f'{args.seq}_{f - base + 1:04d}.png'))
