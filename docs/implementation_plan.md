# 입찰가 전달 및 확인 UI 연동 구현 계획

목표: 관리자가 입찰가를 전송하면 상태가 '전달완료'가 되고 텔레그램으로 안내되며, 회원이 대시보드에서 흐리게 처리된 입찰가를 클릭하면 '확인완료'로 상태가 변경되는 기능을 구현합니다.

## User Review Required

- 보고서(`bidding_price_process_report.md`) 및 본 구현 계획서의 프로세스 흐름이 의도와 정확히 일치하는지 확인해 주세요.
- 특히 상태값의 명칭(`신규`, `전달완료`, `확인완료`) 및 텔레그램 메시지 문구("입찰가가 도착했습니다") 등이 맞는지 확인 부탁드립니다.

## Proposed Changes

### 1. Telegram Service (백엔드)

`TelegramService.js` 기능을 수정하여 텔레그램 메시지 발송 시 문구 수정 및 상태 업데이트를 처리합니다.

- `telegramBuildItemMessage_` 등 메시지 포맷팅 함수에서 `style === 'bid_price'` 일 때:
  - 텍스트를 "입찰가가 도착했습니다. 아래 버튼(보러가기)을 눌러 확인해 주세요." 등의 문구로 변경합니다.
  - 입찰가를 메시지 본문에서 직접 노출하지 않고, MAPS 앱 진입 버튼을 유도합니다.
- 관리자가 "선택 전송(입찰가 안내)"을 실행할 때 (`handleBulkTelegramSendFromItemList` 등 호출 시) 성공적으로 발송된 아이템들의 `bid_state`를 `전달완료`로 일괄 업데이트합니다.

### 2. Backend API 추가 (`SheetDB.js` or `Code.js`)

회원이 프론트엔드에서 입찰가를 클릭했을 때 데이터베이스(구글 시트)를 업데이트할 서버 함수를 추가합니다.

- **`updateBidPriceConfirmed(memberToken, itemId)`**:
  - `memberToken` 검증을 통해 권한을 확인합니다.
  - 해당 `itemId`를 가진 물건의 `bid_state` 값을 `확인완료`로 변경합니다.
  - 성공 여부를 프론트엔드로 반환합니다.

### 3. Frontend 스타일 (`css.html`)

블러 처리와 확인완료 텍스트를 위한 CSS 클래스를 추가합니다.

- `.price-blur`: `filter: blur(5px); transition: filter 0.3s; cursor: pointer; user-select: none;`
- `.price-clear`: `filter: blur(0);`
- `.bid-state-confirmed`: `color: blue; font-weight: bold;`

### 4. Frontend 로직 (`js-app.html`)

회원 대시보드 및 월별 조회 카드 렌더링을 수정합니다.

- **카드 렌더링 (`renderMemberDashboard`, `renderMemberItemList` 등)**:
  - `item.bid_state`가 비어있거나 `신규`인 경우: 입찰가 자리에 `(미정)` 텍스트 표시
  - `item.bid_state`가 `전달완료`인 경우: 입찰가 금액 텍스트에 `<span class="price-blur" onclick="confirmBidPrice(this, 'itemId')">[금액]원</span>` 형태로 블러 처리 적용
  - `item.bid_state`가 `확인완료`인 경우: 입찰가 금액 정상 노출
- **클릭 이벤트 (`confirmBidPrice(el, itemId)`)**:
  - 클릭 시 즉시 요소의 클래스를 `.price-clear`로 변경하여 선명하게 보여줍니다.
  - 백그라운드로 `google.script.run.updateBidPriceConfirmed`를 호출하여 서버 상태를 업데이트합니다.
  - 로컬 메모리의 `item.bid_state`도 즉시 `확인완료`로 동기화합니다.
- **관리자 목록 화면**:
  - `ItemManagement` 데이터 테이블 렌더링 시 `bid_state` 값을 표시하고, `확인완료`인 경우 `.bid-state-confirmed` (파란색 굵게) 스타일을 적용합니다.

## Verification Plan

### Automated Tests

* GAS 환경 특성상 별도의 단위 테스트 프레임워크가 부재하므로 수동 검증 위주로 진행합니다.

### Manual Verification

