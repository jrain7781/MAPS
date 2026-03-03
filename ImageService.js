/**
 * [ImageService.gs]
 * 구글 드라이브 이미지 동기화 및 자동 매칭 서비스
 */

// SPREADSHEET_ID는 SheetDB.js에서 선언됨
const IMAGE_UPLOAD_FOLDER_ID = '1ATjdMgI2Ir_F6q9VNbVjqoaPiGB3BhrK';
const IMAGE_ARCHIVE_FOLDER_ID = '1bvebAcNi8wWurBJbgEikBFbvssYQAQ7y';
const IMAGE_DB_SHEET_NAME = 'items';
const ITEM_IMAGES_SHEET_NAME = 'item_images';
const ITEM_IMAGES_HEADERS = ['item_id', 'image_id', 'uploader', 'created_at', 'file_name'];

const SYNC_LOGS_SHEET_NAME = 'sync_logs';
const SYNC_LOGS_HEADERS = ['timestamp', 'type', 'sakun_no', 'in_date', 'court', 'file_name', 'status_msg', 'image_id', 'auction_id', 'existing_uploader', 'file_uploader'];

function ensureSyncLogsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SYNC_LOGS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SYNC_LOGS_SHEET_NAME);
    sh.getRange(1, 1, 1, SYNC_LOGS_HEADERS.length).setValues([SYNC_LOGS_HEADERS]);
    sh.getRange(1, 1, 1, SYNC_LOGS_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // [강제 업데이트] 헤더 컬럼 수가 맞지 않으면 새로 고침
    var currentHeader = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (currentHeader.length < SYNC_LOGS_HEADERS.length) {
      sh.getRange(1, 1, 1, SYNC_LOGS_HEADERS.length).setValues([SYNC_LOGS_HEADERS]);
      sh.getRange(1, 1, 1, SYNC_LOGS_HEADERS.length).setFontWeight('bold');
    }
  }
  return sh;
}

/**
 * 3일 이상 된 로그 삭제
 */
function rotateSyncLogs() {
  var sh = ensureSyncLogsSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  var now = new Date();
  var cutoff = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
  var data = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  var rowsToDelete = 0;

  for (var i = 0; i < data.length; i++) {
    var logDate = new Date(data[i][0]);
    if (logDate < cutoff) {
      rowsToDelete++;
    } else {
      break; // 이력은 시간순이므로 이후는 모두 최신
    }
  }

  if (rowsToDelete > 0) {
    sh.deleteRows(2, rowsToDelete);
  }
}

/**
 * 로그 검색
 */
function getSyncLogs(filters) {
  var sh = ensureSyncLogsSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, SYNC_LOGS_HEADERS.length).getValues();
  var result = [];

  var fSakun = (filters.sakun_no || '').toLowerCase().trim();
  var fDate = (filters.in_date || '').trim();
  var fCourt = (filters.court || '').toLowerCase().trim();

  for (var i = data.length - 1; i >= 0; i--) { // 최신순
    var row = data[i];
    var timestamp = row[0];
    var type = row[1];
    var sakunNo = String(row[2]);
    var inDate = String(row[3]);
    var court = String(row[4]);
    var fileName = row[5];
    var statusMsg = row[6];

    if (fSakun && !sakunNo.toLowerCase().includes(fSakun)) continue;
    if (fDate && !inDate.includes(fDate)) continue;
    if (fCourt && !court.toLowerCase().includes(fCourt)) continue;

    result.push({
      timestamp: Utilities.formatDate(new Date(timestamp), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      status: type,
      sakun_no: sakunNo,
      in_date: inDate,
      court: court,
      file_name: fileName,
      message: statusMsg,
      image_id: String(row[7] || ''),
      auction_id: String(row[8] || ''),
      existing_uploader: String(row[9] || ''),
      file_uploader: String(row[10] || '')
    });

    if (result.length >= 200) break; // 최대 200건
  }
  return result;
}

/**
 * 대시보드용: 최근 7일 동기화 통계를 날짜×담당자 기준으로 집계하여 반환합니다.
 */
/**
 * 대시보드용: sync_logs를 "동기화 실행 세션" 단위로 집계하여 반환합니다.
 * - 20분 이상 간격이 있으면 새로운 세션으로 판단
 * - 세션 내에서 담당자(items m_name_id = existing_uploader)별로 집계
 * - 반환값: 최근 30건, 최신 세션이 위
 */
