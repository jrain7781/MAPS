# -*- coding: utf-8 -*-
"""
MJ경매 [진행사항 확인]
- 입력 한 줄 = "사건번호 | 입찰일자 | 법원(MAPS명)" (MAPS '7일 리스트' 결과).
  (env MJ_IMAGEUP_CASES_JSON 또는 「변경취소 확인리스트」 폴더 최신 .txt)
- ★ 옥션원 종합검색(ca_title.php) 진입 → 사건번호(년도+번호)로 auction_num_ser() 검색
  → 결과행들 중 (주소→법원 일치) AND (매각기일 일치) 행 선택 → 진행상태(td5) 판정.
  (관심물건 inter_list.php 진입 방식 폐기 — 조사물건 크롤러와 동일한 종합검색 경로)
- 진행상태가 법원 진행불가(변경/취소/취하/정지/연기/기각/각하)면 → 불가, 상세 종결문구 파싱.
- 결과는 stdout 에 'RESULT|{json}' 한 줄씩 → 매니저 UI 결과표 렌더.
- 이미지 캡처 없음. Selenium 일반 모드.
"""
print("📢 MJ경매 [진행사항 확인] (종합검색 → 법원·기일 매칭 → 불가사유 판정)...")

import os, sys, json, time, re, glob, traceback
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LIST_FOLDER_NAME = "변경취소 확인리스트"
LIST_FOLDER = os.path.join(SCRIPT_DIR, LIST_FOLDER_NAME)
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


# ── 입력 파싱 ──────────────────────────────────────────────────────────
def get_newest_list_file():
    if not os.path.isdir(LIST_FOLDER):
        return None
    files = [f for f in glob.glob(os.path.join(LIST_FOLDER, "*.txt"))
             if re.match(r"^\d{14}\.txt$", os.path.basename(f))]
    return max(files, key=os.path.getmtime) if files else None


def parse_line(s):
    """'사건번호 | 입찰일자 | 법원' → dict. 구버전(사건번호만) 호환."""
    s = (s or "").strip()
    if not s:
        return None
    if s.startswith("- ") or "경로" in s or "폴더" in s or "다운로드" in s or "====" in s:
        return None
    parts = [p.strip() for p in s.split("|")]
    sakun = parts[0]
    if not sakun or len(sakun) > 60:
        return None
    return {
        "sakun_no": sakun,
        "bid_date": parts[1] if len(parts) > 1 else "",
        "court": parts[2] if len(parts) > 2 else "",
    }


def read_cases_from_file(filepath):
    out = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                d = parse_line(line)
                if d:
                    out.append(d)
    except Exception as e:
        print(f"  ⚠ 파일 읽기 오류: {e}")
    return out


# ── 유틸 ────────────────────────────────────────────────────────────────
def norm_date6(v):
    d = re.sub(r"[^0-9]", "", str(v or ""))
    if len(d) >= 8 and d[:2] == "20":
        d = d[2:]
    if len(d) > 6:
        d = d[-6:]
    return d


