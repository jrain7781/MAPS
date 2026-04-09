# MAPS 구현 TODO 리스트

> 기반 문서: `docs/implementation_plan.md`
> 작업 순서: 각 STEP 완료 후 → `clasp push` → GAS 검증 → `git push`

---

## 사전 확인 (시작 전 1회)

- [ ] `appsscript.json`에 `"timeZone": "Asia/Seoul"` 설정 확인
- [ ] `telegramSendMessage_()` 함수에 `parse_mode: 'HTML'` 파라미터 지원 여부 확인
- [ ] 현재 `items` 시트 컬럼 구조 확인 (bid_state 컬럼 존재 여부)

---

## STEP 0: bid_state 기반 입찰가 전달 시스템 (기존 계획 구현)

> `docs/implementation_plan.md` 상단 안티그래비티 작성 계획 구현

### 0-1. 백엔드 (`SheetDB.js` or `Code.js`)

- [x] `updateBidPriceConfirmed(memberToken, itemId)` 함수 추가
  - memberToken 검증 로직 포함
  - 해당 itemId 물건의 `bid_state` → `확인완료` 업데이트
  - 성공 여부 반환

### 0-2. 텔레그램 서비스 (`TelegramService.js`)

- [ ] `bid_price` 스타일 발송 시 `bid_state` → `전달완료` 자동 업데이트 로직 추가
  - `handleBulkTelegramSendFromItemList` 또는 전송 성공 후 처리 위치 확인
- [ ] 텔레그램 메시지 문구: "입찰가가 도착했습니다. 아래 버튼으로 앱에서 확인해 주세요."
- [ ] 입찰가 금액 메시지 본문 미노출 확인 (앱 진입 유도)

### 0-3. 프론트엔드 스타일 (`css.html`)

- [ ] `.price-blur` 클래스 추가: `filter: blur(5px); transition: filter 0.3s; cursor: pointer; user-select: none;`
- [ ] `.price-clear` 클래스 추가: `filter: blur(0);`
- [ ] `.bid-state-confirmed` 클래스 추가: `color: blue; font-weight: bold;`

### 0-4. 프론트엔드 로직 (`js-app.html`)

- [ ] 카드 렌더링 시 `bid_state` 분기 처리:
  - `신규` / 빈값: 입찰가 자리에 `(미정)` 표시
  - `전달완료`: 입찰가에 `.price-blur` 클래스 + `onclick="confirmBidPrice(this, itemId)"` 적용
  - `확인완료`: 입찰가 정상 노출
- [ ] `confirmBidPrice(el, itemId)` 함수 추가:
  - 클릭 즉시 `.price-blur` → `.price-clear` 변경 (즉각 반응)
  - 백그라운드로 `google.script.run.updateBidPriceConfirmed` 호출
  - 로컬 캐시의 `bid_state`도 `확인완료`로 즉시 동기화
- [ ] 관리자 ItemManagement 목록에 `bid_state` 컬럼 표시 추가
  - `확인완료` 상태에 `.bid-state-confirmed` 스타일 적용

### 0-5. STEP 0 검증 및 배포

- [ ] `clasp push`
- [ ] 관리자: 입찰가 안내 전송 → `bid_state` 전달완료 변경 확인
- [ ] 회원화면: 입찰가 흐리게 표시 확인
- [ ] 회원화면: 흐린 입찰가 탭/클릭 → 선명하게 전환 확인
- [ ] 새로고침 후에도 `확인완료` 상태 유지 확인
- [ ] 관리자 목록에서 `bid_state` 파란색 굵게 표시 확인
- [ ] `git push`

---

## STEP 1: 자동 승인 처리 시스템

### 1-1. 백엔드 (`Code.js`)

- [ ] `getAutoApprovalMode()` 함수 추가

  ```
  위치: 기존 getAuctionSettings() 근처
  내용: ScriptProperties에서 AUTO_APPROVAL_MODE 읽기, 기본값 'MANUAL'
  ```

- [ ] `saveAutoApprovalMode(mode)` 함수 추가

  ```
  내용: ScriptProperties에 AUTO_APPROVAL_MODE 저장, {success, mode} 반환
  ```

### 1-2. 텔레그램 자동 승인 연동 (`TelegramService.js`)

- [ ] `handleTelegramWebhook_()` 함수 내 BID_YES 처리 블록 수정
  - `createTelegramRequest()` 호출 직후 자동 승인 체크 코드 추가:

  ```javascript
  const autoMode = getAutoApprovalMode();
  if (autoMode === 'AUTO' && createResult.success) {
    approveTelegramRequests([createResult.req_id], 'AUTO');
  }
  ```

