# -*- coding: utf-8 -*-
"""
MJ경매 건별 캡처: 리스트 파일의 사건번호만 관심물건에서 조회 후 캡처.
- 사건번호에 "타경" 포함 = 경매 → #num2에 타경 뒷부분만 입력, 검색, 모두 캡처
- 사건번호에 "-" 포함 = 공매 → 공매 선택 후 #pnum에 전체 입력, 검색, 모두 캡처
"""
print("📢 MJ경매 [건별 캡처] (리스트 파일 사건번호 → 관심물건 조회 → 모두 캡처)...")

import base64
import time
import os
import re
import traceback
import datetime
import glob
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# 배치 파일이 있는 폴더 = 스크립트 폴더
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LIST_FOLDER_NAME = "건별 캡쳐 리스트"
LIST_FOLDER = os.path.join(SCRIPT_DIR, LIST_FOLDER_NAME)

ACCOUNTS = [
    {"id": "mjgold",   "pw": "28471296",   "manager": "대표님"},
    {"id": "mjjang1",  "pw": "28471298",   "manager": "대표님"},
    {"id": "jjhsm81",  "pw": "marlboro81!!", "manager": "전제혁"}
]
BASE_SAVE_DIR = r"G:\내 드라이브\MAPS\mapsimage"

# 법원 관할 매칭: 재미나이 정리 스크립트 기반 (court_jurisdiction 모듈 사용)
from court_jurisdiction import get_court_from_text

SELECTOR_ID = "client_id"
SELECTOR_PW_DUMMY = "pw_Dummy"
SELECTOR_PW_REAL = "passwd"
SELECTOR_LOGIN_BTN = "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]"
SKIP_KEYWORDS = ["나의 분류관리", "엑셀저장", "매각기일 변경공지", "정렬/보기", "검색"]


def remove_popups_css(driver):
    try:
        driver.execute_script("""
            var styles = `
                #inter_popup, .layer, .popup, div[id^='layer'], div[class*='popup'], #div_pop_back {
                    display: none !important; visibility: hidden !important; opacity: 0 !important;
                    pointer-events: none !important; z-index: -9999 !important;
                }
            `;
            var s = document.createElement("style"); s.innerText = styles; document.head.appendChild(s);
        """)
        time.sleep(0.5)
    except:
        pass


def capture_combined_element(driver, header_element, table_element, file_path):
    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", header_element)
        time.sleep(0.2)
        rect_h = driver.execute_script("return arguments[0].getBoundingClientRect();", header_element)
        rect_t = driver.execute_script("return arguments[0].getBoundingClientRect();", table_element)
        scroll_x = driver.execute_script("return window.pageXOffset;")
        scroll_y = driver.execute_script("return window.pageYOffset;")
        x = rect_t['left'] + scroll_x
        y = rect_h['top'] + scroll_y
        width = rect_t['width']
        height = (rect_t['top'] + rect_t['height']) - rect_h['top']
        if width <= 0 or height <= 0:
            return False
        screenshot_base64 = driver.execute_cdp_cmd("Page.captureScreenshot", {
            "clip": {"x": x, "y": y, "width": width, "height": height, "scale": 1},
            "captureBeyondViewport": True, "format": "png"
        })
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(screenshot_base64['data']))
        return True
    except:
        return False


def extract_reg_date(header_text):
    """헤더에서 등록일(YY.MM.DD) 파싱 → datetime.date 반환"""
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{2})", header_text)
    if m:
        yy, mm, dd = m.groups()
        try:
            return datetime.date(2000 + int(yy), int(mm), int(dd))
        except:
            pass
    return None


