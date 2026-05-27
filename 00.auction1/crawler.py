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
import json, os, re, sys, time, traceback, threading, base64
import urllib.request, urllib.error
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler

# 법원 매칭 모듈 (00.imageup/court_jurisdiction.py 재사용)
try:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "00.imageup"))
    from court_jurisdiction import find_court as _find_court, _JURISDICTION_MAP
    def _court_from_address(addr_text):
        if not addr_text: return ""
        first_line = str(addr_text).split("\n")[0].strip()
        try:
            c = _find_court(first_line, _JURISDICTION_MAP)
            return "" if c == "기타" else c
        except Exception:
            return ""
except Exception as _e:
    print(f"[court] 매핑 모듈 로드 실패: {_e}")
    def _court_from_address(addr_text):
        return ""

# ── MAPS GAS 웹앱 (메인 deployment) ────────────────────────
GAS_WEBAPP_URL = (
    "https://script.google.com/macros/s/"
    "AKfycby1SnLYJmPQ9PU0JlEZC5rG3e9y9s6wMVrsPeG_gqgDBnK9FMkyVPb3v5V0DFI14ETZiA"
    "/exec"
)


def _img_to_b64_data_uri(url: str, max_bytes: int = 35000) -> str:
    """옥션원 CloudFront signed URL 을 Python 으로 즉시 다운로드 후 base64 data: URI 로 반환.
    실패 시 원본 URL 반환 (옛 동작 호환). 35KB 초과 시도 원본 URL 반환 (셀 한도 보호).
    크롤 시점은 URL 이 살아있는 시각이라 거의 항상 200 응답."""
    if not url or not isinstance(url, str): return ""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "Referer": "https://www.auction1.co.kr/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            },
        )
        with urllib.request.urlopen(req, timeout=8.0) as resp:
            if resp.status != 200:
                return url
            raw = resp.read()
            if len(raw) > max_bytes:
                return url  # 너무 커서 시트 셀 한도(50K char) 위험 → URL 유지 (24h 만료 위험 감수)
            mime = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip() or "image/jpeg"
            b64 = base64.b64encode(raw).decode("ascii")
            return f"data:{mime};base64,{b64}"
    except Exception as e:
        # 만료/네트워크/타임아웃 → 원본 URL 유지 (MAPS 가 그래도 24h 동안은 표시 가능)
        return url


