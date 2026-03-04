# 테스트 체크리스트 & 트러블슈팅 가이드
> GAS 463~468 구현 사항 기준 | 작성일: 2026-03-04

---

## 0. 배포 전 필수 1회 실행 (GAS 에디터)

| 순서 | 함수 | 목적 | 확인방법 |
|------|------|------|---------|
| 1 | `initSheets()` | settings / msg_templates 시트 생성 | 스프레드시트에 두 시트 생성됨 |
| 2 | `setupAutoExpireTrigger()` | 추천 자동만료 매시간 트리거 | 트리거 목록에 `autoExpireRecommended` 표시 |
| 3 | `setupBidDateTrigger()` | 입찰일 알림 매일 트리거 | 트리거 목록에 `sendBidDateReminders` 표시 |

> **트리거 확인**: GAS 에디터 → 왼쪽 시계아이콘(트리거) → 목록에서 확인

---

## 1. 이력 기록 (telegram_requests 시트)

### 1-A. 물건 등록 시 ITEM_CREATE 기록

**테스트**:
1. 입찰물건관리 → 새 물건 등록 (저장)
2. 스프레드시트 `telegram_requests` 시트 열기
3. 가장 마지막 행 확인

**기대값**:
| 컬럼 | 값 |
|------|----|
| C (action) | `ITEM_CREATE` |
| D (status) | `DONE` |
| O (trigger_type) | `web` |
| I (note) | `법원명 사건번호` |

**안되는 경우**:
- `telegram_requests` 시트가 없음 → `initSheets()` 실행
- 시트는 있는데 행 추가 안 됨 → `SheetDB.js:createData()` 확인 (line ~191), `writeItemHistory_` 호출 위치

---

### 1-B. 물건 수정 시 FIELD_CHANGE 기록

**테스트**:
1. 기존 물건의 stu_member(상태), member_id(회원), bid_state(입찰상태) 중 하나를 변경
2. 저장 후 `telegram_requests` 시트 확인

**기대값**: 변경된 필드마다 1행씩 기록
| 컬럼 | 값 |
|------|----|
| C (action) | `FIELD_CHANGE` |
| N (field_name) | 변경된 필드명 (예: `stu_member`) |
| L (from_value) | 변경 전 값 |
| M (to_value) | 변경 후 값 |
| O (trigger_type) | `web` |

**감지 대상 필드**: `stu_member`, `m_name_id`, `m_name`, `bidprice`, `member_id`, `bid_state`

**안되는 경우**:
- 헤더가 11컬럼만 있음 → `initSheets()` 실행하여 L~P 컬럼 추가
- 변경해도 기록 안 됨 → `SheetDB.js:updateData()` 의 `oldRow` 읽기 위치 확인 (line ~241)

---

### 1-C. 텔레그램 전송 시 TELEGRAM_SENT 기록

**테스트**:
1. 물건에 회원 연결 (telegram_chat_id 있는 회원)
2. 전달하기 / 추천전달 버튼 클릭
3. `telegram_requests` 시트 확인

**기대값**:
| 컬럼 | 값 |
|------|----|
| C (action) | `TELEGRAM_SENT` |
| G (chat_id) | 회원 chat_id |
| O (trigger_type) | `web-telegram` |
| I (note) | 전송 스타일 (`card` / `bid_price`) |

---

### 1-D. 회원 입찰/취소 요청 기록 (텔레그램 버튼)

**테스트**: 회원이 텔레그램에서 입찰확정 버튼 → 예 클릭

**기대값**:
| action | trigger_type | status |
|--------|-------------|--------|
| `REQUEST_BID` | `member-telegram` | `PENDING` 또는 `APPROVED` |

**주의**: 기존 `REQUEST_CANCEL` → `REQUEST_CANCEL_BID` 로 변경됨
- 기존 PENDING 상태 행이 있으면 approveTelegramRequests() 에서 **두 값 모두 처리** 됨

---

### 1-E. 승인/거절 시 기록

**테스트**: 관리자 대시보드 → 승인 또는 거절 클릭

