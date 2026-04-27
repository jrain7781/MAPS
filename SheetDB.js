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

// - m_name2: "선택된 명의 표시값" (예: "(MJ) 한한한") — 화면 복원/리스트 표시에 사용
// - auction_id: "옥션 고유번호 (7자리)"
const ITEM_HEADERS = ['id', 'in-date', 'sakun_no', 'court', 'stu_member', 'm_name_id', 'm_name', 'bidprice', 'member_id', 'reg_date', 'reg_member', 'bid_state', 'image_id', 'note', 'm_name2', 'auction_id', 'chuchen_state', 'chuchen_date', 'class_d1_id', 'bid_datetime_2'];
// chuchen_state:  Q열(idx 16) - '신규'|'전달완료'
// chuchen_date:   R열(idx 17) - 최근 전달 일시 (ISO string)
// class_d1_id:    S열(idx 18) - 수업 회차 ID (수업 물건 연결용)
// bid_datetime_2: T열(idx 19) - 최종 마감 일시 (yyMMddHHmm). 일반=chuchen_date+48h+주말보정, 수업=회차값

// ============================================================================
// 마감일 보정 헬퍼 (서버) — js-app.html의 adjustFinalDeadline_ 와 동일 로직
// 토/일/공휴일이면 다음 평일로 이동(최대 7일), 보정 시 14:00로 설정
// ============================================================================
const _KR_HOLIDAYS_GLOBAL_ = (function() {
  return new Set([
    '2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02',
    '2026-05-05','2026-05-24','2026-05-25','2026-06-03','2026-06-06','2026-08-15','2026-08-17',
    '2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25'
  ]);
})();
function _isKRHolidayOrWeekend_(dt) {
  if (!dt || isNaN(dt.getTime())) return false;
  var w = dt.getDay();
  if (w === 0 || w === 6) return true;
  var ymd = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return _KR_HOLIDAYS_GLOBAL_.has(ymd);
}
function adjustFinalDeadline_(dt) {
  if (!dt || isNaN(dt.getTime())) return dt;
  var out = new Date(dt.getTime());
  var shifted = false;
  for (var i = 0; i < 7 && _isKRHolidayOrWeekend_(out); i++) {
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
// chuchen_date(ISO) + 48h + 주말/공휴일 보정 → bid_datetime_2 문자열 반환
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
  'kakao_name'
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
  // 필요한 열(12개)과 실제 열 중 작은 값까지만 읽음
  const colsToRead = Math.min(maxCols, ITEM_HEADERS.length);

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

  return values.map(row => {
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

    // [추가] item_images 테이블에 이미지가 있는지 확인
    rowData['has_images'] = itemsWithImages.has(String(row[0]).trim());

    return rowData;
  });
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
function createData(inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, bidState, imageId, note, mName2, chuchenState, regMember, auctionId) {
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
    const dupRows = sheet.getRange(2, 2, dupLastRow - 1, 3).getValues(); // B=in-date, C=sakun_no, D=court
    const isDup = dupRows.some(function(r) {
      return String(r[0]) === String(inDate) &&
             String(r[1]).trim() === String(sakunNo).trim() &&
             String(r[2]).trim() === String(court).trim();
    });
    if (isDup) return { success: false, message: '이미 동일한 입찰일자/사건번호/법원명으로 등록된 물건이 있습니다.' };
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
    return '';
  });

  sheet.appendRow(newRow);

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
function updateData(id, inDate, sakunNo, court, stuMember, mName, bidPrice, mNameId, note, memberId, bidState, chuchenState, imageId, regMember, mName2, auctionId) {
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

  // 초기화 조건: stu_member(=물건상태) 변경 OR m_name(회원명) 변경
  // → 4키 룰(stu_member=추천 + chuchen_state=전달완료 + chuchen_date + bid_datetime_2) 깨뜨림
  const stuMemberChanged =
    (oldValues.stu_member === '추천' && newStuMemberVal !== '추천') ||
    (oldValues.stu_member !== '추천' && newStuMemberVal === '추천') ||
    (oldValues.stu_member === '입찰' && (newStuMemberVal === '미정' || newStuMemberVal === '상품'));
  const mNameChanged = (oldMNameVal !== newMNameVal);
  const shouldResetChuchen = stuMemberChanged || mNameChanged;

  const actualSavedChuchenState = shouldResetChuchen ? '' : newChuchenState;

  if (shouldResetChuchen) {
    newRowValues[16] = ''; // Q: chuchen_state 클리어
    newRowValues[17] = ''; // R: chuchen_date 클리어
    // T(bid_datetime_2)는 일반 케이스만 클리어. 수업회차(class_d1_id 존재)는 회차 데이터 유지
    if (!oldClassD1IdVal) {
      newRowValues[19] = ''; // T: bid_datetime_2 클리어
    }
  } else if (newChuchenState) {
    newRowValues[16] = newChuchenState;
    if (newChuchenState === '신규') {
      newRowValues[17] = ''; // 신규로 변경 시 chuchen_date 클리어
      if (!oldClassD1IdVal) newRowValues[19] = ''; // bid_datetime_2도 클리어 (일반)
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

  // [중복 체크] 자기 자신 제외하고 동일 키 존재 여부 확인 (A,B,C,D열만 읽어 속도 최적화)
  {
    const dupLastRow = sheet.getLastRow();
    if (dupLastRow > 1) {
      const dupRows = sheet.getRange(2, 1, dupLastRow - 1, 4).getValues(); // A=id, B=in-date, C=sakun_no, D=court
      const isDup = dupRows.some(function(r) {
        if (String(r[0]) === String(id)) return false; // 자기 자신 제외
        return String(r[1]) === String(inDate) &&
               String(r[2]).trim() === String(sakunNo).trim() &&
               String(r[3]).trim() === String(court).trim();
      });
      if (isDup) return { success: false, message: '이미 동일한 입찰일자/사건번호/법원명으로 등록된 물건이 있습니다.' };
    }
  }

  // [BATCH] 일괄 저장 (setValue 10여 회 -> setValues 1회로 단축)
  range.setValues([newRowValues]);

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

  // 수정된 데이터 객체 반환 (프론트엔드 로컬 캐시 갱신용)
  var updatedItem = {};
  ITEM_HEADERS.forEach((header, index) => {
    updatedItem[header] = newRowValues[index];
  });
  if (typeof formatParamsDate === 'function') {
    updatedItem['in-date'] = formatParamsDate(newRowValues[1]);
    updatedItem['reg_date'] = formatParamsDate(newRowValues[9], 'yyyy-MM-dd');
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
      // [캐스케이드 클리어] stu_member 변경 시 4키 룰 깨뜨림 → 3키 클리어
      // 일반 케이스(class_d1_id 비어있음)만 bid_datetime_2 클리어. 수업회차는 회차 데이터 유지
      const curStu = String(sheet.getRange(rowNum, 5).getValue() || '').trim();
      const curClassD1 = String(sheet.getRange(rowNum, 19).getValue() || '').trim(); // S열
      const stuChanged = (curStu === '추천' && newStatusVal !== '추천') ||
                         (curStu !== '추천' && newStatusVal === '추천');

      sheet.getRange(rowNum, 5).setValue(newStatusVal); // E: stu_member

      if (stuChanged) {
        sheet.getRange(rowNum, 17).setValue(''); // Q: chuchen_state
        sheet.getRange(rowNum, 18).setValue(''); // R: chuchen_date
        if (!curClassD1) sheet.getRange(rowNum, 20).setValue(''); // T: bid_datetime_2 (일반만)
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
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var st = String(r[3] || '').trim().toUpperCase();
      if (!st) st = 'PENDING';
      Logger.log('[listTelegramRequests] row ' + j + ' status=' + st + ' filter=' + s);
      // PENDING 필터: 빈값도 PENDING 취급
      if (s && s !== 'ALL' && st !== s) continue;

      var itemId = String(r[4] || '').trim();
      var item = itemMap[itemId] || {};

      out.push({
        req_id: r[0],
        requested_at: (r[1] instanceof Date) ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") : String(r[1] || ''),
        action: r[2],
        status: st,
        item_id: itemId,
        member_id: r[5],
        chat_id: r[6],
        telegram_username: r[7],
        sakun_no: String(item.sakun_no || ''),
        court: String(item.court || ''),
        in_date: (item['in-date'] instanceof Date) ? Utilities.formatDate(item['in-date'], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(item['in-date'] || ''),
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
  if (addCount !== null) {
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
  // class_d1_id 배치키: 생성 시각 ms 타임스탬프 (날짜 변경에도 유니크 보장)
  var timestamp = batchTimestamp || String(new Date().getTime());
  var regDate   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var weekNames = ['일', '월', '화', '수', '목', '금', '토'];

  // 한국 공휴일 (월/일 기준, 연도 무관 고정 공휴일)
  var KOREAN_FIXED_HOLIDAYS_ = [
    '01-01','03-01','05-05','06-06','08-15','10-03','10-09','12-25'
  ];
  function isHoliday_(d) {
    var dow = d.getDay(); // 0=일, 6=토
    if (dow === 0 || dow === 6) return true;
    var md = Utilities.formatDate(d, tz, 'MM-dd');
    return KOREAN_FIXED_HOLIDAYS_.indexOf(md) >= 0;
  }
  function addWorkingDays_(baseDate, days) {
    var d = new Date(baseDate.getTime());
    var remaining = Math.abs(days);
    var step = days >= 0 ? 1 : -1;
    while (remaining > 0) {
      d.setDate(d.getDate() + step);
      if (!isHoliday_(d)) remaining--;
    }
    return d;
  }

  // 수업일 기준 bid 일시 계산 헬퍼 (워킹데이 기준)
  function calcBidDatetime_(baseDate, dayOffset, timeStr) {
    if (dayOffset === null) return '';
    var d = dayOffset === 0 ? new Date(baseDate.getTime()) : addWorkingDays_(baseDate, dayOffset);
    var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return dateStr + 'T' + (timeStr || '00:00');
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
    var d1Id    = classId + '_' + timestamp + '_' + loopNo;

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
        case 'bid_datetime_2': return hasDate ? calcBidDatetime_(currentDate, bidDatetime2Day, bidDatetime2Time) : '';
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

  return { success: true, message: newRows.length + '개 회차 생성 완료 (회원 ' + memberIds.length + '명)', created: newRows.length };
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

  sheet.deleteRow(idx + 2);
  const cache = CacheService.getScriptCache();
  if (classId) cache.remove('sessions_' + classId);
  cache.remove('all_class_d1_sessions');
  return { success: true, message: '회차 삭제 완료' };
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
  var repInfo = _getBatchRepMemberInfo_(classD1Id);
  if (hasOverride) {
    mNameVal = String(mNameOverride).trim();
  } else if (repInfo && repInfo.name) {
    mNameVal = repInfo.name;
  } else {
    mNameVal = autoMName;
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
    // [4키 룰] 회차 등록 시점에는 chuchen_state/chuchen_date 비워둠
    // → 관리자가 텔레그램 발송 또는 수동 '전달완료' 업데이트 시 채워짐
    sheet.getRange(row, chuchenStateCol).setValue('');
    sheet.getRange(row, chuchenDateCol).setValue('');
    sheet.getRange(row, bd2Col).setValue(bidDatetime2Val);
    var existingMid = String(scanData[idx][midColRel] || '').trim();
    // PT/돈클 일괄등록: items.member_id가 비어있으면 대표회원 ID로 채움 (텔레그램 심볼 등 회원연계용)
    if (!existingMid && repMemberIdForBulk) {
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

  var allData = sheet.getDataRange().getValues();
  var headers = allData[0].map(function(v){ return String(v||'').trim(); });

  // class_d1_id 컬럼 탐지: 헤더명 → 고정인덱스 폴백
  var d1Col = headers.indexOf('class_d1_id');
  if (d1Col < 0) d1Col = ITEM_HEADERS.indexOf('class_d1_id'); // = 18

  var searchId = String(classD1Id).trim();
  var tz = Session.getScriptTimeZone();
  var result = [];

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    if (String(row[d1Col]||'').trim() !== searchId) continue;
    var obj = {};
    ITEM_HEADERS.forEach(function(h, idx) {
      var col = headers.indexOf(h);
      if (col < 0) col = idx;
      var v = (col >= 0 && col < row.length && row[col] != null) ? row[col] : '';
      // Date 객체 → 문자열 변환 (직렬화 오류 방지)
      if (v instanceof Date) {
        v = isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
      }
      obj[h] = v;
    });
    result.push(obj);
  }

  Logger.log('[getItemsByClassD1Id] id=' + searchId + ' | d1Col=' + d1Col + ' | hdr=' + (headers[d1Col]||'?') + ' | totalRows=' + (allData.length-1) + ' | matched=' + result.length);
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
  var result = filtered.map(function(d) {
    var member = allMembers.find(function(m) { return String(m.member_id) === String(d.member_id); }) || {};
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
    MEMBER_CLASS_DETAILS_HEADERS.forEach(function(h, i) {
      if (updates[h] !== undefined) rowVals[i] = updates[h];
    });
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
  return { success: true };
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
    var remaining = isNew ? totalSessions : Math.max(0, parseInt(mData.remaining) || 0);
    for (var n = 1; n <= totalSessions && n <= 20; n++) {
      result['no_' + n] = (n <= remaining) ? 'O' : 'X';
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

  const row = MEMBER_CLASS_DETAILS_HEADERS.map(function(h) {
    switch (h) {
      case 'detail_id':   return newId;
      case 'class_d1_id': return batchKey;
      case 'class_id':    return classId || '';
      case 'member_id':     return memberId;
      case 'member_status': return mData ? (mData.status || '') : '';
      case 'reg_date':      return regDate;
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
        status_tele: [],         // 12번: TELEGRAM_SENT note='status'
        status_web: []           // 8번: FIELD_CHANGE stu_member→변경
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

    var dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yy/MM/dd');
    var ds = getOrCreate(dateKey);

    // ── 물건추천 ─────────────────────────────────────────────────────
    if (action === 'TELEGRAM_SENT' && note === 'card') {
      addId(ds.recommend_tele, itemId);                                          // 11번
    } else if (action === 'FIELD_CHANGE' && fieldName === 'chuchen_state' && toVal === '전달완료'
      && triggerType !== 'web-telegram') {
      addId(ds.recommend_web, itemId);                                           // 9번 (수작업만)

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

      // ── 변경/취소 안내 ────────────────────────────────────────────────
    } else if (action === 'TELEGRAM_SENT' && note === 'status') {
      addId(ds.status_tele, itemId);                                             // 12번
    } else if (action === 'FIELD_CHANGE' && fieldName === 'stu_member' && toVal === '취소') {
      addId(ds.status_web, itemId);                                              // 8번
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
    var stat = mergeIds(s.status_tele, s.status_web);
    return {
      date: s.date,
      recommend: rec.length, recommend_tele: s.recommend_tele.length, recommend_web: s.recommend_web.length, recommend_ids: rec, recommend_tele_ids: s.recommend_tele, recommend_web_ids: s.recommend_web,
      bid_approved: bapr.length, bid_approved_tele: s.bid_approved_tele.length, bid_approved_web: s.bid_approved_web.length, bid_approved_ids: bapr, bid_approved_tele_ids: s.bid_approved_tele, bid_approved_web_ids: s.bid_approved_web,
      bid_pending: bpnd.length, bid_pending_tele: s.bid_pending_tele.length, bid_pending_web: s.bid_pending_web.length, bid_pending_sys: s.bid_pending_sys.length, bid_pending_ids: bpnd, bid_pending_tele_ids: s.bid_pending_tele, bid_pending_web_ids: s.bid_pending_web, bid_pending_sys_ids: s.bid_pending_sys,
      cancel_approved: capr.length, cancel_approved_tele: s.cancel_approved_tele.length, cancel_approved_web: s.cancel_approved_web.length, cancel_approved_ids: capr, cancel_approved_tele_ids: s.cancel_approved_tele, cancel_approved_web_ids: s.cancel_approved_web,
      delivered: dlvr.length, delivered_tele: s.delivered_tele.length, delivered_web: s.delivered_web.length, delivered_ids: dlvr, delivered_tele_ids: s.delivered_tele, delivered_web_ids: s.delivered_web,
      confirmed: conf.length, confirmed_tele: s.confirmed_tele.length, confirmed_web: s.confirmed_web.length, confirmed_ids: conf, confirmed_tele_ids: s.confirmed_tele, confirmed_web_ids: s.confirmed_web,
      status_notify: stat.length, status_notify_tele: s.status_tele.length, status_notify_web: s.status_web.length, status_notify_ids: stat, status_notify_tele_ids: s.status_tele, status_notify_web_ids: s.status_web
    };
  });
  result.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return result;
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
function extendItemDeadline(itemIds, newBd2) {
  try {
    if (!itemIds || !itemIds.length) return { success: false, updated: 0, message: '대상 물건이 없습니다.' };
    const bd2 = String(newBd2 || '').trim();
    if (!/^\d{10}$/.test(bd2)) return { success: false, updated: 0, message: '잘못된 마감 형식 (yyMMddHHmm 10자리 필요)' };
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, updated: 0, message: '시트를 찾을 수 없습니다.' };
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, updated: 0, message: '데이터가 없습니다.' };
    const idStrs = itemIds.map(String);
    const allIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String);
    const affectedMembers = [];
    let updated = 0;
    idStrs.forEach(function(id) {
      const idx = allIds.indexOf(id);
      if (idx < 0) return;
      const rowNum = idx + 2;
      const oldBd2 = String(sheet.getRange(rowNum, 20).getValue() || '').trim();
      sheet.getRange(rowNum, 20).setValue(bd2); // T: bid_datetime_2
      const mid = String(sheet.getRange(rowNum, 9).getValue() || '').trim();
      const mName = String(sheet.getRange(rowNum, 7).getValue() || '').trim();
      if (mid && affectedMembers.indexOf(mid) === -1) affectedMembers.push(mid);
      try {
        writeItemHistory_({
          action: 'FIELD_CHANGE',
          item_id: id,
          member_id: mid,
          member_name: mName,
          field_name: 'bid_datetime_2',
          from_value: oldBd2,
          to_value: bd2,
          trigger_type: 'web',
          note: '만기연장'
        });
      } catch(e) { /* 이력 실패는 무시 */ }
      updated++;
    });
    if (updated > 0) {
      SpreadsheetApp.flush();
      try { invalidateMemberItemsCache_(affectedMembers); } catch(e) {}
    }
    return { success: true, updated: updated };
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

      // [신규 룰] bid_datetime_2 우선. 만료 시 3키(chuchen_state/chuchen_date/bid_datetime_2) 클리어
      // (일반/수업 통합 처리. 일반은 updateChuchenState에서 bid_datetime_2가 자동 채워짐)
      if (bd2Str) {
        const expTs = parseBd2Str_(bd2Str);
        if (!isNaN(expTs) && now.getTime() >= expTs) {
          if (getSetting_('AUTO_EXPIRE_ENABLED', 'true') === 'true') {
            sheet.getRange(realRow, 5).setValue('미정');     // E: stu_member
            sheet.getRange(realRow, 17).setValue('');         // Q: chuchen_state
            sheet.getRange(realRow, 18).setValue('');         // R: chuchen_date
            // bid_datetime_2는 일반만 클리어, 수업회차는 회차 데이터 유지
            if (!classD1Id) sheet.getRange(realRow, 20).setValue(''); // T
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
        // 미정 전환 (만료): AUTO_EXPIRE_ENABLED 설정이 true일 때만 실행
        if (getSetting_('AUTO_EXPIRE_ENABLED', 'true') === 'true') {
          sheet.getRange(realRow, 5).setValue('미정');
          sheet.getRange(realRow, 17).setValue(''); // Q
          sheet.getRange(realRow, 18).setValue(''); // R
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
      else if (fieldName === 'stu_member' && toValue === '취소') category = CATEGORIES.CHANGE;
      else if (BID_ACTIONS.indexOf(action) !== -1) category = CATEGORIES.BID;
      else if (CHUCHEN_ACTIONS.indexOf(action) !== -1 || (fieldName === 'stu_member' && toValue && toValue !== '미정' && toValue !== '취소')) category = CATEGORIES.CHUCHEN;

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
      ['check', '추천물건안내', '안녕하세요?\n엠제이경매스쿨입니다.\n\n추천물건 전달드립니다.\n입찰 여부 회신 부탁드려요~ (48시간 이후 자동취소)\n\n====================================\n회 원 명:    {{이름}}\n입찰일자:   {{입찰일자}}\n사건번호:   {{사건번호}}\n법     원:   {{법원}}\n====================================', 'public', ''],
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
 * 이름 하나를 표시명으로 변환 (TelegramService 내부 호출용)
 * @param {string} name
 * @returns {string}
 */
function getDisplayName_(name) {
  try {
    if (!name) return name;
    const map = getDisplayNameMap();
    return (map && map[name]) ? map[name] : name;
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
 * search 시트 초기화 (헤더 세팅)
 */
function initSearchSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DB_SEARCH_SHEET_NAME);
  }
  const headerRange = sheet.getRange(1, 1, 1, SEARCH_HEADERS.length);
  headerRange.setValues([SEARCH_HEADERS]);
  headerRange.setFontWeight('bold');
  return sheet;
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
  if (!sheet) {
    initSearchSheet_();
    sheet = ss.getSheetByName(DB_SEARCH_SHEET_NAME);
  }
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