- [ ] CANCEL_YES 처리 블록에도 동일하게 적용

### 1-3. 프론트엔드 함수 (`js-app.html`)

- [ ] `loadAutoApprovalMode()` 함수 추가
  - `gasCall('getAutoApprovalMode')` 호출
  - 결과에 따라 라디오 버튼 상태 반영
- [ ] `saveAutoApprovalMode(mode)` 함수 추가
  - `gasCall('saveAutoApprovalMode', mode)` 호출
  - 성공 시 `showStatus()` 알림 표시
- [ ] Dashboard 로드 함수(예: `loadDashboard()`)에 `loadAutoApprovalMode()` 호출 추가

### 1-4. Dashboard UI (`index.html`)

- [ ] Dashboard 섹션의 "입찰 요청(승인 대기)" 패널 상단에 토글 UI 추가:

  ```
  위치: 해당 패널 div 최상단 (테이블 위)
  내용: 수동/자동 라디오 버튼 + 설명 텍스트
  스타일: bg-indigo-50, border-indigo-200
  ```

### 1-5. STEP 1 검증 및 배포

- [ ] `clasp push`
- [ ] 대시보드 → "자동 처리" 라디오 선택
- [ ] 새로고침 후에도 "자동 처리" 유지되는지 확인 (ScriptProperties 저장 확인)
- [ ] 텔레그램 테스트 계정 → 입찰확정 클릭 → 관리자 승인 없이 즉시 '입찰' 상태 변경 확인
- [ ] 텔레그램으로 확인 메시지 자동 수신 확인
- [ ] "수동 처리"로 변경 → 동일 테스트 → PENDING 상태 유지 확인
- [ ] `git push`

---

## STEP 2: 텔레그램 메시지 스타일 전면 개선

### 2-1. 스타일 설정 오브젝트 추가 (`TelegramService.js`)

- [ ] 파일 상단(또는 함수 위)에 상수 추가:
  - `TELEGRAM_DIVIDER = '━━━━━━━━━━━━━━━━━━'`
  - `TELEGRAM_STYLE_CONFIG` 오브젝트 (card / bid_price / status / check_request / reminder / bid_alert)

### 2-2. `telegramBuildItemMessage_()` 함수 재작성 (`TelegramService.js`)

- [ ] 기존 함수 내용을 새 포맷으로 전면 교체
  - header / DIVIDER / 데이터 라인 / (입찰가 조건부) / DIVIDER / footer 구조
  - `{ text, buttons }` 형태로 반환
- [ ] `parse_mode: 'HTML'` 파라미터 전달 확인
  - `telegramSendMessage_()` 호출부 확인
  - 파라미터가 없으면 추가

### 2-3. STEP 2 검증 및 배포

- [ ] `clasp push`
- [ ] ItemManagement → 테스트 물건 → "추천물건 안내" 전송
- [ ] 텔레그램에서 새 스타일 확인:
  - 헤더 굵게 표시
  - 구분선(━) 표시
  - 항목별 이모지 + 굵은 라벨
- [ ] "입찰가 안내" 전송 → 입찰가 미노출 + "내물건보기" 버튼만 표시 확인
- [ ] `[✅ 입찰확정]` `[❌ 입찰취소]` `[📋 내물건보기]` 버튼 동작 확인
- [ ] `git push`

---

## STEP 3: item_history 시트 + 히스토리 UI

### 3-1. 히스토리 시트 함수 추가 (`SheetDB.js`)

- [ ] 파일 상단에 상수 추가:
  - `ITEM_HISTORY_SHEET_NAME = 'item_history'`
  - `ITEM_HISTORY_HEADERS` 배열 (10개 컬럼)
- [ ] `addItemHistory(eventType, itemId, memberId, oldVal, newVal, triggeredBy, note)` 함수 추가
  - 시트 없으면 자동 생성 (헤더 포함)
  - `appendRow()` 로 이벤트 기록
- [ ] `getItemHistory(itemId)` 함수 추가
  - item_id 기준 필터
  - 최신순 정렬 후 반환

### 3-2. API 래퍼 추가 (`Code.js`)

- [ ] `getItemHistoryApi(itemId)` 함수 추가

### 3-3. 히스토리 기록 연동 (`TelegramService.js`)

- [ ] `sendItemToMemberTelegramWithStyle()` 함수 → 발송 성공 후 `addItemHistory('ITEM_SENT', ...)` 추가
- [ ] BID_YES 처리 블록 → `addItemHistory('BID_REQUESTED', ...)` 추가
- [ ] CANCEL_YES 처리 블록 → `addItemHistory('CANCEL_REQUESTED', ...)` 추가

