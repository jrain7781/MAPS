# -*- coding: utf-8 -*-
"""
MJ경매 [매각확인]
- 입력 한 줄 = case dict: {item_id, sakun_no, bid_date(YYMMDD), court(MAPS법원명), our_bidprice, m_name}
  (env MJ_IMAGEUP_CASES_JSON — 매니저 「매각」 탭의 'getTodayMaegakList' 결과)
- 옥션원 종합검색을 사건번호(년도+번호)로 auction_num_ser() 호출 → 결과행들 중
  (주소→법원 일치) AND (매각기일 일치) 인 행을 선택 → 진행상태(td5) 판정.
- 매각건이면 상세페이지의 '매각가격 결과' 표에서 해당 매각기일 행의
  매각대금 / 매수인 / 입찰자수 를 파싱.
- 결과는 stdout 에 'RESULT|{json}' 한 줄씩 → 매니저 UI 가 파싱해 결과표로 렌더.
- 이미지 캡처 없음. Selenium 일반 모드.
"""
print("📢 MJ경매 [매각확인] (오늘 입찰건 → 매각대금/매수인 조회)...")

import os, sys, json, time, re, traceback
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
A1_BASE = "https://www.auction1.co.kr"
URL_SEARCH = f"{A1_BASE}/auction/ca_title.php"

# 법원 변환: 옥션 결과 주소 → MAPS 법원명
try:
    from court_jurisdiction import find_court as _find_court, _JURISDICTION_MAP
    def addr_to_court(addr_text):
        try:
            first = (addr_text or "").strip().splitlines()[0] if addr_text else ""
            c = _find_court(first, _JURISDICTION_MAP)
            return (c or "").strip()
        except Exception:
            return ""
    print("[MJ] court_jurisdiction 로드 OK")
except Exception as _e:
    print(f"[MJ] court_jurisdiction 로드 실패(법원검증 생략): {_e}")
    def addr_to_court(addr_text):
        return ""

# MAPS 법원명 → 옥션 lawsup 코드 (종합검색 법원 드롭다운 지정용)
try:
    from court_lawsup import court_to_lawsup
except Exception as _e:
    print(f"[MJ] court_lawsup 로드 실패(법원 미지정 검색): {_e}")
    def court_to_lawsup(c):
        return ""

# 계정 (매니저 주입)
ACCOUNTS = []
_env_acc = os.environ.get("MJ_IMAGEUP_ACCOUNTS_JSON")
if _env_acc:
    try:
        _loaded = json.loads(_env_acc)
        if isinstance(_loaded, list) and _loaded:
            ACCOUNTS = _loaded
            print(f"[MJ] ACCOUNTS env: {len(ACCOUNTS)}개")
    except Exception as e:
        print(f"[MJ] ACCOUNTS env parse 실패: {e}")


# ── 유틸 ────────────────────────────────────────────────────────────────
def norm_date6(v):
    """입찰일자 → yymmdd 6자리. '2026-06-01'/'260601'/'20260601'/'2026.06.01' 처리."""
    d = re.sub(r"[^0-9]", "", str(v or ""))
    if len(d) >= 8 and d[:2] == "20":
        d = d[2:]
    if len(d) > 6:
        d = d[-6:]
    return d


def yymmdd_to_full(d6):
    """260601 → 2026-06-01 (상세표 매칭용)."""
    d6 = re.sub(r"[^0-9]", "", str(d6 or ""))
    if len(d6) != 6:
        return ""
    return f"20{d6[:2]}-{d6[2:4]}-{d6[4:6]}"


def year_of(case):
    """검색 연도(4자리): 사건번호 '20XX타경' 우선, 없으면 입찰일자."""
    s = case.get("sakun_no", "")
    m = re.search(r"(20\d{2})\s*타경", s) or re.search(r"^(20\d{2})", s)
    if m:
        return m.group(1)
    nd = norm_date6(case.get("bid_date"))
    if len(nd) == 6:
        return "20" + nd[:2]
    return ""


