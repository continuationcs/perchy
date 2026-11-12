#!/usr/bin/env python3
"""Mock OpenAI-style image API for testing Perchy's hatch pipeline offline.

Implements POST /v1/images/generations, /v1/images/edits (multipart) and
/v1/chat/completions (modalities image). It reads the frame count and grid
from the prompt and draws simple "pets" (body + head + eyes) on chroma green,
moving them per frame (bob / jump / walk). For jumping it draws one extra pose
in the spare cell so the extractor's "extra pose" warning is exercised.
Like OpenRouter with gpt-image-2, it rejects `background: transparent` and `n`.
The first "failed" sheet is two poses short (exercises the automatic retry).

    python3 tools/mock-image-api.py 8765               # OpenAI-style
    python3 tools/mock-image-api.py 8765 --openrouter  # no /images/edits; JSON /images + input_references
"""
import base64, json, math, re, struct, sys, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BG = (0, 255, 0)
OPENROUTER = "--openrouter" in sys.argv

def png(w, h, buf):
    raw = b"".join(b"\x00" + bytes(buf[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    c = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + c(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + c(b"IDAT", zlib.compress(raw, 6)) + c(b"IEND", b"")

def ellipse(buf, w, h, cx, cy, rx, ry, col):
    for y in range(max(0, int(cy - ry)), min(h, int(cy + ry) + 1)):
        dy = (y - cy) / ry
        if abs(dy) > 1: continue
        span = rx * math.sqrt(1 - dy * dy)
        x0, x1 = max(0, int(cx - span)), min(w - 1, int(cx + span))
        row = y * w * 3
        buf[row + x0 * 3: row + (x1 + 1) * 3] = bytes(col) * (x1 - x0 + 1)

def pet(buf, w, h, cx, ground, size, t, kind):
    lift = 0
    if kind == "jumping": lift = size * 0.9 * math.sin(math.pi * t)
    bob = size * 0.04 * math.sin(2 * math.pi * t)
    lean = size * 0.12 * math.sin(2 * math.pi * t) if kind.startswith("running") else 0
    gy = ground - lift
    ellipse(buf, w, h, cx + lean * 0.3, gy - size * 0.35 + bob, size * 0.42, size * 0.35, (240, 150, 60))  # body
    # Translucent skirt: cream blended 35% with the key colour (like tulle on a chroma background).
    tulle = tuple(round(c * 0.65 + k * 0.35) for c, k in zip((240, 225, 200), BG))
    ellipse(buf, w, h, cx + lean * 0.3, gy - size * 0.16 + bob, size * 0.5, size * 0.1, tulle)
    if kind in ("waving", "jumping"):  # raised arm above the head → taller pose, same body size
        ellipse(buf, w, h, cx + size * 0.3, gy - size * 1.25 + bob, size * 0.07, size * 0.22, (250, 175, 90))
    ellipse(buf, w, h, cx + lean, gy - size * 0.85 + bob, size * 0.33, size * 0.3, (250, 175, 90))       # head
    for ex in (-0.12, 0.12):
        ellipse(buf, w, h, cx + lean + size * ex, gy - size * 0.88 + bob, size * 0.04, size * 0.06, (40, 25, 15))
    for fx in (-0.2, 0.2):  # feet
        step = size * 0.08 * math.sin(2 * math.pi * t + (0 if fx < 0 else math.pi)) if kind.startswith("running") else 0
        ellipse(buf, w, h, cx + size * fx + step, gy - size * 0.03, size * 0.1, size * 0.06, (200, 110, 40))

SEEN = {}

def draw(prompt, size):
    m = re.search(r"(\d+)x(\d+)", size or "") or re.search(r"size (\d+)x(\d+)", prompt)
    w, h = (int(m.group(1)), int(m.group(2))) if m else (1024, 1024)
    buf = bytearray(bytes(BG) * (w * h))
    g = re.search(r"grid of (\d+) columns × (\d+) rows", prompt)
    if not g:  # base character
        pet(buf, w, h, w / 2, h * 0.82, h * 0.6, 0, "idle")
        return png(w, h, buf)
    cols, rows = int(g.group(1)), int(g.group(2))
    n = 8 if "16-direction" in prompt else int(re.search(r"with (\d+) frames", prompt).group(1))
    kind = (re.search(r'Animation "([\w-]+)"', prompt) or [None, "look"])[1]
    draw_n = n + 1 if kind == "jumping" and n < cols * rows else n
    # The first "failed" sheet comes back two poses short, to exercise the
    # pipeline's automatic retry.
    SEEN[kind] = SEEN.get(kind, 0) + 1
    if kind == "failed" and SEEN[kind] == 1:
        draw_n = n - 2
    cw, ch = w / cols, h / rows
    for i in range(draw_n):
        cx, cy = (i % cols + 0.5) * cw, (i // cols) * ch
        pet(buf, w, h, cx, cy + ch * 0.9, ch * 0.42, (i % n) / n, kind)
    return png(w, h, buf)

def multipart_field(body, ctype, name):
    boundary = ctype.split("boundary=")[1].encode()
    for part in body.split(b"--" + boundary):
        if f'name="{name}"'.encode() in part.split(b"\r\n\r\n")[0]:
            return part.split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0].decode()
    return ""

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.headers.get("Authorization") != "Bearer test-key":
            return self.reply(401, {"error": {"message": "bad key"}})
        if self.path.endswith("/images/edits") and OPENROUTER:
            return self.reply(404, {"error": {"message": "Not Found"}})
        if self.path.endswith("/images/edits"):
            ct = self.headers["Content-Type"]
            if multipart_field(body, ct, "background") == "transparent" or b'name="n"' in body:
                return self.reject()
            prompt, size = multipart_field(body, ct, "prompt"), multipart_field(body, ct, "size")
            refs = body.count(b'name="image[]"')
            img = draw(prompt, size)
            print(f"edits refs={refs} size={size} prompt={prompt[:60]!r}", flush=True)
            return self.reply(200, {"data": [{"b64_json": base64.b64encode(img).decode()}]})
        req = json.loads(body)
        if self.path.endswith("/v1/images"):
            if req.get("background") == "transparent" or "n" in req:
                return self.reject()
            refs = req.get("input_references", [])
            assert all(r["image_url"]["url"].startswith("data:image/png;base64,") for r in refs)
            img = draw(req["prompt"], req.get("size"))
            print(f"images(input_references={len(refs)}) size={req.get('size')}", flush=True)
            return self.reply(200, {"data": [{"b64_json": base64.b64encode(img).decode(), "media_type": "image/png"}]})
        if self.path.endswith("/images/generations"):
            if req.get("background") == "transparent" or "n" in req:
                return self.reject()
            img = draw(req["prompt"], req.get("size"))
            print(f"generations size={req.get('size')}", flush=True)
            return self.reply(200, {"data": [{"b64_json": base64.b64encode(img).decode()}]})
        if self.path.endswith("/chat/completions"):
            parts = req["messages"][0]["content"]
            text = next(p["text"] for p in parts if p["type"] == "text")
            refs = sum(1 for p in parts if p["type"] == "image_url")
            assert req.get("modalities") == ["image", "text"]
            img = draw(text, None)
            print(f"chat refs={refs} prompt={text[:60]!r}", flush=True)
            url = "data:image/png;base64," + base64.b64encode(img).decode()
            return self.reply(200, {"choices": [{"message": {"role": "assistant", "content": "", "images": [{"type": "image_url", "image_url": {"url": url}}]}}]})
        self.reply(404, {"error": {"message": "not found"}})

    def reject(self):
        # Same shape as OpenRouter's error for gpt-image-2.
        msg = 'No provider for openai/gpt-image-2 supports the requested parameter(s): background "transparent", n "1". Provider rejections: OpenAI: background: not supported. Accepted: auto, opaque'
        print("rejected optional params", flush=True)
        return self.reply(400, {"error": {"message": msg, "code": 400}})

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def log_message(self, *a): pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8765
    print(f"mock image API on http://127.0.0.1:{port}/v1", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