### 3-4. 히스토리 기록 연동 (`SheetDB.js`)

- [ ] `approveTelegramRequests()` → 각 요청 승인 후 `addItemHistory('BID_APPROVED', ...)` 추가
- [ ] `rejectTelegramRequests()` → 각 요청 반려 후 `addItemHistory('BID_REJECTED', ...)` 추가
- [ ] 입찰가 전송 후 `bid_state` → `전달완료` 업데이트 위치 → `addItemHistory('PRICE_SENT', ...)` 추가
- [ ] `updateBidPriceConfirmed()` (STEP 0 구현 함수) → `addItemHistory('PRICE_CONFIRMED', ...)` 추가
- [ ] 아이템 상태(`stu_member`) 변경 위치 확인 → `addItemHistory('STATUS_CHANGED', ...)` 추가
- [ ] 담당 회원(`member_id`) 변경 위치 확인 → `addItemHistory('MEMBER_CHANGED', ...)` 추가

### 3-5. 히스토리 탭 UI (`index.html`)

- [ ] ItemManagement 상세 패널(detailPane) 탭 버튼 리스트에 추가:

  ```html
  <button class="detail-tab-btn" id="tab-history" onclick="switchDetailTab('history')">
    📋 히스토리
  </button>
  ```

- [ ] 탭 패널 영역에 추가:

  ```html
  <div id="detail-panel-history" class="detail-tab-panel hidden">
    <div id="item-history-list" class="p-2"></div>
  </div>
  ```

### 3-6. 히스토리 렌더링 함수 (`js-app.html`)

- [ ] `HISTORY_EVENT_ICONS` 상수 오브젝트 추가 (이벤트별 이모지 매핑)
- [ ] `loadItemHistory(itemId)` 비동기 함수 추가
  - `gasCall('getItemHistoryApi', itemId)` 호출
  - 타임라인 형태 HTML 렌더링 (아이콘 + 시각 + 이벤트명 + 비고)
- [ ] `switchDetailTab('history')` 실행 시 `loadItemHistory(currentItemId)` 호출 연결

### 3-7. STEP 3 검증 및 배포

- [ ] `clasp push`
- [ ] 스프레드시트에서 `item_history` 시트 자동 생성 확인
- [ ] 물건 텔레그램 전송 → `ITEM_SENT` 행 기록 확인
- [ ] 입찰확정 → `BID_REQUESTED` 행 확인
- [ ] 승인 처리 → `BID_APPROVED` 행 확인
- [ ] 물건 상세 UI → "히스토리" 탭 클릭 → 타임라인 렌더링 확인
- [ ] `git push`

---

## STEP 4: 알림 푸쉬 스케줄러

### 4-1. 신규 파일 생성: `PushScheduler.js`

- [ ] 파일 생성 (`c:\00.AI\00.antigravity\00. MAPS\PushScheduler.js`)
- [ ] 상단 상수 정의:
  - `REMIND_HOURS_SCHEDULE = [1, 6, 24, 36, 47]`
  - `BID_ALERT_DAYS = { '-3': 9, '-2': 9, '-1': 15, '0': 8 }`
- [ ] `isQuietHour_()` 함수 구현 (09:00~18:00 외 시간 → true 반환)
- [ ] `runHourlyScheduler()` 메인 함수 구현 (3개 하위 함수 호출)
- [ ] `checkBidReminderPushes()` 함수 구현:
  - item_history에서 ITEM_SENT 이벤트 조회
  - 현재 상태 '추천'인 물건만 필터
  - 경과 시간 계산 → REMIND_HOURS_SCHEDULE 발송 시점 체크
  - PUSH_SENT 이벤트로 중복 발송 방지
  - reminder 스타일로 텔레그램 발송
  - `addItemHistory('PUSH_SENT', ...)` 기록
- [ ] `checkAutoExpiry()` 함수 구현:
  - ITEM_SENT 후 48시간 이상 + 상태 '추천' 물건 조회
  - `stu_member` → '미정' 변경
  - `addItemHistory('AUTO_EXPIRED', ...)` 기록
  - 회원에게 만료 알림 텔레그램 발송
- [ ] `checkBidDatePushes()` 함수 구현:
  - items 시트에서 `stu_member === '입찰'` 물건 조회
  - 입찰일 기준 D-N 계산
  - BID_ALERT_DAYS 발송 시각 체크
  - bid_alert 스타일로 텔레그램 발송
  - `addItemHistory('PUSH_SENT', ...)` 기록 (중복 방지)

### 4-2. `appsscript.json` 확인

