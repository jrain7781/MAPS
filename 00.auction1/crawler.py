"""
crawler.py — 옥션원 크롤링 매니저 백엔드
- HTTP 정적 서버 + /api/crawl POST 엔드포인트
- Selenium 으로 옥션원(auction1.co.kr) 자동 검색 + 결과 파싱

실행:
    cd 00.auction1
    python crawler.py
브라우저: http://localhost:8765
"""
from __future__ import annotations
import json, os, re, sys, time, traceback, threading
from http.server import HTTPServer, SimpleHTTPRequestHandler

# stdout 버퍼링 비활성 (디버그 로그 즉시 보이게)
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager

# ── 로그인 정보 (00.imageup/01.i.py 의 ACCOUNTS 와 동일) ────────
ACCOUNT = {"id": "mjgold", "pw": "28471298"}

# ── 우리 폼 → 옥션원 폼 필드명 매핑 ──────────────────────────────
FIELD_MAP = {
    "court": "lawsup",
    "branch": "lesson",
    "caseYear": "num1",
    "caseNo": "num2",
    "apprMin": "ju_price1",
    "apprMax": "ju_price2",
    "status": "state",
    "failMin": "b_count1",
    "failMax": "b_count2",
    "propType": "s_class",
    "lowMin": "bi_price1",
    "lowMax": "bi_price2",
    "bidDateFrom": "next_biddate1",
    "bidDateTo": "next_biddate2",
    "bldArea1Min": "b_area1",
    "bldArea1Max": "b_area2",
    "bldArea2Min": "b_area_p1",
    "bldArea2Max": "b_area_p2",
    "lndArea1Min": "e_area1",
    "lndArea1Max": "e_area2",
    "lndArea2Min": "e_area_p1",
    "lndArea2Max": "e_area_p2",
    "regDateFrom": "bojon_date1",
    "regDateTo": "bojon_date2",
    "addrSido": "sido",
    "addrGugun": "gugun",
    "addrDong": "dong",
    "lotKind": "bunji_key",
    "lotFrom": "bunji1",
    "lotTo": "bunji2",
    "bldName": "bldname",
    "special": "special",
    "orderBy": "order",
    "pageSize": "scale",
    "procType": "sagun_type",
}

A1_BASE    = "https://www.auction1.co.kr"
URL_LOGIN  = f"{A1_BASE}/common/login_box.php"
URL_SEARCH = f"{A1_BASE}/auction/ca_title.php"

_driver = None
_lock = threading.Lock()
_last_login_at = 0.0
LOGIN_TTL_SEC = 30 * 60  # 30분 — 옥션원 세션 안에서 재로그인 안 하고 빠르게 처리

def _looks_like_login(html: str) -> bool:
    """응답 HTML 이 옥션원 로그인 페이지 / 비로그인 모달 페이지인지 판정"""
    if not html:
        return False
    head = html[:15000]
    if 'id="client_id"' in head or 'name="client_id"' in head:
        return True
    # ca_title.php 등에서 비로그인 시 옥션원이 띄우는 모달
    if '로그인 후 이용' in head:
        return True
    if 'popup_login' in head or 'login_pop' in head:
        return True
    return False


def get_driver():
    global _driver
    if _driver is not None:
        try:
            _ = _driver.title
            return _driver
        except Exception:
            _driver = None
    opts = webdriver.ChromeOptions()
    opts.add_argument("--window-size=1480,920")
    opts.add_experimental_option("detach", True)
    _driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=opts,
    )
    return _driver


