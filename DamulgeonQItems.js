/**
 * [DamulgeonQItems.gs]
 * 다물건 관리 ▸ '? 임의물건 생성' 백엔드.
 * 사건번호 끝 괄호에 (?N) 을 붙인 placeholder 물건을 ITEMS 시트에 생성한다.
 *   - 물건번호 칸은 따로 없음 → 사건번호 = '입력사건번호(?N)' 형태로 저장(다물건 그리드가 괄호를 물건번호로 인식).
 *   - 상태(stu_member) = '상품' 고정.
 *   - ?번호는 전체 ?물건 기준 연속(없으면 ?1, 있으면 최대번호+1 부터).
 * 재사용: ITEM_HEADERS, DB_SHEET_NAME, _dmMulgeonNo_, writeItemHistoryBatch_ (SheetDB.gs).
 */

var DM_QITEM_MAX_PER_CALL = 100;   // 1회 생성 상한(런어웨이 방지)

/** 사건번호 → ?번호(정수). '(?12)' → 12, ?없으면 null. */
function _dmQNum_(sakun) {
  var mul = (typeof _dmMulgeonNo_ === 'function') ? _dmMulgeonNo_(sakun) : '';
  var m = String(mul).match(/^\?\s*(\d+)$/);   // '?12' 형태만 번호로 인정
  return m ? parseInt(m[1], 10) : null;
}

/**
 * [공개] 현재 전체 ?임의물건 현황 — 모달 상단 카운트/리스트 + 다음 번호.
 * 반환: { success, count, maxNum, nextNum, items:[{id,sakun_no,qnum,court,in_date,m_name_id,stu_member,member_name}] }
 */
function getQItemsInfo() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, count: 0, maxNum: 0, nextNum: 1, items: [] };
    var n = sheet.getLastRow() - 1;
    var data = sheet.getRange(2, 1, n, ITEM_HEADERS.length).getValues();
    var items = [], maxNum = 0;
    data.forEach(function (r) {
      var sakun = String(r[2] || '').trim();
      if (!sakun || sakun.indexOf('?') < 0) return;            // ?물건만
      var qnum = _dmQNum_(sakun);
      if (qnum != null && qnum > maxNum) maxNum = qnum;
      items.push({
        id: String(r[0] || ''),
        sakun_no: sakun,
        qnum: (qnum == null ? '' : qnum),
        court: String(r[3] || ''),
        in_date: String(r[1] || ''),
        stu_member: String(r[4] || ''),
        m_name_id: String(r[5] || ''),
        member_name: String(r[6] || '')
      });
    });
    items.sort(function (a, b) { return (parseInt(a.qnum, 10) || 0) - (parseInt(b.qnum, 10) || 0); });
    return { success: true, count: items.length, maxNum: maxNum, nextNum: maxNum + 1, items: items };
  } catch (e) {
    Logger.log('[getQItemsInfo] ' + e);
    return { success: false, message: String(e), count: 0, maxNum: 0, nextNum: 1, items: [] };
  }
}

/**
 * [공개] ?임의물건 N개 생성.
 * @param {string} inDate   입찰일자(원문 그대로 저장)
 * @param {string} sakun    사건번호(괄호 앞 본문) — 끝에 (?N) 자동 부착
 * @param {string} court    법원
 * @param {string} mNameId  담당(m_name_id)
 * @param {number} count    생성 개수(1~DM_QITEM_MAX_PER_CALL)
 * @returns {{success, created, fromNum, toNum, created_sakuns, info}}
 */
function generateQItems(inDate, sakun, court, mNameId, count) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { success: false, message: '저장이 혼잡합니다. 잠시 후 다시 시도해 주세요.' }; }
  try {
    inDate = String(inDate == null ? '' : inDate).trim();
    sakun = String(sakun == null ? '' : sakun).trim();
    court = String(court == null ? '' : court).trim();
    mNameId = String(mNameId == null ? '' : mNameId).trim() || '대표님';
    count = parseInt(count, 10);

    if (!sakun) return { success: false, message: '사건번호를 입력하세요.' };
    if (!court) return { success: false, message: '법원을 입력하세요.' };
    if (isNaN(count) || count < 1) return { success: false, message: '생성 개수를 1 이상 입력하세요.' };
    if (count > DM_QITEM_MAX_PER_CALL) return { success: false, message: '1회 최대 ' + DM_QITEM_MAX_PER_CALL + '개까지 생성할 수 있습니다.' };
    // 사건번호에 이미 괄호 물건번호가 들어있으면 제거(본문만 사용)
    sakun = sakun.replace(/\([^)]*\)\s*$/, '').trim();
    if (!sakun) return { success: false, message: '사건번호 본문이 비었습니다.' };

    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음' };

    // 전체 ?물건 최대번호
    var info = getQItemsInfo();
    var start = (info && info.maxNum ? info.maxNum : 0) + 1;

    var regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var rows = [], ids = [], createdSakuns = [], history = [];
    for (var k = 0; k < count; k++) {
      var num = start + k;
      var fullSakun = sakun + '(?' + num + ')';
      var id = String(new Date().getTime()) + String(Math.floor(Math.random() * 1000)) + String(k);
      var row = ITEM_HEADERS.map(function (h) {
        switch (h) {
          case 'id': return id;
          case 'in-date': return inDate;
          case 'sakun_no': return fullSakun;
          case 'court': return court;
          case 'stu_member': return '상품';
          case 'm_name_id': return mNameId;
          case 'reg_date': return regDate;
          case 'reg_member': return mNameId;
          default: return '';
        }
      });
      rows.push(row);
      ids.push(id);
      createdSakuns.push(fullSakun);
      history.push({ action: 'ITEM_CREATE', item_id: id, member_id: '', member_name: '', trigger_type: 'dm-qitem', note: court + ' ' + fullSakun + ' (다물건 임의물건 생성)', req_id: String(new Date().getTime()) });
    }

    // 일괄 append (마지막 행 뒤에 한 번에 기록)
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, ITEM_HEADERS.length).setValues(rows);
    // id 열 텍스트 고정(지수표기/매칭실패 방지) — items_id_text 정책
    var idCol = ITEM_HEADERS.indexOf('id') + 1;
    sheet.getRange(startRow, idCol, rows.length, 1).setNumberFormat('@');
    for (var j = 0; j < ids.length; j++) sheet.getRange(startRow + j, idCol).setValue(ids[j]);

    if (history.length && typeof writeItemHistoryBatch_ === 'function') writeItemHistoryBatch_(history);
    SpreadsheetApp.flush();
    Logger.log('[generateQItems] ' + count + '개 생성 ?' + start + '~?' + (start + count - 1) + ' (' + sakun + ')');

    return { success: true, created: count, fromNum: start, toNum: start + count - 1, created_sakuns: createdSakuns, info: getQItemsInfo() };
  } catch (e) {
    Logger.log('[generateQItems] ' + e);
    return { success: false, message: String(e) };
  } finally {
    lock.releaseLock();
  }
}
