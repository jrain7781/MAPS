import re
import os

# --- Step 1: Reconstruct preview.html ---

# Read the content of index.html
try:
    with open(r"C:\LJW\MAPS_TEST\index.html", "r", encoding="utf-8") as f:
        index_content = f.read()

    # 1a. Remove the "전체보기" button HTML
    button_to_remove_pattern = re.compile(
        r'\s*<button onclick="showAllItemData\(\)"[^>]*?>전체보기</button>',
        re.DOTALL
    )
    modified_content = button_to_remove_pattern.sub("", index_content)

    # 1b. Replace Apps Script specific includes (CORRECTED QUOTES)
    modified_content = modified_content.replace(
        "<?!= include('css'); ?>",
        '<link rel="stylesheet" href="css.html">'
    )
    modified_content = modified_content.replace(
        "<?!= include('js-app'); ?>",
        '<script src="js-app.html"></script>'
    )

    # 1c. Remove Apps Script specific parameter injection script
    gas_params_script_pattern = re.compile(
        r'<!-- 서버\(doGet\)에서 받은 파라미터 주입.*?<script>.*?window\.__MJ_GAS_PARAMS__.*?</script>',
        re.DOTALL
    )
    modified_content = gas_params_script_pattern.sub("", modified_content)

    # 1d. Insert the Mock Google Apps Script Environment and DOMContentLoaded listener
    mock_gas_environment = """
    <script>
    // --- Mock Google Apps Script Environment ---
    window.google = {
      script: {
        run: {
          withSuccessHandler: function(handler) {
            this.successHandler = handler;
            return this;
          },
          withFailureHandler: function(handler) {
            this.failureHandler = handler;
            return this;
          },
          // Mock functions from js-app.html
          getCourtList: function() { const courts = ['서울중앙', '서울동부', '서울남부', '서울북부', '서울서부', '의정부', '인천', '수원']; setTimeout(() => this.successHandler(courts), 100); },
          readAllDataWithImageIds: function() { const mockData = [ {id: 1, 'in-date': '260204', sakun_no: '2025타경1001', court: '서울중앙', stu_member: '상품', m_name: '홍길동(이정우)', m_name_id: '대표님', image_ids: ['img1']}, {id: 2, 'in-date': '260205', sakun_no: '2025타경1002', court: '서울남부', stu_member: '미정', m_name: '이정우', m_name_id: '전제혁', image_ids: []}, {id: 3, 'in-date': '260206', sakun_no: '2025타경1003', court: '인천본원', stu_member: '추천', m_name: '김철수', m_name_id: '대표님', image_ids: ['img2']}, {id: 4, 'in-date': '260210', sakun_no: '2025타경2024', court: '수원지법', stu_member: '입찰', m_name: '박영희', m_name_id: '대표님', image_ids: []}, {id: 5, 'in-date': '260211', sakun_no: '2025타경3030', court: '서울북부', stu_member: '변경', m_name: '최민수', m_name_id: '전제혁', image_ids: []} ]; setTimeout(() => this.successHandler(mockData), 200); },
          readAllMembers: function() { const members = [ {member_id: 'M001', name: '홍길동', role: 'admin', phone: '010-1111-2222', class_name: 'VIP'}, {member_id: 'M002', name: '김철수', role: 'member', phone: '010-3333-4444', class_name: '일반'} ]; setTimeout(() => this.successHandler(members), 100); },
          removeImageSyncTriggers: function() { setTimeout(() => this.successHandler({message: 'Success'}), 10); }
        }
      }
    };
    console.log("Mock GAS Loaded for local preview.");

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (typeof navigateTo === 'function') navigateTo('Dashboard');
        }, 500);
    });
    </script>
    """

    # Insert the mock environment before the main js-app script
    js_app_include_pos = modified_content.find('<script src="js-app.html"></script>')
    if js_app_include_pos != -1:
        modified_content = modified_content[:js_app_include_pos] + mock_gas_environment + modified_content[js_app_include_pos:]
    else:
        # Fallback
        modified_content = modified_content.replace('</body>', mock_gas_environment + '</body>')

    # Write the final content to preview.html
    with open(r"C:\LJW\MAPS_TEST\preview.html", "w", encoding="utf-8") as f:
        f.write(modified_content)
    print("Step 1: Successfully reconstructed preview.html.")

except Exception as e:
    print(f"Error during Step 1 (reconstructing preview.html): {e}")


# --- Step 2: Create server.py for UTF-8 serving ---
server_script_content = """
import http.server
import socketserver

PORT = 8000
Handler = http.server.SimpleHTTPRequestHandler

class MyHandler(Handler):
    def end_headers(self):
        self.send_header('Content-type', 'text/html; charset=utf-8')
        super().end_headers()

try:
    with socketserver.TCPServer(("", PORT), MyHandler) as httpd:
        print(f"Serving at http://127.0.0.1:{PORT}")
        httpd.serve_forever()
except OSError as e:
    print(f"Could not start server on port {PORT}. Error: {e}")
    print("The port might be in use by another application.")

"""
try:
    with open(r"C:\LJW\MAPS_TEST\server.py", "w", encoding="utf-8") as f:
        f.write(server_script_content)
    print("Step 2: Successfully created server.py for UTF-8 encoding.")
except Exception as e:
    print(f"Error during Step 2 (creating server.py): {e}")