def login_if_needed(force: bool = False):
    """TTL(30분) 내에는 로그인 skip — 첫 요청만 느리고 이후 매 요청은 즉시.
    force=True 또는 TTL 만료 시 옥션원 로그인 페이지로 가서 재로그인.
    """
    global _last_login_at
    if not force and (time.time() - _last_login_at) < LOGIN_TTL_SEC:
        return
    d = get_driver()
    print(f"[login] (re)login → {URL_LOGIN}")
    d.get(URL_LOGIN)
    try:
        WebDriverWait(d, 15).until(EC.presence_of_element_located((By.ID, "client_id")))
    except Exception:
        # 이미 로그인된 상태에서 옥션원이 메인으로 redirect — 강제로 logout 후 재시도하기보다 그대로 진행
        print("[login] client_id input not found (이미 로그인 상태?). 그대로 진행")
        return
    d.execute_script(
        f"""
        document.getElementById('client_id').value = '{ACCOUNT['id']}';
        var dummy = document.getElementById('pw_Dummy');
        var real = document.getElementById('passwd');
        if (dummy) dummy.style.display = 'none';
        if (real) {{ real.style.display = 'block'; real.value = '{ACCOUNT['pw']}'; }}
        """
    )
    try:
        d.find_element(
            By.XPATH,
            "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]",
        ).click()
    except Exception:
        d.find_element(By.ID, "passwd").send_keys(Keys.RETURN)
    # 로그인 완료 대기: client_id input 이 사라지거나 페이지가 다른 곳으로 이동할 때까지
    try:
        WebDriverWait(d, 10).until(
            lambda dr: "login_box" not in dr.current_url
            or not dr.find_elements(By.ID, "client_id")
        )
    except Exception:
        time.sleep(2)
    # 옥션원 세션 cookie / user_ssid 안정화 대기
    time.sleep(1.2)
    _last_login_at = time.time()
    print(f"[login] done, current_url={d.current_url}")


def fill_form(d, form_data: dict):
    """우리 폼 데이터 → 옥션원 폼 필드 setter
    - select 는 Selenium Select API (값 매칭 + 옵션 selected 속성 정확히 토글)
    - 일반 input 은 JS setter
    """
    for our_name, val in (form_data or {}).items():
        if our_name.startswith("_"):
            continue
        ax = FIELD_MAP.get(our_name)
        if not ax:
            continue
        v_raw = "" if val is None else str(val).strip()
        if not v_raw:
            continue
        try:
            el = d.find_element(By.NAME, ax)
        except NoSuchElementException:
            continue
        tag = el.tag_name.lower()
        if tag == "select":
            # select 의 option value 는 원본 그대로 (콤마 포함된 값 - 진행물건 '1,2,17,18',
            # 유찰횟수↓ 'b_count DESC,address DESC' 등 - 보존 필수)
            try:
                Select(el).select_by_value(v_raw)
                d.execute_script("arguments[0].dispatchEvent(new Event('change'));", el)
            except Exception as e:
                print(f"[fill_form] select fail {ax}={v_raw}: {e}")
        else:
            # text/date input - 사용자가 입력한 콤마(천단위) 제거 후 숫자만
            v_clean = v_raw.replace(",", "")
            v_safe = v_clean.replace("\\", "\\\\").replace("'", "\\'")
            d.execute_script(
                f"""
                var el = arguments[0];
                el.value = '{v_safe}';
                try {{ el.dispatchEvent(new Event('change')); }} catch(e) {{}}
                """,
                el,
            )
    # 주소 다중 추가: _addrTags 가 있으면 sido/gugun/dong 별로 set + addr_multi_plus() 호출
    addr_tags = (form_data or {}).get("_addrTags") or []
    sido_v = (form_data or {}).get("addrSido") or ""
    gugun_v = (form_data or {}).get("addrGugun") or ""
    dong_v = (form_data or {}).get("addrDong") or ""
    # 단일 sido 라도 _addrTags 가 있다는 것은 사용자가 [추가] 클릭으로 다중 적용을 의도한 것
    if addr_tags and sido_v:
        # 이미 sido/gugun/dong 은 fill_form 루프에서 set 된 상태. 옥션원의 addr_multi_plus 함수 호출.
        d.execute_script("if (typeof addr_multi_plus === 'function') addr_multi_plus();")
        time.sleep(0.3)


