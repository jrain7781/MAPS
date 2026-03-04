# 물건 종합 히스토리 & 추천 자동만료 설계 리포트

작성일: 2026-03-03
버전: v3 최종 확정

---

## 1. 핵심 원칙

```
물건 키          = items.id              (사건번호 ≠ 키)
48시간 기산점     = items.chuchen_date    (텔레그램 전달완료 시각, 로딩바와 동일 기준)
히스토리 FK      = item_id
타임스탬프 형식   = yyMMdd HHmmss         (예: 260303 143022)
모든 변경 = 뮤테이션 (생성/수정/삭제 구분 없음, from→to 값으로 표현)
```

---

## 2. 모든 변경은 뮤테이션이다

```
없다가 생김  = from_value: '' (없음)  →  to_value: '추천'       (생성)
있다가 바뀜  = from_value: '추천'     →  to_value: '입찰'       (수정)
있다가 없어짐 = from_value: '1109'    →  to_value: '' (없음)    (삭제)
```

→ CREATE / UPDATE / DELETE 모두 동일한 구조로 기록. 별도 구분 불필요.

---

## 3. trigger_type 분류

| trigger_type | 설명 | 예시 |
|-------------|------|------|
| `web` | 관리자 웹 대시보드 수동 조작 | 물건 저장, 상태 변경, 전달완료 버튼 |
| `web-telegram` | 관리자가 웹에서 텔레그램 전송 | 추천 전달(텔레그램), 입찰가 전달(텔레그램) |
| `web-다중` | 관리자 웹 일괄 처리 | 일괄 상태변경 |
| `member-telegram` | 회원 텔레그램 요청/응답 | 입찰 요청, 취소 요청 |
| `system` | GAS 자동 트리거 | 48시간 만료, 알림 발송, 자동승인 |

> **구분 기준**: 입찰가를 텔레그램으로 전송하면 `web-telegram`, 전달완료 버튼만 클릭하면 `web`

---

## 4. action 전체 목록

### 4-1. 필드 뮤테이션 (물건 저장 시 변경 감지)

| action | field_name | 설명 |
|--------|-----------|------|
| `FIELD_CHANGE` | `stu_member` | 물건 상태 변경 (상품→추천→입찰→미정 등) |
| `FIELD_CHANGE` | `member_id` | 담당 회원 변경 |
| `FIELD_CHANGE` | `bidprice` | 입찰가 변경 |
| `FIELD_CHANGE` | `m_name_id` | 입찰담당 변경 |

> **생성**: from_value='' → to_value='값'
> **수정**: from_value='이전값' → to_value='새값'
> **삭제**: from_value='이전값' → to_value=''

### 4-2. 물건 생명주기

| action | 설명 |
|--------|------|
| `ITEM_CREATE` | 물건 신규 등록 |
| `ITEM_DELETE` | 물건 삭제 (향후 기능) |

### 4-3. 텔레그램 이벤트

| action | trigger_type | 설명 |
|--------|-------------|------|
| `TELEGRAM_SENT` | web-telegram / system | 텔레그램 발송 (관리자 전달 또는 자동 알림) |
| `TELEGRAM_RECEIVED` | member-telegram | 텔레그램 수신 (회원 응답/버튼 클릭) |
| `REQUEST_BID` | member-telegram | 회원 입찰 요청 접수 |
| `REQUEST_CANCEL_CHUCHEN` | member-telegram | 회원 **추천 취소** 요청 접수 |
| `REQUEST_CANCEL_BID` | member-telegram | 회원 **입찰 취소** 요청 접수 |
| `REQUEST_APPROVED` | system / web | 요청 승인 (현재 자동승인 → `system`) |
| `REQUEST_REJECTED` | web | 요청 거절 |

> **읽음 히스토리**: Telegram Bot API는 봇이 보낸 메시지의 읽음 여부를 직접 수신하는 기능을 제공하지 않음.
> 대안: 회원이 봇에 다음 메시지를 보낼 때 `TELEGRAM_RECEIVED`로 간접 확인 가능.
> 추후 Telegram Webhook의 `read` 이벤트 지원 여부 모니터링 필요.
> 입찰가 확인완료 버튼 클릭은 기존대로 별도 상태(`bid_state=확인완료`)로 관리.

