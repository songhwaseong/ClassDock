#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""헤더 브랜드 락업(마크 + ClassDock 워드마크) SVG 생성기.

워드마크는 Century Gothic Bold 의 9글자 외곽선을 패스로 뜬 것이다. 글꼴 파일은 배포하지
않고 이 글자들의 외곽선만 쓰므로, 글꼴이 깔리지 않은 환경에서도 같은 모양으로 나온다.

사용법
    python tools/build-brand-lockup.py                 # 결과만 보여주고 파일은 안 건드림
    python tools/build-brand-lockup.py --apply         # classdock.html + styles.css 에 반영
    python tools/build-brand-lockup.py --check         # 현재 소스가 최신인지 확인(다르면 종료코드 1)
    python tools/build-brand-lockup.py --out dist/     # 독립 SVG 파일들도 저장
    python tools/build-brand-lockup.py --mark 20       # 크기를 바꿔서 실험

--apply 뒤에는 오프라인 HTML 과 exe 를 다시 만들어야 실제 앱에 반영된다.
    node build-offline.js  &&  desktop\\build.bat

--------------------------------------------------------------------------------
실제로 밟았던 함정들 — 값을 고치기 전에 읽을 것
--------------------------------------------------------------------------------
1. 외곽선에는 힌팅(hinting)이 없다.
   진짜 글꼴은 "작은 크기에서 세로획을 픽셀 경계에 맞춰라"는 명령을 품고 있지만, 글자를
   패스로 뜨는 순간 그게 전부 사라진다. Century Gothic Bold 의 세로획은 대문자 높이의
   0.181 배라서, 락업 20px(대문자 12px)에서는 획이 2.17px 이 된다. 2px 에도 3px 에도
   맞지 않아 반드시 번지고, 글자마다 번지는 정도가 달라 "지저분해" 보인다.
   → MARK 를 26 으로 두어 획을 2.82px 로 키웠다. 줄이려면 그 대가를 각오할 것.

2. GAP 은 반드시 정수여야 한다.
   6.5 로 두었더니 워드마크 전체가 반 픽셀 밀린 자리에서 시작해, 아래 3번의 스냅이
   통째로 무의미해졌다.

3. 글자 시작 x 를 정수로 스냅한다(SNAP).
   viewBox 단위 = px 로 맞춰 두었기 때문에(=viewBox 높이와 CSS height 가 같다) 반올림이
   곧 픽셀 격자 정렬이 된다. 이걸 켜야 글자마다 획 굵기가 들쭉날쭉해 보이는 게 없어진다.
   CSS 에서 height 를 viewBox 높이와 다르게 주면 이 정렬이 전부 깨진다.

4. classdock.html 에 심을 때 width/height 정규식을 문서 전체에 돌리면 안 된다.
   루트 <svg> 의 width/height 만 지우려던 정규식이 <rect> 의 width/height 까지 지워서
   마크 안 흰 판이 통째로 사라진 적이 있다(크기 없는 rect 는 그려지지 않는다).
   아래 inline_svg() 는 루트 태그 안에서만 지우고, 흰 판이 살아 있는지 단정문으로 막는다.

5. 흰 판을 좁게 잡으면 작은 크기에서 '막대'로 보인다.
   원본 로고는 판이 넓어서 '종이 한 장'으로 읽힌다. PANEL 참고.
