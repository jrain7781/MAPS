# -*- coding: utf-8 -*-
"""
MJ경매 진행사항 보고서 PDF (요약카드 + 건별 최소카드).
- 1) 요약 카드: 불가 N건·낙찰 N건 + 목록(사유/사건번호/회원명)
- 2) 건별 카드: [불가/낙찰] 사유 / 사건번호 / 회원명  +  바로 아래 캡처 이미지

item dict: sakun_no, state_kind('불가'|'매각'), status(사유), m_name, screenshot_path …
"""
import os
import io
from datetime import datetime

try:
    from fpdf import FPDF
except Exception:
    FPDF = None
try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    Image = None

FONT_PATH = r"C:\Windows\Fonts\malgun.ttf"
FONT_BOLD = r"C:\Windows\Fonts\malgunbd.ttf"

C_NAVY = (24, 33, 57)
C_BUGA = (220, 38, 38)
C_NAKCHAL = (37, 99, 235)
C_DARK = (17, 24, 39)
C_GRAY = (120, 128, 142)
C_LINE = (226, 232, 240)

# 일일보고 카테고리 색: 낙찰=파랑, 미입찰=빨강, 불가=검정 (이미지 카드용)
CARD_COLOR = {"낙찰": (37, 99, 235), "미입찰": (220, 38, 38), "불가": (17, 24, 39)}
# 리스트 표기용(패찰=일반, 확인불가 포함). 정렬: 낙찰→불가→미입찰→패찰→확인불가
ALL_CATS = ("낙찰", "미입찰", "불가", "일반", "확인불가")
CARD_ORDER = {"낙찰": 0, "불가": 1, "미입찰": 2, "일반": 3, "확인불가": 4}
CAT_LABEL = {"낙찰": "낙찰", "미입찰": "미입찰", "불가": "불가", "일반": "패찰", "확인불가": "확인불가"}
CAT_COLOR_RGB = {"낙찰": (37, 99, 235), "미입찰": (220, 38, 38), "불가": (17, 24, 39),
                 "일반": (107, 114, 128), "확인불가": (156, 163, 175)}
CARD_CATS = ("낙찰", "불가", "미입찰")   # 이미지 카드는 이 셋만


def _cat_of(it):
    """item에서 일일보고 카테고리 결정 (category 우선, 없으면 state_kind 기반)."""
    c = (it.get("category") or "").strip()
    if c in ALL_CATS:
        return c
    return "불가" if (it.get("state_kind") or "") == "불가" else "낙찰"


