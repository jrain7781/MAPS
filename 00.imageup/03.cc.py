# -*- coding: utf-8 -*-
"""
MJ경매 [불가확인]
- 입력 한 줄 = "사건번호 | 입찰일자 | 법원(MAPS명)" (MAPS '~7일 리스트 다운' 결과).
  (env MJ_IMAGEUP_CASES_JSON 또는 「변경취소 확인리스트」 폴더 최신 .txt)
- 옥션원은 사건번호로만 검색되므로: 사건번호+연도로 검색 → 결과의 주소를 court_jurisdiction 으로
  MAPS 법원명으로 변환 → (사건번호·입찰일자·법원) 3키 일치 검증 → 일치 시 종결사유/상세 파싱.
- 결과는 stdout 에 'RESULT|{json}' 한 줄씩 출력 → 매니저 UI 가 파싱해 결과표로 렌더.
- 이미지 캡처는 하지 않음. Selenium 일반 모드.
- ⚠ 옥션원 실제 DOM(주소/종결문구/기일) 셀렉터는 로컬 테스트하며 보정 필요.
"""
print("📢 MJ경매 [불가확인] (사건번호 검색 → 3키 일치 검증 → 종결사유 파싱)...")

import os, sys, json, time, re, glob, traceback
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LIST_FOLDER_NAME = "변경취소 확인리스트"
LIST_FOLDER = os.path.join(SCRIPT_DIR, LIST_FOLDER_NAME)
A1_BASE = "https://www.auction1.co.kr"

# 법원 변환: 옥션 결과 주소 → MAPS 법원명 (crawler.py 와 동일 방식)
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

# 계정 — env override (MJ 매니저에서 주입)
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


def norm_date(v):
    """입찰일자 → 비교용 yymmdd 6자리 숫자. '2026-07-13'/'260713'/'20260713' 모두 처리."""
    d = re.sub(r"[^0-9]", "", str(v or ""))
    if len(d) == 8:   # yyyymmdd
        return d[2:]
    if len(d) >= 6:
        return d[:6]
    return d


def year_of(case):
    """검색 연도(4자리): 사건번호의 '20XX타경' 우선, 없으면 입찰일자에서."""
    m = re.search(r"(20\d{2})\s*타경", case.get("sakun_no", "")) or re.search(r"^(20\d{2})", case.get("sakun_no", ""))
    if m:
        return m.group(1)
    nd = norm_date(case.get("bid_date"))
    if len(nd) == 6:
        return "20" + nd[:2]
    return ""


def case_num2(sakun):
    """사건번호에서 일련번호(타경 뒷부분/하이픈 뒷부분)."""
    m = re.search(r"타경\s*(\d+)", sakun) or re.search(r"-\s*(\d+)", sakun) or re.search(r"(\d{3,})", sakun)
    return m.group(1) if m else sakun


def classify(cases):
    auc, gng = [], []
    for c in cases:
        n = c.get("sakun_no", "")
        if "타경" in n:
            auc.append(c)
        elif n.count("-") >= 2:
            gng.append(c)
        else:
            auc.append(c)
    return auc, gng


# ── 옥션 ───────────────────────────────────────────────────────────────
def login(driver, account):
    driver.get(f"{A1_BASE}/common/login_box.php")
    wait = WebDriverWait(driver, 15)
    wait.until(EC.presence_of_element_located((By.ID, "client_id")))
    driver.execute_script(
        f"""
        document.getElementById('client_id').value = {json.dumps(account['id'])};
        var d = document.getElementById('pw_Dummy');
        var r = document.getElementById('passwd');
        if(d) d.style.display = 'none';
        if(r) {{ r.style.display = 'block'; r.value = {json.dumps(account['pw'])}; }}
        """
    )
    try:
        driver.find_element(By.XPATH, "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]").click()
    except Exception:
        driver.find_element(By.ID, "passwd").send_keys(Keys.RETURN)
    time.sleep(2)


