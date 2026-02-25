/**
 * [ClassService.gs]
 * 수업 관리 (Class, Session, Attendance) 비즈니스 로직
 */

// -----------------------------------------------------------------------------
// 1. 수업 (Class) 관리
// -----------------------------------------------------------------------------

/**
 * 수업 목록 조회
 * @return {Array} Class Objects
 */
function getClasses() {
    ensureClassSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    // 헤더: CLASS_HEADERS 참조 (Code.js)
    const data = sheet.getRange(2, 1, lastRow - 1, CLASS_HEADERS.length).getValues();

    return data.map(row => {
        let cls = {};
        CLASS_HEADERS.forEach((h, i) => {
            let val = (i < row.length) ? row[i] : '';
            // 날짜 포맷팅
            if ((h === 'reg_date' || h.includes('date')) && val instanceof Date) {
                cls[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            } else {
                cls[h] = val;
            }
        });
        return cls;
    });
}
/**
 * 수업 등록
 * 중복 검사: class_type + class_name + class_grade + class_loc
 */
function createClass(data) {
    ensureClassSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);

    // 중복 검사
    const classes = getClasses();
    const duplicate = classes.find(c =>
        c.class_type === data.class_type &&
        c.class_name === data.class_name &&
        c.class_grade === data.class_grade &&
        c.class_loc === data.class_loc
    );

    if (duplicate) {
        return { success: false, message: '이미 동일한 수업(구분/이름/등급/지역)이 존재합니다.' };
    }

    // ID 생성
    const newId = 'CLS_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
    const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // 데이터 매핑
    const row = CLASS_HEADERS.map(h => {
        if (h === 'class_id') return newId;
        if (h === 'reg_date') return regDate;
        return data[h] || '';
    });

    sheet.appendRow(row);

    // 자동 회차 생성 옵션이 있다면 여기서 호출 가능 (지금은 별도 버튼으로 권장)
    return { success: true, message: '수업이 등록되었습니다.', class_id: newId };
}

/**
 * 수업 수정
 */
function updateClass(data) {
    ensureClassSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);
    const classes = getClasses(); // ID 찾기 위해
    const idx = classes.findIndex(c => String(c.class_id) === String(data.class_id));

    if (idx === -1) return { success: false, message: '수업을 찾을 수 없습니다.' };

    // 수정할 row (1-based, header=1 -> idx + 2)
    const rowNum = idx + 2;
    const currentRowVals = sheet.getRange(rowNum, 1, 1, CLASS_HEADERS.length).getValues()[0];

    // 업데이트할 값 매핑
    const newRowVals = CLASS_HEADERS.map((h, i) => {
        // 키(ID)나 등록일 등 불변 데이터 보존
        if (h === 'class_id' || h === 'reg_date' || h === 'member_id') {
            return currentRowVals[i];
        }
        // 값이 넘어왔으면 수정, 아니면 기존 유지? (PUT 방식 vs PATCH 방식)
        // 여기서는 폼에서 전송된 값(undefined가 아니면) 사용
        return (data[h] !== undefined) ? data[h] : currentRowVals[i];
    });

    sheet.getRange(rowNum, 1, 1, newRowVals.length).setValues([newRowVals]);
    return { success: true, message: '수업이 수정되었습니다.' };
}

/**
 * 수업 삭제
 * - 연관된 회차(class_d1) 및 출석(details)도 삭제해야 할 수 있음 (정책 결정 필요)
 * - 현재는 수업만 삭제
 */
function deleteClass(classId) {
    ensureClassSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);
    const classes = getClasses();
    const idx = classes.findIndex(c => String(c.class_id) === String(classId));
    if (idx === -1) return { success: false, message: '수업을 찾을 수 없습니다.' };

    sheet.deleteRow(idx + 2);
    return { success: true, message: '수업이 삭제되었습니다.' };
}


// -----------------------------------------------------------------------------
// 2. 수업 회차 (Session) 관리
// -----------------------------------------------------------------------------

/**
 * 특정 수업의 회차 목록 조회
 */
