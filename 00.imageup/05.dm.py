# -*- coding: utf-8 -*-
"""
MJ경매 [다물건 데이터 크롤]
- 입력 한 줄 = "사건번호" 또는 "사건번호 | 법원(MAPS명)". (env MJ_IMAGEUP_CASES_JSON, 보통 1건)
- 옥션원 종합검색(ca_title.php)으로 그 사건의 '모든 물건'(물건번호 (1)(2)(3)…)을 열거.
  (04.cc.py 의 검증된 검색/페이지네이션/상태분류 로직 재사용. 단, cc 처럼 한 행만 고르지 않고 전부 출력.)
- 각 물건: 입찰일자 / 법원(주소→변환) / 사건번호(+물건번호) / 매각·진행·불가 / 주소 / 건물면적 / 최저가 / 보증금.
- 결과는 stdout 'RESULT|{json}' 한 줄씩 → 매니저 다물건 탭 결과표 렌더. 이미지 캡처 없음.
"""
print("📢 MJ경매 [다물건 데이터 크롤] (종합검색 → 사건의 모든 물건 → 매각/진행/불가 + 필드)...")

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

# MAPS 법원명 → 옥션 lawsup 코드
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


# ── 입력 ────────────────────────────────────────────────────────────────
def parse_case_line(s):
    """'사건번호' 또는 '사건번호 | 법원' → {sakun_no, court}."""
    s = (s or "").strip()
    if not s or s.startswith("- "):
        return None
    parts = [p.strip() for p in s.split("|")]
    sakun = parts[0]
    if not sakun or len(sakun) > 60:
        return None
    return {"sakun_no": sakun, "court": parts[1] if len(parts) > 1 else ""}


def read_cases():
    env = os.environ.get("MJ_IMAGEUP_CASES_JSON")
    out = []
    if env:
        try:
            arr = json.loads(env)
            if isinstance(arr, list):
                for x in arr:
                    if isinstance(x, dict):
                        d = {"sakun_no": str(x.get("sakun_no") or "").strip(), "court": str(x.get("court") or "").strip()}
                        if d["sakun_no"]:
                            out.append(d)
                    else:
                        d = parse_case_line(str(x))
                        if d:
                            out.append(d)
        except Exception as e:
            print(f"[MJ] CASES env parse 실패: {e}")
    return out


# ── 유틸 (04.cc.py 재사용) ────────────────────────────────────────────────
def norm_date6(v):
    d = re.sub(r"[^0-9]", "", str(v or ""))
    if len(d) >= 8 and d[:2] == "20":
        d = d[2:]
    if len(d) > 6:
        d = d[-6:]
    return d


def extract_date6(s):
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
    return m.group(1) if m else ""


def case_num2(sakun):
    s = re.sub(r"\(\s*\d+\s*\)\s*$", "", str(sakun or "")).strip()
    m = re.search(r"타경\s*(\d+)", s) or re.search(r"-\s*(\d+)\s*$", s) or re.search(r"(\d{3,})", s)
    return m.group(1) if m else s


def mulgeon_no(sakun):
    m = re.search(r"\(\s*(\d+)\s*\)", str(sakun or ""))
    return m.group(1) if m else ""


_BUGA_TOKENS = ["변경", "취소", "취하", "정지", "연기", "기각", "각하"]
_MAEGAK_TOKENS = ["매각", "낙찰"]
_ING_TOKENS = ["유찰", "신건", "진행", "예정", "재진행"]


def classify_state(state_text):
    t = state_text or ""
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


def parse_price_cell(txt):
    """결과표 td[4](감정가/최저가/평당) → 최저가 숫자(콤마 제거)."""
    t = txt or ""
    m = re.search(r"최\s*저\s*가?\s*[^\d]{0,8}([1-9][\d,]{3,})", t)
    if m:
        return m.group(1).replace(",", "")
    nums = [n.replace(",", "") for n in re.findall(r"([1-9][\d,]{3,})", t)]
    if len(nums) >= 2:
        return nums[1]   # 보통 감정가, 최저가 순
    return nums[0] if nums else ""


def parse_appraisal_cell(txt):
    """결과표 td[4] → 감정가 숫자(콤마 제거). 보통 첫 금액 = 감정가."""
    t = txt or ""
    m = re.search(r"감\s*정\s*가?\s*[^\d]{0,8}([1-9][\d,]{3,})", t)
    if m:
        return m.group(1).replace(",", "")
    nums = [n.replace(",", "") for n in re.findall(r"([1-9][\d,]{3,})", t)]
    return nums[0] if nums else ""


