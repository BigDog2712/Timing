#!/usr/bin/env python3
"""Timing 图标生成器 —— 矢量式绘制 + 4x 超采样，产出 master / tray / 预览对比图。

设计语言（与 src/styles/tokens/*.css 同源）：
  · 底板      —— 超椭圆（同 --ring-radius 的超椭圆口径），深色主题底 #1B1F27 → #0A0B0E
  · 主体      —— 开口圆环 = 小条左侧的计时环 --ring-size，开口朝上
  · 环形渐变  —— --accent-ink #98CDF6 → --accent 深端 #3885C9
  · 刻度点    —— --warn #E8A33D，落在环的开口里当 12 点刻度（旧图标的高亮色）
  · 发丝描边  —— 白 10%（= --line-2），纯平面、不投影（V0.2.10 去除整体阴影）

用法：
  python scripts/gen-icon.py --lab        # 候选对比图 → .workbuddy/icon-lab/
  python scripts/gen-icon.py --lab2       # 第二轮候选
  python scripts/gen-icon.py              # 正式 master + tray → .workbuddy/icon-lab/out/
"""
from __future__ import annotations

import io
import math
import struct
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / ".workbuddy" / "icon-lab"
SS = 4  # 超采样倍数

TILE_TOP = (27, 31, 39)
TILE_BOT = (10, 11, 14)
GLOW = (44, 52, 68)
ARC_TOP = (152, 205, 246)
ARC_BOT = (56, 133, 201)
WHITE_ARC = (238, 243, 250)
TRAY_TOP = (90, 168, 224)    # #5AA8E0
TRAY_BOT = (44, 122, 184)    # #2C7AB8（压深一档：浅色任务栏上仍有 3:1 以上轮廓对比）
HAIRLINE = (255, 255, 255, 30)
TICK = (232, 163, 61)


# --------------------------------------------------------------------------- #
# 基础图元
# --------------------------------------------------------------------------- #
def _squircle(cx, cy, a, b, n=3.0, steps=1440, inset=0.0):
    pts = []
    for i in range(steps):
        t = 2.0 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = cx + (a - inset) * math.copysign(abs(c) ** (2.0 / n), c)
        y = cy + (b - inset) * math.copysign(abs(s) ** (2.0 / n), s)
        pts.append((x, y))
    return pts


def _vgrad(size, top, bot):
    strip = Image.new("RGB", (1, size))
    px = strip.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    return strip.resize((size, size), Image.BILINEAR)


def _glow_alpha(size, cx=0.34, cy=0.16, radius=0.80):
    n = 224
    small = Image.new("L", (n, n))
    px = small.load()
    for y in range(n):
        for x in range(n):
            d = math.hypot(x / n - cx, y / n - cy) / radius
            px[x, y] = 0 if d >= 1.0 else int((1.0 - d) ** 2.4 * 255)
    return small.resize((size, size), Image.BICUBIC)


def _disc(size, cx, cy, r, color, alpha=255):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=alpha)
    layer.paste(Image.new("RGB", (size, size), color), (0, 0), m)
    layer.putalpha(m)
    return layer


def _capsule(size, cx, cy, w, h, color):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], h / 2, fill=255)
    layer.paste(Image.new("RGB", (size, size), color), (0, 0), m)
    layer.putalpha(m)
    return layer


# --------------------------------------------------------------------------- #
# 组成部件
# --------------------------------------------------------------------------- #
def _tile(size, n=3.0):
    pos = _squircle(size / 2, size / 2, size / 2, size / 2, n, inset=size * 0.002)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(pos, fill=255)

    plate = _vgrad(size, TILE_TOP, TILE_BOT)
    glow = Image.new("RGB", (size, size), GLOW)
    plate = Image.composite(glow, plate, _glow_alpha(size).point(lambda v: int(v * 0.5)))

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(plate, (0, 0), mask)

    lw = max(2, round(size * 0.0055))
    edge = Image.new("L", (size, size), 0)
    ImageDraw.Draw(edge).polygon(
        _squircle(size / 2, size / 2, size / 2, size / 2, n, inset=size * 0.002 + lw / 2),
        outline=255, width=lw,
    )
    out.paste(Image.new("RGBA", (size, size), HAIRLINE), (0, 0), ImageChops.multiply(edge, mask))
    return out


def _ring_mask(size, r_out, stroke, sweep, gap_center=270.0):
    cx = cy = size / 2
    r_in = r_out - stroke
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=255)
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=0)

    sector = Image.new("L", (size, size), 0)
    a0 = gap_center + (360.0 - sweep) / 2.0
    a1 = a0 + sweep
    ImageDraw.Draw(sector).pieslice(
        [cx - r_out - 1, cy - r_out - 1, cx + r_out + 1, cy + r_out + 1], a0, a1, fill=255
    )
    m = ImageChops.multiply(m, sector)

    r_mid = (r_out + r_in) / 2.0
    cc = ImageDraw.Draw(m)
    for ang in (a0, a1):
        x, y = cx + r_mid * math.cos(math.radians(ang)), cy + r_mid * math.sin(math.radians(ang))
        cc.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=255)
    return m


def _annulus(size, r_out, stroke):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r_in = r_out - stroke
    d.ellipse([size / 2 - r_out, size / 2 - r_out, size / 2 + r_out, size / 2 + r_out], fill=255)
    d.ellipse([size / 2 - r_in, size / 2 - r_in, size / 2 + r_in, size / 2 + r_in], fill=0)
    return m