def submit_search(d):
    # ca_title.php 의 종합검색 — 검색 input 을 직접 클릭 (옥션원 onclick 검증 로직을 거치게)
    clicked = d.execute_script(
        """
        var f = document.getElementById('fm_aulist');
        if (!f) return 'noform';
        // 검색 버튼: input value=검색 또는 onclick 함수가 있는 element
        var btn = Array.from(f.querySelectorAll('input, span, a, button')).find(function(b){
            var v = (b.value || b.textContent || '').trim();
            return v === '검색';
        });
        if (btn) { btn.click(); return 'clicked'; }
        // fallback: search 함수 직접 호출
        if (typeof auction_ser === 'function') { auction_ser(); return 'fn:auction_ser'; }
        if (typeof go_search === 'function') { go_search(); return 'fn:go_search'; }
        f.submit();
        return 'fallback:submit';
        """
    )
    print(f"[crawl] submit -> {clicked}")
    WebDriverWait(d, 30).until(
        lambda dr: "ca_list" in dr.current_url or dr.find_elements(By.CSS_SELECTOR, "table.tbl_list tbody tr")
    )
    time.sleep(1.5)


def parse_results(d, max_rows: int = 100):
    """결과 페이지 tbl_list tbody tr 파싱 → 리스트 of dict
    각 셀의 innerHTML 도 함께 보내서 프론트엔드에서 옥션원 디자인 그대로 렌더한다.
    """
    rows = d.find_elements(By.CSS_SELECTOR, "table.tbl_list tbody tr")
    # 페이지 전역 변수에서 user_ssid 추출 (옥션원 ca_view URL 조립 필수)
    try:
        user_ssid = d.execute_script("return (typeof user_ssid !== 'undefined') ? user_ssid : '';") or ""
    except Exception:
        user_ssid = ""
    # 결과 행만 미리 필터 → line_tnum (전체 건수) 계산
    valid_rows = []
    for r in rows[:max_rows]:
        try:
            tds_chk = r.find_elements(By.TAG_NAME, "td")
            if len(tds_chk) >= 8:
                valid_rows.append((r, tds_chk))
        except Exception:
            pass
    line_tnum = len(valid_rows)
    items = []
    for r, tds in valid_rows:
        try:
            if len(tds) < 8:
                continue
            # 셀 인덱스: 0체크 / 1사진 / 2사건번호+물건종류 / 3소재지 / 4감정/최저/평당 / 5진행상태 / 6매각기일 / 7조회수
            sakun_block = tds[2].text.strip().split("\n")
            sakun_no = sakun_block[0] if sakun_block else ""
            prop_kind = sakun_block[1] if len(sakun_block) > 1 else ""
            # product_id (체크박스 value) + line_num (hidden input) 추출
            product_id = ""
            line_num = ""
            try:
                cb = tds[0].find_element(By.CSS_SELECTOR, "input[type=checkbox]")
                product_id = (cb.get_attribute("value") or "").strip()
            except Exception:
                pass
            try:
                ln_el = tds[0].find_element(By.CSS_SELECTOR, "input[name='line_num']")
                line_num = (ln_el.get_attribute("value") or "").strip()
            except Exception:
                pass
            if not product_id:
                try:
                    inner = tds[2].get_attribute("innerHTML") or ""
                    m = re.search(r"\(\s*(\d{5,})\s*,", inner)
                    if m:
                        product_id = m.group(1)
                except Exception:
                    pass
            # ca_view URL 조립 (옥션원이 user_ssid + line_tnum 검증함)
            view_url = ""
            if product_id:
                parts = [f"product_id={product_id}"]
                if line_num:  parts.append(f"line_num={line_num}")
                if line_tnum: parts.append(f"line_tnum={line_tnum}")
                if user_ssid: parts.append(f"user_ssid={user_ssid}")
                parts.append("person_hide=0")
                view_url = f"{A1_BASE}/auction/ca_view.php?" + "&".join(parts)
            # 사진 url
            img_el = tds[1].find_elements(By.TAG_NAME, "img")
            img_url = img_el[0].get_attribute("src") if img_el else ""

            def html_of(td):
                try:
                    return td.get_attribute("innerHTML") or ""
                except Exception:
                    return ""

            items.append({
                # 텍스트 (필터/검색용)
                "sakun_no": sakun_no,
                "prop_kind": prop_kind,
                "address": tds[3].text.strip(),
                "price": tds[4].text.strip(),
                "status": tds[5].text.strip(),
                "bid_date": tds[6].text.strip(),
                "view_count": tds[7].text.strip(),
                "img_url": img_url,
                "view_url": view_url,
                # 옥션원 원본 셀 HTML (렌더용)
                "img_html":     html_of(tds[1]),
                "sakun_html":   html_of(tds[2]),
                "address_html": html_of(tds[3]),
                "price_html":   html_of(tds[4]),
                "status_html":  html_of(tds[5]),
                "bid_html":     html_of(tds[6]),
                "view_html":    html_of(tds[7]),
            })
        except Exception as e:
            print(f"[parse row err] {e}")
    return items


