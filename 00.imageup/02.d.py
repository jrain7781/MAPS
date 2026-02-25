print("📢 MJ경매 [입찰일 기준] (정렬 미변경 + 개수 20 + 검색 + 합체캡처)...")

import base64
import time
import os
import re
import traceback
import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# ==============================================================================
# [설정] 계정 및 경로
# ==============================================================================
ACCOUNTS = [
    {"id": "mjgold", "pw": "28471296"},
    {"id": "mjjang1", "pw": "28471295"}
]

# 저장 경로: 구글 드라이브 (웹 등록과 동일하게 유지)
BASE_SAVE_DIR = r"G:\내 드라이브\MAPS\mapsimage"

# ==============================================================================
# [설정] 법원 관할 매칭 (재미나이 정리 스크립트 기반 - court_jurisdiction 모듈 사용)
# ==============================================================================
from court_jurisdiction import get_court_from_text

SELECTOR_ID = "client_id"
SELECTOR_PW_DUMMY = "pw_Dummy"
SELECTOR_PW_REAL = "passwd"
SELECTOR_LOGIN_BTN = "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]"
SELECTOR_RADIO_GONGMAE = '//*[@id="itype2"]'
SELECTOR_SEARCH_BTN = '//*[@id="btnSrch"]'

SKIP_KEYWORDS = ["나의 분류관리", "엑셀저장", "매각기일 변경공지", "정렬/보기", "검색"]

# ==============================================================================
# [함수 1] 팝업 제거
# ==============================================================================
def remove_popups_css(driver):
    try:
        driver.execute_script("""
            var styles = `
                #inter_popup, .layer, .popup, div[id^='layer'], div[class*='popup'], #div_pop_back { 
                    display: none !important; 
                    visibility: hidden !important; 
                    opacity: 0 !important;
                    pointer-events: none !important;
                    z-index: -9999 !important;
                }
            `;
            var styleSheet = document.createElement("style");
            styleSheet.innerText = styles;
            document.head.appendChild(styleSheet);
        """)
        time.sleep(0.5)
    except:
        pass

# ==============================================================================
# [함수 2-1] 입찰일 기준: 개수 20 선택 + 검색만 (정렬/보기 미변경)
# ==============================================================================
def apply_list_scale_and_search(driver):
    """개수: 20(#list_scale=20), 검색(#btnSrch) 클릭. 정렬은 건드리지 않음."""
    try:
        scale_select = Select(driver.find_element(By.ID, "list_scale"))
        scale_select.select_by_value("20")
        time.sleep(0.3)
        driver.find_element(By.ID, "btnSrch").click()
        time.sleep(2)
    except Exception as e:
        print(f"  ⚠ 개수 선택 또는 검색 실패: {e}")

# ==============================================================================
# [함수 3] [핵심] 헤더+테이블 합체 캡처
# ==============================================================================
def capture_combined_element(driver, header_element, table_element, file_path):
    try:
        # 1. 헤더 위치로 스크롤
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", header_element)
        time.sleep(0.2)

        # 2. 좌표 계산
        rect_h = driver.execute_script("return arguments[0].getBoundingClientRect();", header_element)
        rect_t = driver.execute_script("return arguments[0].getBoundingClientRect();", table_element)
        scroll_x = driver.execute_script("return window.pageXOffset;")
        scroll_y = driver.execute_script("return window.pageYOffset;")

        x = rect_t['left'] + scroll_x
        y = rect_h['top'] + scroll_y
        width = rect_t['width']
        # 높이 = (테이블 바닥) - (헤더 천장)
        height = (rect_t['top'] + rect_t['height']) - rect_h['top']

        if width <= 0 or height <= 0: return False

        # 3. 캡처
        screenshot_base64 = driver.execute_cdp_cmd("Page.captureScreenshot", {
            "clip": { "x": x, "y": y, "width": width, "height": height, "scale": 1 },
            "captureBeyondViewport": True, "format": "png"
        })
        
        if os.path.exists(file_path):
            try: os.remove(file_path); time.sleep(0.1)
            except: pass
            
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(screenshot_base64['data']))
        return True
    except:
        return False

# ==============================================================================
# [함수 4] 날짜 추출 로직 (헤더 텍스트 기반)
# ==============================================================================
def extract_smart_date(header_text, type_prefix):
    today_year = datetime.datetime.now().year
    
    # [공매 전용] "12/23 10:00" 형태 -> 251223
    if type_prefix == "공매":
        gongmae_pattern = re.search(r"(\d{1,2})[\./](\d{1,2})\s+(\d{1,2}):(\d{1,2})", header_text)
        if gongmae_pattern:
            month, day, _, _ = gongmae_pattern.groups()
            return f"{str(today_year)[2:]}{month.zfill(2)}{day.zfill(2)}"

    # [경매 전용] "2025.02.14" 형태 -> 250214
    k_auction_pattern = re.search(r"(20\d{2})[\.-](\d{1,2})[\.-](\d{1,2})", header_text)
    if k_auction_pattern:
        year, month, day = k_auction_pattern.groups()
        return f"{year[2:]}{month.zfill(2)}{day.zfill(2)}"

    return "000000"

