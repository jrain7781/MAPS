function checkMemberStatus() {
    let log = [];
    try {
        log.push("=== Member Sheet Debug Info ===");
        log.push("Time: " + new Date().toString());

        // 1. Check Spreadsheet Access
        log.push("\n[1] Spreadsheet Access");
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        log.push("SS Name: " + ss.getName());

        // 2. Check Sheet Existence
        log.push("\n[2] Sheet Existence ('members')");
        const sheet = ss.getSheetByName(DB_MEMBERS_SHEET_NAME);
        if (!sheet) {
            log.push("ERROR: Sheet 'members' NOT found!");
            return log.join("\n");
        }
        log.push("Sheet found.");

        // 3. Check Dimensions
        const lastRow = sheet.getLastRow();
        const maxCols = sheet.getMaxColumns();
        log.push(`Last Row: ${lastRow}`);
        log.push(`Max Cols: ${maxCols}`);

        if (lastRow < 1) {
            log.push("Sheet is completely empty (no headers).");
            return log.join("\n");
        }

        // 4. Check Headers
        log.push("\n[3] Header Verification");
        const realHeaders = sheet.getRange(1, 1, 1, maxCols).getValues()[0].map(String);
        log.push("Real Headers (Top 5): " + realHeaders.slice(0, 5).join(", ") + "...");
        log.push("Expected Headers (Code): " + ITEM_MEMBER_HEADERS.slice(0, 5).join(", ") + "...");

        // Check for critical mismatches
        let mismatch = [];
        ITEM_MEMBER_HEADERS.forEach((h, i) => {
            if (i < realHeaders.length && realHeaders[i] !== h) {
                mismatch.push(`Index ${i}: Expected '${h}', Found '${realHeaders[i]}'`);
            }
        });

        if (mismatch.length > 0) {
            log.push("\nHeader Mismatches found (" + mismatch.length + "):");
            log.push(mismatch.slice(0, 5).join("\n"));
            if (mismatch.length > 5) log.push("...");
        } else {
            log.push("Headers match perfectly up to length " + ITEM_MEMBER_HEADERS.length);
        }

        // 5. Check Data Reading
        log.push("\n[4] Data Read Test (readAllMembersNew)");
        try {
            const data = readAllMembersNew();
            log.push(`Calls readAllMembersNew() success.`);
            log.push(`Returned Records: ${data.length}`);

            if (data.length > 0) {
                log.push("First Record Sample:");
                log.push(JSON.stringify(data[0]));
            } else {
                log.push("No data records found (returns empty array).");
            }
        } catch (e) {
            log.push("ERROR calling readAllMembersNew: " + e.toString());
        }

    } catch (e) {
        log.push("\nFATAL ERROR: " + e.toString() + "\n" + e.stack);
    }

    return log.join("\n");
}

function showDebugDialog() {
    const result = checkMemberStatus();
    const html = HtmlService.createHtmlOutput(`<pre style='font-size:11px; white-space:pre-wrap;'>${result}</pre>`)
        .setWidth(600)
        .setHeight(500);
    SpreadsheetApp.getUi().showModalDialog(html, 'Member Data Debug Report');
}

/**
 * 텔레그램 웹훅 주소 확인
 */
function getWebhookUrl() {
    const base = getWebAppBaseUrl_();
    Logger.log('=== 웹훅 주소 ===');
    Logger.log('Webhook URL: ' + base);
    return { webhookUrl: base };
}

/**
 * 텔레그램 웹훅 상태 확인
 */
function checkTelegramWebhook() {
    const botToken = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
        Logger.log('ERROR: TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
        return { error: 'TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.' };
    }

    const url = 'https://api.telegram.org/bot' + botToken + '/getWebhookInfo';
    try {
        const response = UrlFetchApp.fetch(url);
        const result = JSON.parse(response.getContentText());
        Logger.log('=== 텔레그램 웹훅 상태 ===');
        Logger.log(JSON.stringify(result, null, 2));
        return result;
    } catch (e) {
        Logger.log('ERROR: ' + e.message);
        return { error: e.message };
    }
}

