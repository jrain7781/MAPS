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
const ITEM_HEADERS = ['id', 'in-date', 'sakun_no', 'court', 'stu_member', 'm_name_id', 'm_name', 'bidprice', 'member_id', 'reg_date', 'reg_member', 'bid_state', 'image_id', 'note', 'm_name2', 'auction_id'];


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
  'reg_id'
];

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
  // "이정우 (MJ) 한한한" 형식에서 이름 부분만 추출하여 비교하거나, 
  // 전체 문자열이 member_name 중 하나를 포함하는지 확인
  const cleanName = String(mName).split(' ')[0].split('(')[0].trim();
  return members.some(m => String(m.member_name).trim() === cleanName);
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
function createData(inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, bidState, imageId, note) {
  if (!isAllowedCourt_(court)) return { success: false, message: '허용되지 않은 법원입니다.' };

  // 물건상태가 '미정' 또는 '상품'이면서 회원명이 없는 경우 검증 통과
  const isOptionalMemberStatus = (stuMember === '미정' || stuMember === '상품');
  if (!(isOptionalMemberStatus && !String(mName || '').trim())) {
    if (!isValidMemberName_(mName)) return { success: false, message: '등록된 회원이 아닙니다.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };
  // [방어 코드] 쓰기 전에 15번째 열(m_name2)까지 확보
  ensureColumnExists(sheet, 15);

  const id = new Date().getTime().toString();
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const regMember = '';
  // appendRow는 열이 부족하면 알아서 늘려주므로 안전
  sheet.appendRow([id, inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, regDate, regMember, bidState, imageId, note || '', '']);
  return { success: true, message: '성공적으로 등록되었습니다.' };
}

/**
 * 기존 입찰 물건 데이터를 수정합니다.
 */
function updateData(id, inDate, sakunNo, court, stuMember, mNameId, mName, bidPrice, memberId, bidState, imageId, note, mName2) {
  if (!isAllowedCourt_(court)) return { success: false, message: '허용되지 않은 법원입니다.' };

  // 물건상태가 '미정' 또는 '상품'이면서 회원명이 없는 경우 검증 통과
  const isOptionalMemberStatus = (stuMember === '미정' || stuMember === '상품');
  if (!(isOptionalMemberStatus && !String(mName || '').trim())) {
    if (!isValidMemberName_(mName)) return { success: false, message: '등록된 회원이 아닙니다.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  if (!sheet) return { success: false, message: '시트를 찾을 수 없습니다.' };
  // [방어 코드] 15번째 열(m_name2)까지 확보
  ensureColumnExists(sheet, 15);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  // ID 검색
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.findIndex(item => String(item) === String(id));

  if (rowIndex === -1) {
    return { success: false, message: '해당 ID의 데이터를 찾을 수 없습니다.' };
  }

  const realRowIndex = rowIndex + 2;

  // 기존 상태값(bid_state) 확인
  const oldBidState = String(sheet.getRange(realRowIndex, 12).getValue() || '').trim();

  // 데이터 업데이트 (개별 셀 업데이트로 정확성 확보)
  sheet.getRange(realRowIndex, 2).setValue(inDate);
  sheet.getRange(realRowIndex, 3).setValue(sakunNo);
  sheet.getRange(realRowIndex, 4).setValue(court);
  sheet.getRange(realRowIndex, 5).setValue(stuMember);
  sheet.getRange(realRowIndex, 6).setValue(mNameId);
  sheet.getRange(realRowIndex, 7).setValue(mName);
  sheet.getRange(realRowIndex, 8).setValue(bidPrice);
  sheet.getRange(realRowIndex, 9).setValue(memberId);

  // 12번째 열(L열)에 상태값 저장
  sheet.getRange(realRowIndex, 12).setValue(bidState);
  // [추가] 13번째 열(M열)에 이미지 URL 저장
  sheet.getRange(realRowIndex, 13).setValue(imageId);
  // [추가] 14번째 열(N열)에 note(비고) 저장
  sheet.getRange(realRowIndex, 14).setValue(note || '');
  // [추가] 15번째 열(O열)에 m_name2(명의 표시값) 저장
  sheet.getRange(realRowIndex, 15).setValue(mName2 || '');

  // [기능 추가] 상태가 '전달완료'로 변경될 때 텔레그램 자동 발송
  if (bidState === '전달완료' && oldBidState !== '전달완료') {
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

  return { success: true, message: '성공적으로 수정되었습니다.' };
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

  ids.forEach(id => {
    const idx = allIds.findIndex(v => String(v) === String(id));
    if (idx >= 0) {
      const rowNum = idx + 2;
      // 5번째 열(E열)이 stu_member
      sheet.getRange(rowNum, 5).setValue(String(newStatus || '').trim());
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
  sheet.getRange(rowIndex, 12).setValue('확인완료');
  SpreadsheetApp.flush();

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
  sheet.getRange(match.getRow(), 12).setValue('확인완료');
  SpreadsheetApp.flush();

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

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.findIndex(item => String(item) === String(id));

  if (rowIndex === -1) {
    return { success: false, message: '해당 ID의 데이터를 찾을 수 없습니다.' };
  }

  sheet.deleteRow(rowIndex + 2);
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
    const cur = String(sheet.getRange(rowNum, enabledCol).getValue() || '').trim();
    if (!cur) sheet.getRange(rowNum, enabledCol).setValue('Y');
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
 * 회원 토큰으로 해당 회원 물건만 반환합니다. (이미지 ID 포함)
 * - 프론트가 기존과 동일하게 image_ids를 기대하므로, ImageService의 readAllDataWithImageIds()를 활용
 * @param {string} memberToken
 * @return {Array}
 */
function readDataWithImageIdsByMemberToken(memberToken) {
  const member = getMemberByToken(memberToken);
  if (!member) return [];
  const items = (typeof readAllDataWithImageIds === 'function')
    ? readAllDataWithImageIds()
    : readAllData();
  return (items || []).filter(it => String(it.member_id || '') === String(member.member_id));
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
    'action',           // REQUEST_BID 등
    'status',           // PENDING | APPROVED | REJECTED
    'item_id',
    'member_id',
    'chat_id',
    'telegram_username',
    'note',
    'approved_at',
    'approved_by'
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

    // items 시트 상태 변경 (같은 ss 재사용, openById 추가 없음)
    if (action === 'REQUEST_BID') {
      try {
        // items 시트에서 직접 상태 변경 (updateItemStuMemberById_ 호출 안 함 = openById 절약)
        if (itemsSheet && itemId) {
          var finder = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 1)
            .createTextFinder(itemId).matchEntireCell(true);
          var match = finder.findNext();
          if (match) {
            itemsSheet.getRange(match.getRow(), 5).setValue('입찰');
            updatedItems++;
          }
        }
        if (chatId && typeof telegramSendMessage === 'function') {
          try {
            telegramSendMessage(chatId, prefix + '입찰확정 되었습니다.', null, originMessageId ? { replyToMessageId: originMessageId } : null);
          } catch (e) { }
        }
      } catch (e) { }
    }

    if (action === 'REQUEST_CANCEL') {
      try {
        if (itemsSheet && itemId) {
          var finder2 = itemsSheet.getRange(2, 1, itemsSheet.getLastRow() - 1, 1)
            .createTextFinder(itemId).matchEntireCell(true);
          var match2 = finder2.findNext();
          if (match2) {
            itemsSheet.getRange(match2.getRow(), 5).setValue('미정');
            updatedItems++;
          }
        }
        if (chatId && typeof telegramSendMessage === 'function') {
          try {
            telegramSendMessage(chatId, prefix + '입찰취소 되었습니다.', null, originMessageId ? { replyToMessageId: originMessageId } : null);
          } catch (e) { }
        }
      } catch (e) { }
    }
  }
  return { success: true, approved: approved, updatedItems: updatedItems, message: '승인 ' + approved + '건 처리 (상태 변경 ' + updatedItems + '건)' };
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
  return data
    .map(row => {
      const obj = {};
      CLASS_D1_HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    })
    .filter(d => String(d.class_id) === String(classId))
    .sort((a, b) => Number(a.class_loop) - Number(b.class_loop));
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
 * @param {string} loopUnit - 루프 단위 ('1주' 또는 '2주' 등)
 * @param {number} loopCount - 생성할 회차 수
 */
function generateClassD1(classId, startDate, loopUnit, loopCount) {
  const sheet = ensureClassD1Sheet_();

  // 수업 정보 가져오기
  const allClasses = readAllClasses();
  const classInfo = allClasses.find(c => String(c.class_id) === String(classId));
  if (!classInfo) return { success: false, message: '수업 정보를 찾을 수 없습니다.' };

  // 기존 회차 중 가장 큰 회차 번호 확인
  const existingD1 = readClassD1ByClassId(classId);
  const maxLoop = existingD1.length > 0
    ? Math.max(...existingD1.map(d => Number(d.class_loop) || 0))
    : 0;

  // 루프 단위 파싱 (주 단위)
  const weekInterval = parseInt(loopUnit) || 1;
  const dayInterval = weekInterval * 7;

  // 시작일 파싱
  const year = parseInt(startDate.substring(0, 4));
  const month = parseInt(startDate.substring(4, 6)) - 1;
  const day = parseInt(startDate.substring(6, 8));
  let currentDate = new Date(year, month, day);

  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const weekNames = ['일', '월', '화', '수', '목', '금', '토'];

  const newRows = [];
  for (let i = 0; i < loopCount; i++) {
    const loopNo = maxLoop + i + 1;

    // 수업 전체 회차를 초과하면 중단
    if (classInfo.class_loop && loopNo > Number(classInfo.class_loop)) break;

    const dateStr = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), 'yyyyMMdd');
    const weekDay = weekNames[currentDate.getDay()];
    const d1Id = `${classId}_${timestamp}_${loopNo}`;

    const row = CLASS_D1_HEADERS.map(h => {
      switch (h) {
        case 'class_d1_id': return d1Id;
        case 'class_id': return classId;
        case 'class_type': return classInfo.class_type || '';
        case 'class_name': return classInfo.class_name || '';
        case 'class_grade': return classInfo.class_grade || '';
        case 'class_loc': return classInfo.class_loc || '';
        case 'class_date': return dateStr;
        case 'class_week': return weekDay;
        case 'class_time_from': return classInfo.class_time_from || '';
        case 'class_time_to': return classInfo.class_time_to || '';
        case 'class_loop': return loopNo;
        case 'completed': return 'N';
        case 'reg_date': return regDate;
        default: return '';
      }
    });

    newRows.push(row);

    // 다음 날짜로 이동
    currentDate.setDate(currentDate.getDate() + dayInterval);
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, CLASS_D1_HEADERS.length).setValues(newRows);
  }

  return { success: true, message: `${newRows.length}개 회차 생성 완료`, created: newRows.length };
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
 * 회차를 삭제합니다.
 */
function deleteClassD1(classD1Id) {
  const sheet = ensureClassD1Sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '회차 데이터가 없습니다.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(id => String(id) === String(classD1Id));
  if (idx < 0) return { success: false, message: '해당 회차를 찾을 수 없습니다.' };

  sheet.deleteRow(idx + 2);
  return { success: true, message: '회차 삭제 완료' };
}

// ================================================================================================
// [회원 수업 상세(member_class_details) 시트 관리] CRUD 함수들
// ================================================================================================

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
      MEMBER_CLASS_DETAILS_HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });
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
 * 수업 회차에 회원을 추가합니다.
 */
function addMemberToClassD1(classD1Id, memberId) {
  const sheet = ensureMemberClassDetailsSheet_();

  // 중복 검사 (같은 회차에 같은 회원이 있는지)
  const existing = readMembersByClassD1Id(classD1Id);
  if (existing.some(e => String(e.member_id) === String(memberId))) {
    return { success: false, message: '해당 회원이 이미 등록되어 있습니다.' };
  }

  const newId = new Date().getTime().toString();
  const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const row = MEMBER_CLASS_DETAILS_HEADERS.map(h => {
    switch (h) {
      case 'detail_id': return newId;
      case 'class_d1_id': return classD1Id;
      case 'member_id': return memberId;
      case 'attended': return 'N';
      case 'reg_date': return regDate;
      default: return '';
    }
  });

  sheet.appendRow(row);
  return { success: true, message: '회원 추가 완료' };
}

/**
 * 수업 회차에서 회원을 삭제합니다.
 */
function removeMemberFromClassD1(detailId) {
  const sheet = ensureMemberClassDetailsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(id => String(id) === String(detailId));
  if (idx < 0) return { success: false, message: '해당 데이터를 찾을 수 없습니다.' };

  sheet.deleteRow(idx + 2);
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
      if (inDate.length === 6) {
        // 'yyMMdd'(6자리) → 'yyyyMMdd' 변환
        inDate = '20' + inDate;
      } else if (inDate.length > 8) {
        inDate = inDate.substring(0, 8);
      }
    }
    if (!inDate || inDate.length !== 8 || inDate < today) return; // 오늘(포함) 이후 물건만 집계. 비정상 날짜 제외.

    // 물건상태 필터: 추천, 입찰, 변경 건에 대해서만 집계 (열 이름: 'stu_member')
    var stuMember = String(itemObj['stu_member'] || '').trim();
    if (['추천', '입찰', '변경'].indexOf(stuMember) === -1) return;

    // member_id(index 8)로 회원 매핑
    var memberId = String(itemObj['member_id'] || '').trim();
    if (!memberId) return;

    var m = memberMap[memberId];
    if (!m) return;

    var cls = classMap[String(m.class_id)] || {};
    var ct = String(cls.class_type || '').trim();
    if (!ct) return;

    if (!statMap[ct]) statMap[ct] = { class_type: ct, item_count: 0, total: 0, joined: 0, chat_id: 0, _members: {} };
    // 1번 요건: 물건수
    statMap[ct].item_count++;

    // 2번 요건: 1번의 물건을 가진 회원의 수 (고유 회원)
    if (!statMap[ct]._members[memberId]) {
      statMap[ct]._members[memberId] = true;
      statMap[ct].total++;
      if (String(m.telegram_enabled || '').toUpperCase() === 'Y') statMap[ct].joined++;
      if (String(m.telegram_chat_id || '').trim() !== '') statMap[ct].chat_id++;
    }
  });

  var classTypes = Object.keys(statMap).sort();
  var result = classTypes.map(function (t) { return statMap[t]; });

  var totals = { class_type: '합계', item_count: 0, total: 0, joined: 0, chat_id: 0 };
  result.forEach(function (r) {
    totals.item_count += r.item_count;
    totals.total += r.total;
    totals.joined += r.joined;
    totals.chat_id += r.chat_id;
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

function getAutoApprovalStats() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  if (!reqSheet || reqSheet.getLastRow() < 2) return [];

  // 회원 gubun 맵 (관리자 제외용)
  var members = readAllMembersNew();
  var memberGubunMap = {};
  members.forEach(function (m) {
    memberGubunMap[String(m.member_id)] = String(m.gubun || '').trim();
  });

  // 아이템 bid_state 맵
  var itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
  var itemBidStateMap = {};
  if (itemsSheet && itemsSheet.getLastRow() >= 2) {
    var iLastRow = itemsSheet.getLastRow();
    var iCols = Math.min(itemsSheet.getMaxColumns(), 12);
    var iData = itemsSheet.getRange(2, 1, iLastRow - 1, iCols).getValues();
    iData.forEach(function (r) {
      var id = String(r[0] || '').trim();
      if (id) itemBidStateMap[id] = String(r[11] || '');
    });
  }

  var lastRow = reqSheet.getLastRow();
  var rows = reqSheet.getRange(2, 1, lastRow - 1, 11).getValues();
  // [0]req_id [1]requested_at [2]action [3]status [4]item_id [5]member_id [6]chat_id [7]username [8]note [9]approved_at [10]approved_by

  var dateStats = {};
  rows.forEach(function (row) {
    var action = String(row[2] || '').trim();
    var status = String(row[3] || '').trim();
    var itemId = String(row[4] || '').trim();
    var memberId = String(row[5] || '').trim();
    var reqAt = row[1];
    var appAt = row[9];

    if (memberGubunMap[memberId] === '관리자') return;
    if (!itemId) return;

    var dateToUse = (status === 'APPROVED' && appAt) ? appAt : reqAt;
    if (!dateToUse) return;
    var d = new Date(dateToUse);
    if (isNaN(d.getTime())) return;

    var dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yy/MM/dd');
    if (!dateStats[dateKey]) {
      dateStats[dateKey] = {
        date: dateKey,
        items: {},
        bid_approved_ids: [], bid_pending_ids: [], cancel_ids: [],
        delivered_ids: [], confirmed_ids: []
      };
    }
    var ds = dateStats[dateKey];
    ds.items[itemId] = true;

    if (action === 'REQUEST_BID' && status === 'APPROVED') {
      if (ds.bid_approved_ids.indexOf(itemId) < 0) ds.bid_approved_ids.push(itemId);
      var bs = String(itemBidStateMap[itemId] || '');
      if (bs === '전달완료') { if (ds.delivered_ids.indexOf(itemId) < 0) ds.delivered_ids.push(itemId); }
      else if (bs === '확인완료') { if (ds.confirmed_ids.indexOf(itemId) < 0) ds.confirmed_ids.push(itemId); }
    } else if (action === 'REQUEST_BID' && status === 'PENDING') {
      if (ds.bid_pending_ids.indexOf(itemId) < 0) ds.bid_pending_ids.push(itemId);
    } else if (action === 'REQUEST_CANCEL' && status === 'APPROVED') {
      if (ds.cancel_ids.indexOf(itemId) < 0) ds.cancel_ids.push(itemId);
    }
  });

  var result = Object.keys(dateStats).map(function (k) {
    var s = dateStats[k];
    var allIds = Object.keys(s.items);
    return {
      date: s.date,
      recommend: allIds.length,
      recommend_ids: allIds,
      bid_approved: s.bid_approved_ids.length,
      bid_approved_ids: s.bid_approved_ids,
      bid_pending: s.bid_pending_ids.length,
      bid_pending_ids: s.bid_pending_ids,
      cancel_approved: s.cancel_ids.length,
      cancel_approved_ids: s.cancel_ids,
      delivered: s.delivered_ids.length,
      delivered_ids: s.delivered_ids,
      confirmed: s.confirmed_ids.length,
      confirmed_ids: s.confirmed_ids
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
  return allMembers.some(m =>
    String(m.member_name || '').trim() === String(memberName || '').trim() &&
    String(m.phone || '').trim().replace(/[^0-9]/g, '') === String(phone || '').trim().replace(/[^0-9]/g, '') &&
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