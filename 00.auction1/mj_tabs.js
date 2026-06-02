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
        setCcDates(0, 0);          // 날짜 기본값 = 오늘~오늘
        renderCcFavSelect();       // 즐겨찾기 드롭다운 채우기
        renderCcStatusSelect();    // 상태값 드롭다운(기본 입찰)
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
            // 진행사항: 자동 보고 토글 ON 이면 불가/낙찰 보고서 자동 전송
            if (key === 'cc' && ccAutoReportOn()) sendCcReportAuto();
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
  // 진행사항 리스트/결과 초기화
  function clearCcList() {
    ccCases = []; ccResults.length = 0; ccSort = { key: '', dir: 1 }; ccRunUnchecked.clear();
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
      // 실행 전(pending)엔 ✓/✗ 대신 무표시
      const keyCell = (v, hit) => pending ? escapeHtml(v || '') : ccKeyCell(v, hit);
      const resCls = pending ? 'cc-pend' : (isBuga ? 'cc-bad' : (stateKind === '매각' ? 'cc-end' : (stateKind === '조회없음' || stateKind === '오류' ? 'cc-warn' : 'cc-ok')));
      const resBadge = `<span class="cc-badge ${resCls}">${escapeHtml(stateKind)}</span>`;
      const dtl = String(r.detail || '');
      const detail = dtl ? `<span title="${escapeAttr(dtl)}">${escapeHtml(dtl.length > 20 ? dtl.slice(0, 20) + '…' : dtl)}</span>` : '';
      const url = r.view_url ? ` <a href="#" class="cc-link" data-act="cc-view" data-url="${escapeAttr(r.view_url)}">옥션원</a>` : '';
      const willUpdate = isBuga
        ? `<b style="color:#b91c1c">불가</b>${r.status ? ` <span class="cc-badge cc-bad">${escapeHtml(r.status)}</span>` : ''}`
        : (!pending && stateKind === '매각' ? '<span class="cc-badge cc-end">매각</span>' : '<span style="color:#9ca3af">-</span>');
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
      // 비고: 불가 처리 시 MAPS 에 들어갈 사유/상세(취하/변경 등). MAPS note 아님
      const noteVal = isBuga ? [r.status, r.detail].filter(Boolean).join(' / ') : '';
      const noteCell = noteVal ? `<span title="${escapeAttr(noteVal)}">${escapeHtml(noteVal.length > 12 ? noteVal.slice(0, 12) + '…' : noteVal)}</span>` : '';
      const viewLink = r.view_url ? `<a href="#" class="cc-link" data-act="cc-view" data-url="${escapeAttr(r.view_url)}">옥션원</a>` : '';
      const rkey = ccKeyOf(r);
      const runChk = ccRunUnchecked.has(rkey) ? '' : 'checked';
      return `<tr data-idx="${i}" class="${isBuga ? 'cc-row-buga' : ''}">
        <td style="text-align:center"><input type="checkbox" class="cc-run-cb" data-key="${escapeAttr(rkey)}" ${runChk}></td>
        <td style="text-align:center"><input type="checkbox" class="cc-cb" ${isBuga ? 'checked' : ''}></td>
        <td>${keyCell(r.bid_date, r.date_hit !== false)}</td>
        <td>${keyCell(r.sakun_no, r.sakun_hit !== false)}</td>
        <td>${keyCell(r.court, r.court_hit !== false)}</td>
        <td>${escapeHtml(r.m_name || '')}</td>
        <td>${buyerCell}</td>
        <td style="text-align:right">${fmtWon(r.bidprice)}</td>
        <td style="text-align:right">${maeCell}</td>
        <td style="text-align:center">${resBadge}</td>
        <td style="text-align:center">${viewLink}</td>
        <td style="text-align:center">${stu ? `<span class="cc-badge cc-ok">${escapeHtml(stu)}</span>` : ''}</td>
        <td>${willUpdate}</td>
        <td class="cc-note">${noteCell}</td>
      </tr>`;
    }).join('');
    const doneCnt = merged.filter(r => !r._pending).length;
    const bugaCnt = merged.filter(r => r.is_buga).length;
    const maegakCnt = merged.filter(r => !r._pending && ccStateKind(r) === '매각').length;
    wrap.innerHTML = `
      <div class="cc-results-head">
        <span><b>${merged.length}건</b> (조회완료 ${doneCnt}) · <b style="color:#b91c1c">불가 ${bugaCnt}</b> · 매각 ${maegakCnt} · <span style="color:#9ca3af">실행=조회대상 · 업데이트=불가전송</span></span>
        <span class="mjcap-spacer"></span>
        <label style="font-size:12px;display:inline-flex;align-items:center;gap:3px;margin-right:6px;cursor:pointer" title="매칭(실행) 완료 시 불가/낙찰 보고서를 관리자에게 자동 전송">
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
  // 보고 대상 건 = 불가 또는 낙찰(매각)
  function ccReportItems() { return ccResults.filter(r => r && (r.is_buga || ccStateKind(r) === '매각')); }

  // 실제 전송 (target 지정)
  function doSendReport(target, auto) {
    const items = ccReportItems();
    if (!items.length) { if (!auto) alert('보고할 불가/낙찰 건이 없습니다.'); return; }
    const apiKey = getMapsAdminKeyMj();
    if (!apiKey) { if (!auto) alert('MAPS Admin Key 미설정 — 상단 ⚙(MAPS 연동) 설정에서 키를 먼저 저장하세요.'); return; }
    log('cc', `📋 보고서 전송 중… (${items.length}건 · 대상=${reportTargetLabel(target)}${auto ? ' · 자동' : ''})`, 'log-ok');
    fetch('/api/send-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, items, target })
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
  function sendCcReportAuto() { doSendReport(getReportTarget(), true); }   // 자동 보고(저장된 대상)

  // base64 → Blob
  function b64ToBlob(b64, type) {
    const bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'application/octet-stream' });
  }
  // 보고서 미리보기 — 전송 없이 PDF 새 탭 열람 (텔레그램/키 불필요)
  function previewCcReport() {
    const items = ccReportItems();
    if (!items.length) { alert('미리볼 불가/낙찰 건이 없습니다.'); return; }
    const btn = $card('cc')?.querySelector('[data-act="cc-preview"]');
    if (btn) btn.disabled = true;
    log('cc', `👁 보고서 미리보기 생성 중… (${items.length}건)`, 'log-ok');
    fetch('/api/preview-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
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

  // 대상 선택 모달
  function openReportPicker() {
    if (!ccReportItems().length) { alert('보고할 불가/낙찰 건이 없습니다.'); return; }
    let modal = document.getElementById('ccReportModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ccReportModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:99999';
      modal.innerHTML = `<div style="background:#fff;border-radius:10px;width:90%;max-width:560px;max-height:85vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb">
          <b>📋 보고 대상 선택</b><button type="button" data-act="rp-close" style="border:0;background:none;font-size:18px;cursor:pointer">✕</button></div>
        <div style="padding:14px 16px">
          <div style="margin-bottom:10px">
            <label style="margin-right:14px;cursor:pointer"><input type="radio" name="rpBy" value="gubun" checked> 회원관리 구분</label>
            <label style="cursor:pointer"><input type="radio" name="rpBy" value="members"> 회원명 직접선택</label>
          </div>
          <div data-role="rp-gubun" style="margin-bottom:8px">구분 <select data-role="rp-gubun-sel" style="min-width:150px;padding:3px"></select></div>
          <div data-role="rp-list" style="max-height:320px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px"></div>
          <div style="margin-top:7px;font-size:12px;color:#6b7280">✅연결=텔레그램 토큰 발급됨 · ▶사용=발송 ON. <b>연결+사용</b>이어야 전송됩니다(미연결은 비활성).</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #e5e7eb">
          <button type="button" class="btn_box_sss" data-act="rp-close">취소</button>
          <button type="button" class="btn_box_sss btn_blue bold" data-act="rp-send">📤 이 대상으로 전송</button>
        </div></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
      modal.querySelectorAll('[data-act="rp-close"]').forEach(b => b.addEventListener('click', () => modal.style.display = 'none'));
      modal.querySelectorAll('input[name="rpBy"]').forEach(rb => rb.addEventListener('change', () => renderReportPicker(false)));
      modal.querySelector('[data-role="rp-gubun-sel"]').addEventListener('change', () => renderReportPicker(false));
      modal.querySelector('[data-act="rp-send"]').addEventListener('click', submitReportPicker);
    }
    modal.style.display = 'flex';
    // 저장된 대상으로 라디오 초기화
    const saved = getReportTarget();
    modal.querySelector(`input[name="rpBy"][value="${saved.by === 'members' ? 'members' : 'gubun'}"]`).checked = true;
    fetchReportCandidates(() => renderReportPicker(true));
  }

  function renderReportPicker(initGubun) {
    const modal = document.getElementById('ccReportModal'); if (!modal || !_ccCandCache) return;
    const by = modal.querySelector('input[name="rpBy"]:checked').value;
    const gsel = modal.querySelector('[data-role="rp-gubun-sel"]');
    const listEl = modal.querySelector('[data-role="rp-list"]');
    modal.querySelector('[data-role="rp-gubun"]').style.display = (by === 'gubun') ? '' : 'none';
    if (initGubun) {
      const saved = getReportTarget();
      gsel.innerHTML = (_ccCandCache.gubuns || []).map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join('');
      if (saved.by === 'gubun' && saved.value) gsel.value = saved.value;
      else if ((_ccCandCache.gubuns || []).indexOf('관리자') >= 0) gsel.value = '관리자';
    }
    let members = _ccCandCache.members || [];
    if (by === 'gubun') { const g = gsel.value; members = members.filter(m => m.gubun === g); }
    const savedIds = (getReportTarget().member_ids || []).map(String);
    listEl.innerHTML = members.map(m => {
      const conn = m.has_token ? '<span style="color:#16a34a">✅연결</span>' : '<span style="color:#9ca3af">❌미연결</span>';
      const use = m.enabled ? '<span style="color:#2563eb">▶사용</span>' : '<span style="color:#9ca3af">⏸중지</span>';
      const chk = (by === 'members') ? (savedIds.indexOf(String(m.member_id)) >= 0 ? 'checked' : '') : 'checked';
      return `<label style="display:flex;gap:8px;align-items:center;padding:6px 9px;border-bottom:1px solid #f1f5f9;${m.ready ? '' : 'opacity:.5'}">
        <input type="checkbox" class="rp-cb" data-id="${escapeAttr(m.member_id)}" data-name="${escapeAttr(m.member_name)}" ${chk} ${m.ready ? '' : 'disabled'}>
        <span style="flex:1">${escapeHtml(m.member_name)} <span style="color:#9ca3af;font-size:11px">(${escapeHtml(m.gubun || '-')})</span></span>
        ${conn} <span style="width:6px"></span> ${use}</label>`;
    }).join('') || '<div style="padding:12px;color:#9ca3af">해당 회원이 없습니다.</div>';
  }

  function submitReportPicker() {
    const modal = document.getElementById('ccReportModal'); if (!modal) return;
    const by = modal.querySelector('input[name="rpBy"]:checked').value;
    let target;
    if (by === 'gubun') {
      target = { by: 'gubun', value: modal.querySelector('[data-role="rp-gubun-sel"]').value };
    } else {
      const ids = [], labels = [];
      modal.querySelectorAll('.rp-cb:checked').forEach(cb => { ids.push(cb.dataset.id); labels.push(cb.dataset.name); });
      if (!ids.length) { alert('회원을 1명 이상 선택하세요.'); return; }
      target = { by: 'members', member_ids: ids, labels: labels };
    }
    setReportTarget(target);
    modal.style.display = 'none';
    doSendReport(target, false);
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
