# 자동 알림 & 메시지 편집 화면 분석 리포트

작성일: 2026-03-03 (v2 수정)

---

## ★ 핵심 데이터 구조 (재분석 없이 참조용)

```
[파일 구조]
c:\LJW\MAPS_TEST\
  SheetDB.js        → GAS 서버사이드 DB 함수 (2957줄)
  TelegramService.js → 텔레그램 전송/수신 처리 (895줄)
  Code.js           → GAS 진입점, 트리거, 대시보드 액션 (529줄)
  Backup.js         → 백업 트리거 (125줄)
  Main.js           → doGet/doPost 웹앱 진입점
  js-app.html       → 프론트엔드 전체 (10000줄+)
  index.html        → HTML 구조

[items 시트 컬럼 - ITEM_HEADERS (SheetDB.js:17)]
idx  컬럼  필드명          값 예시
 0    A    id             1740999000001  ← 물건 키 (PK)
 1    B    in-date        260311         ← 입찰일자 YYMMDD
 2    C    sakun_no       2025타경10593
 3    D    court          서울중앙지법
 4    E    stu_member     상품/미정/추천/입찰/변경  ← 물건 상태
 5    F    m_name_id      이정우           ← 입찰담당
 6    G    m_name         MJ 임준희        ← 회원명
 7    H    bidprice       150000000
 8    I    member_id      1109             ← 담당 회원 ID (FK)
 9    J    reg_date       2026-03-01
10    K    reg_member
11    L    bid_state      신규/전달완료/확인완료  ← 입찰가 전달 상태
12    M    image_id
13    N    note
14    O    m_name2        (MJ) 한한한       ← 명의 표시값
15    P    auction_id     1234567
16    Q    chuchen_state  신규/전달완료     ← 추천 전달 상태
17    R    chuchen_date   2026-03-03T14:30:00.000Z  ← 텔레그램 전달완료 시각 (로딩바 기준)

[members 시트 주요 필드 (ITEM_MEMBER_HEADERS SheetDB.js:24)]
  member_id, member_name, telegram_chat_id, telegram_enabled('Y'/'N'), member_token
  name1_gubun, name1, name2_gubun, name2, name3_gubun, name3  ← 명의들

[telegram_requests 시트 현재 컬럼 11개 (SheetDB.js:1142)]
  A:req_id  B:requested_at  C:action  D:status  E:item_id  F:member_id
  G:chat_id  H:telegram_username  I:note  J:approved_at  K:approved_by

[기존 GAS 트리거 (Backup.js:104)]
  backupDataToDrive → 매일 09:00

[텔레그램 메시지 함수들 (TelegramService.js)]
  telegramSendMessage(chatId, text, options)   ← 핵심 발송 함수 (line 57)
  sendItemToMemberTelegramWithStyle(memberId, itemId, styleKey)  ← 물건카드 발송 (line 763)
  sendChuchenTelegramBulk(itemIds)             ← 추천 일괄발송 (line 862)

[물건 카드 스타일 (TelegramService.js:639 telegramBuildItemMessage_)]
  'card'         → 추천 물건 전달
  'bid_price'    → 입찰가 전달
  'status'       → 입찰취소 안내
  'check_request'→ 입찰여부 확인 요청

[in-date 변환 (TelegramService.js:590)]
  formatInDate_('260311') → '2026-03-11'
  YYMMDD → Date 변환: '20' + ss.slice(0,2) + '-' + ss.slice(2,4) + '-' + ss.slice(4,6)

[환경설정 관련 Script Properties]
  TELEGRAM_BOT_TOKEN, WEBAPP_BASE_URL, MJAPS_AUTO_APPROVE, ADMIN_SECRET_KEY 등
```

---

## 1. 추천 알림 자동화

### 1-1. 알림 시점 (chuchen_date 기준)

```
chuchen_date = 텔레그램 추천 전달완료 시각 (items.R열)
→ 이미 로딩바(createChuchenTimerBar, js-app.html:930)가 이 값으로 48h 계산 중
→ 자동만료도 동일 기준 사용

  0h ────────────── 24h ──────── 47h ─── 48h
  │                  │            │       │
  전달완료           D+1         만료     자동미정
  (chuchen_date)   같은시각    1시간전   전환+알림
                    알림        알림
```

| 시점 | elapsed 조건 | 알림 내용 |
|------|------------|---------|
| 24시간 경과 | elapsed ≥ 24h, 알림 미발송 | 추천 24시간 경과, 남은 시간 24시간 |
| 47시간 경과 | elapsed ≥ 47h, 알림 미발송 | ⚠️ 만료 1시간 전 |
| 48시간 경과 | elapsed ≥ 48h | 자동 미정 전환 + 만료 알림 |

