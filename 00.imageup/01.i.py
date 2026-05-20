print("📢 MJ경매 최종 완결 (법원명수정 + 공매강제 + 괄호인식 + 합체캡처)...")

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
    {"id": "mjgold",   "pw": "28471299",    "manager": "대표님"},
    {"id": "mjjang1",  "pw": "28471297",    "manager": "대표님"},
    {"id": "jjhsm81",  "pw": "marlboro81!", "manager": "전부쌤"}
]
# [MJ 매니저 통합] 환경변수로 ACCOUNTS override
import json as _mj_json
_mj_env_acc = os.environ.get("MJ_IMAGEUP_ACCOUNTS_JSON")
if _mj_env_acc:
    try:
        _mj_loaded = _mj_json.loads(_mj_env_acc)
        if isinstance(_mj_loaded, list) and _mj_loaded:
            ACCOUNTS = _mj_loaded
            print(f"[MJ] ACCOUNTS env override: {len(ACCOUNTS)}개")
    except Exception as _e:
        print(f"[MJ] ACCOUNTS env parse 실패: {_e}")

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

# 옥션원 detail 페이지에서 보증금 추출 (관심물건 row 텍스트에 보증금이 없으므로)
_DEPOSIT_CACHE = {}
def fetch_deposit_from_detail(driver, product_id, type_prefix):
    if not product_id:
        return ""
    cache_key = f"{type_prefix}:{product_id}"
    if cache_key in _DEPOSIT_CACHE:
        return _DEPOSIT_CACHE[cache_key]
    if type_prefix == "공매":
        url = f"https://www.auction1.co.kr/pubauct/view.php?product_id={product_id}"
    else:
        url = f"https://www.auction1.co.kr/auction/ca_view.php?product_id={product_id}"
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
        if html.startswith("FETCH_ERR"):
            print(f"      [디버그] pid={product_id} fetch 실패: {html[:200]}")
            _DEPOSIT_CACHE[cache_key] = ""
            return ""
        print(f"      [디버그] pid={product_id} HTML 길이: {len(html)}")
        # 보증금 여러 표현 시도
        patterns = [
            r'(?:입찰\s*)?보증금?[\s\S]{0,400}?([0-9][\d,]{4,})\s*원?',
            r'매수신청보증[\s\S]{0,400}?([0-9][\d,]{4,})\s*원?',
            r'보\s*증\s*금[\s\S]{0,400}?([0-9][\d,]{4,})',
        ]
        for pat in patterns:
            m = re.search(pat, html)
            if m:
                val = m.group(1).replace(",", "")
                _DEPOSIT_CACHE[cache_key] = val
                return val
        # 매칭 안 됨 → 보증금 단어 위치 출력 (디버그)
        idx = html.find("보증금")
        if idx >= 0:
            snippet = html[max(0, idx - 50):idx + 400]
            print(f"      [디버그] '보증금' 발견 @ {idx}, 주변 텍스트:")
            print(f"      {snippet!r}")
        else:
            print(f"      [디버그] '보증금' 단어 자체가 HTML 에 없음. HTML 앞 800자:")
            print(f"      {html[:800]!r}")
    except Exception as e:
        print(f"      [보증금 detail fetch 오류] pid={product_id}: {e}")
    _DEPOSIT_CACHE[cache_key] = ""
    return ""

SKIP_KEYWORDS = ["나의 분류관리", "엑셀저장", "매각기일 변경공지", "정렬/보기", "검색"]