function getSyncStats() {
  try {
    const sh = ensureSyncLogsSheet();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return [];

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 최근 30일
    const data = sh.getRange(2, 1, lastRow - 1, SYNC_LOGS_HEADERS.length).getValues();

    // 유효한 로그만 필터링 후 타임스탬프 오름차순 정렬
    const entries = data
      .filter(row => row[0] && new Date(row[0]) >= cutoff)
      .map(row => {
        // 담당자 결정: ① items m_name_id(existing_uploader) ② 파일명 파싱 ③ 파일담당자 순
        let manager = String(row[9] || '').trim(); // existing_uploader = items.m_name_id
        if (!manager) {
          // 신규등록 등 m_name_id 없는 경우: 파일명에서 직접 파싱
          const fn = String(row[5] || '');
          const dotIdx = fn.lastIndexOf('.');
          const nameNoExt = dotIdx > -1 ? fn.substring(0, dotIdx) : fn;
          const fparts = nameNoExt.split('_');
          // 끝이 순수 숫자면 옥션ID 제거
          if (fparts.length > 0 && /^\d{4,12}$/.test(fparts[fparts.length - 1])) fparts.pop();
          if (fparts.length > 3) manager = fparts[fparts.length - 1].trim();
        }
        if (!manager) manager = String(row[10] || '').trim(); // file_uploader 최종 폴백
        return {
          ts: new Date(row[0]),
          type: String(row[1]),
          sakunNo: String(row[2] || '').trim(),
          aucId: String(row[8] || ''),
          manager: manager || '대표님'
        };
      })
      .sort((a, b) => a.ts - b.ts);

    if (entries.length === 0) return [];

    // 1시간 이상 간격 = 새 세션으로 분리
    const SESSION_GAP_MS = 60 * 60 * 1000;
    const sessions = [];
    let current = [entries[0]];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].ts - entries[i - 1].ts > SESSION_GAP_MS) {
        sessions.push(current);
        current = [entries[i]];
      } else {
        current.push(entries[i]);
      }
    }
    sessions.push(current);

    // 각 세션을 담당자별로 집계
    const result = [];
    sessions.forEach(session => {
      const timeStr = Utilities.formatDate(session[0].ts, Session.getScriptTimeZone(), 'MM/dd HH:mm');
      const byManager = new Map();

      session.forEach(e => {
        if (!byManager.has(e.manager)) {
          byManager.set(e.manager, {
            time: timeStr,
            manager: e.manager,
            total: 0, newCount: 0, matchCount: 0,
            conflictCount: 0, aucMatch: 0, aucNoMatch: 0,
            allSakunNos: [], newSakunNos: [], matchSakunNos: [],
            conflictSakunNos: [], aucMatchSakunNos: [], aucNoMatchSakunNos: []
          });
        }
        const s = byManager.get(e.manager);
        s.total++;
        if (e.sakunNo && !s.allSakunNos.includes(e.sakunNo)) s.allSakunNos.push(e.sakunNo);
        if (e.type === '신규등록') {
          s.newCount++;
          if (e.sakunNo && !s.newSakunNos.includes(e.sakunNo)) s.newSakunNos.push(e.sakunNo);
        }
        if (e.type === '매칭성공') {
          s.matchCount++;
          if (e.sakunNo && !s.matchSakunNos.includes(e.sakunNo)) s.matchSakunNos.push(e.sakunNo);
        }
        if (e.type === '충돌') {
          s.conflictCount++;
          if (e.sakunNo && !s.conflictSakunNos.includes(e.sakunNo)) s.conflictSakunNos.push(e.sakunNo);
        }
        if (e.aucId) {
          s.aucMatch++;
          if (e.sakunNo && !s.aucMatchSakunNos.includes(e.sakunNo)) s.aucMatchSakunNos.push(e.sakunNo);
        } else {
          s.aucNoMatch++;
          if (e.sakunNo && !s.aucNoMatchSakunNos.includes(e.sakunNo)) s.aucNoMatchSakunNos.push(e.sakunNo);
        }
      });

      byManager.forEach(s => result.push(s));
    });

    // 최신 세션이 위에 오도록 역순, 최대 30행
    return result.reverse().slice(0, 30);
  } catch (e) {
    Logger.log(`getSyncStats Error: ${e.message}`);
    return [];
  }
}

function ensureItemImagesSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(ITEM_IMAGES_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ITEM_IMAGES_SHEET_NAME);
    sh.getRange(1, 1, 1, ITEM_IMAGES_HEADERS.length).setValues([ITEM_IMAGES_HEADERS]);
    sh.getRange(1, 1, 1, ITEM_IMAGES_HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

/**
 * item_images 시트에서 동일한 물건(item_id)에 대해 중복 등록된 이미지를 정리합니다.
 * 파일명이 다르더라도 동일한 item_id라면 가장 최근에 등록된 것 하나만 남깁니다.
 * @param {string} targetItemId - 특정 물건 ID만 처리할 경우 사용.
 */
function cleanupDuplicateItemImages(targetItemId = null) {
  const sh = ensureItemImagesSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const data = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  const seen = new Map(); // key: item_id, value: {rowIndex}
  const rowsToDelete = [];

  for (let i = 0; i < data.length; i++) {
    const itemId = String(data[i][0]).trim();
    if (!itemId) continue;
    if (targetItemId && itemId !== String(targetItemId)) continue;

    // 동일 물건 ID에 대해 중복 발견 시 이전 행을 삭제 목록에 추가
    if (seen.has(itemId)) {
      rowsToDelete.push(seen.get(itemId).rowIndex);
    }
    seen.set(itemId, { rowIndex: i + 2 });
  }

  if (rowsToDelete.length > 0) {
    rowsToDelete.sort((a, b) => b - a);
    rowsToDelete.forEach(row => sh.deleteRow(row));
    Logger.log(`[cleanupDuplicateItemImages] ${rowsToDelete.length}개의 중복 데이터를 정리했습니다. (ID: ${targetItemId || 'ALL'})`);
  }
}

/**
 * [관리용] 2024타경77586 사건의 중복 이미지를 정리합니다.
 * GAS 에디터에서 이 함수를 선택하고 실행(Run)하세요.
 */
function fixDuplicateForSakun() {
  const sakunNo = '2024타경77586';
  // items 시트에서 ID 찾기
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
  const data = itemsSheet.getDataRange().getValues();
  let foundId = '';

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() === sakunNo) {
      foundId = String(data[i][0]).trim();
      break;
    }
  }

  if (!foundId) {
    Logger.log(`${sakunNo} 해당 사건번호를 찾을 수 없습니다.`);
    return;
  }

  Logger.log(`${sakunNo} (ID: ${foundId}) 중복 이미지 정리를 시작합니다.`);
  cleanupDuplicateItemImages(foundId);
  Logger.log(`정리 완료.`);
}

/**
 * [관리용] 모든 물건에 대해 중복된 이미지를 찾아 정리합니다.
 * 파일명이 다르더라도 동일 사건(item_id)이면 최신 1장만 남깁니다.
 */
function fixAllDuplicates() {
  Logger.log(`전체 중복 이미지 정리를 시작합니다.`);
  cleanupDuplicateItemImages(); // targetItemId 없이 호출하면 전체 처리
  Logger.log(`전체 정리 완료.`);
}

/**
 * 메인 리스트용: items 시트 데이터에 각 물건의 이미지 ID 목록을 콤마 구분 문자열(image_ids)로 붙여 반환합니다.
 * item_images 시트가 있으면 해당 item_id별 image_id를 created_at 순으로 이어 붙이고,
 * 없으면 items.image_id 한 개를 그대로 사용합니다.
 */
function readAllDataWithImageIds() {
  var items = [];
  try {
    if (typeof readAllData === 'function') items = readAllData();
  } catch (e) { return items; }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var imgSheet = ss.getSheetByName(ITEM_IMAGES_SHEET_NAME);
  var map = {};
  if (imgSheet && imgSheet.getLastRow() >= 2) {
    var data = imgSheet.getRange(2, 1, imgSheet.getLastRow(), 5).getValues();
    for (var i = 0; i < data.length; i++) {
      var itemId = String(data[i][0]).trim();
      if (!itemId) continue;
      if (!map[itemId]) map[itemId] = [];
      map[itemId].push({ id: String(data[i][1] || '').trim(), created_at: String(data[i][3] || '').trim() });
    }
    for (var k in map) {
      map[k].sort(function (a, b) { return (a.created_at || '').localeCompare(b.created_at || ''); });
    }
  }
  for (var j = 0; j < items.length; j++) {
    var key = String(items[j].id || '').trim();
    var arr = map[key];
    if (arr && arr.length) {
      items[j].image_ids = arr.map(function (x) { return x.id; }).filter(Boolean).join(',');
      items[j].has_images = true;
    } else if (items[j].image_id && String(items[j].image_id).trim()) {
      items[j].image_ids = String(items[j].image_id).trim();
      items[j].has_images = true;
    } else {
      items[j].image_ids = '';
      items[j].has_images = false;
    }
  }
  return items;
}