def extract_smart_date(header_text, type_prefix, reg_date=None):
    """날짜 추출 → (파일명용 YYMMDD 문자열, datetime.date or None) 반환"""
    today_year = datetime.datetime.now().year

    # [1] 공매 전용: "02.23 14:00~02.25 17:00" → ~ 뒤 종료일 사용
    if type_prefix == "공매":
        end_match = re.search(r"~\s*(\d{1,2})[\./](\d{1,2})", header_text)
        if end_match:
            em, ed = int(end_match.group(1)), int(end_match.group(2))
            # 년도 확정: 등록일 월 > 입찰 종료월이면 다음 연도
            if reg_date:
                year = (reg_date.year + 1) if reg_date.month > em else reg_date.year
            else:
                year = today_year
            try:
                bid_date = datetime.date(year, em, ed)
                return f"{str(year)[2:]}{str(em).zfill(2)}{str(ed).zfill(2)}", bid_date
            except:
                pass

        # fallback: end_date_match (단순 ~ 패턴)
        end_date_match = re.search(r"~\s*(?:20\d{2}[\./])?(\d{1,2})[\./](\d{1,2})", header_text)
        if end_date_match:
            month, day = end_date_match.groups()
            return f"{str(today_year)[2:]}{month.zfill(2)}{day.zfill(2)}", None

        gongmae_pattern = re.search(r"(?<!\d\.)(?<!\d)(?:0[1-9]|1[0-2])[\./](?:[0-2][0-9]|3[01])(?!\d)", header_text)
        if gongmae_pattern:
            mm_dd = gongmae_pattern.group()
            month, day = re.split(r"[\./]", mm_dd)
            return f"{str(today_year)[2:]}{month.zfill(2)}{day.zfill(2)}", None

    # [2] 경매: 전체 날짜 (2025.02.14 또는 25.02.14 또는 2026-02-26)
    full_date_match = re.search(r"(?:20)?(\d{2})[\.-](\d{1,2})[\.-](\d{1,2})", header_text)
    if full_date_match:
        yy, mm, dd = full_date_match.groups()
        try:
            year = 2000 + int(yy)
            bid_date = datetime.date(year, int(mm), int(dd))
            return f"{yy}{mm.zfill(2)}{dd.zfill(2)}", bid_date
        except:
            pass

    return "000000", None


def get_newest_list_file():
    """건별 캡쳐 리스트 폴더에서 가장 최신 리스트 파일 경로 반환. (YYYYMMDDHHMMSS.txt 형식만, README 등 제외)"""
    if not os.path.isdir(LIST_FOLDER):
        return None
    all_txt = glob.glob(os.path.join(LIST_FOLDER, "*.txt"))
    # 이미지캡쳐로 받는 파일명만: 숫자 14자리 + .txt
    files = [f for f in all_txt if re.match(r"^\d{14}\.txt$", os.path.basename(f))]
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def read_case_numbers(filepath):
    """파일에서 사건번호 목록 읽기 (한 줄에 하나). README/안내 문장은 제외."""
    out = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                # 안내 문장 제외: "- " 로 시작하거나, "경로" "폴더" "다운로드" 등 포함
                if s.startswith("- ") or "경로" in s or "폴더" in s or "다운로드" in s or "====" in s or len(s) > 80:
                    continue
                out.append(s)
    except Exception as e:
        print(f"  ⚠ 파일 읽기 오류: {e}")
    return out


def classify_case_numbers(numbers):
    """
    경매/공매 구분 규칙:
    - "타경" 포함 → 경매
    - "-" 하나만 포함 → 경매 (예: 2025-11157)
    - "-" 2개 이상 포함 → 공매 (예: 2024-12345-001)
    """
    gongmae = []
    k_auction = []
    for n in numbers:
        if "타경" in n:
            k_auction.append(n)
        else:
            dash_count = n.count("-")
            if dash_count == 1:
                k_auction.append(n)  # 하이픈 1개 = 경매
            elif dash_count >= 2:
                gongmae.append(n)    # 하이픈 2개 이상 = 공매
    return k_auction, gongmae


def extract_auction_parts(sakun_no):
    """
    경매용: 사건번호에서 연도(num1)와 일련번호(num2) 추출
    예: 2024타경1234 -> ('2024', '1234')
    """
    s = re.sub(r"\([^)]*\)", "", sakun_no)  # 괄호 제거
    year = ""
    num = ""

    # 연도 추출: 4자리 숫자 + 타경 또는 4자리 숫자 + 하이픈
    m_year = re.search(r"(\d{4})\s*타경", s) or re.search(r"^(\d{4})", s)
    if m_year:
        year = m_year.group(1)

    # 일련번호 추출
    # "타경" 뒷부분 숫자
    m_num = re.search(r"타경\s*(\d+)", s)
    if m_num:
        num = m_num.group(1).strip()
    else:
        # 하이픈 뒷부분 숫자
        m_num = re.search(r"-(\d+)", s)
        if m_num:
            num = m_num.group(1).strip()
        else:
            # 기타
            num = re.sub(r"[^\d]", "", s)

    return year, num