### 1-2. 중복 발송 방지
별도 필드 추가 없이 **히스토리(telegram_requests) 조회**로 처리:
```
action='EXPIRY_NOTIFY' AND item_id=해당ID AND note에 '24h' 포함 → 이미 발송됨 → SKIP
```

### 1-3. SKIP 조건
```
chuchen_state = '신규' (텔레그램 미발송)       → SKIP
chuchen_date 없음                             → SKIP (데이터 이상)
stu_member ≠ '추천'                           → SKIP (이미 다른 상태)
telegram_enabled ≠ 'Y' OR chat_id 없음        → 알림 불가
```

### 1-4. GAS 함수명
```javascript
autoExpireRecommended()  // 매시간 트리거
```

---

## 2. 입찰일자 알림 (수정됨)

### 2-1. ★ 발송 조건 (중요 수정)

```
stu_member = '입찰' 인 물건만 발송
(추천 상태는 대상 아님 - 아직 입찰 확정 전)
```

### 2-2. 알림 시점

| 알림 | 발송 시각 | 조건 |
|------|---------|------|
| D-2 알림 | 해당일 오전 10:00 | (in-date - 오늘) = 2일 AND stu_member='입찰' |
| D-1 알림 | 해당일 오전 10:00 | (in-date - 오늘) = 1일 AND stu_member='입찰' |

예시) in-date=260313, 현재 stu_member='입찰':
- 3월 11일 10:00 → D-2 알림
- 3월 12일 10:00 → D-1 알림

### 2-3. 설정 가능 항목 (configurable)

**저장 위치: `settings` 시트 또는 Script Properties**

```
설정 키                    기본값    설명
BID_NOTIFY_ENABLED         true     입찰일 알림 ON/OFF 전체
BID_NOTIFY_D2_ENABLED      true     D-2 알림 활성화
BID_NOTIFY_D1_ENABLED      true     D-1 알림 활성화
BID_NOTIFY_HOUR            10       알림 발송 시각 (시 단위, 기본 오전 10시)
BID_NOTIFY_STATUS_FILTER   입찰     알림 대상 stu_member 값 (콤마 구분 가능)
```

**관리 화면**: 환경설정 탭에 "알림 설정" 섹션 추가 (메시지 편집 팝업과 별도 또는 동일 팝업 내 탭)

### 2-4. GAS 함수명
```javascript
sendBidDateReminders()  // 매일 설정된 시각 트리거
```

### 2-5. in-date 날짜 계산 방법 (GAS)
```javascript
// YYMMDD → Date 객체
function yymmddToDate_(yymmdd) {
  const s = String(yymmdd).trim();
  return new Date('20'+s.slice(0,2)+'-'+s.slice(2,4)+'-'+s.slice(4,6));
}
// 오늘 + N일
function addDays_(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
// 비교용 YYMMDD 생성
function dateToYYMMDD_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyMMdd');
}
```

---

## 3. 메시지 편집 화면

### 3-1. 현재 하드코딩 메시지 위치 (19개)

```
[TelegramService.js]
line 287  인증 성공: '■ MJMAPS 텔레그램 연결 완료...'
line 289  인증 실패: '※ 토큰 인증 실패...'
line 305  스케줄 안내: 'MJMAPS 회원 전용 입찰 일정입니다...'
line 307  회원 없음: '회원 정보가 확인되지 않습니다...'
line 314  최초 접속: '안녕하세요. MJMAPS 봇입니다...'
line 363  입찰확정 질문: '입찰확정 하시겠습니까?'
line 376  입찰취소 질문: '입찰취소 하시겠습니까?'
line 456  입찰확정/취소 결과 (동적)
line 518  회원정보 없음 오류
line 536  입찰가 공개 메시지 (divider 포함)
line 539  입찰가 확인완료
line 542  처리 오류
line 545  오류
line 559  이미지 목록
line 562  이미지 없음
line 581  테스트 발송 성공
line 691  물건카드 card 상단문구: 'MJ 경매 스쿨입니다. 추천 물건드립니다.'
line 673  물건카드 bid_price 상단문구: '입찰가가 도착했습니다...'
line 680  물건카드 status 상단문구: 'MJ 경매 스쿨입니다. 입찰불가 안내...'
line 686  물건카드 check_request 상단문구

[TelegramService.js - 물건카드 공통 고정문구 (line 654~660)]
  경고: '서울/수도권(경기,인천) 입찰하시는 분은 1주택자만 대출이가능합니다!!'
  담당1: '업무별 담당자 안내 드립니다.'
  담당2: '1. 입찰가 관리: 이정우: (010-4238-7781)'
  담당3: '2. 단기투자클럽 관리: 이경미님 (010-3448-8035)'
  담당4: '3. PT 관리: 장정아님 (010-9838-8035)'

[SheetDB.js]
line 409  입찰가 공개 (confirmBidPriceWithTelegramReply)
line 1499 입찰확정 완료 reply
line 1518 입찰취소 완료 reply
line 1593 요청 반려 reply
```