1. **관리자 발송 테스트**: 관리자가 '입찰물건 관리'에서 `입찰가 안내` 옵션으로 선택 전송을 클릭하면 텔레그램 메시지가 정상 전송되고 물건의 `bid_state`가 `전달완료`로 바뀌는지 확인.
2. **회원 UI 테스트**: 모바일/웹에서 회원 링크로 접속 시 해당 물건의 금액이 흐리게 보이는지 확인.
3. **확인완료 테스트**: 흐릿한 금액을 탭/클릭하면 즉시 선명한 텍스트로 전환되며, 새로고침 후에도 선명하게 렌더링되고 서버의 상태가 `확인완료`로 유지되는지 확인.
4. **관리자 목록 점검**: 관리자 목록에서 `bid_state` 컬럼에 '확인완료'가 파란색 굵게 표시되는지 확인.

---

---

# 추가 기능 구현 계획 (by Claude Sonnet 4.6 / 2026-02-27)

> 위 계획(안티그래비티 작성)은 수정 없이 유지. 아래는 별도 추가 기능입니다.
> 각 STEP 순서대로: **코드 수정 → `clasp push` → GAS 웹앱 검증 → `git push`**

---

## 컨설팅 답변

### 물건 전달 후 48시간 내 푸쉬 횟수 (허용 시간: 09:00~18:00)

| 시점 | 조건 | 메시지 |
|------|------|--------|
| T+1h (또는 다음 09시) | 최초 안내 | 📩 물건이 도착했어요 |
| T+6h (또는 다음 09시) | 미확인 시 | 📋 확인 기다리고 있어요 |
| T+24h | 미확인 시 | ⏰ 24시간이 지났어요 |
| T+36h | 미확인 시 | ⚠️ 마감 12시간 전 경고 |
| T+47h (또는 전날 18시 이전) | 미확인 시 | 🚨 1시간 후 자동 만료 |

- 최대 5회, 회원이 입찰확정/취소 시 자동 중단
- 18:00~09:00 예정 푸쉬는 다음 날 09:00으로 자동 이동

### 입찰 확정 후 입찰일 기준 알림 (허용 시간: 09:00~18:00)

| 시점 | 발송 시각 | 내용 |
|------|-----------|------|
| D-3 (입찰일 3일 전) | 09:00 | 📅 입찰일이 3일 남았습니다 |
| D-2 | 09:00 | 📅 입찰일이 2일 남았습니다 |
| D-1 | 15:00 | 📋 내일 입찰입니다. 입찰가 최종 확인 |
| D-0 (당일) | 08:00 | 🚀 오늘 입찰일입니다! |

- 총 4회, 입찰 취소 시 자동 중단

### 텔레그램 메시지 창에서 웹 물건카드 그대로 표시 가능한가?

- ❌ 직접 불가 — 텔레그램은 HTML/CSS 렌더링 미지원
- ✅ 대안: `parse_mode: 'HTML'` + 이모지로 카드 유사 포맷 구현 (STEP 2에 포함)
- "내물건보기" 버튼 → Web App 링크로 실제 카드 확인 유도가 최선

---

## 전체 구현 로드맵

```
STEP 1  → 자동 승인 처리 시스템 + 대시보드 토글
STEP 2  → 텔레그램 메시지 스타일 전면 개선
STEP 3  → item_history 시트 + 히스토리 UI
STEP 4  → 알림 푸쉬 스케줄러 (48시간 리마인드 / 입찰일 D-3)
STEP 5  → 48시간 로딩바 UI (회원 물건카드)
```

---

## STEP 1: 자동 승인 처리 시스템

### 목표

회원의 입찰확정/취소 요청을 자동처리 OR 수동처리 선택 가능하게 대시보드에 토글 추가.

### 현재 흐름 (수동)

```
BID_YES 클릭
  → createTelegramRequest() — PENDING 생성
  → 관리자가 대시보드에서 approveTelegramRequests() 실행
```

### 새 흐름 (자동 모드 ON)

```
BID_YES 클릭
  → createTelegramRequest() — PENDING 생성
  → getAutoApprovalMode() === 'AUTO' 이면
  → approveTelegramRequests([req_id], 'AUTO') 즉시 호출
  → 상태 변경 + 텔레그램 자동 알림
```

### 수정 파일

#### `Code.js` — 함수 2개 추가 (기존 함수 수정 없음)

```javascript
// ScriptProperties에서 자동 승인 모드 읽기
function getAutoApprovalMode() {
  return PropertiesService.getScriptProperties()
    .getProperty('AUTO_APPROVAL_MODE') || 'MANUAL';
}

// 자동 승인 모드 저장 (mode: 'AUTO' | 'MANUAL')
function saveAutoApprovalMode(mode) {
  PropertiesService.getScriptProperties()
    .setProperty('AUTO_APPROVAL_MODE', mode);
  return { success: true, mode: mode };
}
```

