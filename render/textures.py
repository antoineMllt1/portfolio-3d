# Textures for the Blender scene: the record label and the groove maps (run with python3).
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-{}.ttf'
S = 2048

# Label: amber disc with name, tagline, a small index mark and the spindle hole.
img = Image.new('RGB', (S, S), (255, 181, 71))
d = ImageDraw.Draw(img)
m = S // 2
d.ellipse([m - 930, m - 930, m + 930, m + 930], outline=(214, 150, 58), width=10)
navy = (10, 31, 68)
def text(y, s, size, weight='Bold', alpha=1.0):
    f = ImageFont.truetype(FONT.format(weight), size)
    w = d.textlength(s, font=f)
    col = tuple(int(255 * (1 - alpha) * c / 255 + alpha * v) for c, v in zip((255, 181, 71), navy))
    d.text((m - w / 2, y), s, font=f, fill=col)
text(m - 520, 'ANTOINE MILLOT', 150)
text(m - 330, 'DATA ANALYST · AI ENGINEER', 62, 'Medium', 0.8)
text(m + 260, 'DATA · AI · DJ', 96, 'SemiBold', 0.85)
text(m + 420, 'SIDE A   ·   33⅓ RPM', 58, 'Medium', 0.7)
d.rectangle([m - 14, m - 760, m + 14, m - 640], fill=navy)
d.ellipse([m - 46, m - 46, m + 46, m + 46], fill=(20, 24, 32))
img.save('tex/label.png')

# Grooves: fine concentric rings (bump) with four darker track gaps, flat run-out near the label.
y, x = np.mgrid[0:S, 0:S].astype(np.float32)
r = np.hypot(x - m + 0.5, y - m + 0.5) / m  # 0 centre → 1 rim
rings = 0.5 + 0.5 * np.sin(r * 2 * np.pi * 260)
noise = np.random.default_rng(3).normal(0, 0.08, (S, S)).astype(np.float32)
bump = np.where((r > 0.36) & (r < 0.985), rings * 0.8 + noise * 0.2 + 0.1, 0.5)
for f in (0.5, 0.62, 0.74, 0.87):
    bump = np.where(np.abs(r - f) < 0.006, 0.15, bump)
Image.fromarray((np.clip(bump, 0, 1) * 255).astype(np.uint8)).save('tex/grooves.png')
# Roughness: grooved area slightly glossier than the gaps.
rough = np.where((r > 0.36) & (r < 0.985), 0.28 + 0.05 * rings, 0.45)
for f in (0.5, 0.62, 0.74, 0.87):
    rough = np.where(np.abs(r - f) < 0.006, 0.15, rough)
Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).save('tex/rough.png')
print('ok')

# Back of the sleeve that gets lifted: cream paper with a small printed block (the front stays white
# so the project cover can be multiplied onto it in the browser).
S2 = 1024
back = Image.new('RGB', (S2, S2), (236, 231, 220))
d = ImageDraw.Draw(back)
grain = np.random.default_rng(5).normal(0, 4, (S2, S2, 1)).astype(np.int16)
back = Image.fromarray(np.clip(np.asarray(back).astype(np.int16) + grain, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(back)
navy = (10, 31, 68)
f1 = ImageFont.truetype(FONT.format('Bold'), 34)
f2 = ImageFont.truetype(FONT.format('Medium'), 20)
d.text((80, 80), 'ANTOINE MILLOT', font=f1, fill=navy)
d.text((80, 128), 'DATA · AI · DJ   —   SIDE A / SIDE B', font=f2, fill=navy)
for i, line in enumerate(['A1  INTRO', 'A2  THE NEEDLE', 'A3  TEARDOWN', 'A4  THE NUMBERS', 'B1  THE PROJECTS', 'B2  SIDE B']):
    d.text((80, 220 + i * 34), line, font=f2, fill=navy)
d.rectangle([80, 880, 420, 900], fill=navy)
x = 700
rng = np.random.default_rng(9)
for _ in range(40):
    w = int(rng.integers(2, 7))
    d.rectangle([x, 800, x + w, 900], fill=navy)
    x += w + int(rng.integers(3, 8))
d.text((700, 910), 'AM-2026-001', font=f2, fill=navy)
back.save('tex/sleeve-back.png')
print('back ok')
