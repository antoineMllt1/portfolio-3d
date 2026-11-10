# Downloads the CC0 assets the scene uses from Poly Haven into render/assets (not committed).
#   python3 render/fetch_assets.py
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
UA = {'User-Agent': 'portfolio-3d-render'}
MODELS = {'modern_wooden_cabinet': '2k', 'potted_plant_02': '2k', 'desk_lamp_arm_01': '2k', 'decorative_book_set_01': '1k', 'Camera_01': '2k'}
TEXTURES = {'walnut_veneer': '2k', 'painted_plaster_wall': '2k', 'oak_veneer_01': '2k', 'plywood': '2k', 'herringbone_parquet': '2k'}
HDRIS = {'lythwood_room': '2k'}


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req) as r, open(path, 'wb') as fh:
        fh.write(r.read())
    print('  ', os.path.relpath(path, OUT), os.path.getsize(path) // 1024, 'kB')


def files(asset):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers=UA)
    return json.load(urllib.request.urlopen(req))


for asset, res in MODELS.items():
    print(asset)
    f = files(asset)['blend'][res]['blend']
    folder = os.path.join(OUT, 'models', asset)
    get(f['url'], os.path.join(folder, f'{asset}.blend'))
    for rel, inc in f.get('include', {}).items():
        get(inc['url'], os.path.join(folder, rel))

for asset, res in TEXTURES.items():
    print(asset)
    f = files(asset)
    for kind, key in (('diff', 'Diffuse'), ('rough', 'Rough'), ('nor', 'nor_gl')):
        entry = f[key][res]
        fmt = 'jpg' if 'jpg' in entry else 'png'
        get(entry[fmt]['url'], os.path.join(OUT, 'textures', f'{asset}_{kind}.{fmt}'))

for asset, res in HDRIS.items():
    print(asset)
    get(files(asset)['hdri'][res]['hdr']['url'], os.path.join(OUT, f'{asset}.hdr'))
