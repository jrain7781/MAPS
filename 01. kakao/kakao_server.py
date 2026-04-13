import http.server
import socketserver
import json
import pyautogui
import pyperclip
import time

PORT = 8000

class KakaoHandler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, format, *args):
        # 기본 HTTP 요청 로그 억제 (직접 print로 관리)
        pass

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/send_kakao':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            target_name = data.get('target_name', '')
            message = data.get('message', '')
            auto_enter = data.get('auto_enter', False)

            if not target_name or not message:
                self._send_json(400, {"status": "error", "message": "target_name 또는 message가 없습니다."})
                return

            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 카카오톡 전송 요청:")
            print(f"  - 대상: {target_name}")
            print(f"  - 길이: {len(message)}자")
            print(f"  - 자동전송(엔터): {auto_enter}")

            try:
                import pygetwindow as gw

                # 1. 카카오톡 창 활성화
                kakao_wins = gw.getWindowsWithTitle('카카오톡')
                if not kakao_wins:
                    raise Exception("카카오톡이 실행되어 있지 않습니다. 카카오톡을 먼저 켜주세요.")

                kakao_win = kakao_wins[0]
                try:
                    if kakao_win.isMinimized:
                        kakao_win.restore()
                    kakao_win.activate()
                except Exception as win_err:
                    # pygetwindow 알려진 버그: 에러코드 0은 성공인데 예외를 던지는 경우
                    if "Error code from Windows: 0" not in str(win_err):
                        print(f"  >> 창 활성화 경고 (무시 가능): {win_err}")

                time.sleep(0.5)

                # 2. Ctrl+F 로 검색창 열고 이름 입력
                pyautogui.hotkey('ctrl', 'f')
                time.sleep(0.3)
                pyperclip.copy(target_name)
                pyautogui.hotkey('ctrl', 'v')
                time.sleep(0.8)

                # 검색 결과 첫 항목 Enter로 채팅방 진입
                pyautogui.press('enter')
                time.sleep(0.8)

                # 3. 메시지 붙여넣기
                pyperclip.copy(message)
                pyautogui.hotkey('ctrl', 'v')
                time.sleep(0.3)

                if auto_enter:
                    pyautogui.press('enter')
                    print("  >> 전송 완료 (자동 엔터)")
                else:
                    print("  >> 붙여넣기 완료 (사용자 확인 후 전송)")

                self._send_json(200, {"status": "success", "message": "카톡 조작 완료"})

            except Exception as e:
                error_msg = str(e)
                print(f"  !! 오류: {error_msg}")
                self._send_json(500, {"status": "error", "message": error_msg})
        else:
            self.send_response(404)
            self.end_headers()

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True  # 서버 재시작 시 "Address already in use" 방지


if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), KakaoHandler) as httpd:
        print(f"카카오톡 매크로 서버가 {PORT} 포트에서 시작되었습니다.")
        print("이 창을 끄지 마시고, 브라우저에서 '💬카톡 전송' 버튼을 클릭하세요.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")