def case_num2(sakun):
    """사건번호 일련번호(타경/하이픈 뒷부분)."""
    m = re.search(r"타경\s*(\d+)", sakun) or re.search(r"-\s*(\d+)\s*$", sakun) or re.search(r"(\d{3,})", sakun)
    return m.group(1) if m else sakun


# 진행상태 분류 토큰
_MAEGAK_TOKENS = ["매각", "낙찰"]                       # 매각완료
_BUGA_TOKENS = ["변경", "취소", "취하", "정지", "연기", "기각", "각하"]  # 법원 진행불가
_ING_TOKENS = ["유찰", "신건", "진행", "예정", "재진행"]   # 진행중


def _norm_court(c):
    """법원명 비교용 정규화 — 공백 제거. (MAPS '창원 통영' vs 변환 '창원통영')"""
    return str(c or "").replace(" ", "").strip()


def classify_state(state_text):
    t = state_text or ""
    for tok in _MAEGAK_TOKENS:
        if tok in t:
            return "매각", tok
    for tok in _BUGA_TOKENS:
        if tok in t:
            return "불가", tok
    for tok in _ING_TOKENS:
        if tok in t:
            return "진행", tok
    return "기타", t.strip().replace("\n", " ")[:20]


# ── 옥션 ───────────────────────────────────────────────────────────────
def login(driver, account):
    driver.get(f"{A1_BASE}/common/login_box.php")
    wait = WebDriverWait(driver, 15)
    wait.until(EC.presence_of_element_located((By.ID, "client_id")))
    driver.execute_script(
        """
        document.getElementById('client_id').value = arguments[0];
        var d = document.getElementById('pw_Dummy');
        var r = document.getElementById('passwd');
        if(d) d.style.display = 'none';
        if(r) { r.style.display = 'block'; r.value = arguments[1]; }
        """,
        account["id"], account["pw"],
    )
    try:
        driver.find_element(By.XPATH, "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]").click()
    except Exception:
        driver.find_element(By.ID, "passwd").send_keys(Keys.RETURN)
    time.sleep(2)


def search_case(driver, wait, case):
    """종합검색(ca_title.php): 법원(lawsup)+사건번호(본문 num1/num2)+물건현황(전체) 세팅
    → 메인 검색 버튼 실제 클릭. (auction_num_ser 은 법원 무시 → 사용 안 함)"""
    year = year_of(case)
    num = case_num2(case["sakun_no"])
    lawsup = court_to_lawsup(case.get("court", ""))
    try:
        driver.get(URL_SEARCH)
        wait.until(EC.presence_of_element_located((By.ID, "num2")))
        driver.execute_script(
            """
            var ls=document.querySelector('select[name="lawsup"]'); if(ls && arguments[2]) ls.value=arguments[2];
            var n1=document.getElementById('num1'); if(n1 && arguments[0]) n1.value=arguments[0];
            var n2=document.getElementById('num2'); if(n2) n2.value=arguments[1];
            var st=document.querySelector('select[name="state"]'); if(st) st.value='';
            """,
            year, num, lawsup,
        )
        btn = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//form[@id='fm_aulist']//*[normalize-space(text())='검색' and contains(@class,'btn_lightblack')]")))
        try:
            btn.click()
        except Exception:
            driver.execute_script("arguments[0].scrollIntoView({block:'center'}); arguments[0].click();", btn)
        try:
            WebDriverWait(driver, 20).until(lambda d: "ca_list" in d.current_url)
        except Exception:
            pass
        time.sleep(1.2)
        return True
    except Exception as e:
        print(f"    ⚠ 검색 오류: {e}")
        return False


