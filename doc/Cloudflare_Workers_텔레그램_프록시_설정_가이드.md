# Cloudflare Workers 텔레그램 프록시 설정 가이드

## 📋 개요

### 문제
- GAS(Google Apps Script) 웹앱은 POST 요청 시 항상 **302 Moved Temporarily**를 반환
- Telegram 웹훅은 302를 에러로 처리하여 **재시도 → 3~5분 지연** 발생
- `getWebhookInfo`에서 `last_error_message: "Wrong response from the webhook: 302 Moved Temporarily"` 확인됨

### 해결 방법
Cloudflare Workers를 프록시로 사용:
```
Telegram → Cloudflare Worker (즉시 200 OK 반환)
                ↓ (waitUntil 비동기)
         GAS 웹앱 (302 리다이렉트 자동 처리)
```

### 장점
- Telegram에 즉시 200 OK 반환 → **재시도 없음, 지연 없음**
- `waitUntil()`로 비동기 전달 → Worker 응답 시간에 영향 없음
- Cloudflare Workers 무료 플랜: **일 10만 요청** 충분
- 추가 비용 없음

---

## 🚀 설정 방법

### 방법 1: Cloudflare 대시보드 (GUI, 추천)

#### Step 1: Cloudflare 계정 생성
1. https://dash.cloudflare.com/sign-up 접속
2. 이메일/비밀번호로 가입 (무료)

#### Step 2: Worker 생성
1. 대시보드 좌측 메뉴 → **Workers & Pages** 클릭
2. **Create application** → **Create Worker** 클릭
3. Worker 이름: `mjmaps-telegram-proxy` (원하는 이름)
4. **Deploy** 클릭 (기본 코드로 먼저 배포)

#### Step 3: 코드 붙여넣기
1. 배포 완료 후 **Edit code** 클릭
2. 기본 코드를 모두 삭제
3. `cloudflare-worker/worker.js` 파일 내용을 전체 복사하여 붙여넣기
4. **Save and Deploy** 클릭

#### Step 4: 환경 변수 설정
1. Worker 설정 → **Settings** → **Variables** 탭
2. **Environment Variables** 섹션에서 **Add variable** 클릭
3. 다음 변수 추가:

| 변수명 | 값 | 암호화 |
|--------|-----|--------|
| `GAS_WEBAPP_URL` | `https://script.google.com/macros/s/AKfycby1SnLYJmPQ9PU0JlEZC5rG3e9y9s6wMVrsPeG_gqgDBnK9FMkyVPb3v5V0DFI14ETZiA/exec` | ✅ Encrypt |
| `WEBHOOK_SECRET` | (선택) 원하는 시크릿 문자열 | ✅ Encrypt |

4. **Save and Deploy** 클릭

#### Step 5: Worker URL 확인
- 배포 후 Worker URL이 표시됩니다
- 형식: `https://mjmaps-telegram-proxy.{your-subdomain}.workers.dev`
- 이 URL을 메모해 둡니다

---

### 방법 2: Wrangler CLI (개발자용)

```bash
# 1. wrangler 설치
npm install -g wrangler

# 2. Cloudflare 로그인
wrangler login

# 3. 프로젝트 디렉토리로 이동
cd cloudflare-worker

# 4. 환경 변수 설정 (시크릿)
wrangler secret put GAS_WEBAPP_URL
# 프롬프트에 GAS URL 입력

wrangler secret put WEBHOOK_SECRET
# 프롬프트에 시크릿 토큰 입력 (선택)

# 5. 배포
wrangler deploy

# 6. 로그 확인 (실시간)
wrangler tail
```

---

## 🔗 Telegram 웹훅 URL 변경

### GAS에서 실행 (추천)

Apps Script 에디터에서 다음 함수를 실행합니다:

```javascript
// 1. 스크립트 속성에 Cloudflare Worker URL 설정
function setCloudflareProxyUrl() {
  PropertiesService.getScriptProperties().setProperty(
    'CLOUDFLARE_PROXY_URL',
    'https://mjmaps-telegram-proxy.YOUR-SUBDOMAIN.workers.dev'
  );
}

// 2. 웹훅을 Cloudflare Worker URL로 변경
// → setTelegramWebhookViaProxy() 함수 실행
```

### 수동 설정 (curl)

```bash
# 웹훅 URL을 Cloudflare Worker로 변경
curl -X POST "https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://mjmaps-telegram-proxy.YOUR-SUBDOMAIN.workers.dev",
    "max_connections": 5,
    "secret_token": "YOUR_WEBHOOK_SECRET"
  }'

# 웹훅 상태 확인
curl "https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getWebhookInfo"
```

---

## ✅ 동작 확인

### 1. Worker 헬스체크
브라우저에서 Worker URL 접속:
```
https://mjmaps-telegram-proxy.YOUR-SUBDOMAIN.workers.dev
```
응답:
```json
{
  "status": "ok",
  "service": "MJMAPS Telegram Webhook Proxy",
  "timestamp": "2026-02-12T...",
  "gas_url_configured": true
}
```

### 2. 웹훅 상태 확인
GAS에서 `checkTelegramWebhook()` 실행 후 로그 확인:
- `url`: Cloudflare Worker URL이어야 함
- `last_error_message`: 없어야 함 (또는 이전 에러)
- `pending_update_count`: 0이어야 함

### 3. 실제 테스트
1. Telegram 봇에 메시지 전송
2. GAS 실행 로그에서 `[doPost]` 로그 확인
3. 응답 지연 없이 즉시 처리되는지 확인

---

## 🔧 트러블슈팅

### Worker 로그 확인
```bash
# Wrangler CLI
wrangler tail

# 또는 Cloudflare 대시보드 → Workers → 해당 Worker → Logs
```

### 일반적인 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| Worker에서 500 에러 | GAS_WEBAPP_URL 미설정 | 환경 변수 확인 |
| Worker에서 401 에러 | WEBHOOK_SECRET 불일치 | 시크릿 토큰 확인 |
| GAS에 요청 안 도착 | GAS URL 잘못됨 | 배포 URL 재확인 |
| 여전히 지연 발생 | 웹훅 URL이 아직 GAS 직접 | `getWebhookInfo`로 URL 확인 |

### GAS 재배포 시 주의
- GAS를 새로 배포하면 URL이 변경될 수 있음
- 변경 시 Cloudflare Worker의 `GAS_WEBAPP_URL` 환경 변수도 업데이트 필요

---

## 📊 아키텍처

```
┌──────────┐     POST      ┌─────────────────┐    POST     ┌──────────┐
│ Telegram │ ──────────── → │ Cloudflare      │ ─────────→  │ GAS      │
│ Server   │ ← 200 OK ──── │ Worker (Proxy)  │ ← 302→200  │ WebApp   │
└──────────┘   (즉시)       └─────────────────┘  (비동기)    └──────────┘
                              │
                              ├─ 즉시 200 OK 반환
                              ├─ waitUntil()로 비동기 전달
                              ├─ 302 리다이렉트 자동 처리
                              └─ 최대 3회 재시도 (5xx 오류 시)
```

## 💰 비용

| 항목 | 무료 플랜 | 예상 사용량 |
|------|-----------|-------------|
| 요청 수 | 일 10만 건 | 일 수십~수백 건 |
| CPU 시간 | 요청당 10ms | 충분 |
| 대역폭 | 무제한 | - |

**결론: 무료 플랜으로 충분합니다.**
