# 회원 관리 DB 및 UI 매핑 분석 보고서

## 1. 개요
본 문서는 회원 관리 기능의 데이터베이스(Google Sheet) 구조와 사용자 인터페이스(HTML/JS) 간의 데이터 매핑 정합성을 분석한 결과입니다.

## 2. 데이터 구조 비교

### 2.1 DB 구조 (SheetDB.js - ITEM_MEMBER_HEADERS)
Google Sheet의 `members` 시트에 저장되는 데이터 필드 정의입니다.

| 순번 | 필드명 | 설명 | 비고 |
| :-- | :--- | :--- | :--- |
| 1 | `member_id` | 회원 ID (PK) | 자동 생성 |
| 2 | `class_id` | 수업 ID (FK) | |
| 3 | `gubun` | 구분 | 회원/직원/관리자 |
| 4 | `member_name` | 회원 이름 | 필수 |
| 5 | `name1_gubun` | 명의1 구분 | 개인/법인 |
| 6 | `name1` | 명의1 이름 | |
| 7 | `name2_gubun` | 명의2 구분 | |
| 8 | `name2` | 명의2 이름 | |
| 9 | `name3_gubun` | 명의3 구분 | |
| 10 | `name3` | 명의3 이름 | |
| 11 | `phone` | 전화번호 | 필수 |
| 12 | `address` | 주소 | |
| 13 | `account_bank` | 계좌 은행명 | |
| 14 | `account_no` | 계좌 번호 | |
| 15 | `note1` | 비고1 | |
| 16 | `note2` | 비고2 | Class 비고 |
| 17 | `member_token` | 회원 토큰 | 자동 생성 |
| 18 | `telegram_chat_id` | 텔레그램 ID | 연동 시 자동 |
| 19 | `telegram_enabled` | 텔레그램 사용여부 | |
| 20 | `kaib_date` | 가입일 | |
| 21 | `reg_date` | 등록일 | 자동 생성 |

### 2.2 UI 입력 폼 (index.html MemberManagement)
사용자 화면에서 데이터를 입력하고 보여주는 필드 구성입니다.

| UI ID | 매핑 필드 | 입력 타입 | 비고 |
| :--- | :--- | :--- | :--- |
| `mem-member_id` | `member_id` | Hidden | |
| `mem-class_id` | `class_id` | Hidden | `mem-class_id_select`로 선택 |
| `mem-gubun` | `gubun` | Select | |
| `mem-member_name` | `member_name` | Text | |
| `mem-phone` | `phone` | Text | |
| `mem-name1_gubun` | `name1_gubun` | Select | |
| `mem-name1` | `name1` | Text | |
| `mem-name2_gubun` | `name2_gubun` | Select | |
| `mem-name2` | `name2` | Text | |
| `mem-name3_gubun` | `name3_gubun` | Select | |
| `mem-name3` | `name3` | Text | |
| `mem-kaib_date` | `kaib_date` | Date | |
| `mem-note1` | `note1` | Textarea | |
| `mem-address` | `address` | Text | |
| `mem-account_bank` | `account_bank`| Text | |
| `mem-account_no` | `account_no` | Text | |
| `mem-note2` | `note2` | Textarea | |
| `mem-member_token` | `member_token` | Text | Readonly |
| `mem-telegram_chat_id`| `telegram_chat_id`| Text | Readonly |
| `mem-telegram_enabled`| `telegram_enabled`| Text | Readonly |

## 3. 매핑 분석 결과

### 3.1 정합성 확인 (일치)
대부분의 주요 필드가 DB와 UI 간에 1:1로 정확하게 매핑되어 있습니다.
- **기본 정보**: 이름, 전화번호, 구분 등 핵심 정보가 일치합니다.
- **명의 정보**: 명의 1, 2, 3의 구분과 이름 필드가 모두 존재합니다.
- **상세 정보**: 주소, 계좌정보, 비고란이 일치합니다.
- **시스템 정보**: 토큰, 텔레그램 정보가 UI에 표시(Read-only)되고 DB에 저장됩니다.

### 3.2 특이 사항
1.  **`reg_date` (등록일)**:
    -   DB에는 존재하지만, **상세 화면(Form)에는 표시되지 않습니다.**
    -   사용자가 수정할 수 없는 정보이므로 폼에서 제외된 것은 의도된 설계로 보입니다.
    -   필요 시 `read-only` 필드로 추가할 수 있습니다.
2.  **`account_name` (예금주)**:
    -   과거 코드 (`Code.js`의 이전 버전)에는 있었으나, 현재 `SheetDB.js`의 `ITEM_MEMBER_HEADERS`와 UI에서 **모두 제거**되었습니다.
    -   이는 최신 스키마("2026-02 Reform") 정책과 일치합니다.

## 4. 결론
현재 상태에서 **DB 구조와 UI 입력 폼 간의 데이터 매핑은 정확**합니다.
이전 단계에서 수행한 헤더 불일치 수정 작업(`Code.js` 업데이트)을 통해 데이터 읽기/쓰기 오류가 해결되었으며, UI 상의 누락 필드는 없는 것으로 확인됩니다.
