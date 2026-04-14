import http.server
import socketserver
import json
import pyautogui
import pyperclip
import time

PORT = 8000

class KakaoHandler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))

        if self.path == '/open_kakao':
            target_name = data.get('target_name', '')
            if not target_name:
                self._send_json(400, {"status": "error", "message": "target_name이 없습니다."})
                return

            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 채팅창 열기 요청: {target_name}")
            try:
                self._focus_kakao()
                self._search_and_enter(target_name)
                print("  >> 채팅창 열기 완료")
                self._send_json(200, {"status": "success", "message": "채팅창 열기 완료"})
            except Exception as e:
                print(f"  !! 오류: {e}")
                self._send_json(500, {"status": "error", "message": str(e)})

        elif self.path == '/send_kakao':
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
                self._focus_kakao()
                self._search_and_enter(target_name)

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
                print(f"  !! 오류: {e}")
                self._send_json(500, {"status": "error", "message": str(e)})

        else:
            self.send_response(404)
            self.end_headers()

    def _focus_kakao(self):
        """카카오톡 창 활성화 + 500x800 리사이즈 + 채팅탭 이동(B, 1)"""
        import pygetwindow as gw

        kakao_wins = gw.getWindowsWithTitle('카카오톡')
        if not kakao_wins:
            raise Exception("카카오톡이 실행되어 있지 않습니다. 카카오톡을 먼저 켜주세요.")

        win = kakao_wins[0]
        try:
            pyautogui.press('alt')
            win.activate()
            if win.isMinimized:
                win.restore()
            
            # 창 크기 고정 (좌표 일관성 유지)
            win.resizeTo(500, 800)
            time.sleep(0.3)
            win.activate()

            # [단계 1] 사이드바 채팅 아이콘(B) 클릭
            pyautogui.moveTo(win.left + 35, win.top + 110, duration=0.1)
            pyautogui.click()
            time.sleep(0.3)

            # [단계 1-1] 상단 '채팅(1)' 탭 클릭 (위치 수정: 왼쪽 위로 20px씩 이동)
            pyautogui.moveTo(win.left + 100, win.top + 50, duration=0.1)
            pyautogui.click()
            time.sleep(0.3)
            
        except Exception as e:
            if "Error code from Windows: 0" not in str(e):
                print(f"  >> 창 활성화 경고: {e}")

        time.sleep(0.2)

    def _search_and_enter(self, target_name):
        """Ctrl+F -> 검색창 더블클릭 -> 이름 입력"""
        import pygetwindow as gw
        
        # [단계 2] Ctrl + F 로 검색창 포커스
        pyautogui.hotkey('ctrl', 'f')
        time.sleep(0.3)

        # [단계 3] 검색창 위치 더블클릭 (위치 수정: 오른쪽으로 2cm 이동)
        win = gw.getWindowsWithTitle('카카오톡')[0]
        search_x, search_y = win.left + 165, win.top + 105
        pyautogui.moveTo(search_x, search_y) # 순간이동
        pyautogui.doubleClick()
        time.sleep(0.2)

        # [단계 4] 회원 이름 붙여넣기 및 엔터
        print(f"  >> '{target_name}' 이름 입력 중...")
        pyperclip.copy(target_name)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.5) # 이름 입력 후 대기시간 단축
        
        # 엔터를 쳐서 채팅방 열기
        pyautogui.press('enter')
        time.sleep(0.5)

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), KakaoHandler) as httpd:
        print(f"카카오톡 매크로 서버가 {PORT} 포트에서 시작되었습니다.")
        print("이 창을 끄지 마시고, 브라우저에서 버튼을 클릭하세요.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")