# ==============================================================================
# [함수 2] 팝업 제거
# ==============================================================================
def remove_popups_css(driver):
    try:
        driver.execute_script("""
            var styles = `
                #inter_popup, .layer, .popup, div[id^='layer'], div[class*='popup'], #div_pop_back,
                #header_wrap, .gnb_wrap, #header, .top_menu, #quick_menu { 
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
# [함수 2-1] 정렬/개수 선택 후 검색 (캡처 직전)
# ==============================================================================
def wait_for_ajax(driver, timeout=15):
    """AJAX 완료 대기 - jQuery 여부 무관, 최소 3초 보장"""
    time.sleep(0.5)  # AJAX 시작 보장
    _start = time.time()
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script("""
                try { return jQuery.active === 0; } catch(e) { return true; }
            """)
        )
    except:
        pass
    # 비 jQuery AJAX 대비: 총 3초 보장 (0.5s 초기 + 최소 2.5s 추가)
    _elapsed = time.time() - _start
    if _elapsed < 2.5:
        time.sleep(2.5 - _elapsed)

def apply_list_options_and_search(driver):
    """정렬: 등록일↓(#order_type=idx desc), 개수: 20(#list_scale=20), 검색(#btnSrch) 클릭"""
    # order_type: 등록일↓ 옵션을 텍스트로 찾아서 설정 (value가 경매/공매마다 다름)
    try:
        r = driver.execute_script("""
            var s = document.getElementById('order_type');
            if(!s) return '없음';
            var opt = Array.from(s.options).find(o => o.text.includes('등록일') && o.text.includes('↓'));
            if(!opt) return '옵션없음';
            s.value = opt.value;
            s.dispatchEvent(new Event('change', {bubbles:true}));
            return s.value;
        """)
        print(f"    ✓ 정렬(order_type) 설정: {r}")
        time.sleep(0.3)
    except:
        pass
    # list_scale: JS 직접 설정 (env MJ_IMAGEUP_LIMIT 우선, 없으면 20)
    _mj_limit = os.environ.get("MJ_IMAGEUP_LIMIT", "").strip() or "20"
    try:
        driver.execute_script(f"""
            var s = document.getElementById('list_scale');
            if(s) {{ s.value = '{_mj_limit}'; s.dispatchEvent(new Event('change', {{bubbles:true}})); }}
        """)
        print(f"    ✓ list_scale 설정: {_mj_limit}")
        time.sleep(0.3)
    except:
        pass
    # btnSrch: JS 강제 클릭
    try:
        btn = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.ID, "btnSrch")))
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(2)
    except Exception as e:
        print(f"  ⚠ 검색 버튼 클릭 실패: {e}")

# ==============================================================================
# [함수 3] [핵심] 헤더+테이블 합체 캡처
# ==============================================================================
def capture_combined_element(driver, header_element, table_element, file_path):
    try:
        # [추가 보완] 검색메뉴, 네비게이션바 등 화면을 가리는 고정 요소(fixed/sticky)를 캡처 직전에 다시 한번 완벽하게 숨김
        driver.execute_script("""
            try {
                var all = document.querySelectorAll('*');
                for(var i=0; i<all.length; i++) {
                    var el = all[i];
                    var pos = window.getComputedStyle(el).position;
                    if((pos === 'fixed' || pos === 'sticky') && (!el.id || el.id.indexOf('tr_') !== 0)) {
                        el.style.setProperty('display', 'none', 'important');
                    }
                }
                var selectors = ['#header', '#header_wrap', '.gnb_wrap', '.top_menu', '#quick_menu', '#top_bg'];
                selectors.forEach(function(sel) {
                    var els = document.querySelectorAll(sel);
                    els.forEach(function(e) { e.style.setProperty('display', 'none', 'important'); });
                });
            } catch(e) {}
        """)
        time.sleep(0.3)

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

        if width <= 0 or height <= 0:
            print(f"      ⚠ 캡처 실패: 크기 이상 (width={width:.1f}, height={height:.1f})")
            return False

        # 3. 캡처 (scale=2로 고해상도 유지)
        screenshot_base64 = driver.execute_cdp_cmd("Page.captureScreenshot", {
            "clip": { "x": x, "y": y, "width": width, "height": height, "scale": 2 },
            "captureBeyondViewport": True, "format": "png"
        })

        if os.path.exists(file_path):
            try: os.remove(file_path); time.sleep(0.1)
            except: pass

        with open(file_path, "wb") as f:
            f.write(base64.b64decode(screenshot_base64['data']))
        return True
    except Exception as e:
        print(f"      ⚠ 캡처 오류: {type(e).__name__}: {e}")
        return False

