# -*- coding: utf-8 -*-
import sys, os, datetime as _dt

# ── 로그 파일: 스크립트 폴더/logs/ 하위에 실행시각_apt84.log 로 저장 ──
_LOG_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(_LOG_DIR, exist_ok=True)
_LOG_FILE = os.path.join(_LOG_DIR, _dt.datetime.now().strftime('%Y%m%d_%H%M%S') + '_apt84.log')
_log_fh   = open(_LOG_FILE, 'w', encoding='utf-8', buffering=1)

class _Tee:
    encoding = 'utf-8'
    errors   = 'replace'
    def __init__(self, console, logfile):
        self._con = console
        self._log = logfile
    def write(self, data):
        try:  self._con.write(data)
        except: pass
        try:  self._log.write(data)
        except: pass
    def flush(self):
        try:  self._con.flush()
        except: pass
        try:  self._log.flush()
        except: pass
    def reconfigure(self, **kw): pass   # 호환성

sys.stdout = _Tee(open(sys.stdout.fileno(), 'w', encoding='utf-8', closefd=False), _log_fh)
sys.stderr = _Tee(open(sys.stderr.fileno(), 'w', encoding='utf-8', closefd=False), _log_fh)

print(f"[LOG] 로그 파일: {_LOG_FILE}")
print("[INFO] 조사물건 크롤링 - 아파트, 84m2, 2~10억 (auction1.co.kr)...")

import time
import re
import json
import datetime
import traceback
import urllib.request
import urllib.parse

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# ==============================================================================
# [설정] 계정 및 MAPS API
# ==============================================================================
ACCOUNT = {"id": "mjjang1", "pw": "28471298"}

# MAPS GAS 웹앱 URL (실제 서비스 배포 ID)
MAPS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycby1SnLYJmPQ9PU0JlEZC5rG3e9y9s6wMVrsPeG_gqgDBnK9FMkyVPb3v5V0DFI14ETZiA/exec"

# ADMIN KEY: MAPS GAS 에디터에서 Admin > 관리자 KEY 확인으로 얻은 값을 입력
ADMIN_KEY = "ijty597EhkNcVnqt9eZvKnEDmXZFOHcj"

# ==============================================================================
# [설정] 검색 조건 (아파트, 84m², 2~10억)
# ==============================================================================
MIN_KAMJUNGKA_MAN = 20000   # 최소 감정가 (만원) = 2억
MAX_KAMJUNGKA_MAN = 100000  # 최대 감정가 (만원) = 10억

APARTMENT_KEYWORD = "아파트"

# ------------------------------------------------------------------------------
# [편집 가능] 리스트 항목 범위 설정
#   - ITEM_START: 파싱 시작 번호 (1부터 시작, 1이면 처음부터)
#   - ITEM_END  : 파싱 끝 번호   (None이면 끝까지)
#   예) 11~20번만 처리: ITEM_START=11, ITEM_END=20
# ------------------------------------------------------------------------------
ITEM_START = 1      # ← 시작 번호
ITEM_END   = None   # ← 끝 번호 (None = 전체)

# ==============================================================================
# [핵심] 특수물건 제외 목록
# auction1.co.kr 검색 화면에서 special select의 option value 목록
# special=0(설정안함/전체)으로 1번만 검색 후, 아래 태그가 있는 물건은 등록 제외
# 형식: (value, 표시명, 텍스트키워드목록)
# ==============================================================================
# ※ value: auction1.co.kr input value / 키워드: 페이지 텍스트에서도 체크
SPECIAL_EXCLUDE_LIST = [
    ('44',  '맹지',                    ['맹지']),
    ('16',  '전세권/임차권 설정',       ['전세권설정', '임차권설정']),
    ('17',  '선순위 전세권/임차권 설정', ['선순위전세권', '선순위임차권']),
    ('39',  '임차권 설정',              ['임차권설정']),
    ('40',  '선순위 임차권 설정',       ['선순위임차권설정']),
    ('18',  '임차권 등기',              ['임차권등기']),
    ('20',  '전세권설정/임차권등기',    ['전세권설정', '임차권등기']),
    ('19',  '말소기준등기보다 앞선 임차권', ['말소기준등기보다앞선임차권', '선순위임차권']),
    ('23',  '대항력 있는 임차인',       ['대항력있는임차인', '대항력 있는 임차인']),
    ('32',  '전세권만 매각',            ['전세권만매각', '전세권만 매각']),
    ('22',  '선순위 가등기',            ['선순위가등기', '선순위 가등기']),
    ('21',  '선순위 가처분',            ['선순위가처분', '선순위 가처분']),
    ('15',  '예고등기',                 ['예고등기']),
    ('13',  '대지권미등기',             ['대지권미등기', '대지권 미등기']),
    ('12',  '토지별도등기 있는 물건',   ['토지별도등기']),
    ('14',  '토지별도등기인수조건',     ['토지별도등기인수조건']),
    ('4',   '건물만 입찰',              ['건물만입찰', '건물만 입찰']),
    ('5',   '토지만 입찰',              ['토지만입찰', '토지만 입찰']),
    ('3',   '지분입찰',                 ['지분입찰', '지분 입찰']),
]

# value 셋 (JS 체크용)
SPECIAL_EXCLUDE_VALUES = {row[0] for row in SPECIAL_EXCLUDE_LIST}

# 텍스트 키워드 셋 (페이지 텍스트 체크용)
SPECIAL_EXCLUDE_KEYWORDS = {kw for _, _, kws in SPECIAL_EXCLUDE_LIST for kw in kws}