/**
 * 웹훅 설정 및 상태 확인 종합
 */
function debugWebhookSetup() {
    const log = [];

    log.push('=== 텔레그램 웹훅 디버깅 ===');
    log.push('시각: ' + new Date().toString());
    log.push('');

    // 1. 웹훅 URL 확인
    log.push('[1] 현재 웹앱 URL:');
    const base = getWebAppBaseUrl_();
    log.push(base || '(없음)');
    log.push('');

    // 2. 토큰 확인
    const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    log.push('[2] TELEGRAM_BOT_TOKEN:');
    log.push(token ? '설정됨 (' + token.substring(0, 10) + '...)' : '설정 안 됨');
    log.push('');

    // 3. 웹훅 상태 확인
    log.push('[3] 텔레그램 웹훅 상태:');
    if (token) {
        try {
            const info = checkTelegramWebhook();
            if (info.result) {
                log.push('URL: ' + (info.result.url || '(설정 안 됨)'));
                log.push('Pending Updates: ' + (info.result.pending_update_count || 0));
                log.push('Last Error: ' + (info.result.last_error_message || '없음'));
                log.push('Last Error Date: ' + (info.result.last_error_date ? new Date(info.result.last_error_date * 1000) : '없음'));
            } else if (info.error) {
                log.push('ERROR: ' + info.error);
            }
        } catch (e) {
            log.push('ERROR: ' + e.message);
        }
    } else {
        log.push('토큰이 없어서 확인 불가');
    }

    const result = log.join('\n');
    Logger.log(result);
    return result;
}

/**
 * 웹훅 URL POST 접속 테스트 (302 오류 디버깅용)
 */
function testWebhookPost() {
    const url = getWebAppBaseUrl_();
    Logger.log('=== 웹훅 POST 테스트 ===');
    Logger.log('URL: ' + url);

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
                update_id: 999999999,
                callback_query: {
                    id: "test123",
                    from: { id: 123, username: "test" },
                    message: { chat: { id: 123 } },
                    data: "MJ|BID|123"
                }
            }),
            muteHttpExceptions: true,
            followRedirects: false
        });

        const code = response.getResponseCode();
        const content = response.getContentText();
        const headers = response.getHeaders();

        Logger.log('Status Code: ' + code);
        Logger.log('Response: ' + content);
        Logger.log('Location header: ' + (headers.Location || '없음'));

        return {
            statusCode: code,
            response: content,
            location: headers.Location,
            success: code === 200
        };
    } catch (err) {
        Logger.log('ERROR: ' + err.toString());
        return { success: false, error: err.toString() };
    }
}

/**
 * 텔레그램 Pending Updates 클리어
 */
function clearPendingUpdates() {
    const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    if (!token) { Logger.log('토큰 없음'); return; }
    try {
        // 웹훅 삭제 → pending 클리어 → 웹훅 재설정
        UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
        Logger.log('웹훅 삭제 및 pending updates 클리어 완료');

        // 웹훅 재설정
        Utilities.sleep(1000);
        const url = PropertiesService.getScriptProperties().getProperty('WEBAPP_BASE_URL') || '';
        if (url) {
            const resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify({ url: url }),
                muteHttpExceptions: true
            });
            Logger.log('웹훅 재설정 완료: ' + resp.getContentText());
        }
    } catch (e) {
        Logger.log('ERROR: ' + e.message);
    }
}

/**
 * ★ 텔레그램 웹훅 단계별 성능 진단 도구
 * Apps Script 에디터에서 실행하면 각 단계별 소요 시간을 측정합니다.
 * 실행 방법: Apps Script 에디터 → debugTelegramPerformance 선택 → 실행 → 로그 확인
 */
