/* ===== MJ 매니저 - 탭 전환 / 물건캡쳐 / 폴더 브라우저 / 카카오 ===== */
(function(){
  'use strict';

  // ========== 탭 전환 ==========
  function switchTab(name) {
    document.querySelectorAll('.mjTab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.mj-tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== ('tab-' + name)));
    try { localStorage.setItem('mj_active_tab', name); } catch(e) {}
    // 탭 진입 시 초기화 hook
    if (name === 'capture') { initCaptureTabOnce(); }
    if (name === 'kakao') { refreshKakaoStatus(); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.mjTab');
    if (b) { switchTab(b.dataset.tab); }
  });

  // ========== 물건캡쳐 - 공통 ==========
  const CAP_SPEC = {
    i:  { script: '01.i.py',  title: '등록일 정렬',     hasLimit: true,  hasCases: false },
    d:  { script: '02.d.py',  title: '입찰일 정렬',     hasLimit: true,  hasCases: false },
    k:  { script: '03.k.py',  title: '건별 캡쳐',       hasLimit: false, hasCases: true  },
    cc: { script: '04.cc.py', title: '진행사항 확인',  hasLimit: false, hasCases: false, hasResults: true },
  };
  const runState = { i: null, d: null, k: null, cc: null }; // run_id
  const ccResults = []; // 진행사항 결과 누적 (실행마다 초기화)
  let ccCases = [];     // 📥 불러오기로 받은 case 객체 배열 (item_id/sakun_no/bid_date/court/bidprice/m_name)
  let ccSort = { key: '', dir: 1 }; // 결과표 정렬 상태
  let ccRunUnchecked = new Set();   // 실행 체크 해제된 행 키 (재렌더에도 보존)

  let captureInitDone = false;
  function initCaptureTabOnce() {
    if (captureInitDone) return;
    captureInitDone = true;
    // 각 카드 이벤트 바인딩
    Object.keys(CAP_SPEC).forEach(key => {
      const card = document.querySelector('.mjcap-card[data-cap="'+key+'"]');
      if (!card) return;
      card.querySelector('[data-act="run"]').addEventListener('click', () => runCapture(key));
      card.querySelector('[data-act="stop"]').addEventListener('click', () => stopCapture(key));
      card.querySelector('[data-act="reload-accounts"]').addEventListener('click', () => loadAccounts(key));
      card.querySelector('[data-act="save-accounts"]').addEventListener('click', () => saveAccounts(key));
      // 캡쳐 행수 localStorage 복원/저장
      const limitEl = card.querySelector('[data-role="limit"]');
      if (limitEl) {
        const stored = localStorage.getItem('mj_cap_limit_' + key);
        if (stored && Array.from(limitEl.options).some(o => o.value === stored)) {
          limitEl.value = stored;
        }
        limitEl.addEventListener('change', () => {
          try { localStorage.setItem('mj_cap_limit_' + key, limitEl.value); } catch(e) {}
        });
      }
      // 건별(k)/변경취소(cc) 카드의 파일 업로드 입력: 선택 시 텍스트 전체를 textarea에 자동 로드
      const fileEl = card.querySelector('[data-role="file"]');
      const casesEl = card.querySelector('[data-role="cases"]');
      if (fileEl && casesEl) {
        fileEl.addEventListener('change', () => {
          const f = fileEl.files && fileEl.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            let text = String(reader.result || '');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM 제거
            casesEl.value = text;
            const n = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length;
            log(key, '[파일 로드] ' + f.name + ' — ' + n + '줄', 'log-ok');
          };
          reader.onerror = () => log(key, '[파일 읽기 오류] ' + reader.error, 'log-err');
          reader.readAsText(f, 'utf-8');
          // 같은 파일 재선택해도 change 발생하도록 input value 초기화
          setTimeout(() => { try { fileEl.value = ''; } catch(_) {} }, 100);
        });
      }
      // cc(진행사항 확인) 전용: 날짜범위/즐겨찾기/상태 드롭다운
      if (key === 'cc') {
        const loadBtn = card.querySelector('[data-act="cc-load"]');
        if (loadBtn) loadBtn.addEventListener('click', loadProgressList);
        const clearBtn = card.querySelector('[data-act="cc-clear"]');
        if (clearBtn) clearBtn.addEventListener('click', clearCcList);
        const favSel = card.querySelector('[data-role="cc-fav"]');
        if (favSel) favSel.addEventListener('change', () => applyCcFav(favSel.value));
        const favMng = card.querySelector('[data-act="cc-fav-manage"]');
        if (favMng) favMng.addEventListener('click', openCcFav);
        const calBtn = card.querySelector('[data-act="cc-calendar-toggle"]');
        if (calBtn) calBtn.addEventListener('click', toggleCcCalendar);
        setCcDates(0, 0);          // 날짜 기본값 = 오늘~오늘
        renderCcFavSelect();       // 즐겨찾기 드롭다운 채우기
        renderCcStatusSelect();    // 상태값 드롭다운(기본 입찰)
        loadCcState();             // 저장된 매칭 자료 복원(localStorage)
      }
      loadAccounts(key);
    });
    // 서브탭 바인딩
    document.querySelectorAll('.mjcap-subtab').forEach(btn => {
      btn.addEventListener('click', () => switchCapSub(btn.dataset.subtab));
    });
    // 저장된 서브탭 복원
    try {
      const sub = localStorage.getItem('mj_capture_subtab');
      if (sub) switchCapSub(sub);
    } catch(e) {}
    initFolderBrowser();
  }

  function switchCapSub(key) {
    document.querySelectorAll('.mjcap-subtab').forEach(b =>
      b.classList.toggle('active', b.dataset.subtab === key));
    document.querySelectorAll('.mjcap-subpanel').forEach(p =>
      p.classList.toggle('hidden', p.dataset.subpanel !== key));
    // 진행사항 확인(cc) 탭에서는 구글드라이브 폴더브라우저/미리보기 숨김
    document.querySelectorAll('[data-hide-on-cc]').forEach(el =>
      el.classList.toggle('hidden', key === 'cc'));
    try { localStorage.setItem('mj_capture_subtab', key); } catch(e) {}
  }

  function $card(key) { return document.querySelector('.mjcap-card[data-cap="'+key+'"]'); }
  function $log(key) { return $card(key).querySelector('[data-role="log"]'); }
  function $status(key) { return $card(key).querySelector('[data-role="status"]'); }
  function setStatus(key, txt, cls) {
    const el = $status(key);
    el.textContent = txt;
    el.className = 'mjcap-status' + (cls ? ' ' + cls : '');
  }
  function setRunning(key, running) {
    const card = $card(key);
    card.querySelector('[data-act="run"]').disabled = running;
    card.querySelector('[data-act="stop"]').disabled = !running;
  }

  // ----- 계정 관리 -----
  function loadAccounts(key) {
    fetch('/api/imageup/accounts?which=' + key)
      .then(r => r.json())
      .then(j => renderAccounts(key, j.accounts || []))
      .catch(err => log(key, '[계정 로드 실패] ' + err, 'log-err'));
  }
  function renderAccounts(key, accounts) {
    const wrap = $card(key).querySelector('[data-role="accounts"]');
    wrap.innerHTML = '';
    const head = document.createElement('div');
    head.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;font-weight:600';
    head.textContent = '계정 목록 (체크된 계정만 실행 · 체크 변경 시 자동 저장)';
    wrap.appendChild(head);
    accounts.forEach((acc, idx) => addAccountRow(wrap, acc, idx));
    const addBtn = document.createElement('span');
    addBtn.className = 'mjcap-acc-add';
    addBtn.textContent = '+ 계정 추가';
    addBtn.addEventListener('click', () => addAccountRow(wrap, {id:'',pw:'',manager:'',enabled:true}));
    wrap.appendChild(addBtn);
    // 체크박스 변경시 자동 저장 (1회만 위임 바인딩)
    if (!wrap.dataset.autosaveBound) {
      wrap.dataset.autosaveBound = '1';
      wrap.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('acc-enabled')) {
          saveAccounts(key);
        }
      });
    }
  }
  function addAccountRow(wrap, acc, idx) {
    const row = document.createElement('div');
    row.className = 'mjcap-acc-row';
    row.innerHTML = `
      <input type="checkbox" class="acc-enabled" ${acc.enabled !== false ? 'checked' : ''}>
      <input type="text" class="acc-id" placeholder="아이디" value="${escapeAttr(acc.id||'')}">
      <input type="text" class="acc-pw" placeholder="비밀번호" value="${escapeAttr(acc.pw||'')}">
      <input type="text" class="acc-mgr" placeholder="매니저" value="${escapeAttr(acc.manager||'')}">
    `;
    wrap.insertBefore(row, wrap.querySelector('.mjcap-acc-add') || null);
  }
  function collectAccounts(key) {
    const rows = $card(key).querySelectorAll('.mjcap-acc-row');
    return Array.from(rows).map(r => ({
      id: r.querySelector('.acc-id').value.trim(),
      pw: r.querySelector('.acc-pw').value,
      manager: r.querySelector('.acc-mgr').value.trim(),
      enabled: r.querySelector('.acc-enabled').checked
    })).filter(a => a.id);
  }
  function saveAccounts(key) {
    const accounts = collectAccounts(key);
    fetch('/api/imageup/accounts?which=' + key, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({accounts})
    })
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          log(key, '[계정 저장됨] ' + accounts.length + '개 (다른 스크립트 동기화 완료)', 'log-ok');
          // 다른 카드들도 동기화된 값으로 재로드
          Object.keys(CAP_SPEC).forEach(k => { if (k !== key) loadAccounts(k); });
        } else {
          log(key, '[저장 실패] ' + (j.error || '?'), 'log-err');
        }
      })
      .catch(err => log(key, '[저장 오류] ' + err, 'log-err'));
  }

  // ----- 실행 -----
  function runCapture(key) {
    if (runState[key]) {
      log(key, '[이미 실행 중] 중지 후 다시 실행하세요', 'log-err');
      return;
    }
    const card = $card(key);
    const accounts = collectAccounts(key).filter(a => a.enabled);
    if (accounts.length === 0) { log(key, '[중단] 활성 계정 없음', 'log-err'); return; }
    const payload = { which: key, accounts };
    if (CAP_SPEC[key].hasLimit) {
      const limitEl = card.querySelector('[data-role="limit"]');
      payload.limit = parseInt(limitEl.value, 10) || 20;
    }
    if (CAP_SPEC[key].hasCases) {
      const casesEl = card.querySelector('[data-role="cases"]');
      const lines = (casesEl.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      payload.cases = lines;
    }
    // 진행사항 확인: 실행 체크된 건만 조회 (없으면 안내)
    if (key === 'cc') {
      if (!ccCases.length) { log('cc', '[중단] 먼저 "📥 불러오기" 로 MAPS 입찰건을 가져오세요.', 'log-err'); return; }
      const runCases = getCcRunChecked();
      if (!runCases.length) { log('cc', '[중단] 실행 체크된 건이 없습니다.', 'log-err'); return; }
      payload.cases = runCases;
    }
    $log(key).textContent = '';
    if (key === 'cc') { ccResults.length = 0; renderCcResults(); }
    log(key, '▶ ' + CAP_SPEC[key].script + ' 시작 (활성 계정 ' + accounts.length + '개)', 'log-ok');
    setStatus(key, '실행중', 'running');
    setRunning(key, true);
    fetch('/api/imageup/run', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    })
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          runState[key] = j.run_id;
          pollLogs(key, 0);
        } else {
          log(key, '[시작 실패] ' + (j.error || '?'), 'log-err');
          setStatus(key, '오류', 'error');
          setRunning(key, false);
        }
      })
      .catch(err => {
        log(key, '[요청 오류] ' + err, 'log-err');
        setStatus(key, '오류', 'error');
        setRunning(key, false);
      });
  }
  function stopCapture(key) {
    const rid = runState[key];
    if (!rid) return;
    fetch('/api/imageup/stop', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({run_id: rid})
    }).catch(()=>{});
    log(key, '⏹ 중지됨', 'log-err');
    // 즉시 클라이언트 상태 정리 (polling 도 다음 tick 에 자동 종료됨)
    runState[key] = null;
    setStatus(key, '중지', 'error');
    setRunning(key, false);
  }
  function pollLogs(key, offset) {
    const rid = runState[key];
    if (!rid) return;
    fetch('/api/imageup/logs?run_id=' + encodeURIComponent(rid) + '&offset=' + offset)
      .then(r => r.json())
      .then(j => {
        if (j.lines && j.lines.length) {
          j.lines.forEach(line => log(key, line));
          offset += j.lines.length;
        }
        if (j.status === 'running') {
          setTimeout(() => pollLogs(key, offset), 700);
        } else {
          const code = j.exit_code;
          if (code === 0) {
            setStatus(key, '완료', 'done'); log(key, '✅ 정상 종료 (exit ' + code + ')', 'log-ok');
            // 진행사항: 실행 완료 시 시트에 1회 저장(날짜 upsert) + 자동 보고
            if (key === 'cc') {
              pushCcToSheet();
              if (ccAutoReportOn()) sendCcReportAuto();
            }
          }
          else if (code === null || code === undefined) { setStatus(key, '중지', 'error'); log(key, '⏹ 중지됨', 'log-err'); }
          else { setStatus(key, '오류', 'error'); log(key, '❌ exit ' + code, 'log-err'); }
          setRunning(key, false);
          runState[key] = null;
        }
      })
      .catch(err => {
        log(key, '[로그 polling 오류] ' + err, 'log-err');
        setTimeout(() => pollLogs(key, offset), 2000);
      });
  }
  function log(key, line, cls) {
    // 'cc' 탭은 RESULT|{json} 라인을 가로채 결과표에 추가
    if (key === 'cc' && typeof line === 'string' && line.startsWith('RESULT|')) {
      try {
        const obj = JSON.parse(line.slice(7));
        ccResults.push(obj);
        renderCcResults();
        saveCcState();   // 매칭 결과 누적 저장
        return;
      } catch (e) { /* fallthrough → 일반 로그 */ }
    }
    const el = $log(key);
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = line + '\n';
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }

  // MAPS Admin Key (app.js 와 동일 localStorage 키 — ⚙ MAPS 연동 설정에서 저장됨)
  function getMapsAdminKeyMj() {
    try { return localStorage.getItem('auction1_maps_admin_key') || ''; } catch (e) { return ''; }
  }

  // 날짜 input 기본값 세팅 (offsetFrom/offsetTo = 오늘 기준 +일수)
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function setCcDates(offFrom, offTo) {
    const card = $card('cc'); if (!card) return;
    const f = card.querySelector('[data-role="cc-from"]'), t = card.querySelector('[data-role="cc-to"]');
    const df = new Date(); df.setDate(df.getDate() + offFrom);
    const dt = new Date(); dt.setDate(dt.getDate() + offTo);
    if (f) f.value = ymd(df);
    if (t) t.value = ymd(dt);
  }
  function ymdToYYMMDD(v) { const d = String(v || '').replace(/[^0-9]/g, ''); return d.length >= 8 ? d.slice(2, 8) : d.slice(-6); }

  // ===== 즐겨찾기 기간 (localStorage) =====
  const CC_FAV_KEY = 'mj_cc_fav_periods';
  const CC_FAV_DEFAULT = [{ name: '오늘', f: 0, t: 0 }, { name: '7일', f: 0, t: 7 }];
  function getCcFavs() {
    try { const v = JSON.parse(localStorage.getItem(CC_FAV_KEY) || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) {}
    return CC_FAV_DEFAULT.slice();
  }
  function saveCcFavs(arr) { try { localStorage.setItem(CC_FAV_KEY, JSON.stringify(arr)); } catch (e) {} }
  function renderCcFavSelect() {
    const sel = $card('cc')?.querySelector('[data-role="cc-fav"]'); if (!sel) return;
    const favs = getCcFavs();
    sel.innerHTML = '<option value="">즐겨찾기…</option>' +
      favs.map((p, i) => `<option value="${i}">${escapeHtml(p.name)} (오늘+${p.f}~+${p.t})</option>`).join('');
  }
  function applyCcFav(idx) {
    if (idx === '' || idx == null) return;
    const p = getCcFavs()[parseInt(idx, 10)]; if (!p) return;
    setCcDates(p.f, p.t);   // 날짜만 세팅 — 불러오기는 📥 버튼으로만
  }
  // ===== 매칭 자료 저장/복원 (localStorage — 재실행 안 하게) =====
  const CC_SAVE_KEY = 'mj_cc_saved';
  function saveCcState() {
    try { localStorage.setItem(CC_SAVE_KEY, JSON.stringify({ cases: ccCases, results: ccResults.slice(), ts: Date.now() })); } catch (e) {}
    saveCcByDate();              // 날짜별 누적 저장(로컬 캐시/오프라인 폴백)
    // 시트 영구저장은 매 건이 아니라 '실행 완료' 시 1회만 (pollLogs 종료 분기에서 pushCcToSheet)
  }

  // ===== MAPS 시트 영구 저장 (cc_daily) =====
  let ccSheetSummary = null;   // {date:{n,nak,miss,buga}} 캐시
  let _ccSheetTimer = null;
  function pushCcToSheetDebounced() {
    if (_ccSheetTimer) clearTimeout(_ccSheetTimer);
    _ccSheetTimer = setTimeout(pushCcToSheet, 1500);
  }
  function pushCcToSheet() {
    const apiKey = getMapsAdminKeyMj(); if (!apiKey) return;
    const rows = ccMergedRows().filter(r => bidToYMD(r.bid_date));
    if (!rows.length) return;
    const items = rows.map(r => ({
      date: bidToYMD(r.bid_date), item_id: r.item_id || '', sakun_no: r.sakun_no || '', court: r.court || '',
      bid_date: r.bid_date || '', m_name: r.m_name || '', m_name_id: r.m_name_id || '',
      m_name_id_disp: r.m_name_id_disp || '', m_name_id_color: r.m_name_id_color || '', mid_member_id: r.mid_member_id || '',
      bidprice: r.bidprice || '', maegak_price: r.maegak_price || '', buyer: r.buyer || '',
      state_kind: r.state_kind || '', status: r.status || '', category: ccCategory(r), is_buga: !!r.is_buga,
      detail: r.detail || '', view_url: r.view_url || '', screenshot_path: r.screenshot_path || '', stu_member: r.stu_member || ''
    }));
    fetch('/api/maps-gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_action: 'saveProgressMatches', items })
    }).then(r => r.json()).then(j => {
      if (j && j.success) { ccSheetSummary = null; log('cc', `💾 시트 저장 ${j.saved}건 (${(j.dates || []).join(',')})`, 'log-ok'); }
      else log('cc', `⚠ 시트 저장 실패: ${(j && (j.message || j.error)) || '?'}`, 'log-err');
    }).catch(err => log('cc', `⚠ 시트 저장 오류: ${err}`, 'log-err'));
  }
  function refreshCcSummary(cb) {
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { if (cb) cb(); return; }
    fetch('/api/maps-gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_action: 'getProgressMatchSummary' })
    }).then(r => r.json()).then(j => {
      if (j && j.success) ccSheetSummary = j.summary || {};
      if (cb) cb();
    }).catch(() => { if (cb) cb(); });
  }

  // ===== 날짜별 저장/달력 (localStorage — 이 브라우저 한정) =====
  const CC_BYDATE_KEY = 'mj_cc_saved_byDate';
  function bidToYMD(d6) {
    const s = String(d6 || '').replace(/[^0-9]/g, '');
    if (s.length === 6) return '20' + s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
    if (s.length === 8) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    return '';
  }
  function loadCcByDate() { try { return JSON.parse(localStorage.getItem(CC_BYDATE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeCcByDate(o) { try { localStorage.setItem(CC_BYDATE_KEY, JSON.stringify(o)); } catch (e) {} }
  // 현재 병합 데이터를 입찰일자별로 그룹핑해 저장 (해당 날짜만 갱신, 나머지 날짜 보존)
  function saveCcByDate() {
    try {
      const rows = ccMergedRows();
      if (!rows.length) return;
      const map = loadCcByDate();
      const groups = {};
      rows.forEach(r => { const ymd = bidToYMD(r.bid_date); if (!ymd) return; (groups[ymd] = groups[ymd] || []).push(r); });
      Object.keys(groups).forEach(ymd => { map[ymd] = { rows: groups[ymd], ts: Date.now() }; });
      writeCcByDate(map);
      const cont = $card('cc')?.querySelector('[data-role="cc-calendar"]');
      if (cont && cont.style.display !== 'none') renderCcCalendar(ccCalYM ? ccCalYM.y : null, ccCalYM ? ccCalYM.m : null);
    } catch (e) {}
  }
  // 특정 날짜의 저장 자료를 결과표로 복원 (시트 우선, 실패 시 로컬 폴백)
  function _applyRestoredRows(ymd, rows, src) {
    ccCases = rows.map(r => Object.assign({}, r));
    ccResults.length = 0;
    rows.forEach(r => { if (r.state_kind || r.status || r.is_buga) ccResults.push(Object.assign({}, r)); });
    ccSort = { key: '', dir: 1 }; ccRunUnchecked.clear();
    renderCcResults();
    const info = $card('cc')?.querySelector('[data-role="cc-loaded"]');
    if (info) info.textContent = `📅 ${ymd} 저장 자료 복원 ${rows.length}건 (${src})`;
  }
  function restoreCcDate(ymd) {
    const apiKey = getMapsAdminKeyMj();
    const fallback = () => {
      const e = loadCcByDate()[ymd];
      if (!e || !Array.isArray(e.rows) || !e.rows.length) { alert(ymd + ' 저장된 자료가 없습니다.'); return; }
      _applyRestoredRows(ymd, e.rows, '로컬');
    };
    if (!apiKey) { fallback(); return; }
    fetch('/api/maps-gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_action: 'getProgressMatchByDate', date: ymd })
    }).then(r => r.json()).then(j => {
      if (j && j.success && Array.isArray(j.rows) && j.rows.length) _applyRestoredRows(ymd, j.rows, '시트');
      else fallback();
    }).catch(() => fallback());
  }
  let ccCalYM = null;   // {y, m(0-based)}
  function toggleCcCalendar() {
    const cont = $card('cc')?.querySelector('[data-role="cc-calendar"]'); if (!cont) return;
    const show = (cont.style.display === 'none' || !cont.style.display);
    cont.style.display = show ? '' : 'none';
    if (show) {
      renderCcCalendar(ccCalYM ? ccCalYM.y : null, ccCalYM ? ccCalYM.m : null);
      refreshCcSummary(() => renderCcCalendar(ccCalYM.y, ccCalYM.m));   // 시트 집계로 갱신
    }
  }
  function renderCcCalendar(y, m) {
    const cont = $card('cc')?.querySelector('[data-role="cc-calendar"]'); if (!cont) return;
    if (y == null || m == null) { const t = new Date(); y = t.getFullYear(); m = t.getMonth(); }
    ccCalYM = { y, m };
    const map = loadCcByDate();
    const startDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cellInfo = (ymd) => {
      if (ccSheetSummary && ccSheetSummary[ymd]) { const s = ccSheetSummary[ymd]; return { n: s.n, nak: s.nak, miss: s.miss, buga: s.buga }; }
      const e = map[ymd]; if (!e || !Array.isArray(e.rows)) return null;
      const rows = e.rows, cat = (c) => rows.filter(r => ccCategory(r) === c).length;
      return { n: rows.length, nak: cat('낙찰'), miss: cat('미입찰'), buga: cat('불가') };
    };
    let h = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <button type="button" class="btn_box_sss btn_white" data-cal-nav="-1">‹</button>
      <b style="min-width:90px;text-align:center">${y}년 ${m + 1}월</b>
      <button type="button" class="btn_box_sss btn_white" data-cal-nav="1">›</button>
      <button type="button" class="btn_box_sss btn_white" data-cal-nav="today">오늘</button>
      <span style="font-size:11px;color:#9ca3af">날짜 클릭 → 그날 매칭 자료 복원</span></div>`;
    h += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">`;
    ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) =>
      h += `<div style="text-align:center;font-size:11px;font-weight:700;color:${i === 0 ? '#dc2626' : (i === 6 ? '#2563eb' : '#6b7280')}">${d}</div>`);
    for (let i = 0; i < startDow; i++) h += `<div></div>`;
    for (let d = 1; d <= days; d++) {
      const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const c = cellInfo(ymd);
      const base = 'min-height:46px;border:1px solid #e5e7eb;border-radius:6px;padding:3px;font-size:11px';
      if (c && c.n) {
        h += `<div data-cal-day="${ymd}" title="복원: ${ymd}" style="${base};cursor:pointer;background:#eff6ff;border-color:#bfdbfe">
          <div style="font-weight:700">${d} <span style="float:right;background:#2563eb;color:#fff;border-radius:8px;padding:0 5px;font-size:10px">${c.n}</span></div>
          <div style="margin-top:2px;line-height:1.3"><span style="color:#2563eb">낙${c.nak}</span> <span style="color:#dc2626">미${c.miss}</span> <span style="color:#111827">불${c.buga}</span></div>
        </div>`;
      } else {
        h += `<div style="${base};color:#9ca3af">${d}</div>`;
      }
    }
    h += `</div>`;
    cont.innerHTML = h;
    cont.querySelectorAll('[data-cal-nav]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.calNav;
      if (v === 'today') { renderCcCalendar(); return; }
      let mm = ccCalYM.m + parseInt(v, 10), yy = ccCalYM.y;
      if (mm < 0) { mm = 11; yy--; } if (mm > 11) { mm = 0; yy++; }
      renderCcCalendar(yy, mm);
    }));
    cont.querySelectorAll('[data-cal-day]').forEach(el => el.addEventListener('click', () => restoreCcDate(el.dataset.calDay)));
  }
  function loadCcState() {
    try {
      const s = JSON.parse(localStorage.getItem(CC_SAVE_KEY) || 'null');
      if (!s || (!Array.isArray(s.results) && !Array.isArray(s.cases))) return;
      ccCases = Array.isArray(s.cases) ? s.cases : [];
      ccResults.length = 0;
      (s.results || []).forEach(r => ccResults.push(r));
      renderCcResults();
      const info = $card('cc')?.querySelector('[data-role="cc-loaded"]');
      if (info && s.ts) info.textContent = '💾 저장된 매칭 자료 복원 (' + new Date(s.ts).toLocaleString() + ') · 다시 조회하려면 📥 불러오기 → ▶ 실행';
    } catch (e) {}
  }
  // 진행사항 리스트/결과 초기화
  function clearCcList() {
    ccCases = []; ccResults.length = 0; ccSort = { key: '', dir: 1 }; ccRunUnchecked.clear();
    try { localStorage.removeItem(CC_SAVE_KEY); } catch (e) {}
    renderCcResults();
    const info = $card('cc')?.querySelector('[data-role="cc-loaded"]');
    if (info) info.textContent = '기간 + 상태값 선택 → 📥 불러오기 → ▶ 실행';
  }
  // 상태값 다중 선택 (체크박스, 기본 입찰만 체크) — 아래 줄에 펼쳐서
  const CC_STATUSES = ['입찰', '추천', '상품', '검증', '미정', '폐기', '불가', '매각'];
  function renderCcStatusSelect() {
    const box = $card('cc')?.querySelector('[data-role="cc-status"]'); if (!box) return;
    box.innerHTML = CC_STATUSES.map(s =>
      `<label class="${s === '입찰' ? 'on' : ''}"><input type="checkbox" class="cc-st-cb" value="${s}"${s === '입찰' ? ' checked' : ''}> ${s}</label>`
    ).join('');
    box.querySelectorAll('.cc-st-cb').forEach(cb => cb.addEventListener('change', () => {
      cb.closest('label').classList.toggle('on', cb.checked);
    }));
  }
  function getCcStatuses() {
    const box = $card('cc')?.querySelector('[data-role="cc-status"]');
    if (!box) return [];
    return Array.from(box.querySelectorAll('.cc-st-cb:checked')).map(cb => cb.value);
  }

  // 즐겨찾기 관리 모달
  function openCcFav() { renderCcFavManage(); const m = document.getElementById('ccFavModal'); if (m) m.style.display = 'flex'; }
  function closeCcFav() { const m = document.getElementById('ccFavModal'); if (m) m.style.display = 'none'; }
  function renderCcFavManage() {
    const tbody = document.getElementById('ccFavTbody'); if (!tbody) return;
    const favs = getCcFavs();
    tbody.innerHTML = '<thead><tr><th>이름</th><th>오늘+시작</th><th>오늘+끝</th><th></th></tr></thead><tbody>' +
      favs.map((p, i) => `<tr><td>${escapeHtml(p.name)}</td><td>${p.f}</td><td>${p.t}</td>
        <td><button type="button" class="btn_box_sss btn_white" data-fav-del="${i}">삭제</button></td></tr>`).join('') +
      '</tbody>';
    tbody.querySelectorAll('[data-fav-del]').forEach(b => b.addEventListener('click', () => deleteCcFav(parseInt(b.dataset.favDel, 10))));
  }
  function addCcFav() {
    const name = (document.getElementById('ccFavName')?.value || '').trim();
    const f = parseInt(document.getElementById('ccFavFrom')?.value, 10);
    const t = parseInt(document.getElementById('ccFavTo')?.value, 10);
    if (!name) { alert('이름을 입력하세요.'); return; }
    if (isNaN(f) || isNaN(t)) { alert('오프셋(숫자)을 입력하세요.'); return; }
    const favs = getCcFavs(); favs.push({ name, f, t }); saveCcFavs(favs);
    document.getElementById('ccFavName').value = '';
    renderCcFavManage(); renderCcFavSelect();
  }
  function deleteCcFav(i) {
    const favs = getCcFavs(); favs.splice(i, 1); saveCcFavs(favs);
    renderCcFavManage(); renderCcFavSelect();
  }

  // 진행사항 확인 → MAPS 입찰건 불러오기 (날짜범위 FROM~TO, 기본 오늘~오늘)
  function loadProgressList() {
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { alert('MAPS Admin Key 미설정 — 상단 ⚙(MAPS 연동) 설정에서 키를 먼저 저장하세요.'); return; }
    const card = $card('cc'); if (!card) return;
    const from6 = ymdToYYMMDD(card.querySelector('[data-role="cc-from"]')?.value);
    const to6 = ymdToYYMMDD(card.querySelector('[data-role="cc-to"]')?.value);
    const statuses = getCcStatuses();
    const btn = card.querySelector('[data-act="cc-load"]');
    if (btn) btn.disabled = true;
    log('cc', `📥 MAPS 입찰건 불러오는 중... (${from6}~${to6}, 상태 ${statuses.join('/') || '전체'})`, 'log-ok');
    fetch('/api/maps-gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_action: 'getProgressList', from: from6, to: to6, statuses: statuses })
    }).then(r => r.json()).then(j => {
      if (btn) btn.disabled = false;
      if (j && j.success && Array.isArray(j.cases)) {
        ccCases = j.cases;
        ccResults.length = 0; ccSort = { key: '', dir: 1 }; ccRunUnchecked.clear(); renderCcResults();   // 불러온 리스트 즉시 표시(실행 전)
        saveCcState();   // 불러온 리스트 저장
        const now = new Date();
        const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
        const info = card.querySelector('[data-role="cc-loaded"]');
        if (info) info.textContent = `불러옴 ${ccCases.length}건 (${from6}~${to6}) · 불러온 시각 ${hhmmss} — ▶ 실행으로 옥션 조회`;
        log('cc', `✅ ${ccCases.length}건 불러옴 (${from6}~${to6})`, 'log-ok');
        if (ccCases.length === 0) alert('해당 기간 입찰 건이 없습니다.');
      } else {
        const msg = (j && (j.message || j.error)) || '알 수 없음';
        log('cc', `❌ 불러오기 실패: ${msg}`, 'log-err');
        alert('실패: ' + msg);
      }
    }).catch(err => {
      if (btn) btn.disabled = false;
      log('cc', `❌ 불러오기 오류: ${err}`, 'log-err');
      alert('오류: ' + err);
    });
  }

  // 항목별 일치 표시: ✓(초록)/✗(빨강) + 값
  function ccKeyCell(value, hit) {
    const mark = hit
      ? '<span class="cc-hit ok">✓</span>'
      : '<span class="cc-hit no">✗</span>';
    return `${mark} ${escapeHtml(value || '')}`;
  }

  function fmtWon(v) {
    const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? '' : n.toLocaleString('ko-KR');
  }
  function ccStateKind(r) { return String(r.state_kind || r.status || '').trim() || (r.status === '조회없음' ? '조회없음' : '진행중'); }

  const _won = (v) => parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0;
  function ccKeyOf(o) { return (o && o.item_id && String(o.item_id)) || (String(o.sakun_no || '') + '|' + String(o.bid_date || '') + '|' + String(o.court || '')); }
  // 불러온 리스트(ccCases) + 옥션 결과(ccResults) 병합 — 실행 전엔 리스트만, 실행 후 결과 채움
  function ccMergedRows() {
    const byKey = {}; ccResults.forEach(r => { byKey[ccKeyOf(r)] = r; });
    const base = ccCases.length ? ccCases : ccResults;
    return base.map(c => { const r = byKey[ccKeyOf(c)]; return Object.assign({ _pending: !r }, c, r || {}); });
  }
  // 실행 체크된 행의 케이스만 반환 (ccRunUnchecked 에 없는 = 체크된 것)
  function getCcRunChecked() {
    return ccMergedRows().filter(m => !ccRunUnchecked.has(ccKeyOf(m)));
  }
  // 헤더 클릭 정렬 (병합 기준 base=ccCases 정렬)
  function sortCc(key) {
    if (ccSort.key === key) ccSort.dir = -ccSort.dir; else { ccSort.key = key; ccSort.dir = 1; }
    const byKey = {}; ccResults.forEach(r => { byKey[ccKeyOf(r)] = r; });
    const m = (c) => Object.assign({}, c, byKey[ccKeyOf(c)] || {});
    const val = (c0) => { const r = m(c0); switch (key) {
      case 'bid_date': return String(r.bid_date || '');
      case 'sakun_no': return String(r.sakun_no || '');
      case 'court': return String(r.court || '');
      case 'm_name': return String(r.m_name || '');
      case 'mid': return String(r.m_name_id_disp || r.m_name_id || '');
      case 'buyer': return String(r.buyer || '');
      case 'bidprice': return _won(r.bidprice);
      case 'maegak': return _won(r.maegak_price);
      case 'stu': return String(r.stu_member || '');
      case 'result': return ccStateKind(r);
      default: return ''; } };
    const base = ccCases.length ? ccCases : ccResults;
    base.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * ccSort.dir; });
    renderCcResults();
  }

  // 진행사항 결과 테이블 — 불러오면 즉시 리스트 표시, 실행 시 결과 채움.
  // 3키 ✓/✗ + 회원·매수인·입찰가·매각가(일치 파랑/불일치 빨강) + 결과·상세·현재상태·업데이트예정.
  function renderCcResults() {
    const wrap = $card('cc')?.querySelector('[data-role="cc-results"]');
    if (!wrap) return;
    const merged = ccMergedRows();
    if (merged.length === 0) { wrap.innerHTML = ''; return; }
    const arrow = (k) => ccSort.key === k ? (ccSort.dir > 0 ? ' ▲' : ' ▼') : '';
    const rows = merged.map((r, i) => {
      const pending = !!r._pending;
      const isBuga = !!r.is_buga;
      const stateKind = pending ? '대기' : ccStateKind(r);
      const cat = pending ? '' : ccCategory(r);
      // 실행 전(pending)엔 ✓/✗ 대신 무표시
      const keyCell = (v, hit) => pending ? escapeHtml(v || '') : ccKeyCell(v, hit);
      // 결과 라벨: 낙찰(파랑)/미입찰(빨강)/패찰=매각가>입찰가(회색)/확인불가/불가. 그 외=진행중·조회없음·매각
      const _catStyle = { '낙찰': 'background:#2563eb;color:#fff', '미입찰': 'background:#dc2626;color:#fff', '일반': 'background:#6b7280;color:#fff', '확인불가': 'background:#9ca3af;color:#fff', '불가': 'background:#111827;color:#fff' };
      const _catLabel = { '낙찰': '낙찰', '미입찰': '미입찰', '일반': '패찰', '확인불가': '확인불가', '불가': '불가' };
      const resBadge = (!pending && _catStyle[cat])
        ? `<span style="${_catStyle[cat]};padding:1px 8px;border-radius:4px;font-weight:700;font-size:12px">${_catLabel[cat]}</span>`
        : `<span class="cc-badge ${pending ? 'cc-pend' : (stateKind === '조회없음' || stateKind === '오류' ? 'cc-warn' : 'cc-ok')}">${escapeHtml(stateKind)}</span>`;
      const dtl = String(r.detail || '');
      const detail = dtl ? `<span title="${escapeAttr(dtl)}">${escapeHtml(dtl.length > 20 ? dtl.slice(0, 20) + '…' : dtl)}</span>` : '';
      const url = r.view_url ? ` <a href="#" class="cc-link" data-act="cc-view" data-url="${escapeAttr(r.view_url)}">옥션원</a>` : '';
      // 업데이트 예정 = 결과 카테고리 라벨 (패찰=매각가>입찰가, 진행중과 구분). 불가는 MAPS 반영 대상
      const willUpdate = (!pending && _catStyle[cat])
        ? `<span style="${_catStyle[cat]};padding:1px 8px;border-radius:4px;font-weight:700">${_catLabel[cat]}</span>`
        : '<span style="color:#9ca3af">-</span>';
      // 매각가 색: 매각가<입찰가=빨강, 매각가>입찰가=검정, 같으면 파랑
      const bid = _won(r.bidprice), mae = _won(r.maegak_price);
      let maeCell = mae ? fmtWon(r.maegak_price) : '';
      if (mae && bid) {
        const col = mae < bid ? '#dc2626' : (mae > bid ? '#111827' : '#2563eb');
        maeCell = `<b style="color:${col}">${fmtWon(r.maegak_price)}</b>`;
      }
      const stu = String(r.stu_member || '');
      // 매수인: 회원이름과 같으면(=우리 회원 낙찰) 파란색
      const mNm = String(r.m_name || '').trim(), buyer = String(r.buyer || '').trim();
      const buyerCell = buyer ? `<span${(mNm && mNm === buyer) ? ' style="color:#2563eb;font-weight:700"' : ''}>${escapeHtml(buyer)}</span>` : '';
      // 담당자: teacher_color 적용(닉네임 표시)
      const midDisp = String(r.m_name_id_disp || r.m_name_id || '');
      const midCol = String(r.m_name_id_color || '');
      const midCell = midDisp ? (midCol ? `<b style="color:${midCol}">${escapeHtml(midDisp)}</b>` : escapeHtml(midDisp)) : '';
      // 비고: 불가 사유(변경=빨강) + 상세값. (물건상태는 업데이트예정 칸, 사유/상세는 여기)
      const noteReason = isBuga ? String(r.status || '') : '';
      const noteDetail = isBuga ? String(r.detail || '') : '';
      const noteCell = (noteReason || noteDetail)
        ? `<span title="${escapeAttr([noteReason, noteDetail].filter(Boolean).join(' · '))}">`
          + (noteReason ? `<b style="color:#dc2626">${escapeHtml(noteReason)}</b>` : '')
          + (noteDetail ? ` ${escapeHtml(noteDetail.length > 18 ? noteDetail.slice(0, 18) + '…' : noteDetail)}` : '')
          + `</span>`
        : '';
      const viewLink = r.view_url ? `<a href="#" class="cc-link" data-act="cc-view" data-url="${escapeAttr(r.view_url)}">옥션원</a>` : '';
      const rkey = ccKeyOf(r);
      const runChk = ccRunUnchecked.has(rkey) ? '' : 'checked';
      return `<tr data-idx="${i}" class="${isBuga ? 'cc-row-buga' : ''}">
        <td style="text-align:center"><input type="checkbox" class="cc-run-cb" data-key="${escapeAttr(rkey)}" ${runChk}></td>
        <td style="text-align:center"><input type="checkbox" class="cc-cb" ${isBuga ? 'checked' : ''}></td>
        <td>${keyCell(r.bid_date, r.date_hit !== false)}</td>
        <td>${keyCell(r.sakun_no, r.sakun_hit !== false)}</td>
        <td>${keyCell(r.court, r.court_hit !== false)}</td>
        <td>${midCell}</td>
        <td>${tgDot(r.m_tg === 'Y')}${escapeHtml(r.m_name || '')}</td>
        <td>${buyerCell}</td>
        <td style="text-align:right">${fmtWon(r.bidprice)}</td>
        <td style="text-align:right">${maeCell}</td>
        <td style="text-align:center">${resBadge}</td>
        <td style="text-align:center">${viewLink}</td>
        <td style="text-align:center">${stu ? `<span class="cc-badge cc-ok">${escapeHtml(stu)}</span>` : ''}</td>
        <td>${willUpdate}</td>
        <td class="cc-note">${noteCell}${isBuga ? `<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">
          <button type="button" class="cc-row-send btn_box_sss" data-key="${escapeAttr(rkey)}" title="이 불가건을 담당자에게 즉시 텔레그램 전송" style="padding:1px 6px;font-size:11px">📤전송</button>
          <button type="button" class="cc-row-copy btn_box_sss" data-key="${escapeAttr(rkey)}" title="카드 이미지만 복사(카톡 붙여넣기)" style="padding:1px 6px;font-size:11px">📋이미지</button>
          <button type="button" class="cc-row-text btn_box_sss" data-key="${escapeAttr(rkey)}" title="제목 텍스트 복사(카톡에 별도 붙여넣기)" style="padding:1px 6px;font-size:11px">📝제목</button></div>` : ''}</td>
      </tr>`;
    }).join('');
    const doneCnt = merged.filter(r => !r._pending).length;
    const catCnt = (c) => merged.filter(r => ccCategory(r) === c).length;
    const winCnt = catCnt('낙찰'), missCnt = catCnt('미입찰'), bugaCnt = catCnt('불가'), unkCnt = catCnt('확인불가');
    wrap.innerHTML = `
      <div class="cc-results-head">
        <span>입찰(전체) <b>${merged.length}</b> (조회완료 ${doneCnt}) · <b style="color:#2563eb">낙찰 ${winCnt}</b> · <b style="color:#dc2626">미입찰 ${missCnt}</b> · <b style="color:#111827">불가 ${bugaCnt}</b>${unkCnt ? ` · <span style="color:#6b7280">확인불가 ${unkCnt}</span>` : ''}</span>
        <span class="mjcap-spacer"></span>
        <span style="font-size:12px;color:#374151;margin-right:8px">📨 수신: <b>${escapeHtml(recipientsLabel())}</b> <a href="#" data-act="cc-recipients" style="color:#2563eb;text-decoration:none">설정</a></span>
        <label style="font-size:12px;display:inline-flex;align-items:center;gap:3px;margin-right:6px;cursor:pointer" title="매칭(실행) 완료 시 낙찰/미입찰/불가 일일보고를 설정 대상에게 자동 전송">
          <input type="checkbox" class="cc-auto-report" ${ccAutoReportOn() ? 'checked' : ''}>자동 보고
        </label>
        <button type="button" class="btn_box_sss bold" data-act="cc-preview" title="전송 전 보고서 PDF를 새 탭에서 미리보기">👁 미리보기</button>
        <button type="button" class="btn_box_sss btn_gray bold" data-act="cc-report" title="불가/낙찰 건을 PDF+캡처 보고서로 관리자 텔레그램 전송">📋 보고서 전송</button>
        <button type="button" class="btn_box_sss btn_blue bold" data-act="cc-send">📤 업데이트 체크건 MAPS '불가' 처리</button>
      </div>
      <div class="cc-table-wrap">
      <table class="cc-table"><thead>
        <tr>
          <th>실행<br><input type="checkbox" class="cc-run-all" checked title="전체 실행 토글"></th>
          <th>업데이트</th>
          <th class="cc-sort" data-sort="bid_date">입찰일자${arrow('bid_date')}</th>
          <th class="cc-sort" data-sort="sakun_no">사건번호${arrow('sakun_no')}</th>
          <th class="cc-sort" data-sort="court">법원${arrow('court')}</th>
          <th class="cc-sort" data-sort="mid">담당자${arrow('mid')}</th>
          <th class="cc-sort" data-sort="m_name">회원${arrow('m_name')}</th>
          <th class="cc-sort" data-sort="buyer">매수인${arrow('buyer')}</th>
          <th class="cc-sort" data-sort="bidprice">입찰가${arrow('bidprice')}</th>
          <th class="cc-sort" data-sort="maegak">매각가${arrow('maegak')}</th>
          <th class="cc-sort" data-sort="result">결과${arrow('result')}</th>
          <th>옥션원</th>
          <th class="cc-sort" data-sort="stu">현재상태${arrow('stu')}</th>
          <th>업데이트 예정</th>
          <th>비고</th>
        </tr>
      </thead><tbody>${rows}</tbody></table>
      </div>
    `;
    // 실행 체크 상태를 키로 보존 (재렌더에도 유지)
    wrap.querySelectorAll('.cc-run-cb').forEach(cb => cb.addEventListener('change', () => {
      const k = cb.dataset.key;
      if (cb.checked) ccRunUnchecked.delete(k); else ccRunUnchecked.add(k);
    }));
    wrap.querySelector('.cc-run-all')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      wrap.querySelectorAll('.cc-run-cb').forEach(cb => {
        cb.checked = on;
        if (on) ccRunUnchecked.delete(cb.dataset.key); else ccRunUnchecked.add(cb.dataset.key);
      });
    });
    wrap.querySelector('[data-act="cc-send"]')?.addEventListener('click', sendCcToMaps);
    wrap.querySelector('[data-act="cc-preview"]')?.addEventListener('click', previewCcReport);
    wrap.querySelector('[data-act="cc-report"]')?.addEventListener('click', openReportPicker);
    wrap.querySelector('[data-act="cc-recipients"]')?.addEventListener('click', (e) => { e.preventDefault(); openReportPicker(); });
    wrap.querySelectorAll('.cc-row-send').forEach(b => b.addEventListener('click', () => sendOneByKey(b.dataset.key)));
    wrap.querySelectorAll('.cc-row-copy').forEach(b => b.addEventListener('click', () => copyCardByKey(b.dataset.key)));
    wrap.querySelectorAll('.cc-row-text').forEach(b => b.addEventListener('click', () => copyTitleByKey(b.dataset.key)));
    wrap.querySelector('.cc-auto-report')?.addEventListener('change', (e) => setCcAutoReport(e.target.checked));
    wrap.querySelectorAll('th.cc-sort').forEach(th => th.addEventListener('click', () => sortCc(th.dataset.sort)));
  }

  function sendCcToMaps() {
    const card = $card('cc');
    if (!card) return;
    const tbody = card.querySelector('[data-role="cc-results"] tbody');
    if (!tbody) return;
    const merged = ccMergedRows();
    const picked = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const cb = tr.querySelector('.cc-cb');
      if (cb && cb.checked) {
        const idx = parseInt(tr.dataset.idx, 10);
        const r = merged[idx];
        if (r && r.is_buga) picked.push(r);   // 불가 확정 건만 전송
      }
    });
    if (picked.length === 0) { alert('체크된 건이 없습니다.'); return; }
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { alert('MAPS Admin Key 미설정 — 상단 ⚙(MAPS 연동) 설정에서 키를 먼저 저장하세요.'); return; }
    if (!confirm(`${picked.length}건을 MAPS 로 전송하여 상태를 "불가"(+사유/상세) 로 업데이트 합니다. 진행할까요?`)) return;
    const btn = card.querySelector('[data-act="cc-send"]');
    if (btn) btn.disabled = true;
    log('cc', `📤 ${picked.length}건 MAPS 전송 중...`, 'log-ok');
    fetch('/api/maps-changecancel', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ api_key: apiKey, items: picked })
    }).then(r => r.json()).then(j => {
      if (btn) btn.disabled = false;
      if (j && (j.success || j.ok)) {
        const n = j.updated || j.count || picked.length;
        log('cc', `✅ MAPS 업데이트 완료: ${n}건`, 'log-ok');
        alert('MAPS 업데이트 완료: ' + n + '건');
      } else {
        log('cc', `❌ MAPS 전송 실패: ${j && (j.error || j.message) || '알 수 없음'}`, 'log-err');
        alert('실패: ' + (j && (j.error || j.message) || '?'));
      }
    }).catch(err => {
      if (btn) btn.disabled = false;
      log('cc', `❌ MAPS 전송 오류: ${err}`, 'log-err');
      alert('오류: ' + err);
    });
  }

  // ===== 진행사항 보고서(불가/낙찰) 텔레그램 전송 =====
  const CC_AUTO_REPORT_KEY = 'mj_cc_auto_report';
  const CC_REPORT_TARGET_KEY = 'mj_cc_report_target';
  function ccAutoReportOn() { try { return localStorage.getItem(CC_AUTO_REPORT_KEY) === '1'; } catch (e) { return false; } }
  function setCcAutoReport(on) { try { localStorage.setItem(CC_AUTO_REPORT_KEY, on ? '1' : '0'); } catch (e) {} }
  function getReportTarget() {
    try { const t = JSON.parse(localStorage.getItem(CC_REPORT_TARGET_KEY) || 'null'); if (t && t.by) return t; } catch (e) {}
    return { by: 'gubun', value: '관리자' };
  }
  function setReportTarget(t) { try { localStorage.setItem(CC_REPORT_TARGET_KEY, JSON.stringify(t)); } catch (e) {} }
  function reportTargetLabel(t) {
    t = t || getReportTarget();
    if (t.by === 'members') return `회원 ${(t.labels && t.labels.length) ? t.labels.join('·') : ((t.member_ids || []).length + '명')}`;
    return `구분 ${t.value || '관리자'}`;
  }
  // ===== 수신 대상(관리자=전체 / 강사=자기 담당건) =====
  const CC_RECIPIENTS_KEY = 'mj_cc_recipients';
  function getRecipients() {
    try {
      const r = JSON.parse(localStorage.getItem(CC_RECIPIENTS_KEY) || 'null');
      if (r && typeof r === 'object') return { include_admins: r.include_admins !== false, teacher_ids: r.teacher_ids || [], teacher_labels: r.teacher_labels || [] };
    } catch (e) {}
    return { include_admins: true, teacher_ids: [], teacher_labels: [] };
  }
  function setRecipients(r) { try { localStorage.setItem(CC_RECIPIENTS_KEY, JSON.stringify(r)); } catch (e) {} }
  function recipientsLabel(r) {
    r = r || getRecipients();
    const parts = [];
    if (r.include_admins) parts.push('관리자(전체)');
    if (r.teacher_ids && r.teacher_ids.length) parts.push('강사 ' + ((r.teacher_labels && r.teacher_labels.length) ? r.teacher_labels.join('·') : r.teacher_ids.length + '명'));
    return parts.length ? parts.join(' + ') : '대상 없음';
  }
  // 텔레그램 뱃지: 연결+사용=📨, 연결·사용중지=🔔, 미연결=🔕
  function tgBadge(m) {
    if (m.ready) return '<span title="텔레그램 연결+사용" style="color:#16a34a">📨</span>';
    if (m.has_token) return '<span title="연결됨·사용중지" style="color:#d97706">🔔</span>';
    return '<span title="미연결" style="color:#9ca3af">🔕</span>';
  }
  // 회원 텔레그램 사용여부 T 뱃지 (MAPS 스타일: 사용=파랑채움 / 미사용=회색테두리)
  function tgDot(ready) {
    const base = 'display:inline-block;width:15px;height:15px;line-height:15px;text-align:center;border-radius:50%;font-size:10px;font-weight:700;margin-right:3px;vertical-align:middle';
    return ready
      ? `<span title="텔레그램 사용" style="${base};background:#229ED9;color:#fff">T</span>`
      : `<span title="텔레그램 미사용" style="${base};border:1px solid #cbd5e1;color:#94a3b8">T</span>`;
  }
  // 우리 회원 낙찰 = 매각 & 매각가==입찰가
  function ccIsOurWin(r) {
    if (!r || ccStateKind(r) !== '매각') return false;
    const mae = _won(r.maegak_price), bid = _won(r.bidprice);
    return !!(mae && bid && mae === bid);
  }
  // 일일보고 분류: 불가 / 낙찰(매각&매각가==입찰가) / 미입찰(매각&매각가<입찰가) /
  //   확인불가(매각&입찰가없음) / 일반(매각&매각가>입찰가) / ''(대기·기타)
  const CC_CAT_COLOR = { '낙찰': '#2563eb', '미입찰': '#dc2626', '불가': '#111827', '확인불가': '#6b7280', '일반': '#9ca3af' };
  function ccCategory(r) {
    if (!r || r._pending) return '';
    if (r.is_buga || ccStateKind(r) === '불가') return '불가';
    if (ccStateKind(r) !== '매각') return '';
    const bid = _won(r.bidprice), mae = _won(r.maegak_price);
    if (!mae) return '';
    if (!bid) return '확인불가';
    if (mae === bid) return '낙찰';
    if (mae < bid) return '미입찰';
    return '일반';   // 매각가 > 입찰가 (우리보다 높게 팔림)
  }
  // 일일보고 항목 = 낙찰/미입찰/불가 (category 부착). 일반매각·확인불가·진행중 제외
  function ccReportItems() {
    return ccMergedRows().filter(r => ['낙찰', '미입찰', '불가'].indexOf(ccCategory(r)) >= 0)
      .map(r => Object.assign({}, r, { category: ccCategory(r) }));
  }
  function ccReportTotal() { return ccMergedRows().length; }   // 입찰(전체)
  // 보고 날짜 = 항목들의 대표 입찰일자(YYYY-MM-DD) + 현재 시각
  function ccReportDate() {
    const cnt = {};
    ccMergedRows().forEach(r => { const d = bidToYMD(r.bid_date); if (d) cnt[d] = (cnt[d] || 0) + 1; });
    let best = '', bn = -1;
    Object.keys(cnt).forEach(d => { if (cnt[d] > bn) { bn = cnt[d]; best = d; } });
    if (!best) best = ymd(new Date());
    const t = new Date();
    return best + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }

  // 실제 전송 (recipients = {include_admins, teacher_ids})
  function doSendReport(recipients, auto) {
    const items = ccReportItems();
    if (!items.length) { if (!auto) alert('보고할 낙찰/미입찰/불가 건이 없습니다.'); return; }
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { if (!auto) alert('MAPS Admin Key 미설정 — 상단 ⚙(MAPS 연동) 설정에서 키를 먼저 저장하세요.'); return; }
    recipients = recipients || getRecipients();
    log('cc', `📋 보고서 전송 중… (${items.length}건 · 대상=${recipientsLabel(recipients)}${auto ? ' · 자동' : ''})`, 'log-ok');
    fetch('/api/send-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, items, recipients, total: ccReportTotal(), report_dt: ccReportDate() })
    }).then(r => r.json()).then(j => {
      if (j && j.success) {
        const errN = (j.errors && j.errors.length) ? ` (전송오류 ${j.errors.length})` : '';
        log('cc', `✅ 보고서 전송 완료 — 대상 ${j.admins || '?'}명, 전송 ${j.sent || 0}건${errN}`, 'log-ok');
        if (!auto) alert(`보고서 전송 완료 — 대상 ${j.admins || '?'}명`);
      } else {
        const msg = j && (j.message || j.error) || '응답 없음';
        log('cc', `⚠ 보고서 전송 실패: ${msg}`, 'log-err');
        if (!auto) alert('보고서 전송 실패: ' + msg);
      }
    }).catch(err => {
      log('cc', `⚠ 보고서 전송 오류: ${err}`, 'log-err');
      if (!auto) alert('보고서 전송 오류: ' + err);
    });
  }
  function sendCcReportAuto() { doSendReport(getRecipients(), true); }   // 자동 보고(저장된 수신대상)

  // base64 → Blob
  function b64ToBlob(b64, type) {
    const bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'application/octet-stream' });
  }
  // 보고서 미리보기 — 전송 없이 PDF 새 탭 열람 (텔레그램/키 불필요)
  function previewCcReport() {
    const items = ccReportItems();
    if (!items.length) { alert('미리볼 낙찰/미입찰/불가 건이 없습니다.'); return; }
    const btn = $card('cc')?.querySelector('[data-act="cc-preview"]');
    if (btn) btn.disabled = true;
    log('cc', `👁 보고서 미리보기 생성 중… (${items.length}건)`, 'log-ok');
    fetch('/api/preview-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, total: ccReportTotal(), report_dt: ccReportDate() })
    }).then(r => r.json()).then(j => {
      if (btn) btn.disabled = false;
      if (j && j.success && j.pdf_b64) {
        const url = URL.createObjectURL(b64ToBlob(j.pdf_b64, 'application/pdf'));
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        log('cc', `👁 미리보기 열림 (${j.count}건)`, 'log-ok');
      } else {
        const msg = j && (j.message || j.error) || '응답 없음';
        log('cc', `⚠ 미리보기 실패: ${msg}`, 'log-err');
        alert('미리보기 실패: ' + msg);
      }
    }).catch(err => {
      if (btn) btn.disabled = false;
      log('cc', `⚠ 미리보기 오류: ${err}`, 'log-err');
      alert('미리보기 오류: ' + err + '\n(매니저 서버 재시작이 필요할 수 있습니다)');
    });
  }

  // 불가 단건: 담당자(강사)에게 즉시 텔레그램 전송
  function sendOneByKey(key) {
    const r = ccMergedRows().find(x => ccKeyOf(x) === key);
    if (!r) return;
    const mid = String(r.mid_member_id || '');
    if (!mid) { alert('담당자(강사 회원)가 매칭되지 않아 전송 대상이 없습니다.\n(담당자 닉네임이 회원관리 강사와 일치해야 함)'); return; }
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { alert('MAPS Admin Key 미설정'); return; }
    const who = r.m_name_id_disp || r.m_name_id || '담당자';
    if (!confirm(`이 불가건을 담당자 "${who}" 에게 즉시 전송할까요?\n${r.sakun_no || ''}`)) return;
    const item = Object.assign({}, r, { category: ccCategory(r) });
    log('cc', `📤 즉시전송: ${r.sakun_no || ''} → 담당자 ${who}`, 'log-ok');
    fetch('/api/send-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, items: [item], recipients: { include_admins: false, teacher_ids: [mid] }, total: 1, report_dt: ccReportDate() })
    }).then(r2 => r2.json()).then(j => {
      if (j && j.success) { log('cc', `✅ 즉시전송 완료 (${j.sent || 0}명)`, 'log-ok'); alert('전송 완료'); }
      else { const m = (j && (j.message || j.error)) || '?'; log('cc', `⚠ 즉시전송 실패: ${m}`, 'log-err'); alert('전송 실패: ' + m); }
    }).catch(e => { log('cc', `⚠ 즉시전송 오류: ${e}`, 'log-err'); alert('오류: ' + e); });
  }
  // 카드 제목 텍스트 (헤더와 동일: 카테고리 | 입찰일자 | 사건번호 | 회원명)
  function cardTitleText(r) {
    const c = ccCategory(r);
    const head = (c === '불가') ? ('불가' + (r.status ? ' - ' + String(r.status) : '')) : (c || '');
    return [head, r.bid_date, r.sakun_no, r.m_name].map(x => String(x || '').trim()).filter(Boolean).join(' | ');
  }
  // 제목 텍스트만 클립보드 복사 (이미지와 별개로 카톡에 붙여넣기)
  function copyTitleByKey(key) {
    const r = ccMergedRows().find(x => ccKeyOf(x) === key);
    if (!r) return;
    const txt = cardTitleText(r);
    navigator.clipboard.writeText(txt).then(() => {
      log('cc', `✅ 제목 복사: ${txt}`, 'log-ok');
    }).catch(() => { prompt('아래 텍스트를 복사하세요 (Ctrl+C):', txt); });
  }
  // 카드 이미지 클립보드 복사 (카톡 붙여넣기용)
  function copyCardByKey(key) {
    const r = ccMergedRows().find(x => ccKeyOf(x) === key);
    if (!r) return;
    const item = Object.assign({}, r, { category: ccCategory(r) });
    log('cc', `📋 카드 이미지 준비… ${r.sakun_no || ''}`, 'log-ok');
    fetch('/api/card-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item)
    }).then(r2 => r2.json()).then(async j => {
      if (!(j && j.success && j.png_b64)) { const m = (j && (j.message || j.error)) || '?'; alert('이미지 생성 실패: ' + m); return; }
      try {
        const blob = b64ToBlob(j.png_b64, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        log('cc', `✅ 이미지 복사됨 — 카톡에 Ctrl+V`, 'log-ok');
        alert('카드 이미지를 복사했습니다. 카톡 대화창에 Ctrl+V 로 붙여넣으세요.');
      } catch (e) {
        const url = URL.createObjectURL(b64ToBlob(j.png_b64, 'image/png'));
        window.open(url, '_blank');
        alert('자동복사가 차단되어 새 탭으로 열었습니다. 이미지 우클릭 → 복사 하세요.');
      }
    }).catch(e => alert('이미지 복사 오류: ' + e));
  }

  // 대상 후보(구분/회원명 + 텔레그램 상태) 조회 → GAS getReportRecipientCandidates
  let _ccCandCache = null;
  function fetchReportCandidates(cb) {
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { alert('MAPS Admin Key 미설정'); return; }
    fetch('/api/maps-gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_action: 'getReportRecipientCandidates' })
    }).then(r => r.json()).then(j => {
      if (j && j.success) { _ccCandCache = j; cb(j); }
      else alert('회원 조회 실패: ' + (j && (j.message || j.error) || '?'));
    }).catch(e => alert('회원 조회 오류: ' + e));
  }

  // 수신 대상 설정 모달 (관리자=전체 / 강사=자기 담당건 체크)
  function openReportPicker() {
    if (!ccReportItems().length) { alert('보고할 낙찰/미입찰/불가 건이 없습니다.'); return; }
    let modal = document.getElementById('ccReportModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ccReportModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:99999';
      modal.innerHTML = `<div style="background:#fff;border-radius:10px;width:90%;max-width:560px;max-height:85vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb">
          <b>📋 보고 수신 대상 설정</b><button type="button" data-act="rp-close" style="border:0;background:none;font-size:18px;cursor:pointer">✕</button></div>
        <div style="padding:14px 16px">
          <label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:14px;margin-bottom:6px">
            <input type="checkbox" data-role="rp-admins"> <b>관리자 — 전체 일일보고 받기</b></label>
          <div data-role="rp-admin-list" style="margin:0 0 12px 24px;font-size:12px;color:#6b7280"></div>
          <div style="border-top:1px solid #e5e7eb;padding-top:10px"><b>강사 — 자기 담당건만 받기</b> <span style="font-size:12px;color:#9ca3af">(체크한 강사에게만 본인 m_name_id 건 전송)</span></div>
          <div data-role="rp-teacher-list" style="max-height:300px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;margin-top:6px"></div>
          <div style="margin-top:7px;font-size:12px;color:#6b7280">📨연결+사용 · 🔔연결·사용중지 · 🔕미연결. <b>📨</b> 만 전송됩니다.</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #e5e7eb">
          <button type="button" class="btn_box_sss" data-act="rp-close">취소</button>
          <button type="button" class="btn_box_sss btn_white bold" data-act="rp-save">💾 대상 저장</button>
          <button type="button" class="btn_box_sss btn_blue bold" data-act="rp-send">📤 저장 후 전송</button>
        </div></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
      modal.querySelectorAll('[data-act="rp-close"]').forEach(b => b.addEventListener('click', () => modal.style.display = 'none'));
      modal.querySelector('[data-act="rp-save"]').addEventListener('click', () => { saveReportPicker(); modal.style.display = 'none'; });
      modal.querySelector('[data-act="rp-send"]').addEventListener('click', () => { const r = saveReportPicker(); modal.style.display = 'none'; doSendReport(r, false); });
    }
    modal.style.display = 'flex';
    fetchReportCandidates(() => renderReportPicker());
  }

  function renderReportPicker() {
    const modal = document.getElementById('ccReportModal'); if (!modal || !_ccCandCache) return;
    const saved = getRecipients();
    const isG = (m, g) => String(m.gubun || '').split(',').map(s => s.trim()).indexOf(g) >= 0;
    const members = _ccCandCache.members || [];
    const admins = members.filter(m => isG(m, '관리자'));
    const teachers = members.filter(m => isG(m, '강사'));
    modal.querySelector('[data-role="rp-admins"]').checked = saved.include_admins;
    modal.querySelector('[data-role="rp-admin-list"]').innerHTML = admins.length
      ? admins.map(m => `${tgBadge(m)} ${escapeHtml(m.member_name)}`).join(' &nbsp; ')
      : '<span style="color:#dc2626">관리자 회원 없음</span>';
    const savedT = (saved.teacher_ids || []).map(String);
    modal.querySelector('[data-role="rp-teacher-list"]').innerHTML = teachers.length
      ? teachers.map(m => {
        const chk = savedT.indexOf(String(m.member_id)) >= 0 ? 'checked' : '';
        return `<label style="display:flex;gap:8px;align-items:center;padding:6px 9px;border-bottom:1px solid #f1f5f9;${m.ready ? '' : 'opacity:.5'}">
          <input type="checkbox" class="rp-tcb" data-id="${escapeAttr(m.member_id)}" data-name="${escapeAttr(m.member_name)}" ${chk} ${m.ready ? '' : 'disabled'}>
          ${tgBadge(m)} <span style="flex:1">${escapeHtml(m.member_name)}</span></label>`;
      }).join('')
      : '<div style="padding:12px;color:#9ca3af">강사 회원이 없습니다.</div>';
  }

  function saveReportPicker() {
    const modal = document.getElementById('ccReportModal');
    const include_admins = modal.querySelector('[data-role="rp-admins"]').checked;
    const ids = [], labels = [];
    modal.querySelectorAll('.rp-tcb:checked').forEach(cb => { ids.push(cb.dataset.id); labels.push(cb.dataset.name); });
    const r = { include_admins, teacher_ids: ids, teacher_labels: labels };
    setRecipients(r);
    renderCcResults();   // 상단 상시표시 갱신
    return r;
  }
  // ===== 법원 매칭표 모달 (MAPS ↔ 옥션원) =====
  function renderCourtMap(filter) {
    const tbody = document.getElementById('courtMapTbody');
    const foot = document.getElementById('courtMapFoot');
    if (!tbody) return;
    const map = (window.COURT_MAP || []);
    const q = String(filter || '').replace(/\s/g, '').trim();
    const rows = map.filter(r => !q || (r.maps + r.auction + r.code).replace(/\s/g, '').indexOf(q) >= 0);
    tbody.innerHTML = rows.map(r => {
      const miss = !r.code ? ' class="cm-miss"' : '';
      return `<tr${miss}><td>${escapeHtml(r.maps)}</td><td>${escapeHtml(r.auction || '— 미매칭 —')}</td><td>${escapeHtml(r.code || '')}</td></tr>`;
    }).join('');
    if (foot) {
      const missCnt = map.filter(r => !r.code).length;
      foot.textContent = `총 ${map.length}개 · 표시 ${rows.length}개` + (missCnt ? ` · ⚠ 미매칭 ${missCnt}개` : ' · 전부 매칭됨');
    }
  }
  function openCourtMap() {
    const m = document.getElementById('courtMapModal');
    if (!m) return;
    renderCourtMap('');
    const s = document.getElementById('courtMapSearch');
    if (s) { s.value = ''; }
    m.style.display = 'flex';
    if (s) setTimeout(() => s.focus(), 50);
  }
  function closeCourtMap() {
    const m = document.getElementById('courtMapModal');
    if (m) m.style.display = 'none';
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-act="court-map-open"]')) { openCourtMap(); }
    else if (e.target.closest('[data-act="court-map-close"]')) { closeCourtMap(); }
    else if (e.target.id === 'courtMapModal') { closeCourtMap(); } // 오버레이 클릭 닫기
    else if (e.target.closest('[data-act="cc-fav-close"]')) { closeCcFav(); }
    else if (e.target.closest('[data-act="cc-fav-add"]')) { addCcFav(); }
    else if (e.target.id === 'ccFavModal') { closeCcFav(); }
    else if (e.target.closest('[data-act="cc-view"]')) {
      e.preventDefault();
      openAuctionView(e.target.closest('[data-act="cc-view"]').dataset.url);
    }
  });
  // 옥션원 상세 — MAPS 입찰물건관리 '옥션원' 버튼과 동일: window.open 팝업창(독립 이동/리사이즈).
  // 첫 클릭은 로그인 페이지(팝업 '_auction' 에 로그인) → 이후 클릭은 상세 열림(같은 세션 사용).
  let _ccAuctionLoginShown = false;
  function openAuctionView(viewUrl) {
    const LOGIN = 'https://www.auction1.co.kr/common/login_box.php';
    const feat = 'width=896,height=900,left=100,top=50,resizable=yes,scrollbars=yes';
    if (!_ccAuctionLoginShown) {
      _ccAuctionLoginShown = true;
      window.open(LOGIN, '_auction', feat);
      alert('옥션원 로그인 페이지를 열었습니다. 로그인 후 다시 [옥션원]을 클릭하세요.');
      return;
    }
    const m = String(viewUrl || '').match(/product_id=(\d+)/);
    const pid = m ? m[1] : '';
    if (!pid) { window.open(LOGIN, '_auction', feat); return; }
    const isGong = /pubauct/.test(viewUrl);
    const base = isGong
      ? 'https://www.auction1.co.kr/pubauct/view.php?product_id='
      : 'https://www.auction1.co.kr/auction/ca_view.php?product_id=';
    window.open(base + pid, '_auction', feat);
  }
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'courtMapSearch') renderCourtMap(e.target.value);
  });

  function escapeAttr(s) {
    return String(s||'').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ========== 폴더 브라우저 (pane 단위 인스턴스 + 공유 미리보기) ==========
  function initFolderBrowser() {
    const sharedPreview = document.getElementById('mjfbSharedPreview');
    const allStates = [];
    document.querySelectorAll('.mjfb-pane[data-fb-root]').forEach(pane => {
      const root = pane.dataset.fbRoot;
      const state = { pane, root, rel: '', searchMode: false, fingerprint: null };
      const el = {
        path: pane.querySelector('[data-fb="path"]'),
        search: pane.querySelector('[data-fb="search"]'),
        deep: pane.querySelector('[data-fb="deep"]'),
        count: pane.querySelector('[data-fb="count"]'),
        list: pane.querySelector('[data-fb="list"]'),
        preview: sharedPreview,  // 공유 미리보기 영역
      };
      state.__el = el;
      pane.querySelector('[data-fb-act="back"]').addEventListener('click', () => {
        if (!state.rel) return;
        const parts = state.rel.split('/').filter(Boolean); parts.pop();
        state.rel = parts.join('/'); state.searchMode = false;
        loadDir(state, el);
      });
      pane.querySelector('[data-fb-act="home"]').addEventListener('click', () => {
        state.rel = ''; state.searchMode = false; el.search.value = '';
        loadDir(state, el);
      });
      pane.querySelector('[data-fb-act="refresh"]').addEventListener('click', () => {
        if (state.searchMode) doSearch(state, el); else loadDir(state, el);
      });
      pane.querySelector('[data-fb-act="search"]').addEventListener('click', () => doSearch(state, el));
      el.search.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(state, el); });
      loadDir(state, el);
      allStates.push(state);
    });
    if (allStates.length) startFolderAutoWatch(allStates);
  }

  function loadDir(state, el) {
    el.list.innerHTML = '<div class="mjfb-empty">불러오는 중...</div>';
    fetch('/api/files/list?root=' + state.root + '&rel=' + encodeURIComponent(state.rel))
      .then(r => r.json())
      .then(j => {
        if (!j.ok) { el.list.innerHTML = '<div class="mjfb-empty">'+ (j.error || '오류') + '</div>'; return; }
        state.searchMode = false;
        el.path.textContent = j.abs_path || '';
        renderFileList(state, el, j.items || []);
        // fingerprint 저장 (자동 감지 기준)
        state.fingerprint = computeFingerprintFromItems(j.items || []);
      })
      .catch(err => { el.list.innerHTML = '<div class="mjfb-empty">로드 실패: ' + err + '</div>'; });
  }

  function computeFingerprintFromItems(items) {
    let max_mtime = 0;
    items.forEach(it => { if ((it.mtime || 0) > max_mtime) max_mtime = it.mtime; });
    return { count: items.length, max_mtime };
  }

  // 폴더 자동 감지: 탭 보일 때 5초마다 fingerprint 비교
  function startFolderAutoWatch(states) {
    let timer = null;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      states.forEach(s => {
        if (s.searchMode) return;  // 검색 중일 땐 자동 갱신 안 함
        if (!s.fingerprint) return;
        fetch('/api/files/fingerprint?root=' + s.root + '&rel=' + encodeURIComponent(s.rel))
          .then(r => r.json())
          .then(j => {
            if (!j.ok) return;
            const same = j.count === s.fingerprint.count && j.max_mtime === s.fingerprint.max_mtime;
            if (!same) {
              // 변경 감지 → 현재 뷰 reload
              const el = s.__el;
              if (el) loadDir(s, el);
            }
          })
          .catch(()=>{});
      });
    };
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 5000);
  }

  function doSearch(state, el) {
    const q = el.search.value.trim();
    if (!q) { loadDir(state, el); return; }
    const deep = el.deep.checked;
    el.list.innerHTML = '<div class="mjfb-empty">검색 중...</div>';
    const url = '/api/files/search?root=' + state.root + '&rel=' + encodeURIComponent(state.rel)
              + '&q=' + encodeURIComponent(q) + '&deep=' + (deep ? '1' : '0');
    fetch(url).then(r => r.json()).then(j => {
      if (!j.ok) { el.list.innerHTML = '<div class="mjfb-empty">'+ (j.error || '오류') + '</div>'; return; }
      state.searchMode = true;
      renderFileList(state, el, j.items || [], true);
    }).catch(err => { el.list.innerHTML = '<div class="mjfb-empty">검색 실패: ' + err + '</div>'; });
  }

  function renderFileList(state, el, items, searchMode) {
    el.count.textContent = items.length + '개 (폴더 ' + items.filter(x=>x.is_dir).length + ' / 파일 ' + items.filter(x=>!x.is_dir).length + ')';
    if (!items.length) { el.list.innerHTML = '<div class="mjfb-empty">비어 있음</div>'; return; }
    const html = items.map(it => {
      const icon = it.is_dir ? '📁' : (isImageName(it.name) ? '🖼️' : '📄');
      const meta = it.is_dir ? '' : (formatSize(it.size) + ' · ' + formatTime(it.mtime));
      const showPath = searchMode ? ' <span style="color:#9ca3af;font-size:10px">' + escapeHtml(it.rel || '') + '</span>' : '';
      return '<div class="mjfb-row" data-rel="' + escapeAttr(it.rel) + '" data-dir="' + (it.is_dir?'1':'0') + '" data-name="' + escapeAttr(it.name) + '">' +
        '<span class="icon">' + icon + '</span>' +
        '<span class="name">' + escapeHtml(it.name) + showPath + '</span>' +
        '<span class="meta">' + meta + '</span>' +
        '</div>';
    }).join('');
    el.list.innerHTML = html;
    el.list.querySelectorAll('.mjfb-row').forEach(row => {
      row.addEventListener('click', () => {
        // 공유 미리보기 사용 시 모든 pane 의 선택 표시 클리어
        document.querySelectorAll('.mjfb-list .mjfb-row.selected').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        const isDir = row.dataset.dir === '1';
        const rel = row.dataset.rel;
        if (isDir) {
          state.rel = rel; state.searchMode = false; el.search.value = '';
          loadDir(state, el);
        } else {
          showPreview(state, el, rel, row.dataset.name);
        }
      });
    });
  }

  function showPreview(state, el, rel, name) {
    const url = '/api/files/get?root=' + state.root + '&rel=' + encodeURIComponent(rel);
    if (isImageName(name)) {
      el.preview.innerHTML = '<div class="preview-info"><span><b>' + escapeHtml(name) + '</b></span>' +
        '<span><a href="' + url + '" target="_blank">원본 열기</a></span></div>' +
        '<img src="' + url + '" alt="' + escapeAttr(name) + '">';
    } else {
      el.preview.innerHTML = '<div class="preview-info"><b>' + escapeHtml(name) + '</b></div>' +
        '<a href="' + url + '" target="_blank" class="btn_box_sss btn_blue">파일 다운로드 / 열기</a>';
    }
  }

  function isImageName(n) { return /\.(jpe?g|png|gif|webp|bmp)$/i.test(n||''); }
  function formatSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    return (b/1024/1024).toFixed(2) + ' MB';
  }
  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts*1000);
    const pad = n => String(n).padStart(2,'0');
    return pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  }
  function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ========== 카카오 ==========
  function refreshKakaoStatus() {
    fetch('/api/kakao/status').then(r => r.json()).then(j => {
      const el = document.getElementById('kakaoStatus');
      if (j.running) { el.textContent = j.pid ? ('● 실행중 (PID ' + j.pid + ')') : '● 실행중 (포트 8000)'; el.className = 'mjcap-status running'; }
      else { el.textContent = '○ 중지됨'; el.className = 'mjcap-status'; }
    }).catch(() => {
      document.getElementById('kakaoStatus').textContent = '확인 실패';
    });
  }
  function kakaoLog(msg, cls) {
    const el = document.getElementById('kakaoLog');
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg + '\n';
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }
  document.addEventListener('click', e => {
    if (e.target.id === 'kakaoStartBtn') {
      fetch('/api/kakao/start', {method:'POST'}).then(r=>r.json()).then(j => {
        if (j.ok) kakaoLog('▶ 카카오 서버 시작됨 (PID ' + j.pid + ')', 'log-ok');
        else kakaoLog('시작 실패: ' + (j.error || '?'), 'log-err');
        refreshKakaoStatus();
      });
    }
    if (e.target.id === 'kakaoStopBtn') {
      fetch('/api/kakao/stop', {method:'POST'}).then(r=>r.json()).then(j => {
        if (j.ok) kakaoLog('⏹ 카카오 서버 중지됨', 'log-ok');
        else kakaoLog('중지 실패: ' + (j.error || '?'), 'log-err');
        refreshKakaoStatus();
      });
    }
    if (e.target.id === 'kakaoRefreshBtn') refreshKakaoStatus();
  });

  // 복원 (모든 변수 선언 이후에)
  try {
    const saved = localStorage.getItem('mj_active_tab');
    if (saved) switchTab(saved); else switchTab('capture');
  } catch(e) { switchTab('capture'); }

})();