# auction1.co.kr special select 전체 value→이름 맵 (제외되지 않은 특수물건 이름 추출용)
SPECIAL_VALUE_NAME_MAP = {
    '11': '오늘공개신건',
    '31': '재매각',
    '42': '재진행',
    '8':  '반값경매',
    '24': '반값(1년경과)',
    '33': '위반건축물',
    '34': '초보자경매물건',
    '1':  '유치권',
    '2':  '법정지상권',
    '29': '분묘기지권',
    '35': '유치권배제신청',
    '36': '임금채권',
    '45': 'HUG임차권',
    '25': '형식적경매(유치권)',
    '26': '형식적경매(유류)',
    '27': '형식적경매(청산)',
    '28': '형식적경매(기타)',
    '46': '공시1억이하',
    '47': '공시1억~2억',
    '48': '공시2억~3억',
    '49': '공시3억~4억',
}

SELECTOR_ID = "client_id"
SELECTOR_PW_DUMMY = "pw_Dummy"
SELECTOR_PW_REAL = "passwd"
SELECTOR_LOGIN_BTN = "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]"


# ==============================================================================
# [함수] 법원 관할 추출
# ==============================================================================
try:
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '로직', '0226'))
    from court_jurisdiction import get_court_from_text
except ImportError:
    def get_court_from_text(text):
        court_keywords = [
            '서울중앙', '서울동부', '서울서부', '서울남부', '서울북부',
            '의정부', '인천', '수원', '춘천', '대전', '청주',
            '대구', '부산', '울산', '창원', '광주', '전주', '제주',
            '거제', '통영', '마산', '진주', '여수', '순천'
        ]
        for kw in court_keywords:
            if kw in text:
                return kw
        return ''


# ==============================================================================
# [함수] 팝업/오버레이 제거
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
        time.sleep(0.3)
    except:
        pass


# ==============================================================================
# [함수] AJAX 대기
# ==============================================================================
def wait_for_ajax(driver, timeout=15):
    time.sleep(0.5)
    _start = time.time()
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script("""
                try { return jQuery.active === 0; } catch(e) { return true; }
            """)
        )
    except:
        pass
    _elapsed = time.time() - _start
    if _elapsed < 2.0:
        time.sleep(2.0 - _elapsed)


# ==============================================================================
# [함수] 숫자 파싱 (만원 단위로 변환)
# ==============================================================================
def parse_price_to_man(text):
    """'2억 3,000만원' 또는 '230,000,000' 형태 → 만원 단위 int 반환"""
    if not text:
        return 0
    text = str(text).replace(',', '').replace(' ', '')
    total = 0
    m_uk = re.search(r'(\d+(?:\.\d+)?)억', text)
    m_man = re.search(r'(\d+)만', text)
    if m_uk:
        total += float(m_uk.group(1)) * 10000
    if m_man:
        total += int(m_man.group(1))
    if total > 0:
        return int(total)
    m_num = re.search(r'(\d+)', text)
    if m_num:
        n = int(m_num.group(1))
        if n > 10000:
            return n // 10000
        return n
    return 0


# ==============================================================================
# [함수] 특수물건 여부 체크
# - 검색 결과 컨테이너 텍스트 + 특수물건 아이콘/태그 확인
# ==============================================================================
def is_special_item(driver, container):
    """특수물건 제외 목록에 해당하면 True 반환"""
    try:
        # 1) JS로 특수물건 value 체크 (checkbox, hidden input, data 속성 등)
        special_found = driver.execute_script("""
            var tbl = arguments[0];
            var excludeVals = arguments[1];
            
            // 체크박스/hidden input의 value 확인
            var inputs = tbl.querySelectorAll('input[type="checkbox"], input[type="hidden"]');
            for (var i = 0; i < inputs.length; i++) {
                var val = inputs[i].value || '';
                if (excludeVals.indexOf(val) !== -1) return val;
            }
            
            // data-special, data-type 속성 확인
            var allEls = tbl.querySelectorAll('[data-special], [data-type]');
            for (var j = 0; j < allEls.length; j++) {
                var spVal = allEls[j].getAttribute('data-special') || allEls[j].getAttribute('data-type') || '';
                if (excludeVals.indexOf(spVal) !== -1) return spVal;
            }
            
            return null;
        """, container, list(SPECIAL_EXCLUDE_VALUES))
        
        if special_found:
            return True, f"특수물건 value={special_found}"
        
        # 2) 텍스트 키워드 체크
        full_text = container.text
        full_text_no_space = full_text.replace(' ', '')
        for kw in SPECIAL_EXCLUDE_KEYWORDS:
            kw_no_space = kw.replace(' ', '')
            if kw_no_space in full_text_no_space:
                return True, f"특수물건 키워드='{kw}'"
        
        return False, ""
    except Exception as e:
        return False, ""


# ==============================================================================
# [함수] 총 페이지 수 조회
# ==============================================================================
def has_next_page(driver):
    """현재 페이지에 '다음' 페이지 버튼이 있으면 True 반환"""
    try:
        return driver.execute_script("""
            // goPage(N) 링크 스캔 (현재 페이지 번호보다 큰 숫자)
            var goPageLinks = document.querySelectorAll('a[onclick*="goPage"]');
            for(var i=0; i<goPageLinks.length; i++){
                var m = (goPageLinks[i].getAttribute('onclick')||'').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if(m && parseInt(m[1]) > 1) return true;
            }
            // 모든 엘리먼트에서 '다음' 텍스트 탐색 (태그 무관)
            var all = document.querySelectorAll('*');
            for(var i=0; i<all.length; i++){
                var el = all[i];
                // 자식 없는 leaf 노드이거나 a/button/span 등 클릭 가능 요소
                var t = '';
                if(el.childElementCount === 0) t = (el.textContent||'').trim();
                else if(el.tagName === 'A' || el.tagName === 'BUTTON') t = (el.textContent||'').trim();
                if(t === '다음' || t === '>' || t === '▶' || t === 'next' || t === '다음 페이지') return true;
            }
            return false;
        """) or False
    except:
        return False