def goto_inter_list(driver):
    driver.get(f"{A1_BASE}/member/inter_list.php")
    time.sleep(1.0)


def reset_search(driver):
    try:
        driver.get(f"{A1_BASE}/member/inter_list.php")
        time.sleep(0.8)
    except Exception:
        pass


def search_kauction(driver, wait, case):
    """경매 검색: 연도(num1) + 번호(num2)."""
    year = year_of(case)
    num = case_num2(case["sakun_no"])
    try:
        if year:
            try:
                Select(wait.until(EC.element_to_be_clickable((By.NAME, "num1")))).select_by_value(year)
            except Exception:
                driver.execute_script(
                    f"var s=document.querySelector('select[name=\"num1\"]'); if(s){{s.value='{year}'; s.dispatchEvent(new Event('change'));}}"
                )
            time.sleep(0.3)
        el = wait.until(EC.presence_of_element_located((By.ID, "num2")))
        el.clear(); el.send_keys(num); time.sleep(0.2)
        driver.execute_script("arguments[0].click();", driver.find_element(By.ID, "btnSrch"))
        time.sleep(2.0)
        return True
    except Exception as e:
        print(f"    ⚠ 경매 검색 오류: {e}")
        return False


def search_gongmae(driver, wait, case):
    try:
        driver.execute_script("if(document.querySelector('#itype2')) document.querySelector('#itype2').click();")
        time.sleep(0.6)
        el = wait.until(EC.presence_of_element_located((By.ID, "pnum")))
        el.clear(); el.send_keys(case["sakun_no"]); time.sleep(0.2)
        driver.execute_script("arguments[0].click();", wait.until(EC.element_to_be_clickable((By.ID, "btnSrch"))))
        time.sleep(2.0)
        return True
    except Exception as e:
        print(f"    ⚠ 공매 검색 오류: {e}")
        return False


def find_first_row(driver):
    cands = driver.find_elements(By.XPATH, "//div[starts-with(@id,'tr_')] | //tr[starts-with(@id,'tr_')]")
    for c in cands:
        try:
            if c.is_displayed() and c.size.get("height", 0) >= 50 and "감정가" in (c.text or ""):
                return c
        except Exception:
            continue
    return None


def extract_product_id(driver, row_el):
    try:
        pid = driver.execute_script(
            "var el=arguments[0];var cb=el.querySelector('input[type=checkbox][value]');"
            "if(cb)return cb.value;var opt=el.querySelector('[opt]');if(opt)return opt.getAttribute('opt');return '';",
            row_el)
        return (pid or "").strip()
    except Exception:
        return ""


_STATUS_TOKENS = ["취하", "취소", "변경", "정지", "연기", "기각", "각하", "유찰", "매각", "낙찰", "신건"]
# 불가(법원 진행불가) 로 간주할 사유
_BUGA_TOKENS = ["변경", "취소", "취하", "정지", "연기", "기각", "각하"]


def parse_jongryo(detail_text):
    """종결문구에서 사유 추출. '본사건은 ○○(으)로 경매절차가 종결되었습니다' → (사유, 문장)."""
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


def scan_token(text, tokens):
    for tok in tokens:
        if tok in (text or ""):
            return tok
    return ""


def scan_address(text):
    """결과/상세 텍스트에서 소재지(주소) 한 줄 추출."""
    if not text:
        return ""
    m = re.search(r"(?:소재지|주소)\s*[:：]?\s*([^\n]+)", text)
    if m:
        return m.group(1).strip()
    # fallback: 시/도로 시작하는 줄
    for ln in text.splitlines():
        if re.match(r"^\s*(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)", ln.strip()):
            return ln.strip()
    return ""


