# MAPS 프로젝트 이력 (Project History)

## 2026-02-21: Git & GitHub 통합 및 자동 배포 설정

수많은 시행착오 끝에 GitHub Actions를 통한 Google Apps Script(GAS) 자동 배포 환경을 구축했습니다.

### 🛠️ 주요 조치 및 해결 사항

1. **GitHub Actions 워크플로우 안정화**:
   - 쉘 스크립트의 문자열 처리 한계를 극복하기 위해 **Node.js 기반 Base64 디코딩** 방식을 최종 채택.
   - 깃허브 시크릿(`CLASP_SETTING`) 복사 과정에서 발생하는 공백/줄바꿈 이슈를 자동 해결하도록 구현.
2. **보안 및 인증**:
   - `CLASP_SETTING` 시크릿에 `.clasprc.json` 내용을 Base64로 인코딩하여 저장.
   - `.clasp.json` 파일을 저장소에 포함하여 배포 시 스크립트 ID를 인식하도록 조치.
3. **버전 관리 워크플로우 확립**:
   - `로컬 개발 -> GAS 테스트(clasp push) -> 검증 완료 -> GitHub 푸시(git push) -> 자동 배포`

### ⚠️ 인지된 문제 및 교훈

- **도구 성능 맹신 금지**: 브라우저 도구 등 AI 도구의 일시적 장애가 발생할 경우, 짐작에 의존하지 말고 가장 확실한 정석(Heredoc, Node.js script 등)으로 즉시 전환해야 함.
- **검증 루틴 필수**: 설정 파일 수정 후 반드시 실제 깃허브 실행 로그를 대조하여 최종 성공 여부를 확인해야 함.

### 🚀 최종 배포 워크플로우

이제 `master` 브랜치에 코드를 푸시하면 깃허브 로봇이 즉시 GAS로 배포를 시작합니다.

- [GitHub Actions 관리](https://github.com/jrain7781/MAPS/actions)