# ==============================================================================
# [함수 4] 날짜 추출 로직 (헤더 텍스트 기반)
# ==============================================================================
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
    """날짜 추출 → (파일명용 문자열 YYMMDD, datetime.date or None) 반환"""
    today_year = datetime.datetime.now().year

    # [공매 전용] "02.23 14:00~02.25 17:00" → ~ 뒤 종료일 사용
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
        # fallback: 첫 번째 시간 패턴
        gm = re.search(r"(\d{1,2})[\./](\d{1,2})\s+\d{1,2}:\d{1,2}", header_text)
        if gm:
            month, day = gm.group(1), gm.group(2)
            return f"{str(today_year)[2:]}{month.zfill(2)}{day.zfill(2)}", None

    # [경매 전용] "2026-02-26" 또는 "2025.02.14" 형태
    k_auction_pattern = re.search(r"(20\d{2})[\.-](\d{1,2})[\.-](\d{1,2})", header_text)
    if k_auction_pattern:
        year, month, day = k_auction_pattern.groups()
        try:
            bid_date = datetime.date(int(year), int(month), int(day))
            return f"{year[2:]}{month.zfill(2)}{day.zfill(2)}", bid_date
        except:
            pass

    return "000000", None

def extract_sakun_from_dom(driver, container):
    """사건번호/관리번호 추출 (경매/공매 공통)
    위치: table.tbl_grid.hand tbody tr:nth-child(1) td:nth-child(2)
    """
    try:
        td = container.find_element(By.CSS_SELECTOR, "table.tbl_grid.hand tbody tr:nth-child(1) td:nth-child(2)")
        return td.text.strip()
    except:
        return None


def extract_date_from_dom(driver, container):
    """경매 전용: table.tbl_noline 6번째 td에서 입찰일자 추출
    위치: table.tbl_noline tbody tr td:nth-child(6)
    예: '2026-03-04(경매1일전)' → ('260304', datetime.date(2026, 3, 4))
    """
    try:
        td = container.find_element(By.CSS_SELECTOR, "table.tbl_noline tbody tr td:nth-child(6)")
        td_text = td.text.strip()          # "2026-03-04(경매1일전)"
        date_part = td_text.split("(")[0].strip()  # "2026-03-04"
        m = re.match(r"(20\d{2})-(\d{1,2})-(\d{1,2})", date_part)
        if m:
            year, month, day = m.groups()
            bid_date = datetime.date(int(year), int(month), int(day))
            return f"{year[2:]}{month.zfill(2)}{day.zfill(2)}", bid_date
    except:
        pass
    return "000000", None

