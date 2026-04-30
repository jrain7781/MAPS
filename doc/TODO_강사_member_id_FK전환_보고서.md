# [TODO] 강사 식별을 텍스트 → member_id 기반 FK로 전환 (동명이인 발생 시 트리거)

> **작성일**: 2026-04-30
> **작성**: Claude Opus 4.7 (1M context)
> **상태**: 보류 (트리거 발생 시 실행)

## 트리거 조건 (다음 중 하나라도 발생 시 실행)

1. **강사로 등록된 회원 중 본명이 같은 동명이인이 있고, 닉네임도 같음**
   → 룩업 매칭 충돌 (어느 강사인지 구분 불가)
2. **본명이 같은 동명이인이지만 닉네임이 다름** + items 옛 데이터에 **raw 본명**이 저장된 경우
   → 본명 매칭 단계에서 첫 번째 강사로만 매칭됨 (잘못된 강사로 보일 수 있음)
3. **닉네임을 다른 강사가 쓰던 닉네임으로 변경** (재사용)
   → 옛 items 텍스트와 새 강사 매칭이 충돌
4. **회원-강사 간 동명이인 + 잘못된 매칭 발견**
   → 현재 구조는 강사로 필터링 후 매칭하므로 회원 동명이인은 영향 없음. 단 운영상 혼란 시 ID 기반이 안전

## 트리거 안 되는 케이스 (그냥 닉네임만 다르면 OK)

- 동명이인 강사가 닉네임이 서로 다르고, items 신규 데이터만 들어옴
  → 신규 입력은 닉네임으로 저장되어 자동 구분
  → 옛 데이터에 raw 본명이 들어가 있지 않다면 무관

---

## 배경

### 현재 구조 (1~5단계 작업 완료, v@1006 배포됨)

- `items.m_name_id`: **닉네임 텍스트** 저장 (예: "대표님", "전부쌤", "박대원")
- 룩업: `resolveTeacherDisplay_(text)` — 텍스트 양방향 매칭 (닉네임 → 본명)
- 입력 select: 옵션 value/label 모두 닉네임 텍스트
- 표시 4화면 + 텔레그램 모두 룩업 함수로 변환

### 한계

| 케이스 | 현재 동작 | 문제 |
|---|---|---|
| 동명이인 강사 (강사 2명이 같은 본명+같은 닉네임) | 첫 매칭만 사용 | **잘못된 강사 매칭** |
| 닉네임을 다른 강사가 이미 쓴 닉네임으로 변경 | 충돌 | 잘못 매칭 |
| 시트 직접 본명/닉네임 수정 | 옛 items 텍스트와 불일치 | 룩업 실패 |

→ 진정한 식별을 위해서는 **member_id (PK) 기반 FK**가 필요함. 단 현재는 강사 3명·동명이인 없음으로 ROI가 낮아 보류.

---

## 트리거 발생 시 실행할 작업

### Phase 1 — 코드 변경 (양방향 호환 룩업)

#### 1. `resolveTeacherDisplay_()` 함수에 member_id 매칭 추가
파일: `js-app.html` (현재 11432 라인 부근)

```js
function resolveTeacherDisplay_(savedValue) {
    const v = String(savedValue || '').trim();
    if (!v) return { display: '', color: '' };
    const members = Array.isArray(allMembersNewData) ? allMembersNewData : [];
    const isTeacher = (m) => String(m.gubun || '').split(',').map(s => s.trim()).includes('강사');

    // (1) member_id 매칭 (신규/마이그레이션 후 데이터)
    let m = members.find(x => isTeacher(x) && String(x.member_id || '').trim() === v);
    // (2) 닉네임 매칭 (옛 데이터)
    if (!m) m = members.find(x => isTeacher(x) && String(x.teacher_nickname || '').trim() === v);
    // (3) 본명 매칭 (더 옛 데이터)
    if (!m) m = members.find(x => isTeacher(x) && String(x.member_name || '').trim() === v);

    if (!m) return { display: v, color: '' };
    const nickname = String(m.teacher_nickname || '').trim();
    const name = String(m.member_name || '').trim();
    return {
        display: nickname || name || v,
        color: String(m.teacher_color || '').trim()
    };
}
```

#### 2. `populateMNameIdDropdowns_()` value를 member_id로 전환
파일: `js-app.html` (현재 11456 라인 부근)

