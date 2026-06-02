# -*- coding: utf-8 -*-
"""
MJ경매 진행사항 보고서 PDF 생성기.
- 입력: 불가/낙찰 건 리스트(dict) + 건별 상세 스크린샷 경로.
- 출력: PDF bytes (한글 malgun.ttf 임베드).
- crawler.py /api/send-report 에서 호출 → base64 로 GAS sendBugaReport 전송.

item dict 키:
  sakun_no, court, bid_date(YYMMDD), state_kind('불가'|'매각'),
  status(불가사유), maegak_price, buyer, addr, mulgeon_type, view_url, screenshot_path
"""
import os
from datetime import datetime

try:
    from fpdf import FPDF
except Exception as _e:
    FPDF = None

FONT_PATH = r"C:\Windows\Fonts\malgun.ttf"
FONT_BOLD = r"C:\Windows\Fonts\malgunbd.ttf"

# 색상 (MAPS 상태색과 통일)
C_BUGA = (17, 24, 39)      # 불가 = 검정
C_NAKCHAL = (37, 99, 235)  # 낙찰 = 파랑
C_GRAY = (107, 114, 128)
C_LINE = (209, 213, 219)
C_HEADBG = (243, 244, 246)


def _fmt_won(v):
    s = "".join(ch for ch in str(v or "") if ch.isdigit())
    if not s:
        return ""
    return format(int(s), ",") + "원"


def _fmt_date6(d6):
    s = "".join(ch for ch in str(d6 or "") if ch.isdigit())
    if len(s) == 6:
        return f"20{s[:2]}.{s[2:4]}.{s[4:6]}"
    return str(d6 or "")