### 3-2. msg_templates 시트 구조

| 컬럼 | 필드 | 예시 |
|------|------|------|
| A | msg_key | `item_card.card` |
| B | category | `물건카드` |
| C | description | 추천 물건 전달 시 상단 문구 |
| D | template | MJ 경매 스쿨입니다. 추천 물건드립니다. |
| E | variables | {memberName},{sakunNo},{inDate},{court} |
| F | updated_at | 260303 143022 |
| G | updated_by | admin |

### 3-3. 전체 메시지 키 목록 (31개)

```
카테고리: 인증
  auth.connect_success    ← TelegramService.js:287
  auth.connect_fail       ← TelegramService.js:289
  auth.welcome            ← TelegramService.js:314

카테고리: 네비게이션
  nav.schedule            ← TelegramService.js:305
  nav.member_not_found    ← TelegramService.js:307

카테고리: 입찰다이얼로그
  bid.confirm_dialog      ← TelegramService.js:363
  bid.cancel_dialog       ← TelegramService.js:376

카테고리: 입찰결과
  bid.confirmed           ← TelegramService.js:456 + SheetDB.js:1499
  bid.cancelled           ← TelegramService.js:456 + SheetDB.js:1518
  bid.approved            ← (승인 후 결과)
  bid.rejected            ← SheetDB.js:1593

카테고리: 입찰가
  price.reveal            ← TelegramService.js:536 + SheetDB.js:409
  price.confirmed         ← TelegramService.js:539

카테고리: 물건카드
  item_card.card          ← TelegramService.js:691
  item_card.bid_price     ← TelegramService.js:673
  item_card.status        ← TelegramService.js:680
  item_card.check_request ← TelegramService.js:686
  item_card.warning       ← TelegramService.js:654
  item_card.staff_intro   ← TelegramService.js:655
  item_card.staff_1       ← TelegramService.js:657
  item_card.staff_2       ← TelegramService.js:658
  item_card.staff_3       ← TelegramService.js:659

카테고리: 자동알림 (신규)
  notify.expiry_24h       ← 신규 구현
  notify.expiry_1h        ← 신규 구현
  notify.expiry_done      ← 신규 구현
  notify.bid_d2           ← 신규 구현
  notify.bid_d1           ← 신규 구현

카테고리: 오류
  error.general           ← TelegramService.js:542/545
  error.member_not_found  ← TelegramService.js:518
  error.processing        ← TelegramService.js:477
```

### 3-4. getMessageTemplate_ 함수 설계

```javascript
// SheetDB.js에 추가
function getMessageTemplate_(key, vars) {
  // 1. CacheService에서 먼저 확인 (5분 캐시)
  const cache = CacheService.getScriptCache();
  const cached = cache.get('msg_' + key);
  if (cached) return replaceVars_(cached, vars);

  // 2. msg_templates 시트에서 읽기
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('msg_templates');
  if (!sheet) return '[메시지 없음: ' + key + ']';
  const data = sheet.getDataRange().getValues();
  const row = data.find(r => r[0] === key);
  if (!row) return '[메시지 없음: ' + key + ']';

  const template = String(row[3] || '');
  cache.put('msg_' + key, template, 300); // 5분 캐시
  return replaceVars_(template, vars);
}

function replaceVars_(template, vars) {
  if (!vars) return template;
  let result = template;
  Object.keys(vars).forEach(k => {
    result = result.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k] || '');
  });
  return result;
}
```

**사용 예:**
```javascript
getMessageTemplate_('item_card.card', {memberName: 'MJ 임준희', sakunNo: '2025타경10593'})
getMessageTemplate_('notify.expiry_1h', {memberName: 'MJ 임준희', expireAt: '03/05 14:30'})
getMessageTemplate_('notify.bid_d1', {memberName: 'MJ 임준희', inDate: '26-03-13', court: '서울중앙지법'})
```

### 3-5. 메시지 편집 팝업 UI 설계