**기대값**:
| 승인 | action=`REQUEST_APPROVED`, trigger_type=`system` |
| 거절 | action=`REQUEST_REJECTED`, trigger_type=`web` |

---

## 2. 추천 자동 만료 (autoExpireRecommended)

### 2-A. 트리거 등록 확인

**확인**: GAS 에디터 → 트리거 목록 → `autoExpireRecommended` / `everyHours(1)` 있어야 함

**안되는 경우**: `setupAutoExpireTrigger()` 다시 실행

---

### 2-B. 24h 알림 테스트

**전제조건**: `chuchen_date` (R열) 설정된 `stu_member=추천`, `chuchen_state=전달완료` 물건

**수동 테스트**:
1. GAS 에디터에서 `autoExpireRecommended` 직접 실행
2. `telegram_requests` 시트에서 최신 행 확인
3. 24h 이상 경과 물건 → `EXPIRY_NOTIFY` (note=`24h`) 행 추가됨
4. 47h 이상 → `EXPIRY_NOTIFY` (note=`47h`)
5. 48h 이상 → `AUTO_EXPIRE` + stu_member → `미정` 변경

**안되는 경우**:
- `chuchen_date` 값이 텍스트(문자열)로 저장된 경우 → Date 파싱 실패
  - 확인: `sheet.getRange(row, 18).getValue()` → instanceof Date 아닌 경우
  - 조치: chuchen_date 셀 형식을 날짜/시간으로 변경
- `EXPIRY_NOTIFY` 중복 발송됨 → `isAlreadyNotified_` 확인 (C열=action, E열=item_id, I열=note 조합으로 체크)

---

### 2-C. 텔레그램 알림 메시지 확인

**전제조건**: 회원에 `telegram_chat_id`, `telegram_enabled=Y` 설정

**기대 메시지 형식** (settings 기본값 기준):
- 24h: `홍길동님, 추천드린 [2024타경1234] 물건 전달 후 24시간이 경과했습니다.`
- 1h:  `홍길동님, [2024타경1234] 추천 물건이 1시간 후 자동 만료됩니다.`
- done: `홍길동님, [2024타경1234] 추천 물건이 만료되어 미정 처리되었습니다.`

**안되는 경우**:
- 메시지가 빈 문자열 → `msg_templates` 시트에 해당 키 없음 → `initSheets()` 실행
- 발송은 됐으나 이력 없음 → `sendExpiryNotification_` 내 `writeItemHistory_` 호출 확인

---

### 2-D. settings 설정으로 ON/OFF 확인

| 설정키 | 기본값 | 역할 |
|--------|-------|------|
| `EXPIRY_NOTIFY_24H` | true | 24h 알림 활성 |
| `EXPIRY_NOTIFY_1H` | true | 47h 알림 활성 |
| `EXPIRY_NOTIFY_DONE` | true | 만료 처리 활성 |

**테스트**: 환경설정 탭 → 알림 설정 섹션 → 체크 해제 → `autoExpireRecommended` 실행 → 해당 알림 기록 안 됨

---

## 3. 입찰일 알림 (sendBidDateReminders)

### 3-A. 트리거 등록 확인

**확인**: GAS 에디터 트리거 목록 → `sendBidDateReminders` / `everyDays(1) at hour 10` 있어야 함

---

### 3-B. D-1/D-2/D-3 알림 테스트

**전제조건**: `stu_member=입찰`, `in-date=내일날짜(yyMMdd)`, `member_id` 있는 물건

**수동 테스트**:
1. 물건의 `in-date` 를 내일 날짜(yyMMdd 형식, 예: `260305`)로 설정
2. GAS 에디터에서 `sendBidDateReminders` 직접 실행
3. `telegram_requests` 시트 → `BID_DATE_NOTIFY` (note=`D-1`) 행 확인
4. 회원 텔레그램으로 메시지 수신 확인

**안되는 경우**:
- `BID_NOTIFY_ENABLED` = `false` → 환경설정에서 켜기
- in-date 형식 불일치 → `yyMMdd` (6자리) 인지 확인 (`260305` 형식)
- 중복 발송 방지로 안 됨 → `telegram_requests` 에 이미 같은 날 `BID_DATE_NOTIFY` 기록 있음

