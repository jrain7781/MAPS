# -*- coding: utf-8 -*-
"""
MJ경매 [변경/취소 확인]
- 「변경취소 확인리스트」 폴더의 최신 .txt (또는 env MJ_IMAGEUP_CASES_JSON) 의 사건번호들을
  옥션원에서 조회해 현재 진행 결과(빈값/변경/취소/유찰/매각)를 가져옴.
- 결과는 stdout 에 'RESULT|{json}' 한 줄씩 출력 → 매니저 UI 가 파싱해서 결과표로 렌더.
- 이미지 캡처는 하지 않음. Selenium 일반 모드 (사용자 화면 확인 가능).
"""
print("📢 MJ경매 [변경/취소 확인] (관심물건 조회 → 결과 컬럼만 파싱)...")

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

A1_BASE = "https://www.auction1.co.kr"


def get_newest_list_file():
    if not os.path.isdir(LIST_FOLDER):
        return None
    all_txt = glob.glob(os.path.join(LIST_FOLDER, "*.txt"))
    files = [f for f in all_txt if re.match(r"^\d{14}\.txt$", os.path.basename(f))]
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def read_case_numbers(filepath):
    out = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                if s.startswith("- ") or "경로" in s or "폴더" in s or "다운로드" in s or "====" in s or len(s) > 80:
                    continue
                out.append(s)
    except Exception as e:
        print(f"  ⚠ 파일 읽기 오류: {e}")
    return out


def classify(numbers):
    """경매(타경 or '-' 1개) / 공매('-' 2개 이상) 분리."""
    auc, gng = [], []
    for n in numbers:
        if "타경" in n:
            auc.append(n)
        elif n.count("-") >= 2:
            gng.append(n)
        else:
            auc.append(n)  # 기본 경매로
    return auc, gng


def extract_auction_parts(sakun):
    """경매 사건번호 → (연도, 번호) 분리. '2025타경12345' → ('2025', '12345')"""
    m = re.search(r"(20\d{2})\s*타경\s*(\d+)", sakun)
    if m:
        return m.group(1), m.group(2)
    m = re.search(r"(20\d{2})\s*-\s*(\d+)", sakun)
    if m:
        return m.group(1), m.group(2)
    return "", sakun


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


_STATUS_TOKENS = ["변경", "취소", "유찰", "매각", "낙찰", "정지", "취하", "신건"]


def _scan_status_token(text):
    """행 텍스트에서 결과 토큰 추출 (없으면 '진행중' 으로 간주)."""
    if not text:
        return ""
    for tok in _STATUS_TOKENS:
        if tok in text:
            return tok
    return ""  # 빈값 = 진행중


def _scan_date(text):
    m = re.search(r"(20\d{2})[\.\-/](\d{1,2})[\.\-/](\d{1,2})", text or "")
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def _scan_price(text):
    # 최저가 패턴 (괄호 안 % 옆 숫자 또는 "최저" 옆 숫자)
    m = re.search(r"최저[가]?\s*[:：]?\s*([\d,]+)", text or "")
    if m:
        return m.group(1)
    # fallback: 가장 작은 큰 숫자(천 단위) — 거칠게
    nums = re.findall(r"[\d,]{6,}", text or "")
    return nums[-1] if nums else ""


def find_first_row(driver):
    """관심물건 결과 페이지에서 첫 결과행 element 반환 or None."""
    candidates = driver.find_elements(By.XPATH, "//div[starts-with(@id, 'tr_')] | //tr[starts-with(@id, 'tr_')]")
    for c in candidates:
        try:
            if not c.is_displayed():
                continue
            if c.size.get("height", 0) < 50:
                continue
            txt = c.text or ""
            if "감정가" not in txt:
                continue
            return c
        except Exception:
            continue
    return None


def extract_product_id(driver, row_el):
    try:
        pid = driver.execute_script(
            "var el = arguments[0];"
            "var cb = el.querySelector('input[type=checkbox][value]');"
            "if(cb) return cb.value;"
            "var opt = el.querySelector('[opt]');"
            "if(opt) return opt.getAttribute('opt');"
            "return '';",
            row_el,
        )
        return (pid or "").strip()
    except Exception:
        return ""


def search_case_kauction(driver, wait, sakun):
    """경매 검색: 연도 select + 번호 input."""
    year, num = extract_auction_parts(sakun)
    try:
        if year:
            try:
                sel_el = wait.until(EC.element_to_be_clickable((By.NAME, "num1")))
                Select(sel_el).select_by_value(year)
            except Exception:
                driver.execute_script(
                    f"var s = document.querySelector('select[name=\"num1\"]'); if(s) {{ s.value = '{year}'; s.dispatchEvent(new Event('change')); }}"
                )
            time.sleep(0.3)
        el = wait.until(EC.presence_of_element_located((By.ID, "num2")))
        el.clear()
        el.send_keys(num)
        time.sleep(0.2)
        btn = driver.find_element(By.ID, "btnSrch")
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(2.0)
        return True
    except Exception as e:
        print(f"    ⚠ 경매 검색 오류: {e}")
        return False