```js
function populateMNameIdDropdowns_() {
    const members = Array.isArray(allMembersNewData) ? allMembersNewData : [];
    const teachers = members.filter(m => String(m.gubun || '').split(',').map(s => s.trim()).includes('강사'));
    const optHtml = teachers.map(m => {
        const id = String(m.member_id || '').trim();
        const nick = String(m.teacher_nickname || '').trim();
        const name = String(m.member_name || '').trim();
        const label = nick || name;
        if (!id || !label) return '';
        return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    }).filter(Boolean).join('');
    ['form-m-name-id', 'modal-form-m-name-id'].forEach(sid => {
        const sel = document.getElementById(sid);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = optHtml;
        if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
    });
}
```

#### 3. `updateDashboardFilterOptions()` value를 member_id로
파일: `js-app.html` (현재 3081 라인 부근)
- 옵션/체크박스 value = member_id
- label = 닉네임 || 본명
- 옛 raw 텍스트 폴백 옵션 그룹 별도로 추가 (옛 items 호환)

#### 4. 표시 4화면을 `resolveTeacherById_` 또는 `resolveTeacherDisplay_` 통일 사용
- 입찰물건관리 메인 테이블 (현재 1479 부근)
- 입찰일정 카드뷰 3곳 (현재 2278/2521/2989 변수 정의, 6곳 사용)
- 대쉬보드 필터 옵션
- 텔레그램 (`getDisplayName_` 본문 — `buildTeacherDisplayMap_`)

#### 5. 필터 비교 코드 (`applyFilters`, `filtersForList`)
파일: `js-app.html` 7271, 17517 라인 부근
- 체크박스 value가 member_id가 되니까 비교는 raw vs raw → 그대로 OK
- 옛 raw 텍스트 데이터는 위 폴백 옵션으로 매칭

#### 6. 텔레그램 서버측 `getDisplayName_` + `buildTeacherDisplayMap_` 수정
파일: `SheetDB.js` 5886 라인 부근
- map에 member_id 키 추가 (현재는 nickname/name 키만)

#### 7. (선택) Map 캐시화로 O(1) 룩업
- `_teacherByIdMap`, `_teacherByLabelMap` 빌드
- members 데이터 갱신 시 invalidate

---

### Phase 2 — 데이터 마이그레이션 (1회)

#### 마이그레이션 함수 작성 (`SheetDB.js`에 추가)

```js
/**
 * items.m_name_id 텍스트(닉네임/본명)를 member_id로 변환
 * @param {boolean} dryRun true면 변환 카운트만 보고, false면 실제 적용
 */
function migrateItemsMNameIdToMemberId(dryRun) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    if (!sheet) return { success: false, message: 'items 시트 없음' };
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, changed: 0, dryRun: !!dryRun };
    const mNameIdCol = ITEM_HEADERS.indexOf('m_name_id') + 1; // F=6
    const range = sheet.getRange(2, mNameIdCol, lastRow - 1, 1);
    const values = range.getValues();

    // members 강사 매핑: text → member_id
    const mSheet = ss.getSheetByName(DB_MEMBERS_SHEET_NAME);
    if (!mSheet) return { success: false, message: 'members 시트 없음' };
    const mLastRow = mSheet.getLastRow();
    if (mLastRow < 2) return { success: true, changed: 0, dryRun: !!dryRun };
    const colsToRead = Math.min(mSheet.getMaxColumns(), ITEM_MEMBER_HEADERS.length);
    const mData = mSheet.getRange(2, 1, mLastRow - 1, colsToRead).getValues();
    const idIdx = ITEM_MEMBER_HEADERS.indexOf('member_id');
    const gubunIdx = ITEM_MEMBER_HEADERS.indexOf('gubun');
    const nameIdx = ITEM_MEMBER_HEADERS.indexOf('member_name');
    const nickIdx = ITEM_MEMBER_HEADERS.indexOf('teacher_nickname');

    const textToId = {};
    mData.forEach(row => {
        const gubun = String(row[gubunIdx] || '');
        if (!gubun.split(',').map(s => s.trim()).includes('강사')) return;
        const id = String(row[idIdx] || '').trim();
        const name = String(row[nameIdx] || '').trim();
        const nick = (nickIdx >= 0) ? String(row[nickIdx] || '').trim() : '';
        if (!id) return;
        if (nick && !(nick in textToId)) textToId[nick] = id;
        if (name && !(name in textToId)) textToId[name] = id;
    });

    let changed = 0;
    const newValues = values.map(([v]) => {
        const t = String(v || '').trim();
        if (!t) return [v];
        const mappedId = textToId[t];
        if (mappedId && mappedId !== t) {
            changed++;
            return [mappedId];
        }
        return [v];
    });

    if (!dryRun && changed > 0) {
        range.setValues(newValues);
        SpreadsheetApp.flush();
    }

    return { success: true, changed, dryRun: !!dryRun, totalRows: values.length };
}
```