/**
 * 해당 물건에 연결된 모든 이미지를 등록일 순으로 반환합니다.
 * system / web 혼합 시 등록일(created_at) 순 정렬.
 * item_images가 없거나 비어있으면 items.image_id 한 건을 system으로 반환(하위 호환).
 */
function getItemImages(itemId) {
  if (!itemId) return [];
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var imgSheet = ss.getSheetByName(ITEM_IMAGES_SHEET_NAME);
  var itemsSheet = ss.getSheetByName(IMAGE_DB_SHEET_NAME);
  var list = [];
  if (imgSheet) {
    var lastRow = imgSheet.getLastRow();
    if (lastRow >= 2) {
      var data = imgSheet.getRange(2, 1, lastRow, 5).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(itemId).trim()) {
          list.push({
            image_id: String(data[i][1] || '').trim(),
            uploader: String(data[i][2] || 'system').trim(),
            created_at: String(data[i][3] || '').trim(),
            file_name: String(data[i][4] || '').trim()
          });
        }
      }
    }
  }
  if (list.length === 0 && itemsSheet) {
    var idCol = itemsSheet.getRange(2, 1, Math.max(2, itemsSheet.getLastRow() - 1), 1).getValues();
    for (var r = 0; r < idCol.length; r++) {
      if (String(idCol[r][0]).trim() === String(itemId).trim()) {
        var rowIndex = r + 2;
        var imageId = itemsSheet.getRange(rowIndex, 13).getValue();
        if (imageId && String(imageId).trim()) {
          list.push({ image_id: String(imageId).trim(), uploader: 'system', created_at: '', file_name: '' });
        }
        break;
      }
    }
  }
  list.sort(function (a, b) {
    if (!a.created_at) return 1;
    if (!b.created_at) return -1;
    return a.created_at.localeCompare(b.created_at);
  });
  return list;
}

/**
 * 해당 물건의 웹 이미지 번호 다음 값을 구합니다. (_web1, _web2 ...)
 */
function getNextWebNumber_(itemId) {
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ITEM_IMAGES_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return 1;
  var data = sh.getRange(2, 1, sh.getLastRow(), 5).getValues();
  var maxN = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() !== String(itemId).trim()) continue;
    if (String(data[i][2]).trim() !== 'web') continue;
    var fn = String(data[i][4] || '');
    var m = fn.match(/_web(\d+)(\.[^.]+)?$/i) || fn.match(/_web(\d+)$/i);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return maxN + 1;
}

/**
 * 웹에서 수동 등록한 이미지를 저장합니다.
 * 파일명: 사건번호_날짜_법원명_webN.확장자 (중복 방지)
 * uploader='web' 고정.
 */
