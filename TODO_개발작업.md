# 개발 TODO 리스트

작성일: 2026-03-03
상태: 🔲 미완료 / 🔳 진행중 / ✅ 완료

---

## ★ 읽기 전 필수 참조 문서

| 문서 | 내용 |
|------|------|
| `CONSULTING_추천자동만료.md` | 히스토리 DB 설계, telegram_requests 확장 16컬럼 |
| `CONSULTING_알림자동화_메시지관리.md` | 자동알림 로직, 메시지편집 UI 설계, 메시지 31개 목록 |

---

## PHASE 1: 히스토리 DB 확장 【선행 필수】

> 이 단계가 완료되어야 이후 모든 자동화가 가능

### 1-1. telegram_requests 시트 컬럼 5개 추가

**수정 파일**: `SheetDB.js`
**수정 함수**: `ensureTelegramRequestsSheet_()` (line 1138)

추가할 컬럼:
```
L: from_value    (변경 전 값)
M: to_value      (변경 후 값)
N: field_name    (변경된 필드명: stu_member/member_id/bidprice/m_name_id/bid_state/chuchen_state)
O: trigger_type  (web/system/telegram/bulk)
P: member_name   (이벤트 시점 회원명, 집계 편의)
```

작업:
- 🔲 `ensureTelegramRequestsSheet_()` headers 배열에 5개 추가
- 🔲 기존 데이터 호환: 새 컬럼은 빈 값으로 자동 처리됨

### 1-2. writeItemHistory_() 함수 작성

**수정 파일**: `SheetDB.js` (맨 아래에 추가)

```javascript
/**
 * 물건 히스토리를 telegram_requests 시트에 기록
 * @param {Object} p - {action, item_id, member_id, member_name,
 *   field_name, from_value, to_value, trigger_type,
 *   note, chat_id, telegram_username, status}
 */
function writeItemHistory_(p) {
  try {
    const sheet = ensureTelegramRequestsSheet_();
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd HHmmss');
    sheet.appendRow([
      String(new Date().getTime()),  // A: req_id
      now,                           // B: requested_at (yyMMdd HHmmss)
      p.action || '',                // C: action
      p.status || 'DONE',            // D: status
      p.item_id || '',               // E: item_id
      p.member_id || '',             // F: member_id
      p.chat_id || '',               // G: chat_id
      p.telegram_username || '',     // H: telegram_username
      p.note || '',                  // I: note
      now,                           // J: approved_at
      p.approved_by || 'system',     // K: approved_by
      p.from_value || '',            // L: from_value
      p.to_value || '',              // M: to_value
      p.field_name || '',            // N: field_name
      p.trigger_type || 'system',    // O: trigger_type
      p.member_name || ''            // P: member_name
    ]);
  } catch(e) {
    Logger.log('[writeItemHistory_] 오류: ' + e.toString());
  }
}
```

작업:
- 🔲 위 함수 SheetDB.js 하단에 추가

### 1-3. updateData()에 변경 감지 및 히스토리 기록 삽입

**수정 파일**: `SheetDB.js`
**수정 함수**: `updateData()` (line 202)

흐름:
```
1. 저장 전: 기존 값 읽기 (stu_member, member_id, bidprice, m_name_id, bid_state)
2. 저장 실행 (기존 코드 유지)
3. 저장 후: 각 필드 변경 감지 → writeItemHistory_() 호출
```

감지 대상 필드:
```
stu_member  (E열, 4번 인덱스)  → 기존값: sheet.getRange(row,5).getValue()
member_id   (I열, 8번 인덱스)  → sheet.getRange(row,9).getValue()
bidprice    (H열, 7번 인덱스)  → sheet.getRange(row,8).getValue()
m_name_id   (F열, 5번 인덱스)  → sheet.getRange(row,6).getValue()
bid_state   (L열, 11번 인덱스) → sheet.getRange(row,12).getValue()
```

trigger_type 결정:
- updateData 호출 시 파라미터로 triggerType 추가하거나
- 기본값 'web' 사용 (관리자 웹에서 호출하므로)

작업:
- 🔲 updateData() 상단에 기존값 읽기 코드 추가
- 🔲 updateData() 하단에 변경 감지 루프 추가
- 🔲 각 변경 필드마다 writeItemHistory_() 호출

### 1-4. createData()에 ITEM_CREATE 기록 추가

**수정 파일**: `SheetDB.js`
**수정 함수**: `createData()` (line 172)

