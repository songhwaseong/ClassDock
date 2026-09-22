"""일기장 손글씨 글꼴을 vendor/*.js 로 만든다.

오프라인 앱이라 웹 글꼴을 받을 수 없어 글꼴을 앱에 담는다. 한 벌에 약 0.7MB 라 시작할 때 읽지 않고,
일기장에서 그 글꼴을 고를 때만 MNLazy 로 읽는다(lazy.js 의 hand* 묶음).

  - 펜·붓: github.com/google/fonts (ofl/nanumpenscript, ofl/nanumbrushscript) — SIL OFL 1.1.
    TTF(약 3MB) → WOFF2(약 0.6MB) 로 형식만 바꾼다(글자 모양·이름은 그대로). 한글 11,172자 전부 들어 있다.
    라이선스 전문은 vendor/licenses/nanum-handwriting-OFL.txt.
  - 나머지: 네이버 나눔손글씨 모음(CLOVA 손글씨, 2019, SIL OFL 1.1 — clova.ai/handwriting).
    붓으로 따라 그린 윤곽이라 점이 많아 11,172자를 다 담으면 WOFF2 가 한 벌에 2.6MB 다(앱 HTML 에 그대로 들어간다).
    그래서 자주 쓰는 한글 2,350자(KS X 1001)와 한글 아닌 글자만 남긴다(약 0.5MB). 빠진 글자(예: 봬·똠)는
    diary.js 가 펜 글꼴로 이어 그린다(글꼴 목록 뒤에 펜을 둔다).
    글자를 줄이면 OFL 의 '고친 글꼴'이 되어 예약 이름(Nanum)을 쓸 수 없으므로 글꼴 안 이름을
    "ClassDock Hand ..." 로 바꾼다. 저작권 줄은 그대로 두고, 설명(name 10)에 원본과 고친 내용을 적는다.
    라이선스 전문은 vendor/licenses/nanum-clova-handwriting-OFL.txt.
  - 칩 견본: 꾸미기 창의 글꼴 칩은 "가나다" 세 글자만 쓴다. 창을 열 때 모든 손글씨를 읽지 않도록
    세 글자만 남긴 아주 작은 글꼴들을 hand-font-samples.js 한 파일에 담는다(이것도 고친 글꼴이라 이름을 바꾼다).

  결과(형식):
      globalThis.__MN_HANDFONT = globalThis.__MN_HANDFONT || {};
      globalThis.__MN_HANDFONT.pen = "<woff2 base64>";
      globalThis.__MN_HANDFONT_SAMPLE = { pen:"<woff2 base64>", ... };

준비: pip install fonttools brotli
실행: python tools/build-hand-fonts.py [원본 TTF 가 든 폴더]
만든 뒤 scripts.manifest.json 의 sha384 를 새 값으로 바꿔야 한다(이 도구가 마지막에 출력한다).
"""
import base64
import hashlib
import io
import os
import sys
import urllib.parse
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOOGLE = "https://github.com/google/fonts/raw/main/ofl/"
CLOVA = "https://ssl.pstatic.net/static/clova/service/clova_ai/event/handwriting/download/"
SAMPLE_TEXT = "가나다"
# (키, 받을 곳, 원본 파일 이름, 결과 파일, 설명, 2,350자로 줄일지)
FONTS = [
    ("pen", GOOGLE + "nanumpenscript/", "NanumPenScript-Regular.ttf", "hand-font-pen.js", "나눔손글씨 펜(Nanum Pen Script)", False),
    ("brush", GOOGLE + "nanumbrushscript/", "NanumBrushScript-Regular.ttf", "hand-font-brush.js", "나눔손글씨 붓(Nanum Brush Script)", False),
    ("hippie", CLOVA, "나눔손글씨 바른히피.ttf", "hand-font-hippie.js", "나눔손글씨 바른히피(Nanum BaReunHiPi)", True),
    ("dahaeng", CLOVA, "나눔손글씨 다행체.ttf", "hand-font-dahaeng.js", "나눔손글씨 다행체(Nanum DaHaengCe)", True),
    ("student", CLOVA, "나눔손글씨 중학생.ttf", "hand-font-student.js", "나눔손글씨 중학생(Nanum JungHagSaeng)", True),
    ("amsterdam", CLOVA, "나눔손글씨 암스테르담.ttf", "hand-font-amsterdam.js", "나눔손글씨 암스테르담(Nanum AmSeuTeReuDam)", True),
    ("mago", CLOVA, "나눔손글씨 마고체.ttf", "hand-font-mago.js", "나눔손글씨 마고체(Nanum MaGoCe)", True),
]
KSX1001 = {c for c in range(0xAC00, 0xD7A4) if len(chr(c).encode("euc_kr", "ignore")) == 2}