"""

import argparse
import io
import os
import re
import struct
import sys
from urllib.parse import quote

try:
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.misc.transform import Transform
except ImportError:
    sys.stderr.write("fontTools 가 필요합니다:  pip install fonttools\n")
    raise SystemExit(2)

# 콘솔이 cp949 여도 한글·기호 출력에서 죽지 않게 한다.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT  = r"C:\Windows\Fonts\GOTHICB.TTF"   # Century Gothic Bold
TEXT  = "ClassDock"
SPLIT = 5                 # "Class" | "Dock" — 두 색으로 나누는 지점
TRACK = -0.012            # em 자간 보정(기하학적 산세리프는 조금 좁혀야 로고처럼 보인다)
CAPR  = 0.60              # 대문자 높이 = 마크 높이의 60%
GAP   = 7.0               # 마크와 글자 사이(px) — 위 함정 2번, 정수일 것


def num(v):
    """SVG 좌표를 짧게. 0.50 -> 0.5, 3.00 -> 3"""
    return format(round(v, 2), "f").rstrip("0").rstrip(".") or "0"


# ---- 마크(D) 도형 — 24x24 좌표계 --------------------------------------------
# 아이콘(.ico)은 SVG 를 브라우저로 렌더하지 않고 Pillow 로 직접 그린다(파이썬에 SVG
# 래스터라이저가 없다). 두 곳에 같은 도형을 따로 적으면 반드시 어긋나므로, 아래 숫자만
# 진실로 두고 SVG 패스 문자열과 Pillow 렌더를 모두 여기서 파생시킨다.
M_L, M_T, M_B = 3.0, 3.0, 21.0    # 왼쪽 / 위 / 아래
M_SX = 12.0                       # 오른쪽 불룩한 호가 시작하는 x
M_R  = 2.0                        # 왼쪽 모서리 반지름
M_BULGE = (M_B - M_T) / 2.0       # 호 반지름 = 9

PANEL_X, PANEL_Y, PANEL_W, PANEL_H, PANEL_R = 7.2, 5.3, 8.2, 13.4, 2.0
PANEL_ALPHA = 0.88                # 원본의 반투명 흰 판 — 위 함정 5번

# 그라데이션(시안 -> 파랑 -> 인디고)
GRAD_STOPS = ((0.00, (0x22, 0xd3, 0xee)),
              (0.55, (0x3b, 0x82, 0xf6)),
              (1.00, (0x63, 0x66, 0xf1)))

MARK_D = ("M%s %sh%sa%s %s 0 0 1 0 %sH%sa%s %s 0 0 1-%s-%sV%sa%s %s 0 0 1 %s-%sz" % (
    num(M_L + M_R), num(M_T), num(M_SX - M_L - M_R),
    num(M_BULGE), num(M_BULGE), num(M_B - M_T),
    num(M_L + M_R), num(M_R), num(M_R), num(M_R), num(M_R),
    num(M_T + M_R), num(M_R), num(M_R), num(M_R), num(M_R)))

PANEL = ('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="#fff" opacity="%s"/>'
         % (num(PANEL_X), num(PANEL_Y), num(PANEL_W), num(PANEL_H), num(PANEL_R),
            ("%.2f" % PANEL_ALPHA).lstrip("0")))

GRAD = ('<linearGradient id="cdg{id}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
        'gradientUnits="userSpaceOnUse">'
        '<stop offset="0" stop-color="#22d3ee"/><stop offset=".55" stop-color="#3b82f6"/>'
        '<stop offset="1" stop-color="#6366f1"/></linearGradient>')

# 배경별 색 변형. 헤더(어두운 배경)에 쓰는 것은 "dark2".
VARIANTS = {
    "dark":  ("#ffffff", "#60a5fa", "ClassDock (어두운 배경용)"),
    "dark2": ("#ffffff", "#4f8ff7", "ClassDock (어두운 배경용 / 진한 파랑)"),
    "mono":  ("#ffffff", "#ffffff", "ClassDock (어두운 배경용 / 단색)"),
    "light": ("#0f172a", "#2563eb", "ClassDock (밝은 배경용)"),
}
HEADER_VARIANT = "dark2"

# .ico 에 담을 크기들. 작은 쪽은 작업표시줄·목록, 큰 쪽은 탐색기 큰 아이콘용.
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


class Lockup(object):
    def __init__(self, mark=26.0, snap=True, font_path=FONT):
        if not os.path.exists(font_path):
            raise SystemExit(
                "글꼴을 찾지 못했습니다: %s\n"
                "Century Gothic 은 Windows/Office 와 함께 깔리는 글꼴이라 다른 OS 에는 없습니다.\n"
                "이 스크립트는 로고를 '다시 뜰 때'만 필요합니다 — 이미 만들어진 락업은\n"
                "classdock.html 안에 패스로 들어 있어 글꼴 없이도 그대로 나옵니다." % font_path)

        self.mark = float(mark)
        self.snap = bool(snap)

        font = TTFont(font_path, fontNumber=0)
        self.upem = font["head"].unitsPerEm
        cmap = font.getBestCmap()
        gs = font.getGlyphSet()

        def ink(ch):
            bp = BoundsPen(gs)
            gs[cmap[ord(ch)]].draw(bp)
            return bp.bounds

        self.cap_units = ink("C")[3]
        lb = ink("l")
        self.stem_units = lb[2] - lb[0]          # 'l' 은 세로획 하나뿐이라 획 두께가 된다
        S = (self.mark * CAPR) / self.cap_units  # 폰트 단위 -> px

        segs = [[], []]
        x = 0.0
        ink_top, ink_bot = 0.0, 0.0
        for i, ch in enumerate(TEXT):
            g = cmap[ord(ch)]
            b = BoundsPen(gs)
            gs[g].draw(b)
            if b.bounds:
                ink_top = max(ink_top, b.bounds[3])
                ink_bot = min(ink_bot, b.bounds[1])
            ox = round(x * S) if self.snap else x * S     # 함정 3번
            pen = SVGPathPen(gs, ntos=num)
            # y 뒤집기(SVG 는 y-down). 베이스라인 y=0.
            gs[g].draw(TransformPen(pen, Transform(S, 0, 0, -S, ox, 0)))
            d = pen.getCommands()
            if d:
                segs[0 if i < SPLIT else 1].append(d)
            x += gs[g].width + TRACK * self.upem

        raw_w = (x - TRACK * self.upem) * S
        self.word_w = round(raw_w) if self.snap else raw_w
        self.cap_px = self.mark * CAPR
        self.stem_px = self.cap_px * self.stem_units / self.cap_units
        self.paths = (" ".join(segs[0]), " ".join(segs[1]))

        # 세로 정렬: 마크 중심을 대문자 블록(베이스라인~cap)의 중심에 맞춘다.
        cap_mid = -self.cap_px / 2
        self.mark_top = cap_mid - self.mark / 2
        self.top = min(self.mark_top, -ink_top * S)
        self.bottom = max(cap_mid + self.mark / 2, -ink_bot * S)
        self.word_x = self.mark + GAP
        self.width = self.word_x + self.word_w
        self.height = self.bottom - self.top
        self.view_box = "%s %s %s %s" % (num(0), num(self.top), num(self.width), num(self.height))

    def _mark(self, idsuf):
        ms = self.mark / 24.0
        return ('<g transform="translate(0 %s) scale(%s)"><path d="%s" fill="url(#cdg%s)"/>%s</g>'
                % (num(self.mark_top), num(ms), MARK_D, idsuf, PANEL))

    def _grad(self, idsuf):
        ms = self.mark / 24.0
        return GRAD.format(id=idsuf, x1=num(1.5 * ms), y1=num(self.mark_top + 2.5 * ms),
                           x2=num(18 * ms), y2=num(self.mark_top + 21 * ms))

    def svg(self, variant=HEADER_VARIANT, standalone=True):
        c1, c2, title = VARIANTS[variant]
        head = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" width="%s" height="%s" '
                'role="img" aria-label="ClassDock">\n<title>%s</title>\n'
                % (self.view_box, num(self.width), num(self.height), title))
        body = ('<defs>%s</defs>\n%s\n<g transform="translate(%s 0)">\n'
                '<path fill="%s" d="%s"/>\n<path fill="%s" d="%s"/>\n</g>\n</svg>\n'
                % (self._grad(variant), self._mark(variant), num(self.word_x),
                   c1, self.paths[0], c2, self.paths[1]))
        return head + body if standalone else head + body

    def mark_svg(self, variant=HEADER_VARIANT):
        return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" '
                'role="img" aria-label="ClassDock">\n'
                '<defs>%s</defs>\n<path d="%s" fill="url(#cdg%s)"/>\n%s\n</svg>\n'
                % (GRAD.format(id=variant, x1="3", y1="3", x2="21", y2="21"), MARK_D, variant, PANEL))


# ---- 아이콘(.ico) ------------------------------------------------------------
# Pillow 로 마크를 직접 그린다. 위쪽 M_* / PANEL_* / GRAD_STOPS 에서만 치수를 읽으므로
# SVG 와 어긋날 일이 없다. 크기마다 4배로 크게 그린 뒤 줄여서 가장자리를 매끈하게 만든다.

def _grad_color(t):
    """0~1 위치의 그라데이션 색."""
    t = min(1.0, max(0.0, t))
    for i in range(len(GRAD_STOPS) - 1):
        p0, c0 = GRAD_STOPS[i]
        p1, c1 = GRAD_STOPS[i + 1]
        if t <= p1:
            f = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return tuple(int(round(c0[k] + (c1[k] - c0[k]) * f)) for k in range(3))
    return GRAD_STOPS[-1][1]


def render_mark(size, ss=4):
    """마크를 size x size RGBA 로 그린다(배경 투명)."""
    from PIL import Image, ImageDraw

    n = size * ss
    k = n / 24.0                       # 24 단위 좌표계 -> 픽셀
    def S(v):
        return v * k

    # 1) D 실루엣 마스크 = 왼쪽 둥근 사각형 + 오른쪽 원(불룩한 호)의 합집합
    mask = Image.new("L", (n, n), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([S(M_L), S(M_T), S(M_SX), S(M_B)], radius=S(M_R), fill=255)
    md.ellipse([S(M_SX - M_BULGE), S(M_T), S(M_SX + M_BULGE), S(M_B)], fill=255)

    # 2) 그라데이션 — SVG 와 같은 (3,3) -> (21,21) 대각선
    grad = Image.new("RGB", (n, n))
    gp = grad.load()
    x0, y0, x1, y1 = S(3), S(3), S(21), S(21)
    dx, dy = x1 - x0, y1 - y0
    den = float(dx * dx + dy * dy)
    for y in range(n):
        for x in range(n):
            gp[x, y] = _grad_color(((x - x0) * dx + (y - y0) * dy) / den)

    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    # 3) 반투명 흰 판 — D 밖으로 새지 않게 마스크로 한 번 더 자른다
    panel = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle(
        [S(PANEL_X), S(PANEL_Y), S(PANEL_X + PANEL_W), S(PANEL_Y + PANEL_H)],
        radius=S(PANEL_R), fill=(255, 255, 255, int(round(255 * PANEL_ALPHA))))
    panel.putalpha(Image.composite(panel.getchannel("A"),
                                   Image.new("L", (n, n), 0), mask))
    img = Image.alpha_composite(img, panel)

    return img.resize((size, size), Image.LANCZOS)


def _dib(img):
    """ICO 안에 들어갈 DIB(BITMAPINFOHEADER + BGRA + AND 마스크)."""
    w, h = img.size
    px = img.load()
    rows = []
    for y in range(h - 1, -1, -1):          # bottom-up
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    pixels = b"".join(rows)
    mask = b"\x00" * ((((w + 31) // 32) * 4) * h)   # 알파를 쓰므로 AND 마스크는 0
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0,
                         len(pixels) + len(mask), 0, 0, 0, 0)
    return header + pixels + mask


def build_ico(out_path, sizes=ICO_SIZES):
    """크기별로 따로 렌더한 마크를 하나의 .ico 로 묶는다.

    Pillow 의 ICO 저장은 원본 한 장을 리사이즈해 담을 뿐이라 쓰지 않는다.
    작은 크기는 BMP(DIB), 128 이상은 PNG 로 담는다 — PNG 엔트리는 Vista 이상만 읽는다.
    """
    import io as _io

    entries = []
    for s in sizes:
        img = render_mark(s)
        if s >= 128:
            buf = _io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            data = buf.getvalue()
        else:
            data = _dib(img)
        entries.append((s, data))

    offset = 6 + 16 * len(entries)
    head = struct.pack("<HHH", 0, 1, len(entries))
    blob = b""
    for s, data in entries:
        dim = 0 if s >= 256 else s                  # 256 은 0 으로 적는 규칙
        head += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blob += data
        offset += len(data)

    with open(out_path, "wb") as f:
        f.write(head + blob)
    return len(head) + len(blob)


def favicon_link(lock):
    """마크를 data URI 로 담은 favicon 태그.

    외부 파일로 두면 단일 HTML(exe)에서 깨지므로 인라인한다.
    """
    svg = lock.mark_svg().replace("\n", "").replace('"', "'")
    # '#' 은 반드시 %23 으로 — 그대로 두면 색상값 #22d3ee 부터가 URI 프래그먼트로 잘려
    # 아이콘이 통째로 깨진다. '<' '>' 도 속성 안이라 인코딩해 두는 편이 안전하다.
    quoted = quote(svg, safe="/:=;{}()., '-+*")
    return '<link rel="icon" href="data:image/svg+xml,%s">' % quoted


def inline_svg(svg):
    """독립 SVG 를 classdock.html 에 심을 형태로 바꾼다.

    루트 <svg> 태그 안에서만 width/height 를 지운다 — 문서 전체에 정규식을 돌리면
    <rect> 의 width/height 까지 지워져 마크 안 흰 판이 사라진다(함정 4번).
    """
    svg = re.sub(r"<title>.*?</title>\s*", "", svg, flags=re.S)

    m = re.match(r"<svg\b[^>]*>", svg)
    if not m:
        raise SystemExit("루트 svg 태그를 찾지 못했습니다.")
    root = m.group(0)
    root = root.replace('<svg xmlns="http://www.w3.org/2000/svg" ', '<svg class="brand-lockup" ')
    root = re.sub(r'\s+width="[^"]*"', "", root)
    root = re.sub(r'\s+height="[^"]*"', "", root)
    out = (root + svg[m.end():]).replace("\n", "")

    # 함정 4번을 두 번 다시 겪지 않도록 여기서 막는다.
    if 'class="brand-lockup"' not in out:
        raise SystemExit("brand-lockup 클래스가 붙지 않았습니다.")
    if out.count("<rect") != 1 or 'width="8.2"' not in out or 'height="13.4"' not in out:
        raise SystemExit("마크 안 흰 판의 width/height 가 사라졌습니다. inline_svg() 의 정규식을 확인하세요.")
    return out


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    # 이 저장소의 작업 트리는 LF 다. newline="" 없이 쓰면 파일 전체가 CRLF 로 바뀐다.
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def patch_sources(lock, apply_changes):
    """classdock.html 의 인라인 SVG 와 styles.css 의 높이를 갱신한다.

    apply_changes 가 False 면 쓰지 않고 달라진 곳만 알려준다(--check).
    """
    html_path = os.path.join(ROOT, "classdock.html")
    css_path = os.path.join(ROOT, "src", "styles.css")
    svg = inline_svg(lock.svg(HEADER_VARIANT))
    changed = []

    # --- classdock.html : 헤더 락업 + favicon. 다 바꾼 뒤 한 번만 쓴다. ---
    html = read(html_path)
    out = html

    out, n = re.subn(r'<div class="brand">.*?</div>',
                     lambda _: '<div class="brand">' + svg + "</div>",
                     out, flags=re.S)
    if n != 1:
        raise SystemExit('classdock.html 에서 <div class="brand"> 를 %d 개 찾았습니다(1개여야 합니다).' % n)

    # favicon — 앱 모드 창·브라우저 탭 아이콘. 외부 파일은 단일 HTML(exe)에서 깨지므로
    # data URI 로 <head> 안에 인라인한다.
    link = favicon_link(lock)
    # href 값 전체를 따옴표 기준으로 잡는다. [^>]* 로 잡으면 data URI 안에 '>' 가 있는
    # (예전 버그로 만들어진) 태그에서 앞부분만 잘라내고 나머지 SVG 를 문서에 흘린다.
    # 그렇게 흘린 <defs> 의 그라데이션 id 가 헤더 락업과 충돌해 앱이 통째로 깨진 적이 있다.
    icon_re = r'<link\s+rel="icon"\s+href="[^"]*"\s*/?>'
    if re.search(icon_re, out):
        out = re.sub(icon_re, lambda _: link, out, count=1)
    else:
        out, n2 = re.subn(r"(<title>[^<]*</title>)", lambda m: m.group(1) + "\n" + link,
                          out, count=1)
        if n2 != 1:
            raise SystemExit("classdock.html 의 <title> 을 찾지 못해 favicon 을 넣지 못했습니다.")

    # head 안에 SVG 조각이 흘렀는지 확인한다 — 위 사고의 재발 방지.
    head = out[out.find("<head"):out.find("</head>")]
    if out.count('<link rel="icon"') != 1:
        raise SystemExit("favicon 태그가 %d 개가 되었습니다(1개여야 합니다)." % out.count('<link rel="icon"'))
    for stray in ("<defs", "<path", "<rect", "<svg", "</svg>"):
        if stray in head:
            raise SystemExit(
                "head 안에 '%s' 가 흘렀습니다. favicon data URI 의 인코딩이 깨졌습니다.\n"
                "classdock.html 을 git 에서 되돌린 뒤 다시 실행하세요." % stray)

    if out != html:
        changed.append("classdock.html")
        if apply_changes:
            write(html_path, out)

    css = read(css_path)
    want = "height:%spx" % num(lock.height)
    new_css, n = re.subn(r"(\.brand-lockup\{height:)[0-9.]+px", r"\g<1>%spx" % num(lock.height), css)
    if n != 1:
        raise SystemExit("src/styles.css 에서 .brand-lockup 높이 규칙을 %d 개 찾았습니다(1개여야 합니다)." % n)
    if new_css != css:
        changed.append("src/styles.css (%s)" % want)
        if apply_changes:
            write(css_path, new_css)

    return changed


def main():
    ap = argparse.ArgumentParser(description="ClassDock 브랜드 락업 SVG 생성기")
    ap.add_argument("--apply", action="store_true", help="classdock.html 과 styles.css 에 반영")
    ap.add_argument("--check", action="store_true", help="소스가 최신인지 확인(다르면 종료코드 1)")
    ap.add_argument("--out", metavar="DIR", help="독립 SVG 파일들을 이 폴더에 저장")
    ap.add_argument("--ico", nargs="?", const=os.path.join(ROOT, "desktop", "classdock.ico"),
                    metavar="PATH", help="exe 아이콘(.ico) 생성. 기본 desktop/classdock.ico")
    ap.add_argument("--mark", type=float, default=26.0, help="마크 높이(px), 기본 26")
    ap.add_argument("--no-snap", action="store_true", help="픽셀 격자 스냅 끄기(비교용)")
    ap.add_argument("--font", default=FONT, help="글꼴 경로")
    args = ap.parse_args()

    lock = Lockup(mark=args.mark, snap=not args.no_snap, font_path=args.font)

    print("락업 크기   : %s x %s px   (CSS 는 height:%spx)"
          % (num(lock.width), num(lock.height), num(lock.height)))
    print("마크 %spx / 대문자 %spx / 간격 %spx / 글자폭 %spx"
          % (num(lock.mark), num(lock.cap_px), num(GAP), num(lock.word_w)))
    print("세로획      : %.2f px  %s"
          % (lock.stem_px, "(2.5px 미만이면 작은 크기에서 번져 보인다)" if lock.stem_px < 2.5 else ""))
    print("픽셀 스냅   : %s" % ("켜짐" if lock.snap else "꺼짐  <- 글자마다 획 굵기가 달라 보인다"))

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        for name in VARIANTS:
            p = os.path.join(args.out, "classdock-lockup-%s.svg" % name)
            write(p, lock.svg(name))
            print("  저장: %s" % p)
        p = os.path.join(args.out, "classdock-mark.svg")
        write(p, lock.mark_svg())
        print("  저장: %s" % p)

    if args.ico:
        size = build_ico(args.ico)
        print("\n아이콘 생성: %s" % args.ico)
        print("  %d bytes / 크기 %s" % (size, ", ".join(str(s) for s in ICO_SIZES)))
        print("  desktop/build.bat 의 csc 호출에 /win32icon: 이 있어야 exe 에 박힙니다.")

    if args.check:
        changed = patch_sources(lock, apply_changes=False)
        if changed:
            print("\n소스가 최신이 아닙니다: %s" % ", ".join(changed))
            print("  python tools/build-brand-lockup.py --apply")
            return 1
        print("\n소스 최신 상태입니다.")
        return 0

    if args.apply:
        changed = patch_sources(lock, apply_changes=True)
        if changed:
            print("\n반영: %s" % ", ".join(changed))
        else:
            print("\n바뀐 내용이 없습니다.")
        print("이제 다시 빌드하세요:  node build-offline.js  &&  desktop\\build.bat")
    else:
        print("\n(파일은 건드리지 않았습니다. 반영하려면 --apply)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
