// SheetDB.gs

// [중요] Code.gs의 설정과 충돌하지 않도록 변수명 변경 (HEADERS -> ITEM_HEADERS)
// 스프레드시트 ID
const SPREADSHEET_ID = '1ENbsdkKAgjS9M33O_fQEgMxTTuaUTQ7knCZSliUnw1E';

// 시트 이름 상수
const DB_SHEET_NAME = 'items';
const DB_MEMBERS_SHEET_NAME = 'members';
const TELEGRAM_REQUESTS_SHEET_NAME = 'telegram_requests';
const CLASS_SHEET_NAME_DB = 'class';
const CLASS_D1_SHEET_NAME_DB = 'class_d1';
const MEMBER_CLASS_DETAILS_SHEET_NAME_DB = 'member_class_details';

// [돈클] 회원별 물건 상태(추천/입찰/낙찰/불가) 적립 원장 — append-only, 자동삭제 없음(수동 UI만)
//  · 1행 = (회원, 물건, 상태) 1건. dedup키 = (member_id, item_id, status)
//  · myeongui = 선택된 명의 1개 (items.m_name2 스냅샷)
//  · 적립: 추천/불가/낙찰=이벤트 즉시, 입찰=일별 트리거(in_date≤어제)
const MEMBERS_ITEM_STATUS_SHEET_NAME = 'members_item_status';
const MIS_HEADERS = [
  'mis_id',        // 레코드 PK (UI 수정/삭제용)
  'member_id',     // 회원ID (적립 시점 스냅샷)
  'm_name',        // 회원명
  'm_name_id',     // 입찰담당자
  'myeongui',      // 선택 명의 1개 (items.m_name2)
  'item_id',       // 물건ID
  'in_date',       // 입찰일자 (items.in-date)
  'sakun_no',      // 사건번호
  'court',         // 법원
  'status',        // 추천 | 입찰 | 낙찰 | 불가
  'recorded_at',   // 적립 일시 (ISO)
  'lowest_price',  // 최저가 (items 연계)
  'bid_price',     // 입찰가 (items.bidprice 연계)
  'win_price',     // 낙찰가 (크롤러 매각가)
  'est_interior',  // 예상 인테리어비용 (낙찰건, 수동입력)
  'est_resale',    // 예상 매도가 (낙찰건, 수동입력)
  'event_date'     // 상태 실제 발생일: 추천=전달완료 시점(telegram B/chuchen_date) / 입찰=in_date / 불가·낙찰=이벤트 시점. recorded_at(적립시각)과 별개
];

/** in_date(YYMMDD/YYYYMMDD 등) → 'YYYY-MM-DD' 정규화 (event_date 입찰용) */
function _inDateToIso_(v) {
  var s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (s.length === 6) return '20' + s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
  if (s.length >= 8) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return String(v == null ? '' : v);
}

// - m_name2: "선택된 명의 표시값" (예: "(MJ) 한한한") — 화면 복원/리스트 표시에 사용
// - auction_id: "옥션 고유번호 (7자리)"
const ITEM_HEADERS = ['id', 'in-date', 'sakun_no', 'court', 'stu_member', 'm_name_id', 'm_name', 'bidprice', 'member_id', 'reg_date', 'reg_member', 'bid_state', 'image_id', 'note', 'm_name2', 'auction_id', 'chuchen_state', 'chuchen_date', 'class_d1_id', 'bid_datetime_2', 'items_youngdo', 'deposit', 'lowest_price'];
// chuchen_state:  Q열(idx 16) - '신규'|'전달완료'
// chuchen_date:   R열(idx 17) - 최근 전달 일시 (ISO string)
// class_d1_id:    S열(idx 18) - 수업 회차 ID (수업 물건 연결용)
// bid_datetime_2: T열(idx 19) - 최종 마감 일시 (yyMMddHHmm). 일반=chuchen_date+48h+토/일보정, 수업=회차값

// ============================================================================
// 마감일 보정 헬퍼 (서버) — js-app.html의 adjustFinalDeadline_ 와 동일 로직
// 토·일이면 다음 평일 14:00으로 이동 (공휴일은 보정 대상 아님)
// ============================================================================
function _isWeekend_(dt) {
  if (!dt || isNaN(dt.getTime())) return false;
  var w = dt.getDay();
  return w === 0 || w === 6;
}
function adjustFinalDeadline_(dt) {
  if (!dt || isNaN(dt.getTime())) return dt;
  var out = new Date(dt.getTime());
  var shifted = false;
  for (var i = 0; i < 2 && _isWeekend_(out); i++) {
    out.setDate(out.getDate() + 1);
    shifted = true;
  }
  if (shifted) out.setHours(14, 0, 0, 0);
  return out;
}
function _formatBd2_(dt) {
  if (!dt || isNaN(dt.getTime())) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyMMddHHmm');
}
// chuchen_date(ISO) + 48h + 토/일 보정 → bid_datetime_2 문자열 반환
function calcBidDatetime2FromChuchen_(chuchenDateIso) {
  if (!chuchenDateIso) return '';
  var d = new Date(chuchenDateIso);
  if (isNaN(d.getTime())) return '';
  d.setTime(d.getTime() + 48 * 3600 * 1000);
  return _formatBd2_(adjustFinalDeadline_(d));
}


// members 시트 헤더 정의 (2026-02 개편)
// Code.js에 정의된 MEMBER_HEADERS와 동일하게 유지
const ITEM_MEMBER_HEADERS = [
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
  'reg_id',
  'kakao_name',
  'teacher_nickname',  // AB열
  'teacher_color',     // AC열
  'name4_gubun', 'name4',   // AD~AE
  'name5_gubun', 'name5',   // AF~AG
  'name6_gubun', 'name6',   // AH~AI
  'name7_gubun', 'name7',   // AJ~AK
  'name8_gubun', 'name8',   // AL~AM
  'name9_gubun', 'name9',   // AN~AO
  'name10_gubun', 'name10'  // AP~AQ
];

const KAKAO_TEMPLATES_SHEET_NAME = 'kakao_templates';

// 수업 관리 헤더 (Code.js의 CLASS_HEADERS 사용)
// const CLASS_HEADERS_DB = ... (Removed to use global CLASS_HEADERS)

// 수업 회차 헤더 (Code.js의 CLASS_D1_HEADERS 사용)
// const CLASS_D1_HEADERS_DB = ... (Removed to use global CLASS_D1_HEADERS)

// 회원-수업 상세(출석) 헤더 (Code.js의 MEMBER_CLASS_DETAILS_HEADERS 사용)
// const MEMBER_CLASS_DETAILS_HEADERS_DB = ... (Removed to use global MEMBER_CLASS_DETAILS_HEADERS)

// 법원 코드 허용 목록 (하드코딩, 법원.txt 기준)
const COURT_CODES = ['공매', '인천', '서울중앙', '서울동부', '서울서부', '서울남부', '서울북부', '의정부', '의정부고양', '의정부남양주', '인천부천', '수원', '수원성남', '수원평택', '수원안산', '수원안양', '수원여주', '춘천', '춘천강릉', '춘천원주', '춘천속초', '춘천영월', '대전', '대전홍성', '대전공주', '대전논산', '대전서산', '대전천안', '청주', '청주충주', '청주제천', '청주영동', '대구', '대구서부', '대구안동', '대구경주', '대구포항', '대구김천', '대구상주', '대구의성', '대구영덕', '부산', '부산동부', '부산서부', '울산', '창원', '창원마산', '창원진주', '창원통영', '창원밀양', '창원거창', '광주', '광주목포', '광주장흥', '광주순천', '광주해남', '전주', '전주군산', '전주정읍', '전주남원', '제주'];

/**
 * 법원 허용 목록을 반환합니다. (프론트 자동완성·검증용)
 */
function getCourtList() {
  return COURT_CODES;
}

function isAllowedCourt_(court) {
  if (!court || typeof court !== 'string') return false;
  var t = String(court).trim();
  return COURT_CODES.indexOf(t) !== -1;
}

/**
 * 등록된 회원인지 확인합니다. (member_name 기준)
 */
function isValidMemberName_(mName) {
  if (!mName) return false;
  const members = readAllMembers();
  const inputFull = String(mName).trim();
  // "(MJ) 임준희" 또는 "MJ 임준희 (클래스) 명의" 형식에서 앞의 괄호 prefix 제거 후 첫 단어 추출
  const cleanInput = inputFull.replace(/^\([^)]+\)\s*/, '').split(/[\s(]/)[0].trim();
  return members.some(m => {
    const name = String(m.member_name || '').trim();
    // 전체 일치 또는 첫 단어 기준 일치
    if (name === inputFull) return true;
    const cleanName = name.replace(/^\([^)]+\)\s*/, '').split(/[\s(]/)[0].trim();
    return cleanName && cleanInput && cleanName === cleanInput;
  });
}

/**
 * items 시트의 모든 데이터를 읽어옵니다. (안전 모드 적용)
 */
function readAllData() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // [핵심 수정] 물리적인 열 개수를 확인하여 에러 방지
  const maxCols = sheet.getMaxColumns();
  // 필요한 열까지만 읽음 (+4: chuchen_read(X=24)/chuchen_read_date(Y=25) + stu_reason(Z=26)/stu_reason_detail(AA=27) 는 ITEM_HEADERS 외 추가 컬럼)
  const colsToRead = Math.min(maxCols, ITEM_HEADERS.length + 4);

  if (colsToRead < 1) return [];

  // 데이터 범위 읽기
  const dataRange = sheet.getRange(2, 1, lastRow - 1, colsToRead);
  const values = dataRange.getValues();

  // item_images 시트에서 이미지가 있는 item_id 목록을 미리 조회
  const imagesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('item_images');
  const itemsWithImages = new Set();
  if (imagesSheet) {
    const imagesLastRow = imagesSheet.getLastRow();
    if (imagesLastRow >= 2) {
      const imagesData = imagesSheet.getRange(2, 1, imagesLastRow - 1, 1).getValues(); // item_id 컬럼만
      imagesData.forEach(row => {
        if (row[0]) itemsWithImages.add(String(row[0]).trim());
      });
    }
  }

  // members_note(회원전달내용) — ITEM_HEADERS 외 끝열, 헤더명으로 위치 탐색 후 부착 (기존 매핑 불변)
  let _mnCol = -1;
  try {
    const _hdr = sheet.getRange(1, 1, 1, maxCols).getValues()[0];
    for (let _c = 0; _c < _hdr.length; _c++) { if (String(_hdr[_c]).trim() === 'members_note') { _mnCol = _c + 1; break; } }
  } catch (e) {}
  const _mnVals = (_mnCol > 0) ? sheet.getRange(2, _mnCol, lastRow - 1, 1).getValues() : null;

  return values.map((row, _ri) => {
    let rowData = {};

    // 0~10번 인덱스 매핑
    rowData['id'] = row[0];
    rowData['in-date'] = formatParamsDate(row[1]);
    rowData['sakun_no'] = row[2];
    rowData['court'] = row[3];
    rowData['stu_member'] = row[4];
    rowData['m_name_id'] = row[5];
    rowData['m_name'] = row[6];
    rowData['bidprice'] = row[7];
    rowData['member_id'] = row[8];
    rowData['reg_date'] = formatParamsDate(row[9], 'yyyy-MM-dd');
    rowData['reg_member'] = row[10];

    // [중요] 12번째 열(11번 인덱스)이 없으면 빈 값으로 처리하여 에러 방지
    rowData['bid_state'] = (row.length > 11) ? (row[11] || '') : '';
    // [추가] 13번째 열(12번 인덱스) image_id 매핑
    rowData['image_id'] = (row.length > 12) ? (row[12] || '') : '';
    // [추가] 14번째 열(13번 인덱스) note(비고) 매핑
    rowData['note'] = (row.length > 13) ? (row[13] || '') : '';
    // [추가] members_note(회원전달내용) — 끝열, 텔레그램/카카오 [물건전달사항]
    rowData['members_note'] = _mnVals ? String((_mnVals[_ri] && _mnVals[_ri][0]) || '') : '';
    // [추가] 15번째 열(14번 인덱스) m_name2(명의 표시값) 매핑
    rowData['m_name2'] = (row.length > 14) ? (row[14] || '') : '';
    // [추가] 16번째 열(15번 인덱스) auction_id 매핑
    rowData['auction_id'] = (row.length > 15) ? (row[15] || '') : '';
    // [추가] 17번째 열(16번 인덱스) chuchen_state 매핑
    rowData['chuchen_state'] = (row.length > 16) ? (row[16] || '') : '';
    // [추가] 18번째 열(17번 인덱스) chuchen_date 매핑
    rowData['chuchen_date'] = (row.length > 17) ? (row[17] || '') : '';
    // [추가] 19번째 열(18번 인덱스) class_d1_id 매핑
    rowData['class_d1_id'] = (row.length > 18) ? (row[18] || '') : '';
    // [추가] 20번째 열(19번 인덱스) bid_datetime_2 매핑 (Date 객체 → 문자열 변환)
    if (row.length > 19 && row[19]) {
      var bd2v = row[19];
      rowData['bid_datetime_2'] = (bd2v instanceof Date)
        ? (isNaN(bd2v.getTime()) ? '' : Utilities.formatDate(bd2v, Session.getScriptTimeZone(), 'yyMMddHHmm'))
        : String(bd2v);
    } else {
      rowData['bid_datetime_2'] = '';
    }
    // [추가] 21번째 열(20번 인덱스, U열) items_youngdo (물건용도) 매핑
    rowData['items_youngdo'] = (row.length > 20) ? String(row[20] || '').trim() : '';
    // [추가] 22번째 열(21번 인덱스, V열) deposit (보증금) 매핑
    rowData['deposit'] = (row.length > 21) ? (row[21] || '') : '';
    // [추가] 23번째 열(22번 인덱스, W열) lowest_price (최저가) 매핑
    rowData['lowest_price'] = (row.length > 22) ? (row[22] || '') : '';
    // [추가] 24번째 열(23번 인덱스, X열) chuchen_read (추천 읽음여부: '미읽음'|'읽음') 매핑
    rowData['chuchen_read'] = (row.length > 23) ? String(row[23] || '').trim() : '';
    // [추가] 25번째 열(24번 인덱스, Y열) chuchen_read_date (추천 확인 일시 ISO) 매핑
    rowData['chuchen_read_date'] = (row.length > 24) ? (row[24] || '') : '';
    // [추가] 26번째 열(25번 인덱스, Z열) stu_reason (불가사유: 변경/취소/기각/취하/정지/연기) 매핑
    rowData['stu_reason'] = (row.length > 25) ? String(row[25] || '').trim() : '';
    // [추가] 27번째 열(26번 인덱스, AA열) stu_reason_detail (불가/폐기 사유 상세) 매핑
    rowData['stu_reason_detail'] = (row.length > 26) ? (row[26] || '') : '';

    // [추가] item_images 테이블에 이미지가 있는지 확인
    rowData['has_images'] = itemsWithImages.has(String(row[0]).trim());

    return rowData;
  });
}

/**
 * stu_reason(Z=26) / stu_reason_detail(AA=27) 컬럼이 물리적으로 존재하도록 보장.
 * ITEM_HEADERS(1~23) + chuchen_read/date(24,25) 뒤에 append. 기존 열은 절대 건드리지 않음.
 * 헤더 셀이 비어 있을 때만 라벨 설정(덮어쓰지 않음).
 */
function ensureItemReasonColumns_() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: 'items 시트 없음' };
  var maxCols = sheet.getMaxColumns();
  if (maxCols < 27) {
    sheet.insertColumnsAfter(maxCols, 27 - maxCols);
  }
  var hdr = sheet.getRange(1, 26, 1, 2).getValues()[0];
  if (!String(hdr[0] || '').trim()) sheet.getRange(1, 26).setValue('stu_reason');
  if (!String(hdr[1] || '').trim()) sheet.getRange(1, 27).setValue('stu_reason_detail');
  SpreadsheetApp.flush();
  return { success: true, maxCols: sheet.getMaxColumns() };
}

/**
 * 한 물건의 불가/폐기 사유(stu_reason=Z=26) + 상세(stu_reason_detail=AA=27)만 저장.
 * id 로 행을 찾아 26/27 열만 기록. 기존 열 무손상.
 */
function saveItemReason(itemId, reason, detail) {
  try {
    var id = String(itemId || '').trim();
    if (!id) return { success: false, message: 'id 필요' };
    ensureItemReasonColumns_();
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음' };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '데이터 없음' };
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        var rowNum = i + 2;
        sheet.getRange(rowNum, 26).setValue(String(reason || ''));
        sheet.getRange(rowNum, 27).setValue(String(detail || ''));
        SpreadsheetApp.flush();
        return { success: true, id: id, stu_reason: String(reason || ''), stu_reason_detail: String(detail || '') };
      }
    }
    return { success: false, message: '해당 id 없음: ' + id };
  } catch (e) {
    Logger.log('[saveItemReason] ' + e);
    return { success: false, message: String(e) };
  }
}

/**
 * 날짜 포맷팅 헬퍼 함수
 */
function formatParamsDate(value, format = 'yyMMdd') {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), format);
  }
  return value;
}

/**
 * 새로운 입찰 물건 데이터를 생성합니다.
 */
function createData(inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, bidState, imageId, note, mName2, chuchenState, regMember, auctionId, itemsYongdo) {
  // [동시성] 스크립트 락으로 중복 생성(같은 키 2행) 방지 — 중복검사~appendRow를 직렬화
  var __lock = LockService.getScriptLock();
  try { __lock.waitLock(20000); } catch (e) { return { success: false, message: '저장이 혼잡합니다. 잠시 후 다시 시도해 주세요.' }; }
  try {
    return _createDataImpl(inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, bidState, imageId, note, mName2, chuchenState, regMember, auctionId, itemsYongdo);
  } finally {
    __lock.releaseLock();
  }
}
function _createDataImpl(inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, bidState, imageId, note, mName2, chuchenState, regMember, auctionId, itemsYongdo) {
  if (!isAllowedCourt_(court)) return { success: false, message: '허용되지 않은 법원입니다.' };

  // 추천, 입찰만 회원명 필수 / 나머지 상태는 회원명 없어도 허용
  const isRequiredMemberStatus = (stuMember === '추천' || stuMember === '입찰');
  if (isRequiredMemberStatus) {
    if (!isValidMemberName_(mName)) return { success: false, message: '등록된 회원이 아닙니다.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };
  // [방어 코드] 쓰기 전에 16번째 열(auction_id)까지 확보
  ensureColumnExists(sheet, 16);

  // [중복 체크] 동일 입찰일자+사건번호+법원명 존재 여부 확인 (B,C,D열만 읽어 속도 최적화)
  const dupLastRow = sheet.getLastRow();
  if (dupLastRow > 1) {
    const dupRows = sheet.getRange(2, 1, dupLastRow - 1, 4).getValues(); // A=id, B=in-date, C=sakun_no, D=court
    var _dupConflict = null;
    for (var _di = 0; _di < dupRows.length; _di++) {
      var _r = dupRows[_di];
      if (String(_r[1]) === String(inDate) &&
          String(_r[2]).trim() === String(sakunNo).trim() &&
          String(_r[3]).trim() === String(court).trim()) { _dupConflict = _r; break; }
    }
    if (_dupConflict) {
      Logger.log('[DUP:신규] inDate=' + inDate + ' sakun=' + sakunNo + ' court=' + court + ' / 충돌ID=' + _dupConflict[0]);
      return { success: false, message: '이미 동일한 입찰일자/사건번호/법원명으로 등록된 물건이 있습니다.' };
    }
  }

  const id = new Date().getTime().toString();
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // [PHASE 1-4] 물건 생성 이력 기록 (배치 처리로 속도 대폭 개선)
  const createBatchTs = String(new Date().getTime());
  const historyEntries = [];

  // 메인 생성 이벤트
  historyEntries.push({
    action: 'ITEM_CREATE',
    item_id: id,
    member_id: String(memberId || ''),
    member_name: String(mName || ''),
    trigger_type: 'web',
    note: court + ' ' + sakunNo,
    req_id: createBatchTs
  });

  // 초기 값 기록
  const initialValues = {
    stu_member: String(stuMember || '').trim(),
    m_name_id: String(mNameId || '').trim(),
    m_name: String(mName || '').trim(),
    bidprice: String(bidPrice || '').trim(),
    member_id: String(memberId || '').trim(),
    bid_state: String(bidState || '').trim()
  };

  const trackFields = ['stu_member', 'm_name_id', 'm_name', 'bidprice', 'member_id', 'bid_state'];
  trackFields.forEach(function (field) {
    if (initialValues[field] !== '') {
      historyEntries.push({
        action: 'ITEM_CREATE',
        item_id: String(id),
        member_id: initialValues.member_id,
        member_name: initialValues.m_name,
        field_name: field,
        from_value: '',
        to_value: initialValues[field],
        trigger_type: 'web',
        note: '최초 등록 값',
        req_id: createBatchTs
      });
    }
  });

  // [BATCH] 일괄 이력 저장
  writeItemHistoryBatch_(historyEntries);

  // Prepare the new row data (Mapping arguments to ITEM_HEADERS structure)
  const newRow = ITEM_HEADERS.map(header => {
    if (header === 'id') return id;
    if (header === 'in-date') return inDate;
    if (header === 'sakun_no') return sakunNo;
    if (header === 'court') return court;
    if (header === 'stu_member') return stuMember;
    if (header === 'm_name_id') return mNameId;
    if (header === 'm_name') return mName;
    if (header === 'bidprice') return bidPrice;
    if (header === 'member_id') return memberId;
    if (header === 'reg_date') return regDate;
    if (header === 'reg_member') return regMember || '';
    if (header === 'bid_state') return bidState;
    if (header === 'image_id') return imageId || '';
    if (header === 'note') return note || '';
    if (header === 'm_name2') return mName2 || '';
    if (header === 'auction_id') return auctionId || '';
    if (header === 'chuchen_state') return chuchenState || '';
    if (header === 'chuchen_date') return '';
    if (header === 'items_youngdo') return String(itemsYongdo || '').trim();
    return '';
  });

  sheet.appendRow(newRow);
  SpreadsheetApp.flush(); // 커밋 확정 (락 해제 전)

  // 생성된 데이터 객체 반환 (프론트엔드 로컬 캐시 갱신용)
  var createdItem = {};
  ITEM_HEADERS.forEach((header, index) => {
    createdItem[header] = newRow[index];
  });
  if (typeof formatParamsDate === 'function') {
    createdItem['in-date'] = formatParamsDate(newRow[1]);
    createdItem['reg_date'] = formatParamsDate(newRow[9], 'yyyy-MM-dd');
  }

  return { success: true, message: '성공적으로 등록되었습니다.', data: createdItem };
}

/**
 * 기존 입찰 물건 데이터를 수정합니다.
 */
function updateData(id, inDate, sakunNo, court, stuMember, mName, bidPrice, mNameId, note, memberId, bidState, chuchenState, imageId, regMember, mName2, auctionId, itemsYongdo, stuReason, stuReasonDetail) {
  // [동시성] 스크립트 락으로 read-modify-write 직렬화 — 동시 저장 유실/유령 중복 방지
  var __lock = LockService.getScriptLock();
  try { __lock.waitLock(20000); } catch (e) { return { success: false, message: '저장이 혼잡합니다. 잠시 후 다시 시도해 주세요.' }; }
  try {
    return _updateDataImpl(id, inDate, sakunNo, court, stuMember, mName, bidPrice, mNameId, note, memberId, bidState, chuchenState, imageId, regMember, mName2, auctionId, itemsYongdo, stuReason, stuReasonDetail);
  } finally {
    __lock.releaseLock();
  }
}
function _updateDataImpl(id, inDate, sakunNo, court, stuMember, mName, bidPrice, mNameId, note, memberId, bidState, chuchenState, imageId, regMember, mName2, auctionId, itemsYongdo, stuReason, stuReasonDetail) {
  if (!isAllowedCourt_(court)) return { success: false, message: '허용되지 않은 법원입니다.' };

  // 추천, 입찰만 회원명 필수 / 나머지 상태는 회원명 없어도 허용
  const isRequiredMemberStatus = (stuMember === '추천' || stuMember === '입찰');
  if (isRequiredMemberStatus) {
    if (!isValidMemberName_(mName)) return { success: false, message: '등록된 회원이 아닙니다.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };
  // [방어 코드] 17번째 열(chuchen_state)까지 확보
  ensureColumnExists(sheet, 17);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  // ID 검색 (createTextFinder 사용으로 12k+ 행 조회 성능 최적화)
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(id)).matchEntireCell(true);
  const match = finder.findNext();

  if (!match) {
    return { success: false, message: '해당 ID의 데이터를 찾을 수 없습니다.' };
  }

  const realRowIndex = match.getRow();

  // [PHASE 1-3] 저장 전: 기존 값 읽기 (변경 감지용) - T열(20)까지 읽기 (class_d1_id, bid_datetime_2 포함)
  const range = sheet.getRange(realRowIndex, 1, 1, ITEM_HEADERS.length); // A~T 한 번에 처리
  const rowValues = range.getValues()[0];
  const oldValues = {
    inDate: String(rowValues[1] || '').trim(), // B
    sakunNo: String(rowValues[2] || '').trim(), // C
    court: String(rowValues[3] || '').trim(), // D
    stu_member: String(rowValues[4] || '').trim(), // E
    m_name_id: String(rowValues[5] || '').trim(), // F
    m_name: String(rowValues[6] || '').trim(), // G
    bidprice: String(rowValues[7] || '').trim(), // H
    member_id: String(rowValues[8] || '').trim(), // I
    reg_member: String(rowValues[10] || '').trim(), // K
    bid_state: String(rowValues[11] || '').trim(), // L
    image_id: String(rowValues[12] || '').trim(), // M
    note: String(rowValues[13] || '').trim(), // N
    m_name_2: String(rowValues[14] || '').trim(), // O
    auction_id: String(rowValues[15] || '').trim(), // P
    chuchen_state: String(rowValues[16] || '').trim(), // Q
    chuchen_date: String(rowValues[17] || '').trim(), // R
    class_d1_id: String(rowValues[18] || '').trim(), // S
    bid_datetime_2: String(rowValues[19] || '').trim(), // T
  };

  // 신규 값 배열 생성 (메모리상 업데이트)
  const newRowValues = [...rowValues];
  newRowValues[1] = inDate;
  newRowValues[2] = sakunNo;
  newRowValues[3] = court;
  newRowValues[4] = stuMember;
  newRowValues[5] = mNameId;
  newRowValues[6] = mName;
  newRowValues[7] = bidPrice;
  newRowValues[8] = memberId;

  if (regMember) newRowValues[10] = regMember;
  newRowValues[11] = bidState;

  if (imageId) {
    newRowValues[12] = imageId;
  } else if (!imageId && oldValues.image_id) {
    // 삭제 방지
  } else {
    newRowValues[12] = '';
  }

  newRowValues[13] = note || '';
  newRowValues[14] = mName2 || '';

  if (auctionId) {
    newRowValues[15] = auctionId;
  } else if (!auctionId && oldValues.auction_id) {
    // 삭제 방지
  } else {
    newRowValues[15] = '';
  }

  const newChuchenState = String(chuchenState || '').trim();
  const newStuMemberVal = String(stuMember || '').trim();
  const newMNameVal = String(mName || '').trim();
  const oldMNameVal = String(oldValues.m_name || '').trim();
  const oldClassD1IdVal = String(oldValues.class_d1_id || '').trim();

  // 초기화 조건: stu_member(=물건상태) 변경 OR m_name(회원명) 변경 → 4키 룰 깨뜨림
  // 정책: 추천 → 다른 상태(상품/미정/입찰/취소/검증) 전환은 chuchen만 정리, 회차/마감은 보존
  //   - 타이머 바는 4키 룰의 stu==='추천' 깨져서 자동 사라짐
  //   - class_d1_id/bid_datetime_2 보존 → 수업관리 회차/물건리스트 + 입찰일정에 그대로 표시
  //   - 회원명(m_name)이 바뀌면 회차 자체를 끊어야 하므로 그땐 4키 모두 클리어
  const isFromRecommendToOther = (oldValues.stu_member === '추천' && newStuMemberVal !== '추천');
  const stuMemberChanged =
    (oldValues.stu_member !== '추천' && newStuMemberVal === '추천') ||
    (oldValues.stu_member === '입찰' && (newStuMemberVal === '미정' || newStuMemberVal === '상품'));
  const mNameChanged = (oldMNameVal !== newMNameVal);
  const shouldResetChuchen = stuMemberChanged || mNameChanged;

  const actualSavedChuchenState = shouldResetChuchen ? '' : newChuchenState;

  if (shouldResetChuchen) {
    // chuchen_state/date + bid_datetime_2만 클리어. class_d1_id(S)는 보존
    // — 상태/회원명이 바뀌어도 회차 연결 유지. class_d1_id는 수업관리 물건탭 등록/추가/제거에서만 변경
    newRowValues[16] = ''; // Q: chuchen_state
    newRowValues[17] = ''; // R: chuchen_date
    newRowValues[19] = ''; // T: bid_datetime_2
  } else if (isFromRecommendToOther) {
    // 추천 → 상품/미정/입찰/취소/검증: chuchen_state/date + bid_datetime_2 클리어, class_d1_id만 보존
    //   - 타이머 바·마감 카운트다운 안 보임 (4키 깨짐)
    //   - 수업관리 물건리스트엔 그대로 (class_d1_id 살아있음)
    //   - 다시 추천 상태로 돌릴 때 새 bid_datetime_2 입력 강제 → 옛 마감 시점과 혼동 방지
    newRowValues[16] = ''; // chuchen_state
    newRowValues[17] = ''; // chuchen_date
    newRowValues[19] = ''; // bid_datetime_2
  } else if (newChuchenState) {
    newRowValues[16] = newChuchenState;
    if (newChuchenState === '신규') {
      newRowValues[17] = ''; // 신규로 변경 시 chuchen_date 클리어
      if (!oldClassD1IdVal) newRowValues[19] = ''; // bid_datetime_2 클리어 (일반만, 수업회차는 회차 데이터 유지)
    } else if (newChuchenState === '전달완료' && oldValues.chuchen_state !== '전달완료') {
      // 신규/null → 전달완료: chuchen_date 갱신 + bid_datetime_2 자동 계산 (일반 케이스만)
      const nowIso = new Date().toISOString();
      newRowValues[17] = nowIso; // R: chuchen_date
      if (!oldClassD1IdVal) {
        const bd2 = calcBidDatetime2FromChuchen_(nowIso);
        if (bd2) newRowValues[19] = bd2; // T: bid_datetime_2
      }
    }
  }

  // [추가] 회원변경(회원명 변경) 시: bid_state + class_d1_id + bid_datetime_2 초기화
  //   - 회원이 바뀌면 회차 연결(class_d1_id)까지 끊고 입찰상태도 리셋
  //   - bidState 변수까지 비워 히스토리/텔레그램(전달완료 자동발송) 판정에도 반영
  //   - chuchen_state/date(Q/R)는 위 shouldResetChuchen 분기에서 이미 클리어됨
  if (mNameChanged) {
    bidState = '';
    newRowValues[11] = ''; // L: bid_state
    newRowValues[18] = ''; // S: class_d1_id
    newRowValues[19] = ''; // T: bid_datetime_2
  }

  // [추가] 추천/입찰 → 미정 전환 시: bid_state 초기화 (class_d1_id 는 보존)
  const _toUndeterminedFromRecOrBid =
    (newStuMemberVal === '미정') &&
    (oldValues.stu_member === '추천' || oldValues.stu_member === '입찰');
  if (_toUndeterminedFromRecOrBid) {
    bidState = '';
    newRowValues[11] = ''; // L: bid_state
  }

  // [추가] items_youngdo (U열) — 클라이언트에서 값을 넘긴 경우에만 갱신, 아니면 기존값 유지
  if (typeof itemsYongdo !== 'undefined' && itemsYongdo !== null) {
    newRowValues[20] = String(itemsYongdo).trim();
  }

  // [중복 체크] 자기 자신 제외하고 동일 키 존재 여부 확인 (A,B,C,D열만 읽어 속도 최적화)
  {
    const dupLastRow = sheet.getLastRow();
    if (dupLastRow > 1) {
      const dupRows = sheet.getRange(2, 1, dupLastRow - 1, 4).getValues(); // A=id, B=in-date, C=sakun_no, D=court
      var _dupConflict = null;
      for (var _di = 0; _di < dupRows.length; _di++) {
        var _r = dupRows[_di];
        if (String(_r[0]) === String(id)) continue; // 자기 자신 제외
        if (String(_r[1]) === String(inDate) &&
            String(_r[2]).trim() === String(sakunNo).trim() &&
            String(_r[3]).trim() === String(court).trim()) { _dupConflict = _r; break; }
      }
      if (_dupConflict) {
        Logger.log('[DUP:수정] 제출ID=' + id + ' inDate=' + inDate + ' sakun=' + sakunNo + ' court=' + court + ' / 충돌ID=' + _dupConflict[0]);
        return { success: false, message: '이미 동일한 입찰일자/사건번호/법원명으로 등록된 물건이 있습니다.' };
      }
    }
  }

  // [BATCH] 일괄 저장 (setValue 10여 회 -> setValues 1회로 단축)
  range.setValues([newRowValues]);

  // [추가] chuchen 끊김(회원변경 or 추천이탈/상태변경) 시 추천 읽음표시 초기화
  //   - chuchen_read(X=24)/chuchen_read_date(Y=25)는 ITEM_HEADERS(A~W) 밖이라 별도 셀 기록
  //   - 중복체크 early-return 이후, 저장 확정(setValues) 뒤에 기록 → 부분 손상 방지
  if (shouldResetChuchen || isFromRecommendToOther) {
    if (sheet.getMaxColumns() >= 25) {
      sheet.getRange(realRowIndex, 24, 1, 2).setValues([['', '']]); // X: chuchen_read, Y: chuchen_read_date
    }
  }

  // [통합] 불가/폐기 사유(Z=26/AA=27) — 클라이언트가 값을 넘긴 경우에만 기록 (undefined=보존)
  //   기존 병렬 saveItemReason 호출 제거 → 한 저장 = 한 행 단일 쓰기(락 안에서 원자적)
  if (typeof stuReason !== 'undefined' && stuReason !== null) {
    ensureItemReasonColumns_();
    sheet.getRange(realRowIndex, 26, 1, 2).setValues([[String(stuReason || ''), String(stuReasonDetail || '')]]);
  }

  // [PHASE 1-4] 변경 감지 및 히스토리 기록 (배치 처리)
  const updateBatchTs = String(new Date().getTime());
  const historyEntries = [];
  const trackFields = {
    'stu_member': stuMember,
    'm_name_id': mNameId,
    'm_name': mName,
    'bidprice': bidPrice,
    'member_id': memberId,
    'bid_state': bidState,
    'chuchen_state': newRowValues[16], // Use the value that was actually saved
    'note': (note || '').trim()
  };

  Object.keys(trackFields).forEach(function (field) {
    const newVal = String(trackFields[field] || '').trim();
    const oldVal = String(oldValues[field] || '').trim(); // Ensure oldVal is also trimmed for comparison

    // [보정] bidprice는 콤마 제거 후 숫자만 비교 (문자열 콤마 유무에 따른 중복 로그 방지)
    if (field === 'bidprice') {
      const ovNum = String(oldVal || '').replace(/[^0-9]/g, '');
      const nvNum = String(newVal || '').replace(/[^0-9]/g, '');
      // [보정] 빈값("")과 "0"은 실질적으로 동일한 '가격 없음'으로 간주하여 중복 로그 방지
      if ((ovNum === '' || ovNum === '0') && (nvNum === '' || nvNum === '0')) {
        return; // Skip logging if both are effectively 'no price'
      }
      if (ovNum === nvNum) return; // If numeric values are the same, skip
    }

    if (oldVal !== newVal) {
      historyEntries.push({
        action: 'FIELD_CHANGE',
        item_id: String(id),
        member_id: String(memberId || ''),
        member_name: String(mName || ''),
        field_name: field,
        from_value: oldVal,
        to_value: newVal,
        trigger_type: 'web',
        req_id: updateBatchTs
      });
    }
  });

  if (historyEntries.length > 0) {
    writeItemHistoryBatch_(historyEntries);
  }

  // [기능 추가] 상태가 '전달완료'로 변경될 때 텔레그램 자동 발송
  if (bidState === '전달완료' && oldValues.bid_state !== '전달완료') {
    try {
      if (typeof sendItemToMemberTelegramWithStyle === 'function') {
        const result = sendItemToMemberTelegramWithStyle(memberId, id, 'bid_price');
        if (!result.success) {
          Logger.log(`자동 텔레그램 전송 실패 (ID:${id}): ` + result.message);
          return { success: true, message: '수정되었으나 텔레그램 전송에 실패했습니다: ' + result.message };
        }
      } else {
        Logger.log('sendItemToMemberTelegramWithStyle 함수를 찾을 수 없습니다.');
      }
    } catch (e) {
      Logger.log(`자동 텔레그램 전송 중 오류 (ID:${id}): ` + e.message);
      return { success: true, message: '수정되었으나 텔레그램 전송 중 오류가 발생했습니다.' };
    }
  }

  // [재조회] 저장 확정 후 시트 실제값을 다시 읽어 반환 — "의도값"이 아닌 "시트 진실"을 프론트에 전달
  //   → 백엔드 파생필드 클리어/사유까지 화면=시트 100% 일치 보장 (잔재 구조적 제거)
  SpreadsheetApp.flush();
  var verifyRow = sheet.getRange(realRowIndex, 1, 1, ITEM_HEADERS.length).getValues()[0]; // A~W
  var updatedItem = {};
  ITEM_HEADERS.forEach((header, index) => {
    updatedItem[header] = verifyRow[index];
  });
  if (sheet.getMaxColumns() >= 27) {
    var reasonRow = sheet.getRange(realRowIndex, 26, 1, 2).getValues()[0]; // Z/AA
    updatedItem['stu_reason'] = reasonRow[0];
    updatedItem['stu_reason_detail'] = reasonRow[1];
  }
  if (typeof formatParamsDate === 'function') {
    updatedItem['in-date'] = formatParamsDate(verifyRow[1]);
    updatedItem['reg_date'] = formatParamsDate(verifyRow[9], 'yyyy-MM-dd');
  }

  // 데이터 변경 → 해당 회원 캐시 무효화
  invalidateMemberItemsCache_(memberId);
  if (oldValues.member_id && oldValues.member_id !== String(memberId || '')) {
    invalidateMemberItemsCache_(oldValues.member_id); // 회원 변경 시 이전 회원 캐시도 무효화
  }

  return { success: true, message: '성공적으로 수정되었습니다.', data: updatedItem };
}

/**
 * 여러 물건의 상태(stu_member)를 일괄 변경합니다.
 * @param {Array} ids - 물건 ID 배열
 * @param {string} newStatus - 신규 상태값
 * @return {Object} {success: boolean, count: number, message: string}
 */
function updateBulkStatus(ids, newStatus) {
  if (!ids || !ids.length) return { success: false, message: '선택된 항목이 없습니다.' };

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  const allIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  let updatedCount = 0;

  const newStatusVal = String(newStatus || '').trim();
  ids.forEach(id => {
    const idx = allIds.findIndex(v => String(v) === String(id));
    if (idx >= 0) {
      const rowNum = idx + 2;
      const curStu = String(sheet.getRange(rowNum, 5).getValue() || '').trim();
      const stuChanged = (curStu === '추천' && newStatusVal !== '추천') ||
                         (curStu !== '추천' && newStatusVal === '추천');

      sheet.getRange(rowNum, 5).setValue(newStatusVal); // E: stu_member

      if (stuChanged) {
        // chuchen_state/date + bid_datetime_2만 클리어. class_d1_id(S)는 보존
        // — 상태가 바뀌어도 회차 연결 유지. class_d1_id는 수업관리 물건탭 등록/추가/제거에서만 변경
        sheet.getRange(rowNum, 17).setValue(''); // Q: chuchen_state
        sheet.getRange(rowNum, 18).setValue(''); // R: chuchen_date
        sheet.getRange(rowNum, 20).setValue(''); // T: bid_datetime_2
      }
      updatedCount++;
    }
  });

  SpreadsheetApp.flush();
  return { success: true, count: updatedCount, message: `${updatedCount}건의 상태가 성공적으로 변경되었습니다.` };
}

/**
 * 회원이 입찰가를 확인했음을 서버에 기록합니다.
 * @param {string} memberToken - 회원 토큰 (권한 검증용)
 * @param {string} itemId - 물건 ID
 * @return {Object} {success: boolean, message: string}
 */
function updateBidPriceConfirmed(memberToken, itemId) {
  if (!memberToken || !itemId) {
    return { success: false, message: '요청 정보가 올바르지 않습니다.' };
  }

  // 1. 회원 검증
  const member = getMemberByToken(memberToken);
  if (!member) {
    return { success: false, message: '유효하지 않은 회원 토큰입니다.' };
  }

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  // 2. 해당 물건 찾기 (단일 조회 최적화)
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(itemId)).matchEntireCell(true);
  const match = finder.findNext();

  if (!match) {
    return { success: false, message: '해당 물건을 찾을 수 없습니다.' };
  }

  const rowIndex = match.getRow();

  // 3. 해당 물건이 이 회원과 관련 있는지 확인 (선택적)
  // 현재 구조상 member_id 컬럼과 대조하거나, 최소한 담당 회원이 지정된 건인지 확인.
  // 9번째 열(I열)이 member_id
  const itemMemberId = String(sheet.getRange(rowIndex, 9).getValue()).trim();
  if (itemMemberId && itemMemberId !== String(member.member_id).trim()) {
    Logger.log(`권한 불일치: 회원(${member.member_id})이 다른 회원의 물건(${itemId})에 접근 시도`);
    // 보안상 여기서 거절할 수 있으나, 기존 동작과 일치하도록 로깅만 남기거나 에러 반환.
    // return { success: false, message: '해당 물건에 대한 권한이 없습니다.' };
  }

  // 4. 상태 업데이트
  // 12번째 열(L열)이 bid_state
  const oldState = String(sheet.getRange(rowIndex, 12).getValue() || '').trim();
  sheet.getRange(rowIndex, 12).setValue('확인완료');
  SpreadsheetApp.flush();

  // 5. 히스토리 로깅 (PRICE_CONFIRMED)
  if (oldState !== '확인완료' && typeof writeItemHistory_ === 'function') {
    try {
      writeItemHistory_({
        action: 'PRICE_CONFIRMED',
        item_id: String(itemId),
        member_id: member.member_id,
        member_name: member.member_name,
        trigger_type: 'system',
        field_name: 'bid_state',
        from_value: oldState,
        to_value: '확인완료',
        note: '입찰가 확인'
      });
    } catch (e) {
      Logger.log('입찰가확인 로깅 실패: ' + e.toString());
    }
  }

  return { success: true, message: '입찰가 확인 처리가 완료되었습니다.' };
}

/**
 * 회원 앱에서 입찰가 터치 시: 텔레그램으로 전체 가격 전송 + bid_state 확인완료 처리
 * @param {string} memberToken - 회원 토큰 (권한 검증용)
 * @param {string} itemId - 물건 ID
 * @return {Object} {success: boolean, message: string}
 */
function confirmBidPriceWithTelegramReply(memberToken, itemId) {
  if (!memberToken || !itemId) {
    return { success: false, message: '요청 정보가 올바르지 않습니다.' };
  }

  // 1. 회원 검증
  const member = getMemberByToken(memberToken);
  if (!member) {
    return { success: false, message: '유효하지 않은 회원 토큰입니다.' };
  }

  // 2. 물건 정보 조회
  const item = (typeof getItemLiteById_ === 'function') ? getItemLiteById_(String(itemId)) : null;
  if (!item) {
    return { success: false, message: '물건 정보를 찾을 수 없습니다.' };
  }

  // 2-1. 물건 상태 검증: 입찰 상태인 경우에만 입찰가 확인 허용
  const itemStatus = String(item.stu_member || '').trim();
  if (itemStatus !== '입찰') {
    return { success: false, message: '입찰 상태인 물건만 입찰가를 확인할 수 있습니다.' };
  }

  // 3. 시트에서 해당 물건 찾아 bid_state 확인완료로 업데이트
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(itemId)).matchEntireCell(true);
  const match = finder.findNext();
  if (!match) {
    return { success: false, message: '해당 물건을 찾을 수 없습니다.' };
  }

  const rowIndex = match.getRow();
  const oldState = String(sheet.getRange(rowIndex, 12).getValue() || '').trim();
  sheet.getRange(rowIndex, 12).setValue('확인완료');
  SpreadsheetApp.flush();

  // 3.5 히스토리 로깅 (PRICE_CONFIRMED)
  if (oldState !== '확인완료' && typeof writeItemHistory_ === 'function') {
    try {
      writeItemHistory_({
        action: 'PRICE_CONFIRMED',
        item_id: String(itemId),
        member_id: member.member_id,
        member_name: member.member_name,
        trigger_type: 'member-telegram',
        field_name: 'bid_state',
        from_value: oldState,
        to_value: '확인완료',
        note: '입찰가 확인 (빠른답장)'
      });
    } catch (e) {
      Logger.log('입찰가확인(봇) 로깅 실패: ' + e.toString());
    }
  }

  // 4. 텔레그램으로 가격 공개 메시지 전송 (chatId 있을 때만)
  const chatId = String(member.telegram_chat_id || '').trim();
  if (chatId && typeof telegramSendMessage === 'function') {
    try {
      const shortDate = (typeof formatShortInDate_ === 'function') ? formatShortInDate_(item['in-date']) : String(item['in-date'] || '');
      const sakunNo = String(item.sakun_no || '');
      const court = String(item.court || '');
      const bidPrice = (typeof formatKrw_ === 'function') ? formatKrw_(item.bidprice) : String(item.bidprice || '');
      const simpleLine = [shortDate, sakunNo, court].filter(Boolean).join(' / ');
      const divider = '=============================';
      const priceMsg = divider + '\n' + simpleLine + '\n' + bidPrice + '원 입니다.\n' + divider;
      telegramSendMessage(chatId, priceMsg);
    } catch (e) {
      Logger.log('confirmBidPriceWithTelegramReply 텔레그램 전송 오류: ' + e.message);
    }
  }

  return { success: true, message: '확인완료 처리되었습니다.' };
}

/**
 * [강력한 방어 코드] 특정 열까지 시트를 강제로 확장하고 동기화
 */
function ensureColumnExists(sheet, targetColIndex) {
  const maxCols = sheet.getMaxColumns(); // 현재 시트의 물리적 최대 열 개수

  if (maxCols < targetColIndex) {
    // 부족한 만큼 열 추가
    const colsToAdd = targetColIndex - maxCols;
    sheet.insertColumnsAfter(maxCols, colsToAdd);

    // [중요] 변경 사항을 즉시 반영 (비동기 처리 방지)
    SpreadsheetApp.flush();
  }

  // 헤더가 비어있다면 자동 추가
  const header12 = sheet.getRange(1, 12);
  if (!header12.getValue()) {
    header12.setValue('bid_state');
  }

  const header13 = sheet.getRange(1, 13);
  if (!header13.getValue()) {
    header13.setValue('image_id');
  }

  const header14 = sheet.getRange(1, 14);
  if (!header14.getValue()) {
    header14.setValue('note');
  }

  const header15 = sheet.getRange(1, 15);
  if (!header15.getValue()) {
    header15.setValue('m_name2');
  }

  const header16 = sheet.getRange(1, 16);
  if (!header16.getValue()) {
    header16.setValue('auction_id');
  }


}

/**
 * 데이터를 삭제합니다.
 */
function deleteData(id) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(id)).matchEntireCell(true);
  const match = finder.findNext();

  if (!match) {
    return { success: false, message: '해당 ID의 데이터를 찾을 수 없습니다.' };
  }

  sheet.deleteRow(match.getRow());
  return { success: true, message: '성공적으로 삭제되었습니다.' };
}

/**
 * 여러 물건을 한 번의 서버 호출로 안전하게 일괄 삭제합니다.
 * Race Condition 방지: ID 목록을 한 번만 읽고, 역순(내림차순)으로 행 삭제.
 * @param {Array} ids - 삭제할 물건 ID 배열
 * @return {Object} {success, deletedCount, notFoundCount, message}
 */
function deleteBulkData(ids) {
  if (!ids || !ids.length) return { success: false, message: '선택된 항목이 없습니다.' };

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  // 1. ID 목록을 한 번만 읽기
  const allIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();

  // 2. 각 ID의 실제 행 번호 수집
  const rowNumbers = [];
  let notFoundCount = 0;
  ids.forEach(id => {
    const idx = allIds.findIndex(v => String(v) === String(id));
    if (idx >= 0) {
      rowNumbers.push(idx + 2); // 0-based index → 실제 행 번호 (헤더 1행 오프셋)
    } else {
      notFoundCount++;
    }
  });

  if (rowNumbers.length === 0) {
    return { success: false, message: '삭제할 항목을 찾을 수 없습니다.' };
  }

  // 3. 행 번호 내림차순 정렬 (아래 행부터 삭제 → 위쪽 행 번호 밀림 방지)
  rowNumbers.sort((a, b) => b - a);

  // 4. 역순으로 삭제
  rowNumbers.forEach(rowNum => {
    sheet.deleteRow(rowNum);
  });

  SpreadsheetApp.flush();

  const deletedCount = rowNumbers.length;
  return {
    success: true,
    deletedCount: deletedCount,
    notFoundCount: notFoundCount,
    message: `${deletedCount}건이 삭제되었습니다.` + (notFoundCount > 0 ? ` (${notFoundCount}건 미발견)` : '')
  };
}

// ------------------------------------------------------------------------------------------------
// [회원 관리] 함수들
// ------------------------------------------------------------------------------------------------

/**
 * 회원 시트에서 UUID·카카오 관련 컬럼을 삭제합니다. (Legacy - 개편으로 인해 미사용 가능성 높음)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet members 시트
 * @return {Object} {deleted: number, columns: Array} 삭제된 컬럼 수와 삭제된 컬럼명 목록
 */
function removeMemberUuidKakaoColumns_(sheet) {
  // 개편된 스키마에서는 모든 컬럼을 재정의하므로, 이 함수는 사용하지 않거나
  // 단순히 0을 리턴하게 하여 사이드 이펙트를 방지합니다.
  return { deleted: 0, columns: [] };
}

/**
 * 회원 시트에서 카카오/UUID 관련 컬럼을 수동으로 삭제합니다.
 * 환경설정에서 호출하거나 Apps Script 편집기에서 직접 실행 가능합니다.
 * @return {Object} {success: boolean, message: string, deleted: number, columns: Array}
 */
function cleanupKakaoColumns() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
    if (!sheet) {
      return { success: false, message: '회원 시트(members)를 찾을 수 없습니다.', deleted: 0, columns: [] };
    }

    const result = removeMemberUuidKakaoColumns_(sheet);

    if (result.deleted > 0) {
      // 헤더 정리 (표준 헤더로 업데이트)
      ensureMemberSheetColumns();

      return {
        success: true,
        message: `카카오/UUID 관련 컬럼 ${result.deleted}개가 삭제되었습니다.`,
        deleted: result.deleted,
        columns: result.columns
      };
    } else {
      return {
        success: true,
        message: '삭제할 카카오/UUID 관련 컬럼이 없습니다.',
        deleted: 0,
        columns: []
      };
    }
  } catch (error) {
    Logger.log('카카오 컬럼 삭제 오류: ' + error.toString());
    return {
      success: false,
      message: '카카오 컬럼 삭제 중 오류가 발생했습니다: ' + error.toString(),
      deleted: 0,
      columns: []
    };
  }
}

// cleanupKakaoColumns 삭제 또는 비활성화
function cleanupKakaoColumns() { return { success: true }; }

// 이전 헤더 (마이그레이션 감지용)
const MEMBER_HEADERS_LEGACY = [
  'member_id', 'name', 'role', 'phone', 'class_name',
  'login_id', 'password', 'account_no', 'rrn', 'address',
  'note1', 'note2', 'reg_date',
  'member_token', 'telegram_chat_id', 'telegram_username', 'telegram_enabled'
];

/**
 * 2026-02 개편: 구 `members` 데이터를 신규 스키마로 마이그레이션합니다.
 */
function migrateMembersToNewSchema_(sheet) {
  const maxCols = sheet.getMaxColumns();
  const lastRow = sheet.getLastRow();

  // 1. 기존 데이터 읽기 (헤더 제외)
  const oldData = (lastRow > 1)
    ? sheet.getRange(2, 1, lastRow - 1, maxCols).getValues()
    : [];

  // 2. 데이터 매핑
  const newData = oldData.map(row => {
    // Legacy Index: 0:id, 1:name, 2:role, 3:phone, 4:class, 5:login, 6:pw, 7:acc, 8:rrn, 9:addr, 10:n1, 11:n2, 12:reg, 13:token...
    // New Header: member_id, class_id, gubun, member_name, ...

    // 안전한 접근을 위한 헬퍼
    const getVal = (idx) => (idx < row.length ? row[idx] : '');

    return [
      getVal(0), // member_id -> member_id
      '',        // class_id (New)
      getVal(2), // role -> gubun
      getVal(1), // name -> member_name
      '', '',    // name1_gubun, name1
      '', '',    // name2_gubun, name2
      '', '',    // name3_gubun, name3
      getVal(3), // phone -> phone
      getVal(9), // address -> address
      '',         // account_bank (New)
      getVal(7), // account_no -> account_no
      getVal(10),// note1 -> note1
      getVal(11),// note2 -> note2
      getVal(13),// member_token -> member_token (Legacy col 13 checked via header index usually, but hardcoded for safety based on known Legacy)
      getVal(14),// telegram_chat_id
      getVal(16),// telegram_enabled
      '',        // kaib_date (New)
      getVal(12) // reg_date -> reg_date
    ];
  });

  // 3. 시트 초기화 (백업 권장되지만, 사용자가 "진행해"라고 했으므로 덮어쓰기)
  sheet.clearContents();

  // 4. 새 헤더 쓰기
  sheet.getRange(1, 1, 1, ITEM_MEMBER_HEADERS.length).setValues([ITEM_MEMBER_HEADERS]);

  // 5. 변환된 데이터 쓰기
  if (newData.length > 0) {
    // 새 데이터가 새 헤더 길이보다 짧을 수 있으므로 맞춤
    const finalizedData = newData.map(r => {
      while (r.length < ITEM_MEMBER_HEADERS.length) r.push('');
      return r.slice(0, ITEM_MEMBER_HEADERS.length); // 넘치면 자름
    });
    sheet.getRange(2, 1, finalizedData.length, ITEM_MEMBER_HEADERS.length).setValues(finalizedData);
  }

  Logger.log(`Migrated ${newData.length} rows to new member schema.`);
}

/**
 * 회원 시트의 컬럼을 2026-02 개편된 표준 헤더로 강제 동기화합니다.
 * - 구형 헤더가 감지되면 마이그레이션을 수행합니다.
 */
function ensureMemberSheetColumns() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return;

  const currentMaxCols = sheet.getMaxColumns();
  const firstRowValues = (currentMaxCols > 0)
    ? sheet.getRange(1, 1, 1, currentMaxCols).getValues()[0]
    : [];

  // [마이그레이션 감지] 첫 컬럼은 member_id로 같지만, 두 번째 컬럼이 'name'이면 구형, 'class_id'면 신형
  const isLegacy = (firstRowValues.length > 1 && String(firstRowValues[1]).trim() === 'name');

  if (isLegacy) {
    migrateMembersToNewSchema_(sheet);
    return; // 마이그레이션 내에서 헤더 설정까지 완료함
  }

  // [신형 유지보수] 컬럼 부족 시 확장 및 헤더 라벨 교정
  const targetCols = ITEM_MEMBER_HEADERS.length;
  if (currentMaxCols < targetCols) {
    sheet.insertColumnsAfter(currentMaxCols, targetCols - currentMaxCols);
  }

  // 헤더 강제 동기화 (라벨 변경 등 반영)
  // 데이터는 건드리지 않고 1행만 업데이트
  sheet.getRange(1, 1, 1, targetCols).setValues([ITEM_MEMBER_HEADERS]);
}

/**
 * 수업(Class) 관리 시트 생성 및 확인
 */
function ensureClassSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CLASS_SHEET_NAME_DB);
  if (!sheet) {
    sheet = ss.insertSheet(CLASS_SHEET_NAME_DB);
    sheet.getRange(1, 1, 1, CLASS_HEADERS.length).setValues([CLASS_HEADERS]);
  } else {
    // 헤더 동기화
    const currentHeaders = sheet.getRange(1, 1, 1, CLASS_HEADERS.length).getValues()[0];
    if (JSON.stringify(currentHeaders) !== JSON.stringify(CLASS_HEADERS)) {
      sheet.getRange(1, 1, 1, CLASS_HEADERS.length).setValues([CLASS_HEADERS]);
    }
  }
}

/**
 * 수업 회차(Class D1) 시트 생성 및 확인
 */
function ensureClassD1Sheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CLASS_D1_SHEET_NAME_DB);
  if (!sheet) {
    sheet = ss.insertSheet(CLASS_D1_SHEET_NAME_DB);
    sheet.getRange(1, 1, 1, CLASS_D1_HEADERS.length).setValues([CLASS_D1_HEADERS]);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, CLASS_D1_HEADERS.length).getValues()[0];
    if (JSON.stringify(currentHeaders) !== JSON.stringify(CLASS_D1_HEADERS)) {
      sheet.getRange(1, 1, 1, CLASS_D1_HEADERS.length).setValues([CLASS_D1_HEADERS]);
    }
  }
}

/**
 * 회원-수업 상세(Member Class Details) 시트 생성 및 확인
 */
function ensureMemberClassDetailsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(MEMBER_CLASS_DETAILS_SHEET_NAME_DB);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBER_CLASS_DETAILS_SHEET_NAME_DB);
    sheet.getRange(1, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([MEMBER_CLASS_DETAILS_HEADERS]);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues()[0];
    if (JSON.stringify(currentHeaders) !== JSON.stringify(MEMBER_CLASS_DETAILS_HEADERS)) {
      sheet.getRange(1, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([MEMBER_CLASS_DETAILS_HEADERS]);
    }
  }
}

function initAllSheets() {
  ensureMemberSheetColumns();
  ensureClassSheet();
  ensureClassD1Sheet();
  ensureMemberClassDetailsSheet();
  ensureTelegramRequestsSheet_(); // 기존 존재
  ensureSettingsSheet_();         // [PHASE 3-1] settings 시트
  ensureMsgTemplatesSheet_();     // [PHASE 4-1] msg_templates 시트
  ensureMembersItemStatusSheet_(); // [돈클] 회원별 물건상태 적립 원장
  return "All sheets initialized.";
}

function readAllMembers() {
  try {
    // 회원 시트 컬럼 자동 확장
    // 회원 시트 컬럼 자동 확장 (읽기 시에는 성능을 위해 생략, 쓰기 시에만 수행)
    // ensureMemberSheetColumns();

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
    if (!sheet) {
      throw new Error('회원 시트(members)를 찾을 수 없습니다.');
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return []; // 데이터가 없으면 빈 배열 반환
    }

    // ITEM_MEMBER_HEADERS 길이를 직접 사용 (안전한 방법)
    const numCols = ITEM_MEMBER_HEADERS.length;

    if (numCols < 1) {
      throw new Error('읽을 수 있는 열이 없습니다.');
    }

    // 시트의 최대 열 개수 확인하여 안전하게 읽기
    const maxCols = sheet.getMaxColumns();
    const colsToRead = Math.min(numCols, maxCols);

    const data = sheet.getRange(2, 1, lastRow - 1, colsToRead).getValues();

    return data.map(row => {
      let member = {};
      ITEM_MEMBER_HEADERS.forEach((header, index) => {
        let val = (index < row.length) ? row[index] : '';
        if (header === 'reg_date' && val instanceof Date) {
          member[header] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          member[header] = val || '';
        }
      });
      return member;
    });
  } catch (e) {
    Logger.log('회원 데이터 읽기 오류: ' + e.toString());
    Logger.log('오류 상세: ' + e.stack);
    throw e; // 에러를 다시 throw하여 클라이언트에 전달
  }
}

function createMember(data) {
  // 회원 시트 컬럼 자동 확장
  ensureMemberSheetColumns();

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  const newId = (sheet.getLastRow() < 2 ? 1000 : Math.max(...sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat())) + 1;
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const row = ITEM_MEMBER_HEADERS.map(header => {
    if (header === 'member_id') return newId;
    if (header === 'reg_date') return regDate;
    return data[header] || '';
  });

  sheet.appendRow(row);
  return { success: true, message: '회원 등록 성공' };
}

function updateMember(data) {
  // 회원 시트 컬럼 자동 확장
  ensureMemberSheetColumns();

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const index = ids.findIndex(id => String(id) === String(data.member_id));

  if (index === -1) return { success: false, message: '회원 없음' };

  const rowNum = index + 2;
  const maxCols = sheet.getMaxColumns();
  const currentRow = sheet.getRange(rowNum, 1, 1, maxCols).getValues()[0];

  const updatedRow = ITEM_MEMBER_HEADERS.map((header, i) => {
    if (header === 'member_id' || header === 'reg_date') {
      return (i < currentRow.length) ? currentRow[i] : (data[header] || '');
    }
    return data[header] !== undefined ? data[header] : ((i < currentRow.length) ? currentRow[i] : '');
  });

  sheet.getRange(rowNum, 1, 1, updatedRow.length).setValues([updatedRow]);
  return { success: true, message: '회원 수정 성공' };
}

function deleteMember(id) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const index = ids.findIndex(mid => String(mid) === String(id));

  if (index === -1) return { success: false, message: '회원 없음' };

  sheet.deleteRow(index + 2);
  return { success: true, message: '회원 삭제 성공' };
}

/**
 * 회원 ID로 물건 목록을 조회합니다 (회원별 조회 권한용).
 * @param {string|number} memberId - 회원 ID
 * @return {Array} 해당 회원의 물건 목록
 */
function readDataByMember(memberId) {
  const allData = readAllData();
  if (!memberId) return allData;

  return allData.filter(item => {
    const itemMemberId = item.member_id || '';
    return String(itemMemberId) === String(memberId);
  });
}

// ------------------------------------------------------------------------------------------------
// [회원 권한 토큰 / 텔레그램 연동 준비] 서버 유틸
// ------------------------------------------------------------------------------------------------

function generateMemberToken_() {
  // URL 파라미터로 쓰기 좋은 토큰(충분히 긴 랜덤 ID)
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/**
 * member_id에 대해 member_token을 "항상" 새로 생성/저장하고 반환합니다.
 * - 운영상 "토큰 재발급" 버튼용
 * @param {string|number} memberId
 * @return {Object} {success:boolean, member_token?:string, message?:string}
 */
function regenerateMemberToken(memberId) {
  ensureMemberSheetColumns();
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return { success: false, message: '회원 시트(members)를 찾을 수 없습니다.' };
  if (!memberId) return { success: false, message: 'member_id가 필요합니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회원 데이터가 없습니다.' };

  const maxCols = sheet.getMaxColumns();
  const headerRow = sheet.getRange(1, 1, 1, maxCols).getValues()[0];
  const tokenCol = headerRow.indexOf('member_token') + 1;
  if (tokenCol <= 0) return { success: false, message: 'member_token 컬럼이 없습니다. (헤더 갱신 필요)' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(memberId));
  if (idx < 0) return { success: false, message: '해당 회원을 찾을 수 없습니다.' };

  const rowNum = idx + 2;
  const token = generateMemberToken_();
  sheet.getRange(rowNum, tokenCol).setValue(token);
  SpreadsheetApp.flush();
  return { success: true, member_token: token };
}

/**
 * member_id에 대해 member_token이 없으면 생성/저장하고 반환합니다.
 * @param {string|number} memberId
 * @return {Object} {success:boolean, member_token?:string, message?:string}
 */
function ensureMemberToken(memberId) {
  ensureMemberSheetColumns();
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return { success: false, message: '회원 시트(members)를 찾을 수 없습니다.' };
  if (!memberId) return { success: false, message: 'member_id가 필요합니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회원 데이터가 없습니다.' };

  const maxCols = sheet.getMaxColumns();
  const headerRow = sheet.getRange(1, 1, 1, maxCols).getValues()[0];
  const tokenCol = headerRow.indexOf('member_token') + 1;
  if (tokenCol <= 0) return { success: false, message: 'member_token 컬럼이 없습니다. (헤더 갱신 필요)' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(memberId));
  if (idx < 0) return { success: false, message: '해당 회원을 찾을 수 없습니다.' };

  const rowNum = idx + 2;
  const current = sheet.getRange(rowNum, tokenCol).getValue();
  const existing = String(current || '').trim();
  if (existing) return { success: true, member_token: existing };

  const token = generateMemberToken_();
  sheet.getRange(rowNum, tokenCol).setValue(token);
  SpreadsheetApp.flush();
  return { success: true, member_token: token };
}

/**
 * 토큰으로 회원을 찾습니다. (민감 컬럼은 최소로 반환)
 * @param {string} memberToken
 * @return {Object|null} {member_id, name, role, member_token, telegram_chat_id, telegram_enabled}
 */
function getMemberByToken(memberToken) {
  ensureMemberSheetColumns();
  const t = String(memberToken || '').trim();
  if (!t) return null;

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const maxCols = sheet.getMaxColumns();
  const headerRow = sheet.getRange(1, 1, 1, maxCols).getValues()[0];
  const tokenCol = headerRow.indexOf('member_token') + 1;
  if (tokenCol <= 0) return null;

  const tokenVals = sheet.getRange(2, tokenCol, lastRow - 1, 1).getValues().flat();
  const idx = tokenVals.findIndex(v => String(v || '').trim() === t);
  if (idx < 0) return null;

  // 필요한 컬럼만 뽑기 위해 해당 행 1줄 전체를 읽고 헤더 기준으로 매핑
  const row = sheet.getRange(idx + 2, 1, 1, Math.min(maxCols, ITEM_MEMBER_HEADERS.length)).getValues()[0];
  const m = {};
  ITEM_MEMBER_HEADERS.forEach((h, i) => { m[h] = (i < row.length ? row[i] : ''); });

  return {
    member_id: m.member_id,
    name: m.name,
    role: m.role,
    member_token: m.member_token,
    telegram_chat_id: m.telegram_chat_id,
    telegram_enabled: m.telegram_enabled
  };
}

/**
 * (텔레그램) 토큰 인증 메시지를 받아 회원과 chat_id를 자동 연결합니다.
 * - members 시트에 telegram_chat_id / telegram_username / telegram_enabled를 업데이트
 * @param {string} memberToken
 * @param {string|number} chatId
 * @param {string} telegramUsername
 * @return {Object} {success:boolean, message:string, member_id?:string|number, name?:string}
 */
function linkTelegramByMemberToken(memberToken, chatId, telegramUsername) {
  ensureMemberSheetColumns();
  const t = String(memberToken || '').trim();
  const c = String(chatId || '').trim();
  if (!t) return { success: false, message: 'member_token이 비어있습니다.' };
  if (!c) return { success: false, message: 'telegram chat_id가 비어있습니다.' };

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return { success: false, message: '회원 시트(members)를 찾을 수 없습니다.' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회원 데이터가 없습니다.' };

  const maxCols = sheet.getMaxColumns();
  const headerRow = sheet.getRange(1, 1, 1, maxCols).getValues()[0];
  const tokenCol = headerRow.indexOf('member_token') + 1;
  const chatCol = headerRow.indexOf('telegram_chat_id') + 1;
  const userCol = headerRow.indexOf('telegram_username') + 1;
  const enabledCol = headerRow.indexOf('telegram_enabled') + 1;
  const nameCol = headerRow.indexOf('member_name') + 1;
  const idCol = headerRow.indexOf('member_id') + 1;

  if (tokenCol <= 0) return { success: false, message: 'member_token 컬럼이 없습니다.' };
  if (chatCol <= 0) return { success: false, message: 'telegram_chat_id 컬럼이 없습니다.' };

  const tokenVals = sheet.getRange(2, tokenCol, lastRow - 1, 1).getValues().flat();
  const idx = tokenVals.findIndex(v => String(v || '').trim() === t);
  if (idx < 0) return { success: false, message: '해당 토큰의 회원을 찾을 수 없습니다.' };

  const rowNum = idx + 2;
  sheet.getRange(rowNum, chatCol).setValue(c);
  if (userCol > 0) sheet.getRange(rowNum, userCol).setValue(String(telegramUsername || '').trim());
  if (enabledCol > 0) {
    const autoApprove = getSetting_('TELEGRAM_CHATID_AUTO_APPROVE', 'false') === 'true';
    const cur = String(sheet.getRange(rowNum, enabledCol).getValue() || '').trim();
    if (autoApprove || !cur) sheet.getRange(rowNum, enabledCol).setValue('Y');
  }
  SpreadsheetApp.flush();

  const memberId = (idCol > 0) ? sheet.getRange(rowNum, idCol).getValue() : '';
  const memberName = (nameCol > 0) ? sheet.getRange(rowNum, nameCol).getValue() : '';
  return {
    success: true,
    message: '텔레그램이 성공적으로 연결되었습니다.',
    member_id: memberId,
    name: memberName
  };
}

/**
 * 회원 토큰으로 해당 회원 물건만 반환합니다.
 * - "다른 회원 정보 절대 조회 불가" 요구사항 때문에 서버에서 필터링하여 반환
 * @param {string} memberToken
 * @return {Array}
 */
function readDataByMemberToken(memberToken) {
  const member = getMemberByToken(memberToken);
  if (!member) return [];
  return readDataByMember(member.member_id);
}

/**
 * 회원 물건 캐시 무효화 (데이터 변경 시 호출)
 * @param {string|Array} memberIds
 */
function invalidateMemberItemsCache_(memberIds) {
  try {
    var cache = CacheService.getScriptCache();
    var ids = Array.isArray(memberIds) ? memberIds : [memberIds];
    ids.forEach(function(id) {
      if (id) cache.remove('member_items_v1_' + String(id));
    });
  } catch(e) {
    Logger.log('캐시 무효화 오류: ' + e.message);
  }
}

/**
 * 회원 토큰으로 해당 회원 물건만 반환합니다. (이미지 ID 포함)
 * - 프론트가 기존과 동일하게 image_ids를 기대하므로, ImageService의 readAllDataWithImageIds()를 활용
 * @param {string} memberToken
 * @return {Array}
 */
function readDataWithImageIdsByMemberToken(memberToken) {
  const member = getMemberByToken(memberToken);
  if (!member) return [];

  const memberId = String(member.member_id || '');
  if (!memberId) return [];

  // 서버 캐시 확인 (두 번째 접속부터 Spreadsheet 읽기 없이 반환)
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'member_items_v1_' + memberId;
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch(e) {
    Logger.log('캐시 읽기 오류: ' + e.message);
  }

  // 스프레드시트 1회만 열기
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. items 시트 전체를 읽되, 배열 상태에서 member_id(idx=8)로 먼저 필터링
  const sheet = ss.getSheetByName(DB_SHEET_NAME);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const colsToRead = Math.min(sheet.getMaxColumns(), ITEM_HEADERS.length);
  if (colsToRead < 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, colsToRead).getValues();
  const memberRows = values.filter(row => String(row[8] || '') === memberId);
  if (memberRows.length === 0) return [];

  // 2. 필터된 행만 객체 변환
  const memberItems = memberRows.map(row => ({
    'id':             row[0],
    'in-date':        formatParamsDate(row[1]),
    'sakun_no':       row[2],
    'court':          row[3],
    'stu_member':     row[4],
    'm_name_id':      row[5],
    'm_name':         row[6],
    'bidprice':       row[7],
    'member_id':      row[8],
    'reg_date':       formatParamsDate(row[9], 'yyyy-MM-dd'),
    'reg_member':     row[10],
    'bid_state':      (row.length > 11) ? (row[11] || '') : '',
    'image_id':       (row.length > 12) ? (row[12] || '') : '',
    'note':           (row.length > 13) ? (row[13] || '') : '',
    'm_name2':        (row.length > 14) ? (row[14] || '') : '',
    'auction_id':     (row.length > 15) ? (row[15] || '') : '',
    'chuchen_state':  (row.length > 16) ? (row[16] || '') : '',
    'chuchen_date':   (row.length > 17) ? (row[17] || '') : '',
    'has_images':     false
  }));

  // 3. 이 회원 물건 ID 목록으로 item_images 부분 조회
  const memberItemIds = new Set(memberItems.map(it => String(it.id || '').trim()));
  const imageMap = {};
  const imgSheet = ss.getSheetByName(ITEM_IMAGES_SHEET_NAME);
  if (imgSheet) {
    const imgLastRow = imgSheet.getLastRow();
    if (imgLastRow >= 2) {
      const imgData = imgSheet.getRange(2, 1, imgLastRow - 1, 4).getValues();
      for (let i = 0; i < imgData.length; i++) {
        const itemId = String(imgData[i][0]).trim();
        if (!memberItemIds.has(itemId)) continue; // 이 회원 물건이 아니면 스킵
        const imgId = String(imgData[i][1] || '').trim();
        if (!imgId) continue;
        if (!imageMap[itemId]) imageMap[itemId] = [];
        imageMap[itemId].push({ id: imgId, created_at: String(imgData[i][3] || '').trim() });
      }
      for (const k in imageMap) {
        imageMap[k].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      }
    }
  }

  // 4. image_ids 결합
  for (const item of memberItems) {
    const imgArr = imageMap[String(item.id || '').trim()];
    if (imgArr && imgArr.length > 0) {
      item.image_ids = imgArr.map(x => x.id).join(',');
      item.has_images = true;
    } else if (item.image_id && String(item.image_id).trim()) {
      item.image_ids = String(item.image_id).trim();
      item.has_images = true;
    } else {
      item.image_ids = '';
      item.has_images = false;
    }
  }

  // 서버 캐시 저장 (5분 TTL - 재방문 시 Spreadsheet 읽기 생략)
  try {
    var cache = CacheService.getScriptCache();
    cache.put('member_items_v1_' + memberId, JSON.stringify(memberItems), 300);
  } catch(e) {
    Logger.log('캐시 저장 오류: ' + e.message);
  }

  return memberItems;
}

/**
 * 회원 토큰으로 특정 물건 1건을 조회합니다. (본인 소유 검증)
 * @param {string} memberToken
 * @param {string|number} itemId
 * @return {Object|null}
 */
function getItemByMemberToken(memberToken, itemId) {
  const member = getMemberByToken(memberToken);
  if (!member) return null;
  if (!itemId) return null;
  const items = (typeof readAllDataWithImageIds === 'function')
    ? readAllDataWithImageIds()
    : readAllData();
  const found = (items || []).find(it => String(it.id) === String(itemId));
  if (!found) return null;
  if (String(found.member_id || '') !== String(member.member_id)) return null;
  return found;
}

/**
 * 디버그/진단용: 토큰 매칭 및 필터 결과 요약
 * - 큰 데이터 전체를 반환하지 않고 카운트만 반환
 * @param {string} memberToken
 * @return {Object}
 */
function debugMemberTokenSummary(memberToken) {
  const member = getMemberByToken(memberToken);
  const items = (typeof readAllDataWithImageIds === 'function')
    ? readAllDataWithImageIds()
    : readAllData();
  const total = (items || []).length;
  const blankMemberIdCount = (items || []).filter(it => !String(it.member_id || '').trim()).length;

  if (!member) {
    return {
      tokenFound: false,
      totalItems: total,
      blankMemberIdCount: blankMemberIdCount
    };
  }

  const filtered = (items || []).filter(it => String(it.member_id || '') === String(member.member_id));
  const filteredCount = filtered.length;
  const uniqueMemberIds = {};
  (items || []).forEach(it => {
    const mid = String(it.member_id || '').trim();
    uniqueMemberIds[mid] = true;
  });
  const uniqueMemberIdCount = Object.keys(uniqueMemberIds).filter(k => k !== '').length;

  return {
    tokenFound: true,
    member: member,
    totalItems: total,
    blankMemberIdCount: blankMemberIdCount,
    uniqueMemberIdCount: uniqueMemberIdCount,
    filteredCount: filteredCount,
    memberIdType: (member.member_id === null || member.member_id === undefined) ? 'nullish' : typeof member.member_id,
    memberIdValue: member.member_id
  };
}

// ------------------------------------------------------------------------------------------------
// [텔레그램 양방향 요청(승인 필요)] requests 시트
// ------------------------------------------------------------------------------------------------

function ensureTelegramRequestsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(TELEGRAM_REQUESTS_SHEET_NAME);
  const headers = [
    'req_id',
    'requested_at',
    'action',           // FIELD_CHANGE / TELEGRAM_SENT / REQUEST_BID 등
    'status',           // PENDING | APPROVED | REJECTED | DONE
    'item_id',
    'member_id',
    'chat_id',
    'telegram_username',
    'note',
    'approved_at',
    'approved_by',
    'from_value',       // 변경 전 값
    'to_value',         // 변경 후 값
    'field_name',       // 변경된 필드명
    'trigger_type',     // web / web-telegram / web-다중 / member-telegram / system
    'member_name'       // 이벤트 시점 회원명 (집계 편의)
  ];
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    SpreadsheetApp.flush();
  } else {
    // 헤더 최소 보장
    const maxCols = sheet.getMaxColumns();
    const row = sheet.getRange(1, 1, 1, Math.max(headers.length, maxCols)).getValues()[0];
    let needs = false;
    for (let i = 0; i < headers.length; i++) {
      if (String(row[i] || '').trim() !== headers[i]) { needs = true; break; }
    }
    if (needs) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      SpreadsheetApp.flush();
    }
  }
  return sheet;
}

// getMemberByTelegramChatId: 중복 제거됨. Line 1165의 신버전 사용

/**
 * [돈클] members_item_status 시트 보장 (없으면 생성, 헤더 보정)
 * @returns {Sheet}
 */
function ensureMembersItemStatusSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(MEMBERS_ITEM_STATUS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(MEMBERS_ITEM_STATUS_SHEET_NAME);
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, MIS_HEADERS.length).setValues([MIS_HEADERS]);
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();
  } else {
    // 헤더 최소 보장 (불일치 시 1행만 재기록)
    const maxCols = sheet.getMaxColumns();
    const row = sheet.getRange(1, 1, 1, Math.max(MIS_HEADERS.length, maxCols)).getValues()[0];
    let needs = false;
    for (let i = 0; i < MIS_HEADERS.length; i++) {
      if (String(row[i] || '').trim() !== MIS_HEADERS[i]) { needs = true; break; }
    }
    if (needs) {
      sheet.getRange(1, 1, 1, MIS_HEADERS.length).setValues([MIS_HEADERS]);
      SpreadsheetApp.flush();
    }
  }
  return sheet;
}

/**
 * [돈클] members_item_status 시트 생성/검증 — 수동 실행용 공개 함수
 * GAS 편집기에서 이 함수 실행 → 시트 생성 확인
 */
function initMembersItemStatusSheet() {
  const sheet = ensureMembersItemStatusSheet_();
  const headerRow = sheet.getRange(1, 1, 1, MIS_HEADERS.length).getValues()[0];
  Logger.log('[members_item_status] 시트 준비 완료');
  Logger.log('  시트명: ' + sheet.getName());
  Logger.log('  컬럼수: ' + MIS_HEADERS.length);
  Logger.log('  헤더: ' + headerRow.join(' | '));
  Logger.log('  현재 데이터행: ' + Math.max(0, sheet.getLastRow() - 1) + '건');
  return { sheet: sheet.getName(), cols: MIS_HEADERS.length, headers: headerRow, rows: Math.max(0, sheet.getLastRow() - 1) };
}

/**
 * [돈클] members_item_status 적립(upsert) — 추천/입찰/낙찰/불가 마일스톤 도달 시 1건 추가
 *  · dedup: (member_id, item_id, status) 이미 있으면 skip (append-only, 동일건 1건)
 *  · 물건정보는 items에서 읽어 스냅샷 (myeongui=m_name2, 최저가/입찰가 연계)
 *  · 회원 미지정(member_id 없음)이면 적립 안 함
 * @param {string} itemId
 * @param {string} memberIdHint  이벤트가 가진 member_id (없으면 items에서)
 * @param {string} memberNameHint
 * @param {string} status  '추천' | '입찰' | '낙찰' | '불가'
 * @param {Object} extra   {win_price} 등 추가 필드(낙찰 push용, optional)
 * @returns {boolean} 적립했으면 true, skip이면 false
 */
function accrueMembersItemStatus_(itemId, memberIdHint, memberNameHint, status, extra) {
  try {
    if (!itemId || !status) return false;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // 1) 물건 정보 읽기 (id로 단일 행)
    const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!itemSheet || itemSheet.getLastRow() < 2) return false;
    const itFinder = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, 1).createTextFinder(String(itemId)).matchEntireCell(true);
    const itMatch = itFinder.findNext();
    if (!itMatch) return false;
    const r = itemSheet.getRange(itMatch.getRow(), 1, 1, ITEM_HEADERS.length).getValues()[0];
    const itStu = String(r[4] || '').trim();      // E: stu_member
    // 추천은 stu_member='추천' 확인(4키 룰). 불가/낙찰은 to_value가 곧 stu_member라 일치 보장.
    if (status === '추천' && itStu !== '추천') return false;

    const memberId = String(memberIdHint || r[8] || '').trim();   // I: member_id
    const mName = String(memberNameHint || r[6] || '').trim();    // G: m_name
    if (!memberId) return false;                                  // 회원 미지정 → 적립 안 함

    // 2) dedup: (member_id, item_id, status) 존재 확인 (item_id 컬럼 F=6 finder)
    const misSheet = ensureMembersItemStatusSheet_();
    const misLast = misSheet.getLastRow();
    if (misLast >= 2) {
      const hits = misSheet.getRange(2, 6, misLast - 1, 1).createTextFinder(String(itemId)).matchEntireCell(true).findAll();
      for (let h = 0; h < hits.length; h++) {
        const rr = misSheet.getRange(hits[h].getRow(), 1, 1, MIS_HEADERS.length).getValues()[0];
        if (String(rr[1]) === memberId && String(rr[9]) === status) return false; // 이미 적립됨
      }
    }

    // 3) append
    const now = new Date();
    const misId = 'MIS' + now.getTime() + Math.floor(Math.random() * 1000);
    const winPrice = (extra && extra.win_price != null) ? String(extra.win_price) : '';
    // event_date: 상태 실제 발생일. 추천=items.chuchen_date(방금 찍힌 전달완료 시점, R열 r[17]) / 입찰=in_date / 불가·낙찰=now
    let eventDate = (extra && extra.event_date) ? String(extra.event_date) : '';
    if (!eventDate) {
      if (status === '추천') eventDate = String(r[17] || '') || now.toISOString();
      else if (status === '입찰') eventDate = _inDateToIso_(r[1]);
      else eventDate = now.toISOString();
    }
    const row = [
      misId,                    // A: mis_id
      memberId,                 // B: member_id
      mName,                    // C: m_name
      String(r[5] || ''),       // D: m_name_id (F)
      String(r[14] || ''),      // E: myeongui (m_name2, O)
      String(itemId),           // F: item_id
      String(r[1] || ''),       // G: in_date (in-date, B)
      String(r[2] || ''),       // H: sakun_no (C)
      String(r[3] || ''),       // I: court (D)
      status,                   // J: status
      now.toISOString(),        // K: recorded_at (적립 시각)
      String(r[22] || ''),      // L: lowest_price (W)
      String(r[7] || ''),       // M: bid_price (bidprice, H)
      winPrice,                 // N: win_price
      '',                       // O: est_interior
      '',                       // P: est_resale
      eventDate                 // Q: event_date (상태 실제 발생일)
    ];
    misSheet.appendRow(row);
    return true;
  } catch (e) {
    Logger.log('[accrueMembersItemStatus_] 오류(' + status + ',' + itemId + '): ' + e.toString());
    return false;
  }
}

/**
 * [돈클] 적립 자체 검증용 — 실제 추천물건 1건을 골라 적립 → 재실행 시 dedup 확인
 * GAS 편집기에서 실행 후 로그 확인. (1회차: 적립 true/행수+1, 2회차: false/행수 동일)
 */
function testAccrueMembersItemStatus() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
  if (!itemSheet || itemSheet.getLastRow() < 2) { Logger.log('[test] items 데이터 없음'); return; }
  const data = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, ITEM_HEADERS.length).getValues();
  let target = null;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][4]).trim() === '추천' && String(data[i][8]).trim()) { target = data[i]; break; }
  }
  if (!target) { Logger.log('[test] stu_member=추천 & member_id 있는 물건이 없습니다.'); return; }
  const itemId = String(target[0]);
  const before = Math.max(0, ensureMembersItemStatusSheet_().getLastRow() - 1);
  const ok = accrueMembersItemStatus_(itemId, '', '', '추천');
  const after = Math.max(0, ensureMembersItemStatusSheet_().getLastRow() - 1);
  Logger.log('[test] 대상 item_id=' + itemId + ' 회원=' + target[6] + '(' + target[8] + ') 명의=' + (target[14] || '-'));
  Logger.log('[test] 적립결과=' + ok + '  (true=신규적립 / false=이미있음·조건불충족)');
  Logger.log('[test] members_item_status 행수: ' + before + ' → ' + after);
  Logger.log('[test] ▶ 이 함수를 한 번 더 실행하면 dedup으로 false + 행수 동일해야 정상');
  return { itemId: itemId, accrued: ok, before: before, after: after };
}

// ===== [돈클] 시트 메뉴(Admin ▸ 돈클 물건상태) 클릭용 래퍼 — 결과를 팝업으로 표시 =====
function menuDonkleInitMis_() {
  const r = initMembersItemStatusSheet();
  SpreadsheetApp.getUi().alert('✅ members_item_status 준비 완료\n\n컬럼 ' + r.cols + '개\n현재 데이터 ' + r.rows + '행');
}
function menuDonkleTestAccrue_() {
  const r = testAccrueMembersItemStatus();
  const ui = SpreadsheetApp.getUi();
  if (!r) { ui.alert('테스트 대상 없음\n\nstu_member=추천 + 회원이 지정된 물건이 없습니다.'); return; }
  ui.alert('적립 테스트 결과\n\nitem_id: ' + r.itemId +
    '\n적립: ' + (r.accrued ? '신규 적립됨(true)' : '이미있음/dedup(false)') +
    '\n행수: ' + r.before + ' → ' + r.after +
    '\n\n※ 한 번 더 실행 시 false + 행수 동일이면 dedup 정상');
}

/**
 * [돈클] 백필 — telegram_requests 1회 스캔으로 과거 추천/입찰/불가/낙찰을 members_item_status에 일괄 적재
 *  · 판정조건은 ②(라이브 훅)과 동일: 추천=chuchen_state→전달완료, 불가/낙찰/입찰=stu_member→해당값
 *  · 입찰만 추가 필터: 물건 in_date < 오늘(=어제 이전, 실제 입찰함). 추천/불가/낙찰은 즉시.
 *  · member_id = 이벤트 시점값(col F) 스냅샷. 물건 스냅샷필드(명의/일자/사건/법원/최저가/입찰가)=현재 items.
 *  · dedup: 기존 + 백필 내부 (member_id,item_id,status) 1건.
 * @param {Object} opts { months: 0=전체|N개월, dryRun: bool }
 */
function backfillMembersItemStatus(opts) {
  const months = (opts && opts.months) ? parseInt(opts.months, 10) : 0;
  const dryRun = !!(opts && opts.dryRun);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const now = new Date();
  const todayYYMMDD = Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd');
  const startDate = months > 0 ? new Date(now.getFullYear(), now.getMonth() - months, now.getDate()) : null;

  // 1) items 맵 (1회 읽기)
  const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
  const itemMap = {};
  if (itemSheet && itemSheet.getLastRow() >= 2) {
    const idata = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, ITEM_HEADERS.length).getValues();
    for (let i = 0; i < idata.length; i++) {
      const r = idata[i]; const id = String(r[0] || '').trim();
      if (id) itemMap[id] = {
        inDate: String(r[1] || ''), sakunNo: String(r[2] || ''), court: String(r[3] || ''),
        mNameId: String(r[5] || ''), mName: String(r[6] || ''), bidprice: String(r[7] || ''),
        memberId: String(r[8] || ''), myeongui: String(r[14] || ''), lowest: String(r[22] || '')
      };
    }
  }

  // 2) telegram_requests 스캔 → (member,item,status) 튜플
  const reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  const tuples = [];
  if (reqSheet && reqSheet.getLastRow() >= 2) {
    const rdata = reqSheet.getRange(2, 1, reqSheet.getLastRow() - 1, 16).getValues();
    for (let i = 0; i < rdata.length; i++) {
      const row = rdata[i];
      const at = row[1] instanceof Date ? row[1] : new Date(row[1]);
      if (isNaN(at.getTime())) continue;
      if (startDate && at < startDate) continue;
      const itemId = String(row[4] || '').trim();
      if (!itemId) continue;
      const fn = String(row[13] || '').trim(), tv = String(row[12] || '').trim();
      let status = '';
      if (fn === 'chuchen_state' && tv === '전달완료') status = '추천';
      else if (fn === 'stu_member' && tv === '불가') status = '불가';
      else if (fn === 'stu_member' && tv === '낙찰') status = '낙찰';
      else if (fn === 'stu_member' && tv === '입찰') status = '입찰';
      if (!status) continue;
      tuples.push({ memberId: String(row[5] || '').trim(), memberName: String(row[15] || '').trim(), itemId: itemId, status: status, at: at });
    }
  }

  // 3) 기존 적립 set
  const misSheet = ensureMembersItemStatusSheet_();
  const seen = {};
  if (misSheet.getLastRow() >= 2) {
    const md = misSheet.getRange(2, 1, misSheet.getLastRow() - 1, MIS_HEADERS.length).getValues();
    for (let i = 0; i < md.length; i++) seen[String(md[i][1]) + '|' + String(md[i][5]) + '|' + String(md[i][9])] = true;
  }

  // 4) 신규 행 빌드 — (member,item,status) 별 "가장 최근 이벤트" 1건만. 기존 적립분(seen)은 skip
  const newRows = []; const stat = { '추천': 0, '입찰': 0, '불가': 0, '낙찰': 0 };
  let skipNoMember = 0, skipBidFuture = 0, skipNoItem = 0;
  const agg = {};   // key=(member|item|status) -> { t(가장 최근 이벤트), memberId, mName, item }
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i]; const item = itemMap[t.itemId];
    if (!item) { skipNoItem++; continue; }   // items에 없는(삭제된) 물건 → 적립 안 함
    let memberId = t.memberId, mName = t.memberName;
    if (!memberId) memberId = item.memberId;
    if (!mName) mName = item.mName;
    if (!memberId) { skipNoMember++; continue; }
    if (t.status === '입찰') {  // 입찰: in_date < 오늘(어제 이전)만
      const inD = item.inDate;
      if (!inD || String(inD) >= todayYYMMDD) { skipBidFuture++; continue; }
    }
    const key = memberId + '|' + t.itemId + '|' + t.status;
    if (seen[key]) continue;                   // 이미 MIS에 적립됨
    const cur = agg[key];
    if (!cur || t.at > cur.t.at) agg[key] = { t: t, memberId: memberId, mName: mName, item: item };  // 토글 시 가장 최근 전달완료 유지
  }
  Object.keys(agg).forEach(function (key) {
    const a = agg[key], t = a.t, item = a.item;
    // event_date: 추천/불가/낙찰=이벤트 시각(telegram requested_at) / 입찰=in_date
    const eventDate = (t.status === '입찰') ? _inDateToIso_(item.inDate) : t.at.toISOString();
    const misId = 'MIS' + t.at.getTime() + Math.floor(Math.random() * 1000) + newRows.length;
    newRows.push([
      misId, a.memberId, a.mName, item.mNameId, item.myeongui, t.itemId,
      item.inDate, item.sakunNo, item.court, t.status,
      t.at.toISOString(), item.lowest, item.bidprice, '', '', '',
      eventDate   // Q: event_date
    ]);
    stat[t.status]++;
  });

  // 5) 쓰기
  if (!dryRun && newRows.length) {
    const lr = misSheet.getLastRow();
    misSheet.getRange(lr + 1, 1, newRows.length, MIS_HEADERS.length).setValues(newRows);
    SpreadsheetApp.flush();
  }
  Logger.log('[backfill] tuples=' + tuples.length + ' 신규=' + newRows.length + (dryRun ? ' (DRY RUN)' : ''));
  Logger.log('[backfill] 추천 ' + stat['추천'] + ' / 입찰 ' + stat['입찰'] + ' / 불가 ' + stat['불가'] + ' / 낙찰 ' + stat['낙찰']);
  Logger.log('[backfill] skip 삭제물건=' + skipNoItem + ' 회원없음=' + skipNoMember + ' 입찰미래=' + skipBidFuture);
  return { tuples: tuples.length, inserted: newRows.length, byStatus: stat, dryRun: dryRun, skipNoItem: skipNoItem };
}

function menuDonkleBackfill_() {
  const ui = SpreadsheetApp.getUi();
  const dry = backfillMembersItemStatus({ months: 0, dryRun: true });
  const msg = '백필 미리보기 (전체기간)\n\n후보 ' + dry.tuples + '건 → 신규 적립 예정 ' + dry.inserted + '건\n' +
    '· 추천 ' + dry.byStatus['추천'] + ' / 입찰 ' + dry.byStatus['입찰'] + ' / 불가 ' + dry.byStatus['불가'] + ' / 낙찰 ' + dry.byStatus['낙찰'] +
    '\n· 제외: 삭제된물건 ' + (dry.skipNoItem || 0) + '건' +
    '\n\n실제로 적재할까요?';
  if (ui.alert('③ 백필', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) { ui.alert('취소됨 (적재 안 함)'); return; }
  const run = backfillMembersItemStatus({ months: 0, dryRun: false });
  ui.alert('✅ 백필 완료\n\n신규 적재 ' + run.inserted + '건\n· 추천 ' + run.byStatus['추천'] + ' / 입찰 ' + run.byStatus['입찰'] + ' / 불가 ' + run.byStatus['불가'] + ' / 낙찰 ' + run.byStatus['낙찰']);
}

/** [돈클] members_item_status 데이터 비우기(헤더 유지) — 메뉴 클릭용 */
function menuDonkleClearMis_() {
  const ui = SpreadsheetApp.getUi();
  const sheet = ensureMembersItemStatusSheet_();
  const n = Math.max(0, sheet.getLastRow() - 1);
  if (n === 0) { ui.alert('비울 데이터가 없습니다 (헤더만 있음).'); return; }
  if (ui.alert('데이터 비우기', n + '개 행 내용을 모두 비웁니다 (헤더 1행 유지).\n진행할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) { ui.alert('취소됨'); return; }
  // deleteRows는 "고정 안 된 행 전부 삭제" 제한에 걸리므로 내용삭제(clearContent) 사용
  sheet.getRange(2, 1, n, sheet.getMaxColumns()).clearContent();
  SpreadsheetApp.flush();
  ui.alert('✅ ' + n + '개 행 비움 완료 (헤더 유지)\n\n이제 ③ 백필을 다시 실행하면 깨끗하게 재적재됩니다.');
}

// ===== [돈클] ④ 입찰 일별 적립 (시간 트리거) =====
const DONKLE_BID_HOUR_KEY = 'donkle_bid_accrual_hour'; // 입찰 적립 트리거 실행 시각(0~23), 기본 4시

/**
 * [돈클] 입찰 일별 적립 — items에서 stu_member=입찰 AND in_date<오늘(어제 이전) AND 미적립 → 입찰 적립
 *  · 입찰일 전(예정)은 제외, 입찰일 지난 실제 입찰건만. 영구 보존(dedup).
 *  · 매일 1회 시간 트리거가 호출. 수동 실행도 가능.
 */
function accrueBidsDaily() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const now = new Date();
  const todayYYMMDD = Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd');
  const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
  if (!itemSheet || itemSheet.getLastRow() < 2) return { scanned: 0, accrued: 0 };
  const idata = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, ITEM_HEADERS.length).getValues();

  // 기존 (member,item) 입찰 적립 set
  const misSheet = ensureMembersItemStatusSheet_();
  const seen = {};
  if (misSheet.getLastRow() >= 2) {
    const md = misSheet.getRange(2, 1, misSheet.getLastRow() - 1, MIS_HEADERS.length).getValues();
    for (let i = 0; i < md.length; i++) if (String(md[i][9]) === '입찰') seen[String(md[i][1]) + '|' + String(md[i][5])] = true;
  }

  const newRows = []; let scanned = 0;
  for (let i = 0; i < idata.length; i++) {
    const r = idata[i];
    if (String(r[4] || '').trim() !== '입찰') continue;        // stu_member=입찰
    const inD = String(r[1] || '');
    if (!inD || inD >= todayYYMMDD) continue;                 // in_date < 오늘(어제 이전)
    const memberId = String(r[8] || '').trim();
    if (!memberId) continue;
    scanned++;
    const itemId = String(r[0] || '').trim();
    const key = memberId + '|' + itemId;
    if (seen[key]) continue;
    seen[key] = true;
    const misId = 'MIS' + now.getTime() + Math.floor(Math.random() * 1000) + newRows.length;
    newRows.push([
      misId, memberId, String(r[6] || ''), String(r[5] || ''), String(r[14] || ''), itemId,
      inD, String(r[2] || ''), String(r[3] || ''), '입찰', now.toISOString(),
      String(r[22] || ''), String(r[7] || ''), '', '', '',
      _inDateToIso_(inD)   // Q: event_date = 입찰일(in_date)
    ]);
  }
  if (newRows.length) {
    const lr = misSheet.getLastRow();
    misSheet.getRange(lr + 1, 1, newRows.length, MIS_HEADERS.length).setValues(newRows);
    SpreadsheetApp.flush();
  }
  Logger.log('[입찰적립] 대상(입찰&지난) ' + scanned + ' → 신규 적립 ' + newRows.length);
  return { scanned: scanned, accrued: newRows.length };
}

/**
 * [돈클] 입찰 일별 적립 트리거 설치/재설치 — 설정된 시각(donkle_bid_accrual_hour)에 매일 1회
 */
function setupBidAccrualTrigger() {
  const trgs = ScriptApp.getProjectTriggers();
  for (let i = 0; i < trgs.length; i++) {
    if (trgs[i].getHandlerFunction() === 'accrueBidsDaily') ScriptApp.deleteTrigger(trgs[i]);
  }
  let hour = parseInt(getSetting_(DONKLE_BID_HOUR_KEY, '4'), 10);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 4;
  ScriptApp.newTrigger('accrueBidsDaily').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('[입찰트리거] 매일 ' + hour + '시 설치 완료');
  return hour;
}

// 메뉴: 입찰 적립 지금 실행
function menuDonkleBidAccrueNow_() {
  const r = accrueBidsDaily();
  SpreadsheetApp.getUi().alert('입찰 적립 실행 결과\n\n대상(입찰 & 입찰일 지남): ' + r.scanned + '건\n신규 적립: ' + r.accrued + '건');
}
// 메뉴: 실행 시각 설정 + 트리거 설치
function menuDonkleBidTrigger_() {
  const ui = SpreadsheetApp.getUi();
  const cur = getSetting_(DONKLE_BID_HOUR_KEY, '4');
  const resp = ui.prompt('입찰 적립 트리거 시각', '매일 몇 시에 입찰 적립을 돌릴까요? (0~23)\n현재 설정: ' + cur + '시', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) { ui.alert('취소됨'); return; }
  let h = parseInt(String(resp.getResponseText()).trim(), 10);
  if (isNaN(h) || h < 0 || h > 23) { ui.alert('0~23 사이 숫자를 입력하세요. (변경 안 됨)'); return; }
  saveSetting_(DONKLE_BID_HOUR_KEY, String(h));
  const setH = setupBidAccrualTrigger();
  ui.alert('✅ 입찰 적립 트리거 설치 완료\n\n매일 ' + setH + '시에 자동 실행됩니다.');
}

function updateItemStuMemberById_(itemId, newStatus) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) throw new Error('items 시트를 찾을 수 없습니다.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('items 데이터가 없습니다.');
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(itemId));
  if (idx < 0) throw new Error('해당 item_id를 찾을 수 없습니다.');
  const rowNum = idx + 2;
  // items 컬럼: 5번째 열이 stu_member (A=1, ... E=5)
  sheet.getRange(rowNum, 5).setValue(String(newStatus || '').trim());
  SpreadsheetApp.flush();
  return true;
}

function updateItemMemberIdById_(itemId, newMemberId) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) throw new Error('items 시트를 찾을 수 없습니다.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('items 데이터가 없습니다.');
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(itemId));
  if (idx < 0) throw new Error('해당 item_id를 찾을 수 없습니다.');
  const rowNum = idx + 2;
  // items 컬럼: 9번째 열이 member_id (A=1 ... I=9)
  sheet.getRange(rowNum, 9).setValue(String(newMemberId || '').trim());
  SpreadsheetApp.flush();
  return true;
}

function findItemRowById_(itemId) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const id = String(itemId || '').trim();
  if (!id) return -1;
  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const finder = range.createTextFinder(id).matchEntireCell(true);
  const match = finder.findNext();
  return match ? match.getRow() : -1;
}

function getItemLiteById_(itemId) {
  const rowNum = findItemRowById_(itemId);
  if (rowNum < 2) return null;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return null;
  // A~I (id ~ member_id)까지만
  const r = sheet.getRange(rowNum, 1, 1, 9).getValues()[0];
  return {
    id: String(r[0] || '').trim(),
    'in-date': r[1],
    sakun_no: r[2],
    court: r[3],
    stu_member: r[4],
    m_name_id: r[5],
    m_name: r[6],
    bidprice: r[7],
    member_id: r[8]
  };
}

function findUniqueMemberIdByName_(name) {
  ensureMemberSheetColumns();
  const n = String(name || '').trim();
  if (!n) return null;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const maxCols = sheet.getMaxColumns();
  const headerRow = sheet.getRange(1, 1, 1, maxCols).getValues()[0];
  const nameCol = headerRow.indexOf('name') + 1;
  const idCol = headerRow.indexOf('member_id') + 1;
  if (nameCol <= 0 || idCol <= 0) return null;
  const names = sheet.getRange(2, nameCol, lastRow - 1, 1).getValues().flat().map(v => String(v || '').trim());
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat();
  const matched = [];
  for (let i = 0; i < names.length; i++) {
    if (names[i] === n) matched.push(ids[i]);
  }
  if (matched.length === 1) return matched[0];
  return null; // 0개 또는 중복명
}

function createTelegramRequest(action, itemId, chatId, telegramUsername, note) {
  const sheet = ensureTelegramRequestsSheet_();
  const a = String(action || '').trim();
  const item = String(itemId || '').trim();
  const chat = String(chatId || '').trim();
  if (!a || !item || !chat) return { success: false, message: '요청 정보가 부족합니다.' };

  const member = getMemberByTelegramChatId(chat);
  if (!member) return { success: false, message: '이 텔레그램은 아직 회원과 연결되지 않았습니다. 먼저 토큰 인증을 해주세요.' };

  // 아이템 소유권/상태 검증 (전체 readAllData 금지: ID로 1건만 lookup)
  const found = getItemLiteById_(item);
  if (!found) return { success: false, message: '물건 정보를 찾을 수 없습니다.' };
  if (String(found.member_id || '').trim() !== String(member.member_id)) {
    return { success: false, message: '본인 물건이 아니어서 요청할 수 없습니다.' };
  }
  if (a === 'REQUEST_BID') {
    if (String(found.stu_member || '').trim() === '입찰') {
      return { success: false, message: '이미 입찰 상태입니다.' };
    }
  }
  if (a === 'REQUEST_CANCEL') {
    // 취소는 승인 후 미정 처리. 현재 상태가 무엇이든 요청 가능(중복만 방지)
  }

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues(); // req_id~member_id
    const dup = values.find(r =>
      String(r[2] || '').trim() === a &&
      String(r[3] || '').trim() === 'PENDING' &&
      String(r[4] || '').trim() === item &&
      String(r[5] || '').trim() === String(member.member_id)
    );
    if (dup) return { success: true, message: '이미 동일한 요청이 접수되어 있습니다.', already: true };
  }

  const reqId = String(new Date().getTime());
  const requestedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const noteStr = (note === null || note === undefined) ? '' : String(note);
  sheet.appendRow([
    reqId,
    requestedAt,
    a,
    'PENDING',
    item,
    member.member_id,
    chat,
    String(telegramUsername || '').trim(),
    noteStr,
    '',
    ''
  ]);
  return { success: true, message: '요청이 접수되었습니다.', req_id: reqId, member_id: member.member_id, item_id: item };
}

function listTelegramRequests(status) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var s = String(status || 'PENDING').trim().toUpperCase();

    var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
    if (!reqSheet) {
      Logger.log('[listTelegramRequests] 시트 없음: ' + TELEGRAM_REQUESTS_SHEET_NAME);
      return [];
    }
    var lastRow = reqSheet.getLastRow();
    Logger.log('[listTelegramRequests] lastRow=' + lastRow + ', filter=' + s);
    if (lastRow < 2) return [];

    // ★ 헤더 확인 (디버그)
    var headerRow = reqSheet.getRange(1, 1, 1, 11).getValues()[0];
    Logger.log('[listTelegramRequests] 헤더=' + JSON.stringify(headerRow));

    var rows = reqSheet.getRange(2, 1, lastRow - 1, 11).getValues();
    Logger.log('[listTelegramRequests] rows.length=' + rows.length);
    // ★ 첫 번째 행 데이터 디버그
    if (rows.length > 0) {
      Logger.log('[listTelegramRequests] 첫행 raw=' + JSON.stringify(rows[0]));
      Logger.log('[listTelegramRequests] 첫행 r[3]=' + JSON.stringify(rows[0][3]) + ' type=' + typeof rows[0][3]);
    }

    // items 시트
    var itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
    var itemMap = {};
    if (itemsSheet) {
      var itemLastRow = itemsSheet.getLastRow();
      if (itemLastRow >= 2) {
        var itemData = itemsSheet.getRange(2, 1, itemLastRow - 1, 9).getValues();
        for (var i = 0; i < itemData.length; i++) {
          var id = String(itemData[i][0] || '').trim();
          if (id) {
            itemMap[id] = {
              'in-date': itemData[i][1],
              sakun_no: itemData[i][2],
              court: itemData[i][3],
              stu_member: itemData[i][4],
              m_name: itemData[i][6]
            };
          }
        }
      }
    }

    var out = [];
    var tz_ = Session.getScriptTimeZone(); // [속도] 루프 밖 1회 (행마다 호출 시 수 ms씩 누적)
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var st = String(r[3] || '').trim().toUpperCase();
      if (!st) st = 'PENDING';
      // PENDING 필터: 빈값도 PENDING 취급 ([속도] 행별 Logger.log 제거 — 수천 행 시 10초+ 소모)
      if (s && s !== 'ALL' && st !== s) continue;

      var itemId = String(r[4] || '').trim();
      var item = itemMap[itemId] || {};

      out.push({
        req_id: r[0],
        requested_at: (r[1] instanceof Date) ? Utilities.formatDate(r[1], tz_, "yyyy-MM-dd HH:mm:ss") : String(r[1] || ''),
        action: r[2],
        status: st,
        item_id: itemId,
        member_id: r[5],
        chat_id: r[6],
        telegram_username: r[7],
        sakun_no: String(item.sakun_no || ''),
        court: String(item.court || ''),
        in_date: (item['in-date'] instanceof Date) ? Utilities.formatDate(item['in-date'], tz_, "yyyy-MM-dd") : String(item['in-date'] || ''),
        stu_member: String(item.stu_member || ''),
        m_name: String(item.m_name || '')
      });
    }
    Logger.log('[listTelegramRequests] 결과=' + out.length);
    out.sort(function (a, b) { return String(b.requested_at || '').localeCompare(String(a.requested_at || '')); });
    return out;
  } catch (e) {
    Logger.log('[listTelegramRequests] 오류: ' + e.message);
    return [];
  }
}

// 관리자 디버그: 요청 시트가 실제로 조회되는지 점검
function debugTelegramRequests_() {
  const sheet = ensureTelegramRequestsSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.min(sheet.getMaxColumns(), 11);
  const sample = (lastRow >= 2)
    ? sheet.getRange(Math.max(2, lastRow - 5 + 1), 1, Math.min(5, lastRow - 1), lastCol).getValues()
    : [];
  return {
    sheetName: sheet.getName(),
    lastRow: lastRow,
    headers: sheet.getRange(1, 1, 1, lastCol).getValues()[0],
    sampleLast5: sample
  };
}

function approveTelegramRequests(reqIds, approvedBy) {
  // ★ openById 1회만 (기존: ensureTelegramRequestsSheet_ 1회 + items 1회 + updateItemStuMemberById_ N회)
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ids = Array.isArray(reqIds) ? reqIds : [reqIds];
  var idSet = {};
  ids.forEach(function (v) { idSet[String(v)] = true; });
  if (Object.keys(idSet).length === 0) return { success: false, message: '승인할 요청이 없습니다.' };

  var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  if (!reqSheet) return { success: false, message: 'telegram_requests 시트가 없습니다.' };
  var lastRow = reqSheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '요청 데이터가 없습니다.' };
  var values = reqSheet.getRange(2, 1, lastRow - 1, 11).getValues();
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var by = String(approvedBy || 'admin').trim();

  // items 시트 (같은 ss에서 - 추가 openById 없음)
  var itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
  var itemMap = {};
  if (itemsSheet) {
    var itemLastRow = itemsSheet.getLastRow();
    if (itemLastRow >= 2) {
      var itemData = itemsSheet.getRange(2, 1, itemLastRow - 1, 9).getValues();
      for (var k = 0; k < itemData.length; k++) {
        var id = String(itemData[k][0] || '').trim();
        if (id) itemMap[id] = { 'in-date': itemData[k][1], sakun_no: itemData[k][2], court: itemData[k][3], stu_member: itemData[k][4], m_name_id: itemData[k][5], m_name: itemData[k][6], bidprice: itemData[k][7], member_id: itemData[k][8] };
      }
    }
  }

  var approved = 0, updatedItems = 0;
  var updatedItemsList = [];

  function parseNote_(raw) {
    var s = String(raw || '').trim();
    if (!s) return {};
    try { return JSON.parse(s); } catch (e) { return {}; }
  }
  function prefixFrom_(it) {
    if (!it) return '';
    var d = (typeof formatShortInDate_ === 'function') ? formatShortInDate_(it['in-date']) : String(it['in-date'] || '').trim();
    var sk = String(it.sakun_no || '').trim();
    var p = (d && sk) ? (d + ' ' + sk + ' ') : '';
    return (typeof telegramEscapeHtml_ === 'function') ? telegramEscapeHtml_(p) : p;
  }

  for (var i = 0; i < values.length; i++) {
    var reqId = String(values[i][0] || '').trim();
    if (!idSet[reqId]) continue;
    var status = String(values[i][3] || '').trim().toUpperCase();
    if (status !== 'PENDING') continue;
    var action = String(values[i][2] || '').trim();
    var itemId = String(values[i][4] || '').trim();
    var chatId = String(values[i][6] || '').trim();
    var noteRaw = values[i][8];
    var note = parseNote_(noteRaw);
    var originMessageId = note && note.origin_message_id ? Number(note.origin_message_id) : null;
    var it = itemMap[itemId] || null;
    var prefix = prefixFrom_(it);

    // 승인 처리: 3개 셀을 한번에 쓰기 (기존: 3번 분리 → 1번)
    var rowNum = i + 2;
    reqSheet.getRange(rowNum, 4, 1, 1).setValue('APPROVED');
    reqSheet.getRange(rowNum, 10, 1, 2).setValues([[now, by]]);
    approved++;

    // [PHASE 1-5] REQUEST_APPROVED 이력 기록
    var memberId_req = String(values[i][5] || '').trim();
    var memberName_req = (it && it.m_name) ? String(it.m_name) : '';
    writeItemHistory_({
      action: 'REQUEST_APPROVED',
      item_id: itemId,
      member_id: memberId_req,
      member_name: memberName_req,
      chat_id: chatId,
      approved_by: by,
      trigger_type: 'system',
      note: action + ' 승인'
    });

    // items 시트 상태 변경 (같은 ss 재사용, openById 추가 없음)
    if (action === 'REQUEST_BID') {
      try {
        updateItemStuMemberById_(itemId, '입찰');
        updatedItems++;

        if (it) {
          var updatedItem = Object.assign({}, it, { id: itemId, stu_member: '입찰' });
          updatedItemsList.push(updatedItem);
        }

        if (chatId && typeof telegramSendMessage === 'function') {
          try {
            telegramSendMessage(chatId, prefix + '입찰확정 되었습니다.', null, originMessageId ? { replyToMessageId: originMessageId } : null);
          } catch (e) { }
        }
      } catch (e) { }
    }

    // [PHASE 1-5] REQUEST_CANCEL → REQUEST_CANCEL_BID 호환 처리
    if (action === 'REQUEST_CANCEL_BID' || action === 'REQUEST_CANCEL') {
      try {
        updateItemStuMemberById_(itemId, '미정');
        updatedItems++;

        if (it) {
          var updatedItem = Object.assign({}, it, { id: itemId, stu_member: '미정' });
          updatedItemsList.push(updatedItem);
        }

        if (chatId && typeof telegramSendMessage === 'function') {
          try {
            telegramSendMessage(chatId, prefix + '입찰취소 되었습니다.', null, originMessageId ? { replyToMessageId: originMessageId } : null);
          } catch (e) { }
        }
      } catch (e) { }
    }
  }
  return { success: true, approved: approved, updatedItems: updatedItems, data: updatedItemsList, message: '승인 ' + approved + '건 처리 (상태 변경 ' + updatedItems + '건)' };
}

function rejectTelegramRequests(reqIds, rejectedBy) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ids = Array.isArray(reqIds) ? reqIds : [reqIds];
  var idSet = {};
  ids.forEach(function (v) { idSet[String(v)] = true; });
  if (Object.keys(idSet).length === 0) return { success: false, message: '거절할 요청이 없습니다.' };

  var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  if (!reqSheet) return { success: false, message: 'telegram_requests 시트가 없습니다.' };
  var lastRow = reqSheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '요청 데이터가 없습니다.' };
  var values = reqSheet.getRange(2, 1, lastRow - 1, 11).getValues();
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var by = String(rejectedBy || 'admin').trim();

  // items 시트 조회 (결과 메시지에 사건번호 포함용)
  var itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
  var itemMap = {};
  if (itemsSheet) {
    var itemLastRow = itemsSheet.getLastRow();
    if (itemLastRow >= 2) {
      var itemData = itemsSheet.getRange(2, 1, itemLastRow - 1, 9).getValues();
      for (var k = 0; k < itemData.length; k++) {
        var id = String(itemData[k][0] || '').trim();
        if (id) itemMap[id] = { 'in-date': itemData[k][1], sakun_no: itemData[k][2], court: itemData[k][3], m_name: itemData[k][6] };
      }
    }
  }

  function parseNote_(raw) {
    var s = String(raw || '').trim();
    if (!s) return {};
    try { return JSON.parse(s); } catch (e) { return {}; }
  }
  function prefixFrom_(it) {
    if (!it) return '';
    var d = (typeof formatShortInDate_ === 'function') ? formatShortInDate_(it['in-date']) : String(it['in-date'] || '').trim();
    var sk = String(it.sakun_no || '').trim();
    var p = (sk) ? ((d ? d + ' ' : '') + sk + ' ') : '';
    return (typeof telegramEscapeHtml_ === 'function') ? telegramEscapeHtml_(p) : p;
  }

  var rejected = 0;
  for (var i = 0; i < values.length; i++) {
    var reqId = String(values[i][0] || '').trim();
    if (!idSet[reqId]) continue;
    var status = String(values[i][3] || '').trim().toUpperCase();
    if (status !== 'PENDING') continue;

    var itemId = String(values[i][4] || '').trim();
    var chatId = String(values[i][6] || '').trim();
    var noteRaw = values[i][8];
    var note = parseNote_(noteRaw);
    var originMessageId = note && note.origin_message_id ? Number(note.origin_message_id) : null;
    var it = itemMap[itemId] || null;
    var prefix = prefixFrom_(it);

    // 거절 처리
    var rowNum = i + 2;
    reqSheet.getRange(rowNum, 4).setValue('REJECTED');
    reqSheet.getRange(rowNum, 10, 1, 2).setValues([[now, by]]);
    rejected++;

    // [PHASE 1-5] REQUEST_REJECTED 이력 기록
    var actionRej = String(values[i][2] || '').trim();
    var itemIdRej = String(values[i][4] || '').trim();
    var memberIdRej = String(values[i][5] || '').trim();
    var itRej = itemMap[itemIdRej] || null;
    writeItemHistory_({
      action: 'REQUEST_REJECTED',
      item_id: itemIdRej,
      member_id: memberIdRej,
      member_name: itRej ? String(itRej.m_name || '') : '',
      chat_id: chatId,
      approved_by: by,
      trigger_type: 'web',
      note: actionRej + ' 거절'
    });

    // 텔레그램 알림 전송
    if (chatId && typeof telegramSendMessage === 'function') {
      try {
        telegramSendMessage(chatId, prefix + '요청이 반려되었습니다. (관리자 확인 필요)', null, originMessageId ? { replyToMessageId: originMessageId } : null);
      } catch (e) { }
    }
  }
  return { success: true, rejected: rejected, message: '거절 ' + rejected + '건 처리 및 알림 전송' };
}

/**
 * member_id로 회원 1건 조회 (전체 readAllMembers 대신 사용 - 성능 최적화)
 * @param {string|number} memberId
 * @return {Object|null} ITEM_MEMBER_HEADERS 기반 회원 객체
 */
function getMemberById_(memberId) {
  if (!memberId) return null;
  var mid = String(memberId).trim();
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  // TextFinder로 member_id 열(1열)에서 빠르게 검색
  var finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(mid).matchEntireCell(true);
  var match = finder.findNext();
  if (!match) return null;
  var rowNum = match.getRow();
  var maxCols = Math.min(sheet.getMaxColumns(), ITEM_MEMBER_HEADERS.length);
  var row = sheet.getRange(rowNum, 1, 1, maxCols).getValues()[0];
  var member = {};
  ITEM_MEMBER_HEADERS.forEach(function (header, index) {
    member[header] = (index < row.length) ? (row[index] || '') : '';
  });
  return member;
}

/**
 * Telegram chatId로 회원 정보 조회
 * @param {string} chatId
 * @return {Object|null} {member_id, member_name, member_token, telegram_chat_id, telegram_enabled}
 */
function getMemberByTelegramChatId(chatId) {
  if (!chatId) return null;
  const chat = String(chatId).trim();
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const maxCols = sheet.getMaxColumns();
  const headerRow = sheet.getRange(1, 1, 1, maxCols).getValues()[0].map(String);

  // 헤더에서 컬럼 인덱스 직접 찾기
  const col = {};
  ['member_id', 'member_name', 'member_token', 'telegram_chat_id', 'telegram_enabled'].forEach(function (h) {
    col[h] = headerRow.indexOf(h);
  });
  if (col.telegram_chat_id < 0) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, maxCols).getValues();
  const found = rows.find(function (r) { return String(r[col.telegram_chat_id] || '').trim() === chat; });
  if (!found) return null;

  return {
    member_id: col.member_id >= 0 ? String(found[col.member_id] || '').trim() : '',
    member_name: col.member_name >= 0 ? String(found[col.member_name] || '').trim() : '',
    member_token: col.member_token >= 0 ? String(found[col.member_token] || '').trim() : '',
    telegram_chat_id: String(found[col.telegram_chat_id] || '').trim(),
    telegram_enabled: col.telegram_enabled >= 0 ? String(found[col.telegram_enabled] || '').trim() : ''
  };
}

/**
 * 텔레그램에서 직접 물건 상태 변경 (즉시 처리, 승인 불필요)
 * @param {string} itemId
 * @param {string} chatId
 * @param {string} newStatus - '입찰' 또는 '미정'
 * @return {Object} {success:boolean, message:string}
 */
function updateItemStatusByTelegram(itemId, chatId, newStatus) {
  if (!itemId || !chatId || !newStatus) {
    return { success: false, message: '요청 정보가 부족합니다.' };
  }

  // 1. 회원 확인
  const member = getMemberByTelegramChatId(chatId);
  if (!member || !member.member_id) {
    return { success: false, message: '텔레그램 연동 회원을 찾을 수 없습니다.' };
  }

  // 2. 물건 조회 및 소유권 검증
  const items = (typeof readAllDataWithImageIds === 'function') ? readAllDataWithImageIds() : readAllData();
  const item = (items || []).find(it => String(it.id) === String(itemId));
  if (!item) {
    return { success: false, message: '물건 정보를 찾을 수 없습니다.' };
  }
  if (String(item.member_id || '').trim() !== String(member.member_id)) {
    return { success: false, message: '본인 물건이 아니어서 변경할 수 없습니다.' };
  }

  // 3. 상태 즉시 변경
  try {
    updateItemStuMemberById_(itemId, newStatus);
    return { success: true, message: `물건 상태가 "${newStatus}"(으)로 변경되었습니다.` };
  } catch (e) {
    return { success: false, message: '상태 변경 중 오류가 발생했습니다: ' + e.message };
  }
}


// ================================================================================================
// [수업(class) 시트 관리] CRUD 함수들 -> ClassService.js로 이관됨
// (ensureClassSheet_, updateClass, deleteClass, getClassDropdownOptions removed)

// ================================================================================================
// [수업 회차(class_d1) 시트 관리] CRUD 함수들
// ================================================================================================

/**
 * class_d1 시트를 확보합니다. (없으면 생성)
 */
function ensureClassD1Sheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CLASS_D1_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CLASS_D1_SHEET_NAME);
    sheet.getRange(1, 1, 1, CLASS_D1_HEADERS.length).setValues([CLASS_D1_HEADERS]);
    SpreadsheetApp.flush();
  } else {
    const maxCols = sheet.getMaxColumns();
    if (maxCols < CLASS_D1_HEADERS.length) {
      sheet.insertColumnsAfter(maxCols, CLASS_D1_HEADERS.length - maxCols);
    }
    const headerRow = sheet.getRange(1, 1, 1, CLASS_D1_HEADERS.length).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < CLASS_D1_HEADERS.length; i++) {
      if (headerRow[i] !== CLASS_D1_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, CLASS_D1_HEADERS.length).setValues([CLASS_D1_HEADERS]);
      SpreadsheetApp.flush();
    }
  }
  return sheet;
}

/**
 * 특정 수업의 모든 회차를 조회합니다.
 */
function readClassD1ByClassId(classId) {
  const sheet = ensureClassD1Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
  const tz_ = Session.getScriptTimeZone();
  const TIME_FIELDS_  = new Set(['class_time_from', 'class_time_to']);
  const DATETIME_FIELDS_ = new Set(['bid_starttime', 'bid_datetime_1', 'bid_datetime_2']);
  const d1List = data
    .map(row => {
      const obj = {};
      CLASS_D1_HEADERS.forEach((h, i) => {
        const val = row[i];
        if (val instanceof Date) {
          if (TIME_FIELDS_.has(h)) {
            obj[h] = Utilities.formatDate(val, tz_, 'HH:mm');
          } else if (DATETIME_FIELDS_.has(h)) {
            obj[h] = Utilities.formatDate(val, tz_, "yyyy-MM-dd'T'HH:mm");
          } else {
            obj[h] = Utilities.formatDate(val, tz_, 'yyyy-MM-dd');
          }
        } else {
          obj[h] = val !== undefined && val !== null ? val : '';
        }
      });
      return obj;
    })
    .filter(d => String(d.class_id) === String(classId))
    .sort((a, b) => Number(a.class_loop) - Number(b.class_loop));

  if (d1List.length === 0) return [];

  // 물건/회원 카운트 집계
  const d1Ids = new Set(d1List.map(d => String(d.class_d1_id)));

  // 물건 카운트 (items 시트)
  const itemSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  const itemCountMap = {};
  if (itemSheet && itemSheet.getLastRow() >= 2) {
    const d1IdCol = ITEM_HEADERS.indexOf('class_d1_id');
    const itemData = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, ITEM_HEADERS.length).getValues();
    itemData.forEach(row => {
      const d1Id = String(row[d1IdCol] || '');
      if (d1Ids.has(d1Id)) itemCountMap[d1Id] = (itemCountMap[d1Id] || 0) + 1;
    });
  }

  // 회원 카운트 (member_class_details 시트)
  const memSheet = ensureMemberClassDetailsSheet_();
  const memberCountMap = {};
  if (memSheet.getLastRow() >= 2) {
    const d1IdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    const memData = memSheet.getRange(2, 1, memSheet.getLastRow() - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    memData.forEach(row => {
      const d1Id = String(row[d1IdIdx] || '');
      if (d1Ids.has(d1Id)) memberCountMap[d1Id] = (memberCountMap[d1Id] || 0) + 1;
    });
  }

  return d1List.map(d => ({
    ...d,
    item_count: itemCountMap[String(d.class_d1_id)] || 0,
    member_count: memberCountMap[String(d.class_d1_id)] || 0
  }));
}

/**
 * 모든 회차 데이터를 조회합니다.
 */
function readAllClassD1() {
  const sheet = ensureClassD1Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
  return data.map(row => {
    const obj = {};
    CLASS_D1_HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

/**
 * 수업 회차를 일괄 생성합니다.
 * @param {string} classId - 수업 ID
 * @param {string} startDate - 시작일 (YYYYMMDD)
 * @param {string} loopUnit - 루프 단위 (주)
 * @param {Object} options - { startLoop, endLoop, timeFrom, timeTo, memberIds }
 */
function generateClassD1(classId, startDate, loopUnit, options) {
  var sheet = ensureClassD1Sheet_();

  var allClasses = readAllClasses();
  var classInfo = allClasses.find(function(c) { return String(c.class_id) === String(classId); });
  if (!classInfo) return { success: false, message: '수업 정보를 찾을 수 없습니다.' };

  // options 파싱 (하위호환: 숫자가 오면 loopCount로 처리)
  var opts = (options && typeof options === 'object') ? options : { endLoop: Number(options) || 10 };
  var startLoop    = Number(opts.startLoop) || 1;
  var endLoop      = Number(opts.endLoop)   || 10;
  var addCount     = opts.addCount ? Number(opts.addCount) : null; // 회차 추가 모드
  var timeFrom     = opts.timeFrom || classInfo.class_time_from || '';
  var timeTo       = opts.timeTo   || classInfo.class_time_to   || '';
  // 입찰시간: 수업일 기준 day offset + time (예: bidStarttimeDay=1, bidStarttimeTime='14:00')
  var bidStarttimeDay  = (opts.bidStarttimeDay  !== '' && opts.bidStarttimeDay  != null) ? parseInt(opts.bidStarttimeDay)  : null;
  var bidStarttimeTime = opts.bidStarttimeTime  || '00:00';
  var bidDatetime1Day  = (opts.bidDatetime1Day  !== '' && opts.bidDatetime1Day  != null) ? parseInt(opts.bidDatetime1Day)  : null;
  var bidDatetime1Time = opts.bidDatetime1Time  || '00:00';
  var bidDatetime2Day  = (opts.bidDatetime2Day  !== '' && opts.bidDatetime2Day  != null) ? parseInt(opts.bidDatetime2Day)  : null;
  var bidDatetime2Time = opts.bidDatetime2Time  || '00:00';

  // 회차 추가 모드: 기존 배치 timestamp 재사용 (동일 배치로 편입)
  var batchTimestamp = opts.batchTimestamp || null;
  var memberIds   = Array.isArray(opts.memberIds)   ? opts.memberIds   : [];
  var memberData  = Array.isArray(opts.memberData)  ? opts.memberData  : [];
  var totalSessions = typeof opts.totalSessions === 'number' ? opts.totalSessions : 0;

  // 회차 추가 모드: startLoop/endLoop을 기존 마지막 회차 기준으로 계산
  //  - 임시 loop(맨 끝)로 생성 후, 마지막에 rebuildClassD1BatchOrder_가 날짜순 재정렬
  //  - 반드시 기존 배치 timestamp 필요 (없으면 새 배치/수업이 생성되는 버그 → 차단)
  if (addCount !== null) {
    if (!batchTimestamp) {
      return { success: false, message: '회차 추가에는 기존 배치 정보가 필요합니다. 배치를 다시 선택한 뒤 시도하세요.' };
    }
    var existingLoops = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, CLASS_D1_HEADERS.length).getValues()
          .filter(function(r) { return String(r[CLASS_D1_HEADERS.indexOf('class_id')]) === String(classId); })
          .map(function(r) { return Number(r[CLASS_D1_HEADERS.indexOf('class_loop')]); })
      : [];
    var lastLoop = existingLoops.length > 0 ? Math.max.apply(null, existingLoops) : 0;
    startLoop = lastLoop + 1;
    endLoop   = lastLoop + addCount;
  }

  // 루프단위 '0' = 날짜 미정 모드 (PT/돈클 전용) — 모든 회차 class_date 빈 문자열
  var isNoDateMode = (String(loopUnit) === '0');
  var weekInterval = isNoDateMode ? 1 : (parseInt(loopUnit) || 1);
  var dayInterval  = weekInterval * 7;

  var year  = parseInt(startDate.substring(0, 4));
  var month = parseInt(startDate.substring(4, 6)) - 1;
  var day   = parseInt(startDate.substring(6, 8));
  var currentDate = new Date(year, month, day);

  var tz        = Session.getScriptTimeZone();
  // class_d1_id 배치 prefix
  //  - 추가 모드: batchTimestamp = 기존 배치키(이미 classId 포함, 예 "5004_1777..." 또는 "CLS_..._...")
  //    → 그대로 prefix 로 사용해야 같은 배치로 편입됨 (classId 중복 prepend 금지)
  //  - 신규 모드: classId_<생성 ms 타임스탬프>
  var batchPrefix = batchTimestamp ? String(batchTimestamp) : (classId + '_' + String(new Date().getTime()));
  var regDate   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var weekNames = ['일', '월', '화', '수', '목', '금', '토'];

  // 수업일 기준 bid 일시 계산 (단순 캘린더 +N일, 보정 없음) — 등록시작/1차마감용
  function calcBidDatetime_(baseDate, dayOffset, timeStr) {
    if (dayOffset === null) return '';
    var d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayOffset);
    var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return dateStr + 'T' + (timeStr || '00:00');
  }
  // 최종마감 전용: 단순 캘린더 +N일 → 결과가 토/일이면 익일(=다음 평일) 14:00으로 보정
  function calcBidDatetime2_(baseDate, dayOffset, timeStr) {
    if (dayOffset === null) return '';
    var d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayOffset);
    var time = String(timeStr || '00:00');
    var dow = d.getDay(); // 0=일, 6=토
    if (dow === 6) {       // 토 → 월(+2)
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2);
      time = '14:00';
    } else if (dow === 0) { // 일 → 월(+1)
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      time = '14:00';
    }
    var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return dateStr + 'T' + time;
  }
  // U열 origin 포맷: "{dayOffset}|{HH:MM}" — 사용자 입력 그대로 보존
  function buildBd2Origin_(dayOffset, timeStr) {
    if (dayOffset === null || dayOffset === '' || dayOffset === undefined) return '';
    return String(dayOffset) + '|' + (timeStr || '00:00');
  }

  // 기존 회차 날짜 중복 체크 제거 (사용자 요청 — CLASS/PT/돈클 모두 동일 기간 재생성 허용)

  var newRows = [];
  var newD1Ids = [];

  for (var loopNo = startLoop; loopNo <= endLoop; loopNo++) {
    // 루프 미정 모드: 첫 회차만 시작일 설정, 나머지는 날짜 빈 값 (나중에 수정)
    var isFirst = (loopNo === startLoop);
    var hasDate = !isNoDateMode || isFirst;
    var dateStr = hasDate ? Utilities.formatDate(currentDate, Session.getScriptTimeZone(), 'yyyyMMdd') : '';
    var weekDay = hasDate ? weekNames[currentDate.getDay()] : '';
    var d1Id    = batchPrefix + '_' + loopNo;

    var row = CLASS_D1_HEADERS.map(function(h) {
      switch (h) {
        case 'class_d1_id':    return d1Id;
        case 'class_id':       return classId;
        case 'class_type':     return classInfo.class_type  || '';
        case 'class_name':     return classInfo.class_name  || '';
        case 'class_grade':    return classInfo.class_grade || '';
        case 'class_loc':      return classInfo.class_loc   || '';
        case 'class_date':     return dateStr;
        case 'class_week':     return weekDay;
        case 'class_time_from':return timeFrom;
        case 'class_time_to':  return timeTo;
        case 'class_loop':     return loopNo;
        case 'completed':      return 'N';
        case 'reg_date':       return regDate;
        case 'bid_starttime':  return hasDate ? calcBidDatetime_(currentDate, bidStarttimeDay, bidStarttimeTime) : '';
        case 'bid_datetime_1': return hasDate ? calcBidDatetime_(currentDate, bidDatetime1Day, bidDatetime1Time) : '';
        case 'bid_datetime_2': return hasDate ? calcBidDatetime2_(currentDate, bidDatetime2Day, bidDatetime2Time) : '';
        case 'bid_datetime_2_origin': return hasDate ? buildBd2Origin_(bidDatetime2Day, bidDatetime2Time) : '';
        case '1cha_bid':       return (opts.bid1Count != null && opts.bid1Count !== '') ? Number(opts.bid1Count) : '';
        case '2cha_bid':       return (opts.bid2Count != null && opts.bid2Count !== '') ? Number(opts.bid2Count) : '';
        case 'teacher_id':     return opts.teacherId || '';
        default:               return '';
      }
    });
    newRows.push(row);
    newD1Ids.push(d1Id);
    if (!isNoDateMode) currentDate.setDate(currentDate.getDate() + dayInterval);
  }

  if (newRows.length === 0) return { success: false, message: '생성할 회차가 없습니다.' };

  sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, CLASS_D1_HEADERS.length).setValues(newRows);
  SpreadsheetApp.flush();

  // 회원 일괄 등록 - 배치키 기준 1회만 등록 (회차 번호 제거)
  if (memberIds.length > 0) {
    var batchKey = extractD1BatchKey_(newD1Ids[0]);
    var actualTotal = totalSessions > 0 ? totalSessions : newRows.length;
    addMemberToClassD1Batch(batchKey, memberIds, classId, memberData, actualTotal);
  }

  // 회차 추가 모드: 임시 loop으로 생성된 새 회차를 날짜순으로 재정렬하고
  //   회원 출석(no_N) 시프트 + 새 회차 출석 채움 + class 마스터 class_loop 동기화
  if (addCount !== null) {
    var addBatchKey = extractD1BatchKey_(newD1Ids[0]);
    rebuildClassD1BatchOrder_(addBatchKey, { fillNewIds: newD1Ids });
  }

  return { success: true, message: newRows.length + '개 회차 생성 완료 (회원 ' + memberIds.length + '명)', created: newRows.length };
}

/**
 * 배치 회차를 날짜순으로 1..M 재정렬하고, 관련 데이터를 모두 정정한다.
 *  - class_d1.class_loop 를 날짜 오름차순 1..M 로 재배치
 *  - 각 회원(member_class_details)의 no_N 출석값을 동일 매핑으로 시프트
 *    (수업회차/남은회차/이월회차/심블은 프론트에서 no_N+회차로 자동 재계산되므로 별도 저장 불필요)
 *  - 새로 삽입된 회차(fillNewIds)는 "활성 회원 + 미래 + 남은회차 여유" 일 때만 'O' 채움 (없으면 빈칸)
 *  - 휴강 백업(holiday_backup)의 shifted_loop 참조도 같은 매핑으로 보정 (휴강 로직 자체는 불변)
 *  - class 마스터 class_loop 를 이 수업의 배치 중 최대 회차수로 동기화 (빈 패딩칸 방지, 다중 배치 안전)
 *  - 계약회차(contract_loop)는 의도적으로 변경하지 않음 (남은/이월로 자동 흡수)
 * @param {string} batchKey  classId_timestamp
 * @param {Object} [options]  { fillNewIds: string[] }  이번에 삽입된 class_d1_id 목록
 */
function rebuildClassD1BatchOrder_(batchKey, options) {
  options = options || {};
  var fillNew = {};
  (options.fillNewIds || []).forEach(function(id) { fillNew[String(id)] = true; });

  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');

  var d1Sheet = ensureClassD1Sheet_();
  var d1Last = d1Sheet.getLastRow();
  if (d1Last < 2) return { success: false, message: '회차 데이터 없음' };

  var idIdx      = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var classIdIdx = CLASS_D1_HEADERS.indexOf('class_id');
  var loopIdx    = CLASS_D1_HEADERS.indexOf('class_loop');
  var dateIdx    = CLASS_D1_HEADERS.indexOf('class_date');
  var holidayIdx = CLASS_D1_HEADERS.indexOf('holiday');
  var holBackIdx = CLASS_D1_HEADERS.indexOf('holiday_backup');

  var d1Data = d1Sheet.getRange(2, 1, d1Last - 1, CLASS_D1_HEADERS.length).getValues();

  // 이 배치의 회차 행 수집
  var rows = [];
  var classId = null;
  for (var i = 0; i < d1Data.length; i++) {
    if (extractD1BatchKey_(String(d1Data[i][idIdx])) !== batchKey) continue;
    classId = String(d1Data[i][classIdIdx]);
    var rawDate = d1Data[i][dateIdx];
    var dateStr = (rawDate instanceof Date)
      ? Utilities.formatDate(rawDate, tz, 'yyyyMMdd')
      : String(rawDate || '').replace(/-/g, '');
    rows.push({
      sheetRow: i + 2,
      oldLoop: Number(d1Data[i][loopIdx]),
      dateStr: dateStr,
      holiday: String(d1Data[i][holidayIdx] || '') === 'Y',
      isNew: !!fillNew[String(d1Data[i][idIdx])],
      backupRaw: holBackIdx >= 0 ? String(d1Data[i][holBackIdx] || '') : ''
    });
  }
  if (rows.length === 0) return { success: false, message: '배치 회차 없음' };

  // 날짜 오름차순 정렬 (빈 날짜는 맨 뒤, 동일 날짜는 기존 loop 순)
  rows.sort(function(a, b) {
    var ad = a.dateStr || '99999999';
    var bd = b.dateStr || '99999999';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.oldLoop - b.oldLoop;
  });

  // oldLoop -> newLoop 매핑
  var loopMap = {};
  rows.forEach(function(r, idx) { r.newLoop = idx + 1; loopMap[r.oldLoop] = r.newLoop; });
  var total = rows.length;

  // 1) class_d1.class_loop 갱신 + holiday_backup.shifted_loop 보정
  rows.forEach(function(r) {
    if (Number(r.oldLoop) !== r.newLoop) {
      d1Sheet.getRange(r.sheetRow, loopIdx + 1).setValue(r.newLoop);
    }
    if (holBackIdx >= 0 && r.backupRaw) {
      try {
        var bk = JSON.parse(r.backupRaw);
        var touched = false;
        Object.keys(bk).forEach(function(mid) {
          var e = bk[mid];
          if (e && e.shifted_loop !== null && e.shifted_loop !== undefined && e.shifted_loop !== '') {
            var mapped = loopMap[Number(e.shifted_loop)];
            e.shifted_loop = (mapped !== undefined) ? mapped : null; // 대상 회차 삭제됐으면 null
            touched = true;
          }
        });
        if (touched) d1Sheet.getRange(r.sheetRow, holBackIdx + 1).setValue(JSON.stringify(bk));
      } catch (e) {}
    }
  });

  // 2) 회원 출석(no_N) 시프트
  var mcdSheet = ensureMemberClassDetailsSheet_();
  var mcdLast = mcdSheet.getLastRow();
  if (mcdLast >= 2) {
    var mcdData = mcdSheet.getRange(2, 1, mcdLast - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    var mD1Idx      = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    var statusIdx   = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_status');
    var contractIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('contract_loop');
    var noIdxCache = {};
    function noIdx_(n) {
      if (noIdxCache[n] === undefined) noIdxCache[n] = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + n);
      return noIdxCache[n];
    }
    var INACTIVE = ['종료', '홀딩'];

    for (var mi = 0; mi < mcdData.length; mi++) {
      if (String(mcdData[mi][mD1Idx]) !== String(batchKey)) continue;
      var rowVals = mcdData[mi].slice();

      // 기존 no_oldLoop 스냅샷
      var oldNo = {};
      rows.forEach(function(r) {
        var ci = noIdx_(r.oldLoop);
        oldNo[r.oldLoop] = (ci >= 0) ? String(rowVals[ci] || '') : '';
      });

      // newLoop 위치로 재배치 (새 회차는 일단 빈값)
      var newNo = {};
      rows.forEach(function(r) { newNo[r.newLoop] = r.isNew ? '' : (oldNo[r.oldLoop] || ''); });

      // 새 회차 출석 채움: 활성 + 미래 + (futureO < remaining) → 'O'
      var isActive = INACTIVE.indexOf(String(rowVals[statusIdx] || '')) < 0;
      if (isActive) {
        rows.forEach(function(r) {
          if (!r.isNew) return;
          if (!(r.dateStr !== '' && r.dateStr > todayStr)) return; // 미래만
          var used = 0, futureO = 0;
          rows.forEach(function(rr) {
            if (rr.holiday) return; // 휴강 제외
            var v = String(newNo[rr.newLoop] || '').trim().toUpperCase();
            if (rr.dateStr !== '' && rr.dateStr <= todayStr) { if (v === 'O' || v === 'R') used++; }
            else if (rr.dateStr !== '' && rr.dateStr > todayStr) { if (v === 'O' || v === 'R') futureO++; }
          });
          var contract = parseInt(rowVals[contractIdx], 10);
          if (isNaN(contract)) contract = total; // 비어있으면 배치 회차수 fallback
          var remaining = Math.max(0, contract - used);
          if (futureO < remaining) newNo[r.newLoop] = 'O';
        });
      }

      // no_1..no_20 기록 (배치 범위 밖은 비움)
      var changed = false;
      for (var n = 1; n <= 20; n++) {
        var ci2 = noIdx_(n);
        if (ci2 < 0) continue;
        var nv = (n <= total) ? (newNo[n] || '') : '';
        if (String(rowVals[ci2] || '') !== String(nv)) { rowVals[ci2] = nv; changed = true; }
      }
      if (changed) mcdSheet.getRange(mi + 2, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([rowVals]);
    }
  }

  // 3) class 마스터 class_loop = 이 수업의 배치 중 최대 회차수 (빈 패딩칸 방지, 다중 배치 안전)
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var classSh = ss.getSheetByName(CLASS_SHEET_NAME_DB);
    if (classSh && classSh.getLastRow() >= 2 && classId) {
      // 같은 class_id의 배치별 회차수 집계 → 최대값
      var batchCount = {};
      for (var k = 0; k < d1Data.length; k++) {
        if (String(d1Data[k][classIdIdx]) !== String(classId)) continue;
        var bk = extractD1BatchKey_(String(d1Data[k][idIdx]));
        batchCount[bk] = (batchCount[bk] || 0) + 1;
      }
      // 현재 배치는 방금 재정렬한 total로 반영 (d1Data 스냅샷은 추가 전일 수 있음)
      batchCount[batchKey] = total;
      var maxLoop = 0;
      Object.keys(batchCount).forEach(function(bk) { if (batchCount[bk] > maxLoop) maxLoop = batchCount[bk]; });

      var cData = classSh.getRange(2, 1, classSh.getLastRow() - 1, CLASS_HEADERS.length).getValues();
      var cidIdx = CLASS_HEADERS.indexOf('class_id');
      var clpIdx = CLASS_HEADERS.indexOf('class_loop');
      for (var ci3 = 0; ci3 < cData.length; ci3++) {
        if (String(cData[ci3][cidIdx]) === String(classId)) {
          if (parseInt(cData[ci3][clpIdx], 10) !== maxLoop) {
            classSh.getRange(ci3 + 2, clpIdx + 1).setValue(maxLoop);
          }
          break;
        }
      }
    }
  } catch (e) {}

  SpreadsheetApp.flush();
  // 캐시 무효화
  var cache = CacheService.getScriptCache();
  cache.remove('mcd_' + batchKey);
  if (classId) cache.remove('sessions_' + classId);
  cache.remove('all_class_d1_sessions');
  cache.remove('class_batch_counts');
  cache.remove('all_batch_members');
  cache.remove('class_member_index');

  return { success: true, total: total };
}

/**
 * 회차 완료 상태를 업데이트합니다.
 */
function updateClassD1Completed(classD1Id, completed) {
  const sheet = ensureClassD1Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터가 없습니다.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(id => String(id) === String(classD1Id));
  if (idx < 0) return { success: false, message: '해당 회차를 찾을 수 없습니다.' };

  const completedCol = CLASS_D1_HEADERS.indexOf('completed') + 1;
  sheet.getRange(idx + 2, completedCol).setValue(completed ? 'Y' : 'N');

  return { success: true, message: '회차 상태 업데이트 완료' };
}

/**
 * 회차 날짜를 수정합니다.
 */
function updateClassD1Date(classD1Id, newDate) {
  const sheet = ensureClassD1Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터 없음' };
  const rawData = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const idx = rawData.findIndex(r => String(r[0]) === String(classD1Id));
  if (idx < 0) return { success: false, message: '회차를 찾을 수 없습니다.' };
  const classId = String(rawData[idx][1] || '');
  const dateCol = CLASS_D1_HEADERS.indexOf('class_date') + 1;
  sheet.getRange(idx + 2, dateCol).setValue(newDate);
  const cache = CacheService.getScriptCache();
  if (classId) cache.remove('sessions_' + classId);
  cache.remove('all_class_d1_sessions');
  return { success: true, message: '날짜 수정 완료' };
}

/**
 * 회차를 삭제합니다.
 */
function deleteClassD1(classD1Id) {
  const sheet = ensureClassD1Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터가 없습니다.' };

  const rawData = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const idx = rawData.findIndex(r => String(r[0]) === String(classD1Id));
  if (idx < 0) return { success: false, message: '해당 회차를 찾을 수 없습니다.' };
  const classId = String(rawData[idx][1] || '');

  // 휴강 회차 삭제 차단
  const holidayColIdx = CLASS_D1_HEADERS.indexOf('holiday') + 1;
  if (holidayColIdx > 0) {
    const holidayVal = String(sheet.getRange(idx + 2, holidayColIdx).getValue() || '');
    if (holidayVal === 'Y') {
      return { success: false, message: '휴강 회차는 먼저 해제 후 삭제하세요.' };
    }
  }

  sheet.deleteRow(idx + 2);
  const cache = CacheService.getScriptCache();
  if (classId) cache.remove('sessions_' + classId);
  cache.remove('all_class_d1_sessions');
  return { success: true, message: '회차 삭제 완료' };
}

/**
 * [정리용] class.class_loop 초과 회차 자동 식별 + 삭제
 *  - 2026-05-11 잘못 실행된 appendRoundsForContract로 추가된 회차를 정리
 *  - class 시트의 class_loop가 N인데 class_d1에 N보다 큰 회차가 있으면 그게 잘못 추가된 회차
 *  - 해당 회차의 class_d1 행 삭제 + 모든 회원의 no_<loop> 빈값으로
 *  - 휴강 회차는 건드리지 않음 (휴강은 정상 회차로 간주)
 * @return 삭제된 회차 정보
 */
function cleanupExtraRoundsBeyondClassLoop() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var classSh = ss.getSheetByName(CLASS_SHEET_NAME_DB);
  if (!classSh) return { success: false, message: 'class 시트 없음' };
  var clast = classSh.getLastRow();
  if (clast < 2) return { success: false, message: 'class 데이터 없음' };
  var cData = classSh.getRange(2, 1, clast - 1, CLASS_HEADERS.length).getValues();
  var cidIdx = CLASS_HEADERS.indexOf('class_id');
  var clpIdx = CLASS_HEADERS.indexOf('class_loop');
  var classLoopMap = {};
  cData.forEach(function(r) {
    classLoopMap[String(r[cidIdx])] = parseInt(r[clpIdx], 10) || 0;
  });

  var d1Sh = ensureClassD1Sheet_();
  var d1Last = d1Sh.getLastRow();
  if (d1Last < 2) return { success: false, message: 'class_d1 데이터 없음' };
  var d1Data = d1Sh.getRange(2, 1, d1Last - 1, CLASS_D1_HEADERS.length).getValues();
  var classIdIdx = CLASS_D1_HEADERS.indexOf('class_id');
  var loopIdx = CLASS_D1_HEADERS.indexOf('class_loop');
  var classD1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var holidayIdx = CLASS_D1_HEADERS.indexOf('holiday');

  // 삭제 후보 식별
  var toDelete = []; // { rowIdx, classD1Id, classId, loop, batchKey }
  for (var i = 0; i < d1Data.length; i++) {
    var classId = String(d1Data[i][classIdIdx]);
    var loop = parseInt(d1Data[i][loopIdx], 10);
    var maxLoop = classLoopMap[classId] || 0;
    if (maxLoop > 0 && loop > maxLoop && String(d1Data[i][holidayIdx] || '') !== 'Y') {
      toDelete.push({
        rowIdx: i + 2,
        classD1Id: String(d1Data[i][classD1IdIdx]),
        classId: classId,
        loop: loop,
        batchKey: extractD1BatchKey_(String(d1Data[i][classD1IdIdx]))
      });
    }
  }

  if (toDelete.length === 0) {
    return { success: true, message: '정리할 회차 없음', deletedCount: 0 };
  }

  // 회원 셀의 no_<loop> 빈값으로 정리
  var mcdSh = ensureMemberClassDetailsSheet_();
  var mcdLast = mcdSh.getLastRow();
  if (mcdLast >= 2) {
    var mcdData = mcdSh.getRange(2, 1, mcdLast - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    var d1IdMcdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    for (var mi = 0; mi < mcdData.length; mi++) {
      var memBatchKey = String(mcdData[mi][d1IdMcdIdx]);
      var changed = false;
      var rowVals = mcdData[mi].slice();
      toDelete.forEach(function(d) {
        if (d.batchKey !== memBatchKey) return;
        var fieldIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + d.loop);
        if (fieldIdx >= 0 && rowVals[fieldIdx] !== '') {
          rowVals[fieldIdx] = '';
          changed = true;
        }
      });
      if (changed) {
        mcdSh.getRange(mi + 2, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([rowVals]);
      }
    }
  }

  // class_d1 행 삭제 (역순으로)
  toDelete.sort(function(a, b) { return b.rowIdx - a.rowIdx; });
  toDelete.forEach(function(d) {
    d1Sh.deleteRow(d.rowIdx);
  });

  SpreadsheetApp.flush();
  // 캐시 무효화
  var cache = CacheService.getScriptCache();
  var seenBatches = {};
  toDelete.forEach(function(d) {
    if (!seenBatches[d.batchKey]) {
      cache.remove('mcd_' + d.batchKey);
      seenBatches[d.batchKey] = true;
    }
    cache.remove('sessions_' + d.classId);
  });
  cache.remove('all_class_d1_sessions');

  return {
    success: true,
    message: toDelete.length + '개 잉여 회차 삭제 완료',
    deletedCount: toDelete.length,
    deleted: toDelete.map(function(d) { return { classD1Id: d.classD1Id, loop: d.loop, classId: d.classId }; })
  };
}

/**
 * @deprecated 2026-05-11 사용자 의도와 반대로 회차 자동 추가 → 호출 중단. 함수 본체 보존.
 * 계약회차 증가 시 미래 슬롯이 부족하면 끝에 회차 자동 추가
 * @param {string} classD1Id - 회원의 한 회차 ID (배치 식별용)
 * @param {string} memberId - 새 ●를 받을 회원 ID
 * @param {number} count - 추가할 회차 수
 */
function appendRoundsForContract(classD1Id, memberId, count) {
  if (count <= 0) return { success: false, message: '추가할 회차 수가 0 이하입니다.' };
  var d1Sheet = ensureClassD1Sheet_();
  var lastRow = d1Sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터 없음.' };

  var batchKey = extractD1BatchKey_(classD1Id);
  var d1Data = d1Sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
  var classD1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var classIdIdx   = CLASS_D1_HEADERS.indexOf('class_id');
  var classLoopIdx = CLASS_D1_HEADERS.indexOf('class_loop');
  var classDateIdx = CLASS_D1_HEADERS.indexOf('class_date');
  var classWeekIdx = CLASS_D1_HEADERS.indexOf('class_week');
  var holidayIdx   = CLASS_D1_HEADERS.indexOf('holiday');

  // 같은 배치 행들 수집, class_loop 기준 마지막 행 찾기
  var batchRows = [];
  for (var i = 0; i < d1Data.length; i++) {
    if (extractD1BatchKey_(String(d1Data[i][classD1IdIdx])) === batchKey) {
      batchRows.push({ idx: i, loop: Number(d1Data[i][classLoopIdx]), row: d1Data[i] });
    }
  }
  if (batchRows.length === 0) return { success: false, message: '배치 회차 없음.' };
  batchRows.sort(function(a, b) { return a.loop - b.loop; });
  var lastBatchRow = batchRows[batchRows.length - 1];
  var lastLoop = lastBatchRow.loop;
  var lastDateRaw = lastBatchRow.row[classDateIdx];
  var tz = Session.getScriptTimeZone();
  var lastDateStr = (lastDateRaw instanceof Date)
    ? Utilities.formatDate(lastDateRaw, tz, 'yyyyMMdd')
    : String(lastDateRaw || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(lastDateStr)) return { success: false, message: '마지막 회차 일자 형식 오류: ' + lastDateStr };

  // 마지막 회차 행의 메타 정보 복사 (휴강/백업 필드는 비움)
  var templateRow = lastBatchRow.row.slice();
  templateRow[holidayIdx] = '';
  var holidayNoteIdx2 = CLASS_D1_HEADERS.indexOf('holiday_note');
  var holidayBackupIdx2 = CLASS_D1_HEADERS.indexOf('holiday_backup');
  var classD1NoteIdx2 = CLASS_D1_HEADERS.indexOf('class_d1_note');
  if (holidayNoteIdx2 >= 0)   templateRow[holidayNoteIdx2] = '';
  if (holidayBackupIdx2 >= 0) templateRow[holidayBackupIdx2] = '';
  if (classD1NoteIdx2 >= 0)   templateRow[classD1NoteIdx2] = '';

  // count개 행 생성 (7일 간격)
  var y = parseInt(lastDateStr.substring(0,4));
  var m = parseInt(lastDateStr.substring(4,6)) - 1;
  var d = parseInt(lastDateStr.substring(6,8));
  var baseDate = new Date(y, m, d);
  var weekNames = ['일','월','화','수','목','금','토'];
  var newRows = [];
  for (var k = 1; k <= count; k++) {
    var newDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 7 * k);
    var newDateStr = Utilities.formatDate(newDate, tz, 'yyyyMMdd');
    var newLoop = lastLoop + k;
    var newId = batchKey + '_' + newLoop;
    var row = templateRow.slice();
    row[classD1IdIdx] = newId;
    row[classLoopIdx] = newLoop;
    row[classDateIdx] = newDateStr;
    if (classWeekIdx >= 0) row[classWeekIdx] = weekNames[newDate.getDay()];
    newRows.push(row);
  }
  if (newRows.length > 0) {
    d1Sheet.getRange(d1Sheet.getLastRow() + 1, 1, newRows.length, CLASS_D1_HEADERS.length).setValues(newRows);
  }

  // 해당 회원의 member_class_details에 새 회차 'O' 채움
  var mcdSheet = ensureMemberClassDetailsSheet_();
  var mcdLast = mcdSheet.getLastRow();
  if (mcdLast >= 2) {
    var mcdData = mcdSheet.getRange(2, 1, mcdLast - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    var midIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_id');
    var d1IdMcdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    for (var r = 0; r < mcdData.length; r++) {
      if (String(mcdData[r][d1IdMcdIdx]) !== String(batchKey)) continue;
      if (String(mcdData[r][midIdx]) !== String(memberId)) continue;
      var rowVals = mcdData[r].slice();
      for (var k2 = 1; k2 <= count; k2++) {
        var idx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + (lastLoop + k2));
        if (idx >= 0) rowVals[idx] = 'O';
      }
      mcdSheet.getRange(r + 2, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([rowVals]);
      break;
    }
  }

  SpreadsheetApp.flush();
  var cache = CacheService.getScriptCache();
  cache.remove('mcd_' + batchKey);
  cache.remove('sessions_' + String(lastBatchRow.row[classIdIdx]));
  cache.remove('all_class_d1_sessions');

  return { success: true, message: count + '개 회차 추가 완료 (회원 ' + memberId + ')', addedCount: count };
}

// =============================================================================
// 휴강(holiday) 처리 함수
// =============================================================================

/**
 * 회차를 휴강으로 지정합니다.
 *  - 미래 회차: 회원 O/R → 다음 미래 빈 셀로 시프트, 회원 셀은 '' 처리
 *  - 오늘/과거 회차: 회원 O/R → 'X' 변경 + 미래 빈 셀에 'O' 자동 추가
 *  - 변경 전 값은 class_d1.holiday_backup(X열)에 JSON 저장
 *  - 다른 휴강 회차는 시프트 대상 후보에서 제외
 */
function setClassD1Holiday(classD1Id, note) {
  var d1Sheet = ensureClassD1Sheet_();
  var lastRow = d1Sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터가 없습니다.' };

  var classD1IdIdx     = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var classIdIdx       = CLASS_D1_HEADERS.indexOf('class_id');
  var classLoopIdx     = CLASS_D1_HEADERS.indexOf('class_loop');
  var classDateIdx     = CLASS_D1_HEADERS.indexOf('class_date');
  var holidayIdx       = CLASS_D1_HEADERS.indexOf('holiday');
  var holidayNoteIdx   = CLASS_D1_HEADERS.indexOf('holiday_note');
  var holidayBackupIdx = CLASS_D1_HEADERS.indexOf('holiday_backup');

  var d1Data = d1Sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
  var targetRow = -1, targetLoop = null, targetDate = null, classId = null;
  for (var i = 0; i < d1Data.length; i++) {
    if (String(d1Data[i][classD1IdIdx]) === String(classD1Id)) {
      targetRow = i;
      targetLoop = Number(d1Data[i][classLoopIdx]);
      var rawDate = d1Data[i][classDateIdx];
      if (rawDate instanceof Date) {
        targetDate = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyyMMdd');
      } else {
        targetDate = String(rawDate || '').replace(/-/g, '');
      }
      classId = String(d1Data[i][classIdIdx]);
      break;
    }
  }
  if (targetRow < 0) return { success: false, message: '회차를 찾을 수 없습니다.' };
  if (String(d1Data[targetRow][holidayIdx]) === 'Y') {
    return { success: false, message: '이미 휴강 지정된 회차입니다.' };
  }

  // 같은 배치의 회차 정보 수집 (시프트 후보)
  var batchKey = extractD1BatchKey_(classD1Id);
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var batchD1List = [];
  for (var i = 0; i < d1Data.length; i++) {
    if (extractD1BatchKey_(String(d1Data[i][classD1IdIdx])) !== batchKey) continue;
    var rawDate = d1Data[i][classDateIdx];
    var dateStr = (rawDate instanceof Date)
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyyMMdd')
      : String(rawDate || '').replace(/-/g, '');
    batchD1List.push({
      loop: Number(d1Data[i][classLoopIdx]),
      date: dateStr,
      holiday: String(d1Data[i][holidayIdx] || '') === 'Y'
    });
  }
  batchD1List.sort(function(a, b) { return a.loop - b.loop; });

  var mcdSheet = ensureMemberClassDetailsSheet_();
  var mcdLastRow = mcdSheet.getLastRow();
  var backup = {};
  var modifiedCount = 0;

  if (mcdLastRow >= 2) {
    var mcdData = mcdSheet.getRange(2, 1, mcdLastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    var memberIdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_id');
    var d1IdMcdIdx  = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    var fieldKeyIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + targetLoop);
    if (fieldKeyIdx < 0) return { success: false, message: 'no_' + targetLoop + ' 컬럼이 없습니다.' };

    var isFuture = targetDate !== '' && targetDate > todayStr;
    var isPastOrToday = targetDate !== '' && targetDate <= todayStr;
    var modifiedRows = [];

    for (var mi = 0; mi < mcdData.length; mi++) {
      if (String(mcdData[mi][d1IdMcdIdx]) !== String(batchKey)) continue;
      var memberId = String(mcdData[mi][memberIdIdx]);
      var origVal = String(mcdData[mi][fieldKeyIdx] || '').trim().toUpperCase();
      var rowVals = mcdData[mi].slice();
      var memberBackup = { orig: origVal, shifted_loop: null };
      var modified = false;

      if (isFuture) {
        if (origVal === 'O' || origVal === 'R') {
          // 다음 미래 빈 셀로 시프트 (휴강 제외, date > today, val === '')
          var shiftToLoop = null;
          for (var bi = 0; bi < batchD1List.length; bi++) {
            var bd = batchD1List[bi];
            if (bd.loop <= targetLoop) continue;
            if (bd.holiday) continue;
            if (bd.date === '' || bd.date <= todayStr) continue;
            var bdFieldIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + bd.loop);
            if (bdFieldIdx < 0) continue;
            if (String(rowVals[bdFieldIdx] || '').trim() === '') {
              rowVals[bdFieldIdx] = origVal;
              shiftToLoop = bd.loop;
              break;
            }
          }
          memberBackup.shifted_loop = shiftToLoop;
          rowVals[fieldKeyIdx] = '';
          modified = true;
        } else if (origVal === 'X') {
          rowVals[fieldKeyIdx] = '';
          modified = true;
        }
      } else if (isPastOrToday) {
        if (origVal === 'O' || origVal === 'R') {
          // 미래 빈 셀에 ● 추가 + 현 셀 'X'
          var shiftToLoop = null;
          for (var bi = 0; bi < batchD1List.length; bi++) {
            var bd = batchD1List[bi];
            if (bd.holiday) continue;
            if (bd.date === '' || bd.date <= todayStr) continue;
            var bdFieldIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + bd.loop);
            if (bdFieldIdx < 0) continue;
            if (String(rowVals[bdFieldIdx] || '').trim() === '') {
              rowVals[bdFieldIdx] = 'O';
              shiftToLoop = bd.loop;
              break;
            }
          }
          memberBackup.shifted_loop = shiftToLoop;
          rowVals[fieldKeyIdx] = 'X';
          modified = true;
        }
      }

      if (modified) {
        backup[memberId] = memberBackup;
        modifiedRows.push({ rowIdx: mi + 2, values: rowVals });
        modifiedCount++;
      }
    }

    modifiedRows.forEach(function(mr) {
      mcdSheet.getRange(mr.rowIdx, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([mr.values]);
    });
  }

  // class_d1 휴강 마크 저장
  d1Sheet.getRange(targetRow + 2, holidayIdx + 1).setValue('Y');
  d1Sheet.getRange(targetRow + 2, holidayNoteIdx + 1).setValue(String(note || ''));
  d1Sheet.getRange(targetRow + 2, holidayBackupIdx + 1).setValue(JSON.stringify(backup));
  SpreadsheetApp.flush();

  var cache = CacheService.getScriptCache();
  cache.remove('mcd_' + batchKey);
  if (classId) cache.remove('sessions_' + classId);
  cache.remove('all_class_d1_sessions');

  return {
    success: true,
    message: targetLoop + '회차 휴강 지정 완료 (회원 ' + modifiedCount + '명 변경)',
    modifiedCount: modifiedCount
  };
}

/**
 * 회차의 휴강을 해제합니다.
 * @param {string} restoreMode - 'backup'(백업 복원) / 'allO'(전체 참석) / 'allX'(전체 결석)
 */
function unsetClassD1Holiday(classD1Id, restoreMode) {
  var mode = String(restoreMode || 'backup');
  var d1Sheet = ensureClassD1Sheet_();
  var lastRow = d1Sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터가 없습니다.' };

  var classD1IdIdx     = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var classIdIdx       = CLASS_D1_HEADERS.indexOf('class_id');
  var classLoopIdx     = CLASS_D1_HEADERS.indexOf('class_loop');
  var holidayIdx       = CLASS_D1_HEADERS.indexOf('holiday');
  var holidayNoteIdx   = CLASS_D1_HEADERS.indexOf('holiday_note');
  var holidayBackupIdx = CLASS_D1_HEADERS.indexOf('holiday_backup');

  var d1Data = d1Sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
  var targetRow = -1, targetLoop = null, classId = null;
  for (var i = 0; i < d1Data.length; i++) {
    if (String(d1Data[i][classD1IdIdx]) === String(classD1Id)) {
      targetRow = i;
      targetLoop = Number(d1Data[i][classLoopIdx]);
      classId = String(d1Data[i][classIdIdx]);
      break;
    }
  }
  if (targetRow < 0) return { success: false, message: '회차를 찾을 수 없습니다.' };
  if (String(d1Data[targetRow][holidayIdx]) !== 'Y') {
    return { success: false, message: '휴강 상태가 아닙니다.' };
  }

  var backup = {};
  try {
    var backupStr = String(d1Data[targetRow][holidayBackupIdx] || '');
    if (backupStr) backup = JSON.parse(backupStr);
  } catch (e) {
    return { success: false, message: '백업 데이터 파싱 실패: ' + e.message };
  }

  var batchKey = extractD1BatchKey_(classD1Id);
  var mcdSheet = ensureMemberClassDetailsSheet_();
  var mcdLastRow = mcdSheet.getLastRow();
  var fieldKeyIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + targetLoop);
  var modifiedCount = 0;

  if (mcdLastRow >= 2 && fieldKeyIdx >= 0) {
    var mcdData = mcdSheet.getRange(2, 1, mcdLastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    var memberIdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_id');
    var d1IdMcdIdx  = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    var modifiedRows = [];

    for (var mi = 0; mi < mcdData.length; mi++) {
      if (String(mcdData[mi][d1IdMcdIdx]) !== String(batchKey)) continue;
      var memberId = String(mcdData[mi][memberIdIdx]);
      var rowVals = mcdData[mi].slice();
      var memberBackup = backup[memberId] || null;
      var modified = false;

      // 1단계: 시프트 되돌리기
      if (memberBackup && memberBackup.shifted_loop) {
        var shiftedFieldIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + memberBackup.shifted_loop);
        if (shiftedFieldIdx >= 0) {
          rowVals[shiftedFieldIdx] = '';
          modified = true;
        }
      }

      // 2단계: 휴강 셀 복원 (모드별)
      if (mode === 'backup') {
        if (memberBackup) {
          rowVals[fieldKeyIdx] = memberBackup.orig || '';
          modified = true;
        }
      } else if (mode === 'allO') {
        rowVals[fieldKeyIdx] = 'O';
        modified = true;
      } else if (mode === 'allX') {
        rowVals[fieldKeyIdx] = 'X';
        modified = true;
      }

      if (modified) {
        modifiedRows.push({ rowIdx: mi + 2, values: rowVals });
        modifiedCount++;
      }
    }

    modifiedRows.forEach(function(mr) {
      mcdSheet.getRange(mr.rowIdx, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([mr.values]);
    });
  }

  d1Sheet.getRange(targetRow + 2, holidayIdx + 1).setValue('N');
  d1Sheet.getRange(targetRow + 2, holidayNoteIdx + 1).setValue('');
  d1Sheet.getRange(targetRow + 2, holidayBackupIdx + 1).setValue('');
  SpreadsheetApp.flush();

  var cache = CacheService.getScriptCache();
  cache.remove('mcd_' + batchKey);
  if (classId) cache.remove('sessions_' + classId);
  cache.remove('all_class_d1_sessions');

  return {
    success: true,
    message: targetLoop + '회차 휴강 해제 완료 (' + mode + ', 회원 ' + modifiedCount + '명 변경)',
    modifiedCount: modifiedCount
  };
}

/**
 * 휴강 일괄 적용 (휴강관리 모달에서 호출)
 * @param {Array} updates - [{classD1Id, isHoliday, note, restoreMode}]
 */
function bulkSetClassD1Holiday(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return { success: false, message: '변경할 회차가 없습니다.' };
  }
  var results = [];
  var totalModified = 0;
  var okCount = 0;
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    var r = u.isHoliday
      ? setClassD1Holiday(u.classD1Id, u.note || '')
      : unsetClassD1Holiday(u.classD1Id, u.restoreMode || 'backup');
    results.push(r);
    if (r && r.success) okCount++;
    if (r && r.modifiedCount) totalModified += r.modifiedCount;
  }
  return {
    success: okCount === updates.length,
    message: okCount + '/' + updates.length + ' 회차 처리 (회원 ' + totalModified + '회 변경)',
    results: results
  };
}

/**
 * 회차별 수업비고 저장 (Y열 class_d1_note)
 */
function saveClassD1Note(classD1Id, note) {
  var sheet = ensureClassD1Sheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터가 없습니다.' };

  var classD1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var classIdIdx   = CLASS_D1_HEADERS.indexOf('class_id');
  var noteIdx      = CLASS_D1_HEADERS.indexOf('class_d1_note');

  var data = sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][classD1IdIdx]) === String(classD1Id)) {
      sheet.getRange(i + 2, noteIdx + 1).setValue(String(note || ''));
      var classId = String(data[i][classIdIdx]);
      var cache = CacheService.getScriptCache();
      if (classId) cache.remove('sessions_' + classId);
      cache.remove('all_class_d1_sessions');
      return { success: true, message: '수업비고 저장 완료' };
    }
  }
  return { success: false, message: '회차를 찾을 수 없습니다.' };
}

/**
 * 회차에 물건들을 일괄 등록합니다.
 * - stu_member = '추천', class_d1_id 강제 업데이트, bid_datetime_2 복사
 */
/**
 * 신규 물건을 items 시트에 생성하고 해당 수업회차에 동시 등록합니다.
 */
function createItemAndRegisterToD1(classD1Id, itemData, className, classDate, classLoop) {
  if (!classD1Id) return { success: false, message: '회차 ID 없음' };
  var inDate = String(itemData.inDate || '').trim();
  var mNameOverride = String(itemData.mName || '').trim(); // PT/돈클: 실제 회원명
  var memberIdIn = String(itemData.memberId || '').trim();
  // PT/돈클: 클라이언트가 memberId 못 보낸 경우 서버에서 배치 대표회원으로 자동 해소
  if (!memberIdIn) {
    var repInfo = _getBatchRepMemberInfo_(classD1Id);
    if (repInfo) {
      if (!mNameOverride && repInfo.name) mNameOverride = repInfo.name;
      if (repInfo.memberId) memberIdIn = repInfo.memberId;
    }
  }
  var result = createData(
    inDate,
    String(itemData.sakunNo || '').trim(),
    String(itemData.court || '').trim(),
    '검증',
    String(itemData.mNameId || '대표님').trim(),
    mNameOverride,
    parseInt(String(itemData.bidPrice || '0').replace(/[^0-9]/g, '')) || '',
    memberIdIn,
    '',    // bidState
    '',    // imageId
    '',    // note
    '',    // mName2
    '신규', // chuchenState
    '',    // regMember
    ''     // auctionId
  );
  if (!result || !result.success) return result || { success: false, message: '물건 생성 실패' };
  var newId = result.data && result.data.id;
  if (!newId) return { success: false, message: '생성된 물건 ID를 찾을 수 없습니다.' };
  // PT/돈클: mNameOverride 전달 → m_name 덮어쓰기 스킵하고 실제 회원명 유지
  var regResult = addItemsToClassD1(classD1Id, [newId], className, classDate, classLoop, mNameOverride);
  if (!regResult.success) return { success: false, message: '물건 생성 완료, 회차 등록 실패: ' + regResult.message };
  return { success: true, message: '신규 물건 생성 및 회차 등록 완료' };
}

function addItemsToClassD1(classD1Id, itemIds, className, classDate, classLoop, mNameOverride) {
  if (!classD1Id || !Array.isArray(itemIds) || itemIds.length === 0) {
    return { success: false, message: '파라미터 오류' };
  }
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: 'items 시트 없음' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터 없음' };

  // 시트 컬럼 수 부족하면 확장 (헤더 텍스트는 건드리지 않음)
  var needCols = ITEM_HEADERS.length;
  if (sheet.getMaxColumns() < needCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
  }

  // ITEM_HEADERS 고정 인덱스 사용 (1-based)
  var idCol           = ITEM_HEADERS.indexOf('id') + 1;
  var stuMemberCol    = ITEM_HEADERS.indexOf('stu_member') + 1;
  var mNameCol        = ITEM_HEADERS.indexOf('m_name') + 1;
  var classD1IdCol    = ITEM_HEADERS.indexOf('class_d1_id') + 1;    // S열 = 19
  var chuchenStateCol = ITEM_HEADERS.indexOf('chuchen_state') + 1;
  var chuchenDateCol  = ITEM_HEADERS.indexOf('chuchen_date') + 1;
  var bd2Col          = ITEM_HEADERS.indexOf('bid_datetime_2') + 1; // T열 = 20

  // m_name 결정 + PT/돈클 대표 회원 ID 준비:
  //   1) mNameOverride (명시적 전달 — 신규물건 폼)
  //   2) PT/돈클이면 → 해당 배치 대표 회원 자동 조회 (일괄 등록 포함, member_id도 함께 주입)
  //   3) 그 외(CLASS) → 자동 생성 (종목_yymmdd_N회차)
  var dateStr = String(classDate || '');
  if (dateStr.length === 8) dateStr = dateStr.slice(2);
  var autoMName = (className || '') + '_' + dateStr + '_' + (classLoop || '') + '회차';
  var hasOverride = !!(mNameOverride && String(mNameOverride).trim());
  var mNameVal;
  var repMemberIdForBulk = '';
  var isAutoMName = false;
  var repInfo = _getBatchRepMemberInfo_(classD1Id);
  if (hasOverride) {
    mNameVal = String(mNameOverride).trim();
  } else if (repInfo && repInfo.name) {
    mNameVal = repInfo.name;
  } else {
    mNameVal = autoMName;
    isAutoMName = true;
  }
  if (repInfo && repInfo.memberId) repMemberIdForBulk = repInfo.memberId;

  // 회차 정보에서 bid_datetime_2 조회
  var d1Sheet = ensureClassD1Sheet_();
  var d1LastRow = d1Sheet.getLastRow();
  var bidDatetime2Val = '';
  if (d1LastRow >= 2) {
    var d1Data = d1Sheet.getRange(2, 1, d1LastRow - 1, CLASS_D1_HEADERS.length).getValues();
    var d1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
    var bd2Idx  = CLASS_D1_HEADERS.indexOf('bid_datetime_2');
    var found = d1Data.find(function(r) { return String(r[d1IdIdx]) === String(classD1Id); });
    if (found && bd2Idx >= 0) {
      var raw = found[bd2Idx];
      if (raw instanceof Date && !isNaN(raw.getTime())) {
        bidDatetime2Val = Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyMMddHHmm');
      } else {
        bidDatetime2Val = raw ? String(raw) : '';
      }
    }
  }

  // id + member_id 컬럼만 한 번에 읽기 (캐시 무효화 대상 수집용)
  var memberIdCol = ITEM_HEADERS.indexOf('member_id') + 1;
  var scanFrom = Math.min(idCol, memberIdCol);
  var scanTo   = Math.max(idCol, memberIdCol);
  var scanWidth = scanTo - scanFrom + 1;
  var scanData = sheet.getRange(2, scanFrom, lastRow - 1, scanWidth).getValues();
  var idColRel = idCol - scanFrom;
  var midColRel = memberIdCol - scanFrom;
  var ids = scanData.map(function(r){ return String(r[idColRel]); });

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var nowIso = new Date().toISOString();
  var updated = 0;
  var notFound = [];
  var affectedMemberIds = {};

  itemIds.forEach(function(itemId) {
    var idx = ids.indexOf(String(itemId));
    if (idx < 0) { notFound.push(itemId); return; }
    var row = idx + 2;
    sheet.getRange(row, stuMemberCol).setValue('추천');
    sheet.getRange(row, mNameCol).setValue(mNameVal);
    sheet.getRange(row, classD1IdCol).setValue(classD1Id);
    sheet.getRange(row, chuchenStateCol).setValue('전달완료');
    sheet.getRange(row, chuchenDateCol).setValue(nowIso);
    sheet.getRange(row, bd2Col).setValue(bidDatetime2Val);
    var existingMid = String(scanData[idx][midColRel] || '').trim();
    // CLASS(일반): m_name이 자동생성(종목_yymmdd_N회차)이므로 기존 member_id 잔존 시 클리어 — 상세탭 회원박스 불일치 방지
    if (isAutoMName) {
      if (existingMid) {
        sheet.getRange(row, memberIdCol).setValue('');
        affectedMemberIds[existingMid] = true;
      }
    } else if (!hasOverride && repMemberIdForBulk) {
      // PT/돈클 일괄등록: m_name을 회차 대표 이름으로 덮어쓸 때 member_id도 반드시 동기화
      if (existingMid !== repMemberIdForBulk) {
        sheet.getRange(row, memberIdCol).setValue(repMemberIdForBulk);
        if (existingMid) affectedMemberIds[existingMid] = true; // 옛 회원 캐시도 무효화
      }
      affectedMemberIds[repMemberIdForBulk] = true;
    } else if (!existingMid && repMemberIdForBulk) {
      sheet.getRange(row, memberIdCol).setValue(repMemberIdForBulk);
      affectedMemberIds[repMemberIdForBulk] = true;
    } else if (existingMid) {
      affectedMemberIds[existingMid] = true;
    }
    updated++;
  });

  SpreadsheetApp.flush();
  invalidateMemberItemsCache_(Object.keys(affectedMemberIds));

  var msg = updated + '개 물건 등록 완료';
  if (notFound.length > 0) msg += ' (미매칭 ' + notFound.length + '건)';
  return { success: true, message: msg, updated: updated, notFound: notFound };
}

/**
 * 회차에서 물건을 취소합니다 (class_d1_id/bid_datetime_2 초기화, stu_member='미정').
 */
function removeItemFromClassD1(itemId) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: 'items 시트 없음' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터 없음' };

  var idCol            = ITEM_HEADERS.indexOf('id') + 1;
  var d1IdCol          = ITEM_HEADERS.indexOf('class_d1_id') + 1;
  var bd2Col           = ITEM_HEADERS.indexOf('bid_datetime_2') + 1;
  var stuMemberCol     = ITEM_HEADERS.indexOf('stu_member') + 1;
  var chuchenDateCol   = ITEM_HEADERS.indexOf('chuchen_date') + 1;
  var chuchenStateCol  = ITEM_HEADERS.indexOf('chuchen_state') + 1;

  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat().map(String);
  var idx = ids.indexOf(String(itemId));
  if (idx < 0) return { success: false, message: '물건을 찾을 수 없습니다.' };

  var row = idx + 2;
  sheet.getRange(row, d1IdCol).setValue('');
  sheet.getRange(row, stuMemberCol).setValue('미정');
  if (bd2Col > 0) sheet.getRange(row, bd2Col).setValue('');
  if (chuchenDateCol > 0) sheet.getRange(row, chuchenDateCol).setValue('');
  if (chuchenStateCol > 0) sheet.getRange(row, chuchenStateCol).setValue('');
  SpreadsheetApp.flush();
  return { success: true, message: '물건 취소 완료' };
}

/**
 * yymmddhhmm 문자열 → timestamp. 파싱 실패 시 NaN.
 */
function parseBd2Str_(s) {
  s = String(s || '').trim();
  if (s.length !== 10) return NaN;
  var yy = parseInt(s.slice(0,2),10), mo = parseInt(s.slice(2,4),10)-1,
      dd = parseInt(s.slice(4,6),10), hh = parseInt(s.slice(6,8),10),
      mi = parseInt(s.slice(8,10),10);
  var d = new Date(2000+yy, mo, dd, hh, mi);
  return isNaN(d.getTime()) ? NaN : d.getTime();
}

/**
 * 특정 회차의 bid_datetime_2가 경과된 경우 추천 물건을 미정으로 일괄 변경.
 * class_d1_id는 유지, bid_datetime_2는 유지.
 */
function expireClassD1Items(classD1Id) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: 'items 시트 없음' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터 없음' };

  var idIdx      = ITEM_HEADERS.indexOf('class_d1_id');
  var stuIdx     = ITEM_HEADERS.indexOf('stu_member');
  var bd2Idx     = ITEM_HEADERS.indexOf('bid_datetime_2');
  var stuCol     = stuIdx + 1;

  var data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();
  var now = new Date();
  var updated = 0;

  data.forEach(function(row, i) {
    if (String(row[idIdx]) !== String(classD1Id)) return;
    if (String(row[stuIdx]) !== '추천') return;
    var bd2 = row[bd2Idx];
    if (!bd2) return;
    var expTs = parseBd2Str_(String(bd2));
    if (isNaN(expTs) || now.getTime() < expTs) return;
    sheet.getRange(i + 2, stuCol).setValue('미정');
    updated++;
  });

  SpreadsheetApp.flush();
  return { success: true, message: updated + '개 물건 미정 처리 완료' };
}

/**
 * 특정 회차(classD1Id)에 등록된 물건 목록을 조회합니다.
 * - getDataRange()로 전체 읽기 → 헤더 이름으로 class_d1_id 컬럼 탐지
 * - Date 객체를 문자열로 변환하여 google.script.run 직렬화 오류 방지
 */
function getItemsByClassD1Id(classD1Id) {
  if (!classD1Id) return [];
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // [속도 개선] 전체 시트(getDataRange) 대신 헤더 1행 + class_d1_id 열만 스캔 후 매칭 행만 읽기
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v||'').trim(); });

  // class_d1_id 컬럼 탐지: 헤더명 → 고정인덱스 폴백
  var d1Col = headers.indexOf('class_d1_id');
  if (d1Col < 0) d1Col = ITEM_HEADERS.indexOf('class_d1_id'); // = 18
  if (d1Col >= lastCol) {
    Logger.log('[getItemsByClassD1Id] id=' + String(classD1Id).trim() + ' | d1Col=' + d1Col + ' (시트 범위 밖) | matched=0');
    return [];
  }

  var searchId = String(classD1Id).trim();
  var d1ColVals = sheet.getRange(2, d1Col + 1, lastRow - 1, 1).getValues();
  var matchedRowNums = [];
  for (var i = 0; i < d1ColVals.length; i++) {
    if (String(d1ColVals[i][0]||'').trim() === searchId) matchedRowNums.push(i + 2);
  }

  // 헤더 → 컬럼 인덱스 매핑 (기존: 행마다 indexOf → 동일 결과를 1회만 계산)
  var colMap = ITEM_HEADERS.map(function(h, idx) {
    var col = headers.indexOf(h);
    return (col < 0) ? idx : col;
  });

  var tz = Session.getScriptTimeZone();
  var result = [];

  // 첫~끝 매칭 행을 한 블록으로 1회 읽기 (getRange 호출 수 고정 → 흩어진 행도 기존보다 느려지지 않음)
  if (matchedRowNums.length > 0) {
    var firstRow = matchedRowNums[0];
    var lastMatchedRow = matchedRowNums[matchedRowNums.length - 1];
    var block = sheet.getRange(firstRow, 1, lastMatchedRow - firstRow + 1, lastCol).getValues();
    matchedRowNums.forEach(function(rowNum) {
      var row = block[rowNum - firstRow];
      var obj = {};
      ITEM_HEADERS.forEach(function(h, idx) {
        var col = colMap[idx];
        var v = (col >= 0 && col < row.length && row[col] != null) ? row[col] : '';
        // Date 객체 → 문자열 변환 (직렬화 오류 방지)
        if (v instanceof Date) {
          v = isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
        }
        obj[h] = v;
      });
      result.push(obj);
    });
  }

  Logger.log('[getItemsByClassD1Id] id=' + searchId + ' | d1Col=' + d1Col + ' | hdr=' + (headers[d1Col]||'?') + ' | totalRows=' + (lastRow-1) + ' | matched=' + result.length);
  return result;
}


// ================================================================================================
// [회원 수업 상세(member_class_details) 시트 관리] CRUD 함수들
// ================================================================================================

/**
 * 수업(classId)의 회원 상세 목록을 조회합니다.
 * - class_d1 시트에서 해당 classId의 모든 배치키와 회차→루프 매핑을 수집
 * - member_class_details에서 동일 classId 회원을 모두 조회하고
 *   복수 배치에 걸쳐 등록된 회원을 1명으로 통합(no_N을 절대 루프 번호로 재매핑)
 */
function readMemberClassDetailsByClassId(classId) {
  var sheet = ensureMemberClassDetailsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // class_d1 시트에서 배치키별 루프 목록 수집 (절대 루프 번호 매핑용)
  var d1Sheet = ensureClassD1Sheet_();
  var d1LastRow = d1Sheet.getLastRow();
  var batchToLoops = {};  // batchKey → [loopNo, ...] sorted
  if (d1LastRow >= 2) {
    var d1Data = d1Sheet.getRange(2, 1, d1LastRow - 1, CLASS_D1_HEADERS.length).getValues();
    var d1ClassIdIdx = CLASS_D1_HEADERS.indexOf('class_id');
    var d1IdIdx      = CLASS_D1_HEADERS.indexOf('class_d1_id');
    var d1LoopIdx    = CLASS_D1_HEADERS.indexOf('class_loop');
    d1Data.forEach(function(r) {
      if (String(r[d1ClassIdIdx]) === String(classId)) {
        var bk   = extractD1BatchKey_(String(r[d1IdIdx]));
        var loop = parseInt(r[d1LoopIdx]) || 0;
        if (!batchToLoops[bk]) batchToLoops[bk] = [];
        if (batchToLoops[bk].indexOf(loop) < 0) batchToLoops[bk].push(loop);
      }
    });
  }
  if (Object.keys(batchToLoops).length === 0) return [];
  Object.keys(batchToLoops).forEach(function(bk) {
    batchToLoops[bk].sort(function(a, b) { return a - b; });
  });

  var data = sheet.getRange(2, 1, lastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
  var tz = Session.getScriptTimeZone();

  // member_id → [{batchKey, row}] 로 그룹핑 (이 수업의 배치에 속한 행만)
  var memberBatches = {};
  data.forEach(function(row) {
    var obj = {};
    MEMBER_CLASS_DETAILS_HEADERS.forEach(function(h, i) {
      var val = row[i];
      obj[h] = (val instanceof Date) ? Utilities.formatDate(val, tz, 'yyMMdd')
                                     : (val !== undefined && val !== null ? val : '');
    });
    var bk  = String(obj.class_d1_id || '');
    var mid = String(obj.member_id   || '');
    if (!batchToLoops[bk] || !mid) return;  // 이 수업 소속이 아닌 행 제외
    if (!memberBatches[mid]) memberBatches[mid] = [];
    memberBatches[mid].push({ batchKey: bk, row: obj });
  });

  var allMembers = readAllMembersNew();

  return Object.keys(memberBatches).map(function(mid) {
    var batches = memberBatches[mid];
    // 가장 최근 배치를 primary로 (reg_date 내림차순)
    batches.sort(function(a, b) {
      return String(b.row.reg_date).localeCompare(String(a.row.reg_date));
    });
    var primary = Object.assign({}, batches[0].row);

    // no_1..no_20 을 절대 루프 번호 기준으로 재매핑 (중복 배치 통합)
    for (var n = 1; n <= 20; n++) primary['no_' + n] = '';
    batches.forEach(function(b) {
      var loops = batchToLoops[b.batchKey] || [];
      loops.forEach(function(loop, idx) {
        var val = String(b.row['no_' + (idx + 1)] || '').trim();
        if (val !== '') primary['no_' + loop] = val;
      });
    });

    // member_status / remark1 – 비어있으면 다른 배치에서 보충
    if (!primary.member_status) {
      for (var bi = 1; bi < batches.length; bi++) {
        if (batches[bi].row.member_status) { primary.member_status = batches[bi].row.member_status; break; }
      }
    }
    if (!primary.remark1) {
      for (var br = 1; br < batches.length; br++) {
        if (batches[br].row.remark1) { primary.remark1 = batches[br].row.remark1; break; }
      }
    }

    var member = allMembers.find(function(m) { return String(m.member_id) === mid; }) || {};
    return Object.assign({}, primary, {
      member_name: member.member_name || '',
      phone:       member.phone       || '',
      gubun:       member.gubun       || '',
      name1: member.name1 || '', name1_gubun: member.name1_gubun || '',
      name2: member.name2 || '', name2_gubun: member.name2_gubun || '',
      name3: member.name3 || '', name3_gubun: member.name3_gubun || ''
    });
  });
}

/**
 * 특정 배치키(batchKey)의 회원 목록을 반환합니다.
 * member_class_details에서 class_d1_id === batchKey 인 행만 조회합니다.
 */
function readMemberClassDetailsByBatchKey(batchKey) {
  if (!batchKey) return [];
  var cache = CacheService.getScriptCache();
  var cacheKey = 'mcd_' + String(batchKey);
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var sheet = ensureMemberClassDetailsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
  var tz = Session.getScriptTimeZone();
  var d1IdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');

  var filtered = data
    .filter(function(row) { return String(row[d1IdIdx]) === String(batchKey); })
    .map(function(row) {
      var obj = {};
      MEMBER_CLASS_DETAILS_HEADERS.forEach(function(h, i) {
        var val = row[i];
        obj[h] = (val instanceof Date) ? Utilities.formatDate(val, tz, 'yyMMdd')
                                       : (val !== undefined && val !== null ? val : '');
      });
      return obj;
    });

  var allMembers = readAllMembersNew();

  // class.class_loop lookup (contract_loop fallback용) - 배치 내 row들은 동일 class_id
  var classLoopFallback = 0;
  try {
    var firstRow = filtered.find(function(r) { return r.class_id; });
    if (firstRow) {
      var classSh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);
      if (classSh) {
        var cLast = classSh.getLastRow();
        if (cLast >= 2) {
          var cidIdx = CLASS_HEADERS.indexOf('class_id');
          var clpIdx = CLASS_HEADERS.indexOf('class_loop');
          var cData = classSh.getRange(2, 1, cLast - 1, CLASS_HEADERS.length).getValues();
          var cRow = cData.find(function(r) { return String(r[cidIdx]) === String(firstRow.class_id); });
          if (cRow) classLoopFallback = parseInt(cRow[clpIdx], 10) || 0;
        }
      }
    }
  } catch(e) { /* ignore */ }

  var result = filtered.map(function(d) {
    var member = allMembers.find(function(m) { return String(m.member_id) === String(d.member_id); }) || {};
    // contract_loop 비어있으면 class.class_loop로 fallback (응답에만 반영, 시트 영속화는 첫 편집/저장 시)
    var cl = d.contract_loop;
    if (cl === '' || cl === null || cl === undefined) {
      d.contract_loop = classLoopFallback || '';
    }
    return Object.assign({}, d, {
      member_name: member.member_name || '',
      phone:       member.phone       || '',
      gubun:       member.gubun       || '',
      name1: member.name1 || '', name1_gubun: member.name1_gubun || '',
      name2: member.name2 || '', name2_gubun: member.name2_gubun || '',
      name3: member.name3 || '', name3_gubun: member.name3_gubun || ''
    });
  });
  try { cache.put(cacheKey, JSON.stringify(result), 120); } catch(e) {}
  return result;
}

/**
 * 선택된 회원들의 상태값을 일괄 업데이트합니다.
 * batchKey: 배치키, memberIds: [memberId, ...], status: 새 상태값
 */
function bulkUpdateMemberStatus(batchKey, memberIds, status) {
  var updated = 0;
  for (var i = 0; i < memberIds.length; i++) {
    var r = saveMemberClassDetail(batchKey, memberIds[i], { member_status: status });
    if (r && r.success) updated++;
  }
  return { success: true, message: updated + '명 상태 변경 완료 (' + status + ')' };
}

/**
 * 출석 일괄 저장
 * changes: [{batchKey, memberId, fields: {no_1:'O', no_3:'X', ...}}]
 */
function bulkSaveAttendance(changes) {
  var updated = 0;
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    var r = saveMemberClassDetail(c.batchKey, c.memberId, c.fields);
    if (r && r.success) updated++;
  }
  return { success: true, message: updated + '명 출석 변경 완료' };
}

/**
 * 수업 회원 상세를 저장(upsert)합니다.
 * updates: 저장할 필드 객체 (e.g. { member_status: '수강중', no_1: '260409', remark1: '...' })
 */
function saveMemberClassDetail(classD1Id, memberId, updates) {
  var sheet = ensureMemberClassDetailsSheet_();
  var lastRow = sheet.getLastRow();
  var d1IdIdx   = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
  var memberIdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_id');

  var existingRow = -1;
  if (lastRow >= 2) {
    var ids  = sheet.getRange(2, d1IdIdx + 1, lastRow - 1, 1).getValues().flat();
    var mids = sheet.getRange(2, memberIdIdx + 1, lastRow - 1, 1).getValues().flat();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i]) === String(classD1Id) && String(mids[i]) === String(memberId)) {
        existingRow = i + 2;
        break;
      }
    }
  }

  if (existingRow > 0) {
    var rowVals = sheet.getRange(existingRow, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues()[0];
    var statusIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_status');
    var prevStatus = String(rowVals[statusIdx] || '');
    MEMBER_CLASS_DETAILS_HEADERS.forEach(function(h, i) {
      if (updates[h] !== undefined) rowVals[i] = updates[h];
    });
    var newStatus = String(rowVals[statusIdx] || '');
    // 상태 변경 시 미래 심볼 자동 처리 (비활성 = 미래 비움, 활성 전환 = 남은회차만큼 미래 ● 채움)
    if (updates.member_status !== undefined && prevStatus !== newStatus) {
      _applyStatusFutureShift_(rowVals, classD1Id, prevStatus, newStatus);
    }
    sheet.getRange(existingRow, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([rowVals]);
  } else {
    var regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var newRow = MEMBER_CLASS_DETAILS_HEADERS.map(function(h) {
      if (h === 'detail_id')   return new Date().getTime().toString();
      if (h === 'class_d1_id') return classD1Id;
      if (h === 'member_id')   return memberId;
      if (h === 'reg_date')    return regDate;
      if (updates[h] !== undefined) return updates[h];
      return '';
    });
    sheet.appendRow(newRow);
  }
  // 캐시 무효화 (다음 readMemberClassDetailsByBatchKey 호출 시 최신 데이터 반환)
  try {
    var batchKey_ = extractD1BatchKey_(classD1Id);
    var _cache = CacheService.getScriptCache();
    _cache.remove('mcd_' + batchKey_);
  } catch(e) {}
  return { success: true };
}

/**
 * 회원 상태 변경에 따른 미래 심볼 자동 시프트
 *  - 비활성('종료'/'홀딩')으로 전환: 미래 회차 셀 모두 비움 (휴강 제외)
 *  - 활성(그 외)으로 전환: 미래 빈 셀에 (contract - used)만큼 ● 자동 채움
 *  - 과거 셀은 절대 건드리지 않음, 휴강 회차는 제외
 *  rowVals를 in-place 수정
 */
function _applyStatusFutureShift_(rowVals, classD1Id, prevStatus, newStatus) {
  var INACTIVE_STATUSES = ['종료', '홀딩'];
  var wasInactive = INACTIVE_STATUSES.indexOf(String(prevStatus || '')) >= 0;
  var isInactive  = INACTIVE_STATUSES.indexOf(String(newStatus || '')) >= 0;
  if (wasInactive === isInactive) return; // 활성/비활성 그룹 내 이동(예: 종료↔홀딩, 진행중↔빈)은 무영향

  // 같은 배치의 회차 정보 수집 (휴강 + 날짜)
  var batchKey = extractD1BatchKey_(classD1Id);
  var d1Sheet = ensureClassD1Sheet_();
  var d1Last = d1Sheet.getLastRow();
  if (d1Last < 2) return;
  var d1Data = d1Sheet.getRange(2, 1, d1Last - 1, CLASS_D1_HEADERS.length).getValues();
  var classD1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
  var classLoopIdx = CLASS_D1_HEADERS.indexOf('class_loop');
  var classDateIdx = CLASS_D1_HEADERS.indexOf('class_date');
  var holidayIdx   = CLASS_D1_HEADERS.indexOf('holiday');
  var tz = Session.getScriptTimeZone();
  var batchD1List = [];
  for (var i = 0; i < d1Data.length; i++) {
    if (extractD1BatchKey_(String(d1Data[i][classD1IdIdx])) !== batchKey) continue;
    var rawDate = d1Data[i][classDateIdx];
    var dateStr = (rawDate instanceof Date)
      ? Utilities.formatDate(rawDate, tz, 'yyyyMMdd')
      : String(rawDate || '').replace(/-/g, '');
    batchD1List.push({
      loop: Number(d1Data[i][classLoopIdx]),
      date: dateStr,
      holiday: String(d1Data[i][holidayIdx] || '') === 'Y'
    });
  }
  batchD1List.sort(function(a, b) { return a.loop - b.loop; });

  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');

  if (isInactive) {
    // 비활성 전환: 미래 회차 셀 비움 (휴강 제외)
    batchD1List.forEach(function(bd) {
      if (bd.holiday) return;
      if (bd.date === '' || bd.date <= todayStr) return; // 과거/오늘 보존
      var idx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + bd.loop);
      if (idx >= 0) rowVals[idx] = '';
    });
  } else {
    // 활성 전환: contract - used 계산 후 미래 빈 셀에 ● 채움
    var contractIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('contract_loop');
    var contract = parseInt(rowVals[contractIdx], 10) || 0;
    if (contract <= 0) return;
    var used = 0;
    batchD1List.forEach(function(bd) {
      if (bd.holiday) return;
      if (bd.date === '' || bd.date > todayStr) return;
      var idx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + bd.loop);
      if (idx < 0) return;
      var v = String(rowVals[idx] || '').trim().toUpperCase();
      if (v === 'O' || v === 'R') used++;
    });
    var needed = Math.max(0, contract - used);
    if (needed <= 0) return;
    var added = 0;
    for (var bi = 0; bi < batchD1List.length && added < needed; bi++) {
      var bd2 = batchD1List[bi];
      if (bd2.holiday) continue;
      if (bd2.date === '' || bd2.date <= todayStr) continue;
      var idx2 = MEMBER_CLASS_DETAILS_HEADERS.indexOf('no_' + bd2.loop);
      if (idx2 < 0) continue;
      if (String(rowVals[idx2] || '').trim() === '') {
        rowVals[idx2] = 'O';
        added++;
      }
    }
  }
}

/**
 * member_class_details 시트를 확보합니다. (없으면 생성)
 */
function ensureMemberClassDetailsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(MEMBER_CLASS_DETAILS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBER_CLASS_DETAILS_SHEET_NAME);
    sheet.getRange(1, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([MEMBER_CLASS_DETAILS_HEADERS]);
    SpreadsheetApp.flush();
  } else {
    const maxCols = sheet.getMaxColumns();
    if (maxCols < MEMBER_CLASS_DETAILS_HEADERS.length) {
      sheet.insertColumnsAfter(maxCols, MEMBER_CLASS_DETAILS_HEADERS.length - maxCols);
    }
    const headerRow = sheet.getRange(1, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < MEMBER_CLASS_DETAILS_HEADERS.length; i++) {
      if (headerRow[i] !== MEMBER_CLASS_DETAILS_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, MEMBER_CLASS_DETAILS_HEADERS.length).setValues([MEMBER_CLASS_DETAILS_HEADERS]);
      SpreadsheetApp.flush();
    }
  }
  return sheet;
}

/**
 * 특정 수업 회차의 회원 목록을 조회합니다.
 */
function readMembersByClassD1Id(classD1Id) {
  const sheet = ensureMemberClassDetailsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
  const filtered = data
    .map(row => {
      const obj = {};
      MEMBER_CLASS_DETAILS_HEADERS.forEach((h, i) => {
        const val = row[i];
        if (val instanceof Date) {
          obj[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          obj[h] = val !== undefined && val !== null ? val : '';
        }
      });
      return obj;
    })
    .filter(d => String(d.class_d1_id) === String(classD1Id));

  // 회원 정보 조인
  const allMembers = readAllMembersNew();
  return filtered.map(d => {
    const member = allMembers.find(m => String(m.member_id) === String(d.member_id)) || {};
    return {
      ...d,
      member_name: member.member_name || '',
      phone: member.phone || '',
      gubun: member.gubun || ''
    };
  });
}

/**
 * 특정 수업(classId)의 전체 회차에 대한 회원 출석 현황을 조회합니다.
 * 반환: { d1List: [...], members: [{ member_id, member_name, phone, gubun, name1~3, attendance: {d1Id: 'Y'/'N'}, attendCount }] }
 */
function readAllMembersByClassId(classId) {
  var d1List = readClassD1ByClassId(classId);
  if (!d1List || d1List.length === 0) return { d1List: [], members: [] };

  var d1Ids = {};
  d1List.forEach(function(d) { d1Ids[String(d.class_d1_id)] = true; });

  var sheet = ensureMemberClassDetailsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { d1List: d1List, members: [] };

  var data = sheet.getRange(2, 1, lastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
  var relevantRows = data
    .map(function(row) {
      var obj = {};
      MEMBER_CLASS_DETAILS_HEADERS.forEach(function(h, i) { obj[h] = (row[i] !== undefined && row[i] !== null) ? row[i] : ''; });
      return obj;
    })
    .filter(function(d) { return d1Ids[String(d.class_d1_id)]; });

  var allMembers = readAllMembersNew();

  var memberMap = {};
  relevantRows.forEach(function(d) {
    var memberId = String(d.member_id);
    if (!memberMap[memberId]) {
      var member = allMembers.find(function(m) { return String(m.member_id) === memberId; }) || {};
      memberMap[memberId] = {
        member_id: memberId,
        member_name: member.member_name || '',
        phone: member.phone || '',
        gubun: member.gubun || '',
        name1: member.name1 || '', name1_gubun: member.name1_gubun || '',
        name2: member.name2 || '', name2_gubun: member.name2_gubun || '',
        name3: member.name3 || '', name3_gubun: member.name3_gubun || '',
        attendance: {},
        attendCount: 0
      };
    }
    var d1Id = String(d.class_d1_id);
    memberMap[memberId].attendance[d1Id] = d.attended === 'Y' ? 'Y' : 'N';
    if (d.attended === 'Y') memberMap[memberId].attendCount++;
  });

  var members = Object.values(memberMap).sort(function(a, b) {
    return a.member_name.localeCompare(b.member_name, 'ko');
  });

  return { d1List: d1List, members: members };
}

/**
 * 특정 회원의 수업 출석 횟수를 조회합니다.
 */
function getMemberAttendanceCount(memberId, classId) {
  const sheet = ensureMemberClassDetailsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const data = sheet.getRange(2, 1, lastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
  const allD1 = readAllClassD1();

  let count = 0;
  data.forEach(row => {
    const obj = {};
    MEMBER_CLASS_DETAILS_HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });

    if (String(obj.member_id) !== String(memberId)) return;
    if (obj.attended !== 'Y') return;

    // 해당 회차가 classId에 속하는지 확인
    const d1 = allD1.find(d => String(d.class_d1_id) === String(obj.class_d1_id));
    if (d1 && String(d1.class_id) === String(classId)) {
      count++;
    }
  });

  return count;
}

/**
 * 회원 등록 시 no_1..no_N 초기값 계산
 * - mData가 없거나 remaining=-1 → 신규(직접등록): 전체 O
 * - mData.status === '진행중' → 앞에서 remaining개 O, 나머지 X (remaining=0이면 전체X)
 * - 그 외 (종료/홀딩/빈값 등) → 전체 X
 */
/**
 * sessionDates: ['20260311', '20260318', ...] 형식 배열 (no_1부터 순서대로)
 * isNew + sessionDates → 지나간 회차 X, 미래/오늘 회차 O
 * isNew + sessionDates 없음 → 전체 O (하위 호환)
 * 가져오기 → remaining 개수만큼 O, 나머지 X
 */
function buildInitialAttendance_(mData, totalSessions, sessionDates) {
  var result = {};
  if (totalSessions <= 0) return result;
  var isNew = !mData || mData.remaining === -1;

  if (isNew && Array.isArray(sessionDates) && sessionDates.length > 0) {
    // 신규 중간 추가: 지나간 날짜 → X, 오늘 이후 → O
    var tz    = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
    for (var n = 1; n <= Math.min(sessionDates.length, 20); n++) {
      var ds = String(sessionDates[n - 1] || '').replace(/-/g, '');
      result['no_' + n] = (ds !== '' && ds < today) ? 'X' : 'O';
    }
  } else {
    // 배치 이월 (가져오기): remaining 만큼만 'O', 나머지는 빈값 ('')
    //   → 마지막 검정 ● 이후 셀은 X가 아닌 빈값 (다음 배치 추가 이월/계약 변경 여지)
    var remaining = isNew ? totalSessions : Math.max(0, parseInt(mData.remaining) || 0);
    for (var n = 1; n <= totalSessions && n <= 20; n++) {
      result['no_' + n] = (n <= remaining) ? 'O' : '';
    }
  }
  return result;
}

/**
 * classD1Id의 종목이 PT/돈클이면 해당 배치의 대표 회원 {name, memberId} 반환, 아니면 null
 */
function _getBatchRepMemberInfo_(classD1Id) {
  try {
    var batchKey = extractD1BatchKey_(classD1Id);
    var firstU = batchKey.indexOf('_');
    var classId = firstU > 0 ? batchKey.substring(0, firstU) : batchKey;
    if (!classId) return null;
    // 종목 타입 확인
    var classSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);
    if (!classSheet) return null;
    var cLast = classSheet.getLastRow();
    if (cLast < 2) return null;
    var cidIdx   = CLASS_HEADERS.indexOf('class_id');
    var ctypeIdx = CLASS_HEADERS.indexOf('class_type');
    var cData = classSheet.getRange(2, 1, cLast - 1, CLASS_HEADERS.length).getValues();
    var cRow = cData.find(function(r) { return String(r[cidIdx]) === String(classId); });
    if (!cRow) return null;
    var ctype = String(cRow[ctypeIdx] || '').trim();
    if (ctype !== 'PT' && ctype !== '프리미엄 PT' && ctype !== '돈클') return null;
    // MCD에서 배치 첫 회원 ID 조회
    var mcdSheet = ensureMemberClassDetailsSheet_();
    if (!mcdSheet) return null;
    var mLast = mcdSheet.getLastRow();
    if (mLast < 2) return null;
    var d1IdIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
    var midIdx  = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_id');
    var mData = mcdSheet.getRange(2, 1, mLast - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    var memberIdStr = '';
    for (var i = 0; i < mData.length; i++) {
      if (String(mData[i][d1IdIdx]) === batchKey) {
        memberIdStr = String(mData[i][midIdx] || '');
        if (memberIdStr) break;
      }
    }
    if (!memberIdStr) return null;
    var members = readAllMembersNew();
    var found = members.find(function(m) { return String(m.member_id) === memberIdStr; });
    var name = found ? String(found.member_name || '').trim() : '';
    return { memberId: memberIdStr, name: name };
  } catch (e) {
    return null;
  }
}

/**
 * 이름만 필요할 때 — addItemsToClassD1에서 사용
 */
function _getBatchRepMemberName_(classD1Id) {
  var info = _getBatchRepMemberInfo_(classD1Id);
  return info ? info.name : '';
}

/**
 * [Dry-run] items 시트에서 m_name과 member_id 불일치 행을 찾아 리스트만 반환 (시트 변경 없음).
 *
 * 기준: class_d1_id가 있는 행 중, 그 회차의 대표회원 정보(_getBatchRepMemberInfo_)와
 *      m_name 또는 member_id가 어긋난 행을 보고.
 *
 * 반환: { success, total, mismatchCount, items: [{ row, id, sakun_no, classD1Id,
 *        currentMName, currentMemberId, expectedMName, expectedMemberId, reason }] }
 */
function dryRunFindMNameMemberIdMismatch() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: 'items 시트 없음' };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, total: 0, mismatchCount: 0, items: [] };

  var idCol        = ITEM_HEADERS.indexOf('id') + 1;
  var sakunCol     = ITEM_HEADERS.indexOf('sakun_no') + 1;
  var mNameCol     = ITEM_HEADERS.indexOf('m_name') + 1;
  var memberIdCol  = ITEM_HEADERS.indexOf('member_id') + 1;
  var classD1IdCol = ITEM_HEADERS.indexOf('class_d1_id') + 1;

  var width = ITEM_HEADERS.length;
  var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var repCache = {}; // classD1Id → repInfo
  var mismatches = [];

  for (var i = 0; i < data.length; i++) {
    var classD1Id = String(data[i][classD1IdCol - 1] || '').trim();
    if (!classD1Id) continue;
    var currentMName = String(data[i][mNameCol - 1] || '').trim();
    var currentMid   = String(data[i][memberIdCol - 1] || '').trim();

    var rep = repCache[classD1Id];
    if (rep === undefined) {
      rep = _getBatchRepMemberInfo_(classD1Id) || null;
      repCache[classD1Id] = rep;
    }
    // 대표 회원이 없는 회차(CLASS 등)는 자동명 사용 → 보정 대상 아님
    if (!rep || !rep.name || !rep.memberId) continue;

    var nameMatch = (currentMName === rep.name);
    var idMatch   = (currentMid === String(rep.memberId));

    // m_name이 대표명과 같은데 member_id가 다른 경우 = 명백한 보정 대상
    // (m_name이 다른 경우는 회원 별칭/명의 등 다른 사정일 수 있어 제외)
    if (nameMatch && !idMatch) {
      mismatches.push({
        row: i + 2,
        id: String(data[i][idCol - 1] || ''),
        sakun_no: String(data[i][sakunCol - 1] || ''),
        classD1Id: classD1Id,
        currentMName: currentMName,
        currentMemberId: currentMid || '(빈값)',
        expectedMName: rep.name,
        expectedMemberId: String(rep.memberId),
        reason: 'm_name=대표명 일치 / member_id=' + (currentMid || '빈') + ' → 대표(' + rep.memberId + ')로 보정 필요'
      });
    }
  }

  // GAS 에디터 실행로그용 출력 (브라우저 콘솔 호출 시에도 동일하게 반환)
  Logger.log('=== dryRunFindMNameMemberIdMismatch ===');
  Logger.log('총 검사 행: ' + data.length);
  Logger.log('보정 대상: ' + mismatches.length + ' 건');
  for (var k = 0; k < mismatches.length; k++) {
    var m = mismatches[k];
    Logger.log(
      (k + 1) + ') row=' + m.row +
      ' | id=' + m.id +
      ' | 사건=' + m.sakun_no +
      ' | 회차=' + m.classD1Id +
      ' | m_name=' + m.currentMName +
      ' | member_id: ' + m.currentMemberId + ' → ' + m.expectedMemberId
    );
  }

  return {
    success: true,
    total: data.length,
    mismatchCount: mismatches.length,
    items: mismatches
  };
}

/**
 * class_d1_id에서 배치키 추출 (회차 번호 제거)
 * 예: 5001_20260409161654_1 → 5001_20260409161654
 */
function extractD1BatchKey_(classD1Id) {
  var s = String(classD1Id);
  var lastUnderscore = s.lastIndexOf('_');
  if (lastUnderscore > 0) {
    var suffix = s.substring(lastUnderscore + 1);
    // 회차 번호는 1~4자리 짧은 숫자, 타임스탬프(14자리)와 구별
    if (/^\d{1,4}$/.test(suffix)) return s.substring(0, lastUnderscore);
  }
  return s;
}

/**
 * 수업에 회원을 추가합니다.
 * class_d1_id의 회차(_N) 제거한 배치키로 저장 → 회원은 수업당 1회만 등록
 * mData: {status, remaining} - 이전 배치 상태/잔여 (없으면 전체 O)
 * totalSessions: 새 배치의 총 회차 수
 */
function addMemberToClassD1(classD1IdOrBatchKey, memberId, classId, mData, totalSessions) {
  const sheet = ensureMemberClassDetailsSheet_();
  const tz = Session.getScriptTimeZone();

  // 배치키 추출 (회차 번호 제거)
  const batchKey = extractD1BatchKey_(classD1IdOrBatchKey);

  // class_id 없으면 배치키로 class_d1 시트에서 조회
  if (!classId) {
    var d1Sheet = ensureClassD1Sheet_();
    var d1Last = d1Sheet.getLastRow();
    if (d1Last >= 2) {
      var d1Rows = d1Sheet.getRange(2, 1, d1Last - 1, CLASS_D1_HEADERS.length).getValues();
      var d1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
      var d1CidIdx = CLASS_D1_HEADERS.indexOf('class_id');
      var found = d1Rows.find(function(r) { return extractD1BatchKey_(String(r[d1IdIdx])) === batchKey; });
      if (found) classId = String(found[d1CidIdx]);
    }
  }

  // 중복 검사 (배치키 + 회원 조합으로 1회만 등록)
  const d1IdColIdx     = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
  const memberIdColIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('member_id');
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const existingData = sheet.getRange(2, 1, lastRow - 1, MEMBER_CLASS_DETAILS_HEADERS.length).getValues();
    const dup = existingData.some(function(r) {
      return String(r[d1IdColIdx]) === batchKey && String(r[memberIdColIdx]) === String(memberId);
    });
    if (dup) return { success: false, message: '해당 회원이 이미 등록되어 있습니다.' };
  }

  const newId = new Date().getTime().toString();
  const regDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // 배치 세션 날짜 조회 (신규 중간 추가 시 지나간 회차 X 처리용)
  var sessionDates = [];
  try {
    var d1Sh = ensureClassD1Sheet_();
    var d1Last2 = d1Sh.getLastRow();
    if (d1Last2 >= 2) {
      var d1Rows2 = d1Sh.getRange(2, 1, d1Last2 - 1, CLASS_D1_HEADERS.length).getValues();
      var d1IdIdx2   = CLASS_D1_HEADERS.indexOf('class_d1_id');
      var d1DateIdx  = CLASS_D1_HEADERS.indexOf('class_date');
      var d1LoopIdx  = CLASS_D1_HEADERS.indexOf('class_loop');
      var batchRows  = d1Rows2.filter(function(r) { return extractD1BatchKey_(String(r[d1IdIdx2])) === batchKey; });
      batchRows.sort(function(a, b) { return Number(a[d1LoopIdx]) - Number(b[d1LoopIdx]); });
      sessionDates = batchRows.map(function(r) { return String(r[d1DateIdx] || '').replace(/-/g, ''); });
    }
  } catch(e) { /* 날짜 조회 실패 시 전체 O 폴백 */ }

  // 출석 초기값 계산 (신규=지나간X/미래O, 가져오기=잔여만큼O)
  const attendance = buildInitialAttendance_(mData || null, totalSessions || 0, sessionDates);

  // contract_loop 초기값:
  //   - 신규 등록 → totalSessions (수업 총회차)
  //   - 배치 이월 (mData.contractLoop 또는 remaining) → 그 값 그대로 (잔여 이월)
  var initContractLoop = totalSessions || 0;
  if (mData) {
    if (mData.contractLoop !== undefined && mData.contractLoop !== null && mData.contractLoop !== '') {
      initContractLoop = parseInt(mData.contractLoop, 10) || initContractLoop;
    } else if (mData.remaining !== undefined && mData.remaining !== null && Number(mData.remaining) >= 0) {
      initContractLoop = parseInt(mData.remaining, 10);
    }
  }

  const row = MEMBER_CLASS_DETAILS_HEADERS.map(function(h) {
    switch (h) {
      case 'detail_id':   return newId;
      case 'class_d1_id': return batchKey;
      case 'class_id':    return classId || '';
      case 'member_id':     return memberId;
      // 신규 등록(mData 없거나 status 비어있음) → '진행중'
      // 배치 이월(mData.status 있음) → 이전 배치 상태 그대로 유지
      case 'member_status': return (mData && mData.status) ? mData.status : '진행중';
      case 'reg_date':      return regDate;
      case 'contract_loop': return initContractLoop;
      default:              return attendance[h] !== undefined ? attendance[h] : '';
    }
  });

  sheet.appendRow(row);
  const _cache = CacheService.getScriptCache();
  _cache.remove('mcd_' + batchKey);
  _cache.remove('class_member_index');
  _cache.remove('all_batch_members');
  return { success: true, message: '회원 추가 완료' };
}

/**
 * 수업에 여러 회원을 일괄 추가합니다.
 * memberData: [{id, status, remaining}] - 이전 배치 상태/잔여 정보 (없으면 전체 O)
 * totalSessions: 새 배치의 총 회차 수
 */
function addMemberToClassD1Batch(classD1Id, memberIds, classId, memberData, totalSessions) {
  var dataMap = {};
  if (Array.isArray(memberData)) {
    memberData.forEach(function(d) { if (d && d.id) dataMap[String(d.id)] = d; });
  }
  var total = typeof totalSessions === 'number' && totalSessions > 0 ? totalSessions : 0;
  var added = 0;
  var skipped = [];
  memberIds.forEach(function(memberId) {
    var mData = dataMap[String(memberId)] || null;
    var r = addMemberToClassD1(classD1Id, memberId, classId, mData, total);
    if (r.success) {
      added++;
    } else {
      skipped.push(memberId);
    }
  });
  var msg = added + '명 추가 완료';
  if (skipped.length > 0) msg += ' (중복 ' + skipped.length + '명 스킵)';
  return { success: added > 0, added: added, message: msg };
}

/**
 * 수업 회차에서 회원을 삭제합니다.
 */
function removeMemberFromClassD1(detailId) {
  const sheet = ensureMemberClassDetailsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  const d1IdColIdx = MEMBER_CLASS_DETAILS_HEADERS.indexOf('class_d1_id');
  const colCount = Math.max(2, d1IdColIdx + 1);
  const rows = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
  const idx = rows.findIndex(r => String(r[0]) === String(detailId));
  if (idx < 0) return { success: false, message: '해당 데이터를 찾을 수 없습니다.' };

  const batchKey = d1IdColIdx >= 0 ? String(rows[idx][d1IdColIdx] || '') : '';
  sheet.deleteRow(idx + 2);
  const _cache = CacheService.getScriptCache();
  if (batchKey) _cache.remove('mcd_' + batchKey);
  _cache.remove('class_member_index');
  _cache.remove('all_batch_members');
  return { success: true, message: '회원 삭제 완료' };
}

/**
 * 회원 출석 상태를 업데이트합니다.
 */
function updateMemberAttendance(detailId, attended) {
  const sheet = ensureMemberClassDetailsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(id => String(id) === String(detailId));
  if (idx < 0) return { success: false, message: '해당 데이터를 찾을 수 없습니다.' };

  const rowNum = idx + 2;
  const attendedCol = MEMBER_CLASS_DETAILS_HEADERS.indexOf('attended') + 1;
  const attendedDateCol = MEMBER_CLASS_DETAILS_HEADERS.indexOf('attended_date') + 1;

  sheet.getRange(rowNum, attendedCol).setValue(attended ? 'Y' : 'N');
  if (attended) {
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    sheet.getRange(rowNum, attendedDateCol).setValue(now);
  } else {
    sheet.getRange(rowNum, attendedDateCol).setValue('');
  }

  return { success: true, message: '출석 상태 업데이트 완료' };
}

// ================================================================================================
// [회원(members) 시트 - 신규 구조] 함수들
// ================================================================================================

/**
 * 새로운 회원 헤더로 시트를 확보합니다.
 */
function ensureNewMemberSheetColumns_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return;

  const targetCols = MEMBER_HEADERS.length;
  let maxCols = sheet.getMaxColumns();

  if (maxCols < targetCols) {
    sheet.insertColumnsAfter(maxCols, targetCols - maxCols);
    SpreadsheetApp.flush();
  }

  // 헤더 확인 및 업데이트
  const headerRow = sheet.getRange(1, 1, 1, targetCols).getValues()[0];
  let needsUpdate = false;
  for (let i = 0; i < targetCols; i++) {
    if (headerRow[i] !== MEMBER_HEADERS[i]) { needsUpdate = true; break; }
  }

  if (needsUpdate) {
    sheet.getRange(1, 1, 1, targetCols).setValues([MEMBER_HEADERS]);
    SpreadsheetApp.flush();
  }
}

/**
 * 새로운 구조로 모든 회원을 조회합니다.
 */
function readAllMembersNew() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const maxCols = sheet.getMaxColumns();
  const colsToRead = Math.min(ITEM_MEMBER_HEADERS.length, maxCols);
  const data = sheet.getRange(2, 1, lastRow - 1, colsToRead).getValues();

  return data.map(row => {
    const obj = {};
    ITEM_MEMBER_HEADERS.forEach((h, i) => {
      let val = (i < row.length) ? row[i] : '';
      if ((h === 'reg_date' || h === 'kaib_date') && val instanceof Date) {
        obj[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        obj[h] = val || '';
      }
    });
    return obj;
  });
}

/**
 * 텔레그램 가입현황 통계 (수업 타입별)
 * @return {Array} [{ class_type, total, joined, chat_id }, ..., { class_type:'합계', ... }]
 */
function getTelegramJoinStats() {
  var members = readAllMembersNew();
  var classes = readAllClasses();
  var classMap = {};
  classes.forEach(function (c) { classMap[String(c.class_id)] = c; });

  // class_type을 동적으로 수집 (하드코딩 제거 → 실제 DB 값 사용)
  var classTypeSet = {};
  classes.forEach(function (c) {
    var ct = String(c.class_type || '').trim();
    if (ct) classTypeSet[ct] = true;
  });
  var classTypes = Object.keys(classTypeSet).sort();

  var stats = {};
  classTypes.forEach(function (t) {
    stats[t] = { class_type: t, total: 0, joined: 0, chat_id: 0 };
  });

  members.forEach(function (m) {
    if (String(m.gubun || '').trim() === '관리자') return; // 관리자 제외
    var cls = classMap[String(m.class_id)] || {};
    var ct = String(cls.class_type || '').trim();
    if (!ct) return;
    if (!stats[ct]) stats[ct] = { class_type: ct, total: 0, joined: 0, chat_id: 0 };
    stats[ct].total++;
    if (String(m.telegram_enabled || '').toUpperCase() === 'Y') stats[ct].joined++;
    if (String(m.telegram_chat_id || '').trim() !== '') stats[ct].chat_id++;
  });

  var result = classTypes.map(function (t) { return stats[t]; });
  var totals = { class_type: '합계', total: 0, joined: 0, chat_id: 0 };
  result.forEach(function (r) { totals.total += r.total; totals.joined += r.joined; totals.chat_id += r.chat_id; });
  result.push(totals);
  return result;
}

/**
 * 텔레그램 가입현황 [물건 모드]: 오늘(포함) 이후 입찰일 물건에 배정된 회원의 텔레그램 가입 여부
 * 회원 모드와 동일 컬럼: class_type, item_count(=물건수), total(=회원수), joined(=가입수), chat_id
 */
function getTelegramJoinStatsByItem() {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var members = readAllMembersNew();
  var classes = readAllClasses();
  var classMap = {};
  classes.forEach(function (c) { classMap[String(c.class_id)] = c; });

  // member_id → 회원 정보 매핑 (관리자 제외)
  var memberMap = {};
  members.forEach(function (m) {
    if (String(m.gubun || '').trim() === '관리자') return;
    memberMap[String(m.member_id)] = m;
  });

  // 아이템 데이터 읽기
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();

  // class_type별로 물건과 회원 집계
  var statMap = {};
  data.forEach(function (row) {
    var itemObj = {};
    ITEM_HEADERS.forEach(function (h, i) { itemObj[h] = row[i]; });

    // in-date: Date 객체/문자열 모두 yyyyMMdd 숫자 문자열로 변환
    var inDateRaw = itemObj['in-date'];
    var inDate;
    if (inDateRaw instanceof Date && !isNaN(inDateRaw.getTime())) {
      inDate = Utilities.formatDate(inDateRaw, tz, 'yyyyMMdd');
    } else {
      inDate = String(inDateRaw || '').replace(/\D/g, '');
      // 'yyMMdd'(6자리) → 'yyyyMMdd' 변환, 그 이상이면 8자리까지만 취함 (YYYYMMDD)
      if (inDate.length >= 8) inDate = inDate.substring(0, 8);
      else if (inDate.length === 6) inDate = '20' + inDate;
    }
    if (!inDate || inDate < today) return; // 오늘 이후 물건만

    // 물건상태 필터: stu_member가 추천 또는 입찰인 건만 집계
    var stuMember = String(itemObj['stu_member'] || '').trim();
    if (['추천', '입찰'].indexOf(stuMember) === -1) return;

    // member_id(index 8)로 회원 매핑
    var memberId = String(itemObj['member_id'] || '').trim();
    if (!memberId) return;

    var m = memberMap[memberId];
    if (!m) return;

    var cls = classMap[String(m.class_id)] || {};
    var ct = String(cls.class_type || '').trim();
    if (!ct) return;

    var itemId = String(itemObj['id'] || '').trim();

    if (!statMap[ct]) statMap[ct] = {
      class_type: ct,
      recommend_count: 0, bid_count: 0,
      recommend_ids: [], bid_ids: [],
      total: 0, joined: 0, chat_id: 0,
      member_ids: [], joined_member_ids: [], chatid_member_ids: [],
      _members: {}
    };

    // stu_member별 물건수 집계
    if (stuMember === '추천') {
      statMap[ct].recommend_count++;
      if (itemId) statMap[ct].recommend_ids.push(itemId);
    } else if (stuMember === '입찰') {
      statMap[ct].bid_count++;
      if (itemId) statMap[ct].bid_ids.push(itemId);
    }

    // 고유 회원수/가입수 집계 + member_id 배열 누적
    if (!statMap[ct]._members[memberId]) {
      statMap[ct]._members[memberId] = true;
      statMap[ct].total++;
      statMap[ct].member_ids.push(memberId);
      if (String(m.telegram_enabled || '').toUpperCase() === 'Y') {
        statMap[ct].joined++;
        statMap[ct].joined_member_ids.push(memberId);
      }
      if (String(m.telegram_chat_id || '').trim() !== '') {
        statMap[ct].chat_id++;
        statMap[ct].chatid_member_ids.push(memberId);
      }
    }
  });

  var classTypes = Object.keys(statMap).sort();
  var result = classTypes.map(function (t) { return statMap[t]; });

  var totals = { class_type: '합계', recommend_count: 0, bid_count: 0, recommend_ids: [], bid_ids: [], total: 0, joined: 0, chat_id: 0, member_ids: [], joined_member_ids: [], chatid_member_ids: [] };
  result.forEach(function (r) {
    totals.recommend_count += r.recommend_count;
    totals.bid_count += r.bid_count;
    totals.total += r.total;
    totals.joined += r.joined;
    totals.chat_id += r.chat_id;
    if (Array.isArray(r.recommend_ids)) totals.recommend_ids = totals.recommend_ids.concat(r.recommend_ids);
    if (Array.isArray(r.bid_ids)) totals.bid_ids = totals.bid_ids.concat(r.bid_ids);
    if (Array.isArray(r.member_ids)) totals.member_ids = totals.member_ids.concat(r.member_ids);
    if (Array.isArray(r.joined_member_ids)) totals.joined_member_ids = totals.joined_member_ids.concat(r.joined_member_ids);
    if (Array.isArray(r.chatid_member_ids)) totals.chatid_member_ids = totals.chatid_member_ids.concat(r.chatid_member_ids);
  });
  result.push(totals);
  return result;
}

/**
 * 디버그: 물건 모드 데이터 샘플 확인
 */
function debugTelegramJoinItemStats() {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  var members = readAllMembersNew();
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { today: today, totalItems: 0, samples: [] };
  var data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();

  var samples = [];
  for (var i = 0; i < Math.min(data.length, 10); i++) {
    var row = data[i];
    var itemObj = {};
    ITEM_HEADERS.forEach(function (h, idx) { itemObj[h] = row[idx]; });
    var inDateRaw = itemObj['in-date'];
    var inDateType = typeof inDateRaw;
    var isDate = inDateRaw instanceof Date;
    var inDate = isDate ? Utilities.formatDate(inDateRaw, tz, 'yyyyMMdd') : String(inDateRaw || '').replace(/\D/g, '');
    samples.push({
      inDateRaw: String(inDateRaw),
      inDateType: inDateType,
      isDate: isDate,
      inDate: inDate,
      member_id: itemObj['member_id'],
      m_name_id: itemObj['m_name_id']
    });
  }
  return { today: today, totalItems: data.length, memberCount: members.length, samples: samples, headers: ITEM_HEADERS };
}

function getAutoApprovalStats(testMode) {
  // testMode=true: 직원/관리자 건만 조회 / testMode=false(기본): 직원/관리자 제외
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  if (!reqSheet || reqSheet.getLastRow() < 2) return [];

  // members 시트 gubun 맵 (member_id → gubun): 직원/관리자 필터용
  var memberGubunMap = {};
  try {
    var mSheet = ss.getSheetByName(MEMBERS_SHEET_NAME);
    if (mSheet && mSheet.getLastRow() > 1) {
      var mRows = mSheet.getRange(2, 1, mSheet.getLastRow() - 1, 3).getValues();
      mRows.forEach(function (mr) { if (mr[0]) memberGubunMap[String(mr[0]).trim()] = String(mr[2] || '').trim(); });
    }
  } catch (e) { }

  // itemId → 현재 stu_member (폐기/불가 안내 텔레그램 귀속용)
  var itemStatusMap = {};
  try {
    var iSheet = ss.getSheetByName(DB_SHEET_NAME);
    if (iSheet && iSheet.getLastRow() > 1) {
      var iRows = iSheet.getRange(2, 1, iSheet.getLastRow() - 1, 5).getValues();
      iRows.forEach(function (ir) { var id = String(ir[0] || '').trim(); if (id) itemStatusMap[id] = String(ir[4] || '').trim(); });
    }
  } catch (e) { }

  var lastRow = reqSheet.getLastRow();
  var totalCols = Math.min(reqSheet.getMaxColumns(), 16);
  var rows = reqSheet.getRange(2, 1, lastRow - 1, totalCols).getValues();
  // [0]req_id [1]requested_at [2]action [3]status [4]item_id [5]member_id
  // [6]chat_id [7]username [8]note [9]approved_at [10]approved_by
  // [11]from_value [12]to_value [13]field_name [14]trigger_type [15]member_name

  var dateStats = {};
  function getOrCreate(dateKey) {
    if (!dateStats[dateKey]) {
      dateStats[dateKey] = {
        date: dateKey,
        // 텔레그램(tele) / 수작업(web) 분리 카운팅 → 표시: "합계 (tele, web)"
        recommend_tele: [],      // 11번: TELEGRAM_SENT note='card'
        recommend_web: [],       // 9번: FIELD_CHANGE chuchen_state→전달완료
        recommend_read: [],      // 추천확인(읽음): CHUCHEN_CONFIRMED — T 안에 표시, 전체합계 미포함
        bid_approved_tele: [],   // 17번: REQUEST_BID APPROVED
        bid_approved_web: [],    // 8번: FIELD_CHANGE stu_member→입찰
        bid_pending_tele: [],    // 18번: REQUEST_CANCEL_CHUCHEN APPROVED
        bid_pending_web: [],     // 8번: FIELD_CHANGE stu_member 추천→미정/상품
        bid_pending_sys: [],     // AUTO_EXPIRE: 시스템 자동 만료
        cancel_approved_tele: [],// 19번: REQUEST_CANCEL_BID APPROVED
        cancel_approved_web: [], // 8번: FIELD_CHANGE stu_member 입찰→추천/미정/상품
        delivered_tele: [],      // 10번: TELEGRAM_SENT note='bid_price'
        delivered_web: [],       // 3번: FIELD_CHANGE bid_state→전달완료
        confirmed_tele: [],      // 20번: PRICE_CONFIRMED
        confirmed_web: [],       // 3번: FIELD_CHANGE bid_state→확인완료
        discard_tele: [],        // 폐기 안내 발송 (TELEGRAM_SENT note='status', 물건 현재상태=폐기)
        discard_web: [],         // 폐기 수기 전환 (FIELD_CHANGE stu_member→폐기, 옛 취소 포함)
        unable_tele: [],         // 불가 안내 발송 (TELEGRAM_SENT note='status', 물건 현재상태=불가)
        unable_web: []           // 불가 수기 전환 (FIELD_CHANGE stu_member→불가, 옛 변경 포함)
      };
    }
    return dateStats[dateKey];
  }
  function addId(arr, id) {
    if (arr.indexOf(id) < 0) arr.push(id);
  }
  // 텔레+수작업 합산 (중복 제거)
  function mergeIds(tele, web) {
    var all = tele.slice();
    web.forEach(function (id) { if (all.indexOf(id) < 0) all.push(id); });
    return all;
  }
  // arr에서 removeArr에 포함된 id 제거 (브레이크다운 상호배타화 → 부분합=합계)
  function subtract(arr, removeArr) {
    return arr.filter(function (id) { return removeArr.indexOf(id) < 0; });
  }

  var tzStats_ = Session.getScriptTimeZone(); // [속도] 루프 밖 1회 (행마다 호출 시 27초까지 누적되던 원인)
  rows.forEach(function (row) {
    var action = String(row[2] || '').trim();
    var status = String(row[3] || '').trim();
    var itemId = String(row[4] || '').trim();
    var note = String(row[8] || '').trim();
    var reqAt = row[1];
    var appAt = row[9];
    var fromVal = String(row[11] || '').trim();
    var toVal = String(row[12] || '').trim();
    var fieldName = String(row[13] || '').trim();
    var triggerType = String(row[14] || '').trim();

    if (!itemId) return;

    // 테스트모드: members.gubun이 직원/관리자인 건만 / 일반모드: 직원/관리자 제외
    var memberId = String(row[5] || '').trim();
    var gubun = memberGubunMap[memberId] || '';
    var isStaff = (gubun === '직원' || gubun === '관리자');
    if (testMode && !isStaff) return;
    if (!testMode && isStaff) return;

    // 날짜 기준: APPROVED 건은 approved_at, 나머지는 requested_at
    var dateToUse = (status === 'APPROVED' && appAt) ? appAt : reqAt;
    if (!dateToUse) return;
    // yyMMdd HHmmss 포맷('260316 111356') 및 Date 객체 모두 처리
    var d;
    if (dateToUse instanceof Date) {
      d = dateToUse;
    } else {
      var s = String(dateToUse).trim();
      if (/^\d{6} \d{6}$/.test(s)) {
        d = new Date(2000 + parseInt(s.substring(0, 2), 10), parseInt(s.substring(2, 4), 10) - 1,
          parseInt(s.substring(4, 6), 10), parseInt(s.substring(7, 9), 10),
          parseInt(s.substring(9, 11), 10), parseInt(s.substring(11, 13), 10));
      } else {
        d = new Date(s);
      }
    }
    if (!d || isNaN(d.getTime())) return;

    var dateKey = Utilities.formatDate(d, tzStats_, 'yy/MM/dd');
    var ds = getOrCreate(dateKey);

    // ── 물건추천 ─────────────────────────────────────────────────────
    if (action === 'TELEGRAM_SENT' && note === 'card') {
      addId(ds.recommend_tele, itemId);                                          // 11번
    } else if (action === 'FIELD_CHANGE' && fieldName === 'chuchen_state' && toVal === '전달완료'
      && triggerType !== 'web-telegram') {
      addId(ds.recommend_web, itemId);                                           // 9번 (수작업만)
    } else if (action === 'CHUCHEN_CONFIRMED') {
      addId(ds.recommend_read, itemId);                                          // 추천확인(읽음) — 전체합계 미포함

      // ── 추천물건-입찰확정 ─────────────────────────────────────────────
    } else if (action === 'REQUEST_BID' && status === 'APPROVED') {
      addId(ds.bid_approved_tele, itemId);                                       // 17번
    } else if (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && toVal === '입찰') {
      addId(ds.bid_approved_web, itemId);                                        // 8번

      // ── 입찰물건-입찰취소 (미선택보다 먼저) ─────────────────────────────
    } else if (action === 'REQUEST_CANCEL_BID' && status === 'APPROVED') {
      addId(ds.cancel_approved_tele, itemId);                                    // 19번
      // 수작업: 입찰→추천/미정/상품 (엑셀 로직수정: 구체적 값 명시)
    } else if (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && fromVal === '입찰'
      && (toVal === '추천' || toVal === '미정' || toVal === '상품')) {
      addId(ds.cancel_approved_web, itemId);                                     // 8번

      // ── 추천물건-미선택 ───────────────────────────────────────────────
    } else if (action === 'REQUEST_CANCEL_CHUCHEN' && status === 'APPROVED') {
      addId(ds.bid_pending_tele, itemId);                                        // 18번
      // 수작업: 추천→미정/상품 (엑셀 로직수정: from='추천' 조건 추가)
    } else if (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && fromVal === '추천'
      && (toVal === '미정' || toVal === '상품')) {
      addId(ds.bid_pending_web, itemId);                                         // 8번
      // 시스템 자동 만료: AUTO_EXPIRE
    } else if (action === 'AUTO_EXPIRE' && fieldName === 'stu_member' && fromVal === '추천' && toVal === '미정') {
      addId(ds.bid_pending_sys, itemId);

      // ── 입찰가-전달 ──────────────────────────────────────────────────
    } else if (action === 'TELEGRAM_SENT' && note === 'bid_price') {
      addId(ds.delivered_tele, itemId);                                          // 10번
    } else if (action === 'FIELD_CHANGE' && fieldName === 'bid_state' && toVal === '전달완료') {
      addId(ds.delivered_web, itemId);                                           // 3번

      // ── 입찰가-확인 ──────────────────────────────────────────────────
    } else if (action === 'PRICE_CONFIRMED') {
      addId(ds.confirmed_tele, itemId);                                          // 20번
    } else if (action === 'FIELD_CHANGE' && fieldName === 'bid_state' && toVal === '확인완료') {
      addId(ds.confirmed_web, itemId);                                           // 3번

      // ── 폐기/불가 안내 ────────────────────────────────────────────────
    } else if (action === 'TELEGRAM_SENT' && note === 'status') {
      // 상태안내 텔레그램은 사유 미기록 → 물건 현재 상태(폐기/불가)로 귀속
      var stCur = itemStatusMap[itemId] || '';
      if (stCur === '폐기') addId(ds.discard_tele, itemId);                       // 12번
      else if (stCur === '불가') addId(ds.unable_tele, itemId);
    } else if (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && (toVal === '폐기' || toVal === '취소')) {
      addId(ds.discard_web, itemId);                                             // 8번 폐기(옛 취소 포함)
    } else if (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && (toVal === '불가' || toVal === '변경')) {
      addId(ds.unable_web, itemId);                                              // 8번 불가(옛 변경 포함)
    }
  });

  var result = Object.keys(dateStats).map(function (k) {
    var s = dateStats[k];
    var rec = mergeIds(s.recommend_tele, s.recommend_web);
    var bapr = mergeIds(s.bid_approved_tele, s.bid_approved_web);
    var bpnd = mergeIds(mergeIds(s.bid_pending_tele, s.bid_pending_web), s.bid_pending_sys);
    var capr = mergeIds(s.cancel_approved_tele, s.cancel_approved_web);
    var dlvr = mergeIds(s.delivered_tele, s.delivered_web);
    var conf = mergeIds(s.confirmed_tele, s.confirmed_web);
    var disc = mergeIds(s.discard_tele, s.discard_web);
    var unab = mergeIds(s.unable_tele, s.unable_web);
    // 브레이크다운 상호배타화 (T 우선 > 수기 > 자동만료) → 부분합 = 합계 일치 (합계는 union 그대로)
    var rWeb  = subtract(s.recommend_web, s.recommend_tele);
    var baWeb = subtract(s.bid_approved_web, s.bid_approved_tele);
    var bpWeb = subtract(s.bid_pending_web, s.bid_pending_tele);
    var bpSys = subtract(s.bid_pending_sys, mergeIds(s.bid_pending_tele, s.bid_pending_web));
    var caWeb = subtract(s.cancel_approved_web, s.cancel_approved_tele);
    var dlWeb = subtract(s.delivered_web, s.delivered_tele);
    var cfWeb = subtract(s.confirmed_web, s.confirmed_tele);
    var dscWeb = subtract(s.discard_web, s.discard_tele);
    var unbWeb = subtract(s.unable_web, s.unable_tele);
    return {
      date: s.date,
      recommend: rec.length, recommend_tele: s.recommend_tele.length, recommend_web: rWeb.length, recommend_read: s.recommend_read.length, recommend_ids: rec, recommend_tele_ids: s.recommend_tele, recommend_web_ids: rWeb, recommend_read_ids: s.recommend_read,
      bid_approved: bapr.length, bid_approved_tele: s.bid_approved_tele.length, bid_approved_web: baWeb.length, bid_approved_ids: bapr, bid_approved_tele_ids: s.bid_approved_tele, bid_approved_web_ids: baWeb,
      bid_pending: bpnd.length, bid_pending_tele: s.bid_pending_tele.length, bid_pending_web: bpWeb.length, bid_pending_sys: bpSys.length, bid_pending_ids: bpnd, bid_pending_tele_ids: s.bid_pending_tele, bid_pending_web_ids: bpWeb, bid_pending_sys_ids: bpSys,
      cancel_approved: capr.length, cancel_approved_tele: s.cancel_approved_tele.length, cancel_approved_web: caWeb.length, cancel_approved_ids: capr, cancel_approved_tele_ids: s.cancel_approved_tele, cancel_approved_web_ids: caWeb,
      delivered: dlvr.length, delivered_tele: s.delivered_tele.length, delivered_web: dlWeb.length, delivered_ids: dlvr, delivered_tele_ids: s.delivered_tele, delivered_web_ids: dlWeb,
      confirmed: conf.length, confirmed_tele: s.confirmed_tele.length, confirmed_web: cfWeb.length, confirmed_ids: conf, confirmed_tele_ids: s.confirmed_tele, confirmed_web_ids: cfWeb,
      discard_notify: disc.length, discard_notify_tele: s.discard_tele.length, discard_notify_web: dscWeb.length, discard_notify_ids: disc, discard_notify_tele_ids: s.discard_tele, discard_notify_web_ids: dscWeb,
      unable_notify: unab.length, unable_notify_tele: s.unable_tele.length, unable_notify_web: unbWeb.length, unable_notify_ids: unab, unable_notify_tele_ids: s.unable_tele, unable_notify_web_ids: unbWeb
    };
  });
  result.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return result;
}

/**
 * [속도] 회원관리 진입 통합 로드 — 기존 3개 직렬 호출(readAllMembersNew → getClassDropdownOptions + getDonkleMemberCounts)을 1회로
 * - 각 하위 함수 출력 그대로 묶음 / JSON 문자열 반환 (google.script.run null 수신 문제 회피)
 */
function getMemberManagementData() {
  return JSON.stringify({
    members: readAllMembersNew(),
    classOptions: getClassDropdownOptions(),
    donkleCounts: getDonkleMemberCounts()
  });
}

/**
 * 회원 중복 검사 (이름 + 전화번호)
 */
function checkMemberDuplicate_(memberName, phone, excludeId) {
  const allMembers = readAllMembersNew();
  const normalizedName = String(memberName || '').trim();
  const normalizedPhone = String(phone || '').trim().replace(/[^0-9]/g, '');

  // 두 정보 중 하나라도 없으면 중복판단을 하지 않음 (폼에서 필수값 체크는 따로 함)
  if (!normalizedName || !normalizedPhone) return false;

  return allMembers.some(m =>
    String(m.member_name || '').trim() === normalizedName &&
    String(m.phone || '').trim().replace(/[^0-9]/g, '') === normalizedPhone &&
    String(m.member_id) !== String(excludeId)
  );
}

/**
 * 새 회원을 등록합니다. (신규 구조)
 */
function createMemberNew(data) {
  ensureMemberSheetColumns();
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);

  // 중복 검사
  if (checkMemberDuplicate_(data.member_name, data.phone, null)) {
    return { success: false, message: '동일한 이름과 전화번호를 가진 회원이 이미 존재합니다.' };
  }

  const lastRow = sheet.getLastRow();
  const newId = (lastRow < 2 ? 1000 : Math.max(...sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(v => Number(v) || 0))) + 1;
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const row = ITEM_MEMBER_HEADERS.map(h => {
    if (h === 'member_id') return newId;
    if (h === 'reg_date') return regDate;
    return data[h] || '';
  });

  sheet.appendRow(row);
  return { success: true, message: '회원 등록 성공', member_id: newId };
}

/**
 * 회원을 수정합니다. (신규 구조)
 */
function updateMemberNew(data) {
  ensureNewMemberSheetColumns_();
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회원 데이터가 없습니다.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(id => String(id) === String(data.member_id));
  if (idx < 0) return { success: false, message: '해당 회원을 찾을 수 없습니다.' };

  // 중복 검사 (자신 제외)
  if (checkMemberDuplicate_(data.member_name, data.phone, data.member_id)) {
    return { success: false, message: '동일한 이름과 전화번호를 가진 회원이 이미 존재합니다.' };
  }

  const rowNum = idx + 2;
  const maxCols = sheet.getMaxColumns();
  const currentRow = sheet.getRange(rowNum, 1, 1, Math.min(maxCols, MEMBER_HEADERS.length)).getValues()[0];

  const updatedRow = MEMBER_HEADERS.map((h, i) => {
    if (h === 'member_id' || h === 'reg_date' || h === 'reg_id') {
      return (i < currentRow.length) ? currentRow[i] : '';
    }
    return data[h] !== undefined ? data[h] : ((i < currentRow.length) ? currentRow[i] : '');
  });

  sheet.getRange(rowNum, 1, 1, updatedRow.length).setValues([updatedRow]);
  return { success: true, message: '회원 수정 성공' };
}

/**
 * 회원의 특정 단일 필드만 업데이트합니다.
 */
function updateMemberField(memberId, field, value) {
  try {
    const colIdx = MEMBER_HEADERS.indexOf(field);
    if (colIdx < 0) return { success: false, message: '알 수 없는 필드: ' + field };
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '회원 데이터 없음' };
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const idx = ids.findIndex(id => String(id) === String(memberId));
    if (idx < 0) return { success: false, message: '회원을 찾을 수 없습니다.' };
    sheet.getRange(idx + 2, colIdx + 1).setValue(value);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 회원을 삭제합니다. (신규 구조)
 */
function deleteMemberNew(memberId) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회원 데이터가 없습니다.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(id => String(id) === String(memberId));
  if (idx < 0) return { success: false, message: '해당 회원을 찾을 수 없습니다.' };

  sheet.deleteRow(idx + 2);
  return { success: true, message: '회원 삭제 성공' };
}

/**
 * 회원 검색 (자동완성용) - 이름 또는 전화번호로 검색
 */
function searchMembers(keyword) {
  const allMembers = readAllMembersNew();
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return allMembers.slice(0, 50); // 빈 검색어면 상위 50개

  return allMembers.filter(m => {
    const name = String(m.member_name || '').toLowerCase();
    const phone = String(m.phone || '').replace(/[^0-9]/g, '');
    const name1 = String(m.name1 || '').toLowerCase();
    const name2 = String(m.name2 || '').toLowerCase();
    const name3 = String(m.name3 || '').toLowerCase();

    return name.includes(kw) ||
      phone.includes(kw.replace(/[^0-9]/g, '')) ||
      name1.includes(kw) ||
      name2.includes(kw) ||
      name3.includes(kw);
  }).slice(0, 50);
}

/**
 * 구분(gubun)이 '회원'인 회원 목록만 조회합니다. (수업 회원 추가용)
 */
function getMembersForClass() {
  const allMembers = readAllMembersNew();
  return allMembers.filter(m => String(m.gubun || '').trim() === '회원');
}

// ================================================================================================
// [시트 초기화] - 구글 스크립트 콘솔에서 initializeAllSheets() 실행
// ================================================================================================

/**
 * 모든 시트를 초기화합니다. (members, class, class_d1, member_class_details)
 * Google Apps Script 콘솔에서 직접 실행하세요.
 */
function initializeAllSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. members 시트 초기화 (기존 내용 삭제 후 새 데이터 삽입)
  initializeMembersSheet_(ss);

  // 2. class 시트 초기화
  initializeClassSheet_(ss);

  // 3. class_d1 시트 초기화
  initializeClassD1Sheet_(ss);

  // 4. member_class_details 시트 초기화 (헤더만)
  initializeMemberClassDetailsSheet_(ss);

  SpreadsheetApp.flush();
  Logger.log('All sheets initialized successfully!');
  return { success: true, message: 'All sheets initialized!' };
}

function initializeMembersSheet_(ss) {
  let sheet = ss.getSheetByName(DB_MEMBERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DB_MEMBERS_SHEET_NAME);
  }

  // 기존 내용 삭제
  sheet.clear();

  // 헤더 설정
  const headers = MEMBER_HEADERS;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 데이터 삽입
  const data = getMembersInitData_();
  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
  }

  Logger.log('Members sheet initialized: ' + data.length + ' rows');
}

function getMembersInitData_() {
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let memberId = 1001;

  const rawData = [
    [5006, '회원', '곽지혜', '', '', '', '', '', '', '010 7539-9147'],
    [5006, '회원', '권윤찬', '', '', '', '', '', '', '010-3212-8253'],
    [5006, '회원', '김민규1', '', '', '', '', '', '', '010-5742-7588'],
    [5006, '회원', '김재헌', '', '', '', '', '', '', '010-4080-7947'],
    [5006, '회원', '박신후', '', '', '', '', '', '', '010-3223-1137'],
    [5006, '회원', '박현준', '', '', '', '', '', '', '010-5048-9517'],
    [5006, '회원', '이경진', '', '', '', '', '', '', '010-8522-0035'],
    [5006, '회원', '이기현', '', '', '', '', '', '', '010-2311-4544'],
    [5006, '회원', '이승하', '', '', '', '', '', '', '010-6290-3603'],
    [5006, '회원', '정선아', '', '', '', '', '', '', '010-7552-6064'],
    [5005, '회원', '구태근', '', '', '', '', '', '', '010-2396-3982'],
    [5005, '회원', '김미영', '', '', '', '', '', '', '010-3271-6343'],
    [5005, '회원', '이종환', '', '', '', '', '', '', '010-9983-0520'],
    [5005, '회원', '이한주', '', '', '', '', '', '', '010-3046-0789'],
    [5005, '회원', '최석', '', '', '', '', '', '', '010-6603-9876'],
    [5005, '회원', '한권희', '', '', '', '', '', '', '010-9262-2113'],
    [5005, '회원', '함태호', '', '', '', '', '', '', '010-2701-6243'],
    [5008, '회원', '이효진', '', '', '', '', '', '', '010-7778-7501'],
    [5008, '회원', '임현주', '', '', '', '', '', '', '010-4707-9680'],
    [5008, '회원', '최승훈', '', '', '', '', '', '', '010-7299-1593'],
    [5008, '회원', '최아현', '', '', '', '', '', '', '010-6605-8327'],
    [5021, '회원', '이명희', '', '', '', '', '', '', '010-3010-6055'],
    [5022, '회원', '김태희', '', '', '', '', '', '', '010-2420-0860'],
    [5022, '회원', '김하나', '', '', '', '', '', '', '010-5036-3568'],
    [5022, '회원', '남길우', '', '', '', '', '', '', '010-9139-2046'],
    [5022, '회원', '박예진', '', '', '', '', '', '', '010-4104-9687'],
    [5022, '회원', '박유영', '', '', '', '', '', '', '010-4057-2770'],
    [5022, '회원', '박지희', '', '', '', '', '', '', '010-3821-4010'],
    [5022, '회원', '안수정', '', '', '', '', '', '', '010-2538-6593'],
    [5022, '회원', '오정민', '', '', '', '', '', '', '010-4706-3051'],
    [5022, '회원', '최정미', '', '', '', '', '', '', '010-3036-5862'],
    [5020, '회원', '김경렬', '', '', '', '', '', '', '010-2778-1241'],
    [5020, '회원', '유혜원', '', '', '', '', '', '', '010-6327-1580'],
    [5020, '회원', '이상민', '', '', '', '', '', '', '010-8705-0386'],
    [5020, '회원', '이승희', '', '', '', '', '', '', '010-2000-4855'],
    [5025, '회원', '김충선', '', '', '', '', '', '', '010-4699-7551'],
    [5025, '회원', '박도윤', '', '', '', '', '', '', '010-4333-8845'],
    [5025, '회원', '박서준', '', '', '', '', '', '', '010-3393-5709'],
    [5025, '회원', '이도인', '', '', '', '', '', '', '010-3567-3907'],
    [5025, '회원', '이지아', '', '', '', '', '', '', '010-3875-3875'],
    [5025, '회원', '장보영', '', '', '', '', '', '', '010-3044-7564'],
    [5025, '회원', '정지용', '', '', '', '', '', '', '010-3583-4580'],
    [5025, '회원', '배호연', '', '', '', '', '', '', '010-3804-5856'],
    [5025, '회원', '제우진', '', '', '', '', '', '', '010-2728-6752'],
    [5024, '회원', '고혜주', '', '', '', '', '', '', '010-7490-3707'],
    [5024, '회원', '이정후', '', '', '', '', '', '', '010-6776-9883'],
    [5024, '회원', '정유선', '', '', '', '', '', '', '010-3497-0035'],
    [5018, '회원', '김연준', '', '', '', '', '', '', '010-9289-5463'],
    [5001, '회원', '김지한', '', '', '', '', '', '', '010-7679-3054'],
    [5001, '회원', '권수현', '', '', '', '', '', '', '010-4665-7656'],
    [5001, '회원', '김경아', '', '', '', '', '', '', '010-3352-1389'],
    [5001, '회원', '박경립', '', '', '', '', '', '', '010-8456-5506'],
    [5001, '회원', '박수현', '', '', '', '', '', '', '010-2743-7087'],
    [5001, '회원', '박지현', '', '', '', '', '', '', '010-4929-0025'],
    [5001, '회원', '안수진', '', '', '', '', '', '', '010-7452-0724'],
    [5001, '회원', '원유섭', '', '', '', '', '', '', '010-8885-3595'],
    [5001, '회원', '정연미', '', '', '', '', '', '', '010-5590-3439'],
    [5001, '회원', '정재완', '', '', '', '', '', '', '010-2538-3181'],
    [5001, '회원', '정정화', '', '', '', '', '', '', '010-6256-5751'],
    [5001, '회원', '최남희', '', '', '', '', '', '', '010-7581-1359'],
    [5003, '회원', '권민혁', '', '', '', '', '', '', '010-7123-1759'],
    [5003, '회원', '김규태', '', '', '', '', '', '', '010-9901-7979'],
    [5003, '회원', '김나영', '', '', '', '', '', '', '010-2696-3254'],
    [5003, '회원', '김도희', '', '', '', '', '', '', '010-7540-0024'],
    [5003, '회원', '김성론', '', '', '', '', '', '', '010-6409-5692'],
    [5003, '회원', '김현정', '', '', '', '', '', '', '010-5044-8349'],
    [5003, '회원', '남궁원', '', '', '', '', '', '', '010-2467-5089'],
    [5003, '회원', '박기영', '', '', '', '', '', '', '010-2479-5566'],
    [5003, '회원', '박명희', '', '', '', '', '', '', '010-5453-4514'],
    [5003, '회원', '변현란', '', '', '', '', '', '', '010-8942-2245'],
    [5003, '회원', '어수혜', '', '', '', '', '', '', '010-5568-6997'],
    [5003, '회원', '장주영', '', '', '', '', '', '', '010-5618-5385'],
    [5003, '회원', '조다원', '', '', '', '', '', '', '010-9073-5962'],
    [5003, '회원', '장수은', '', '', '', '', '', '', '010-4512-1127'],
    [5002, '회원', '한우리', '', '', '', '', '', '', '010-2650-2199'],
    [5002, '회원', '강지은', '', '', '', '', '', '', '010-4302-2665'],
    [5002, '회원', '김영민', '', '', '', '', '', '', '010-4174-8209'],
    [5002, '회원', '김영희', '', '', '', '', '', '', '010-2433-2238'],
    [5002, '회원', '김지영', '', '', '', '', '', '', '010-9409-6326'],
    [5002, '회원', '노주영', '', '', '', '', '', '', '010-6508-5450'],
    [5002, '회원', '서동현', '', '', '', '', '', '', '010-5931-3607'],
    [5002, '회원', '이민주', '', '', '', '', '', '', '010-9235-8337'],
    [5002, '회원', '탁명란', '', '', '', '', '', '', '010-9101-7278'],
    [5020, '회원', '김민규2', '', '', '', '', '', '', '010-4692-6410'],
    [5028, '회원', '김재곤', '', '', '', '', '', '', '010-2853-8002'],
    [5028, '회원', '김진학', '', '', '', '', '', '', '010-9060-5580'],
    [5028, '회원', '박현배', '', '', '', '', '', '', '010-4229-3008'],
    [5028, '회원', '박형준', '', '', '', '', '', '', '010-9166-2918'],
    [5028, '회원', '최윤경', '', '', '', '', '', '', '010-3852-5046'],
    [5028, '회원', '허미선', '', '', '', '', '', '', '010-6282-0102'],
    [5004, '회원', '김무회', '', '', '', '', '', '', '010-4538-0987'],
    [5004, '회원', '김수현', '', '', '', '', '', '', '010-7159-3393'],
    [5004, '회원', '배주희', '', '', '', '', '', '', '010-8449-2462'],
    [5004, '회원', '백무성', '', '', '', '', '', '', '010-8357-7026'],
    [5004, '회원', '성낙진', '', '', '', '', '', '', '010-3713-8404'],
    [5004, '회원', '송강헌', '', '', '', '', '', '', '010-8337-0316'],
    [5004, '회원', '안주호', '', '', '', '', '', '', '010-5123-3818'],
    [5004, '회원', '유지영', '', '', '', '', '', '', '010-8226-5606'],
    [5004, '회원', '전양종', '', '', '', '', '', '', '0104277-8797'],
    [5004, '회원', '천성민', '', '', '', '', '', '', '010-7678-9914'],
    [5004, '회원', '허영자', '', '', '', '', '', '', '010-8500-6373'],
    [5004, '회원', '황혜정', '', '', '', '', '', '', '010-5358-7993'],
    [5007, '회원', '김미라', '', '', '', '', '', '', '010-7771-7954'],
    [5007, '회원', '유현주', '', '', '', '', '', '', '010-3560-1500'],
    [5007, '회원', '최승현', '', '', '', '', '', '', '010-2711-6453'],
    [1001, '관리자', '이정우', '', '', '', '', '', '', '010-4238-7781']
  ];

  // MEMBER_HEADERS 순서에 맞게 데이터 변환
  // member_id,class_id,gubun,member_name,name1_gubun,name1,name2_gubun,name2,name3_gubun,name3,phone,...
  return rawData.map((row, idx) => {
    const mId = memberId++;
    return [
      mId,           // member_id
      row[0],        // class_id
      row[1],        // gubun
      row[2].trim(), // member_name
      row[3],        // name1_gubun
      row[4],        // name1
      row[5],        // name2_gubun
      row[6],        // name2
      row[7],        // name3_gubun
      row[8],        // name3
      row[9],        // phone
      '',            // login_id
      '',            // password
      '',            // account_bank
      '',            // account_no
      '',            // account_name
      '',            // address
      '',            // note1
      '',            // note2
      '',            // member_token
      '',            // telegram_chat_id
      '',            // telegram_username
      '',            // telegram_enabled
      '',            // kaib_date
      regDate,       // reg_date
      'init'         // reg_id
    ];
  });
}

function initializeClassSheet_(ss) {
  let sheet = ss.getSheetByName(CLASS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CLASS_SHEET_NAME);
  }

  sheet.clear();

  const headers = CLASS_HEADERS;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // class_id,class_type,class_name,class_grade,class_loc,class_week,class_time_from,class_time_to,class_loop,class_loop_min,class_price,guaranteed_type,guaranteed_details,remark,reg_date,reg_id
  const data = [
    [5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '수', '10', '13', 13, 13, '1,990,000', '물건추천', '입찰가', '격주', regDate, 'init'],
    [5002, 'CLASS', '부산단기투자클럽B', '일반', '부산', '수', '19', '22', 13, 13, '1,990,000', '물건추천', '입찰가', '격주', regDate, 'init'],
    [5003, 'CLASS', '서울단기투자클럽A', '일반', '서울', '토', '15', '18', 13, 13, '2,190,000', '물건추천', '입찰가', '격주', regDate, 'init'],
    [5004, 'CLASS', '온라인단기투자클럽', '일반', '온라인', '금', '11', '13', 8, 8, '990,000', '물건추천', '입찰가', '격주', regDate, 'init'],
    [5005, 'PT', '1:1', '일반', '서울', '', '', '', '', '', '4,290,000', '낙찰', '1건', '', regDate, 'init'],
    [5006, 'PT', '1:1', '일반', '부산', '', '', '', '', '', '3,290,000', '낙찰', '1건', '', regDate, 'init'],
    [5007, 'PT', '1:1', '일반', '온라인추천물건', '', '', '', '', '', '3,290,000', '낙찰', '1건', '', regDate, 'init'],
    [5008, 'PT', '2:1', '일반', '서울', '', '', '', '', '', '3,510,000', '낙찰', '1건', '', regDate, 'init'],
    [5009, 'PT', '2:1', '일반', '부산', '', '', '', '', '', '2,630,000', '낙찰', '1건', '', regDate, 'init'],
    [5010, 'PT', '2:1', '일반', '온라인추천물건', '', '', '', '', '', '3,290,000', '낙찰', '1건', '', regDate, 'init'],
    [5011, 'PT', '3:1', '일반', '서울', '', '', '', '', '', '3,070,000', '낙찰', '1건', '', regDate, 'init'],
    [5012, 'PT', '3:1', '일반', '부산', '', '', '', '', '', '2,300,000', '낙찰', '1건', '', regDate, 'init'],
    [5013, 'PT', '3:1', '일반', '온라인추천물건', '', '', '', '', '', '3,290,000', '낙찰', '1건', '', regDate, 'init'],
    [5014, 'PT', '4:1', '일반', '서울', '', '', '', '', '', '2,630,000', '낙찰', '1건', '', regDate, 'init'],
    [5015, 'PT', '4:1', '일반', '부산', '', '', '', '', '', '1,970,000', '낙찰', '1건', '', regDate, 'init'],
    [5016, 'PT', '4:1', '일반', '온라인추천물건', '', '', '', '', '', '3,290,000', '낙찰', '1건', '', regDate, 'init'],
    [5017, '프리미엄 PT', '1:1', '플레티넘', '서울', '', '', '', 15, 6, '30,000,000', '수익', '80,000,000', '', regDate, 'init'],
    [5018, '프리미엄 PT', '1:1', '플레티넘', '부산', '', '', '', 15, 6, '30,000,000', '수익', '80,000,000', '', regDate, 'init'],
    [5019, '프리미엄 PT', '1:1', '플레티넘', '온라인추천물건', '', '', '', 15, 6, '30,000,000', '수익', '80,000,000', '', regDate, 'init'],
    [5020, '프리미엄 PT', '1:1', '블랙', '서울', '', '', '', 13, 6, '16,500,000', '수익', '30,000,000', '', regDate, 'init'],
    [5021, '프리미엄 PT', '1:1', '블랙', '대구', '', '', '', 13, 6, '16,500,000', '수익', '30,000,000', '', regDate, 'init'],
    [5022, '프리미엄 PT', '1:1', '블랙', '부산', '', '', '', 13, 6, '16,500,000', '수익', '30,000,000', '', regDate, 'init'],
    [5023, '프리미엄 PT', '1:1', '블랙', '온라인추천물건', '', '', '', 13, 6, '16,500,000', '수익', '30,000,000', '', regDate, 'init'],
    [5024, '프리미엄 PT', '1:1', '실버', '서울', '', '', '', 10, 6, '11,000,000', '수익', '20,000,000', '', regDate, 'init'],
    [5025, '프리미엄 PT', '1:1', '실버', '부산', '', '', '', 10, 6, '11,000,000', '수익', '20,000,000', '', regDate, 'init'],
    [5026, '프리미엄 PT', '1:1', '실버', '온라인추천물건', '', '', '', 10, 6, '11,000,000', '수익', '20,000,000', '', regDate, 'init'],
    [5027, 'CLASS', '블루존', '일반', '서울', '', '', '', 8, 8, '2,490,000', '수업', '', '', regDate, 'init'],
    [5028, 'CLASS', '블루존', '일반', '부산', '', '', '', 8, 8, '1,990,000', '수업', '', '', regDate, 'init'],
    [5029, 'CLASS', '블루존', '일반', '온라인', '', '', '', 8, 8, '1,490,000', '수업', '', '', regDate, 'init'],
    [5030, 'CLASS', '온라인트레이닝반', '일반', '온라인', '', '', '', 1, 1, '290,000', '수업', '2달', '', regDate, 'init'],
    [5031, 'CLASS', '온라인경매초급반', '일반', '온라인', '', '', '', 1, 1, '100,000', '수업', '1달', '', regDate, 'init']
  ];

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
  }

  Logger.log('Class sheet initialized: ' + data.length + ' rows');
}

function initializeClassD1Sheet_(ss) {
  let sheet = ss.getSheetByName(CLASS_D1_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CLASS_D1_SHEET_NAME);
  }

  sheet.clear();

  const headers = CLASS_D1_HEADERS;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // class_d1_id,class_id,class_type,class_name,class_grade,class_loc,class_date,class_week,class_time_from,class_time_to,class_loop,completed,reg_date,reg_id
  const data = [
    ['5001_20260128121033_1', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260128', '월', '10', '13', 1, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_2', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260211', '월', '10', '13', 2, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_3', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260225', '월', '10', '13', 3, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_4', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260311', '월', '10', '13', 4, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_5', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260325', '월', '10', '13', 5, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_6', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260408', '월', '10', '13', 6, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_7', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260422', '월', '10', '13', 7, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_8', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260506', '월', '10', '13', 8, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_9', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260520', '월', '10', '13', 9, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_10', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260603', '월', '10', '13', 10, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_11', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260617', '월', '10', '13', 11, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_12', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260701', '월', '10', '13', 12, 'N', '2026-01-26', 'init'],
    ['5001_20260128121033_13', 5001, 'CLASS', '부산단기투자클럽A', '일반', '부산', '20260715', '월', '10', '13', 13, 'N', '2026-01-26', 'init']
  ];

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
  }

  Logger.log('ClassD1 sheet initialized: ' + data.length + ' rows');
}

function initializeMemberClassDetailsSheet_(ss) {
  let sheet = ss.getSheetByName(MEMBER_CLASS_DETAILS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBER_CLASS_DETAILS_SHEET_NAME);
  }

  sheet.clear();

  const headers = MEMBER_CLASS_DETAILS_HEADERS;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  Logger.log('MemberClassDetails sheet initialized (headers only)');
}

/**
 * [Migration] Items 시트의 member_id가 비어있을 때, m_name(이름)을 기준으로
 * Members 시트에서 member_id를 찾아 채워넣습니다.
 * - 주의: 동명이인이 있을 경우, Members 시트에서 먼저 발견된 회원의 ID를 사용합니다.
 */
function syncItemMemberIdsByName() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
  // memberSheet는 readAllMembers() 내부에서 처리됨

  if (!itemSheet) {
    return { success: false, message: 'Items 시트를 찾을 수 없습니다.' };
  }

  // 1. 회원 정보 로딩 (이름 -> ID 매핑 생성)
  const members = readAllMembers();
  const nameToIdMap = new Map();

  members.forEach(m => {
    // 이름 정규화 (앞뒤 공백 제거)
    const name = String(m.member_name || m.name || '').trim();
    const id = String(m.member_id || '').trim();
    if (name && id && !nameToIdMap.has(name)) {
      nameToIdMap.set(name, id);
    }
  });

  // 2. 물건 정보 로딩 (Raw Data)
  const lastRow = itemSheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '물건 데이터가 없습니다.' };

  // 전체 데이터 범위를 읽음 (헤더 제외)
  // 필요한 컬럼 인덱스 (0-based in array)
  // m_name : 6 (G열)
  // member_id : 8 (I열)
  const range = itemSheet.getRange(2, 1, lastRow - 1, itemSheet.getLastColumn());
  const values = range.getValues();

  let updatedCount = 0;
  let missingCount = 0;

  // member_id 열 데이터만 별도로 관리 (업데이트용)
  // values는 Reference가 아니므로 복사본처럼 동작하지만,
  // 나중에 setValues할 2차원 배열을 만듦.
  // Col Index 8 (I열)
  const memberIdColValues = values.map(row => [row[8]]);

  // 3. 데이터 순회하며 member_id 채우기
  values.forEach((row, i) => {
    const currentMemberId = String(row[8] || '').trim(); // I열
    const mName = String(row[6] || '').trim(); // G열

    // member_id가 비어있고, 이름이 있는 경우에만 처리
    if (!currentMemberId && mName) {
      if (nameToIdMap.has(mName)) {
        const foundId = nameToIdMap.get(mName);
        memberIdColValues[i][0] = foundId; // 업데이트
        updatedCount++;
      } else {
        missingCount++;
        Logger.log(`[Skip] ID not found for name: ${mName} (Row ${i + 2})`);
      }
    }
  });

  // 4. 배치 업데이트
  if (updatedCount > 0) {
    // I열(9번째) 전체 덮어쓰기
    itemSheet.getRange(2, 9, memberIdColValues.length, 1).setValues(memberIdColValues);
  }

  return {
    success: true,
    message: `동기화 완료: 총 ${updatedCount}건의 member_id를 복구했습니다. (이름 매칭 실패: ${missingCount}건)`,
    details: { updated: updatedCount, missing: missingCount }
  };
}

/**
 * 아이템의 특정 필드들을 업데이트합니다. (주로 입찰/취소 요청 시 사용)
 * @param {Object} data { id, status, remarks, ... }
 * @param {boolean} silent (성공 시 메시지 최소화 여부)
 * @return {Object} { success, message }
 */
function saveItemData(data, silent = false) {
  if (!data || !data.id) return { success: false, message: 'ID가 없습니다.' };

  const itemId = data.id;
  const sheet = getSpreadsheet().getSheetByName('bidding');
  const headers = BIDDING_HEADERS;
  const rowIdx = findItemRowById_(itemId);

  if (rowIdx === -1) return { success: false, message: '물건을 찾을 수 없습니다.' };

  const range = sheet.getRange(rowIdx, 1, 1, headers.length);
  const rowValues = range.getValues()[0];

  // 데이터 매핑
  if (data.status !== undefined) {
    const statusCol = headers.indexOf('stu_member');
    if (statusCol !== -1) rowValues[statusCol] = data.status;
  }

  if (data.remarks !== undefined) {
    const remarksCol = headers.indexOf('remarks');
    if (remarksCol !== -1) {
      // 기존 비고 유지하면서 추가
      const oldVal = rowValues[remarksCol] || '';
      rowValues[remarksCol] = (oldVal ? oldVal + '\n' : '') + data.remarks;
    }
  }

  range.setValues([rowValues]);

  return { success: true, message: silent ? '처리완료' : '데이터가 성공적으로 업데이트되었습니다.' };
}

/**
 * 다수 물건의 chuchen_state 및 chuchen_date를 업데이트합니다.
 * 텔레그램 전송 성공/실패 여부와 무관하게 항상 업데이트.
 * @param {Array} itemIds - 물건 ID 배열
 * @param {string} state - '신규' | '전달완료'
 * @param {string} dateStr - ISO date string (선택, state='전달완료'일 때 기록)
 * @returns {{ success: boolean, updated: number }}
 */
/**
 * [만기연장] 선택 물건들의 bid_datetime_2(T열)를 새 값으로 갱신
 * @param {Array<string>} itemIds 물건 ID 배열
 * @param {string} newBd2 새 마감 yyMMddHHmm (10자리)
 * @return {{success: boolean, updated: number, message?: string}}
 */
function extendItemDeadline(itemIds, newBd2, reactivate) {
  try {
    if (!itemIds || !itemIds.length) return { success: false, updated: 0, message: '대상 물건이 없습니다.' };
    const bd2 = String(newBd2 || '').trim();
    if (!/^\d{10}$/.test(bd2)) return { success: false, updated: 0, message: '잘못된 마감 형식 (yyMMddHHmm 10자리 필요)' };
    const isReactivate = !!reactivate;
    const nowIso = new Date().toISOString();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, updated: 0, message: '시트를 찾을 수 없습니다.' };
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, updated: 0, message: '데이터가 없습니다.' };
    const idStrs = itemIds.map(String);
    const allIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String);
    const affectedMembers = [];
    let updated = 0;
    const noteText = isReactivate ? '만기연장 (추천 재활성화)' : '만기연장';
    idStrs.forEach(function(id) {
      const idx = allIds.indexOf(id);
      if (idx < 0) return;
      const rowNum = idx + 2;
      const oldBd2 = String(sheet.getRange(rowNum, 20).getValue() || '').trim();
      sheet.getRange(rowNum, 20).setValue(bd2); // T: bid_datetime_2
      const mid = String(sheet.getRange(rowNum, 9).getValue() || '').trim();
      const mName = String(sheet.getRange(rowNum, 7).getValue() || '').trim();

      // reactivate: stu='추천', chuchen_state='전달완료', chuchen_date=now 도 같이 갱신
      let oldStu = '', oldCs = '', oldCd = '';
      if (isReactivate) {
        oldStu = String(sheet.getRange(rowNum, 5).getValue() || '').trim();   // E: stu_member
        oldCs  = String(sheet.getRange(rowNum, 17).getValue() || '').trim();  // Q: chuchen_state
        oldCd  = String(sheet.getRange(rowNum, 18).getValue() || '').trim();  // R: chuchen_date
        if (oldStu !== '추천')      sheet.getRange(rowNum, 5).setValue('추천');
        if (oldCs !== '전달완료')   sheet.getRange(rowNum, 17).setValue('전달완료');
                                     sheet.getRange(rowNum, 18).setValue(nowIso);
      }

      if (mid && affectedMembers.indexOf(mid) === -1) affectedMembers.push(mid);
      try {
        writeItemHistory_({
          action: 'FIELD_CHANGE', item_id: id, member_id: mid, member_name: mName,
          field_name: 'bid_datetime_2', from_value: oldBd2, to_value: bd2,
          trigger_type: 'web', note: noteText
        });
        if (isReactivate) {
          if (oldStu !== '추천') writeItemHistory_({
            action: 'FIELD_CHANGE', item_id: id, member_id: mid, member_name: mName,
            field_name: 'stu_member', from_value: oldStu, to_value: '추천',
            trigger_type: 'web', note: noteText
          });
          if (oldCs !== '전달완료') writeItemHistory_({
            action: 'FIELD_CHANGE', item_id: id, member_id: mid, member_name: mName,
            field_name: 'chuchen_state', from_value: oldCs, to_value: '전달완료',
            trigger_type: 'web', note: noteText
          });
          writeItemHistory_({
            action: 'FIELD_CHANGE', item_id: id, member_id: mid, member_name: mName,
            field_name: 'chuchen_date', from_value: oldCd, to_value: nowIso,
            trigger_type: 'web', note: noteText
          });
        }
      } catch(e) { /* 이력 실패는 무시 */ }
      updated++;
    });
    if (updated > 0) {
      SpreadsheetApp.flush();
      try { invalidateMemberItemsCache_(affectedMembers); } catch(e) {}
    }
    return { success: true, updated: updated, reactivated: isReactivate };
  } catch(e) {
    return { success: false, updated: 0, message: e.message };
  }
}

function updateChuchenState(itemIds, state, dateStr, triggerType) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, updated: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, updated: 0 };
    // ITEM_HEADERS 전체 길이만큼 읽어 class_d1_id(S), bid_datetime_2(T)까지 확보
    var allData = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();
    var updated = 0;
    var idsStr = itemIds.map(String);
    var affectedMemberIds = [];
    allData.forEach(function (row, i) {
      var rowId = String(row[0] || '').trim();
      if (idsStr.indexOf(rowId) === -1) return;
      var oldState = String(row[16] || '').trim(); // Q열(idx 16): chuchen_state
      var oldClassD1Id = String(row[18] || '').trim(); // S열: class_d1_id
      var oldBd2 = String(row[19] || '').trim(); // T열: bid_datetime_2

      sheet.getRange(i + 2, 17).setValue(state); // Q: chuchen_state

      if (state === '전달완료') {
        // chuchen_date 저장 (dateStr 우선, 없으면 now)
        var savedChuchenDate = dateStr || new Date().toISOString();
        sheet.getRange(i + 2, 18).setValue(savedChuchenDate); // R: chuchen_date

        // bid_datetime_2 자동 계산: 일반 케이스(class_d1_id 비어있음)만
        // 수업회차 케이스는 회차 등록 시 이미 채워진 bid_datetime_2 유지
        if (!oldClassD1Id) {
          var bd2 = calcBidDatetime2FromChuchen_(savedChuchenDate);
          if (bd2) sheet.getRange(i + 2, 20).setValue(bd2); // T: bid_datetime_2
        }
      } else {
        // 전달완료 해제(신규 등) → 4키 룰 깨짐, chuchen_date / bid_datetime_2 클리어
        sheet.getRange(i + 2, 18).setValue(''); // R: chuchen_date
        // bid_datetime_2는 일반 케이스만 클리어 (수업은 회차 데이터 유지)
        if (!oldClassD1Id) {
          sheet.getRange(i + 2, 20).setValue(''); // T: bid_datetime_2
        }
      }

      // FIELD_CHANGE 로깅 (변경이 실제 발생한 경우만)
      if (oldState !== state) {
        // [중요] 텔레그램 발송에 의한 자동 업데이트인 경우 별도 로그 안 남김 (발송 로그에 포함됨)
        if (triggerType !== 'skip_logging') {
          writeItemHistory_({
            action: 'FIELD_CHANGE',
            item_id: rowId,
            member_id: String(row[8] || '').trim(),   // I열: member_id
            member_name: String(row[6] || '').trim(),  // G열: m_name
            field_name: 'chuchen_state',
            from_value: oldState,
            to_value: state,
            trigger_type: triggerType || 'web-telegram',
            note: 'chuchen_state 변경'
          });
        }
      }
      var mid = String(row[8] || '').trim();
      if (mid && affectedMemberIds.indexOf(mid) === -1) affectedMemberIds.push(mid);
      updated++;
    });
    if (updated > 0) {
      SpreadsheetApp.flush();
      invalidateMemberItemsCache_(affectedMemberIds);
    }
    return { success: true, updated: updated };
  } catch (e) {
    Logger.log('updateChuchenState 오류: ' + e.message);
    return { success: false, updated: 0 };
  }
}

/**
 * 다수 물건의 bid_state를 일괄 업데이트합니다. (FIELD_CHANGE 로깅 포함)
 * @param {Array} itemIds - 물건 ID 배열
 * @param {string} state - '신규' | '전달완료' | '확인완료'
 */
function updateBidState(itemIds, state) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, updated: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, updated: 0 };
    var allData = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    // [0]id [6]m_name [8]member_id [11]bid_state
    var updated = 0;
    var idsStr = itemIds.map(String);
    var affectedMemberIds = [];
    allData.forEach(function (row, i) {
      var rowId = String(row[0] || '').trim();
      if (idsStr.indexOf(rowId) === -1) return;
      var oldState = String(row[11] || '').trim();
      sheet.getRange(i + 2, 12).setValue(state);
      if (oldState !== state) {
        writeItemHistory_({
          action: 'FIELD_CHANGE',
          item_id: rowId,
          member_id: String(row[8] || '').trim(),
          member_name: String(row[6] || '').trim(),
          field_name: 'bid_state',
          from_value: oldState,
          to_value: state,
          trigger_type: 'web',
          note: 'bid_state 변경'
        });
      }
      var mid = String(row[8] || '').trim();
      if (mid && affectedMemberIds.indexOf(mid) === -1) affectedMemberIds.push(mid);
      updated++;
    });
    if (updated > 0) {
      SpreadsheetApp.flush();
      invalidateMemberItemsCache_(affectedMemberIds);
    }
    return { success: true, updated: updated };
  } catch (e) {
    Logger.log('updateBidState 오류: ' + e.message);
    return { success: false, updated: 0 };
  }
}

/**
 * 물건의 특정 필드 하나를 일괄 업데이트합니다. (배치 처리 최적화)
 * @param {Array} ids - 물건 ID 배열
 * @param {string} field - 필드명 (e.g., 'note', 'stu_member'...)
 * @param {any} value - 저장할 값
 */
function updateDataField(ids, field, value) {
  try {
    if (!ids || !ids.length) return { success: false, message: 'ID 목록이 없습니다.' };
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

    const colIndex = ITEM_HEADERS.indexOf(field);
    if (colIndex === -1) return { success: false, message: '유효하지 않은 필드명입니다: ' + field };
    const realColNum = colIndex + 1;

    // [최적화] ID가 한 개인 경우: 전체 시트를 읽지 않고 해당 셀만 직접 수정 (속도/동시성 개선)
    if (ids.length === 1) {
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(10000); // 10초 대기
        const id = String(ids[0]);
        const allIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
        const rowIdx = allIds.findIndex(v => String(v) === id);
        if (rowIdx >= 0) {
          sheet.getRange(rowIdx + 2, realColNum).setValue(value);
          SpreadsheetApp.flush();
          return { success: true, message: `1건의 [${field}] 필드가 수정되었습니다.`, updated: 1 };
        } else {
          return { success: false, message: 'ID를 찾을 수 없습니다: ' + id };
        }
      } finally {
        lock.releaseLock();
      }
    }

    // [BATCH] 여러 개 업데이트 시: Lock 적용 후 전체 데이터 읽기 -> 메모리 수정 -> 한 번에 쓰기
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000); // 일괄 처리 시 30초 대기
      const range = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length);
      const data = range.getValues();
      let updatedCount = 0;

      ids.forEach(id => {
        const rowIdx = data.findIndex(row => String(row[0]) === String(id));
        if (rowIdx >= 0) {
          data[rowIdx][colIndex] = value;
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        range.setValues(data);
        SpreadsheetApp.flush();
      }

      return { success: true, message: `${updatedCount}건의 [${field}] 필드가 수정되었습니다.`, updated: updatedCount };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[updateDataField] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * 물건별로 서로 다른 값을 가진 특정 필드를 일괄 업데이트합니다.
 * @param {Array<{id: string, value: any}>} updates - {id, value} 객체 배열
 * @param {string} field - 필드명
 */
function updateDataFieldBulk(updates, field) {
  try {
    if (!updates || !updates.length) return { success: false, message: '업데이트 목록이 없습니다.' };
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

    const colIndex = ITEM_HEADERS.indexOf(field);
    if (colIndex === -1) return { success: false, message: '유효하지 않은 필드명입니다: ' + field };

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000); // 30초 대기
      const range = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length);
      const data = range.getValues();
      let updatedCount = 0;

      updates.forEach(u => {
        const rowIdx = data.findIndex(row => String(row[0]) === String(u.id));
        if (rowIdx >= 0) {
          data[rowIdx][colIndex] = u.value;
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        range.setValues(data);
        SpreadsheetApp.flush();
      }

      return { success: true, message: `${updatedCount}건이 일괄 수정되었습니다.`, updated: updatedCount };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[updateDataFieldBulk] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

// ------------------------------------------------------------------------------------------------
// [PHASE 1-2] 이력 기록 공통 함수
// ------------------------------------------------------------------------------------------------

/**
 * telegram_requests 시트에 이력 1건을 기록합니다.
 */
function writeItemHistory_(p) {
  writeItemHistoryBatch_([p]);
}

/**
 * [PHASE 1-4] telegram_requests 시트에 이력을 배치로 기록합니다. (성능 최적화 핵심)
 * @param {Array<Object>} entries - 이력 객체 배열
 */
function writeItemHistoryBatch_(entries) {
  if (!entries || entries.length === 0) return;

  try {
    const sheet = ensureTelegramRequestsSheet_();
    const now = new Date();

    // 이력 데이터를 이차원 배열로 변환 (A~P열)
    const rows = entries.map(p => [
      p.req_id || String(now.getTime()), // A: req_id
      now,                            // B: requested_at
      p.action || '',                 // C: action
      p.status || 'DONE',             // D: status
      p.item_id || '',                // E: item_id
      p.member_id || '',              // F: member_id
      p.chat_id || '',                // G: chat_id
      p.telegram_username || '',      // H: telegram_username
      p.note || '',                   // I: note
      now,                            // J: approved_at
      p.approved_by || 'system',      // K: approved_by
      p.from_value || '',             // L: from_value
      p.to_value || '',               // M: to_value
      p.field_name || '',             // N: field_name
      p.trigger_type || 'system',     // O: trigger_type
      p.member_name || ''             // P: member_name
    ]);

    // 마지막 행 다음부터 일괄 쓰기
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, 16).setValues(rows);

    // [중요] 즉시 동기화
    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('[writeItemHistoryBatch_] 오류: ' + e.toString());
  }

  // [돈클] 추천/불가/낙찰 마일스톤 → members_item_status 적립 (입찰은 일별 트리거에서)
  //   · 히스토리 기록 실패와 무관하게 별도 try (적립 오류가 본 흐름 안 깸)
  try {
    for (let ai = 0; ai < entries.length; ai++) {
      const ep = entries[ai];
      const fn = String(ep.field_name || '').trim();
      const tv = String(ep.to_value || '').trim();
      let accStatus = '';
      if (fn === 'chuchen_state' && tv === '전달완료') accStatus = '추천';
      else if (fn === 'stu_member' && tv === '불가') accStatus = '불가';
      else if (fn === 'stu_member' && tv === '낙찰') accStatus = '낙찰';
      if (accStatus) accrueMembersItemStatus_(ep.item_id, ep.member_id, ep.member_name, accStatus);
    }
  } catch (e2) {
    Logger.log('[writeItemHistoryBatch_/적립] 오류: ' + e2.toString());
  }
}

// ------------------------------------------------------------------------------------------------
// [PHASE 3-1] settings 시트 관리
// ------------------------------------------------------------------------------------------------

const SETTINGS_SHEET_NAME = 'settings';

/**
 * settings 시트를 초기화합니다. 없으면 생성하고 기본값을 입력합니다.
 * GAS 에디터에서 1회 실행하거나 initSheets()에서 호출합니다.
 */
function ensureSettingsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SETTINGS_SHEET_NAME);

  if (sheet.getLastRow() < 1) {
    // 헤더
    sheet.getRange(1, 1, 1, 3).setValues([['key', 'value', 'description']]);
    // 기본값
    const defaults = [
      ['BID_NOTIFY_ENABLED', 'true', '입찰일 알림 전체 ON/OFF'],
      ['BID_NOTIFY_D3', 'true', 'D-3 알림 활성화'],
      ['BID_NOTIFY_D2', 'true', 'D-2 알림 활성화'],
      ['BID_NOTIFY_D1', 'true', 'D-1 알림 활성화'],
      ['BID_NOTIFY_HOUR', '10', '발송 시각 (시 단위)'],
      ['AUTO_EXPIRE_ENABLED', 'true', '추천물건 48시간 후 자동 미정 전환 ON/OFF'],
      ['EXPIRY_NOTIFY_24H', 'true', '추천 24h 알림'],
      ['EXPIRY_NOTIFY_1H', 'true', '추천 47h(만료 1시간 전) 알림'],
      ['EXPIRY_NOTIFY_DONE', 'true', '만료 처리 알림'],
    ];
    sheet.getRange(2, 1, defaults.length, 3).setValues(defaults);
    SpreadsheetApp.flush();
  }
  return sheet;
}

/**
 * settings 시트에서 키에 해당하는 값을 반환합니다.
 * @param {string} key
 * @param {string} [defaultValue=''] 키 없을 때 반환값
 * @returns {string}
 */
function getSetting_(key, defaultValue) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return defaultValue !== undefined ? String(defaultValue) : '';
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) return String(data[i][1]).trim();
    }
    return defaultValue !== undefined ? String(defaultValue) : '';
  } catch (e) {
    Logger.log('[getSetting_] 오류: ' + e.toString());
    return defaultValue !== undefined ? String(defaultValue) : '';
  }
}

/**
 * settings 시트의 키 값을 변경합니다.
 * @param {string} key
 * @param {string} value
 */
function saveSetting_(key, value) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (String(keys[i][0]).trim() === key) {
          sheet.getRange(i + 2, 2).setValue(String(value));
          SpreadsheetApp.flush();
          return;
        }
      }
    }
    // 없으면 추가
    sheet.appendRow([key, String(value), '']);
    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('[saveSetting_] 오류: ' + e.toString());
  }
}

// ------------------------------------------------------------------------------------------------
// [PHASE 2-1] 추천 자동 만료 + 알림
// ------------------------------------------------------------------------------------------------

/**
 * 추천 물건 자동 만료 처리 (매시간 트리거로 실행)
 * - chuchen_state='전달완료' + elapsed >= 48h → stu_member='미정' 전환
 * - elapsed >= 47h → 만료 1시간 전 알림 (중복 방지)
 * - elapsed >= 24h → 24시간 경과 알림 (중복 방지)
 */
function autoExpireRecommended() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // 중복 실행 방지

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return;
    const now = new Date();

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();

    data.forEach(function (row, i) {
      const realRow = i + 2;
      const itemId = String(row[0] || '').trim();
      const stuMember = String(row[4] || '').trim();
      const memberId = String(row[8] || '').trim();
      const mName = String(row[6] || '').trim();
      const chuchenState = String(row[16] || '').trim();  // Q열: chuchen_state
      const chuchenDate = row[17];                        // R열: chuchen_date
      const classD1Id   = String(row[18] || '').trim();  // S열: class_d1_id
      const bd2Str      = String(row[19] || '').trim();  // T열: bid_datetime_2

      if (stuMember !== '추천') return;

      // [신규 룰] bid_datetime_2 우선. 만료 시 4키 모두 클리어
      // (일반/수업 통합 처리. 일반은 updateChuchenState에서 bid_datetime_2가 자동 채워짐)
      if (bd2Str) {
        const expTs = parseBd2Str_(bd2Str);
        if (!isNaN(expTs) && now.getTime() >= expTs) {
          if (getSetting_('AUTO_EXPIRE_ENABLED', 'true') === 'true') {
            sheet.getRange(realRow, 5).setValue('미정');     // E: stu_member
            sheet.getRange(realRow, 17).setValue('');         // Q: chuchen_state
            sheet.getRange(realRow, 18).setValue('');         // R: chuchen_date
            // S(class_d1_id)는 보존: 만료돼도 수업관리 회차 물건탭에 미정으로 유지. class_d1_id는 물건탭 등록/추가/제거에서만 변경
            sheet.getRange(realRow, 20).setValue('');         // T: bid_datetime_2
            writeItemHistory_({
              action: 'AUTO_EXPIRE',
              item_id: itemId,
              member_id: memberId,
              member_name: mName,
              field_name: 'stu_member',
              from_value: '추천',
              to_value: '미정',
              trigger_type: 'system',
              note: classD1Id ? 'class_d1_expire' : 'bd2_expire'
            });
            if (getSetting_('EXPIRY_NOTIFY_DONE', 'true') === 'true') {
              sendExpiryNotification_(memberId, itemId, 'done');
            }
          }
        }
        return; // bid_datetime_2가 있으면 그것만 기준
      }

      // [Fallback - 기존 데이터 호환] bid_datetime_2가 없는 옛 데이터: chuchen_date+48h
      if (chuchenState !== '전달완료') return;
      if (!chuchenDate) return;

      // chuchen_date가 Date 객체거나 ISO 문자열일 수 있음
      let dateObj;
      if (chuchenDate instanceof Date) {
        dateObj = chuchenDate;
      } else {
        dateObj = new Date(chuchenDate);
      }
      if (isNaN(dateObj.getTime())) return;

      const elapsed = (now - dateObj) / (1000 * 3600); // 시간 단위

      if (elapsed >= 48) {
        // 미정 전환 (만료): 4키 모두 클리어
        if (getSetting_('AUTO_EXPIRE_ENABLED', 'true') === 'true') {
          sheet.getRange(realRow, 5).setValue('미정');
          sheet.getRange(realRow, 17).setValue(''); // Q
          sheet.getRange(realRow, 18).setValue(''); // R
          // S(class_d1_id)는 보존: 만료돼도 수업관리 회차 물건탭에 미정으로 유지
          sheet.getRange(realRow, 20).setValue(''); // T: bid_datetime_2
          writeItemHistory_({
            action: 'AUTO_EXPIRE',
            item_id: itemId,
            member_id: memberId,
            member_name: mName,
            field_name: 'stu_member',
            from_value: '추천',
            to_value: '미정',
            trigger_type: 'system',
            note: 'elapsed=' + Math.floor(elapsed) + 'h'
          });
          // 만료 처리 알림 (별도 토글)
          if (getSetting_('EXPIRY_NOTIFY_DONE', 'true') === 'true') {
            sendExpiryNotification_(memberId, itemId, 'done');
          }
        }

      } else if (elapsed >= 47 && !isAlreadyNotified_(itemId, 'EXPIRY_NOTIFY', '47h')) {
        if (getSetting_('EXPIRY_NOTIFY_1H', 'true') === 'true') {
          writeItemHistory_({
            action: 'EXPIRY_NOTIFY',
            item_id: itemId,
            member_id: memberId,
            member_name: mName,
            trigger_type: 'system',
            note: '47h'
          });
          sendExpiryNotification_(memberId, itemId, '1h');
        }

      } else if (elapsed >= 24 && !isAlreadyNotified_(itemId, 'EXPIRY_NOTIFY', '24h')) {
        if (getSetting_('EXPIRY_NOTIFY_24H', 'true') === 'true') {
          writeItemHistory_({
            action: 'EXPIRY_NOTIFY',
            item_id: itemId,
            member_id: memberId,
            member_name: mName,
            trigger_type: 'system',
            note: '24h'
          });
          sendExpiryNotification_(memberId, itemId, '24h');
        }
      }
    });

    if (lastRow >= 2) SpreadsheetApp.flush();

  } catch (e) {
    Logger.log('[autoExpireRecommended] 오류: ' + e.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * 이미 해당 알림을 발송했는지 확인 (중복 방지)
 * @param {string} itemId
 * @param {string} action  - 'EXPIRY_NOTIFY' 등
 * @param {string} noteKey - '24h' | '47h' 등 note에 포함된 키
 * @returns {boolean}
 */
function isAlreadyNotified_(itemId, action, noteKey) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return false;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues(); // A~I열
    return data.some(function (r) {
      return String(r[2]).trim() === action &&
        String(r[4]).trim() === itemId &&
        String(r[8]).indexOf(noteKey) >= 0;
    });
  } catch (e) {
    Logger.log('[isAlreadyNotified_] 오류: ' + e.toString());
    return false;
  }
}

// ------------------------------------------------------------------------------------------------
// [PHASE 2-2] 자동 만료 트리거 등록
// ------------------------------------------------------------------------------------------------

/**
 * autoExpireRecommended 매시간 트리거를 등록합니다.
 * GAS 에디터에서 1회 실행하세요.
 */
function setupAutoExpireTrigger() {
  // 기존 동명 트리거 삭제 (중복 방지)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoExpireRecommended') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoExpireRecommended').timeBased().everyHours(1).create();
  Logger.log('autoExpireRecommended 매시간 트리거 등록 완료');
}

// ------------------------------------------------------------------------------------------------
// [PHASE 3-2] 입찰일 D-3/D-2/D-1 알림
// ------------------------------------------------------------------------------------------------

/**
 * 입찰일 D-3/D-2/D-1 알림 (매일 BID_NOTIFY_HOUR 시에 트리거로 실행)
 * stu_member='입찰' 물건 대상, in-date 기준 D-3/D-2/D-1 해당 시 이력 기록
 */
function sendBidDateReminders() {
  if (getSetting_('BID_NOTIFY_ENABLED', 'true') !== 'true') return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    const tz = Session.getScriptTimeZone();
    const today = new Date();
    const d3 = new Date(today); d3.setDate(d3.getDate() + 3);
    const d2 = new Date(today); d2.setDate(d2.getDate() + 2);
    const d1 = new Date(today); d1.setDate(d1.getDate() + 1);

    const d3str = Utilities.formatDate(d3, tz, 'yyMMdd');
    const d2str = Utilities.formatDate(d2, tz, 'yyMMdd');
    const d1str = Utilities.formatDate(d1, tz, 'yyMMdd');

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();

    data.forEach(function (row) {
      const itemId = String(row[0] || '').trim();
      const inDate = String(row[1] || '').trim();   // B열: in-date (yyMMdd)
      const stuMember = String(row[4] || '').trim();   // E열
      const mName = String(row[6] || '').trim();   // G열
      const memberId = String(row[8] || '').trim();   // I열

      if (stuMember !== '입찰') return;
      if (!memberId || !inDate) return;

      if (getSetting_('BID_NOTIFY_D3', 'true') === 'true' && inDate === d3str) {
        if (!isAlreadyNotified_(itemId, 'BID_DATE_NOTIFY', 'D-3')) {
          writeItemHistory_({
            action: 'BID_DATE_NOTIFY', item_id: itemId,
            member_id: memberId, member_name: mName, trigger_type: 'system', note: 'D-3'
          });
          sendBidDateNotification_(memberId, itemId, 'D-3');
        }
      }
      if (getSetting_('BID_NOTIFY_D2', 'true') === 'true' && inDate === d2str) {
        if (!isAlreadyNotified_(itemId, 'BID_DATE_NOTIFY', 'D-2')) {
          writeItemHistory_({
            action: 'BID_DATE_NOTIFY', item_id: itemId,
            member_id: memberId, member_name: mName, trigger_type: 'system', note: 'D-2'
          });
          sendBidDateNotification_(memberId, itemId, 'D-2');
        }
      }
      if (getSetting_('BID_NOTIFY_D1', 'true') === 'true' && inDate === d1str) {
        if (!isAlreadyNotified_(itemId, 'BID_DATE_NOTIFY', 'D-1')) {
          writeItemHistory_({
            action: 'BID_DATE_NOTIFY', item_id: itemId,
            member_id: memberId, member_name: mName, trigger_type: 'system', note: 'D-1'
          });
          sendBidDateNotification_(memberId, itemId, 'D-1');
        }
      }
    });

  } catch (e) {
    Logger.log('[sendBidDateReminders] 오류: ' + e.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * sendBidDateReminders 매일 트리거 등록
 * GAS 에디터에서 1회 실행하세요.
 */
function setupBidDateTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendBidDateReminders') ScriptApp.deleteTrigger(t);
  });
  const hour = parseInt(getSetting_('BID_NOTIFY_HOUR', '10'), 10) || 10;
  ScriptApp.newTrigger('sendBidDateReminders').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('sendBidDateReminders 매일 ' + hour + '시 트리거 등록 완료');
}

// ------------------------------------------------------------------------------------------------
// [PHASE 3-3] 취소건 조회 서버 함수
// ------------------------------------------------------------------------------------------------

/**
 * 회원별 취소 이력 조회
 * @param {string} memberId - 회원 ID (빈 문자열이면 전체)
 * @param {number} [limit=100]
 * @returns {Array<Object>}
 */
/**
 * 회원의 전체 물건 이력(추천, 입찰, 취소, 변경) 조회 및 월별 요약 통계 생성
 * @param {string} memberId - 회원 ID
 * @param {number} months - 조회 기간 (월 단위, 기본 12)
 * @returns {Object} { summary: Array, list: Array }
 */
function getMemberItemHistory(memberId, months) {
  const CATEGORIES = {
    CHUCHEN: '추천',
    BID: '입찰',
    CANCEL: '취소',
    CHANGE: '취소'
  };

  const CANCEL_ACTIONS = ['AUTO_EXPIRE', 'REQUEST_CANCEL_CHUCHEN', 'REQUEST_CANCEL_BID', 'CANCEL_BID'];
  const BID_ACTIONS = ['REQUEST_BID', 'BID', 'REQUEST_BID_CONFIRM'];
  const CHUCHEN_ACTIONS = ['CHUCHEN', 'SEND_CHUCHEN'];

  const periodMonths = parseInt(months, 10) || 12;
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - periodMonths, now.getDate());

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
    if (!reqSheet || reqSheet.getLastRow() < 2) return { summary: [], list: [] };

    const lastRow = reqSheet.getLastRow();
    let rowNumbers = [];

    // 1. Member ID로 행 번호 추출 (createTextFinder)
    if (memberId) {
      const finder = reqSheet.getRange(2, 6, lastRow - 1, 1).createTextFinder(String(memberId)).matchEntireCell(true);
      const matches = finder.findAll();
      if (!matches || matches.length === 0) return { summary: [], list: [] };
      rowNumbers = matches.map(m => m.getRow());
    } else {
      return { summary: [], list: [] }; // 관리자 전체 조회 등은 별도 로직 필요
    }

    // 2. 데이터 일괄 읽기 (Batch Read Optimization)
    const minRow = Math.min(...rowNumbers);
    const maxRow = Math.max(...rowNumbers);
    const totalScanRows = maxRow - minRow + 1;
    const chunkData = reqSheet.getRange(minRow, 1, totalScanRows, 16).getValues();
    const startOffset = minRow;

    // 3. 물건 정보 캐싱 (items 시트)
    const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
    const itemMap = {};
    if (itemSheet && itemSheet.getLastRow() >= 2) {
      const iData = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, 18).getValues();
      iData.forEach(r => {
        const id = String(r[0] || '').trim();
        if (id) itemMap[id] = {
          inDate: String(r[1] || ''),
          sakunNo: String(r[2] || ''),
          court: String(r[3] || '')
        };
      });
    }

    const list = [];
    const monthlyStats = {}; // { '26-03': { 추천: 0, 입찰: 0, 취소: 0, 변경: 1 } }
    const seenActionPerItem = {}; // { itemId_category: true } - 중복 기록 방지

    // 4. 데이터 분류 및 집계
    for (let i = rowNumbers.length - 1; i >= 0; i--) {
      const rowNum = rowNumbers[i];
      const rowData = chunkData[rowNum - startOffset];
      if (!rowData) continue;

      const requestedAt = rowData[1] instanceof Date ? rowData[1] : new Date(rowData[1]);
      if (isNaN(requestedAt.getTime())) continue;
      
      // 기간 필터링
      if (periodMonths !== 999 && requestedAt < startDate) continue;

      const action = String(rowData[2] || '').trim();
      const fieldName = String(rowData[13] || '').trim();
      const toValue = String(rowData[12] || '').trim();
      const itemId = String(rowData[4] || '').trim();

      let category = '';
      if (CANCEL_ACTIONS.indexOf(action) !== -1 || (fieldName === 'stu_member' && toValue === '미정')) category = CATEGORIES.CANCEL;
      else if (fieldName === 'stu_member' && (toValue === '취소' || toValue === '폐기' || toValue === '변경')) category = CATEGORIES.CHANGE;
      else if (BID_ACTIONS.indexOf(action) !== -1) category = CATEGORIES.BID;
      else if (CHUCHEN_ACTIONS.indexOf(action) !== -1 || (fieldName === 'stu_member' && toValue && toValue !== '미정' && toValue !== '취소' && toValue !== '폐기' && toValue !== '변경')) category = CATEGORIES.CHUCHEN;

      if (!category) continue;

      // 동일 물건+동일 카테고리 중복 방지 (최신 1건만)
      const seenKey = itemId + '_' + category;
      if (itemId && seenActionPerItem[seenKey]) continue;
      if (itemId) seenActionPerItem[seenKey] = true;

      // 월별 통계 집계 (YY-MM)
      const yy = String(requestedAt.getFullYear()).slice(2, 4);
      const mm = String(requestedAt.getMonth() + 1).padStart(2, '0');
      const monthKey = yy + '-' + mm;

      if (!monthlyStats[monthKey]) monthlyStats[monthKey] = { month: monthKey, 추천: 0, 입찰: 0, 취소: 0, 변경: 0, total: 0 };
      monthlyStats[monthKey][category]++;
      monthlyStats[monthKey].total++;

      const item = itemMap[itemId] || {};
      list.push({
        req_id: String(rowData[0] || ''),
        date: Utilities.formatDate(requestedAt, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
        category: category,
        item_id: itemId,
        sakun_no: item.sakunNo || '',
        court: item.court || '',
        in_date: item.inDate || ''
      });
    }

    // 요약 집계 정렬 (최신월순)
    const summary = Object.keys(monthlyStats).sort((a, b) => b.localeCompare(a)).map(k => monthlyStats[k]);

    return { summary: summary, list: list };
  } catch (e) {
    Logger.log('[getMemberItemHistory] 오류: ' + e.toString());
    return { summary: [], list: [] };
  }
}


/**
 * 회원 토큰으로 물건 이력조회 (최근 n개월)
 * @param {string} token - 회원 member_token
 * @param {number} months - 조회 기간 (기본 12)
 * @returns {Object} { summary, list }
 */
function getMemberItemHistoryByToken(token, months) {
  try {
    const member = (typeof getMemberByToken === 'function') ? getMemberByToken(token) : null;
    if (!member || !member.id) return { summary: [], list: [] };
    return getMemberItemHistory(String(member.id), months);
  } catch (e) {
    Logger.log('[getMemberItemHistoryByToken] 오류: ' + e.toString());
    return { summary: [], list: [] };
  }
}

// ------------------------------------------------------------------------------------------------
// [PHASE 4-1/4-2] 메시지 템플릿 시스템
// ------------------------------------------------------------------------------------------------

const MSG_TEMPLATES_SHEET_NAME = 'msg_templates';

/**
 * msg_templates 시트 초기화 (없으면 생성 + 기본 메시지 입력)
 */
function ensureMsgTemplatesSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(MSG_TEMPLATES_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(MSG_TEMPLATES_SHEET_NAME);

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 7).setValues([
      ['msg_key', 'category', 'description', 'template', 'variables', 'updated_at', 'updated_by']
    ]);
    const defaults = [
      ['item_card.card', 'item_card', '추천 물건 카드 인사말',
        'MJ 경매 스쿨입니다. 추천 물건드립니다.', '', '', ''],
      ['item_card.check_request', 'item_card', '입찰 여부 회신 요청',
        'MJ 경매 스쿨입니다. 입찰 여부 회신 요청드립니다.', '', '', ''],
      ['item_card.status', 'item_card', '입찰불가 안내',
        'MJ 경매 스쿨입니다. 입찰불가 안내 드립니다.\n해당 물건은 입찰이 취소 되었습니다.', '', '', ''],
      ['item_card.warning', 'item_card', '대출 주의 안내',
        '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!', '', '', ''],
      ['item_card.staff_1', 'item_card', '담당자 안내1',
        '1. 입찰가 관리: 이정우: (010-4238-7781)', '', '', ''],
      ['item_card.staff_2', 'item_card', '담당자 안내2',
        '2. 단기투자클럽 관리: 이경미님 (010-3448-8035)', '', '', ''],
      ['notify.expiry_24h', 'notify', '추천 24h 경과 알림',
        '{{member_name}}님, 추천드린 [{{sakun_no}}] 물건 전달 후 24시간이 경과했습니다.\n입찰확정/취소를 선택해 주세요.', 'member_name,sakun_no', '', ''],
      ['notify.expiry_1h', 'notify', '추천 만료 1시간 전 알림',
        '{{member_name}}님, [{{sakun_no}}] 추천 물건이 1시간 후 자동 만료됩니다.\n지금 확정해 주세요!', 'member_name,sakun_no', '', ''],
      ['notify.expiry_done', 'notify', '추천 만료 알림',
        '{{member_name}}님, [{{sakun_no}}] 추천 물건이 만료되어 미정 처리되었습니다.', 'member_name,sakun_no', '', ''],
      ['notify.bid_d3', 'notify', '입찰 D-3 알림',
        '{{member_name}}님, [{{sakun_no}}] 입찰일이 3일 후입니다. ({{in_date}})', 'member_name,sakun_no,in_date', '', ''],
      ['notify.bid_d2', 'notify', '입찰 D-2 알림',
        '{{member_name}}님, [{{sakun_no}}] 입찰일이 2일 후입니다. ({{in_date}})', 'member_name,sakun_no,in_date', '', ''],
      ['notify.bid_d1', 'notify', '입찰 D-1 알림',
        '{{member_name}}님, [{{sakun_no}}] 내일이 입찰일입니다. ({{in_date}}) 준비 잘 되셨나요?', 'member_name,sakun_no,in_date', '', ''],
    ];
    sheet.getRange(2, 1, defaults.length, 7).setValues(defaults);
    SpreadsheetApp.flush();
  }
  return sheet;
}

/**
 * 메시지 템플릿 조회 + 변수 치환
 * @param {string} key       - msg_key
 * @param {Object} [vars={}] - 치환 변수 (예: {member_name:'홍길동', sakun_no:'2024타경1234'})
 * @returns {string}
 */
function getMessageTemplate_(key, vars) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(MSG_TEMPLATES_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return '';
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues(); // A~D열
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        return replaceVars_(String(data[i][3] || ''), vars || {});
      }
    }
    return '';
  } catch (e) {
    Logger.log('[getMessageTemplate_] 오류: ' + e.toString());
    return '';
  }
}

/**
 * {{변수명}} 치환 헬퍼
 */
function replaceVars_(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, function (_, name) {
    return vars[name] !== undefined ? String(vars[name]) : '';
  });
}

/**
 * 메시지 템플릿 저장/업데이트 (설정 화면에서 호출)
 * @param {string} key      - msg_key
 * @param {string} template - 새 템플릿
 * @returns {{ success: boolean, message?: string }}
 */
function saveMsgTemplate(key, template) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(MSG_TEMPLATES_SHEET_NAME);
    if (!sheet) return { success: false, message: 'msg_templates 시트 없음' };
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (String(keys[i][0]).trim() === key) {
          sheet.getRange(i + 2, 4).setValue(template);  // D: template
          sheet.getRange(i + 2, 6).setValue(now);        // F: updated_at
          sheet.getRange(i + 2, 7).setValue('admin');    // G: updated_by
          SpreadsheetApp.flush();
          return { success: true };
        }
      }
    }
    return { success: false, message: '키를 찾을 수 없습니다: ' + key };
  } catch (e) {
    Logger.log('[saveMsgTemplate] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

// ─── 클라이언트 공개 API (google.script.run 용) ─────────────────────────────

// ------------------------------------------------------------------------------------------------
// [PHASE 1-3] 물건 히스토리 조회 (상세 화면 히스토리 탭)
// ------------------------------------------------------------------------------------------------

/**
 * 특정 물건의 이력을 telegram_requests 시트에서 조회합니다.
 * @param {string} itemId - 물건 ID
 * @param {number} [limit=200] - 최대 행 수
 * @returns {Array<Object>} 이력 목록 (오래된 순)
 */
function getItemHistory(itemId, limit) {
  const maxRows = parseInt(limit, 10) || 200;
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const lastRow = sheet.getLastRow();
    
    // [최적화 Phase 4] 최근 기록 우선 검색
    // 로그가 수만 건일 경우 findAll() 자체가 느릴 수 있으므로 최근 5000행만 먼저 검색
    const searchDepth = 5000;
    const startRow = Math.max(2, lastRow - searchDepth);
    const numRows = lastRow - startRow + 1;
    
    let finder = sheet.getRange(startRow, 5, numRows, 1).createTextFinder(String(itemId)).matchEntireCell(true);
    let matches = finder.findAll();
    
    // 최근 5000행에 결과가 없거나 부족한 경우 (극히 드묾) 전체 검색으로 전환
    if (!matches || matches.length === 0) {
      finder = sheet.getRange(2, 5, lastRow - 1, 1).createTextFinder(String(itemId)).matchEntireCell(true);
      matches = finder.findAll();
    }
    
    if (!matches || matches.length === 0) return [];

    const rowNumbers = matches.map(m => m.getRow()).sort((a, b) => b - a).slice(0, maxRows);
    
    const minRow = Math.min(...rowNumbers);
    const maxRow = Math.max(...rowNumbers);
    const dataRange = sheet.getRange(minRow, 1, maxRow - minRow + 1, 16).getValues();
    const minRowIdx = minRow;

    const result = [];
    rowNumbers.forEach(rowNum => {
      const rowData = dataRange[rowNum - minRowIdx];
      if (!rowData) return;
      
      result.push({
        req_id: String(rowData[0] || ''),
        requested_at: String(rowData[1] || ''),
        action: String(rowData[2] || ''),
        status: String(rowData[3] || ''),
        item_id: String(rowData[4] || ''),
        member_id: String(rowData[5] || ''),
        note: String(rowData[8] || ''),
        from_value: String(rowData[11] || ''),
        to_value: String(rowData[12] || ''),
        field_name: String(rowData[13] || ''),
        trigger_type: String(rowData[14] || ''),
        member_name: String(rowData[15] || '')
      });
    });

    return result.reverse();
  } catch (e) {
    Logger.log('[getItemHistory] 오류: ' + e.toString());
    return [];
  }
}


/**
 * 알림 설정값 전체 반환 (프론트 환경설정 탭 로드용)
 */
function getNotifySettings() {
  const keys = ['BID_NOTIFY_ENABLED', 'BID_NOTIFY_D3', 'BID_NOTIFY_D2', 'BID_NOTIFY_D1',
    'BID_NOTIFY_HOUR', 'AUTO_EXPIRE_ENABLED',
    'EXPIRY_NOTIFY_24H', 'EXPIRY_NOTIFY_1H', 'EXPIRY_NOTIFY_DONE'];
  const result = {};
  keys.forEach(function (k) { result[k] = getSetting_(k, 'true'); });
  result['BID_NOTIFY_HOUR'] = getSetting_('BID_NOTIFY_HOUR', '10');
  return result;
}

/**
 * 설정 저장 공개 API (프론트에서 saveSetting_ 직접 호출 불가 → 래퍼)
 */
function saveSettingPublic(key, value) {
  saveSetting_(key, value);
  return { success: true };
}

/**
 * chat_id 수취 시 telegram_enabled 자동승인 설정 조회
 */
function getTelegramChatIdAutoApprove() {
  return getSetting_('TELEGRAM_CHATID_AUTO_APPROVE', 'false') === 'true';
}

/**
 * chat_id 수취 시 telegram_enabled 자동승인 설정 저장
 */
function setTelegramChatIdAutoApprove(isOn) {
  saveSetting_('TELEGRAM_CHATID_AUTO_APPROVE', isOn ? 'true' : 'false');
  return { success: true };
}

/**
 * 환경설정 모든 설정 한 번에 반환 (초기 로딩 속도 개선용)
 */
function getAllPrefSettings() {
  const notifyKeys = ['BID_NOTIFY_ENABLED', 'BID_NOTIFY_D3', 'BID_NOTIFY_D2', 'BID_NOTIFY_D1',
    'BID_NOTIFY_HOUR', 'AUTO_EXPIRE_ENABLED', 'EXPIRY_NOTIFY_24H', 'EXPIRY_NOTIFY_1H', 'EXPIRY_NOTIFY_DONE'];
  const result = { notify: {}, autoApprove: false, autoSync: false, chatIdAutoApprove: false };
  notifyKeys.forEach(function (k) { result.notify[k] = getSetting_(k, 'true'); });
  result.notify['BID_NOTIFY_HOUR'] = getSetting_('BID_NOTIFY_HOUR', '10');
  try { result.autoApprove = getAutoApproveSetting(); } catch (e) { }
  try { result.autoSync = getAutoSyncSetting(); } catch (e) { }
  result.chatIdAutoApprove = getSetting_('TELEGRAM_CHATID_AUTO_APPROVE', 'false') === 'true';
  return result;
}

/**
 * msg_templates 전체 반환 (메시지 편집 팝업용)
 * @returns {Array<Object>} {msg_key, category, description, template, variables}
 */
function getAllMsgTemplates() {
  try {
    migrateMsgTemplatesNewKeys_(); // [MSG EDITOR V2] 빠진 키 자동 추가
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(MSG_TEMPLATES_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues(); // A~E열
    return data.map(function (r) {
      return {
        msg_key: String(r[0] || ''),
        category: String(r[1] || ''),
        description: String(r[2] || ''),
        template: String(r[3] || ''),
        variables: String(r[4] || '')
      };
    }).filter(function (r) { return r.msg_key; });
  } catch (e) {
    Logger.log('[getAllMsgTemplates] 오류: ' + e.toString());
    return [];
  }
}

/**
 * 메시지 템플릿 초기화 (기본값으로 복원)
 * - ensureMsgTemplatesSheet_의 defaults 배열 기준으로 복원
 */
function resetMsgTemplate(key) {
  // defaults 맵 (ensureMsgTemplatesSheet_ 와 동기화 유지)
  const DEFAULTS = {
    'item_card.card': 'MJ 경매 스쿨입니다. 추천 물건드립니다.',
    'item_card.check_request': 'MJ 경매 스쿨입니다. 입찰 여부 회신 요청드립니다.',
    'item_card.status': 'MJ 경매 스쿨입니다. 입찰불가 안내 드립니다.\n해당 물건은 입찰이 취소 되었습니다.',
    'item_card.warning': '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!',
    'item_card.staff_1': '1. 입찰가 관리: 이정우: (010-4238-7781)',
    'item_card.staff_2': '2. 단기투자클럽 관리: 이경미님 (010-3448-8035)',
    'notify.expiry_24h': '{{member_name}}님, 추천드린 [{{sakun_no}}] 물건 전달 후 24시간이 경과했습니다.\n입찰확정/취소를 선택해 주세요.',
    'notify.expiry_1h': '{{member_name}}님, [{{sakun_no}}] 추천 물건이 1시간 후 자동 만료됩니다.\n지금 확정해 주세요!',
    'notify.expiry_done': '{{member_name}}님, [{{sakun_no}}] 추천 물건이 만료되어 미정 처리되었습니다.',
    'notify.bid_d3': '{{member_name}}님, [{{sakun_no}}] 입찰일이 3일 후입니다. ({{in_date}})',
    'notify.bid_d2': '{{member_name}}님, [{{sakun_no}}] 입찰일이 2일 후입니다. ({{in_date}})',
    'notify.bid_d1': '{{member_name}}님, [{{sakun_no}}] 내일이 입찰일입니다. ({{in_date}}) 준비 잘 되셨나요?',
    // [MSG EDITOR V2] 새로운 메세지 키
    'member.bid_confirm_ask': '입찰확정 하시겠습니까?',
    'member.bid_confirm_invalid': '⚠️ 현재 물건상태 변경이 불가능 합니다.\n(현재 상태: {{status}})',
    'sys.bid_confirmed': '입찰확정 완료되었습니다.',
    'member.bid_cancel_ask': '입찰취소 하시겠습니까?',
    'member.bid_cancel_invalid': '⚠️ 현재 물건상태 변경이 불가능 합니다.\n(현재 상태: {{status}})',
    'sys.bid_cancelled': '입찰취소 완료되었습니다.',
    'member.bid_price_view': '입찰가가 도착했습니다. 확인하시겠습니까?',
    // [하단 메세지 개별 관리] 각 maps_card 타입별 독립 하단 메세지
    'item_card.card.bottom': '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)',
    'item_card.check_request.bottom': '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)',
    'item_card.status.bottom': '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)'
  };
  const defVal = DEFAULTS[key];
  if (!defVal) return { success: false, message: '기본값 없음: ' + key };
  return saveMsgTemplate(key, defVal);
}

// ------------------------------------------------------------------------------------------------
// [MSG EDITOR V2] 새 메세지 키 마이그레이션 + 배치 저장 + 버튼 설정
// ------------------------------------------------------------------------------------------------

/**
 * 기존 msg_templates 시트에 빠진 키가 있으면 자동 추가 (멱등 마이그레이션)
 */
function migrateMsgTemplatesNewKeys_() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(MSG_TEMPLATES_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 1) return;
    const lastRow = sheet.getLastRow();
    const existingKeys = lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); })
      : [];
    const newDefaults = [
      ['member.bid_confirm_ask', 'member', '입찰확정 요청', '입찰확정 하시겠습니까?', '', '', ''],
      ['member.bid_confirm_invalid', 'member', '입찰확정 불가', '⚠️ 현재 물건상태 변경이 불가능 합니다.\n(현재 상태: {{status}})', 'status', '', ''],
      ['sys.bid_confirmed', 'sys', '입찰확정 완료 자동 메시지', '입찰확정 완료되었습니다.', '', '', ''],
      ['member.bid_cancel_ask', 'member', '입찰취소 요청', '입찰취소 하시겠습니까?', '', '', ''],
      ['member.bid_cancel_invalid', 'member', '입찰취소 불가', '⚠️ 현재 물건상태 변경이 불가능 합니다.\n(현재 상태: {{status}})', 'status', '', ''],
      ['sys.bid_cancelled', 'sys', '입찰취소 완료 자동 메시지', '입찰취소 완료되었습니다.', '', '', ''],
      ['member.bid_price_view', 'member', '입찰가 확인', '입찰가가 도착했습니다. 확인하시겠습니까?', '', '', ''],
      ['item_card.card.bottom', 'item_card', '추천물건 하단 메세지', '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)', '', '', ''],
      ['item_card.check_request.bottom', 'item_card', '입찰가전달 하단 메세지', '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)', '', '', ''],
      ['item_card.status.bottom', 'item_card', '입찰불가 하단 메세지', '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!\n1. 입찰가 관리: 이정우: (010-4238-7781)\n2. 단기투자클럽 관리: 이경미님 (010-3448-8035)', '', '', '']
    ];
    let added = 0;
    newDefaults.forEach(function (row) {
      if (!existingKeys.includes(row[0])) {
        sheet.appendRow(row);
        added++;
      }
    });
    if (added > 0) SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('[migrateMsgTemplatesNewKeys_] 오류: ' + e.toString());
  }
}

/**
 * 여러 메시지 템플릿 일괄 저장 (maps_card 편집 시 여러 키 동시 저장)
 * @param {Array<{key:string, template:string}>} pairs
 */
function saveMsgTemplatesBatch(pairs) {
  try {
    if (!Array.isArray(pairs) || pairs.length === 0) return { success: false, message: '저장할 항목이 없습니다.' };
    var saved = 0;
    for (var i = 0; i < pairs.length; i++) {
      var r = saveMsgTemplate(pairs[i].key, pairs[i].template);
      if (!r || !r.success) return { success: false, message: pairs[i].key + ': ' + (r && r.message || '저장 실패') };
      saved++;
    }
    return { success: true, saved: saved };
  } catch (e) {
    Logger.log('[saveMsgTemplatesBatch] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

// ─── 카카오 템플릿 CRUD ───────────────────────────────────────────────────────
function _ensureKakaoSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KAKAO_TEMPLATES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KAKAO_TEMPLATES_SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([['id', 'name', 'content', 'type', 'member_id']]);
    sheet.getRange(2, 1, 2, 5).setValues([
      ['check', '추천물건안내', '안녕하세요?\n엠제이경매스쿨입니다.\n\n추천물건 전달드립니다.\n입찰 여부 회신 부탁드려요~ (48시간 이후 자동취소)\n\n====================================\n회 원 명:    {{이름}}\n입찰일자:   {{입찰일자}}\n사건번호:   {{사건번호}}\n법     원:   {{법원}}\n====================================\n[물건전달사항]\n{{물건전달사항}}', 'public', ''],
      ['guide', '입찰가 안내', '안녕하세요?\n엠제이경매스쿨입니다.\n\n입찰가 전달드립니다. 회원님의 낙찰을 기원드립니다!\n\n====================================\n회 원 명:    {{이름}}\n입찰일자:   {{입찰일자}}\n사건번호:   {{사건번호}}\n법     원:   {{법원}}\n====================================\n입 찰 가:    {{입찰가}}원\n====================================', 'public', '']
    ]);
    SpreadsheetApp.flush();
  }
  return sheet;
}

function getAllKakaoTemplates() {
  try {
    const sheet = _ensureKakaoSheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues()
      .filter(r => r[0])
      .map(r => ({ id: String(r[0]), name: String(r[1]), content: String(r[2]), type: String(r[3]), member_id: String(r[4]) }));
  } catch (e) {
    Logger.log('[getAllKakaoTemplates] ' + e);
    return [];
  }
}

function saveKakaoTemplate(obj) {
  try {
    const sheet = _ensureKakaoSheet_();
    if (!obj.id) obj.id = 'kt_' + new Date().getTime();
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
    let rowIdx = -1;
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]) === String(obj.id)) { rowIdx = i + 2; break; } }
    const row = [obj.id, obj.name, obj.content, obj.type, obj.type === 'individual' ? (obj.member_id || '') : ''];
    if (rowIdx > -1) sheet.getRange(rowIdx, 1, 1, 5).setValues([row]);
    else sheet.appendRow(row);
    return { success: true, id: obj.id };
  } catch (e) { return { success: false, message: e.toString() }; }
}

function deleteKakaoTemplate(id) {
  try {
    const sheet = _ensureKakaoSheet_();
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) { sheet.deleteRow(i + 2); return { success: true }; }
    }
    return { success: false, message: 'not found' };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * 캘린더 색상 규칙 저장 (settings 시트에 CAL_COLOR_RULES 키로 저장)
 * @param {string} json - JSON 배열 문자열
 */
function saveCalColorRules(json) {
  try {
    saveSetting_('CAL_COLOR_RULES', json);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 캘린더 색상 규칙 로드 (settings 시트에서 CAL_COLOR_RULES 읽기)
 * @returns {Array|null}
 */
function getCalColorRules() {
  try {
    const val = getSetting_('CAL_COLOR_RULES', '');
    if (!val) return null;
    return JSON.parse(val);
  } catch (e) {
    return null;
  }
}

/**
 * 버튼 설정 저장 (settings 시트에 BTN_CFG.{msgKey} 키로 저장)
 * @param {string} msgKey
 * @param {string} btnsJson  - JSON 배열 문자열
 */
function saveBtnConfig(msgKey, btnsJson) {
  try {
    saveSetting_('BTN_CFG.' + msgKey, btnsJson);
    return { success: true };
  } catch (e) {
    Logger.log('[saveBtnConfig] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * 버튼 설정 전체 반환 (BTN_CFG.* 키만 추출)
 * @returns {Object}  key → parsed array
 */
function getAllBtnConfigs() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return {};
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    const result = {};
    data.forEach(function (row) {
      const k = String(row[0] || '');
      if (k.indexOf('BTN_CFG.') === 0) {
        const msgKey = k.slice('BTN_CFG.'.length);
        try { result[msgKey] = JSON.parse(String(row[1] || '')); } catch (e) { }
      }
    });
    return result;
  } catch (e) {
    Logger.log('[getAllBtnConfigs] 오류: ' + e.toString());
    return {};
  }
}

/**
 * 특정 메시지 키의 버튼 설정 반환 (TelegramService 내부 호출용)
 * @param {string} msgKey
 * @returns {Array|null}
 */
function getMsgBtnConfig_(msgKey) {
  try {
    const val = getSetting_('BTN_CFG.' + msgKey, '');
    if (!val) return null;
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * 표시명 맵 저장 (settings 시트 DISPLAY_NAME_MAP 키에 JSON 저장)
 * @param {string} mapJson  예: '{"대표님":"MJ","전제혁":"전부쌤"}'
 */
function saveDisplayNameMap(mapJson) {
  try {
    saveSetting_('DISPLAY_NAME_MAP', mapJson);
    return { success: true };
  } catch (e) {
    Logger.log('[saveDisplayNameMap] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * 표시명 맵 전체 반환 (프론트 관리 UI용)
 * @returns {Object}  예: {"대표님":"MJ","전제혁":"전부쌤"}
 */
function getDisplayNameMap() {
  try {
    const val = getSetting_('DISPLAY_NAME_MAP', '');
    if (!val) return { '대표님': 'MJ' };  // 기본값
    const parsed = JSON.parse(val);
    return (typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/**
 * [관리자용 일회성 데이터 정리]
 * items.m_name_id에 본명("전제혁")으로 저장된 옛 데이터를 닉네임("전부쌤")으로 일괄 변환
 *
 * 사용:
 *   migrateItemsMNameIdToNickname(true)   // dry-run: 변경 카운트만 보고
 *   migrateItemsMNameIdToNickname(false)  // 실제 적용
 *
 * 매칭 규칙:
 *   - members 강사 중 teacher_nickname이 비어있지 않은 회원만 대상
 *   - items.m_name_id === member_name 매칭 시 → teacher_nickname으로 갱신
 *   - 이미 닉네임으로 저장된 행은 건드리지 않음
 *   - 강사가 아니거나 닉네임 없는 회원의 본명은 그대로 유지
 *
 * 트리거 우회: setValues 직접 호출 (이력 시트 트리거 안 거침)
 *
 * @param {boolean} dryRun
 * @returns {{success, dryRun, totalRows, changed, samples, message?}}
 */
function migrateItemsMNameIdToNickname(dryRun) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음' };
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, dryRun: !!dryRun, totalRows: 0, changed: 0, samples: [] };

    const mNameIdCol = ITEM_HEADERS.indexOf('m_name_id') + 1; // F=6
    const range = sheet.getRange(2, mNameIdCol, lastRow - 1, 1);
    const values = range.getValues();

    // members 시트에서 강사 본명→닉네임 매핑 build
    const mSheet = ss.getSheetByName(DB_MEMBERS_SHEET_NAME);
    if (!mSheet) return { success: false, message: 'members 시트 없음' };
    const mLastRow = mSheet.getLastRow();
    if (mLastRow < 2) return { success: true, dryRun: !!dryRun, totalRows: values.length, changed: 0, samples: [] };
    const colsToRead = Math.min(mSheet.getMaxColumns(), ITEM_MEMBER_HEADERS.length);
    const mData = mSheet.getRange(2, 1, mLastRow - 1, colsToRead).getValues();
    const gubunIdx = ITEM_MEMBER_HEADERS.indexOf('gubun');
    const nameIdx = ITEM_MEMBER_HEADERS.indexOf('member_name');
    const nickIdx = ITEM_MEMBER_HEADERS.indexOf('teacher_nickname');

    const nameToNickname = {};
    mData.forEach(row => {
      const gubun = String(row[gubunIdx] || '');
      if (!gubun.split(',').map(s => s.trim()).includes('강사')) return;
      const name = String(row[nameIdx] || '').trim();
      const nick = (nickIdx >= 0 && nickIdx < row.length) ? String(row[nickIdx] || '').trim() : '';
      if (!name || !nick) return; // 닉네임 없는 강사는 변환 대상 아님
      if (name === nick) return; // 본명 == 닉네임이면 변환 의미 없음
      if (!(name in nameToNickname)) nameToNickname[name] = nick;
    });

    let changed = 0;
    const samples = [];
    const newValues = values.map(([v]) => {
      const t = String(v || '').trim();
      if (!t) return [v];
      const newVal = nameToNickname[t];
      if (newVal && newVal !== t) {
        if (samples.length < 10) samples.push({ from: t, to: newVal });
        changed++;
        return [newVal];
      }
      return [v];
    });

    if (!dryRun && changed > 0) {
      range.setValues(newValues);
      SpreadsheetApp.flush();
    }

    Logger.log('[migrateItemsMNameIdToNickname] dryRun=' + !!dryRun + ' totalRows=' + values.length + ' changed=' + changed);
    return {
      success: true,
      dryRun: !!dryRun,
      totalRows: values.length,
      changed,
      mappingCount: Object.keys(nameToNickname).length,
      mapping: nameToNickname,
      samples
    };
  } catch (e) {
    Logger.log('[migrateItemsMNameIdToNickname] 오류: ' + e.message);
    return { success: false, message: e.message };
  }
}

/**
 * members 시트에서 강사 표시명 매핑 build (서버측 룩업)
 * 닉네임/본명 둘 다 키로 사용 → 닉네임 표시값 반환
 * @returns {Object} { '대표님': '대표님', '전제혁': '전부쌤', ... }
 */
function buildTeacherDisplayMap_() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
    if (!sheet) return {};
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    const colsToRead = Math.min(sheet.getMaxColumns(), ITEM_MEMBER_HEADERS.length);
    const data = sheet.getRange(2, 1, lastRow - 1, colsToRead).getValues();
    const gubunCol = ITEM_MEMBER_HEADERS.indexOf('gubun');
    const nameCol = ITEM_MEMBER_HEADERS.indexOf('member_name');
    const nickCol = ITEM_MEMBER_HEADERS.indexOf('teacher_nickname');
    const map = {};
    data.forEach(row => {
      const gubun = String(row[gubunCol] || '');
      const isTeacher = gubun.split(',').map(s => s.trim()).includes('강사');
      if (!isTeacher) return;
      const name = String(row[nameCol] || '').trim();
      const nick = (nickCol >= 0 && nickCol < row.length) ? String(row[nickCol] || '').trim() : '';
      const display = nick || name;
      if (!display) return;
      if (nick) map[nick] = display;
      if (name && !(name in map)) map[name] = display;
    });
    return map;
  } catch (e) {
    Logger.log('[buildTeacherDisplayMap_] 오류: ' + e.message);
    return {};
  }
}

/**
 * 이름 하나를 표시명으로 변환 (TelegramService 내부 호출용)
 * 우선순위: (1) members 강사 닉네임 매핑 → (2) settings 옛 매핑 폴백 → (3) 원본
 * @param {string} name
 * @returns {string}
 */
function getDisplayName_(name) {
  try {
    if (!name) return name;
    const trimmed = String(name).trim();
    // (1) members 강사 닉네임 우선
    const teacherMap = buildTeacherDisplayMap_();
    if (teacherMap[trimmed]) return teacherMap[trimmed];
    // (2) 옛 settings 매핑 폴백 (하위 호환)
    const map = getDisplayNameMap();
    return (map && map[trimmed]) ? map[trimmed] : name;
  } catch (e) {
    return name;
  }
}

/**
 * 데이터 필드 표시 설정 저장 (settings 시트에 DATA_CFG.{msgKey} 키로 저장)
 * @param {string} msgKey
 * @param {string} configJson  예: '{"status":true,"in_date":false,...}'
 */
function saveDataConfig(msgKey, configJson) {
  try {
    saveSetting_('DATA_CFG.' + msgKey, configJson);
    return { success: true };
  } catch (e) {
    Logger.log('[saveDataConfig] 오류: ' + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * 데이터 필드 표시 설정 전체 반환 (DATA_CFG.* 키만)
 * @returns {Object}  msgKey → {status:bool, in_date:bool, ...}
 */
function getAllDataConfigs() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return {};
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    const result = {};
    data.forEach(function (row) {
      const k = String(row[0] || '');
      if (k.indexOf('DATA_CFG.') === 0) {
        const msgKey = k.slice('DATA_CFG.'.length);
        try { result[msgKey] = JSON.parse(String(row[1] || '')); } catch (e) { }
      }
    });
    return result;
  } catch (e) {
    Logger.log('[getAllDataConfigs] 오류: ' + e.toString());
    return {};
  }
}

/**
 * 특정 메시지 키의 데이터 필드 설정 반환 (TelegramService 내부 호출용)
 * @param {string} msgKey
 * @returns {Object|null}  null → 기본값(모두 표시)
 */
function getDataConfig_(msgKey) {
  try {
    const val = getSetting_('DATA_CFG.' + msgKey, '');
    if (!val) return null;
    const parsed = JSON.parse(val);
    return (typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------
// [PHASE 2/3] 텔레그램 알림 발송 헬퍼
// ------------------------------------------------------------------------------------------------

/**
 * 추천 만료 사전/만료 알림을 텔레그램으로 발송합니다.
 * @param {string} memberId
 * @param {string} itemId
 * @param {'24h'|'1h'|'done'} type
 */
function sendExpiryNotification_(memberId, itemId, type) {
  try {
    const member = getMemberById_(memberId);
    if (!member) { Logger.log('[sendExpiryNotification_] 회원 없음: ' + memberId); return; }

    const chatId = String(member.telegram_chat_id || '').trim();
    if (!chatId) { Logger.log('[sendExpiryNotification_] chat_id 없음: ' + memberId); return; }

    const enabled = String(member.telegram_enabled || '').toUpperCase();
    if (enabled === 'N') return;

    // 물건 정보 조회
    const item = (typeof getItemLiteById_ === 'function') ? getItemLiteById_(itemId) : null;
    const sakunNo = item ? String(item.sakun_no || '') : '';
    const memberName = String(member.member_name || '');

    const keyMap = { '24h': 'notify.expiry_24h', '1h': 'notify.expiry_1h', 'done': 'notify.expiry_done' };
    const msgKey = keyMap[type] || 'notify.expiry_24h';
    const text = getMessageTemplate_(msgKey, { member_name: memberName, sakun_no: sakunNo })
      || memberName + '님, 추천 물건 알림입니다. [' + sakunNo + ']';

    if (typeof telegramSendMessage === 'function') {
      telegramSendMessage(chatId, text, null);
    }

    // TELEGRAM_SENT 이력
    writeItemHistory_({
      action: 'TELEGRAM_SENT',
      item_id: itemId,
      member_id: memberId,
      member_name: memberName,
      chat_id: chatId,
      telegram_username: String(member.telegram_username || ''),
      trigger_type: 'system',
      note: msgKey
    });
  } catch (e) {
    Logger.log('[sendExpiryNotification_] 오류: ' + e.toString());
  }
}

/**
 * 입찰일 D-N 알림을 텔레그램으로 발송합니다.
 * @param {string} memberId
 * @param {string} itemId
 * @param {'D-3'|'D-2'|'D-1'} dTag
 */
function sendBidDateNotification_(memberId, itemId, dTag) {
  try {
    const member = getMemberById_(memberId);
    if (!member) { Logger.log('[sendBidDateNotification_] 회원 없음: ' + memberId); return; }

    const chatId = String(member.telegram_chat_id || '').trim();
    if (!chatId) { Logger.log('[sendBidDateNotification_] chat_id 없음: ' + memberId); return; }

    const enabled = String(member.telegram_enabled || '').toUpperCase();
    if (enabled === 'N') return;

    const item = (typeof getItemLiteById_ === 'function') ? getItemLiteById_(itemId) : null;
    const sakunNo = item ? String(item.sakun_no || '') : '';
    const inDate = item ? String(item['in-date'] || '') : '';
    const memberName = String(member.member_name || '');

    const keyMap = { 'D-3': 'notify.bid_d3', 'D-2': 'notify.bid_d2', 'D-1': 'notify.bid_d1' };
    const msgKey = keyMap[dTag] || 'notify.bid_d1';
    const text = getMessageTemplate_(msgKey, { member_name: memberName, sakun_no: sakunNo, in_date: inDate })
      || memberName + '님, [' + sakunNo + '] 입찰일 ' + dTag + ' 알림입니다.';

    if (typeof telegramSendMessage === 'function') {
      telegramSendMessage(chatId, text, null);
    }

    writeItemHistory_({
      action: 'TELEGRAM_SENT',
      item_id: itemId,
      member_id: memberId,
      member_name: memberName,
      chat_id: chatId,
      telegram_username: String(member.telegram_username || ''),
      trigger_type: 'system',
      note: msgKey
    });
  } catch (e) {
    Logger.log('[sendBidDateNotification_] 오류: ' + e.toString());
  }
}

// ============================================================
// [조사물건 관리] search 시트 CRUD
// ============================================================

const DB_SEARCH_SHEET_NAME = 'search';
const SEARCH_HEADERS = [
  'search_id', 'in-date', 'sakun_no', 'court', 'item_type',
  'item_summary', 'item_area', 'item_status', 'kamjungka',
  'min_bid_price', 'min_bid_rate', 'address', 'note1', 'note2',
  'josaja', 'reg_date', 'reg_member', 'auction_id', 'josa_status', 'img_url',
  'tags', 'search_group'
];

/**
 * search 시트 초기화 — 비활성화 (조사물건관리 v2 = josa_items 로 이전됨)
 * 호출되어도 새로 생성하지 않음. 이미 있으면 그대로 반환.
 */
function initSearchSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(DB_SEARCH_SHEET_NAME); // null 가능
}

/**
 * SEARCH 시트 헤더 컬럼 갱신 (신규 컬럼 추가 시 GAS 에디터에서 직접 실행)
 * - 기존 데이터는 유지하고 헤더 행만 SEARCH_HEADERS 기준으로 갱신
 */
function updateSearchHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) { Logger.log('SEARCH 시트 없음'); return; }
  const currentCols = sheet.getLastColumn();
  if (currentCols < SEARCH_HEADERS.length) {
    // 부족한 열만 추가
    const needed = SEARCH_HEADERS.length - currentCols;
    sheet.insertColumnsAfter(currentCols, needed);
  }
  // 헤더 행 전체 재기록
  sheet.getRange(1, 1, 1, SEARCH_HEADERS.length).setValues([SEARCH_HEADERS]).setFontWeight('bold');
  Logger.log('SEARCH 헤더 갱신 완료: ' + SEARCH_HEADERS.join(', '));
}

/**
 * 조사물건 전체 조회
 */
function readAllSearchItems() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) return []; // 시트 없으면 빈 배열 (자동 생성 X)
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const maxCols = Math.min(sheet.getMaxColumns(), SEARCH_HEADERS.length);
  const values = sheet.getRange(2, 1, lastRow - 1, maxCols).getValues();

  return values.map(function(row) {
    var obj = {};
    SEARCH_HEADERS.forEach(function(h, i) {
      var val = (row[i] !== undefined && row[i] !== null) ? row[i] : '';
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyMMdd HHmmss');
      obj[h] = String(val);
    });
    return obj;
  }).filter(function(row) { return row.search_id; });
}

/**
 * 조사물건 신규 등록
 */
function saveSearchItem(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) {
    initSearchSheet_();
    sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  }
  // 헤더 컬럼 수가 SEARCH_HEADERS보다 적으면 업데이트 (신규 컬럼 추가 대응)
  if (sheet.getLastColumn() < SEARCH_HEADERS.length) {
    sheet.getRange(1, 1, 1, SEARCH_HEADERS.length).setValues([SEARCH_HEADERS]).setFontWeight('bold');
  }
  // sakun_no 연도 정규화: "25타경..." → "2025타경..."
  if (data.sakun_no) {
    data.sakun_no = String(data.sakun_no).replace(/^(\d{2})(타경)/, function(_, yr, t) {
      return '20' + yr + t;
    });
  }

  // 중복 체크 키: sakun_no + in-date + court (3개 조합)
  var existing = readAllSearchItems();
  var sakunNo = String(data.sakun_no || '').trim();
  var inDate  = String(data['in-date'] || '').trim();
  var court   = String(data.court || '').trim();

  // 동일 물건 존재 여부 확인
  var existIdx = -1;
  var existItem = null;
  if (sakunNo) {
    for (var ei = 0; ei < existing.length; ei++) {
      var ex = existing[ei];
      if (String(ex.sakun_no  || '').trim() === sakunNo &&
          String(ex['in-date']|| '').trim() === inDate  &&
          String(ex.court     || '').trim() === court) {
        existIdx = ei;
        existItem = ex;
        break;
      }
    }
  }

  // ── 기존 등록 있음 → 업데이트 (josa_status, josaja 제외) ──
  if (existItem) {
    var searchId = existItem.search_id;
    // search_group 누적 (콤마 구분, 중복 제거)
    var newGroup = String(data.search_group || '').trim();
    var existGroups = String(existItem.search_group || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    if (newGroup && existGroups.indexOf(newGroup) === -1) existGroups.push(newGroup);
    var mergedGroup = existGroups.join(',');
    // tags 누적 (세미콜론 구분, 중복 제거)
    var newTags = String(data.tags || '').trim();
    var existTags = String(existItem.tags || '').split(';').map(function(s){return s.trim();}).filter(Boolean);
    if (newTags && existTags.indexOf(newTags) === -1) existTags.push(newTags);
    var mergedTags = existTags.join(';');

    // 시트에서 해당 행 찾아 업데이트
    var lastRow = sheet.getLastRow();
    var idCol = SEARCH_HEADERS.indexOf('search_id') + 1;
    var allIds = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    var sheetRowIdx = -1;
    for (var ri = 0; ri < allIds.length; ri++) {
      if (String(allIds[ri][0]).trim() === searchId) { sheetRowIdx = ri + 2; break; }
    }
    if (sheetRowIdx > 0) {
      var skipFields = { search_id:1, reg_date:1, josa_status:1, josaja:1 };
      SEARCH_HEADERS.forEach(function(h, ci) {
        if (skipFields[h]) return;
        var val;
        if (h === 'search_group') val = mergedGroup;
        else if (h === 'tags') val = mergedTags;
        else val = (data[h] !== undefined && data[h] !== null) ? String(data[h]) : String(existItem[h] || '');
        sheet.getRange(sheetRowIdx, ci + 1).setValue(val);
      });
    }
    return { success: true, search_id: searchId, updated: true, message: '기존 물건 업데이트 완료' };
  }

  // ── 신규 등록 ──
  var now = new Date();
  var ts = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMddHHmmss');
  var searchId = 'S' + ts + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  var regDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd HHmmss');

  var row = SEARCH_HEADERS.map(function(h) {
    if (h === 'search_id') return searchId;
    if (h === 'reg_date') return regDate;
    if (h === 'josa_status') return data.josa_status || '신규';
    var v = data[h];
    return (v !== undefined && v !== null) ? String(v) : '';
  });

  sheet.appendRow(row);
  return { success: true, search_id: searchId, updated: false };
}

/**
 * 여러 조사물건 일괄 등록 (Python 크롤링에서 사용)
 */
function saveSearchItemsBatch(items) {
  var results = [];
  if (!Array.isArray(items)) return { success: false, message: 'items가 배열이 아닙니다.' };
  items.forEach(function(item) {
    results.push(saveSearchItem(item));
  });
  var saved = results.filter(function(r) { return r.success; }).length;
  return { success: true, saved: saved, skipped: items.length - saved, results: results };
}

/**
 * 조사물건 상태 업데이트 (josa_status, josaja)
 */
function updateSearchItemStatus(searchId, josaStatus, josaja) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) return { success: false, message: 'search 시트가 없습니다.' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(searchId).trim()) {
      var rowNum = i + 2;
      var statusColIdx = SEARCH_HEADERS.indexOf('josa_status') + 1;
      var josajaColdIdx = SEARCH_HEADERS.indexOf('josaja') + 1;
      if (statusColIdx > 0) sheet.getRange(rowNum, statusColIdx).setValue(josaStatus);
      if (josajaColdIdx > 0 && josaja) sheet.getRange(rowNum, josajaColdIdx).setValue(josaja);
      return { success: true };
    }
  }
  return { success: false, message: '해당 조사물건을 찾을 수 없습니다.' };
}

/**
 * 조사자 목록 조회 (members 시트에서 gubun='조사자')
 */
function getInvestigators() {
  var members = readAllMembers();
  return members.filter(function(m) {
    var gubun = String(m.gubun || '');
    return gubun === '조사자' || gubun.split(',').map(function(g) { return g.trim(); }).indexOf('조사자') !== -1;
  });
}

/**
 * 조사물건 삭제 (search_id 배열)
 */
function deleteSearchItems(searchIds) {
  if (!Array.isArray(searchIds) || searchIds.length === 0) return { success: false, message: '삭제할 항목이 없습니다.' };
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) return { success: false, message: 'search 시트 없음' };
  var ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  var toDelete = searchIds.map(function(id) { return String(id).trim(); });
  // 뒤에서부터 삭제 (행 번호 밀림 방지)
  for (var i = ids.length - 1; i >= 0; i--) {
    if (toDelete.indexOf(String(ids[i][0]).trim()) !== -1) {
      sheet.deleteRow(i + 2);
    }
  }
  return { success: true };
}

/**
 * 조사물건 비고 저장 (note1)
 */
function saveSearchNote(searchId, note1) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) return { success: false };
  var ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  var noteColIdx = SEARCH_HEADERS.indexOf('note1') + 1;
  if (noteColIdx < 1) return { success: false };
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(searchId).trim()) {
      sheet.getRange(i + 2, noteColIdx).setValue(note1);
      return { success: true };
    }
  }
  return { success: false, message: '항목 없음' };
}

/**
 * 외부 API 핸들러 (Python 크롤링 스크립트에서 POST로 호출)
 * payload.api_action: 'saveSearchItems' | 'getSearchItems' | 'initSearchSheet'
 */
function handleSearchApiPost_(payload) {
  var action = String(payload.api_action || '');
  if (action === 'saveSearchItems') {
    return saveSearchItemsBatch(payload.items || []);
  }
  if (action === 'getSearchItems') {
    return { success: true, items: readAllSearchItems() };
  }
  if (action === 'initSearchSheet') {
    initSearchSheet_();
    return { success: true, message: 'search 시트 초기화 완료' };
  }
  return { success: false, message: '알 수 없는 API 액션: ' + action };
}

// ============================================================
// [조사물건관리 v2] josa_presets + josa_items 시트
// - 매니저(00.auction1) 의 크롤링 결과를 받아 저장
// - 매니저 → MAPS 단방향 동기화 (매니저가 source of truth)
// - 매니저에서 리스트 삭제해도 MAPS 자동 폐기 X → 빨간 카드로 표시, 사용자가 결정
// ============================================================

const DB_JOSA_PRESETS_SHEET_NAME = 'josa_presets';
const JOSA_PRESETS_HEADERS = [
  'preset_id',              // 매니저 uid() 와 동일 (동기화 키)
  'preset_title',           // 크롤링리스트 이름
  'created_at',             // 최초 등록일 (YYYY-MM-DD HH:mm:ss)
  'updated_at',             // 최종 동기화 시각
  'last_upload_at',         // 마지막 크롤링 업로드 시각
  'items_count',            // 현재 속한 물건 수 (캐시)
  'is_active',              // Y/N (매니저에 존재 여부)
  'deleted_in_manager_at',  // 매니저에서 삭제 감지된 시각 (빨간 카드 표시용)
  // ── 보고서용 추가 (매니저 sync 시 함께 push) ──────────────────
  'form_data_lines',        // JSON 문자열: [{label, val}, ...] — 검색조건 KV (라벨-친화 변환됨)
  'custom_filters_lines',   // JSON 문자열: [{name, op, value}, ...] — 추가필터 (typeName resolved)
  'cache_total',            // 매니저 캐시 raw items.length
  'cache_filtered',         // 매니저 캐시 추가필터 적용 후 length
  'cache_ts'                // 매니저 캐시 시각 (ms timestamp 또는 YYYY-MM-DD HH:mm:ss)
];

// 시트 헤더가 JOSA_PRESETS_HEADERS 와 다르거나 컬럼 수 부족하면 확장 (스키마 변경 자동 반영)
function _ensureJosaPresetsHeader_(sheet) {
  if (sheet.getMaxColumns() < JOSA_PRESETS_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), JOSA_PRESETS_HEADERS.length - sheet.getMaxColumns());
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    sheet.getRange(1, 1, 1, JOSA_PRESETS_HEADERS.length).setValues([JOSA_PRESETS_HEADERS]).setFontWeight('bold');
    return;
  }
  var current = sheet.getRange(1, 1, 1, Math.max(lastCol, JOSA_PRESETS_HEADERS.length)).getValues()[0];
  var match = true;
  for (var i = 0; i < JOSA_PRESETS_HEADERS.length; i++) {
    if (String(current[i] || '').trim() !== JOSA_PRESETS_HEADERS[i]) { match = false; break; }
  }
  if (!match) {
    sheet.getRange(1, 1, 1, JOSA_PRESETS_HEADERS.length).setValues([JOSA_PRESETS_HEADERS]).setFontWeight('bold');
  }
}

function initJosaPresetsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DB_JOSA_PRESETS_SHEET_NAME);
  }
  _ensureJosaPresetsHeader_(sheet);
  sheet.setFrozenRows(1);
  return sheet;
}

const DB_JOSA_ITEMS_SHEET_NAME = 'josa_items';
const JOSA_ITEMS_HEADERS = [
  'josa_id',                // PK — 자동 발급 (items.id 와 동일 패턴, Date.now() 기반 timestamp)
  'sakun_no',               // 사건번호 (예: 24타경102685)
  'bid_date',               // 입찰일자 YYMMDD (items.in-date 동일)
  'bid_time',               // 입찰시간 HH:MM
  'court',                  // 법원명
  'address',                // 소재지 (정제된 주소만)
  'size_info',              // 크기/면적정보 (대지권, 건물, 계약평형 등)
  'specials_all',           // 특수전체 (address 라인 3)
  'issue',                  // 정책 이슈 (투기과열지구/조정대상지역 등)
  'prop_kind',              // 물건종류
  'specials',               // 특수물건 (개별, raw 필드)
  'kamjungka',              // 감정가 (숫자만)
  'low_price',              // 최저입찰가 (숫자만)
  'pyeong_price',           // 평당가 (숫자만, 만원 단위)
  'area',                   // 면적
  'fail_count',             // 유찰 횟수 (숫자만)
  'fail_rate',              // 유찰율 % (숫자만)
  'view_count',             // 옥션원 조회수 (숫자만)
  'view_url',               // 옥션원 상세 URL (바로가기)
  'img_url',                // 대표 이미지 URL
  'preset_ids',             // 콤마 구분 다중값 (어느 크롤링리스트들에 속하는지)
  'preset_titles_cached',   // 캐시 (표시용, 콤마 구분)
  'josa_status',            // 미분류/조사요청/조사접수/조사확정/조사불가/폐기
  'josaja',                 // 조사자명 (members.member_name)
  'requested_at',           // 조사요청 시각
  'accepted_at',            // 조사접수 시각 (텔레그램 [접수] 클릭)
  'finalized_at',           // 조사확정/조사불가 시각
  'reject_reason',          // 일정불가/조사불가/기타텍스트
  'memo',                   // 사용자 비고
  'reg_date',               // YYYY-MM-DD HH:mm:ss 초단위
  'update_date',            // 최종 갱신 시각
  'josaja_id'               // 조사자 member_id (동명이인 대비 — 키 매칭은 이것 우선)
];

function initJosaItemsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DB_JOSA_ITEMS_SHEET_NAME);
  }
  // 헤더 갱신 (컬럼 수 부족 시 확장)
  if (sheet.getMaxColumns() < JOSA_ITEMS_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), JOSA_ITEMS_HEADERS.length - sheet.getMaxColumns());
  }
  const headerRange = sheet.getRange(1, 1, 1, JOSA_ITEMS_HEADERS.length);
  headerRange.setValues([JOSA_ITEMS_HEADERS]);
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
  // josa_id (컬럼 A) 서식 강제 텍스트 — Sheets 자동 Number 변환 방지 (안전망)
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  return sheet;
}

/**
 * 두 시트 한번에 초기화 (GAS 에디터에서 1회 실행)
 *   GAS 에디터 → 함수 선택 → initJosaSheetsAll → 실행
 */
function initJosaSheetsAll() {
  initJosaPresetsSheet_();
  initJosaItemsSheet_();
  Logger.log('[josa] josa_presets / josa_items 시트 초기화 완료');
  return { success: true, sheets: [DB_JOSA_PRESETS_SHEET_NAME, DB_JOSA_ITEMS_SHEET_NAME] };
}

/**
 * josa_items 시트 데이터 행 전체 삭제 + 헤더 정상화 (GAS 에디터에서 1회 실행)
 *   스키마 변경(컬럼 추가/순서 변경) 후 기존 행이 어긋났을 때 사용.
 *   헤더 행(1행)은 보존, 나머지 모두 삭제.
 */
function resetJosaItemsData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
  if (!sheet) { initJosaItemsSheet_(); return { success: true, message: '시트 새로 생성됨' }; }
  var lastRow = sheet.getLastRow();
  var deleted = 0;
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
    deleted = lastRow - 1;
  }
  // 헤더 강제 갱신
  if (sheet.getMaxColumns() < JOSA_ITEMS_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), JOSA_ITEMS_HEADERS.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, JOSA_ITEMS_HEADERS.length).setValues([JOSA_ITEMS_HEADERS]).setFontWeight('bold');
  // josa_presets 의 items_count 초기화
  var p = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME);
  if (p && p.getLastRow() >= 2) {
    var col = JOSA_PRESETS_HEADERS.indexOf('items_count') + 1;
    var n = p.getLastRow() - 1;
    p.getRange(2, col, n, 1).setValues(Array(n).fill(['0']));
  }
  Logger.log('[josa] josa_items 데이터 ' + deleted + '행 삭제 + 헤더 ' + JOSA_ITEMS_HEADERS.length + '컬럼으로 정상화');
  return { success: true, deleted: deleted, headers: JOSA_ITEMS_HEADERS.length };
}

// 조사불가 사유 프리셋 (계속 추가 예정)
const JOSA_REJECT_REASONS = ['일정불가', '조사불가', '기타'];

// ────────────────────────────────────────────────────────────
// [josa v2] 공통 헬퍼
// ────────────────────────────────────────────────────────────

function _josaNowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// google.script.run 직렬화 안전성을 위해 control character (CR/LF/TAB 등) 제거
function _josaSafeStr_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  //  - (제어문자),  (DEL), - (C1 제어) 모두 공백으로
  return s.replace(/[ --]+/g, ' ').trim();
}

// 중복 체크용 dedup 키 — court 제외 (주소 파생값이라 늦게/일찍 매핑된 차이로 옛 row 가 영원히 잔존하는 버그 방지)
function _josaDedupKey_(item) {
  var sakun = String(item.sakun_no || '').trim();
  var bd    = String(item.bid_date  || '').trim();
  if (!sakun) return '';
  return sakun + '|' + bd;
}
// 새 josa_id 발급 — Sheets Number 자동변환 방지 위해 'J' prefix (16자리 순수숫자 정밀도 손실 차단)
function _newJosaId_() {
  return 'J' + String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// ────────────────────────────────────────────────────────────
// [josa v2] josa_presets CRUD
// ────────────────────────────────────────────────────────────

function readAllJosaPresets() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME);
  if (!sheet) { initJosaPresetsSheet_(); sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME); }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, JOSA_PRESETS_HEADERS.length).getValues();
  return values.map(function(row) {
    var obj = {};
    JOSA_PRESETS_HEADERS.forEach(function(h, i) {
      var val = row[i];
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      obj[h] = _josaSafeStr_(val);
    });
    return obj;
  }).filter(function(r) { return r.preset_id; });
}

/**
 * 매니저 → MAPS 동기화 (preset 목록 일괄)
 * payload.presets = [{id, title}, ...]  ← 보낼 preset 목록
 * payload.mode    = 'partial' (기본) | 'full'
 *   - 'partial': 보낸 것만 upsert. 시트에 있지만 안 보낸 건 그대로 둠 (체크박스 선택 동기화)
 *   - 'full':    보낸 게 매니저 전체. 시트엔 있지만 안 보낸 건 is_active=N + deleted_in_manager_at=now
 */
function syncJosaPresets(presetList, mode) {
  if (!Array.isArray(presetList)) return { success: false, message: 'presets 배열 필요' };
  var syncMode = (mode === 'full') ? 'full' : 'partial';
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME);
  if (!sheet) { initJosaPresetsSheet_(); sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME); }
  _ensureJosaPresetsHeader_(sheet);

  var now = _josaNowText_();
  var existing = readAllJosaPresets();
  var existIdMap = {};
  existing.forEach(function(e, i) { existIdMap[e.preset_id] = { row: i + 2, data: e }; });

  var incomingIds = {};
  var added = 0, updated = 0, marked = 0, restored = 0;

  // 보고서용 새 필드 — 매니저가 안 보내면 prev 보존, 보내면 그 값 (빈 문자열도 명시적 의미)
  function _pick(p, prev, key) { return (p[key] !== undefined && p[key] !== null) ? String(p[key]) : (prev[key] || ''); }

  presetList.forEach(function(p) {
    var id = String(p.id || '').trim();
    var title = String(p.title || '').trim();
    if (!id) return;
    incomingIds[id] = true;

    if (existIdMap[id]) {
      var rowNum = existIdMap[id].row;
      var prev = existIdMap[id].data;
      var wasDeleted = prev.is_active === 'N' || !!prev.deleted_in_manager_at;
      var rowObj = {
        preset_id: id,
        preset_title: title,
        created_at: prev.created_at || now,
        updated_at: now,
        last_upload_at: prev.last_upload_at || '',
        items_count: prev.items_count || '0',
        is_active: 'Y',
        deleted_in_manager_at: '',
        form_data_lines:      _pick(p, prev, 'form_data_lines'),
        custom_filters_lines: _pick(p, prev, 'custom_filters_lines'),
        cache_total:          _pick(p, prev, 'cache_total'),
        cache_filtered:       _pick(p, prev, 'cache_filtered'),
        cache_ts:             _pick(p, prev, 'cache_ts')
      };
      var rowArr = JOSA_PRESETS_HEADERS.map(function(h) { return rowObj[h]; });
      sheet.getRange(rowNum, 1, 1, JOSA_PRESETS_HEADERS.length).setValues([rowArr]);
      if (wasDeleted) restored++; else updated++;
    } else {
      var rowObj2 = {
        preset_id: id, preset_title: title,
        created_at: now, updated_at: now, last_upload_at: '',
        items_count: '0', is_active: 'Y', deleted_in_manager_at: '',
        form_data_lines:      String(p.form_data_lines || ''),
        custom_filters_lines: String(p.custom_filters_lines || ''),
        cache_total:          String(p.cache_total != null ? p.cache_total : ''),
        cache_filtered:       String(p.cache_filtered != null ? p.cache_filtered : ''),
        cache_ts:             String(p.cache_ts || '')
      };
      sheet.appendRow(JOSA_PRESETS_HEADERS.map(function(h) { return rowObj2[h]; }));
      added++;
    }
  });

  // mode='full' 일 때만 매니저에 없는 preset → deleted 표시 (자동 폐기 X)
  if (syncMode === 'full') {
    Object.keys(existIdMap).forEach(function(eid) {
      if (incomingIds[eid]) return;
      var rowNum = existIdMap[eid].row;
      var prev = existIdMap[eid].data;
      if (prev.is_active === 'N' && prev.deleted_in_manager_at) return; // 이미 표시됨
      var isActiveCol = JOSA_PRESETS_HEADERS.indexOf('is_active') + 1;
      var delCol = JOSA_PRESETS_HEADERS.indexOf('deleted_in_manager_at') + 1;
      sheet.getRange(rowNum, isActiveCol).setValue('N');
      sheet.getRange(rowNum, delCol).setValue(now);
      marked++;
    });
  }

  return { success: true, mode: syncMode, added: added, updated: updated, restored: restored, marked_deleted: marked, total: presetList.length };
}

// ────────────────────────────────────────────────────────────
// [josa v2] josa_items CRUD
// ────────────────────────────────────────────────────────────

// 시트 헤더가 JOSA_ITEMS_HEADERS 와 다르면 강제 갱신 (스키마 변경 자동 반영)
function _ensureJosaItemsHeader_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    sheet.getRange(1, 1, 1, JOSA_ITEMS_HEADERS.length).setValues([JOSA_ITEMS_HEADERS]).setFontWeight('bold');
    return;
  }
  var current = sheet.getRange(1, 1, 1, Math.max(lastCol, JOSA_ITEMS_HEADERS.length)).getValues()[0];
  var match = true;
  for (var i = 0; i < JOSA_ITEMS_HEADERS.length; i++) {
    if (String(current[i] || '').trim() !== JOSA_ITEMS_HEADERS[i]) { match = false; break; }
  }
  if (!match) {
    if (sheet.getMaxColumns() < JOSA_ITEMS_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), JOSA_ITEMS_HEADERS.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, JOSA_ITEMS_HEADERS.length).setValues([JOSA_ITEMS_HEADERS]).setFontWeight('bold');
  }
}

function readAllJosaItems() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
  if (!sheet) { initJosaItemsSheet_(); sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME); }
  _ensureJosaItemsHeader_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, JOSA_ITEMS_HEADERS.length).getValues();
  return values.map(function(row) {
    var obj = {};
    JOSA_ITEMS_HEADERS.forEach(function(h, i) {
      var val = row[i];
      if (val instanceof Date) {
        // bid_time 만 HH:mm (Sheets 가 시간 형식으로 자동 변환 시 1899-12-30 prefix 제거)
        if (h === 'bid_time') val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
        else val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      }
      obj[h] = _josaSafeStr_(val);
    });
    // 레거시 정규화: 시트에 저장된 옛 '분류필요' → '미분류' (읽을 때만, 시트 비파괴)
    if (obj.josa_status === '분류필요') obj.josa_status = '미분류';
    return obj;
  }).filter(function(r) { return r.josa_id; });
}

// 조사자 토큰 → 본인(josaja) 조사물건 목록 (조사 웹뷰용). 조사불가 등은 제외.
function getJosaItemsByToken(token) {
  try {
    var mem = (typeof getMemberByToken === 'function') ? getMemberByToken(token) : null;
    if (!mem || !mem.member_token) return { success: false, message: '유효하지 않은 토큰', items: [] };
    // getMemberByToken 의 name 은 비어있음(헤더가 member_name) → 전체 회원행에서 정확히 추출
    var full = null;
    try { full = (typeof getMemberById_ === 'function') ? getMemberById_(mem.member_id) : null; } catch (e0) { full = null; }
    var name = String((full && (full.member_name || full.name)) || mem.member_name || mem.name || '').trim();
    var gubun = full ? String(full.gubun || '') : '';
    if (!name) return { success: false, message: '회원명 없음(member_id=' + (mem.member_id || '?') + ')', items: [] };
    var mid = String(mem.member_id || '').trim();
    var VISIBLE = { '조사요청': 1, '조사접수': 1, '조사확정': 1, '조사완료': 1 };
    var all = (typeof readAllJosaItems === 'function') ? readAllJosaItems() : [];
    var items = all.filter(function (r) {
      if (!VISIBLE[String(r.josa_status || '').trim()]) return false;
      var jid = String(r.josaja_id || '').trim();
      if (jid) return jid === mid;                                  // id 우선(동명이인 안전)
      return String(r.josaja || '').trim() === name && !!name;      // 레거시(미기록) 행만 이름 폴백
    });
    return { success: true, member_id: mid, member_name: name, gubun: gubun, items: items };
  } catch (e) {
    return { success: false, message: String(e && e.message || e), items: [] };
  }
}

/**
 * 크롤링 결과 일괄 upsert
 * payload: { preset_id, preset_title, items: [...] }
 * 사용자 룰:
 *   - 키 = sakun_no|bid_date|court
 *   - 기존 행: 본문 덮어쓰기, 상태/조사자/사유/메모/시각들 보존
 *   - preset_ids/preset_titles_cached 에 현재 preset 누적 (중복 제거)
 */
function bulkUpsertJosaItems(payload) {
  var presetId = String(payload.preset_id || '').trim();
  var presetTitle = String(payload.preset_title || '').trim();
  var items = Array.isArray(payload.items) ? payload.items : [];
  if (!presetId) return { success: false, message: 'preset_id 필요' };

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
  if (!sheet) { initJosaItemsSheet_(); sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME); }
  _ensureJosaItemsHeader_(sheet);  // 스키마 변경 시 헤더 자동 갱신

  var now = _josaNowText_();
  var existing = readAllJosaItems();
  // dedup 키 (sakun|bid_date|court) → 행번호 매핑
  var keyToRow = {};
  existing.forEach(function(e, i) {
    var k = _josaDedupKey_(e);
    if (k) keyToRow[k] = { row: i + 2, data: e };
  });

  // 본문 컬럼 (크롤링 시 덮어쓰기) — 정제된 분리 필드
  var BODY_FIELDS = ['sakun_no','bid_date','bid_time','court','address','size_info','specials_all','issue','prop_kind','specials','kamjungka','low_price','pyeong_price','area','fail_count','fail_rate','view_count','view_url','img_url'];
  // 보존 컬럼 (사용자 룰 - 상태/조사자/메모 보존)
  var PRESERVE_FIELDS = ['josa_status','josaja','requested_at','accepted_at','finalized_at','reject_reason','memo'];

  // ── 사진 영구화: 옥션원은 CloudFront signed URL(24h 만료) → 받은 직후 base64 로 변환 후 시트 보관 ──
  // 셀 한도 50K char ≒ 35KB 바이트 이내 이미지만 변환. 초과/실패 시 원본 URL 유지(만료 위험 감수).
  var imgFetchTargets = [];  // [{idx, url}]
  items.forEach(function(it, idx) {
    var u = String(it && it.img_url || '').trim();
    if (u && u.indexOf('http') === 0 && u.indexOf('data:') !== 0) {
      imgFetchTargets.push({ idx: idx, url: u });
    }
  });
  if (imgFetchTargets.length) {
    try {
      var requests = imgFetchTargets.map(function(t) {
        return { url: t.url, headers: { 'Referer': 'https://www.auction1.co.kr/', 'User-Agent': 'Mozilla/5.0' }, muteHttpExceptions: true, followRedirects: true };
      });
      var responses = UrlFetchApp.fetchAll(requests);
      responses.forEach(function(resp, ri) {
        try {
          if (resp.getResponseCode() !== 200) return;
          var blob = resp.getBlob();
          var bytes = blob.getBytes();
          if (bytes.length > 35000) return; // 35KB 초과 → skip (원본 URL 유지)
          var mime = blob.getContentType() || 'image/jpeg';
          items[imgFetchTargets[ri].idx].img_url = 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes);
        } catch (e) { Logger.log('[bulkUpsert img] resp ' + ri + ' err: ' + e); }
      });
    } catch (e) {
      Logger.log('[bulkUpsert] img fetchAll err: ' + e);
    }
  }

  var added = 0, updated = 0, failed = 0;

  items.forEach(function(item) {
    var dkey = _josaDedupKey_(item);
    if (!dkey) { failed++; return; }

    if (keyToRow[dkey]) {
      // 기존 행 — josa_id 그대로 유지
      var rowNum = keyToRow[dkey].row;
      var prev = keyToRow[dkey].data;

      // preset_ids 누적 (콤마 구분, 중복 제거)
      var prevIds = String(prev.preset_ids || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
      var prevTitles = String(prev.preset_titles_cached || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
      if (prevIds.indexOf(presetId) === -1) prevIds.push(presetId);
      while (prevTitles.length < prevIds.length) prevTitles.push('');
      var idx = prevIds.indexOf(presetId);
      prevTitles[idx] = presetTitle;

      var rowObj = {
        josa_id: prev.josa_id,  // 기존 ID 보존
        preset_ids: prevIds.join(','),
        preset_titles_cached: prevTitles.join(','),
        update_date: now,
        reg_date: prev.reg_date || now
      };
      BODY_FIELDS.forEach(function(f) {
        rowObj[f] = (item[f] !== undefined && item[f] !== null) ? String(item[f]) : '';
      });
      PRESERVE_FIELDS.forEach(function(f) {
        rowObj[f] = prev[f] || '';
      });
      var rowArr = JOSA_ITEMS_HEADERS.map(function(h) { return rowObj[h] !== undefined ? rowObj[h] : (prev[h] || ''); });
      sheet.getRange(rowNum, 1, 1, JOSA_ITEMS_HEADERS.length).setValues([rowArr]);
      updated++;
    } else {
      // 신규 — josa_id 자동 발급
      var rowObj2 = {
        josa_id: _newJosaId_(),
        preset_ids: presetId,
        preset_titles_cached: presetTitle,
        josa_status: '미분류',
        reg_date: now,
        update_date: now
      };
      BODY_FIELDS.forEach(function(f) {
        rowObj2[f] = (item[f] !== undefined && item[f] !== null) ? String(item[f]) : '';
      });
      var rowArr2 = JOSA_ITEMS_HEADERS.map(function(h) { return rowObj2[h] !== undefined ? rowObj2[h] : ''; });
      sheet.appendRow(rowArr2);
      added++;
    }
  });

  // josa_presets 의 items_count + last_upload_at 갱신
  try { _updateJosaPresetUploadStat_(presetId, presetTitle); } catch (e) {}

  return { success: true, added: added, updated: updated, failed: failed, total: items.length };
}

function _updateJosaPresetUploadStat_(presetId, presetTitle) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME);
  if (!sheet) { initJosaPresetsSheet_(); sheet = ss.getSheetByName(DB_JOSA_PRESETS_SHEET_NAME); }
  var now = _josaNowText_();
  var lastRow = sheet.getLastRow();

  // items_count 계산 (preset_ids 에 이 ID 포함된 행 수)
  var itemsAll = readAllJosaItems();
  var cnt = 0;
  itemsAll.forEach(function(it) {
    var ids = String(it.preset_ids || '').split(',').map(function(s){return s.trim();});
    if (ids.indexOf(presetId) !== -1) cnt++;
  });

  if (lastRow < 2) {
    // preset 시트 비어있으면 신규 추가
    var rowObj = {
      preset_id: presetId, preset_title: presetTitle,
      created_at: now, updated_at: now, last_upload_at: now,
      items_count: String(cnt), is_active: 'Y', deleted_in_manager_at: ''
    };
    sheet.appendRow(JOSA_PRESETS_HEADERS.map(function(h) { return rowObj[h]; }));
    return;
  }

  var idCol = JOSA_PRESETS_HEADERS.indexOf('preset_id') + 1;
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var rowNum = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === presetId) { rowNum = i + 2; break; }
  }

  if (rowNum < 0) {
    var rowObj2 = {
      preset_id: presetId, preset_title: presetTitle,
      created_at: now, updated_at: now, last_upload_at: now,
      items_count: String(cnt), is_active: 'Y', deleted_in_manager_at: ''
    };
    sheet.appendRow(JOSA_PRESETS_HEADERS.map(function(h) { return rowObj2[h]; }));
  } else {
    var luCol = JOSA_PRESETS_HEADERS.indexOf('last_upload_at') + 1;
    var cntCol = JOSA_PRESETS_HEADERS.indexOf('items_count') + 1;
    var upCol = JOSA_PRESETS_HEADERS.indexOf('updated_at') + 1;
    sheet.getRange(rowNum, luCol).setValue(now);
    sheet.getRange(rowNum, cntCol).setValue(cnt);
    sheet.getRange(rowNum, upCol).setValue(now);
  }
}

// ────────────────────────────────────────────────────────────
// [josa v2] API 라우터 (doPost 에서 호출)
// ────────────────────────────────────────────────────────────

/**
 * [JM] MAPS 새 화면 초기 데이터 일괄 로드 (google.script.run 단일 호출용)
 * 3개 따로 호출 시 chained call 문제가 생길 수 있어 단일 wrapper 로 묶음.
 */
// 사건번호 정규화: "2023타경6542" / "23타경6542" / 공백 → "23타경6542" 통일
function _jmSakunKey_(s) {
  s = String(s || '').trim();
  var m = s.match(/(\d{2,4})\s*타경\s*0*(\d+)/);
  if (!m) return s.replace(/\s+/g, '');
  var y = m[1]; if (y.length >= 4) y = y.slice(2); else if (y.length === 1) y = '0' + y;
  return y + '타경' + m[2];
}
// items 시트: 사건번호(정규화) → image_id 맵 (조사내용 모달 이미지용)
function _jmItemsImageMap_() {
  var map = {};
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sh) return map;
    var lr = sh.getLastRow();
    if (lr < 2) return map;
    var skCol = ITEM_HEADERS.indexOf('sakun_no') + 1;
    var imgCol = ITEM_HEADERS.indexOf('image_id') + 1;
    if (skCol < 1 || imgCol < 1) return map;
    var lo = Math.min(skCol, imgCol), hi = Math.max(skCol, imgCol);
    var vals = sh.getRange(2, lo, lr - 1, hi - lo + 1).getValues();
    var sRel = skCol - lo, iRel = imgCol - lo;
    for (var r = 0; r < vals.length; r++) {
      var img = String(vals[r][iRel] || '').trim();
      if (!img) continue;
      var k = _jmSakunKey_(vals[r][sRel]);
      if (k && !map[k]) map[k] = img;
    }
  } catch (e) {}
  return map;
}
function jmLoadAllData() {
  try {
    var items = readAllJosaItems();
    var imgMap = _jmItemsImageMap_();
    items.forEach(function (it) {
      var iid = imgMap[_jmSakunKey_(it.sakun_no)] || '';
      it.bid_img_id = iid;
      it.bid_img = !!iid;
    });
    return {
      success: true,
      investigators: getInvestigators(),
      presets: readAllJosaPresets(),
      items: items
    };
  } catch (e) {
    return { success: false, error: String(e), stack: e && e.stack ? String(e.stack).substring(0, 500) : '' };
  }
}

/**
 * josa_items 한 행의 특정 필드 1개 업데이트 (memo/josaja/josa_status 등)
 * @param {string} josaId   PK
 * @param {string} field    수정할 컬럼명 (JOSA_ITEMS_HEADERS 에 있어야 함)
 * @param {string} value    새 값
 */
function updateJosaField(josaId, field, value) {
  if (!josaId || !field) return { success: false, message: 'josa_id / field 필수' };
  var colIdx = JOSA_ITEMS_HEADERS.indexOf(field);
  if (colIdx < 0) return { success: false, message: '알 수 없는 컬럼: ' + field };

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
  if (!sheet) return { success: false, message: 'josa_items 시트 없음' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터 없음' };

  // josa_id 컬럼은 항상 1번 (헤더 첫 컬럼)
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var targetId = String(josaId).trim();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === targetId) {
      var rowNum = i + 2;
      sheet.getRange(rowNum, colIdx + 1).setValue(String(value || ''));
      // update_date 갱신
      var udCol = JOSA_ITEMS_HEADERS.indexOf('update_date') + 1;
      if (udCol > 0) sheet.getRange(rowNum, udCol).setValue(_josaNowText_());
      // 상태 변경 시 시각 자동 기록
      if (field === 'josa_status') {
        var v = String(value || '');
        var nowText = _josaNowText_();
        if (v === '조사요청')      { var c = JOSA_ITEMS_HEADERS.indexOf('requested_at') + 1; if (c > 0) sheet.getRange(rowNum, c).setValue(nowText); }
        else if (v === '조사접수') { var c2 = JOSA_ITEMS_HEADERS.indexOf('accepted_at') + 1; if (c2 > 0) sheet.getRange(rowNum, c2).setValue(nowText); }
        else if (v === '조사확정' || v === '조사불가') { var c3 = JOSA_ITEMS_HEADERS.indexOf('finalized_at') + 1; if (c3 > 0) sheet.getRange(rowNum, c3).setValue(nowText); }
      }
      return { success: true, josa_id: targetId, field: field, value: String(value || '') };
    }
  }
  return { success: false, message: '해당 josa_id 없음: ' + targetId };
}

function handleJosaApiPost_(payload) {
  var action = String(payload.api_action || '');
  if (action === 'syncJosaPresets') return syncJosaPresets(payload.presets || [], payload.mode);
  if (action === 'uploadJosaItems') return bulkUpsertJosaItems(payload);
  if (action === 'uploadChangeCancel') return uploadChangeCancel(payload.items || []);
  if (action === 'uploadWinningBids')  return uploadWinningBids(payload.items || []);
  if (action === 'get7DaysBugaList')   return get7DaysBugaList();
  if (action === 'getTodayMaegakList') return getTodayMaegakList();
  if (action === 'getProgressList')    return getProgressList(payload.from, payload.to, payload.statuses);
  if (action === 'saveProgressMatches')    return saveProgressMatches(payload);
  if (action === 'getProgressMatchSummary') return getProgressMatchSummary();
  if (action === 'getProgressMatchByDate')  return getProgressMatchByDate(payload.date);
  if (action === 'getReportRecipientCandidates') return getReportRecipientCandidates();
  if (action === 'sendBugaReport')     return sendBugaReport(payload);
  if (action === 'notifyAdminsText')   return notifyAdminsText(payload);
  if (action === 'getJosaPresets')  return { success: true, presets: readAllJosaPresets() };
  if (action === 'getJosaItems')    return { success: true, items: readAllJosaItems() };
  if (action === 'getInvestigators') return { success: true, investigators: getInvestigators() };
  if (action === 'updateJosaField') return updateJosaField(payload.josa_id, payload.field, payload.value);
  return { success: false, message: '알 수 없는 josa API 액션: ' + action };
}

/**
 * 매니저 「변경/취소 확인」 결과를 받아 items 의 stu_member 를 업데이트.
 * items 배열 각 원소: { sakun_no, status('변경'|'취소'|...), bid_date, lowest_price, view_url }
 * - 같은 sakun_no 의 모든 행을 그 status 값으로 변경 (옥션원 외부사유 = 해당 사건 전체 적용)
 * - status 가 '변경'/'취소' 가 아닌 건(빈값/유찰/매각/조회실패 등)은 건너뜀
 * - 현재 stu_member 가 이미 동일 값이면 skip
 * - 변경 이력을 item_history 에 기록 (writeItemHistoryBatch_ 존재 시)
 */
function uploadChangeCancel(items) {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: '항목이 비어 있습니다.', updated: 0 };
    }
    // 3키(사건번호|입찰일자|법원) → {reason(불가사유), detail(상세)} (3키 검증은 cc(04.cc.py)에서 끝냄)
    var normDate = function (v) { return String(v || '').replace(/[^0-9]/g, ''); };
    var keyOf = function (sakun, bidDate, court) {
      return String(sakun || '').trim() + '|' + normDate(bidDate) + '|' + String(court || '').trim();
    };
    var byKey = {};
    items.forEach(function (it) {
      if (!it) return;
      var sakun = String(it.sakun_no || '').trim();
      if (!sakun) return;
      var k = keyOf(sakun, it.bid_date || it['in-date'] || it.bid_datetime_2, it.court);
      byKey[k] = {
        reason: String(it.status || it.reason || it.stu_reason || '').trim(),
        detail: String(it.detail || it.stu_reason_detail || '').trim()
      };
    });
    var keyList = Object.keys(byKey);
    if (keyList.length === 0) {
      return { success: false, message: '유효한 항목(사건번호)이 없습니다.', updated: 0 };
    }

    if (typeof ensureItemReasonColumns_ === 'function') ensureItemReasonColumns_(); // Z/AA 보장

    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음', updated: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: 'items 비어있음', updated: 0 };

    var idIdx        = ITEM_HEADERS.indexOf('id');
    var sakunIdx     = ITEM_HEADERS.indexOf('sakun_no');
    var courtIdx     = ITEM_HEADERS.indexOf('court');
    var inDateIdx    = ITEM_HEADERS.indexOf('in-date');
    var stuIdx       = ITEM_HEADERS.indexOf('stu_member');
    var memberIdIdx  = ITEM_HEADERS.indexOf('member_id');
    var mNameIdx     = ITEM_HEADERS.indexOf('m_name');

    var data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();
    var historyEntries = [];
    var matchedKeys = {};
    var updated = 0;

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var k = keyOf(row[sakunIdx], row[inDateIdx], row[courtIdx]);
      if (!byKey.hasOwnProperty(k)) continue;
      matchedKeys[k] = true;
      var info = byKey[k];
      var currentStu = String(row[stuIdx] || '').trim();
      var sheetRowNum = i + 2; // 헤더 제외, 1-based
      sheet.getRange(sheetRowNum, stuIdx + 1).setValue('불가'); // E: stu_member = 불가
      sheet.getRange(sheetRowNum, 26).setValue(info.reason);    // Z: stu_reason (불가사유)
      sheet.getRange(sheetRowNum, 27).setValue(info.detail);    // AA: stu_reason_detail (상세)
      updated++;
      historyEntries.push({
        action: 'AUCTION_CHANGE_CANCEL',
        item_id: String(row[idIdx] || ''),
        member_id: String(row[memberIdIdx] || ''),
        member_name: String(row[mNameIdx] || ''),
        field_name: 'stu_member',
        from_value: currentStu,
        to_value: '불가',
        note: 'auction1 불가확인 사유=' + info.reason + (info.detail ? (' / ' + info.detail) : ''),
        trigger_type: 'auction-manager',
        approved_by: 'manager',
        status: 'DONE',
      });
    }

    SpreadsheetApp.flush();

    if (historyEntries.length > 0 && typeof writeItemHistoryBatch_ === 'function') {
      writeItemHistoryBatch_(historyEntries);
    }

    return {
      success: true,
      updated: updated,
      matched_keys: Object.keys(matchedKeys).length,
      unmatched: keyList.length - Object.keys(matchedKeys).length,
      history: historyEntries.length,
      message: updated + '건 불가 처리 완료'
    };
  } catch (e) {
    Logger.log('[uploadChangeCancel] 오류: ' + e.toString());
    return { success: false, message: String(e), updated: 0 };
  }
}

/**
 * [돈클/낙찰] 크롤러 매니저 "MAPS 낙찰 처리" — 3키 매칭 물건의 stu_member='낙찰' 세팅 + 낙찰가 적립
 *  · 불가 경로(uploadChangeCancel)와 평행. items: [{sakun_no, bid_date|in-date, court, maegak_price(낙찰가), buyer}]
 *  · stu_member='낙찰' setValue → writeItemHistoryBatch_(to_value='낙찰') → ②적립훅이 members_item_status 낙찰행 생성
 *  · 적립 후 setMisWinPrice_로 그 행의 win_price(낙찰가) 채움
 */
function uploadWinningBids(items) {
  try {
    if (!Array.isArray(items) || items.length === 0) return { success: false, message: '항목이 비어 있습니다.', updated: 0 };
    var normDate = function (v) { return String(v || '').replace(/[^0-9]/g, ''); };
    var keyOf = function (s, d, c) { return String(s || '').trim() + '|' + normDate(d) + '|' + String(c || '').trim(); };
    var byKey = {};
    items.forEach(function (it) {
      if (!it) return;
      var sakun = String(it.sakun_no || '').trim(); if (!sakun) return;
      byKey[keyOf(sakun, it.bid_date || it['in-date'] || it.bid_datetime_2, it.court)] = {
        win: String(it.maegak_price || it.win_price || '').replace(/[^0-9]/g, ''),  // 낙찰가 숫자만
        buyer: String(it.buyer || '').trim()
      };
    });
    var keyList = Object.keys(byKey);
    if (keyList.length === 0) return { success: false, message: '유효한 항목(사건번호)이 없습니다.', updated: 0 };

    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음', updated: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: 'items 비어있음', updated: 0 };

    var idIdx = ITEM_HEADERS.indexOf('id'), sakunIdx = ITEM_HEADERS.indexOf('sakun_no'),
        courtIdx = ITEM_HEADERS.indexOf('court'), inDateIdx = ITEM_HEADERS.indexOf('in-date'),
        stuIdx = ITEM_HEADERS.indexOf('stu_member'), memberIdIdx = ITEM_HEADERS.indexOf('member_id'),
        mNameIdx = ITEM_HEADERS.indexOf('m_name');

    var data = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();
    var historyEntries = [], winByMI = {}, updated = 0, matched = {};
    for (var i = 0; i < data.length; i++) {
      var row = data[i]; var k = keyOf(row[sakunIdx], row[inDateIdx], row[courtIdx]);
      if (!byKey.hasOwnProperty(k)) continue;
      matched[k] = true;
      var info = byKey[k], cur = String(row[stuIdx] || '').trim(), rn = i + 2;
      sheet.getRange(rn, stuIdx + 1).setValue('낙찰');  // E: stu_member='낙찰'
      updated++;
      var itemId = String(row[idIdx] || ''), memberId = String(row[memberIdIdx] || '');
      if (memberId && info.win) winByMI[memberId + '|' + itemId] = info.win;
      historyEntries.push({
        action: 'AUCTION_WINNING', item_id: itemId, member_id: memberId, member_name: String(row[mNameIdx] || ''),
        field_name: 'stu_member', from_value: cur, to_value: '낙찰',
        note: 'auction1 낙찰 낙찰가=' + info.win + (info.buyer ? (' / 매수인 ' + info.buyer) : ''),
        trigger_type: 'auction-manager', approved_by: 'manager', status: 'DONE'
      });
    }
    SpreadsheetApp.flush();

    // 적립 훅 발화 (낙찰 행 생성) → 그 뒤 win_price 채움
    if (historyEntries.length > 0 && typeof writeItemHistoryBatch_ === 'function') writeItemHistoryBatch_(historyEntries);
    var winFilled = 0;
    Object.keys(winByMI).forEach(function (mi) {
      var p = mi.split('|');
      if (setMisWinPrice_(p[0], p[1], winByMI[mi])) winFilled++;
    });

    return {
      success: true, updated: updated, win_filled: winFilled, history: historyEntries.length,
      matched_keys: Object.keys(matched).length, unmatched: keyList.length - Object.keys(matched).length,
      message: updated + '건 낙찰 처리 완료'
    };
  } catch (e) {
    Logger.log('[uploadWinningBids] 오류: ' + e.toString());
    return { success: false, message: String(e), updated: 0 };
  }
}

/** [돈클] members_item_status의 (member,item,낙찰) 행에 win_price(낙찰가) 기록 */
function setMisWinPrice_(memberId, itemId, winPrice) {
  try {
    var sheet = ensureMembersItemStatusSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return false;
    var hits = sheet.getRange(2, 6, last - 1, 1).createTextFinder(String(itemId)).matchEntireCell(true).findAll();
    for (var h = 0; h < hits.length; h++) {
      var rn = hits[h].getRow();
      var rr = sheet.getRange(rn, 1, 1, MIS_HEADERS.length).getValues()[0];
      if (String(rr[1]) === String(memberId) && String(rr[9]) === '낙찰') {
        sheet.getRange(rn, 14).setValue(winPrice); // N: win_price (idx13 → 14열)
        return true;
      }
    }
    return false;
  } catch (e) {
    Logger.log('[setMisWinPrice_] 오류: ' + e.toString());
    return false;
  }
}

/**
 * [돈클] 회원별 물건상태 카운트 — members_item_status GROUP BY (member_id, status)
 * 회원관리 그리드 추천/입찰/낙찰/불가 카운트 컬럼용. 클라이언트 google.script.run 호출.
 * @returns {Object} { member_id: {추천,입찰,낙찰,불가} }
 */
function getDonkleMemberCounts() {
  try {
    const sheet = ensureMembersItemStatusSheet_();
    const last = sheet.getLastRow();
    const out = {};
    if (last >= 2) {
      const data = sheet.getRange(2, 1, last - 1, MIS_HEADERS.length).getValues();
      for (let i = 0; i < data.length; i++) {
        const mid = String(data[i][1] || '').trim();   // member_id
        const st = String(data[i][9] || '').trim();     // status
        if (!mid || !st) continue;
        if (!out[mid]) out[mid] = { '추천': 0, '입찰': 0, '낙찰': 0, '불가': 0 };
        if (out[mid][st] != null) out[mid][st]++;
      }
    }
    return out;
  } catch (e) {
    Logger.log('[getDonkleMemberCounts] ' + e.toString());
    return {};
  }
}

// ===== [돈클 ⑦] 회원별 물건상태 탭 CRUD (회원 상세화면용) =====
/** 회원의 members_item_status 행들 (recorded_at 내림차순, 최근 위) */
function getMemberItemStatusRows(memberId) {
  try {
    var tid = String(memberId == null ? '' : memberId).trim();
    if (!tid) return [];
    var sheet = ensureMembersItemStatusSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return [];
    var tz = Session.getScriptTimeZone();
    var data = sheet.getRange(2, 1, last - 1, MIS_HEADERS.length).getValues();
    var rows = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1] == null ? '' : data[i][1]).trim() !== tid) continue;
      var o = {};
      for (var j = 0; j < MIS_HEADERS.length; j++) {
        var v = data[i][j];
        // Date → 문자열로 안전 직렬화 (google.script.run 페이로드 안정화)
        o[MIS_HEADERS[j]] = (v instanceof Date)
          ? Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss")
          : (v == null ? '' : v);
      }
      rows.push(o);
    }
    rows.sort(function (a, b) { return String(b.recorded_at || '').localeCompare(String(a.recorded_at || '')); });
    return rows;
  } catch (e) { Logger.log('[getMemberItemStatusRows] ' + e.toString()); return []; }
}
/** [회원화면] 토큰으로 members_item_status 행 조회 — 회원 물건이력(추천/입찰/낙찰/불가) 연동 */
function getMemberItemStatusRowsByToken(token) {
  try {
    var member = getMemberByToken(token);
    if (!member || !member.member_id) return { success: false, list: [] };
    var rows = getMemberItemStatusRows(String(member.member_id));
    return { success: true, list: rows };
  } catch (e) { Logger.log('[getMemberItemStatusRowsByToken] ' + e.toString()); return { success: false, list: [], message: String(e) }; }
}
/** mis_id 행 삭제 (사람이 UI에서 수동) */
function deleteMisRow(misId) {
  try {
    const sheet = ensureMembersItemStatusSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return { success: false, message: '데이터 없음' };
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(misId)) {
        const rn = i + 2;
        if (last - 1 <= 1) sheet.getRange(rn, 1, 1, MIS_HEADERS.length).clearContent(); // 마지막 1행이면 내용만
        else sheet.deleteRow(rn);
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return { success: false, message: 'mis_id 없음' };
  } catch (e) { return { success: false, message: String(e) }; }
}
/** mis_id 행 필드 수정 (updates = {필드명:값}) */
function updateMisRow(misId, updates) {
  try {
    const sheet = ensureMembersItemStatusSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return { success: false, message: '데이터 없음' };
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(misId)) {
        const rn = i + 2;
        Object.keys(updates || {}).forEach(k => {
          const ci = MIS_HEADERS.indexOf(k);
          if (ci >= 0 && k !== 'mis_id') sheet.getRange(rn, ci + 1).setValue(updates[k]);
        });
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return { success: false, message: 'mis_id 없음' };
  } catch (e) { return { success: false, message: String(e) }; }
}
/** 수동 행 추가 (사람이 UI에서 직접 추가). fields = {status,in_date,sakun_no,court,myeongui,win_price,est_interior,est_resale, item_id, m_name, m_name_id} */
function addMisRow(memberId, fields) {
  try {
    if (!memberId) return { success: false, message: 'member_id 없음' };
    const f = fields || {};
    const sheet = ensureMembersItemStatusSheet_();
    const now = new Date();
    const misId = 'MIS' + now.getTime() + Math.floor(Math.random() * 1000);
    // event_date: 입력값 우선, 없으면 입찰=in_date / 그 외=now
    let eventDate = String(f.event_date || '');
    if (!eventDate) eventDate = (String(f.status || '') === '입찰') ? _inDateToIso_(f.in_date) : now.toISOString();
    const row = [
      misId,                              // A: mis_id
      String(memberId),                   // B: member_id
      String(f.m_name || ''),             // C: m_name
      String(f.m_name_id || ''),          // D: m_name_id
      String(f.myeongui || ''),           // E: myeongui
      String(f.item_id || ''),            // F: item_id
      String(f.in_date || ''),            // G: in_date
      String(f.sakun_no || ''),           // H: sakun_no
      String(f.court || ''),              // I: court
      String(f.status || ''),             // J: status
      now.toISOString(),                  // K: recorded_at
      String(f.lowest_price || ''),       // L: lowest_price
      String(f.bid_price || ''),          // M: bid_price
      String(f.win_price || ''),          // N: win_price
      String(f.est_interior || ''),       // O: est_interior
      String(f.est_resale || ''),         // P: est_resale
      eventDate                           // Q: event_date
    ];
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return { success: true, mis_id: misId };
  } catch (e) { return { success: false, message: String(e) }; }
}

// ===== [돈클] 추천물건관리 화면(rec-management.html) 데이터 — 단일 호출 =====
/**
 * 추천 큐 + 월별 현황 1회 로드용. IIFE(window.REC)에서 google.script.run 으로 호출.
 *  - members   : 돈클 회원 로스터 (class_type='돈클') + 상태/보류해제일/회원비고(note1) + 구분(items_youngdo 파생)
 *  - delivered : members_item_status status='추천' (전달완료 추천 원장) → 큐 hist + 추천완료 표시 + 달력 완료
 *  - wait      : items stu_member='추천' & chuchen_state≠'전달완료' (전달대기) — 물건추천비고=items.note
 *  - candidates: items in-date≥오늘 (추천하기 모달 후보; 상품/미정/추천만 선택가능)
 * @return {{success:boolean, today:string, members:Array, delivered:Array, wait:Array, candidates:Array}}
 */
function getRecManagementData() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var todayNum = parseInt(Utilities.formatDate(now, tz, 'yyyyMMdd'), 10);

    var toIso = function (v) {
      if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      var s = String(v == null ? '' : v).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      var d = s.replace(/[^0-9]/g, '');
      if (d.length >= 8) return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
      if (d.length === 6) return '20' + d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4, 6);
      return '';
    };
    var isoToNum = function (iso) { return iso ? parseInt(iso.replace(/-/g, ''), 10) : 0; };

    // ── 1) 회원 로스터 (돈클) ──
    var members = readAllMembersNew();
    var classes = readAllClasses();
    var classMap = {};
    classes.forEach(function (c) { classMap[String(c.class_id)] = c; });

    var mSheet = ss.getSheetByName(DB_MEMBERS_SHEET_NAME);
    var dc = _ensureMemberStatusCols_(mSheet); // {statusCol, holdCol, groupCol} (1-based)
    var lastRowM = mSheet.getLastRow();
    var statusMap = {}, holdMap = {}, groupMap = {};
    if (lastRowM >= 2) {
      var idCol = mSheet.getRange(2, 1, lastRowM - 1, 1).getValues();
      var sCol = mSheet.getRange(2, dc.statusCol, lastRowM - 1, 1).getValues();
      var hCol = mSheet.getRange(2, dc.holdCol, lastRowM - 1, 1).getValues();
      var gCol = mSheet.getRange(2, dc.groupCol, lastRowM - 1, 1).getValues();
      for (var i = 0; i < idCol.length; i++) {
        var mid0 = String(idCol[i][0]).trim();
        if (!mid0) continue;
        statusMap[mid0] = String(sCol[i][0] || '').trim();
        holdMap[mid0] = String(hCol[i][0] || '').trim();
        groupMap[mid0] = String(gCol[i][0] || '').trim().toUpperCase();
      }
    }

    var roster = [];
    members.forEach(function (m) {
      var cls = classMap[String(m.class_id)] || {};
      if (String(cls.class_type || '').trim() !== '돈클') return; // 돈클만
      var mid = String(m.member_id).trim();
      roster.push({
        id: mid,
        name: String(m.member_name || ''),
        phone: String(m.phone || ''),
        classType: '돈클',
        grade: String(cls.class_grade || ''),
        className: String(cls.class_name || ''),
        note: String(m.note1 || ''),
        status: statusMap[mid] || '',
        hold: holdMap[mid] || '',
        group: (groupMap[mid] === 'A' || groupMap[mid] === 'B') ? groupMap[mid] : '',
        telegram: String(m.telegram_enabled || '').toUpperCase() === 'Y',
        sub: ''
      });
    });

    // ── 2) items 스캔 → candidates + wait + 구분(youngdo) 집계 ──
    var iSheet = ss.getSheetByName(DB_SHEET_NAME);
    var candidates = [], wait = [];
    var youngdoByMember = {};
    var mnoteById = {};   // item_id → members_note (회원전달내용)
    if (iSheet && iSheet.getLastRow() >= 2) {
      var IX = {};
      ITEM_HEADERS.forEach(function (h, j) { IX[h] = j; });
      var nRows = iSheet.getLastRow() - 1;
      var idata = iSheet.getRange(2, 1, nRows, ITEM_HEADERS.length).getValues();
      var mnCol = _ensureItemMembersNoteCol_(iSheet);
      var mnVals = iSheet.getRange(2, mnCol, nRows, 1).getValues();
      idata.forEach(function (r, ri) {
        var iso = toIso(r[IX['in-date']]);
        var num = isoToNum(iso);
        var stu = String(r[IX['stu_member']] || '').trim();
        var cs = String(r[IX['chuchen_state']] || '').trim();
        var mid = String(r[IX['member_id']] || '').trim();
        var youngdo = String(r[IX['items_youngdo']] || '').trim();
        var mnote = String((mnVals[ri] && mnVals[ri][0]) || '');
        mnoteById[String(r[IX['id']])] = mnote;
        if (mid && (youngdo === '돈클수익' || youngdo === '돈클월세')) {
          youngdoByMember[mid] = youngdoByMember[mid] || { '돈클수익': 0, '돈클월세': 0 };
          youngdoByMember[mid][youngdo]++;
        }
        if (num && num >= todayNum) {
          candidates.push({
            id: String(r[IX['id']]), inDate: iso, sakun_no: String(r[IX['sakun_no']] || ''),
            court: String(r[IX['court']] || ''), youngdo: youngdo, stu: stu,
            member: String(r[IX['m_name']] || ''), memberId: mid,
            mgr: String(r[IX['m_name_id']] || ''), membersNote: mnote
          });
        }
        if (stu === '추천' && cs !== '전달완료') {
          wait.push({
            id: String(r[IX['id']]), memberId: mid, name: String(r[IX['m_name']] || ''),
            sakun_no: String(r[IX['sakun_no']] || ''), court: String(r[IX['court']] || ''),
            inDate: iso, regDate: toIso(r[IX['reg_date']]), by: String(r[IX['m_name_id']] || ''),
            youngdo: youngdo, membersNote: mnote
          });
        }
      });
    }

    // 구분 파생: 회원별 우세 용도 (돈클월세 > 돈클수익 → 월세, 아니면 수익)
    roster.forEach(function (m) {
      var y = youngdoByMember[m.id];
      if (y) m.sub = (y['돈클월세'] > y['돈클수익']) ? '월세' : '수익';
    });

    // ── 3) members_item_status status='추천' → delivered ──
    var delivered = [];
    var misSheet = ensureMembersItemStatusSheet_();
    if (misSheet.getLastRow() >= 2) {
      var SX = {};
      MIS_HEADERS.forEach(function (h, j) { SX[h] = j; });
      var sdata = misSheet.getRange(2, 1, misSheet.getLastRow() - 1, MIS_HEADERS.length).getValues();
      sdata.forEach(function (r) {
        if (String(r[SX['status']] || '').trim() !== '추천') return;
        var itemId = String(r[SX['item_id']] || '').trim();
        delivered.push({
          memberId: String(r[SX['member_id']] || '').trim(),
          name: String(r[SX['m_name']] || ''),
          itemId: itemId,
          sakun_no: String(r[SX['sakun_no']] || ''),
          court: String(r[SX['court']] || ''),
          inDate: toIso(r[SX['in_date']]),
          eventDate: toIso(r[SX['event_date']]) || toIso(r[SX['recorded_at']]),
          by: String(r[SX['m_name_id']] || ''),
          membersNote: (mnoteById[itemId] != null ? mnoteById[itemId] : '')
        });
      });
    }

    return { success: true, today: todayStr, groupAnchor: getDonkleGroupAnchor_(), members: roster, delivered: delivered, wait: wait, candidates: candidates };
  } catch (e) {
    Logger.log('[getRecManagementData] ' + e.toString());
    return { success: false, message: String(e), members: [], delivered: [], wait: [], candidates: [] };
  }
}

/** [돈클] 돈클 회원 member_id 목록 (class_type='돈클'). 대시보드 카드가 돈클 추천만 카운팅하도록 필터용 */
function getDonkleMemberIds() {
  try {
    var members = readAllMembersNew();
    var classes = readAllClasses();
    var classMap = {};
    classes.forEach(function (c) { classMap[String(c.class_id)] = String(c.class_type || '').trim(); });
    var ids = [];
    members.forEach(function (m) {
      if (classMap[String(m.class_id)] === '돈클') ids.push(String(m.member_id).trim());
    });
    return ids;
  } catch (e) { Logger.log('[getDonkleMemberIds] ' + e.toString()); return []; }
}

/**
 * [돈클] 대시보드 '돈클 추천요청 현황' — telegram_requests 히스토리 단일 출처 집계.
 *  전달대기 = stu_member→'추천' FIELD_CHANGE 이벤트 중 (회원,물건) 아직 전달완료(chuchen_state→전달완료) 안 온 것. 날짜=추천 시각.
 *  추천완료 = chuchen_state→'전달완료' FIELD_CHANGE 이벤트. 날짜=그 시각.
 *  돈클 회원(member_id) 한정. 최근 7일(오늘 포함) 이벤트만 반환. 담당(m_name_id)은 items에서 조인.
 *  반환 events 를 클라이언트가 날짜·담당·종류로 버킷팅(드릴다운/담당필터 그대로 재사용).
 *  ★ items가 아니라 히스토리를 출처로 쓰는 이유: items는 물건당 member_id 1개라 같은 물건을
 *    다른 회원에게 재추천하면 이전 회원 추천요청이 소실됨. 히스토리는 (회원,물건,시각) 별도 행이라 안전.
 */
function getDonkleRequestDashboard() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
    if (!reqSheet || reqSheet.getLastRow() < 2) return { days: [], events: [], managers: [] };

    // 돈클 회원 id 셋
    var donkleSet = {};
    getDonkleMemberIds().forEach(function (id) { donkleSet[String(id).trim()] = true; });

    // itemId → m_name_id(담당) 맵
    var mgrMap = {};
    var iSheet = ss.getSheetByName(DB_SHEET_NAME);
    if (iSheet && iSheet.getLastRow() > 1) {
      var iRows = iSheet.getRange(2, 1, iSheet.getLastRow() - 1, 6).getValues();
      iRows.forEach(function (ir) { var id = String(ir[0] || '').trim(); if (id) mgrMap[id] = String(ir[5] || '').trim(); });
    }

    var tz = Session.getScriptTimeZone();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var winStart = new Date(today); winStart.setDate(today.getDate() - 6);

    var lastRow = reqSheet.getLastRow();
    var totalCols = Math.min(reqSheet.getMaxColumns(), 16);
    var rows = reqSheet.getRange(2, 1, lastRow - 1, totalCols).getValues();
    // [0]req_id [1]requested_at [2]action [3]status [4]item_id [5]member_id ...
    // [11]from_value [12]to_value [13]field_name [14]trigger_type

    function parseDate(v) {
      if (!v) return null;
      if (v instanceof Date) return v;
      var s = String(v).trim();
      if (/^\d{6} \d{6}$/.test(s)) {
        return new Date(2000 + parseInt(s.substring(0, 2), 10), parseInt(s.substring(2, 4), 10) - 1,
          parseInt(s.substring(4, 6), 10), parseInt(s.substring(7, 9), 10),
          parseInt(s.substring(9, 11), 10), parseInt(s.substring(11, 13), 10));
      }
      var d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    // 전달완료(회원|물건) 키 — 전체 기간 스캔(대기 판정용). 추천/완료 이벤트는 윈도우 내만 수집.
    // ★ 전달완료(=추천완료)는 2경로: ① 수작업 FIELD_CHANGE chuchen_state→전달완료
    //    ② 텔레그램 전달 TELEGRAM_SENT note='card' (같은 행에 chuchen_state→전달완료 태그 포함, [TelegramService.js])
    //   → action 으로 거르지 말고 (텔레전달=TELEGRAM_SENT 이므로) 두 경로 모두 인정. getAutoApprovalStats recommend(tele+web)와 동일.
    var deliveredKey = {};
    var recEvents = [], doneEvents = [];
    rows.forEach(function (row) {
      var itemId = String(row[4] || '').trim();
      var memberId = String(row[5] || '').trim();
      if (!itemId || !memberId || !donkleSet[memberId]) return;
      var action = String(row[2] || '').trim();
      var note = String(row[8] || '').trim();
      var toVal = String(row[12] || '').trim();
      var fieldName = String(row[13] || '').trim();
      var key = memberId + '|' + itemId;
      var isDelivery = (action === 'TELEGRAM_SENT' && note === 'card')
        || (fieldName === 'chuchen_state' && toVal === '전달완료');
      var isRecommend = (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && toVal === '추천');
      if (isDelivery) {
        deliveredKey[key] = true;
        var dd = parseDate(row[1]);
        if (dd && dd >= winStart) doneEvents.push({ d: dd, itemId: itemId, key: key });
      } else if (isRecommend) {
        var dr = parseDate(row[1]);
        if (dr && dr >= winStart) recEvents.push({ d: dr, itemId: itemId, key: key });
      }
    });

    var events = [], mgrSet = {};
    function emit(d, kind, itemId) {
      var mgr = mgrMap[itemId] || '';
      if (mgr) mgrSet[mgr] = true;
      events.push({ date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'), kind: kind, itemId: itemId, manager: mgr });
    }
    recEvents.forEach(function (e) { if (!deliveredKey[e.key]) emit(e.d, 'wait', e.itemId); });
    doneEvents.forEach(function (e) { emit(e.d, 'done', e.itemId); });

    // ── 입찰등록(전일): members_item_status status='입찰' (매일 오전 accrueBidsDaily가 in_date<오늘 적립) ──
    //   ★날짜 기준 = recorded_at(배치가 돈 날 = 적립일). 배치는 in_date<오늘(전일까지)의 입찰을 그날 적립하므로
    //   "그날 배치가 등록한 전일 입찰 건수"가 그 날짜 행에 잡힘. (event_date=매각기일은 대부분 7일보다 과거라 부적합.)
    //   ※ 과거 백필분은 백필 실행일에 몰림(일시적 스파이크) — 윈도우 밖으로 자연히 빠짐.
    try {
      var misSheet = ensureMembersItemStatusSheet_();
      if (misSheet.getLastRow() >= 2) {
        var SX = {}; MIS_HEADERS.forEach(function (h, j) { SX[h] = j; });
        var sdata = misSheet.getRange(2, 1, misSheet.getLastRow() - 1, MIS_HEADERS.length).getValues();
        sdata.forEach(function (r) {
          if (String(r[SX['status']] || '').trim() !== '입찰') return;
          var mid = String(r[SX['member_id']] || '').trim();
          if (!mid || !donkleSet[mid]) return;
          var bd = parseDate(r[SX['recorded_at']]);
          if (bd && bd >= winStart) emit(bd, 'bid', String(r[SX['item_id']] || '').trim());
        });
      }
    } catch (eMis) { Logger.log('[getDonkleRequestDashboard] MIS 입찰 스캔: ' + eMis); }

    var days = [];
    for (var i = 0; i < 7; i++) {
      var dx = new Date(today); dx.setDate(today.getDate() - i);
      days.push(Utilities.formatDate(dx, tz, 'yyyy-MM-dd'));
    }
    return { days: days, events: events, managers: Object.keys(mgrSet).sort() };
  } catch (e) {
    Logger.log('[getDonkleRequestDashboard] ' + e.toString());
    return { days: [], events: [], managers: [], error: String(e) };
  }
}

/**
 * members 시트 끝에 회원 상태 컬럼(status, hold) 보장 — 없으면 생성. {statusCol, holdCol}(1-based)
 * 범용(모든 회원 종목 공용). 레거시 donkle_status/donkle_hold 는 이름만 status/hold 로 마이그레이션(데이터 보존).
 */
function _ensureMemberStatusCols_(sheet) {
  var maxC = sheet.getMaxColumns();
  var headerRow = sheet.getRange(1, 1, 1, maxC).getValues()[0];
  var find = function (name) {
    for (var i = 0; i < headerRow.length; i++) if (String(headerRow[i]).trim() === name) return i + 1;
    return -1;
  };
  // 레거시 donkle_* → status/hold 헤더명 변경 (열 위치/데이터 유지)
  var leg;
  if ((leg = find('donkle_status')) > 0) { sheet.getRange(1, leg).setValue('status'); headerRow[leg - 1] = 'status'; }
  if ((leg = find('donkle_hold')) > 0) { sheet.getRange(1, leg).setValue('hold'); headerRow[leg - 1] = 'hold'; }
  var statusCol = find('status');
  var holdCol = find('hold');
  var groupCol = find('rec_group');   // 추천 A/B 그룹
  var lastCol = sheet.getLastColumn();
  var addCol = function (name) {
    var col = lastCol + 1;
    if (sheet.getMaxColumns() < col) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    sheet.getRange(1, col).setValue(name);
    lastCol = col;
    return col;
  };
  if (statusCol < 0) statusCol = addCol('status');
  if (holdCol < 0) holdCol = addCol('hold');
  if (groupCol < 0) groupCol = addCol('rec_group');
  return { statusCol: statusCol, holdCol: holdCol, groupCol: groupCol };
}

// ===== [돈클] 추천 A/B 그룹 격주 로테이션 =====
/** 회원 추천그룹(A/B) 저장 (members 끝 rec_group). group='' 면 미지정(기존 14일 로직) */
function setRecGroup(memberId, group) {
  try {
    var g = String(group || '').trim().toUpperCase();
    if (g !== 'A' && g !== 'B') g = '';
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
    var dc = _ensureMemberStatusCols_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '회원 없음' };
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(memberId).trim()) {
        sheet.getRange(i + 2, dc.groupCol).setValue(g);
        SpreadsheetApp.flush();
        return { success: true, group: g };
      }
    }
    return { success: false, message: 'member_id 없음' };
  } catch (e) { return { success: false, message: String(e) }; }
}

/** 그룹 앵커(A주 월요일 ISO 'YYYY-MM-DD') 조회 — 없으면 '' */
function getDonkleGroupAnchor_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('donkle_group_anchor') || ''); }
  catch (e) { return ''; }
}
/** 그룹 앵커 저장 — mondayIso = 'A그룹 주'의 월요일 날짜 (프론트에서 계산해 전달) */
function setDonkleGroupAnchor(mondayIso) {
  try {
    PropertiesService.getScriptProperties().setProperty('donkle_group_anchor', String(mondayIso || ''));
    return { success: true };
  } catch (e) { return { success: false, message: String(e) }; }
}

/** 물건 추천비고 저장 — items.note (단일 필드). 추천물건관리 우측패널에서 호출 */
function setItemNote(itemId, note) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '물건 없음' };
    var noteCol = ITEM_HEADERS.indexOf('note') + 1;
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(itemId).trim()) {
        sheet.getRange(i + 2, noteCol).setValue(String(note || ''));
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return { success: false, message: 'item_id 없음' };
  } catch (e) { return { success: false, message: String(e) }; }
}

/**
 * items 시트 끝에 'members_note'(회원전달내용) 컬럼 보장 — ITEM_HEADERS는 건드리지 않고 헤더명으로 관리.
 * (ITEM_HEADERS.length 기반 일반 reads를 깨지 않기 위해 by-name 방식). 1-based 컬럼 반환.
 */
function _ensureItemMembersNoteCol_(sheet) {
  var maxC = sheet.getMaxColumns();
  var headerRow = sheet.getRange(1, 1, 1, maxC).getValues()[0];
  for (var i = 0; i < headerRow.length; i++) if (String(headerRow[i]).trim() === 'members_note') return i + 1;
  var col = sheet.getLastColumn() + 1;
  if (sheet.getMaxColumns() < col) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
  sheet.getRange(1, col).setValue('members_note');
  return col;
}

/** 회원전달내용 저장 — items.members_note. 추천물건관리 우측패널 "회원전달내용" 박스에서 호출 */
function setItemMembersNote(itemId, value) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '물건 없음' };
    var col = _ensureItemMembersNoteCol_(sheet);
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(itemId).trim()) {
        sheet.getRange(i + 2, col).setValue(String(value || ''));
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return { success: false, message: 'item_id 없음' };
  } catch (e) { return { success: false, message: String(e) }; }
}

/** items.members_note(회원전달내용) 단건 조회 — 텔레그램/카카오 발송 시 [물건전달사항] 삽입용 */
function getItemMembersNote_(itemId) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';
    var col = _ensureItemMembersNoteCol_(sheet);
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(itemId).trim()) {
        return String(sheet.getRange(i + 2, col).getValue() || '');
      }
    }
    return '';
  } catch (e) { Logger.log('[getItemMembersNote_] ' + e); return ''; }
}

/** 돈클 회원 상태(진행/보류/종료) + 보류해제일 저장 (members 끝 donkle_status/donkle_hold) */
function setDonkleMemberStatus(memberId, status, hold) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_MEMBERS_SHEET_NAME);
    var dc = _ensureMemberStatusCols_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '회원 없음' };
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(memberId).trim()) {
        sheet.getRange(i + 2, dc.statusCol).setValue(String(status || ''));
        sheet.getRange(i + 2, dc.holdCol).setValue(String(hold || ''));
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return { success: false, message: 'member_id 없음' };
  } catch (e) { return { success: false, message: String(e) }; }
}

/**
 * [돈클] 추천하기 — 선택 물건들을 해당 회원 앞으로 '추천' 등록 (전달대기).
 *  · items: stu_member→'추천', member_id/m_name 세팅. 기존이 '추천'이 아니었으면 chuchen_state/date/bid_datetime_2 클리어(전달대기 보장).
 *  · 적립(members_item_status)은 전달완료(chuchen→전달완료) 시점에 이뤄지므로 여기선 안 함.
 * @return {{success:boolean, count:number}}
 */
function registerDonkleRecommendation(memberId, memberName, itemIds) {
  try {
    if (!itemIds || !itemIds.length) return { success: false, message: '선택된 물건이 없습니다.' };
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '물건 없음' };
    var allIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    var batchTs = 'REC' + (new Date().getTime());
    var historyEntries = [];
    var cnt = 0;
    itemIds.forEach(function (id) {
      var idx = allIds.findIndex(function (v) { return String(v) === String(id); });
      if (idx < 0) return;
      var rowNum = idx + 2;
      var oldStu = String(sheet.getRange(rowNum, 5).getValue() || '').trim();
      var oldMid = String(sheet.getRange(rowNum, 9).getValue() || '').trim();
      var newMid = String(memberId || ''), newMname = String(memberName || '');
      sheet.getRange(rowNum, 5).setValue('추천');                    // E: stu_member
      sheet.getRange(rowNum, 9).setValue(newMid);                    // I: member_id
      sheet.getRange(rowNum, 7).setValue(newMname);                  // G: m_name
      if (oldStu !== '추천') {
        sheet.getRange(rowNum, 17).setValue(''); // Q: chuchen_state
        sheet.getRange(rowNum, 18).setValue(''); // R: chuchen_date
        sheet.getRange(rowNum, 20).setValue(''); // T: bid_datetime_2
      }
      // [핵심] 정상 수정 경로와 동일하게 히스토리(FIELD_CHANGE) 기록 → telegram_requests에 추천요청 시각 남김
      if (oldStu !== '추천') historyEntries.push({ action: 'FIELD_CHANGE', item_id: String(id), member_id: newMid, member_name: newMname, field_name: 'stu_member', from_value: oldStu, to_value: '추천', trigger_type: 'web-rec', req_id: batchTs });
      if (oldMid !== newMid) historyEntries.push({ action: 'FIELD_CHANGE', item_id: String(id), member_id: newMid, member_name: newMname, field_name: 'member_id', from_value: oldMid, to_value: newMid, trigger_type: 'web-rec', req_id: batchTs });
      cnt++;
    });
    if (historyEntries.length > 0 && typeof writeItemHistoryBatch_ === 'function') writeItemHistoryBatch_(historyEntries);
    SpreadsheetApp.flush();
    return { success: true, count: cnt };
  } catch (e) { return { success: false, message: String(e) }; }
}

/**
 * 불가확인용 — 오늘 ~ 오늘+7일 입찰건의 (사건번호, 입찰일자, 법원) 3키 리스트 반환.
 * 매니저 「불가확인」 탭의 "MAPS 7일 리스트 불러오기" 버튼이 호출.
 * (js-app 의 handleDownload7DaysList 서버판 — 동일 필터/포맷)
 * @return {{success:boolean, cases:Array<{sakun_no,bid_date,court}>, count:number}}
 */
function get7DaysBugaList() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음', cases: [], count: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, cases: [], count: 0 };

    // 입찰일자(in-date, B열) 기준 — 오늘 포함 ~ 오늘+7일. (js-app '~7일 리스트 다운'과 동일 숫자비교)
    // YYMMDD 숫자 비교: 같은 8일 범위 내에선 월/연 경계도 안전(실재하지 않는 날짜는 데이터에 없음).
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var startNum = parseInt(Utilities.formatDate(now, tz, 'yyMMdd'), 10);                                  // 오늘 (포함)
    var endNum   = parseInt(Utilities.formatDate(new Date(now.getTime() + 7 * 86400000), tz, 'yyMMdd'), 10); // +7일 (포함)

    // B(in-date)/C(sakun_no)/D(court) 만 읽어 빠르게 처리
    var values = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
    var norm6 = function (v) {
      var s = (v instanceof Date)
        ? Utilities.formatDate(v, tz, 'yyMMdd')
        : String(v == null ? '' : v);
      var digits = s.replace(/[^0-9]/g, '');
      if (digits.length >= 8 && digits.slice(0, 2) === '20') digits = digits.slice(2); // 20YYMMDD → YYMMDD
      if (digits.length > 6) digits = digits.slice(-6);
      return digits;
    };

    var seen = {};
    var cases = [];
    for (var i = 0; i < values.length; i++) {
      var inDate = norm6(values[i][0]);
      var n = parseInt(inDate, 10);
      if (!n || n < startNum || n > endNum) continue;
      var sakun = String(values[i][1] == null ? '' : values[i][1]).trim();
      if (!sakun) continue;
      var court = String(values[i][2] == null ? '' : values[i][2]).trim();
      var key = sakun + '|' + inDate + '|' + court;
      if (seen[key]) continue;
      seen[key] = true;
      cases.push({ sakun_no: sakun, bid_date: inDate, court: court });
    }

    // 입찰일자(YYMMDD) 오름차순 — 오늘(가장 이른 입찰일)이 맨 위
    cases.sort(function (a, b) {
      if (a.bid_date < b.bid_date) return -1;
      if (a.bid_date > b.bid_date) return 1;
      return 0;
    });

    // window: 적용된 날짜창(진단용) — 누락 의심 시 start/end 확인
    return { success: true, cases: cases, count: cases.length, window: { start: startNum, end: endNum } };
  } catch (e) {
    Logger.log('[get7DaysBugaList] 오류: ' + e.toString());
    return { success: false, message: String(e), cases: [], count: 0 };
  }
}

/**
 * 매각확인용 — 오늘(입찰일자 in-date) 입찰건 리스트 반환.
 * 매니저 「매각」 탭이 호출 → 옥션 조회 후 매각대금/매수인 가져와 표시.
 * @return {{success, cases:[{item_id, sakun_no, bid_date(YYMMDD), court, our_bidprice, m_name}], count}}
 */
function getTodayMaegakList() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음', cases: [], count: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, cases: [], count: 0 };

    var tz = Session.getScriptTimeZone();
    var today = parseInt(Utilities.formatDate(new Date(), tz, 'yyMMdd'), 10); // 오늘만

    // A(id)/B(in-date)/C(sakun_no)/D(court)/H(bidprice)/G(m_name) 포함 위해 A~H 읽기
    var idIdx     = ITEM_HEADERS.indexOf('id');       // 0
    var inDateIdx = ITEM_HEADERS.indexOf('in-date');  // 1
    var sakunIdx  = ITEM_HEADERS.indexOf('sakun_no'); // 2
    var courtIdx  = ITEM_HEADERS.indexOf('court');    // 3
    var mNameIdx  = ITEM_HEADERS.indexOf('m_name');   // 6
    var bidIdx    = ITEM_HEADERS.indexOf('bidprice'); // 7
    var nCols = bidIdx + 1;
    var values = sheet.getRange(2, 1, lastRow - 1, nCols).getValues();

    var norm6 = function (v) {
      var s = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyMMdd') : String(v == null ? '' : v);
      var d = s.replace(/[^0-9]/g, '');
      if (d.length >= 8 && d.slice(0, 2) === '20') d = d.slice(2);
      if (d.length > 6) d = d.slice(-6);
      return d;
    };

    var seen = {};
    var cases = [];
    for (var i = 0; i < values.length; i++) {
      var inDate = norm6(values[i][inDateIdx]);
      if (!inDate || parseInt(inDate, 10) !== today) continue;
      var sakun = String(values[i][sakunIdx] == null ? '' : values[i][sakunIdx]).trim();
      if (!sakun) continue;
      var court = String(values[i][courtIdx] == null ? '' : values[i][courtIdx]).trim();
      var key = sakun + '|' + inDate + '|' + court;
      if (seen[key]) continue;
      seen[key] = true;
      cases.push({
        item_id: String(values[i][idIdx] == null ? '' : values[i][idIdx]),
        sakun_no: sakun,
        bid_date: inDate,
        court: court,
        our_bidprice: String(values[i][bidIdx] == null ? '' : values[i][bidIdx]).trim(),
        m_name: String(values[i][mNameIdx] == null ? '' : values[i][mNameIdx]).trim()
      });
    }

    return { success: true, cases: cases, count: cases.length, today: today };
  } catch (e) {
    Logger.log('[getTodayMaegakList] 오류: ' + e.toString());
    return { success: false, message: String(e), cases: [], count: 0 };
  }
}

/**
 * 진행사항 확인용 — 입찰일자(in-date)가 [from, to] (YYMMDD) 범위인 items 반환.
 * from/to 미지정 시 오늘~오늘. 필드: 입찰일자·사건번호·법원·입찰가·회원명.
 * @param {string} from6 YYMMDD (예 '260601')
 * @param {string} to6   YYMMDD
 * @return {{success, cases:[{item_id,sakun_no,bid_date,court,bidprice,m_name}], count, from, to}}
 */
// ===== 일일보고 매칭자료 영구 저장 (MAPS 스프레드시트 cc_daily 탭, 첫 저장 시 자동 생성) =====
var CC_DAILY_SHEET_NAME = 'cc_daily';
var CC_DAILY_HEADERS = ['date', 'item_id', 'sakun_no', 'court', 'bid_date', 'm_name', 'm_name_id',
  'm_name_id_disp', 'm_name_id_color', 'mid_member_id', 'bidprice', 'maegak_price', 'buyer',
  'state_kind', 'status', 'category', 'is_buga', 'detail', 'view_url', 'screenshot_path', 'stu_member', 'ts',
  'load_ts', 'match_ts'];

// 날짜 셀 정규화: 시트가 'YYYY-MM-DD'를 Date로 자동변환해도 항상 'yyyy-MM-dd' 문자열로 비교
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function ensureCcDailySheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(CC_DAILY_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CC_DAILY_SHEET_NAME);
    sh.setFrozenRows(1);
  }
  sh.getRange(1, 1, 1, CC_DAILY_HEADERS.length).setValues([CC_DAILY_HEADERS]);  // 헤더 항상 최신(열 추가 반영)
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');  // date 열 텍스트 고정(날짜 자동변환 방지)
  return sh;
}

// 매칭 결과 저장 (날짜별 upsert: payload에 들어온 날짜의 기존 행 삭제 후 재기록)
function saveProgressMatches(payload) {
  try {
    var items = (payload && payload.items) || [];
    if (!items.length) return { success: true, saved: 0 };
    var sh = ensureCcDailySheet_();
    var dates = {};
    items.forEach(function (it) { var d = String(it.date || '').trim(); if (d) dates[d] = true; });
    var last = sh.getLastRow();
    if (last >= 2) {
      var existing = sh.getRange(2, 1, last - 1, 1).getValues();   // date 열
      for (var r = existing.length - 1; r >= 0; r--) {
        if (dates[normDate_(existing[r][0])]) sh.deleteRow(r + 2);   // 같은 날짜 기존행 삭제(upsert)
      }
    }
    var rows = items.map(function (it) {
      return CC_DAILY_HEADERS.map(function (h) { return h === 'ts' ? new Date() : (it[h] == null ? '' : it[h]); });
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, CC_DAILY_HEADERS.length).setValues(rows);
    return { success: true, saved: rows.length, dates: Object.keys(dates) };
  } catch (e) {
    Logger.log('[saveProgressMatches] ' + e);
    return { success: false, message: String(e) };
  }
}

// 달력용 날짜별 집계 {date:{n,nak,miss,buga}}
function getProgressMatchSummary() {
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CC_DAILY_SHEET_NAME);
    if (!sh) return { success: true, summary: {} };
    var last = sh.getLastRow();
    if (last < 2) return { success: true, summary: {} };
    var dIdx = CC_DAILY_HEADERS.indexOf('date'), cIdx = CC_DAILY_HEADERS.indexOf('category'),
        ltIdx = CC_DAILY_HEADERS.indexOf('load_ts'), mtIdx = CC_DAILY_HEADERS.indexOf('match_ts');
    var vals = sh.getRange(2, 1, last - 1, CC_DAILY_HEADERS.length).getValues();
    var sum = {};
    vals.forEach(function (row) {
      var d = normDate_(row[dIdx]); if (!d) return;
      var c = String(row[cIdx] || '').trim();
      if (!sum[d]) sum[d] = { n: 0, nak: 0, miss: 0, buga: 0, unk: 0, load_ts: '', match_ts: '' };
      sum[d].n++;
      if (c === '낙찰') sum[d].nak++; else if (c === '미입찰') sum[d].miss++; else if (c === '불가') sum[d].buga++; else if (c === '확인불가') sum[d].unk++;
      var lt = String(row[ltIdx] || '').trim(), mt = String(row[mtIdx] || '').trim();
      if (lt && lt > sum[d].load_ts) sum[d].load_ts = lt;     // 최신(가장 늦은) 시각
      if (mt && mt > sum[d].match_ts) sum[d].match_ts = mt;
    });
    return { success: true, summary: sum };
  } catch (e) {
    Logger.log('[getProgressMatchSummary] ' + e);
    return { success: false, message: String(e), summary: {} };
  }
}

// 특정 날짜의 저장 행 반환 (복원용)
function getProgressMatchByDate(date) {
  try {
    var d0 = String(date || '').trim();
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CC_DAILY_SHEET_NAME);
    if (!sh) return { success: true, rows: [] };
    var last = sh.getLastRow();
    if (last < 2) return { success: true, rows: [] };
    var vals = sh.getRange(2, 1, last - 1, CC_DAILY_HEADERS.length).getValues();
    var rows = [];
    vals.forEach(function (row) {
      if (normDate_(row[0]) !== d0) return;
      var o = {};
      CC_DAILY_HEADERS.forEach(function (h, i) {
        o[h] = (h === 'ts' && row[i] instanceof Date)
          ? Utilities.formatDate(row[i], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : row[i];
      });
      o.is_buga = (String(o.is_buga) === 'true' || o.is_buga === true || String(o.state_kind).trim() === '불가');
      rows.push(o);
    });
    return { success: true, rows: rows };
  } catch (e) {
    Logger.log('[getProgressMatchByDate] ' + e);
    return { success: false, message: String(e), rows: [] };
  }
}

function getProgressList(from6, to6, statuses) {
  try {
    var tz = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyMMdd');
    // 상태 필터(다중) — 비어있으면 전체
    var statusSet = null;
    if (Array.isArray(statuses) && statuses.length) {
      statusSet = {};
      statuses.forEach(function (s) { statusSet[String(s || '').trim()] = true; });
    }
    var clean6 = function (v, dflt) {
      var d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
      if (d.length >= 8 && d.slice(0, 2) === '20') d = d.slice(2);
      if (d.length > 6) d = d.slice(-6);
      return d.length === 6 ? d : dflt;
    };
    var fromN = parseInt(clean6(from6, today), 10);
    var toN = parseInt(clean6(to6, today), 10);
    if (fromN > toN) { var t = fromN; fromN = toN; toN = t; }

    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음', cases: [], count: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, cases: [], count: 0, from: fromN, to: toN };

    var idIdx = ITEM_HEADERS.indexOf('id'), inDateIdx = ITEM_HEADERS.indexOf('in-date'),
        sakunIdx = ITEM_HEADERS.indexOf('sakun_no'), courtIdx = ITEM_HEADERS.indexOf('court'),
        stuIdx = ITEM_HEADERS.indexOf('stu_member'), mNameIdIdx = ITEM_HEADERS.indexOf('m_name_id'),
        mNameIdx = ITEM_HEADERS.indexOf('m_name'), bidIdx = ITEM_HEADERS.indexOf('bidprice'),
        memberIdIdx = ITEM_HEADERS.indexOf('member_id');
    var values = sheet.getRange(2, 1, lastRow - 1, memberIdIdx + 1).getValues();
    var norm6 = function (v) {
      var s = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyMMdd') : String(v == null ? '' : v);
      var d = s.replace(/[^0-9]/g, '');
      if (d.length >= 8 && d.slice(0, 2) === '20') d = d.slice(2);
      if (d.length > 6) d = d.slice(-6);
      return d;
    };
    // 담당자(m_name_id 닉네임/이름) → 강사 회원 매칭. MAPS와 동일: 닉네임 전역 우선, 그다음 본명.
    // (닉네임/본명을 한 맵에 섞으면 본명='전부쌤'인 다른 강사가 닉네임='전부쌤'을 덮을 수 있어 분리)
    var teacherByNick = {}, teacherByName = {}, tgById = {};
    try {
      (readAllMembers() || []).forEach(function (m) {
        var mid = String(m.member_id || '').trim();
        // 회원 텔레그램 사용여부 (MAPS T 뱃지와 동일: telegram_enabled === 'Y')
        if (mid) tgById[mid] = (String(m.telegram_enabled || '').toUpperCase() === 'Y') ? 'Y' : '';
        if (String(m.gubun || '').split(',').map(function (s) { return s.trim(); }).indexOf('강사') < 0) return;
        var nick = String(m.teacher_nickname || '').trim(), nm = String(m.member_name || '').trim();
        var col = String(m.teacher_color || '').trim();
        var info = { member_id: mid, display: (nick || nm),
                     color: /^#[0-9a-fA-F]{6}$/.test(col) ? col : '' };
        if (nick && !teacherByNick[nick]) teacherByNick[nick] = info;
        if (nm && !teacherByName[nm]) teacherByName[nm] = info;
      });
    } catch (e) { Logger.log('[getProgressList] 회원 매핑 실패: ' + e); }

    var seen = {}, cases = [];
    for (var i = 0; i < values.length; i++) {
      var d6 = norm6(values[i][inDateIdx]);
      var n = parseInt(d6, 10);
      if (!n || n < fromN || n > toN) continue;
      var stu = String(values[i][stuIdx] == null ? '' : values[i][stuIdx]).trim();
      if (statusSet && !statusSet[stu]) continue;  // 상태 다중 필터
      var sakun = String(values[i][sakunIdx] == null ? '' : values[i][sakunIdx]).trim();
      if (!sakun) continue;
      var court = String(values[i][courtIdx] == null ? '' : values[i][courtIdx]).trim();
      var key = sakun + '|' + d6 + '|' + court;
      if (seen[key]) continue;
      seen[key] = true;
      var midText = String(values[i][mNameIdIdx] == null ? '' : values[i][mNameIdIdx]).trim();  // 담당자(닉네임/이름)
      var tinfo = teacherByNick[midText] || teacherByName[midText] || null;   // 닉네임 우선, 본명 폴백
      var memberId = String(values[i][memberIdIdx] == null ? '' : values[i][memberIdIdx]).trim();  // 회원 id
      cases.push({
        item_id: String(values[i][idIdx] == null ? '' : values[i][idIdx]),
        sakun_no: sakun,
        bid_date: d6,
        court: court,
        stu_member: stu,
        bidprice: String(values[i][bidIdx] == null ? '' : values[i][bidIdx]).trim(),
        m_name_id: midText,                                   // 원본 텍스트
        m_name_id_disp: tinfo ? tinfo.display : midText,      // 표시명(닉네임 우선)
        m_name_id_color: tinfo ? tinfo.color : '',            // teacher_color hex
        mid_member_id: tinfo ? tinfo.member_id : '',          // 강사 회원 id (매칭/전송 키)
        member_id: memberId,                                  // 회원 id
        m_tg: tgById[memberId] || '',                         // 회원 텔레그램 사용여부 ('Y'/'')
        m_name: String(values[i][mNameIdx] == null ? '' : values[i][mNameIdx]).trim()
      });
    }
    cases.sort(function (a, b) { return a.bid_date < b.bid_date ? -1 : (a.bid_date > b.bid_date ? 1 : 0); });
    return { success: true, cases: cases, count: cases.length, from: fromN, to: toN };
  } catch (e) {
    Logger.log('[getProgressList] 오류: ' + e.toString());
    return { success: false, message: String(e), cases: [], count: 0 };
  }
}

/**
 * 리스트(preset) 1건 삭제 — josa_presets 시트에서 행 제거.
 * josa_items 의 preset_ids 컬럼은 그대로 둠 (orphan 참조는 화면에서 fallback 표시).
 */
function deleteJosaPreset(presetId) {
  try {
    var id = String(presetId || '').trim();
    if (!id) return { success: false, message: 'preset_id 필요' };
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_JOSA_PRESETS_SHEET_NAME);
    if (!sheet) return { success: false, message: 'josa_presets 시트 없음' };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: false, message: '빈 시트' };
    var headers = data[0];
    var idIdx = headers.indexOf('preset_id');
    if (idIdx < 0) return { success: false, message: 'preset_id 컬럼 없음' };
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === id) {
        sheet.deleteRow(i + 1);
        return { success: true, preset_id: id };
      }
    }
    return { success: false, message: '해당 preset_id 없음: ' + id };
  } catch (err) {
    Logger.log('[deleteJosaPreset] err: ' + err);
    return { success: false, message: String(err) };
  }
}

/**
 * 정리 — 같은 (sakun_no, bid_date) 인데 court 가 비어 있는 옛 row 와 채워진 새 row 가 공존하는 경우,
 * 빈 court row 를 삭제하여 dedup 통합. dedup 키에서 court 빠진 후 1회 실행 권장.
 */
function mergeEmptyCourtJosaDuplicates() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
    if (!sheet) { Logger.log('[merge] no sheet'); return { error: 'no sheet' }; }
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) { Logger.log('[merge] empty'); return { rows: 0 }; }
    var headers = data[0];
    var sakunIdx = headers.indexOf('sakun_no');
    var bdIdx    = headers.indexOf('bid_date');
    var courtIdx = headers.indexOf('court');
    if (sakunIdx < 0 || bdIdx < 0 || courtIdx < 0) { Logger.log('[merge] col missing'); return { error: 'col missing' }; }
    // 그룹핑
    var groups = {};
    for (var i = 1; i < data.length; i++) {
      var k = String(data[i][sakunIdx]).trim() + '|' + String(data[i][bdIdx]).trim();
      if (!k || k === '|') continue;
      if (!groups[k]) groups[k] = [];
      groups[k].push({ row: i + 1, court: String(data[i][courtIdx] || '').trim() });
    }
    // 삭제 대상: 같은 그룹에 court 채워진 row 가 있는데 본인은 빈 court
    var toDelete = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length < 2) return;
      var hasNonEmpty = g.some(function (r) { return r.court; });
      if (!hasNonEmpty) return;
      g.forEach(function (r) { if (!r.court) toDelete.push(r.row); });
    });
    // 아래에서 위로 삭제 (인덱스 보존)
    toDelete.sort(function (a, b) { return b - a; });
    toDelete.forEach(function (row) { sheet.deleteRow(row); });
    Logger.log('[merge] 삭제 ' + toDelete.length + '행 (빈 court 중복)');
    return { success: true, deleted: toDelete.length };
  } catch (e) {
    Logger.log('[merge] err: ' + e);
    return { success: false, error: String(e) };
  }
}

/**
 * 진단 — 첫 http img_url 1개를 GAS UrlFetchApp 으로 직접 받아 응답 코드 + 크기 보고
 * (사진 안 변환되는 원인이 fetch 차단인지 / 크기 초과인지 가르는 용)
 */
function testFirstJosaImgFetch() {
  var out;
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) { out = { error: 'no rows' }; Logger.log(JSON.stringify(out)); return out; }
    var imgIdx = data[0].indexOf('img_url');
    Logger.log('[diag] total_rows=' + (data.length-1) + ', img_url 컬럼 인덱스=' + imgIdx);
    var httpFound = 0, dataFound = 0, emptyFound = 0;
    for (var i = 1; i < data.length; i++) {
      var u = String(data[i][imgIdx] || '');
      if (!u) emptyFound++;
      else if (u.indexOf('data:') === 0) dataFound++;
      else if (u.indexOf('http') === 0) httpFound++;
    }
    Logger.log('[diag] http_url 행=' + httpFound + ' / data_uri 행=' + dataFound + ' / empty 행=' + emptyFound);

    for (var j = 1; j < data.length; j++) {
      var v = String(data[j][imgIdx] || '');
      if (v && v.indexOf('http') === 0) {
        Logger.log('[diag] row ' + (j+1) + ' url prefix: ' + v.substring(0, 200));
        try {
          var resp = UrlFetchApp.fetch(v, {
            headers: { 'Referer': 'https://www.auction1.co.kr/', 'User-Agent': 'Mozilla/5.0' },
            muteHttpExceptions: true,
            followRedirects: true
          });
          var blob = resp.getBlob();
          var bytes = blob.getBytes();
          out = {
            row: j + 1,
            response_code: resp.getResponseCode(),
            content_type: blob.getContentType(),
            size_bytes: bytes.length,
            would_b64_fit: bytes.length <= 35000 ? 'YES — 변환됨' : 'NO — 35KB 초과 skip'
          };
          Logger.log('[diag] RESULT: ' + JSON.stringify(out));
          return out;
        } catch (e) {
          out = { row: j + 1, fetch_error: String(e) };
          Logger.log('[diag] FETCH ERR: ' + JSON.stringify(out));
          return out;
        }
      }
    }
    out = { error: 'http URL 없음 — 모두 data: 거나 빈값', http_count: httpFound, data_count: dataFound, empty_count: emptyFound };
    Logger.log('[diag] RESULT: ' + JSON.stringify(out));
    return out;
  } catch (e) {
    out = { error: String(e) };
    Logger.log('[diag] ERR: ' + JSON.stringify(out));
    return out;
  }
}

/**
 * 진단 — josa_items 첫 10행의 img_url 샘플 반환 (사진 안 나올 때 시트 실제 내용 확인용)
 */
function diagJosaImgUrls() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
    if (!sheet) return { error: 'no sheet' };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { total: 0 };
    var headers = data[0];
    var imgIdx = headers.indexOf('img_url');
    if (imgIdx < 0) return { error: 'img_url col missing' };
    var samples = [];
    for (var i = 1; i < Math.min(11, data.length); i++) {
      var u = String(data[i][imgIdx] || '');
      samples.push({ row: i+1, josa_id: String(data[i][0]), len: u.length, prefix: u.substring(0, 120) });
    }
    return { total: data.length-1, samples: samples };
  } catch (e) { return { error: String(e) }; }
}

/**
 * 정리 — Drive / googleusercontent / data: URL 로 손상된 img_url 을 빈 문자열로 리셋.
 * 매니저에서 크롤링 → [MAPS 전송] 하면 BODY_FIELDS 에 의해 fresh auction1 URL 로 자동 복구.
 */
function resetJosaDriveImgUrls() {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
    if (!sheet) return { error: 'no sheet' };
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var imgIdx = headers.indexOf('img_url');
    var cleared = 0, samples = [];
    for (var i = 1; i < data.length; i++) {
      var u = String(data[i][imgIdx] || '');
      if (u && (u.indexOf('drive.google.com') !== -1 ||
                u.indexOf('googleusercontent.com') !== -1 ||
                u.indexOf('data:') === 0)) {
        if (cleared < 3) samples.push(u.substring(0, 100));
        sheet.getRange(i+1, imgIdx+1).setValue('');
        cleared++;
      }
    }
    return { success: true, cleared: cleared, sample_cleared: samples };
  } catch (e) { return { success: false, error: String(e) }; }
}

/**
 * 옥션원 이미지 프록시 — img_url 을 Referer:auction1 헤더와 함께 fetch,
 * Drive 공유 폴더에 업로드 후 공개 URL 을 josa_items.img_url 에 캐시.
 * (현재 비활성 — @1141 client revert 로 사용 안 함. 진단 용도로만 보존)
 */
function _getOrCreateJosaImageFolder_() {
  var folders = DriveApp.getFoldersByName('josa_images');
  if (folders.hasNext()) return folders.next();
  var folder = DriveApp.createFolder('josa_images');
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return folder;
}
function fetchJosaImage(josaId) {
  try {
    if (!josaId) return '';
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_JOSA_ITEMS_SHEET_NAME);
    if (!sheet) return '';
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return '';
    var headers = data[0];
    var idIdx  = headers.indexOf('josa_id');
    var imgIdx = headers.indexOf('img_url');
    if (idIdx < 0 || imgIdx < 0) return '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(josaId)) continue;
      var u = String(data[i][imgIdx] || '').trim();
      if (!u) return '';
      // 이미 Drive thumbnail / lh3 / data: → 그대로 사용
      if (u.indexOf('drive.google.com') !== -1 ||
          u.indexOf('googleusercontent.com') !== -1 ||
          u.indexOf('data:') === 0) return u;

      var resp;
      try {
        resp = UrlFetchApp.fetch(u, {
          headers: { 'Referer': 'https://www.auction1.co.kr/', 'User-Agent': 'Mozilla/5.0' },
          muteHttpExceptions: true,
          followRedirects: true
        });
      } catch (e) {
        Logger.log('[fetchJosaImage] ' + josaId + ' fetch err: ' + e);
        return '';
      }
      if (resp.getResponseCode() !== 200) {
        Logger.log('[fetchJosaImage] ' + josaId + ' http ' + resp.getResponseCode());
        return '';
      }
      var blob = resp.getBlob();
      try {
        var folder = _getOrCreateJosaImageFolder_();
        var ext = (blob.getContentType() || '').indexOf('png') !== -1 ? '.png' : '.jpg';
        blob.setName(String(josaId) + ext);
        var file = folder.createFile(blob);
        try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
        var publicUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w200';
        try { sheet.getRange(i + 1, imgIdx + 1).setValue(publicUrl); } catch (e) { Logger.log('[fetchJosaImage] save err: ' + e); }
        return publicUrl;
      } catch (e) {
        Logger.log('[fetchJosaImage] drive err: ' + e);
        return '';
      }
    }
    return '';
  } catch (err) {
    Logger.log('[fetchJosaImage] err: ' + err);
    return '';
  }
}