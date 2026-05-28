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
    i: { script: '01.i.py', title: '등록일 정렬',     hasLimit: true,  hasCases: false },
    d: { script: '02.d.py', title: '입찰일 정렬',     hasLimit: true,  hasCases: false },
    k: { script: '03.k.py', title: '건별 캡쳐',       hasLimit: false, hasCases: true  },
  };
  const runState = { i: null, d: null, k: null }; // run_id

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
    $log(key).textContent = '';
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
          if (code === 0) { setStatus(key, '완료', 'done'); log(key, '✅ 정상 종료 (exit ' + code + ')', 'log-ok'); }
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
    const el = $log(key);
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = line + '\n';
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }
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
