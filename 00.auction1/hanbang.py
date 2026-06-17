# -*- coding: utf-8 -*-
"""
hanbang.py — 한방(karhanbang.com) 중개사무소 리스트 크롤러
- 대상: https://www.karhanbang.com/office/?topM=09  (페이지당 10개, 기본 2498페이지)
- 리스트에서: 지역 / 상호 / 대표자 / 신주소 / 사무실번호(02)
- 상세 진입해서: 부가주소 / 핸드폰번호(010)   ← 핸드폰은 리스트에 없음
- 사무실번호와 핸드폰번호는 분리 컬럼으로 저장
- 결과: xlsx 내보내기 (openpyxl)

주의: 사이트에 dotDefender WAF 가 있어 봇처럼 빠르게 연속요청하면 차단됨.
      → requests 세션(쿠키) + 브라우저 헤더 + Referer + 요청 간 지연 으로 사람처럼 천천히.
"""
from __future__ import annotations
import os, re, time, uuid, threading, json, html as _html

import requests

_DIR_HERE = os.path.dirname(os.path.abspath(__file__))
_EXPORT_DIR = os.path.join(_DIR_HERE, "hanbang_exports")

BASE = "https://www.karhanbang.com"
LIST_BASE = BASE + "/office/"
DETAIL_BASE = BASE + "/office/office_detail.asp"

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

# 컬럼 순서 (사용자 사양) — 상호 / 핸드폰 / 신주소 3개만
# - 상호 = 앞 괄호 제거 (예: (가락)학사공인중개사사무소 → 학사공인중개사사무소)
# - 핸드폰 = 상세의 010 (없으면 공란)
# - 신주소 = 상세의 소재지(풀 도로명주소). 리스트엔 동 레벨만 있어 상세에서 보강
COLUMNS = ["상호", "핸드폰", "신주소"]

# 시도(지역) 코드 — sel_sido 파라미터 (사이트 드롭다운 순서)
SIDO = [
    (1, "서울특별시"), (2, "경기도"), (3, "인천광역시"), (4, "부산광역시"),
    (5, "대구광역시"), (6, "광주광역시"), (7, "대전광역시"), (8, "울산광역시"),
    (9, "강원특별자치도"), (10, "경상남도"), (11, "경상북도"), (12, "전라남도"),
    (13, "전북특별자치도"), (14, "충청남도"), (15, "충청북도"), (16, "세종특별자치시"),
    (17, "제주특별자치도"),
]

SAVE_EVERY_PAGES = 25   # 지역별 모드: N쪽마다 중간저장 + 체크포인트 (≈250건)
_CKPT_PATH = os.path.join(_EXPORT_DIR, "hanbang_checkpoint.json")

# ── 작업 레지스트리 (run_id -> state) ───────────────────────────
_runs = {}            # run_id -> dict
_runs_lock = threading.Lock()


# ============================================================
# 파싱 유틸
# ============================================================
def _text(s: str) -> str:
    """태그 제거 + 엔티티 복원 + 공백 정리."""
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = _html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_list(html_text: str):
    """리스트 페이지 → [{region, name, rep, office_tel, new_addr, mem_no, param}]"""
    out = []
    m = re.search(r"<tbody>(.*?)</tbody>", html_text, re.S)
    scope = m.group(1) if m else html_text
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", scope, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 5:
            continue
        mv = re.search(r"moveDetail\('(\d+)'\s*,\s*'([^']*)'\)", tds[1])
        if not mv:
            continue
        mem_no, param = mv.group(1), mv.group(2)
        # 상호 = 앵커 텍스트에서 span(viewnum/date) 제거 후
        sub = re.sub(r"<span.*?</span>", "", tds[1], flags=re.S)
        name = _text(sub)
        # 사무실 전화 (02 등) = td3 의 tel: 링크
        mt = re.search(r"tel:([0-9\-]+)", tds[3])
        office_tel = mt.group(1) if mt else _text(tds[3])
        out.append({
            "region": _text(tds[0]),
            "name": name,
            "rep": _text(tds[2]),
            "office_tel": office_tel,
            "new_addr": _text(tds[4]),
            "mem_no": mem_no,
            "param": param,
        })
    return out


def _detail_li(html_text: str, label: str) -> str:
    """상세 <li><span>라벨</span><em>값</em></li> 에서 값 추출."""
    m = re.search(r"<li[^>]*>\s*<span[^>]*>\s*" + re.escape(label) + r"\s*</span>\s*<em[^>]*>(.*?)</em>",
                  html_text, re.S)
    return _text(m.group(1)) if m else ""