> **추천/입찰 취소 구분**: `REQUEST_CANCEL_CHUCHEN`(추천 단계 취소) vs `REQUEST_CANCEL_BID`(입찰 결정 후 취소)로 분리하여 취소 유형별 집계 가능.

### 4-4. 시스템 자동화

| action | trigger_type | 설명 |
|--------|-------------|------|
| `EXPIRY_NOTIFY` | system | 만료 사전 알림 발송 (주기 설정) |
| `AUTO_EXPIRE` | system | 48시간 만료 → 미정 자동 전환 |

---

## 5. telegram_requests 최종 컬럼 설계 (16컬럼)

| # | 컬럼 | 기존/신규 | 설명 | 예시 |
|---|------|----------|------|------|
| A | req_id | 기존 | 고유 ID (타임스탬프) | 1740999123456 |
| B | requested_at | 기존 | 발생 시각 **yyMMdd HHmmss** | 260303 143022 |
| C | action | 기존→확장 | 이벤트 종류 | FIELD_CHANGE |
| D | status | 기존 | PENDING / APPROVED / REJECTED / DONE | DONE |
| E | item_id | 기존 | **물건 키 (FK → items.id)** | 1740999000001 |
| F | member_id | 기존 | **이벤트 시점 담당 회원 ID** | 1109 |
| G | chat_id | 기존 | 텔레그램 chat_id (해당시만) | 7123456789 |
| H | telegram_username | 기존 | 텔레그램 username (해당시만) | mjuser |
| I | note | 기존 | 부가 정보 (JSON) | {"msg":"..."} |
| J | approved_at | 기존 | 처리 완료 시각 yyMMdd HHmmss | 260303 143055 |
| K | approved_by | 기존 | 처리 주체 | system |
| **L** | **from_value** | 신규 | 변경 전 값 (없으면 빈 문자열) | 추천 |
| **M** | **to_value** | 신규 | 변경 후 값 (없으면 빈 문자열) | 미정 |
| **N** | **field_name** | 신규 | 변경된 필드명 | stu_member |
| **O** | **trigger_type** | 신규 | web / web-telegram / web-다중 / member-telegram / system | system |
| **P** | **member_name** | 신규 | 이벤트 시점 회원명 | MJ 임준희 |

> **설계 확인 - 회원 변경 대응**: F(member_id)와 P(member_name)는 이벤트 **발생 시점** 기준으로 기록.
> 나중에 물건 담당 회원이 바뀌어도 과거 히스토리의 집계는 영향받지 않음. ✅

> **일반회원 + 텔레그램 회원 혼재 처리**:
> - 텔레그램 연동 회원: `TELEGRAM_SENT` → `TELEGRAM_RECEIVED` (응답) 모두 기록
> - 일반회원(카톡 안내): `TELEGRAM_SENT` 기록 (관리자가 텔레그램 전송 버튼 사용), `TELEGRAM_RECEIVED` 없음
> - **입찰가 전달 통합**: 일반회원도 추천 전달과 동일하게 텔레그램 전송 버튼으로 전달 → `TELEGRAM_SENT(web-telegram)` 기록. 기존 '전달완료 버튼'은 텔레그램 미발송 시 수동 기록용(`web`)으로 유지.
> - 결과: 텔레그램 버튼 하나로 전달 + 히스토리 기록 일괄 처리 가능.

---

## 6. 실제 타임라인 예시 (물건 하나의 히스토리)

