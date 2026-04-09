/**
 * [Config.gs]
 * 프로젝트 전반에서 사용되는 환경 설정 및 상수 정의
 * // GitHub Actions Auto-Deploy Final Test: 2026-02-21 (Base64 Mode)
 * Updated: 2026-02-21
 */

// --- 구글 시트 설정 ---
const SHEET_NAME = 'items'; // 기존 아이템 시트
const MEMBERS_SHEET_NAME = 'members'; // 회원 시트 이름
const STR_CLASS_SHEET_NAME = 'class'; // 수업 시트
const STR_CLASS_D1_SHEET_NAME = 'class_d1'; // 수업 회차 시트
const STR_MEMBER_CLASS_DETAILS_SHEET_NAME = 'member_class_details'; // 회원 수업 상세 시트
const CLASS_SHEET_NAME = 'class'; // 수업 시트 이름
const CLASS_D1_SHEET_NAME = 'class_d1'; // 수업 회차 시트 이름
const MEMBER_CLASS_DETAILS_SHEET_NAME = 'member_class_details'; // 회원 수업 상세 시트 이름

// [수정] items 시트 헤더 (16개 열)
const HEADERS = [
  'id',
  'in-date',
  'sakun_no',
  'court',
  'stu_member',
  'm_name_id',
  'm_name',
  'bidprice',
  'member_id',
  'reg_date',
  'reg_member',
  'bid_state',
  'image_id',
  'note',
  'm_name2',
  'auction_id'
];

// --- 회원(members) 시트 헤더 ---
// --- 회원(members) 시트 헤더 ---
const MEMBER_HEADERS = [
  'member_id',
  'class_id',
  'gubun',
  'member_name',
  'name1_gubun', 'name1',
  'name2_gubun', 'name2',
  'name3_gubun', 'name3',
  'phone',
  'login_id',
  'password',
  'account_bank',
  'account_no',
  'account_name',
  'address',
  'note1',
  'note2',
  'member_token',
  'telegram_chat_id',
  'telegram_username',
  'telegram_enabled',
  'kaib_date',
  'reg_date',
  'reg_id'
];

// --- 수업(class) 시트 헤더 ---
const CLASS_HEADERS = [
  'class_id',           // 수업 ID (PK)
  'class_type',         // 수업 구분 (CLASS, PT, 프리미엄PT 등)
  'class_name',         // 수업 이름
  'class_grade',        // 수업 등급 (일반, 플레티넘, 블랙, 실버 등)
  'class_loc',          // 지역 (부산, 서울, 온라인 등)
  'class_week',         // 수업 요일
  'class_time_from',    // 시작 시간
  'class_time_to',      // 종료 시간
  'class_loop',         // 전체 회차
  'class_loop_min',     // 최소 회차
  'class_price',        // 가격
  'guaranteed_type',    // 보장 형식
  'guaranteed_details', // 보장 상세
  'remark',             // 비고
  'reg_date',           // 등록일
  'reg_id'              // 등록자
];

// --- 전역 설정 관리 (PropertiesService) ---
function getAutoApproveSetting() {
  try {
    const p = PropertiesService.getScriptProperties();
    const val = p.getProperty('MJAPS_AUTO_APPROVE');
    // 설정이 없거나 'true'가 아니면 false (보수적 접근)
    return val === 'true';
  } catch (e) {
    Logger.log('[getAutoApproveSetting] 오류: ' + e.message);
    return false;
  }
}

function setAutoApproveSetting(isOn) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('MJAPS_AUTO_APPROVE', isOn ? 'true' : 'false');
  return { success: true, autoApprove: isOn };
}

// --- 수업 회차(class_d1) 시트 헤더 ---
const CLASS_D1_HEADERS = [
  'class_d1_id',      // 회차 ID (PK, 예: 5001_20260128121033_1)
  'class_id',         // 수업 ID (FK)
  'class_type',       // 수업 구분
  'class_name',       // 수업 이름
  'class_grade',      // 수업 등급
  'class_loc',        // 지역
  'class_date',       // 수업 일자 (YYYYMMDD)
  'class_week',       // 요일
  'class_time_from',  // 시작 시간
  'class_time_to',    // 종료 시간
  'class_loop',       // 회차 번호 (1, 2, 3...)
  'completed',        // 완료 여부 (Y/N)
  'reg_date',         // 등록일
  'reg_id',           // 등록자
  'bid_datetime_1',   // 1차 입찰 마감 일시 (O열)
  'bid_datetime_2',   // 2차 입찰 마감 일시 (P열)
  'bid_starttime',    // 물건선택 시작시간 (Q열)
  '1cha_bid',         // 1차 선택 가능 개수 (R열)
  '2cha_bid'          // 2차 선택 가능 개수 (S열)
];

