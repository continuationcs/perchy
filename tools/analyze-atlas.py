#!/usr/bin/env python3
"""Quality metrics for a Codex v2 atlas (no Pillow needed).

    python3 tools/analyze-atlas.py spritesheet.png

- key tint: opaque pixels still tinted toward green / magenta (fringe)
- body width per row: widest opaque run in the lower half of each frame,
  averaged per row (rows should match if the scale is consistent)
"""
import struct, sys, zlib

def read_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat = 8, b""
    while pos < len(data):
        n, t = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if t == b"IHDR": w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
        elif t == b"IDAT": idat += body
        pos += 12 + n
    assert depth == 8 and ctype == 6, "expects 8-bit RGBA"
    raw, bpp, stride = zlib.decompress(idat), 4, w * 4
    out, prev, i = bytearray(), bytearray(stride), 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b, c = prev[x], prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += line; prev = line
    return w, h, out

w, h, px = read_png(sys.argv[1])
tint_g = tint_m = opaque = 0
for i in range(0, len(px), 4):
    r, g, b, a = px[i:i + 4]
    if a < 200: continue
    opaque += 1
    if g > max(r, b) + 20: tint_g += 1
    if min(r, b) > g + 20 and abs(r - b) < 60: tint_m += 1
print(f"opaque px {opaque}, green-tinted {tint_g} ({tint_g / max(opaque, 1):.2%}), magenta-tinted {tint_m} ({tint_m / max(opaque, 1):.2%})")
CW, CH = 192, 208
for row in range(h // CH):
    widths = []
    for col in range(w // CW):
        best, top = 0, None
        for y in range(CH):
            yy = row * CH + y
            run = cur = 0
            for x in range(CW):
                if px[(yy * w + col * CW + x) * 4 + 3] > 128: cur += 1; run = max(run, cur)
                else: cur = 0
            if run and top is None: top = y
            if top is not None and y > (top + CH) / 2: best = max(best, run)
        if best: widths.append(best)
    if widths: print(f"row {row:2d}: body width {sum(widths) / len(widths):5.1f} px over {len(widths)} frames")
