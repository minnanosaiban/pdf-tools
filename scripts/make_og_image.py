"""Regenerate public/og-image-square.png and public/og-image-large.png.

Requires Pillow and Japanese-capable TrueType fonts (Meiryo / HG教科書体 on Windows).
Run: python scripts/make_og_image.py

sidenote（サイドノート作成ツール）のOGP画像と同じ構成：
- 横長（1200x630 / Twitterのlargeカード）＝左にアプリ名と説明、右にアプリのミニ画面。
  このアプリの推しは「墨消し」と「手書き風」なので、ミニ画面には黒塗りの帯と、
  手書き風の青い文字・赤い手書きのマルを描く。
- 正方形（630x630 / summaryカード・小さいサムネイル）＝小さくても読める黒地に白抜き2行。
"""

import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = r"C:\Windows\Fonts\meiryo.ttc"
FONT_BOLD_PATH = r"C:\Windows\Fonts\meiryob.ttc"
HAND_FONT_PATH = r"C:\Windows\Fonts\HGRKK.TTC"      # HG教科書体（手書きに近い書体）
OUT_DIR = Path(__file__).resolve().parent.parent / "public"

TITLE = "PDFツール"
DESC_LINES = ["PDFに墨消しと", "手書き風の書き込みを。"]
SUB_LINE = "結合・分割・回転／メタデータ編集も"
SQUARE_LINES = ["墨消し", "手書き風"]
URL = "pdf-tools-agb.pages.dev"

BG = "#fafafa"
TEXT = "#0a0a0a"
MUTED = "#4d4d4d"
BORDER = "#e5e5e5"
BODY_BG = "#f2f2f2"
LINE = "#eceef1"
LINE_STRONG = "#d7dade"
INK_BLUE = "#1d3fa8"
INK_RED = "#d92d20"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD_PATH if bold else FONT_PATH, size, index=0)


def bar(d, x, y, w, h, color=LINE, radius=None):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius if radius is not None else h / 2, fill=color)


def hand_text(img, xy, text, size, color, seed=3):
    """1文字ずつ位置・角度・大きさを少しずらして、手書き風に描く（アプリ本体と同じ考え方）。"""
    rnd = random.Random(seed)
    f = ImageFont.truetype(HAND_FONT_PATH, size, index=0)
    x, y = xy
    for ch in text:
        adv = f.getlength(ch)
        tile = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((size * 0.5, size * 0.3), ch, font=f, fill=color)
        tile = tile.rotate(rnd.uniform(-9, 9), resample=Image.BICUBIC, center=(size, size))
        img.paste(tile, (int(x - size * 0.5), int(y + rnd.uniform(-4, 4) - size * 0.3)), tile)
        x += adv * rnd.uniform(0.95, 1.05)


def hand_ellipse(d, box, color, width=4, seed=7):
    """始点と終点をずらして少し重ねた、揺れのあるマル。"""
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    a0 = rnd.uniform(0, 6.28)
    p1, p2 = rnd.uniform(0, 6.28), rnd.uniform(0, 6.28)
    pts = []
    n = 90
    for i in range(n + 1):
        t = i / n
        a = a0 + t * 6.28318 * 1.07
        k = 1 + 0.035 * math.sin(2.1 * a + p1) + 0.02 * math.sin(5.3 * a + p2) + 0.03 * t
        pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
    d.line(pts, fill=color, width=width, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2], fill=color)