def _gas_post(payload: dict, timeout: float = 60.0) -> dict:
    """GAS 웹앱으로 JSON POST 호출. 응답 JSON 반환."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        GAS_WEBAPP_URL,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"success": False, "error": "GAS 응답 JSON 파싱 실패", "raw": raw[:500]}
    except urllib.error.HTTPError as e:
        return {"success": False, "error": f"HTTP {e.code} {e.reason}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# stdout 버퍼링 비활성 + utf-8 강제 (Windows 콘솔 cp949 가 한글/유니코드 못 찍어 print 실패 → 예외 → 크롤 실패 막기 위함)
try:
    sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
except Exception:
    pass

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    NoSuchElementException, TimeoutException, NoAlertPresentException,
    UnexpectedAlertPresentException,
)
from webdriver_manager.chrome import ChromeDriverManager

# ── 로그인 정보 (기본 fallback — 프론트엔드 설정 모달의 활성 계정이 우선) ────────
ACCOUNT = {"id": "mjgold", "pw": "28471298"}

def _resolve_account(account):
    """account dict 가 유효(id/pw 둘 다 있음)면 그것 사용, 아니면 기본 ACCOUNT.
    return: {id, pw, label}
    """
    if isinstance(account, dict):
        aid = str(account.get("id") or "").strip()
        apw = str(account.get("pw") or "")
        if aid and apw:
            return {"id": aid, "pw": apw, "label": str(account.get("label") or aid)}
    return {"id": ACCOUNT["id"], "pw": ACCOUNT["pw"], "label": ACCOUNT["id"] + " (기본)"}

def _esc_js(s):
    return str(s).replace("\\", "\\\\").replace("'", "\\'")

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
_cancel_event = threading.Event()  # 크롤링 페이지 순회 중간 중지 신호

# 크롤링 동작 설정 (프론트엔드 설정 모달에서 보내옴 — 누락 시 안전한 기본값)
DEFAULT_SETTINGS = {
    "useSessionReuse": True,    # True 면 login_if_needed force=False (TTL 30분 활용). False 면 매번 강제 재로그인 (기존 동작)
    "verifyLogin":     True,    # 로그인 후 사용자 표시 elem 확인 — 실패 시 _last_login_at 리셋해서 다음 호출에서 재로그인
    "retryEnabled":    True,    # 0건 + 비로그인 감지 시 백오프 재시도 활성
    "retryCount":      2,
    "retryBackoffSec": [5, 15], # 부족하면 마지막 값 반복
}

def _coerce_settings(s):
    out = dict(DEFAULT_SETTINGS)
    if isinstance(s, dict):
        for k in out.keys():
            if k in s and s[k] is not None:
                out[k] = s[k]
    # 타입 정규화
    try: out["retryCount"] = max(0, int(out["retryCount"]))
    except: out["retryCount"] = 0
    if not isinstance(out["retryBackoffSec"], list):
        out["retryBackoffSec"] = list(DEFAULT_SETTINGS["retryBackoffSec"])
    out["retryBackoffSec"] = [max(0, int(x)) for x in out["retryBackoffSec"] if isinstance(x, (int, float))]
    if not out["retryBackoffSec"]:
        out["retryBackoffSec"] = [5]
    return out

# 크롤링 진행상황 (프론트 폴링용)
_progress = {
    "running": False,
    "current": 0,          # 지금까지 받은 행 수
    "total": 0,            # 옥션원이 알린 전체 건수 (0 = 미정)
    "pages_done": 0,
    "started_at": 0.0,
    "cancelled": False,
    "stage": "",           # 'login' | 'search' | 'paging' | 'done' | 'cancelled' | 'fail'
    # 세션 가로채기 / 비로그인 감지 추적
    "hijack_count": 0,           # 현재 크롤에서 감지된 가로채기/세션누락 횟수 (= retry 발동 횟수)
    "hijack_detected": False,    # 한 번이라도 발동했는지
    "hijack_reason": "",         # 마지막 감지 사유 ('session_hijacked')
    # 자격 증명 오류 (PW 변경/오타 등) — 옥션원이 alert 으로 띄움
    "auth_error": False,
    "auth_error_reason": "",
}

def _get_total_record(d):
    """ca_list.php 페이지에서 '물건수 : N건' 텍스트 또는 URL total_record=N 추출"""
    try:
        src = d.page_source or ""
    except Exception:
        return 0
    m = re.search(r"물건수\s*:\s*([\d,]+)\s*건", src)
    if m:
        try: return int(m.group(1).replace(",", ""))
        except: pass
    m = re.search(r"total_record=(\d+)", src)
    if m:
        try: return int(m.group(1))
        except: pass
    return 0

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


def _accept_alert_if_any(d, timeout: float = 2.0, tag: str = "") -> str | None:
    """alert 떠 있으면 텍스트 로깅 후 accept. 없으면 None.

    옥션원 대표 alert:
      - "같은 ID로 동시 접속하여 서비스를 이용할 수 없습니다." (동시접속 — accept 시 우리가 새 세션 차지)
      - "로그인 후 이용..." (비로그인 — 검색 시도 시)
      - 만료/에러 류
    accept 자체가 옥션원 정책상 새 세션을 활성화시키는 동작이므로 안전.
    """
    try:
        WebDriverWait(d, timeout).until(EC.alert_is_present())
    except (TimeoutException, NoAlertPresentException):
        return None
    except Exception as e:
        print(f"[alert{':'+tag if tag else ''}] wait failed: {e}")
        return None
    try:
        a = d.switch_to.alert
        text = (a.text or "").replace("\n", " ").strip()
        print(f"[alert{':'+tag if tag else ''}] {text!r} → accept")
        a.accept()
        return text
    except NoAlertPresentException:
        return None
    except Exception as e:
        print(f"[alert{':'+tag if tag else ''}] accept failed: {e}")
        return None


def _drain_alerts(d, max_iter: int = 3, tag: str = "") -> list:
    """여러 개 연속 알럿(드물지만 가능) 다 비우기."""
    seen = []
    for _ in range(max_iter):
        t = _accept_alert_if_any(d, timeout=0.5, tag=tag)
        if not t:
            break
        seen.append(t)
    return seen


def _is_unauth_after_search(d) -> tuple:
    """검색 submit 후 비로그인/PW오류 상태인지 multi-signal 검사.
    return: (unauth: bool, reason: str) — reason 은 'cert_redirect' | 'login_modal' | 'login_class' | 'no_user_ssid' | 'ca_title_stuck' | ''
    """
    try:
        cur = (d.current_url or "").lower()
    except Exception:
        cur = ""
    # 정상: 결과 페이지 ca_list.php
    if "ca_list" in cur:
        return (False, "")
    # cert.php redirect — PW 오류 강한 신호
    if "/member/cert.php" in cur:
        return (True, "cert_redirect")
    # ca_title.php 그대로 머무름 또는 login_box 로 갔으면 검색 자체 못 함 → 비로그인
    # selenium DOM 으로 확정 신호 다단계 검사 (Chrome MCP 로 직접 확인한 selector 들)
    try:
        # 1) section_login_on class — 옥션원 비로그인 wrapper (Chrome MCP 로 확인)
        if d.find_elements(By.CSS_SELECTOR, ".section_login_on"):
            return (True, "login_class")
    except Exception:
        pass
    try:
        # 2) "로그인 후 이용" 텍스트 (visible 안 보일 수도 있지만 DOM 엔 존재)
        if d.find_elements(By.XPATH, "//*[contains(text(),'로그인 후 이용')]"):
            return (True, "login_modal")
    except Exception:
        pass
    try:
        # 3) user_ssid JS 변수 — 옥션원 인증된 세션이면 truthy
        has_ssid = bool(d.execute_script("return (typeof user_ssid !== 'undefined') && !!user_ssid;"))
        if not has_ssid:
            return (True, "no_user_ssid")
    except Exception:
        pass
    # ca_title 에 머무름 = search 안 먹음 = 비로그인 (위에서 못 잡았어도)
    if "ca_title" in cur:
        return (True, "ca_title_stuck")
    return (False, "")


def _verify_logged_in(d) -> bool:
    """로그인 표시 elem 확인 — 옥션원의 user_ssid 변수 또는 로그아웃 링크 존재 여부.
    fallback 보수적: 못 찾으면 False 반환 (=재로그인 트리거). 단 client_id input 자체가 안 보이면 페이지가 로그인 폼이 아니므로 통과시킴(기존 동작 호환)."""
    try:
        # user_ssid 가 있으면 옥션원 입장에서 인증된 세션
        has_user_ssid = bool(d.execute_script("return (typeof user_ssid !== 'undefined') && !!user_ssid;"))
    except Exception:
        has_user_ssid = False
    if has_user_ssid:
        return True
    try:
        # 로그아웃 / mypage / 마이페이지 링크 등
        if d.find_elements(By.XPATH, "//a[contains(@href,'logout') or contains(@href,'mypage') or contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'logout') or contains(text(),'로그아웃') or contains(text(),'마이페이지')]"):
            return True
    except Exception:
        pass
    try:
        # 로그인 폼이 보이면 명백히 비로그인
        if d.find_elements(By.ID, "client_id"):
            return False
    except Exception:
        pass
    # 옥션원 페이지에 따라 표시 elem 이 다를 수 있음 → 둘 다 못 찾고 client_id 도 없으면 알 수 없음 → 통과 (기존 동작 호환)
    return True


def login_if_needed(force: bool = False, verify_login: bool = True, account=None):
    """TTL(30분) 내에는 로그인 skip — 첫 요청만 느리고 이후 매 요청은 즉시.
    force=True 또는 TTL 만료 시 옥션원 로그인 페이지로 가서 재로그인.
    verify_login=True 면 로그인 후 사용자 표시 elem 확인 — 실패 시 _last_login_at 리셋.
    account=None 이면 기본 ACCOUNT, dict 면 그 계정 사용.
    """
    global _last_login_at
    creds = _resolve_account(account)
    if not force and (time.time() - _last_login_at) < LOGIN_TTL_SEC:
        return
    d = get_driver()
    # 시작 전 잔여 알럿 정리 (이전 작업의 잔재일 수 있음)
    _drain_alerts(d, tag="pre")
    print(f"[login] (re)login → {URL_LOGIN} (account={creds['label']})")
    # 페이지 이동 자체가 알럿을 띄울 수 있으므로 UnexpectedAlertPresent 안전 처리
    try:
        d.get(URL_LOGIN)
    except UnexpectedAlertPresentException:
        _drain_alerts(d, tag="nav")
        d.get(URL_LOGIN)
    _drain_alerts(d, tag="after-nav")
    try:
        WebDriverWait(d, 15).until(EC.presence_of_element_located((By.ID, "client_id")))
    except UnexpectedAlertPresentException:
        _drain_alerts(d, tag="wait-form")
    except Exception:
        # 이미 로그인된 상태에서 옥션원이 메인으로 redirect — 그대로 진행
        print("[login] client_id input not found (이미 로그인 상태?). 그대로 진행")
        _last_login_at = time.time()
        return
    _id_js = _esc_js(creds["id"])
    _pw_js = _esc_js(creds["pw"])
    d.execute_script(
        f"""
        document.getElementById('client_id').value = '{_id_js}';
        var dummy = document.getElementById('pw_Dummy');
        var real = document.getElementById('passwd');
        if (dummy) dummy.style.display = 'none';
        if (real) {{ real.style.display = 'block'; real.value = '{_pw_js}'; }}
        """
    )
    try:
        d.find_element(
            By.XPATH,
            "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]",
        ).click()
    except UnexpectedAlertPresentException:
        _drain_alerts(d, tag="submit-click")
    except Exception:
        try:
            d.find_element(By.ID, "passwd").send_keys(Keys.RETURN)
        except UnexpectedAlertPresentException:
            _drain_alerts(d, tag="submit-enter")
    # 옥션원이 즉시 띄우는 알럿(동시접속/잘못된 비번/만료 등) 처리.
    #   동시접속 alert 은 accept 자체가 새 세션을 활성화 → 추가 retry 불필요.
    seen = _drain_alerts(d, tag="post-submit")
    if seen:
        for t in seen:
            if "동시 접속" in t or "동시접속" in t:
                print("[login] 동시접속 alert → accept 로 우리 세션이 우선권 확보")
            elif ("비밀번호" in t) or ("아이디" in t) or ("일치하지" in t) or ("잘못" in t) or ("다시 입력" in t) or ("다시 확인" in t):
                # ★ 자격 증명 오류 — 프론트가 자동으로 검증 결과 업데이트 가능하도록 _progress 에 마킹
                print(f"[login][AUTH_ERROR] 자격 증명 거부 (account={creds['label']}): {t!r}")
                _progress["auth_error"] = True
                _progress["auth_error_reason"] = t
            elif "로그인" in t and "이용" in t:
                # 비로그인 상태 안내 — 단순 accept 후 진행
                pass
    # 로그인 완료 대기: client_id input 이 사라지거나 페이지가 다른 곳으로 이동할 때까지
    def _logged_in(dr):
        # 대기 중에도 알럿이 새로 뜰 수 있어 매 폴 마다 안전 처리
        try:
            return "login_box" not in dr.current_url or not dr.find_elements(By.ID, "client_id")
        except UnexpectedAlertPresentException:
            _drain_alerts(dr, tag="wait-poll")
            return False
    try:
        WebDriverWait(d, 10).until(_logged_in)
    except Exception:
        time.sleep(2)
    # 옥션원 세션 cookie / user_ssid 안정화 대기
    time.sleep(1.2)
    _drain_alerts(d, tag="post-wait")
    _last_login_at = time.time()
    try:
        cur = d.current_url
    except UnexpectedAlertPresentException:
        _drain_alerts(d, tag="post-cur")
        cur = "(alert handled)"
    print(f"[login] done, current_url={cur}")
    # ★ submit 후 URL 검사 — PW 오류 시 옥션원이 보이는 패턴 (Claude-in-Chrome 직접 테스트로 확인):
    #   - login_box.php 그대로  → 로그인 실패 (단순 redirect 안 됨)
    #   - /member/cert.php       → 옥션원 인증페이지 redirect (PW 오류 시 옥션원 정책)
    cur_l = (cur or "").lower()
    url_unauth_hint = ""
    if "/member/cert.php" in cur_l:
        url_unauth_hint = "auction1 cert.php redirect (PW 오류 강한 신호)"
    elif "login_box" in cur_l or "login.php" in cur_l:
        url_unauth_hint = "login 페이지 그대로 (로그인 실패)"
    url_still_login = bool(url_unauth_hint)
    if verify_login or url_still_login:
        ok = _verify_logged_in(d)
        if not ok or url_still_login:
            print(f"[login][verify] 실패 — _last_login_at 리셋 (hint={url_unauth_hint!r}, verify_ok={ok})")
            _last_login_at = 0.0
            # PW 오류 의심 마킹 — 프론트가 자동으로 활성 계정 검증 결과 ✗ 갱신
            _progress["auth_error"] = True
            if "cert.php" in cur_l:
                _progress["auth_error_reason"] = (
                    f"🚨 PW 오류 의심 — 옥션원이 인증페이지(/member/cert.php)로 redirect (account={creds['label']})"
                )
            else:
                _progress["auth_error_reason"] = (
                    f"로그인 실패 (PW 오류 또는 옥션원 응답 이상) — account={creds['label']}"
                )
        else:
            print("[login][verify] OK")


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
    # 주소 필터: _addrTags 만 기준 (위쪽 sido/gugun/dong 단일 select 는 무시)
    # _addrTags 항목 형태:
    #   - 신규: {text, sido, gugun, dong}  ← 매니저 [추가] 클릭 시점의 select value 포함
    #   - 구버전 호환: "서울" 같은 문자열  ← sido/gugun/dong value 없음 → text 만 사용 (옥션원 폼 적용 불가)
    addr_tags = (form_data or {}).get("_addrTags") or []
    if addr_tags:
        for idx, tag in enumerate(addr_tags):
            if not isinstance(tag, dict):
                print(f"[addr] tag#{idx} 문자열 형태 (구버전 프리셋) — 옥션원 폼 적용 불가, 스킵: {tag}")
                continue
            sv = str(tag.get("sido")  or "").strip()
            gv = str(tag.get("gugun") or "").strip()
            dv = str(tag.get("dong")  or "").strip()
            if not sv:
                print(f"[addr] tag#{idx} sido 비어있음, 스킵: {tag}")
                continue
            try:
                # sido 선택 → gugun option 로드 대기 → gugun 선택 → dong 로드 → dong 선택 → addr_multi_plus
                el_sido = d.find_element(By.NAME, "sido")
                Select(el_sido).select_by_value(sv)
                d.execute_script("arguments[0].dispatchEvent(new Event('change'));", el_sido)
                time.sleep(0.25)
                if gv:
                    el_gugun = d.find_element(By.NAME, "gugun")
                    Select(el_gugun).select_by_value(gv)
                    d.execute_script("arguments[0].dispatchEvent(new Event('change'));", el_gugun)
                    time.sleep(0.25)
                if dv:
                    el_dong = d.find_element(By.NAME, "dong")
                    Select(el_dong).select_by_value(dv)
                    d.execute_script("arguments[0].dispatchEvent(new Event('change'));", el_dong)
                    time.sleep(0.1)
                d.execute_script("if (typeof addr_multi_plus === 'function') addr_multi_plus();")
                time.sleep(0.2)
            except Exception as e:
                print(f"[addr] tag#{idx} 적용 실패: {e}")
        # 다중 처리 끝 — 단일 sido/gugun/dong select 는 비움 (다중만 옥션원에 적용되도록)
        for nm in ("sido", "gugun", "dong"):
            try:
                el = d.find_element(By.NAME, nm)
                Select(el).select_by_value("")
                d.execute_script("arguments[0].dispatchEvent(new Event('change'));", el)
            except Exception:
                pass

    # 물건종류 복수선택: _multiProp = ['8','19',...] → s_class2 hidden 에 콤마 join + 각 clg_<v> 체크박스 체크
    multi_props = (form_data or {}).get("_multiProp") or []
    multi_props = [str(v).strip() for v in multi_props if str(v).strip()]
    if multi_props:
        s_class2_val = ",".join(multi_props)
        try:
            d.execute_script(
                f"""
                var el = document.getElementById('s_class2');
                if (el) {{ el.value = '{s_class2_val}'; try {{ el.dispatchEvent(new Event('change')); }} catch(e){{}} }}
                // 단일 select 는 비움 (복수선택이 우선)
                var single = document.getElementById('s_class');
                if (single) {{ single.value = ''; try {{ single.dispatchEvent(new Event('change')); }} catch(e){{}} }}
                // 'clg_all' (전체 선택) 체크 풀어서 옥션원이 '복수선택 모드' 로 인식
                var allCb = document.getElementById('clg_all');
                if (allCb && allCb.checked) {{ allCb.checked = false; try {{ allCb.dispatchEvent(new Event('change')); }} catch(e){{}} }}
                """
            )
        except Exception as e:
            print(f"[multi_prop] hidden set fail: {e}")
        # 각 clg_<v> 체크박스도 체크 (옥션원 검증/제출 시 사용 가능)
        for v in multi_props:
            try:
                cb = d.find_element(By.ID, f"clg_{v}")
                d.execute_script(
                    "arguments[0].checked = true; try { arguments[0].dispatchEvent(new Event('change')); } catch(e){}",
                    cb,
                )
            except Exception:
                pass
        print(f"[multi_prop] s_class2={s_class2_val}, checkboxes={len(multi_props)}")
        time.sleep(0.2)


def submit_search(d):
    # ca_title.php 의 종합검색 — 검색 input 을 직접 클릭 (옥션원 onclick 검증 로직을 거치게)
    try:
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
    except UnexpectedAlertPresentException:
        _drain_alerts(d, tag="submit")
        clicked = "alert-handled"
    print(f"[crawl] submit -> {clicked}")
    def _ready(dr):
        try:
            return "ca_list" in dr.current_url or dr.find_elements(By.CSS_SELECTOR, "table.tbl_list tbody tr")
        except UnexpectedAlertPresentException:
            _drain_alerts(dr, tag="submit-wait")
            return False
    try:
        WebDriverWait(d, 30).until(_ready)
    except Exception:
        # alert 이후 페이지 미이동일 수 있음 — 잔여 알럿 정리만 하고 진행
        _drain_alerts(d, tag="submit-timeout")
    time.sleep(1.5)
    _drain_alerts(d, tag="post-submit")


def _extract_specials(td3):
    """소재지 셀(td3) 에서 [임차권등기 / 대항력 / HUG인수조건변경 / 공시가격...] 같은
    특수물건 표시 (옥션원이 빨강 #961c00 색으로 표시) 만 추출."""
    parts = []
    try:
        # 빨강(#961c00) 색 div = 특수물건 표시
        for el in td3.find_elements(By.CSS_SELECTOR, 'div[style*="#961c00"], div[style*="961c00"]'):
            t = (el.text or "").strip()
            if t: parts.append(t)
    except Exception:
        pass
    if parts:
        return " ".join(parts)
    # fallback: 텍스트에서 [...] 안에 특수 키워드 들어간 줄
    try:
        text = td3.text or ""
        for line in text.split("\n"):
            line = line.strip()
            if not line.startswith("["): continue
            if any(kw in line for kw in ["대항력", "임차권등기", "HUG", "선순위", "유치권", "재매각", "분묘", "법정지상권", "지분", "공시가격"]):
                parts.append(line)
    except Exception:
        pass
    return " ".join(parts)


def parse_results(d, max_rows: int = 200):
    """결과 페이지 tbl_list tbody tr 파싱 → 리스트 of dict
    각 셀의 innerHTML 도 함께 보내서 프론트엔드에서 옥션원 디자인 그대로 렌더한다.
    selector 는 결과 표(list_header tr 가 있는 tbody) 의 데이터 행만 한정.
    """
    # 결과 표 = id="list_header" 인 tr 의 형제 tr 들 (검색폼 등 다른 tbl_list 제외)
    rows = d.find_elements(By.XPATH, "//tr[@id='list_header']/following-sibling::tr")
    if not rows:
        # fallback: 옛 selector (호환)
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
    for _dbg_idx, (r, tds) in enumerate(valid_rows):
        try:
            if len(tds) < 8:
                continue
            # ★ DEBUG: 첫 2개 행만 td innerHTML 길이 출력
            if _dbg_idx < 2:
                try:
                    _addr_html = tds[3].get_attribute("innerHTML") or ""
                    _price_html = tds[4].get_attribute("innerHTML") or ""
                    print(f"[parse-debug] row#{_dbg_idx} tds={len(tds)} addr_html_len={len(_addr_html)} price_html_len={len(_price_html)} addr_text={tds[3].text[:60]!r}")
                except Exception as _de:
                    print(f"[parse-debug] row#{_dbg_idx} err={_de}")
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
            # 사진 url — 옥션원 CloudFront signed URL 은 24h 만료 → 크롤 직후 즉시 다운로드 + base64 변환
            img_el = tds[1].find_elements(By.TAG_NAME, "img")
            img_url_raw = img_el[0].get_attribute("src") if img_el else ""
            img_url = _img_to_b64_data_uri(img_url_raw) if img_url_raw else ""

            def html_of(td):
                try:
                    return td.get_attribute("innerHTML") or ""
                except Exception:
                    return ""

            address_text = tds[3].text.strip()
            items.append({
                # 텍스트 (필터/검색용)
                "sakun_no": sakun_no,
                "prop_kind": prop_kind,
                "address": address_text,
                "court": _court_from_address(address_text),  # 주소 → 법원명 자동 매핑
                "specials": _extract_specials(tds[3]),
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


def _next_page_link(d, visited: set):
    """결과 페이지의 페이지네이션(div.pagn) 에서 아직 안 본 가장 작은 start 의 링크 반환"""
    try:
        links = d.find_elements(By.CSS_SELECTOR, "div.pagn a")
    except Exception:
        return None
    candidates = []
    for a in links:
        try:
            href = (a.get_attribute("href") or "").strip()
        except Exception:
            continue
        m = re.search(r"[?&]start=(\d+)", href)
        if not m:
            continue
        s = int(m.group(1))
        if s in visited:
            continue
        candidates.append((s, href))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0]


def verify_account(account: dict) -> dict:
    """ID/PW 단발 검증 — 옥션원에 실제 로그인 시도해서 성공/실패 반환.
    메인 driver + _lock 사용 (일괄 크롤 중이면 대기). 검증 후 _last_login_at 리셋해서 다음 크롤이 활성 계정으로 새로 로그인하도록 한다.
    return: {success: bool, reason: str}
    """
    global _last_login_at
    if not isinstance(account, dict):
        return {"success": False, "reason": "account payload 형식 오류"}
    aid = str(account.get("id") or "").strip()
    apw = str(account.get("pw") or "")
    if not aid or not apw:
        return {"success": False, "reason": "ID/PW 누락"}
    with _lock:
        d = get_driver()
        _drain_alerts(d, tag="verify-pre")
        try:
            d.get(URL_LOGIN)
        except UnexpectedAlertPresentException:
            _drain_alerts(d, tag="verify-nav")
            try: d.get(URL_LOGIN)
            except Exception: pass
        _drain_alerts(d, tag="verify-after-nav")
        # 로그인 폼 대기
        try:
            WebDriverWait(d, 15).until(EC.presence_of_element_located((By.ID, "client_id")))
        except UnexpectedAlertPresentException:
            _drain_alerts(d, tag="verify-form-wait")
        except Exception:
            # 옥션원이 메인으로 redirect 한 경우 = 이미 로그인됨. 검증 elem 으로 판정.
            ok = _verify_logged_in(d)
            _last_login_at = 0.0
            return {"success": ok, "reason": "이미 로그인 상태로 판정" if ok else "로그인 폼 못 찾음 (페이지 응답 이상)"}
        # ID/PW 입력
        _id_js = _esc_js(aid)
        _pw_js = _esc_js(apw)
        d.execute_script(
            f"""
            document.getElementById('client_id').value = '{_id_js}';
            var dummy = document.getElementById('pw_Dummy');
            var real = document.getElementById('passwd');
            if (dummy) dummy.style.display = 'none';
            if (real) {{ real.style.display = 'block'; real.value = '{_pw_js}'; }}
            """
        )
        # 제출
        try:
            d.find_element(
                By.XPATH,
                "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]",
            ).click()
        except UnexpectedAlertPresentException:
            _drain_alerts(d, tag="verify-submit-click")
        except Exception:
            try:
                d.find_element(By.ID, "passwd").send_keys(Keys.RETURN)
            except UnexpectedAlertPresentException:
                _drain_alerts(d, tag="verify-submit-enter")
        # 옥션원 alert 검사 (잘못된 비번/동시접속/만료 등)
        seen = _drain_alerts(d, tag="verify-post-submit")
        for t in seen:
            if "비밀번호" in t or "아이디" in t or ("확인" in t and "다시" in t) or "잘못" in t or "일치하지" in t:
                _last_login_at = 0.0
                return {"success": False, "reason": f"인증 거부 — {t}"}
            # 동시접속 alert 은 PW 가 정확함을 의미 (다른 곳에서 로그인 중) → accept 후 우리가 차지 → 성공
            if "동시 접속" in t or "동시접속" in t:
                print(f"[verify] 동시접속 alert (=PW 정확) — 우리 세션 우선권 확보")
        # 로그인 후 페이지 안정화 대기
        try:
            WebDriverWait(d, 8).until(
                lambda dr: "login_box" not in dr.current_url or not dr.find_elements(By.ID, "client_id")
            )
        except Exception:
            pass
        time.sleep(0.8)
        _drain_alerts(d, tag="verify-post-wait")
        ok = _verify_logged_in(d)
        _last_login_at = 0.0  # 다음 크롤은 활성 계정으로 다시 로그인하도록 TTL 리셋
        try: cur = d.current_url
        except Exception: cur = ""
        if ok:
            return {"success": True, "reason": f"로그인 성공 ({cur or 'URL 미상'})"}
        else:
            return {"success": False, "reason": "로그인 폼이 그대로 — PW 오류 가능 (또는 옥션원 응답 이상)"}


def crawl(form_data: dict, custom_filters: list | None = None, settings: dict | None = None, account: dict | None = None):
    s = _coerce_settings(settings)
    creds = _resolve_account(account)
    print(f"[crawl] settings={s} account={creds['label']}")
    # 새 크롤링 시작 — 이전 cancel 신호 초기화
    _cancel_event.clear()
    _progress.update({
        "running": True, "current": 0, "total": 0,
        "pages_done": 0, "started_at": time.time(),
        "cancelled": False, "stage": "login",
        "hijack_count": 0, "hijack_detected": False, "hijack_reason": "",
        "auth_error": False, "auth_error_reason": "",
    })
    with _lock:
        print(f"\n[crawl] formData={form_data}")
        def _do_search():
            d2 = get_driver()
            try:
                d2.get(URL_SEARCH)
            except UnexpectedAlertPresentException:
                _drain_alerts(d2, tag="search-nav")
                d2.get(URL_SEARCH)
            _drain_alerts(d2, tag="search-after-nav")
            # ★ 검색 폼 진입 후 user_ssid 사전 검증 — driver 가 떠있어도 옥션원 세션 끊겼을 수 있음
            # 비로그인이면 force 재로그인 후 다시 ca_title.php 진입. (검색 부터 지르지 않음)
            try:
                has_ssid = bool(d2.execute_script("return (typeof user_ssid !== 'undefined') && !!user_ssid;"))
            except Exception:
                has_ssid = False
            if not has_ssid:
                print(f"[crawl] 🔒 검색 폼 user_ssid 없음 — 비로그인 상태. force 재로그인 후 재검색 (account={creds['label']})")
                _progress["stage"] = "login"
                login_if_needed(force=True, verify_login=bool(s["verifyLogin"]), account=account)
                _progress["stage"] = "search"
                try:
                    d2.get(URL_SEARCH)
                except UnexpectedAlertPresentException:
                    _drain_alerts(d2, tag="search-nav-relogin")
                    try: d2.get(URL_SEARCH)
                    except Exception: pass
                _drain_alerts(d2, tag="search-after-relogin")
            try:
                WebDriverWait(d2, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "table.tbl_fmSrch"))
                )
            except UnexpectedAlertPresentException:
                _drain_alerts(d2, tag="search-wait-form")
            time.sleep(0.5)
            fill_form(d2, form_data)
            try:
                print(f"[crawl] form filled, current url={d2.current_url}")
            except UnexpectedAlertPresentException:
                _drain_alerts(d2, tag="search-pre-submit")
            submit_search(d2)
            try:
                print(f"[crawl] after submit, current url={d2.current_url}")
            except UnexpectedAlertPresentException:
                _drain_alerts(d2, tag="search-post-submit")
            return d2, parse_results(d2)
        # 1차 로그인: 세션 재사용 ON 이면 TTL 활용 (force=False), OFF 면 매번 강제 로그인 (옛 동작)
        _progress["stage"] = "login"
        use_force = not bool(s["useSessionReuse"])
        login_if_needed(force=use_force, verify_login=bool(s["verifyLogin"]), account=account)
        _progress["stage"] = "search"
        d, items = _do_search()
        # 0건 + 비로그인 모달 감지 시 백오프 재시도 (설정에 따라 N회)
        retry_count = int(s["retryCount"]) if bool(s["retryEnabled"]) else 0
        backoffs = list(s["retryBackoffSec"])
        # ★ retry 와 무관하게 1차 0건 + 비로그인 multi-signal 감지는 항상 마킹
        if not items:
            try:
                unauth, reason = _is_unauth_after_search(d)
                if unauth:
                    _progress["hijack_detected"] = True
                    _progress["hijack_reason"] = reason
                    if reason == "cert_redirect":
                        # cert.php redirect = PW 오류 강한 신호 — auth_error 도 마킹
                        _progress["auth_error"] = True
                        _progress["auth_error_reason"] = (
                            f"🚨 PW 오류 의심 — 옥션원이 검색 후 인증페이지(/member/cert.php)로 redirect (account={creds['label']})"
                        )
                    suffix = "" if retry_count > 0 else " — retry OFF 라 자동 복구 없음"
                    print(f"[crawl] ⚠ 비로그인/PW오류 감지 ({reason}, account={creds['label']}){suffix}")
            except UnexpectedAlertPresentException:
                _drain_alerts(d, tag="hijack-precheck")
        for attempt in range(retry_count):
            try:
                if items:
                    still_login = False
                else:
                    unauth, _r = _is_unauth_after_search(d)
                    still_login = unauth
            except UnexpectedAlertPresentException:
                _drain_alerts(d, tag=f"retry{attempt}-check")
                still_login = True
            if not still_login:
                break
            wait = backoffs[attempt] if attempt < len(backoffs) else backoffs[-1]
            # ★ 세션 가로채기 / 누락 감지 — 프론트 폴링이 알아채도록 _progress 갱신
            _progress["hijack_count"] = attempt + 1
            _progress["hijack_detected"] = True
            _progress["hijack_reason"] = "session_hijacked"
            print(f"[crawl] ⚠ 세션 가로채기/누락 감지 — retry {attempt+1}/{retry_count}, {wait}s 대기 후 재로그인 (account={creds['label']})")
            _progress["stage"] = "login"
            time.sleep(wait)
            login_if_needed(force=True, verify_login=bool(s["verifyLogin"]), account=account)  # 재시도 시는 항상 강제
            _progress["stage"] = "search"
            d, items = _do_search()
        # 첫 페이지 결과 progress 반영 + 옥션원 전체 건수 추출
        _progress["pages_done"] = 1
        _progress["current"] = len(items)
        _progress["total"] = _get_total_record(d) or len(items)
        _progress["stage"] = "paging"
        print(f"[crawl] page 1: {len(items)} items, total_record={_progress['total']}")
        # 페이지네이션 순회 (start=100, start=200, ...)
        visited = {0}
        max_pages = 20  # 안전 한도
        cancelled = False
        while len(visited) < max_pages:
            if _cancel_event.is_set():
                print("[crawl] cancelled by user")
                cancelled = True
                break
            nxt = _next_page_link(d, visited)
            if not nxt:
                break
            start, href = nxt
            print(f"[crawl] page start={start} → {href[:120]}...")
            visited.add(start)
            try:
                try:
                    d.get(href)
                except UnexpectedAlertPresentException:
                    _drain_alerts(d, tag=f"page{start}-nav")
                    d.get(href)
                _drain_alerts(d, tag=f"page{start}-after-nav")
                try:
                    WebDriverWait(d, 15).until(
                        EC.presence_of_element_located((By.XPATH, "//tr[@id='list_header']"))
                    )
                except UnexpectedAlertPresentException:
                    _drain_alerts(d, tag=f"page{start}-wait")
                time.sleep(0.5)
                page_items = parse_results(d)
                print(f"[crawl] page {len(visited)}: {len(page_items)} items")
                items.extend(page_items)
                _progress["pages_done"] = len(visited)
                _progress["current"] = len(items)
            except Exception as e:
                print(f"[crawl] page fetch fail (start={start}): {e}")
                _drain_alerts(d, tag=f"page{start}-error")
                break
        print(f"[crawl] total {len(items)} items across {len(visited)} pages{' (cancelled)' if cancelled else ''}")
        crawl.last_cancelled = cancelled
        _progress.update({
            "running": False,
            "current": len(items),
            "pages_done": len(visited),
            "cancelled": cancelled,
            "stage": "cancelled" if cancelled else "done",
        })
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
        # MJ 확장 라우터 (imageup / files / kakao)
        try:
            import mj_extensions as _mjx
            if _mjx.handle_get(self):
                return
        except Exception as _e:
            traceback.print_exc()
        # ping: 백엔드 살아있는지 빠른 감지용
        if self.path.startswith("/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"service":"auction1-crawler"}')
            return
        # 크롤링 진행상황 폴링
        if self.path.startswith("/api/progress"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(_progress, ensure_ascii=False).encode("utf-8"))
            return
        # 디버그 — 옥션원 cookies 강제 삭제 (자체 검증 시 옛 세션 끊김 시뮬용)
        # _last_login_at 은 유지 → 케이스 2-B (TTL 살아있는데 옥션원 세션만 끊김) 정확히 시뮬
        if self.path.startswith("/api/_debug_clear_cookies"):
            try:
                d = get_driver()
                d.delete_all_cookies()
                msg = '{"ok":true,"cookies_cleared":true,"last_login_at_kept":true}'
            except Exception as e:
                msg = '{"ok":false,"error":' + json.dumps(str(e)) + '}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
            return
        # 크롤링 중지 신호: 진행 중인 페이지 순회 다음 iteration 에서 break
        if self.path.startswith("/api/cancel"):
            _cancel_event.set()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"cancelled":true}')
            return
        return super().do_GET()

    def do_POST(self):
        # MJ 확장 라우터 (imageup / kakao)
        try:
            import mj_extensions as _mjx
            if _mjx.handle_post(self):
                return
        except Exception as _e:
            traceback.print_exc()
        # MAPS GAS 중계 엔드포인트 (매니저 JS → 이 서버 → GAS)
        if self.path in ("/api/maps-sync-presets", "/api/maps-upload-items", "/api/maps-gas"):
            self._handle_maps_proxy()
            return
        # 계정 검증 — 설정 모달의 [검증하기] 버튼
        if self.path == "/api/verify-account":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length).decode("utf-8") if length else "{}"
                payload = json.loads(raw or "{}")
                result = verify_account(payload)
                body = json.dumps(result, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                traceback.print_exc()
                err = {"success": False, "reason": f"서버 오류: {e}"}
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(err, ensure_ascii=False).encode("utf-8"))
            return
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
            settings = payload.get("settings") or {}
            account = payload.get("account") or None
            items = crawl(form_data, custom_filters, settings, account)
            cancelled = bool(getattr(crawl, "last_cancelled", False))
            body = json.dumps({
                "success": True,
                "count": len(items),
                "items": items,
                "cancelled": cancelled,
                "hijack_count": int(_progress.get("hijack_count") or 0),
                "hijack_detected": bool(_progress.get("hijack_detected")),
                "auth_error": bool(_progress.get("auth_error")),
                "auth_error_reason": str(_progress.get("auth_error_reason") or ""),
            }, ensure_ascii=False)
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

    def _handle_maps_proxy(self):
        """매니저 → 이 서버 → GAS 로 페이로드를 forward.
        매니저는 api_key, presets/items 등만 보내면 됨. api_action 은 path 기준으로 부여."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            action_map = {
                "/api/maps-sync-presets":  "syncJosaPresets",
                "/api/maps-upload-items":  "uploadJosaItems",
            }
            # /api/maps-gas 는 payload.api_action 그대로 사용 (진단용 일반 라우터)
            if self.path in action_map:
                payload["api_action"] = action_map[self.path]
            # 업로드는 GAS 처리 시간(시트 쓰기 N건) 60s 넘는 사례 있음 — 5분까지 허용.
            # sync/일반 라우터는 메타만이라 60s 충분.
            timeout = 300.0 if self.path == "/api/maps-upload-items" else 60.0
            result = _gas_post(payload, timeout=timeout)
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
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
    # ThreadingHTTPServer: /api/crawl 진행 중에도 /api/cancel 등 다른 요청 동시 처리
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
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
