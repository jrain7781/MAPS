# -*- coding: utf-8 -*-
"""
MJ경매 진행사항 보고서 PDF 생성기 (카드뉴스 스타일).
- 입력: 불가/낙찰 건 리스트(dict) + 건별 상세 스크린샷 경로.
- 출력: PDF bytes (한글 malgun.ttf 임베드).

item dict 키:
  sakun_no, court, bid_date(YYMMDD), state_kind('불가'|'매각'),
  status(불가사유), detail(불가 상세문장), maegak_price, buyer, m_name,
  addr, mulgeon_type, view_url, screenshot_path
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

# 팔레트
C_NAVY = (24, 33, 57)        # 헤더 배너
C_BUGA = (220, 38, 38)       # 불가 = 빨강
C_NAVY_TXT = (17, 24, 39)
C_NAKCHAL = (37, 99, 235)    # 낙찰 = 파랑
C_GRAY = (120, 128, 142)
C_LABEL = (140, 148, 160)
C_LINE = (226, 232, 240)
C_PANEL = (247, 249, 252)    # 연한 패널
C_VALUE = (33, 41, 56)


def _fmt_won(v):
    s = "".join(ch for ch in str(v or "") if ch.isdigit())
    return format(int(s), ",") + "원" if s else ""


def _fmt_date6(d6):
    s = "".join(ch for ch in str(d6 or "") if ch.isdigit())
    if len(s) == 6:
        return f"20{s[:2]}.{s[2:4]}.{s[4:6]}"
    return str(d6 or "")


def _img_disp(path, max_w, max_h):
    """이미지를 (max_w x max_h) 안에 맞춘 표시 (w, h) mm. 실패 시 None."""
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


def _pill(pdf, x, y, w, h, text, color):
    pdf.set_fill_color(*color)
    pdf.rect(x, y, w, h, style="F", round_corners=True, corner_radius=1.6)
    pdf.set_xy(x, y + (h - 4) / 2 - 0.3)
    pdf.set_font("malgun", "B", 9)
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
    pdf.set_auto_page_break(False)          # 카드 단위로 수동 페이지 제어
    pdf.add_font("malgun", "", FONT_PATH)
    pdf.add_font("malgun", "B", FONT_BOLD if os.path.exists(FONT_BOLD) else FONT_PATH)
    pdf.add_page()
    M = pdf.l_margin
    W = pdf.w - pdf.l_margin - pdf.r_margin
    PAGE_BOTTOM = pdf.h - 14

    # ── 헤더 배너 ──
    hy = pdf.get_y()
    pdf.set_fill_color(*C_NAVY)
    pdf.rect(M, hy, W, 21, style="F", round_corners=True, corner_radius=3)
    pdf.set_xy(M + 7, hy + 4.5)
    pdf.set_font("malgun", "B", 17)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 8, "MJ경매 진행사항 보고서", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(M + 7)
    pdf.set_font("malgun", "", 9)
    pdf.set_text_color(190, 200, 214)
    pdf.cell(0, 5, dt.strftime("%Y-%m-%d %H:%M") + " 기준")
    _pill(pdf, M + W - 64, hy + 6.5, 30, 8, f"불가 {n_buga}", C_BUGA)
    _pill(pdf, M + W - 32, hy + 6.5, 30, 8, f"낙찰 {n_nak}", C_NAKCHAL)
    pdf.set_y(hy + 21 + 6)

    if not items:
        pdf.set_font("malgun", "", 11)
        pdf.set_text_color(*C_GRAY)
        pdf.cell(0, 10, "보고 대상(불가/낙찰) 건이 없습니다.")
        return bytes(pdf.output())

    for it in items:
        _render_card(pdf, it, M, W, PAGE_BOTTOM)

    return bytes(pdf.output())


def _render_card(pdf, it, M, W, PAGE_BOTTOM):
    kind = it.get("state_kind") or ""
    is_buga = (kind == "불가")
    accent = C_BUGA if is_buga else C_NAKCHAL
    badge = "불가" if is_buga else "낙찰"

    inner_x = M + 7
    inner_w = W - 14

    # 스크린샷 표시 크기 (카드 하단, 풀폭, 높이캡 100mm)
    disp = _img_disp(it.get("screenshot_path", ""), inner_w, 100)

    # 정보 행 구성
    rows = []
    rows.append(("회원", it.get("m_name", ""), C_VALUE))
    rows.append(("물건종별", it.get("mulgeon_type", ""), C_VALUE))
    rows.append(("소재지", (it.get("addr", "") or "").split("\n")[0], C_VALUE))
    rows.append(("매각기일", _fmt_date6(it.get("bid_date", "")), C_VALUE))
    rows.append(("법원/기관", it.get("court", ""), C_VALUE))
    rows = [r for r in rows if r[1]]

    # 카드 높이 추정
    pad = 6
    head_h = 11
    rows_h = len(rows) * 6.2
    if is_buga:
        result_h = 8 + (7 if it.get("detail") else 0)     # 처리결과 + 상세
    else:
        result_h = 8 + (6.2 if it.get("buyer") or True else 0)  # 낙찰가 + 매수인
    btn_h = 9
    img_h = (disp[1] + 4) if disp else 0
    card_h = pad + head_h + rows_h + result_h + btn_h + img_h + pad

    # 페이지 넘김
    if pdf.get_y() + card_h > PAGE_BOTTOM:
        pdf.add_page()
    top = pdf.get_y()
    y = top + pad

    # ── 헤더: 배지 + 사건번호 ──
    _pill(pdf, inner_x, y, 16, 7, badge, accent)
    pdf.set_xy(inner_x + 19, y)
    pdf.set_font("malgun", "B", 13)
    pdf.set_text_color(*C_NAVY_TXT)
    pdf.cell(inner_w - 19, 7, str(it.get("sakun_no", "")))
    y += head_h

    # ── 정보 행 ──
    def info_row(label, value, color):
        nonlocal y
        pdf.set_xy(inner_x, y)
        pdf.set_font("malgun", "", 8.5)
        pdf.set_text_color(*C_LABEL)
        pdf.cell(22, 6, label)
        pdf.set_xy(inner_x + 22, y)
        pdf.set_font("malgun", "", 9.5)
        pdf.set_text_color(*color)
        pdf.cell(inner_w - 22, 6, str(value))
        y += 6.2

    for (lb, val, col) in rows:
        info_row(lb, val, col)

    # ── 결과 하이라이트 박스 ──
    y += 1
    if is_buga:
        reason = it.get("status", "") or ""
        pdf.set_fill_color(254, 242, 242)        # 연한 빨강
        box_h = 7.5 + (6.5 if it.get("detail") else 0)
        pdf.rect(inner_x, y, inner_w, box_h, style="F", round_corners=True, corner_radius=1.5)
        pdf.set_xy(inner_x + 3, y + 1.3)
        pdf.set_font("malgun", "B", 10)
        pdf.set_text_color(*C_BUGA)
        pdf.cell(0, 5, f"불가  ·  {reason}" if reason else "불가")
        if it.get("detail"):
            pdf.set_xy(inner_x + 3, y + 7.3)
            pdf.set_font("malgun", "", 9)
            pdf.set_text_color(180, 40, 40)
            pdf.cell(inner_w - 6, 5, str(it.get("detail", "")))
        y += box_h + 2
    else:
        pdf.set_fill_color(239, 246, 255)        # 연한 파랑
        pdf.rect(inner_x, y, inner_w, 13.5, style="F", round_corners=True, corner_radius=1.5)
        pdf.set_xy(inner_x + 3, y + 1.6)
        pdf.set_font("malgun", "", 8.5)
        pdf.set_text_color(90, 110, 150)
        pdf.cell(20, 5, "낙찰가")
        pdf.set_xy(inner_x + 22, y + 0.8)
        pdf.set_font("malgun", "B", 13)
        pdf.set_text_color(*C_NAKCHAL)
        pdf.cell(inner_w - 22, 7, _fmt_won(it.get("maegak_price", "")))
        pdf.set_xy(inner_x + 3, y + 8.3)
        pdf.set_font("malgun", "", 8.5)
        pdf.set_text_color(90, 110, 150)
        pdf.cell(20, 4.5, "매수인")
        pdf.set_xy(inner_x + 22, y + 8.3)
        pdf.set_font("malgun", "", 9.5)
        pdf.set_text_color(*C_VALUE)
        pdf.cell(inner_w - 22, 4.5, it.get("buyer", "") or "(비공개)")
        y += 13.5 + 2

    # ── 옥션원 바로가기 버튼 ──
    vu = it.get("view_url", "")
    if vu:
        pdf.set_fill_color(*accent)
        pdf.rect(inner_x, y, 42, 7, style="F", round_corners=True, corner_radius=1.5)
        pdf.set_xy(inner_x, y + 1.4)
        pdf.set_font("malgun", "B", 9)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(42, 4, "옥션원에서 보기  ▶", align="C", link=vu)
        y += btn_h

    # ── 스크린샷 (중앙) ──
    if disp:
        ix = inner_x + (inner_w - disp[0]) / 2
        pdf.set_draw_color(*C_LINE)
        try:
            pdf.image(it.get("screenshot_path"), x=ix, y=y + 2, w=disp[0], h=disp[1])
            pdf.rect(ix, y + 2, disp[0], disp[1])      # 얇은 테두리
        except Exception:
            pass
        y += disp[1] + 4

    bottom = y + pad
    # ── 카드 외곽선 + 좌측 액센트 바 ──
    pdf.set_draw_color(*C_LINE)
    pdf.set_line_width(0.3)
    pdf.rect(M, top, W, bottom - top, style="D", round_corners=True, corner_radius=3)
    pdf.set_fill_color(*accent)
    pdf.rect(M, top + 3, 2.2, (bottom - top) - 6, style="F", round_corners=True, corner_radius=1)

    pdf.set_y(bottom + 5)


if __name__ == "__main__":
    sample = [
        {"sakun_no": "2024타경54944", "court": "춘천강릉", "bid_date": "260608", "state_kind": "불가",
         "status": "변경", "detail": "본사건은 변경 되었으며 현재 매각기일이 지정되지 않았습니다.",
         "m_name": "김진현", "addr": "강원특별자치도 강릉시 구정면 학산리 641-129", "mulgeon_type": "주택",
         "view_url": "https://www.auction1.co.kr/auction/ca_view.php", "screenshot_path": ""},
    ]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_report_test.pdf")
    with open(out, "wb") as f:
        f.write(build_report_pdf(sample))
    print("OK", out)
