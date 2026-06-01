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
# ------------------------------------------------------------------------------
ITEM_START = 1      # ← 시작 번호
ITEM_END   = None   # ← 끝 번호 (None = 전체)

# ==============================================================================
# [핵심] 특수물건 검색 목록
# 제외 범위: value 9~27 (맹지~지분입찰) → 아래 목록에서 원천 제외
# 특수물건 하나씩 검색 → item_summary = 해당 특수물건명
# ==============================================================================
SPECIAL_VALUE_NAME_MAP = {
    '31': '오늘공고신건',
    '11': '재매각',
    '42': '재진행',
    '8':  '반값경매',
    '24': '1년경과물건',
    '33': '위반건축물',
    '34': '초보자경매',
    '1':  '유치권',
    '2':  '법정지상권',
    '29': '분묘기지권',
    '35': '유치권배제신청',
    '36': '임금채권',
    '45': 'HUG임차권',
    '25': '형식적경매(유치권)',
    '26': '형식적경매(공유물분할)',
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
# [함수] 총 페이지 수 / 다음 페이지 관련
# ==============================================================================
def has_next_page(driver):
    try:
        return driver.execute_script("""
            var goPageLinks = document.querySelectorAll('a[onclick*="goPage"]');
            for(var i=0; i<goPageLinks.length; i++){
                var m = (goPageLinks[i].getAttribute('onclick')||'').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if(m && parseInt(m[1]) > 1) return true;
            }
            var all = document.querySelectorAll('*');
            for(var i=0; i<all.length; i++){
                var el = all[i];
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
    try:
        return driver.execute_script("""
            var maxPg = 0, maxEl = null;
            var goPageLinks = document.querySelectorAll('a[onclick*="goPage"]');
            for(var i=0; i<goPageLinks.length; i++){
                var m = (goPageLinks[i].getAttribute('onclick')||'').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if(m){ var pg = parseInt(m[1]); if(pg > maxPg){ maxPg = pg; maxEl = goPageLinks[i]; } }
            }
            if(maxEl){ maxEl.click(); return 'goPage:'+maxPg; }
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
    try:
        page_info = driver.execute_script("""
            var maxPage = 1;
            var goPageLinks = document.querySelectorAll('a[onclick*="goPage"]');
            goPageLinks.forEach(function(a) {
                var m = (a.getAttribute('onclick') || '').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if (m) { var pg = parseInt(m[1]); if (pg > maxPage) maxPage = pg; }
            });
            return maxPage;
        """)
        return int(page_info) if page_info else 1
    except:
        return 1


# ==============================================================================
# [함수] 페이지 이동
# ==============================================================================
def go_to_page(driver, wait, page_no):
    try:
        result = driver.execute_script("""
            var pageNo = arguments[0];
            try { goPage(pageNo); return 'goPage:' + pageNo; } catch(e) {}
            var fnNames = ['goListPage','go_page','movePage','pageMove','changePage','listPage'];
            for(var fi=0; fi<fnNames.length; fi++){
                try {
                    if(typeof window[fnNames[fi]] === 'function'){
                        window[fnNames[fi]](pageNo);
                        return fnNames[fi]+':'+pageNo;
                    }
                } catch(e2){}
            }
            var goLinks = document.querySelectorAll('a[onclick*="goPage"]');
            for (var i = 0; i < goLinks.length; i++) {
                var m = (goLinks[i].getAttribute('onclick') || '').match(/goPage\\s*\\(\\s*(\\d+)\\s*\\)/);
                if (m && parseInt(m[1]) === pageNo) {
                    goLinks[i].click();
                    return 'goPage_click:' + pageNo;
                }
            }
            var selectors = ['#paging a', '.paging a', '#pager a', '.pager a',
                             '[class*="paging"] a', '[class*="pagination"] a', 'td a', 'div a'];
            for (var s = 0; s < selectors.length; s++) {
                var links = document.querySelectorAll(selectors[s]);
                for (var j = 0; j < links.length; j++) {
                    var txt = links[j].textContent.trim();
                    if (txt === String(pageNo)) { links[j].click(); return 'clicked:' + pageNo; }
                }
            }
            var allLinks = document.querySelectorAll('a');
            for (var k = 0; k < allLinks.length; k++) {
                var oc = allLinks[k].getAttribute('onclick') || '';
                var m2 = oc.match(/page_no[=,\\s]+(\\d+)/i);
                if (m2 && parseInt(m2[1]) === pageNo) { allLinks[k].click(); return 'page_no:' + pageNo; }
            }
            var allLinks2 = document.querySelectorAll('a');
            for (var k2 = 0; k2 < allLinks2.length; k2++) {
                var oc2 = allLinks2[k2].getAttribute('onclick') || '';
                var mFn = oc2.match(/^\\s*(\\w+)\\s*\\(\\s*\\d+/);
                if(mFn){ try{ window[mFn[1]](pageNo); return 'fn_'+mFn[1]+':'+pageNo; } catch(e3){} }
            }
            var forms = document.querySelectorAll('form');
            for(var fi2=0; fi2<forms.length; fi2++){
                var pgInput = forms[fi2].querySelector('input[name="page"], input[name="page_no"], input[name="p"]');
                if(pgInput){ pgInput.value = pageNo; forms[fi2].submit(); return 'form_submit_page:'+pageNo; }
            }
            var fnSet = {};
            var allA = document.querySelectorAll('a[onclick]');
            for(var di=0; di<allA.length && di<30; di++){
                var oc3 = allA[di].getAttribute('onclick') || '';
                var mD = oc3.match(/^\\s*(\\w+)\\s*\\(/);
                if(mD) fnSet[mD[1]] = (fnSet[mD[1]]||0)+1;
            }
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
            keys = set()
            for item in items:
                sn = str(item.get('sakun_no', '')).strip()
                dt = str(item.get('in-date', '')).strip()
                if sn:
                    keys.add(sn)
                    keys.add(f"{sn}|{dt}")
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
            headers={'Content-Type': 'application/json', 'User-Agent': 'MJMaps-Crawler/1.0'},
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
def parse_search_results(driver, existing_keys, page_no=1, item_summary=''):
    time.sleep(2)
    remove_popups_css(driver)

    items = []
    skip_price = 0
    skip_past = 0

    all_containers_raw = driver.execute_script("""
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
        debug_info = driver.execute_script("""
            var info = [];
            var trId = document.querySelectorAll('tr[id]');
            info.push('tr[id]:' + trId.length);
            var big = Array.from(trId).filter(function(el){ return el.getBoundingClientRect().height > 50; });
            info.push('h>50:' + big.length);
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
            has_price = bool(re.search(r'\d{1,3}(?:,\d{3}){2,}', text))
            has_date  = bool(re.search(r'20\d{2}[\./]\d{1,2}[\./]\d{1,2}', text))
            has_word  = bool(re.search(r'유찰|입찰|낙찰|경매', text))
            if has_price or has_date or has_word:
                candidates.append(item)
        except:
            continue

    total_count = len(candidates)
    print(f"    [파서] 후보 컨테이너: {total_count}개")

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

            if APARTMENT_KEYWORD not in full_text:
                continue

            sak_m = re.search(r'\b(\d{2,4})-(\d+)(?:-\d+)?\b', full_text)
            if sak_m:
                yr = sak_m.group(1)
                if len(yr) == 2:
                    yr = '20' + yr
                sakun_no = yr + '타경' + sak_m.group(2)
            else:
                sakun_no = f'번호미상{i}'

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

            if bid_date and bid_date < datetime.date.today():
                skip_past += 1
                print(f"    ⏭  [{sakun_no}] 입찰일 {bid_date} 지남, 스킵")
                continue

            type_m = re.search(r'아파트|오피스텔|빌라|다세대|연립|단독주택|상가|토지|근린생활', full_text)
            item_type = type_m.group() if type_m else ''

            address = driver.execute_script("""
                var tr = arguments[0];
                var el = tr.querySelector('td:nth-child(4) > span > div[class*="addr"]');
                if (el) return (el.innerText || el.textContent || '').trim();
                var el2 = tr.querySelector('div[class*="addr"]');
                if (el2) return (el2.innerText || el2.textContent || '').trim();
                return '';
            """, container) or ''

            area_m = re.search(r'\[[^\]]*㎡[^\]]*\]', full_text)
            item_area = area_m.group() if area_m else ''

            status_parts = []
            fail_m = re.search(r'유찰\s*\d+회', full_text)
            if fail_m:
                status_parts.append(fail_m.group())
            sp_bracks = re.findall(r'\[[^\]]*(?:재매각|공시가격|특수)[^\]]*\]', full_text)
            status_parts.extend(sp_bracks)
            item_status = ' '.join(status_parts) if status_parts else '신건'

            prices = re.findall(r'\d{1,3}(?:,\d{3}){2,}', full_text)
            kamjungka_str     = prices[0] if len(prices) > 0 else ''
            min_bid_price_str = prices[1] if len(prices) > 1 else ''

            rate_m = re.search(r'\((\d+)%\)', full_text)
            min_bid_rate = (rate_m.group(1) + '%') if rate_m else ''

            court = get_court_from_text(full_text)

            kamjungka_man = parse_price_to_man(kamjungka_str)
            if kamjungka_man > 0:
                if kamjungka_man < MIN_KAMJUNGKA_MAN or kamjungka_man > MAX_KAMJUNGKA_MAN:
                    skip_price += 1
                    print(f"    🔕 [{sakun_no}] 감정가({kamjungka_man}만원) 범위 초과, 스킵")
                    continue

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
            print(f"    ✅ [{sakun_no}] {address or court} / {in_date} / 특수:{item_summary} / 감정가:{kamjungka_str}")

        except Exception as e:
            print(f"    ⚠️ [{i+1}] 파싱 오류: {type(e).__name__}: {e}")
            continue

    print(f"    [{page_no}p] 결과: {len(items)}건 추출 (가격필터:{skip_price} 기간:{skip_past})")
    return items, total_count


# ==============================================================================
# [메인] 크롤링 실행
# ==============================================================================
def run_crawler():
    print(f"\n🔑 계정: {ACCOUNT['id']}")
    if not ADMIN_KEY:
        print("⚠️  ADMIN_KEY가 비어있습니다.")

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

    # ── 로그인 함수 (재로그인 시 재사용) ──
    def do_login():
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
        handles = driver.window_handles
        if len(handles) > 1:
            driver.switch_to.window(handles[-1])
            print(f"   ↩ 새 탭 감지 → 탭 전환 (총 {len(handles)}개)")
        driver.set_window_position(0, 0)
        driver.maximize_window()
        print("   ✓ 로그인 완료")

    # ── 로그인 상태 확인 ──
    def is_logged_in():
        """로그아웃 상태 감지: 로그인 폼이 보이거나 URL에 login 포함이면 False"""
        try:
            cur_url = driver.current_url.lower()
            if 'login' in cur_url:
                return False
            # 페이지 텍스트에서 로그아웃 신호 감지
            body_text = driver.execute_script("return (document.body.innerText || '').slice(0, 500);") or ''
            if '로그인' in body_text and ('아이디' in body_text or '비밀번호' in body_text):
                return False
            # 로그인 폼 요소 존재 여부
            login_form = driver.find_elements(By.ID, SELECTOR_ID)
            if login_form and login_form[0].is_displayed():
                return False
            return True
        except:
            return True  # 판단 불가 시 로그인 상태로 간주

    # ── 로그아웃 확인 후 필요 시 재로그인 ──
    def ensure_logged_in():
        if not is_logged_in():
            print("\n⚠️  로그아웃 감지! 재로그인 시도...")
            do_login()
            return True  # 재로그인 발생
        return False

    from selenium.webdriver.common.action_chains import ActionChains

    # ── 검색 페이지 이동 (최초 1회 또는 폼 없을 때 fallback) ──
    def go_to_search_page():
        try:
            driver.get("https://www.auction1.co.kr/")
            remove_popups_css(driver)
            time.sleep(2)

            # 로그아웃 됐으면 재로그인 후 다시 시도
            if ensure_logged_in():
                driver.get("https://www.auction1.co.kr/")
                remove_popups_css(driver)
                time.sleep(2)

            menu = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR,
                    "body > div.width_guide > div.header > div > ul > li:nth-child(1) > a"))
            )
            ActionChains(driver).move_to_element(menu).perform()
            time.sleep(1.5)

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
                driver.execute_script("arguments[0].click();", links[0])
                time.sleep(2)
                remove_popups_css(driver)
                return True
        except Exception as e:
            print(f"   ! 메뉴 방법 실패: {e}")

        for url in [
            "https://www.auction1.co.kr/auction/list.php",
            "https://www.auction1.co.kr/auction/search.php",
            "https://www.auction1.co.kr/auction/",
        ]:
            try:
                driver.get(url)
                remove_popups_css(driver)
                time.sleep(3)
                ensure_logged_in()
                if driver.find_elements(By.ID, "fm_aulist"):
                    print(f"   v 직접 URL 성공: {url}")
                    return True
            except:
                pass
        return False

    # ── 전체 조건 세팅 (최초 1회) ──
    def set_search_conditions(special_val):
        driver.execute_script("""
            function setVal(id, val) {
                var el = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
                if(el) { el.value = val; el.dispatchEvent(new Event('change', {bubbles:true})); }
            }
            function setPriceInput(cls, val) {
                var el = document.querySelector('input.' + cls) || document.getElementById(cls);
                if(el) { el.value = val; el.dispatchEvent(new Event('change', {bubbles:true})); }
            }
            setPriceInput('min_price', '20000');
            setPriceInput('max_price', '100000');
            setVal('b_count1', '2');
            setVal('b_count2', '3');
            var sClass = document.getElementById('s_class');
            if(sClass) {
                var aptOpt = Array.from(sClass.options).find(o => o.text.includes('아파트'));
                if(aptOpt) { sClass.value = aptOpt.value; sClass.dispatchEvent(new Event('change', {bubbles:true})); }
            }
            setVal('b_area1', '84');
            var special = document.getElementById('special');
            if(special) { special.value = arguments[0]; special.dispatchEvent(new Event('change', {bubbles:true})); }
        """, special_val)
        time.sleep(0.5)

    # ── 특수물건만 변경 (2회차 이후) ──
    def change_special_only(special_val):
        driver.execute_script("""
            var special = document.getElementById('special');
            if(special) {
                special.value = arguments[0];
                special.dispatchEvent(new Event('change', {bubbles:true}));
            }
        """, special_val)
        time.sleep(0.3)

    def click_search():
        for sel in [
            '#fm_aulist > table > tbody > tr:nth-child(12) > td > input.btn_box_s.btn_lightblack',
            'input.btn_lightblack', 'input.btn_box_s',
        ]:
            try:
                btn = WebDriverWait(driver, 5).until(EC.presence_of_element_located((By.CSS_SELECTOR, sel)))
                driver.execute_script("arguments[0].click();", btn)
                wait_for_ajax(driver)
                return True
            except:
                continue
        try:
            driver.execute_script("document.getElementById('fm_aulist').submit();")
            wait_for_ajax(driver)
            return True
        except:
            return False

    def crawl_all_pages(summary_name):
        items = []
        prev_fp = get_page_fingerprint(driver)
        print(f"\n📋 [1페이지] 파싱 중...")
        pg1, _ = parse_search_results(driver, existing_keys, page_no=1, item_summary=summary_name)
        items.extend(pg1)

        total_pages = get_total_pages(driver)
        if total_pages == 1:
            total_pages = 999 if has_next_page(driver) else 1

        pg = 2
        while pg <= total_pages:
            print(f"\n📋 [{pg}페이지] 이동 중...")
            result = go_to_page(driver, wait, pg)
            if 'not_found' in str(result):
                if not click_next_page(driver):
                    break
            wait_for_ajax(driver)
            time.sleep(1.5)
            remove_popups_css(driver)
            curr_fp = get_page_fingerprint(driver)
            if curr_fp and prev_fp and curr_fp == prev_fp:
                print(f"   ⚠️ [{pg}p] 페이지 이동 실패, 종료")
                break
            prev_fp = curr_fp
            pg_items, pg_total = parse_search_results(driver, existing_keys, page_no=pg, item_summary=summary_name)
            items.extend(pg_items)
            if pg_total == 0:
                break
            if total_pages == 999 and not has_next_page(driver):
                break
            if pg >= 50:
                break
            pg += 1
        return items

    try:
        # ── 최초 로그인 ──
        do_login()

        # ── 특수물건별 루프 검색 ──
        # 최초 1회: 검색 페이지 이동 + 전체 조건 세팅
        # 2회차 이후: 검색폼이 살아있으면 특수물건만 변경, 없으면 폼 재이동
        first_iteration = True

        for sp_val, sp_name in SPECIAL_VALUE_NAME_MAP.items():
            print(f"\n{'='*50}")
            print(f"🔍 특수물건 [{sp_name}] (value={sp_val}) 검색")
            print(f"{'='*50}")

            # 로그아웃 체크
            ensure_logged_in()

            # 검색폼(fm_aulist) 현재 페이지에 살아있는지 확인
            form_alive = bool(driver.find_elements(By.ID, "fm_aulist"))

            if first_iteration or not form_alive:
                if not form_alive and not first_iteration:
                    print(f"   ↩ 검색폼 없음 → 검색 페이지 재이동")
                nav_ok = go_to_search_page()
                try:
                    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "fm_aulist")))
                except:
                    print(f"   ! 검색폼 로드 실패, 건너뜀")
                    continue
                set_search_conditions(sp_val)
                first_iteration = False
            else:
                # 검색폼 살아있음 → 특수물건만 변경
                print(f"   ♻️  검색폼 재활용: 특수물건만 변경")
                change_special_only(sp_val)

            if not click_search():
                print(f"   ! 검색 실행 실패, 건너뜀")
                continue

            # 검색 후 로그아웃 됐는지 체크 (결과 0건인데 로그인 페이지로 이동)
            if ensure_logged_in():
                # 재로그인 후 검색폼부터 다시
                nav_ok = go_to_search_page()
                try:
                    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "fm_aulist")))
                except:
                    print(f"   ! 재로그인 후 검색폼 로드 실패, 건너뜀")
                    continue
                set_search_conditions(sp_val)
                if not click_search():
                    print(f"   ! 재시도 검색 실패, 건너뜀")
                    continue

            sp_items = crawl_all_pages(sp_name)
            all_new_items.extend(sp_items)
            print(f"   → [{sp_name}] {len(sp_items)}건 수집")

        print(f"\n📦 총 등록 대상: {len(all_new_items)}건")

    except Exception as e:
        print(f"\n❌ 오류 발생:")
        traceback.print_exc()
    finally:
        print(f"\n👋 크롤링 종료")
        driver.quit()

    if all_new_items:
        print("\n📤 MAPS에 등록 중...")
        save_search_items_to_maps(all_new_items)
    else:
        print("\n➡️ 등록할 신규 물건이 없습니다.")

    print("\n🎉 완료!")


if __name__ == "__main__":
    run_crawler()
