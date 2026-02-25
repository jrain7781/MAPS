# Project Context: MAPS

## 프로젝트 개요

MAPS(Member Auction/Bidding Management System)는 구글 스프레드시트를 데이터베이스로 활용하여 회원 및 경매 물건을 관리하고, 텔레그램 봇과 연동하여 관련 알림 및 요청을 처리하는 시스템입니다.

## 주요 기능

- **회원 관리**: 스프레드시트의 `members` 시트를 통한 회원 데이터 CRUD.
- **물건 관리**: `items` 시트를 통한 경매 물건 데이터 CRUD 및 대량 업데이트.
- **텔레그램 연동**: `telegram_requests` 시트를 통해 텔레그램 봇에서 수신된 요청 처리.
- **데이터 백업**: 드라이브 내 특정 폴더로 데이터와 스크립트 백업 (JSON 및 스프레드시트 복사).
- **웹 인터페이스**: Google Apps Script Web App (HTML/JS/CSS) 제공.

## 파일 구성 및 역할

- `Code.js`: GAS 백엔드 진입점 및 주요 API 핸들러.
- `SheetDB.js`: 스프레드시트 데이터 조작(Read/Write) 핵심 로직.
- `Backup.js`: 데이터 백업 및 트리거 관리.
- `TelegramService.js`: 텔레그램 봇 연동 로직.
- `ClassService.js`: 수업 관리 로직.
- `Main.js`: UI 진입 및 메뉴 구성.
- `index.html`: 메인 웹 UI 레이아웃.
- `js-app.html`: 프론트엔드 JavaScript 앱 로직 (메인 코드).
- `css.html`: 앱 스타일 시트.
- `.clasp.json`: GAS 로컬 개발을 위한 `clasp` 설정 파일.
- `.gitignore`: Git 제외 파일 설정 (`backup/` 포함).

## 데이터 구조 (핵심 키)

### items 시트
- `member_id`: 회원 연결 키 (members.member_id와 연결)
- `m_name`: 회원 표시 이름
- `bidprice`, `bid_state`: 입찰가, 입찰 상태
- `note`: 물건 비고

### members 시트
- `member_id`: **기본 키** (items.member_id와 연결)
- `member_name` (또는 `name`): 회원 이름
- `note1`: 회원 비고
- `telegram_enabled`: 텔레그램 연동 여부 (Y/N)
- `telegram_chat_id`: 텔레그램 Chat ID
- `member_token`: 인증 토큰

## 버전 관리 및 작업 흐름 (Version Control Workflow)

본 프로젝트는 **Local → GAS → GitHub(master)** 삼중 구조로 관리됩니다.

### ⚠️ GitHub 브랜치 규칙 (반드시 준수)
- **GitHub 기본 브랜치**: `master` (한국어 UI에서 "주인"으로 표시됨)
- **자동 배포 트리거**: `master` 브랜치 push → GitHub Actions → `clasp push` → GAS 자동 배포
- **로컬 설정**: 로컬 `main` 브랜치가 `origin/master`를 추적하도록 설정됨
  ```
  git push  →  origin/master  →  GitHub Actions  →  GAS 자동 배포
  ```
- **절대 `main` 브랜치에만 push 금지** (Actions가 master만 감시함)

### 작업 순서
1. **코드 수정**: 로컬에서 작업
2. **GAS 반영** (`clasp push`): 개발 중 실시간 확인용 수시 실행
3. **사용자 검증**: GAS 웹앱에서 기능 정상 작동 확인
4. **GitHub push** (`git push`): 사용자 검증 완료 후 "깃허브에 올려줘" 요청 시
   - 커밋: `git add -A && git commit -m "설명"`
   - push: `git push` (자동으로 origin/master로 전송됨)
   - push 후 GitHub Actions가 자동으로 GAS에 재배포
5. **복구**: 문제 발생 시 `git checkout <커밋>` → `clasp push` 순서로 복구