def fetch(base, name, src_dir):
    local = os.path.join(src_dir, name) if src_dir else None
    if local and os.path.exists(local):
        return open(local, "rb").read()
    parts = urllib.parse.urlsplit(base + name)
    return urllib.request.urlopen(urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path)))).read()


def rename(font, key, original):
    """고친 글꼴 — 예약 이름(Nanum)을 빼고 ClassDock 이름을 붙인다. 저작권 줄(name 0)은 그대로 둔다."""
    family = "ClassDock Hand " + key.capitalize()
    table = font["name"]
    for rec in list(table.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17, 18, 21, 22):
            table.removeNames(nameID=rec.nameID)
    note = "Modified by ClassDock from %s: glyph subset only (outlines unchanged). SIL Open Font License 1.1." % original
    for nid, value in ((1, family), (2, "Regular"), (3, family + " Regular"), (4, family), (6, family.replace(" ", "")), (10, note),
                       (13, "This Font Software is licensed under the SIL Open Font License, Version 1.1."), (14, "https://openfontlicense.org")):
        table.setName(value, nid, 3, 1, 0x409)
        table.setName(value, nid, 1, 0, 0)


def subset_font(data, unicodes, key, original):
    font = TTFont(io.BytesIO(data))
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.drop_tables += ["FFTM"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    rename(font, key, original)
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def to_woff2(data, key, original, cut):
    font = TTFont(io.BytesIO(data))
    cmap = font.getBestCmap()
    hangul = sum(1 for c in cmap if 0xAC00 <= c <= 0xD7A3)
    if hangul < 11172:
        raise SystemExit("%s: 한글 글자가 모자란다: %d" % (key, hangul))
    if cut:
        return subset_font(data, [c for c in cmap if not (0xAC00 <= c <= 0xD7A3) or c in KSX1001], key, original)
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def write(name, text):
    target = os.path.join(ROOT, "vendor", name)
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    digest = base64.b64encode(hashlib.sha384(text.encode("utf-8")).digest()).decode("ascii")
    print("%s  %d bytes  sha384-%s" % (name, len(text.encode("utf-8")), digest))


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else None
    samples = []
    for key, base, path, name, label, cut in FONTS:
        data = fetch(base, path, src_dir)
        original = TTFont(io.BytesIO(data))["name"].getDebugName(1)
        woff2 = to_woff2(data, key, original, cut)
        lic = "nanum-clova-handwriting-OFL.txt" if cut else "nanum-handwriting-OFL.txt"
        what = "자주 쓰는 한글 2,350자(KS X 1001)만 남겨 이름을 ClassDock Hand %s 로 바꾼 " % key.capitalize() if cut else ""
        text = ("// 자동 생성 파일 — 수정 금지. %s 를 %sWOFF2 로 base64 에 담음. SIL OFL 1.1 (vendor/licenses/%s).\n"
                "// 일기장(diary.js)에서 손글씨 글꼴을 고를 때만 MNLazy 로 읽는다. 만든 도구: tools/build-hand-fonts.py\n"
                "globalThis.__MN_HANDFONT = globalThis.__MN_HANDFONT || {};\n"
                "globalThis.__MN_HANDFONT.%s = \"%s\";\n") % (label, what, lic, key, base64.b64encode(woff2).decode("ascii"))
        write(name, text)
        samples.append((key, subset_font(data, [ord(c) for c in SAMPLE_TEXT], key + "Sample", original)))
    body = ",\n".join('  %s:"%s"' % (key, base64.b64encode(w).decode("ascii")) for key, w in samples)
    write("hand-font-samples.js",
          "// 자동 생성 파일 — 수정 금지. 손글씨 글꼴마다 \"%s\" 세 글자만 남긴 WOFF2(칩 견본용, 이름을 바꾼 고친 글꼴). SIL OFL 1.1.\n"
          "// 일기장 꾸미기 창을 열 때 MNLazy 로 읽는다. 만든 도구: tools/build-hand-fonts.py\n"
          "globalThis.__MN_HANDFONT_SAMPLE = {\n%s\n};\n" % (SAMPLE_TEXT, body))


if __name__ == "__main__":
    main()
