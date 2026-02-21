/**
 * [Config.gs]
 * 프로젝트 전반에서 사용되는 환경 설정 및 상수 정의
 * Updated: 2026-02-20
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
  'reg_id'            // 등록자
];

// --- 회원 수업 상세(member_class_details) 시트 헤더 ---
const MEMBER_CLASS_DETAILS_HEADERS = [
  'detail_id',        // 상세 ID (PK)
  'class_d1_id',      // 회차 ID (FK)
  'member_id',        // 회원 ID (FK)
  'attended',         // 출석 여부 (Y/N)
  'attended_date',    // 출석일
  'reg_date',         // 등록일
  'reg_id'            // 등록자
];

// --- 구분(gubun) 드롭다운 옵션 ---
const GUBUN_OPTIONS = ['회원', '직원', '관리자'];

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