# ==============================================================================
# 건별: 검색 결과 전부 캡처 (메모 필터 없음)
# ==============================================================================
def process_list_page_capture_all(driver, save_dir, type_prefix, suffix="", manager=""):
    print(f"    ▶ [{type_prefix}] 분석 중...")
    try:
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "table")))
    except:
        pass

    # XPATH로 1차 필터링
    table_xpath = "//table[contains(., '사건번호') or contains(., '관리번호')]"
    all_tables = driver.find_elements(By.XPATH, table_xpath)
    
    candidates = []
    for item in all_tables:
        try:
            if not item.is_displayed(): continue
            if item.size['height'] < 50: continue
            
            text = item.text
            if not text: continue
            
            # [핵심] 모드 교차 검증
            if type_prefix == "경매":
                if "타경" not in text: continue
            elif type_prefix == "공매":
                if "타경" in text: continue
                
            if "감정가" in text and not any(k in text for k in SKIP_KEYWORDS):
                candidates.append(item)
        except: continue

    count = 0
    for i, item in enumerate(candidates):
        try:
            full_text = item.text
            try:
                header_element = item.find_element(By.XPATH, "preceding-sibling::*[1]")
                header_text = header_element.text + " " + full_text.split("\n")[0]
            except:
                header_text = full_text.split("\n")[0]
                header_element = item

            pattern = r"20\d{2}-\d+[\d-]*(?:\(\d+\))?|20\d{2}\ud0c0\uacbd\d+[\d()]*"
            match = re.search(pattern, full_text) or re.search(pattern, header_text)
            
            raw_sakun = match.group() if match else f"번호미상{i}"
            
            # 사건번호 정규화: 하이픈 개수에 따른 엄격한 분류
            dash_count = raw_sakun.count("-")
            if dash_count == 1:
                sakun_no = raw_sakun.replace("-", "타경")
            elif dash_count >= 2:
                sakun_no = raw_sakun.split()[0] if " " in raw_sakun else raw_sakun
            elif type_prefix == "경매":
                sakun_no = raw_sakun.replace("-", "타경")
            else:
                sakun_no = raw_sakun.split()[0]

            # 등록일 파싱
            reg_date = extract_reg_date(header_text)

            # 날짜 추출 + 입찰일 스킵 체크
            bid_date_str, bid_date_obj = extract_smart_date(header_text, type_prefix, reg_date)
            if bid_date_obj and bid_date_obj <= datetime.date.today():
                print(f"    ⏭ 입찰일 {bid_date_obj} <= 오늘, 스킵")
                continue

            court_name = "공매" if type_prefix == "공매" else get_court_from_text(full_text)

            # 안전한 파일명
            safe_sakun = re.sub(r'[_]', "-", sakun_no)
            safe_sakun = re.sub(r'[\\/*?:"<>|]', "", safe_sakun)
            safe_court = re.sub(r'[_]', "-", court_name)
            safe_court = re.sub(r'[\\/*?:"<>|]', "", safe_court)
            
            filename = f"{safe_sakun}_{bid_date_str}_{safe_court}_{manager}.png"
            file_path = os.path.join(save_dir, filename)
            
            if capture_combined_element(driver, header_element, item, file_path):
                print(f"    - 📸 저장: {filename}")
                count += 1
        except Exception as e:
            continue
    return count