---

### 3-C. 발송 메시지 확인

**기대 형식**:
- D-3: `홍길동님, [2024타경1234] 입찰일이 3일 후입니다. (260305)`
- D-2: `홍길동님, [2024타경1234] 입찰일이 2일 후입니다. (260305)`
- D-1: `홍길동님, [2024타경1234] 내일이 입찰일입니다. (260305) 준비 잘 되셨나요?`

---

## 4. 취소건 조회 UI

### 4-A. 취소건 탭 표시 확인

**테스트**:
1. 회원관리 메뉴 → 회원 클릭
2. 우측 상세 패널 상단 → **회원정보 / 취소건 조회** 탭 버튼 표시됨 확인

**안되는 경우**:
- 탭 버튼 안 보임 → `index.html` 내 `memberDetailTabs` div 확인
- `detail-tab-btn` CSS 클래스가 없음 → 기존 탭 CSS 공유 여부 확인

---

### 4-B. 취소건 데이터 로드

**전제조건**: `telegram_requests` 시트에 `AUTO_EXPIRE` / `REQUEST_CANCEL_BID` / `REQUEST_CANCEL_CHUCHEN` 데이터

**테스트**:
1. 회원 선택 → 취소건 조회 탭 클릭
2. 테이블에 행 표시 확인

**표시 컬럼**: 순번 / 취소일자 / 입찰일자 / 사건번호 / 법원 / 취소사유

**취소사유 매핑**:
| action | 화면 표시 |
|--------|---------|
| `AUTO_EXPIRE` | 추천시간 만기 |
| `REQUEST_CANCEL_CHUCHEN` | 회원요청(추천취소) |
| `REQUEST_CANCEL_BID` | 회원요청(입찰취소) |

**안되는 경우**:
- "취소 이력이 없습니다" → telegram_requests 시트에 해당 회원의 취소 데이터 없음 (정상)
- 오류 표시 → GAS 로그에서 `getCancelHistory` 오류 확인
- 사건번호/법원이 빈칸 → items 시트 매핑 실패 (item_id 불일치)

---

## 5. 환경설정 - 알림 설정 UI

### 5-A. 설정값 로드

**테스트**:
1. 환경설정 탭 클릭
2. "텔레그램 알림 설정" 섹션 → 체크박스 자동 로드됨

**안되는 경우**:
- 체크박스가 모두 꺼짐 (기본값 true인데) → `settings` 시트 없음 → `initSheets()` 실행
- "로드 실패" 메시지 → GAS 로그에서 `getNotifySettings` 오류 확인

---

### 5-B. 설정값 저장

**테스트**:
1. D-3 알림 체크 해제
2. 스프레드시트 `settings` 시트 → `BID_NOTIFY_D3` 행 → B열 값 = `false` 확인

**안되는 경우**:
- 저장됐다는 표시가 없음 → `saveNotifySetting` → `saveSettingPublic` → `saveSetting_` 흐름 확인
- 스프레드시트에 반영 안 됨 → `settings` 시트 A열에 `BID_NOTIFY_D3` 키 있는지 확인

---

## 6. 환경설정 - 메시지 편집 UI

### 6-A. 팝업 열기

**테스트**:
1. 환경설정 탭 → "텔레그램 메시지 편집" 섹션 → **메시지 편집 열기** 클릭
2. 팝업 모달 표시 확인

**안되는 경우**:
- 팝업 안 열림 → `index.html` 내 `msgEditorModal` div `display:none` 확인
- 좌측 목록 비어있음 → `getAllMsgTemplates` → `msg_templates` 시트 없음 → `initSheets()` 실행

---

### 6-B. 템플릿 편집 및 저장

**테스트**:
1. 좌측에서 `notify.bid_d1` 클릭
2. 우측 템플릿 내용 수정
3. 미리보기에 변경 즉시 반영 확인 (샘플 변수 치환)
4. **저장** 클릭
5. `msg_templates` 시트 D열 값 변경됨 확인