#### `TelegramService.js` — BID_YES / CANCEL_YES 처리 블록 수정

`handleTelegramWebhook_()` 함수 내 BID_YES / CANCEL_YES 처리 부분(약 line 381~466)에서
`createTelegramRequest()` 호출 직후 아래 코드를 추가:

```javascript
// 자동 승인 모드 체크
const autoMode = getAutoApprovalMode();
if (autoMode === 'AUTO' && createResult.success) {
  approveTelegramRequests([createResult.req_id], 'AUTO');
}
```

#### `js-app.html` — 함수 2개 추가

```javascript
// 페이지 로드 시 현재 모드 반영
async function loadAutoApprovalMode() {
  const mode = await gasCall('getAutoApprovalMode');
  const radios = document.querySelectorAll('input[name="approval-mode"]');
  radios.forEach(r => { r.checked = (r.value === mode); });
}

// 모드 변경 저장
async function saveAutoApprovalMode(mode) {
  const result = await gasCall('saveAutoApprovalMode', mode);
  if (result && result.success) {
    showStatus(
      `승인 처리 방식이 "${mode === 'AUTO' ? '자동' : '수동'}"으로 변경되었습니다.`,
      'success'
    );
  }
}
```

Dashboard 로드 함수(예: `loadDashboard()`)에 `loadAutoApprovalMode()` 호출 추가.

#### `index.html` — Dashboard "입찰 요청(승인 대기)" 패널 상단에 추가

```html
<!-- 자동/수동 승인 모드 토글 -->
<div class="flex items-center gap-3 mb-3 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
  <span class="text-sm font-bold text-indigo-700">승인 처리 방식</span>
  <label class="flex items-center gap-1 cursor-pointer text-sm">
    <input type="radio" name="approval-mode" value="MANUAL"
           onchange="saveAutoApprovalMode('MANUAL')">
    수동 처리
  </label>
  <label class="flex items-center gap-1 cursor-pointer text-sm font-bold text-indigo-600">
    <input type="radio" name="approval-mode" value="AUTO"
           onchange="saveAutoApprovalMode('AUTO')">
    자동 처리
  </label>
  <span class="text-xs text-gray-400 ml-2">(자동: 회원 요청 즉시 처리)</span>
</div>
```

### 테스트

1. `clasp push` 후 대시보드 접속
2. "자동 처리" 라디오 선택 → 새로고침 후에도 유지되는지 확인
3. 텔레그램 테스트 계정으로 입찰확정 클릭
4. 관리자 승인 없이 즉시 상태 '입찰' 변경 + 텔레그램 확인 메시지 수신 확인
5. "수동 처리"로 변경 → 동일 테스트 시 PENDING 상태로 대기 확인
6. `git push`

---

## STEP 2: 텔레그램 메시지 스타일 전면 개선

### 목표

단순 텍스트 → 헤더 / 구분선 / 데이터 / 하단 안내 구조로 개선 (카카오톡 스타일 참고).
텔레그램은 배경색 지원 안 됨 → `parse_mode: 'HTML'` + 이모지 + Bold로 시각적 구분.

### 스타일별 새 메시지 포맷

**`card` — 추천 물건 안내:**

```
🏠 <b>추천 물건 안내</b>
━━━━━━━━━━━━━━━━━━
📅 <b>입찰일</b>   2026-03-15 (토)
🏛 <b>법원</b>     서울중앙지방법원
📋 <b>사건번호</b>  <code>2025타경12345</code>
👤 <b>담당</b>     홍길동
━━━━━━━━━━━━━━━━━━
💬 입찰 의사를 확인해 주세요.
```

버튼: `[✅ 입찰확정]` `[❌ 입찰취소]` `[📋 내물건보기]`

**`bid_price` — 입찰가 안내** (입찰가 본문 미노출, 기존 계획 유지):

```
💰 <b>입찰가 안내</b>
━━━━━━━━━━━━━━━━━━
📅 <b>입찰일</b>   2026-03-15
🏛 <b>법원</b>     서울중앙지방법원
📋 <b>사건번호</b>  <code>2025타경12345</code>
━━━━━━━━━━━━━━━━━━
📲 입찰가가 도착했습니다.
앱에서 확인 후 클릭해 주세요.
```

