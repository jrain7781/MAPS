// MJ 크롤링 매니저 실행기 - background service worker
// 툴바 아이콘 클릭 → native host 호출 → 서버 실행 + 새 탭 열기

const HOST_NAME = 'com.mj.crawler';
const TARGET_URL = 'http://localhost:8765/';

chrome.action.onClicked.addListener(async () => {
  let status = 'unknown';
  try {
    const response = await sendNativeMessage(HOST_NAME, { action: 'start' });
    status = (response && response.status) || 'no_response';
    console.log('[MJ] native host response:', response);
  } catch (e) {
    console.error('[MJ] native host failed:', e);
    // 알림 권한 없으니 콘솔 + 탭 메시지로 안내
    chrome.tabs.create({
      url: 'data:text/html;charset=utf-8,' + encodeURIComponent(
        '<h2>MJ 매니저 실행 실패</h2>' +
        '<p>네이티브 호스트 호출 실패. register.bat 실행 여부를 확인하세요.</p>' +
        '<pre>' + (e.message || e) + '</pre>'
      )
    });
    return;
  }

  // 서버가 막 시작됐을 때 약간 대기 (포트 바인딩 시간)
  const waitMs = status === 'started' ? 1500 : 200;
  setTimeout(() => {
    chrome.tabs.query({ url: TARGET_URL + '*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: TARGET_URL });
      }
    });
  }, waitMs);
});

function sendNativeMessage(host, msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(host, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
