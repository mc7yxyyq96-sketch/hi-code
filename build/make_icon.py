#!/usr/bin/env python3
"""Generate the Hi Code app icon: a gradient squircle with a sparkle mark."""
import math
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# --- vertical gradient background ---
top = (0xBB, 0x9A, 0xF7)      # violet
bot = (0x6A, 0x7A, 0xE8)      # indigo
grad = Image.new("RGBA", (S, S))
gd = grad.load()
for y in range(S):
    t = y / (S - 1)
    r = round(top[0] + (bot[0] - top[0]) * t)
    g = round(top[1] + (bot[1] - top[1]) * t)
    b = round(top[2] + (bot[2] - top[2]) * t)
    for x in range(S):
        gd[x, y] = (r, g, b, 255)

# --- rounded-square (squircle-ish) mask ---
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
radius = int(S * 0.225)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(img)

# subtle inner highlight at top
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
hd = ImageDraw.Draw(hl)
hd.rounded_rectangle([0, 0, S - 1, int(S * 0.5)], radius=radius, fill=(255, 255, 255, 26))
img = Image.alpha_composite(img, Image.composite(hl, Image.new("RGBA", (S, S)), mask))
draw = ImageDraw.Draw(img)

# --- 4-point sparkle ---
def sparkle(cx, cy, tip, waist, fill):
    pts = []
    for k in range(8):
        ang = math.radians(k * 45 - 90)
        r = tip if k % 2 == 0 else waist
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    draw.polygon(pts, fill=fill)

cx, cy = S / 2, int(S * 0.52)
sparkle(cx, cy, S * 0.34, S * 0.085, (255, 255, 255, 255))
# small accent sparkle
sparkle(S * 0.70, S * 0.30, S * 0.085, S * 0.022, (255, 255, 255, 235))

out = Path(__file__).resolve().parent / "icon.png"
img.save(out)
print(f"wrote {out}")