# ==============================================================================
# [함수 5] 리스트 처리
# ==============================================================================
def process_list_page(driver, save_dir, type_prefix):
    print(f"\n  ▶ [{type_prefix}] 리스트 분석 시작...")
    remove_popups_css(driver)
    
    try:
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "table")))
        time.sleep(2) 
    except:
        return

    all_tables = driver.find_elements(By.TAG_NAME, "table")
    candidates = []
    
    for item in all_tables:
        try:
            if item.size['height'] > 100:
                text = item.text
                is_skip = False
                for k in SKIP_KEYWORDS:
                    if k in text: is_skip = True; break
                if is_skip: continue

                # [필터] 사건번호 또는 관리번호 (공매 포함)
                if ("사건번호" in text or "관리번호" in text) and "감정가" in text:
                    candidates.append(item)
        except: continue
    
    if not candidates:
        print(f"    - [{type_prefix}] 처리할 물건이 없습니다.")
        return

    count = 0
    skipped_count = 0
    
    for i, item in enumerate(candidates):
        try:
            full_text = item.text
            
            # 1. 메모 체크
            has_memo = False
            if "메모" in full_text:
                for line in full_text.split('\n'):
                    if "메모" in line:
                        clean = line.replace("메모", "").replace(":", "").strip()
                        if len(clean) > 0: has_memo = True; break
            
            if not has_memo:
                skipped_count += 1
                continue

            # 2. 헤더 찾기 (형제 요소)
            try:
                header_element = item.find_element(By.XPATH, "preceding-sibling::*[1]")
                header_text = header_element.text + " " + full_text.split('\n')[0]
            except:
                header_text = full_text.split('\n')[0]
                header_element = item 

            # 3. [핵심수정] 사건번호 추출 (괄호 물건번호 포함)
            # 예: 2024-82718(5)
            pattern = r"20\d{2}-\d+[\d-]*(?:\(\d+\))?"
            match = re.search(pattern, full_text)
            if not match: match = re.search(pattern, header_text)
            
            raw_sakun = match.group() if match else f"번호미상{i}"
            sakun_no = raw_sakun.replace("-", "타경") if type_prefix == "경매" else raw_sakun.split()[0]
            
            # 4. 날짜 추출 (헤더에서)
            bid_date_str = extract_smart_date(header_text, type_prefix)

            # 5. 법원명 추출
            court_name = "공매" if type_prefix == "공매" else get_court_from_text(full_text)

            # 6. 저장 (합체 캡처)
            safe_sakun = re.sub(r'[\\/*?:"<>|]', "", sakun_no)
            safe_court = re.sub(r'[\\/*?:"<>|]', "", court_name)
            filename = f"{safe_sakun}_{bid_date_str}_{safe_court}.png"
            file_path = os.path.join(save_dir, filename)
            
            if capture_combined_element(driver, header_element, item, file_path):
                print(f"    - ({i+1}) 📸 저장: {filename}")
                count += 1
            else:
                print(f"    - ({i+1}) ❌ 캡처 실패")
            
        except Exception as e:
            continue
            
    print(f"  ✅ [{type_prefix}] {count}건 저장 완료 (메모없음 제외: {skipped_count}건)")

# ==============================================================================
# 메인 실행부 (입찰일 기준: 정렬 미변경 + 개수 20 + 검색 → 캡처)
# ==============================================================================
def run_macro(account):
    user_id = account['id']
    user_pw = account['pw']
    save_dir = BASE_SAVE_DIR
    os.makedirs(save_dir, exist_ok=True)

    print(f"\n🚀 계정 [{user_id}] 작업 시작 [입찰일 기준]")
    print(f"📂 저장 경로: {save_dir}")

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--force-device-scale-factor=1")
    options.add_argument("--disable-gpu")
    options.add_experimental_option("detach", True)

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)

    try:
        # 로그인
        driver.get("https://www.auction1.co.kr/common/login_box.php")
        remove_popups_css(driver)
        wait.until(EC.presence_of_element_located((By.ID, SELECTOR_ID)))
        
        login_script = f"""
            document.getElementById('{SELECTOR_ID}').value = '{user_id}';
            var dummy = document.getElementById('{SELECTOR_PW_DUMMY}');
            var real = document.getElementById('{SELECTOR_PW_REAL}');
            if(dummy) dummy.style.display = 'none';
            if(real) {{ real.style.display = 'block'; real.value = '{user_pw}'; }}
        """
        driver.execute_script(login_script)
        
        try:
            driver.find_element(By.XPATH, SELECTOR_LOGIN_BTN).click()
        except:
            driver.find_element(By.ID, SELECTOR_PW_REAL).send_keys(Keys.RETURN)
        
        time.sleep(2)

        # 경매 (관심물건 진입 → 팝업 제거 → 개수 20 + 검색 → 캡처, 정렬 미변경)
        driver.get("https://www.auction1.co.kr/member/inter_list.php")
        remove_popups_css(driver)
        time.sleep(1)
        apply_list_scale_and_search(driver)
        process_list_page(driver, save_dir, "경매")

        # 공매
        try:
            print("  ▶ [공매] 페이지 전환 시도...")
            driver.execute_script("if(document.querySelector('#itype2')) document.querySelector('#itype2').click();")
            time.sleep(1)
            remove_popups_css(driver)
            apply_list_scale_and_search(driver)
            process_list_page(driver, save_dir, "공매")
            
        except Exception as e:
            print(f"  ❌ 공매 진입 중 오류: {e}")

    except Exception as e:
        print(f"\n❌ 오류 발생:")
        traceback.print_exc() 
    finally:
        print(f"👋 [{user_id}] 종료")
        driver.quit()

if __name__ == "__main__":
    for acc in ACCOUNTS:
        run_macro(acc)
        time.sleep(3)
    print("\n🎉 [입찰일 기준] 모든 작업 완료!")
