# -*- coding: utf-8 -*-
"""
mj_extensions.py — 옥션원 매니저 확장 모듈

크롤러 메인 (crawler.py) 에 다음 기능을 추가:
- /api/imageup/* : 00.imageup/01.i, 02.d, 03.k subprocess 실행 + 실시간 로그
- /api/files/*   : G:\내 드라이브\MAPS\mapsimage / mapsimagedb 파일 브라우저 + 검색
- /api/kakao/*   : 01.kakao/kakao_server.py 독립 프로세스 ON/OFF

모든 데이터 저장: 00.imageup/imageup_config.json
"""
from __future__ import annotations
import os, sys, json, time, uuid, threading, subprocess, mimetypes, socket, shutil
import urllib.parse

# 메인 매니저 폴더 (= crawler.py 위치)
_DIR_HERE = os.path.dirname(os.path.abspath(__file__))
_DIR_IMAGEUP = os.path.normpath(os.path.join(_DIR_HERE, "..", "00.imageup"))
_DIR_KAKAO   = os.path.normpath(os.path.join(_DIR_HERE, "..", "01. kakao"))

_IMAGEUP_SCRIPTS = {
    "i":  os.path.join(_DIR_IMAGEUP, "01.i.py"),
    "d":  os.path.join(_DIR_IMAGEUP, "02.d.py"),
    "k":  os.path.join(_DIR_IMAGEUP, "03.k.py"),
    "cc": os.path.join(_DIR_IMAGEUP, "03.cc.py"),   # 변경/취소 확인 (옥션원 결과 컬럼 조회, 캡처 없음)
}
_IMAGEUP_CONFIG_PATH = os.path.join(_DIR_IMAGEUP, "imageup_config.json")

# 폴더 브라우저 루트들
_FILE_ROOTS = {
    "mapsimage":   r"G:\내 드라이브\MAPS\mapsimage",
    "mapsimagedb": r"G:\내 드라이브\MAPS\mapsimagedb",
}

# ============================================================
# 1) IMAGEUP subprocess 실행 + 실시간 로그
# ============================================================
_imageup_runs = {}  # run_id -> {proc, lines, status, exit_code, lock}
_imageup_lock = threading.Lock()