def prop_kind_of(sakun_txt):
    """td[2](사건번호 셀) 에서 물건종류 추출. 사건번호/물건번호 줄 제외, 한글 물건종류 줄."""
    lines = [l.strip() for l in str(sakun_txt or "").split("\n") if l.strip()]
    for l in lines[1:]:
        if "타경" in l:
            continue
        if re.fullmatch(r"\(?\d+\)?", l):   # 물건번호 (4) 등
            continue
        return l
    return ""


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
    """종합검색: 법원(lawsup, 있으면)+사건번호(num1/num2) → 그 사건의 모든 물건. (날짜 필터 없음)"""
    year = year_of(case)
    num = case_num2(case["sakun_no"])
    lawsup = court_to_lawsup(case.get("court", ""))
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
            if(b1) b1.value=''; if(b2) b2.value='';
            var sc=document.querySelector('[name="scale"]');
            if(sc){ sc.value='100'; try{ sc.dispatchEvent(new Event('change')); }catch(e){} }
            else { var f=document.getElementById('fm_aulist'); if(f){ var h=document.createElement('input'); h.type='hidden'; h.name='scale'; h.value='100'; f.appendChild(h); } }
            var od=document.querySelector('select[name="order"]');
            if(od){ od.value='num1,num2,p_num ASC'; try{ od.dispatchEvent(new Event('change')); }catch(e){} }
            """,
            year, num, lawsup,
        )
        btns = driver.find_elements(By.CSS_SELECTOR, "#fm_aulist .btn_lightblack")
        if not btns:
            print("    ⚠ 검색 버튼 못 찾음")
            return False
        btn = btns[0]
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        try:
            btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", btn)
        try:
            WebDriverWait(driver, 20).until(lambda d: "ca_list" in d.current_url)
        except Exception:
            pass
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
    """결과행 → [{pid, line_num, sakun, mulgeon, addr, state, lowest, date6, date_txt}]"""
    out = []
    cbs = driver.find_elements(By.CSS_SELECTOR, "input[type=checkbox][value]")
    for cb in cbs:
        try:
            val = (cb.get_attribute("value") or "").strip()
            if not re.match(r"^\d{4,}$", val):
                continue
            tr = cb.find_element(By.XPATH, "./ancestor::tr[1]")
            tds = tr.find_elements(By.TAG_NAME, "td")
            if len(tds) < 7:
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
                "mulgeon": mulgeon_no(sakun_txt),
                "prop_kind": prop_kind_of(sakun_txt),     # 물건종류 (사건번호 아래 줄)
                "addr": (tds[3].text or "").strip(),
                "state": (tds[5].text or "").strip(),
                "lowest": parse_price_cell(tds[4].text or ""),
                "gamjungga": parse_appraisal_cell(tds[4].text or ""),   # 감정가
                "date6": extract_date6(date_txt),
                "date_txt": date_txt.replace("\n", " "),
            })
        except Exception:
            continue
    return out


def collect_rows_paged(driver, max_pages=15):
    rows = parse_result_rows(driver)
    seen_starts = {0}
    for _ in range(max_pages - 1):
        next_url, next_start = None, None
        try:
            links = driver.find_elements(By.CSS_SELECTOR, "div.pagn a")
        except Exception:
            links = []
        for a in links:
            href = a.get_attribute("href") or ""
            m = re.search(r"[?&]start=(\d+)", href)
            if not m:
                continue
            s = int(m.group(1))
            if s in seen_starts:
                continue
            if next_start is None or s < next_start:
                next_start, next_url = s, href
        if next_url is None:
            break
        seen_starts.add(next_start)
        try:
            driver.get(next_url)
            WebDriverWait(driver, 10).until(lambda d:
                d.find_elements(By.CSS_SELECTOR, "input[type=checkbox][value]")
                or "없습니다" in (d.find_element(By.TAG_NAME, "body").text or ""))
            time.sleep(0.3)
        except Exception:
            break
        rows += parse_result_rows(driver)
    return rows


_DETAIL_CACHE = {}
def fetch_detail_extra(driver, pid):
    """상세(ca_view.php)에서 보증금 + 건물면적 추출. return (deposit, building_area)."""
    if not pid:
        return "", ""
    if pid in _DETAIL_CACHE:
        return _DETAIL_CACHE[pid]
    url = f"{A1_BASE}/auction/ca_view.php?product_id={pid}"
    deposit = area = ""
    try:
        driver.set_script_timeout(15)
        html = driver.execute_async_script(
            "const url=arguments[0],cb=arguments[arguments.length-1];"
            "fetch(url,{credentials:'include'})"
            ".then(r=>r.arrayBuffer())"
            ".then(buf=>new TextDecoder('euc-kr').decode(buf))"
            ".then(t=>cb(t))"
            ".catch(e=>cb('FETCH_ERR:'+(e&&e.message||e)));",
            url
        ) or ""
        if not html.startswith("FETCH_ERR"):
            # 보증금 (03.k.py 패턴)
            for pat in [
                r'보\s*증\s*금[\s\S]{0,300}?\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)[\s\S]{0,50}?([1-9][\d,]{4,})',
                r'보\s*증\s*금\s*</(?:th|td)>\s*<(?:th|td)[^>]*>[\s\S]{0,200}?([1-9][\d,]{4,})',
            ]:
                m = re.search(pat, html)
                if m:
                    deposit = m.group(1).replace(",", "")
                    break
            # 건물면적: '건물' 라벨 뒤 첫 ㎡ 수치 (없으면 전용/연면적)
            for pat in [
                r'건\s*물[\s\S]{0,120}?([\d,]+\.?\d*)\s*(?:㎡|m²|m2)',
                r'전용\s*면적[\s\S]{0,60}?([\d,]+\.?\d*)\s*(?:㎡|m²|m2)',
                r'연\s*면\s*적[\s\S]{0,60}?([\d,]+\.?\d*)\s*(?:㎡|m²|m2)',
            ]:
                m = re.search(pat, html)
                if m:
                    area = m.group(1).replace(",", "") + "㎡"
                    break
    except Exception as e:
        print(f"      ⚠ 상세 fetch 오류 pid={pid}: {e}")
    _DETAIL_CACHE[pid] = (deposit, area)
    return deposit, area


def process_case(driver, wait, case):
    sakun_in = case.get("sakun_no", "")
    if not search_case(driver, wait, case):
        print(f"RESULT|{json.dumps({'sakun_in': sakun_in, 'error': '검색실패'}, ensure_ascii=False)}")
        return
    rows = collect_rows_paged(driver)
    if not rows:
        print(f"RESULT|{json.dumps({'sakun_in': sakun_in, 'error': '조회없음'}, ensure_ascii=False)}")
        print("    ⚠ 결과 행 없음")
        return
    print(f"    → 물건 {len(rows)}건 수집")
    base = str(sakun_in or "").strip()
    for r in rows:
        state_kind, tok = classify_state(r["state"])
        court = addr_to_court(r["addr"])
        addr = r["addr"].replace("\n", " ")
        # 사건번호 정규화: 입력 기준 + 물건번호 (예: 2023타경919(4)). 단일물건은 물건번호 없음.
        canonical = base + (f"({r['mulgeon']})" if r["mulgeon"] else "")
        # 건물면적: 주소 대괄호 '[건물 18.89㎡]' 우선, 없으면 상세에서.
        m_area = re.search(r"건물\s*([\d.]+)\s*(?:㎡|m²|m2)", addr)
        deposit, det_area = fetch_detail_extra(driver, r["pid"])
        area = (m_area.group(1) + "㎡") if m_area else det_area
        rec = {
            "sakun_in": sakun_in,
            "sakun_no": canonical,             # 등록/대조용 정규화 사건번호(+물건번호)
            "sakun_raw": r["sakun"].split("\n")[0].strip(),  # 옥션 원문(참고)
            "mulgeon": r["mulgeon"],
            "prop_kind": r.get("prop_kind", ""),   # 물건종류 (아파트/오피스텔 등)
            "in_date": yymmdd_to_full(r["date6"]),
            "date_txt": r["date_txt"],
            "court": court,
            "address": addr,
            "building_area": area,
            "lowest_price": r["lowest"],
            "gamjungga": r.get("gamjungga", ""),   # 감정가
            "deposit": deposit,
            "state": state_kind,               # 매각/진행/불가/기타
            "state_raw": r["state"].replace("\n", " "),
            "pid": r["pid"],
        }
        print(f"RESULT|{json.dumps(rec, ensure_ascii=False)}")
        print(f"    · {canonical} [{state_kind}] {court} 최저 {r['lowest']} 보증 {deposit} 면적 {area}")
        time.sleep(0.2)


def main():
    cases = read_cases()
    if not cases:
        print("❌ 사건번호 입력 없음 (env MJ_IMAGEUP_CASES_JSON)")
        return
    if not ACCOUNTS:
        print("❌ 계정 없음 (env MJ_IMAGEUP_ACCOUNTS_JSON)")
        return
    acc = ACCOUNTS[0]
    print(f"🔐 로그인 계정: {acc.get('id')}")
    print(f"🎯 다물건 크롤 시작: {len(cases)}건\n")

    options = webdriver.ChromeOptions()
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
            print(f"[다물건 {i}/{len(cases)}] {case['sakun_no']} | {case.get('court')}")
            try:
                process_case(driver, wait, case)
            except Exception as e:
                print(f"    ❌ 처리 오류: {e}")
                print(f"RESULT|{json.dumps({'sakun_in': case.get('sakun_no',''), 'error': str(e)}, ensure_ascii=False)}")
            time.sleep(1.2)
        print(f"\n✅ 완료: 총 {len(cases)}건")
    except Exception as e:
        traceback.print_exc()
        print(f"❌ 오류: {e}")
    finally:
        try:
            time.sleep(1)
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
