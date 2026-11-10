# Building blocks for the scene (real-world scale, metres): helpers, materials, the turntable, the
# record crate with its sleeves, and the room (wall, floor, sideboard, plant, lamp).
import math
import os
import random

import bmesh
import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
COVERS = os.path.join(HERE, 'covers')
V = Vector
FONT_PATH = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf'


# ---------------------------------------------------------------- helpers
def link(o, coll=None):
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)):
    e = link(bpy.data.objects.new(name, None))
    e.location = loc
    e.rotation_euler = rot
    e.parent = parent
    e.empty_display_size = 0.02
    return e


def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def finish(o, material, parent=None, bevel=0.0, segs=3, smooth=True, angle=35):
    if material:
        o.data.materials.append(material)
    if parent is not None:
        o.parent = parent
    if bevel:
        mod = o.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
    if smooth:
        active(o)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    return o


def box(name, size, loc, material, parent=None, bevel=0.0, segs=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, material, parent, bevel, segs)


def cyl(name, r, depth, loc, material, parent=None, bevel=0.0, verts=96, rot=(0, 0, 0), r2=None, segs=3):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    return finish(o, material, parent, bevel, segs)


def rounded_slab(name, w, d, h, radius, loc, material, parent=None, bevel=0.0, corner_segs=10):
    """A slab with rounded vertical corners (plan view), origin at its centre."""
    bm = bmesh.new()
    pts = []
    for cx, cy, a0 in ((w / 2 - radius, d / 2 - radius, 0), (-w / 2 + radius, d / 2 - radius, 90), (-w / 2 + radius, -d / 2 + radius, 180), (w / 2 - radius, -d / 2 + radius, 270)):
        for i in range(corner_segs + 1):
            a = math.radians(a0 + 90 * i / corner_segs)
            pts.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    bottom = [bm.verts.new((x, y, -h / 2)) for x, y in pts]
    face = bm.faces.new(bottom)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)], vec=(0, 0, h))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = link(bpy.data.objects.new(name, me))
    o.location = loc
    return finish(o, material, parent, bevel, 3)