def parse_detail(html_text: str) -> dict:
    """상세 페이지 → {sojae(신주소·도로명), buga(부가주소), jibun(지번주소), mobile, office}"""
    sojae = _detail_li(html_text, "소재지")   # 도로명주소 = 신주소(풀)
    buga = _detail_li(html_text, "부가주소")
    jibun = _detail_li(html_text, "지번주소")
    office = ""
    mobile = ""
    mr = re.search(r"전화걸기\s*</span>\s*<em[^>]*>(.*?)</em>", html_text, re.S)
    if mr:
        tels = re.findall(r"tel:([0-9\-]+)", mr.group(1))
        for t in tels:
            digits = re.sub(r"[^0-9]", "", t)
            if not digits or digits == "000":
                continue
            if digits.startswith("01"):
                mobile = t            # 핸드폰 (010 등)
            elif not office:
                office = t            # 사무실 (02/지역번호)
    return {"sojae": sojae, "buga": buga, "jibun": jibun, "mobile": mobile, "office": office}


def strip_name_paren(name: str) -> str:
    """상호 앞 괄호 제거. '(가락)학사공인중개사사무소' → '학사공인중개사사무소'."""
    return re.sub(r"^\s*\([^)]*\)\s*", "", name or "").strip()


def detect_block(html_text: str) -> bool:
    return "dotDefender" in html_text or "Blocked Your Request" in html_text


# ============================================================
# 크롤 작업 (스레드)
# ============================================================
def _log(state, msg):
    with state["lock"]:
        state["lines"].append(msg)


def _list_page_url(page: int, sido=None) -> str:
    # sido 지정 시 지역 필터, 미지정 시 사이트 기본 리스트(=서울)
    if sido:
        return f"{LIST_BASE}?topM=09&sel_sido={sido}&page={page}"
    return f"{LIST_BASE}?topM=09&page={page}"


def _detail_url(mem_no: str, param: str) -> str:
    return f"{DETAIL_BASE}?topM=09&mem_no={mem_no}&{param}"


def _detect_total_pages(html_text: str) -> int:
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", html_text)]
    return max(pages) if pages else 0


def _fetch(session, url, referer, delay, state, tries=3):
    """지연 후 GET. dotDefender 차단 감지 시 백오프 재시도. (text, blocked)"""
    last = ""
    for attempt in range(tries):
        if state.get("cancel"):
            return "", False
        time.sleep(delay if attempt == 0 else delay * (attempt + 2))
        try:
            h = dict(_HEADERS)
            if referer:
                h["Referer"] = referer
            r = session.get(url, headers=h, timeout=20)
            r.encoding = "utf-8"
            txt = r.text
            if detect_block(txt):
                last = txt
                _log(state, f"  ⚠ WAF 차단 감지 — {(attempt+1)}/{tries} 백오프 재시도")
                continue
            return txt, False
        except Exception as e:
            last = ""
            _log(state, f"  ⚠ 요청 오류({attempt+1}/{tries}): {e}")
    return last, detect_block(last)


def _session():
    s = requests.Session()
    s.headers.update(_HEADERS)
    return s


def _warm(state, session, delay, sido=None) -> bool:
    _log(state, "세션 준비 중… (워밍)")
    warm, blocked = _fetch(session, _list_page_url(1, sido), BASE + "/", delay, state)
    if blocked or not warm:
        _log(state, "❌ 시작 실패: 첫 요청이 WAF 차단됨. 잠시 후 다시 시도하세요.")
        return False
    return True


def _crawl_one_page(state, session, page, end_label, sido, delay, rows):
    """리스트 1페이지 + 각 사무소 상세 → rows 누적."""
    state["cur_page"] = page
    list_html, blocked = _fetch(session, _list_page_url(page, sido),
                                _list_page_url(max(1, page - 1), sido), delay, state)
    if blocked or not list_html:
        _log(state, f"❌ {page}쪽 리스트 실패(차단/오류) — 건너뜀")
        return
    offices = parse_list(list_html)
    _log(state, f"[{page}/{end_label}쪽] 사무소 {len(offices)}건")
    for i, off in enumerate(offices, 1):
        if state.get("cancel"):
            return
        d_html, blocked = _fetch(session, _detail_url(off["mem_no"], off["param"]),
                                 _list_page_url(page, sido), delay, state)
        det = parse_detail(d_html) if (not blocked and d_html) else {}
        name2 = strip_name_paren(off["name"])
        mobile = det.get("mobile", "")
        sin_addr = det.get("sojae") or off["new_addr"]   # 상세 소재지(풀) 우선, 없으면 리스트 폴백
        rows.append({"상호": name2, "핸드폰": mobile, "신주소": sin_addr})
        state["count"] = state.get("count", 0) + 1
        _log(state, f"    {page}-{i} {name2} | {mobile or '없음'} | {sin_addr or '-'}")