function debugTelegramPerformance() {
    var log = [];
    var t0 = Date.now();

    function lap(label) {
        var elapsed = Date.now() - t0;
        log.push('[' + elapsed + 'ms] ' + label);
        return elapsed;
    }

    log.push('=== 텔레그램 웹훅 성능 진단 ===');
    log.push('시작: ' + new Date().toString());
    log.push('');

    // 1단계: 스크립트 속성 읽기
    try {
        var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
        lap('1. 스크립트 속성 읽기 (BOT_TOKEN): ' + (token ? '있음' : '없음'));
    } catch (e) {
        lap('1. 스크립트 속성 읽기 실패: ' + e.message);
    }

    // 2단계: CacheService 접근
    try {
        var cache = CacheService.getScriptCache();
        cache.get('test_key');
        lap('2. CacheService 접근');
    } catch (e) {
        lap('2. CacheService 실패: ' + e.message);
    }

    // 3단계: SpreadsheetApp.openById
    var ss = null;
    try {
        ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        lap('3. SpreadsheetApp.openById (★ 핵심 병목)');
    } catch (e) {
        lap('3. SpreadsheetApp.openById 실패: ' + e.message);
    }

    // 4단계: items 시트 열기
    var itemsSheet = null;
    try {
        if (ss) {
            itemsSheet = ss.getSheetByName(DB_SHEET_NAME);
            lap('4. items 시트 열기: ' + (itemsSheet ? '성공' : '없음'));
        }
    } catch (e) {
        lap('4. items 시트 열기 실패: ' + e.message);
    }

    // 5단계: items 시트 TextFinder (첫 번째 아이템 검색)
    try {
        if (itemsSheet) {
            var lastRow = itemsSheet.getLastRow();
            lap('5a. items lastRow: ' + lastRow);
            if (lastRow >= 2) {
                var firstId = String(itemsSheet.getRange(2, 1).getValue()).trim();
                lap('5b. 첫 번째 item_id: ' + firstId);
                var finder = itemsSheet.getRange(2, 1, lastRow - 1, 1)
                    .createTextFinder(firstId).matchEntireCell(true);
                var match = finder.findNext();
                lap('5c. TextFinder 검색 완료: ' + (match ? '찾음' : '못찾음'));
                if (match) {
                    var vals = itemsSheet.getRange(match.getRow(), 1, 1, 9).getValues()[0];
                    lap('5d. 행 데이터 읽기 완료');
                }
            }
        }
    } catch (e) {
        lap('5. TextFinder 실패: ' + e.message);
    }

    // 6단계: telegram_requests 시트
    try {
        if (ss) {
            var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
            lap('6. telegram_requests 시트: ' + (reqSheet ? '있음 (rows: ' + reqSheet.getLastRow() + ')' : '없음'));
        }
    } catch (e) {
        lap('6. telegram_requests 시트 실패: ' + e.message);
    }

    // 7단계: Telegram API 호출 테스트 (sendMessage 없이 getMe만)
    try {
        var botToken = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
        if (botToken) {
            var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/getMe', { muteHttpExceptions: true });
            var code = resp.getResponseCode();
            lap('7. Telegram API (getMe): HTTP ' + code);
        } else {
            lap('7. Telegram API: 토큰 없음');
        }
    } catch (e) {
        lap('7. Telegram API 실패: ' + e.message);
    }

    // 8단계: members 시트 (전체 읽기 vs 단건 조회 비교)
    try {
        if (ss) {
            var memSheet = ss.getSheetByName(DB_MEMBERS_SHEET_NAME);
            if (memSheet) {
                var memLastRow = memSheet.getLastRow();
                lap('8a. members 시트 lastRow: ' + memLastRow);

                // 전체 읽기 시간
                var t1 = Date.now();
                if (memLastRow >= 2) {
                    var allData = memSheet.getRange(2, 1, memLastRow - 1, Math.min(memSheet.getMaxColumns(), 25)).getValues();
                    lap('8b. members 전체 읽기 (' + allData.length + '건): ' + (Date.now() - t1) + 'ms');
                }

                // 단건 조회 시간
                var t2 = Date.now();
                if (memLastRow >= 2) {
                    var firstMid = String(memSheet.getRange(2, 1).getValue()).trim();
                    var mFinder = memSheet.getRange(2, 1, memLastRow - 1, 1).createTextFinder(firstMid).matchEntireCell(true);
                    var mMatch = mFinder.findNext();
                    if (mMatch) {
                        memSheet.getRange(mMatch.getRow(), 1, 1, 25).getValues();
                    }
                    lap('8c. members 단건 조회: ' + (Date.now() - t2) + 'ms');
                }
            }
        }
    } catch (e) {
        lap('8. members 시트 실패: ' + e.message);
    }

    // 9단계: 웹훅 상태 확인
    try {
        var botToken2 = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
        if (botToken2) {
            var whResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken2 + '/getWebhookInfo', { muteHttpExceptions: true });
            var whInfo = JSON.parse(whResp.getContentText());
            if (whInfo.result) {
                lap('9. 웹훅 URL: ' + (whInfo.result.url || '없음'));
                log.push('   Pending Updates: ' + (whInfo.result.pending_update_count || 0));
                log.push('   Last Error: ' + (whInfo.result.last_error_message || '없음'));
                log.push('   Last Error Date: ' + (whInfo.result.last_error_date ? new Date(whInfo.result.last_error_date * 1000).toString() : '없음'));
                log.push('   Max Connections: ' + (whInfo.result.max_connections || 'default'));
            }
        }
    } catch (e) {
        lap('9. 웹훅 상태 확인 실패: ' + e.message);
    }

    var total = Date.now() - t0;
    log.push('');
    log.push('=== 총 소요 시간: ' + total + 'ms ===');
    log.push('');
    log.push('※ 이 시간이 30초 이상이면 GAS 실행 환경 자체가 느린 것입니다.');
    log.push('※ Pending Updates가 많으면 Telegram이 재시도를 반복하고 있는 것입니다.');
    log.push('※ Last Error가 있으면 웹훅 URL이 잘못되었거나 응답이 너무 느린 것입니다.');

    var result = log.join('\n');
    Logger.log(result);
    return result;
}