def open_detail_text(driver, pid, is_gongmae):
    """상세(view) 페이지 열어 body 텍스트 반환 (주소/종결문구/기일 파싱용)."""
    if not pid:
        return "", ""
    url = (f"{A1_BASE}/pubauct/view.php?product_id={pid}" if is_gongmae
           else f"{A1_BASE}/auction/ca_view.php?product_id={pid}")
    try:
        driver.get(url)
        time.sleep(1.5)
        body = driver.find_element(By.TAG_NAME, "body").text or ""
        return body, url
    except Exception as e:
        print(f"    ⚠ 상세 열기 오류: {e}")
        return "", url


def verify_and_emit(driver, case, is_gongmae):
    row = find_first_row(driver)
    if not row:
        rec = dict(case, status="조회실패", key_match=False, detail="", view_url="", fetched_court="", fetched_date="")
        print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
        print("    ⚠ 결과 없음")
        return
    row_txt = row.text or ""
    pid = extract_product_id(driver, row)
    detail_txt, view_url = open_detail_text(driver, pid, is_gongmae)
    full_txt = (row_txt + "\n" + detail_txt).strip()

    # 종결사유 우선, 없으면 결과 토큰
    reason, sentence = parse_jongryo(detail_txt)
    if not reason:
        reason = scan_token(full_txt, _STATUS_TOKENS)
    # 법원/주소 변환
    addr = scan_address(full_txt)
    fetched_court = addr_to_court(addr)
    # 기일(입찰일자) — 페이지에 expected 기일이 존재하는지
    exp_date = norm_date(case.get("bid_date"))
    date_hit = bool(exp_date) and (exp_date in re.sub(r"[^0-9]", "", full_txt) or
                                   any(norm_date(d) == exp_date for d in re.findall(r"20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}", full_txt)))

    exp_court = (case.get("court") or "").strip()
    court_hit = bool(exp_court) and bool(fetched_court) and (fetched_court == exp_court)

    key_match = bool(exp_date == "" or date_hit) and bool(exp_court == "" or court_hit)

    is_buga = reason in _BUGA_TOKENS
    rec = {
        "sakun_no": case.get("sakun_no", ""),
        "bid_date": case.get("bid_date", ""),
        "court": exp_court,
        "status": reason,           # 불가사유 (변경/취소/취하/...) — 진행중이면 ''
        "detail": sentence,         # 종결문구 원문
        "is_buga": is_buga,
        "key_match": key_match,
        "fetched_court": fetched_court,
        "date_hit": date_hit,
        "court_hit": court_hit,
        "view_url": view_url,
    }
    print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
    flag = "✅" if key_match else "⚠키불일치"
    print(f"    → {flag} 사유:{reason or '진행중'} / 법원:{fetched_court}({'=' if court_hit else '≠'}{exp_court}) / 기일일치:{date_hit}")


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
    auc, gng = classify(cases)
    print(f"🔐 로그인 계정: {acc.get('id')}")
    print(f"🎯 조회 시작: 경매 {len(auc)}건 / 공매 {len(gng)}건 (3키 검증)\n")

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1400,900")
    options.add_experimental_option("detach", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)
    try:
        login(driver, acc)
        goto_inter_list(driver)
        for i, case in enumerate(auc, 1):
            print(f"[경매 {i}/{len(auc)}] {case['sakun_no']} | {case.get('bid_date')} | {case.get('court')}")
            reset_search(driver)
            if search_kauction(driver, wait, case):
                verify_and_emit(driver, case, is_gongmae=False)
            else:
                print(f"RESULT|{json.dumps(dict(case, status='검색실패', key_match=False, detail='', view_url=''), ensure_ascii=False)}")
            time.sleep(1.8)
        if gng:
            print("\n▶ 공매 전환")
            reset_search(driver)
            for i, case in enumerate(gng, 1):
                print(f"[공매 {i}/{len(gng)}] {case['sakun_no']}")
                if search_gongmae(driver, wait, case):
                    verify_and_emit(driver, case, is_gongmae=True)
                else:
                    print(f"RESULT|{json.dumps(dict(case, status='검색실패', key_match=False, detail='', view_url=''), ensure_ascii=False)}")
                time.sleep(1.8)
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