```
[환경설정 탭] → "메시지 편집하기" 버튼 클릭
↓
┌─────────────────────────────────────────────────────────────────┐
│  텔레그램 메시지 편집                                       [X] │
├──────────────────┬──────────────────────────────────────────────┤
│ 📁 메시지 목록    │  ✏️ 편집 영역                                │
│                  │                                              │
│ ▼ 인증/연결      │  카테고리: [물건카드        ]                │
│   연결 완료      │  키:       [item_card.card  ] (읽기전용)     │
│   토큰 실패      │  설명:     추천 물건 전달 시 상단 문구        │
│   최초 안내      │                                              │
│                  │  ┌──────────────────────────────────────┐   │
│ ▼ 물건카드       │  │ MJ 경매 스쿨입니다.                  │   │
│ ► 추천전달  ←선택 │  │ 추천 물건드립니다.                   │   │
│   입찰가전달     │  │                                      │   │
│   입찰취소       │  └──────────────────────────────────────┘   │
│   확인요청       │                                              │
│   경고문구       │  사용가능 변수:                              │
│   담당자안내     │  {memberName} {sakunNo} {inDate}            │
│                  │  {court} {remainHours} {expireAt}           │
│ ▼ 자동알림       │                                              │
│   24시간경과     │  ┌──────────────────────────────────────┐   │
│   만료1시간전    │  │ 미리보기                              │   │
│   만료완료       │  │ MJ 경매 스쿨입니다.                  │   │
│   입찰D-2        │  │ 추천 물건드립니다.                   │   │
│   입찰D-1        │  └──────────────────────────────────────┘   │
│                  │                                              │
│ ▼ 오류메시지     │            [초기화]  [미리보기]  [저장]      │
└──────────────────┴──────────────────────────────────────────────┘
```

**저장 흐름:**
```
팝업 [저장] 클릭
→ google.script.run.saveMsgTemplate(key, template)
→ GAS: msg_templates 시트 해당 행 업데이트 + updated_at/by 기록
→ CacheService 해당 키 캐시 삭제
→ 성공 토스트 표시
```

---

## 4. 알림 설정 화면

환경설정 탭에 "알림 설정" 섹션 (메시지 편집 팝업과 별도):

```
┌──────────────────────────────────────────────┐
│ 알림 설정                                     │
├──────────────────────────────────────────────┤
│ 추천 알림                                     │
│  ☑ 24시간 경과 알림 활성화                   │
│  ☑ 만료 1시간 전 알림 활성화                 │
│  ☑ 만료 시 알림 활성화                       │
│                                              │
│ 입찰일 알림                                   │
│  ☑ 전체 활성화                               │
│  ☑ D-2 알림 활성화                          │
│  ☑ D-1 알림 활성화                          │
│  발송 시각: [10] 시  (0~23)                  │
│  대상 상태: [입찰   ] (고정, 변경 불가)       │
│                                              │
│                          [저장]              │
└──────────────────────────────────────────────┘
```

**설정 저장 위치: `settings` 시트**

| key | value | 설명 |
|-----|-------|------|
| EXPIRY_NOTIFY_24H | true | 추천 24h 알림 |
| EXPIRY_NOTIFY_1H | true | 추천 1h 전 알림 |
| EXPIRY_NOTIFY_DONE | true | 만료 알림 |
| BID_NOTIFY_ENABLED | true | 입찰일 알림 전체 |
| BID_NOTIFY_D2 | true | D-2 알림 |
| BID_NOTIFY_D1 | true | D-1 알림 |
| BID_NOTIFY_HOUR | 10 | 발송 시각 |

---

## 5. 전체 트리거 구조 (구현 완료 후)

```
매시간   autoExpireRecommended()   → 추천 24h/47h 알림, 48h 자동만료
매일09시  backupDataToDrive()       → 데이터 백업 (기존 유지)
매일10시  sendBidDateReminders()    → 입찰일 D-2/D-1 알림
         ↑ 시각은 설정값 BID_NOTIFY_HOUR 으로 동적 변경
```

---

## 6. 히스토리 연동 (telegram_requests 확장 - 별도 리포트 참조)

신규 action 값 추가 (기존 호환 유지):
```
EXPIRY_NOTIFY  → 만료 사전 알림 (note에 '24h'/'1h' 표시)
AUTO_EXPIRE    → 48시간 자동 미정 전환
BID_DATE_NOTIFY → 입찰일 알림 (note에 'D-2'/'D-1' 표시)
```

중복 발송 방지:
```
발송 전 체크: action=해당값 AND item_id=해당ID AND note=해당구분 → 있으면 SKIP
```

---

*v2 2026-03-03 수정 - 입찰일 알림 대상 stu_member='입찰'만, 설정화면 추가*