def build_report_pdf(items, report_dt=None):
    """불가/낙찰 건 리스트 → PDF bytes. report_dt: datetime (없으면 now)."""
    if FPDF is None:
        raise RuntimeError("fpdf2 미설치 (pip install fpdf2)")
    items = list(items or [])
    dt = report_dt or datetime.now()
    n_buga = sum(1 for it in items if (it.get("state_kind") or "") == "불가")
    n_nak = sum(1 for it in items if (it.get("state_kind") or "") == "매각")

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_font("malgun", "", FONT_PATH)
    if os.path.exists(FONT_BOLD):
        pdf.add_font("malgun", "B", FONT_BOLD)
    else:
        pdf.add_font("malgun", "B", FONT_PATH)
    pdf.add_page()
    W = pdf.w - pdf.l_margin - pdf.r_margin

    # ── 헤더 ──
    pdf.set_font("malgun", "B", 18)
    pdf.set_text_color(17, 24, 39)
    pdf.cell(0, 11, "MJ경매 진행사항 보고서", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("malgun", "", 10)
    pdf.set_text_color(*C_GRAY)
    pdf.cell(0, 6, f"보고일시  {dt.strftime('%Y-%m-%d %H:%M')}", new_x="LMARGIN", new_y="NEXT")
    # 요약 배지
    pdf.ln(1)
    pdf.set_font("malgun", "B", 11)
    pdf.set_text_color(*C_BUGA)
    pdf.cell(45, 8, f"● 불가 {n_buga}건", border=0)
    pdf.set_text_color(*C_NAKCHAL)
    pdf.cell(45, 8, f"● 낙찰 {n_nak}건", border=0, new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*C_LINE)
    pdf.ln(1)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + W, pdf.get_y())
    pdf.ln(3)

    if not items:
        pdf.set_font("malgun", "", 11)
        pdf.set_text_color(*C_GRAY)
        pdf.cell(0, 10, "보고 대상 건이 없습니다.", new_x="LMARGIN", new_y="NEXT")
        return bytes(pdf.output())

    # ── 건별 카드 ──
    for idx, it in enumerate(items, 1):
        kind = it.get("state_kind") or ""
        is_buga = (kind == "불가")
        accent = C_BUGA if is_buga else C_NAKCHAL
        badge = "불가" if is_buga else "낙찰"

        # 카드 시작 y (페이지 넘김 대비 최소 높이 확보)
        if pdf.get_y() > pdf.h - 70:
            pdf.add_page()
        top = pdf.get_y()

        # 좌측 텍스트 / 우측 스크린샷
        text_w = W * 0.56
        img_w = W * 0.40
        img_x = pdf.l_margin + text_w + (W * 0.04)

        # 제목줄: [배지] 사건번호
        pdf.set_xy(pdf.l_margin, top)
        pdf.set_font("malgun", "B", 12)
        pdf.set_text_color(*accent)
        pdf.cell(14, 7, f"[{badge}]", border=0)
        pdf.set_text_color(17, 24, 39)
        pdf.cell(text_w - 14, 7, f"{it.get('sakun_no','')}", new_x="LMARGIN", new_y="NEXT")

        def row(label, value, vcolor=(31, 41, 55)):
            if not value:
                return
            pdf.set_x(pdf.l_margin)
            pdf.set_font("malgun", "", 9)
            pdf.set_text_color(*C_GRAY)
            pdf.cell(22, 6, label, border=0)
            pdf.set_font("malgun", "", 9.5)
            pdf.set_text_color(*vcolor)
            pdf.multi_cell(text_w - 22, 6, str(value), new_x="LMARGIN", new_y="NEXT", max_line_height=6)

        row("물건종별", it.get("mulgeon_type", ""))
        row("소재지", (it.get("addr", "") or "").split("\n")[0])   # 토지/대항력 등 부가줄 제외
        row("매각기일", _fmt_date6(it.get("bid_date", "")))
        row("법원/기관", it.get("court", ""))
        if is_buga:
            row("불가사유", it.get("status", ""), C_BUGA)
        else:
            row("낙찰가", _fmt_won(it.get("maegak_price", "")), C_NAKCHAL)
            row("매수인", it.get("buyer", "") or "(비공개)")
        row("옥션원", it.get("view_url", ""), (37, 99, 235))

        text_bottom = pdf.get_y()

        # 우측 스크린샷
        shot = it.get("screenshot_path", "")
        if shot and os.path.exists(shot):
            try:
                pdf.image(shot, x=img_x, y=top + 8, w=img_w)
            except Exception:
                pass
        img_bottom = top + 8 + img_w  # 대략

        bottom = max(text_bottom, img_bottom, top + 30)
        # 카드 외곽선
        pdf.set_draw_color(*C_LINE)
        pdf.rect(pdf.l_margin - 1, top - 1, W + 2, (bottom - top) + 3)
        pdf.set_y(bottom + 5)

    return bytes(pdf.output())


if __name__ == "__main__":
    # 자체 검증
    sample = [
        {"sakun_no": "2025-08032-001", "court": "공매", "bid_date": "260527",
         "state_kind": "매각", "maegak_price": "234888999", "buyer": "",
         "addr": "강원특별자치도 홍천군 홍천읍 갈마곡리 73 신성미소지움아파트 제104동 제4층 제404호",
         "mulgeon_type": "아파트", "view_url": "https://www.auction1.co.kr/pubauct/view.php?product_id=578802",
         "screenshot_path": ""},
        {"sakun_no": "2023타경110430", "court": "부산지방법원 동부지원", "bid_date": "260608",
         "state_kind": "불가", "status": "변경",
         "addr": "부산광역시 남구 대연동 892-38 대연동금샘하이클래스 101동 2층 201호",
         "mulgeon_type": "다세대(빌라)", "view_url": "", "screenshot_path": ""},
    ]
    data = build_report_pdf(sample)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_report_test.pdf")
    with open(out, "wb") as f:
        f.write(data)
    print(f"OK PDF 생성: {out} ({len(data)} bytes), 불가/낙찰 카드 {len(sample)}건")
