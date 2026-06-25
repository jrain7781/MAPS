/**
 * [TriggerSettings.gs]
 * 환경설정 ▸ 트리거 탭 백엔드.
 * 시간 기반 트리거의 실행 시각을 settings 시트에 저장하고, 저장값으로 (재)설치한다.
 *
 * ⚠ GAS 한계: 이미 설치된 트리거의 "설정 시각"은 API로 읽을 수 없다.
 *   따라서 화면 표시 시각 = settings 에 저장된 값(= 다음 재설치 시 적용될 값).
 *   기본값을 기존 하드코딩 시각과 일치시켜, 최초 표시 = 실제 상태가 되도록 했다.
 */

// 관리 대상 트리거 레지스트리 (단일 소스)
var TRG_REGISTRY_ = [
  { fn: 'dmCleanupExpired',      label: '다물건 PDF 자동삭제',  desc: '입찰 다음날, 만료된 입찰안내 첨부 PDF를 휴지통으로 정리', freq: 'daily',  key: 'trg_hour_dm_cleanup',     def: 4 },
  { fn: 'accrueBidsDaily',       label: '입찰 일별 적립(돈클)', desc: '회원별 입찰 건수를 매일 1회 적립',                        freq: 'daily',  key: 'donkle_bid_accrual_hour', def: 4 },
  { fn: 'sendBidDateReminders',  label: '입찰일 알림(D-3/2/1)', desc: '입찰일이 임박한 회원에게 텔레그램 알림 발송',             freq: 'daily',  key: 'BID_NOTIFY_HOUR',         def: 10 },
  { fn: 'backupDataToDrive',     label: '데이터 자동 백업',     desc: 'items/members 등을 드라이브 MAPS_BACKUP 폴더에 백업',     freq: 'daily',  key: 'trg_hour_backup',         def: 9 },
  { fn: 'autoSyncImagesWrapper', label: '이미지 자동 동기화',   desc: '드라이브 업로드 이미지를 자동 매칭·등록(정시 30분 부근)', freq: 'daily',  key: 'trg_hour_image_sync',     def: 9, nearMinute: 30 },
  { fn: 'autoExpireRecommended', label: '추천 자동 만료',       desc: '기한이 지난 추천 건을 매시간 자동 만료',                  freq: 'hourly' }
];

function trgFindReg_(fn) {
  for (var i = 0; i < TRG_REGISTRY_.length; i++) if (TRG_REGISTRY_[i].fn === fn) return TRG_REGISTRY_[i];
  return null;
}

/** 레지스트리 기준 트리거 실행 시각(0~23). settings 값 우선, 없으면 기본값. (daily 전용) */
function trgHour_(fn) {
  var reg = trgFindReg_(fn);
  if (!reg || reg.freq !== 'daily') return null;
  var h = parseInt(getSetting_(reg.key, String(reg.def)), 10);
  if (isNaN(h) || h < 0 || h > 23) h = reg.def;
  return h;
}

/** 현재 설치된 핸들러 함수명 → true 맵 */
function trgInstalledSet_() {
  var set = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { set[t.getHandlerFunction()] = true; });
  return set;
}

/** 동명 핸들러 트리거 모두 제거. 제거 개수 반환. */
function trgDelete_(fn) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

/** 레지스트리 + 시각으로 트리거 생성 */
function trgCreate_(reg, hour) {
  var b = ScriptApp.newTrigger(reg.fn).timeBased();
  if (reg.freq === 'hourly') {
    b.everyHours(1);
  } else {
    b.everyDays(1).atHour(hour);
    if (reg.nearMinute != null) b.nearMinute(reg.nearMinute);
  }
  b.create();
}

/** [공개] 트리거 설정 + 설치상태 조회 → UI 렌더용 */
function getTriggerConfig() {
  var installed = trgInstalledSet_();
  return TRG_REGISTRY_.map(function (reg) {
    return {
      fn: reg.fn,
      label: reg.label,
      desc: reg.desc,
      freq: reg.freq,                                       // 'daily' | 'hourly'
      hour: reg.freq === 'daily' ? trgHour_(reg.fn) : null,
      nearMinute: reg.nearMinute != null ? reg.nearMinute : null,
      installed: !!installed[reg.fn]
    };
  });
}

/** [공개] 시각 저장 + 재설치. hour 는 daily 에서만 의미. 갱신된 전체 설정 반환. */
function applyTriggerConfig(fn, hour) {
  var reg = trgFindReg_(fn);
  if (!reg) throw new Error('알 수 없는 트리거: ' + fn);
  if (reg.freq === 'daily') {
    var h = parseInt(hour, 10);
    if (isNaN(h) || h < 0 || h > 23) throw new Error('시각은 0~23 사이여야 합니다: ' + hour);
    saveSetting_(reg.key, String(h));
    trgDelete_(reg.fn);
    trgCreate_(reg, h);
    Logger.log('[트리거] ' + reg.fn + ' 매일 ' + h + '시 재설치');
  } else {
    trgDelete_(reg.fn);
    trgCreate_(reg, null);
    Logger.log('[트리거] ' + reg.fn + ' 매시간 재설치');
  }
  return getTriggerConfig();
}

/** [공개] 설치/해제 토글. 갱신된 전체 설정 반환. */
function setTriggerEnabled(fn, enabled) {
  var reg = trgFindReg_(fn);
  if (!reg) throw new Error('알 수 없는 트리거: ' + fn);
  trgDelete_(reg.fn);
  if (enabled) trgCreate_(reg, reg.freq === 'daily' ? trgHour_(reg.fn) : null);
  Logger.log('[트리거] ' + reg.fn + (enabled ? ' 설치' : ' 해제'));
  return getTriggerConfig();
}