버튼: `[📋 내물건보기]`

**`status` — 입찰취소 알림:**

```
🚫 <b>입찰 취소 안내</b>
━━━━━━━━━━━━━━━━━━
📋 <code>2025타경12345</code>
취소 처리가 완료되었습니다.
```

**`reminder` — 48시간 리마인드** (STEP 4에서 사용):

```
⏰ <b>확인 요청</b>
━━━━━━━━━━━━━━━━━━
📋 <code>2025타경12345</code>
아직 입찰 의사를 선택하지 않으셨습니다.
남은 시간: <b>N시간</b>
━━━━━━━━━━━━━━━━━━
서둘러 확인해 주세요!
```

**`bid_alert` — 입찰일 D-N 알림** (STEP 4에서 사용):

```
📅 <b>입찰일 D-N 알림</b>
━━━━━━━━━━━━━━━━━━
📋 <code>2025타경12345</code>
🏛 서울중앙지방법원
입찰일이 <b>N일</b> 남았습니다.
━━━━━━━━━━━━━━━━━━
입찰가를 꼭 확인해 주세요.
```

### 수정 파일

#### `TelegramService.js` — `telegramBuildItemMessage_()` 함수 전면 재작성

1. 파일 상단에 스타일 설정 오브젝트 추가:

```javascript
const TELEGRAM_DIVIDER = '━━━━━━━━━━━━━━━━━━';

const TELEGRAM_STYLE_CONFIG = {
  card: {
    header: '🏠 <b>추천 물건 안내</b>',
    footer: '💬 입찰 의사를 확인해 주세요.',
    showPrice: false,
    buttons: ['confirm', 'cancel', 'view']
  },
  bid_price: {
    header: '💰 <b>입찰가 안내</b>',
    footer: '📲 입찰가가 도착했습니다.\n앱에서 확인 후 클릭해 주세요.',
    showPrice: false,   // 본문 미노출 (앱에서 확인 유도)
    buttons: ['view']
  },
  status: {
    header: '🚫 <b>입찰 취소 안내</b>',
    footer: '취소 처리가 완료되었습니다.',
    showPrice: false,
    buttons: ['view']
  },
  check_request: {
    header: '✅ <b>입찰 확정 확인</b>',
    footer: '⚠️ 입찰가를 반드시 확인하고 답변해 주세요.',
    showPrice: true,
    buttons: ['confirm', 'cancel', 'view']
  },
  reminder: {
    header: '⏰ <b>확인 요청</b>',
    footer: '서둘러 확인해 주세요!',
    showPrice: false,
    buttons: ['confirm', 'cancel', 'view']
  },
  bid_alert: {
    header: '📅 <b>입찰일 알림</b>',
    footer: '입찰가를 꼭 확인해 주세요.',
    showPrice: false,
    buttons: ['view']
  }
};
```

2. `telegramBuildItemMessage_()` 재작성:

```javascript
function telegramBuildItemMessage_(item, member, styleKey) {
  const cfg = TELEGRAM_STYLE_CONFIG[styleKey] || TELEGRAM_STYLE_CONFIG['card'];
  const lines = [
    cfg.header,
    TELEGRAM_DIVIDER,
    `📅 <b>입찰일</b>   ${item.date || ''}`,
    `🏛 <b>법원</b>     ${item.court || ''}`,
    `📋 <b>사건번호</b>  <code>${item.case_no || ''}</code>`,
    `👤 <b>담당</b>     ${item.handler || member.name || ''}`,
  ];
  if (cfg.showPrice && item.bid_price) {
    lines.push(TELEGRAM_DIVIDER);
    lines.push(`💵 <b>입찰가</b>   ${Number(item.bid_price).toLocaleString('ko-KR')}원`);
  }
  lines.push(TELEGRAM_DIVIDER);
  lines.push(cfg.footer);
  return { text: lines.join('\n'), buttons: cfg.buttons };
}
```

3. `telegramSendMessage_()` 또는 메시지 전송 호출부에 `parse_mode: 'HTML'` 파라미터 확인/추가.

### 테스트

1. `clasp push`
2. ItemManagement → 테스트 물건 선택 → "추천물건 안내" 전송
3. 텔레그램에서 새 스타일 확인 (헤더/구분선/굵은 라벨)
4. "입찰가 안내" 전송 → 입찰가 미노출 + "내물건보기" 버튼만 표시 확인
5. 입찰확정/취소 버튼 동작 확인
6. `git push`

