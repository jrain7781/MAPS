import os
import re

def create_preview():
    try:
        # 1. 원본 파일 읽기
        with open('index.html', 'r', encoding='utf-8') as f:
            index = f.read()
        with open('css.html', 'r', encoding='utf-8') as f:
            css = f.read()
        with open('js-app.html', 'r', encoding='utf-8') as f:
            js = f.read()

        # 2. 중복 태그 제거 (태그 내부의 내용만 추출)
        css_content = re.sub(r'<\/?style>', '', css, flags=re.IGNORECASE).strip()
        js_content = re.sub(r'<\/?script>', '', js, flags=re.IGNORECASE).strip()

        # 3. 가짜(Mock) 데이터 및 GAS 환경 흉내내기 스크립트
        mock_gas_js = """
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
      getCourtList: function() {
        const courts = ['서울중앙', '서울동부', '서울남부', '서울북부', '서울서부', '의정부', '인천', '수원'];
        setTimeout(() => this.successHandler(courts), 100);
      },
      readAllDataWithImageIds: function() {
        const mockData = [
          {id: 1, 'in-date': '260204', sakun_no: '2025타경1001', court: '서울중앙', stu_member: '상품', m_name: '홍길동(이정우)', m_name_id: '대표님', image_ids: ['img1']},
          {id: 2, 'in-date': '260205', sakun_no: '2025타경1002', court: '서울남부', stu_member: '미정', m_name: '이정우', m_name_id: '전제혁', image_ids: []},
          {id: 3, 'in-date': '260206', sakun_no: '2025타경1003', court: '인천본원', stu_member: '추천', m_name: '김철수', m_name_id: '대표님', image_ids: ['img2']},
          {id: 4, 'in-date': '260210', sakun_no: '2025타경2024', court: '수원지법', stu_member: '입찰', m_name: '박영희', m_name_id: '대표님', image_ids: []},
          {id: 5, 'in-date': '260211', sakun_no: '2025타경3030', court: '서울북부', stu_member: '변경', m_name: '최민수', m_name_id: '전제혁', image_ids: []}
        ];
        setTimeout(() => this.successHandler(mockData), 200);
      },
      readAllMembers: function() {
        const members = [
          {member_id: 'M001', name: '홍길동', role: 'admin', phone: '010-1111-2222', class_name: 'VIP'},
          {member_id: 'M002', name: '김철수', role: 'member', phone: '010-3333-4444', class_name: '일반'}
        ];
        setTimeout(() => this.successHandler(members), 100);
      },
      removeImageSyncTriggers: function() { setTimeout(() => this.successHandler({message: 'Success'}), 10); }
    }
  }
};
console.log("Mock GAS Loaded.");

// 초기화: Dashboard 탭 강제 표시
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo('Dashboard');
    }, 500);
});
"""

        # 4. index.html 내용 조립
        if '<meta charset="UTF-8">' not in index.upper():
            index = index.replace('<head>', '<head>\n    <meta charset="UTF-8">')

        index = index.replace("<?!= include('css'); ?>", f"<style>\n{css_content}\n</style>")
        index = index.replace("<?!= include('js-app'); ?>", f"<script>\n{mock_gas_js}\n\n{js_content}\n</script>")

        # 5. 결과 저장
        with open('preview.html', 'w', encoding='utf-8-sig') as f:
            f.write(index)
        
        print("preview.html 생성 완료! 이제 브라우저에서 메뉴가 정상 작동합니다.")
    except Exception as e:
        print(f"오류 발생: {e}")

if __name__ == "__main__":
    create_preview()