def draw_mock(img):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 664, 146, 1144, 486
    d.rounded_rectangle([x0, y0, x1, y1], radius=18, fill="#ffffff", outline=BORDER, width=1)
    d.rounded_rectangle([x0, y0, x1, y0 + 46], radius=18, fill="#f3f3f3")
    d.rectangle([x0, y0 + 28, x1, y0 + 46], fill="#f3f3f3")
    d.line([x0, y0 + 46, x1, y0 + 46], fill=BORDER, width=1)
    for i, c in enumerate(("#ff5f57", "#ffbd2e", "#28c840")):
        cx = x0 + 24 + i * 20
        d.ellipse([cx - 6, y0 + 17, cx + 6, y0 + 29], fill=c)
    d.rounded_rectangle([x0 + 92, y0 + 12, x1 - 24, y0 + 34], radius=11, fill="#ffffff", outline=BORDER, width=1)
    d.text((x0 + 106, y0 + 16), URL, font=font(13), fill="#71717a")

    d.rectangle([x0 + 1, y0 + 47, x1 - 1, y1 - 1], fill=BODY_BG)
    px0, py0, px1, py1 = x0 + 22, y0 + 66, x1 - 22, y1 - 22
    d.rounded_rectangle([px0, py0, px1, py1], radius=12, fill="#ffffff", outline=BORDER, width=1)

    left = px0 + 28
    doc_w = px1 - px0 - 56
    y = py0 + 26
    pitch = 27

    def line(w_ratio, color=LINE, height=10):
        nonlocal y
        bar(d, left, y, int(doc_w * w_ratio), height, color)
        y += pitch

    line(0.50, LINE_STRONG, 13)     # 見出し
    line(0.92)
    bar(d, left, y - 1, int(doc_w * 0.46), 13, "#111111", radius=3)      # 墨消しの帯
    bar(d, left + int(doc_w * 0.46) + 10, y + 1, int(doc_w * 0.34), 10)
    y += pitch
    line(0.80)
    bar(d, left + 40, y - 1, int(doc_w * 0.58), 13, "#111111", radius=3)  # 墨消しの帯
    y += pitch
    line(0.66)

    # 手書き風の書き込み：赤い手書きのマルと、青い手書き文字
    gx = left + int(doc_w * 0.46) + 10
    hand_ellipse(d, (gx - 20, py0 + 26 + pitch * 2 - 15, gx + int(doc_w * 0.34) + 20, py0 + 26 + pitch * 2 + 27), INK_RED, seed=11)
    hand_text(img, (left + 4, py1 - 62), "確認済み　要修正！", 30, INK_BLUE)


def make_large():
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    title_font = font(46, bold=True)
    tb = d.textbbox((0, 0), TITLE, font=title_font)
    desc_font, sub_font = font(26), font(16)
    line_h = 42
    total = (tb[3] - tb[1]) + 28 + line_h * len(DESC_LINES) + 26
    top = (h - total) / 2
    d.text((72, top - tb[1]), TITLE, font=title_font, fill=TEXT)
    ty = top + (tb[3] - tb[1]) + 28
    for t in DESC_LINES:
        d.text((72, ty), t, font=desc_font, fill=MUTED)
        ty += line_h
    d.text((72, ty + 8), SUB_LINE, font=sub_font, fill="#71717a")

    draw_mock(img)
    img.save(OUT_DIR / "og-image-large.png")


def make_square():
    size = 630
    pad_x = 34
    line1, line2 = SQUARE_LINES
    scratch = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    avail_w = size - 2 * pad_x
    font_size = 260
    while font_size > 10:
        f = font(font_size)
        b1 = scratch.textbbox((0, 0), line1, font=f)
        b2 = scratch.textbbox((0, 0), line2, font=f)
        if max(b1[2] - b1[0], b2[2] - b2[0]) <= avail_w:
            break
        font_size -= 2
    h1, h2 = b1[3] - b1[1], b2[3] - b2[1]
    gap = round(font_size * 0.35)
    top = (size - (h1 + h2 + gap)) / 2

    img = Image.new("RGB", (size, size), "#000000")
    d = ImageDraw.Draw(img)
    d.text(((size - (b1[2] - b1[0])) / 2 - b1[0], top - b1[1]), line1, font=f, fill="#ffffff")
    d.text(((size - (b2[2] - b2[0])) / 2 - b2[0], top + h1 + gap - b2[1]), line2, font=f, fill="#ffffff")
    img.save(OUT_DIR / "og-image-square.png")


if __name__ == "__main__":
    make_square()
    make_large()
    print("wrote", OUT_DIR / "og-image-square.png")
    print("wrote", OUT_DIR / "og-image-large.png")