def compose_card_png(screenshot_path, category, sakun, m_name, bid_date="", reason="", footer=False):
    """컬러 헤더바(낙찰 파랑·미입찰 빨강·불가 검정) + 캡처 → 라운드 카드 PNG bytes. 텔레그램/PDF 공용.
    헤더 = '불가 - 변경 | 입찰일자 | 사건번호 | 회원명' / '낙찰|미입찰 | 입찰일자 | 사건번호 | 회원명'."""
    if not Image or not screenshot_path or not os.path.exists(screenshot_path):
        return None
    try:
        shot = Image.open(screenshot_path).convert("RGB")
    except Exception:
        return None
    W = shot.width
    pad = max(16, int(W * 0.018))
    accent = CARD_COLOR.get(category, (17, 24, 39))
    sep = "   |   "
    head = ("불가" + (" - " + reason if reason else "")) if category == "불가" else category
    parts = [head] + [p for p in (str(bid_date or ""), str(sakun or ""), str(m_name or "")) if p]
    txt = sep.join(parts)

    def _font(sz):
        try:
            return ImageFont.truetype(FONT_BOLD if os.path.exists(FONT_BOLD) else FONT_PATH, sz)
        except Exception:
            return ImageFont.load_default()

    # 폰트 이전 대비 2배(=W*0.057), 가로 넘치면 축소
    fsize = max(20, int(W * 0.057))
    font = _font(fsize)
    _m = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    while fsize > 14:
        try:
            tw = _m.textlength(txt, font=font)
        except Exception:
            tw = len(txt) * fsize * 0.6
        if tw <= W - 2 * pad:
            break
        fsize = int(fsize * 0.93)
        font = _font(fsize)
    head_h = int(fsize * 1.9)

    # 테두리(헤더와 동일 색)를 캡처 바깥에 둬서 이미지가 잘리지 않게.
    # 구조: 헤더바(상단 테두리 겸) + 좌/우/하단 bw 만큼 컬러 테두리 + 그 안에 캡처 온전히.
    bw = max(10, int(W * 0.014))
    radius = max(14, int(bw * 0.9))
    CW = W + bw * 2
    # footer=True 면 캡처 아래에 제목(txt)을 텍스트로 한 줄 더 (카톡 붙여넣기 후 검색용)
    foot_h = int(fsize * 1.5) if footer else 0
    CH = head_h + shot.height + foot_h + bw
    canvas = Image.new("RGB", (CW, CH), accent)   # 전체 배경 = 테두리 색
    d = ImageDraw.Draw(canvas)
    try:
        d.text((bw + pad, head_h // 2), txt, fill=(255, 255, 255), font=font, anchor="lm")
    except Exception:
        d.text((bw + pad, head_h // 4), txt, fill=(255, 255, 255), font=font)
    canvas.paste(shot, (bw, head_h))   # 좌우/하단 bw 테두리 남기고 캡처 온전히 배치
    if footer:
        fy = head_h + shot.height
        d.rectangle([bw, fy, bw + W, fy + foot_h], fill=(255, 255, 255))   # 흰 바탕 텍스트 줄
        ffont = _font(max(14, int(fsize * 0.78)))
        try:
            d.text((bw + pad, fy + foot_h // 2), txt, fill=(17, 24, 39), font=ffont, anchor="lm")
        except Exception:
            d.text((bw + pad, fy + foot_h // 4), txt, fill=(17, 24, 39), font=ffont)
    # 라운드 코너 (흰 배경 위)
    mask = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, CW - 1, CH - 1], radius=radius, fill=255)
    out = Image.new("RGB", (CW, CH), (255, 255, 255))
    out.paste(canvas, (0, 0), mask)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def _img_disp(path, max_w, max_h):
    if not Image or not path or not os.path.exists(path):
        return None
    try:
        with Image.open(path) as im:
            pw, ph = im.size
        if not pw or not ph:
            return None
        ratio = ph / pw
        w = max_w
        h = w * ratio
        if h > max_h:
            h = max_h
            w = h / ratio
        return (w, h)
    except Exception:
        return None


def _pill(pdf, x, y, w, h, text, color, fsize=9):
    pdf.set_fill_color(*color)
    pdf.rect(x, y, w, h, style="F", round_corners=True, corner_radius=1.6)
    pdf.set_xy(x, y + (h - 4) / 2 - 0.3)
    pdf.set_font("malgun", "B", fsize)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(w, 4, text, align="C")


def build_report_pdf(items, report_dt=None, total=None):
    if FPDF is None:
        raise RuntimeError("fpdf2 미설치 (pip install fpdf2)")
    items = list(items or [])
    items.sort(key=lambda it: CARD_ORDER.get(_cat_of(it), 9))   # 낙찰→미입찰→불가 순
    dt = report_dt or datetime.now()
    n_nak = sum(1 for it in items if _cat_of(it) == "낙찰")
    n_miss = sum(1 for it in items if _cat_of(it) == "미입찰")
    n_buga = sum(1 for it in items if _cat_of(it) == "불가")
    n_ipchal = total if total is not None else len(items)
    n_maegak = sum(1 for it in items if _cat_of(it) in ("낙찰", "미입찰", "일반", "확인불가"))   # 매각(경매 실시)
    n_jin = max(0, (n_ipchal or 0) - n_maegak - n_buga)                                          # 진행(아직 경매 전)

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.add_font("malgun", "", FONT_PATH)
    pdf.add_font("malgun", "B", FONT_BOLD if os.path.exists(FONT_BOLD) else FONT_PATH)
    pdf.add_page()
    M = pdf.l_margin
    W = pdf.w - pdf.l_margin - pdf.r_margin
    PAGE_BOTTOM = pdf.h - 14

    # ── 헤더 배너: 'YYYY년 MM월 DD일 일일보고' ──
    hy = pdf.get_y()
    pdf.set_fill_color(*C_NAVY)
    pdf.rect(M, hy, W, 18, style="F", round_corners=True, corner_radius=3)
    pdf.set_xy(M + 7, hy + 4.5)
    pdf.set_font("malgun", "B", 17)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 9, dt.strftime("%Y년 %m월 %d일") + " 일일보고", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(hy + 18 + 5)

    # ── 집계 + 목록 카드 ──
    _summary_card(pdf, items, {"낙찰": n_nak, "입찰": n_ipchal, "불가": n_buga, "미입찰": n_miss,
                               "매각": n_maegak, "진행": n_jin}, M, W)

    if not items:
        return bytes(pdf.output())

    # ── 건별 카드 (낙찰→불가→미입찰만, 패찰·확인불가는 카드 없음) ──
    for it in items:
        if _cat_of(it) in CARD_CATS:
            _item_card(pdf, it, M, W, PAGE_BOTTOM)

    return bytes(pdf.output())


def _summary_card(pdf, items, counts, M, W):
    inner_x = M + 6
    inner_w = W - 12
    line_h = 12
    top = pdf.get_y()
    y = top + 5

    # 집계 4줄: 입찰 / 낙찰(매각·진행) / 불가 / 미입찰
    lines2 = [
        (f"입찰 {counts.get('입찰', 0)}건", C_DARK),
        (f"낙찰 {counts.get('낙찰', 0)}건  (매각 {counts.get('매각', 0)}건   진행 {counts.get('진행', 0)}건)", C_NAKCHAL),
        (f"불가 {counts.get('불가', 0)}건", C_DARK),
        (f"미입찰 {counts.get('미입찰', 0)}건", C_BUGA),
    ]
    pdf.set_font("malgun", "B", 15)
    for txt, col in lines2:
        pdf.set_xy(inner_x, y)
        pdf.set_text_color(*col)
        pdf.cell(inner_w, 8, txt)
        y += 9
    y += 3

    pdf.set_draw_color(*C_LINE)
    pdf.line(inner_x, y, inner_x + inner_w, y)
    y += 3

    # 목록 (카테고리 · 입찰일자 · 사건번호 · 회원명) — 낙찰·불가·미입찰·패찰·확인불가 순, 앞 카테고리 글자 색
    for it in items:
        cat = _cat_of(it)
        col = CAT_COLOR_RGB.get(cat, C_DARK)
        pdf.set_xy(inner_x, y)
        pdf.set_font("malgun", "B", 19)
        pdf.set_text_color(*col)
        pdf.cell(33, line_h, CAT_LABEL.get(cat, cat))
        pdf.set_xy(inner_x + 34, y)
        pdf.set_font("malgun", "B", 19)
        pdf.set_text_color(*C_DARK)
        pdf.cell(36, line_h, str(it.get("bid_date", "")))
        pdf.set_xy(inner_x + 72, y)
        pdf.cell(58, line_h, str(it.get("sakun_no", "")))
        pdf.set_xy(inner_x + 132, y)
        pdf.set_font("malgun", "", 16)
        pdf.set_text_color(70, 78, 92)
        pdf.cell(inner_w - 132, line_h, str(it.get("m_name", "")))
        y += line_h

    bottom = y + 4
    pdf.set_draw_color(*C_LINE)
    pdf.set_line_width(0.3)
    pdf.rect(M, top, W, bottom - top, style="D", round_corners=True, corner_radius=3)
    pdf.set_y(bottom + 6)


def _item_card(pdf, it, M, W, PAGE_BOTTOM):
    """합성 카드(컬러 헤더바+캡처+라운드) 이미지를 풀폭으로 배치."""
    cat = _cat_of(it)
    comp = compose_card_png(it.get("screenshot_path", ""), cat,
                            it.get("sakun_no", ""), it.get("m_name", ""),
                            it.get("bid_date", ""), it.get("status", ""))
    if not comp:
        # 캡처 없으면 텍스트 한 줄
        accent = CARD_COLOR.get(cat, C_DARK)
        top = pdf.get_y()
        _pill(pdf, M + 6, top + 4, 18, 7, cat, accent)
        pdf.set_xy(M + 28, top + 4)
        pdf.set_font("malgun", "B", 11)
        pdf.set_text_color(*C_DARK)
        hdr = ((cat + " - " + (it.get("status") or "")) if cat == "불가" else cat) + "  |  " + str(it.get("sakun_no", "")) + ("  |  " + it.get("m_name", "") if it.get("m_name") else "")
        pdf.cell(0, 7, hdr)
        pdf.set_draw_color(*C_LINE)
        pdf.rect(M, top, W, 15, style="D", round_corners=True, corner_radius=3)
        pdf.set_y(top + 20)
        return

    try:
        with Image.open(io.BytesIO(comp)) as im:
            pw, ph = im.size
    except Exception:
        return
    disp_w = W
    disp_h = disp_w * (ph / pw)
    max_h = PAGE_BOTTOM - 24
    if disp_h > max_h:
        disp_h = max_h
        disp_w = disp_h * (pw / ph)

    if pdf.get_y() + disp_h + 6 > PAGE_BOTTOM and pdf.get_y() > 40:
        pdf.add_page()
    x = M + (W - disp_w) / 2
    y = pdf.get_y()
    try:
        pdf.image(io.BytesIO(comp), x=x, y=y, w=disp_w, h=disp_h)
    except Exception:
        pass
    pdf.set_y(y + disp_h + 6)


if __name__ == "__main__":
    items = [
        {"sakun_no": "2024타경54944", "category": "불가", "status": "변경", "m_name": "김진현", "bid_date": "260602", "screenshot_path": ""},
        {"sakun_no": "2025-08032-001", "category": "낙찰", "m_name": "석재근", "bid_date": "260527", "screenshot_path": ""},
        {"sakun_no": "2025타경1646", "category": "미입찰", "m_name": "이대영", "bid_date": "260602", "screenshot_path": ""},
    ]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_report_test.pdf")
    with open(out, "wb") as f:
        f.write(build_report_pdf(items, total=7))
    print("OK", out)