function getClassSessions(classId) {
    ensureClassD1Sheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
    const sessions = [];

    data.forEach(row => {
        let sess = {};
        CLASS_D1_HEADERS.forEach((h, i) => {
            let val = (i < row.length) ? row[i] : '';
            if ((h.includes('date') || h === 'reg_date') && val instanceof Date) {
                sess[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            } else {
                sess[h] = val;
            }
        });

        if (String(sess.class_id) === String(classId)) {
            sessions.push(sess);
        }
    });

    return sessions;
}

/**
 * 회차 자동 생성 로직
 * - 입력: class_id, 시작일(startDate), 반복 횟수(totalWeeks)
 * - 요일에 맞춰서 N주차 데이터 생성
 */
/**
 * 회차 자동 생성 로직 (파라미터 확장 지원)
 * - 입력: class_id, 시작일(startDate), 반복 단위(loopUnit), 반복 횟수(loopCount)
 */
function generateClassSessions(classId, startDateStr, loopUnit = 1, loopCount = 8) {
    // 1. 수업 정보 가져오기
    const classes = getClasses();
    const cls = classes.find(c => String(c.class_id) === String(classId));
    if (!cls) return { success: false, message: '수업 정보 없음' };

    // 2. 파라미터 파싱
    let start = startDateStr;
    if (start && typeof start === 'string' && start.length === 8 && !start.includes('-')) {
        // YYYYMMDD -> YYYY-MM-DD
        start = start.substring(0, 4) + '-' + start.substring(4, 6) + '-' + start.substring(6, 8);
    }
    const startDateObj = new Date(start);

    if (isNaN(startDateObj.getTime())) return { success: false, message: '올바른 시작 날짜가 아닙니다.' };

    const unit = parseInt(loopUnit, 10) || 1;
    const total = parseInt(loopCount, 10) || parseInt(cls.class_loop, 10) || 8;

    // 3. 기존 회차 확인 (중복 생성 방지? 혹은 추가 생성?)
    // 여기서는 단순 추가

    ensureClassD1Sheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const newRows = [];

    for (let i = 0; i < total; i++) {
        // 날짜 계산 (unit 주 단위)
        let d = new Date(startDateObj);
        d.setDate(d.getDate() + (i * 7 * unit));
        const dStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');

        const sessId = 'D1_' + new Date().getTime() + '_' + i + '_' + Math.floor(Math.random() * 100);

        // CLASS_D1_HEADERS: class_d1_id, class_id, class_type, class_name, class_grade, class_loc, class_date, class_week, class_time_from, class_time_to, class_loop, completed, reg_date
        const sessRow = {};
        sessRow['class_d1_id'] = sessId;
        sessRow['class_id'] = classId;

        // Denormalized fields (from Class)
        sessRow['class_type'] = cls.class_type;
        sessRow['class_name'] = cls.class_name;
        sessRow['class_grade'] = cls.class_grade;
        sessRow['class_loc'] = cls.class_loc;
        sessRow['class_week'] = cls.class_week;
        sessRow['class_time_from'] = cls.class_time_from;
        sessRow['class_time_to'] = cls.class_time_to;

        sessRow['class_date'] = dStr;
        sessRow['class_loop'] = (i + 1) + '회차';
        sessRow['completed'] = 'N';
        sessRow['reg_date'] = regDate;

        // Array 변환
        newRows.push(CLASS_D1_HEADERS.map(h => sessRow[h] || ''));
    }

    // 일괄 쓰기
    if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, CLASS_D1_HEADERS.length).setValues(newRows);
    }

    return { success: true, message: `${newRows.length}개의 회차가 생성되었습니다.` };
}

// -----------------------------------------------------------------------------
// 3. 출석 (Attendance) 관리
// -----------------------------------------------------------------------------

/**
 * 특정 회차(session)의 출석부 조회
 * - 해당 수업을 듣는 모든 회원(members where class_id matches)을 가져와서
 * - member_class_details 테이블의 기록과 조인(Join)하여 반환
 */
function getSessionAttendance(classId, sessionId) {
    // 1. 해당 수업의 수강생 목록 가져오기
    const allMembers = readAllMembers(); // SheetDB.gs
    const students = allMembers.filter(m => String(m.class_id) === String(classId));

    // 2. 기존 출석 기록 가져오기
    ensureMemberClassDetailsSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(MEMBER_CLASS_DETAILS_SHEET_NAME_DB);
    const attData = (sheet.getLastRow() > 1)
        ? sheet.getRange(2, 1, sheet.getLastRow() - 1, MEMBER_CLASS_DETAILS_HEADERS_DB.length).getValues()
        : [];

    // Map으로 변환 (member_id -> record)
    // MEMBER_CLASS_DETAILS_HEADERS_DB: detail_id, class_d1_id, member_id, attended, attended_date, reg_date
    const attMap = {}; // key: member_id
    attData.forEach(r => {
        // detail_id(0), class_d1_id(1), member_id(2), attended(3)...
        const rSessionId = r[1];
        const rMemberId = r[2];
        if (String(rSessionId) === String(sessionId)) {
            attMap[String(rMemberId)] = {
                detail_id: r[0],
                attended: r[3],
                attended_date: r[4]
            };
        }
    });

    // 3. 결과 조합 (학생 정보 + 출석 상태)
    return students.map(s => {
        const attDesc = attMap[String(s.member_id)];
        return {
            member_id: s.member_id,
            member_name: s.member_name,
            phone: s.phone,
            attended: attDesc ? attDesc.attended : '', // 공백이면 미처리
            detail_id: attDesc ? attDesc.detail_id : null
        };
    });
}

/**
 * 출석 상태 저장/수정
 * - data: [{ member_id, attended, detail_id(opt) }, ...]
 */