- [ ] `"timeZone": "Asia/Seoul"` 설정 확인 (없으면 추가)
- [ ] `"runtimeVersion": "V8"` 설정 확인

### 4-3. 트리거 설정 함수 추가 (`Backup.js`)

- [ ] `setupHourlyScheduler()` 함수 추가:
  - 기존 runHourlyScheduler 트리거 전체 제거
  - 1시간마다 트리거 생성
  - 완료 알림 메시지 표시

### 4-4. 관리자 메뉴 추가 (`Code.js`)

- [ ] `onOpen()` 함수 내 메뉴 항목에 추가:

  ```javascript
  .addItem('⏰ 시간별 스케줄러 설정', 'setupHourlyScheduler')
  ```

### 4-5. `.claspignore` 확인

- [ ] `PushScheduler.js`가 clasp push 대상에 포함되는지 확인 (제외 설정 없는지)

### 4-6. STEP 4 검증 및 배포

- [ ] `clasp push`
- [ ] GAS 스프레드시트 메뉴 → "⏰ 시간별 스케줄러 설정" 실행
- [ ] GAS 편집기 → 트리거 탭에서 `runHourlyScheduler` 1시간 트리거 확인
- [ ] GAS 편집기에서 `runHourlyScheduler()` 수동 실행
- [ ] item_history 시트에서 `PUSH_SENT` 행 생성 확인
- [ ] 테스트 회원 텔레그램으로 리마인드 메시지 수신 확인
- [ ] 조용한 시간(18~09시) 테스트: 스케줄러 실행해도 발송 안 됨 확인
- [ ] `git push`

---

## STEP 5: 48시간 로딩바 UI

### 5-1. 백엔드 데이터 준비 (`SheetDB.js` or `Code.js`)

- [ ] `readDataByMemberToken()` 또는 회원 카드 데이터 반환 함수에 `sent_at` 필드 추가
  - item_history에서 해당 item_id의 최근 ITEM_SENT 이벤트 `recorded_at` 조회
  - 없으면 null 반환 (로딩바 미표시)

### 5-2. CSS 스타일 추가 (`css.html`)

- [ ] `.bid-timer-bar` 클래스 추가 (flex 컨테이너, height 6px)
- [ ] `.bid-timer-segment` 클래스 추가 (flex: 1, 색상 transition)
- [ ] `.bts-green`, `.bts-yellow`, `.bts-orange`, `.bts-red`, `.bts-empty` 색상 클래스 추가
- [ ] `.bid-timer-label` 클래스 추가 (우측 정렬, 작은 회색 텍스트)

### 5-3. 타이머 바 함수 추가 (`js-app.html`)

- [ ] `createTimerBar(sentAt)` 함수 추가:
  - sentAt 없으면 빈 문자열 반환
  - 경과 시간(시) 계산
  - 48개 segment div 생성 (각 색상 분기 처리)
  - 남은 시간 라벨 반환
- [ ] `createMemberItemCard(item)` 함수 수정:
  - 카드 HTML 하단에 타이머 바 HTML 삽입 (추천 상태만)

  ```javascript
  const timerHtml = (item.stu_member === '추천' && item.sent_at)
    ? createTimerBar(item.sent_at)
    : '';
  ```

- [ ] 페이지 로드 시 60초 인터벌 설정:

  ```javascript
  setInterval(() => {
    if (window._memberItemsCache) renderMemberCards(window._memberItemsCache);
  }, 60_000);
  ```

### 5-4. STEP 5 검증 및 배포

- [ ] `clasp push`
- [ ] 회원화면(MemberDashboard / MemberItemList) 접속
- [ ] '추천' 상태 물건카드 하단에 48칸 바 + "N시간 남음" 라벨 표시 확인
- [ ] 개발자 도구에서 `item.sent_at` 값 조작:
  - 최근 시간 → 초록색 확인
  - 40시간 전 → 주황/빨강 확인
  - 48시간 이상 → "⚠️ 만료됨" 표시 확인
- [ ] 입찰확정 후 로딩바 사라짐 확인
- [ ] 1분 후 바가 자동으로 1칸 채워지는 확인
- [ ] `git push`

---

## 전체 완료 체크

- [ ] STEP 0 완료 및 git push
- [ ] STEP 1 완료 및 git push
- [ ] STEP 2 완료 및 git push
- [ ] STEP 3 완료 및 git push
- [ ] STEP 4 완료 및 git push
- [ ] STEP 5 완료 및 git push
- [ ] 전체 통합 테스트 (자동 승인 + 메시지 스타일 + 히스토리 + 푸쉬 + 로딩바)
