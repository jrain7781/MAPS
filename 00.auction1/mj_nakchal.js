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
      + '#nccard .hero{background:linear-gradient(135deg,#1e1b4b,#4338ca);color:#fff;padding:22px 24px;}'
      + '#nccard .hero .bd{display:inline-block;background:#fbbf24;color:#7c2d12;font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;}'
      + '#nccard .hero h1{font-size:25px;font-weight:900;line-height:1.3;margin:12px 0 4px;}'
      + '#nccard .hero h1 .y{color:#fbbf24;}'
      + '#nccard .hero .sub{font-size:13px;color:#c7d2fe;font-weight:600;}'
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
      + '#nccard .josa{font-size:12.5px;line-height:1.6;color:#334155;font-weight:500;}'
      + '#nccard .note{font-size:10.5px;color:#94a3b8;margin-top:8px;line-height:1.5;}'
      + '</style>';
    var h = css + '<div id="nccard">';
    h += '<div class="hero"><span class="bd">🏆 낙찰 성공 · ' + esc(d.sakun || '') + '</span>'
      + '<h1>' + esc(d.member || '회원') + ' 회원님, <span class="y">' + (man(bid) || comma(bid)) + '원</span> 낙찰 성공! 🎉</h1>'
      + '<div class="sub">' + esc(d.addr || '') + (d.date ? (' · 매각기일 ' + esc(d.date)) : '') + '</div></div>';
    h += '<div class="sec"><h2>📌 낙찰 요약</h2>'
      + (appr ? ('<div class="kv"><div class="k">감정가</div><div class="v">' + comma(appr) + '원</div></div>') : '')
      + (mn ? ('<div class="kv"><div class="k">최저가</div><div class="v">' + comma(mn) + '원</div></div>') : '')
      + '<div class="kv"><div class="k">낙찰가</div><div class="v"><span class="hl">' + comma(bid) + '원' + (pct ? (' (' + pct + '%)') : '') + '</span></div></div>'
      + (sec ? ('<div class="kv"><div class="k">차순위</div><div class="v">' + comma(sec) + '원 (차이 ' + man(bid - sec) + ')</div></div>') : '')
      + ((d.cnt || buyer) ? ('<div class="kv"><div class="k">입찰</div><div class="v">' + esc(d.cnt || '') + (d.cnt ? '명' : '') + (buyer ? (' · 매수인 ' + esc(buyer)) : '') + '</div></div>') : '')
      + '</div>';
    h += '<div class="sec"><h2>💰 수익 시나리오</h2><div class="g3">'
      + '<div class="sc a"><div class="t">① 매매 차익</div><div class="n">' + (sale ? manSigned(saleGain) : '–') + '</div></div>'
      + '<div class="sc b"><div class="t">② 전세 무피</div><div class="n">' + (jeonse ? manSigned(jeonseGain) : '–') + '</div></div>'
      + '<div class="sc c"><div class="t">③ 월세 수익률</div><div class="n">' + (yld ? (yld + '%') : '–') + '</div></div>'
      + '</div>'
      + (((jeonseGain > 0) || (yld >= 8)) ? '<div class="punch">전세만 놔도 투자금 회수, 월세 돌리면 두 자릿수 수익률 🚀</div>' : '')
      + '<div class="note">※ 취득세·수리비·명도비 등 별도, 시세·임대료·수익률은 조사 기반 추정치로 실제와 다를 수 있습니다.</div>'
      + '</div>';
    if (String(d.josa || '').trim()) {
      h += '<div class="sec"><h2>🔎 현장 조사 내용</h2><div class="josa">' + blurPhones(d.josa) + '</div>'
        + '<div class="note">부동산 전화번호는 블러 처리했습니다.</div></div>';
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
      + '</div>';
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
  // [📥불러오기] MAPS getItemsBySakun(3키+회원·입찰가) → 그리드 표시 (크롤 X)
  function ncLoad() {
    if (ncRunId) { alert('실행 중입니다. 잠시 후 다시.'); return; }
    var sakun = ($('ncSakun').value || '').trim();
    if (!sakun) { alert('사건번호를 입력하세요.'); return; }
    ncItems = []; ncCrawl = null; ncLinkedIdx = -1;
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
    var rb = $('ncRunBtn'); if (rb) rb.disabled = true;
    setStatus('실행중… (체크 계정 ' + accs.length + '개 · 3키 일치 확정 → 매각결과+조사내용)');
    fetch('/api/imageup/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ which: 'nc', accounts: accs, cases: [caseObj], headless: !!($('ncHeadless') && $('ncHeadless').checked) })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { ncRunId = j.run_id; ncPoll(); }
      else { setStatus('시작 실패: ' + (j.error || '?')); if (rb) rb.disabled = false; }
    }).catch(function (e) { setStatus('요청 오류: ' + e); if (rb) rb.disabled = false; });
  }
  function ncPoll() {
    if (!ncRunId) return;
    fetch('/api/imageup/logs?run_id=' + encodeURIComponent(ncRunId) + '&offset=' + ncOffset)
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.lines && j.lines.length) {
          j.lines.forEach(function (line) {
            if (typeof line !== 'string' || line.indexOf('RESULT|') !== 0) return;
            try { var o = JSON.parse(line.slice(7)); if (o && o.ok) { ncCrawl = o; renderGrid(); } else if (o && !o.ok) { setStatus('⚠ ' + (o.err || '매칭 실패') + ' (사건번호/기일 확인)'); } } catch (e) {}
          });
          ncOffset += j.lines.length;
        }
        if (j.status === 'running') { setTimeout(ncPoll, 700); }
        else {
          ncRunId = null; var rb = $('ncRunBtn'); if (rb) rb.disabled = false;
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
    var h = '<div style="font-size:11px;color:#374151;font-weight:600;margin-bottom:2px">조사내용 보유 계정 ' + ja.length + '개 — 카드에 쓸 계정 선택:</div>';
    ja.forEach(function (a, i) { h += '<label style="font-size:12px;margin-right:10px;cursor:pointer"><input type="radio" name="ncJosaAcc" value="' + i + '" ' + (i === 0 ? 'checked' : '') + '> ' + esc(a.id) + ' (' + a.len + '자)</label>'; });
    wrap.innerHTML = h;
    wrap.querySelectorAll('input[name=ncJosaAcc]').forEach(function (r) { r.addEventListener('change', function () { var a = ja[parseInt(r.value, 10)]; if (a) { $('ncJosa').value = a.josa; if (lastNode) generate(); } }); });
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
    var sel = ncCard() && ncCard().querySelector('input[name=ncJosaAcc]:checked');
    var josa = (sel && ja[parseInt(sel.value, 10)]) ? ja[parseInt(sel.value, 10)].josa : (cr.josa || '');
    renderGrid();   // 연동 행 하이라이트 반영
    window.NakchalCafe.fill({   // fill 이 num(bid) 있으면 미리보기 자동 생성
      sakun: cr.sakun_no || it.sakun_no || '',
      member: it.m_name || cr.member || '',
      buyer: cr.buyer || '',
      date: cr.date || it.in_date || it.bid_date || '',
      bid: cr.bid || '',
      cnt: cr.cnt || '',
      addr: cr.addr || it.address || '',
      appr: it.gamjungga || cr.appr || '',     // MAPS 감정가 없으면 옥션 상세 크롤값
      min: it.lowest_price || '',
      second: cr.second || '',                 // 차순위금액(상세, 있을 때만)
      josa: josa
    });
    setStatus('✓ 일치 — 자동 연동+미리보기 생성' + (ja.length ? (' · 조사내용 계정 ' + ja.length) : '') + (cr.key_match ? '' : ' (⚠법원키 확인)'));
  }

  function collect() {
    return {
      sakun: $('ncSakun').value, member: $('ncMember').value, buyer: $('ncBuyer').value, date: $('ncDate').value,
      appr: $('ncAppr').value, min: $('ncMin').value, bid: $('ncBid').value, cnt: $('ncCnt').value, second: $('ncSecond').value,
      addr: $('ncAddr').value, sale: $('ncSale').value, jeonse: $('ncJeonse').value, wolBo: $('ncWolBo').value, wol: $('ncWol').value,
      josa: $('ncJosa').value
    };
  }
  function generate() {
    var d = collect();
    if (!num(d.bid)) { alert('낙찰가를 입력하세요.'); return; }
    $('ncPreview').innerHTML = buildCard(d);
    lastNode = document.getElementById('nccard');
    $('ncCopyBtn').disabled = false; $('ncDownBtn').disabled = false;
    setStatus('생성됨');
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

  function init() {
    var g = $('ncGenBtn'); if (!g) return;
    g.addEventListener('click', generate);
    var c = $('ncCopyBtn'); if (c) c.addEventListener('click', copyImg);
    var dn = $('ncDownBtn'); if (dn) dn.addEventListener('click', download);
    var lb = $('ncLoadBtn'); if (lb) lb.addEventListener('click', ncLoad);
    var rb = $('ncRunBtn'); if (rb) rb.addEventListener('click', ncRun);
    var cd = ncCard();
    if (cd) cd.querySelectorAll('.nc-lt-tab').forEach(function (b) { b.addEventListener('click', function () { ncSwitchLtTab(b.dataset.lt); }); });
    var sr = $('ncSkillReload'); if (sr) sr.addEventListener('click', function () { _ncSkillLoaded = false; ncSkillLoad(); });
    var sv = $('ncSkillSave'); if (sv) sv.addEventListener('click', ncSkillSave);
    ncLoadAccounts();   // 계정 UI 로드 (진행사항확인과 공유)
    renderGrid();       // 빈 그리드 안내
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // 외부(진행사항 확인 탭 등)에서 낙찰건 데이터를 넘겨받아 폼 채우고 낙찰카페등록 탭으로 이동 + 생성
  // 예: window.NakchalCafe.fill({ sakun:'2024타경82847', bid:97999999, appr:235000000, buyer:'이현민', josa:'...' })
  window.NakchalCafe = {
    fill: function (d) {
      d = d || {};
      var map = { ncSakun: 'sakun', ncMember: 'member', ncBuyer: 'buyer', ncDate: 'date', ncAppr: 'appr', ncMin: 'min', ncBid: 'bid', ncCnt: 'cnt', ncSecond: 'second', ncAddr: 'addr', ncSale: 'sale', ncJeonse: 'jeonse', ncWolBo: 'wolBo', ncWol: 'wol', ncJosa: 'josa' };
      Object.keys(map).forEach(function (id) { var el = $(id); if (el && d[map[id]] != null && d[map[id]] !== '') el.value = d[map[id]]; });
      var btn = document.querySelector('.mjcap-subtab[data-subtab="nc"]'); if (btn) btn.click();
      if (d.autogen !== false && num($('ncBid').value)) generate();
      setStatus('진행사항 확인에서 넘어옴');
    }
  };
})();