// --- 회원 수업 상세(member_class_details) 시트 헤더 ---
const MEMBER_CLASS_DETAILS_HEADERS = [
  'detail_id',        // 상세 ID (PK)
  'class_id',         // 수업 ID (FK)
  'member_id',        // 회원 ID (FK)
  'member_status',    // 회원 상태 (하드코딩 및 사용자 정의)
  'reg_date',         // 등록일
  'reg_id',           // 등록자
  'no_1', 'no_2', 'no_3', 'no_4', 'no_5', 'no_6', 'no_7', 'no_8', 'no_9', 'no_10',
  'no_11', 'no_12', 'no_13', 'no_14', 'no_15', 'no_16', 'no_17', 'no_18', 'no_19', 'no_20'
];

// --- 구분(gubun) 드롭다운 옵션 ---
const GUBUN_OPTIONS = ['회원', '직원', '관리자', '조사자'];

// --- 조사물건(search) 시트 이름 ---
const SEARCH_SHEET_NAME = 'search';

// --- 명의 구분 드롭다운 옵션 ---
const NAME_GUBUN_OPTIONS = ['개인', '법인'];



/**
 * 스프레드시트가 열릴 때 실행되는 트리거
 * - 관리자 메뉴 추가
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Admin') // 메뉴 이름
    .addItem('🔑 관리자 KEY 확인', 'getAdminKey') // 관리자 KEY 확인
    .addItem('🔄 관리자 KEY 재생성', 'regenerateAdminKey') // KEY 재발급
    .addSeparator()
    .addItem('Manual Backup (Drive)', 'manualBackupFromMenu') // 수동 백업
    .addSeparator()
    .addItem('Setup Daily Backup (9am)', 'setupBackupTrigger') // 자동 백업 설정
    .addSeparator()
    .addItem('Initialize All Sheets (Schema Update)', 'initAllSheetsWrapper') // 스키마 초기화
    .addSeparator()
    .addItem('Debug Member Status', 'showDebugDialog') // 디버그 메뉴 추가
    .addSeparator()
    .addItem('🛠️ 물건 member_id 동기화', 'runSyncItemMemberIdsByName') // 마이그레이션 메뉴 추가
    .addSeparator()
    .addItem('📊 텔레그램 성능 진단', 'debugTelegramPerformance') // 텔레그램 성능 진단
    .addItem('🔄 텔레그램 웹훅 초기화', 'resetTelegramWebhookClean') // 웹훅 초기화
    .addItem('☁️ CF 프록시 진단', 'debugCloudflareProxy') // Cloudflare 프록시 진단
    .addItem('☁️ CF 프록시 웹훅 설정', 'setTelegramWebhookViaProxy') // 프록시 웹훅 설정
    .addToUi();
}

function initAllSheetsWrapper() {
  // SheetDB.gs의 initAllSheets 호출
  if (typeof initAllSheets === 'function') {
    const res = initAllSheets();
    SpreadsheetApp.getUi().alert(res);
  } else {
    SpreadsheetApp.getUi().alert('initAllSheets function not found.');
  }
}

/**
 * [Migration] 물건 member_id 동기화 실행 (메뉴용)
 */
function runSyncItemMemberIdsByName() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    '물건 member_id 동기화',
    '물건의 member_id가 비어있는 경우, 이름(m_name)으로 회원을 찾아 member_id를 채웁니다.\n\n이 작업은 되돌릴 수 없습니다. 진행하시겠습니까?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    if (typeof syncItemMemberIdsByName === 'function') {
      const res = syncItemMemberIdsByName();
      if (res.success) {
        ui.alert('완료', res.message, ui.ButtonSet.OK);
      } else {
        ui.alert('실패', res.message, ui.ButtonSet.OK);
      }
    } else {
      ui.alert('오류', 'syncItemMemberIdsByName 함수를 찾을 수 없습니다.', ui.ButtonSet.OK);
    }
  }
}