function registerWebImage(itemId, base64DataUrl, mimeType, sakunNo, inDate, court) {
  if (!itemId || !base64DataUrl) return { success: false, message: 'itemId와 이미지 데이터가 필요합니다.' };
  try {
    var n = getNextWebNumber_(itemId);
    var ext = 'png';
    if (typeof mimeType === 'string' && mimeType.indexOf('jpeg') >= 0) ext = 'jpg';
    if (typeof mimeType === 'string' && mimeType.indexOf('gif') >= 0) ext = 'gif';
    // 사건번호와 법원명에서 언더바(_)를 대시(-)로 치환하여 필드 구분자(_)와 혼동 방지
    var cleanSakun = (sakunNo || '').replace(/_/g, '-').replace(/[^a-zA-Z0-9가-힣-]/g, '');
    var cleanCourt = (court || 'x').replace(/_/g, '-').replace(/[^a-zA-Z0-9가-힣-]/g, '');
    var base = cleanSakun + '_' + (inDate || '').replace(/\D/g, '') + '_' + cleanCourt;
    var fileName = base + '_web' + n + '.' + ext;

    var data = base64DataUrl;
    if (data.indexOf('base64,') >= 0) data = data.split('base64,')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(data), mimeType || 'image/png', fileName);
    var folder = DriveApp.getFolderById(IMAGE_ARCHIVE_FOLDER_ID);
    var file = folder.createFile(blob);

    var imgSheet = ensureItemImagesSheet();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

    // [추가] 중복 체크 (itemId + fileName)
    var existingData = imgSheet.getRange(2, 1, Math.max(1, imgSheet.getLastRow() - 1), 5).getValues();
    var isDup = existingData.some(row => String(row[0]).trim() === String(itemId).trim() && String(row[4]).trim() === fileName);

    if (!isDup) {
      imgSheet.appendRow([String(itemId), file.getId(), 'web', now, fileName]);
    } else {
      Logger.log(`[registerWebImage] 중복 등록 건너뜀: ${fileName}`);
    }

    var itemsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(IMAGE_DB_SHEET_NAME);
    if (itemsSheet && typeof ensureColumnExists === 'function') {
      ensureColumnExists(itemsSheet, 13);
      var ids = itemsSheet.getRange(2, 1, Math.max(2, itemsSheet.getLastRow() - 1), 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(itemId).trim()) {
          var cell = itemsSheet.getRange(i + 2, 13);
          if (!cell.getValue() || !String(cell.getValue()).trim()) cell.setValue(file.getId());
          break;
        }
      }
    }
    return { success: true, image_id: file.getId(), file_name: fileName };
  } catch (e) {
    return { success: false, message: e.message || '등록 실패' };
  }
}

/**
 * 웹 등록(uploader='web') 이미지만 삭제합니다. Drive 파일 휴지통 이동 + item_images 행 삭제.
 */
function deleteWebImage(itemId, imageId) {
  if (!itemId || !imageId) return { success: false, message: 'itemId와 image_id가 필요합니다.' };
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ITEM_IMAGES_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { success: false, message: 'item_images 시트에 해당 데이터가 없습니다.' };
  var data = sh.getRange(2, 1, sh.getLastRow(), 5).getValues();
  var rowIndex = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(itemId).trim() &&
      String(data[i][1]).trim() === String(imageId).trim() &&
      String(data[i][2]).trim() === 'web') {
      rowIndex = i + 2;
      break;
    }
  }
  if (rowIndex < 0) return { success: false, message: '웹 등록 이미지만 삭제할 수 있습니다.' };
  try {
    var file = DriveApp.getFileById(String(imageId).trim());
    file.setTrashed(true);
  } catch (ignore) { }
  sh.deleteRow(rowIndex);

  var itemsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(IMAGE_DB_SHEET_NAME);
  if (itemsSheet) {
    var currentPrimary = null;
    var idCol = itemsSheet.getRange(2, 1, Math.max(2, itemsSheet.getLastRow() - 1), 1).getValues();
    for (var r = 0; r < idCol.length; r++) {
      if (String(idCol[r][0]).trim() === String(itemId).trim()) {
        if (itemsSheet.getRange(r + 2, 13).getValue() === String(imageId).trim()) {
          var remaining = getItemImages(itemId).filter(function (x) { return x.image_id !== String(imageId).trim(); });
          itemsSheet.getRange(r + 2, 13).setValue(remaining.length ? remaining[0].image_id : '');
        }
        break;
      }
    }
  }
  return { success: true };
}

/**
 * 물건 이미지를 삭제합니다 (system/web 모두 가능).
 * - Drive 파일 휴지통 이동
 * - item_images 시트에서 해당 행 삭제
 * - items.image_id 업데이트 (삭제된 ID면 다음 이미지로 교체)
 */
function deleteItemImage(itemId, imageId) {
  if (!itemId || !imageId) return { success: false, message: 'itemId와 imageId가 필요합니다.' };

  var imgSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ITEM_IMAGES_SHEET_NAME);
  var itemsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(IMAGE_DB_SHEET_NAME);

  // 1. Drive 파일 휴지통 이동
  try {
    var file = DriveApp.getFileById(String(imageId).trim());
    file.setTrashed(true);
  } catch (e) {
    Logger.log('파일 휴지통 이동 실패 (권한 또는 파일 없음): ' + e.message);
  }

  // 2. item_images 시트에서 해당 행 삭제
  if (imgSheet && imgSheet.getLastRow() >= 2) {
    var data = imgSheet.getRange(2, 1, imgSheet.getLastRow(), 5).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]).trim() === String(itemId).trim() &&
        String(data[i][1]).trim() === String(imageId).trim()) {
        imgSheet.deleteRow(i + 2);
        break;
      }
    }
  }

  // 3. items.image_id 업데이트 (삭제된 이미지가 대표 이미지면 다음 것으로 교체)
  if (itemsSheet && itemsSheet.getLastRow() >= 2) {
    var idCol = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < idCol.length; r++) {
      if (String(idCol[r][0]).trim() === String(itemId).trim()) {
        var currentImageId = String(itemsSheet.getRange(r + 2, 13).getValue()).trim();
        if (currentImageId === String(imageId).trim()) {
          var remaining = getItemImages(itemId).filter(function (x) { return x.image_id !== String(imageId).trim(); });
          itemsSheet.getRange(r + 2, 13).setValue(remaining.length ? remaining[0].image_id : '');
        }
        break;
      }
    }
  }

  return { success: true, message: '이미지가 삭제되었습니다.' };
}

