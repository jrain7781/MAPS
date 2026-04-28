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
    const cache = CacheService.getScriptCache();
    const cached = cache.get('all_classes');
    if (cached) return JSON.parse(cached);

    ensureClassSheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_SHEET_NAME_DB);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    // 헤더: CLASS_HEADERS 참조 (Code.js)
    const data = sheet.getRange(2, 1, lastRow - 1, CLASS_HEADERS.length).getValues();

    const result = data.map(row => {
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
    cache.put('all_classes', JSON.stringify(result), 300);
    return result;
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
    CacheService.getScriptCache().remove('all_classes');
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
    CacheService.getScriptCache().remove('all_classes');
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
    CacheService.getScriptCache().remove('all_classes');
    return { success: true, message: '수업이 삭제되었습니다.' };
}


// -----------------------------------------------------------------------------
// 2. 수업 회차 (Session) 관리
// -----------------------------------------------------------------------------

/**
 * 특정 수업의 회차 목록 조회
 */
function getClassSessions(classId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'sessions_' + String(classId);
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

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

    cache.put(cacheKey, JSON.stringify(sessions), 180);
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
function generateClassSessions(classId, startDateStr, loopUnit, loopCount, opts) {
    loopCount = loopCount || 8;
    opts = opts || {};
    // PT/돈클 루프단위 '없음' 모드: 수업날짜 없이 회차만 생성
    const isNoDateMode = (String(loopUnit) === '0');
    if (!loopUnit && !isNoDateMode) loopUnit = 1;
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

    const unit = isNoDateMode ? 1 : (parseInt(loopUnit, 10) || 1);
    const total = parseInt(loopCount, 10) || parseInt(cls.class_loop, 10) || 8;

    ensureClassD1Sheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const regDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const newRows = [];

    var startLoopNo = parseInt(opts.startLoop) || 1;
    var timeFrom = opts.timeFrom || '';
    var timeTo = opts.timeTo || '';

    // sessId 기반: {classId}_{시작일yyyyMMdd}_{종료일yyyyMMdd}_{회차}
    var endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + ((total - 1) * 7 * unit));
    var startFmt = Utilities.formatDate(startDateObj, Session.getScriptTimeZone(), 'yyyyMMdd');
    var endFmt   = Utilities.formatDate(endDateObj,   Session.getScriptTimeZone(), 'yyyyMMdd');
    // 배치키(parts[1])에 HHmmss 추가 — 동일 기간 중복 생성 허용 + class_d1_id 충돌 방지
    var batchStamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmmss');
    var sessIdBase = String(classId) + '_' + startFmt + batchStamp + '_' + endFmt;

    // 기간 중복 체크 제거 (사용자 요청 — 동일 기간 재생성 허용)

    // 입찰시간 계산 헬퍼
    function calcBidDatetime(classDateStr, dayOffset, timeStr) {
        if (dayOffset === '' || dayOffset === null || dayOffset === undefined) return '';
        var base = new Date(classDateStr);
        base.setDate(base.getDate() + parseInt(dayOffset));
        var parts = String(timeStr || '00:00').split(':');
        base.setHours(parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, 0, 0);
        return Utilities.formatDate(base, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    }

    for (var i = 0; i < total; i++) {
        // 날짜 계산 (unit 주 단위) — 날짜 미정 모드는 빈 문자열
        var d = new Date(startDateObj);
        d.setDate(d.getDate() + (i * 7 * unit));
        var dStr = isNoDateMode ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');

        var sessId = sessIdBase + '_' + (startLoopNo + i);

        var sessRow = {};
        sessRow['class_d1_id'] = sessId;
        sessRow['class_id'] = classId;
        sessRow['class_type'] = cls.class_type;
        sessRow['class_name'] = cls.class_name;
        sessRow['class_grade'] = cls.class_grade;
        sessRow['class_loc'] = cls.class_loc;
        sessRow['class_week'] = cls.class_week;
        sessRow['class_time_from'] = timeFrom || cls.class_time_from;
        sessRow['class_time_to'] = timeTo || cls.class_time_to;
        sessRow['class_date'] = dStr;
        sessRow['class_loop'] = (startLoopNo + i);
        sessRow['completed'] = 'N';
        sessRow['reg_date'] = regDate;

        // 입찰시간 (opts에 있으면 적용) — 날짜 미정 모드는 계산 불가
        if (!isNoDateMode && opts.bidStarttimeDay !== '' && opts.bidStarttimeDay !== undefined) {
            sessRow['bid_starttime'] = calcBidDatetime(dStr, opts.bidStarttimeDay, opts.bidStarttimeTime);
        }
        if (!isNoDateMode && opts.bidDatetime1Day !== '' && opts.bidDatetime1Day !== undefined) {
            sessRow['bid_datetime_1'] = calcBidDatetime(dStr, opts.bidDatetime1Day, opts.bidDatetime1Time);
        }
        if (!isNoDateMode && opts.bidDatetime2Day !== '' && opts.bidDatetime2Day !== undefined) {
            sessRow['bid_datetime_2'] = calcBidDatetime(dStr, opts.bidDatetime2Day, opts.bidDatetime2Time);
        }
        if (opts.bid1Count) sessRow['1cha_bid'] = opts.bid1Count;
        if (opts.bid2Count) sessRow['2cha_bid'] = opts.bid2Count;
        if (opts.teacherId) sessRow['teacher_id'] = opts.teacherId;

        newRows.push(CLASS_D1_HEADERS.map(function(h) { return sessRow[h] !== undefined ? sessRow[h] : ''; }));
    }

    // 일괄 쓰기
    if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, CLASS_D1_HEADERS.length).setValues(newRows);
    }

    const cache_ = CacheService.getScriptCache();
    cache_.remove('sessions_' + String(classId));
    cache_.remove('all_class_d1_sessions');
    cache_.remove('class_batch_counts');
    cache_.remove('all_batch_members');
    cache_.remove('class_member_index');
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
 * 세션 목록 + 기본 배치 회원 요약을 1회 GAS 호출로 반환 (속도 개선용)
 */
function readClassD1WithSummary(classId) {
    var sessions = getClassSessions(classId);
    try {
        var keyCount = {};
        sessions.forEach(function(s) {
            var id = String(s.class_d1_id || '');
            var last = id.lastIndexOf('_');
            if (last > 0 && /^\d{1,4}$/.test(id.substring(last + 1))) {
                var k = id.substring(0, last);
                keyCount[k] = (keyCount[k] || 0) + 1;
            }
        });
        var sortedKeys = Object.keys(keyCount).sort(function(a, b) { return b.localeCompare(a); });
        var defaultBatchKey = sortedKeys.length > 0 ? sortedKeys[0] : null;
        var summary = defaultBatchKey ? readMemberClassDetailsByBatchKey(defaultBatchKey) : [];
        return { sessions: sessions, summary: summary, defaultBatchKey: defaultBatchKey };
    } catch(e) {
        return { sessions: sessions, summary: [], defaultBatchKey: null };
    }
}

/**
 * 수업관리 초기화: 수업 목록 + 전체 회차 데이터를 1회 GAS 호출로 반환
 * → 클라이언트가 _d1CacheMap 선제 채움 → 종목 클릭 시 즉시 표시
 */
/**
 * 수업별 배치 개수(수업수) 집계: { classId: count }
 * - CLASS_D1의 class_id / class_d1_id 2개 컬럼만 읽어 payload 최소화
 * - 수업수 컬럼 표시용 — getAllClassD1Sessions보다 훨씬 빠름
 */
function getClassBatchCounts() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('class_batch_counts');
    if (cached) { try { return JSON.parse(cached); } catch (e) {} }

    ensureClassD1Sheet();
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const lastRow = sheet ? sheet.getLastRow() : 0;
    const result = {};
    if (!sheet || lastRow < 2) return result;

    const classIdIdx = CLASS_D1_HEADERS.indexOf('class_id');
    const d1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
    const readCols = Math.max(classIdIdx, d1IdIdx) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, readCols).getValues();

    const seen = {}; // classId -> { batchKey: true }
    data.forEach(function(row) {
        const cid = String(row[classIdIdx] || '');
        const d1Id = String(row[d1IdIdx] || '');
        if (!cid || !d1Id) return;
        const parts = d1Id.split('_');
        const batchKey = parts.length >= 2 ? parts[1] : 'default';
        if (!seen[cid]) seen[cid] = {};
        seen[cid][batchKey] = true;
    });
    Object.keys(seen).forEach(function(cid) {
        result[cid] = Object.keys(seen[cid]).length;
    });

    try { cache.put('class_batch_counts', JSON.stringify(result), 300); } catch (e) {}
    return result;
}