작업:
- 🔲 sheet.appendRow() 직후 writeItemHistory_({action:'ITEM_CREATE', ...}) 추가

### 1-5. 텔레그램 이벤트에 히스토리 기록 추가

**수정 파일**: `TelegramService.js`, `SheetDB.js`

| 함수 | 추가할 기록 |
|------|-----------|
| `sendChuchenTelegramBulk()` (TelegramService.js:862) | TELEGRAM_SENT 기록 |
| `sendItemToMemberTelegramWithStyle()` (TelegramService.js:763) | TELEGRAM_SENT 기록 |
| `handleTelegramWebhook_()` 수신 처리 | TELEGRAM_RECEIVED 기록 |
| `approveTelegramRequests()` 승인 | REQUEST_APPROVED 기록 |
| `approveTelegramRequests()` 거절 | REQUEST_REJECTED 기록 |

작업:
- 🔲 각 함수에 writeItemHistory_() 추가

---

## PHASE 2: 추천 만료 자동화

> PHASE 1 완료 후 진행

### 2-1. autoExpireRecommended() 함수 작성

**수정 파일**: `SheetDB.js` 또는 새 파일 `AutoTriggers.js`

핵심 로직:
```javascript
function autoExpireRecommended() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // 중복 실행 방지

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DB_SHEET_NAME);
    const now = new Date();

    // stu_member='추천' AND chuchen_date 있는 행 조회
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const data = sheet.getRange(2,1,lastRow-1,ITEM_HEADERS.length).getValues();

    data.forEach((row, i) => {
      const realRow = i + 2;
      const itemId = String(row[0]);
      const stuMember = String(row[4] || '').trim();
      const memberId = String(row[8] || '').trim();
      const chuchenDate = row[17]; // R열
      const chuchenState = String(row[16] || '').trim();

      if (stuMember !== '추천') return;
      if (!chuchenDate || !(chuchenDate instanceof Date)) return;
      if (chuchenState !== '전달완료') return;

      const elapsed = (now - chuchenDate) / (1000 * 3600); // 시간 단위

      if (elapsed >= 48) {
        // 미정 전환
        sheet.getRange(realRow, 5).setValue('미정');
        writeItemHistory_({action:'AUTO_EXPIRE', item_id:itemId, member_id:memberId,
          field_name:'stu_member', from_value:'추천', to_value:'미정',
          trigger_type:'system'});
        // 텔레그램 만료 알림 발송
        // sendExpiryNotification_(memberId, itemId, 'done');

      } else if (elapsed >= 47 && !isAlreadyNotified_(itemId, 'EXPIRY_NOTIFY', '47h')) {
        writeItemHistory_({action:'EXPIRY_NOTIFY', item_id:itemId, member_id:memberId,
          trigger_type:'system', note:'47h'});
        // sendExpiryNotification_(memberId, itemId, '1h');

      } else if (elapsed >= 24 && !isAlreadyNotified_(itemId, 'EXPIRY_NOTIFY', '24h')) {
        writeItemHistory_({action:'EXPIRY_NOTIFY', item_id:itemId, member_id:memberId,
          trigger_type:'system', note:'24h'});
        // sendExpiryNotification_(memberId, itemId, '24h');
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// 이미 알림 발송했는지 확인
function isAlreadyNotified_(itemId, action, noteKey) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const data = sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues(); // A~I열
  return data.some(r =>
    String(r[2]) === action &&
    String(r[4]) === itemId &&
    String(r[8]).indexOf(noteKey) >= 0
  );
}
```

작업:
- 🔲 위 함수 작성
- 🔲 sendExpiryNotification_() 함수 작성 (메시지 템플릿 사용)
- 🔲 GAS 매시간 트리거 등록 (setupAutoExpireTrigger() 함수)

### 2-2. GAS 트리거 등록 함수

```javascript
function setupAutoExpireTrigger() {
  // 기존 동명 트리거 삭제
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'autoExpireRecommended') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoExpireRecommended').timeBased().everyHours(1).create();
}
```

작업:
- 🔲 함수 작성 후 GAS 에디터에서 1회 실행하여 트리거 등록

---

## PHASE 3: 입찰일 알림 자동화

### 3-1. settings 시트 생성 및 설정값 정의

**시트명**: `settings`