/**
 * ★ Telegram Pending Updates 강제 클리어 + 웹훅 재설정
 * 5분 지연의 원인이 Pending Updates 누적인 경우 이 함수를 실행합니다.
 */
function resetTelegramWebhookClean() {
    var log = [];
    var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    if (!token) { Logger.log('토큰 없음'); return '토큰 없음'; }

    // 1. 현재 상태 확인
    try {
        var info = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', { muteHttpExceptions: true });
        var parsed = JSON.parse(info.getContentText());
        log.push('현재 상태:');
        log.push('  URL: ' + (parsed.result ? parsed.result.url : '없음'));
        log.push('  Pending: ' + (parsed.result ? parsed.result.pending_update_count : 0));
        log.push('  Last Error: ' + (parsed.result ? (parsed.result.last_error_message || '없음') : '없음'));
    } catch (e) {
        log.push('상태 확인 실패: ' + e.message);
    }

    // 2. 웹훅 삭제 + pending 클리어
    try {
        UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
        log.push('웹훅 삭제 + pending 클리어 완료');
    } catch (e) {
        log.push('웹훅 삭제 실패: ' + e.message);
    }

    Utilities.sleep(2000);

    // 3. 웹훅 재설정 (프록시 URL이 있으면 프록시로, 없으면 GAS 직접)
    var proxyUrl = PropertiesService.getScriptProperties().getProperty('CLOUDFLARE_PROXY_URL') || '';
    var url = proxyUrl || (PropertiesService.getScriptProperties().getProperty('WEBAPP_BASE_URL') || '');
    var maxConn = proxyUrl ? 5 : 1; // 프록시는 동시 처리 가능
    if (url) {
        try {
            var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify({
                    url: url,
                    max_connections: maxConn
                }),
                muteHttpExceptions: true
            });
            log.push('웹훅 재설정: ' + resp.getContentText());
            log.push('  사용 URL: ' + url + (proxyUrl ? ' (Cloudflare 프록시)' : ' (GAS 직접)'));
        } catch (e) {
            log.push('웹훅 재설정 실패: ' + e.message);
        }
    } else {
        log.push('WEBAPP_BASE_URL 또는 CLOUDFLARE_PROXY_URL이 설정되지 않았습니다.');
    }

    // 4. 재설정 후 상태 확인
    Utilities.sleep(1000);
    try {
        var info2 = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', { muteHttpExceptions: true });
        var parsed2 = JSON.parse(info2.getContentText());
        log.push('재설정 후 상태:');
        log.push('  URL: ' + (parsed2.result ? parsed2.result.url : '없음'));
        log.push('  Pending: ' + (parsed2.result ? parsed2.result.pending_update_count : 0));
        log.push('  Max Connections: ' + (parsed2.result ? parsed2.result.max_connections : 'default'));
    } catch (e) {
        log.push('재설정 후 상태 확인 실패: ' + e.message);
    }

    var result = log.join('\n');
    Logger.log(result);
    return result;
}

