/**
 * [TelegramService.gs]
 * 텔레그램 봇 전송 유틸리티 + 물건 카드 전송
 *
 * 설정(스크립트 속성 권장):
 * - TELEGRAM_BOT_TOKEN: BotFather에서 발급받은 토큰
 * - WEBAPP_BASE_URL: (선택) 회원 전용 페이지 base URL. 없으면 ScriptApp.getService().getUrl() 사용
 */

function getTelegramBotToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!t) throw new Error('스크립트 속성 TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
  return String(t).trim();
}

function telegramApiUrl_(method) {
  return 'https://api.telegram.org/bot' + getTelegramBotToken_() + '/' + method;
}

function getWebAppBaseUrl_() {
  const configured = PropertiesService.getScriptProperties().getProperty('WEBAPP_BASE_URL');
  if (configured && String(configured).trim()) return String(configured).trim().replace(/\/+$/, '');
  const u = ScriptApp.getService().getUrl();
  return (u || '').replace(/\/+$/, '');
}

function telegramFetch_(method, payload) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(payload || {})
  };
  const resp = UrlFetchApp.fetch(telegramApiUrl_(method), options);
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { }
  if (code < 200 || code >= 300 || (parsed && parsed.ok === false)) {
    throw new Error('텔레그램 API 오류 (' + code + '): ' + text);
  }
  return parsed || text;
}

/**
 * 최근 업데이트를 조회해 chat_id를 찾는 용도.
 * - 봇을 만든 뒤, 본인(또는 회원)이 봇에게 먼저 메시지를 보내야 업데이트가 잡힙니다.
 */
function telegramGetUpdates(offset) {
  const resp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + getTelegramBotToken_() + '/getUpdates' + (offset ? ('?offset=' + encodeURIComponent(String(offset))) : ''),
    { muteHttpExceptions: true }
  );
  return resp.getContentText();
}

function telegramSendMessage(chatId, text, replyMarkup) {
  const extra = arguments.length >= 4 ? arguments[3] : null; // { replyToMessageId?: number|string }
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (extra && extra.replyToMessageId) payload.reply_to_message_id = extra.replyToMessageId;
  return telegramFetch_('sendMessage', payload);
}

function telegramAnswerCallbackQuery_(callbackQueryId, text, showAlert) {
  const payload = {
    callback_query_id: callbackQueryId,
    text: text || '',
    show_alert: !!showAlert
  };
  return telegramFetch_('answerCallbackQuery', payload);
}

function telegramDeleteMessage_(chatId, messageId) {
  const payload = {
    chat_id: chatId,
    message_id: messageId
  };
  return telegramFetch_('deleteMessage', payload);
}

/**
 * 텔레그램 webhook URL 설정 (관리자 1회 실행)
 * - WEBAPP_BASE_URL이 별도로 있으면 그 URL을 사용
 * - 없으면 ScriptApp.getService().getUrl() 사용
 * - Telegram은 반드시 HTTPS 공개 URL이어야 합니다.
 */
function setTelegramWebhook() {
  const base = getWebAppBaseUrl_();
  if (!base) throw new Error('WEBAPP_BASE_URL 또는 ScriptApp URL을 가져오지 못했습니다.');
  const url = base; // doPost는 루트로 들어옴
  const resp = telegramFetch_('setWebhook', { url: url });
  return { success: true, url: url, response: resp };
}

/**
 * Cloudflare Workers 프록시 URL을 스크립트 속성에 저장합니다.
 * ★ 최초 1회 실행 필요 (Apps Script 에디터에서 실행)
 * 
 * @param {string} proxyUrl Cloudflare Worker URL
 *   예: https://mjmaps-telegram-proxy.your-subdomain.workers.dev
 */
function setCloudflareProxyUrl(proxyUrl) {
  if (!proxyUrl) throw new Error('proxyUrl이 필요합니다.');
  const url = String(proxyUrl).trim().replace(/\/+$/, '');
  PropertiesService.getScriptProperties().setProperty('CLOUDFLARE_PROXY_URL', url);
  Logger.log('CLOUDFLARE_PROXY_URL 설정 완료: ' + url);
  return { success: true, url: url };
}

