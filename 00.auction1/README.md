# 옥션원 크롤링 매니저 (00.auction1)

옥션원(auction1.co.kr) 종합검색 페이지를 로컬에서 미러링한 화면.
검색 조건 + 후처리 필터를 프리셋으로 저장/수정/삭제하고,
저장된 프리셋을 셀레니움 백엔드로 실행해 MAPS 조사관리 DB로 업로드하는 것이 최종 목표.

## 실행

브라우저에서 `index.html` 을 직접 열기 (Chrome/Edge 권장).
또는 임시 정적 서버:

```
cd 00.auction1
python -m http.server 8765
# http://localhost:8765
```

## 파일

- `index.html` — 사이드바 + 편집 패널 (옥션원 종합검색 폼 1:1)
- `styles.css` — 옥션원 분위기 따라간 자체 CSS
- `data.js`   — 옥션원 종합검색 select 옵션값 (법원/물건종류/물건현황/특수물건/시도/정렬)
- `app.js`    — 프리셋 CRUD + 추가 필터 종류 CRUD + UI 로직

## 데이터 저장

브라우저 localStorage:

- `auction1_presets_v1` — 프리셋 배열 `[{id, title, formData, customFilters, updatedAt}]`
- `auction1_ftypes_v1`  — 추가 필터 종류 배열 `[{id, name, valueType}]` (재사용 라이브러리)

## 추가 필터링 조건

옥션원 종합검색 폼에서 표현 못 하는 후처리 필터.
예) 비고에 특정 키워드 포함 / 임차인 N명 이상 / 근저당 합계 X 이하.

- 한번 등록한 종류는 다음 프리셋에서 그대로 재사용 (드롭다운에 노출).
- 새 종류 필요하면 드롭다운 끝의 `+ 새 필터 종류 추가...` 선택.
- 각 행: `[종류] [비교: =, ≠, ≥, ≤, 포함, 미포함, 정규식] [값]`

## 다음 단계 (백엔드)

- Python (Selenium) 백엔드 작성 예정
- 로그인 정보 출처: `00.imageup/01.i.py` ACCOUNTS
- 흐름: 프리셋 → 옥션원 폼 자동 입력 → 결과 페이지 파싱 → 후처리 필터 적용 → MAPS 조사관리 DB 업로드

## 주의

- 로컬 전용. GAS 배포 안 함 (`.claspignore` 에 `00.auction1/**` 추가).
- 깃 커밋은 정상.