```
item_id: 1740999000001

260301 100000  ITEM_CREATE      -           -          web      ← 물건 등록
260301 100001  FIELD_CHANGE     stu_member  '' → 상품  web      ← 상태 생성
260301 140000  FIELD_CHANGE     stu_member  상품→추천  web      ← 추천 설정
260301 140010  TELEGRAM_SENT    -           -          system   ← 추천 알림 발송
260301 150000  TELEGRAM_RECEIVED -          -          member-telegram ← 회원 "확인" 응답
260302 080000  EXPIRY_NOTIFY    -           -          system   ← 18시간 경과 알림
260302 120000  FIELD_CHANGE     bidprice    ''→15000만 web      ← 입찰가 등록(생성)
260302 120001  FIELD_CHANGE     stu_member  추천→입찰  web      ← 상태 변경
260302 130000  REQUEST_CANCEL_BID -         -          member-telegram ← 회원 입찰취소 요청
                                                       ★ 이 로그로 회원별 입찰취소 건수 집계 가능 (Section 8 참조)
260302 131000  REQUEST_APPROVED -           -          system   ← 자동승인 처리
260302 131001  FIELD_CHANGE     stu_member  입찰→미정  web      ← 상태 변경
260302 131002  FIELD_CHANGE     member_id   1109→''    web      ← 회원 해제(삭제)
260303 100000  FIELD_CHANGE     member_id   ''→1042    web      ← 회원 재배정(생성)
260303 100001  FIELD_CHANGE     member_id명 ''→정지용  web
260303 100500  FIELD_CHANGE     stu_member  미정→추천  web      ← 재추천
260303 100510  TELEGRAM_SENT    -           -          system   ← 재추천 알림 발송
260303 140510  EXPIRY_NOTIFY    -           -          system   ← 6시간 전 알림
260305 100510  AUTO_EXPIRE      stu_member  추천→미정  system   ← 48시간 자동만료
260305 100511  TELEGRAM_SENT    -           -          system   ← 만료 알림 발송
```

---

## 7. 48시간 자동만료 로직

### 7-1. 기산점: chuchen_date (기존 필드, 로딩바와 동일)

```
items.chuchen_date = 텔레그램 추천 전달완료 시각 (R열)
→ 로딩바(createChuchenTimerBar)가 이미 이 값으로 48h 표시 중
→ 자동만료도 동일 기준 사용 → 화면과 서버 로직 일치
```

### 7-2. 알림 주기 (configurable)

```javascript
// 설정 (나중에 Settings 시트로 이관 가능)
const EXPIRY_NOTIFY_HOURS = [24, 47];  // 경과 24h (24시간 경과), 47h (만료 1시간 전)
const EXPIRY_HOURS = 48;               // 48h 경과 시 자동 미정 전환
```

**알림 주기 확정**:
- **추천 물건**: 24시간 경과 알림 → 47시간 경과 알림(만료 1시간 전) → 48시간 자동만료 알림
- **입찰 물건**: 매일 오전 10시 D-3, D-2, D-1 알림 (CONSULTING_알림자동화_메시지관리.md 참조)


### 7-3. 매시간 트리거 흐름

```
[GAS 매시간 실행: autoExpireRecommended()]

1. items 시트에서 stu_member='추천' AND chuchen_date 있는 행 조회
2. 각 물건에 대해:
   a. elapsed = (현재시각 - chuchen_date) / 3600초
   b. elapsed >= 48h
      → stu_member = '미정' 변경
      → 히스토리: AUTO_EXPIRE, FIELD_CHANGE(stu_member: 추천→미정) 기록
      → 텔레그램 알림: TELEGRAM_SENT 기록
   c. elapsed >= 알림 주기 (24h, 36h, 42h) AND 해당 알림 미발송
      → 텔레그램 사전 알림 발송
      → 히스토리: EXPIRY_NOTIFY 기록
3. LockService로 중복 실행 방지
```

### 7-4. 텔레그램 알림 메시지

**사전 알림 (예: 6시간 전)**
```
⏰ 추천 물건 만료 예정 안내

[MJ 임준희]님, 아래 물건의 추천 기간이 6시간 후 만료됩니다.

📋 2025타경10593 (서울중앙지법)
⏳ 남은 시간: 6시간
📅 만료 예정: 03/05 10:51

입찰 진행을 원하시면 지금 바로 요청해 주세요.
48시간 이후 자동 취소 처리 됩니다.
```

**만료 알림**
```
📌 추천 물건 기간 만료

[MJ 임준희]님, 아래 물건의 추천 기간(48시간)이 만료되어
물건추천이 취소 되었습니다. 

📋 2025타경10593 (서울중앙지법)
📅 전달 시각: 03/03 10:51
⏰ 만료 시각: 03/05 10:51

감사합니다.
```