def _load_imageup_config() -> dict:
    if not os.path.exists(_IMAGEUP_CONFIG_PATH):
        return {}
    try:
        with open(_IMAGEUP_CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_imageup_config(cfg: dict) -> None:
    os.makedirs(os.path.dirname(_IMAGEUP_CONFIG_PATH), exist_ok=True)
    with open(_IMAGEUP_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_accounts(which: str) -> list:
    """저장된 계정 반환. 없으면 .py 내부 ACCOUNTS 파싱 fallback."""
    if which not in _IMAGEUP_SCRIPTS:
        return []
    cfg = _load_imageup_config()
    saved = (cfg.get(which) or {}).get("accounts")
    if saved:
        return saved
    # fallback: .py에서 ACCOUNTS 변수 파싱 시도
    try:
        return _parse_accounts_from_py(_IMAGEUP_SCRIPTS[which])
    except Exception:
        return []


def save_accounts(which: str, accounts: list) -> None:
    """현재 카드 저장 + 다른 스크립트(들)에 pw/manager 동기화 (id 매칭).
    enabled 는 각 스크립트별 독립 유지. id 가 없는 스크립트에는 추가하지 않음."""
    if which not in _IMAGEUP_SCRIPTS:
        raise ValueError("unknown script: " + which)
    cfg = _load_imageup_config()
    # 1) 본 카드 저장
    cfg.setdefault(which, {})["accounts"] = accounts
    # 2) id → (pw, manager) 마스터 맵
    master = {}
    for a in (accounts or []):
        if a.get("id"):
            master[a["id"]] = {
                "pw": a.get("pw", ""),
                "manager": a.get("manager", ""),
            }
    # 3) 다른 스크립트 카드들에 propagate (pw/manager 만, enabled/존재여부는 유지)
    for other in _IMAGEUP_SCRIPTS:
        if other == which:
            continue
        other_acc = (cfg.get(other) or {}).get("accounts")
        if other_acc is None:
            # 아직 저장된 적 없으면 .py 본체에서 파싱
            other_acc = _parse_accounts_from_py(_IMAGEUP_SCRIPTS[other])
        changed = False
        for entry in other_acc:
            m = master.get(entry.get("id"))
            if m:
                if entry.get("pw") != m["pw"]:
                    entry["pw"] = m["pw"]; changed = True
                if entry.get("manager") != m["manager"]:
                    entry["manager"] = m["manager"]; changed = True
        if changed or (cfg.get(other) or {}).get("accounts") is None:
            cfg.setdefault(other, {})["accounts"] = other_acc
    _save_imageup_config(cfg)


def _parse_accounts_from_py(py_path: str) -> list:
    """.py 의 ACCOUNTS = [...] 블록을 정규식으로 대충 파싱.
    실패 시 빈 리스트. 정확성보다 안전성 우선."""
    import re
    if not os.path.exists(py_path):
        return []
    with open(py_path, encoding="utf-8") as f:
        src = f.read()
    m = re.search(r'ACCOUNTS\s*=\s*\[(.*?)\]', src, re.DOTALL)
    if not m:
        return []
    body = m.group(1)
    out = []
    # 각 dict 항목 ({...}) 통째로 매치 후 내부에서 키별 추출
    for entry in re.finditer(r'\{([^{}]*?)\}', body):
        inner = entry.group(1)
        def _pick(key):
            mm = re.search(r'"' + key + r'"\s*:\s*"([^"]*)"', inner)
            return mm.group(1) if mm else ""
        _id = _pick("id")
        if not _id:
            continue
        # 주석(#)이 같은 라인 시작부에 있으면 비활성으로 표시
        line_start = body.rfind("\n", 0, entry.start()) + 1
        line_text = body[line_start:entry.start()]
        enabled = "#" not in line_text
        out.append({
            "id": _id,
            "pw": _pick("pw"),
            "manager": _pick("manager"),
            "enabled": enabled,
        })
    return out


def imageup_start(which: str, accounts: list, limit=None, cases=None):
    """subprocess 시작 후 (run_id, None) 또는 (None, error_msg)."""
    if which not in _IMAGEUP_SCRIPTS:
        return None, "unknown script: " + str(which)
    script_path = _IMAGEUP_SCRIPTS[which]
    if not os.path.exists(script_path):
        return None, "script not found: " + script_path

    # enabled 계정만 .py 로 전달
    use_accounts = [a for a in (accounts or []) if a.get("enabled", True) and a.get("id")]
    if not use_accounts:
        return None, "활성 계정 없음"

    run_id = uuid.uuid4().hex[:12]
    env = os.environ.copy()
    # 한글 env vars 는 Python 3.14 + Windows console init 충돌 위험 → ASCII escape
    env["MJ_IMAGEUP_ACCOUNTS_JSON"] = json.dumps(use_accounts, ensure_ascii=True)
    if limit is not None:
        env["MJ_IMAGEUP_LIMIT"] = str(int(limit))
    if cases:
        env["MJ_IMAGEUP_CASES_JSON"] = json.dumps(list(cases), ensure_ascii=True)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    try:
        # Python 3.14 prerelease 의 console init 버그 회피: cmd.exe 통해 우회
        # shell=True 면 cmd.exe wrapping → STATUS_DLL_INIT_FAILED 회피
        if sys.platform == "win32":
            cmd = f'"{sys.executable}" -u "{script_path}"'
            proc = subprocess.Popen(
                cmd,
                cwd=os.path.dirname(script_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                shell=True,
            )
        else:
            proc = subprocess.Popen(
                [sys.executable, "-u", script_path],
                cwd=os.path.dirname(script_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
    except Exception as e:
        return None, "subprocess 시작 실패: " + str(e)

    state = {
        "proc": proc,
        "lines": [],
        "status": "running",
        "exit_code": None,
        "lock": threading.Lock(),
        "started_at": time.time(),
    }
    with _imageup_lock:
        _imageup_runs[run_id] = state

    def reader():
        try:
            for line in proc.stdout:  # type: ignore[union-attr]
                with state["lock"]:
                    state["lines"].append(line.rstrip("\r\n"))
        except Exception as e:
            with state["lock"]:
                state["lines"].append("[READER ERROR] " + str(e))
        proc.wait()
        with state["lock"]:
            state["status"] = "done"
            state["exit_code"] = proc.returncode

    threading.Thread(target=reader, daemon=True).start()
    return run_id, None


def imageup_logs(run_id: str, offset: int = 0):
    state = _imageup_runs.get(run_id)
    if not state:
        return None
    with state["lock"]:
        lines = state["lines"][offset:]
        return {
            "lines": lines,
            "status": state["status"],
            "exit_code": state["exit_code"],
        }


def imageup_stop(run_id: str) -> bool:
    state = _imageup_runs.get(run_id)
    if not state:
        return False
    try:
        state["proc"].terminate()
        return True
    except Exception:
        return False


# ============================================================
# 2) 파일 브라우저 (G:\내 드라이브\MAPS\...)
# ============================================================
def _resolve_path(root: str, rel: str):
    if root not in _FILE_ROOTS:
        raise ValueError("unknown root: " + root)
    base_abs = os.path.realpath(_FILE_ROOTS[root])
    rel = (rel or "").replace("\\", "/").lstrip("/")
    target = os.path.realpath(os.path.join(base_abs, rel))
    # 경로 탈출 방지
    if not (target == base_abs or target.startswith(base_abs + os.sep)):
        raise ValueError("path escape: " + target)
    return base_abs, target


def list_dir(root: str, rel: str) -> dict:
    try:
        base_abs, abs_path = _resolve_path(root, rel)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not os.path.exists(abs_path):
        return {"ok": False, "error": "폴더 없음: " + abs_path}
    items = []
    try:
        for e in os.scandir(abs_path):
            try:
                st = e.stat()
                items.append({
                    "name": e.name,
                    "is_dir": e.is_dir(),
                    "size": st.st_size if e.is_file() else None,
                    "mtime": int(st.st_mtime),
                    "rel": (rel.rstrip("/") + "/" + e.name).lstrip("/") if rel else e.name,
                })
            except Exception:
                pass
    except PermissionError as pe:
        return {"ok": False, "error": "권한 없음: " + str(pe)}
    # 폴더 먼저(이름순), 그 다음 파일(최신 mtime 먼저)
    items.sort(key=lambda x: (
        0 if x["is_dir"] else 1,
        x["name"].lower() if x["is_dir"] else -(x.get("mtime") or 0)
    ))
    return {"ok": True, "abs_path": abs_path, "items": items}


def search_files(root: str, rel: str, query: str, deep: bool = False) -> dict:
    try:
        base_abs, abs_path = _resolve_path(root, rel)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not os.path.exists(abs_path):
        return {"ok": False, "error": "폴더 없음"}
    if not query.strip():
        return {"ok": True, "items": []}
    q = query.strip().lower()
    items = []
    limit = 500
    try:
        if deep:
            for dp, dns, fns in os.walk(abs_path):
                for n in dns + fns:
                    if q in n.lower():
                        full = os.path.join(dp, n)
                        try:
                            is_dir = os.path.isdir(full)
                            st = os.stat(full)
                            rel_path = os.path.relpath(full, base_abs).replace("\\", "/")
                            items.append({
                                "name": n,
                                "is_dir": is_dir,
                                "size": st.st_size if not is_dir else None,
                                "mtime": int(st.st_mtime),
                                "rel": rel_path,
                            })
                            if len(items) >= limit:
                                break
                        except Exception:
                            pass
                if len(items) >= limit:
                    break
        else:
            for e in os.scandir(abs_path):
                if q in e.name.lower():
                    try:
                        st = e.stat()
                        items.append({
                            "name": e.name,
                            "is_dir": e.is_dir(),
                            "size": st.st_size if e.is_file() else None,
                            "mtime": int(st.st_mtime),
                            "rel": (rel.rstrip("/") + "/" + e.name).lstrip("/") if rel else e.name,
                        })
                        if len(items) >= limit:
                            break
                    except Exception:
                        pass
    except Exception as e:
        return {"ok": False, "error": str(e)}
    # 폴더 먼저(이름순), 그 다음 파일(최신 mtime 먼저)
    items.sort(key=lambda x: (
        0 if x["is_dir"] else 1,
        x["name"].lower() if x["is_dir"] else -(x.get("mtime") or 0)
    ))
    return {"ok": True, "items": items, "truncated": len(items) >= limit}


def folder_fingerprint(root: str, rel: str) -> dict:
    """폴더 변경 감지용 가벼운 지문: 파일 수 + 최대 mtime.
    파일 내용·이름 직렬화 안 함 → 디렉토리 큰 경우도 빠름."""
    try:
        base_abs, abs_path = _resolve_path(root, rel)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not os.path.exists(abs_path):
        return {"ok": False, "error": "폴더 없음"}
    count = 0
    max_mtime = 0
    try:
        for e in os.scandir(abs_path):
            count += 1
            try:
                mt = int(e.stat().st_mtime)
                if mt > max_mtime:
                    max_mtime = mt
            except Exception:
                pass
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "count": count, "max_mtime": max_mtime}


def _unique_dest(dst_abs: str) -> str:
    """대상 경로가 이미 존재하면 ' (1)', ' (2)' ... 를 확장자 앞에 붙여 충돌 회피."""
    if not os.path.exists(dst_abs):
        return dst_abs
    base_dir = os.path.dirname(dst_abs)
    name, ext = os.path.splitext(os.path.basename(dst_abs))
    for i in range(1, 1000):
        cand = os.path.join(base_dir, f"{name} ({i}){ext}")
        if not os.path.exists(cand):
            return cand
    raise RuntimeError("대상 이름 자동 부여 실패 (1000 시도 초과)")


def copy_file(src_root: str, src_rel: str, dst_root: str, dst_rel: str = "") -> dict:
    """파일을 src_root/src_rel 에서 dst_root/dst_rel 로 복사. dst_rel 비어있으면 src_rel 그대로 사용.
    같은 이름 존재 시 ' (N)' 자동 부여. 폴더 복사는 금지(파일만)."""
    try:
        _, src_abs = _resolve_path(src_root, src_rel)
    except Exception as e:
        return {"ok": False, "error": "원본 경로 오류: " + str(e)}
    if not os.path.isfile(src_abs):
        return {"ok": False, "error": "원본 파일 없음(또는 폴더): " + src_abs}
    rel_target = (dst_rel or src_rel).replace("\\", "/").lstrip("/")
    try:
        dst_base_abs, dst_abs = _resolve_path(dst_root, rel_target)
    except Exception as e:
        return {"ok": False, "error": "대상 경로 오류: " + str(e)}
    try:
        os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
        dst_final = _unique_dest(dst_abs)
        shutil.copy2(src_abs, dst_final)
        rel_final = os.path.relpath(dst_final, dst_base_abs).replace("\\", "/")
        return {"ok": True, "dst_rel": rel_final, "dst_abs": dst_final}
    except Exception as e:
        return {"ok": False, "error": "복사 실패: " + str(e)}


def delete_file(root: str, rel: str) -> dict:
    """파일 1개 삭제. 안전을 위해 폴더 삭제는 차단."""
    try:
        _, abs_path = _resolve_path(root, rel)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not os.path.exists(abs_path):
        return {"ok": False, "error": "대상 없음: " + abs_path}
    if os.path.isdir(abs_path):
        return {"ok": False, "error": "폴더 삭제는 매니저에서 차단됨 (탐색기에서 직접 삭제)"}
    try:
        os.remove(abs_path)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": "삭제 실패: " + str(e)}


def serve_file_to(handler, root: str, rel: str):
    """파일 본문을 응답으로 직접 전송."""
    try:
        base_abs, abs_path = _resolve_path(root, rel)
    except Exception as e:
        handler.send_response(400)
        handler.end_headers()
        handler.wfile.write(str(e).encode("utf-8"))
        return
    if not os.path.isfile(abs_path):
        handler.send_response(404)
        handler.end_headers()
        handler.wfile.write(b"file not found")
        return
    ctype, _ = mimetypes.guess_type(abs_path)
    ctype = ctype or "application/octet-stream"
    try:
        size = os.path.getsize(abs_path)
        handler.send_response(200)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(size))
        handler.send_header("Cache-Control", "no-cache")
        handler.end_headers()
        with open(abs_path, "rb") as f:
            while True:
                chunk = f.read(64 * 1024)
                if not chunk:
                    break
                handler.wfile.write(chunk)
    except Exception as e:
        try:
            handler.send_response(500)
            handler.end_headers()
            handler.wfile.write(str(e).encode("utf-8"))
        except Exception:
            pass


# ============================================================
# 3) 카카오 서버 독립 프로세스 관리
# ============================================================
_KAKAO_PORT = 8000
_KAKAO_ERR_LOG = os.path.join(_DIR_KAKAO, "kakao_server_error.log")
_kakao_state = {"proc": None, "pid": None}


def _kakao_port_listening() -> bool:
    """포트 8000 이 실제로 LISTEN 중인지 = 서버 살아있음의 진짜 기준."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        return s.connect_ex(("127.0.0.1", _KAKAO_PORT)) == 0
    except OSError:
        return False
    finally:
        s.close()


def kakao_status() -> dict:
    # 진짜 기준은 포트 LISTEN 여부 (매니저 재시작 후에도, 독립 프로세스도 감지)
    listening = _kakao_port_listening()
    p = _kakao_state["proc"]
    pid = _kakao_state["pid"] if (p is not None and p.poll() is None) else None
    return {"running": listening, "pid": pid}


def kakao_start() -> dict:
    if _kakao_port_listening():
        return {"ok": True, "pid": _kakao_state["pid"], "msg": "이미 실행중"}
    script = os.path.join(_DIR_KAKAO, "kakao_server.py")
    if not os.path.exists(script):
        return {"ok": False, "error": "kakao_server.py 없음: " + script}
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        errf = open(_KAKAO_ERR_LOG, "w", encoding="utf-8")
        proc = subprocess.Popen(
            [sys.executable, script],
            cwd=os.path.dirname(script),
            stdout=subprocess.DEVNULL,
            stderr=errf,
            stdin=subprocess.DEVNULL,
            creationflags=flags,
            close_fds=True,
        )
        _kakao_state["proc"] = proc
        _kakao_state["pid"] = proc.pid
    except Exception as e:
        return {"ok": False, "error": str(e)}

    # pyautogui import 등으로 기동이 느리므로 포트가 뜰 때까지 최대 ~8초 대기
    deadline = time.time() + 8.0
    while time.time() < deadline:
        if _kakao_port_listening():
            return {"ok": True, "pid": proc.pid}
        if proc.poll() is not None:  # 기동 중 죽음 → stderr 회수
            break
        time.sleep(0.25)

    # 여기 도달 = 포트 안 뜸. 죽었으면 에러 로그 첨부
    err = ""
    try:
        errf.flush()
        with open(_KAKAO_ERR_LOG, "r", encoding="utf-8", errors="replace") as f:
            err = f.read().strip()
    except Exception:
        pass
    if proc.poll() is not None:
        msg = "카카오 서버가 기동 직후 종료됨 (exit %s)" % proc.returncode
    else:
        msg = "카카오 서버 프로세스는 살아있으나 %s 포트 응답 없음" % _KAKAO_PORT
    if err:
        msg += " — " + err.splitlines()[-1][:300]
    return {"ok": False, "error": msg}


def kakao_stop() -> dict:
    p = _kakao_state["proc"]
    if p is not None and p.poll() is None:
        try:
            p.terminate()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    # 이 매니저가 띄운 핸들이 없는데 포트는 열려있음 = 다른(이전) 프로세스 소유
    if _kakao_port_listening():
        return {"ok": False,
                "error": "다른 프로세스가 8000 포트를 점유 중입니다. 해당 콘솔/작업관리자에서 종료하세요."}
    return {"ok": True, "msg": "이미 중지됨"}


# ============================================================
# 4) HTTP 핸들러 디스패처 (crawler.py 에서 호출)
# ============================================================
def _send_json(handler, code: int, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def handle_get(handler) -> bool:
    """crawler.py do_GET 에서 호출. True 반환 시 응답 완료. False 시 다음 라우터로."""
    path = handler.path
    qs = {}
    if "?" in path:
        path, q = path.split("?", 1)
        qs = dict(urllib.parse.parse_qsl(q))

    # 이미지캡쳐 계정 읽기
    if path == "/api/imageup/accounts":
        which = qs.get("which", "")
        _send_json(handler, 200, {"ok": True, "accounts": get_accounts(which)})
        return True

    # 이미지캡쳐 로그
    if path == "/api/imageup/logs":
        run_id = qs.get("run_id", "")
        offset = int(qs.get("offset", "0") or "0")
        r = imageup_logs(run_id, offset)
        if r is None:
            _send_json(handler, 404, {"ok": False, "error": "unknown run_id"})
        else:
            _send_json(handler, 200, {"ok": True, **r})
        return True

    # 파일 브라우저
    if path == "/api/files/list":
        r = list_dir(qs.get("root", ""), qs.get("rel", ""))
        _send_json(handler, 200, r)
        return True
    if path == "/api/files/search":
        r = search_files(
            qs.get("root", ""), qs.get("rel", ""),
            qs.get("q", ""), qs.get("deep", "0") in ("1", "true", "yes"),
        )
        _send_json(handler, 200, r)
        return True
    if path == "/api/files/get":
        serve_file_to(handler, qs.get("root", ""), qs.get("rel", ""))
        return True
    if path == "/api/files/fingerprint":
        r = folder_fingerprint(qs.get("root", ""), qs.get("rel", ""))
        _send_json(handler, 200, r)
        return True

    # 카카오
    if path == "/api/kakao/status":
        _send_json(handler, 200, kakao_status())
        return True

    return False


def handle_post(handler) -> bool:
    """crawler.py do_POST 에서 호출. True 반환 시 응답 완료."""
    path = handler.path
    if "?" in path:
        path, _ = path.split("?", 1)

    # ---- 이미지캡쳐 ----
    if path == "/api/imageup/accounts":
        # 저장
        which = ""
        if "?" in handler.path:
            qs = dict(urllib.parse.parse_qsl(handler.path.split("?", 1)[1]))
            which = qs.get("which", "")
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            save_accounts(which, payload.get("accounts") or [])
            _send_json(handler, 200, {"ok": True})
        except Exception as e:
            _send_json(handler, 500, {"ok": False, "error": str(e)})
        return True

    if path == "/api/imageup/run":
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            which = payload.get("which", "")
            accounts = payload.get("accounts") or []
            limit = payload.get("limit")
            cases = payload.get("cases")
            run_id, err = imageup_start(which, accounts, limit=limit, cases=cases)
            if err:
                _send_json(handler, 400, {"ok": False, "error": err})
            else:
                _send_json(handler, 200, {"ok": True, "run_id": run_id})
        except Exception as e:
            _send_json(handler, 500, {"ok": False, "error": str(e)})
        return True

    if path == "/api/imageup/stop":
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            ok = imageup_stop(payload.get("run_id", ""))
            _send_json(handler, 200, {"ok": ok})
        except Exception as e:
            _send_json(handler, 500, {"ok": False, "error": str(e)})
        return True

    # ---- 파일 복사/삭제 ----
    if path == "/api/files/copy":
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            r = copy_file(
                payload.get("src_root", ""), payload.get("src_rel", ""),
                payload.get("dst_root", ""), payload.get("dst_rel", ""),
            )
            _send_json(handler, 200, r)
        except Exception as e:
            _send_json(handler, 500, {"ok": False, "error": str(e)})
        return True

    if path == "/api/files/delete":
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw or "{}")
            r = delete_file(payload.get("root", ""), payload.get("rel", ""))
            _send_json(handler, 200, r)
        except Exception as e:
            _send_json(handler, 500, {"ok": False, "error": str(e)})
        return True

    # ---- 카카오 ----
    if path == "/api/kakao/start":
        _send_json(handler, 200, kakao_start())
        return True
    if path == "/api/kakao/stop":
        _send_json(handler, 200, kakao_stop())
        return True

    return False