**안되는 경우**:
- 미리보기 갱신 안 됨 → `<textarea oninput="updateMsgPreview_()">` 확인
- 저장 후 반영 안 됨 → `saveMsgTemplate` 함수에서 key 매칭 실패 (A열 값 확인)

---

### 6-C. 초기화

**테스트**:
1. 템플릿 임의 수정 → 저장
2. **초기화** 버튼 클릭 → 확인 대화상자 → 확인
3. 기본값으로 복원됨 확인

**기본값 정의 위치**: `SheetDB.js:resetMsgTemplate()` 내 `DEFAULTS` 객체

---

## 7. 입찰일정 모달 회원정보 (GAS 463)

### 7-A. 모달 회원 정보 표시

**테스트**:
1. 입찰일정 탭 → 일정 아이템 클릭 → 모달 열림
2. 회원명 옆 정보 확인: T배지(텔레그램), 회원ID, 전화번호, 수업등급, 명의

**안되는 경우**:
- 기존처럼 `(등록일, 회원ID)` 포맷으로 덮어써짐 → `js-app.html:openDetailModal()` 에서 `modal-display-member-id` 덮어쓰는 코드 있는지 확인 (삭제됐어야 함)
- 정보가 비어있음 → `updateMemberTokenInfo('modal')` 호출됐는지 확인

---

### 7-B. 자동새로고침 스크롤 위지 유지

**테스트**:
1. 입찰일정 탭 → 아래로 스크롤
2. 15초 대기 (자동 새로고침)
3. 스크롤 위치 유지됨 확인 (맨 위로 올라가지 않음)

**안되는 경우**:
- 스크롤이 여전히 초기화됨 → `startCalendarPolling_` 에서 `loadDataAndRenderCalendar(true, true)` 두 번째 인자 `true` 확인
- 150ms 타이밍 문제 → `renderCalendarWeek` 의 100ms setTimeout 이후에 복원되는지 확인

---

### 7-C. 이미지 등록 저장 경로

**테스트**:
1. 입찰물건관리 → 이미지 등록 버튼
2. 파일 저장 대화상자 표시 확인 (Chrome 86+)
3. 원하는 경로 지정 → 저장

**안되는 경우 (Chrome 구버전)**:
- `showSaveFilePicker` 미지원 → 브라우저 기본 다운로드로 폴백됨 (정상 동작)
- 대화상자에서 취소 → 아무 일 없음 (정상)

---

## 8. 빠른 진단 체크리스트

### "telegram_requests 시트 구조 오류"
```
A: req_id | B: requested_at | C: action | D: status | E: item_id
F: member_id | G: chat_id | H: telegram_username | I: note
J: approved_at | K: approved_by | L: from_value | M: to_value
N: field_name | O: trigger_type | P: member_name
→ 총 16컬럼이어야 함
→ 11컬럼이면 initSheets() 실행
```

### "settings 시트 없음"
```
initSheets() 실행 → settings 시트 자동 생성 + 기본값 8개 입력
```

### "msg_templates 시트 없음"
```
initSheets() 실행 → msg_templates 시트 자동 생성 + 기본 메시지 12개 입력
```

### "텔레그램 알림 발송됐는데 이력이 없음"
```
1. TELEGRAM_SENT 이력은 sendExpiryNotification_ / sendBidDateNotification_ 에서 기록
2. 이력 기록에서 오류 발생 시 → GAS Logger 에서 [writeItemHistory_] 오류 확인
```

### "알림이 중복 발송됨"
```
isAlreadyNotified_(itemId, action, noteKey) 체크 실패
→ telegram_requests 시트 C열(action), E열(item_id), I열(note) 조합으로 중복 여부 판단
→ 시트 데이터가 너무 많으면 조회 범위 확인 (getLastRow -1 행)
```

### "회원 취소건이 조회 안 됨"
```
1. telegram_requests 시트에 AUTO_EXPIRE / REQUEST_CANCEL_BID / REQUEST_CANCEL_CHUCHEN 데이터 있는지 확인
2. P열(member_name)이 비어있어도 F열(member_id) 기준으로 필터됨
3. 기존 REQUEST_CANCEL → REQUEST_CANCEL_BID 로 변경됨 (신규 데이터부터 적용)
```