def click_next_page(driver):
    """'다음' 버튼 클릭. 성공 시 True 반환"""
    try:
        return driver.execute_script("""
            // goPage 링크 중 최대 번호 클릭
            var maxPg = 0, maxEl = null;
            var goPageLinks = document.querySelectorAll('a[onclick*="goPage"]');
            for(var i=0; i<goPageLinks.length; i++){
                var m = (goPageLinks[i].getAttribute('onclick')||'').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if(m){ var pg = parseInt(m[1]); if(pg > maxPg){ maxPg = pg; maxEl = goPageLinks[i]; } }
            }
            if(maxEl){ maxEl.click(); return 'goPage:'+maxPg; }

            // '다음' 텍스트 엘리먼트 탐색 (전체 DOM)
            var all = document.querySelectorAll('*');
            for(var i=0; i<all.length; i++){
                var el = all[i];
                var t = '';
                if(el.childElementCount === 0) t = (el.textContent||'').trim();
                else if(el.tagName === 'A' || el.tagName === 'BUTTON') t = (el.textContent||'').trim();
                if(t === '다음' || t === '>' || t === '▶' || t === 'next' || t === '다음 페이지'){
                    el.click(); return '다음클릭';
                }
            }
            return false;
        """) or False
    except:
        return False


def get_page_fingerprint(driver):
    """현재 페이지 첫 번째 물건 행의 텍스트 앞 200자 반환 (페이지 변경 감지용)"""
    try:
        return driver.execute_script("""
            var trs = document.querySelectorAll('tr');
            for(var i=0; i<trs.length; i++){
                var tr = trs[i];
                if(tr.querySelector('a[href*="product_id="]') || tr.querySelector('img[src*="auction1.co.kr"]')){
                    var t = (tr.textContent || '').replace(/\\s+/g,' ').trim();
                    if(t.length > 30) return t.slice(0, 200);
                }
            }
            return (document.body.innerText || '').slice(300, 500);
        """) or ''
    except:
        return ''


def get_total_pages(driver):
    """현재 검색 결과의 총 페이지 수 반환 (goPage 방식만, 그 외는 has_next_page로 처리)"""
    try:
        page_info = driver.execute_script("""
            var maxPage = 1;
            // goPage(N) onclick 패턴 스캔
            var goPageLinks = document.querySelectorAll('a[onclick*="goPage"]');
            goPageLinks.forEach(function(a) {
                var m = (a.getAttribute('onclick') || '').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if (m) { var pg = parseInt(m[1]); if (pg > maxPage) maxPage = pg; }
            });
            return maxPage;
        """)
        total = int(page_info) if page_info else 1
        return total
    except:
        return 1


# ==============================================================================
# [함수] 페이지 이동
# ==============================================================================
def go_to_page(driver, wait, page_no):
    """지정한 페이지 번호로 이동"""
    try:
        result = driver.execute_script("""
            var pageNo = arguments[0];

            // 1순위: goPage(N) 직접 호출 (auction1 전용 함수)
            try { goPage(pageNo); return 'goPage:' + pageNo; } catch(e) {}

            // 2순위: 페이지 함수 다양한 이름 시도
            var fnNames = ['goListPage','go_page','movePage','pageMove','changePage','listPage'];
            for(var fi=0; fi<fnNames.length; fi++){
                try {
                    if(typeof window[fnNames[fi]] === 'function'){
                        window[fnNames[fi]](pageNo);
                        return fnNames[fi]+':'+pageNo;
                    }
                } catch(e2){}
            }

            // 3순위: onclick="goPage(N)" 링크 클릭
            var goLinks = document.querySelectorAll('a[onclick*="goPage"]');
            for (var i = 0; i < goLinks.length; i++) {
                var m = (goLinks[i].getAttribute('onclick') || '').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if (m && parseInt(m[1]) === pageNo) {
                    goLinks[i].click();
                    return 'goPage_click:' + pageNo;
                }
            }

            // 4순위: 숫자 텍스트 기반 링크 클릭 (다양한 셀렉터)
            var selectors = ['#paging a', '.paging a', '#pager a', '.pager a',
                             '[class*="paging"] a', '[class*="pagination"] a',
                             'td a', 'div a'];
            for (var s = 0; s < selectors.length; s++) {
                var links = document.querySelectorAll(selectors[s]);
                for (var j = 0; j < links.length; j++) {
                    var txt = links[j].textContent.trim();
                    if (txt === String(pageNo)) {
                        links[j].click();
                        return 'clicked:' + pageNo;
                    }
                }
            }

            // 5순위: page_no 파라미터 방식 (onclick 속성에서 패턴 탐색)
            var allLinks = document.querySelectorAll('a');
            for (var k = 0; k < allLinks.length; k++) {
                var oc = allLinks[k].getAttribute('onclick') || '';
                var m2 = oc.match(/page_no[=,\\s]+(\\d+)/i);
                if (m2 && parseInt(m2[1]) === pageNo) {
                    allLinks[k].click();
                    return 'page_no:' + pageNo;
                }
            }

            // 6순위: 페이지 관련 함수를 onclick에서 찾아서 pageNo 로 재호출
            var allLinks2 = document.querySelectorAll('a');
            for (var k2 = 0; k2 < allLinks2.length; k2++) {
                var oc2 = allLinks2[k2].getAttribute('onclick') || '';
                var mFn = oc2.match(/^\\s*(\\w+)\\s*\\(\\s*\\d+/);
                if(mFn){
                    try{
                        window[mFn[1]](pageNo);
                        return 'fn_'+mFn[1]+':'+pageNo;
                    } catch(e3){}
                }
            }

            // 7순위: 폼에 숨긴 page 파라미터 있으면 설정 후 submit
            var forms = document.querySelectorAll('form');
            for(var fi2=0; fi2<forms.length; fi2++){
                var pgInput = forms[fi2].querySelector('input[name="page"], input[name="page_no"], input[name="p"]');
                if(pgInput){
                    pgInput.value = pageNo;
                    forms[fi2].submit();
                    return 'form_submit_page:'+pageNo;
                }
            }

            // 디버그: 실제 페이지에 있는 onclick 함수명 목록 반환
            var fnSet = {};
            var allA = document.querySelectorAll('a[onclick]');
            for(var di=0; di<allA.length && di<30; di++){
                var oc3 = allA[di].getAttribute('onclick') || '';
                var mD = oc3.match(/^\\s*(\\w+)\\s*\\(/);
                if(mD) fnSet[mD[1]] = (fnSet[mD[1]]||0)+1;
            }
            // 페이지 번호 링크 있는 a 태그 수집 (디버그)
            var numLinks = [];
            var allAA = document.querySelectorAll('a');
            for(var ni=0; ni<allAA.length; ni++){
                var t = allAA[ni].textContent.trim();
                if(/^\\d+$/.test(t) && parseInt(t) > 1 && parseInt(t) < 20) numLinks.push(t);
            }
            return 'not_found|fns=' + JSON.stringify(fnSet) + '|nums=' + JSON.stringify(numLinks);
        """, page_no)
        return result
    except:
        return 'error'


