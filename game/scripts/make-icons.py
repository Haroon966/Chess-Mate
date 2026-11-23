#!/usr/bin/env python3 -I
"""Generate PWA icons from pieces/white_pawn.png. Run: python3 -I scripts/make-icons.py"""
import os, base64, io
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)
C1, C2 = (0x2f, 0x4a, 0x22), (0x81, 0xb6, 0x4c)
S = 1024  # master size

def gradient(size):
    g = Image.new('RGB', (size, size))
    px = g.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))  # diagonal dark(top-left) -> light(bottom-right)
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(C1, C2))
    return g

def piece(box):
    k = Image.open(os.path.join(ROOT, 'pieces', 'white_pawn.png')).convert('RGBA')
    r = min(box / k.width, box / k.height)
    return k.resize((round(k.width * r), round(k.height * r)), Image.LANCZOS)

def compose(artbox, rounded):
    bg = gradient(S).convert('RGBA')
    k = piece(artbox)
    pos = ((S - k.width) // 2, (S - k.height) // 2)
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow = Image.new('RGBA', k.size, (0, 0, 0, 120)); shadow.putalpha(k.getchannel('A').point(lambda a: a * 120 // 255))
    sh.paste(shadow, (pos[0] + S // 70, pos[1] + S // 55), shadow)
    sh = sh.filter(ImageFilter.GaussianBlur(S // 60))
    bg = Image.alpha_composite(bg, sh)
    bg.alpha_composite(k, pos)
    if rounded:
        m = Image.new('L', (S * 2, S * 2), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S * 2 - 1, S * 2 - 1], radius=int(S * 2 * 0.22), fill=255)
        bg.putalpha(m.resize((S, S), Image.LANCZOS))
    return bg

def save(img, name, size, opaque=False):
    im = img.resize((size, size), Image.LANCZOS)
    if opaque:
        flat = Image.new('RGB', im.size, C1); flat.paste(im, mask=im.getchannel('A')); im = flat
    im.save(os.path.join(OUT, name), optimize=True)

any_ = compose(int(S * 0.64), True)           # pawn ~64% tall on rounded tile
save(any_, 'icon-512.png', 512); save(any_, 'icon-192.png', 192); save(any_, 'favicon-32.png', 32)
mask = compose(int(S * 0.50), False)          # full-bleed; art well inside 80% safe zone
save(mask, 'icon-maskable-512.png', 512, opaque=True)
apple = compose(int(S * 0.58), False)         # iOS rounds corners itself; must be opaque
save(apple, 'apple-touch-icon.png', 180, opaque=True)
any_.resize((48, 48), Image.LANCZOS).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])

# SVG: embeds the pawn art as data URI
buf = io.BytesIO(); k = piece(330); k.save(buf, 'PNG')
b64 = base64.b64encode(buf.getvalue()).decode()
kw, kh = k.size
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f4a22"/><stop offset="1" stop-color="#81b64c"/></linearGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#g)"/>
<image x="{(512 - kw) / 2:.1f}" y="{(512 - kh) / 2:.1f}" width="{kw}" height="{kh}" href="data:image/png;base64,{b64}"/>
</svg>
'''
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg)
print('icons written to', OUT)
