/* 낙찰 카페등록 이미지 생성기 (물건캡쳐 ▸ 낙찰카페등록)
   - 입력(수동/추후 크롤)으로 낙찰 안내 카드 생성 → 이미지 복사/다운로드
   - 부동산 전화 자동 블러 · 매수인 이름 마스킹 · 수익 시나리오 자동계산
   자동 불러오기(옥션 크롤 + MAPS 조사내용)는 다음 단계에서 백엔드 연결. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function comma(n) { n = Math.round(num(n)); return n ? n.toLocaleString('ko-KR') : ''; }
  function man(v) { var n = Math.round(num(v)); if (n <= 0) return ''; var m = Math.round(n / 10000); var eok = Math.floor(m / 10000), rem = m % 10000; return eok > 0 ? (eok + '억' + (rem ? (comma(rem) + '만') : '')) : (comma(m) + '만'); }
  function manSigned(n) { n = Math.round(num(n)); if (n === 0) return '0'; return (n < 0 ? '−' : '+') + man(Math.abs(n)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function maskName(nm) { nm = String(nm || '').trim(); if (!nm) return ''; if (nm.length <= 1) return nm + '○'; return nm.charAt(0) + '○'.repeat(nm.length - 1); }
  // 조사내용 텍스트 → HTML, 전화번호 패턴 블러
  function blurPhones(text) {
    var t = esc(text);
    t = t.replace(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, function (m) { return '<span class="ncbl">' + m + '</span>'; });
    return t.replace(/\n/g, '<br>');
  }

  function buildCard(d) {
    var appr = num(d.appr), mn = num(d.min), bid = num(d.bid), sec = num(d.second);
    var pct = appr ? Math.round(bid / appr * 1000) / 10 : 0;
    var sale = num(d.sale), jeonse = num(d.jeonse), wolBo = num(d.wolBo), wol = num(d.wol);
    var saleGain = (sale && bid) ? (sale - bid) : 0;
    var jeonseGain = (jeonse && bid) ? (jeonse - bid) : 0;
    var realInv = (bid - wolBo) > 0 ? (bid - wolBo) : bid;
    var yld = (wol && realInv) ? Math.round(wol * 12 / realInv * 1000) / 10 : 0;
    var buyer = maskName(d.buyer);
    var css = '<style>'
      + '#nccard *{box-sizing:border-box;margin:0;padding:0;font-family:"Pretendard","맑은 고딕","Malgun Gothic",sans-serif;}'
      + '#nccard{width:640px;background:#fff;border-radius:16px;overflow:hidden;color:#0f172a;}'
      + '#nccard .ncbl{filter:blur(5px);background:#e5e7eb;border-radius:3px;}'
      + '#nccard .hero{background:linear-gradient(140deg,#0b1026,#312e81 55%,#4338ca);color:#fff;padding:26px 26px 24px;}'
      + '#nccard .hero .bd{display:inline-block;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#7c2d12;font-size:12px;font-weight:800;padding:4px 12px;border-radius:999px;letter-spacing:-.2px;box-shadow:0 2px 8px rgba(251,191,36,.35);}'
      + '#nccard .hero h1{font-size:26px;font-weight:900;line-height:1.32;margin:13px 0 6px;letter-spacing:-.5px;}'
      + '#nccard .hero h1 .y{color:#fbbf24;}'
      + '#nccard .hero .sub{font-size:13px;color:#c7d2fe;font-weight:600;line-height:1.5;}'
      + '#nccard .proof{padding:16px 24px 4px;border-top:1px solid #eef2f7;}'
      + '#nccard .proof .cap{font-size:11px;font-weight:800;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:6px;}'
      + '#nccard .proof .cap b{color:#dc2626;}'
      + '#nccard .proof img{width:100%;display:block;border-radius:10px;border:1px solid #e2e8f0;}'
      + '#nccard .sec{padding:18px 24px;border-top:1px solid #eef2f7;}'
      + '#nccard h2{font-size:17px;font-weight:900;color:#1e1b4b;margin-bottom:10px;}'
      + '#nccard .kv{display:flex;font-size:14px;padding:6px 0;border-bottom:1px solid #f1f5f9;}'
      + '#nccard .kv .k{width:96px;color:#64748b;font-weight:700;flex-shrink:0;}'
      + '#nccard .kv .v{font-weight:700;}'
      + '#nccard .hl{color:#dc2626;font-weight:900;}'
      + '#nccard .g3{display:flex;gap:10px;}'
      + '#nccard .sc{flex:1;border:2px solid #e2e8f0;border-radius:12px;padding:12px;text-align:center;}'
      + '#nccard .sc.a{border-color:#fcd34d;background:#fffbeb;} #nccard .sc.b{border-color:#6ee7b7;background:#ecfdf5;} #nccard .sc.c{border-color:#93c5fd;background:#eff6ff;}'
      + '#nccard .sc .t{font-size:12px;font-weight:900;} #nccard .sc.a .t{color:#b45309;} #nccard .sc.b .t{color:#047857;} #nccard .sc.c .t{color:#1d4ed8;}'
      + '#nccard .sc .n{font-size:19px;font-weight:900;margin-top:4px;} #nccard .sc.a .n{color:#b45309;} #nccard .sc.b .n{color:#047857;} #nccard .sc.c .n{color:#1d4ed8;}'
      + '#nccard .punch{margin-top:12px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border-radius:11px;padding:13px;text-align:center;font-weight:900;font-size:15px;}'
      + '#nccard .josa{font-size:13px;line-height:1.72;color:#1e293b;font-weight:500;}'
      + '#nccard .josa .li{display:flex;gap:8px;padding:3px 0;}'
      + '#nccard .josa .li .dot{color:#4338ca;font-weight:900;flex-shrink:0;}'
      + '#nccard .note{font-size:10.5px;color:#94a3b8;margin-top:8px;line-height:1.5;}'
      + '#nccard .win{margin:2px 0 0;background:linear-gradient(135deg,#dc2626,#f97316);color:#fff;border-radius:11px;padding:12px 14px;font-weight:900;font-size:14.5px;text-align:center;letter-spacing:-.3px;box-shadow:0 4px 14px rgba(220,38,38,.28);}'
      + '</style>';
    // 대표제목(어그로) — ncTitle 우선
    var heroTitle = String(d.title || '').trim()
      ? esc(d.title)
      : ('감정가의 <span class="y">' + (pct || '?') + '%</span>, <span class="y">' + (man(bid) || comma(bid)) + '원</span>에 낙찰 성공! 🎉');
    // 인사 — 이름(성 제외) 친근하게
    var full = String(d.member || '').trim();
    var given = full.length >= 2 ? full.slice(1) : (full || '회원');
    var grade = String(d.grade || '').trim();
    var eyebrow = '🏆 ' + esc(given) + ' 회원님' + (grade ? (' · ' + esc(grade)) : '') + ' 낙찰 성공';
    var h = css + '<div id="nccard">';
    // 주소 정리 — 대괄호 주석([선순위임차권/대항력/HUG…][대지권…]) 제거(리스크·스펙 노출 금지), 공백 정돈
    var cleanAddr = String(d.addr || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
    h += '<div class="hero"><span class="bd">' + eyebrow + '</span>'
      + '<h1>' + heroTitle + '</h1>'
      + '<div class="sub">' + esc(cleanAddr) + (d.date ? (' · 매각기일 ' + esc(d.date)) : '') + '</div></div>';
    // 증빙 이미지(옥션 매각결과 캡처) — 최상단 증빙
    if (String(d.imgUrl || '').trim()) {
      h += '<div class="proof"><div class="cap">📸 실제 낙찰 <b>증빙</b> · 옥션원 매각결과</div>'
        + '<img src="' + esc(d.imgUrl) + '" alt="낙찰 증빙"></div>';
    }
    h += '<div class="sec"><h2>📌 낙찰 요약</h2>'
      + (appr ? ('<div class="kv"><div class="k">감정가</div><div class="v">' + comma(appr) + '원</div></div>') : '')
      + (mn ? ('<div class="kv"><div class="k">최저가</div><div class="v">' + comma(mn) + '원</div></div>') : '')
      + '<div class="kv"><div class="k">낙찰가</div><div class="v"><span class="hl">' + comma(bid) + '원' + (pct ? (' (' + pct + '%)') : '') + '</span></div></div>'
      + (sec ? ('<div class="kv"><div class="k">차순위</div><div class="v">' + comma(sec) + '원 (차이 ' + man(bid - sec) + ')</div></div>') : '')
      + ((d.cnt || buyer) ? ('<div class="kv"><div class="k">입찰</div><div class="v">' + esc(d.cnt || '') + (d.cnt ? '명' : '') + (buyer ? (' · 매수인 ' + esc(buyer)) : '') + '</div></div>') : '')
      + (sec && (bid - sec) > 0 ? ('<div class="win">😮 차순위와 단 ' + man(bid - sec) + ' 차이 — 짜릿한 역전 낙찰!</div>')
          : (num(d.cnt) >= 3 ? ('<div class="win">🔥 ' + esc(d.cnt) + '명 경쟁을 뚫고 낙찰 성공!</div>') : ''))
      + '</div>';
    h += '<div class="sec"><h2>💰 수익 시나리오</h2><div class="g3">'
      + '<div class="sc a"><div class="t">① 매매 차익</div><div class="n">' + (sale ? manSigned(saleGain) : '–') + '</div></div>'
      + '<div class="sc b"><div class="t">② 전세 무피</div><div class="n">' + (jeonse ? manSigned(jeonseGain) : '–') + '</div></div>'
      + '<div class="sc c"><div class="t">③ 월세 수익률</div><div class="n">' + (yld ? (yld + '%') : '–') + '</div></div>'
      + '</div>'
      + (((jeonseGain > 0) || (yld >= 8)) ? '<div class="punch">전세만 놔도 투자금 회수, 월세 돌리면 두 자릿수 수익률 🚀</div>' : '')
      + '<div class="note">※ 취득세·수리비·명도비 등 별도, 시세·임대료·수익률은 조사 기반 추정치로 실제와 다를 수 있습니다.</div>'
      + '</div>';
    // 현장 조사 — 조사내용 원문 덤프 금지. 큐레이션 요약(ncSummary)만 노출.
    var summ = String(d.summary || '').trim();
    if (summ) {
      var lis = summ.split(/\r?\n/).map(function (ln) { return ln.replace(/^\s*[-·•*]\s*/, '').trim(); }).filter(function (x) { return x; });
      var body = lis.length
        ? lis.map(function (x) { return '<div class="li"><span class="dot">✓</span><span>' + blurPhones(esc(x)) + '</span></div>'; }).join('')
        : blurPhones(esc(summ));
      h += '<div class="sec"><h2>🔎 현장 조사 요약</h2><div class="josa">' + body + '</div>'
        + '<div class="note">현장 부동산 조사 기반 요약 · 연락처는 비공개 처리했습니다.</div></div>';
    }
    h += '</div>';
    return h;
  }

  var lastNode = null;
  function setStatus(s) { var e = $('ncStatus'); if (e) e.textContent = s; }

  function ncCard() { return document.querySelector('.mjcap-card[data-cap="nc"]'); }
  function mapsKey() { try { return localStorage.getItem('auction1_maps_admin_key') || ''; } catch (e) { return ''; } }
  function escA(s) { return esc(s).replace(/"/g, '&quot;'); }

  // ── 계정 UI (진행사항확인과 계정 공유 · 체크된 계정 전부 접속해 조사내용 확인) ──
  function ncLoadAccounts() {
    fetch('/api/imageup/accounts?which=nc').then(function (r) { return r.json(); })
      .then(function (j) { ncRenderAccounts(j.accounts || []); }).catch(function () {});
  }
  function ncRenderAccounts(accs) {
    var wrap = ncCard() && ncCard().querySelector('[data-role="nc-accounts"]'); if (!wrap) return;
    var h = '<div style="font-size:11px;color:#6b7280;margin-bottom:4px;font-weight:600">계정 목록 — 체크된 계정 전부 접속해 조사내용 확인 (진행사항확인과 공유·체크변경 자동저장)</div>';
    accs.forEach(function (a) { h += ncAccRowHtml(a); });
    h += '<span class="nc-acc-add" style="font-size:11px;color:#2563eb;cursor:pointer">+ 계정 추가</span>';
    wrap.innerHTML = h;
    wrap.querySelector('.nc-acc-add').addEventListener('click', function () {
      var d = document.createElement('div'); d.innerHTML = ncAccRowHtml({ id: '', pw: '', manager: '', enabled: true });
      wrap.insertBefore(d.firstChild, this);
    });
    if (!wrap.dataset.bound) {
      wrap.dataset.bound = '1';
      wrap.addEventListener('change', function (e) { if (e.target && e.target.classList.contains('nc-acc-en')) ncSaveAccounts(); });
    }
  }
  function ncAccRowHtml(a) {
    return '<div class="nc-acc-row" style="display:flex;gap:4px;align-items:center;margin-bottom:2px">'
      + '<input type="checkbox" class="nc-acc-en" ' + (a.enabled !== false ? 'checked' : '') + '>'
      + '<input type="text" class="nc-acc-id" placeholder="아이디" value="' + escA(a.id || '') + '" style="width:92px;padding:2px 4px">'
      + '<input type="text" class="nc-acc-pw" placeholder="비밀번호" value="' + escA(a.pw || '') + '" style="width:92px;padding:2px 4px">'
      + '<input type="text" class="nc-acc-mgr" placeholder="매니저" value="' + escA(a.manager || '') + '" style="width:70px;padding:2px 4px">'
      + '<span class="nc-acc-prog" style="font-size:11px;font-weight:600;margin-left:4px;white-space:nowrap"></span>'
      + '</div>';
  }
  // 계정 진행사항 표시 (id 매칭) — 06.nc.py NCACCT 마커로 갱신
  function ncSetAcctProg(id, state) {
    var wrap = ncCard() && ncCard().querySelector('[data-role="nc-accounts"]'); if (!wrap) return;
    var col = state.indexOf('✖') === 0 ? '#dc2626' : (state.indexOf('✔') === 0 ? '#16a34a' : '#2563eb');
    wrap.querySelectorAll('.nc-acc-row').forEach(function (r) {
      var idi = r.querySelector('.nc-acc-id'); var pr = r.querySelector('.nc-acc-prog');
      if (idi && pr && idi.value.trim() === id) { pr.textContent = state; pr.style.color = col; }
    });
  }
  function ncClearAcctProg() {
    var wrap = ncCard() && ncCard().querySelector('[data-role="nc-accounts"]'); if (!wrap) return;
    wrap.querySelectorAll('.nc-acc-prog').forEach(function (p) { p.textContent = ''; });
  }
  function ncCollectAccounts() {
    var wrap = ncCard() && ncCard().querySelector('[data-role="nc-accounts"]'); if (!wrap) return [];
    return Array.prototype.map.call(wrap.querySelectorAll('.nc-acc-row'), function (r) {
      return { id: r.querySelector('.nc-acc-id').value.trim(), pw: r.querySelector('.nc-acc-pw').value, manager: r.querySelector('.nc-acc-mgr').value.trim(), enabled: r.querySelector('.nc-acc-en').checked };
    }).filter(function (a) { return a.id; });
  }
  function ncSaveAccounts() {
    fetch('/api/imageup/accounts?which=nc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: ncCollectAccounts() }) }).catch(function () {});
  }

  // ── 불러오기: MAPS 3키 조회 → 체크 계정들로 옥션 크롤(cc와 동일 매칭) → 그리드 ──
  // 로컬 매니저 서버(localhost) 경로. 외부 유료 API 아님(비용 0).
  var ncRunId = null, ncOffset = 0, ncItems = [], ncCrawl = null, ncLinkedIdx = -1;
  // 모든 연동 데이터·그리드·미리보기·상세이미지 초기화 (keepSakun=true 면 사건번호 유지)
  function ncClearData(keepSakun) {
    if (ncRunId) { alert('실행 중입니다. 잠시 후 다시.'); return false; }
    ['ncTitle', 'ncMember', 'ncGrade', 'ncBuyer', 'ncDate', 'ncAppr', 'ncMin', 'ncBid', 'ncGongsi', 'ncCnt', 'ncSecond', 'ncAddr', 'ncSale', 'ncJeonse', 'ncWolBo', 'ncWol', 'ncHoga', 'ncJosa', 'ncSummary'].forEach(function (id) { var e = $(id); if (e) e.value = ''; });
    if (!keepSakun) { var s = $('ncSakun'); if (s) s.value = ''; }
    ncItems = []; ncCrawl = null; ncLinkedIdx = -1; lastNode = null;
    var pv = $('ncPreview'); if (pv) pv.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:34px 0">제목/본문 작업이 완료되면 여기에 카드가 표시됩니다.</div>';
    var cp = $('ncCopyBtn'), dn = $('ncDownBtn'); if (cp) cp.disabled = true; if (dn) dn.disabled = true;
    var jw = ncCard() && ncCard().querySelector('[data-role="nc-josa-accounts"]'); if (jw) jw.innerHTML = '';
    try { localStorage.removeItem('nc_state_v1'); } catch (e) {}   // 저장된 직전 자료도 삭제
    renderGrid(); ncShowDetailImg();
    return true;
  }

  // [📥불러오기] MAPS getItemsBySakun(3키+회원·입찰가) → 그리드 표시 (크롤 X)
  function ncLoad() {
    if (ncRunId) { alert('실행 중입니다. 잠시 후 다시.'); return; }
    var sakun = ($('ncSakun').value || '').trim();
    if (!sakun) { alert('사건번호를 입력하세요.'); return; }
    ncClearData(true);   // 불러오기 시 이전 데이터 모두 초기화 (사건번호 유지)
    var key = mapsKey();
    if (!key) { setStatus('MAPS 키 없음 — [▶실행]으로 옥션 크롤만 진행(회원/입찰가 없음)'); renderGrid(); return; }
    setStatus('MAPS 3키 조회 중…');
    var lb = $('ncLoadBtn'); if (lb) lb.disabled = true;
    fetch('/api/maps-gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, api_action: 'getItemsBySakun', sakun_no: sakun, include_past: true })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (lb) lb.disabled = false;
      ncItems = (j && j.success && j.items) ? j.items : [];
      var it0 = ncItems[0] || {};
      if (it0.court && $('ncDate') && !$('ncDate').value) $('ncDate').value = (it0.in_date || it0.bid_date || '');
      renderGrid();
      setStatus(ncItems.length ? ('불러오기 완료 — ' + ncItems.length + '건. [▶실행]으로 옥션 크롤·일치 확정') : 'MAPS에 이 사건 없음 — [▶실행]으로 크롤만 진행 가능');
      ncSaveState();
    }).catch(function (e) { if (lb) lb.disabled = false; setStatus('MAPS 조회 오류: ' + e); renderGrid(); });
  }

  // [▶실행] 체크 계정들로 옥션 크롤 → 3키 일치 확정 → 일치 시 자동 연동+미리보기
  function ncRun() {
    if (ncRunId) { alert('이미 실행 중입니다.'); return; }
    var sakun = ($('ncSakun').value || '').trim();
    if (!sakun) { alert('사건번호를 입력하세요.'); return; }
    var accs = ncCollectAccounts().filter(function (a) { return a.enabled; });
    if (!accs.length) { alert('체크된 계정이 없습니다. 계정을 체크하세요.'); return; }
    var it0 = ncItems[0] || {};
    var caseObj = { sakun_no: sakun, bid_date: (it0.in_date || it0.bid_date || ($('ncDate').value || '').trim() || ''), court: (it0.court || '') };
    ncCrawl = null; ncOffset = 0; ncLinkedIdx = -1;
    ncClearAcctProg();   // 계정 진행사항 초기화
    var rb = $('ncRunBtn'); if (rb) rb.disabled = true;
    var sb0 = $('ncStopBtn'); if (sb0) sb0.disabled = false;   // 실행 중 중지 가능
    setStatus('실행중… (체크 계정 ' + accs.length + '개 · 3키 일치 확정 → 매각결과+조사내용)');
    fetch('/api/imageup/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ which: 'nc', accounts: accs, cases: [caseObj], headless: !!($('ncHeadless') && $('ncHeadless').checked) })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { ncRunId = j.run_id; ncPoll(); }
      else { setStatus('시작 실패: ' + (j.error || '?')); if (rb) rb.disabled = false; var sb = $('ncStopBtn'); if (sb) sb.disabled = true; }
    }).catch(function (e) { setStatus('요청 오류: ' + e); if (rb) rb.disabled = false; var sb = $('ncStopBtn'); if (sb) sb.disabled = true; });
  }
  // 진행 중인 크롤 중지
  function ncStop() {
    if (!ncRunId) return;
    fetch('/api/imageup/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: ncRunId }) }).catch(function () {});
    ncRunId = null;
    var rb = $('ncRunBtn'), sb = $('ncStopBtn'); if (rb) rb.disabled = false; if (sb) sb.disabled = true;
    setStatus('⏹ 중지됨');
  }
  function ncPoll() {
    if (!ncRunId) return;
    fetch('/api/imageup/logs?run_id=' + encodeURIComponent(ncRunId) + '&offset=' + ncOffset)
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.lines && j.lines.length) {
          j.lines.forEach(function (line) {
            if (typeof line !== 'string') return;
            if (line.indexOf('NCACCT|') === 0) { try { var a = JSON.parse(line.slice(7)); if (a && a.id) ncSetAcctProg(a.id, a.state || ''); } catch (e) {} return; }
            if (line.indexOf('RESULT|') !== 0) return;
            try { var o = JSON.parse(line.slice(7)); if (o && o.ok) { ncCrawl = o; renderGrid(); } else if (o && !o.ok) { setStatus('⚠ ' + (o.err || '매칭 실패') + ' (사건번호/기일 확인)'); } } catch (e) {}
          });
          ncOffset += j.lines.length;
        }
        if (j.status === 'running') { setTimeout(ncPoll, 700); }
        else {
          ncRunId = null; var rb = $('ncRunBtn'); if (rb) rb.disabled = false;
          var sb = $('ncStopBtn'); if (sb) sb.disabled = true;
          renderGrid();
          if (ncCrawl) { ncAutoLink(); }   // ★ 일치 시 자동 연동 + 미리보기 생성
          else setStatus('실행 종료 — 결과 없음(사건번호/매각기일 확인)');
        }
      }).catch(function (e) { setStatus('polling 오류: ' + e); setTimeout(ncPoll, 1500); });
  }

  // ── cc식 결과 그리드 (✓3키매칭 · 입찰가 vs 매각가 색비교 · 매수인=회원이면 파랑) ──
  function keyCell(v, hit) { if (!v) return '<span style="color:#cbd5e1">·</span>'; var t = esc(v); if (hit === null || hit === undefined) return t; return (hit ? '<span style="color:#16a34a;font-weight:700">✓</span> ' : '<span style="color:#dc2626;font-weight:700">✗</span> ') + t; }
  function resBadge(cat) { var c = cat === '낙찰' ? '#2563eb' : (cat === '미입찰' ? '#dc2626' : (cat === '불가' ? '#111827' : '#6b7280')); return '<span style="background:' + c + ';color:#fff;padding:1px 7px;border-radius:9px;font-size:11px;font-weight:700">' + esc(cat) + '</span>'; }
  function renderGrid() {
    var box = $('ncGrid'); if (!box) return;
    var cr = ncCrawl, sakun = ($('ncSakun').value || '').trim();
    var items = ncItems.length ? ncItems : (cr ? [{ sakun_no: cr.sakun_no, court: cr.court, bid_date: cr.bid_date, m_name: cr.member, bidprice: cr.bidprice }] : []);
    if (!items.length) { box.innerHTML = '<div style="color:#9ca3af;padding:8px;border:1px dashed #e5e7eb;border-radius:8px">📥 불러오기 결과가 여기에 표시됩니다.</div>'; renderJosaAccounts(); return; }
    var rowsHtml = items.map(function (it, i) {
      var buyer = cr ? (cr.buyer || '') : '';
      var mNm = (it.m_name || '').trim();
      var isWin = !!(cr && buyer && mNm && mNm === buyer);
      // 결과: 회원 알 때만 낙찰/미입찰 판정. 회원 모르면 크롤 상태(매각/불가/진행)만 표시.
      var cat = !cr ? '…' : (mNm ? (isWin ? '낙찰' : '미입찰') : (cr.state_kind || '매각'));
      var mae = num(cr ? cr.bid : 0), bidp = num(it.bidprice);
      var maeCol = (mae && bidp) ? (mae < bidp ? '#dc2626' : (mae > bidp ? '#111827' : '#2563eb')) : '#111827';
      var isLinked = !!(cr && ncLinkedIdx === i);   // 자동 연동된 행 하이라이트
      var td = 'padding:3px 6px;white-space:nowrap;border-bottom:1px solid #f1f5f9' + (isLinked ? ';background:#ecfdf5' : '');
      return '<tr>'
        + '<td style="' + td + '">' + keyCell(it.in_date || it.bid_date || (cr && cr.date) || '', cr ? (cr.date_hit !== false) : null) + '</td>'
        + '<td style="' + td + '">' + keyCell(it.sakun_no || sakun, cr ? true : null) + '</td>'
        + '<td style="' + td + '">' + keyCell(it.court || (cr && cr.court) || '', cr ? (cr.court_hit !== false) : null) + '</td>'
        + '<td style="' + td + '">' + esc(it.m_name_id || '') + '</td>'
        + '<td style="' + td + '">' + esc(it.m_name || '') + (it.grade ? ' <span style="color:#7c3aed;font-size:11px">(' + esc(it.grade) + ')</span>' : '') + '</td>'
        + '<td style="' + td + ';color:' + (isWin ? '#2563eb' : '#111827') + ';font-weight:' + (isWin ? 700 : 400) + '">' + esc(buyer) + '</td>'
        + '<td style="' + td + ';text-align:right">' + (bidp ? comma(bidp) : '') + '</td>'
        + '<td style="' + td + ';text-align:right;color:' + maeCol + ';font-weight:700">' + (mae ? comma(mae) : '') + '</td>'
        + '<td style="' + td + ';text-align:center">' + (cr ? resBadge(cat) : '<span style="color:#cbd5e1">대기</span>') + '</td>'
        + '<td style="' + td + ';text-align:center">' + ((cr && cr.view_url) ? '<a href="' + escA(cr.view_url) + '" target="_blank" style="color:#2563eb;text-decoration:none">옥션원</a>' : '') + '</td>'
        + '</tr>';
    }).join('');
    var th = 'padding:4px 6px;white-space:nowrap;position:sticky;top:0';
    box.innerHTML = '<div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9;color:#334155">'
      + '<th style="' + th + '">입찰일자</th><th style="' + th + '">사건번호</th><th style="' + th + '">법원</th><th style="' + th + '">담당자</th><th style="' + th + '">회원</th><th style="' + th + '">매수인</th><th style="' + th + '">입찰가</th><th style="' + th + '">매각가</th><th style="' + th + '">결과</th><th style="' + th + '">옥션원</th>'
      + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    renderJosaAccounts();
  }
  function renderJosaAccounts() {
    var wrap = ncCard() && ncCard().querySelector('[data-role="nc-josa-accounts"]'); if (!wrap) return;
    var ja = (ncCrawl && ncCrawl.josa_accounts) || [];
    if (!ja.length) { wrap.innerHTML = ''; return; }
    var h = '<div style="font-size:11px;color:#374151;font-weight:600;margin-bottom:3px">조사내용 보유 계정 ' + ja.length + '개 — 체크한 계정만 조사내용에 취합 (기본 전체)</div>';
    ja.forEach(function (a, i) { h += '<label style="font-size:12px;margin-right:10px;cursor:pointer"><input type="checkbox" class="nc-josa-cb" data-i="' + i + '" checked> ' + esc(a.id) + ' (' + a.len + '자)</label>'; });
    wrap.innerHTML = h;
    wrap.querySelectorAll('.nc-josa-cb').forEach(function (cb) { cb.addEventListener('change', ncCombineJosa); });
    ncCombineJosa();   // 초기: 전체 체크 취합
  }
  // 체크된 계정들의 조사내용을 ncJosa 에 취합 (여러 계정이면 계정 라벨+구분선)
  function ncCombineJosa() {
    var ja = (ncCrawl && ncCrawl.josa_accounts) || []; if (!ja.length) return;
    var wrap = ncCard() && ncCard().querySelector('[data-role="nc-josa-accounts"]'); if (!wrap) return;
    var parts = [];
    wrap.querySelectorAll('.nc-josa-cb').forEach(function (cb) {
      if (cb.checked) { var a = ja[parseInt(cb.dataset.i, 10)]; if (a) parts.push((ja.length > 1 ? ('【조사자 계정: ' + a.id + '】\n') : '') + a.josa); }
    });
    $('ncJosa').value = parts.join('\n\n──────────\n\n');
    if (lastNode) generate(); else ncSaveState();   // 카드 있으면 갱신(저장 포함), 없으면 상태만 저장
  }
  // 일치 시 자동 연동 — 낙찰(회원==매수인) 행 우선, 없으면 첫 행 → 폼 채우고 미리보기 자동 생성
  function ncAutoLink() {
    var cr = ncCrawl; if (!cr) return;
    var idx = 0;
    for (var i = 0; i < ncItems.length; i++) {
      var m = String((ncItems[i] && ncItems[i].m_name) || '').trim();
      if (cr.buyer && m && m === cr.buyer) { idx = i; break; }
    }
    ncLinkedIdx = ncItems.length ? idx : -1;
    var it = ncItems[idx] || {};
    var ja = (cr.josa_accounts || []);
    renderGrid();   // 연동 행 하이라이트 + renderJosaAccounts→ncCombineJosa 가 ncJosa(체크계정 취합) 채움
    window.NakchalCafe.fill({   // autogen:false → 실행 시 데이터만 연동, 카드 미생성(제목/본문 작업 후 생성). josa 는 취합이 담당(미포함)
      autogen: false,
      sakun: cr.sakun_no || it.sakun_no || '',
      member: it.m_name || cr.member || '',
      grade: it.grade || '',                   // 회원등급(MAPS 연동)
      buyer: cr.buyer || '',
      date: cr.date || it.in_date || it.bid_date || '',
      bid: cr.bid || '',
      cnt: cr.cnt || '',
      addr: cr.addr || it.address || '',
      appr: it.gamjungga || cr.appr || '',     // MAPS 감정가 없으면 옥션 상세 크롤값
      min: it.lowest_price || '',
      second: cr.second || '',                 // 차순위금액(상세, 있을 때만)
      gongsi: cr.gongsi || ''                  // 공시지가(옥션 상세 연동)
    });
    ncShowDetailImg();   // 상세이미지 탭 이미지 갱신
    setStatus('✓ 일치 — 데이터 연동 완료 (제목/본문 작업 후 카드 생성)' + (ja.length ? (' · 조사내용 계정 ' + ja.length) : '') + (cr.key_match ? '' : ' (⚠법원키 확인)'));
    ncSaveState();
  }

  function _fv(id) { var e = $(id); return e ? e.value : ''; }
  function collect() {
    return {
      title: _fv('ncTitle'), sakun: $('ncSakun').value, member: $('ncMember').value, grade: _fv('ncGrade'), buyer: $('ncBuyer').value, date: $('ncDate').value,
      appr: $('ncAppr').value, min: $('ncMin').value, bid: $('ncBid').value, cnt: $('ncCnt').value, second: $('ncSecond').value,
      addr: $('ncAddr').value, gongsi: _fv('ncGongsi'), sale: $('ncSale').value, jeonse: $('ncJeonse').value, wolBo: $('ncWolBo').value, wol: $('ncWol').value, hoga: _fv('ncHoga'),
      josa: $('ncJosa').value, summary: _fv('ncSummary'), imgUrl: _ncImgUrl()
    };
  }
  // 증빙 이미지 URL(옥션 매각결과 캡처) — ncCrawl.screenshot_path 기반
  function _ncImgUrl() {
    var sp = (ncCrawl && ncCrawl.screenshot_path) || '';
    var fn = sp ? sp.replace(/\\/g, '/').split('/').pop() : '';
    return fn ? ('/api/nc-detail-image?f=' + encodeURIComponent(fn)) : '';
  }
  function generate() {
    var d = collect();
    if (!num(d.bid)) { alert('낙찰가를 입력하세요.'); return; }
    $('ncPreview').innerHTML = buildCard(d);
    lastNode = document.getElementById('nccard');
    $('ncCopyBtn').disabled = false; $('ncDownBtn').disabled = false;
    setStatus('생성됨');
    ncSaveState();
  }
  function toBlob(cb, err) {
    if (!lastNode) return;
    if (!window.htmlToImage) { alert('이미지 라이브러리 로드 안됨(인터넷 연결 확인)'); return; }
    window.htmlToImage.toBlob(lastNode, { pixelRatio: 2, backgroundColor: '#ffffff' }).then(cb).catch(function (e) { (err || alert)('이미지 처리 실패: ' + (e && e.message || e)); });
  }
  function dl(blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '낙찰안내_' + (($('ncSakun').value || 'card').replace(/[^0-9A-Za-z가-힣]/g, '')) + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  function copyImg() {
    toBlob(function (blob) {
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]).then(function () { setStatus('✓ 이미지 복사됨 — 카페에 붙여넣기(Ctrl+V)'); }, function () { dl(blob); setStatus('클립보드 미지원 → 다운로드함'); });
      } else { dl(blob); setStatus('클립보드 미지원 → 다운로드함'); }
    });
  }
  function download() { toBlob(function (blob) { dl(blob); setStatus('다운로드됨'); }); }

  // ── 좌측 탭 (연동데이터 | 스킬) + 스킬(SKILL.md) 편집기 ──
  var _ncSkillLoaded = false;
  function ncSkillStatus(s) { var e = $('ncSkillStatus'); if (e) e.textContent = s; }
  function ncSwitchLtTab(which) {
    var card = ncCard(); if (!card) return;
    card.querySelectorAll('.nc-lt-tab').forEach(function (b) {
      var on = b.dataset.lt === which;
      b.style.color = on ? '#2563eb' : '#94a3b8';
      b.style.borderBottomColor = on ? '#2563eb' : 'transparent';
    });
    card.querySelectorAll('.nc-lt-panel').forEach(function (p) { p.style.display = (p.dataset.ltp === which) ? '' : 'none'; });
    if (which === 'skill' && !_ncSkillLoaded) ncSkillLoad();
    if (which === 'detail') ncShowDetailImg();
  }
  function ncSkillLoad() {
    var ed = $('ncSkillEditor'); if (!ed) return;
    ncSkillStatus('불러오는 중…');
    fetch('/api/nc-skill').then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { ed.value = j.content || ''; _ncSkillLoaded = true; ncSkillStatus(j.exists ? '불러옴' : '파일 없음 — 저장 시 생성'); }
      else ncSkillStatus('로드 실패: ' + (j.error || '?'));
    }).catch(function (e) { ncSkillStatus('오류: ' + e); });
  }
  function ncSkillSave() {
    var ed = $('ncSkillEditor'); if (!ed) return;
    ncSkillStatus('저장 중…');
    fetch('/api/nc-skill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: ed.value }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        ncSkillStatus(j.ok ? ('✓ 저장됨 (' + j.bytes + 'B) · 다음 작업부터 즉시 반영') : ('저장 실패: ' + (j.error || '?')));
      }).catch(function (e) { ncSkillStatus('저장 오류: ' + e); });
  }

  // 클로드에게 붙여넣을 요청문 복사 (클로드가 이 매니저를 읽어 제목/본문 생성)
  function ncClaudeCopy() {
    var sakun = ($('ncSakun').value || '').trim();
    var txt = '낙찰카페등록 자료 만들어줘' + (sakun ? (' (사건번호 ' + sakun + ')') : '')
      + '\n— 크롤링 매니저(localhost:8765) 낙찰카페등록 탭의 연동데이터+조사내용을 읽고, [MAPS] 낙찰 카페글 스킬대로 어그로 제목/본문을 만들어 카드에 넣어줘.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        function () { setStatus('📋 클로드 요청문 복사됨 — 클로드 창에 Ctrl+V'); },
        function () { setStatus('복사 실패(클립보드 권한 확인)'); });
    } else { setStatus('클립보드 미지원'); }
  }
  function ncTitleCopy() {
    var t = ($('ncTitle').value || '').trim();
    if (!t) { setStatus('제목이 비어 있습니다'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { setStatus('📋 제목 복사됨'); }, function () {});
  }

  // 상세이미지 탭 — 옥션 상세 캡처(서버 report_shots) 표시
  function ncShowDetailImg() {
    var img = $('ncDetailImg'), empty = $('ncDetailImgEmpty'); if (!img) return;
    var sp = (ncCrawl && ncCrawl.screenshot_path) || '';
    var fn = sp ? sp.replace(/\\/g, '/').split('/').pop() : '';
    if (fn) {
      img.onerror = function () { img.style.display = 'none'; if (empty) { empty.style.display = ''; empty.textContent = '캡처 이미지를 불러오지 못했습니다.'; } };
      img.src = '/api/nc-detail-image?f=' + encodeURIComponent(fn) + '&t=' + Date.now();
      img.style.display = ''; if (empty) empty.style.display = 'none';
    } else { img.style.display = 'none'; if (empty) { empty.style.display = ''; empty.textContent = '[▶실행] 후 상세 캡처가 여기에 표시됩니다.'; } }
  }

  // ── 마지막 자료 저장/복원 (새로고침 후에도 조회) ──
  var NC_STATE_KEY = 'nc_state_v1';
  var _NC_FIELD_IDS = ['ncSakun', 'ncTitle', 'ncMember', 'ncGrade', 'ncBuyer', 'ncDate', 'ncAppr', 'ncMin', 'ncBid', 'ncGongsi', 'ncCnt', 'ncSecond', 'ncAddr', 'ncSale', 'ncJeonse', 'ncWolBo', 'ncWol', 'ncHoga', 'ncJosa', 'ncSummary'];
  function ncSaveState() {
    try {
      var f = {}; _NC_FIELD_IDS.forEach(function (id) { var e = $(id); if (e) f[id] = e.value; });
      localStorage.setItem(NC_STATE_KEY, JSON.stringify({ f: f, items: ncItems, crawl: ncCrawl, linkedIdx: ncLinkedIdx, ts: Date.now() }));
    } catch (e) {}
  }
  function ncRestoreState() {
    try {
      var s = JSON.parse(localStorage.getItem(NC_STATE_KEY) || 'null'); if (!s) return;
      ncItems = s.items || []; ncCrawl = s.crawl || null; ncLinkedIdx = (s.linkedIdx != null ? s.linkedIdx : -1);
      renderGrid(); ncShowDetailImg();                 // 그리드·상세이미지·조사계정 복원
      if (s.f) _NC_FIELD_IDS.forEach(function (id) { var e = $(id); if (e && s.f[id] != null) e.value = s.f[id]; });  // 폼(취합 josa 포함) 복원 — renderGrid 뒤에 덮어씀
      if (num($('ncBid').value)) generate();           // 카드 재생성
      setStatus('직전 자료 복원됨');
    } catch (e) {}
  }

  function init() {
    var lb = $('ncLoadBtn'); if (!lb) return;   // nc 탭 로드 확인
    lb.addEventListener('click', ncLoad);
    var rst = $('ncResetBtn'); if (rst) rst.addEventListener('click', function () { if (ncClearData(false)) setStatus('초기화됨'); });
    var c = $('ncCopyBtn'); if (c) c.addEventListener('click', copyImg);
    var dn = $('ncDownBtn'); if (dn) dn.addEventListener('click', download);
    var rb = $('ncRunBtn'); if (rb) rb.addEventListener('click', ncRun);
    var sb = $('ncStopBtn'); if (sb) sb.addEventListener('click', ncStop);
    var cd = ncCard();
    if (cd) cd.querySelectorAll('.nc-lt-tab').forEach(function (b) { b.addEventListener('click', function () { ncSwitchLtTab(b.dataset.lt); }); });
    var sr = $('ncSkillReload'); if (sr) sr.addEventListener('click', function () { _ncSkillLoaded = false; ncSkillLoad(); });
    var sv = $('ncSkillSave'); if (sv) sv.addEventListener('click', ncSkillSave);
    var cc2 = $('ncClaudeCopy'); if (cc2) cc2.addEventListener('click', ncClaudeCopy);
    var tc = $('ncTitleCopy'); if (tc) tc.addEventListener('click', ncTitleCopy);
    // 조사숨김 옵션 저장/복원
    var hd = $('ncHeadless');
    if (hd) { try { hd.checked = localStorage.getItem('nc_headless') === '1'; } catch (e) {} hd.addEventListener('change', function () { try { localStorage.setItem('nc_headless', hd.checked ? '1' : '0'); } catch (e) {} }); }
    // 생성 버튼 없음 → 폼 수정 시 자동 재생성(디바운스, 이미 낙찰가 있을 때만)
    var _regenT;
    ['ncTitle', 'ncMember', 'ncBuyer', 'ncDate', 'ncAppr', 'ncMin', 'ncBid', 'ncCnt', 'ncSecond', 'ncAddr', 'ncGongsi', 'ncSale', 'ncJeonse', 'ncWolBo', 'ncWol', 'ncJosa', 'ncSummary'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('input', function () { clearTimeout(_regenT); _regenT = setTimeout(function () { if (num($('ncBid').value)) generate(); else ncSaveState(); }, 500); });
    });
    // 가격 필드 — 포커스 벗어나면 3자리 콤마 포맷
    ['ncAppr', 'ncMin', 'ncBid', 'ncGongsi', 'ncSecond', 'ncSale', 'ncJeonse', 'ncWolBo', 'ncWol'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('blur', function () { if (String(el.value).trim()) el.value = comma(el.value); });
    });
    ncLoadAccounts();   // 계정 UI 로드 (진행사항확인과 공유)
    renderGrid();       // 빈 그리드 안내
    ncRestoreState();   // 직전 자료 복원 (새로고침 후에도 조회)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // 외부(진행사항 확인 탭 등)에서 낙찰건 데이터를 넘겨받아 폼 채우고 낙찰카페등록 탭으로 이동 + 생성
  // 예: window.NakchalCafe.fill({ sakun:'2024타경82847', bid:97999999, appr:235000000, buyer:'이현민', josa:'...' })
  window.NakchalCafe = {
    fill: function (d) {
      d = d || {};
      var map = { ncTitle: 'title', ncSakun: 'sakun', ncMember: 'member', ncGrade: 'grade', ncBuyer: 'buyer', ncDate: 'date', ncAppr: 'appr', ncMin: 'min', ncBid: 'bid', ncCnt: 'cnt', ncSecond: 'second', ncAddr: 'addr', ncGongsi: 'gongsi', ncSale: 'sale', ncJeonse: 'jeonse', ncWolBo: 'wolBo', ncWol: 'wol', ncHoga: 'hoga', ncJosa: 'josa' };
      var priceIds = { ncAppr: 1, ncMin: 1, ncBid: 1, ncGongsi: 1, ncSecond: 1, ncSale: 1, ncJeonse: 1, ncWolBo: 1, ncWol: 1 };
      Object.keys(map).forEach(function (id) { var el = $(id); if (el && d[map[id]] != null && d[map[id]] !== '') el.value = priceIds[id] ? comma(d[map[id]]) : d[map[id]]; });
      var btn = document.querySelector('.mjcap-subtab[data-subtab="nc"]'); if (btn) btn.click();
      if (d.autogen !== false && num($('ncBid').value)) generate();
      setStatus('진행사항 확인에서 넘어옴');
    }
  };
})();
