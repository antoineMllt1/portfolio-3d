# Turns the Blender output into the web film: public/frames/{variant}-{l,s}/…webp + manifest.json.
#   python3 scripts/frames.py render/out
# Per variant folder (wide, tall): f_*.png and c_*.png (motion frames), h_f_*.png and h_c_*.png (the
# bigger rest frames), anchors.json. A sequence whose motion frames are incomplete is left out: the
# page then dissolves between its rest frames (`motion` in the manifest says which ones are there).
import json
import os
import sys

from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else 'render/out'
dst = 'public/frames'
# (motion width, quality), (hold width, quality) per size
SIZES = {
    'wide': {'l': ((1920, 80), (2560, 84)), 's': ((1280, 78), (1600, 82))},
    'tall': {'l': ((720, 78), (1080, 84)), 's': ((540, 76), (810, 82))},
}
ANCHOR_X = {'wide': 0.68, 'tall': 0.5}  # how a cover-cropped frame is anchored horizontally


def save(path_in, path_out, width, quality):
    im = Image.open(path_in).convert('RGB')
    if im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(path_out, 'WEBP', quality=quality, method=6)
    return os.path.getsize(path_out)


manifest = {}
for variant, sizes in SIZES.items():
    folder = os.path.join(src, variant)
    if not os.path.isfile(os.path.join(folder, 'anchors.json')):
        continue
    with open(os.path.join(folder, 'anchors.json')) as fh:
        anchors = json.load(fh)
    names = sorted(os.listdir(folder))
    holds = [n for n in names if n.startswith('h_') and n.endswith('.png')]
    need = len(anchors['beats']) + len(anchors['crate']['order'])
    if len(holds) < need:
        print(f'{variant}: {len(holds)}/{need} rest frames, skipped')
        continue
    motion = {s: [n for n in names if n.startswith(s + '_') and n.endswith('.png')] for s in ('f', 'c')}
    need_motion = {'f': anchors['frames'], 'c': anchors['crate']['frames']}
    has = {s: len(motion[s]) >= need_motion[s] for s in ('f', 'c')}
    for s in ('f', 'c'):
        if not has[s]:
            print(f'{variant}: sequence {s} incomplete ({len(motion[s])}/{need_motion[s]}): rest frames only')
    for size, ((mw, mq), (hw, hq)) in sizes.items():
        out = os.path.join(dst, f'{variant}-{size}')
        os.makedirs(out, exist_ok=True)
        total = 0
        for seq in ('f', 'c'):
            if has[seq]:
                for n in motion[seq]:
                    total += save(os.path.join(folder, n), os.path.join(out, n[:-4] + '.webp'), mw, mq)
        for n in holds:
            total += save(os.path.join(folder, n), os.path.join(out, n[:-4] + '.webp'), hw, hq)
        print(f'{variant}-{size}: {total / 1e6:.1f} MB')
    if variant == 'wide':
        save(os.path.join(folder, 'h_f_0001.png'), os.path.join(dst, 'poster.webp'), 960, 60)
    manifest[variant] = {**anchors, 'anchorX': ANCHOR_X[variant], 'motion': has}
with open(os.path.join(dst, 'manifest.json'), 'w') as fh:
    json.dump(manifest, fh, separators=(',', ':'))
print('variants:', ', '.join(manifest) or 'none')