// ================================================================================================
// 🔐 관리자 인증 KEY 관리 (URL Query Parameter Authentication)
// ================================================================================================

/**
 * 관리자 비밀 KEY를 생성합니다 (32자 랜덤 문자열)
 */
function generateAdminSecretKey_() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

/**
 * 관리자 KEY를 가져옵니다 (없으면 자동 생성)
 * @return {string}
 */
function getAdminSecretKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('ADMIN_SECRET_KEY');

  if (!key) {
    // 처음 실행 시 자동 생성
    key = generateAdminSecretKey_();
    props.setProperty('ADMIN_SECRET_KEY', key);
    Logger.log('[초기 생성] 관리자 KEY: ' + key);
  }

  return key;
}

/**
 * 🔑 관리자 KEY 확인 (Apps Script 에디터에서 실행)
 * - 실행 → getAdminKey 선택 → 실행
 * - 로그에서 KEY 확인
 */
function getAdminKey() {
  const key = getAdminSecretKey_();
  // ScriptApp 호출하지 말고 WEBAPP_BASE_URL 속성만 직접 사용
  const deploymentUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_BASE_URL') || '';

  Logger.log('='.repeat(80));
  Logger.log('🔐 관리자 인증 정보');
  Logger.log('='.repeat(80));
  Logger.log('관리자 KEY: ' + key);
  Logger.log('');
  if (deploymentUrl) {
    Logger.log('✅ 관리자 접속 URL:');
    Logger.log(deploymentUrl + '?admin=' + key);
  } else {
    Logger.log('⚠️ WEBAPP_BASE_URL 속성이 설정되지 않았습니다!');
  }
  Logger.log('');
  Logger.log('⚠️ 이 KEY는 절대 외부에 공유하지 마세요!');
  Logger.log('⚠️ 북마크에 저장하거나 비밀 메모에 보관하세요!');
  Logger.log('='.repeat(80));

  // UI 다이얼로그로도 표시 (스프레드시트에서 실행 시)
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      '🔐 관리자 KEY',
      'KEY: ' + key + '\n\n관리자 URL:\n' + deploymentUrl + '?admin=' + key + '\n\n⚠️ 이 KEY는 외부에 공유하지 마세요!',
      ui.ButtonSet.OK
    );
  } catch (e) {
    // Apps Script 에디터에서 실행 시 SpreadsheetApp 사용 불가
  }

  return key;
}

/**
 * 🔄 관리자 KEY 재생성 (Apps Script 에디터에서 실행)
 * - 기존 KEY 무효화
 * - 새 KEY 생성
 */
function regenerateAdminKey() {
  const oldKey = getAdminSecretKey_();
  const newKey = generateAdminSecretKey_();

  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_SECRET_KEY', newKey);

  const deploymentUrl = ScriptApp.getService().getUrl();

  Logger.log('='.repeat(80));
  Logger.log('🔄 관리자 KEY 재생성');
  Logger.log('='.repeat(80));
  Logger.log('기존 KEY (무효화됨): ' + oldKey);
  Logger.log('새 KEY: ' + newKey);
  Logger.log('');
  Logger.log('✅ 새 관리자 접속 URL:');
  Logger.log(deploymentUrl + '?admin=' + newKey);
  Logger.log('');
  Logger.log('⚠️ 기존 URL은 더 이상 작동하지 않습니다!');
  Logger.log('⚠️ 북마크를 업데이트하세요!');
  Logger.log('='.repeat(80));

  // UI 다이얼로그로도 표시
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      '🔄 관리자 KEY 재생성',
      '새 KEY: ' + newKey + '\n\n새 관리자 URL:\n' + deploymentUrl + '?admin=' + newKey + '\n\n⚠️ 기존 URL은 무효화되었습니다!\n⚠️ 북마크를 업데이트하세요!',
      ui.ButtonSet.OK
    );
  } catch (e) { }

  return newKey;
}

/**
 * 옥션 URL 패턴 설정 조회
 */
function getAuctionSettings() {
  const props = PropertiesService.getScriptProperties();
  return {
    auction_pattern: props.getProperty('AUCTION_URL_PATTERN') || 'https://www.auction1.co.kr/auction/ca_view.php?product_id=[ID]',
    gongmae_pattern: props.getProperty('GONGMAE_URL_PATTERN') || 'https://www.auction1.co.kr/pubauct/view.php?product_id=[ID]'
  };
}