function saveAttendance(sessionId, attendanceList) {
    ensureMemberClassDetailsSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(MEMBER_CLASS_DETAILS_SHEET_NAME_DB);

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // 배치 업데이트를 위해 기존 데이터를 모두 읽어서 처리하면 느릴 수 있음.
    // 여기서는 간단히:
    // - detail_id가 있으면 update
    // - 없으면 insert

    // 1. 기존 ID 목록 캐싱
    const lastRow = sheet.getLastRow();
    const existingIdMap = {}; // detail_id -> rowIndex
    if (lastRow > 1) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat(); // detail_id col=1
        ids.forEach((id, idx) => { existingIdMap[String(id)] = idx + 2; });
    }

    attendanceList.forEach(item => {
        if (item.detail_id && existingIdMap[String(item.detail_id)]) {
            // Update
            const rowNum = existingIdMap[String(item.detail_id)];
            // attended(col 4), attended_date(col 5)
            sheet.getRange(rowNum, 4).setValue(item.attended);
            sheet.getRange(rowNum, 5).setValue(timestamp);
        } else {
            // Insert
            const newId = 'ATT_' + new Date().getTime() + '_' + Math.floor(Math.random() * 10000);
            const rowData = [
                newId,
                sessionId,
                item.member_id,
                item.attended,
                timestamp,
                regDate
            ];
            sheet.appendRow(rowData);
        }
    });

    return { success: true, message: '출석이 저장되었습니다.' };
}

// -----------------------------------------------------------------------------
// 4. Frontend - Backend 연결 (Glue Code)
// -----------------------------------------------------------------------------

/**
 * 프론트엔드용 래퍼: 수업 목록 조회
 */
function readAllClasses() {
    return getClasses();
}

/**
 * 프론트엔드용 래퍼: 수업 회차 조회
 */
function readClassD1ByClassId(classId) {
    return getClassSessions(classId);
}

/**
 * 프론트엔드용 래퍼: 회차 생성
 * @param {string} classId
 * @param {string} startDateStr (YYYY-MM-DD or YYYYMMDD)
 * @param {number|string} loopUnit (주 단위: 1, 2, 3...)
 * @param {number|string} loopCount (생성할 횟수)
 */
function generateClassD1(classId, startDateStr, loopUnit, loopCount) {
    return generateClassSessions(classId, startDateStr, loopUnit, loopCount);
}

/**
 * 프론트엔드용 래퍼: 회차별 멤버(출석부) 조회
 * - class_d1_id만으로 class_id를 역추적하여 출석부를 구성해야 함
 */
function readMembersByClassD1Id(classD1Id) {
    // 1. class_d1_id로 class_id 찾기
    ensureClassD1Sheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const data = sheet.getDataRange().getValues(); // 전체 읽기 (행 수가 많지 않다고 가정)

    // CLASS_D1_HEADERS_DB: class_d1_id(0), class_id(1)...
    const row = data.find(r => String(r[0]) === String(classD1Id));

    if (!row) return []; // 회차 정보 없음
    const classId = row[1];

    return getSessionAttendance(classId, classD1Id);
}

/**
 * 프론트엔드용: 전체 회원 목록 조회 (회원 추가 팝업용)
 */
function getMembersForClass() {
    return readAllMembers(); // SheetDB.gs
}

/**
 * 프론트엔드용: 특정 회차에 멤버 수동 추가
 * - 이미 class에 속해있지 않은 멤버를 해당 회차에만 추가하거나,
 * - class에 속해있지만 member_class_details가 없는 경우 생성
 */
function addMemberToClassD1(classD1Id, memberId) {
    // member_class_details에 레코드 추가
    // Default attended: 'N' or empty

    ensureMemberClassDetailsSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(MEMBER_CLASS_DETAILS_SHEET_NAME_DB);

    // 중복 확인
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
        const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // detail_id, class_d1_id, member_id
        const exists = data.find(r => String(r[1]) === String(classD1Id) && String(r[2]) === String(memberId));
        if (exists) {
            return { success: false, message: '이미 해당 회차에 등록된 회원입니다.' };
        }
    }

    const newId = 'ATT_' + new Date().getTime() + '_' + Math.floor(Math.random() * 10000);
    const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    // detail_id, class_d1_id, member_id, attended, attended_date, reg_date
    sheet.appendRow([newId, classD1Id, memberId, '', '', regDate]);

    return { success: true, message: '회원이 추가되었습니다.' };
}

/**
 * 수업 드롭다운용 유니크 값 목록을 반환합니다.
 */
function getClassDropdownOptions() {
    const allClasses = getClasses(); // Use getClasses directly instead of readAllClasses wrapper
    const types = [...new Set(allClasses.map(c => c.class_type).filter(v => v))];
    const names = [...new Set(allClasses.map(c => c.class_name).filter(v => v))];
    const grades = [...new Set(allClasses.map(c => c.class_grade).filter(v => v))];
    const locs = [...new Set(allClasses.map(c => c.class_loc).filter(v => v))];

    return {
        class_types: types,
        class_names: names,
        class_grades: grades,
        class_locs: locs,
        all_classes: allClasses  // 필터 조인용 (readAllClasses 별도 호출 제거)
    };
}