---

## STEP 3: item_history 시트 + 히스토리 UI

### 목표

물건의 전 생애주기 이벤트 기록. 물건 상세 탭에서 타임라인으로 확인.
키값(item_id + member_id 조합)이 바뀌면 새 카드로 인식.

### 새 시트: `item_history`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| history_id | Number | Timestamp 기반 고유 ID |
| recorded_at | String | ISO 8601 기록 시각 |
| event_type | String | 이벤트 종류 (아래 목록) |
| item_id | String | 물건 ID |
| item_key | String | `{item_id}::{member_id}` 복합키 |
| member_id | String | 관련 회원 ID |
| old_value | String | 변경 전 값 (JSON 문자열) |
| new_value | String | 변경 후 값 (JSON 문자열) |
| triggered_by | String | 실행 주체 ('AUTO', 관리자명, 'SYSTEM') |
| note | String | 비고 |

**event_type 목록:**

- `ITEM_SENT` — 텔레그램 물건 전송
- `BID_REQUESTED` — 회원 입찰확정 요청
- `CANCEL_REQUESTED` — 회원 취소 요청
- `BID_APPROVED` — 승인 처리 (자동/수동)
- `BID_REJECTED` — 반려 처리
- `PRICE_SENT` — 입찰가 전송 (bid_state → 전달완료)
- `PRICE_CONFIRMED` — 회원 입찰가 확인 클릭 (bid_state → 확인완료)
- `STATUS_CHANGED` — 물건 상태값 변경
- `MEMBER_CHANGED` — 담당 회원 변경
- `PRICE_CHANGED` — 입찰가 변경
- `PUSH_SENT` — 리마인드 푸쉬 발송
- `AUTO_EXPIRED` — 48시간 만료로 미정 자동 전환

**item_key 규칙:** `{item_id}::{member_id}` — 회원이 바뀌면 새 item_key → 히스토리에서 새 카드로 인식

### 수정 파일

#### `SheetDB.js` — 함수 2개 추가

```javascript
const ITEM_HISTORY_SHEET_NAME = 'item_history';
const ITEM_HISTORY_HEADERS = [
  'history_id', 'recorded_at', 'event_type', 'item_id', 'item_key',
  'member_id', 'old_value', 'new_value', 'triggered_by', 'note'
];

function addItemHistory(eventType, itemId, memberId, oldVal, newVal, triggeredBy, note) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(ITEM_HISTORY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ITEM_HISTORY_SHEET_NAME);
    sheet.appendRow(ITEM_HISTORY_HEADERS);
  }
  const now = new Date();
  sheet.appendRow([
    now.getTime(),
    now.toISOString(),
    eventType,
    itemId || '',
    `${itemId || ''}::${memberId || 'none'}`,
    memberId || '',
    JSON.stringify(oldVal || {}),
    JSON.stringify(newVal || {}),
    triggeredBy || 'SYSTEM',
    note || ''
  ]);
}

function getItemHistory(itemId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITEM_HISTORY_SHEET_NAME);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1)
    .filter(row => row[3] === itemId)  // item_id 컬럼 인덱스 3
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
    .sort((a, b) => Number(b.history_id) - Number(a.history_id));
}
```

#### `Code.js` — API 래퍼 추가

```javascript
function getItemHistoryApi(itemId) {
  return getItemHistory(itemId);
}
```

#### 히스토리 기록 연동 위치

| 파일 | 함수 | 추가 이벤트 |
|------|------|-------------|
| TelegramService.js | `sendItemToMemberTelegramWithStyle()` | `ITEM_SENT` |
| TelegramService.js | BID_YES 처리 블록 | `BID_REQUESTED` |
| TelegramService.js | CANCEL_YES 처리 블록 | `CANCEL_REQUESTED` |
| SheetDB.js | `approveTelegramRequests()` | `BID_APPROVED` |
| SheetDB.js | `rejectTelegramRequests()` | `BID_REJECTED` |
| SheetDB.js | 입찰가 전송 후 bid_state 업데이트 | `PRICE_SENT` |
| SheetDB.js | `updateBidPriceConfirmed()` (기존 계획 함수) | `PRICE_CONFIRMED` |
| SheetDB.js | 아이템 상태 변경 시 | `STATUS_CHANGED` |
| SheetDB.js | 담당 회원 변경 시 | `MEMBER_CHANGED` |

