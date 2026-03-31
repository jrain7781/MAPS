/**
 * [Main.gs]
 * 웹 앱의 진입점(Entry Point) 및 HTML 템플릿 로딩 담당
 * Last sync: 2026-02-11
 */

/**
 * 웹 앱의 메인 페이지를 제공합니다.
 * 🔐 보안: 관리자 KEY 또는 회원 토큰 필요
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const adminKey = params.admin || '';
  const memberToken = params.t || params.token || '';

  // [추가] items 시트 Q1, R1 컬럼 자동 추가 (사용자 요청: 컬럼 추가 너가 해주고)
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (sheet) {
      if (sheet.getRange("Q1").getValue() !== "chuchen_state") sheet.getRange("Q1").setValue("chuchen_state");
      if (sheet.getRange("R1").getValue() !== "chuchen_date") sheet.getRange("R1").setValue("chuchen_date");
    }
  } catch (err) {
    Logger.log("컬럼 추가 오류: " + err);
  }

  // 1. 관리자 KEY 확인
  if (adminKey) {
    const validAdminKey = getAdminSecretKey_();
    if (adminKey === validAdminKey) {
      // ★ API 조회 (Python 크롤링 스크립트용 - ?admin=KEY&api=getSearchItems)
      if (params.api === 'getSearchItems') {
        try {
          const items = (typeof readAllSearchItems === 'function') ? readAllSearchItems() : [];
          return ContentService.createTextOutput(JSON.stringify({ success: true, items: items }))
            .setMimeType(ContentService.MimeType.JSON);
        } catch (apiErr) {
          return ContentService.createTextOutput(JSON.stringify({ success: false, message: String(apiErr) }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }

      // ✅ 관리자 전체 접근
      const template = HtmlService.createTemplateFromFile('index');
      template.__params = params;
      return template
        .evaluate()
        .setTitle('MJ경매 입찰 관리 시스템')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }

  // 2. 회원 토큰 확인
  if (memberToken) {
    const member = getMemberByToken(memberToken);
    if (member) {
      // ✅ 회원 제한된 접근
      const template = HtmlService.createTemplateFromFile('index');
      template.__params = params;
      return template
        .evaluate()
        .setTitle('MJ경매 입찰 관리 시스템')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }

  // 3. 인증 실패 → 접근 거부
  return HtmlService.createHtmlOutputFromFile('access-denied')
    .setTitle('접근 거부')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * (Telegram Webhook) 텔레그램이 보내는 업데이트를 수신합니다.
 * - 스크립트 속성 TELEGRAM_BOT_TOKEN 설정 필요
 * - webhook URL은 setTelegramWebhook() 실행으로 설정
 */
function doPost(e) {
  var _postStart = Date.now();
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw) {
      return ContentService.createTextOutput('NO_BODY').setMimeType(ContentService.MimeType.TEXT);
    }
    let payload = null;
    try { payload = JSON.parse(raw); } catch (err) { payload = null; }
    if (!payload) {
      return ContentService.createTextOutput('BAD_JSON').setMimeType(ContentService.MimeType.TEXT);
    }

    // ★ 외부 API 호출 처리 (Python 크롤링 스크립트 등 - api_action 필드로 구분)
    if (payload.api_action) {
      try {
        const apiKey = payload.api_key || '';
        const validKey = getAdminSecretKey_();
        if (apiKey !== validKey) {
          return ContentService.createTextOutput(JSON.stringify({ success: false, message: '인증 실패' }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        const result = (typeof handleSearchApiPost_ === 'function')
          ? handleSearchApiPost_(payload)
          : { success: false, message: 'handleSearchApiPost_ 함수 없음' };
        return ContentService.createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (apiErr) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: String(apiErr) }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ★ 텔레그램 웹훅 처리 (단계별 타이밍 로그)
    Logger.log('[doPost] 시작 - payload 파싱 완료 (' + (Date.now() - _postStart) + 'ms)');
    if (typeof handleTelegramWebhook_ === 'function') {
      handleTelegramWebhook_(payload);
    }
    Logger.log('[doPost] 완료 - 총 소요: ' + (Date.now() - _postStart) + 'ms');
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    // 텔레그램은 200 OK를 선호하므로 에러여도 OK 반환 (로그로만 확인)
    try { Logger.log('doPost error (' + (Date.now() - _postStart) + 'ms): ' + (err && err.stack ? err.stack : err)); } catch (e2) { }
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * HTML 파일을 템플릿으로 로드하여 Google Apps Script 환경 변수를 사용할 수 있게 합니다.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}