/**
 * 옥션 URL 패턴 설정 저장
 */
function saveAuctionSettings(settings) {
  if (!settings) return { success: false, message: '설정값이 없습니다.' };

  const props = PropertiesService.getScriptProperties();
  if (settings.auction_pattern) props.setProperty('AUCTION_URL_PATTERN', settings.auction_pattern.trim());
  if (settings.gongmae_pattern) props.setProperty('GONGMAE_URL_PATTERN', settings.gongmae_pattern.trim());

  return { success: true, message: '옥션 URL 설정이 저장되었습니다.' };
}

/**
 * 대시보드 카드 버튼에서 입찰확정/입찰취소 요청 처리
 * - 텔레그램 봇 버튼과 동일한 흐름: telegram_requests 등록 + 텔레그램 댓글 전송
 * @param {string} memberToken  회원 토큰 (APP_CTX.token)
 * @param {string} itemId       물건 ID
 * @param {string} action       'bid' (입찰확정) | 'cancel' (입찰취소)
 * @return {Object} {success, message}
 */
function processMemberDashboardAction(memberToken, itemId, action) {
  var t = String(memberToken || '').trim();
  var item = String(itemId || '').trim();
  var act = String(action || '').trim();

  if (!t) return { success: false, message: '회원 토큰이 없습니다.' };
  if (!item) return { success: false, message: '물건 ID가 없습니다.' };
  if (act !== 'bid' && act !== 'cancel') return { success: false, message: '잘못된 action입니다.' };

  // 1) 토큰으로 회원 조회
  var member = getMemberByToken(t);
  if (!member) return { success: false, message: '회원 정보를 찾을 수 없습니다.' };


  var chatId = String(member.telegram_chat_id || '').trim();
  // chatId가 없어도 수동 신청 가능 (텔레그램 알림만 생략됨)


  var reqAction = (act === 'bid') ? 'REQUEST_BID' : 'REQUEST_CANCEL';

  // 2) 자동승인 여부 확인
  const isAuto = getAutoApproveSetting();

  if (isAuto) {
    // 자동승인 모드: 즉시 DB 업데이트 + 승인완료로 로그 기록
    const newStatus = (act === 'bid') ? '입찰' : '미정';
    try {
      const oldStuAuto = (typeof checkItemStatus_ === 'function') ? checkItemStatus_(item) : '';
      updateItemStuMemberById_(item, newStatus);
      // 로그 기록 (APPROVED 상태)
      createTelegramRequestByToken_(reqAction, item, member.member_id, 'dashboard (auto-approved)', 'APPROVED');

      // [추가] 상태 변경 FIELD_CHANGE 로그 기록
      if (oldStuAuto !== newStatus) {
        writeItemHistory_({
          action: 'FIELD_CHANGE',
          item_id: item,
          member_id: member.member_id,
          member_name: member.member_name || '',
          field_name: 'stu_member',
          from_value: oldStuAuto,
          to_value: newStatus,
          trigger_type: 'web',
          note: 'dashboard auto-approved'
        });
      }
      // 텔레그램 알림 (있을 경우)
      if (chatId) {
        const itemData = getItemLiteById_(item);
        const shortDate = itemData ? formatShortInDate_(itemData['in-date']) : '';
        const sakunNo = itemData ? String(itemData.sakun_no || '').trim() : '';
        const msg = (shortDate ? shortDate + ' ' : '') + (sakunNo ? '<b>' + sakunNo + '</b>\n' : '') +
          (act === 'bid' ? '<b>🔵 입찰확정</b>' : '<b>🔴 입찰취소</b>') + ' 처리되었습니다.';
        telegramSendMessage(chatId, msg);
      }
      return { success: true, message: '자동 승인 처리되었습니다.', autoApproved: true, newStatus: newStatus };
    } catch (e) {
      return { success: false, message: '자동 승인 처리 중 오류: ' + (e.message || '') };
    }
  }

  // 3) 수동신청 모드: telegram_requests 등록
  var reqResult;
  if (chatId) {
    reqResult = createTelegramRequest(reqAction, item, chatId, '', 'dashboard');
  } else {
    reqResult = createTelegramRequestByToken_(reqAction, item, member.member_id, 'dashboard');
  }
  if (!reqResult.success && !reqResult.already) {
    return { success: false, message: reqResult.message || '요청 등록에 실패했습니다.' };
  }

  // 4) 텔레그램 댓글 전송 (chatId 있을 때만)
  if (chatId) {
    try {
      var itemData = getItemLiteById_(item);
      var shortDate = itemData ? formatShortInDate_(itemData['in-date']) : '';
      var sakunNo = itemData ? String(itemData.sakun_no || '').trim() : '';
      var isBid = (act === 'bid');

      var labelHtml = isBid ? '<b>🔵 입찰확정</b>' : '<b>🔴 입찰취소</b>';
      var caseHtml = sakunNo ? ('<b>' + sakunNo + '</b>') : '';
      var datePrefix = shortDate ? (shortDate + ' ') : '';
      var comment = datePrefix + caseHtml + '\n' + labelHtml + ' 요청이 되었습니다.\n잠시만 기다려주세요~';

      var baseUrl = getWebAppBaseUrl_();
      var mapsUrl = baseUrl ? (baseUrl + '?view=member&t=' + encodeURIComponent(t)) : '';
      var replyMarkup = mapsUrl
        ? { inline_keyboard: [[{ text: '🏠 MAPS 바로가기', web_app: { url: mapsUrl } }]] }
        : null;

      telegramSendMessage(chatId, comment, replyMarkup);
    } catch (e) {
      Logger.log('[processMemberDashboardAction] 텔레그램 전송 오류: ' + (e.message || ''));
    }
  }

  return { success: true, message: reqResult.already ? '이미 동일한 요청이 접수되어 있습니다.' : '요청이 접수되었습니다.', autoApproved: false };
}