### GitHub 저장소 정보
- **URL**: https://github.com/jrain7781/MAPS.git
- **기본 브랜치**: `master` (한국어: "주인", 기본값 배지 표시)
- **자동 배포 파일**: `.github/workflows/deploy.yml`
- **backup/ 폴더**: `.gitignore`에 추가됨 (git 추적 제외, .clasprc.json 토큰 보안)

## 프론트엔드 핵심 함수 (js-app.html)

### 전역 변수
- `allMembersNewData`: **메인 회원 데이터 배열** (회원관리 탭 로드 시 채워짐)
- `allMemberData`: 구버전 회원 데이터 (fallback용, 가급적 사용 금지)
- `currentDetailItem`: 현재 선택된 물건 상세 데이터

### 회원 관련 함수
- `loadMembersNew()` / `readAllMembersNew()`: 회원 데이터 로드 → `allMembersNewData`에 저장
- `filterMembersNew()`: 회원 목록 필터링 (검색 입력: `#mem-search-name`)
- `saveMemberNoteOnly()`: 회원 비고(note1)만 저장 → `updateMember()` 호출
- `goToMemberFromDetail()`: 현재 물건의 `member_id`로 회원관리 탭 이동 및 자동 검색
- `navigateTo('MemberManagement')`: 회원관리 탭으로 전환 (탭 전환 함수)

### 물건 상세 함수
- `showForm(data)`: 물건 상세 폼 표시. `allMembersNewData`에서 `member_id`로 회원 찾아 회원비고(note1) 표시

### 회원 데이터 조회 패턴 (표준)
```javascript
const memberList = (typeof allMembersNewData !== 'undefined' && allMembersNewData.length > 0)
    ? allMembersNewData
    : (typeof allMemberData !== 'undefined' ? allMemberData : []);
const mem = memberList.find(m => String(m.member_id) === String(targetId));
```

## UI 구조 주요 요소 (index.html)

### 탭 전환
- `navigateTo('탭명')`: 메인 탭 전환 함수
- 탭명: `Dashboard`, `ItemManagement`, `MemberManagement`, `ClassManagement`, `ClassSchedule`, `BiddingSchedule`, `Preferences`

### 입찰물건 상세탭 비고 영역 (2분할)
- **좌측**: 회원비고 (`#form-member-note`, readonly textarea)
  - [회원관리] 버튼: `goToMemberFromDetail()` 호출
  - [회원비고 저장] 버튼: `saveMemberNoteOnly()` 호출
- **우측**: 물건비고 (`#form-note`, 편집 가능)

### 회원관리 탭 검색
- 이름 검색 입력: `#mem-search-name`
- 검색 함수: `filterMembersNew()`

## 프로젝트 관리 규칙 (Global Rules)

- **한글 경로 지양**: 윈도우 한글 사용자명 관련 호환성 방지.
- **UTF-8 인코딩**: 모든 파일은 UTF-8 인코딩으로 관리.
- **회원 조회 키**: 반드시 `member_id`를 기준으로 검색 (이름 기준 금지).
- **allMembersNewData 우선**: 회원 데이터는 `allMembersNewData` 우선 사용, `allMemberData`는 fallback만.

## 최근 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-02-25 | `backup/` 폴더 `.gitignore` 추가 (GitHub 시크릿 스캔 차단 해결) |
| 2026-02-25 | 로컬 `main` → `origin/master` 추적 설정, git push 자동 배포 파이프라인 확립 |
| 2026-02-25 | 회원비고(note1) 표시/저장 기능 추가: `form-member-note`, `saveMemberNoteOnly()` |
| 2026-02-25 | [회원관리] 버튼 추가: `member_id` 기준 회원관리 탭 이동 및 자동 검색 (`goToMemberFromDetail`) |
| 2026-02-25 | 탭 전환 함수 `showTab` → `navigateTo` 수정 |
| 2026-02-25 | 입찰물건 상세탭 비고 2분할: 회원비고(좌) + 물건비고(우) |
| 2026-02-25 | `allMemberData` → `allMembersNewData` 우선 사용으로 전면 수정 |