def parse_result_rows(driver):
    """결과행 파싱 → [{pid, line_num, sakun, addr, state, date6, date_txt}]."""
    out = []
    cbs = driver.find_elements(By.CSS_SELECTOR, "input[type=checkbox][value]")
    for cb in cbs:
        try:
            val = (cb.get_attribute("value") or "").strip()
            if not re.match(r"^\d{4,}$", val):
                continue
            tr = cb.find_element(By.XPATH, "./ancestor::tr[1]")
            tds = tr.find_elements(By.TAG_NAME, "td")
            if len(tds) < 8:
                continue
            line_num = ""
            try:
                ln = tds[0].find_element(By.CSS_SELECTOR, "input[name='line_num']")
                line_num = (ln.get_attribute("value") or "").strip()
            except Exception:
                pass
            date_txt = (tds[6].text or "").strip()
            out.append({
                "pid": val,
                "line_num": line_num,
                "sakun": (tds[2].text or "").strip(),
                "addr": (tds[3].text or "").strip(),
                "state": (tds[5].text or "").strip(),
                "date6": norm_date6(date_txt),
                "date_txt": date_txt.replace("\n", " "),
            })
        except Exception:
            continue
    return out


def build_view_url(driver, pid, line_num, line_tnum):
    try:
        ssid = driver.execute_script("return (typeof user_ssid!=='undefined')?String(user_ssid):'';") or ""
    except Exception:
        ssid = ""
    parts = [f"product_id={pid}"]
    if line_num:
        parts.append(f"line_num={line_num}")
    if line_tnum:
        parts.append(f"line_tnum={line_tnum}")
    if ssid:
        parts.append(f"user_ssid={ssid}")
    parts.append("person_hide=0")
    return f"{A1_BASE}/auction/ca_view.php?" + "&".join(parts)


def parse_maegak_detail(driver, view_url, target_d6):
    """상세페이지 '매각가격 결과' 표에서 매각기일==target 행의 매각대금/매수인/입찰자수.
    return: {maegak_price, buyer, bidder_count, pct} (없으면 빈값)."""
    res = {"maegak_price": "", "buyer": "", "bidder_count": "", "pct": ""}
    full = yymmdd_to_full(target_d6)  # 2026-06-01
    try:
        driver.get(view_url)
        time.sleep(1.4)
        body = driver.find_element(By.TAG_NAME, "body").text or ""
    except Exception as e:
        print(f"    ⚠ 상세 열기 오류: {e}")
        return res
    lines = [ln.strip() for ln in body.replace("\r", "").split("\n")]
    # target 매각기일이 들어간 줄 찾기 → 이후 몇 줄을 묶어 파싱
    idx = -1
    for i, ln in enumerate(lines):
        if full and full in ln:
            idx = i
            break
    if idx < 0:
        # fallback: 전체에서 첫 '매각 : 금액' (가장 최근 차수가 보통 아래쪽이지만 안전상 target 우선)
        chunk = body
    else:
        chunk = "\n".join(lines[idx: idx + 5])
    mp = re.search(r"매각\s*[:：]?\s*([\d,]+)\s*원", chunk)
    if mp:
        res["maegak_price"] = mp.group(1).replace(",", "")
    pc = re.search(r"\(\s*([\d.]+)\s*%\s*\)", chunk)
    if pc:
        res["pct"] = pc.group(1)
    bc = re.search(r"입찰\s*(\d+)\s*명", chunk)
    if bc:
        res["bidder_count"] = bc.group(1)
    by = re.search(r"매수인\s*[:：]?\s*([^\)\n]+)", chunk)
    if by:
        res["buyer"] = by.group(1).strip()
    return res