### 7-5. 취소건 조회 화면 (Phase 6 구현)

텔레그램 회원관리 화면에 **"취소건 조회"** 탭/메뉴 추가:

| 컬럼 | 내용 |
|------|------|
| 순번 | 1, 2, 3... |
| 입찰일자 | items.in-date (YYMMDD → 표시형식 변환) |
| 사건번호 | items.sakun_no |
| 법원 | items.court |
| 취소일자 | telegram_requests.requested_at |
| 취소사유 | `추천시간 만기` (AUTO_EXPIRE) / `회원요청` (REQUEST_CANCEL_BID / REQUEST_CANCEL_CHUCHEN) |

- 데이터 소스: `telegram_requests` 시트에서 action IN ('AUTO_EXPIRE', 'REQUEST_CANCEL_BID', 'REQUEST_CANCEL_CHUCHEN') 조회
- 회원별 필터: 특정 회원의 취소 이력만 볼 수 있도록

---

## 8. 회원 관리 집계 (향후 기능)

```
member_id = 1109 기준 집계:

입찰 확정 횟수    = REQUEST_BID    & status=APPROVED  & member_id=1109
취소 횟수    = REQUEST_CANCEL & status=APPROVED  & member_id=1109
자동만료 횟수 = AUTO_EXPIRE                      & member_id=1109
담당 물건 수  = FIELD_CHANGE  & field=member_id  & to_value=1109 (배정)
물건 해제 수  = FIELD_CHANGE  & field=member_id  & from_value=1109 (해제)
```

> **이벤트 시점 member_id 기록** → 나중에 회원이 바뀌어도 집계 정확

---

## 9. 구현 계획

### Phase 1: 컬럼 확장 + 기록 함수
1. `ensureTelegramRequestsSheet_()` 에 L~P 컬럼 추가
2. `writeItemHistory_(params)` 함수 작성
3. `updateData()` 에 변경 감지 & 기록 삽입 (저장 전 기존값 읽기 → 비교 → appendRow)
4. `createData()` 에 ITEM_CREATE 기록 삽입

### Phase 2: 텔레그램 이벤트 기록
5. 텔레그램 발송 함수 → TELEGRAM_SENT 기록
6. 텔레그램 수신 처리 → TELEGRAM_RECEIVED 기록
7. 요청 승인/거절 → REQUEST_APPROVED/REJECTED 기록

### Phase 3: 자동만료 트리거
8. `autoExpireRecommended()` 함수 작성
9. `EXPIRY_NOTIFY_HOURS` 설정으로 알림 주기 관리
10. GAS 매시간 트리거 등록 (`ScriptApp.newTrigger().everyHours(1)`)
11. LockService 적용 (중복 실행 방지)

### Phase 4: 회원 관리 집계 UI
12. 회원 상세 화면에 집계 카드: 입찰 N건 / 취소 N건 / 만료 N건

---

## 10. 부하 & 운영

| 항목 | 내용 |
|------|------|
| 쓰기 부하 | appendRow() = O(1), 스캔 없음, **부하 없음** |
| 읽기 부하 | item_id 기준 TextFinder, 수천 행 이하 **문제없음** |
| 시트 크기 | Google Sheets 최대 1000만 셀, 연간 수만 행도 여유 |
| 트리거 실행 | 매시간 1회, LockService로 중복 방지 |
| 기존 데이터 | L~P 컬럼 공백으로 하위 호환 유지 |
| 로딩바 연동 | chuchen_date 기준 동일 → 화면·서버 완전 일치 |

---

*v3 2026-03-03 - trigger_type 4종, 뮤테이션 통합 설계, 로딩바 chuchen_date 연동 확정*
*v4 2026-03-04 - trigger_type 5종 확정(web/web-telegram/web-다중/member-telegram/system), REQUEST_CANCEL 추천/입찰 분리, 알림주기 [24h/47h] 확정, 취소건 조회 화면 설계, 일반회원 히스토리 통합 방향 확정*
