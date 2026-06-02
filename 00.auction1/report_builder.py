# -*- coding: utf-8 -*-
"""
MJ경매 진행사항 보고서 PDF (요약카드 + 건별 최소카드).
- 1) 요약 카드: 불가 N건·낙찰 N건 + 목록(사유/사건번호/회원명)
- 2) 건별 카드: [불가/낙찰] 사유 / 사건번호 / 회원명  +  바로 아래 캡처 이미지

item dict: sakun_no, state_kind('불가'|'매각'), status(사유), m_name, screenshot_path …
"""
import os
from datetime import datetime

try:
    from fpdf import FPDF
except Exception:
    FPDF = None
try:
    from PIL import Image
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
    line_h = 6.5
    top = pdf.get_y()
    y = top + 5

    # 카운트
    _pill(pdf, inner_x, y, 26, 8, f"불가 {n_buga}", C_BUGA, 10)
    _pill(pdf, inner_x + 29, y, 26, 8, f"낙찰 {n_nak}", C_NAKCHAL, 10)
    y += 11

    pdf.set_draw_color(*C_LINE)
    pdf.line(inner_x, y, inner_x + inner_w, y)
    y += 2.5

    # 목록 (사유/낙찰 · 사건번호 · 회원명)
    for it in items:
        is_buga = (it.get("state_kind") or "") == "불가"
        col = C_BUGA if is_buga else C_NAKCHAL
        tag = (it.get("status") or "변경") if is_buga else "낙찰"
        pdf.set_xy(inner_x, y)
        pdf.set_font("malgun", "B", 9.5)
        pdf.set_text_color(*col)
        pdf.cell(20, line_h, ("● " + tag))
        pdf.set_xy(inner_x + 22, y)
        pdf.set_font("malgun", "B", 9.5)
        pdf.set_text_color(*C_DARK)
        pdf.cell(58, line_h, str(it.get("sakun_no", "")))
        pdf.set_xy(inner_x + 82, y)
        pdf.set_font("malgun", "", 9.5)
        pdf.set_text_color(70, 78, 92)
        pdf.cell(inner_w - 82, line_h, str(it.get("m_name", "")))
        y += line_h

    bottom = y + 4
    pdf.set_draw_color(*C_LINE)
    pdf.set_line_width(0.3)
    pdf.rect(M, top, W, bottom - top, style="D", round_corners=True, corner_radius=3)
    pdf.set_y(bottom + 6)


def _item_card(pdf, it, M, W, PAGE_BOTTOM):
    is_buga = (it.get("state_kind") or "") == "불가"
    accent = C_BUGA if is_buga else C_NAKCHAL
    badge = "불가" if is_buga else "낙찰"
    reason = (it.get("status") or "") if is_buga else ""

    inner_x = M + 6
    inner_w = W - 12
    disp = _img_disp(it.get("screenshot_path", ""), inner_w, 215)

    head_h = 11
    pad = 5
    img_h = (disp[1] + 4) if disp else 0
    card_h = pad + head_h + img_h + pad

    if pdf.get_y() + min(card_h, PAGE_BOTTOM - 20) > PAGE_BOTTOM and pdf.get_y() > 40:
        pdf.add_page()
    top = pdf.get_y()
    y = top + pad

    # 헤더: [배지] 사유 / 사건번호 / 회원명
    _pill(pdf, inner_x, y, 15, 7, badge, accent)
    pdf.set_xy(inner_x + 18, y)
    pdf.set_font("malgun", "B", 11)
    # 사유(불가만, 빨강) / 사건번호(검정) / 회원명(회색)
    if reason:
        pdf.set_text_color(*C_BUGA)
        pdf.cell(pdf.get_string_width(reason) + 2, 7, reason)
        pdf.set_text_color(*C_GRAY)
        pdf.cell(4, 7, "/")
    pdf.set_text_color(*C_DARK)
    sak = str(it.get("sakun_no", ""))
    pdf.cell(pdf.get_string_width(sak) + 3, 7, sak)
    if it.get("m_name"):
        pdf.set_text_color(*C_GRAY)
        pdf.cell(4, 7, "/")
        pdf.set_font("malgun", "", 10.5)
        pdf.set_text_color(70, 78, 92)
        pdf.cell(0, 7, str(it.get("m_name", "")))
    y += head_h

    # 캡처 이미지 (헤더 바로 아래, 중앙)
    if disp:
        ix = inner_x + (inner_w - disp[0]) / 2
        try:
            pdf.image(it.get("screenshot_path"), x=ix, y=y, w=disp[0], h=disp[1])
            pdf.set_draw_color(*C_LINE)
            pdf.set_line_width(0.2)
            pdf.rect(ix, y, disp[0], disp[1])
        except Exception:
            pass
        y += disp[1] + 4

    bottom = y + pad
    pdf.set_draw_color(*C_LINE)
    pdf.set_line_width(0.3)
    pdf.rect(M, top, W, bottom - top, style="D", round_corners=True, corner_radius=3)
    pdf.set_fill_color(*accent)
    pdf.rect(M, top + 3, 2.2, (bottom - top) - 6, style="F", round_corners=True, corner_radius=1)
    pdf.set_y(bottom + 5)


if __name__ == "__main__":
    items = [
        {"sakun_no": "2024타경54944", "state_kind": "불가", "status": "변경", "m_name": "김진현", "screenshot_path": ""},
        {"sakun_no": "2025-08032-001", "state_kind": "매각", "m_name": "석재근", "screenshot_path": ""},
    ]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_report_test.pdf")
    with open(out, "wb") as f:
        f.write(build_report_pdf(items))
    print("OK", out)