/**
 * chatId 없이 memberId로 직접 telegram_requests 시트에 행 등록 (상태 지정 가능)
 */
function createTelegramRequestByToken_(action, itemId, memberId, note, status) {
  try {
    var sheet = ensureTelegramRequestsSheet_();
    var a = String(action || '').trim();
    var item = String(itemId || '').trim();
    var mid = String(memberId || '').trim();
    var s = String(status || 'PENDING').trim();
    if (!a || !item || !mid) return { success: false, message: '요청 정보가 부족합니다.' };

    var reqId = String(new Date().getTime());
    var requestedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var approvedAt = (s === 'APPROVED') ? requestedAt : '';

    sheet.appendRow([reqId, requestedAt, a, s, item, mid, '', '', String(note || ''), approvedAt, 'auto']);
    return { success: true, message: '기록되었습니다.', req_id: reqId, member_id: mid, item_id: item };
  } catch (e) {
    return { success: false, message: e.message || '등록 중 오류가 발생했습니다.' };
  }
}


/**
 * [자동승인 전용] 대시보드 카드에서 입찰확정/취소를 관리자 승인 없이 즉시 DB에 반영합니다.
 * - 'bid'  → stu_member = '입찰' 직접 저장
 * - 'cancel' → stu_member = '미정' 직접 저장
 * - 처리 완료 후 회원 텔레그램으로 확정 메시지 전송
 * @param {string} memberToken  회원 토큰
 * @param {string} itemId       물건 ID
 * @param {string} action       'bid' | 'cancel'
 * @return {Object} {success, message, newStatus}
 */