def _run(state, start_page, end_page, delay):
    """단일/테스트 모드 — 페이지 범위 크롤 후 엑셀 1개."""
    rows = []
    try:
        os.makedirs(_EXPORT_DIR, exist_ok=True)
        session = _session()
        if not _warm(state, session, delay, None):
            state["status"] = "error"
            return
        _log(state, f"크롤 범위: {start_page}~{end_page}쪽  (지연 {delay}s)")
        for page in range(start_page, end_page + 1):
            if state.get("cancel"):
                _log(state, "⏹ 사용자 중지")
                break
            _crawl_one_page(state, session, page, end_page, None, delay, rows)
        if rows:
            path = os.path.join(_EXPORT_DIR, f"한방_{start_page}-{end_page}p_{time.strftime('%Y%m%d_%H%M%S')}.xlsx")
            _save_rows(rows, path)
            state["file"] = path
            _log(state, f"✅ 완료 — {len(rows)}건 저장: {os.path.basename(path)}")
        else:
            _log(state, "결과 0건 — 저장할 데이터 없음")
        state["status"] = "done"
    except Exception as e:
        import traceback
        _log(state, "❌ 예외: " + str(e))
        _log(state, traceback.format_exc())
        state["status"] = "error"
    finally:
        if state["status"] not in ("done", "error"):
            state["status"] = "done"


def _run_regions(state, delay):
    """지역별 자동 모드 — 17개 시도 순회. 시도마다 엑셀 1개.
    SAVE_EVERY_PAGES 쪽마다 중간저장 + 체크포인트. 완료 지역은 재실행 시 건너뜀(끊겨도 이어서 재개)."""
    try:
        os.makedirs(_EXPORT_DIR, exist_ok=True)
        session = _session()
        if not _warm(state, session, delay, None):
            state["status"] = "error"
            return
        state["region_total"] = len(SIDO)
        _log(state, f"🌐 전국 지역별 자동 크롤 — {len(SIDO)}개 시도 (지연 {delay}s · {SAVE_EVERY_PAGES}쪽마다 중간저장)")
        ck = _load_ckpt()
        for idx, (sido, name) in enumerate(SIDO, 1):
            if state.get("cancel"):
                _log(state, "⏹ 사용자 중지")
                break
            key = str(idx)
            info = ck.get(key, {})
            state["cur_region"] = name
            fpath = _region_file(idx, name)
            if info.get("done"):
                state["region_done"] = idx
                _log(state, f"⏭ [{idx}/{len(SIDO)}] {name} — 이미 완료, 건너뜀")
                continue
            first, blocked = _fetch(session, _list_page_url(1, sido), BASE + "/", delay, state)
            if blocked or not first:
                _log(state, f"❌ [{idx}/{len(SIDO)}] {name} 시작 실패(차단) — 다음 실행 때 재시도")
                continue
            total = int(info.get("total") or _detect_total_pages(first))
            rows = _load_xlsx_rows(fpath) if os.path.exists(fpath) else []
            done_page = int(info.get("last_page") or 0)
            if done_page > 0:
                _log(state, f"↻ [{idx}/{len(SIDO)}] {name} — {done_page}/{total}쪽까지 완료, 이어서 (기존 {len(rows)}건)")
            else:
                _log(state, f"▶ [{idx}/{len(SIDO)}] {name} — 총 {total}쪽 시작")
            for page in range(done_page + 1, total + 1):
                if state.get("cancel"):
                    break
                before = len(rows)
                _crawl_one_page(state, session, page, total, sido, delay, rows)
                if state.get("cancel"):
                    del rows[before:]   # 중단된 페이지의 부분 데이터 제거(재개 시 중복 방지)
                    break
                done_page = page
                if page % SAVE_EVERY_PAGES == 0:
                    _save_rows(rows, fpath)
                    ck[key] = {"done": False, "last_page": done_page, "total": total}
                    _save_ckpt(ck)
                    _log(state, f"  💾 중간저장 {name} {done_page}/{total}쪽 ({len(rows)}건)")
            if rows:
                _save_rows(rows, fpath)
            if state.get("cancel"):
                ck[key] = {"done": False, "last_page": done_page, "total": total}
                _save_ckpt(ck)
                _log(state, f"⏹ {name} 중단 — {done_page}/{total}쪽까지 저장({len(rows)}건). 다음 실행 때 이어서.")
                break
            ck[key] = {"done": True, "last_page": total, "total": total}
            _save_ckpt(ck)
            state["region_done"] = idx
            state["file"] = fpath
            if os.path.basename(fpath) not in state["region_files"]:
                state["region_files"].append(os.path.basename(fpath))
            _log(state, f"✅ [{idx}/{len(SIDO)}] {name} 완료 — {len(rows)}건: {os.path.basename(fpath)}")
        state["status"] = "done"
        _log(state, f"🏁 종료 — 완료 {state.get('region_done', 0)}/{len(SIDO)} 지역")
    except Exception as e:
        import traceback
        _log(state, "❌ 예외: " + str(e))
        _log(state, traceback.format_exc())
        state["status"] = "error"
    finally:
        if state["status"] not in ("done", "error"):
            state["status"] = "done"


