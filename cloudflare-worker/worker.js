/**
 * Cloudflare Workers - Telegram Webhook Proxy for GAS
 * 
 * 문제: GAS(Google Apps Script) 웹앱은 POST 요청 시 항상 302 Moved Temporarily를 반환.
 *       Telegram 웹훅은 302를 에러로 처리하여 재시도 → 3~5분 지연 발생.
 * 
 * 해결: Cloudflare Worker가 프록시 역할:
 *   1. Telegram → Worker: 즉시 200 OK 반환 (Telegram 재시도 방지)
 *   2. Worker → GAS: waitUntil()로 비동기 전달 (302 리다이렉트 자동 처리)
 * 
 * 설정 방법:
 *   1. Cloudflare Workers 대시보드에서 새 Worker 생성
 *   2. 이 코드를 붙여넣기
 *   3. 환경 변수 GAS_WEBAPP_URL 설정 (GAS 배포 URL)
 *   4. 선택: 환경 변수 WEBHOOK_SECRET 설정 (보안 토큰)
 *   5. Telegram 웹훅 URL을 Worker URL로 변경
 * 
 * 환경 변수:
 *   - GAS_WEBAPP_URL: GAS 웹앱 배포 URL (필수)
 *     예: https://script.google.com/macros/s/AKfycby.../exec
 *   - WEBHOOK_SECRET: (선택) Telegram 웹훅 시크릿 토큰
 *     설정 시 X-Telegram-Bot-Api-Secret-Token 헤더 검증
 * 
 * @version 1.0.0
 * @date 2026-02-12
 */

export default {
    async fetch(request, env, ctx) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Bot-Api-Secret-Token',
                },
            });
        }

        // GET 요청: 헬스체크
        if (request.method === 'GET') {
            return new Response(JSON.stringify({
                status: 'ok',
                service: 'MJMAPS Telegram Webhook Proxy',
                timestamp: new Date().toISOString(),
                gas_url_configured: !!env.GAS_WEBAPP_URL,
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // POST 요청만 처리
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // GAS URL 확인
        const gasUrl = env.GAS_WEBAPP_URL;
        if (!gasUrl) {
            console.error('[PROXY] GAS_WEBAPP_URL 환경 변수가 설정되지 않았습니다.');
            return new Response(JSON.stringify({ error: 'Proxy not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // (선택) 시크릿 토큰 검증
        if (env.WEBHOOK_SECRET) {
            const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
            if (secretHeader !== env.WEBHOOK_SECRET) {
                console.warn('[PROXY] 시크릿 토큰 불일치:', secretHeader);
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        // 요청 본문 읽기
        let body;
        try {
            body = await request.text();
        } catch (e) {
            console.error('[PROXY] 요청 본문 읽기 실패:', e.message);
            return new Response(JSON.stringify({ error: 'Bad request' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 간단한 유효성 검사 (JSON 파싱 가능한지)
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (e) {
            console.error('[PROXY] JSON 파싱 실패:', body.substring(0, 200));
            return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 로깅 (update_id, 타입)
        const updateId = parsed.update_id || 'unknown';
        const updateType = parsed.message ? 'message' :
            parsed.callback_query ? 'callback_query' :
                parsed.edited_message ? 'edited_message' : 'other';
        console.log(`[PROXY] 수신: update_id=${updateId}, type=${updateType}`);

        // ★ 핵심: 즉시 200 OK 반환 + 비동기로 GAS에 전달
        // waitUntil()은 응답 반환 후에도 Worker가 GAS 호출을 완료할 때까지 유지
        ctx.waitUntil(forwardToGAS(gasUrl, body, updateId));

        // Telegram에 즉시 200 OK 반환 (재시도 방지)
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    },
};

/**
 * GAS 웹앱으로 요청을 전달합니다.
 * - GAS는 302 리다이렉트를 반환하므로 fetch()의 기본 redirect: 'follow'로 자동 처리
 * - 최대 3회 재시도 (네트워크 오류 시)
 * 
 * @param {string} gasUrl GAS 웹앱 URL
 * @param {string} body 원본 요청 본문 (JSON 문자열)
 * @param {string|number} updateId 텔레그램 update_id (로깅용)
 */
async function forwardToGAS(gasUrl, body, updateId) {
    const maxRetries = 3;
    const retryDelay = 1000; // 1초

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const startTime = Date.now();

            const response = await fetch(gasUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: body,
                // redirect: 'follow' 가 기본값 → GAS의 302를 자동으로 따라감
            });

            const elapsed = Date.now() - startTime;
            const responseText = await response.text();

            console.log(`[PROXY→GAS] update_id=${updateId}, attempt=${attempt}, status=${response.status}, elapsed=${elapsed}ms, response=${responseText.substring(0, 200)}`);

            // 성공 (2xx) 또는 GAS가 의도적으로 반환한 응답
            if (response.ok || response.status < 500) {
                return; // 완료
            }

            // 5xx 서버 오류: 재시도
            console.warn(`[PROXY→GAS] 서버 오류 (${response.status}), 재시도 ${attempt}/${maxRetries}`);

        } catch (error) {
            console.error(`[PROXY→GAS] 네트워크 오류 (attempt ${attempt}/${maxRetries}):`, error.message);
        }

        // 재시도 전 대기 (마지막 시도가 아닌 경우)
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
    }

    console.error(`[PROXY→GAS] update_id=${updateId} - 모든 재시도 실패`);
}