/**
 * 앱 시작 시 이미지 동기화 트리거를 자동으로 제거합니다.
 */
function onOpen() {
  removeImageSyncTriggers();
}

function syncImages(batchLimit = 100) {
  try {
    const uploadFolder = DriveApp.getFolderById(IMAGE_UPLOAD_FOLDER_ID);
    const archiveFolder = DriveApp.getFolderById(IMAGE_ARCHIVE_FOLDER_ID);
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(IMAGE_DB_SHEET_NAME);
    const logSheet = ensureSyncLogsSheet();

    // 동기화 전 중복 정리 실행
    cleanupDuplicateItemImages();

    if (!sheet) return {
      success: false,
      message: 'DB 시트(items)를 찾을 수 없습니다.'
    };

    // [최적화] 필요한 컬럼 미리 확보
    ensureColumnExists(sheet, 16);

    const files = uploadFolder.getFiles();
    let processCount = 0;
    let newCount = 0;
    let matchCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let remainingFiles = 0;
    const skippedFiles = [];
    const errorFiles = [];
    const duplicateFiles = [];

    // 배치 처리를 위한 데이터 로드
    const lastRow = sheet.getLastRow();
    const dataRange = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 16) : null;
    const values = dataRange ? dataRange.getValues() : [];

    const imgSheet = ensureItemImagesSheet();
    const imgLastRow = imgSheet.getLastRow();
    const imgValues = imgLastRow > 1 ? imgSheet.getRange(2, 1, imgLastRow - 1, 5).getValues() : [];

    // [핵심 최적화] 파일명 기반 인덱스 맵 생성 (속도 저하의 주범인 deleteRow 제거용)
    const imgFileNameMap = new Map();
    for (let k = 0; k < imgValues.length; k++) {
      imgFileNameMap.set(String(imgValues[k][4]).trim(), k + 2); // 1-based rowIndex
    }

    const batchNewItems = new Map();
    const MAX_FILES = batchLimit;
    let fileCount = 0;
    let conflictCount = 0;
    const syncResults = [];

    while (files.hasNext() && fileCount < MAX_FILES) {
      const file = files.next();
      fileCount++;
      const fileName = file.getName();
      const fileId = file.getId();

      try {
        const dotIndex = fileName.lastIndexOf('.');
        if (dotIndex === -1) {
          skipCount++;
          continue;
        }

        const nameWithoutExt = fileName.substring(0, dotIndex);
        let name = nameWithoutExt;
        let auctionId = "";
        let regMember = "대표님";

        // 1. 상품 ID 추출
        let parts = name.split('_');
        if (parts.length > 3) {
          const lastPart = parts[parts.length - 1].trim();
          if (/^\d{4,12}$/.test(lastPart)) {
            auctionId = parts.pop().trim();
            name = parts.join('_');
          }
        }

        // 2. 기본 정보 파싱
        parts = name.split('_');
        if (parts.length < 3) {
          skipCount++;
          continue;
        }

        if (parts.length > 3) {
          regMember = parts.pop().trim();
        }

        const court = parts.pop().trim();
        const rawDate = parts.pop().trim();
        const sakunNo = parts.join('_').trim();

        // 날짜 변환 (8자리 -> 6자리)
        let inDate = '';
        if (rawDate.length === 8) inDate = rawDate.substring(2);
        else if (rawDate.length === 6) inDate = rawDate;
        else { skipCount++; continue; }

        const imageCode = fileId;
        const cacheKey = `${sakunNo}_${inDate}_${court}`;
        let matchedRowIndex = -1;
        let currentItemId = "";
        let existingUploader = "";
        let matchedState = "";
        let matchedMember = "";
        let matchedBidPrice = "";

        // 1. DB 매칭 검색
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          if (String(row[1]).trim() === inDate && String(row[2]).trim() === sakunNo && String(row[3]).trim() === court) {
            matchedRowIndex = i + 2;
            currentItemId = String(row[0]).trim();
            existingUploader = String(row[5]).trim(); // m_name_id (Index 5) - 입찰가담당자 기준으로 비교
            matchedState = String(row[4] || '').trim();  // stu_member (Index 4) - 진행상태 반영을 위해 bid_state 대신 사용
            matchedMember = String(row[6] || '').trim(); // m_name (Index 6)
            matchedBidPrice = String(row[7] || '').trim(); // bidprice (Index 7)
            break;
          }
        }

        // 2. 인메모리 배치(신규) 내 중복 체크
        if (matchedRowIndex === -1 && batchNewItems.has(cacheKey)) {
          const batchItem = batchNewItems.get(cacheKey);
          currentItemId = batchItem.id;
          existingUploader = batchItem.uploader;
          matchedState = "신규";
        }

        // --- 매칭/등록 처리 상세 로직 ---
        const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
        let itemId = currentItemId;

        let isConflict = false;

        if (itemId) {
          // [충돌 감지] 업로더 불일치 - 로그만 남기고 정상 처리 계속 (대기실 전송 없음)
          if (existingUploader !== '' && regMember !== '' && existingUploader !== regMember) {
            isConflict = true;
            conflictCount++;
          }

          // [기존 물건 매칭] - 이미지/옥션ID 항상 업데이트 (충돌 여부 무관, 상태/담당자 유지)
          sheet.getRange(matchedRowIndex, 13).setValue(imageCode);
          if (auctionId) sheet.getRange(matchedRowIndex, 16).setValue(auctionId);
          if (!isConflict) matchCount++;
        } else {
          // [신규 물건 등록]
          const newId = new Date().getTime().toString() + Math.floor(Math.random() * 100);
          itemId = newId;
          const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

          const newRow = [
            newId, inDate, sakunNo, court, "상품", regMember, "", 0, "", regDate, "System", "신규", imageCode, "", "", auctionId
          ];
          sheet.appendRow(newRow);
          batchNewItems.set(cacheKey, { id: newId, uploader: regMember });
          newCount++;
        }

        // (공통) 이미지 이력 업데이트
        const existingImgRow = imgFileNameMap.get(fileName);
        if (existingImgRow) {
          imgSheet.getRange(existingImgRow, 2).setValue(imageCode);
          imgSheet.getRange(existingImgRow, 4).setValue(nowStr);
        } else {
          imgSheet.appendRow([itemId, imageCode, 'system', nowStr, fileName]);
          imgFileNameMap.set(fileName, imgSheet.getLastRow());
        }

        syncResults.push([
          new Date(),
          matchedRowIndex > -1 ? (isConflict ? '충돌' : '매칭성공') : '신규등록',
          sakunNo, inDate, court, fileName,
          matchedRowIndex > -1
            ? (isConflict ? `업로더 불일치 (기존:${existingUploader} VS 신규:${regMember})` : '기존 물건 업데이트 완료')
            : '신규 물건 등록 완료',
          imageCode, auctionId,
          existingUploader || '',
          regMember || ''
        ]);

      } catch (e) {
        errorCount++;
        errorFiles.push({ name: fileName, error: e.message });
        Logger.log(`파일 처리 오류 [${fileName}]: ${e.message}`);
      } finally {
        try {
          const parents = file.getParents();
          if (parents.hasNext() && parents.next().getId() === IMAGE_UPLOAD_FOLDER_ID) {
            moveFileToArchive(file, archiveFolder);
          }
        } catch (f) { }
        processCount++;
      }
    }

    // 남은 파일 확인 (배치 처리 효율을 위해 실시간 확인)
    remainingFiles = 0;
    const remainingFilesIter = uploadFolder.getFiles();
    while (remainingFilesIter.hasNext()) {
      remainingFilesIter.next();
      remainingFiles++;
    }

    // [기존 파일 자동 삭제 로직 유지]
    try { cleanOldFiles(archiveFolder); } catch (e) { }

    // 로그 시트에 일괄 기록
    if (syncResults.length > 0) {
      logSheet.getRange(logSheet.getLastRow() + 1, 1, syncResults.length, SYNC_LOGS_HEADERS.length).setValues(syncResults);
    }

    // 상세 결과 메시지 생성
    let message = `처리 완료: 총 ${processCount}건 (신규: ${newCount}, 매칭: ${matchCount})`;
    if (conflictCount > 0) message += `, 충돌: ${conflictCount}건`;
    if (skipCount > 0) message += `, 건너뜀: ${skipCount}건`;
    if (errorCount > 0) message += `, 오류: ${errorCount}건`;
    if (remainingFiles > 0) message += `, 남은 파일: ${remainingFiles}건 (자동 계속 진행)`;

    const resultLogs = syncResults.map(r => ({
      timestamp: Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      status: r[1],
      sakun_no: r[2],
      in_date: r[3],
      court: r[4],
      file_name: r[5],
      message: r[6],
      image_code: r[7],
      auction_id: r[8],
      existing_uploader: String(r[9] || ''),
      file_uploader: String(r[10] || '')
    }));

    return {
      success: true,
      message: message,
      details: {
        processCount: processCount,
        newCount: newCount,
        matchCount: matchCount,
        conflictCount: conflictCount,
        skipCount: skipCount,
        errorCount: errorCount,
        remainingFiles: remainingFiles,
        skippedFiles: skippedFiles.slice(0, 10),
        errorFiles: errorFiles.slice(0, 10),
        duplicateFiles: duplicateFiles.slice(0, 10),
        logs: resultLogs
      }
    };

  } catch (e) {
    Logger.log('동기화 오류: ' + e.toString());
    Logger.log('스택: ' + e.stack);
    return {
      success: false,
      message: `동기화 오류: ${e.message}`,
      details: { error: e.message, stack: e.stack }
    };
  }
}

