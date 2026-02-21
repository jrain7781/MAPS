# Project Context: MAPS

## 프로젝트 개요

MAPS(Member Auction/Bidding Management System)는 구글 스프레드시트를 데이터베이스로 활용하여 회원 및 경매 물건을 관리하고, 텔레그램 봇과 연동하여 관련 알림 및 요청을 처리하는 시스템입니다.

## 주요 기능

- **회원 관리**: 스프레드시트의 `members` 시트를 통한 회원 데이터 CRUD.
- **물건 관리**: `items` 시트를 통한 경매 물건 데이터 CRUD 및 대량 업데이트.
- **텔레그램 연동**: `telegram_requests` 시트를 통해 텔레그램 봇에서 수신된 요청 처리.
- **데이터 백업**: 드라이브 내 특정 폴더로 데이터와 스트립트 백업 (JSON 및 스프레드시트 복사).
- **웹 인터페이스**: Google Apps Script Web App (HTML/JS/CSS) 제공.

## 파일 구성 및 역할

- `Code.js`: GAS 백엔드 진입점 및 주요 API 핸들러.
- `SheetDB.js`: 스프레드시트 데이터 조작(Read/Write) 핵심 로직.
- `Backup.js`: 데이터 백업 및 트리거 관리.
- `TelegramService.js`: 텔레그램 봇 연동 로직.
- `Main.js`: UI 진입 및 메뉴 구성.
- `index.html`: 메인 웹 UI 레이아웃.
- `js-app.html`: 프론트엔드 JavaScript 앱 로직.
- `css.html`: 앱 스타일 시트.
- `clasp.json`: GAS 로컬 개발을 위한 `clasp` 설정 파일.
- `.gitignore`: Git 제외 파일 설정.

## 버전 관리 및 작업 흐름 (Version Control Workflow)

본 프로젝트는 **Local - GAS - GitHub** 삼중 구조로 관리됩니다.

1. **GAS 반영 (clasp push)**: 개발 중 실시간 확인을 위해 수시로 실행.
2. **사용자 검증**: GAS 웹 앱에서 기능 정상 작동 여부 확인.
3. **GitHub 백업 (git push)**: 사용자 검증 완료 후, "깃허브에 올려줘" 요청 시 최종 커밋 및 푸시 진행.
    - **커밋 메시지**: 작업 내용을 한글/영어 혼용하여 상세히 기록.
    - **복구**: 문제 발생 시 `git checkout` -> `clasp push` 순서로 복구 수행.

## 프로젝트 관리 규칙 (Global Rules)

- **한글 경로 지양**: 윈도우 한글 사용자명 관련 호환성 방지를 위해 모든 프로젝트 폴더 및 파일명은 영문을 원칙으로 함.
- **UTF-8 인코딩**: 모든 파일은 UTF-8 인코딩으로 관리함.
- **Virtual Environment**: Python 활용 시 프로젝트 내 `.venv`를 사용함.
- **Path Handling**: Python 활용 시 `pathlib.Path`를 사용하여 경로 문제를 방지함.

## 최근 변경 관리

- 한글 경로(`백업` 등) 제거 작업 진행 중.
- Git 저장소 초기화 및 GitHub(`jrain7781/MAPS`) 연동 완료.
- `clasp push` -> `사용자 검증` -> `git push` 작업 흐름 확립.
- `project_context.md` 관리 및 업데이트.