function processMemberDashboardActionDirect(memberToken, itemId, action) {
  var t = String(memberToken || '').trim();
  var item = String(itemId || '').trim();
  var act = String(action || '').trim();

  if (!t) return { success: false, message: '회원 토큰이 없습니다.' };
  if (!item) return { success: false, message: '물건 ID가 없습니다.' };
  if (act !== 'bid' && act !== 'cancel') return { success: false, message: '잘못된 action입니다.' };

  // 1) 토큰으로 회원 조회
  var member = getMemberByToken(t);
  if (!member) return { success: false, message: '회원 정보를 찾을 수 없습니다.' };

  var chatId = String(member.telegram_chat_id || '').trim();

  // 2) 물건 조회 + 소유권 확인
  var itemData = getItemLiteById_(item);
  if (!itemData) return { success: false, message: '물건 정보를 찾을 수 없습니다.' };
  if (String(itemData.member_id || '').trim() !== String(member.member_id)) {
    return { success: false, message: '본인 물건이 아닙니다.' };
  }

  // 3) DB 직접 업데이트
  var newStatus = (act === 'bid') ? '입찰' : '미정';
  try {
    const oldStuDirect = (typeof checkItemStatus_ === 'function') ? checkItemStatus_(item) : '';
    updateItemStuMemberById_(item, newStatus);

    // [추가] 상태 변경 FIELD_CHANGE 로그 기록
    if (oldStuDirect !== newStatus) {
      writeItemHistory_({
        action: 'FIELD_CHANGE',
        item_id: item,
        member_id: member.member_id,
        member_name: member.member_name || '',
        field_name: 'stu_member',
        from_value: oldStuDirect,
        to_value: newStatus,
        trigger_type: 'web',
        note: 'dashboard direct sync'
      });
    }
  } catch (e) {
    return { success: false, message: 'DB 업데이트 실패: ' + (e.message || '') };
  }

  // 4) 텔레그램으로 처리 완료 메시지 전송
  try {
    var shortDate = formatShortInDate_(itemData['in-date']);
    var sakunNo = String(itemData.sakun_no || '').trim();
    var prefix = (shortDate ? shortDate + ' ' : '') + (sakunNo ? '<b>' + sakunNo + '</b>\n' : '');
    var msgHtml = (act === 'bid')
      ? prefix + '<b>🔵 입찰확정</b> 완료되었습니다!'
      : prefix + '<b>🔴 입찰취소</b> 처리되었습니다.';

    var baseUrl = getWebAppBaseUrl_();
    var mapsUrl = baseUrl ? (baseUrl + '?view=member&t=' + encodeURIComponent(t)) : '';
    var replyMarkup = mapsUrl
      ? { inline_keyboard: [[{ text: '🏠 MAPS 바로가기', web_app: { url: mapsUrl } }]] }
      : null;

    if (chatId) telegramSendMessage(chatId, msgHtml, replyMarkup);
  } catch (e) {
    Logger.log('[processMemberDashboardActionDirect] 텔레그램 전송 오류: ' + (e.message || ''));
  }

  return { success: true, message: (act === 'bid') ? '입찰확정 완료' : '입찰취소 완료', newStatus: newStatus };
}

// ── 추천 전달 프로세스 API 래퍼 ──────────────────────────────────────
function sendChuchenTelegramBulkApi(itemIds) {
  return sendChuchenTelegramBulk(itemIds);
}
function updateChuchenStateApi(itemIds, state, dateStr) {
  return updateChuchenState(itemIds, state, dateStr, 'web-telegram');
}
function updateBidStateApi(itemIds, state) {
  return updateBidState(itemIds, state);
}

/**
 * [범용] 물건의 특정 필드를 업데이트합니다.
 * @param {Array} ids - 물건 ID 배열
 * @param {string} field - 필드명 (ITEM_HEADERS 기준)
 * @param {any} value - 변경할 값
 */
function updateDataApi(ids, field, value) {
  return updateDataField(ids, field, value);
}

/**
 * [범용] 여러 물건의 특정 필드를 서로 다른 값으로 일괄 업데이트합니다.
 * @param {Array} updates - {id, value} 객체 배열
 * @param {string} field - 필드명
 */
function updateDataFieldBulkApi(updates, field) {
  return updateDataFieldBulk(updates, field);
}

/**
 * 구글 캘린더 이벤트 조회 - iCal 공개URL 방식 (OAuth 불필요)
 * @param {number} startMs - 시작 타임스탬프 (ms)
 * @param {number} endMs - 종료 타임스탬프 (ms)
 */