def run_macro(account, list_filepath):
    user_id = account["id"]
    user_pw = account["pw"]
    manager = account.get("manager", "")
    driver = None
    numbers = read_case_numbers(list_filepath)
    if not numbers:
        print(f"  ⚠ [{user_id}] 사건번호가 없습니다.")
        return
    k_auction_list, gongmae_list = classify_case_numbers(numbers)
    print(f"\n🚀 계정 [{user_id}] 건별 캡처 시작 (경매 {len(k_auction_list)}건, 공매 {len(gongmae_list)}건)")
    os.makedirs(BASE_SAVE_DIR, exist_ok=True)

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--force-device-scale-factor=1")
    options.add_argument("--disable-gpu")
    options.add_experimental_option("detach", True)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)

    try:
        driver.get("https://www.auction1.co.kr/common/login_box.php")
        remove_popups_css(driver)
        wait.until(EC.presence_of_element_located((By.ID, SELECTOR_ID)))
        driver.execute_script(f"""
            document.getElementById('{SELECTOR_ID}').value = '{user_id}';
            var d = document.getElementById('{SELECTOR_PW_DUMMY}');
            var r = document.getElementById('{SELECTOR_PW_REAL}');
            if(d) d.style.display = 'none';
            if(r) {{ r.style.display = 'block'; r.value = '{user_pw}'; }}
        """)
        try:
            driver.find_element(By.XPATH, SELECTOR_LOGIN_BTN).click()
        except:
            driver.find_element(By.ID, SELECTOR_PW_REAL).send_keys(Keys.RETURN)
        time.sleep(2)

        driver.get("https://www.auction1.co.kr/member/inter_list.php")
        remove_popups_css(driver)
        time.sleep(1)

        # 경매: 연도(num1) 선택 + 사건번호(num2) 입력 → 검색 → 모두 캡처
        for idx, sakun in enumerate(k_auction_list):
            year_val, num2_val = extract_auction_parts(sakun)
            print(f"  ▶ [경매] 사건번호 입력: {sakun} → #num1={year_val}, #num2={num2_val}")
            try:
                # 연도 선택
                if year_val:
                    try:
                        print(f"    - 연도 선택 시도: {year_val} (#num1)")
                        # 명시적 대기: 요소가 나타나고 활성화될 때까지
                        select_el = wait.until(EC.element_to_be_clickable((By.NAME, "num1")))
                        sel = Select(select_el)
                        sel.select_by_value(year_val)
                        print(f"    - 연도 선택 완료: {year_val}")
                        time.sleep(0.3) # 선택 반영 대기
                    except Exception as e_sel:
                        print(f"    - 연도 선택 실패 (Select 클래스): {e_sel}")
                        try:
                            # JS로 강제 설정 (마지막 수단)
                            driver.execute_script(f"var s = document.querySelector('select[name=\"num1\"]'); if(s) {{ s.value = '{year_val}'; s.dispatchEvent(new Event('change')); }}")
                            print(f"    - 연도 선택 시도 (JS): {year_val}")
                        except:
                            pass
                
                # 번호 입력
                el = wait.until(EC.presence_of_element_located((By.ID, "num2")))
                el.clear()
                el.send_keys(num2_val)
                print(f"    - 번호 입력 완료: {num2_val} (#num2)")
                time.sleep(0.3)
                
                search_btn = driver.find_element(By.ID, "btnSrch")
                driver.execute_script("arguments[0].click();", search_btn)
                print(f"    - [검색] 버튼 클릭")
                
                time.sleep(2.5) # 검색 결과 로딩 충분히 대기
                n = process_list_page_capture_all(driver, BASE_SAVE_DIR, "경매", suffix=str(idx + 1) if len(k_auction_list) > 1 else "", manager=manager)
                print(f"    ✅ {n}건 캡처")
            except Exception as e:
                print(f"    ❌ 오류: {e}")

        # 공매: itype2 선택 후 #pnum 전체 입력 → 검색 → 모두 캡처
        if gongmae_list:
            print("  ▶ [공매] 전환...")
            try:
                driver.execute_script("if(document.querySelector('#itype2')) document.querySelector('#itype2').click();")
                time.sleep(1)
                remove_popups_css(driver)
            except Exception as e:
                print(f"    ❌ 공매 전환 오류: {e}")
            for idx, sakun in enumerate(gongmae_list):
                print(f"  ▶ [공매] 사건번호 입력: {sakun}")
                try:
                    el = driver.find_element(By.ID, "pnum")
                    el.clear()
                    el.send_keys(sakun)
                    time.sleep(0.3)
                    # 검색 버튼 클릭 (JS로 강제 클릭하여 확실히 처리)
                    search_btn = wait.until(EC.element_to_be_clickable((By.ID, "btnSrch")))
                    driver.execute_script("arguments[0].click();", search_btn)
                    
                    time.sleep(2)
                    n = process_list_page_capture_all(driver, BASE_SAVE_DIR, "공매", suffix=str(idx + 1) if len(gongmae_list) > 1 else "", manager=manager)
                    print(f"    ✅ {n}건 캡처")
                except Exception as e:
                    print(f"    ❌ 오류: {e}")

    except Exception as e:
        traceback.print_exc()
    finally:
        print(f"👋 [{user_id}] 종료")
        if driver:
            try:
                driver.quit()
            except:
                pass


if __name__ == "__main__":
    import sys
    list_path = None
    if len(sys.argv) >= 2:
        list_path = sys.argv[1].strip()
    if not list_path or not os.path.isfile(list_path):
        list_path = get_newest_list_file()
    if not list_path:
        print("❌ 건별 캡쳐 리스트 폴더에 .txt 파일이 없거나, 인자로 파일 경로를 주세요.")
        sys.exit(1)
    print(f"📂 리스트 파일: {list_path}")
    for acc in ACCOUNTS:
        run_macro(acc, list_path)
        time.sleep(2)
    print("\n🎉 [건별 캡처] 완료!")