/**
 * 전체 수업의 배치별 회원 집계: { classId: { batchKey: { firstName, count } } }
 * - 수업관리 초기 진입 시 병렬로 호출하여 _batchMembersCache 선로드
 */
function getAllBatchMembersInfo() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('all_batch_members');
    if (cached) { try { return JSON.parse(cached); } catch (e) {} }

    const mcdSheet = ensureMemberClassDetailsSheet_();
    const lastRow = mcdSheet ? mcdSheet.getLastRow() : 0;
    const result = {};
    if (!mcdSheet || lastRow < 2) return result;

    const headers = MEMBER_CLASS_DETAILS_HEADERS;
    const d1IdIdx = headers.indexOf('class_d1_id');
    const classIdIdx = headers.indexOf('class_id');
    const memberIdIdx = headers.indexOf('member_id');

    const data = mcdSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    const allMembers = readAllMembersNew();
    const nameMap = {};
    allMembers.forEach(function(m) { nameMap[String(m.member_id)] = m.member_name || ''; });

    data.forEach(function(r) {
        const cid = String(r[classIdIdx] || '');
        const bk = String(r[d1IdIdx] || '');
        if (!cid || !bk) return;
        const mid = String(r[memberIdIdx] || '');
        const name = nameMap[mid] || '';
        if (!result[cid]) result[cid] = {};
        if (!result[cid][bk]) result[cid][bk] = { firstName: name, count: 1 };
        else {
            result[cid][bk].count++;
            if (!result[cid][bk].firstName && name) result[cid][bk].firstName = name;
        }
    });

    try { cache.put('all_batch_members', JSON.stringify(result), 300); } catch (e) {}
    return result;
}