function getCalendarEvents(startMs, endMs) {
  var ICAL_URL = 'https://calendar.google.com/calendar/ical/n15dboh1fqef9lrnbr9cn1t6k8%40group.calendar.google.com/private-c4866c71aac66cdb881f757ecc9fb4e4/basic.ics';
  try {
    var resp = UrlFetchApp.fetch(ICAL_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      return { success: false, error: 'iCal 로드 실패 (' + resp.getResponseCode() + ')' };
    }
    var icsText = resp.getContentText('UTF-8');
    var events = parseIcal_(icsText, startMs, endMs);
    return { success: true, events: events };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** iCal 텍스트 파싱 → 이벤트 배열 반환 */
function parseIcal_(icsText, startMs, endMs) {
  var results = [];
  // 줄 이어쓰기(CRLF + 공백) 처리
  var text = icsText.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');
  var lines = text.split('\n');

  var inEvent = false;
  var ev = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === 'BEGIN:VEVENT') { inEvent = true; ev = {}; continue; }
    if (line === 'END:VEVENT') {
      inEvent = false;
      if (ev.start !== undefined && ev.end !== undefined) {
        if (ev.end >= startMs && ev.start <= endMs) {
          results.push(ev);
        }
      }
      continue;
    }
    if (!inEvent) continue;

    var sep = line.indexOf(':');
    if (sep < 0) continue;
    var key = line.substring(0, sep).toUpperCase();
    var val = line.substring(sep + 1);

    if (key === 'SUMMARY') {
      ev.title = val.replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';');
    } else if (key.indexOf('DTSTART') === 0) {
      var parsed = parseIcalDate_(key, val);
      ev.start = parsed.ms;
      ev.allDay = parsed.allDay;
    } else if (key.indexOf('DTEND') === 0) {
      ev.end = parseIcalDate_(key, val).ms;
    } else if (key === 'COLOR' || key === 'X-APPLE-CALENDAR-COLOR') {
      ev.color = val;
    }
  }
  return results;
}

/** iCal 날짜 문자열 → { ms, allDay } */
function parseIcalDate_(key, val) {
  // 종일 이벤트: VALUE=DATE 또는 8자리 숫자
  if (key.indexOf('VALUE=DATE') >= 0 || /^\d{8}$/.test(val)) {
    var y = parseInt(val.substr(0,4)), m = parseInt(val.substr(4,2))-1, d = parseInt(val.substr(6,2));
    return { ms: new Date(y, m, d).getTime(), allDay: true };
  }
  // 일반 날짜시간
  val = val.replace('Z','');
  var y = parseInt(val.substr(0,4)), mo = parseInt(val.substr(4,2))-1, d = parseInt(val.substr(6,2));
  var h = parseInt(val.substr(9,2)||'0'), mi = parseInt(val.substr(11,2)||'0'), s = parseInt(val.substr(13,2)||'0');
  var ms;
  if (val.slice(-1) === 'Z' || key.indexOf('TZID') < 0) {
    // UTC
    ms = Date.UTC(y, mo, d, h, mi, s);
  } else {
    ms = new Date(y, mo, d, h, mi, s).getTime();
  }
  return { ms: ms, allDay: false };
}

/** full.ics 색상 데이터 포함 여부 테스트 - 가장 최근 이벤트 기준 */
function testFullIcalColor() {
  var url = 'https://calendar.google.com/calendar/ical/n15dboh1fqef9lrnbr9cn1t6k8%40group.calendar.google.com/private-c4866c71aac66cdb881f757ecc9fb4e4/full.ics';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var text = resp.getContentText('UTF-8').replace(/\r\n[ \t]/g, '').replace(/\r/g, '');
  // 모든 VEVENT 블록 추출 후 가장 최근 DTSTART 기준 정렬
  var blocks = [];
  var pos = 0;
  while (true) {
    var s = text.indexOf('BEGIN:VEVENT', pos);
    if (s < 0) break;
    var e = text.indexOf('END:VEVENT', s);
    if (e < 0) break;
    blocks.push(text.substring(s, e + 12));
    pos = e + 12;
  }
  // DTSTART 기준 최신순 정렬
  blocks.sort(function(a, b) {
    var da = (a.match(/\nDTSTART[^:]*:(\d+)/) || ['','0'])[1];
    var db = (b.match(/\nDTSTART[^:]*:(\d+)/) || ['','0'])[1];
    return db.localeCompare(da);
  });
  Logger.log('전체 이벤트 수: ' + blocks.length);
  Logger.log('COLOR 있음: ' + (text.indexOf('\nCOLOR:') >= 0));
  Logger.log('CATEGORIES 있음: ' + (text.indexOf('CATEGORIES') >= 0));
  // 최근 3개 이벤트 출력
  for (var i = 0; i < Math.min(3, blocks.length); i++) {
    Logger.log('=== 최근 이벤트 ' + (i+1) + ' ===\n' + blocks[i]);
  }
}