def _arc(size, r_out, stroke, sweep, top=ARC_TOP, bot=ARC_BOT, track=None):
    mask = _ring_mask(size, r_out, stroke, sweep)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    alpha = mask
    if track is not None:
        ta = _annulus(size, r_out, stroke).point(lambda v: v * track[1] // 255)
        out.paste(Image.new("RGBA", (size, size), (*track[0], 255)), (0, 0), ta)
        alpha = ImageChops.lighter(mask, ta)
    out.paste(_vgrad(size, top, bot), (0, 0), mask)
    out.putalpha(alpha)
    return out


# --------------------------------------------------------------------------- #
# 比例分级：小尺寸要更粗的环、更小的开口，且去掉 1px 级的刻度点
# --------------------------------------------------------------------------- #
GRADES = (
    # size 上限, ring, stroke, sweep, bezel, track
    (32, 0.360, 0.140, 310, None, None),
    (48, 0.330, 0.108, 300, 0.30, None),
    (1 << 20, 0.322, 0.098, 300, 0.32, ((58, 66, 84), 90)),
)


def grade(size):
    for lim, ring, sw, sweep, bezel, track in GRADES:
        if size < lim:
            return ring, sw, sweep, bezel, track
    raise AssertionError


def make(size):
    """应用图标：超椭圆底板 + 开口环 + 12 点刻度。"""
    s = size * SS
    ring, sw, sweep, bezel, track = grade(size)
    img = _tile(s, 4.0)
    r_out, stroke = s * ring, s * sw
    img.alpha_composite(_arc(s, r_out, stroke, sweep, ARC_TOP, ARC_BOT, track))
    if bezel:
        img.alpha_composite(_disc(s, s / 2, s / 2 - (r_out - stroke / 2), stroke * bezel, TICK))
    return img.resize((size, size), Image.LANCZOS)


def tray_icon(size):
    """托盘图标：无底板，只留环（开口即身份，刻度点在 16px 会糊成一个脏点）。"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.alpha_composite(_arc(s, s * 0.445, s * 0.158, 316, TRAY_TOP, TRAY_BOT))
    return img.resize((size, size), Image.LANCZOS)


# --------------------------------------------------------------------------- #
# ICO 容器（自己写，才能逐尺寸给不同比例；256 用 PNG，其余用 32bpp BMP）
# --------------------------------------------------------------------------- #
def _ico_entry(im):
    if im.size[0] >= 256:
        buf = io.BytesIO()
        im.save(buf, "PNG")
        return buf.getvalue()
    w, h = im.size
    head = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, w * h * 4, 0, 0, 0, 0)
    body = b"".join(im.crop((0, y, w, y + 1)).tobytes("raw", "BGRA") for y in range(h - 1, -1, -1))
    return head + body + b"\x00" * (((w + 31) // 32) * 4 * h)


def write_ico(path, images):
    blobs = [_ico_entry(im) for im in images]
    offset, dirs = 6 + 16 * len(images), []
    for im, blob in zip(images, blobs):
        w, h = im.size
        dirs.append(struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset))
        offset += len(blob)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + b"".join(dirs) + b"".join(blobs))


# --------------------------------------------------------------------------- #
# 预览 / 产出
# --------------------------------------------------------------------------- #
def compare(path, variants):
    sizes = [256, 128, 48, 32, 24, 16]
    pad, gap, cell_h = 24, 18, 296
    w = sum(sizes) + gap * (len(sizes) - 1) + pad * 2
    sheet = Image.new("RGB", (w, cell_h * 2 * max(1, len(variants)) + 24), (16, 16, 18))
    d = ImageDraw.Draw(sheet)
    y = 12
    for bg in ((32, 32, 34), (243, 243, 245)):
        d.rectangle([0, y, w, y + cell_h], fill=bg)
        x = pad
        for sz in sizes:
            ic = make(sz)
            sheet.paste(ic, (x, y + (cell_h - sz) // 2), ic)
            x += sz + gap
        d.text((pad, y + 8), f"app icon  {'dark' if bg[0] < 128 else 'light'}",
               fill=(225, 225, 225) if bg[0] < 128 else (40, 40, 40))
        y += cell_h
    sheet.save(path)


def compare_tray(path):
    sizes = [32, 24, 16]
    pad, gap, cell_h = 20, 18, 100
    w = pad + len(sizes) * (48 + gap) + 210
    sheet = Image.new("RGB", (w, cell_h * 2 + 12), (16, 16, 18))
    d = ImageDraw.Draw(sheet)
    y = 6
    for bg in ((32, 32, 34), (243, 243, 245)):
        d.rectangle([0, y, w, y + cell_h], fill=bg)
        x = pad
        for sz in sizes:
            ic = tray_icon(sz)
            sheet.paste(ic, (x, y + (cell_h - sz) // 2), ic)
            x += 48 + gap
        zx = x + 6
        for sz in (16, 24):
            z = tray_icon(sz).resize((sz * 4, sz * 4), Image.NEAREST)
            sheet.paste(z, (zx, y + (cell_h - sz * 4) // 2), z)
            zx += sz * 4 + 10
        d.text((pad, y + 6), f"tray {'dark' if bg[0] < 128 else 'light'}",
               fill=(225, 225, 225) if bg[0] < 128 else (40, 40, 40))
        y += cell_h
    sheet.save(path)


def main():
    LAB.mkdir(parents=True, exist_ok=True)
    if "--lab" in sys.argv:
        compare(LAB / "compare.png", ("j",))
        compare_tray(LAB / "tray-compare.png")
        return

    icons = ROOT / "src-tauri" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    for name, size in (("32x32.png", 32), ("128x128.png", 128),
                       ("128x128@2x.png", 256), ("icon.png", 512)):
        make(size).save(icons / name)
    write_ico(icons / "icon.ico", [make(s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)])
    tray_icon(32).save(icons / "tray.png")
    print("icons ->", icons)


if __name__ == "__main__":
    main()