/**
 * 특정 수업(classId)의 배치별 회원 집계: { batchKey: { firstName, count } }
 * - batchKey = member_class_details.class_d1_id (full: {classId}_{timestamp})
 * - firstName = MEMBERS 시트에서 조회한 첫 회원명
 */
function getBatchMembersForClass(classId) {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'cbm2_' + String(classId);
    const cached = cache.get(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch (e) {} }

    const mcdSheet = ensureMemberClassDetailsSheet_();
    const lastRow = mcdSheet ? mcdSheet.getLastRow() : 0;
    const result = {};
    if (!mcdSheet || lastRow < 2) return result;

    const headers = MEMBER_CLASS_DETAILS_HEADERS;
    const d1IdIdx = headers.indexOf('class_d1_id');
    const classIdIdx = headers.indexOf('class_id');
    const memberIdIdx = headers.indexOf('member_id');

    const data = mcdSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    const allMembers = readAllMembersNew();
    const nameMap = {};
    allMembers.forEach(function(m) { nameMap[String(m.member_id)] = m.member_name || ''; });

    data.forEach(function(r) {
        if (String(r[classIdIdx]) !== String(classId)) return;
        const bk = String(r[d1IdIdx] || '');
        if (!bk) return;
        const mid = String(r[memberIdIdx] || '');
        const name = nameMap[mid] || '';
        if (!result[bk]) result[bk] = { firstName: name, firstMemberId: mid, count: 1 };
        else {
            result[bk].count++;
            if (!result[bk].firstName && name) {
                result[bk].firstName = name;
                result[bk].firstMemberId = mid;
            }
        }
    });

    try { cache.put(cacheKey, JSON.stringify(result), 180); } catch (e) {}
    return result;
}