---

## 9. 주요 함수 위치 참조

### SheetDB.js
| 함수 | 역할 | 대략 위치 |
|------|------|---------|
| `createData()` | 물건 등록 + ITEM_CREATE 이력 | line ~178 |
| `updateData()` | 물건 수정 + FIELD_CHANGE 감지 | line ~202 |
| `ensureTelegramRequestsSheet_()` | 16컬럼 헤더 보장 | line ~1138 |
| `writeItemHistory_(p)` | 이력 기록 공통 함수 | line ~3071 |
| `ensureSettingsSheet_()` | settings 시트 초기화 | line ~3055 |
| `getSetting_(key)` | 설정값 조회 | line ~3090 |
| `autoExpireRecommended()` | 추천 자동만료 트리거 함수 | line ~3175 |
| `isAlreadyNotified_()` | 중복 알림 방지 | line ~3270 |
| `setupAutoExpireTrigger()` | 매시간 트리거 등록 | line ~3320 |
| `sendBidDateReminders()` | D-3/D-2/D-1 알림 | line ~3340 |
| `setupBidDateTrigger()` | 매일 트리거 등록 | line ~3400 |
| `getCancelHistory()` | 취소건 조회 | line ~3415 |
| `ensureMsgTemplatesSheet_()` | msg_templates 초기화 | line ~3480 |
| `getMessageTemplate_(key, vars)` | 템플릿 조회+치환 | line ~3530 |
| `sendExpiryNotification_()` | 만료 알림 발송 | line ~3670 |
| `sendBidDateNotification_()` | 입찰일 알림 발송 | line ~3710 |

### TelegramService.js
| 함수 | 역할 | 대략 위치 |
|------|------|---------|
| `telegramBuildItemMessage_()` | 카드 메시지 빌드 (템플릿 적용) | line ~643 |
| `sendItemToMemberTelegramWithStyle()` | 단건 텔레그램 전송 + TELEGRAM_SENT 이력 | line ~767 |
| `handleTelegramWebhook_()` | 수신 처리, REQUEST_BID/CANCEL_BID 기록 | line ~249 |

### js-app.html
| 함수 | 역할 |
|------|------|
| `switchMemberDetailTab(tabName)` | 회원 상세 탭 전환 |
| `loadMemberCancelHistory()` | 취소건 데이터 로드 + 렌더링 |
| `loadNotifySettings()` | 알림 설정 로드 |
| `saveNotifySetting(key, val)` | 알림 설정 저장 |
| `openMsgEditor()` | 메시지 편집 팝업 열기 |
| `updateMsgPreview_()` | 메시지 미리보기 갱신 |
| `saveMsgTemplateUI()` | 메시지 템플릿 저장 |

---

## 10. 테스트 순서 권장

```
Step 1. initSheets() 실행 → settings, msg_templates 시트 생성 확인
Step 2. 물건 등록 → telegram_requests 에 ITEM_CREATE 기록 확인
Step 3. 물건 수정 (상태변경) → FIELD_CHANGE 기록 확인 (L~P 컬럼)
Step 4. 추천전달 버튼 → TELEGRAM_SENT 기록 확인
Step 5. 환경설정 탭 → 알림설정 체크박스 로드 확인 → 변경 후 settings 시트 반영 확인
Step 6. 환경설정 탭 → 메시지 편집 열기 → 목록 로드 → 템플릿 수정/저장 확인
Step 7. 회원관리 탭 → 회원 선택 → 취소건 탭 클릭 → 테이블 표시 확인
Step 8. GAS 에디터에서 sendBidDateReminders() 직접 실행 → 입찰 물건 있을 때 BID_DATE_NOTIFY 기록 확인
Step 9. GAS 에디터에서 autoExpireRecommended() 직접 실행 → 48h+ 물건 있을 때 AUTO_EXPIRE 기록 확인
Step 10. setupAutoExpireTrigger() / setupBidDateTrigger() 실행 → 트리거 등록 확인
```