def crawl(form_data: dict, custom_filters: list | None = None):
    with _lock:
        print(f"\n[crawl] formData={form_data}")
        def _do_search():
            d2 = get_driver()
            d2.get(URL_SEARCH)
            WebDriverWait(d2, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "table.tbl_fmSrch"))
            )
            time.sleep(0.5)
            fill_form(d2, form_data)
            print(f"[crawl] form filled, current url={d2.current_url}")
            submit_search(d2)
            print(f"[crawl] after submit, current url={d2.current_url}")
            return d2, parse_results(d2)
        # 사용자 요구: 크롤링 시 매번 강제 로그인 — 사건상세 모달 fetch 등으로 driver 가 다른 페이지에 있더라도 안전
        login_if_needed(force=True)
        d, items = _do_search()
        # 그래도 비로그인 모달 등이 보이면 1회 재시도
        if not items and _looks_like_login(d.page_source or ""):
            print("[crawl] still not logged in — retry")
            time.sleep(1)
            login_if_needed(force=True)
            d, items = _do_search()
        print(f"[crawl] parsed {len(items)} items")
        # 디버그: 결과 0 이면 페이지 스샷 + HTML 저장
        if not items:
            try:
                ts = time.strftime("%H%M%S")
                shot = os.path.join(os.path.dirname(__file__), f"_debug_{ts}.png")
                html = os.path.join(os.path.dirname(__file__), f"_debug_{ts}.html")
                d.save_screenshot(shot)
                with open(html, "w", encoding="utf-8") as f:
                    f.write(d.page_source)
                print(f"[crawl] zero results - saved {shot} and {html}")
                # 결과 영역 텍스트 추출 (어떤 안내 문구 떴는지)
                try:
                    body_text = d.find_element(By.TAG_NAME, "body").text
                    snippet = body_text[:1500].replace("\n\n", "\n")
                    print(f"[crawl] body text snippet:\n{snippet}")
                except Exception:
                    pass
            except Exception as e:
                print(f"[crawl] debug dump failed: {e}")
        return items


# ── HTTP 서버 ────────────────────────────────────────────────────
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # CORS — MAPS (GAS 웹앱) 등 외부 origin 에서 /api/case_detail, /health 호출 허용
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        # ping: 백엔드 살아있는지 빠른 감지용
        if self.path.startswith("/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"service":"auction1-crawler"}')
            return
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/crawl":
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            form_data = payload.get("formData") or {}
            custom_filters = payload.get("customFilters") or []
            items = crawl(form_data, custom_filters)
            body = json.dumps({"success": True, "count": len(items), "items": items}, ensure_ascii=False)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))
        except Exception as e:
            traceback.print_exc()
            err = {"success": False, "error": str(e)}
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(err, ensure_ascii=False).encode("utf-8"))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)
    port = 8765
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"[crawler] http://localhost:{port}  (정적 서버 + /api/crawl)")
    print(f"[crawler] working dir: {here}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[crawler] 종료")
        try:
            if _driver: _driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