/**
 * 종목별 회원명 인덱스: { classId: "이름1|이름2|..." (lowercased) }
 * - MEMBER_CLASS_DETAILS(class_id, member_id) + members(member_name) 조인
 * - 회원명 검색 시 클라이언트가 includes()로 1-pass 매칭 → classId 추출
 */
function getClassMemberIndex() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('class_member_index');
    if (cached) { try { return JSON.parse(cached); } catch (e) {} }

    const mcdSheet = ensureMemberClassDetailsSheet_();
    const lastRow = mcdSheet ? mcdSheet.getLastRow() : 0;
    const result = {};
    if (!mcdSheet || lastRow < 2) return result;

    const headers = MEMBER_CLASS_DETAILS_HEADERS;
    const classIdIdx = headers.indexOf('class_id');
    const memberIdIdx = headers.indexOf('member_id');
    const readCols = Math.max(classIdIdx, memberIdIdx) + 1;
    const data = mcdSheet.getRange(2, 1, lastRow - 1, readCols).getValues();

    const allMembers = readAllMembersNew();
    const nameMap = {};
    allMembers.forEach(function(m) {
        nameMap[String(m.member_id)] = String(m.member_name || '');
    });

    const seen = {};
    data.forEach(function(r) {
        const cid = String(r[classIdIdx] || '');
        const mid = String(r[memberIdIdx] || '');
        if (!cid || !mid) return;
        const name = nameMap[mid];
        if (!name) return;
        if (!seen[cid]) seen[cid] = {};
        seen[cid][name] = true;
    });
    Object.keys(seen).forEach(function(cid) {
        result[cid] = Object.keys(seen[cid]).join('|').toLowerCase();
    });

    try { cache.put('class_member_index', JSON.stringify(result), 300); } catch (e) {}
    return result;
}

/**
 * 전체 CLASS_D1 시트의 회차 데이터만 반환 (수업 목록은 별도 호출)
 * → 프론트에서 수업 목록과 병렬 호출로 속도 개선
 */
