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


def compose_card_png(screenshot_path, is_buga, reason, sakun, m_name, bid_date=""):
    """컬러 헤더바(불가 빨강·낙찰 파랑) + 캡처 → 라운드 카드 PNG bytes. 텔레그램/PDF 공용.
    헤더 = '불가 - 변경 | 입찰일자 | 사건번호 | 회원명' / '낙찰 | 입찰일자 | 사건번호 | 회원명'."""
    if not Image or not screenshot_path or not os.path.exists(screenshot_path):
        return None
    try:
        shot = Image.open(screenshot_path).convert("RGB")
    except Exception:
        return None
    W = shot.width
    pad = max(16, int(W * 0.018))
    accent = (220, 38, 38) if is_buga else (37, 99, 235)
    sep = "   |   "
    head = "불가" + (" - " + reason if reason else "") if is_buga else "낙찰"
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
    CH = head_h + shot.height + bw
    canvas = Image.new("RGB", (CW, CH), accent)   # 전체 배경 = 테두리 색
    d = ImageDraw.Draw(canvas)
    try:
        d.text((bw + pad, head_h // 2), txt, fill=(255, 255, 255), font=font, anchor="lm")
    except Exception:
        d.text((bw + pad, head_h // 4), txt, fill=(255, 255, 255), font=font)
    canvas.paste(shot, (bw, head_h))   # 좌우/하단 bw 테두리 남기고 캡처 온전히 배치
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


def build_report_pdf(items, report_dt=None):
    if FPDF is None:
        raise RuntimeError("fpdf2 미설치 (pip install fpdf2)")
    items = list(items or [])
    dt = report_dt or datetime.now()
    n_buga = sum(1 for it in items if (it.get("state_kind") or "") == "불가")
    n_nak = sum(1 for it in items if (it.get("state_kind") or "") == "매각")

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.add_font("malgun", "", FONT_PATH)
    pdf.add_font("malgun", "B", FONT_BOLD if os.path.exists(FONT_BOLD) else FONT_PATH)
    pdf.add_page()
    M = pdf.l_margin
    W = pdf.w - pdf.l_margin - pdf.r_margin
    PAGE_BOTTOM = pdf.h - 14

    # ── 헤더 배너 ──
    hy = pdf.get_y()
    pdf.set_fill_color(*C_NAVY)
    pdf.rect(M, hy, W, 18, style="F", round_corners=True, corner_radius=3)
    pdf.set_xy(M + 7, hy + 3.5)
    pdf.set_font("malgun", "B", 16)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 7, "MJ경매 진행사항 보고서", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(M + 7)
    pdf.set_font("malgun", "", 9)
    pdf.set_text_color(190, 200, 214)
    pdf.cell(0, 5, dt.strftime("%Y-%m-%d %H:%M") + " 기준")
    pdf.set_y(hy + 18 + 5)

    # ── 요약 카드 ──
    _summary_card(pdf, items, n_buga, n_nak, M, W)

    if not items:
        return bytes(pdf.output())

    # ── 건별 카드 ──
    for it in items:
        _item_card(pdf, it, M, W, PAGE_BOTTOM)

    return bytes(pdf.output())


def _summary_card(pdf, items, n_buga, n_nak, M, W):
    inner_x = M + 6
    inner_w = W - 12
    line_h = 12
    top = pdf.get_y()
    y = top + 5

    # 카운트 (버튼 폰트 살짝 축소)
    _pill(pdf, inner_x, y, 36, 12, f"불가 {n_buga}", C_BUGA, 15)
    _pill(pdf, inner_x + 41, y, 36, 12, f"낙찰 {n_nak}", C_NAKCHAL, 15)
    y += 16

    pdf.set_draw_color(*C_LINE)
    pdf.line(inner_x, y, inner_x + inner_w, y)
    y += 3

    # 목록 (불가/낙찰 · 입찰일자 · 사건번호 · 회원명) 폰트 2배 — 앞에 불가(빨강)/낙찰(파랑) 글자
    for it in items:
        is_buga = (it.get("state_kind") or "") == "불가"
        col = C_BUGA if is_buga else C_NAKCHAL
        pdf.set_xy(inner_x, y)
        pdf.set_font("malgun", "B", 19)
        pdf.set_text_color(*col)
        pdf.cell(17, line_h, "불가" if is_buga else "낙찰")
        pdf.set_xy(inner_x + 18, y)
        pdf.set_font("malgun", "B", 19)
        pdf.set_text_color(*C_DARK)
        pdf.cell(40, line_h, str(it.get("bid_date", "")))
        pdf.set_xy(inner_x + 59, y)
        pdf.cell(64, line_h, str(it.get("sakun_no", "")))
        pdf.set_xy(inner_x + 124, y)
        pdf.set_font("malgun", "", 16)
        pdf.set_text_color(70, 78, 92)
        pdf.cell(inner_w - 124, line_h, str(it.get("m_name", "")))
        y += line_h

    bottom = y + 4
    pdf.set_draw_color(*C_LINE)
    pdf.set_line_width(0.3)
    pdf.rect(M, top, W, bottom - top, style="D", round_corners=True, corner_radius=3)
    pdf.set_y(bottom + 6)


def _item_card(pdf, it, M, W, PAGE_BOTTOM):
    """합성 카드(컬러 헤더바+캡처+라운드) 이미지를 풀폭으로 배치."""
    is_buga = (it.get("state_kind") or "") == "불가"
    comp = compose_card_png(it.get("screenshot_path", ""), is_buga,
                            it.get("status", ""), it.get("sakun_no", ""), it.get("m_name", ""),
                            it.get("bid_date", ""))
    if not comp:
        # 캡처 없으면 텍스트 한 줄
        accent = C_BUGA if is_buga else C_NAKCHAL
        top = pdf.get_y()
        _pill(pdf, M + 6, top + 4, 15, 7, "불가" if is_buga else "낙찰", accent)
        pdf.set_xy(M + 26, top + 4)
        pdf.set_font("malgun", "B", 11)
        pdf.set_text_color(*C_DARK)
        hdr = (("불가 - " + (it.get("status") or "")) if is_buga else "낙찰") + "  |  " + str(it.get("sakun_no", "")) + ("  |  " + it.get("m_name", "") if it.get("m_name") else "")
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
        {"sakun_no": "2024타경54944", "state_kind": "불가", "status": "변경", "m_name": "김진현", "screenshot_path": ""},
        {"sakun_no": "2025-08032-001", "state_kind": "매각", "m_name": "석재근", "screenshot_path": ""},
    ]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_report_test.pdf")
    with open(out, "wb") as f:
        f.write(build_report_pdf(items))
    print("OK", out)