#### `index.html` — 물건 상세 패널(detailPane)에 히스토리 탭 추가

기존 상세 탭 버튼 리스트 끝에 추가:

```html
<button class="detail-tab-btn" id="tab-history"
        onclick="switchDetailTab('history')">
  📋 히스토리
</button>
```

탭 패널 영역에 추가:

```html
<div id="detail-panel-history" class="detail-tab-panel hidden">
  <div id="item-history-list" class="p-2">
    <!-- JS 렌더링: 타임라인 -->
  </div>
</div>
```

#### `js-app.html` — 히스토리 렌더링 함수 추가

```javascript
// 히스토리 이벤트 아이콘 매핑
const HISTORY_EVENT_ICONS = {
  ITEM_SENT:        '📤',
  BID_REQUESTED:    '🙋',
  CANCEL_REQUESTED: '🙅',
  BID_APPROVED:     '✅',
  BID_REJECTED:     '❌',
  PRICE_SENT:       '💰',
  PRICE_CONFIRMED:  '👀',
  STATUS_CHANGED:   '🔄',
  MEMBER_CHANGED:   '👤',
  PRICE_CHANGED:    '✏️',
  PUSH_SENT:        '🔔',
  AUTO_EXPIRED:     '⌛'
};

async function loadItemHistory(itemId) {
  const list = document.getElementById('item-history-list');
  list.innerHTML = '<p class="text-gray-400 text-sm p-2">로딩 중...</p>';
  const history = await gasCall('getItemHistoryApi', itemId);
  if (!history || history.length === 0) {
    list.innerHTML = '<p class="text-gray-400 text-sm p-2">히스토리 없음</p>';
    return;
  }
  list.innerHTML = history.map(h => {
    const icon = HISTORY_EVENT_ICONS[h.event_type] || '📌';
    const dt = new Date(h.recorded_at).toLocaleString('ko-KR');
    return `<div class="flex items-start gap-2 py-2 border-b border-gray-100">
      <span class="text-lg">${icon}</span>
      <div>
        <div class="text-xs text-gray-500">${dt} · ${h.triggered_by}</div>
        <div class="text-sm font-medium">${h.event_type}</div>
        ${h.note ? `<div class="text-xs text-gray-400">${h.note}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}
```

상세 탭 전환 시 `loadItemHistory(currentItemId)` 호출.

### 테스트

1. `clasp push`
2. 스프레드시트에서 `item_history` 시트 자동 생성 확인
3. 물건 텔레그램 전송 → `ITEM_SENT` 행 확인
4. 입찰확정 → `BID_REQUESTED` / `BID_APPROVED` 행 확인
5. 물건 상세 UI → "히스토리" 탭 → 타임라인 렌더링 확인
6. `git push`

---

## STEP 4: 알림 푸쉬 스케줄러

### 목표

GAS 1시간 트리거 기반 자동 푸쉬:

1. 물건 전달 후 48시간 내 미응답 회원 → 최대 5회 리마인드
2. 48시간 경과 시 자동 '미정' 전환 + 회원 알림
3. 입찰 확정 물건 → 입찰일 D-3~D-0 알림 4회
4. 조용한 시간(18:00~09:00) 발송 금지

### 신규 파일: `PushScheduler.js`

```javascript
// ===== 발송 스케줄 설정 =====
const REMIND_HOURS_SCHEDULE = [1, 6, 24, 36, 47]; // 전송 후 N시간 후 발송
const BID_ALERT_DAYS = { '-3': 9, '-2': 9, '-1': 15, '0': 8 }; // D-N: 발송 시각(시)

// ===== 조용한 시간 체크 (KST 기준) =====
function isQuietHour_() {
  const hour = new Date().getHours(); // appsscript.json timeZone: "Asia/Seoul" 필수
  return hour < 9 || hour >= 18;
}

// ===== 메인 스케줄러 (1시간마다 트리거) =====
function runHourlyScheduler() {
  checkBidReminderPushes();
  checkAutoExpiry();
  checkBidDatePushes();
}

// ===== 48시간 리마인드 =====
function checkBidReminderPushes() {
  if (isQuietHour_()) return;

  // 1. item_history에서 ITEM_SENT 이벤트 조회
  // 2. 현재 상태 '추천'인 물건만 필터
  // 3. 경과 시간(시간 단위) 계산
  // 4. REMIND_HOURS_SCHEDULE 중 아직 발송 안 된 시점 확인
  //    (item_history의 PUSH_SENT 이벤트 조회로 중복 방지)
  // 5. 해당하는 물건에 reminder 스타일 텔레그램 발송
  // 6. addItemHistory('PUSH_SENT', ...) 기록
}

// ===== 48시간 만료 자동 미정 전환 =====
function checkAutoExpiry() {
  // 1. item_history ITEM_SENT 후 48시간 이상 경과
  // 2. 현재 상태 '추천'인 물건
  // 3. stu_member → '미정' 변경
  // 4. addItemHistory('AUTO_EXPIRED', ...) 기록
  // 5. 회원에게 만료 알림 텔레그램 발송
}

// ===== 입찰일 D-N 알림 =====
function checkBidDatePushes() {
  if (isQuietHour_()) return;

  // 1. items 시트에서 stu_member === '입찰'인 물건 조회
  // 2. 각 물건의 bid_date와 현재 날짜 비교 → D-N 계산
  // 3. BID_ALERT_DAYS에 정의된 시각과 현재 시각 비교
  // 4. 해당 날짜+시각이면 bid_alert 스타일 텔레그램 발송
  // 5. addItemHistory('PUSH_SENT', ...) 기록 (중복 방지용)
}
```

**주의:** `REMIND_HOURS_SCHEDULE`과 `BID_ALERT_DAYS`는 파일 상단에 상수로 정의해 유지보수 편의성 확보.

#### `appsscript.json` — 타임존 확인

```json
{
  "timeZone": "Asia/Seoul",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

#### `Backup.js` — 스케줄러 트리거 설정 함수 추가

```javascript
function setupHourlyScheduler() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runHourlyScheduler')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 1시간마다 트리거 생성
  ScriptApp.newTrigger('runHourlyScheduler')
    .timeBased()
    .everyHours(1)
    .create();

  SpreadsheetApp.getUi().alert('시간별 스케줄러가 설정되었습니다.');
}
```

#### `Code.js` — `onOpen()` 메뉴에 추가

기존 관리자 메뉴 `.addItem()` 목록 끝에:

```javascript
.addItem('⏰ 시간별 스케줄러 설정', 'setupHourlyScheduler')
```

### 테스트

1. `clasp push`
2. Admin 메뉴 → "시간별 스케줄러 설정" 실행
3. GAS 편집기 → 트리거 탭에서 `runHourlyScheduler` 1시간 트리거 확인
4. `runHourlyScheduler()` 수동 실행 → item_history에 `PUSH_SENT` 행 생성 확인
5. 테스트 회원 텔레그램으로 리마인드 메시지 수신 확인
6. 48시간 경과 물건 → 상태 '미정' 자동 전환 확인
7. `git push`

---

## STEP 5: 48시간 로딩바 UI

### 목표

회원의 물건카드('추천' 상태) 하단에 48시간 카운트다운 바 표시.

- 48칸 = 1칸당 1시간
- 색상: 초록(남은 25h 이상) → 노랑(24h 이하) → 주황(12h 이하) → 빨강(6h 이하)
- 입찰확정/취소 후 바 숨김
- 1분마다 자동 업데이트

### 데이터 요구사항

- `item.sent_at`: STEP 3의 item_history `ITEM_SENT` 이벤트 `recorded_at` 값
- 카드 데이터 로드 시 `sent_at` 포함되도록 백엔드 수정 필요
- (대안: `readDataByMemberToken()` 응답에 `sent_at` 필드 추가)

### `css.html` — 스타일 추가

```css
/* 48시간 타이머 바 */
.bid-timer-bar {
  display: flex;
  gap: 1px;
  height: 6px;
  background: #f1f5f9;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 8px;
}
.bid-timer-segment {
  flex: 1;
  height: 100%;
  border-radius: 1px;
  transition: background-color 0.5s;
}
.bts-green  { background: #22c55e; }
.bts-yellow { background: #eab308; }
.bts-orange { background: #f97316; }
.bts-red    { background: #ef4444; }
.bts-empty  { background: #e2e8f0; }
.bid-timer-label {
  font-size: 0.7rem;
  color: #94a3b8;
  text-align: right;
  margin-top: 2px;
}
```

### `js-app.html` — 타이머 바 함수 추가 및 카드 렌더 수정

타이머 바 생성 함수:

```javascript
function createTimerBar(sentAt) {
  if (!sentAt) return '';
  const elapsed = Math.floor((Date.now() - new Date(sentAt).getTime()) / 3_600_000);
  const remaining = Math.max(0, 48 - elapsed);

  const segments = Array.from({ length: 48 }, (_, i) => {
    if (i >= elapsed) {
      return `<div class="bid-timer-segment bts-empty"></div>`;
    }
    const hoursLeft = 48 - i;
    const cls = hoursLeft <= 6  ? 'bts-red'
              : hoursLeft <= 12 ? 'bts-orange'
              : hoursLeft <= 24 ? 'bts-yellow'
              : 'bts-green';
    return `<div class="bid-timer-segment ${cls}"></div>`;
  }).join('');

  const label = remaining > 0
    ? `⏱ ${remaining}시간 남음`
    : '⚠️ 만료됨';

  return `<div class="bid-timer-bar">${segments}</div>
          <div class="bid-timer-label">${label}</div>`;
}
```

`createMemberItemCard(item)` 함수 내 카드 HTML 하단에 추가 (추천 상태만):

```javascript
const timerHtml = (item.stu_member === '추천' && item.sent_at)
  ? createTimerBar(item.sent_at)
  : '';
// ... 기존 카드 HTML 끝 부분에 ${timerHtml} 삽입
```

60초마다 카드 리렌더링 (페이지 로드 후 1회 설정):

```javascript
setInterval(() => {
  // 현재 로드된 카드 목록이 있으면 리렌더링
  if (window._memberItemsCache) renderMemberCards(window._memberItemsCache);
}, 60_000);
```

### 테스트

1. `clasp push`
2. 회원화면(MemberDashboard / MemberItemList) 접속
3. '추천' 상태 물건카드 하단에 48칸 로딩바 + "N시간 남음" 라벨 표시 확인
4. `sent_at` 값을 최근으로 조작(개발자 도구) → 초록색 표시 확인
5. 6시간 이내로 조작 → 빨간색 표시 확인
6. 입찰확정 후 로딩바 사라짐 확인
7. `git push`

---

## 주의사항

1. **appsscript.json 타임존**: `"Asia/Seoul"` 필수. 없으면 조용한 시간 로직 오작동
2. **item_history 첫 실행**: `addItemHistory()` 호출 시 시트 없으면 자동 생성
3. **sent_at 소급 불가**: STEP 3 적용 이전 전송된 물건은 `sent_at` 없음 → 로딩바 미표시 (정상)
4. **GAS 트리거 할당량**: 1시간 트리거 1개는 무료 플랜 허용 범위 내
5. **parse_mode HTML**: `telegramSendMessage_()` 호출부에 `parse_mode: 'HTML'` 파라미터 추가 여부 확인
6. **bid_price 스타일**: 기존 계획(implementation_plan.md)의 "앱에서 확인" 방식 유지 — 본문에 금액 미노출

---

## 수정 파일 요약

| STEP | 파일 | 작업 |
|------|------|------|
| 1 | Code.js | `getAutoApprovalMode` / `saveAutoApprovalMode` 추가 |
| 1 | TelegramService.js | BID_YES/CANCEL_YES 처리 후 자동 승인 분기 추가 |
| 1 | js-app.html | `loadAutoApprovalMode` / `saveAutoApprovalMode` 추가 |
| 1 | index.html | Dashboard 수동/자동 토글 UI 추가 |
| 2 | TelegramService.js | `telegramBuildItemMessage_()` 전면 재작성, parse_mode HTML |
| 3 | SheetDB.js | `addItemHistory()` / `getItemHistory()` 추가 |
| 3 | Code.js | `getItemHistoryApi()` 추가, 히스토리 연동 |
| 3 | TelegramService.js | 주요 함수에 `addItemHistory()` 호출 추가 |
| 3 | js-app.html | 히스토리 탭 렌더링 함수 추가 |
| 3 | index.html | 물건 상세에 히스토리 탭 추가 |
| 4 | PushScheduler.js | **신규 파일** 생성 |
| 4 | Backup.js | `setupHourlyScheduler()` 추가 |
| 4 | Code.js | `onOpen()` 메뉴 항목 추가 |
| 4 | TelegramService.js | `reminder` / `bid_alert` 스타일 STYLE_CONFIG에 추가 |
| 5 | css.html | `.bid-timer-*` 스타일 추가 |
| 5 | js-app.html | `createTimerBar()` 추가, 카드 렌더 수정 |