def extract_date6(s):
    """매각기일 텍스트에서 날짜만 YYMMDD 추출. '2026.06.01 (10:00)' → '260601'.
    (시각 10:00 까지 숫자로 긁히는 것 방지)"""
    m = re.search(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", str(s or ""))
    if m:
        return m.group(1)[2:] + m.group(2).zfill(2) + m.group(3).zfill(2)
    return norm_date6(s)


def yymmdd_to_full(d6):
    d6 = re.sub(r"[^0-9]", "", str(d6 or ""))
    if len(d6) != 6:
        return ""
    return f"20{d6[:2]}-{d6[2:4]}-{d6[4:6]}"


def year_of(case):
    s = case.get("sakun_no", "")
    m = re.search(r"(20\d{2})\s*타경", s) or re.search(r"^(20\d{2})", s)
    if m:
        return m.group(1)
    nd = norm_date6(case.get("bid_date"))
    if len(nd) == 6:
        return "20" + nd[:2]
    return ""


def case_num2(sakun):
    # 물건번호 '(4)' 는 검색 대상 아님 → 떼고 사건번호만
    s = re.sub(r"\(\s*\d+\s*\)\s*$", "", str(sakun or "")).strip()
    m = re.search(r"타경\s*(\d+)", s) or re.search(r"-\s*(\d+)\s*$", s) or re.search(r"(\d{3,})", s)
    return m.group(1) if m else s


def mulgeon_no(sakun):
    """다물건 물건번호 추출. '2025타경476(4)'/'25-476 (4)' → '4'. 단일물건은 ''."""
    m = re.search(r"\(\s*(\d+)\s*\)", str(sakun or ""))
    return m.group(1) if m else ""


# 진행상태 분류
_BUGA_TOKENS = ["변경", "취소", "취하", "정지", "연기", "기각", "각하"]  # 법원 진행불가
_MAEGAK_TOKENS = ["매각", "낙찰"]
_ING_TOKENS = ["유찰", "신건", "진행", "예정", "재진행"]


def _norm_court(c):
    """법원명 비교용 정규화 — 공백 제거. (MAPS '창원 통영' vs 변환 '창원통영')"""
    return str(c or "").replace(" ", "").strip()


def classify_state(state_text):
    t = state_text or ""
    # 불가 토큰 우선 (매각/유찰보다 먼저 — '허가취소' 등도 불가로)
    for tok in _BUGA_TOKENS:
        if tok in t:
            return "불가", tok
    for tok in _MAEGAK_TOKENS:
        if tok in t:
            return "매각", tok
    for tok in _ING_TOKENS:
        if tok in t:
            return "진행", tok
    return "기타", t.strip().replace("\n", " ")[:20]


def parse_jongryo(detail_text):
    """상세 종결문구에서 사유/문장. '본사건은 ○○(으)로 경매절차가 종결되었습니다'."""
    if not detail_text:
        return "", ""
    m = re.search(r"본사건은\s*(.+?)\s*\(?으?\)?로\s*경매절차가\s*종결", detail_text)
    if m:
        sentence = m.group(0).strip()
        reason_raw = m.group(1).strip()
        for tok in _BUGA_TOKENS + ["배당종결", "대금납부"]:
            if tok in reason_raw:
                return tok, sentence
        return reason_raw, sentence
    return "", ""


def parse_maegak_detail(detail_text, target_d6):
    """매각 상세 '매각가격 결과' 표에서 매각기일==target 행의 매각대금/매수인/입찰자수.
    return: {maegak_price, buyer, bidder_count}."""
    res = {"maegak_price": "", "buyer": "", "bidder_count": ""}
    if not detail_text:
        return res
    full = yymmdd_to_full(target_d6)  # 2026-06-01
    lines = [ln.strip() for ln in detail_text.replace("\r", "").split("\n")]
    idx = -1
    for i, ln in enumerate(lines):
        if full and full in ln:
            idx = i
            break
    chunk = "\n".join(lines[idx: idx + 5]) if idx >= 0 else detail_text
    mp = re.search(r"매각\s*[:：]?\s*([\d,]+)\s*원", chunk)
    if mp:
        res["maegak_price"] = mp.group(1).replace(",", "")
    bc = re.search(r"입찰\s*(\d+)\s*명", chunk)
    if bc:
        res["bidder_count"] = bc.group(1)
    # 매수인: '지역 이름' 형식(예 '경기도 석재근') → 지역 떼고 이름만.
    by = re.search(r"매수인\s*[:：]?\s*([^\n]+)", chunk)
    if by:
        raw = by.group(1).strip()
        raw = raw.split("/")[0].strip()      # 공동매수인('A / B')은 앞 1명
        raw = raw.rstrip(") ").strip()       # 뒤 닫는 괄호/공백 제거
        parts = raw.split()
        res["buyer"] = parts[-1] if parts else raw  # 마지막 토큰 = 이름
    return res


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


def search_case(driver, wait, case, use_date=True):
    """종합검색(ca_title.php): 법원(lawsup)+사건번호(본문 num1/num2)+매각기일+물건현황(전체)
    세팅 → 메인 검색 버튼 native click. use_date=True 면 매각기일(next_biddate)도 지정."""
    year = year_of(case)
    num = case_num2(case["sakun_no"])
    lawsup = court_to_lawsup(case.get("court", ""))
    bid_full = yymmdd_to_full(norm_date6(case.get("bid_date"))) if use_date else ""  # 2026-06-01
    try:
        driver.get(URL_SEARCH)
        try:
            wait.until(EC.presence_of_element_located((By.ID, "num2")))
        except Exception:
            print(f"    ⚠ 검색폼 미발견(로그인 만료?) url={driver.current_url}")
            return False
        driver.execute_script(
            """
            var ls=document.querySelector('select[name="lawsup"]'); if(ls && arguments[2]) ls.value=arguments[2];
            var n1=document.getElementById('num1'); if(n1 && arguments[0]) n1.value=arguments[0];
            var n2=document.getElementById('num2'); if(n2) n2.value=arguments[1];
            var st=document.querySelector('select[name="state"]'); if(st) st.value='';
            var b1=document.getElementById('next_biddate1'), b2=document.getElementById('next_biddate2');
            if(b1) b1.value=arguments[3]||''; if(b2) b2.value=arguments[3]||'';
            """,
            year, num, lawsup, bid_full,
        )
        # 메인 종합검색 '검색' 버튼 = #fm_aulist .btn_lightblack (span text 가 비어있어 XPath 안됨 → CSS)
        btns = driver.find_elements(By.CSS_SELECTOR, "#fm_aulist .btn_lightblack")
        if not btns:
            print("    ⚠ 검색 버튼 못 찾음")
            return False
        btn = btns[0]
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        try:
            btn.click()              # Selenium native(trusted) click — JS click 은 안 먹음
        except Exception:
            driver.execute_script("arguments[0].click();", btn)
        try:
            WebDriverWait(driver, 20).until(lambda d: "ca_list" in d.current_url)
        except Exception:
            pass
        # 결과 행(체크박스) 또는 '없습니다' 가 렌더될 때까지 대기 (고정 sleep 플레이크 방지)
        try:
            WebDriverWait(driver, 12).until(lambda d:
                d.find_elements(By.CSS_SELECTOR, "input[type=checkbox][value]")
                or "없습니다" in (d.find_element(By.TAG_NAME, "body").text or ""))
        except Exception:
            pass
        time.sleep(0.4)
        return True
    except Exception as e:
        print(f"    ⚠ 검색 오류: {repr(e)[:200]}")
        return False


def parse_result_rows(driver):
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
            sakun_txt = (tds[2].text or "").strip()
            out.append({
                "pid": val,
                "line_num": line_num,
                "sakun": sakun_txt,
                "mulgeon": mulgeon_no(sakun_txt),   # 다물건 물건번호 '25-476 (4)' → '4'
                "addr": (tds[3].text or "").strip(),
                "state": (tds[5].text or "").strip(),
                "date6": extract_date6(date_txt),
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


def open_detail_text(driver, view_url):
    try:
        driver.get(view_url)
        time.sleep(1.4)
        return driver.find_element(By.TAG_NAME, "body").text or ""
    except Exception as e:
        print(f"    ⚠ 상세 열기 오류: {e}")
        return ""


def process_case(driver, wait, case):
    exp_court = (case.get("court") or "").strip()
    exp_d6 = norm_date6(case.get("bid_date"))
    exp_lawsup = court_to_lawsup(exp_court)  # 검색에 법원이 적용됐는지 (적용됐으면 결과는 그 법원으로 이미 필터됨)
    base = {
        "item_id": case.get("item_id", ""),
        "sakun_no": case.get("sakun_no", ""),
        "bid_date": case.get("bid_date", ""),
        "court": exp_court,
        "stu_member": case.get("stu_member", ""),  # 현재 MAPS 물건상태
        "bidprice": case.get("bidprice", ""),       # 우리 입찰가(없을 수도)
        "m_name": case.get("m_name", ""),           # 회원명
    }

    if not search_case(driver, wait, case, use_date=True):
        print(f"RESULT|{json.dumps(dict(base, status='', is_buga=False, key_match=False, detail='', view_url='', fetched_court='', date_hit=False, court_hit=False), ensure_ascii=False)}")
        return

    rows = parse_result_rows(driver)
    # 매각기일까지 넣어 0건이면(변경/취하로 기일 바뀐 경우) 날짜 빼고 재검색
    if not rows:
        print("    ↻ 매각기일 일치 0건 → 날짜 제외 재검색")
        if search_case(driver, wait, case, use_date=False):
            rows = parse_result_rows(driver)
    if not rows:
        print(f"RESULT|{json.dumps(dict(base, status='조회없음', is_buga=False, key_match=False, detail='', view_url='', fetched_court='', date_hit=False, court_hit=False), ensure_ascii=False)}")
        print("    ⚠ 결과 행 없음")
        return

    line_tnum = len(rows)
    exp_mulgeon = mulgeon_no(case.get("sakun_no", ""))  # 다물건 물건번호 '(4)'
    # (법원 일치) AND (매각기일 일치) [AND 물건번호 일치] 행 선택
    # 법원은 검색 단계 lawsup 으로 이미 필터됨 → court_hit=True 신뢰. (미매핑만 주소대조)
    picked = None
    for r in rows:
        fc = addr_to_court(r["addr"])
        r["_fc"] = fc
        if exp_lawsup:
            r["_court_hit"] = True
        else:
            r["_court_hit"] = bool(exp_court) and (_norm_court(fc) == _norm_court(exp_court))
        r["_date_hit"] = bool(exp_d6) and (r["date6"] == exp_d6)
        mul_ok = (not exp_mulgeon) or (r.get("mulgeon", "") == exp_mulgeon)  # 다물건이면 물건번호까지 일치
        if r["_court_hit"] and r["_date_hit"] and mul_ok:
            picked = r
            break
    # 물건번호 일치 우선 fallback
    if not picked and exp_mulgeon:
        for r in rows:
            if r.get("mulgeon", "") == exp_mulgeon:
                picked = r
                break
    if not picked:
        for r in rows:
            if r["_date_hit"]:
                picked = r
                break
    if not picked:
        picked = rows[0]

    state_kind, tok = classify_state(picked["state"])
    fetched_court = picked.get("_fc", "")
    court_hit = picked.get("_court_hit", False)
    date_hit = picked.get("_date_hit", False)
    key_match = court_hit and date_hit

    reason = ""
    sentence = ""
    view_url = ""
    maegak_price = ""
    buyer = ""
    bidder_count = ""
    # 불가/매각 모두 상세페이지에서 추가 정보 파싱
    if state_kind in ("불가", "매각"):
        view_url = build_view_url(driver, picked["pid"], picked["line_num"], line_tnum)
        detail_txt = open_detail_text(driver, view_url)
        if state_kind == "불가":
            reason = tok
            jr, js = parse_jongryo(detail_txt)
            if jr:
                reason = jr
            sentence = js
        else:  # 매각 → 매각가/매수인/입찰자수
            md = parse_maegak_detail(detail_txt, exp_d6)
            maegak_price = md["maegak_price"]
            buyer = md["buyer"]
            bidder_count = md["bidder_count"]

    is_buga = (state_kind == "불가")
    rec = dict(base,
               status=reason if is_buga else (state_kind if state_kind in ("매각",) else ""),
               state_kind=state_kind,
               state_raw=picked["state"].replace("\n", " "),
               detail=sentence,
               is_buga=is_buga,
               key_match=key_match,
               sakun_hit=True,          # 사건번호로 검색해 행을 찾음 = 사건번호 일치
               fetched_court=fetched_court,
               fetched_date=picked.get("date_txt", ""),
               date_hit=date_hit,
               court_hit=court_hit,
               maegak_price=maegak_price,
               buyer=buyer,
               bidder_count=bidder_count,
               view_url=view_url)
    print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
    flag = "✅" if key_match else "⚠키불일치"
    print(f"    → {flag} 상태:{state_kind}/{reason or tok} 법원:{fetched_court}({'=' if court_hit else '≠'}{exp_court}) 기일일치:{date_hit}")


def main():
    cases = []
    env_cases = os.environ.get("MJ_IMAGEUP_CASES_JSON")
    if env_cases:
        try:
            _loaded = json.loads(env_cases)
            if isinstance(_loaded, list):
                for x in _loaded:
                    d = parse_line(x) if isinstance(x, str) else (x if isinstance(x, dict) and x.get("sakun_no") else None)
                    if d:
                        cases.append(d)
                print(f"[MJ] CASES env 사용: {len(cases)}건")
        except Exception as e:
            print(f"[MJ] CASES env parse 실패: {e}")
    if not cases:
        p = get_newest_list_file()
        if not p:
            print(f"❌ 「{LIST_FOLDER_NAME}」 폴더에 .txt 파일이 없습니다.\n   경로: {LIST_FOLDER}")
            sys.exit(1)
        print(f"📂 폴더 최신 파일: {os.path.basename(p)}")
        cases = read_cases_from_file(p)

    if not cases:
        print("❌ 조회할 사건번호가 없습니다.")
        sys.exit(1)
    if not ACCOUNTS:
        print("❌ 활성 계정 없음 (매니저에서 계정 활성 후 다시 실행)")
        sys.exit(1)

    acc = ACCOUNTS[0]
    print(f"🔐 로그인 계정: {acc.get('id')}")
    print(f"🎯 진행사항 확인 시작: {len(cases)}건 (종합검색 → 법원·기일 매칭)\n")

    options = webdriver.ChromeOptions()
    # 기본은 창 표시(사용자가 봐야 함). MJ_IMAGEUP_HEADLESS=1 일 때만 숨김.
    if os.environ.get("MJ_IMAGEUP_HEADLESS", "0") == "1":
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        print("[MJ] headless 모드 (창 숨김)")
    options.add_argument("--window-size=1400,900")
    options.add_experimental_option("detach", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)
    try:
        login(driver, acc)
        for i, case in enumerate(cases, 1):
            print(f"[진행사항 {i}/{len(cases)}] {case['sakun_no']} | {case.get('bid_date')} | {case.get('court')}")
            try:
                process_case(driver, wait, case)
            except Exception as e:
                print(f"    ❌ 처리 오류: {e}")
                print(f"RESULT|{json.dumps(dict(case, status='오류', is_buga=False, key_match=False, detail='', view_url=''), ensure_ascii=False)}")
            time.sleep(1.6)
        print(f"\n✅ 완료: 총 {len(cases)}건 조회")
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