| A (key) | B (value) | C (description) |
|---------|---------|----------------|
| BID_NOTIFY_ENABLED | true | 입찰일 알림 전체 ON/OFF |
| BID_NOTIFY_D2 | true | D-2 알림 활성화 |
| BID_NOTIFY_D1 | true | D-1 알림 활성화 |
| BID_NOTIFY_HOUR | 10 | 발송 시각 (시 단위) |
| EXPIRY_NOTIFY_24H | true | 추천 24h 알림 |
| EXPIRY_NOTIFY_1H | true | 추천 1h 전 알림 |
| EXPIRY_NOTIFY_DONE | true | 만료 알림 |

작업:
- 🔲 스프레드시트에 settings 시트 수동 생성 + 위 기본값 입력
- 🔲 `getSetting_(key)` 함수 작성 (SheetDB.js)
- 🔲 `saveSetting_(key, value)` 함수 작성

### 3-2. sendBidDateReminders() 함수 작성

**수정 파일**: `SheetDB.js` 또는 `AutoTriggers.js`

```javascript
function sendBidDateReminders() {
  if (!getSetting_('BID_NOTIFY_ENABLED', 'true') === 'true') return;

  const tz = Session.getScriptTimeZone();
  const today = new Date();
  const d2 = new Date(today); d2.setDate(d2.getDate() + 2);
  const d1 = new Date(today); d1.setDate(d1.getDate() + 1);

  const d2str = Utilities.formatDate(d2, tz, 'yyMMdd');
  const d1str = Utilities.formatDate(d1, tz, 'yyMMdd');

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2,1,lastRow-1,ITEM_HEADERS.length).getValues();

  data.forEach(row => {
    const itemId = String(row[0]);
    const inDate = String(row[1] || '').trim();   // B열: in-date YYMMDD
    const stuMember = String(row[4] || '').trim(); // E열: stu_member
    const memberId = String(row[8] || '').trim();  // I열: member_id

    if (stuMember !== '입찰') return;  // ★ 입찰 상태만 대상
    if (!memberId) return;

    if (getSetting_('BID_NOTIFY_D2','true') === 'true' && inDate === d2str) {
      if (!isAlreadyNotified_(itemId, 'BID_DATE_NOTIFY', 'D-2')) {
        // sendBidDateNotification_(memberId, itemId, 'D-2');
        writeItemHistory_({action:'BID_DATE_NOTIFY', item_id:itemId,
          member_id:memberId, trigger_type:'system', note:'D-2'});
      }
    }
    if (getSetting_('BID_NOTIFY_D1','true') === 'true' && inDate === d1str) {
      if (!isAlreadyNotified_(itemId, 'BID_DATE_NOTIFY', 'D-1')) {
        // sendBidDateNotification_(memberId, itemId, 'D-1');
        writeItemHistory_({action:'BID_DATE_NOTIFY', item_id:itemId,
          member_id:memberId, trigger_type:'system', note:'D-1'});
      }
    }
  });
}
```

작업:
- 🔲 위 함수 작성
- 🔲 sendBidDateNotification_() 작성 (메시지 템플릿 사용)
- 🔲 GAS 매일 10시 트리거 등록 (setupBidDateTrigger() 함수)

---

## PHASE 4: 메시지 템플릿 시스템

### 4-1. msg_templates 시트 생성

**시트명**: `msg_templates`
컬럼: A:msg_key, B:category, C:description, D:template, E:variables, F:updated_at, G:updated_by

작업:
- 🔲 스프레드시트에 msg_templates 시트 생성
- 🔲 31개 기본 메시지 입력 (CONSULTING 문서 3-3절 참조)
- 🔲 기존 하드코딩 메시지 값을 template 컬럼에 복사

### 4-2. getMessageTemplate_() 함수 작성

**수정 파일**: `SheetDB.js`

작업:
- 🔲 getMessageTemplate_(key, vars) 함수 작성 (CONSULTING 문서 3-4절 코드 참조)
- 🔲 replaceVars_() 헬퍼 함수 작성
- 🔲 saveMsgTemplate(key, template) 서버함수 작성 (팝업에서 호출용)

### 4-3. 기존 하드코딩 메시지 교체

**수정 파일**: `TelegramService.js`, `SheetDB.js`

주요 교체 대상:
```
TelegramService.js:691  'MJ 경매 스쿨입니다. 추천 물건드립니다.'
→ getMessageTemplate_('item_card.card')

TelegramService.js:654  '서울/수도권(경기,인천)...'
→ getMessageTemplate_('item_card.warning')

TelegramService.js:657~659  담당자 안내
→ getMessageTemplate_('item_card.staff_1') 등
```