# ==============================================================================
# [함수 5] 리스트 처리
# ==============================================================================
def process_list_page(driver, save_dir, type_prefix, manager=""):
    print(f"\n  ▶ [{type_prefix}] 리스트 분석 시작...")
    remove_popups_css(driver)
    
    try:
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "table")))
        time.sleep(2) 
    except:
        return

    container_xpath = "//div[starts-with(@id, 'tr_')] | //tr[starts-with(@id, 'tr_')]"
    all_containers = driver.find_elements(By.XPATH, container_xpath)
    candidates = []
    
    for item in all_containers:
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

            # 2. 헤더 찾기 (형제 요소 중 가장 가까운 헤더)
            try:
                header_element = item.find_element(By.XPATH, "preceding-sibling::*[not(starts-with(@id, 'tr_'))][1]")
                header_text = header_element.text + " " + full_text.split('\n')[0]
            except:
                header_text = full_text.split('\n')[0]
                header_element = item 

            # 3. 사건번호 추출 + 하이픈 개수 검증
            # DOM에서 사건번호 추출 시도
            dom_sakun = extract_sakun_from_dom(driver, item)
            if dom_sakun:
                raw_sakun = dom_sakun
            else:
                pattern = r"20\d{2}-\d+[\d-]*(?:\(\d+\))?"
                match = re.search(pattern, full_text)
                if not match: match = re.search(pattern, header_text)
                raw_sakun = match.group() if match else f"번호미상{i}"
            
            dash_count = raw_sakun.count("-")

            if type_prefix == "경매":
                sakun_no = raw_sakun.replace("-", "타경")  # 2025-1234 → 2025타경1234
            else:  # 공매
                sakun_no = raw_sakun.split()[0] if " " in raw_sakun else raw_sakun

            # 4. 등록일 파싱
            reg_date = extract_reg_date(header_text)

            # 5. 날짜 추출 + 입찰일 스킵 체크
            if type_prefix == "경매":
                bid_date_str, bid_date_obj = extract_date_from_dom(driver, item)
                if bid_date_str == "000000":
                    print(f"    ❌ [{i+1}] 경매 입찰일자 추출 실패 (DOM 추출 강제: td:nth-child(6))")
                    skipped_count += 1
                    continue
            else:
                # 공매는 입찰일자 로직 절대 건드리지 말 것 (지시사항)
                bid_date_str, bid_date_obj = extract_smart_date(header_text, type_prefix, reg_date)
            if bid_date_obj and bid_date_obj <= datetime.date.today():
                print(f"    ⏭ 입찰일 {bid_date_obj} <= 오늘, 스킵")
                skipped_count += 1
                continue

            # 6. 법원명 추출
            court_name = "공매" if type_prefix == "공매" else get_court_from_text(full_text)

            # 6-1. 옥션 product_id 추출 (공매: href 링크 우선 / 경매: 이미지 src 패턴 우선)
            product_id = ""
            try:
                product_id = driver.execute_script("""
                    var tbl = arguments[0], hdr = arguments[1], isGongmae = arguments[2];
                    // 공매 전용: opt 속성 (checkbox에 product_id 저장)
                    if(isGongmae){
                        var optEl = tbl.querySelector('[opt]') || hdr.querySelector('[opt]');
                        if(optEl){ var optVal = optEl.getAttribute('opt'); if(optVal) return optVal; }
                        // fallback: pd_view_popup(type, product_id) 패턴
                        var allOC = Array.from(tbl.querySelectorAll('[onclick]')).concat(Array.from(hdr.querySelectorAll('[onclick]')));
                        for(var j=0; j<allOC.length; j++){
                            var m = (allOC[j].getAttribute('onclick')||'').match(/pd_view_popup\(\d+,\s*(\d+)\)/);
                            if(m) return m[1];
                        }
                    }
                    // 이미지 src/onerror에서 추출 (경매 전용 - 공매는 이미지 ID가 달라 스킵)
                    if(!isGongmae){
                    var imgs = tbl.querySelectorAll('img');
                    for(var i=0; i<imgs.length; i++){
                        var src = imgs[i].getAttribute('src') || '';
                        var m = src.match(/Thumnail\/m\/\d+\/m(\d+)_/) || src.match(/PubAuct\/\d+\/\d+\/(\d+)_/);
                        if(m) return m[1];
                        var oe = imgs[i].getAttribute('onerror') || '';
                        var m2 = oe.match(/Thumnail\/m\/\d+\/m(\d+)_/) || oe.match(/PubAuct\/\d+\/\d+\/(\d+)_/);
                        if(m2) return m2[1];
                    }
                    }
                    // href/onclick fallback (경매용)
                    if(!isGongmae){
                        var sources = [tbl, hdr];
                        for(var s=0; s<sources.length; s++){
                            var link = sources[s].querySelector('a[href*="product_id="]');
                            if(link){ var m=link.href.match(/product_id=(\d+)/); if(m) return m[1]; }
                            var all = sources[s].querySelectorAll('[onclick]');
                            for(var j=0; j<all.length; j++){
                                var m=(all[j].getAttribute('onclick')||'').match(/product_id[=\(,]['"]?(\d+)/);
                                if(m) return m[1];
                            }
                        }
                    }
                    // 부모 방향 속성 탐색
                    var el = tbl.parentElement;
                    for(var i=0; i<10; i++){
                        if(!el || el===document.body) break;
                        var attrs = el.attributes || [];
                        for(var j=0; j<attrs.length; j++){
                            var m = attrs[j].value.match(/product_id[=\(,]['"]?(\d+)/);
                            if(m) return m[1];
                        }
                        el = el.parentElement;
                    }
                    return '';
                """, item, header_element, type_prefix == "공매") or ""
            except:
                pass
            print(f"    🔍 product_id: {product_id or '미추출'}")

            # 7. 저장 (합체 캡처)
            safe_sakun = re.sub(r'[\\/*?:"<>|]', "", sakun_no)
            safe_court = re.sub(r'[\\/*?:"<>|]', "", court_name)
            pid_suffix = f"_{product_id}" if product_id else ""
            # 보증금/최저가 추출 (콤마 제거, 라벨은 파일명에 안 붙임)
            _m_dep = re.search(r'(?:입찰\s*)?보증(?:금)?\s*[:\s]*([0-9][\d,]*)', full_text)
            _m_low = re.search(r'최저(?:매각가|가)?\s*[:\s]*([0-9][\d,]*)', full_text)
            _dep = _m_dep.group(1).replace(",", "") if _m_dep else ""
            _low = _m_low.group(1).replace(",", "") if _m_low else ""
            # row 텍스트에 보증금 없으면 detail 페이지 fetch 로 추출
            if not _dep and product_id:
                _dep = fetch_deposit_from_detail(driver, product_id, type_prefix)
                if _dep:
                    print(f"    ✓ 보증금 detail 추출: {_dep}")
                else:
                    print(f"    ⚠ 보증금 detail 추출 실패 (product_id={product_id}, type={type_prefix})")
            # 빈 값이어도 _ 는 항상 붙여서 위치 보존 (보증 자리/최저가 자리 명확히)
            _dep_suffix = f"_{_dep}"
            _low_suffix = f"_{_low}"
            filename = f"{safe_sakun}_{bid_date_str}_{safe_court}_{manager}{pid_suffix}{_dep_suffix}{_low_suffix}.png"
            file_path = os.path.join(save_dir, filename)

            if capture_combined_element(driver, header_element, item, file_path):
                print(f"    - ({i+1}) 📸 저장: {filename}")
                count += 1
            else:
                print(f"    - ({i+1}) ❌ 캡처 실패")
            
        except Exception as e:
            print(f"    ⚠ 물건 처리 오류 ({i+1}번째): {type(e).__name__}: {e}")
            continue

    print(f"  ✅ [{type_prefix}] {count}건 저장 완료 (메모없음 제외: {skipped_count}건)")