/**
 * ★ Cloudflare Workers 프록시 상태 진단
 * - 프록시 URL 설정 여부
 * - 프록시 헬스체크
 * - 현재 웹훅 URL이 프록시인지 GAS 직접인지 확인
 * - telegram_requests 시트 건수 확인
 *
 * 실행: Apps Script 에디터 → debugCloudflareProxy 선택 → 실행 → 로그 확인
 */
function debugCloudflareProxy() {
    var log = [];
    var t0 = Date.now();

    log.push('=== Cloudflare Workers 프록시 진단 ===');
    log.push('시각: ' + new Date().toString());
    log.push('');

    // 1. 프록시 URL 설정 확인
    var proxyUrl = PropertiesService.getScriptProperties().getProperty('CLOUDFLARE_PROXY_URL') || '';
    log.push('[1] CLOUDFLARE_PROXY_URL: ' + (proxyUrl || '(미설정)'));

    // 2. GAS 웹앱 URL 확인
    var gasUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_BASE_URL') || '';
    log.push('[2] WEBAPP_BASE_URL: ' + (gasUrl || '(미설정)'));
    log.push('');

    // 3. 프록시 헬스체크
    if (proxyUrl) {
        log.push('[3] 프록시 헬스체크:');
        try {
            var hcResp = UrlFetchApp.fetch(proxyUrl, { muteHttpExceptions: true });
            var hcCode = hcResp.getResponseCode();
            var hcBody = hcResp.getContentText();
            log.push('  Status: ' + hcCode);
            log.push('  Response: ' + hcBody.substring(0, 300));
            if (hcCode === 200) {
                try {
                    var hcJson = JSON.parse(hcBody);
                    log.push('  gas_url_configured: ' + (hcJson.gas_url_configured ? '✅' : '❌'));
                } catch (e) { }
            }
        } catch (e) {
            log.push('  ERROR: ' + e.message);
        }
    } else {
        log.push('[3] 프록시 헬스체크: URL 미설정으로 건너뜀');
    }
    log.push('');

    // 4. 현재 웹훅 상태
    var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    if (token) {
        log.push('[4] 텔레그램 웹훅 상태:');
        try {
            var whResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo', { muteHttpExceptions: true });
            var whInfo = JSON.parse(whResp.getContentText());
            if (whInfo.result) {
                var whUrl = whInfo.result.url || '';
                log.push('  URL: ' + whUrl);
                log.push('  Pending Updates: ' + (whInfo.result.pending_update_count || 0));
                log.push('  Last Error: ' + (whInfo.result.last_error_message || '없음'));
                log.push('  Last Error Date: ' + (whInfo.result.last_error_date ? new Date(whInfo.result.last_error_date * 1000).toString() : '없음'));
                log.push('  Max Connections: ' + (whInfo.result.max_connections || 'default'));
                log.push('');

                // 프록시 vs 직접 연결 판별
                if (proxyUrl && whUrl.indexOf('workers.dev') >= 0) {
                    log.push('  ✅ 현재 Cloudflare 프록시를 통해 연결됨');
                } else if (whUrl.indexOf('script.google.com') >= 0) {
                    log.push('  ⚠️ 현재 GAS 직접 연결 (302 리다이렉트 문제 발생 가능)');
                    if (proxyUrl) {
                        log.push('  → setTelegramWebhookViaProxy() 실행으로 프록시 전환 권장');
                    } else {
                        log.push('  → 먼저 setCloudflareProxyUrl("https://...workers.dev") 실행 필요');
                    }
                } else {
                    log.push('  ℹ️ 알 수 없는 웹훅 URL');
                }
            }
        } catch (e) {
            log.push('  ERROR: ' + e.message);
        }
    } else {
        log.push('[4] 텔레그램 웹훅: 토큰 미설정');
    }
    log.push('');

    // 5. telegram_requests 시트 건수 확인
    log.push('[5] telegram_requests 시트 상태:');
    try {
        var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        var reqSheet = ss.getSheetByName(TELEGRAM_REQUESTS_SHEET_NAME);
        if (reqSheet) {
            var lastRow = reqSheet.getLastRow();
            log.push('  시트 존재: ✅');
            log.push('  전체 행 수: ' + lastRow + ' (헤더 포함)');
            log.push('  데이터 행 수: ' + Math.max(0, lastRow - 1));

            if (lastRow >= 2) {
                // 상태별 건수 집계
                var statusCol = reqSheet.getRange(2, 4, lastRow - 1, 1).getValues();
                var statusCount = {};
                for (var i = 0; i < statusCol.length; i++) {
                    var st = String(statusCol[i][0] || '').trim().toUpperCase() || 'EMPTY';
                    statusCount[st] = (statusCount[st] || 0) + 1;
                }
                log.push('  상태별 건수:');
                for (var key in statusCount) {
                    log.push('    ' + key + ': ' + statusCount[key] + '건');
                }

                // 최근 5건 표시
                var recentStart = Math.max(2, lastRow - 4);
                var recentRows = reqSheet.getRange(recentStart, 1, lastRow - recentStart + 1, 5).getValues();
                log.push('  최근 ' + recentRows.length + '건:');
                for (var j = 0; j < recentRows.length; j++) {
                    log.push('    [' + recentRows[j][0] + '] ' + recentRows[j][1] + ' | ' + recentRows[j][2] + ' | ' + recentRows[j][3]);
                }
            } else {
                log.push('  ⚠️ 데이터 없음 (헤더만 존재)');
            }
        } else {
            log.push('  시트 존재: ❌ (시트가 없습니다)');
            log.push('  → 텔레그램 입찰확정/취소 요청이 한 번도 없었거나 시트가 삭제됨');
        }
    } catch (e) {
        log.push('  ERROR: ' + e.message);
    }

    var elapsed = Date.now() - t0;
    log.push('');
    log.push('=== 진단 완료 (' + elapsed + 'ms) ===');

    var result = log.join('\n');
    Logger.log(result);
    return result;
}