/**
 * Cloudflare Workers 프록시 URL을 가져옵니다.
 * @return {string} 프록시 URL (없으면 빈 문자열)
 */
function getCloudflareProxyUrl_() {
  return String(PropertiesService.getScriptProperties().getProperty('CLOUDFLARE_PROXY_URL') || '').trim();
}

/**
 * ★ 텔레그램 웹훅을 Cloudflare Workers 프록시 URL로 설정합니다.
 * GAS 직접 연결 시 302 리다이렉트 문제를 해결합니다.
 * 
 * 사전 조건:
 *   1. Cloudflare Worker 배포 완료
 *   2. setCloudflareProxyUrl('https://...workers.dev') 실행 완료
 * 
 * 실행: Apps Script 에디터 → setTelegramWebhookViaProxy 선택 → 실행
 */
function setTelegramWebhookViaProxy() {
  const proxyUrl = getCloudflareProxyUrl_();
  if (!proxyUrl) {
    throw new Error(
      'CLOUDFLARE_PROXY_URL이 설정되지 않았습니다.\n' +
      '먼저 setCloudflareProxyUrl("https://your-worker.workers.dev")를 실행하세요.'
    );
  }

  const log = [];
  log.push('=== Cloudflare 프록시 웹훅 설정 ===');
  log.push('프록시 URL: ' + proxyUrl);

  // 1. 기존 웹훅 삭제 + pending 클리어
  const token = getTelegramBotToken_();
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
    log.push('기존 웹훅 삭제 + pending 클리어 완료');
  } catch (e) {
    log.push('웹훅 삭제 실패: ' + e.message);
  }

  Utilities.sleep(1000);

  // 2. 프록시 URL로 웹훅 설정
  const webhookPayload = {
    url: proxyUrl,
    max_connections: 5  // Worker는 동시 처리 가능하므로 5로 설정
  };

  // WEBHOOK_SECRET이 설정되어 있으면 secret_token도 전달
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (secret) {
    webhookPayload.secret_token = secret;
    log.push('시크릿 토큰 포함');
  }

  const resp = telegramFetch_('setWebhook', webhookPayload);
  log.push('웹훅 설정 응답: ' + JSON.stringify(resp));

  // 3. 설정 확인
  Utilities.sleep(1000);
  try {
    var info = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', { muteHttpExceptions: true });
    var parsed = JSON.parse(info.getContentText());
    if (parsed.result) {
      log.push('');
      log.push('=== 설정 확인 ===');
      log.push('URL: ' + (parsed.result.url || '없음'));
      log.push('Pending: ' + (parsed.result.pending_update_count || 0));
      log.push('Max Connections: ' + (parsed.result.max_connections || 'default'));
      log.push('Has Secret Token: ' + (parsed.result.has_custom_certificate ? 'Yes' : 'No'));
      log.push('Last Error: ' + (parsed.result.last_error_message || '없음'));
    }
  } catch (e) {
    log.push('상태 확인 실패: ' + e.message);
  }

  const result = log.join('\n');
  Logger.log(result);
  return result;
}

/**
 * 텔레그램 웹훅을 GAS 직접 연결로 되돌립니다 (프록시 비활성화).
 * 문제 해결 또는 테스트 시 사용합니다.
 */
function revertTelegramWebhookToDirect() {
  const base = getWebAppBaseUrl_();
  if (!base) throw new Error('WEBAPP_BASE_URL이 설정되지 않았습니다.');

  const log = [];
  log.push('=== GAS 직접 연결로 웹훅 복원 ===');
  log.push('GAS URL: ' + base);

  const token = getTelegramBotToken_();
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
    log.push('기존 웹훅 삭제 완료');
  } catch (e) {
    log.push('웹훅 삭제 실패: ' + e.message);
  }

  Utilities.sleep(1000);

  const resp = telegramFetch_('setWebhook', {
    url: base,
    max_connections: 1  // GAS는 동시 실행 제한이 있으므로 1로 설정
  });
  log.push('웹훅 설정 응답: ' + JSON.stringify(resp));
  log.push('');
  log.push('⚠️ GAS 직접 연결은 302 리다이렉트 문제가 발생할 수 있습니다.');
  log.push('⚠️ 프록시 사용을 권장합니다: setTelegramWebhookViaProxy()');

  const result = log.join('\n');
  Logger.log(result);
  return result;
}