def search_case_gongmae(driver, wait, sakun):
    try:
        # 공매 탭 전환
        driver.execute_script("if(document.querySelector('#itype2')) document.querySelector('#itype2').click();")
        time.sleep(0.6)
        el = wait.until(EC.presence_of_element_located((By.ID, "pnum")))
        el.clear()
        el.send_keys(sakun)
        time.sleep(0.2)
        btn = wait.until(EC.element_to_be_clickable((By.ID, "btnSrch")))
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(2.0)
        return True
    except Exception as e:
        print(f"    ⚠ 공매 검색 오류: {e}")
        return False


def reset_search(driver):
    """다음 케이스 검색 전 입력 초기화."""
    try:
        driver.get(f"{A1_BASE}/member/inter_list.php")
        time.sleep(0.8)
    except Exception:
        pass


def parse_and_emit(driver, sakun_no, is_gongmae):
    row = find_first_row(driver)
    if not row:
        miss = {"sakun_no": sakun_no, "status": "조회실패", "bid_date": "", "lowest_price": "", "view_url": ""}
        print(f"RESULT|{json.dumps(miss, ensure_ascii=False)}")
        print("    ⚠ 결과 없음")
        return
    txt = row.text or ""
    status = _scan_status_token(txt)
    bid_date = _scan_date(txt)
    price = _scan_price(txt)
    pid = extract_product_id(driver, row)
    if pid:
        if is_gongmae:
            view_url = f"{A1_BASE}/pubauct/view.php?product_id={pid}"
        else:
            view_url = f"{A1_BASE}/auction/ca_view.php?product_id={pid}"
    else:
        view_url = ""
    rec = {
        "sakun_no": sakun_no,
        "status": status,
        "bid_date": bid_date,
        "lowest_price": price,
        "view_url": view_url,
    }
    print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
    print(f"    → 결과: {status or '진행중'} / 기일: {bid_date} / 최저: {price}")


def main():
    # 사건번호 리스트 결정
    cases = []
    env_cases = os.environ.get("MJ_IMAGEUP_CASES_JSON")
    if env_cases:
        try:
            _loaded = json.loads(env_cases)
            if isinstance(_loaded, list) and _loaded:
                cases = [str(x).strip() for x in _loaded if str(x).strip()]
                print(f"[MJ] CASES env 사용: {len(cases)}건")
        except Exception as e:
            print(f"[MJ] CASES env parse 실패: {e}")
    if not cases:
        p = get_newest_list_file()
        if not p:
            print(f"❌ 「{LIST_FOLDER_NAME}」 폴더에 .txt 파일이 없습니다.\n   경로: {LIST_FOLDER}")
            sys.exit(1)
        print(f"📂 폴더 최신 파일: {os.path.basename(p)}")
        cases = read_case_numbers(p)

    if not cases:
        print("❌ 조회할 사건번호가 없습니다.")
        sys.exit(1)
    if not ACCOUNTS:
        print("❌ 활성 계정 없음 (매니저에서 계정 활성 후 다시 실행)")
        sys.exit(1)

    acc = ACCOUNTS[0]
    auc, gng = classify(cases)
    print(f"🔐 로그인 계정: {acc.get('id')} (저장된 계정 {len(ACCOUNTS)}개 중 첫 번째)")
    print(f"🎯 조회 시작: 경매 {len(auc)}건 / 공매 {len(gng)}건\n")

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1400,900")
    options.add_experimental_option("detach", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)

    try:
        login(driver, acc)
        goto_inter_list(driver)

        # 경매
        for i, sakun in enumerate(auc, 1):
            print(f"[경매 {i}/{len(auc)}] {sakun}")
            reset_search(driver)
            if search_case_kauction(driver, wait, sakun):
                parse_and_emit(driver, sakun, is_gongmae=False)
            else:
                miss = {"sakun_no": sakun, "status": "검색실패", "bid_date": "", "lowest_price": "", "view_url": ""}
                print(f"RESULT|{json.dumps(miss, ensure_ascii=False)}")
            time.sleep(1.8)

        # 공매
        if gng:
            print("\n▶ 공매 전환")
            reset_search(driver)
            for i, sakun in enumerate(gng, 1):
                print(f"[공매 {i}/{len(gng)}] {sakun}")
                if search_case_gongmae(driver, wait, sakun):
                    parse_and_emit(driver, sakun, is_gongmae=True)
                else:
                    miss = {"sakun_no": sakun, "status": "검색실패", "bid_date": "", "lowest_price": "", "view_url": ""}
                    print(f"RESULT|{json.dumps(miss, ensure_ascii=False)}")
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
