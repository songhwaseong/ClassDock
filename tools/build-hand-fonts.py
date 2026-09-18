"""일기장 손글씨 글꼴(나눔손글씨 펜·붓)을 vendor/*.js 로 만든다.

오프라인 앱이라 웹 글꼴을 받을 수 없어 글꼴을 앱에 담는다. 한 벌에 약 0.8MB 라 시작할 때 읽지 않고,
일기장에서 그 글꼴을 고를 때만 MNLazy 로 읽는다(lazy.js 의 handPen·handBrush 묶음).

  - 원본: github.com/google/fonts (ofl/nanumpenscript, ofl/nanumbrushscript) — SIL Open Font License 1.1
    라이선스 전문은 vendor/licenses/nanum-handwriting-OFL.txt. 글꼴 이름(Reserved Font Name)은 바꾸지 않는다.
  - TTF(약 3MB) → WOFF2(약 0.6MB) 로 형식만 바꾼다(글자 모양·이름은 그대로). 한글 11,172자 전부 들어 있다.
  - 결과: vendor/hand-font-pen.js, vendor/hand-font-brush.js
      globalThis.__MN_HANDFONT = globalThis.__MN_HANDFONT || {};
      globalThis.__MN_HANDFONT.pen = "<woff2 base64>";

준비: pip install fonttools brotli
실행: python tools/build-hand-fonts.py
만든 뒤 scripts.manifest.json 의 sha384 를 새 값으로 바꿔야 한다(이 도구가 마지막에 출력한다).
"""
import base64
import hashlib
import io
import os
import sys
import urllib.request

from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = [
    ("pen", "nanumpenscript/NanumPenScript-Regular.ttf", "hand-font-pen.js", "나눔손글씨 펜(Nanum Pen Script)"),
    ("brush", "nanumbrushscript/NanumBrushScript-Regular.ttf", "hand-font-brush.js", "나눔손글씨 붓(Nanum Brush Script)"),
]
BASE = "https://github.com/google/fonts/raw/main/ofl/"


def woff2_from_ttf(data):
    font = TTFont(io.BytesIO(data))
    hangul = sum(1 for c in font.getBestCmap() if 0xAC00 <= c <= 0xD7A3)
    if hangul < 11172:
        raise SystemExit("한글 글자가 모자란다: %d" % hangul)
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def main():
    for key, path, name, label in FONTS:
        src = sys.argv[1] if len(sys.argv) > 1 else None
        local = os.path.join(src, os.path.basename(path)) if src else None
        data = open(local, "rb").read() if local and os.path.exists(local) else urllib.request.urlopen(BASE + path).read()
        woff2 = woff2_from_ttf(data)
        text = ("// 자동 생성 파일 — 수정 금지. %s WOFF2 를 base64 로 담음. SIL OFL 1.1 (vendor/licenses/nanum-handwriting-OFL.txt).\n"
                "// 일기장(diary.js)에서 손글씨 글꼴을 고를 때만 MNLazy 로 읽는다. 만든 도구: tools/build-hand-fonts.py\n"
                "globalThis.__MN_HANDFONT = globalThis.__MN_HANDFONT || {};\n"
                "globalThis.__MN_HANDFONT.%s = \"%s\";\n") % (label, key, base64.b64encode(woff2).decode("ascii"))
        target = os.path.join(ROOT, "vendor", name)
        with open(target, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        digest = base64.b64encode(hashlib.sha384(text.encode("utf-8")).digest()).decode("ascii")
        print("%s  %d bytes  sha384-%s" % (name, len(text.encode("utf-8")), digest))


if __name__ == "__main__":
    main()
