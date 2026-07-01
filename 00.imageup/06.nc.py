# -*- coding: utf-8 -*-
"""
MJ경매 [낙찰 카페등록 크롤]
- 입력: 낙찰건 키 = "사건번호 | 입찰일자(매각기일) | 법원". (env MJ_IMAGEUP_CASES_JSON)
- ★ 04.cc.py(진행사항 확인)의 로그인·종합검색·행매칭·매각파싱·상세캡처 로직을 그대로 재사용
  (importlib 로 모듈 로드만; 04 원본은 절대 수정하지 않음).
- 04 와의 유일한 차이: 조사내용을 관심물건 편집폼 textarea(#fm_inter) 의 value 로 직접 취득.
  (본문 텍스트 슬라이싱/‘N회차’ 마커 방식은 취약 → textarea 가 조사내용만 깔끔히 담고 있음)
- 결과: 'RESULT|{json}' 한 줄 — sakun/buyer/bid/cnt/date/addr/josa/screenshot_path 등.
  → 매니저 낙찰카페등록 탭이 받아 NakchalCafe.fill() 로 카드 자동 생성.
- 낙찰(매각) 건 전용. Selenium 일반 모드(창 표시, MJ_IMAGEUP_HEADLESS=1 이면 숨김).
"""
print("🏆 MJ경매 [낙찰 카페등록 크롤] (종합검색 → 키매칭 → 매각결과 + 조사내용 textarea)...")

import os, sys, json, time, traceback, importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))


