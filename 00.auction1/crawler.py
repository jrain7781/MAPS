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
import json, os, sys, time, traceback, threading
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
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
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

URL_LOGIN  = "https://www.auction1.co.kr/common/login_box.php"
URL_SEARCH = "https://www.auction1.co.kr/auction/ca_title.php"

_driver = None
_logged_in = False
_lock = threading.Lock()


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


def login_if_needed():
    global _logged_in
    if _logged_in:
        return
    d = get_driver()
    d.get(URL_LOGIN)
    WebDriverWait(d, 15).until(EC.presence_of_element_located((By.ID, "client_id")))
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
    time.sleep(2)
    _logged_in = True


def fill_form(d, form_data: dict):
    """우리 폼 데이터 → 옥션원 폼 필드 setter via JS"""
    for our_name, val in (form_data or {}).items():
        if our_name.startswith("_"):
            continue
        ax = FIELD_MAP.get(our_name)
        if not ax:
            continue
        v = "" if val is None else str(val).replace(",", "").strip()
        if not v:
            continue
        # JS 인젝션 방어 - 작은따옴표 escape
        v_safe = v.replace("\\", "\\\\").replace("'", "\\'")
        d.execute_script(
            f"""
            var el = document.querySelector('[name="{ax}"]');
            if (el) {{
                el.value = '{v_safe}';
                try {{ el.dispatchEvent(new Event('change')); }} catch(e) {{}}
            }}
            """
        )
    # 주소 다중 (_addrTags) 추가는 추후 구현 — 현재는 sido/gugun/dong 단일만
    # 물건종류 복수 (_multiProp) 도 추후


def submit_search(d):
    # ca_title.php 의 종합검색은 폼 fm_aulist - 검색 버튼은 input(image) 라 id 없음.
    # 폼 자체를 JS 로 submit (단순 사건번호 폼 fmSrchTop 과 구분).
    d.execute_script("document.getElementById('fm_aulist').submit();")
    WebDriverWait(d, 30).until(
        lambda dr: "ca_list" in dr.current_url or dr.find_elements(By.CSS_SELECTOR, "table.tbl_list tbody tr")
    )
    time.sleep(1.5)


def parse_results(d, max_rows: int = 100):
    """결과 페이지 tbl_list tbody tr 파싱 → 리스트 of dict"""
    rows = d.find_elements(By.CSS_SELECTOR, "table.tbl_list tbody tr")
    items = []
    for r in rows[:max_rows]:
        try:
            tds = r.find_elements(By.TAG_NAME, "td")
            if len(tds) < 8:
                continue
            # 셀 인덱스: 0체크 / 1사진 / 2사건번호+물건종류 / 3소재지 / 4감정/최저/평당 / 5진행상태 / 6매각기일 / 7조회수
            sakun_block = tds[2].text.strip().split("\n")
            sakun_no = sakun_block[0] if sakun_block else ""
            prop_kind = sakun_block[1] if len(sakun_block) > 1 else ""
            address = tds[3].text.strip()
            price = tds[4].text.strip()
            status = tds[5].text.strip()
            bid_date = tds[6].text.strip()
            view_count = tds[7].text.strip()
            # 사진 url
            img_el = tds[1].find_elements(By.TAG_NAME, "img")
            img_url = img_el[0].get_attribute("src") if img_el else ""
            items.append({
                "sakun_no": sakun_no,
                "prop_kind": prop_kind,
                "address": address,
                "price": price,
                "status": status,
                "bid_date": bid_date,
                "view_count": view_count,
                "img_url": img_url,
            })
        except Exception as e:
            print(f"[parse row err] {e}")
    return items


def crawl(form_data: dict, custom_filters: list | None = None):
    with _lock:
        print(f"\n[crawl] formData={form_data}")
        login_if_needed()
        d = get_driver()
        d.get(URL_SEARCH)
        WebDriverWait(d, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "table.tbl_fmSrch"))
        )
        time.sleep(0.5)
        fill_form(d, form_data)
        print(f"[crawl] form filled, current url={d.current_url}")
        submit_search(d)
        print(f"[crawl] after submit, current url={d.current_url}")
        items = parse_results(d)
        print(f"[crawl] parsed {len(items)} items")
        # 디버그: 결과 0 이면 페이지에 어떤 메시지/요소가 있는지 확인
        if not items:
            try:
                msg_els = d.find_elements(By.CSS_SELECTOR, "td.center, .nodata, .empty_list")
                msgs = [el.text.strip() for el in msg_els if el.text.strip()][:5]
                if msgs:
                    print(f"[crawl] page messages: {msgs}")
                title_el = d.find_elements(By.CSS_SELECTOR, "h1, h2, h3, .title")
                if title_el:
                    print(f"[crawl] page title elements: {[t.text.strip() for t in title_el[:3]]}")
            except Exception:
                pass
        return items


# ── HTTP 서버 ────────────────────────────────────────────────────
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

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
