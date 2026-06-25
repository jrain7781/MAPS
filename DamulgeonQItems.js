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
 * [공개] 선택한 사건(in_date|사건base|법원) 내 ?임의물건 현황 — 모달 카운트/리스트 + 그 사건 내 다음 번호.
 *   사건 3키가 모두 주어지면 그 사건만, 아니면 전체(폴백).
 *   ?물건 = 물건번호가 '(?N)' 숫자인 것만 — '(?회원명)' 등 실제 ?물건(회원매칭용)은 제외.
 * 반환: { success, count, maxNum, nextNum, items:[{id,sakun_no,qnum,court,in_date,m_name_id,stu_member,member_name}] }
 */
function getQItemsInfo(inDate, sakun, court) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, count: 0, maxNum: 0, nextNum: 1, items: [] };
    var wantBase = _normSakunBase_(String(sakun == null ? '' : sakun));
    var wantCourt = String(court == null ? '' : court).trim();
    var wantDate = _dmDateKey6_(inDate);
    var scoped = !!(wantBase && wantCourt);   // 사건 지정 시 그 사건만
    var n = sheet.getLastRow() - 1;
    var data = sheet.getRange(2, 1, n, ITEM_HEADERS.length).getValues();
    var items = [], maxNum = 0;
    data.forEach(function (r) {
      var s = String(r[2] || '').trim();
      if (!s) return;
      var qnum = _dmQNum_(s);
      if (qnum == null) return;   // '(?N)' 숫자 임의물건만
      if (scoped) {
        if (_normSakunBase_(s) !== wantBase) return;
        if (String(r[3] || '').trim() !== wantCourt) return;
        if (wantDate && _dmDateKey6_(r[1]) !== wantDate) return;
      }
      if (qnum > maxNum) maxNum = qnum;
      items.push({
        id: String(r[0] || ''),
        sakun_no: s,
        qnum: qnum,
        court: String(r[3] || ''),
        in_date: String(r[1] || ''),
        stu_member: String(r[4] || ''),
        m_name_id: String(r[5] || ''),
        member_name: String(r[6] || '')
      });
    });
    items.sort(function (a, b) { return (parseInt(b.qnum, 10) || 0) - (parseInt(a.qnum, 10) || 0); });   // 높은 번호 위로(내림차순)
    return { success: true, count: items.length, maxNum: maxNum, nextNum: maxNum + 1, items: items };
  } catch (e) {
    Logger.log('[getQItemsInfo] ' + e);
    return { success: false, message: String(e), count: 0, maxNum: 0, nextNum: 1, items: [] };
  }
}

/**
 * [공개] ?임의물건 N개 생성. (선택 사건 범위, 그 사건 내 ?번호 연속)
 *   입찰물건관리와 동일하게 createData 로 생성(회원검증·이력·적립훅 동일).
 * @param {string} inDate     입찰일자
 * @param {string} sakun      사건번호(괄호 앞 본문) — 끝에 (?N) 자동 부착
 * @param {string} court      법원
 * @param {string} mNameId    담당(m_name_id)
 * @param {number} count      생성 개수(1~DM_QITEM_MAX_PER_CALL)
 * @param {string} memberId   회원 id (추천/입찰이면 필수)
 * @param {string} memberName 회원명(명의 포함 문자열, 예: '이정우 (MJ) 한한한')
 * @param {string} status     상태(stu_member) — 기본 '추천'
 * @returns {{success, created, requested, fromNum, toNum, fails, info, message}}
 */
function generateQItems(inDate, sakun, court, mNameId, count, memberId, memberName, status) {
  try {
    inDate = String(inDate == null ? '' : inDate).trim();
    sakun = String(sakun == null ? '' : sakun).trim();
    court = String(court == null ? '' : court).trim();
    mNameId = String(mNameId == null ? '' : mNameId).trim() || '대표님';
    memberId = String(memberId == null ? '' : memberId).trim();
    memberName = String(memberName == null ? '' : memberName).trim();
    status = String(status == null ? '' : status).trim() || '추천';
    count = parseInt(count, 10);

    if (!sakun) return { success: false, message: '사건번호가 없습니다.' };
    if (!court) return { success: false, message: '법원이 없습니다.' };
    if (isNaN(count) || count < 1) return { success: false, message: '생성 개수를 1 이상 입력하세요.' };
    if (count > DM_QITEM_MAX_PER_CALL) return { success: false, message: '1회 최대 ' + DM_QITEM_MAX_PER_CALL + '개까지 생성할 수 있습니다.' };
    sakun = sakun.replace(/\([^)]*\)\s*$/, '').trim();   // 본문만(끝 괄호 물건번호 제거)
    if (!sakun) return { success: false, message: '사건번호 본문이 비었습니다.' };
    if ((status === '추천' || status === '입찰') && !memberName) {
      return { success: false, message: '상태가 ' + status + '이면 회원을 선택해야 합니다.' };
    }

    // 이 사건 내 ?물건 최대번호 → 다음부터
    var info0 = getQItemsInfo(inDate, sakun, court);
    var start = (info0 && info0.maxNum ? info0.maxNum : 0) + 1;

    var created = 0, fails = [];
    for (var k = 0; k < count; k++) {
      var num = start + k;
      var fullSakun = sakun + '(?' + num + ')';
      // 입찰물건관리와 동일한 정식 생성 — createData(이력·회원검증·적립훅 동일). 각 호출이 자체 락/flush.
      var r = createData(inDate, fullSakun, court, status, mNameId, memberName, '', memberId, '', '', '', '', '', mNameId, '', '');
      if (r && r.success) created++;
      else fails.push({ sakun: fullSakun, msg: (r && r.message) || '실패' });
    }

    Logger.log('[generateQItems] ' + created + '/' + count + ' 생성 ?' + start + '~?' + (start + count - 1) + ' (' + sakun + ') 회원=' + memberName + ' 상태=' + status);
    var info = getQItemsInfo(inDate, sakun, court);
    return {
      success: created > 0,
      created: created, requested: count, fromNum: start, toNum: start + count - 1,
      fails: fails, info: info,
      message: created === count ? '' : (created + '/' + count + '개만 생성됨' + (fails[0] ? (' — ' + fails[0].msg) : ''))
    };
  } catch (e) {
    Logger.log('[generateQItems] ' + e);
    return { success: false, message: String(e) };
  }
}