# ==============================================================================
# [함수] MAPS API - 기존 등록 사건번호 조회 (중복 방지)
# ==============================================================================
def get_existing_search_sakun_nos():
    if not ADMIN_KEY:
        print("  ⚠️ ADMIN_KEY가 설정되지 않아 중복체크를 건너뜁니다.")
        return set()
    try:
        url = f"{MAPS_WEBAPP_URL}?admin={urllib.parse.quote(ADMIN_KEY)}&api=getSearchItems"
        req = urllib.request.Request(url, headers={'User-Agent': 'MJMaps-Crawler/1.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if data.get('success'):
            items = data.get('items', [])
            # sakun_no + in-date 조합으로 중복 체크 키 생성
            keys = set()
            for item in items:
                sn = str(item.get('sakun_no', '')).strip()
                dt = str(item.get('in-date', '')).strip()
                if sn:
                    keys.add(sn)          # 사건번호만으로도 중복 체크
                    keys.add(f"{sn}|{dt}") # 사건번호+날짜 조합
            return keys
        else:
            print(f"  ⚠️ API 조회 실패: {data.get('message', '')}")
            return set()
    except Exception as e:
        print(f"  ⚠️ MAPS API 조회 오류: {e}")
        return set()


# ==============================================================================
# [함수] MAPS API - 신규 등록
# ==============================================================================
def save_search_items_to_maps(items_to_save):
    if not ADMIN_KEY:
        print("  ⚠️ ADMIN_KEY가 설정되지 않아 MAPS 등록을 건너뜁니다.")
        print(f"  → 크롤링 결과 {len(items_to_save)}건 (미등록):")
        for it in items_to_save:
            print(f"    - {it.get('sakun_no')} / {it.get('court')} / {it.get('in-date')}")
        return
    if not items_to_save:
        print("  → 등록할 새 물건이 없습니다.")
        return
    try:
        payload = json.dumps({
            "api_action": "saveSearchItems",
            "api_key": ADMIN_KEY,
            "items": items_to_save
        }, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            MAPS_WEBAPP_URL,
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'MJMaps-Crawler/1.0'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        if result.get('success'):
            print(f"  ✅ MAPS 등록 완료: {result.get('saved', 0)}건 저장, {result.get('skipped', 0)}건 중복 제외")
        else:
            print(f"  ❌ MAPS 등록 실패: {result.get('message', '알 수 없는 오류')}")
    except Exception as e:
        print(f"  ❌ MAPS API 전송 오류: {e}")
        traceback.print_exc()


# ==============================================================================
# [함수] 검색 결과 파싱 (1페이지 분량)
# ==============================================================================
def parse_search_results(driver, existing_keys, page_no=1):
    """검색 결과 페이지에서 물건 정보를 추출합니다."""
    time.sleep(2)
    remove_popups_css(driver)

    items = []
    skip_special = 0
    skip_area = 0
    skip_price = 0
    skip_dup = 0
    skip_past = 0

    # ── 실제 데이터 행만 추출: product_id 링크 포함 행 = 진짜 물건 행 ──
    all_containers_raw = driver.execute_script("""
        // product_id 링크가 있는 tr → 실제 경매 물건 행
        var allTr = document.querySelectorAll('tr');
        var result = [];
        for (var i = 0; i < allTr.length; i++) {
            var tr = allTr[i];
            if (tr.querySelector('a[href*="product_id="]') ||
                tr.querySelector('img[src*="auction1.co.kr"]')) {
                result.push(tr);
            }
        }
        return result;
    """)
    print(f"    [파서] product_id 행: {len(all_containers_raw)}개")

    if not all_containers_raw:
        # fallback 디버그
        debug_info = driver.execute_script("""
            var info = [];
            var trId = document.querySelectorAll('tr[id]');
            info.push('tr[id]:' + trId.length);
            var big = Array.from(trId).filter(function(el){ return el.getBoundingClientRect().height > 50; });
            info.push('h>50:' + big.length);
            if(big[0]) info.push('첫id=' + big[0].id);
            var tbodys = document.querySelectorAll('tbody');
            info.push('tbody수:' + tbodys.length);
            return info.join(' | ');
        """)
        print(f"    [디버그] {debug_info}")
        all_containers_raw = driver.find_elements(By.TAG_NAME, "tr")
        print(f"    [파서] fallback(tr전체): {len(all_containers_raw)}개")

    candidates = []
    for item in all_containers_raw:
        try:
            h = item.size.get('height', 0)
            if h < 30:
                continue
            text = item.text
            if not text.strip():
                continue
            # 경매 데이터 행 감지: 가격 숫자(xxx,xxx,xxx) or 날짜(2026.xx.xx) or 유찰/입찰 포함
            has_price = bool(re.search(r'\d{1,3}(?:,\d{3}){2,}', text))           # 220,000,000
            has_date  = bool(re.search(r'20\d{2}[\./]\d{1,2}[\./]\d{1,2}', text)) # 2026.04.20
            has_word  = bool(re.search(r'유찰|입찰|낙찰|경매', text))
            if has_price or has_date or has_word:
                candidates.append(item)
        except:
            continue

    total_count = len(candidates)
    print(f"    [파서] 후보 컨테이너: {total_count}개")

    # ITEM_START / ITEM_END 범위 적용
    start_idx = max(0, ITEM_START - 1)
    end_idx   = ITEM_END if ITEM_END is not None else total_count
    candidates = candidates[start_idx:end_idx]
    if ITEM_START > 1 or ITEM_END is not None:
        print(f"    [파서] 범위 적용: {ITEM_START}~{ITEM_END or total_count}번 ({len(candidates)}개)")

    if not candidates:

        print(f"    [{page_no}p] 처리할 물건이 없습니다.")
        return items, 0

    print(f"    [{page_no}p] 후보 {total_count}건 발견 → 필터링 시작")

    for i, container in enumerate(candidates):
        try:
            full_text = container.text

            # --- 아파트 필터 ---
            if APARTMENT_KEYWORD not in full_text:
                continue

            # --- 특수물건 체크 (핵심 필터) ---
            is_special, reason = is_special_item(driver, container)
            if is_special:
                skip_special += 1
                print(f"    🚫 [{i+1}/{total_count}] 특수물건 제외: {reason}")
                continue

            # ── full_text 파싱: 페이지에 보이는 데이터 그대로 추출 ──

            # --- 사건번호 (예: 24-87492 → 24타경87492) ---
            sak_m = re.search(r'\b\d{2,4}-\d+(?:-\d+)?\b', full_text)
            if sak_m:
                sakun_no = sak_m.group().replace('-', '타경', 1)
            else:
                sakun_no = f'번호미상{i}'

            # --- 입찰일자 (예: 2026.04.01) ---
            date_m = re.search(r'20(\d{2})[./](\d{1,2})[./](\d{1,2})', full_text)
            if date_m:
                year2  = date_m.group(1)
                month  = date_m.group(2).zfill(2)
                day    = date_m.group(3).zfill(2)
                in_date  = year2 + month + day
                bid_date = datetime.date(int('20' + year2), int(date_m.group(2)), int(date_m.group(3)))
            else:
                in_date  = ''
                bid_date = None

            # 입찰일 지난 물건 제외 (오늘 입찰 포함 - 오늘보다 이전만 제외)
            if bid_date and bid_date < datetime.date.today():
                skip_past += 1
                print(f"    ⏭  [{sakun_no}] 입찰일 {bid_date} 지남, 스킵")
                continue

            # --- 중복 체크 ---
            key1 = sakun_no
            key2 = f"{sakun_no}|{in_date}"
            if key1 in existing_keys or key2 in existing_keys:
                skip_dup += 1
                print(f"    ⏭  [{sakun_no}] 이미 MAPS에 등록됨, 스킵")
                continue

            # --- 물건종류 ---
            type_m = re.search(r'아파트|오피스텔|빌라|다세대|연립|단독주택|상가|토지|근린생활', full_text)
            item_type = type_m.group() if type_m else ''

            # --- 주소 (시/도 포함 라인) ---
            addr_m = re.search(
                r'((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S+\s[^\n\[]{5,100})',
                full_text
            )
            address = addr_m.group().strip() if addr_m else ''

            # --- 면적 (㎡ 포함 대괄호 전체: [대지권 37.105㎡..., 건물 84.944㎡...]) ---
            area_m = re.search(r'\[[^\]]*㎡[^\]]*\]', full_text)
            item_area = area_m.group() if area_m else ''

            # --- 물건상태 (유찰회수 + 특수 브라켓) ---
            status_parts = []
            fail_m = re.search(r'유찰\s*\d+회', full_text)
            if fail_m:
                status_parts.append(fail_m.group())
            sp_bracks = re.findall(r'\[[^\]]*(?:재매각|공시가격|특수)[^\]]*\]', full_text)
            status_parts.extend(sp_bracks)
            item_status = ' '.join(status_parts) if status_parts else '신건'

            # --- 가격 (콤마 포함 억원 단위: 854,000,000) ---
            prices = re.findall(r'\d{1,3}(?:,\d{3}){2,}', full_text)
            kamjungka_str     = prices[0] if len(prices) > 0 else ''
            min_bid_price_str = prices[1] if len(prices) > 1 else ''

            # --- 최저입찰율 ---
            rate_m = re.search(r'\((\d+)%\)', full_text)
            min_bid_rate = (rate_m.group(1) + '%') if rate_m else ''

            # --- 법원 ---
            court = get_court_from_text(full_text)

            # --- 감정가 필터 ---
            kamjungka_man = parse_price_to_man(kamjungka_str)
            if kamjungka_man > 0:
                if kamjungka_man < MIN_KAMJUNGKA_MAN or kamjungka_man > MAX_KAMJUNGKA_MAN:
                    skip_price += 1
                    print(f"    🔕 [{sakun_no}] 감정가({kamjungka_man}만원) 범위 초과, 스킵")
                    continue

            # --- 특수물건 항목명 (item_summary에 저장) ---
            item_summary = driver.execute_script("""
                var tbl = arguments[0];
                var nameMap = arguments[1];
                var excludeVals = arguments[2];
                var inputs = tbl.querySelectorAll('input[type="checkbox"], input[type="hidden"]');
                for (var i = 0; i < inputs.length; i++) {
                    var val = (inputs[i].value || '').trim();
                    if (val && nameMap[val] && excludeVals.indexOf(val) === -1) return nameMap[val];
                }
                var allEls = tbl.querySelectorAll('[data-special], [data-type]');
                for (var j = 0; j < allEls.length; j++) {
                    var spVal = (allEls[j].getAttribute('data-special') || allEls[j].getAttribute('data-type') || '').trim();
                    if (spVal && nameMap[spVal] && excludeVals.indexOf(spVal) === -1) return nameMap[spVal];
                }
                return '';
            """, container, SPECIAL_VALUE_NAME_MAP, list(SPECIAL_EXCLUDE_VALUES)) or ''

            # --- 이미지 URL ---
            img_url = driver.execute_script("""
                var tbl = arguments[0];
                var imgs = tbl.querySelectorAll('img');
                for(var i=0; i<imgs.length; i++){
                    var src = imgs[i].getAttribute('src') || '';
                    if(src && (src.indexOf('Thumnail') > -1 || src.indexOf('PubAuct') > -1 || src.indexOf('auction1') > -1)){
                        return src;
                    }
                }
                return '';
            """, container) or ''

            # --- auction_id ---
            auction_id = driver.execute_script("""
                var tbl = arguments[0];
                var link = tbl.querySelector('a[href*="product_id="]');
                if(link){ var m=link.href.match(/product_id=(\\d+)/); if(m) return m[1]; }
                var imgs = tbl.querySelectorAll('img');
                for(var i=0; i<imgs.length; i++){
                    var src = imgs[i].getAttribute('src') || '';
                    var m = src.match(/\\/m(\\d+)_/) || src.match(/\\/(\\d{5,})\\.jpg/);
                    if(m) return m[1];
                }
                return '';
            """, container) or ''

            item_data = {
                'in-date':       in_date,
                'sakun_no':      sakun_no,
                'court':         court,
                'item_type':     item_type,
                'item_summary':  item_summary,
                'item_area':     item_area,
                'item_status':   item_status,
                'kamjungka':     kamjungka_str,
                'min_bid_price': min_bid_price_str,
                'min_bid_rate':  min_bid_rate,
                'address':       address,
                'note1':         item_status if item_status != '신건' else '',
                'note2':         '',
                'josaja':        '',
                'reg_member':    'system',
                'auction_id':    str(auction_id),
                'img_url':       img_url,
                'josa_status':   '신규',
                'tags':          '아파트|84|2-10억',
                'search_group':  '아파트 84 2-10억',
            }

            items.append(item_data)
            print(f"    ✅ [{sakun_no}] {address or court} / {in_date} / 감정가:{kamjungka_str} / 면적:{item_area}")

        except Exception as e:
            print(f"    ⚠️ [{i+1}] 파싱 오류: {type(e).__name__}: {e}")
            continue

    print(f"    [{page_no}p] 결과: {len(items)}건 추출"
          f" (특수물건제외:{skip_special} 면적:{skip_area} 가격:{skip_price} 중복:{skip_dup} 기간:{skip_past})")
    return items, total_count


# ==============================================================================
# [메인] 크롤링 실행
# ==============================================================================
def run_crawler():
    print(f"\n🔑 계정: {ACCOUNT['id']}")
    if not ADMIN_KEY:
        print("⚠️  ADMIN_KEY가 비어있습니다. MAPS 등록 없이 크롤링만 진행합니다.")
        print("   MAPS GAS 에디터 → Admin메뉴 → 관리자 KEY 확인 후 스크립트 상단 ADMIN_KEY에 입력하세요.")

    # 기존 MAPS 등록 사건번호 조회 (중복 방지)
    print("\n📡 MAPS 기존 데이터 조회 중...")
    existing_keys = get_existing_search_sakun_nos()
    print(f"   기존 등록: {len(existing_keys) // 2}건")

    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_experimental_option("detach", True)

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.set_window_position(0, 0)
    wait = WebDriverWait(driver, 15)

    all_new_items = []

    try:
        # ── 로그인 ──
        print("\n🔐 로그인 중...")
        driver.get("https://www.auction1.co.kr/common/login_box.php")
        remove_popups_css(driver)
        wait.until(EC.presence_of_element_located((By.ID, SELECTOR_ID)))

        driver.execute_script(f"""
            document.getElementById('{SELECTOR_ID}').value = '{ACCOUNT["id"]}';
            var dummy = document.getElementById('{SELECTOR_PW_DUMMY}');
            var real = document.getElementById('{SELECTOR_PW_REAL}');
            if(dummy) dummy.style.display = 'none';
            if(real) {{ real.style.display = 'block'; real.value = '{ACCOUNT["pw"]}'; }}
        """)
        try:
            driver.find_element(By.XPATH, SELECTOR_LOGIN_BTN).click()
        except:
            driver.find_element(By.ID, SELECTOR_PW_REAL).send_keys(Keys.RETURN)
        time.sleep(2)
        # 로그인 후 새 탭/팝업이 열렸으면 가장 마지막 탭으로 전환
        handles = driver.window_handles
        if len(handles) > 1:
            driver.switch_to.window(handles[-1])
            print(f"   ↩ 새 탭 감지 → 탭 전환 (총 {len(handles)}개)")
        driver.set_window_position(0, 0)
        driver.maximize_window()
        print("   ✓ 로그인 완료")

        # ── 경매 검색 페이지 이동 ──
        from selenium.webdriver.common.action_chains import ActionChains
        print("\n[INFO] 경매 검색 시작 (아파트, 84m2, 2~10억, special=설정안함)...")

        def go_to_search_page():
            """종합검색 페이지로 이동. 성공 시 True 반환."""
            # 방법1: 메뉴 hover → 종합검색 링크 href로 직접 이동 (클릭 대신)
            try:
                driver.get("https://www.auction1.co.kr/")
                remove_popups_css(driver)
                time.sleep(2)

                menu = WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR,
                        "body > div.width_guide > div.header > div > ul > li:nth-child(1) > a"))
                )
                ActionChains(driver).move_to_element(menu).perform()
                time.sleep(1.5)  # 드롭다운 애니메이션 대기

                # href 추출해서 직접 이동 (클릭 불안정 문제 회피)
                links = driver.find_elements(By.XPATH,
                    "//div[contains(@class,'header')]//a[contains(text(),'종합검색')] | "
                    "//a[contains(text(),'종합검색')]")
                if links:
                    href = links[0].get_attribute('href') or ''
                    print(f"   v 종합검색 href: {href}")
                    if href and 'auction1' in href:
                        driver.get(href)
                        remove_popups_css(driver)
                        time.sleep(2)
                        return True
                    # href 없으면 JS click 시도
                    driver.execute_script("arguments[0].click();", links[0])
                    time.sleep(2)
                    remove_popups_css(driver)
                    return True
            except Exception as e:
                print(f"   ! 메뉴 방법 실패: {e}")

            # 방법2: 알려진 검색 URL로 직접 이동
            for url in [
                "https://www.auction1.co.kr/auction/list.php",
                "https://www.auction1.co.kr/auction/search.php",
                "https://www.auction1.co.kr/auction/",
            ]:
                try:
                    driver.get(url)
                    remove_popups_css(driver)
                    time.sleep(3)
                    if driver.find_elements(By.ID, "fm_aulist"):
                        print(f"   v 직접 URL 성공: {url}")
                        return True
                except:
                    pass
            return False

        nav_ok = go_to_search_page()

        # fm_aulist 폼 확인
        try:
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.ID, "fm_aulist"))
            )
            print("   v fm_aulist 검색폼 확인")
        except:
            print(f"   ! fm_aulist 없음 (현재URL: {driver.current_url[:80]})")
            print("   → 페이지 소스 일부:", driver.execute_script("return document.title + ' / ' + document.body.innerText.slice(0,100)"))
            raise RuntimeError("검색폼 로드 실패 - 수동으로 URL 확인 필요")
        time.sleep(1)

        # ── 검색 조건 세팅 ──
        print("   검색 조건 세팅 중...")
        driver.execute_script("""
            function setVal(id, val) {
                var el = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
                if(el) {
                    el.value = val;
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                }
            }
            // 가격 범위 (만원 단위) - class 기반 셀렉터 사용 (엑셀 설계: input.unite_ju.min_price)
            function setPriceInput(cls, val) {
                var el = document.querySelector('input.' + cls) ||
                         document.getElementById(cls) ||
                         document.querySelector('[name="' + cls + '"]');
                if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                }
            }
            setPriceInput('min_price', '20000');   // 2억
            setPriceInput('max_price', '100000');  // 10억

            // 개찰횟수 (2~3회차 = 유찰 1~2회)
            setVal('b_count1', '2');
            setVal('b_count2', '3');

            // 부동산 종류: 아파트
            var sClass = document.getElementById('s_class');
            if(sClass) {
                var opts = Array.from(sClass.options);
                var aptOpt = opts.find(o => o.text.includes('아파트'));
                if(aptOpt) {
                    sClass.value = aptOpt.value;
                    sClass.dispatchEvent(new Event('change', {bubbles: true}));
                }
            }

            // 면적 입력 (b_area1 = 84)
            setVal('b_area1', '84');

            // ★ 특수물건 = 설정안함(0) - 전체 검색 후 JS에서 필터링
            var special = document.getElementById('special');
            if(special) {
                special.value = '0';
                special.dispatchEvent(new Event('change', {bubbles: true}));
            }
        """)
        time.sleep(0.5)

        # ── 폼 값 실제 적용 여부 검증 ──
        form_vals = driver.execute_script("""
            function gv(id) {
                var el = document.getElementById(id) || document.querySelector('[name="'+id+'"]') || document.querySelector('input.'+id);
                return el ? el.value : 'NOT_FOUND';
            }
            return {
                min_price: gv('min_price'),
                max_price: gv('max_price'),
                b_area1:   gv('b_area1'),
                b_count1:  gv('b_count1'),
                b_count2:  gv('b_count2'),
                s_class:   gv('s_class'),
                state:     gv('state'),
                special:   gv('special'),
            };
        """)
        print(f"   [폼값확인] {form_vals}")
        print("   ✓ 검색 조건 세팅 완료 (special=설정안함/전체)")

        # ── 목록 수 설정 ──
        try:
            ls = driver.execute_script("""
                var s = document.getElementById('list_scale');
                if(s) { s.value = '50'; s.dispatchEvent(new Event('change', {bubbles:true})); return '50'; }
                return '기본';
            """)
            print(f"   ✓ 목록 수: {ls}개")
        except:
            pass

        # ── 정렬 설정 ──
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
            print(f"   ✓ 정렬 설정: {r}")
        except:
            pass

        # ── 검색 버튼 클릭 (엑셀 셀렉터 우선) ──
        search_clicked = False
        # 엑셀: #fm_aulist > table > tbody > tr:nth-child(12) > td > input.btn_box_s.btn_lightblack
        for sel_type, sel_val in [
            ('css', '#fm_aulist > table > tbody > tr:nth-child(12) > td > input.btn_box_s.btn_lightblack'),
            ('css', 'input.btn_lightblack'),
            ('css', 'input.btn_box_s'),
            ('id',  'btnSrch'),
        ]:
            try:
                if sel_type == 'css':
                    btn = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, sel_val)))
                else:
                    btn = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((By.ID, sel_val)))
                driver.execute_script("arguments[0].click();", btn)
                print(f"   v 검색 버튼 클릭 완료 [{sel_type}:{sel_val[:40]}]")
                search_clicked = True
                wait_for_ajax(driver)
                break
            except:
                continue
        if not search_clicked:
            # 최후 수단: 폼 submit
            try:
                driver.execute_script("document.getElementById('fm_aulist').submit();")
                print("   v 폼 submit 실행")
                wait_for_ajax(driver)
            except Exception as e:
                print(f"   ! 검색 실행 실패: {e}")

        # ── 1페이지 파싱 ──
        print("\n📋 [1페이지] 결과 파싱 중...")
        prev_fingerprint = get_page_fingerprint(driver)
        page1_items, page1_total = parse_search_results(driver, existing_keys, page_no=1)
        all_new_items.extend(page1_items)

        # ── 페이지네이션: goPage 방식 OR '다음' 버튼 방식 ──
        total_pages = get_total_pages(driver)
        # goPage 링크가 없으면 has_next_page로 다음 버튼 체크
        if total_pages == 1:
            total_pages = 999 if has_next_page(driver) else 1
        print(f"\n   총 {total_pages if total_pages < 999 else '다음버튼'}페이지 감지")

        pg = 2
        while pg <= total_pages:
            print(f"\n📋 [{pg}페이지] 이동 중...")

            # 1순위: goPage 방식
            result = go_to_page(driver, wait, pg)
            print(f"   페이지이동: {result}")

            if result == 'not_found':
                # 2순위: '다음' 버튼 클릭
                clicked = click_next_page(driver)
                if not clicked:
                    print(f"   ⚠️ [{pg}p] 다음 페이지 없음 - 크롤링 종료")
                    break
                print(f"   페이지이동: {clicked}")

            wait_for_ajax(driver)
            time.sleep(1.5)
            remove_popups_css(driver)

            # ── 막힌 페이지 감지: 페이지 내용이 이전과 동일하면 중단 ──
            curr_fingerprint = get_page_fingerprint(driver)
            if curr_fingerprint and prev_fingerprint and curr_fingerprint == prev_fingerprint:
                print(f"   ⚠️ [{pg}p] 페이지 내용이 이전과 동일 → 페이지 이동 실패, 크롤링 종료")
                break
            prev_fingerprint = curr_fingerprint

            pg_items, pg_total = parse_search_results(driver, existing_keys, page_no=pg)
            all_new_items.extend(pg_items)

            if pg_total == 0:
                print(f"   [{pg}p] 빈 페이지, 크롤링 종료")
                break

            # total_pages=999(다음버튼 방식)이면 매 페이지마다 다음 버튼 재확인
            if total_pages == 999 and not has_next_page(driver):
                print(f"   [{pg}p] 마지막 페이지 (다음 버튼 없음)")
                break

            if pg >= 50:
                print("   ⚠️ 안전 제한 50페이지 도달")
                break
            pg += 1

        print(f"\n📦 신규 등록 대상: {len(all_new_items)}건")

    except Exception as e:
        print(f"\n❌ 오류 발생:")
        traceback.print_exc()
    finally:
        print(f"\n👋 크롤링 종료")
        driver.quit()

    # ── MAPS 등록 ──
    if all_new_items:
        print("\n📤 MAPS에 등록 중...")
        save_search_items_to_maps(all_new_items)
    else:
        print("\n➡️ 등록할 신규 물건이 없습니다.")

    print("\n🎉 완료!")


if __name__ == "__main__":
    run_crawler()
