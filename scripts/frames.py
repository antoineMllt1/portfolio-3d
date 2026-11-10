# Turns the Blender output (PNG frames + anchors.json per variant) into the web film:
# public/frames/{wide-l,wide-s,tall-l,tall-s}/f_0001.webp … (main film) and l_0001.webp … (crate loop),
# plus manifest.json and poster.webp.
#   python3 scripts/frames.py render/out
import json
import os
import sys

from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else 'render/out'
dst = 'public/frames'
SIZES = {'wide': {'l': (1600, 80), 's': (1024, 76)}, 'tall': {'l': (720, 78), 's': (480, 74)}}
ANCHOR_X = {'wide': 0.6, 'tall': 0.5}  # how a cover-cropped frame is anchored horizontally

manifest = {}
for variant, sizes in SIZES.items():
    folder = os.path.join(src, variant)
    if not os.path.isdir(folder):
        print(f'{variant}: nothing rendered, skipped')
        continue
    with open(os.path.join(folder, 'anchors.json')) as fh:
        anchors = json.load(fh)
    seqs = {}
    for prefix, expected in (('f_', anchors['frames']), ('l_', anchors['loop'])):
        files = sorted(f for f in os.listdir(folder) if f.startswith(prefix) and f.endswith('.png'))
        if len(files) != expected:
            print(f'{variant} {prefix}: {len(files)}/{expected} frames rendered, variant skipped')
            seqs = None
            break
        seqs[prefix] = files
    if not seqs:
        continue
    for size, (width, quality) in sizes.items():
        out = os.path.join(dst, f'{variant}-{size}')
        os.makedirs(out, exist_ok=True)
        total = 0
        for prefix, files in seqs.items():
            for i, name in enumerate(files, 1):
                im = Image.open(os.path.join(folder, name)).convert('RGB')
                h = round(im.height * width / im.width)
                im = im.resize((width, h), Image.LANCZOS)
                path = os.path.join(out, f'{prefix}{i:04d}.webp')
                im.save(path, 'WEBP', quality=quality, method=6)
                total += os.path.getsize(path)
                if variant == 'wide' and size == 'l' and prefix == 'f_' and i == 1:
                    im.save(os.path.join(dst, 'poster.webp'), 'WEBP', quality=72, method=6)
        print(f'{variant}-{size}: {sum(len(f) for f in seqs.values())} frames, {total / 1e6:.1f} MB')
    manifest[variant] = {**anchors, 'anchorX': ANCHOR_X[variant]}
with open(os.path.join(dst, 'manifest.json'), 'w') as fh:
    json.dump(manifest, fh, separators=(',', ':'))