작업:
- 🔲 TelegramService.js 19개 메시지 교체
- 🔲 SheetDB.js 4개 메시지 교체

---

## PHASE 5: 메시지 편집 UI

### 5-1. 환경설정 탭에 버튼 추가

**수정 파일**: `index.html`

```html
<!-- 환경설정 탭 내부에 추가 -->
<button onclick="openMsgEditor()">텔레그램 메시지 편집하기</button>
```

작업:
- 🔲 환경설정 탭 찾아서 버튼 추가

### 5-2. 메시지 편집 팝업 구현

**수정 파일**: `js-app.html`

구현 항목:
- 🔲 팝업 HTML 구조 작성 (CONSULTING 문서 3-5절 UI 설계 참조)
- 🔲 왼쪽 카테고리 트리 렌더링 (msg_templates 시트 데이터 로드)
- 🔲 항목 클릭 시 오른쪽 편집 영역 로드
- 🔲 미리보기: 변수를 샘플값으로 치환하여 표시
- 🔲 저장 버튼: google.script.run.saveMsgTemplate(key, template) 호출
- 🔲 초기화 버튼: 원본값으로 복원

### 5-3. 알림 설정 UI

**수정 파일**: `js-app.html` 또는 `index.html`

작업:
- 🔲 환경설정 탭에 알림 설정 섹션 추가 (CONSULTING 문서 4절 UI 참조)
- 🔲 토글/입력값 변경 → saveSetting_() 호출

---

## PHASE 6: 기타 수정사항

### 6-1. isValidMemberName_ 수정 (★ 이미 로컬 수정 완료, GAS 배포 필요)

**파일**: `SheetDB.js` (line 78)
**상태**: 로컬 수정 완료 ← **GAS에 아직 배포 안됨**

```javascript
// 수정된 코드 확인 후 GAS에 붙여넣기
function isValidMemberName_(mName) {
  if (!mName) return false;
  const members = readAllMembers();
  const inputFull = String(mName).trim();
  const cleanInput = inputFull.replace(/^\([^)]+\)\s*/, '').split(/[\s(]/)[0].trim();
  return members.some(m => {
    const name = String(m.member_name || '').trim();
    if (name === inputFull) return true;
    const cleanName = name.replace(/^\([^)]+\)\s*/, '').split(/[\s(]/)[0].trim();
    return cleanName && cleanInput && cleanName === cleanInput;
  });
}
```

작업:
- 🔲 GAS 에디터에서 isValidMemberName_ 교체 후 저장

### 6-2. validateMember (js-app.html) 수정 (★ 로컬 수정 완료)

**상태**: 로컬 수정 완료 ← **GAS 배포 시 js-app.html도 함께 배포 필요**
작업:
- 🔲 GAS 배포 시 포함 확인

---

## 작업 순서 권장

```
Day 1 (내일):
  [1] PHASE 6-1: isValidMemberName_ GAS 배포 (긴급, MJ 임준희 회원 등록 오류)
  [2] PHASE 1-1,1-2: 히스토리 컬럼 확장 + writeItemHistory_() 작성
  [3] PHASE 1-3: updateData() 변경 감지 삽입

Day 2:
  [4] PHASE 1-4,1-5: createData(), 텔레그램 이벤트 기록
  [5] PHASE 3-1: settings 시트 생성
  [6] PHASE 2-1: autoExpireRecommended() 작성 + 트리거

Day 3:
  [7] PHASE 3-2: sendBidDateReminders() 작성 + 트리거
  [8] PHASE 4: msg_templates 시트 + getMessageTemplate_()

Day 4+:
  [9] PHASE 5: 메시지 편집 UI
```

---

## 주의사항

- GAS 실행 시간 제한: 6분 (LockService 필수)
- appendRow는 O(1)으로 부하 없음
- msg_templates 읽기: CacheService 5분 캐시 사용
- telegram_requests 기존 데이터: 새 컬럼 추가 시 빈 값으로 하위 호환
- in-date 형식: YYMMDD 6자리 (예: 260311)
- chuchen_date: ISO Date 형식 (GAS에서 Date 객체로 읽힘)

---

*2026-03-03 작성 - 내일 개발 시작 전 이 문서와 CONSULTING 2개 문서 읽고 시작*