# ── 체크포인트 / 엑셀 저장·로드 ─────────────────────────────
def _load_ckpt() -> dict:
    try:
        with open(_CKPT_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_ckpt(c: dict):
    try:
        tmp = _CKPT_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(tmp, _CKPT_PATH)
    except Exception:
        pass


def _region_file(idx: int, name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]', "", name)
    return os.path.join(_EXPORT_DIR, f"한방_지역_{idx:02d}_{safe}.xlsx")


def _save_rows(rows, path) -> str:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "한방"
    head_fill = PatternFill("solid", fgColor="D9E1F2")
    for c, name in enumerate(COLUMNS, 1):
        cell = ws.cell(row=1, column=c, value=name)
        cell.font = Font(bold=True)
        cell.fill = head_fill
        cell.alignment = Alignment(horizontal="center")
    for r, row in enumerate(rows, 2):
        for c, name in enumerate(COLUMNS, 1):
            ws.cell(row=r, column=c, value=row.get(name, ""))
    for c, w in enumerate([34, 16, 42], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width = w
    ws.freeze_panes = "A2"
    tmp = path + ".tmp"
    wb.save(tmp)
    os.replace(tmp, path)   # 원자적 교체 — 저장 중 끊겨도 기존 파일 보존
    return path


def _load_xlsx_rows(path):
    import openpyxl
    try:
        ws = openpyxl.load_workbook(path).active
        headers = [c.value for c in ws[1]]
        out = []
        for r in ws.iter_rows(min_row=2, values_only=True):
            out.append({headers[i]: ("" if i >= len(r) or r[i] is None else r[i]) for i in range(len(headers))})
        return out
    except Exception:
        return []


# ============================================================
# 공개 API (mj_extensions 라우터에서 호출)
# ============================================================
def start(start_page: int = 1, end_page: int = 1, delay: float = 1.0, mode: str = "single"):
    delay = max(0.3, float(delay))
    sp = max(1, int(start_page))
    ep = max(sp, int(end_page))
    run_id = uuid.uuid4().hex[:12]
    state = {
        "lines": [], "status": "running", "lock": threading.Lock(),
        "cancel": False, "count": 0, "cur_page": 0,
        "start_page": sp, "end_page": ep,
        "total_pages_site": 0, "file": None, "mode": mode,
        "cur_region": "", "region_done": 0, "region_total": 0, "region_files": [],
    }
    with _runs_lock:
        _runs[run_id] = state
    if mode == "regions":
        t = threading.Thread(target=_run_regions, args=(state, delay), daemon=True)
    else:
        t = threading.Thread(target=_run, args=(state, sp, ep, delay), daemon=True)
    t.start()
    return run_id


def logs(run_id: str, offset: int = 0):
    state = _runs.get(run_id)
    if not state:
        return None
    with state["lock"]:
        lines = state["lines"][offset:]
    return {
        "lines": lines,
        "status": state["status"],
        "count": state["count"],
        "cur_page": state["cur_page"],
        "start_page": state["start_page"],
        "end_page": state["end_page"],
        "total_pages_site": state["total_pages_site"],
        "has_file": bool(state["file"]),
        "file_name": os.path.basename(state["file"]) if state["file"] else "",
        "mode": state.get("mode", "single"),
        "cur_region": state.get("cur_region", ""),
        "region_done": state.get("region_done", 0),
        "region_total": state.get("region_total", 0),
        "region_files": state.get("region_files", []),
    }


def stop(run_id: str) -> bool:
    state = _runs.get(run_id)
    if not state:
        return False
    state["cancel"] = True
    return True


def file_path(run_id: str):
    state = _runs.get(run_id)
    if state and state.get("file") and os.path.isfile(state["file"]):
        return state["file"]
    return None