#### 실행 순서

1. **dry-run으로 영향 카운트 확인**:
   ```js
   migrateItemsMNameIdToMemberId(true)
   ```
2. 결과 확인 (예: `{success: true, changed: 47, totalRows: 1234}`)
3. **백업 후 실 실행**:
   - Google Sheets → 파일 → 사본 만들기 (백업)
   - `migrateItemsMNameIdToMemberId(false)`
4. 검증:
   - 4개 화면 진입해서 강사 닉네임 정상 표시되는지
   - 필터 매칭 정상인지
   - 텔레그램 발송 시 닉네임 표시되는지

---

## 영향 받는 파일/위치 체크리스트

- [ ] `js-app.html`
  - [ ] `resolveTeacherDisplay_` (라인 ~11432)
  - [ ] `resolveTeacherById_` (라인 ~11425) — 이미 ID 기반이므로 그대로 유지
  - [ ] `populateMNameIdDropdowns_` (라인 ~11456)
  - [ ] `updateDashboardFilterOptions` (라인 ~3081)
  - [ ] 입찰물건관리 메인 테이블 셀 (라인 ~1479)
  - [ ] 입찰일정 카드뷰 변수 정의 3곳 (~2278, ~2521, ~2989)
  - [ ] 입찰일정 카드뷰 사용 6곳 (~2329, ~2345, ~2565, ~2580, ~3025, ~3044)
  - [ ] 필터 비교 (~7271, ~17517)
- [ ] `SheetDB.js`
  - [ ] `getDisplayName_` (라인 ~5895)
  - [ ] `buildTeacherDisplayMap_` (라인 ~5886) — member_id 키 추가
  - [ ] `migrateItemsMNameIdToMemberId` 신규 추가
- [ ] `index.html`
  - [ ] 입력 select 옵션은 동적 생성이므로 손댈 필요 없음

---

## 주의사항

1. **이력 시트 영향**: items 변경이 history 시트에 트리거 안 되도록 직접 setValues 사용 (트리거 우회)
2. **하위 호환**: 룩업 함수에 (1) member_id (2) 닉네임 (3) 본명 3단계 폴백 유지 — 마이그레이션 안 된 raw 텍스트도 동작
3. **시트 가독성**: items 시트 직접 보면 m_name_id가 ID로 보여 사람이 못 읽음 → 옆 컬럼에 `=VLOOKUP` 수식으로 이름 표시 추가 권장 (선택)
4. **여러 시트 의존성**: 다른 화면(검색, 이력, 통계 등)에서 m_name_id를 텍스트로 가정하는 코드가 있으면 추가 수정 필요. Phase 1 작업 전에 grep으로 전수 조사 필요:
   ```
   grep -rn "m_name_id" --include="*.{js,html}"
   ```

---

## 결정 보류 이유

- 강사 3명, 동명이인 없음, members 시트 변경 빈도 낮음 → 현재 텍스트 방식으로 충분히 동작
- 1~5단계 작업 (v@1006)이 잘 동작 중이라 추가 변경의 리스크/비용 > 이득
- 트리거 발생 시 이 보고서 따라 한 번에 작업 가능

## 트리거 시 작업 예상 시간

- Phase 1 (코드 변경): 1~2시간
- Phase 2 (마이그레이션 dry-run + 실행 + 검증): 30분
- 전체: 약 2~3시간

---

## 부록: 현재 운영 중인 강사 정보 (2026-04-30 기준)

| member_id | 이름 | 닉네임 | gubun |
|---|---|---|---|
| (확인 필요) | 장재호 | 대표님 | 직원,강사 |
| (확인 필요) | 전제혁 | 전부쌤 | 직원,강사 |
| (확인 필요) | 박대원 | (없음) | 직원,강사 |

> 트리거 시점에 다시 시트 직접 확인할 것.