function getAllClassD1Sessions() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('all_class_d1_sessions');
    if (cached) {
        try { return JSON.parse(cached); } catch (e) {}
    }
    ensureClassD1Sheet();
    const d1Sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const lastRow = d1Sheet ? d1Sheet.getLastRow() : 0;
    const d1Sessions = [];
    if (d1Sheet && lastRow >= 2) {
        const data = d1Sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
        data.forEach(function(row) {
            var sess = {};
            CLASS_D1_HEADERS.forEach(function(h, i) {
                var val = (i < row.length) ? row[i] : '';
                if (val instanceof Date) {
                    // datetime/starttime 필드는 시각 포함 (offset 계산용), 그 외 date 필드는 날짜만
                    if (h.includes('datetime') || h === 'bid_starttime') {
                        sess[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
                    } else if (h.includes('date') || h === 'reg_date') {
                        sess[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
                    } else {
                        sess[h] = val;
                    }
                } else {
                    sess[h] = val;
                }
            });
            d1Sessions.push(sess);
        });
    }
    try { cache.put('all_class_d1_sessions', JSON.stringify(d1Sessions), 300); } catch (e) {}
    return d1Sessions;
}

function getClassScheduleInitData() {
    const opts = getClassDropdownOptions(); // CacheService 캐시 활용
    const cache = CacheService.getScriptCache();

    // 서버 캐시 히트 시 시트 읽기 생략 (재방문 가속)
    const d1Cached = cache.get('all_class_d1_sessions');
    if (d1Cached) {
        try {
            return { opts: opts, d1Sessions: JSON.parse(d1Cached) };
        } catch (e) {}
    }

    ensureClassD1Sheet();
    const d1Sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLASS_D1_SHEET_NAME_DB);
    const lastRow = d1Sheet ? d1Sheet.getLastRow() : 0;
    const d1Sessions = [];
    if (d1Sheet && lastRow >= 2) {
        const data = d1Sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
        data.forEach(function(row) {
            var sess = {};
            CLASS_D1_HEADERS.forEach(function(h, i) {
                var val = (i < row.length) ? row[i] : '';
                if (val instanceof Date) {
                    // datetime/starttime 필드는 시각 포함 (offset 계산용), 그 외 date 필드는 날짜만
                    if (h.includes('datetime') || h === 'bid_starttime') {
                        sess[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
                    } else if (h.includes('date') || h === 'reg_date') {
                        sess[h] = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
                    } else {
                        sess[h] = val;
                    }
                } else {
                    sess[h] = val;
                }
            });
            d1Sessions.push(sess);
        });
    }
    try { cache.put('all_class_d1_sessions', JSON.stringify(d1Sessions), 300); } catch (e) {}
    return { opts: opts, d1Sessions: d1Sessions };
}

/**
 * 프론트엔드용 래퍼: 회차 생성 + 회원 등록
 * @param {string} classId
 * @param {string} startDateStr (YYYYMMDD)
 * @param {string|number} loopUnit (주 단위)
 * @param {object} options { startLoop, endLoop, addCount, timeFrom, timeTo, memberIds, memberApplyAll, bid* ... }
 */
function generateClassD1(classId, startDateStr, loopUnit, options) {
    var opts = (options && typeof options === 'object') ? options : {};
    var mode = opts.addCount ? 'add' : 'create';
    var loopCount = mode === 'add' ? (parseInt(opts.addCount) || 1) : (parseInt(opts.endLoop) - parseInt(opts.startLoop) + 1 || 10);

    // 1. 회차 생성
    var result = generateClassSessions(classId, startDateStr, loopUnit, loopCount, opts);
    if (!result.success) return result;

    // 2. 회원 등록 (수업 단위 1회만 - 이미 등록된 회원은 중복 스킵)
    var memberIds = opts.memberIds;
    if (memberIds && memberIds.length > 0) {
        addMemberToClassD1Batch(classId, memberIds);
    }

    return result;
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

// addMemberToClassD1 / addMemberToClassD1Batch → SheetDB.js 사용 (수업 단위 1회 등록)

/**
 * 여러 class_d1_id에 해당하는 회원 목록을 합산 반환합니다. (class 기준 중복 제거)
 */
function readMembersForMultipleD1s(classD1Ids) {
    if (!Array.isArray(classD1Ids) || classD1Ids.length === 0) return [];
    const sheet = ensureClassD1Sheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const d1Rows = sheet.getRange(2, 1, lastRow - 1, CLASS_D1_HEADERS.length).getValues();
    const d1IdSet = new Set(classD1Ids.map(String));
    const d1IdIdx = CLASS_D1_HEADERS.indexOf('class_d1_id');
    const classIdIdx = CLASS_D1_HEADERS.indexOf('class_id');

    const involvedClassIds = new Set();
    d1Rows.forEach(r => {
        if (d1IdSet.has(String(r[d1IdIdx]))) involvedClassIds.add(String(r[classIdIdx]));
    });

    const allMembers = readAllMembers();
    const result = [];
    const seen = new Set();
    involvedClassIds.forEach(classId => {
        allMembers
            .filter(m => String(m.class_id) === classId)
            .forEach(m => {
                if (!seen.has(String(m.member_id))) {
                    seen.add(String(m.member_id));
                    result.push({ member_id: m.member_id, member_name: m.member_name, phone: m.phone, class_id: m.class_id });
                }
            });
    });
    return result;
}

/**
 * 여러 class_d1_id에 등록된 물건 목록을 합산 반환합니다.
 */
function readItemsByMultipleD1Ids(classD1Ids) {
    if (!Array.isArray(classD1Ids) || classD1Ids.length === 0) return [];
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const d1IdSet = new Set(classD1Ids.map(String));
    const d1IdColIdx = ITEM_HEADERS.indexOf('class_d1_id');
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITEM_HEADERS.length).getValues();
    const result = [];
    data.forEach(row => {
        if (d1IdSet.has(String(row[d1IdColIdx] || ''))) {
            const obj = {};
            ITEM_HEADERS.forEach((h, i) => { obj[h] = row[i]; });
            result.push({ id: obj.id, sakun_no: obj.sakun_no, court: obj.court, m_name: obj.m_name, bidprice: obj.bidprice, stu_member: obj.stu_member, class_d1_id: obj.class_d1_id });
        }
    });
    return result;
}

/**
 * 배치(여러 회차)를 일괄 업데이트합니다.
 * @param {string[]} classD1Ids - 수정할 class_d1_id 배열
 * @param {Object} updateData - 수정할 필드/값 (예: { teacher_id, class_time_from, class_time_to, ... })
 */
function updateClassD1Batch(classD1Ids, updateData) {
    if (!Array.isArray(classD1Ids) || classD1Ids.length === 0) {
        return { success: false, message: '수정할 회차가 없습니다.' };
    }
    const sheet = ensureClassD1Sheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

    const rawData = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const ids = rawData.map(function(r) { return String(r[0]); });
    const classIdByIdx = rawData.map(function(r) { return String(r[1]); });
    const directFields = ['teacher_id', 'class_time_from', 'class_time_to', '1cha_bid', '2cha_bid', 'class_loop', 'class_date'];
    const dateColIdx = CLASS_D1_HEADERS.indexOf('class_date');
    let count = 0;

    function calcBidDt(classDateStr, dayOffset, timeStr) {
        if (dayOffset === '' || dayOffset === null || dayOffset === undefined) return '';
        var base = new Date(String(classDateStr));
        base.setDate(base.getDate() + parseInt(dayOffset));
        var parts = String(timeStr || '00:00').split(':');
        base.setHours(parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, 0, 0);
        return Utilities.formatDate(base, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    }

    classD1Ids.forEach(function(d1Id) {
        const idx = ids.indexOf(String(d1Id));
        if (idx < 0) return;
        const rowNum = idx + 2;
        // 직접 값 업데이트
        directFields.forEach(function(field) {
            if (updateData.hasOwnProperty(field)) {
                const colIdx = CLASS_D1_HEADERS.indexOf(field);
                if (colIdx >= 0) sheet.getRange(rowNum, colIdx + 1).setValue(updateData[field]);
            }
        });
        // 입찰시간: day 기준으로 해당 회차 날짜에서 계산
        if (updateData.hasOwnProperty('bidStarttimeDay')) {
            const classDate = sheet.getRange(rowNum, dateColIdx + 1).getValue();
            const col = CLASS_D1_HEADERS.indexOf('bid_starttime') + 1;
            sheet.getRange(rowNum, col).setValue(calcBidDt(classDate, updateData.bidStarttimeDay, updateData.bidStarttimeTime));
        }
        if (updateData.hasOwnProperty('bidDatetime1Day')) {
            const classDate = sheet.getRange(rowNum, dateColIdx + 1).getValue();
            const col = CLASS_D1_HEADERS.indexOf('bid_datetime_1') + 1;
            sheet.getRange(rowNum, col).setValue(calcBidDt(classDate, updateData.bidDatetime1Day, updateData.bidDatetime1Time));
        }
        if (updateData.hasOwnProperty('bidDatetime2Day')) {
            const classDate = sheet.getRange(rowNum, dateColIdx + 1).getValue();
            const col = CLASS_D1_HEADERS.indexOf('bid_datetime_2') + 1;
            sheet.getRange(rowNum, col).setValue(calcBidDt(classDate, updateData.bidDatetime2Day, updateData.bidDatetime2Time));
        }
        count++;
    });

    const affectedClassIds = new Set();
    classD1Ids.forEach(function(d1Id) {
        const idx = ids.indexOf(String(d1Id));
        if (idx >= 0) affectedClassIds.add(classIdByIdx[idx]);
    });
    const scriptCache = CacheService.getScriptCache();
    affectedClassIds.forEach(function(cId) { if (cId) scriptCache.remove('sessions_' + cId); });
    scriptCache.remove('all_class_d1_sessions');
    scriptCache.remove('class_batch_counts');
    scriptCache.remove('all_batch_members');
    scriptCache.remove('class_member_index');
    return { success: true, message: count + '개 회차가 수정되었습니다.' };
}

/**
 * 배치(여러 회차)를 일괄 삭제합니다.
 * @param {string[]} classD1Ids - 삭제할 class_d1_id 배열
 */
function deleteClassD1Batch(classD1Ids) {
    if (!Array.isArray(classD1Ids) || classD1Ids.length === 0) {
        return { success: false, message: '삭제할 회차가 없습니다.' };
    }

    // ITEMS 시트 연결 물건 정리 (class_d1_id 일치하는 물건 → 미정 처리)
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const itemSheet = ss.getSheetByName(DB_SHEET_NAME);
    if (itemSheet && itemSheet.getLastRow() > 1) {
        const idSet = new Set(classD1Ids.map(String));
        const d1IdCol       = ITEM_HEADERS.indexOf('class_d1_id') + 1;
        const stuMemberCol  = ITEM_HEADERS.indexOf('stu_member') + 1;
        const bd2Col        = ITEM_HEADERS.indexOf('bid_datetime_2') + 1;
        const chuchenDateCol  = ITEM_HEADERS.indexOf('chuchen_date') + 1;
        const chuchenStateCol = ITEM_HEADERS.indexOf('chuchen_state') + 1;
        const lastItemRow = itemSheet.getLastRow();
        const d1Vals = itemSheet.getRange(2, d1IdCol, lastItemRow - 1, 1).getValues().flat().map(String);
        d1Vals.forEach(function(val, i) {
            if (idSet.has(val)) {
                const r = i + 2;
                itemSheet.getRange(r, stuMemberCol).setValue('미정');
                itemSheet.getRange(r, d1IdCol).setValue('');
                if (bd2Col > 0)        itemSheet.getRange(r, bd2Col).setValue('');
                if (chuchenDateCol > 0)  itemSheet.getRange(r, chuchenDateCol).setValue('');
                if (chuchenStateCol > 0) itemSheet.getRange(r, chuchenStateCol).setValue('');
            }
        });
        SpreadsheetApp.flush();
    }

    // CLASS_D1 행 삭제
    const sheet = ensureClassD1Sheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: '데이터가 없습니다.' };

    const idSet2 = new Set(classD1Ids.map(String));
    const rawD1Data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const ids = rawD1Data.map(function(r) { return r[0]; });
    const affectedClassIds2 = new Set();
    rawD1Data.forEach(function(r) { if (idSet2.has(String(r[0]))) affectedClassIds2.add(String(r[1])); });
    for (let i = ids.length - 1; i >= 0; i--) {
        if (idSet2.has(String(ids[i]))) sheet.deleteRow(i + 2);
    }
    const scriptCache2 = CacheService.getScriptCache();
    affectedClassIds2.forEach(function(cId) { if (cId) scriptCache2.remove('sessions_' + cId); });
    scriptCache2.remove('all_class_d1_sessions');
    scriptCache2.remove('class_batch_counts');
    scriptCache2.remove('all_batch_members');
    scriptCache2.remove('class_member_index');
    return { success: true, message: classD1Ids.length + '개 회차가 삭제되었습니다.' };
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
