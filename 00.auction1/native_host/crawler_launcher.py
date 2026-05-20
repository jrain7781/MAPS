# -*- coding: utf-8 -*-
"""
crawler_launcher.py — Chrome Native Messaging Host

Chrome 확장에서 chrome.runtime.sendNativeMessage 로 호출됨.
- stdin: 4바이트 little-endian length + UTF-8 JSON payload
- 동작: localhost:8765 살아있는지 확인 → 안 살아있으면 crawler.py 백그라운드 실행
- stdout: 4바이트 length + JSON 응답
- exit
"""
import sys
import os
import json
import struct
import socket
import subprocess

CRAWLER_DIR = r"C:\LJW\01. SYSTEM\MAPS_TEST\00.auction1"
CRAWLER_PY = os.path.join(CRAWLER_DIR, "crawler.py")
PORT = 8765


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) != 4:
        return None
    msg_length = struct.unpack("<I", raw_length)[0]
    raw = sys.stdin.buffer.read(msg_length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def send_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def port_listening(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        s.connect(("127.0.0.1", port))
        s.close()
        return True
    except Exception:
        return False


def launch_crawler():
    if not os.path.isfile(CRAWLER_PY):
        return {"ok": False, "error": "crawler.py 없음: " + CRAWLER_PY}
    # Windows: 완전 분리된 백그라운드 프로세스로 실행
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(
            [sys.executable, "-u", CRAWLER_PY],
            cwd=CRAWLER_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=flags,
            close_fds=True,
        )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main():
    msg = read_message()  # 입력 메시지는 받기만 함 (action: start 등)
    if port_listening(PORT):
        send_message({"status": "already_running", "port": PORT})
        return
    r = launch_crawler()
    if r.get("ok"):
        send_message({"status": "started", "port": PORT})
    else:
        send_message({"status": "error", "error": r.get("error", "unknown")})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        try:
            send_message({"status": "error", "error": "launcher 예외: " + str(e)})
        except Exception:
            pass
        sys.exit(1)