function extractMemberTokenFromText_(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  // 1) "인증 <token>" 형태 지원
  const m1 = s.match(/^(?:인증|auth)\s+([0-9a-f]{32,128})$/i);
  if (m1 && m1[1]) return m1[1];
  // 2) 토큰만 단독으로 온 경우 (기본 토큰은 64 hex)
  const m2 = s.match(/([0-9a-f]{64})/i);
  if (m2 && m2[1]) return m2[1];
  return '';
}

/**
 * (내부) 텔레그램 webhook 업데이트 처리
 * - 회원이 봇에 "인증 <member_token>" 또는 토큰만 보내면 members에 chat_id 자동 등록
 */
function handleTelegramWebhook_(update) {
  var _whStart = Date.now();
  function _whLog(msg) { try { Logger.log('[WH ' + (Date.now() - _whStart) + 'ms] ' + msg); } catch (e) { } }

  if (!update) return;
  _whLog('시작');

  // 텔레그램은 웹훅 응답이 늦으면 동일 업데이트를 재시도할 수 있어 중복 처리 방지 필요
  // (특히 callback_query를 여러 번 보내면 채팅이 도배될 수 있음)
  function markProcessedOnce_(key, ttlSeconds) {
    try {
      const cache = CacheService.getScriptCache();
      const exists = cache.get(key);
      if (exists) return false; // 이미 처리됨
      cache.put(key, '1', ttlSeconds || 6 * 60 * 60); // 기본 6시간
      return true;
    } catch (e) {
      // 캐시 실패 시에도 기능은 동작해야 함 (중복 방지는 약해짐)
      return true;
    }
  }

  // 1) 일반 메시지(토큰 인증)
  const msg = update.message;
  if (msg && msg.chat && msg.chat.id) {
    const chatId = String(msg.chat.id).trim();
    const from = msg.from || {};
    const username = from.username ? ('@' + String(from.username).trim()) : '';
    const text = (typeof msg.text === 'string') ? msg.text : '';
    const token = extractMemberTokenFromText_(text);

    if (token) {
      const result = (typeof linkTelegramByMemberToken === 'function')
        ? linkTelegramByMemberToken(token, chatId, username)
        : { success: false, message: '서버 함수(linkTelegramByMemberToken)가 없습니다.' };

      if (result && result.success) {
        const memberLabel = (result.name || result.member_id) ? (`\n회원: ${result.name || ''} (${result.member_id || ''})`) : '';
        telegramSendMessage(chatId, '■ MJMAPS 텔레그램 연결 완료' + memberLabel + '\n이제부터 알림/전송을 받을 수 있습니다.');
      } else {
        telegramSendMessage(chatId, '※ 토큰 인증 실패: ' + ((result && result.message) ? result.message : '알 수 없는 오류') + '\n관리자에게 토큰을 다시 요청해 주세요.');
      }
      return;
    }

    // 1.5) "스케줄" 키워드 처리
    if (text.trim() === '스케줄') {
      const member = (typeof getMemberByTelegramChatId === 'function') ? getMemberByTelegramChatId(chatId) : null;
      if (member && member.member_token) {
        const baseUrl = getWebAppBaseUrl_();
        const scheduleUrl = baseUrl + '?view=schedule&t=' + encodeURIComponent(member.member_token);
        const replyMarkup = {
          inline_keyboard: [[
            { text: '🗓️ 내 입찰 일정 보기', web_app: { url: scheduleUrl } }
          ]]
        };
        telegramSendMessage(chatId, 'MJMAPS 회원 전용 입찰 일정입니다.\n아래 버튼을 클릭하여 확인하세요.', replyMarkup);
      } else {
        telegramSendMessage(chatId, '회원 정보가 확인되지 않습니다.\n인증 토큰을 먼저 등록해 주세요.');
      }
      return;
    }

    // 토큰이 아닌 일반 메시지: 안내(스팸 방지 위해 최소 응답)
    if (text && /^\/start/i.test(text)) {
      telegramSendMessage(chatId, '안녕하세요. MJMAPS 봇입니다.\n관리자에게 받은 "인증 토큰"을 이 채팅에 그대로 붙여넣어 보내주세요.\n예) 인증 abcd... 또는 토큰만 전송');
    }
    return;
  }

  // 2) callback_query 처리
  const cq = update.callback_query;
  if (cq && cq.id) {
    // callback_query.id 기준으로 중복 처리 방지(텔레그램 재시도/중복 전송 방어)
    const cqId = String(cq.id).trim();
    if (!markProcessedOnce_('tg_cq_' + cqId, 6 * 60 * 60)) {
      try { telegramAnswerCallbackQuery_(cqId, '이미 처리되었습니다.', false); } catch (e) { }
      return;
    }

    const data = cq.data ? String(cq.data).trim() : '';
    const chatId = cq.message && cq.message.chat && cq.message.chat.id ? String(cq.message.chat.id).trim() : '';
    const from = cq.from || {};
    const username = from.username ? ('@' + String(from.username).trim()) : '';

    if (!data || !chatId) {
      try { telegramAnswerCallbackQuery_(cqId, '요청 정보가 부족합니다.', false); } catch (e) { }
      return;
    }

    const parts = data.split('|');
    if (parts.length < 3 || parts[0] !== 'MJ') {
      try { telegramAnswerCallbackQuery_(cqId, '처리할 수 없는 요청입니다.', false); } catch (e) { }
      return;
    }

    const action = parts[1];
    const itemId = parts[2];
    const arg1 = parts.length >= 4 ? parts[3] : ''; // optional (e.g., originMessageId)

    // === 입찰 확정/취소: 확인 단계(예/아니오) ===
    // - 기존 메시지의 BID/CANCEL도 호환을 위해 CONFIRM 플로우로 처리
    const messageId = cq.message && cq.message.message_id ? Number(cq.message.message_id) : null;

    if (action === 'BID' || action === 'BID_CONFIRM') {
      try { telegramAnswerCallbackQuery_(cqId, '확인', false); } catch (e) { }
      if (!messageId) return;
      const replyMarkup = {
        inline_keyboard: [[
          { text: '예', callback_data: 'MJ|BID_YES|' + String(itemId) + '|' + String(messageId) },
          { text: '아니오', callback_data: 'MJ|BID_NO|' + String(itemId) + '|' + String(messageId) }
        ]]
      };
      // 답글로 달면 원본 메시지 미리보기(긴 내용)가 붙어서 지저분해짐 → 일반 메시지로 표시
      telegramSendMessage(chatId, '입찰확정 하시겠습니까?', replyMarkup);
      return;
    }

    if (action === 'CANCEL' || action === 'CANCEL_CONFIRM') {
      try { telegramAnswerCallbackQuery_(cqId, '확인', false); } catch (e) { }
      if (!messageId) return;
      const replyMarkup = {
        inline_keyboard: [[
          { text: '예', callback_data: 'MJ|CANCEL_YES|' + String(itemId) + '|' + String(messageId) },
          { text: '아니오', callback_data: 'MJ|CANCEL_NO|' + String(itemId) + '|' + String(messageId) }
        ]]
      };
      telegramSendMessage(chatId, '입찰취소 하시겠습니까?', replyMarkup);
      return;
    }

    // === 입찰확정/입찰취소 "예" 처리 (속도 최적화: openById 1회 + 단계별 로깅) ===
    if (action === 'BID_YES' || action === 'CANCEL_YES') {
      const originMessageId = Number(arg1) || null;
      const isBid = (action === 'BID_YES');
      _whLog('BID_YES/CANCEL_YES 시작: item=' + itemId);
      try { telegramAnswerCallbackQuery_(cqId, '요청을 접수했습니다', false); } catch (e) { }
      _whLog('answerCallbackQuery 완료');
      try {
        // ★ 스프레드시트 1번만 열기
        var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        _whLog('openById 완료');

        // 1) items 시트에서 해당 아이템 1건 조회 (TextFinder)
        var shortDate = '', sakunNo = '', memberId = '';
        var itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
        if (itemsSheet) {
          var itemLastRow = itemsSheet.getLastRow();
          if (itemLastRow >= 2) {
            var finder = itemsSheet.getRange(2, 1, itemLastRow - 1, 1)
              .createTextFinder(String(itemId)).matchEntireCell(true);
            var match = finder.findNext();
            if (match) {
              var vals = itemsSheet.getRange(match.getRow(), 1, 1, 9).getValues()[0];
              shortDate = formatShortInDate_(vals[1]);
              sakunNo = String(vals[2] || '').trim();
              memberId = String(vals[8] || '').trim();
            }
          }
        }
        _whLog('items 조회 완료');

        var prefix = (shortDate && sakunNo)
          ? (telegramEscapeHtml_(shortDate) + ' ' + telegramEscapeHtml_(sakunNo) + ' ')
          : '';

        // 2) telegram_requests 시트에 바로 등록
        var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
        if (!reqSheet) {
          reqSheet = ss.insertSheet(TELEGRAM_REQUESTS_SHEET_NAME);
          reqSheet.getRange(1, 1, 1, 11).setValues([['req_id', 'requested_at', 'action', 'status', 'item_id', 'member_id', 'chat_id', 'telegram_username', 'note', 'approved_at', 'approved_by']]);
        }
        var reqAction = isBid ? 'REQUEST_BID' : 'REQUEST_CANCEL';
        var reqId = String(new Date().getTime());
        var requestedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        reqSheet.appendRow([
          reqId, requestedAt, reqAction, 'PENDING',
          String(itemId), memberId, chatId, username,
          JSON.stringify({ origin_message_id: originMessageId || '' }),
          '', ''
        ]);
        _whLog('appendRow 완료');
        // ★ flush로 즉시 반영 (대시보드에서 바로 조회 가능하도록)
        SpreadsheetApp.flush();
        _whLog('flush 완료');

        // 3) 댓글 전송 (HTML 포맷: 사건번호 굵게, 입찰확정 🔵 / 입찰취소 🔴 굵게 + MAPS 버튼)
        var labelHtml = isBid ? '<b>🔵 입찰확정</b>' : '<b>🔴 입찰취소</b>';
        var caseHtml = sakunNo ? ('<b>' + telegramEscapeHtml_(sakunNo) + '</b>') : '';
        var dateStr = shortDate ? (telegramEscapeHtml_(shortDate) + ' ') : '';
        var comment = dateStr + caseHtml + '\n' + labelHtml + ' 요청이 되었습니다.\n잠시만 기다려주세요~';

        // MAPS 바로가기 버튼 (회원 토큰으로 직접 진입)
        var mapsRm = null;
        try {
          var mObj = getMemberByTelegramChatId(chatId);
          var mToken = mObj ? String(mObj.member_token || '').trim() : '';
          var mBase = getWebAppBaseUrl_();
          if (mToken && mBase) {
            mapsRm = { inline_keyboard: [[{ text: '🏠 MAPS 바로가기', web_app: { url: mBase + '?view=member&t=' + encodeURIComponent(mToken) } }]] };
          }
        } catch (me) { _whLog('MAPS 버튼 생성 오류: ' + (me.message || '')); }

        if (originMessageId) {
          telegramSendMessage(chatId, comment, mapsRm, { replyToMessageId: originMessageId });
        } else {
          telegramSendMessage(chatId, comment, mapsRm);
        }
        _whLog('댓글 전송 완료');
      } catch (e) {
        _whLog('오류: ' + (e.message || ''));
        try { telegramSendMessage(chatId, '요청 처리 중 오류: ' + (e.message || '')); } catch (e2) { }
      }
      // 4) 확인 메시지("하시겠습니까?") 삭제
      try { if (messageId) telegramDeleteMessage_(chatId, messageId); } catch (e) { }
      _whLog('BID_YES/CANCEL_YES 종료');
      return;
    }

    if (action === 'BID_NO' || action === 'CANCEL_NO') {
      try { telegramAnswerCallbackQuery_(cqId, '취소했습니다', false); } catch (e) { }
      try { if (messageId) telegramDeleteMessage_(chatId, messageId); } catch (e) { }
      return;
    }

    // === 내물건 보기 ===
    if (action === 'VIEW') {
      const member = (typeof getMemberByTelegramChatId === 'function') ? getMemberByTelegramChatId(chatId) : null;
      if (member && member.member_token) {
        // ScriptApp 호출 방지: WEBAPP_BASE_URL 속성 직접 읽기
        const base = PropertiesService.getScriptProperties().getProperty('WEBAPP_BASE_URL') || '';
        const url = base ? (base + '?view=member&t=' + encodeURIComponent(member.member_token) + '&item=' + encodeURIComponent(itemId)) : '';
        try {
          telegramAnswerCallbackQuery_(cqId, '내물건보기를 실행합니다', false);
          if (url) {
            const rm = { inline_keyboard: [[{ text: '내물건보기', web_app: { url: url } }]] };
            telegramSendMessage(chatId, '내물건보기', rm);
          }
        } catch (e) { }
      } else {
        try { telegramAnswerCallbackQuery_(cqId, '회원 정보를 찾을 수 없습니다', false); } catch (e) { }
      }
      return;
    }

    // === 이미지 보기 ===
    if (action === 'IMAGE') {
      // image_ids 필요하므로 readAllDataWithImageIds 호출 (사용 빈도 낮음)
      const items = (typeof readAllDataWithImageIds === 'function') ? readAllDataWithImageIds() : [];
      const item = items.find(it => String(it.id) === String(itemId));
      const imageIds = (item && item.image_ids) ? String(item.image_ids).trim() : '';
      try {
        if (imageIds) {
          telegramAnswerCallbackQuery_(cqId, '등록된 이미지가 있습니다', false);
          telegramSendMessage(chatId, '등록된 이미지 ID:\n' + imageIds + '\n\n※ 이미지 조회 기능은 추후 구현 예정입니다.');
        } else {
          telegramAnswerCallbackQuery_(cqId, '등록된 이미지가 없습니다', false);
          telegramSendMessage(chatId, '등록된 이미지가 없습니다.');
        }
      } catch (e) { }
      return;
    }

    // 알 수 없는 액션
    try { telegramAnswerCallbackQuery_(cqId, '처리할 수 없는 요청입니다.', false); } catch (e) { }
  }
}

