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
      // MAPS 실제 상태 확인: 추천 상태만 입찰확정 가능
      var bidItemStatus = checkItemStatus_(itemId);
      if (bidItemStatus !== '추천') {
        try { telegramAnswerCallbackQuery_(cqId, '현재 물건상태 변경이 불가능 합니다.', true); } catch (e) { }
        telegramSendMessage(chatId, '⚠️ 현재 물건상태 변경이 불가능 합니다.\n(현재 상태: ' + (bidItemStatus || '확인불가') + ')');
        return;
      }
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
      // MAPS 실제 상태 확인: 추천/입찰 상태만 취소 가능
      var cancelItemStatus = checkItemStatus_(itemId);
      if (cancelItemStatus !== '추천' && cancelItemStatus !== '입찰') {
        try { telegramAnswerCallbackQuery_(cqId, '현재 물건상태 변경이 불가능 합니다.', true); } catch (e) { }
        telegramSendMessage(chatId, '⚠️ 현재 물건상태 변경이 불가능 합니다.\n(현재 상태: ' + (cancelItemStatus || '확인불가') + ')');
        return;
      }
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

        // 2) 자동승인 여부 확인
        var isAutoApprove = (typeof getAutoApproveSetting === 'function') ? getAutoApproveSetting() : false;
        var reqStatus = isAutoApprove ? 'APPROVED' : 'PENDING';
        var requestedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        var approvedAt = isAutoApprove ? requestedAt : '';

        // 3) telegram_requests 시트에 등록
        var reqSheet = (typeof ensureTelegramRequestsSheet_ === 'function')
          ? ensureTelegramRequestsSheet_()
          : ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
        if (!reqSheet) {
          reqSheet = ss.insertSheet(TELEGRAM_REQUESTS_SHEET_NAME);
        }
        // [PHASE 1-5] REQUEST_CANCEL → REQUEST_CANCEL_BID (입찰취소 / 추천취소는 별도)
        var reqAction = isBid ? 'REQUEST_BID' : 'REQUEST_CANCEL_BID';
        var reqId = String(new Date().getTime());
        reqSheet.appendRow([
          reqId, requestedAt, reqAction, reqStatus,
          String(itemId), memberId, chatId, username,
          JSON.stringify({ origin_message_id: originMessageId || '' }),
          approvedAt, isAutoApprove ? 'auto' : '',
          '', '', '',                  // L: from_value, M: to_value, N: field_name
          'member-telegram', ''        // O: trigger_type, P: member_name
        ]);
        _whLog('appendRow 완료 (' + reqStatus + ')');

        // 3.5) 자동승인 시 DB 직접 업데이트
        if (isAutoApprove) {
          try {
            var newStu = isBid ? '입찰' : '미정';
            if (typeof updateItemStuMemberById_ === 'function') {
              var oldStu = (typeof getItemLiteById_ === 'function') ? (getItemLiteById_(itemId).stu_member || '') : '';
              updateItemStuMemberById_(itemId, newStu);
              _whLog('DB 업데이트 완료: ' + newStu);

              // [추가] 상태 변경 FIELD_CHANGE 로그 기록 (역산 렌더링용)
              if (oldStu !== newStu && typeof writeItemHistory_ === 'function') {
                var mObjForLog = (typeof getMemberByTelegramChatId === 'function') ? getMemberByTelegramChatId(chatId) : null;
                writeItemHistory_({
                  action: 'FIELD_CHANGE',
                  item_id: String(itemId),
                  member_id: memberId,
                  member_name: mObjForLog ? (mObjForLog.member_name || mObjForLog.name || '') : (username || ''),
                  field_name: 'stu_member',
                  from_value: oldStu,
                  to_value: newStu,
                  trigger_type: 'system',
                  note: (isBid ? '입찰요청' : '입찰취소') + ' 자동승인',
                  req_id: reqId // 텔레그램 요청 로그와 동일한 req_id로 묶음
                });
              }
            }
          } catch (dbErr) { _whLog('DB 업데이트 실패: ' + dbErr.message); }
        }

        // ★ flush로 즉시 반영
        SpreadsheetApp.flush();
        _whLog('flush 완료');

        // 4) 댓글 전송
        var labelHtml = isBid ? '<b>🔵 입찰확정</b>' : '<b>🔴 입찰취소</b>';
        if (isAutoApprove) labelHtml += ' 완료';
        else labelHtml += ' 요청';

        var caseHtml = sakunNo ? ('<b>' + telegramEscapeHtml_(sakunNo) + '</b>') : '';
        var dateStr = shortDate ? (telegramEscapeHtml_(shortDate) + ' ') : '';

        var comment = dateStr + caseHtml + '\n' + labelHtml + (isAutoApprove ? '되었습니다.' : '이 되었습니다.\n잠시만 기다려주세요~');

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

    // === 입찰가 확인완료 ===
    if (action === 'PRICE_CONFIRM') {
      try { telegramAnswerCallbackQuery_(cqId, '입찰가를 확인합니다.', false); } catch (e) { }
      try {
        // chatId로 회원 조회 → member_token 획득
        var pcMember = (typeof getMemberByTelegramChatId === 'function') ? getMemberByTelegramChatId(chatId) : null;
        if (!pcMember || !pcMember.member_token) {
          telegramSendMessage(chatId, '회원 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
          return;
        }
        // 물건 정보 조회 (가격 포함)
        var pcItem = getBidItemByIdForTelegram_(itemId);
        // bid_state를 확인완료로 업데이트
        var pcResult = (typeof updateBidPriceConfirmed === 'function')
          ? updateBidPriceConfirmed(pcMember.member_token, itemId)
          : { success: false, message: '함수 없음' };
        if (pcResult && pcResult.success) {
          // 가격 공개 메시지 전송
          if (pcItem) {
            var pcShortDate = formatShortInDate_(pcItem['in-date']);
            var pcSakunNo = String(pcItem.sakun_no || '');
            var pcCourt = String(pcItem.court || '');
            var pcBidPrice = formatKrw_(pcItem.bidprice);
            var pcSimpleLine = [pcShortDate, pcSakunNo, pcCourt].filter(Boolean).join(' / ');
            var divider = '=============================';
            var priceRevealMsg = divider + '\n' + pcSimpleLine + '\n' + pcBidPrice + '원 입니다.\n' + divider;
            telegramSendMessage(chatId, priceRevealMsg);
          } else {
            telegramSendMessage(chatId, '✅ 입찰가 확인완료 처리되었습니다.');
          }
        } else {
          telegramSendMessage(chatId, '처리 오류: ' + (pcResult ? pcResult.message : '알 수 없는 오류'));
        }
      } catch (e) {
        try { telegramSendMessage(chatId, '오류: ' + (e.message || '')); } catch (e2) { }
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

/**
 * 아이템의 현재 stu_member 상태를 조회합니다.
 * BID_CONFIRM/CANCEL_CONFIRM 시 MAPS 실제 상태 검증에 사용.
 * @param {string} itemId
 * @returns {string} stu_member 값 ('추천'|'입찰'|'미정'|'상품'|'변경'|'') 또는 '' (조회 실패)
 */
function checkItemStatus_(itemId) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return '';
    var finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(String(itemId)).matchEntireCell(true);
    var match = finder.findNext();
    if (!match) return '';
    return String(sheet.getRange(match.getRow(), 5).getValue() || '').trim(); // E열: stu_member
  } catch (e) {
    Logger.log('[checkItemStatus_] 오류: ' + e.toString());
    return '';
  }
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
  const _rawDamjang = String(item.m_name_id || '').trim();
  const 담당 = telegramEscapeHtml_((typeof getDisplayName_ === 'function') ? getDisplayName_(_rawDamjang) : _rawDamjang);
  const bidPriceFormatted = telegramEscapeHtml_(formatKrw_(item.bidprice)) + '원';

  // [하단 메세지 개별 관리] 각 maps_card 스타일별 독립 하단 키
  const _bottomFallback = '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)';
  const bottomTpl = (typeof getMessageTemplate_ === 'function')
    ? (getMessageTemplate_('item_card.' + (style || 'card') + '.bottom') || _bottomFallback)
    : _bottomFallback;

  let subtitle = '';
  let statusValuePlain = '';
  let includeBidPrice = false;
  let onlyViewButton = false;

  if (style === 'bid_price') {
    // 입찰 상태인 경우에만 입찰가 전송 허용
    if (String(item.stu_member || '').trim() !== '입찰') {
      Logger.log('[telegramBuildItemMessage_] bid_price 전송 차단: 물건상태=' + item.stu_member + ', itemId=' + itemId);
      return null;
    }
    // 간결한 포맷: 입찰일자 / 사건번호 / 법원 + 입찰가확인 버튼 + 내물건보기 버튼
    const shortDate = telegramEscapeHtml_(formatShortInDate_(item['in-date']));
    const simpleLine = [shortDate, sakunNo, court].filter(Boolean).join(' / ');
    const lines2 = [];
    lines2.push(simpleLine);
    const _bidViewMsg = (typeof getMessageTemplate_ === 'function')
      ? (getMessageTemplate_('member.bid_price_view') || '입찰가가 도착했습니다. 확인하시겠습니까?')
      : '입찰가가 도착했습니다. 확인하시겠습니까?';
    lines2.push(telegramEscapeHtml_(_bidViewMsg));
    const keyboard2 = [];
    keyboard2.push([{ text: '입찰가확인', callback_data: 'MJ|PRICE_CONFIRM|' + itemId }]);
    if (url) keyboard2.push([{ text: '내물건보기', web_app: { url: url } }]);
    const replyMarkup2 = keyboard2.length > 0 ? { inline_keyboard: keyboard2 } : null;
    return { text: lines2.join('\n'), replyMarkup: replyMarkup2 };
  } else if (style === 'status') {
    // [PHASE 4-3] 템플릿 적용
    subtitle = (typeof getMessageTemplate_ === 'function')
      ? (getMessageTemplate_('item_card.status') || 'MJ 경매 스쿨입니다. 입찰불가 안내 드립니다.\n해당 물건은 입찰이 취소 되었습니다.')
      : 'MJ 경매 스쿨입니다. 입찰불가 안내 드립니다.\n해당 물건은 입찰이 취소 되었습니다.';
    statusValuePlain = '변경';
    includeBidPrice = true;
    onlyViewButton = true;
  } else if (style === 'check_request') {
    subtitle = (typeof getMessageTemplate_ === 'function')
      ? (getMessageTemplate_('item_card.check_request') || 'MJ 경매 스쿨입니다. 입찰 여부 회신 요청드립니다.')
      : 'MJ 경매 스쿨입니다. 입찰 여부 회신 요청드립니다.';
    statusValuePlain = '입찰';
    includeBidPrice = true;
  } else {
    // card (기본): 추천물건 안내
    subtitle = (typeof getMessageTemplate_ === 'function')
      ? (getMessageTemplate_('item_card.card') || 'MJ 경매 스쿨입니다. 추천 물건드립니다.')
      : 'MJ 경매 스쿨입니다. 추천 물건드립니다.';
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

  // [MSG EDITOR V2] 데이터 필드 표시 설정 (저장된 설정 없으면 기존 동작 완전 유지)
  const _dcKey = 'item_card.' + (style || 'card');
  const _dataCfg = (typeof getDataConfig_ === 'function') ? getDataConfig_(_dcKey) : null;
  const _sf = function(field) { return !_dataCfg || _dataCfg[field] !== false; };

  if (_sf('status'))      lines.push('🔴 물건상태: ' + statusToShow);
  if (_sf('in_date'))     lines.push('📅 입찰일자: ' + inDate);
  if (_sf('sakun_no'))    lines.push('📄 사건번호: ' + sakunNo);
  if (_sf('court'))       lines.push('🏛️ 법원: ' + court);
  if (_sf('member_name')) lines.push('👤 회원: ' + memberName);
  if (_sf('manager'))     lines.push('👨‍💼 담당: ' + 담당);

  if (includeBidPrice && _sf('bid_price')) {
    lines.push('');
    lines.push('💰 입찰가: ' + bidPriceFormatted);
  }

  lines.push('');
  bottomTpl.split('\n').forEach(function(l) { lines.push(telegramEscapeHtml_(l)); });

  // 버튼 구성
  const keyboard = [];
  const row1 = [];
  const row2 = [];

  // [MSG EDITOR V2] 저장된 버튼 설정이 있으면 우선 적용, 없으면 기존 하드코딩 폴백
  const _btnCfgKey = (style === 'bid_price') ? null : ('item_card.' + (style || 'card'));
  const _customBtns = (_btnCfgKey && typeof getMsgBtnConfig_ === 'function') ? getMsgBtnConfig_(_btnCfgKey) : null;

  if (_customBtns && _customBtns.length > 0) {
    // 커스텀 버튼 설정 적용 (enabled:false인 버튼 제외, row 기준 그룹핑)
    const _rowMap = {};
    _customBtns.forEach(function(btn) {
      if (btn.enabled === false) return;
      const r = btn.row || 0;
      if (!_rowMap[r]) _rowMap[r] = [];
      let obj;
      if (btn.action === 'VIEW' && url)        obj = { text: btn.text, web_app: { url: url } };
      else if (btn.action === 'BID_CONFIRM')   obj = { text: btn.text, callback_data: 'MJ|BID_CONFIRM|' + itemId };
      else if (btn.action === 'CANCEL_CONFIRM') obj = { text: btn.text, callback_data: 'MJ|CANCEL_CONFIRM|' + itemId };
      else if (btn.action === 'PRICE_CONFIRM') obj = { text: btn.text, callback_data: 'MJ|PRICE_CONFIRM|' + itemId };
      if (obj) _rowMap[r].push(obj);
    });
    Object.keys(_rowMap).sort(function(a, b) { return Number(a) - Number(b); }).forEach(function(r) {
      if (_rowMap[r].length > 0) keyboard.push(_rowMap[r]);
    });
  } else {
    // 기존 하드코딩 폴백 (기존 동작 완전 유지)
    // 내물건보기: URL 버튼으로 바로 열기(링크 메시지 전송 X)
    // url 버튼은 일부 환경에서 "Open this link?" 팝업이 뜸 → web_app으로 인앱 웹뷰 열기
    if (url) row1.push({ text: '내물건보기', web_app: { url: url } });
    if (!onlyViewButton && style !== 'bid_price') {
      row2.push({ text: '입찰확정', callback_data: 'MJ|BID_CONFIRM|' + itemId });
      row2.push({ text: '입찰취소', callback_data: 'MJ|CANCEL_CONFIRM|' + itemId });
    }
    if (row1.length > 0) keyboard.push(row1);
    if (row2.length > 0) keyboard.push(row2);
  }

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

  // bid_price 스타일: 60초 내 중복 전송 방지 (이중 전송 버그 방어)
  if (styleKey === 'bid_price') {
    try {
      const cache = CacheService.getScriptCache();
      const dedupeKey = 'bps_' + String(itemId).trim() + '_' + String(targetMemberId).trim();
      if (cache.get(dedupeKey)) {
        return { success: true, message: '이미 전송됨 (60초 내 중복 방지)' };
      }
      cache.put(dedupeKey, '1', 60);
    } catch (e) {
      // 캐시 오류는 무시하고 전송 계속
    }
  }

  // 전송 객체 구성
  const member = {
    member_id: targetMemberId,
    member_token: memberToken,
    telegram_chat_id: chatId,
    telegram_enabled: enabled
  };

  const msg = telegramBuildItemMessage_(item, member, styleKey);
  if (!msg) {
    return { success: false, message: '현재 물건 상태에서는 해당 메시지를 전송할 수 없습니다. (물건상태: ' + String(item.stu_member || '') + ')' };
  }
  telegramSendMessage(chatId, msg.text, msg.replyMarkup);

  // 전송 성공 시 상태 업데이트
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
    if (itemsSheet) {
      var itemsLastRow = itemsSheet.getLastRow();
      if (itemsLastRow >= 2) {
        var itemsIdList = itemsSheet.getRange(2, 1, itemsLastRow - 1, 1).getValues().map(v => String(v[0]).trim());
        var idx = itemsIdList.indexOf(String(itemId).trim());
        if (idx !== -1) {
          const rowNum = idx + 2;
          if (styleKey === 'bid_price') {
            itemsSheet.getRange(rowNum, 12).setValue('전달완료'); // L열: bid_state
          } else if (styleKey === 'card') {
            itemsSheet.getRange(rowNum, 17).setValue('전달완료'); // Q열: chuchen_state
            itemsSheet.getRange(rowNum, 18).setValue(new Date().toISOString()); // R열: chuchen_date
          }
          SpreadsheetApp.flush();
        }
      }
    }
  } catch (e) {
    Logger.log('전송 후 상태 업데이트 실패: ' + e.message);
  }

  // [PHASE 1-5] 텔레그램 전송 이력 기록
  try {
    if (typeof writeItemHistory_ === 'function') {
      // 만약 chuchen_state가 변했다면 히스토리에 필드 변경 내용까지 한 줄에 포함
      const histData = {
        action           : 'TELEGRAM_SENT',
        item_id          : String(itemId),
        member_id        : targetMemberId,
        member_name      : String(memberRow.member_name || ''),
        chat_id          : chatId,
        telegram_username: String(memberRow.telegram_username || ''),
        trigger_type     : 'web-telegram',
        note             : styleKey
      };

      if (styleKey === 'card' && String(item.chuchen_state || '').trim() !== '전달완료') {
        histData.field_name = 'chuchen_state';
        histData.from_value = String(item.chuchen_state || '').trim();
        histData.to_value = '전달완료';
      } else if (styleKey === 'bid_price' && String(item.bid_state || '').trim() !== '전달완료') {
        histData.field_name = 'bid_state';
        histData.from_value = String(item.bid_state || '').trim();
        histData.to_value = '전달완료';
      }

      writeItemHistory_(histData);
    }
  } catch (e) {
    Logger.log('[PHASE1-5] TELEGRAM_SENT 기록 오류: ' + e.toString());
  }

  return { success: true, message: '텔레그램으로 전송했습니다.' };
}

/**
 * 다수 물건을 추천 전달로 텔레그램 발송합니다.
 * 텔레그램 전송 실패 회원도 chuchen_state는 '전달완료'로 업데이트합니다.
 * @param {Array} itemIds - 물건 ID 배열
 * @returns {{ sent: number, failed: number, failedItems: Array, updated: number }}
 */
function sendChuchenTelegramBulk(itemIds) {
  if (!itemIds || !itemIds.length) return { sent: 0, failed: 0, failedItems: [], updated: 0 };
  var now = new Date().toISOString();
  var sent = 0, failed = 0;
  var failedItems = [];

  itemIds.forEach(function(itemId) {
    try {
      var result = sendItemToMemberTelegramWithStyle('', itemId, 'card');
      if (result && result.success) {
        sent++;
      } else {
        failed++;
        failedItems.push({ itemId: itemId, reason: result ? result.message : '알 수 없는 오류' });
      }
    } catch (e) {
      failed++;
      failedItems.push({ itemId: itemId, reason: e.message });
    }
  });

  // 성공/실패 무관하게 chuchen_state = '전달완료', chuchen_date = now 업데이트
  var updateResult = (typeof updateChuchenState === 'function')
    ? updateChuchenState(itemIds, '전달완료', now, 'skip_logging') // 개별 발송에서 로그 남겼으므로 여기선 스킵
    : { success: false, updated: 0 };

  return {
    sent: sent,
    failed: failed,
    failedItems: failedItems,
    updated: updateResult.updated
  };
}