def process_case(driver, wait, case):
    exp_court = (case.get("court") or "").strip()
    exp_d6 = norm_date6(case.get("bid_date"))
    exp_lawsup = court_to_lawsup(exp_court)  # 검색에 법원 적용됐는지 (적용 시 결과는 이미 그 법원)
    base = {
        "item_id": case.get("item_id", ""),
        "sakun_no": case.get("sakun_no", ""),
        "bid_date": case.get("bid_date", ""),
        "court": exp_court,
        "our_bidprice": case.get("our_bidprice", ""),
        "m_name": case.get("m_name", ""),
    }

    if not search_case(driver, wait, case):
        print(f"RESULT|{json.dumps(dict(base, status='검색실패', matched=False), ensure_ascii=False)}")
        return

    rows = parse_result_rows(driver)
    if not rows:
        print(f"RESULT|{json.dumps(dict(base, status='조회없음', matched=False), ensure_ascii=False)}")
        print("    ⚠ 결과 행 없음")
        return

    line_tnum = len(rows)
    # (법원 일치) AND (매각기일 일치) 행 선택
    # 법원은 검색 단계 lawsup 으로 이미 필터됨 → court_hit=True 신뢰. (미매핑만 주소대조)
    picked = None
    for r in rows:
        fc = addr_to_court(r["addr"])
        court_hit = True if exp_lawsup else (bool(exp_court) and (_norm_court(fc) == _norm_court(exp_court)))
        date_hit = bool(exp_d6) and (r["date6"] == exp_d6)
        r["_fetched_court"] = fc
        r["_court_hit"] = court_hit
        r["_date_hit"] = date_hit
        if court_hit and date_hit:
            picked = r
            break
    # fallback: 날짜만 일치(법원 변환 실패 대비) → 그 다음 첫 행
    if not picked:
        for r in rows:
            if r["_date_hit"]:
                picked = r
                break
    if not picked:
        picked = rows[0]

    state_kind, reason = classify_state(picked["state"])
    rec = dict(base,
               status=state_kind,           # 매각 / 불가 / 진행 / 기타
               state_raw=picked["state"].replace("\n", " "),
               reason=reason,
               fetched_court=picked.get("_fetched_court", ""),
               court_hit=picked.get("_court_hit", False),
               date_hit=picked.get("_date_hit", False),
               fetched_date=picked["date_txt"],
               maegak_price="", buyer="", bidder_count="", view_url="")

    if state_kind == "매각":
        view_url = build_view_url(driver, picked["pid"], picked["line_num"], line_tnum)
        rec["view_url"] = view_url
        det = parse_maegak_detail(driver, view_url, exp_d6)
        rec["maegak_price"] = det["maegak_price"]
        rec["buyer"] = det["buyer"]
        rec["bidder_count"] = det["bidder_count"]

    print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
    flag = "✅매각" if state_kind == "매각" else ("⚠" + state_kind)
    print(f"    → {flag} 법원:{rec['fetched_court']}({'=' if rec['court_hit'] else '≠'}{exp_court}) 기일일치:{rec['date_hit']} "
          f"매각대금:{rec['maegak_price']} 매수인:{rec['buyer']} 입찰:{rec['bidder_count']}명")


def main():
    cases = []
    env_cases = os.environ.get("MJ_IMAGEUP_CASES_JSON")
    if env_cases:
        try:
            _loaded = json.loads(env_cases)
            if isinstance(_loaded, list):
                for x in _loaded:
                    if isinstance(x, dict) and x.get("sakun_no"):
                        cases.append(x)
                print(f"[MJ] CASES env 사용: {len(cases)}건")
        except Exception as e:
            print(f"[MJ] CASES env parse 실패: {e}")

    if not cases:
        print("❌ 조회할 오늘 입찰건이 없습니다. (매니저 「매각」 탭에서 '오늘 매각 불러오기' 후 실행)")
        sys.exit(1)
    if not ACCOUNTS:
        print("❌ 활성 계정 없음 (매니저에서 계정 활성 후 다시 실행)")
        sys.exit(1)

    acc = ACCOUNTS[0]
    print(f"🔐 로그인 계정: {acc.get('id')}")
    print(f"🎯 매각확인 시작: {len(cases)}건 (오늘 입찰건)\n")

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1400,900")
    options.add_experimental_option("detach", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)
    try:
        login(driver, acc)
        for i, case in enumerate(cases, 1):
            print(f"[매각 {i}/{len(cases)}] {case.get('sakun_no')} | {case.get('bid_date')} | {case.get('court')}")
            try:
                process_case(driver, wait, case)
            except Exception as e:
                print(f"    ❌ 처리 오류: {e}")
                print(f"RESULT|{json.dumps(dict(case, status='오류', matched=False), ensure_ascii=False)}")
            time.sleep(1.5)
        print(f"\n✅ 완료: 총 {len(cases)}건")
    except Exception as e:
        traceback.print_exc()
        print(f"❌ 오류: {e}")
    finally:
        try:
            time.sleep(2)
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