/**
 * 빠른 진단용: 지정 chat_id로 테스트 메시지 전송
 * @param {string|number} chatId
 * @return {Object} {success:boolean, message:string}
 */
function testTelegramSend(chatId) {
  if (!chatId) return { success: false, message: 'chatId가 필요합니다.' };
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  telegramSendMessage(String(chatId).trim(), '✅ 텔레그램 전송 테스트 성공\n' + now);
  return { success: true, message: '테스트 메시지를 전송했습니다.' };
}

function formatKrw_(v) {
  const n = Number(String(v || '0').replace(/[^0-9]/g, '')) || 0;
  return n.toLocaleString('ko-KR');
}

function formatInDate_(yymmdd) {
  const s = String(yymmdd || '').trim();
  if (/^\d{6}$/.test(s)) return '20' + s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
  return s;
}

function formatShortInDate_(yymmddOrIso) {
  const s = String(yymmddOrIso || '').trim();
  // 260211 -> 26-02-11
  if (/^\d{6}$/.test(s)) return s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
  // 2026-02-11 -> 26-02-11
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(2);
  // 20260211 -> 26-02-11
  if (/^\d{8}$/.test(s)) return s.slice(2, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return s;
}

function getBidItemByIdForTelegram_(itemId) {
  // 지연의 주원인: 전체 readAllDataWithImageIds() 금지
  if (typeof getItemLiteById_ === 'function') {
    try { return getItemLiteById_(itemId); } catch (e) { }
  }
  const items = (typeof readAllData === 'function') ? readAllData() : [];
  return (items || []).find(it => String(it.id) === String(itemId)) || null;
}

function normalizeTelegramStyle_(styleKey) {
  const k = String(styleKey || '').trim();
  if (!k) return 'card';
  // 허용 목록만
  // card: 추천물건 안내(기본), bid_price: 입찰가 안내, status: 입찰불가 안내(상태 변경)
  const allowed = { card: true, bid_price: true, status: true, check_request: true };
  return allowed[k] ? k : 'card';
}

function telegramEscapeHtml_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 물건 정보를 텔레그램 "카드" 형태(텍스트 + 버튼 링크)로 전송합니다.
 * @param {Object} item items 시트 row object
 * @param {Object} member 최소 {member_token}
 */
function telegramBuildItemMessage_(item, member, styleKey) {
  const style = normalizeTelegramStyle_(styleKey);
  const base = getWebAppBaseUrl_();
  const url = base
    ? (base + '?view=member&t=' + encodeURIComponent(String(member.member_token || '')) + '&item=' + encodeURIComponent(String(item.id || '')))
    : '';

  const itemId = String(item.id || '').trim();
  const inDate = telegramEscapeHtml_(formatInDate_(item['in-date']));
  const sakunNo = telegramEscapeHtml_(item.sakun_no || '');
  const court = telegramEscapeHtml_(item.court || '');
  const memberName = telegramEscapeHtml_(item.m_name || '');
  const 담당 = telegramEscapeHtml_(item.m_name_id || '');
  const bidPriceFormatted = telegramEscapeHtml_(formatKrw_(item.bidprice)) + '원';

  const warningLine = '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!';
  const staffLines = [
    '업무별 담당자 안내 드립니다.',
    '1. 입찰가 관리: 이정우: (010-4238-7781)',
    '2. 단기투자클럽 관리: 이경미님 (010-3448-8035)',
    '3. PT 관리: 장정아님 (010-9838-8035)'
  ];

  let subtitle = '';
  let statusValuePlain = '';
  let includeBidPrice = false;
  let onlyViewButton = false;

  if (style === 'bid_price') {
    subtitle = 'MJ 경매 스쿨입니다.  입찰가 안내드립니다.\n낙찰을 기원드립니다.';
    statusValuePlain = '입찰';
    includeBidPrice = true;
  } else if (style === 'status') {
    subtitle = 'MJ 경매 스쿨입니다. 입찰불가 안내 드립니다.\n해당 물건은 입찰이 취소 되었습니다.';
    statusValuePlain = '변경';
    includeBidPrice = true;
    onlyViewButton = true;
  } else if (style === 'check_request') {
    // 기존 스타일은 유지하되, 이모지는 제거한 간단 문구로 정리
    subtitle = 'MJ 경매 스쿨입니다. 입찰 여부 회신 요청드립니다.';
    statusValuePlain = '입찰';
    includeBidPrice = true;
  } else {
    // card (기본): 추천물건 안내
    subtitle = 'MJ 경매 스쿨입니다. 추천 물건드립니다.';
    statusValuePlain = '추천';
    includeBidPrice = false;
  }

  const lines = [];
  lines.push('<b>MJMAPS</b>');
  lines.push(subtitle);
  lines.push('');

  // 상태는 "스타일 기본값"보다 실제 아이템 상태가 있으면 그것을 우선 표시
  const actualStatus = String(item.stu_member || '').trim();
  const statusToShow = telegramEscapeHtml_(actualStatus || statusValuePlain);

  lines.push('🔴 물건상태: ' + statusToShow);
  lines.push('📅 입찰일자: ' + inDate);
  lines.push('📄 사건번호: ' + sakunNo);
  lines.push('🏛️ 법원: ' + court);
  lines.push('👤 회원: ' + memberName);
  lines.push('👨‍💼 담당: ' + 담당);

  if (includeBidPrice) {
    lines.push('');
    lines.push('💰 입찰가: ' + bidPriceFormatted);
  }

  lines.push('');
  lines.push(warningLine);
  lines.push(...staffLines);

  // 버튼 구성
  const keyboard = [];
  const row1 = [];
  const row2 = [];

  // 내물건보기: URL 버튼으로 바로 열기(링크 메시지 전송 X)
  // url 버튼은 일부 환경에서 "Open this link?" 팝업이 뜸 → web_app으로 인앱 웹뷰 열기
  if (url) row1.push({ text: '내물건보기', web_app: { url: url } });

  if (!onlyViewButton) {
    row2.push({ text: '입찰확정', callback_data: 'MJ|BID_CONFIRM|' + itemId });
    row2.push({ text: '입찰취소', callback_data: 'MJ|CANCEL_CONFIRM|' + itemId });
  }

  if (row1.length > 0) keyboard.push(row1);
  if (row2.length > 0) keyboard.push(row2);

  const replyMarkup = (keyboard.length > 0) ? { inline_keyboard: keyboard } : null;
  return { text: lines.join('\n'), replyMarkup: replyMarkup };
}

// 하위호환: 기존 이름 유지
function telegramBuildItemCard_(item, member) {
  return telegramBuildItemMessage_(item, member, 'card');
}

/**
 * 관리자용: member_id와 item_id를 받아 해당 회원 텔레그램으로 전송합니다.
 * - 회원 chat_id 미설정이면 실패
 * - member_token이 없으면 자동 생성
 */
function sendItemToMemberTelegram(memberId, itemId) {
  return sendItemToMemberTelegramWithStyle(memberId, itemId, 'card');
}

/**
 * 관리자용: member_id와 item_id를 받아 해당 회원 텔레그램으로 전송합니다. (스타일 지원)
 * [변경] 2026-02: 이름 매칭 제거 (Strict ID), 토큰 자동생성 방지 (Manual Token)
 * @param {string|number} memberId
 * @param {string|number} itemId
 * @param {string} styleKey card | bid_price | status | check_request
 */
function sendItemToMemberTelegramWithStyle(memberId, itemId, styleKey) {
  if (!itemId) return { success: false, message: 'itemId가 필요합니다.' };

  // 1. 물건 조회 (getItemLiteById_로 빠르게)
  const item = (typeof getItemLiteById_ === 'function')
    ? getItemLiteById_(itemId)
    : null;
  if (!item) return { success: false, message: '물건 정보를 찾을 수 없습니다.' };

  // 2. 회원 조회 (단건 조회로 성능 최적화 - readAllMembers 전체 읽기 제거)
  // 인자로 넘어온 memberId가 있으면 그것을, 없으면 물건의 member_id를 사용
  const targetMemberId = String(memberId || item.member_id || '').trim();
  if (!targetMemberId) {
    return { success: false, message: '전송할 회원 ID(member_id)가 확인되지 않습니다.' };
  }

  // ★ getMemberById_ 단건 조회 사용 (기존 readAllMembers 전체 읽기 → 1건만 조회)
  const memberRow = (typeof getMemberById_ === 'function')
    ? getMemberById_(targetMemberId)
    : ((typeof readAllMembers === 'function') ? readAllMembers() : []).find(m => String(m.member_id) === String(targetMemberId));

  if (!memberRow) {
    return { success: false, message: `회원 정보를 찾을 수 없습니다. (ID: ${targetMemberId})` };
  }

  // 3. 토큰 확인 (Manual Token Requirement)
  // 자동 생성(ensureMemberToken) 하지 않고, 없으면 에러 처리
  const memberToken = String(memberRow.member_token || '').trim();
  if (!memberToken) {
    return { success: false, message: '회원 토큰이 발급되지 않았습니다. 관리자 메뉴에서 토큰을 먼저 생성해주세요.' };
  }

  // 4. 텔레그램 정보 확인
  const chatId = String(memberRow.telegram_chat_id || '').trim();
  if (!chatId) {
    return { success: false, message: '회원의 텔레그램 Chat ID가 연동되지 않았습니다.' };
  }

  const enabled = String(memberRow.telegram_enabled || '').toUpperCase();
  if (enabled === 'N') {
    return { success: false, message: '해당 회원은 텔레그램 전송이 비활성화(N) 상태입니다.' };
  }

  // 전송 객체 구성
  const member = {
    member_id: targetMemberId,
    member_token: memberToken,
    telegram_chat_id: chatId,
    telegram_enabled: enabled
  };

  const msg = telegramBuildItemMessage_(item, member, styleKey);
  telegramSendMessage(chatId, msg.text, msg.replyMarkup);
  return { success: true, message: '텔레그램으로 전송했습니다.' };
}