function moveFileToArchive(file, targetFolder) {
  const fileName = file.getName();
  const existingFiles = targetFolder.getFilesByName(fileName);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }
  file.moveTo(targetFolder);
}

function cleanOldFiles(folder) {
  const files = folder.getFiles();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(new Date().getMonth() - 6);
  const limitYMD = parseInt(Utilities.formatDate(sixMonthsAgo, Session.getScriptTimeZone(), 'yyMMdd'));

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    if (fileName.indexOf('_web') >= 0) continue; // 웹 수동 등록 파일은 정리 대상에서 제외
    const parts = fileName.split('_');
    if (parts.length >= 3) { // 사건번호_날짜_법원 (최소 3개)
      // 뒤에서 두 번째가 날짜 (사건번호에 _가 포함될 수 있으므로)
      let fileDateStr = parts[parts.length - 2].trim();
      if (fileDateStr.length === 8) fileDateStr = fileDateStr.substring(2);
      if (fileDateStr.length === 6 && !isNaN(fileDateStr)) {
        if (parseInt(fileDateStr) < limitYMD) file.setTrashed(true);
      }
    }
  }
}

/**
 * syncImages 함수의 모든 트리거를 제거합니다.
 */
function removeImageSyncTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncImages') {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });

  return {
    success: true,
    message: `트리거 ${removedCount}개가 제거되었습니다.`
  };
}

/**
 * Drive 파일 ID로 이미지를 조회하여 Data URL로 반환합니다.
 * 조사 탭 등에서 매칭 이미지를 표시할 때 사용합니다.
 * @param {string} fileId - Drive 파일 ID (image_id)
 * @return {string|null} data URL 또는 실패 시 null
 */
function getImageDataUrl(fileId) {
  if (!fileId || typeof fileId !== 'string') return null;
  try {
    var id = fileId.trim();
    if (!id) return null;
    var file = DriveApp.getFileById(id);
    var blob = file.getBlob();
    var mime = blob.getContentType();
    var b64 = Utilities.base64Encode(blob.getBytes());
    return 'data:' + mime + ';base64,' + b64;
  } catch (e) {
    return null;
  }
}

/**
 * 이미지 ID를 받아 Base64 데이터로 변환하여 반환합니다. (클라이언트 측 CORS 우회용)
 */
function getImageAsBase64(fileId) {
  if (!fileId) return null;
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    const base64 = Utilities.base64Encode(bytes);
    const contentType = blob.getContentType();
    return `data:${contentType};base64,${base64}`;
  } catch (e) {
    Logger.log('getImageAsBase64 오류: ' + e.message);
    return null;
  }
}