# ── 04.cc.py 모듈 로드 (원본 미변경 재사용) ─────────────────────────────
def _load_cc():
    """'04.cc.py' 는 숫자로 시작해 일반 import 불가 → importlib 로 파일 경로 로드.
    04 의 top-level(import/print/ACCOUNTS env 파싱/법원표 로드)만 실행되며 main() 은 __main__ 가드라 안 돎."""
    path = os.path.join(_HERE, "04.cc.py")
    spec = importlib.util.spec_from_file_location("cc_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

cc = _load_cc()

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager


# ── 조사내용 = 관심물건 등록 메모(로그인 계정 것) = ca_view 편집폼 textarea value ──
def get_interest_josa(driver):
    """ca_view 상세페이지의 관심물건 편집폼 textarea(#fm_inter) value 를 그대로 반환.
    이 textarea 는 조사내용만 담고 있어(감정평가/배당요구종기일 등 물건데이터 미포함) 슬라이싱 불필요.
    해당 계정의 관심물건이 아니면 폼/텍스트가 없어 '' 반환."""
    for sel in ("#fm_inter textarea", "textarea.ta600", "#ly_inter textarea"):
        try:
            ta = driver.find_element(By.CSS_SELECTOR, sel)
            v = (driver.execute_script("return arguments[0].value;", ta) or "").strip()
            if v:
                return v
        except Exception:
            continue
    return ""


def process_nakchal(driver, wait, case):
    """단건: 종합검색 → (법원·기일[·물건번호]) 매칭행 선택 → 상세 열어 매각결과+조사내용 취득."""
    exp_court = (case.get("court") or "").strip()
    exp_d6 = cc.norm_date6(case.get("bid_date"))
    exp_lawsup = cc.court_to_lawsup(exp_court)
    sakun = case.get("sakun_no", "")
    base = {
        "sakun_no": sakun,
        "bid_date": case.get("bid_date", ""),
        "court": exp_court,
        "item_id": case.get("item_id", ""),
        "member": case.get("m_name", ""),   # 회원명(있으면 카드에 자동)
    }

    if not cc.search_case(driver, wait, case, use_date=bool(exp_d6)):
        print(f"RESULT|{json.dumps(dict(base, ok=False, err='검색실패'), ensure_ascii=False)}")
        return

    rows = cc.collect_rows_paged(driver)
    if not rows and exp_d6:
        print("    ↻ 매각기일 일치 0건 → 날짜 제외 재검색")
        if cc.search_case(driver, wait, case, use_date=False):
            rows = cc.collect_rows_paged(driver)
    if not rows:
        print(f"RESULT|{json.dumps(dict(base, ok=False, err='결과없음'), ensure_ascii=False)}")
        print("    ⚠ 결과 행 없음")
        return

    line_tnum = len(rows)
    exp_mulgeon = cc.mulgeon_no(sakun)   # 다물건 물건번호 '(4)'
    # (법원 일치) AND (매각기일 일치) [AND 물건번호 일치] — 04.process_case 와 동일 규칙
    picked = None
    for r in rows:
        fc = cc.addr_to_court(r["addr"]); r["_fc"] = fc
        court_hit = True if exp_lawsup else (bool(exp_court) and cc._norm_court(fc) == cc._norm_court(exp_court))
        date_hit = bool(exp_d6) and (r["date6"] == exp_d6)
        mul_ok = (not exp_mulgeon) or (r.get("mulgeon", "") == exp_mulgeon)
        r["_court_hit"], r["_date_hit"] = court_hit, date_hit
        if court_hit and date_hit and mul_ok:
            picked = r; break
    if not picked and exp_mulgeon:
        for r in rows:
            if r.get("mulgeon", "") == exp_mulgeon:
                picked = r; break
    if not picked:
        for r in rows:
            if r.get("_date_hit"):
                picked = r; break
    if not picked:
        picked = rows[0]

    state_kind, tok = cc.classify_state(picked["state"])
    court_hit = picked.get("_court_hit", False)
    date_hit = picked.get("_date_hit", False)

    view_url = cc.build_view_url(driver, picked["pid"], picked["line_num"], line_tnum)
    detail_txt = cc.open_detail_text(driver, view_url)     # 상세로 이동(그 페이지에 textarea 존재)
    josa = get_interest_josa(driver)                        # ★ 조사내용 = textarea value
    if state_kind == "매각":
        md = cc.parse_maegak_detail(detail_txt, exp_d6)     # {maegak_price, buyer, bidder_count}
    else:
        md = {"maegak_price": "", "buyer": "", "bidder_count": ""}
    shot = cc.capture_detail(driver, f"nc_{cc.case_num2(sakun)}", sakun)  # 사건조회 이미지

    rec = dict(base,
               ok=True,
               state_kind=state_kind,
               key_match=(court_hit and date_hit),
               court_hit=court_hit, date_hit=date_hit,
               bid=md.get("maegak_price", ""),      # 낙찰가
               buyer=md.get("buyer", ""),           # 매수인(마스킹은 프론트에서)
               cnt=md.get("bidder_count", ""),      # 입찰인원
               date=(picked.get("date_txt", "") or case.get("bid_date", "")),  # 매각기일
               addr=picked.get("addr", ""),
               josa=josa,
               josa_len=len(josa),
               screenshot_path=shot,
               view_url=view_url)
    print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
    flag = "✅" if (court_hit and date_hit) else "⚠키불일치"
    print(f"    → {flag} 상태:{state_kind} 매수인:{md.get('buyer','')} 낙찰가:{md.get('maegak_price','')} 조사내용:{len(josa)}자 캡처:{'O' if shot else 'X'}")


def main():
    raw = []
    ev = os.environ.get("MJ_IMAGEUP_CASES_JSON")
    if ev:
        try:
            raw = json.loads(ev)
        except Exception as e:
            print(f"[NC] cases parse 실패: {e}")
    # 입력 정규화: 문자열('사건번호 | 입찰일자 | 법원')과 dict 둘 다 허용
    cases = []
    for c in (raw or []):
        if isinstance(c, str):
            d = cc.parse_line(c)
            if d:
                cases.append(d)
        elif isinstance(c, dict) and (c.get("sakun_no") or "").strip():
            cases.append(c)
    if not cases:
        print("❌ 조회할 사건번호가 없습니다.")
        sys.exit(1)
    if not cc.ACCOUNTS:
        print("❌ 활성 계정 없음 (매니저에서 낙찰 계정 활성 후 실행)")
        sys.exit(1)

    acc = cc.ACCOUNTS[0]
    print(f"🔐 로그인 계정: {acc.get('id')}  (조사내용은 이 계정의 관심물건 등록내용)")
    print(f"🏆 낙찰 카페등록 크롤 시작: {len(cases)}건\n")

    options = webdriver.ChromeOptions()
    if os.environ.get("MJ_IMAGEUP_HEADLESS", "0") == "1":
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        print("[NC] headless 모드")
    options.add_argument("--window-size=1400,900")
    options.add_argument("--force-device-scale-factor=3")   # 캡처 고해상도
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)
    try:
        cc.login(driver, acc)
        for i, case in enumerate(cases, 1):
            print(f"[낙찰 {i}/{len(cases)}] {case.get('sakun_no')} | {case.get('bid_date')} | {case.get('court')}")
            try:
                process_nakchal(driver, wait, case)
            except Exception as e:
                traceback.print_exc()
                print(f"RESULT|{json.dumps(dict(sakun_no=case.get('sakun_no',''), ok=False, err=str(e)), ensure_ascii=False)}")
            time.sleep(1.4)
        print(f"\n✅ 완료: 총 {len(cases)}건")
    except Exception as e:
        traceback.print_exc()
        print(f"❌ 오류: {e}")
    finally:
        try:
            time.sleep(1.5)
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