function checkItemDataForTelegram() {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
    var tz = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');

    var debugRows = [];
    var passDate = 0;
    var passStatus = 0;
    var passMember = 0;
    var failMemberIds = [];

    for (var i = 0; i < data.length; i++) {
        var inDateRaw = data[i][1];
        var inDate;
        if (inDateRaw instanceof Date && !isNaN(inDateRaw.getTime())) {
            inDate = Utilities.formatDate(inDateRaw, tz, 'yyyyMMdd');
        } else {
            inDate = String(inDateRaw || '').replace(/\D/g, '');
            if (inDate.length === 6) inDate = '20' + inDate;
            else if (inDate.length > 8) inDate = inDate.substring(0, 8);
        }

        var bidState = String(data[i][11] || '').trim();
        var memberId = String(data[i][8] || '').trim();
        var mNameId = String(data[i][5] || '').trim();

        if (!inDate || inDate.length !== 8 || inDate < today) continue;
        passDate++;

        if (['추천', '입찰', '변경'].indexOf(bidState) === -1) continue;
        passStatus++;

        if (!memberId) {
            failMemberIds.push({ id: data[i][0], bidState: bidState, mNameId: mNameId, memberId: memberId });
            continue;
        }
        passMember++;

        debugRows.push({ id: data[i][0], inDate: inDate, bidState: bidState, memberId: memberId, mNameId: mNameId });
    }

    return JSON.stringify({
        total: data.length,
        today: today,
        passDate: passDate,
        passStatus: passStatus,
        passMember: passMember,
        failedMembers: failMemberIds.slice(0, 5),
        sample: debugRows.slice(0, 5)
    }, null, 2);
}