# ==============================================================================
# 메인 실행부 (안정 로그인 + 공매 강제진입)
# ==============================================================================
def run_macro(account):
    user_id = account['id']
    user_pw = account['pw']
    manager = account.get("manager", "")
    save_dir = BASE_SAVE_DIR
    os.makedirs(save_dir, exist_ok=True)

    print(f"\n🚀 계정 [{user_id}] 작업 시작")
    print(f"📂 저장 경로: {save_dir}")

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1920,1080")
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

        # 경매 (관심물건 진입 → 팝업 제거 → 정렬/개수/검색 → 캡처)
        driver.get("https://www.auction1.co.kr/member/inter_list.php")
        remove_popups_css(driver)
        time.sleep(1)
        apply_list_options_and_search(driver)
        process_list_page(driver, save_dir, "경매", manager)

        # [수정] 공매 강제 진입 (에러 무시하지 않고 돌파)
        try:
            print("  ▶ [공매] 페이지 전환 시도...")
            # 1. 라디오 버튼 강제 클릭
            driver.execute_script("if(document.querySelector('#itype2')) document.querySelector('#itype2').click();")
            wait_for_ajax(driver)  # 공매 전환 AJAX 완료까지 대기 (조회 끝났는지 확인)
            remove_popups_css(driver)
            # 2. 정렬(등록일↓) / 개수(20) / 검색
            apply_list_options_and_search(driver)
            # 3. 분석 시작
            process_list_page(driver, save_dir, "공매", manager)
            
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
    print("\n🎉 모든 작업 완료!")
