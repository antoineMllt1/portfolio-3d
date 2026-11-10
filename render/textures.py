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