def uv_box(o, size=1.0):
    """Box-projected UVs at real-world scale (one UV unit = `size` metres)."""
    active(o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=size, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def tube(name, points, radius, material, parent=None, resolution=24, cyclic=False):
    """A round tube through `points` (Bezier, automatic handles)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    sp.use_cyclic_u = cyclic
    o = link(bpy.data.objects.new(name, cu))
    o.data.materials.append(material)
    o.parent = parent
    return o


def text(name, body, size, loc, material, parent=None, rot=(0, 0, 0), align='CENTER', extrude=0.00008):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    o = link(bpy.data.objects.new(name, cu))
    o.data.materials.append(material)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o


# ---------------------------------------------------------------- materials
def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes['Principled BSDF']


def mat(name, color, rough=0.4, metal=0.0, coat=0.0, coat_rough=0.06, aniso=0.0, emit=None, emit_strength=0.0, spec=None, smudge=0.0, bump=0.0, bump_scale=800):
    """Principled material with optional roughness smudges (fingerprints, wiping marks) and micro bump."""
    m, nodes, links, b = new_mat(name)
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
    if smudge:
        add_smudges(m, rough, smudge)
    if bump:
        n = nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = bump_scale
        n.inputs['Detail'].default_value = 3
        bp = nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump
        bp.inputs['Distance'].default_value = 0.0002
        links.new(n.outputs['Fac'], bp.inputs['Height'])
        links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


def add_smudges(m, base, amount, scale=14.0, source=None):
    """Roughness = base (or `source` socket) + large soft smudges + fine streaks."""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    b = nodes['Principled BSDF']
    tc = nodes.new('ShaderNodeTexCoord')
    big = nodes.new('ShaderNodeTexNoise')
    big.inputs['Scale'].default_value = scale
    big.inputs['Detail'].default_value = 6
    big.inputs['Roughness'].default_value = 0.65
    links.new(tc.outputs['Object'], big.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[1].position = 0.75
    links.new(big.outputs['Fac'], ramp.inputs['Fac'])
    fine = nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = scale * 30
    fine.inputs['Detail'].default_value = 2
    links.new(tc.outputs['Object'], fine.inputs['Vector'])
    add = nodes.new('ShaderNodeMath')
    add.operation = 'MULTIPLY_ADD'
    links.new(ramp.outputs['Color'], add.inputs[0])
    add.inputs[1].default_value = amount
    if source is not None:
        links.new(source, add.inputs[2])
    else:
        add.inputs[2].default_value = base
    add2 = nodes.new('ShaderNodeMath')
    add2.operation = 'MULTIPLY_ADD'
    links.new(fine.outputs['Fac'], add2.inputs[0])
    add2.inputs[1].default_value = amount * 0.25
    links.new(add.outputs[0], add2.inputs[2])
    links.new(add2.outputs[0], b.inputs['Roughness'])
    return add2.outputs[0]


def image_tex(m, path, non_color=False, coords='UV', scale=None):
    nodes, links = m.node_tree.nodes, m.node_tree.links
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


def pbr(name, asset, scale=(1, 1, 1), tint=None, rough_mul=1.0, normal=1.0, coat=0.0, coat_rough=0.2, smudge=0.0):
    """Material from a Poly Haven texture set (diffuse, roughness, normal), UV-mapped."""
    m, nodes, links, b = new_mat(name)
    base = os.path.join(ASSETS, 'textures', asset)
    d = image_tex(m, base + '_diff.jpg', scale=scale)
    col = d.outputs['Color']
    if tint is not None:
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[7].default_value = (*tint, 1)
        links.new(col, mix.inputs[6])
        col = mix.outputs[2]
    links.new(col, b.inputs['Base Color'])
    r = image_tex(m, base + '_rough.jpg', True, scale=scale)
    mul = nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.use_clamp = True
    mul.inputs[1].default_value = rough_mul
    links.new(r.outputs['Color'], mul.inputs[0])
    links.new(mul.outputs[0], b.inputs['Roughness'])
    if smudge:
        add_smudges(m, 0, smudge, source=mul.outputs[0])
    n = image_tex(m, base + '_nor.jpg', True, scale=scale)
    nm = nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = normal
    links.new(n.outputs['Color'], nm.inputs['Color'])
    links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = coat_rough
    return m


def radial_tangent(m):
    nodes, links = m.node_tree.nodes, m.node_tree.links
    t = nodes.new('ShaderNodeTangent')
    t.direction_type = 'RADIAL'
    t.axis = 'Z'
    links.new(t.outputs['Tangent'], nodes['Principled BSDF'].inputs['Tangent'])


def radius_node(m):
    """Distance from the object's Z axis (object space), as a socket."""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tc = nodes.new('ShaderNodeTexCoord')
    sep = nodes.new('ShaderNodeSeparateXYZ')
    links.new(tc.outputs['Object'], sep.inputs[0])
    comb = nodes.new('ShaderNodeCombineXYZ')
    links.new(sep.outputs['X'], comb.inputs['X'])
    links.new(sep.outputs['Y'], comb.inputs['Y'])
    ln = nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    links.new(comb.outputs[0], ln.inputs[0])
    return ln.outputs['Value']


def vinyl_material():
    """Black vinyl: radial anisotropy, glossy gaps between tracks, fine groove lines, light smudges."""
    m, nodes, links, b = new_mat('Vinyl')
    b.inputs['Base Color'].default_value = (0.004, 0.004, 0.005, 1)
    b.inputs['Anisotropic'].default_value = 0.8
    b.inputs['Coat Weight'].default_value = 0.25
    b.inputs['Coat Roughness'].default_value = 0.12
    radial_tangent(m)
    r = radius_node(m)
    R = 0.1508
    # Track layout along the radius: 1 = grooved, 0 = smooth (lead-in, gaps, run-out).
    ramp = nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.interpolation = 'CONSTANT'
    stops = [(0.0, 0), (0.0595, 1), (0.0755, 0), (0.0768, 1), (0.0962, 0), (0.0972, 1), (0.1105, 0), (0.1117, 1), (0.1290, 0), (0.1300, 1), (0.1462, 0)]
    cr.elements[0].position = 0
    cr.elements[0].color = (0, 0, 0, 1)
    cr.elements[1].position = stops[1][0] / R
    cr.elements[1].color = (1, 1, 1, 1)
    for pos, v in stops[2:]:
        e = cr.elements.new(pos / R)
        e.color = (v, v, v, 1)
    norm = nodes.new('ShaderNodeMath')
    norm.operation = 'DIVIDE'
    links.new(r, norm.inputs[0])
    norm.inputs[1].default_value = R
    links.new(norm.outputs[0], ramp.inputs['Fac'])
    # Roughness: grooved 0.3, smooth 0.06
    rough = nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = 0.06
    rough.inputs['To Max'].default_value = 0.3
    links.new(ramp.outputs['Color'], rough.inputs['Value'])
    add_smudges(m, 0, 0.1, scale=22, source=rough.outputs[0])
    # Fine grooves: rings every 0.28 mm, only where grooved.
    wave = nodes.new('ShaderNodeMath')
    wave.operation = 'SINE'
    mul = nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 2 * math.pi / 0.00028
    links.new(r, mul.inputs[0])
    links.new(mul.outputs[0], wave.inputs[0])
    mask = nodes.new('ShaderNodeMath')
    mask.operation = 'MULTIPLY'
    links.new(wave.outputs[0], mask.inputs[0])
    links.new(ramp.outputs['Color'], mask.inputs[1])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.00004
    links.new(mask.outputs[0], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def paper_print(name, path, rough=0.5, coat=0.12):
    """Printed card (record sleeve): the artwork, paper grain, slight sheen and wear."""
    m, nodes, links, b = new_mat(name)
    t = image_tex(m, path)
    links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.25
    b.inputs['Specular IOR Level'].default_value = 0.4
    add_smudges(m, rough, 0.14, scale=9)
    n = nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 1400
    bp = nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.05
    bp.inputs['Distance'].default_value = 0.0002
    links.new(n.outputs['Fac'], bp.inputs['Height'])
    links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


def materials():
    M = {
        'walnut': pbr('Walnut', 'walnut_veneer', scale=(1.6, 1.6, 1.6), tint=(0.5, 0.36, 0.26), rough_mul=0.75, coat=0.3, coat_rough=0.25, smudge=0.06),
        'oak': pbr('Oak', 'oak_veneer_01', scale=(2.2, 2.2, 2.2), rough_mul=1.0, normal=0.8),
        'ply': pbr('Plywood', 'plywood', scale=(2.5, 2.5, 2.5), rough_mul=1.0, normal=0.7),
        'wall': pbr('Wall', 'painted_plaster_wall', scale=(0.5, 0.5, 0.5), tint=srgb('#33415E'), rough_mul=1.05, normal=0.6),
        'floor': pbr('Floor', 'herringbone_parquet', scale=(0.8, 0.8, 0.8), tint=(0.55, 0.5, 0.45), coat=0.2, coat_rough=0.25),
        'plate': mat('Plate', (0.012, 0.012, 0.014), 0.42, 1.0, smudge=0.12, bump=0.08, bump_scale=2500),
        'alu': mat('Aluminium', srgb('#C9CDD3'), 0.24, 1.0, aniso=0.6, smudge=0.08),
        'alu_satin': mat('AluSatin', srgb('#B9BDC4'), 0.36, 1.0, smudge=0.06),
        'chrome': mat('Chrome', srgb('#E4E7EC'), 0.07, 1.0, smudge=0.05),
        'black': mat('BlackPlastic', (0.01, 0.01, 0.011), 0.38, 0.0, smudge=0.1, spec=0.45),
        'rubber': mat('Rubber', (0.009, 0.009, 0.01), 0.82, spec=0.3, bump=0.25, bump_scale=3000),
        'amber': mat('Amber', srgb('#F2A93B'), 0.3, 0.0, coat=0.6, coat_rough=0.1),
        'white': mat('WhitePaint', (0.75, 0.75, 0.73), 0.5),
        'led_red': mat('LedRed', (1, 0.15, 0.05), 0.3, emit=(1, 0.2, 0.06), emit_strength=6),
        'led_green': mat('LedGreen', (0.2, 1, 0.3), 0.3, emit=(0.25, 1, 0.35), emit_strength=3),
        'copper': mat('Copper', srgb('#C87F4A'), 0.25, 1.0),
        'wire_r': mat('WireR', (0.6, 0.02, 0.02), 0.45),
        'wire_g': mat('WireG', (0.02, 0.35, 0.05), 0.45),
        'wire_b': mat('WireB', (0.02, 0.08, 0.5), 0.45),
        'wire_w': mat('WireW', (0.7, 0.7, 0.68), 0.45),
        'dust': mat('Dust', (0.22, 0.21, 0.2), 0.9, spec=0.1),
        'paper': mat('Paper', (0.78, 0.76, 0.7), 0.6, spec=0.3, smudge=0.1),
        'skirting': mat('Skirting', (0.6, 0.6, 0.58), 0.45),
    }
    radial_tangent(M['alu'])
    M['vinyl'] = vinyl_material()
    M['label'] = paper_print('Label', os.path.join(COVERS, 'label.png'), rough=0.55, coat=0.0)
    return M


# ---------------------------------------------------------------- turntable
REC_R = 0.1508
PLINTH = (0.450, 0.365, 0.070)
FOOT_H = 0.020
PLATE_Z = FOOT_H + PLINTH[2]  # top of the deck
PLATTER_H = 0.028
MAT_H = 0.003
REC_H = 0.0018
REC_TOP = PLATE_Z + 0.003 + PLATTER_H + MAT_H + REC_H
PIVOT = V((0.172, 0.118))  # tonearm pivot, from the spindle


def build_turntable(M, parent):
    """Returns the handles the animation needs: arm swing empty, stylus tip, label object."""
    root = empty('Turntable', parent=parent)
    W, D, H = PLINTH
    # Plinth: walnut, rounded corners; feet; black anodised top plate.
    plinth = rounded_slab('Plinth', W, D, H, 0.014, (0, 0, FOOT_H + H / 2), M['walnut'], root, bevel=0.0012)
    uv_box(plinth, 1.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.045), sy * (D / 2 - 0.045)
            cyl('FootRing', 0.027, 0.016, (x, y, FOOT_H - 0.008), M['alu_satin'], root, bevel=0.0015, verts=64)
            cyl('FootPad', 0.024, 0.005, (x, y, 0.0025), M['rubber'], root, verts=48)
    plate = rounded_slab('TopPlate', W - 0.006, D - 0.006, 0.003, 0.0115, (0, 0, PLATE_Z + 0.0015), M['plate'], root, bevel=0.0006)

    z = PLATE_Z + 0.003
    # Platter: machined aluminium with four rows of strobe dots, rubber mat, spindle.
    platter = empty('PlatterSpin', (0, 0, 0), root)
    cyl('PlatterLower', 0.164, 0.006, (0, 0, z + 0.004), M['alu_satin'], platter, bevel=0.0008, verts=160)
    cyl('Platter', 0.166, PLATTER_H - 0.008, (0, 0, z + 0.008 + (PLATTER_H - 0.008) / 2), M['alu'], platter, bevel=0.0015, verts=192)
    bm = bmesh.new()
    for row, n in enumerate((180, 186, 192, 198)):
        zr = z + 0.0115 + row * 0.0043
        for i in range(n):
            a = i * 2 * math.pi / n
            g = bmesh.ops.create_cube(bm, size=1)
            bmesh.ops.scale(bm, verts=g['verts'], vec=(0.0006, 0.0022, 0.0022))
            bmesh.ops.rotate(bm, verts=g['verts'], cent=(0, 0, 0), matrix=Euler((0, 0, a)).to_matrix())
            bmesh.ops.translate(bm, verts=g['verts'], vec=(0.1661 * math.cos(a), 0.1661 * math.sin(a), zr))
    me = bpy.data.meshes.new('Strobe')
    bm.to_mesh(me)
    bm.free()
    strobe = link(bpy.data.objects.new('Strobe', me))
    strobe.data.materials.append(M['alu_satin'])
    strobe.parent = platter
    zm = z + PLATTER_H
    slip = cyl('Mat', 0.1485, MAT_H, (0, 0, zm + MAT_H / 2), M['rubber'], platter, bevel=0.0008, verts=128)
    cyl('Spindle', 0.0036, 0.016, (0, 0, zm + 0.008 + 0.004), M['chrome'], platter, bevel=0.0012, verts=32, segs=4)

    # Record + label.
    spin = empty('RecordSpin', (0, 0, 0), root)
    zr = zm + MAT_H
    record = cyl('Record', REC_R, REC_H, (0, 0, zr + REC_H / 2), None, spin, bevel=0.0005, verts=256)
    record.data.materials.append(M['vinyl'])
    # Object-space radius is used by the vinyl shader: keep the mesh centred on its origin (it is).
    label = cyl('Label', 0.05, 0.0002, (0, 0, zr + REC_H + 0.0001), M['label'], spin, verts=128)
    # Planar UVs for the label artwork.
    uv = label.data.uv_layers.active or label.data.uv_layers.new(name='UVMap')
    for poly in label.data.polygons:
        for li in poly.loop_indices:
            co = label.data.vertices[label.data.loops[li].vertex_index].co
            uv.data[li].uv = (0.5 + co.x / 0.1, 0.5 + co.y / 0.1)

    # Controls, front-left: start/stop, 33/45, strobe pod.
    zc = PLATE_Z + 0.003
    box('StartStop', (0.052, 0.034, 0.006), (-0.178, -0.150, zc + 0.003), M['alu_satin'], root, bevel=0.0012)
    text('T_Start', 'START · STOP', 0.0042, (-0.178, -0.1735, zc + 0.00004), M['white'], root)
    for i, lab in enumerate(('33', '45')):
        x = -0.132 + i * 0.03
        box('Speed', (0.022, 0.014, 0.004), (x, -0.160, zc + 0.002), M['alu_satin'], root, bevel=0.0008)
        text('T_Speed', lab, 0.0042, (x, -0.1735, zc + 0.00004), M['white'], root)
        cyl('SpeedLed', 0.0012, 0.0006, (x, -0.1485, zc + 0.0003), M['led_red'] if i == 0 else M['black'], root, verts=12)
    cyl('StrobePod', 0.011, 0.02, (-0.185, -0.103, zc + 0.01), M['black'], root, bevel=0.0015, verts=48)
    box('StrobeWindow', (0.002, 0.008, 0.006), (-0.1745, -0.1, zc + 0.012), M['led_red'], root, rot=(0, 0, math.radians(-20)))
    text('T_Brand', 'A.M. RECORDS', 0.0046, (-0.158, 0.158, zc + 0.00004), M['white'], root)
    text('T_Model', 'DIRECT DRIVE · MK1', 0.003, (-0.158, 0.150, zc + 0.00004), M['white'], root)
    # 45 rpm adapter in its recess.
    cyl('AdapterWell', 0.0215, 0.0008, (-0.185, 0.118, zc + 0.0004), M['black'], root, verts=64)
    cyl('Adapter', 0.019, 0.007, (-0.185, 0.118, zc + 0.0035), M['alu'], root, bevel=0.0012, verts=64)
    # Pitch fader, front-right.
    box('PitchSlot', (0.006, 0.105, 0.0006), (0.198, -0.085, zc + 0.0003), M['black'], root)
    for i in range(9):
        y = -0.085 + (i - 4) * 0.0115
        box('PitchTick', (0.006 if i % 4 == 0 else 0.0035, 0.0004, 0.00008), (0.2085, y, zc + 0.00004), M['white'], root)
    box('PitchKnob', (0.022, 0.011, 0.012), (0.198, -0.092, zc + 0.006), M['black'], root, bevel=0.002)
    box('PitchKnobLine', (0.022, 0.0012, 0.0003), (0.198, -0.092, zc + 0.01215), M['white'], root)
    cyl('PitchLed', 0.0013, 0.0006, (0.186, -0.085, zc + 0.0003), M['led_green'], root, verts=12)
    text('T_Pitch', 'PITCH', 0.0036, (0.198, -0.147, zc + 0.00004), M['white'], root)

    # Tonearm.
    px, py = PIVOT
    arm = empty('Arm', (px, py, zc), root)
    cyl('ArmBase', 0.038, 0.008, (0, 0, 0.004), M['black'], arm, bevel=0.0015, verts=96)
    cyl('ArmHeight', 0.024, 0.02, (0, 0, 0.018), M['alu'], arm, bevel=0.0012, verts=96)
    cyl('ArmCollar', 0.0265, 0.004, (0, 0, 0.012), M['black'], arm, bevel=0.0008, verts=96)
    cyl('ArmTower', 0.0085, 0.032, (0, 0, 0.044), M['alu_satin'], arm, bevel=0.0008, verts=48)
    AH = 0.057  # arm tube height above the deck (pivot)
    # Lift lever + arm rest, next to the pivot.
    cyl('RestPost', 0.004, 0.046, (0.012, -0.062, 0.023), M['alu_satin'], arm, verts=24)
    box('RestCup', (0.014, 0.008, 0.01), (0.012, -0.062, 0.05), M['black'], arm, bevel=0.002)
    box('LiftBody', (0.016, 0.03, 0.01), (0.036, -0.04, 0.005), M['black'], arm, bevel=0.0015)
    tube('LiftLever', [(0.036, -0.052, 0.008), (0.036, -0.066, 0.014), (0.036, -0.078, 0.016)], 0.0018, M['chrome'], arm)
    cyl('AntiSkate', 0.011, 0.01, (0.04, 0.012, 0.005), M['black'], arm, bevel=0.0012, verts=48)
    text('T_Anti', 'ANTI-SKATING', 0.0026, (0.04, -0.004, 0.00004), M['white'], arm)

    swing = empty('Swing', (0, 0, AH), arm)  # rotates about Z (tracking) and X (cueing)
    # Gimbal
    bpy.ops.mesh.primitive_torus_add(major_radius=0.0125, minor_radius=0.0028, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0), major_segments=48, minor_segments=12)
    finish(bpy.context.object, M['alu_satin'], swing)
    cyl('PivotHousing', 0.0075, 0.02, (0, 0, 0), M['black'], swing, bevel=0.001, verts=32, rot=(0, math.pi / 2, 0))
    # S-shaped tube, towards the front (−Y)
    pts = [(0, 0.006, 0), (0, -0.07, 0), (0.004, -0.125, 0), (0.016, -0.158, 0), (0.014, -0.186, 0), (0.002, -0.205, 0)]
    tube('ArmTube', pts, 0.0042, M['alu_satin'], swing)
    # Rear stub + counterweight with its dial
    cyl('ArmStub', 0.0052, 0.06, (0, 0.034, 0), M['black'], swing, verts=24, rot=(math.pi / 2, 0, 0))
    cyl('Counterweight', 0.0165, 0.03, (0, 0.05, 0), M['alu'], swing, bevel=0.0015, verts=64, rot=(math.pi / 2, 0, 0))
    cyl('CwDial', 0.0172, 0.006, (0, 0.032, 0), M['black'], swing, bevel=0.0006, verts=64, rot=(math.pi / 2, 0, 0))
    # Headshell: collar, plate (22° offset), finger lift, cartridge, stylus, four leads
    head = empty('Head', (0.002, -0.205, 0), swing, rot=(0, 0, math.radians(-24)))
    cyl('ShellCollar', 0.0058, 0.011, (0, -0.004, 0), M['black'], head, bevel=0.0006, verts=32, rot=(math.pi / 2, 0, 0))
    box('Shell', (0.017, 0.044, 0.0016), (0, -0.03, 0.0005), M['black'], head, bevel=0.0006)
    tube('FingerLift', [(0.0085, -0.034, 0.0008), (0.017, -0.036, 0.002), (0.025, -0.036, 0.006)], 0.0011, M['black'], head)
    box('Cartridge', (0.0165, 0.02, 0.0115), (0, -0.036, -0.0062), M['black'], head, bevel=0.0012)
    box('StylusGrip', (0.0125, 0.008, 0.007), (0, -0.0485, -0.009), M['amber'], head, bevel=0.001)
    tube('Cantilever', [(0, -0.047, -0.0125), (0, -0.0515, -0.0158)], 0.00035, M['alu'], head)
    tip = empty('StylusTip', (0, -0.0517, -0.0162), head)
    for i, k in enumerate(('wire_r', 'wire_w', 'wire_g', 'wire_b')):
        x = (i - 1.5) * 0.0032
        tube(f'Lead{i}', [(x * 0.5, -0.0095, 0.0012), (x, -0.018, 0.0042), (x, -0.0262, 0.0012)], 0.00045, M[k], head, resolution=8)
        cyl('Screw', 0.0013, 0.0008, ((-1) ** i * 0.0062, -0.026 - (i // 2) * 0.012, 0.0017), M['chrome'], head, verts=12)

    # Back: hinge blocks and a power lead that drops behind the furniture.
    for sx in (-1, 1):
        box('Hinge', (0.045, 0.012, 0.014), (sx * 0.15, D / 2 - 0.004, PLATE_Z + 0.008), M['black'], root, bevel=0.002)
    tube('Cable', [(0.12, D / 2, FOOT_H + 0.03), (0.13, D / 2 + 0.03, FOOT_H + 0.02), (0.16, D / 2 + 0.06, 0.004), (0.24, D / 2 + 0.085, 0.003), (0.30, D / 2 + 0.1, -0.05)], 0.0028, M['rubber'], root)

    # Dust: tiny specks and fibres on the record and the deck (they make the macro shots).
    rng = random.Random(7)
    bm = bmesh.new()
    def speck(x, y, zz):
        s = rng.uniform(0.00006, 0.00022)
        long = rng.random() < 0.3
        g = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, verts=g['verts'], vec=(s * (rng.uniform(4, 10) if long else 1), s * rng.uniform(0.3, 1), s * 0.3))
        bmesh.ops.rotate(bm, verts=g['verts'], cent=(0, 0, 0), matrix=Euler((0, 0, rng.uniform(0, math.pi))).to_matrix())
        bmesh.ops.translate(bm, verts=g['verts'], vec=(x, y, zz + s * 0.15))
    for _ in range(700):
        a, rr = rng.uniform(0, 2 * math.pi), 0.15 * math.sqrt(rng.random())
        if rr > 0.052:
            speck(rr * math.cos(a), rr * math.sin(a), zr + REC_H)
    for _ in range(900):
        x, y = rng.uniform(-W / 2 + 0.01, W / 2 - 0.01), rng.uniform(-D / 2 + 0.01, D / 2 - 0.01)
        if math.hypot(x, y) > 0.17:
            speck(x, y, zc)
    me = bpy.data.meshes.new('Dust')
    bm.to_mesh(me)
    bm.free()
    dust = link(bpy.data.objects.new('Dust', me))
    dust.data.materials.append(M['dust'])
    dust.parent = root
    return dict(root=root, swing=swing, tip=tip, label=label, spin=spin, platter=platter, arm=arm)


def arm_angle_for(tt, radius):
    """Swing rotation (about Z) that puts the stylus on a groove of the given radius."""
    swing, tip = tt['swing'], tt['tip']
    root = tt['root']
    lo, hi = 0.0, math.radians(45)
    for _ in range(40):
        mid = (lo + hi) / 2
        swing.rotation_euler = (0, 0, -mid)
        bpy.context.view_layer.update()
        p = root.matrix_world.inverted() @ tip.matrix_world.translation
        if math.hypot(p.x, p.y) > radius:
            lo = mid
        else:
            hi = mid
    return -(lo + hi) / 2


# ---------------------------------------------------------------- record crate
SLEEVE = 0.315
SLEEVE_T = 0.0034
CRATE_IN = (0.330, 0.336)  # inner width, depth
CRATE_WALL = 0.012
CRATE_H = 0.250
CRATE_FRONT_H = 0.165


def build_crate(M, parent, order, fillers=24):
    """An oak crate full of sleeves. Returns per-sleeve handles for the riffle animation."""
    crate = empty('Crate', parent=parent)
    iw, idp = CRATE_IN
    t = CRATE_WALL
    parts = [
        box('CrateFloor', (iw + 2 * t, idp + 2 * t, t), (0, 0, t / 2), None, crate, bevel=0.001),
        box('CrateBack', (iw + 2 * t, t, CRATE_H), (0, idp / 2 + t / 2, CRATE_H / 2), None, crate, bevel=0.001),
        box('CrateFront', (iw + 2 * t, t, CRATE_FRONT_H), (0, -idp / 2 - t / 2, CRATE_FRONT_H / 2), None, crate, bevel=0.001),
    ]
    for sx in (-1, 1):
        side = box('CrateSide', (t, idp, CRATE_H), (sx * (iw / 2 + t / 2), 0, CRATE_H / 2), None, crate, bevel=0.001)
        # Hand hole
        bpy.ops.mesh.primitive_cylinder_add(radius=0.016, depth=0.1, location=(0, 0, 0), rotation=(0, math.pi / 2, 0), vertices=48)
        cutter = bpy.context.object
        cutter.scale = (1, 2.6, 1)
        cutter.location = (sx * (iw / 2 + t / 2), 0, CRATE_H - 0.05)
        cutter.parent = crate
        cutter.hide_render = True
        cutter.display_type = 'WIRE'
        mod = side.modifiers.new('Hole', 'BOOLEAN')
        mod.object = cutter
        mod.operation = 'DIFFERENCE'
        side.modifiers.move(len(side.modifiers) - 1, 0)
        parts.append(side)
    for o in parts:
        o.data.materials.append(M['oak'])
        uv_box(o, 1.0)
    for sx in (-1, 1):
        for zz in (0.03, CRATE_FRONT_H - 0.03):
            cyl('Nail', 0.0022, 0.0008, (sx * (iw / 2 + t / 2), -idp / 2 - t - 0.0002, zz), M['alu_satin'], crate, verts=12, rot=(math.pi / 2, 0, 0))
    stamp = text('Stamp', 'A.M. RECORDS', 0.022, (0, -idp / 2 - t - 0.0002, 0.075), mat('Stamp', (0.02, 0.02, 0.025), 0.7), crate, rot=(math.pi / 2, 0, 0), extrude=0.00005)

    # Sleeves: project sleeves first (front), then fillers. In front of them, a divider card (the
    # index of the series) that always leans forward, as if the browsing had already started.
    rng = random.Random(3)
    n = len(order) + fillers
    theta_b = math.radians(9.5)
    theta_f = math.atan(0.05 / (CRATE_FRONT_H - t))
    pitch = 0.0049
    y_back = idp / 2 - SLEEVE * math.sin(theta_b) - 0.004
    filler_cols = ['#EDE5D3', '#15110E', '#C4522E', '#0F3A45', '#F1ECE0', '#2343B4', '#E9E1CF', '#1E4939', '#B3282A', '#D9D3C4', '#3A1E3E', '#EFA72E']
    edge = M['paper']

    def sleeve(name, loc, rot, front, back):
        piv = empty(name, loc, crate, rot=rot)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, SLEEVE / 2))
        o = bpy.context.object
        o.name = name + 'Mesh'
        o.scale = (SLEEVE, SLEEVE_T, SLEEVE)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for m in (edge, front, back):
            o.data.materials.append(m)
        uv = o.data.uv_layers.active or o.data.uv_layers.new()
        for poly in o.data.polygons:
            if abs(poly.normal.y) > 0.5:
                poly.material_index = 1 if poly.normal.y < 0 else 2
                for li in poly.loop_indices:
                    co = o.data.vertices[o.data.loops[li].vertex_index].co
                    u = 0.5 + co.x / SLEEVE
                    uv.data[li].uv = (u if poly.normal.y < 0 else 1 - u, 0.5 + co.z / SLEEVE)
        finish(o, None, piv, bevel=0.0007, segs=2)
        return piv, o

    sleeve('Divider', (0.002, -idp / 2 + 0.05, t + 0.0005), (theta_f, 0, math.radians(0.4)), paper_print('IndexFront', os.path.join(COVERS, 'index-front.png')), M['paper'])
    sleeves = []
    for k in range(n):
        y0 = y_back - (n - 1 - k) * pitch
        if k < len(order):
            front = paper_print(f'Front{k}', os.path.join(COVERS, f'{order[k]}-front.png'))
            back = paper_print(f'Back{k}', os.path.join(COVERS, f'{order[k]}-back.png'))
        else:
            front = back = mat(f'Filler{k}', srgb(filler_cols[k % len(filler_cols)]), 0.55, spec=0.35, smudge=0.1)
        # Rotation about X: negative leans back (top away from the viewer), positive leans forward.
        rot = (-theta_b + math.radians(rng.uniform(-0.6, 0.6)), 0, math.radians(rng.uniform(-0.5, 0.5)))
        piv, o = sleeve(f'Sleeve{k}', (rng.uniform(-0.004, 0.004), y0, t + 0.0005), rot, front, back)
        sleeves.append(dict(pivot=piv, mesh=o, y0=y0, lean=rot[0]))
    return dict(root=crate, sleeves=sleeves, theta_b=theta_b, theta_f=theta_f, pitch=pitch, floor=t + 0.0005, y_front=-idp / 2)


# ---------------------------------------------------------------- room
def append_collection(asset, name=None):
    """Loads a Poly Haven model (.blend) and returns a collection holding everything it needs."""
    path = os.path.join(ASSETS, 'models', asset, asset + '.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if not c.startswith('wdg')]
    holder = bpy.data.collections.new(name or asset)
    for c in dst.collections:
        if c is not None:
            holder.children.link(c)
    return holder


def place(holder, loc, rot=(0, 0, 0), scale=1.0, parent=None):
    inst = link(bpy.data.objects.new(holder.name + '_inst', None))
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = holder
    inst.location = loc
    inst.rotation_euler = rot
    inst.scale = (scale, scale, scale)
    inst.parent = parent
    return inst


def build_room(M):
    """Wall, floor, skirting and the sideboard. Returns the sideboard's top height."""
    wall = box('Wall', (7, 0.1, 3.2), (0, 0.33 + 0.05, 1.6), M['wall'])
    uv_box(wall, 1.0)
    floor = box('Floor', (7, 5, 0.05), (0, -2.1, -0.025), M['floor'])
    uv_box(floor, 1.0)
    sk = box('Skirting', (7, 0.014, 0.09), (0, 0.323, 0.045), M['skirting'], bevel=0.003)
    cab = append_collection('modern_wooden_cabinet')
    place(cab, (0, 0, 0))
    return 0.68
