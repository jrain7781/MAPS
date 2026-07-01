// ====================================================================
// 옥션원 크롤링 매니저 - app.js
// 프리셋 / 추가 필터 종류 / UI 동작 일체.
// 저장소: localStorage (로컬 전용)
// ====================================================================

(function () {
  'use strict';

  const D = window.AUCTION1_DATA;

  // localStorage keys
  const LS_PRESETS  = 'auction1_presets_v1';   // [{id, title, formData, customFilters, updatedAt}]
  const LS_FTYPES   = 'auction1_ftypes_v1';    // [{id, name, valueType: 'text'|'number'|'date'}]
  const LS_CF_FAV   = 'auction1_cf_favorites_v1'; // 추가필터 즐겨찾기 [{id, typeId, op, value, logic}]
  const LS_CACHE_PFX  = 'auction1_cache_';      // (구) localStorage 옛 키 — IndexedDB 마이그레이션 후엔 메모리 + IndexedDB 사용

  // ── IndexedDB 캐시 (수백 MB 가능, localStorage 5MB quota 회피) ─────
  // 메모리 캐시 (sync 접근용) + IndexedDB 백업 (fire-and-forget write)
  const IDB_NAME = 'auction1_v1';
  const IDB_STORE = 'cache';   // key=presetId, value={items, ts, lite?}
  const _memCache = new Map();
  let _idbPromise = null;
  function _openIdb() {
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _idbPromise;
  }
  // 캐시 읽기 (sync, 메모리에서)
  function cacheGetSync(id) {
    return _memCache.get(id) || null;
  }
  // 캐시 저장 (sync 메모리 + 비동기 IndexedDB write)
  function cacheSet(id, value) {
    _memCache.set(id, value);
    _openIdb().then(db => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, id);
    }).catch(e => console.warn('[idb] put fail:', id, e));
    return true;
  }
  // 캐시 삭제 (sync 메모리 + 비동기 IndexedDB)
  function cacheDel(id) {
    _memCache.delete(id);
    _openIdb().then(db => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
    }).catch(e => console.warn('[idb] del fail:', id, e));
  }
  // 캐시 키 목록 (sync, 메모리)
  function cacheKeysSync() {
    return Array.from(_memCache.keys());
  }
  // init 시 IndexedDB 의 모든 캐시를 메모리로 로드 + 옛 localStorage 마이그레이션
  async function _initCache() {
    // 1) 옛 localStorage 의 LS_CACHE_PFX 캐시들 → IndexedDB + 메모리 옮긴 후 localStorage 비움
    const oldKeys = Object.keys(localStorage).filter(k => k.startsWith(LS_CACHE_PFX));
    for (const k of oldKeys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        const id = k.substring(LS_CACHE_PFX.length);
        _memCache.set(id, obj);
        // IndexedDB write (fire-and-forget)
        _openIdb().then(db => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(obj, id);
        }).catch(() => {});
        // 옛 localStorage 키 비움 (quota 회수)
        localStorage.removeItem(k);
      } catch (_) {}
    }
    // 2) IndexedDB 의 기존 데이터를 메모리로 로드
    try {
      const db = await _openIdb();
      await new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).openCursor();
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) {
            // localStorage 마이그레이션 직후 같은 key 면 덮어쓰기 X (메모리에 이미 최신 있음)
            if (!_memCache.has(cur.key)) _memCache.set(cur.key, cur.value);
            cur.continue();
          } else { res(); }
        };
        req.onerror = () => rej(req.error);
      });
    } catch (e) { console.warn('[idb] load fail:', e); }
    // 3) 영구 저장 권한 요청 (Chrome eviction 방지)
    if (navigator.storage && navigator.storage.persist) {
      try {
        const persisted = await navigator.storage.persist();
        console.log('[idb] persist:', persisted);
      } catch (_) {}
    }
    console.log(`[idb] 메모리 캐시 ${_memCache.size}개 로드 완료`);
  }
  const LS_UPLOAD_PFX = 'auction1_upload_ts_';   // + presetId → 마지막 MAPS 전송 timestamp(ms)
  const LS_LAST_PRESET = 'auction1_last_preset'; // 마지막 active preset id
  const LS_PRESET_ORDER = 'auction1_preset_order_v1';      // [id1, id2, ...] 사용자 드래그 순서
  const LS_TREE_COLLAPSED = 'auction1_tree_collapsed_v1';  // [path1, path2, ...] 접힌 폴더 경로
  const LS_SIDE_W = 'auction1_side_w';          // 사이드바 폭 (px)

  // 사이드바 폭 복원 + splitter 드래그 핸들러
  (function setupSideSplitter() {
    function clamp(w) { return Math.max(160, Math.min(600, w)); }
    // 복원
    try {
      var saved = parseInt(localStorage.getItem(LS_SIDE_W), 10);
      if (saved >= 160 && saved <= 600) {
        document.documentElement.style.setProperty('--side-w', saved + 'px');
        var layout = document.getElementById('appLayout');
        if (layout) layout.style.setProperty('--side-w', saved + 'px');
      }
    } catch (e) {}

    document.addEventListener('DOMContentLoaded', function () {
      var splitter = document.getElementById('sideSplitter');
      var layout   = document.getElementById('appLayout');
      if (!splitter || !layout) return;
      var dragging = false;
      var startX = 0, startW = 0;
      function getCurW() {
        var s = getComputedStyle(layout).getPropertyValue('--side-w').trim();
        var n = parseInt(s, 10);
        return isFinite(n) ? n : 240;
      }
      splitter.addEventListener('mousedown', function (e) {
        dragging = true;
        startX = e.clientX;
        startW = getCurW();
        splitter.classList.add('dragging');
        document.body.classList.add('col-resizing');
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var delta = e.clientX - startX;
        var w = clamp(startW + delta);
        layout.style.setProperty('--side-w', w + 'px');
      });
      document.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        splitter.classList.remove('dragging');
        document.body.classList.remove('col-resizing');
        var w = parseInt(getComputedStyle(layout).getPropertyValue('--side-w'), 10);
        if (w >= 160 && w <= 600) localStorage.setItem(LS_SIDE_W, String(w));
      });
      // 더블클릭 → 기본값(240) 복원
      splitter.addEventListener('dblclick', function () {
        layout.style.setProperty('--side-w', '240px');
        localStorage.setItem(LS_SIDE_W, '240');
      });
    });
  })();

  // 기본 추가 필터 종류 — FILTER_FIELDS 와 정확히 매칭되는 이름들
  // (사용자가 손으로 만들지 않아도 즉시 사용 가능)
  const DEFAULT_FTYPES = [
    { id: 'ft_failrate',  name: '유찰율',                  valueType: 'number' },
    { id: 'ft_failcnt',   name: '유찰 횟수',               valueType: 'number' },
    { id: 'ft_apprmin',   name: '감정가 최소 (만원)',      valueType: 'number' },
    { id: 'ft_address',   name: '주소',                    valueType: 'text'   },
    { id: 'ft_addrsido',  name: '주소 시도',               valueType: 'text'   },
    { id: 'ft_addrgugun', name: '주소 구군',               valueType: 'text'   },
    { id: 'ft_specials',  name: '특수물건',                valueType: 'special1' },
    { id: 'ft_specials_multi', name: '특수물건 다중',       valueType: 'specials' },
    { id: 'ft_propkind',  name: '물건종류',                valueType: 'text'   },
    { id: 'ft_keyword',   name: '비고/특이사항 키워드 포함', valueType: 'text'   },
    { id: 'ft_jicheung',  name: '지층 제거',               valueType: 'text'   },
    { id: 'ft_dae_hug_inc', name: '대항력(HUG포함)',       valueType: 'text'   }
  ];

  // 상태
  let presets = loadPresets();
  let ftypes  = loadFtypes();
  let currentPresetId = null;        // 편집 중 preset id (신규는 null)
  let multiPropSelected = new Set(); // 물건종류 복수선택 임시값 (모달 적용 시 폼에 반영)
  let addrTags = [];                 // 주소 추가 목록

  // ── localStorage 유틸 ────────────────────────────────────
  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(LS_PRESETS) || '[]'); } catch (e) { return []; }
  }
  function savePresets() { localStorage.setItem(LS_PRESETS, JSON.stringify(presets)); }
  function loadFtypes() {
    try {
      const raw = localStorage.getItem(LS_FTYPES);
      if (raw) {
        const arr = JSON.parse(raw);
        // 마이그레이션: DEFAULT_FTYPES 중 누락된 종류 자동 추가 (사용자 추가분은 보존)
        const have = new Set(arr.map(t => t.name));
        let changed = false;
        DEFAULT_FTYPES.forEach(d => {
          if (!have.has(d.name)) {
            arr.push({ id: uid('ft'), name: d.name, valueType: d.valueType });
            changed = true;
          }
        });
        // 마이그레이션: 단일 '특수물건'을 text → special1 (단일 콤보) 로 승격
        arr.forEach(t => {
          if (t.name === '특수물건' && t.valueType !== 'special1') { t.valueType = 'special1'; changed = true; }
        });
        if (changed) localStorage.setItem(LS_FTYPES, JSON.stringify(arr));
        return arr;
      }
    } catch (e) { }
    // 첫 실행 시 기본 시드
    localStorage.setItem(LS_FTYPES, JSON.stringify(DEFAULT_FTYPES));
    return DEFAULT_FTYPES.slice();
  }
  function saveFtypes() { localStorage.setItem(LS_FTYPES, JSON.stringify(ftypes)); }

  function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ── 옵션 채우기 ──────────────────────────────────────────
  function fillSelect(el, opts, placeholder) {
    if (!el) return;
    el.innerHTML = '';
    if (placeholder !== undefined) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = placeholder;
      el.appendChild(o);
    }
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.t;
      if (o.cls) opt.className = o.cls; // bg_yellow 등 그룹 헤더 색상
      el.appendChild(opt);
    });
  }
  function fillStaticSelects() {
    fillSelect(document.getElementById('f_court'),    D.COURTS);
    fillSelect(document.getElementById('f_branch'),   D.BRANCHES);
    fillSelect(document.getElementById('f_caseYear'), D.YEARS);
    fillSelect(document.getElementById('f_status'),   D.STATUS);
    fillSelect(document.getElementById('f_propType'), D.PROPERTY_FLAT);
    fillSelect(document.getElementById('f_addrSido'), D.SIDO);
    fillSelect(document.getElementById('f_special'),  D.SPECIAL);
    fillSelect(document.getElementById('f_orderBy'),  D.ORDER_BY);
  }

  // ── 특수물건 콤보박스 (검색 가능) ──────────────────────
  // <select id="f_special"> 는 form 직렬화/프리셋 호환을 위해 그대로 두고 (CSS로 숨김),
  // 위에 검색 가능한 input + 팝업 리스트를 띄워 동기화한다.
  function initSpecialCombo() {
    const sel    = document.getElementById('f_special');
    const inp    = document.getElementById('specialComboInput');
    const list   = document.getElementById('specialComboList');
    const toggle = document.getElementById('specialComboToggle');
    if (!sel || !inp || !list) return;

    // 리스트에서 "설정안함(선택해제)"(v:'') 는 제외 — 입력란을 비우면 그 효과.
    const items = (D.SPECIAL || []).filter(o => String(o.v) !== '');
    let activeIdx = -1; // 키보드 하이라이트 인덱스 (현재 필터된 결과 기준)
    let filtered  = items.slice();

    function labelOf(v) {
      const f = items.find(o => String(o.v) === String(v));
      return f ? f.t : '';
    }
    function syncInputFromSelect() {
      // 빈 값 = 설정안함 → 입력란을 비워서 placeholder 가 흐리게 보이도록.
      // (리스트에는 "설정안함(선택해제)" 항목이 그대로 있어 다시 비우려면 그걸 선택)
      inp.value = sel.value === '' ? '' : labelOf(sel.value);
    }
    function render(q) {
      // 공백 무시 검색: 쿼리/라벨 양쪽에서 모든 공백 제거 후 includes
      const qq = (q || '').replace(/\s+/g, '').toLowerCase();
      filtered = qq
        ? items.filter(o => (o.t || '').replace(/\s+/g, '').toLowerCase().includes(qq))
        : items.slice();
      list.innerHTML = filtered.map((o, i) => {
        const kwHtml = o.kw ? ' <span class="combo-kw">[' + escHtml(o.kw) + ']</span>' : '';
        return '<li class="combo-item' + (String(o.v) === String(sel.value) ? ' selected' : '') + '" data-v="' + escAttr(o.v) + '" data-i="' + i + '">' + escHtml(o.t) + kwHtml + '</li>';
      }).join('') || '<li class="combo-empty">결과 없음</li>';
      activeIdx = filtered.length ? 0 : -1;
      paintActive();
    }
    function paintActive() {
      list.querySelectorAll('.combo-item').forEach((el, i) => {
        el.classList.toggle('active', i === activeIdx);
      });
      const cur = list.querySelector('.combo-item.active');
      if (cur && list.classList.contains('hidden') === false) {
        const r1 = cur.getBoundingClientRect();
        const r2 = list.getBoundingClientRect();
        if (r1.top < r2.top) cur.scrollIntoView({ block: 'nearest' });
        else if (r1.bottom > r2.bottom) cur.scrollIntoView({ block: 'nearest' });
      }
    }
    function open() {
      list.classList.remove('hidden');
      render(inp.value);
      paintActive();
    }
    function close() { list.classList.add('hidden'); }
    function pick(o) {
      sel.value = o.v;
      inp.value = o.t;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      if (typeof window.__refreshHighlights === 'function') window.__refreshHighlights();
    }

    inp.addEventListener('focus', () => { inp.select(); open(); });
    inp.addEventListener('click', () => { inp.select(); open(); });
    inp.addEventListener('input', () => {
      // 입력을 모두 지우면 hidden select 도 빈 값(설정안함) 으로 동기화
      if (inp.value === '') {
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.__refreshHighlights === 'function') window.__refreshHighlights();
      }
      open(); render(inp.value);
    });
    inp.addEventListener('keydown', (e) => {
      if (list.classList.contains('hidden')) { if (e.key === 'ArrowDown' || e.key === 'Enter') { open(); e.preventDefault(); return; } }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx + 1) % filtered.length; paintActive(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; paintActive(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0 && filtered[activeIdx]) pick(filtered[activeIdx]); }
      else if (e.key === 'Escape') { close(); inp.blur(); }
    });
    toggle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (list.classList.contains('hidden')) { inp.focus(); open(); }
      else close();
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.combo-item');
      if (!li) return;
      e.preventDefault();
      const v = li.getAttribute('data-v');
      const o = items.find(it => String(it.v) === String(v));
      if (o) pick(o);
    });
    document.addEventListener('mousedown', (e) => {
      if (e.target === inp || e.target === toggle) return;
      if (list.contains(e.target)) return;
      close();
    });

    // 외부에서 (프리셋 로드 등) sel.value 가 바뀐 뒤 호출
    window.__refreshSpecialCombo = syncInputFromSelect;
    syncInputFromSelect();
  }

  // ── MAPS 동기화 선택 상태 ───────────────────────────────
  // 사이드바 체크박스 (preset id Set). 새로고침 시 초기화 (영구 저장 X).
  let selectedSyncIds = new Set();

  // ── 트리 구조 헬퍼 ─────────────────────────────────────
  function _loadPresetOrder() {
    try { return JSON.parse(localStorage.getItem(LS_PRESET_ORDER) || '[]'); } catch (_) { return []; }
  }
  function _savePresetOrder(arr) {
    try { localStorage.setItem(LS_PRESET_ORDER, JSON.stringify(arr)); } catch (_) {}
  }
  function _loadCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_TREE_COLLAPSED) || '[]')); } catch (_) { return new Set(); }
  }
  function _saveCollapsed(set) {
    try { localStorage.setItem(LS_TREE_COLLAPSED, JSON.stringify(Array.from(set))); } catch (_) {}
  }
  // 저장된 사용자 순서 + 신규 preset 은 끝에 append
  function _getOrderedPresets() {
    const order = _loadPresetOrder();
    const byId = new Map(presets.map(p => [p.id, p]));
    const out = [];
    order.forEach(id => { if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); } });
    presets.forEach(p => { if (byId.has(p.id)) out.push(p); });
    return out;
  }
  // 제목을 '-' 로 분할하여 트리 빌드 (각 path 노드: label, path, children Map, presets 배열)
  function _buildPresetTree(ordered) {
    const root = { label: '', path: '', children: new Map(), presets: [] };
    ordered.forEach(p => {
      const parts = String(p.title || '(제목없음)').split('-').map(s => s.trim()).filter(Boolean);
      if (!parts.length) parts.push('(제목없음)');
      let node = root, path = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        path = path ? (path + '/' + part) : part;
        if (!node.children.has(part)) node.children.set(part, { label: part, path: path, children: new Map(), presets: [] });
        node = node.children.get(part);
        if (i === parts.length - 1) node.presets.push(p);
      }
    });
    return root;
  }
  function _countSubtreePresets(node) {
    let n = node.presets.length;
    node.children.forEach(c => { n += _countSubtreePresets(c); });
    return n;
  }
  function _collectSubtreeIds(node) {
    const ids = node.presets.map(p => p.id);
    node.children.forEach(c => { ids.push(..._collectSubtreeIds(c)); });
    return ids;
  }
  function _collectSubtreePresetObjs(node) {
    const arr = node.presets.slice();
    node.children.forEach(c => { arr.push(..._collectSubtreePresetObjs(c)); });
    return arr;
  }
  function _branchCheckState(ids) {
    if (!ids.length) return 'none';
    let n = 0;
    ids.forEach(id => { if (selectedSyncIds.has(id)) n++; });
    return n === 0 ? 'none' : (n === ids.length ? 'all' : 'some');
  }
  // 노드 서브트리 합산 카운트 (filtered/total)
  function _subtreeCounts(node) {
    let total = 0, filtered = 0;
    const accFor = (p) => {
      try {
        const cache = cacheGetSync(p.id);
        if (!cache) return;
        const items = cache.items || [];
        const rawN = items.length;
        let fN = rawN;
        try {
          const rows = (p.id === currentPresetId) ? custRows : (p.customFilters || []);
          const { items: filt } = applyCustomFilters(items, rows);
          fN = filt.length;
        } catch (_) {}
        total += rawN;
        filtered += fN;
      } catch (_) {}
    };
    node.presets.forEach(accFor);
    node.children.forEach(c => {
      const s = _subtreeCounts(c);
      total += s.total; filtered += s.filtered;
    });
    return { total, filtered };
  }
  function _renderLeafLi(p, depth, isLast, fullLabel) {
    const active = p.id === currentPresetId ? ' active' : '';
    const checked = selectedSyncIds.has(p.id) ? ' checked' : '';
    let countInline = '', lastCrawl = '';
    try {
      const cache = cacheGetSync(p.id);
      if (cache) {
        const items = cache.items || [];
        const rawN = items.length;
        let filteredN = rawN;
        try {
          const filtersToUse = (p.id === currentPresetId) ? custRows : (p.customFilters || []);
          const { items: filt } = applyCustomFilters(items, filtersToUse);
          filteredN = filt.length;
        } catch (_) {}
        countInline = `<span class="it-count">(<span class="cnt-filtered">${filteredN}</span>/<span class="cnt-total">${rawN}</span>)</span>`;
        if (cache.ts) lastCrawl = new Date(cache.ts).toLocaleString('ko-KR', { hour12: false });
      }
    } catch (_) {}
    const subText = lastCrawl ? `최근 크롤링: ${lastCrawl}` : '아직 크롤링하지 않음';
    let lastUpload = '';
    try {
      const ts = parseInt(localStorage.getItem(LS_UPLOAD_PFX + p.id) || '0', 10);
      if (ts) lastUpload = new Date(ts).toLocaleString('ko-KR', { hour12: false });
    } catch (_) {}
    const uploadLine = lastUpload ? `<div class="it-sub it-upload" title="MAPS 마지막 전송 시각">최근 전송: ${lastUpload}</div>` : '';
    // leaf 라벨 = 제목의 마지막 hyphen 부분만 (간결). fullLabel=평면 단일 항목은 전체 제목.
    const parts = String(p.title || '').split('-').map(s => s.trim()).filter(Boolean);
    const leafLabel = fullLabel
      ? (parts.length ? parts.join(' - ') : (p.title || '(제목없음)'))
      : (parts.length ? parts[parts.length - 1] : (p.title || '(제목없음)'));
    return `<li class="snb_item${active}" data-id="${p.id}" data-kind="leaf" data-depth="${depth}" draggable="true" style="padding-left:${depth * 16 + 8}px">
      <span class="drag-handle" title="드래그로 순서 변경">⋮⋮</span>
      <input type="checkbox" class="ms-row-chk" data-id="${p.id}"${checked} title="MAPS 동기화 선택">
      <span class="it-name" title="${escHtml(p.title || '')}">${escHtml(leafLabel)}</span>
      <span class="it-counts">${countInline}</span>
    </li>`;
  }
  function _renderTreeChildren(node, depth, collapsed) {
    let html = '';
    // 같은 부모 아래 자식들: presets 들과 children 합쳐 한 시퀀스로 (마지막 항목 tc-last)
    const entries = [];
    node.presets.forEach(p => entries.push({ kind: 'leaf', preset: p }));
    node.children.forEach(c => entries.push({ kind: 'child', child: c }));
    entries.forEach((entry, idx) => {
      const isLast = (idx === entries.length - 1);
      if (entry.kind === 'leaf') {
        html += _renderLeafLi(entry.preset, depth, isLast);
        return;
      }
      const child = entry.child;
      const isSimpleLeaf = (child.children.size === 0 && child.presets.length === 1);
      if (isSimpleLeaf) {
        html += _renderLeafLi(child.presets[0], depth, isLast);
        return;
      }
      const isCollapsed = collapsed.has(child.path);
      const cnt = _countSubtreePresets(child);
      const ids = _collectSubtreeIds(child);
      const cs = _branchCheckState(ids);
      const checkedAttr = cs === 'all' ? 'checked' : '';
      const sc = _subtreeCounts(child);
      const subtreeN = _countSubtreePresets(child);
      const childCntHtml = `<span class="b-child-count">(${subtreeN})</span>`;
      const summaryHtml = (sc.total > 0)
        ? `<span class="it-count b-summary">(<span class="cnt-filtered">${sc.filtered}</span>/<span class="cnt-total">${sc.total}</span>)</span>`
        : '';
      html += `<li class="snb_branch${isCollapsed ? ' collapsed' : ''}" data-path="${escHtml(child.path)}" data-ids="${ids.join(',')}" data-kind="branch" data-depth="${depth}" draggable="true" style="padding-left:${depth * 16 + 8}px">
        <span class="drag-handle" title="드래그로 순서 변경">⋮⋮</span>
        <input type="checkbox" class="b-check" ${checkedAttr} title="이 그룹 전체 선택/해제">
        <span class="b-label">${escHtml(child.label)}</span>
        <span class="b-counts">${childCntHtml}${summaryHtml}</span>
      </li>`;
      if (!isCollapsed) {
        html += _renderTreeChildren(child, depth + 1, collapsed);
      }
    });
    return html;
  }

  // 최상단 그룹별 카드 렌더 (각 카드 = root 의 직속 자식 하나)
  function _renderTopCard(top, collapsed) {
    const ids = _collectSubtreeIds(top);
    const cs = _branchCheckState(ids);
    const checkedAttr = cs === 'all' ? 'checked' : '';
    const cnt = _countSubtreePresets(top);
    const sc = _subtreeCounts(top);
    const isCollapsed = collapsed.has(top.path);
    // body — _renderTreeChildren 가 top.presets + top.children 를 통합 순서로 처리 (isLast 마킹)
    let body = '';
    if (!isCollapsed) {
      body = _renderTreeChildren(top, 1, collapsed);
    }
    const subtreeN = _countSubtreePresets(top);
    const cardChildCntHtml = `<span class="card-child-count">(${subtreeN})</span>`;
    const cardSummaryHtml = (sc.total > 0)
      ? `<span class="it-count card-summary">(<span class="cnt-filtered">${sc.filtered}</span>/<span class="cnt-total">${sc.total}</span>)</span>`
      : '';
    return `<li class="snb_card" data-path="${escHtml(top.path)}" data-ids="${ids.join(',')}" data-kind="card" draggable="true">
      <div class="card-head" data-path="${escHtml(top.path)}" data-ids="${ids.join(',')}">
        <span class="drag-handle" title="드래그로 순서 변경">⋮⋮</span>
        <input type="checkbox" class="card-check" ${checkedAttr} title="이 카드 전체 선택/해제">
        <span class="card-icon">📁</span>
        <span class="card-title">${escHtml(top.label)}</span>
        <span class="card-counts">${cardChildCntHtml}${cardSummaryHtml}</span>
      </div>
      <ul class="card-body${isCollapsed ? ' collapsed' : ''}">${body}</ul>
    </li>`;
  }

  // ── 사이드바 렌더 (트리 + 드래그 순서 저장) ─────────────────
  function renderSidebar() {
    const list  = document.getElementById('sideList');
    const empty = document.getElementById('sideEmpty');
    if (!presets.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      syncCheckAllState();
      return;
    }
    if (empty) empty.style.display = 'none';
    const ordered = _getOrderedPresets();
    const tree = _buildPresetTree(ordered);
    const collapsed = _loadCollapsed();
    // 최상단 그룹별 카드 렌더 (root.children 의 각 직속 자식 = 1 카드)
    // 단, 그 그룹에 속한 리스트가 1개뿐이면 폴더 카드 없이 1단계 평면 항목으로 표시.
    let html = '';
    tree.children.forEach(top => {
      if (_countSubtreePresets(top) === 1) {
        html += _renderLeafLi(_collectSubtreePresetObjs(top)[0], 0, true, true);
      } else {
        html += _renderTopCard(top, collapsed);
      }
    });
    list.innerHTML = html;
    // leaf 클릭/체크박스/드래그
    list.querySelectorAll('.snb_item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target && e.target.classList && (e.target.classList.contains('ms-row-chk') || e.target.classList.contains('drag-handle'))) return;
        loadPreset(el.dataset.id);
      });
      _bindDragOn(el, 'leaf');
    });
    list.querySelectorAll('.ms-row-chk').forEach(chk => {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) selectedSyncIds.add(id); else selectedSyncIds.delete(id);
        syncCheckAllState();
      });
    });
    // 폴더 접기/펴기 (브랜치) + 드래그
    list.querySelectorAll('.snb_branch').forEach(b => {
      b.addEventListener('click', (e) => {
        const cl = e.target && e.target.classList;
        if (cl && (cl.contains('b-check') || cl.contains('drag-handle'))) return;
        const c = _loadCollapsed();
        const path = b.dataset.path;
        if (c.has(path)) c.delete(path); else c.add(path);
        _saveCollapsed(c);
        renderSidebar();
      });
      _bindDragOn(b, 'branch');
    });
    // 브랜치 체크박스 — 하위 모든 preset 토글
    list.querySelectorAll('.b-check').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        const li = cb.closest('.snb_branch');
        const ids = String(li?.dataset.ids || '').split(',').filter(Boolean);
        if (cb.checked) ids.forEach(id => selectedSyncIds.add(id));
        else ids.forEach(id => selectedSyncIds.delete(id));
        renderSidebar();
      });
    });
    // 카드 헤더 클릭 (체크박스/드래그 제외) → 카드 접기/펴기
    list.querySelectorAll('.card-head').forEach(h => {
      h.addEventListener('click', (e) => {
        const cl = e.target && e.target.classList;
        if (cl && (cl.contains('card-check') || cl.contains('drag-handle'))) return;
        const c = _loadCollapsed();
        const path = h.dataset.path;
        if (c.has(path)) c.delete(path); else c.add(path);
        _saveCollapsed(c);
        renderSidebar();
      });
    });
    // 카드 자체 드래그 (1단계)
    list.querySelectorAll('.snb_card').forEach(card => {
      _bindDragOn(card, 'card');
    });
    // 카드 체크박스 — 카드 전체 하위 토글
    list.querySelectorAll('.card-check').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        const head = cb.closest('.card-head');
        const ids = String(head?.dataset.ids || '').split(',').filter(Boolean);
        if (cb.checked) ids.forEach(id => selectedSyncIds.add(id));
        else ids.forEach(id => selectedSyncIds.delete(id));
        renderSidebar();
      });
    });
    // 브랜치 체크박스 indeterminate (부분 선택) 상태 설정
    list.querySelectorAll('.snb_branch').forEach(b => {
      const cb = b.querySelector('.b-check');
      const ids = String(b.dataset.ids || '').split(',').filter(Boolean);
      const st = _branchCheckState(ids);
      if (cb) cb.indeterminate = (st === 'some');
    });
    list.querySelectorAll('.card-head').forEach(h => {
      const cb = h.querySelector('.card-check');
      const ids = String(h.dataset.ids || '').split(',').filter(Boolean);
      const st = _branchCheckState(ids);
      if (cb) cb.indeterminate = (st === 'some');
    });
    syncCheckAllState();
  }
  function _reorderPresetById(draggedId, targetId, before) {
    let order = _loadPresetOrder();
    presets.forEach(p => { if (!order.includes(p.id)) order.push(p.id); });
    order = order.filter(id => id !== draggedId);
    const targetIdx = order.indexOf(targetId);
    if (targetIdx < 0) order.push(draggedId);
    else order.splice(before ? targetIdx : targetIdx + 1, 0, draggedId);
    _savePresetOrder(order);
    renderSidebar();
  }
  // path 로 노드 찾기 (tree 안에서)
  function _findNodeByPath(root, path) {
    if (!path) return root;
    const parts = String(path).split('/');
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) return null;
      node = node.children.get(part);
    }
    return node;
  }
  // 서브트리 단위 드래그 reorder — draggedPath 의 모든 leaf 들을 targetPath 의 첫 leaf 앞으로 이동
  function _reorderSubtreeByPath(draggedPath, targetPath, before) {
    if (!draggedPath || !targetPath || draggedPath === targetPath) return;
    const ordered = _getOrderedPresets();
    const tree = _buildPresetTree(ordered);
    const dragNode = _findNodeByPath(tree, draggedPath);
    const tgtNode = _findNodeByPath(tree, targetPath);
    if (!dragNode || !tgtNode) return;
    const draggedIds = _collectSubtreeIds(dragNode);
    const targetIds = _collectSubtreeIds(tgtNode);
    if (!draggedIds.length || !targetIds.length) return;
    let order = _loadPresetOrder();
    presets.forEach(p => { if (!order.includes(p.id)) order.push(p.id); });
    order = order.filter(id => !draggedIds.includes(id));
    let insertIdx;
    if (before) {
      insertIdx = order.indexOf(targetIds[0]);
    } else {
      // 타겟 subtree 의 마지막 id 위치 + 1
      let lastIdx = -1;
      targetIds.forEach(id => { const i = order.indexOf(id); if (i > lastIdx) lastIdx = i; });
      insertIdx = lastIdx + 1;
    }
    if (insertIdx < 0) order.push(...draggedIds);
    else order.splice(insertIdx, 0, ...draggedIds);
    _savePresetOrder(order);
    renderSidebar();
  }
  // 드래그 공용 핸들러 — DOM 요소에 dragstart/dragover/drop 바인딩
  function _bindDragOn(el, kind) {
    el.addEventListener('dragstart', (e) => {
      const key = (kind === 'leaf') ? el.dataset.id : el.dataset.path;
      try { e.dataTransfer.setData('text/plain', JSON.stringify({ kind, key })); } catch (_) {}
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
      e.stopPropagation();
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); _clearDropMarkers(); });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 위/아래 결정 — 마우스 Y 가 중앙 위쪽이면 'above', 아래면 'below'
      const rect = el.getBoundingClientRect();
      const isAbove = e.clientY < (rect.top + rect.height / 2);
      el.classList.remove('drop-above', 'drop-below');
      el.classList.add(isAbove ? 'drop-above' : 'drop-below');
      e.stopPropagation();
    });
    el.addEventListener('dragleave', () => { el.classList.remove('drop-above', 'drop-below'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const before = el.classList.contains('drop-above');
      el.classList.remove('drop-above', 'drop-below');
      let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (_) { data = {}; }
      if (!data.kind || data.kind !== kind) return;  // same-kind drops only
      if (kind === 'leaf') {
        if (data.key !== el.dataset.id) _reorderPresetById(data.key, el.dataset.id, before);
      } else {
        if (data.key !== el.dataset.path) _reorderSubtreeByPath(data.key, el.dataset.path, before);
      }
    });
  }
  function _clearDropMarkers() {
    document.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
  }

  // 상단 [전체] 체크박스 상태 동기화 (선택 수 ↔ 전체 체크 일치)
  function syncCheckAllState() {
    const all = document.getElementById('msCheckAll');
    if (all) {
      const total = presets.length;
      const sel = selectedSyncIds.size;
      if (sel === 0) { all.checked = false; all.indeterminate = false; }
      else if (sel === total) { all.checked = true; all.indeterminate = false; }
      else { all.checked = false; all.indeterminate = true; }
    }
    // 사이드바 하단 [선택 합계] 갱신 — 체크된 리스트의 캐시 items 합산
    try {
      const elN = document.getElementById('sfSelN');
      const elF = document.getElementById('sfFiltered');
      const elT = document.getElementById('sfTotal');
      if (elN && elF && elT) {
        let totalSum = 0, filteredSum = 0;
        const targets = presets.filter(p => selectedSyncIds.has(p.id));
        targets.forEach(p => {
          let cache = null;
          try { cache = cacheGetSync(p.id); } catch (_) {}
          if (!cache || !Array.isArray(cache.items)) return;
          const rawN = cache.items.length;
          let fN = rawN;
          try {
            const rows = (p.id === currentPresetId) ? custRows : (p.customFilters || []);
            const { items: filt } = applyCustomFilters(cache.items, rows);
            fN = filt.length;
          } catch (_) {}
          totalSum += rawN;
          filteredSum += fN;
        });
        elN.textContent = String(targets.length);
        elF.textContent = filteredSum.toLocaleString('ko-KR');
        elT.textContent = totalSum.toLocaleString('ko-KR');
      }
    } catch (_) {}
  }

  // ── MAPS 동기화 ─────────────────────────────────────────
  const LS_MAPS_KEY = 'auction1_maps_admin_key';
  function getMapsAdminKey() { try { return localStorage.getItem(LS_MAPS_KEY) || ''; } catch (e) { return ''; } }
  function setMapsAdminKey(k) { try { localStorage.setItem(LS_MAPS_KEY, k || ''); } catch (e) {} }

  // ── 옥션원 계정 (3슬롯, 활성 1개 선택) ──────────────────
  const LS_ACCOUNTS = 'auction1_accounts_v1';
  const LS_ACTIVE_ACCOUNT = 'auction1_active_account_v1';
  const DEFAULT_ACCOUNTS = [
    { id: 'mjgold', pw: '28471298', label: '계정 1' },
    { id: '',       pw: '',          label: '계정 2' },
    { id: '',       pw: '',          label: '계정 3' },
  ];
  function getAccounts() {
    try {
      const raw = localStorage.getItem(LS_ACCOUNTS);
      if (!raw) return DEFAULT_ACCOUNTS.map(a => ({ ...a }));
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return DEFAULT_ACCOUNTS.map(a => ({ ...a }));
      const out = arr.slice(0, 3).map((a, i) => ({
        id: String((a && a.id) || ''),
        pw: String((a && a.pw) || ''),
        label: String((a && a.label) || `계정 ${i + 1}`),
      }));
      while (out.length < 3) out.push({ id: '', pw: '', label: `계정 ${out.length + 1}` });
      return out;
    } catch (_) { return DEFAULT_ACCOUNTS.map(a => ({ ...a })); }
  }
  function setAccounts(arr) {
    try { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(arr)); } catch (_) {}
  }
  function getActiveAccountIdx() {
    try {
      const v = Number(localStorage.getItem(LS_ACTIVE_ACCOUNT));
      return (Number.isFinite(v) && v >= 0 && v < 3) ? v : 0;
    } catch (_) { return 0; }
  }
  function setActiveAccountIdx(i) {
    try { localStorage.setItem(LS_ACTIVE_ACCOUNT, String(i)); } catch (_) {}
  }
  function getActiveAccount() {
    const accs = getAccounts();
    const i = getActiveAccountIdx();
    return accs[i] || accs[0] || { id: '', pw: '', label: '계정 1' };
  }
  function getActiveAccountLabel() {
    const a = getActiveAccount();
    return a.id ? `${a.label} · ${a.id}` : `${a.label || '계정'} (미설정)`;
  }
  // 계정별 검증 결과 (성공/실패 + 검증일시) — 활성 계정 변경/PW 수정해도 보존
  const LS_ACCOUNT_VERIFY = 'auction1_account_verify_v1';
  function getAllAccountVerify() {
    try { return JSON.parse(localStorage.getItem(LS_ACCOUNT_VERIFY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function getAccountVerify(idx) {
    const v = getAllAccountVerify()[String(idx)];
    return (v && typeof v === 'object') ? v : null;
  }
  function setAccountVerify(idx, result) {
    const all = getAllAccountVerify();
    all[String(idx)] = {
      ok: !!result.ok,
      ts: Date.now(),
      reason: String(result.reason || ''),
    };
    try { localStorage.setItem(LS_ACCOUNT_VERIFY, JSON.stringify(all)); } catch (_) {}
  }
  function _fmtVerifyTs(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  }
  function _renderVerifyBadge(v) {
    if (!v) return '<span class="vr vr-busy" style="opacity:0.6;">미검증</span>';
    const ts = _fmtVerifyTs(v.ts);
    const reason = (v.reason || '').replace(/"/g, '&quot;');
    return v.ok
      ? `<span class="vr vr-ok" title="${reason}">✓ 성공 · ${ts}</span>`
      : `<span class="vr vr-fail" title="${reason}">✗ 실패 · ${ts}</span>`;
  }
  function renderAccountSlots() {
    const host = document.getElementById('accountSlots');
    if (!host) return;
    const accs = getAccounts();
    const activeIdx = Number(document.getElementById('setActiveAccount')?.value || 0);
    host.innerHTML = accs.map((a, i) => `
      <div class="account-slot${i === activeIdx ? ' active' : ''}" data-idx="${i}">
        <div class="account-slot-head">
          <span>${escHtml(a.label || ('계정 ' + (i + 1)))}</span>
          <span class="account-verify-result" id="accVerifyResult${i}">${_renderVerifyBadge(getAccountVerify(i))}</span>
          <button type="button" class="btn_box_sss btn_white btn-verify" data-idx="${i}" title="이 ID/PW 로 옥션원에 실제 로그인 시도">검증하기</button>
          ${i === activeIdx ? '<span class="badge-active">● 활성</span>' : ''}
        </div>
        <div class="account-slot-row">
          <label>ID</label>
          <input type="text" id="setAcc${i}Id" value="${escAttr(a.id)}" placeholder="옥션원 ID" autocomplete="off" />
        </div>
        <div class="account-slot-row">
          <label>PW</label>
          <input type="password" id="setAcc${i}Pw" value="${escAttr(a.pw)}" placeholder="비밀번호" autocomplete="off" />
          <button type="button" class="btn-toggle-pw" data-target="setAcc${i}Pw">👁</button>
        </div>
      </div>
    `).join('');
    host.querySelectorAll('.btn-toggle-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = document.getElementById(btn.dataset.target);
        if (!t) return;
        t.type = (t.type === 'password') ? 'text' : 'password';
      });
    });
    host.querySelectorAll('.btn-verify').forEach(btn => {
      btn.addEventListener('click', () => verifyAccountInModal(Number(btn.dataset.idx)));
    });
  }

  async function verifyAccountInModal(i) {
    const id = (document.getElementById(`setAcc${i}Id`)?.value || '').trim();
    const pw = (document.getElementById(`setAcc${i}Pw`)?.value || '');
    const resEl = document.getElementById(`accVerifyResult${i}`);
    const btn = document.querySelector(`.btn-verify[data-idx="${i}"]`);
    if (!resEl) return;
    if (!id || !pw) {
      resEl.innerHTML = '<span class="vr vr-fail">✗ ID/PW 입력 필요</span>';
      return;
    }
    resEl.innerHTML = '<span class="vr vr-busy">검증 중... (옥션원 로그인 시도)</span>';
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/verify-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, pw })
      });
      const data = await r.json();
      // 결과 + 검증일시 저장 — 모달 닫아도 보존, 일괄 크롤 모달 헤더에서도 사용
      setAccountVerify(i, { ok: !!data.success, reason: data.reason });
      resEl.innerHTML = _renderVerifyBadge(getAccountVerify(i));
    } catch (e) {
      setAccountVerify(i, { ok: false, reason: '서버 오류 — ' + (e.message || e) });
      resEl.innerHTML = _renderVerifyBadge(getAccountVerify(i));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── 크롤링 설정 (설정 모달) ─────────────────────────────
  const LS_CRAWL_SETTINGS = 'auction1_crawl_settings_v1';
  const DEFAULT_CRAWL_SETTINGS = {
    useSessionReuse: true,    // login_if_needed force=False — 30분 TTL 활용
    verifyLogin: true,        // 로그인 후 로그아웃 표시 elem 확인
    retryEnabled: true,       // 0건+비로그인 감지 시 재시도
    retryCount: 2,
    retryBackoffSec: [5, 15], // 길이=retryCount, 부족하면 마지막 값 반복
    batchIntervalSec: 3,      // 일괄 크롤 매 프리셋 사이 대기 (초)
    headless: false,          // 크롤링 Selenium 창 숨김(헤드리스)
  };
  function getCrawlSettings() {
    try {
      const raw = localStorage.getItem(LS_CRAWL_SETTINGS);
      if (!raw) return { ...DEFAULT_CRAWL_SETTINGS };
      const v = JSON.parse(raw);
      // 누락 키는 기본값으로 보정
      return { ...DEFAULT_CRAWL_SETTINGS, ...v };
    } catch (_) { return { ...DEFAULT_CRAWL_SETTINGS }; }
  }
  function setCrawlSettings(s) {
    try { localStorage.setItem(LS_CRAWL_SETTINGS, JSON.stringify(s)); } catch (_) {}
  }
  function _parseBackoffStr(s) {
    return String(s || '').split(',')
      .map(x => Number(String(x).trim()))
      .filter(n => Number.isFinite(n) && n >= 0);
  }
  function openSettingsModal() {
    const s = getCrawlSettings();
    const m = document.getElementById('settingsModal');
    if (!m) return;
    document.getElementById('setMapsKey').value = getMapsAdminKey();
    // 옥션원 계정
    document.getElementById('setActiveAccount').value = String(getActiveAccountIdx());
    renderAccountSlots();
    // 크롤링 설정
    document.getElementById('setUseSessionReuse').checked = !!s.useSessionReuse;
    document.getElementById('setVerifyLogin').checked = !!s.verifyLogin;
    document.getElementById('setRetryEnabled').checked = !!s.retryEnabled;
    document.getElementById('setRetryCount').value = Number(s.retryCount) || 0;
    document.getElementById('setRetryBackoff').value = (s.retryBackoffSec || []).join(', ');
    document.getElementById('setBatchInterval').value = Number(s.batchIntervalSec) || 0;
    const hd = document.getElementById('setHeadless'); if (hd) hd.checked = !!s.headless;
    m.classList.remove('hidden');
  }
  function closeSettingsModal() {
    document.getElementById('settingsModal')?.classList.add('hidden');
  }
  function saveSettingsModal() {
    const newKey = (document.getElementById('setMapsKey').value || '').trim();
    setMapsAdminKey(newKey);
    // 옥션원 계정 3슬롯 수집 + 활성 인덱스
    const accs = [];
    for (let i = 0; i < 3; i++) {
      accs.push({
        id: (document.getElementById(`setAcc${i}Id`)?.value || '').trim(),
        pw: (document.getElementById(`setAcc${i}Pw`)?.value || ''),
        label: `계정 ${i + 1}`,
      });
    }
    setAccounts(accs);
    setActiveAccountIdx(Number(document.getElementById('setActiveAccount').value) || 0);
    // 크롤링 설정
    const s = {
      useSessionReuse: document.getElementById('setUseSessionReuse').checked,
      verifyLogin:     document.getElementById('setVerifyLogin').checked,
      retryEnabled:    document.getElementById('setRetryEnabled').checked,
      retryCount:      Math.max(0, Number(document.getElementById('setRetryCount').value) || 0),
      retryBackoffSec: _parseBackoffStr(document.getElementById('setRetryBackoff').value),
      batchIntervalSec: Math.max(0, Number(document.getElementById('setBatchInterval').value) || 0),
      headless:        !!document.getElementById('setHeadless')?.checked,
    };
    setCrawlSettings(s);
    // 모달 유지 — 사용자가 PW 저장 후 바로 [검증하기] 누를 수 있게. 닫기는 [✕]/[취소]/[닫기] 로만.
    // 활성 슬롯 강조도 갱신 (활성 계정 dropdown 변경 후 저장한 경우)
    renderAccountSlots();
    // inline 토스트 (head 안에 잠깐 뜨고 사라짐)
    const toast = document.getElementById('settingsSaveToast');
    if (toast) {
      toast.textContent = `✓ 저장됨 · 활성: ${getActiveAccountLabel()}`;
      toast.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(() => toast.classList.remove('show'), 2500);
    }
    setStatus(`설정 저장됨 — 활성 계정: ${getActiveAccountLabel()}`);
  }
  function resetSettingsModal() {
    if (!confirm('권장값으로 되돌릴까요? (저장 버튼 누르기 전엔 적용 안 됨)')) return;
    const s = { ...DEFAULT_CRAWL_SETTINGS };
    document.getElementById('setUseSessionReuse').checked = s.useSessionReuse;
    document.getElementById('setVerifyLogin').checked = s.verifyLogin;
    document.getElementById('setRetryEnabled').checked = s.retryEnabled;
    document.getElementById('setRetryCount').value = s.retryCount;
    document.getElementById('setRetryBackoff').value = s.retryBackoffSec.join(', ');
    document.getElementById('setBatchInterval').value = s.batchIntervalSec;
    const hd = document.getElementById('setHeadless'); if (hd) hd.checked = s.headless;
  }

  function onMsCheckAllChange(e) {
    const checked = !!e.target.checked;
    selectedSyncIds = new Set();
    if (checked) presets.forEach(p => selectedSyncIds.add(p.id));
    renderSidebar();
  }

  // [전체] 텍스트 클릭 → 트리 전체 펼치기/접기 토글
  // (체크박스 자체 click 은 onMsCheckAllChange 가 처리 — 선택/해제만)
  function toggleAllTreeCollapsed() {
    try {
      const ordered = _getOrderedPresets();
      const tree = _buildPresetTree(ordered);
      const allPaths = [];
      (function walk(node) {
        if (node.path) allPaths.push(node.path);
        node.children.forEach(c => walk(c));
      })(tree);
      const cur = _loadCollapsed();
      if (cur.size === 0) {
        _saveCollapsed(new Set(allPaths));      // 모두 펼침 → 모두 접기
      } else {
        _saveCollapsed(new Set());              // 일부 접힘 → 모두 펼치기
      }
      renderSidebar();
    } catch (_) {}
  }

  // ── 옥션원 raw 데이터 정제 ───────────────────────────────
  // 사건번호 "24-102685" → "24타경102685"
  function _normSakun(s) {
    if (!s) return '';
    var t = String(s).replace(/[\r\n\t]+/g, ' ').trim();
    if (/타경/.test(t)) return t.replace(/\s+/g, '');
    var m = t.match(/^(\d{2,4})-(\d+)/);
    if (m) return m[1] + '타경' + m[2];
    return t;
  }
  // "2026.05.26\n(10:00)\n입찰 14일전" → { bid_date: "260526", bid_time: "10:00" }
  function _parseBid(s) {
    if (!s) return { bid_date: '', bid_time: '' };
    var t = String(s).replace(/[\r\n\t]+/g, ' ').trim();
    var dm = t.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
    var tm = t.match(/(\d{1,2}):(\d{2})/);
    return {
      bid_date: dm ? dm[1].slice(-2) + ('0' + dm[2]).slice(-2) + ('0' + dm[3]).slice(-2) : '',
      bid_time: tm ? ('0' + tm[1]).slice(-2) + ':' + tm[2] : ''
    };
  }
  // "315,000,000\n315,000,000\n평당 1,299만원" → { kamjungka, low_price, pyeong_price } (숫자만)
  function _parsePrice(s) {
    if (!s) return { kamjungka: '', low_price: '', pyeong_price: '' };
    var lines = String(s).split(/[\r\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    function num(x) { return String(x || '').replace(/[^\d]/g, ''); }
    var pyeong = '';
    if (lines[2]) pyeong = num(lines[2].replace(/평당|만원|만/g, ''));
    return {
      kamjungka:    num(lines[0]),
      low_price:    num(lines[1]),
      pyeong_price: pyeong
    };
  }
  // "유찰 13회\n(100%)" → { fail_count: "13", fail_rate: "100" }
  function _parseStatus(s) {
    if (!s) return { fail_count: '', fail_rate: '' };
    var t = String(s).replace(/[\r\n\t]+/g, ' ').trim();
    var cm = t.match(/유찰\s*(\d+)\s*회/);
    var rm = t.match(/\((\d+)\s*%\)/);
    return {
      fail_count: cm ? cm[1] : '',
      fail_rate:  rm ? rm[1] : ''
    };
  }
  // view_count "533" 또는 "201 2일전" → 맨 앞 숫자만
  function _parseViewCount(s) {
    if (!s) return '';
    var t = String(s).replace(/[\r\n\t]+/g, ' ').trim();
    var m = t.match(/^(\d+)/);
    return m ? m[1] : '';
  }
  // 주소 등 일반 정제: 줄바꿈/탭 제거
  function _normText(s) {
    if (!s) return '';
    return String(s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // address raw 3~4 라인 분리: { address, size_info, specials_all, issue }
  function _parseAddress(s) {
    var out = { address: '', size_info: '', specials_all: '', issue: '' };
    if (!s) return out;
    var lines = String(s).split(/[\r\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (lines[0]) out.address = lines[0];
    function strip(x) { return x.replace(/^\[|\]$/g, '').trim(); }
    for (var i = 1; i < lines.length; i++) {
      var ln = lines[i];
      if (/투기과열|조정대상|개발제한|토지거래/.test(ln)) {
        out.issue = strip(ln);
      } else if (/㎡|평|대지권|건물|계약/.test(ln)) {
        out.size_info = strip(ln);
      } else {
        // 그 외 [...] 라인 = 특수전체로 취급
        if (!out.specials_all) out.specials_all = strip(ln);
        else out.specials_all += ' / ' + strip(ln);
      }
    }
    return out;
  }

  // 매니저 item → josa_items 스키마 매핑 (정제 적용, 필드 분리) — uploadSelected + sendChecked 공용
  function _mapItemForMaps(it) {
    const bid = _parseBid(it.bid_date);
    const pr  = _parsePrice(it.price);
    const st  = _parseStatus(it.status);
    const addr = _parseAddress(it.address);
    return {
      sakun_no:     _normSakun(it.sakun_no),
      bid_date:     bid.bid_date,
      bid_time:     bid.bid_time,
      court:        _normText(it.court || ''),
      address:      addr.address,
      size_info:    addr.size_info,
      specials_all: addr.specials_all,
      issue:        addr.issue,
      prop_kind:    _normText(it.prop_kind),
      specials:     Array.isArray(it.specials) ? it.specials.join(',') : _normText(it.specials),
      kamjungka:    pr.kamjungka,
      low_price:    pr.low_price,
      pyeong_price: pr.pyeong_price,
      area:         '',
      fail_count:   st.fail_count,
      fail_rate:    st.fail_rate,
      view_count:   _parseViewCount(it.view_count),
      view_url:     String(it.view_url || '').trim(),
      img_url:      String(it.img_url || '').trim(),
    };
  }

  // 배치 크롤링 활성 플래그 — runCrawl 내부 alert 억제용
  let __batchCrawlActive__ = false;

  // ── 일괄 크롤링 모달 헬퍼 ──
  function openBatchModal(targets, customTitle) {
    const m = document.getElementById('batchCrawlModal');
    if (!m) return;
    const list = document.getElementById('batchModalList');
    const prog = document.getElementById('batchModalProgress');
    const close = document.getElementById('batchModalClose');
    const titleEl = m.querySelector('.batch-modal-title');
    if (titleEl) titleEl.textContent = customTitle || '🔄 일괄 크롤링 진행';
    list.innerHTML = targets.map((p, i) =>
      '<div class="b-item" id="b-item-' + i + '">' +
        '<span class="b-icon">⏳</span>' +
        '<span class="b-title" title="' + escHtml(p.title || p.id) + '">' + escHtml(p.title || p.id) + '</span>' +
        '<span class="b-sub" id="b-sub-' + i + '">대기</span>' +
      '</div>'
    ).join('');
    prog.textContent = '0 / ' + targets.length;
    // 진행 모달 헤더에 활성 계정 + 검증여부/일시 표시 (PW 는 절대 표시 안 함)
    const accSpan = document.getElementById('batchModalAccount');
    if (accSpan) {
      const v = getAccountVerify(getActiveAccountIdx());
      let tag = '';
      if (v) {
        tag = v.ok
          ? ` · <span class="vr vr-ok">✓ 검증 ${_fmtVerifyTs(v.ts)}</span>`
          : ` · <span class="vr vr-fail" title="${(v.reason||'').replace(/"/g,'&quot;')}">✗ 검증실패 ${_fmtVerifyTs(v.ts)}</span>`;
      } else {
        tag = ' · <span class="vr vr-busy" style="opacity:0.7;">⚠ 미검증</span>';
      }
      accSpan.innerHTML = '🔑 ' + escHtml(getActiveAccountLabel()) + tag;
    }
    close.disabled = true;
    close.onclick = closeBatchModal;
    m.classList.remove('hidden');
  }
  function updateBatchItem(idx, statusCls, icon, sub) {
    const el = document.getElementById('b-item-' + idx);
    if (!el) return;
    el.classList.remove('b-running', 'b-done', 'b-fail');
    if (statusCls) el.classList.add(statusCls);
    const iconEl = el.querySelector('.b-icon');
    if (iconEl && icon != null) iconEl.textContent = icon;
    const subEl = document.getElementById('b-sub-' + idx);
    if (subEl && sub != null) subEl.textContent = sub;
  }
  function updateBatchProgress(done, total) {
    const p = document.getElementById('batchModalProgress');
    if (p) p.textContent = done + ' / ' + total;
  }
  function finishBatchModal() {
    const c = document.getElementById('batchModalClose');
    if (c) c.disabled = false;
  }
  function closeBatchModal() {
    const m = document.getElementById('batchCrawlModal');
    if (m) m.classList.add('hidden');
  }

  // ── 일괄 크롤링 (체크된 리스트들을 순차적으로 크롤링) ──
  async function batchCrawlCheckedPresets() {
    if (!selectedSyncIds.size) { alert('일괄 크롤링할 리스트를 사이드바 체크박스로 선택하세요.'); return; }
    const targets = presets.filter(p => selectedSyncIds.has(p.id));
    if (!confirm(`체크된 ${targets.length}개 리스트를 순차적으로 크롤링합니다.\n각 리스트마다 옥션원 fetch + 이미지 base64 변환.\n진행 상황은 모달에 실시간 표시됩니다.\n\n진행할까요?`)) return;

    const btn = document.getElementById('btnBatchCrawl');
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '진행 중…'; }
    __batchCrawlActive__ = true;

    openBatchModal(targets);

    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      updateBatchItem(i, 'b-running', '🔄', '시작 중…');
      __batchStatusObserver__ = function (msg) {
        if (typeof msg === 'string' && msg) updateBatchItem(i, 'b-running', '🔄', msg.length > 60 ? msg.substring(0, 60) + '…' : msg);
      };
      try {
        loadPreset(p.id);
        await runCrawl();
        // 직전 크롤의 가로채기/캐시 정보 (runCrawl 이 마지막 응답을 _lastCrawlMeta 로 보관)
        const meta = window._lastCrawlMeta || {};
        const hijackN = Number(meta.hijack_count) || 0;
        const hijackDetected = !!meta.hijack_detected;
        const rawCount = Number(meta.raw_count) || 0;
        const cacheSaved = !!meta.cache_saved;
        // 성공 케이스의 꼬리표: retry 로 복구된 경우만
        const hijackTag = hijackN > 0 ? ` ⚠가로채기${hijackN}회 복구` : '';
        let n = 0;
        try {
          const cache = cacheGetSync(p.id);
          n = (cache && Array.isArray(cache.items)) ? cache.items.length : 0;
        } catch (_) {}
        if (n > 0) {
          updateBatchItem(i, 'b-done', '✓', n + '건 캐시 완료' + hijackTag);
          results.push({ title: p.title || p.id, ok: true, count: n, hijack: hijackN });
        } else if (rawCount > 0 && !cacheSaved) {
          // ★ 옥션원에선 정상 받았는데 frontend localStorage quota 초과로 캐시 저장 실패
          // "0건" 으로 잘못 표시하지 말고 정확히 안내
          updateBatchItem(i, 'b-warning', '✓', rawCount + '건 받음 (⚠ 캐시 저장 실패: 결과 너무 큼. 새로고침 시 사라짐. MAPS 전송은 가능)' + hijackTag);
          results.push({ title: p.title || p.id, ok: true, count: rawCount, warn: true, cacheFailed: true });
        } else {
          // 0건 — 원인 4분기 (PW 오류가 가장 명확하므로 최우선)
          let warnMsg;
          if (meta.auth_error) {
            warnMsg = `🚨 0건 — PW 오류 자동 감지: "${meta.auth_error_reason || '인증 거부'}". 활성 계정 검증결과 자동 ✗ 갱신됨. ⚙ 에서 PW 수정 + 재검증 필요`;
          } else if (hijackN > 0) {
            warnMsg = `🚨 0건 — 가로채기 ${hijackN}회 복구 시도했으나 실패. ⚙ [검증하기] 로 ID/PW 확인 + 단일 재시도 권장`;
          } else if (hijackDetected) {
            warnMsg = `🚨 0건 — 옥션원 비로그인 감지 (PW 오류 또는 세션 가로채기). ⚙ [검증하기] 로 확인 권장 (재시도 OFF 라 자동 복구 없음)`;
          } else {
            warnMsg = '0건 — 옥션원에 검색결과 자체가 0건이거나 옥션원 응답 이상. 단일 [크롤링 실행] 으로 재확인 권장';
          }
          updateBatchItem(i, 'b-warning', '⚠', warnMsg);
          results.push({ title: p.title || p.id, ok: false, count: 0, warn: true, hijack: hijackN, hijackDetected, authError: !!meta.auth_error });
        }
      } catch (e) {
        const errMsg = (e && e.message) || String(e);
        updateBatchItem(i, 'b-fail', '✗', errMsg.length > 60 ? errMsg.substring(0, 60) + '…' : errMsg);
        results.push({ title: p.title || p.id, ok: false, err: errMsg });
      }
      // ★ 현재 i 의 옵저버 즉시 해제 — leftover setStatus 가 직전 i 박스를 'b-running' 으로 되돌리는 사고 방지
      __batchStatusObserver__ = null;
      updateBatchProgress(i + 1, targets.length);
      // 다음 리스트 처리 전 짧은 대기 — 설정 모달의 batchIntervalSec 사용 (테스트=1, 야간=3)
      if (i < targets.length - 1) {
        const waitMs = Math.max(0, (Number(getCrawlSettings().batchIntervalSec) || 0) * 1000);
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      }
    }

    __batchStatusObserver__ = null;
    __batchCrawlActive__ = false;
    if (btn) { btn.disabled = false; btn.textContent = prevText; }
    setStatus('');
    renderSidebar();  // 최근 크롤링 시각 즉시 반영
    finishBatchModal();
  }

  // ── MAPS 전송 (사이드바 체크된 리스트들의 캐시 items 일괄 → josa_items + 메타 sync) ──
  async function sendCheckedListsToMaps() {
    if (!selectedSyncIds.size) { alert('전송할 리스트를 사이드바 체크박스로 선택하세요.'); return; }
    const adminKey = getMapsAdminKey();
    if (!adminKey) { alert('MAPS Admin Key 미설정 — ⚙ 버튼으로 설정.'); return; }

    const targets = presets.filter(p => selectedSyncIds.has(p.id));
    // 캐시 확인 — 캐시 없는 리스트는 사용자에게 알림. 캐시는 raw(필터 전)라 추가필터 적용 필요.
    const withItems = [];
    const noCache = [];
    for (const p of targets) {
      let cache = null;
      try { cache = cacheGetSync(p.id); } catch (_) {}
      if (cache && Array.isArray(cache.items) && cache.items.length) {
        // 활성 preset 은 미저장 변경 가능성 — custRows 우선, 그외 저장된 p.customFilters
        const rows = (p.id === currentPresetId) ? custRows : (p.customFilters || []);
        const { items: filtered } = applyCustomFilters(cache.items, rows);
        if (filtered.length) {
          withItems.push({ preset: p, items: filtered, rawCount: cache.items.length, filteredCount: filtered.length });
        } else {
          noCache.push(p); // 필터 후 0건이면 캐시없음 취급
        }
      } else {
        noCache.push(p);
      }
    }
    if (noCache.length) {
      const names = noCache.map(p => '- ' + (p.title || p.id)).join('\n');
      const msg = `다음 리스트는 크롤링 캐시가 없어 전송 불가:\n${names}\n\n해당 리스트 열고 [크롤링 실행] 후 다시 시도하세요.`;
      if (!withItems.length) { alert(msg); return; }
      if (!confirm(msg + `\n\n캐시 있는 ${withItems.length}개만 전송할까요?`)) return;
    }

    const btn = document.getElementById('btnSendToMaps');
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '전송 중…'; }

    // 1) 메타데이터 sync (한번에) — 보고서용 라벨/필터/캐시 통계 같이 push
    try {
      const syncTargets = withItems.map(x => _buildSyncPresetEntry(x.preset, x));
      const r = await fetch('/api/maps-sync-presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: adminKey, presets: syncTargets, mode: 'partial' })
      });
      const d = await r.json();
      if (!d.success) {
        alert('리스트 동기화 실패: ' + (d.message || d.error || JSON.stringify(d)));
        if (btn) { btn.disabled = false; btn.textContent = prevText; }
        return;
      }
    } catch (e) {
      alert('동기화 호출 실패: ' + (e && e.message ? e.message : e));
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
      return;
    }

    // 2) 각 리스트별 items 업로드 (sequential)
    let totalAdded = 0, totalUpdated = 0, totalFailed = 0;
    const okList = [], failList = [];
    for (let i = 0; i < withItems.length; i++) {
      const { preset, items } = withItems[i];
      setStatus(`[${i + 1}/${withItems.length}] ${preset.title || preset.id} 업로드 중…`);
      const mapped = items.map(_mapItemForMaps);
      try {
        const r = await fetch('/api/maps-upload-items', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: adminKey,
            preset_id: preset.id,
            preset_title: preset.title || '',
            items: mapped,
          })
        });
        const d = await r.json();
        if (!d.success) {
          failList.push(`${preset.title || preset.id}: ${d.message || d.error || '?'}`);
        } else {
          totalAdded += (d.added || 0);
          totalUpdated += (d.updated || 0);
          totalFailed += (d.failed || 0);
          try { localStorage.setItem(LS_UPLOAD_PFX + preset.id, String(Date.now())); } catch (_) {}
          okList.push(`${preset.title || preset.id}: 추가필터 ${withItems[i].filteredCount}/${withItems[i].rawCount} → 신규${d.added || 0} 갱신${d.updated || 0}` + ((d.recon_deleted || d.recon_marked) ? ` · 정리(삭제${d.recon_deleted || 0}/이탈${d.recon_marked || 0})` : ''));
        }
      } catch (e) {
        failList.push(`${preset.title || preset.id}: ${e && e.message ? e.message : e}`);
      }
    }

    let msg = `MAPS 전송 완료\n성공 ${okList.length} / 실패 ${failList.length}\n총 신규 ${totalAdded} · 갱신 ${totalUpdated}`;
    if (okList.length) msg += '\n\n[성공]\n' + okList.join('\n');
    if (failList.length) msg += '\n\n[실패]\n' + failList.join('\n');
    alert(msg);
    if (btn) { btn.disabled = false; btn.textContent = prevText; }
    setStatus('');
    renderSidebar();
  }

  // ── MAPS 업로드 (현재 결과 화면의 체크된 items → josa_items) ──
  async function uploadSelectedItemsToMaps() {
    if (!currentPresetId) { alert('활성 크롤링 리스트가 없습니다. (사이드바에서 리스트 선택 후 크롤링 결과가 떠 있어야 함)'); return; }
    const adminKey = getMapsAdminKey();
    if (!adminKey) {
      alert('MAPS Admin Key가 설정되지 않았습니다. 사이드바 [⚙] 버튼으로 먼저 설정하세요.');
      return;
    }
    if (!Array.isArray(lastItems) || !lastItems.length) {
      alert('업로드할 크롤링 결과가 없습니다. [크롤링 실행] 먼저 해주세요.');
      return;
    }
    // 체크된 행 — 없으면 보이는 결과 전체로 동작
    const checked = Array.from(document.querySelectorAll('#resBody .res-cb:checked'));
    let targetItems;
    if (checked.length) {
      targetItems = checked.map(cb => lastItems[parseInt(cb.dataset.idx, 10)]).filter(Boolean);
    } else {
      if (!confirm(`체크된 행이 없습니다.\n현재 화면의 전체 ${lastItems.length}건을 MAPS로 업로드할까요?`)) return;
      targetItems = lastItems.slice();
    }
    if (!targetItems.length) { alert('업로드할 항목이 없습니다.'); return; }

    const preset = presets.find(p => p.id === currentPresetId);
    const presetTitle = preset ? (preset.title || '') : '';

    // 매니저 item → josa_items 스키마 매핑 (정제 적용, 필드 분리)
    const items = targetItems.map(it => {
      const bid = _parseBid(it.bid_date);
      const pr  = _parsePrice(it.price);
      const st  = _parseStatus(it.status);
      const addr = _parseAddress(it.address);
      return {
        sakun_no:     _normSakun(it.sakun_no),
        bid_date:     bid.bid_date,
        bid_time:     bid.bid_time,
        court:        _normText(it.court || ''),  // crawler.py 에서 주소 기반 매핑된 법원명
        address:      addr.address,
        size_info:    addr.size_info,
        specials_all: addr.specials_all,
        issue:        addr.issue,
        prop_kind:    _normText(it.prop_kind),
        specials:     Array.isArray(it.specials) ? it.specials.join(',') : _normText(it.specials),
        kamjungka:    pr.kamjungka,
        low_price:    pr.low_price,
        pyeong_price: pr.pyeong_price,
        area:         '',
        fail_count:   st.fail_count,
        fail_rate:    st.fail_rate,
        view_count:   _parseViewCount(it.view_count),
        view_url:     String(it.view_url || '').trim(),
        img_url:      String(it.img_url || '').trim(),
      };
    });

    const btn = document.getElementById('btnUploadMaps');
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'MAPS 업로드 중…'; }
    try {
      // 1) 리스트(preset) 메타 sync — josa_presets 시트에 현재 preset 등록/갱신
      try {
        const syncResp = await fetch('/api/maps-sync-presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: adminKey, presets: [{ id: currentPresetId, title: presetTitle }], mode: 'partial' })
        });
        const syncData = await syncResp.json();
        if (!syncData.success) {
          // sync 실패해도 items 업로드는 진행 (preset 행이 없어도 josa_items 행 자체는 누적됨)
          console.warn('[MAPS] preset sync 실패 (items 업로드는 계속):', syncData.message || syncData.error);
        }
      } catch (e) { console.warn('[MAPS] preset sync 호출 실패:', e); }

      // 2) items 업로드
      const resp = await fetch('/api/maps-upload-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: adminKey,
          preset_id: currentPresetId,
          preset_title: presetTitle,
          items: items,
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        alert('MAPS items 업로드 실패: ' + (data.message || data.error || JSON.stringify(data)));
      } else {
        try { localStorage.setItem(LS_UPLOAD_PFX + currentPresetId, String(Date.now())); } catch (_) {}
        const reconMsg = (data.recon_deleted || data.recon_marked || data.recon_detached)
          ? `\n\n리스트 정리 — 미분류 삭제 ${data.recon_deleted || 0} · 이탈 마킹 ${data.recon_marked || 0}` + (data.recon_detached ? ` · 타리스트 분리 ${data.recon_detached}` : '')
          : '';
        alert(`MAPS items 업로드 완료\n신규: ${data.added}  |  갱신: ${data.updated}  |  실패: ${data.failed || 0}\n총 ${data.total}건 전송` + reconMsg);
        renderSidebar();
      }
    } catch (e) {
      alert('MAPS 업로드 호출 실패: ' + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  async function syncSelectedPresetsToMaps() {
    const adminKey = getMapsAdminKey();
    if (!adminKey) {
      alert('MAPS Admin Key가 설정되지 않았습니다. ⚙ 버튼으로 먼저 설정하세요.');
      return;
    }
    if (!presets.length) { alert('매니저에 리스트가 없습니다.'); return; }
    // 매니저 전체 preset 송신 (mode=full) — 매니저에 없는 MAPS preset 은 "삭제됨" 마킹
    // 보고서용 라벨/필터/캐시 통계 같이 push
    const targets = presets.map(p => _buildSyncPresetEntry(p, null));
    if (!confirm(`매니저 전체 ${targets.length}개 리스트를 MAPS 와 정합 동기화합니다.\n\n· 매니저 ↔ MAPS 양쪽에 있는 리스트: 갱신\n· MAPS 에만 있는 리스트(매니저에서 삭제됨): "삭제됨" 빨강 마킹 (실제 삭제는 사용자가 MAPS JM 트리에서 직접)\n\n진행할까요?`)) return;
    const btn = document.getElementById('btnSyncToMaps');
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '동기화 중…'; }
    try {
      const resp = await fetch('/api/maps-sync-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: adminKey, presets: targets, mode: 'full' }),
      });
      const data = await resp.json();
      if (!data.success) {
        alert('MAPS 동기화 실패: ' + (data.message || data.error || JSON.stringify(data)));
      } else {
        const msg = `MAPS 동기화 완료 (mode=${data.mode})\n` +
                    `신규: ${data.added}  |  갱신: ${data.updated}  |  복원: ${data.restored || 0}  |  매니저 삭제 마킹: ${data.marked_deleted || 0}\n` +
                    `총 ${data.total}건 전송`;
        alert(msg);
      }
    } catch (e) {
      alert('MAPS 동기화 호출 실패: ' + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  // ── 폼 → 객체, 객체 → 폼 ────────────────────────────────
  function collectFormData() {
    const form = document.getElementById('filterForm');
    const data = {};
    Array.from(form.elements).forEach(el => {
      if (!el.name) return;
      data[el.name] = el.value;
    });
    // 옛 문자열 항목 자동 변환 후 전송 (옥션원 select value 까지 포함된 객체로)
    data._addrTags = addrTags.map(_addrTagNormalize);
    data._multiProp = Array.from(multiPropSelected);
    return data;
  }
  function applyFormData(data) {
    const form = document.getElementById('filterForm');
    Array.from(form.elements).forEach(el => {
      if (!el.name) return;
      el.value = (data && data[el.name] != null) ? data[el.name] : '';
    });
    // backward compat: 옛 프리셋의 _addrTags 는 문자열 배열, 신규는 객체 배열
    // 옛 객체 (sido:"") 또는 문자열 → _addrTextToObj 로 자동 매핑
    addrTags = (data && Array.isArray(data._addrTags)) ? data._addrTags.map(function (a) {
      if (a && typeof a === 'object' && a.sido) return a;  // sido 있는 객체만 그대로
      var txt = (a && typeof a === 'object') ? (a.text || '') : String(a || '');
      return _addrTextToObj(txt);
    }) : [];
    renderAddrTags();
    multiPropSelected = new Set((data && Array.isArray(data._multiProp)) ? data._multiProp : []);
    renderMultiPropTags();
    if (typeof window.__refreshSpecialCombo === 'function') window.__refreshSpecialCombo();
    if (typeof window.__refreshHighlights === 'function') window.__refreshHighlights();
  }
  function clearForm() { applyFormData({}); }

  // ── 주소 태그 ──────────────────────────────────────────
  // addrTags 항목 → 표시용 텍스트 (객체 또는 문자열 둘 다 지원)
  function _addrTagText(a) { return (a && typeof a === 'object') ? (a.text || '') : String(a || ''); }

  // 텍스트("서울" / "서울 강남구") → 옥션원 value 객체로 변환 (옛 문자열 형식 자동 마이그레이션)
  function _addrTextToObj(text) {
    var t = String(text || '').trim();
    if (!t) return { text: '', sido: '', gugun: '', dong: '' };
    var parts = t.split(/\s+/);
    var sidoTxt = parts[0] || '', gugunTxt = parts[1] || '', dongTxt = parts[2] || '';
    var sidoOpt = (D.SIDO || []).find(function (x) { return x.t === sidoTxt; });
    var sido_v = sidoOpt ? sidoOpt.v : '';
    var gugun_v = '';
    if (sido_v && gugunTxt) {
      var list = (D.GUGUN_BY_SIDO || {})[sido_v] || [];
      var gOpt = list.find(function (x) { return x.t === gugunTxt; });
      if (gOpt) gugun_v = gOpt.v;
    }
    return { text: t, sido: sido_v, gugun: gugun_v, dong: '' };  // dong 은 옥션원 동적 로드라 무시
  }
  // addrTags 항목 정규화 (객체이지만 sido 빈 값이면 재변환, 문자열이면 변환)
  function _addrTagNormalize(a) {
    if (a && typeof a === 'object' && a.sido) return a;  // sido 채워진 객체만 그대로
    var txt = (a && typeof a === 'object') ? (a.text || '') : String(a || '');
    return _addrTextToObj(txt);
  }

  function renderAddrTags() {
    const wrap = document.getElementById('addrTags');
    if (!wrap) return;
    const has = addrTags.length > 0;
    ['f_addrSido', 'f_addrGugun', 'f_addrDong'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('has-multi-bg', has);
    });
    if (!has) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = addrTags.map((a, i) =>
      `<span class="addr-tag">${escHtml(_addrTagText(a))} <button data-i="${i}" title="제거">×</button></span>`
    ).join('');
    wrap.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        addrTags.splice(parseInt(b.dataset.i, 10), 1);
        renderAddrTags();
      });
    });
  }
  function renderMultiPropTags() {
    const wrap = document.getElementById('multiPropTags');
    if (!wrap) return;
    const has = multiPropSelected.size > 0;
    const sel = document.getElementById('f_propType');
    if (sel) sel.classList.toggle('has-multi-bg', has);
    if (!has) { wrap.innerHTML = ''; return; }
    const idToText = {};
    D.PROPERTY_GROUPS.forEach(g => g.items.forEach(it => { idToText[it.v] = it.t; }));
    wrap.innerHTML = Array.from(multiPropSelected).map(v =>
      `<span class="multi-tag">${escHtml(idToText[v] || v)}</span>`
    ).join('');
  }

  // 종류별 권장 op/값 (선택 시 자동 채움)
  const TYPE_PRESETS = {
    '유찰율':                              { op: 'lte', value: '50' },
    '유찰 횟수':                           { op: 'gte', value: '2' },
    '감정가 최소 (만원)':                  { op: 'gte', value: '10000' },
    '주소':                                { op: 'contains',  value: '' },
    '주소 시도':                           { op: 'ncontains', value: '' },
    '주소시도':                            { op: 'ncontains', value: '' },
    '주소 구군':                           { op: 'ncontains', value: '' },
    '주소구군':                            { op: 'ncontains', value: '' },
    '특수물건':                            { op: 'ncontains', value: '대항력' },
    '특수물건 다중':                       { op: 'ncontains', value: '' },
    '특수권리':                            { op: 'ncontains', value: '대항력' },
    '물건종류':                            { op: 'contains',  value: '' },
    '비고/특이사항 키워드 포함':           { op: 'contains',  value: '' },
    '대항력(HUG포함)':                     { op: 'ncontains', value: '제거대상' },
    '대항력(HUG제외)':                     { op: 'ncontains', value: '제거대상' },
    '대항력 (HUG제외)':                    { op: 'ncontains', value: '제거대상' },
    '대항력 제거':                         { op: 'ncontains', value: '대항력' },
    '지층 제거':                           { op: 'ncontains', value: '지*층' }
  };

  // 값이 고정되어 수정 불가한 필터 종류 (선택만 하면 동작) — { 종류명: 고정값 }
  const LOCKED_FILTER_VALUES = {
    '지층 제거': '지*층'
  };

  // 종류별 동작 설명 (행에 인라인 표시)
  const TYPE_HINTS = {
    '유찰율':                              '단위: % (51 = 51%). 예) ≤ 50',
    '유찰 횟수':                           '예) ≥ 2 → 유찰 2회 이상',
    '감정가 최소 (만원)':                  '단위: 만원. 예) ≥ 10000 = 1억 이상',
    '주소':                                '주소 전체 텍스트 검색. 콤마 다중 키워드',
    '주소 시도':                           '시/도(첫 단어). 예) 미포함 "서울,경기"',
    '주소시도':                            '시/도(첫 단어). 예) 미포함 "서울,경기"',
    '주소 구군':                           '구/군(둘째 단어). 예) 미포함 "강남구,서초구"',
    '주소구군':                            '구/군(둘째 단어). 예) 미포함 "강남구,서초구"',
    '특수물건':                            '대항력/임차권등기/HUG/유치권 등 빨강 표시',
    '특수물건 다중':                       '버튼으로 항목 다중 선택. 포함=어느 하나라도, 미포함=모두 제외',
    '특수권리':                            '대항력/임차권등기/HUG/유치권 등 빨강 표시',
    '물건종류':                            '예) "다세대" / "오피스텔" 포함',
    '비고/특이사항 키워드 포함':           '주소+상태+종류+특수물건 통합 검색',
    '대항력(HUG포함)':                     '대항력+HUG 같이 있으면 살림. 대항력만 있으면 제거 (미포함 "제거대상")',
    '대항력(HUG제외)':                     '대항력+HUG 같이 있으면 살림. 대항력만 있으면 제거 (미포함 "제거대상")',
    '대항력 (HUG제외)':                    '대항력+HUG 같이 있으면 살림. 대항력만 있으면 제거 (미포함 "제거대상")',
    '대항력 제거':                         '대항력 있는 행 무조건 제거 (HUG 여부 무관). 미포함 "대항력"',
    '지층 제거':                           '주소에 지N층/지하N층 있으면 제거 (값 고정 "지*층", 수정 불가)'
  };

  // ── 추가 필터 행 렌더링 ───────────────────────────────────
  let custRows = []; // [{typeId, op, value}]
  function renderCustRows() {
    const wrap = document.getElementById('custFilterRows');
    if (!custRows.length) {
      wrap.innerHTML = `<div class="cust-empty">추가된 필터 조건이 없습니다. 아래 [+ 필터 조건 추가]를 눌러 추가하세요.</div>`;
      return;
    }
    wrap.innerHTML = custRows.map((r, i) => {
      // 종류 드롭다운 — 이름순(한글) 정렬해 비슷한 항목이 모이게 ('+새 종류'는 항상 맨끝)
      const typeOpts = ftypes.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
                       .map(t => `<option value="${t.id}"${t.id === r.typeId ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('')
                       + `<option value="__new__">+ 새 필터 종류 추가...</option>`;
      const opOpts = D.CUSTOM_OPS.map(o => `<option value="${o.v}"${o.v === r.op ? ' selected' : ''}>${o.t}</option>`).join('');
      const t = ftypes.find(x => x.id === r.typeId);
      const hint = (t && TYPE_HINTS[t.name]) || '';
      const isSpecials = t && t.valueType === 'specials';
      const isSingleSpecial = t && t.valueType === 'special1';
      const lockedVal = t && LOCKED_FILTER_VALUES[t.name];
      let valHtml;
      if (isSingleSpecial) {
        // 단일 특수물건 — 위 데이터필터링 특수물건과 동일한 자동완성+드롭다운(1개 선택)
        const curLabel = String(r.value || '').trim();
        valHtml = `<div class="combo-box fspecial1-combo" data-i="${i}" style="width:240px;flex:0 0 auto;">
                     <input type="text" class="combo-input fspecial1-input" value="${escAttr(curLabel)}" placeholder="설정안함(선택해제)" autocomplete="off">
                     <button type="button" class="combo-caret fspecial1-caret" tabindex="-1" title="펼치기">▾</button>
                     <ul class="combo-pop fspecial1-pop hidden"></ul>
                   </div>`;
      } else if (isSpecials) {
        const tags = String(r.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const tagsHtml = tags.length
          ? tags.map(tg => `<span class="multi-tag">${escHtml(tg)}</span>`).join(' ')
          : `<span class="f10 gray">선택된 항목 없음</span>`;
        const lg = r.logic === 'and' ? 'and' : 'or';
        valHtml = `<button type="button" class="btn_box_sss btn_white fval-specials" title="특수물건 항목 선택">선택 ▾</button>
                   <select class="sel flogic-sel" title="여러 항목일 때 — OR: 하나라도 / AND: 모두 동시 (미포함이면 OR=하나라도 있으면 제외, AND=모두 동시에 있을 때만 제외)">
                     <option value="or"${lg === 'or' ? ' selected' : ''}>OR(하나)</option>
                     <option value="and"${lg === 'and' ? ' selected' : ''}>AND(모두)</option>
                   </select>
                   <span class="fval-specials-tags">${tagsHtml}</span>`;
      } else if (lockedVal) {
        // 값 고정 — 사용자가 수정할 수 없음 (선택만 하면 동작)
        r.value = lockedVal;
        valHtml = `<input type="text" class="inp fval-inp" value="${escAttr(lockedVal)}" readonly title="이 필터는 값이 고정되어 수정할 수 없습니다" style="background:#f1f5f9;color:#64748b;cursor:not-allowed;">`;
      } else {
        valHtml = `<input type="text" class="inp fval-inp" value="${escAttr(r.value || '')}" placeholder="값">`;
      }
      // 이 필터로 '빠진(제외)' 건수 (앞쪽 배지) — 캐시(raw) 있을 때만. 클릭 시 전체탭에 제외 건만 표시.
      let cfCountHtml = '<span class="cf-count cf-count-empty" title="크롤링 후 표시">–</span>';
      try {
        if (lastRawItems && lastRawItems.length && r.typeId && String(r.value || '').trim() !== '') {
          const { items: passed } = applyCustomFilters(lastRawItems, [r]);
          const ex = lastRawItems.length - passed.length;
          cfCountHtml = `<span class="cf-count" data-i="${i}" title="이 필터로 제외된 건수 — 클릭 시 전체탭에 그 건들만 표시">${ex}</span>`;
        }
      } catch (_) {}
      // 즐겨찾기 하트 (× 앞) — 값 있을 때만 활성, 이미 즐겨찾기면 채워진 ♥
      const favable = !!(r.typeId && String(r.value || '').trim() !== '');
      const faved = favable && isCfFaved(r);
      const heartHtml = `<button type="button" class="cf-fav-heart${faved ? ' on' : ''}${favable ? '' : ' disabled'}" title="${favable ? '이 조건 즐겨찾기 ' + (faved ? '해제' : '추가') : '값 입력 후 즐겨찾기 가능'}">${faved ? '♥' : '♡'}</button>`;
      return `<div class="cust-row" data-i="${i}">
        ${cfCountHtml}
        <select class="sel ftype-sel">${typeOpts}</select>
        <select class="sel fop-sel">${opOpts}</select>
        ${valHtml}
        <span class="cust-hint">${escHtml(hint)}</span>
        ${heartHtml}
        <button class="row-del" title="이 행 삭제">×</button>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.cust-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      const cfBadge = row.querySelector('.cf-count');
      if (cfBadge) cfBadge.addEventListener('click', () => { if (!cfBadge.classList.contains('cf-count-empty')) showFilterExcluded(i); });
      const heart = row.querySelector('.cf-fav-heart');
      if (heart) heart.addEventListener('click', () => {
        const rr = custRows[i];
        if (!rr || !rr.typeId || String(rr.value || '').trim() === '') { alert('값을 입력한 뒤 ♥ 로 즐겨찾기에 추가하세요.'); return; }
        toggleCfFav(rr);
        renderCustRows();   // 하트 상태 갱신
      });
      row.querySelector('.ftype-sel').addEventListener('change', e => onCustTypeChange(i, e.target));
      row.querySelector('.fop-sel').addEventListener('change', e => { custRows[i].op = e.target.value; refilterFromCache({ quiet: true }); });
      const inp = row.querySelector('.fval-inp');
      if (inp) inp.addEventListener('input', e => { custRows[i].value = e.target.value; });
      const btn = row.querySelector('.fval-specials');
      if (btn) btn.addEventListener('click', () => openSpecialsFilterModal(i));
      const sp1 = row.querySelector('.fspecial1-combo');
      if (sp1) _initSpecial1Combo(sp1, i);
      const logicSel = row.querySelector('.flogic-sel');
      if (logicSel) logicSel.addEventListener('change', e => { custRows[i].logic = e.target.value; refilterFromCache({ quiet: true }); });
      row.querySelector('.row-del').addEventListener('click', () => { custRows.splice(i, 1); renderCustRows(); });
    });
  }

  // ── 추가필터 즐겨찾기 ─────────────────────────────────────
  function loadCfFavs() { try { return JSON.parse(localStorage.getItem(LS_CF_FAV) || '[]') || []; } catch (e) { return []; } }
  function saveCfFavs(arr) { try { localStorage.setItem(LS_CF_FAV, JSON.stringify(arr)); } catch (e) {} }
  function _cfKey(f) { return [f.typeId, f.op || 'eq', String(f.value || '').trim(), f.logic || 'or'].join('|'); }
  function isCfFaved(r) { const k = _cfKey(r); return loadCfFavs().some(f => _cfKey(f) === k); }
  function toggleCfFav(r) {
    const favs = loadCfFavs(); const k = _cfKey(r);
    const idx = favs.findIndex(f => _cfKey(f) === k);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push({ id: uid('cffav'), typeId: r.typeId, op: r.op || 'eq', value: String(r.value || '').trim(), logic: r.logic || 'or' });
    saveCfFavs(favs);
    return idx < 0;
  }
  function cfFilterLabel(f) {
    const t = ftypes.find(x => x.id === f.typeId);
    const name = t ? t.name : '(종류?)';
    const opMap = { eq: '=', ne: '≠', gte: '≥', gt: '>', lte: '≤', lt: '<', contains: '포함', ncontains: '미포함', regex: '정규식' };
    const op = opMap[f.op] || f.op || '';
    let s = (name + ' ' + op + ' ' + (f.value || '')).trim();
    if (t && t.valueType === 'specials' && String(f.value || '').split(',').filter(x => x.trim()).length > 1) s += (f.logic === 'and' ? ' (모두)' : ' (하나라도)');
    return s;
  }
  function _cfFavOutside(e) { const wrap = document.querySelector('.cf-fav-wrap'); if (wrap && !wrap.contains(e.target)) closeCfFavMenu(); }
  function closeCfFavMenu() { document.getElementById('cfFavMenu')?.classList.add('hidden'); document.removeEventListener('mousedown', _cfFavOutside); }
  function openCfFavMenu() { renderCfFavMenu(); document.getElementById('cfFavMenu')?.classList.remove('hidden'); setTimeout(() => document.addEventListener('mousedown', _cfFavOutside), 0); }
  function renderCfFavMenu() {
    const menu = document.getElementById('cfFavMenu'); if (!menu) return;
    // 라벨순(한글) 정렬 — 비슷한 글자끼리 모이게
    const favs = loadCfFavs().slice().sort((a, b) => cfFilterLabel(a).localeCompare(cfFilterLabel(b), 'ko'));
    if (!favs.length) {
      menu.innerHTML = `<div class="cf-fav-empty">즐겨찾기한 조건이 없습니다.<br><span class="f10 gray">각 필터 행 끝의 ♥ 로 추가하세요.</span></div>`;
      return;
    }
    menu.innerHTML = `<div class="cf-fav-head">즐겨찾기 필터 — 체크 후 [선택 추가]</div>
      <div class="cf-fav-list">${favs.map(f => `<label class="cf-fav-item"><input type="checkbox" class="cf-fav-cb" data-fid="${f.id}"><span class="cf-fav-label" title="${escAttr(cfFilterLabel(f))}">${escHtml(cfFilterLabel(f))}</span><button type="button" class="cf-fav-del" data-fid="${f.id}" title="즐겨찾기에서 삭제">×</button></label>`).join('')}</div>
      <div class="cf-fav-foot"><button type="button" class="btn_box_sss btn_white" id="cfFavCancel">닫기</button><button type="button" class="btn_box_sss btn_blue bold" id="cfFavAdd">선택 추가</button></div>`;
    menu.querySelector('#cfFavAdd').addEventListener('click', () => {
      const ids = [...menu.querySelectorAll('.cf-fav-cb:checked')].map(c => c.dataset.fid);
      if (!ids.length) { alert('추가할 즐겨찾기를 1개 이상 체크하세요.'); return; }
      const favs2 = loadCfFavs();
      const existing = new Set(custRows.map(_cfKey));
      let added = 0;
      ids.forEach(id => { const f = favs2.find(x => x.id === id); if (f && !existing.has(_cfKey(f))) { custRows.push({ typeId: f.typeId, op: f.op, value: f.value, logic: f.logic }); existing.add(_cfKey(f)); added++; } });
      closeCfFavMenu();
      renderCustRows();
      if (added) refilterFromCache({ quiet: true });
      else alert('선택한 조건은 이미 추가되어 있습니다.');
    });
    menu.querySelector('#cfFavCancel').addEventListener('click', closeCfFavMenu);
    menu.querySelectorAll('.cf-fav-del').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      saveCfFavs(loadCfFavs().filter(f => f.id !== b.dataset.fid));
      renderCfFavMenu(); renderCustRows();
    }));
  }

  // 배지 클릭 → 이 필터로 '빠진(제외)' 건들만 하단 그리드 전체탭에 표시
  function showFilterExcluded(i) {
    const r = custRows[i];
    if (!r || !r.typeId || String(r.value || '').trim() === '') return;
    if (!lastRawItems || !lastRawItems.length) return;
    const { items: passed } = applyCustomFilters(lastRawItems, [r]);
    const passSet = new Set(passed);
    const excluded = lastRawItems.filter(it => !passSet.has(it));
    // 전체 탭 활성 표시 + 제외 목록만 렌더
    viewMode = 'all';
    document.getElementById('viewTabFiltered')?.classList.remove('active');
    document.getElementById('viewTabAll')?.classList.add('active');
    renderResults(excluded);
    const panel = document.getElementById('resultPanel');
    if (panel) { panel.classList.remove('hidden'); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // 추가필터 각 행 앞 '제외 건수' 배지 갱신 (재렌더 없이 in-place — 콤보 포커스/입력 유지)
  function updateCustRowCounts() {
    const wrap = document.getElementById('custFilterRows');
    if (!wrap) return;
    wrap.querySelectorAll('.cust-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      const badge = row.querySelector('.cf-count');
      const r = custRows[i];
      if (!badge || !r) return;
      if (lastRawItems && lastRawItems.length && r.typeId && String(r.value || '').trim() !== '') {
        try {
          const { items: passed } = applyCustomFilters(lastRawItems, [r]);
          badge.classList.remove('cf-count-empty');
          badge.textContent = lastRawItems.length - passed.length;   // 제외(빠진) 건수
          badge.title = '이 필터로 제외된 건수 — 클릭 시 전체탭에 그 건들만 표시';
          badge.dataset.i = i;
        } catch (_) {}
      } else {
        badge.classList.add('cf-count-empty');
        badge.textContent = '–';
        badge.title = '크롤링 후 표시';
      }
    });
  }

  // ── 단일 특수물건 콤보 (추가필터 '특수물건') — 데이터필터링 특수물건과 동일 동작(1개 선택) ──
  function _initSpecial1Combo(box, i) {
    const inp = box.querySelector('.fspecial1-input');
    const caret = box.querySelector('.fspecial1-caret');
    const list = box.querySelector('.fspecial1-pop');
    if (!inp || !list) return;
    const items = (D.SPECIAL || []).filter(o => String(o.v) !== '');
    let filtered = items.slice(), activeIdx = -1;
    function render(q) {
      const qq = (q || '').replace(/\s+/g, '').toLowerCase();
      filtered = qq
        ? items.filter(o => ((o.t || '') + (o.kw || '')).replace(/\s+/g, '').toLowerCase().includes(qq))
        : items.slice();
      const cur = String(custRows[i] ? custRows[i].value : '').trim();
      list.innerHTML = filtered.map((o, idx) => {
        const kwHtml = o.kw ? ' <span class="combo-kw">[' + escHtml(o.kw) + ']</span>' : '';
        return '<li class="combo-item' + (o.t === cur ? ' selected' : '') + '" data-t="' + escAttr(o.t) + '" data-i="' + idx + '">' + escHtml(o.t) + kwHtml + '</li>';
      }).join('') || '<li class="combo-empty">결과 없음</li>';
      activeIdx = filtered.length ? 0 : -1;
      paintActive();
    }
    function paintActive() {
      list.querySelectorAll('.combo-item').forEach((el, idx) => el.classList.toggle('active', idx === activeIdx));
      const cur = list.querySelector('.combo-item.active');
      if (cur && !list.classList.contains('hidden')) cur.scrollIntoView({ block: 'nearest' });
    }
    function open() { list.classList.remove('hidden'); render(inp.value); }
    function close() { list.classList.add('hidden'); }
    function pick(label) {
      if (!custRows[i]) return;
      custRows[i].value = label;
      inp.value = label;
      close();
      refilterFromCache({ quiet: true });
    }
    inp.addEventListener('focus', () => { inp.select(); open(); });
    inp.addEventListener('click', () => { inp.select(); open(); });
    inp.addEventListener('input', () => {
      if (inp.value.trim() === '' && custRows[i]) { custRows[i].value = ''; refilterFromCache({ quiet: true }); }  // 비우면 설정안함
      open(); render(inp.value);
    });
    inp.addEventListener('keydown', (e) => {
      if (list.classList.contains('hidden')) { if (e.key === 'ArrowDown' || e.key === 'Enter') { open(); e.preventDefault(); return; } }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx + 1) % filtered.length; paintActive(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (filtered.length) { activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; paintActive(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0 && filtered[activeIdx]) pick(filtered[activeIdx].t); }
      else if (e.key === 'Escape') { close(); inp.blur(); }
    });
    caret.addEventListener('mousedown', (e) => { e.preventDefault(); if (list.classList.contains('hidden')) { inp.focus(); open(); } else close(); });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.combo-item'); if (!li) return;
      e.preventDefault(); pick(li.getAttribute('data-t'));
    });
    document.addEventListener('mousedown', (e) => {
      if (e.target === inp || e.target === caret) return;
      if (box.contains(e.target)) return;
      close();
    });
  }

  // ── 특수물건 다중 선택 모달 ───────────────────────────────
  let _specialsFilterRowIdx = -1;
  let _specialsFilterSelected = new Set(); // 현재 모달에서의 선택 상태 (검색 재렌더에도 유지)
  function renderSpecialsModalBody(q) {
    const qq = (q || '').replace(/\s+/g, '').toLowerCase();
    // 전체 표시. kw 없는 항목은 결과 표시 안 됨 안내 + 체크박스 비활성.
    const all = (D.SPECIAL || []).filter(o => String(o.v) !== '');
    const filtered = qq
      ? all.filter(o => {
          const t = (o.t || '').replace(/\s+/g, '').toLowerCase();
          const k = (o.kw || '').replace(/\s+/g, '').toLowerCase();
          return t.includes(qq) || k.includes(qq);
        })
      : all;
    const filterable = all.filter(o => o.kw && o.kw.length).length;
    // 상단 카운트
    const countEl = document.getElementById('specialsFilterCount');
    if (countEl) {
      countEl.textContent = qq
        ? `· 검색 ${filtered.length} / 전체 ${all.length}건 (필터가능 ${filterable})`
        : `· 전체 ${all.length}건 (필터가능 ${filterable} / 결과표시없음 ${all.length - filterable})`;
    }
    const body = document.getElementById('specialsFilterBody');
    body.innerHTML = filtered.length
      ? filtered.map(o => {
          const hasKw = !!(o.kw && o.kw.length);
          const sideHtml = hasKw
            ? ` <span class="combo-kw">[${escHtml(o.kw)}]</span>`
            : ` <span class="kw-none">[결과 표시 없음]</span>`;
          const chk = _specialsFilterSelected.has(o.t) ? ' checked' : '';
          const dis = hasKw ? '' : ' disabled';
          const cls = hasKw ? 'specials-opt' : 'specials-opt disabled';
          const title = hasKw ? '' : ' title="옥션원 검색조건 전용 — 결과 페이지에 표시되지 않아 필터링 불가"';
          return `<label class="${cls}"${title}><input type="checkbox" value="${escAttr(o.t)}"${chk}${dis}> ${escHtml(o.t)}${sideHtml}</label>`;
        }).join('')
      : '<div class="f10 gray" style="padding:12px;text-align:center;">검색 결과 없음</div>';
    // 체크박스 토글 → 선택 상태 갱신
    body.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach(c => {
      c.addEventListener('change', () => {
        if (c.checked) _specialsFilterSelected.add(c.value);
        else _specialsFilterSelected.delete(c.value);
      });
    });
  }
  function openSpecialsFilterModal(rowIdx) {
    _specialsFilterRowIdx = rowIdx;
    _specialsFilterSelected = new Set(String(custRows[rowIdx].value || '').split(',').map(s => s.trim()).filter(Boolean));
    const search = document.getElementById('specialsFilterSearch');
    if (search) search.value = '';
    renderSpecialsModalBody('');
    document.getElementById('specialsFilterModal').classList.remove('hidden');
    if (search) setTimeout(() => search.focus(), 0);
  }
  function closeSpecialsFilterModal() {
    document.getElementById('specialsFilterModal').classList.add('hidden');
    _specialsFilterRowIdx = -1;
  }
  function applySpecialsFilterModal() {
    if (_specialsFilterRowIdx < 0) return;
    // 현재 검색뷰 밖에 있는 항목까지 보존
    const labels = Array.from(_specialsFilterSelected);
    custRows[_specialsFilterRowIdx].value = labels.join(',');
    closeSpecialsFilterModal();
    renderCustRows();
    refilterFromCache({ quiet: true }); // 항목 선택 변경 즉시 결과/카운트 반영
  }
  function bindSpecialsFilterModal() {
    document.getElementById('specialsFilterClose')?.addEventListener('click', closeSpecialsFilterModal);
    document.getElementById('specialsFilterApply')?.addEventListener('click', applySpecialsFilterModal);
    document.getElementById('specialsFilterAll')?.addEventListener('click', () => {
      // 현재 검색뷰의 항목만 전체선택 (사용자 의도 명확)
      document.querySelectorAll('#specialsFilterBody input[type=checkbox]').forEach(c => {
        c.checked = true; _specialsFilterSelected.add(c.value);
      });
    });
    document.getElementById('specialsFilterNone')?.addEventListener('click', () => {
      document.querySelectorAll('#specialsFilterBody input[type=checkbox]').forEach(c => {
        c.checked = false; _specialsFilterSelected.delete(c.value);
      });
    });
    document.getElementById('specialsFilterSearch')?.addEventListener('input', (e) => {
      renderSpecialsModalBody(e.target.value);
    });
  }
  function onCustTypeChange(idx, sel) {
    if (sel.value === '__new__') {
      const supported = Object.keys(FILTER_FIELDS).join(', ');
      const msg = '새 필터 종류 이름을 입력하세요.\n\n' +
                  '⚠ 아래 목록과 정확히 일치하는 이름만 작동합니다 (안 맞으면 무시):\n\n' +
                  supported + '\n\n' +
                  '입력 예) 유찰율 / 주소 시도 / 특수물건';
      const name = prompt(msg);
      if (!name) { sel.value = custRows[idx].typeId || ''; return; }
      const trimmed = name.trim();
      if (!FILTER_FIELDS[trimmed]) {
        if (!confirm(`"${trimmed}" 는 현재 매핑이 없어 필터링 시 무시됩니다.\n\n그래도 등록하시겠습니까?`)) {
          sel.value = custRows[idx].typeId || ''; return;
        }
      }
      const newType = { id: uid('ft'), name: trimmed, valueType: 'text' };
      ftypes.push(newType);
      saveFtypes();
      custRows[idx].typeId = newType.id;
      renderCustRows();
    } else {
      custRows[idx].typeId = sel.value;
      // 권장 op/값 자동 채움 (사용자가 손봐도 됨)
      const t = ftypes.find(x => x.id === sel.value);
      const preset = t && TYPE_PRESETS[t.name];
      if (preset) {
        custRows[idx].op = preset.op;
        custRows[idx].value = preset.value;
      }
      renderCustRows();
    }
  }

  // ── 편집 모드 진입 ──────────────────────────────────────
  // ── 비고(리스트별 메모) ──
  const LS_MEMO_COLLAPSED = 'auction1_memo_collapsed';
  function _memoEl() { return document.getElementById('presetMemo'); }
  function getMemoValue() { const e = _memoEl(); return e ? e.value : ''; }
  function setMemoValue(v) { const e = _memoEl(); if (e) e.value = v || ''; }
  function isMemoCollapsed() { try { return localStorage.getItem(LS_MEMO_COLLAPSED) === '1'; } catch (_) { return false; } }
  function updateMemoBadge() {
    const badge = document.getElementById('memoBadge');
    if (badge) badge.style.display = (isMemoCollapsed() && getMemoValue().trim()) ? '' : 'none';
  }
  function applyMemoCollapse() {
    const collapsed = isMemoCollapsed();
    const body = document.getElementById('memoBody');
    const arrow = document.getElementById('memoArrow');
    if (body) body.style.display = collapsed ? 'none' : '';
    if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
    updateMemoBadge();
  }
  function toggleMemo() {
    try { localStorage.setItem(LS_MEMO_COLLAPSED, isMemoCollapsed() ? '0' : '1'); } catch (_) {}
    applyMemoCollapse();
  }

  function newPreset() {
    currentPresetId = null;
    setMemoValue(''); applyMemoCollapse();
    document.getElementById('editorMode').textContent = '새 크롤링 등록';
    document.getElementById('editorIdBadge').textContent = '';
    document.getElementById('btnDelete').classList.add('hidden');
    document.getElementById('btnDuplicate').classList.add('hidden');
    document.getElementById('presetTitle').value = '';
    clearForm();
    custRows = [];
    renderCustRows();
    showEditor();
  }
  function loadPreset(id) {
    const p = presets.find(x => x.id === id);
    if (!p) return;
    currentPresetId = id;
    document.getElementById('editorMode').textContent = '크롤링 수정';
    document.getElementById('editorIdBadge').textContent = '· ID: ' + id;
    document.getElementById('btnDelete').classList.remove('hidden');
    document.getElementById('btnDuplicate').classList.remove('hidden');
    document.getElementById('presetTitle').value = p.title || '';
    applyFormData(p.formData || {});
    custRows = (p.customFilters || []).map(c => ({ ...c }));
    renderCustRows();
    setMemoValue(p.memo || ''); applyMemoCollapse();
    showEditor();
    renderSidebar();
    // 캐시된 결과 자동 복원 (있으면)
    if (!restoreCachedResult(id)) {
      // 캐시 없으면 결과 + 메모리 변수 비움 (이전 프리셋 잔재 제거)
      lastRawItems = [];
      lastFilteredItems = [];
      lastFilterApplied = 0;
      lastItems = [];
      setResultCounts(0, 0, 0);
      document.getElementById('resultPanel').classList.add('hidden');
      showResTimestamp(0);
    }
    try { localStorage.setItem(LS_LAST_PRESET, id); } catch (e) {}
  }

  // 현재 편집 중인 프리셋 복사 → 제목 비우고 폼/필터는 그대로, 새 프리셋 모드
  function duplicatePreset() {
    if (!currentPresetId) { setStatus('편집 중인 프리셋이 없습니다.', true); return; }
    currentPresetId = null;
    document.getElementById('editorMode').textContent = '새 크롤링 등록 (복사본)';
    document.getElementById('editorIdBadge').textContent = '';
    document.getElementById('btnDelete').classList.add('hidden');
    document.getElementById('btnDuplicate').classList.add('hidden');
    document.getElementById('presetTitle').value = '';
    document.getElementById('presetTitle').focus();
    // 결과/카운트는 이전 프리셋 거였으니 비움 — 새로 [크롤링 실행] 필요
    lastRawItems = [];
    lastFilteredItems = [];
    lastFilterApplied = 0;
    setResultCounts(0, 0, 0);
    showResTimestamp(0);
    document.getElementById('resultPanel').classList.add('hidden');
    renderSidebar();
    setStatus('복사 — 새 제목 입력 후 [저장], 결과는 [크롤링 실행]');
  }
  // 상단 영역(툴바·패널헤드·제목) 스크롤 고정 — 위 요소들의 실제 높이를 측정해 stacking top 설정
  function freezeHeaderSync_() {
    const topShell = document.getElementById('topShell');
    const topBar   = document.getElementById('topBar');
    const head     = document.querySelector('#editorPanel .panel-head');
    const title    = document.querySelector('#editorPanel .title-row');
    const base = topShell ? topShell.offsetHeight : 0;           // 파란 상단바(46px)
    if (topBar) topBar.style.top = base + 'px';
    const h1 = base + (topBar ? topBar.offsetHeight : 0);
    if (head)  head.style.top = h1 + 'px';
    const h2 = h1 + (head ? head.offsetHeight : 0);
    if (title) title.style.top = h2 + 'px';
  }

  function showEditor() {
    document.getElementById('editorPanel').classList.remove('hidden');
    document.getElementById('emptyHint').classList.add('hidden');
    freezeHeaderSync_(); // 패널 표시 후 높이 측정 가능
  }
  function hideEditor() {
    document.getElementById('editorPanel').classList.add('hidden');
    document.getElementById('emptyHint').classList.remove('hidden');
    currentPresetId = null;
    renderSidebar();
  }

  // ── 저장/삭제 ────────────────────────────────────────────
  // formData / customFilters 의 빈값 제거 후 정렬된 직렬화 (중복 비교용)
  function normalizeFormData(fd) {
    const out = {};
    Object.keys(fd || {}).forEach(k => {
      const v = fd[k];
      if (v == null) return;
      if (Array.isArray(v)) { if (v.length) out[k] = v.slice().sort(); return; }
      const s = typeof v === 'string' ? v.trim() : String(v);
      if (s !== '') out[k] = s;
    });
    return out;
  }
  function normalizeCustomFilters(rows) {
    return (rows || []).filter(r => r && r.typeId && String(r.value || '').trim() !== '')
      .map(r => ({ typeId: r.typeId, op: r.op || 'eq', value: String(r.value).trim(), logic: r.logic || 'or' }))
      .sort((a, b) => (a.typeId + a.op + a.value + a.logic).localeCompare(b.typeId + b.op + b.value + b.logic));
  }
  function presetSignature(formData, customFilters) {
    return JSON.stringify({
      f: normalizeFormData(formData),
      c: normalizeCustomFilters(customFilters)
    });
  }

  function savePreset() {
    const title = document.getElementById('presetTitle').value.trim();
    if (!title) { setStatus('제목을 입력해 주세요.', true); return; }
    const formData = collectFormData();
    const customFilters = custRows.filter(r => r.typeId).map(r => ({
      typeId: r.typeId, op: r.op || 'eq', value: r.value || '', logic: r.logic || 'or'
    }));
    // 중복 체크: 같은 formData + customFilters 인 다른 프리셋 존재 여부
    const sig = presetSignature(formData, customFilters);
    const dup = presets.find(p => p.id !== currentPresetId && presetSignature(p.formData, p.customFilters) === sig);
    if (dup) {
      alert(`동일한 검색 조건의 프리셋이 이미 있습니다:\n\n[${dup.title}]\n\n저장하지 않습니다.`);
      setStatus(`중복 — [${dup.title}] 와 동일한 조건`, true);
      return;
    }
    const memo = getMemoValue();
    if (currentPresetId) {
      const idx = presets.findIndex(p => p.id === currentPresetId);
      if (idx >= 0) {
        presets[idx] = { ...presets[idx], title, formData, customFilters, memo, updatedAt: Date.now() };
      }
    } else {
      const np = { id: uid('p'), title, formData, customFilters, memo, updatedAt: Date.now() };
      presets.push(np);
      currentPresetId = np.id;
    }
    savePresets();
    updateMemoBadge();
    setStatus('저장 완료');
    renderSidebar();
    document.getElementById('editorMode').textContent = '크롤링 수정';
    document.getElementById('editorIdBadge').textContent = '· ID: ' + currentPresetId;
    document.getElementById('btnDelete').classList.remove('hidden');
    document.getElementById('btnDuplicate').classList.remove('hidden');
    freezeHeaderSync_(); // 저장 후 버튼 노출로 패널헤드 높이 변동 가능 → 재계산
  }
  function deletePreset() {
    if (!currentPresetId) return;
    if (!confirm('이 크롤링을 삭제하시겠습니까?')) return;
    const id = currentPresetId;
    presets = presets.filter(p => p.id !== id);
    savePresets();
    try {
      cacheDel(id);
      if (localStorage.getItem(LS_LAST_PRESET) === id) localStorage.removeItem(LS_LAST_PRESET);
    } catch (e) {}
    setStatus('삭제 완료');
    hideEditor();
  }

  // ── 물건종류 복수선택 모달 ─────────────────────────────────
  function openMultiPropModal() {
    const list = document.getElementById('multiPropList');
    list.innerHTML = D.PROPERTY_GROUPS.map(g => `
      <div class="modal-cat-title">${escHtml(g.label)}</div>
      <div class="modal-cat-list">
        ${g.items.map(it => `
          <label><input type="checkbox" value="${it.v}"${multiPropSelected.has(it.v) ? ' checked' : ''}> ${escHtml(it.t)}</label>
        `).join('')}
      </div>
    `).join('');
    document.getElementById('multiPropModal').classList.remove('hidden');
  }
  function applyMultiProp() {
    const cbs = document.querySelectorAll('#multiPropList input[type=checkbox]:checked');
    multiPropSelected = new Set(Array.from(cbs).map(cb => cb.value));
    // 복수선택 있으면 단일 select 는 "전체보기" 로 reset (다중만 필터 기준이 되도록)
    if (multiPropSelected.size > 0) {
      const single = document.getElementById('f_propType');
      if (single) {
        single.value = '';
        try { single.dispatchEvent(new Event('change')); } catch (e) {}
      }
    }
    renderMultiPropTags();
    closeMultiPropModal();
  }
  function clearMultiProp() {
    document.querySelectorAll('#multiPropList input[type=checkbox]').forEach(cb => cb.checked = false);
  }
  function closeMultiPropModal() {
    document.getElementById('multiPropModal').classList.add('hidden');
  }

  // ── 주소 추가 ────────────────────────────────────────────
  function addAddress() {
    const sido = document.getElementById('f_addrSido');
    const gugun = document.getElementById('f_addrGugun');
    const dong = document.getElementById('f_addrDong');
    const parts = [
      sido.options[sido.selectedIndex]?.text || '',
      gugun.options[gugun.selectedIndex]?.text || '',
      dong.options[dong.selectedIndex]?.text || ''
    ].filter(t => t && !t.startsWith('-'));
    if (!parts.length) { setStatus('시/도를 먼저 선택하세요.', true); return; }
    if (addrTags.length >= 20) { setStatus('주소는 최대 20개까지', true); return; }
    // 객체로 저장: 옥션원 select value 까지 보관 → crawler.py 가 정확히 재현
    addrTags.push({
      text:  parts.join(' '),
      sido:  sido.value || '',
      gugun: gugun.value || '',
      dong:  dong.value || ''
    });
    // [추가] 후 위쪽 select 자동 reset — addrTags 만 필터 기준이 되도록
    sido.value = ''; gugun.value = ''; dong.value = '';
    try { sido.dispatchEvent(new Event('change')); } catch (e) {}
    renderAddrTags();
  }

  // 태그의 시/도 value 추출 (객체 sido 우선, 없으면 텍스트 첫 단어 → value). 저장값 형식 무관 매칭.
  function _tagSido(a) {
    if (a && a.sido) return String(a.sido);
    const w = String(_addrTagText(a)).trim().split(/\s+/)[0];
    const o = (D.SIDO || []).find(x => x.t === w);
    return o ? String(o.v) : '';
  }
  // ── 주소 제거 ─ X가 목록에 있으면 그것만 제거, 없으면 (X 빼고) 목록에 없는 나머지 시/도를 전부 채움.
  //   → 빈 목록/작은 목록/전체-일부 어떤 상태든 "X만 빼고 전부" 가 직관대로 됨.
  function removeAddress() {
    const sido = document.getElementById('f_addrSido');
    const gugun = document.getElementById('f_addrGugun');
    const dong = document.getElementById('f_addrDong');
    const selSido = String(sido.value || '');
    const selText = sido.options[sido.selectedIndex]?.text || '';
    if (!selSido) { setStatus('제거할 시/도를 먼저 선택하세요.', true); return; }
    const hasX = addrTags.some(a => _tagSido(a) === selSido);
    if (hasX) {
      // 이미 있으면 그 시/도만 제거 (또 누르면 그것만 빠짐)
      addrTags = addrTags.filter(a => _tagSido(a) !== selSido);
      setStatus(`'${selText}' 제외 — 추가주소 ${addrTags.length}개`);
    } else {
      // 없으면: X 빼고, 목록에 아직 없는 나머지 시/도를 전부 채움 (= X만 빼고 전국)
      const present = new Set(addrTags.map(_tagSido).filter(Boolean));
      (D.SIDO || []).forEach(o => {
        if (o.v && String(o.v) !== selSido && !present.has(String(o.v)) && addrTags.length < 20) {
          addrTags.push({ text: o.t, sido: o.v, gugun: '', dong: '' });
        }
      });
      setStatus(`'${selText}' 만 빼고 채움 — 추가주소 ${addrTags.length}개`);
    }
    sido.value = ''; gugun.value = ''; dong.value = '';
    try { sido.dispatchEvent(new Event('change')); } catch (e) {}
    renderAddrTags();
  }

  // ── 필터 종류 관리 (이름 변경/삭제) ─────────────────────────
  function openManageTypes() {
    if (!ftypes.length) { alert('등록된 필터 종류가 없습니다.'); return; }
    let msg = '필터 종류 목록:\n\n';
    ftypes.forEach((t, i) => msg += `${i + 1}. ${t.name}\n`);
    msg += '\n번호를 입력하면 그 종류를 [수정/삭제]할 수 있습니다.\n취소: 빈값';
    const num = prompt(msg);
    if (!num) return;
    const idx = parseInt(num, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= ftypes.length) return;
    const t = ftypes[idx];
    const action = prompt(`"${t.name}"\n\n수정: 새 이름 입력\n삭제: 'del' 입력\n취소: 빈값`);
    if (!action) return;
    if (action.trim().toLowerCase() === 'del') {
      if (!confirm(`"${t.name}" 종류를 삭제하시겠습니까?\n(이 종류를 사용 중인 프리셋의 행은 비워집니다)`)) return;
      ftypes.splice(idx, 1);
      saveFtypes();
      // 사용 중인 프리셋의 customFilters 정리
      presets.forEach(p => {
        if (Array.isArray(p.customFilters)) {
          p.customFilters = p.customFilters.filter(c => c.typeId !== t.id);
        }
      });
      savePresets();
      // 현재 편집 중인 행도 정리
      custRows = custRows.filter(r => r.typeId !== t.id);
      renderCustRows();
      renderSidebar();
      setStatus('삭제 완료');
    } else {
      t.name = action.trim();
      saveFtypes();
      renderCustRows();
      setStatus('이름 변경 완료');
    }
  }

  // ── 유틸 ────────────────────────────────────────────────
  function setStatus(msg, isErr) {
    const el = document.getElementById('statusMsg');
    el.textContent = msg;
    el.style.color = isErr ? '#dc2626' : '#2563eb';
    setTimeout(() => { el.textContent = ''; }, 3000);
    // 배치 크롤링 활성 시 옵저버로 sub-status 전달
    if (typeof __batchStatusObserver__ === 'function') {
      try { __batchStatusObserver__(msg, isErr); } catch (_) {}
    }
  }
  // 배치 크롤링 sub-status 옵저버 (modal sub text 업데이트용)
  let __batchStatusObserver__ = null;
  function escHtml(s) {
    return String(s == null ? '' : s)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }
  function escAttr(s) { return escHtml(s); }

  // ── 이벤트 바인딩 ───────────────────────────────────────
  function bind() {
    document.getElementById('btnNewMain').addEventListener('click', newPreset);
    // MAPS 동기화
    document.getElementById('msCheckAll')?.addEventListener('change', onMsCheckAllChange);
    document.getElementById('msToggleAllCollapse')?.addEventListener('click', toggleAllTreeCollapsed);
    document.getElementById('btnSyncToMaps')?.addEventListener('click', syncSelectedPresetsToMaps);
    document.getElementById('btnSendToMaps')?.addEventListener('click', sendCheckedListsToMaps);
    document.getElementById('btnBatchCrawl')?.addEventListener('click', batchCrawlCheckedPresets);
    document.getElementById('btnMapsConfig')?.addEventListener('click', openSettingsModal);
    document.getElementById('settingsModalSave')?.addEventListener('click', saveSettingsModal);
    document.getElementById('settingsModalCancel')?.addEventListener('click', closeSettingsModal);
    document.getElementById('settingsModalX')?.addEventListener('click', closeSettingsModal);
    document.getElementById('settingsModalReset')?.addEventListener('click', resetSettingsModal);
    document.getElementById('setActiveAccount')?.addEventListener('change', renderAccountSlots);
    document.getElementById('btnUploadMaps')?.addEventListener('click', uploadSelectedItemsToMaps);
    document.getElementById('btnClearResult')?.addEventListener('click', clearCurrentResult);
    document.getElementById('btnClearChecked')?.addEventListener('click', clearCheckedCaches);
    // 결과 테이블 헤더 [전체] 체크박스 (사진 옆) — 모든 행 체크박스 토글
    document.getElementById('resColCheckAll')?.addEventListener('change', (e) => {
      const checked = !!e.target.checked;
      document.querySelectorAll('#resBody .res-cb').forEach(cb => { cb.checked = checked; });
    });
    // 행 체크박스 변경 시 헤더 [전체] 체크박스의 상태(checked/indeterminate) 동기화
    document.getElementById('resBody')?.addEventListener('change', (e) => {
      if (!e.target.classList || !e.target.classList.contains('res-cb')) return;
      const all = document.getElementById('resColCheckAll');
      if (!all) return;
      const boxes = document.querySelectorAll('#resBody .res-cb');
      const sel = document.querySelectorAll('#resBody .res-cb:checked').length;
      if (sel === 0)              { all.checked = false; all.indeterminate = false; }
      else if (sel === boxes.length) { all.checked = true;  all.indeterminate = false; }
      else                        { all.checked = false; all.indeterminate = true; }
    });
    document.getElementById('btnSave').addEventListener('click', savePreset);
    document.getElementById('btnSaveBottom')?.addEventListener('click', savePreset);
    window.addEventListener('resize', freezeHeaderSync_);
    freezeHeaderSync_(); // 초기 topBar 고정 위치 설정
    document.getElementById('btnDelete').addEventListener('click', deletePreset);
    document.getElementById('btnDuplicate').addEventListener('click', duplicatePreset);
    document.getElementById('btnCancel').addEventListener('click', hideEditor);
    document.getElementById('btnReset').addEventListener('click', () => { clearForm(); custRows = []; renderCustRows(); });
    document.getElementById('btnRunCrawl').addEventListener('click', runCrawl);
    document.getElementById('btnCancelCrawl').addEventListener('click', cancelCrawl);

    // 복수선택
    document.getElementById('btnMultiProp').addEventListener('click', openMultiPropModal);
    document.getElementById('multiPropApply').addEventListener('click', applyMultiProp);
    document.getElementById('multiPropClear').addEventListener('click', clearMultiProp);
    document.getElementById('multiPropClose').addEventListener('click', closeMultiPropModal);
    document.querySelector('#multiPropModal .modal-bg').addEventListener('click', closeMultiPropModal);

    // 주소 추가
    document.getElementById('btnAddrAdd').addEventListener('click', addAddress);
    document.getElementById('btnAddrRemove')?.addEventListener('click', removeAddress);

    // 추가 필터 조건
    document.getElementById('btnAddCustRow').addEventListener('click', () => {
      custRows.push({ typeId: ftypes[0]?.id || '', op: 'eq', value: '', logic: 'or' });
      renderCustRows();
    });
    document.getElementById('btnManageTypes').addEventListener('click', openManageTypes);
    document.getElementById('btnCfFav')?.addEventListener('click', () => {
      const menu = document.getElementById('cfFavMenu');
      if (menu && menu.classList.contains('hidden')) openCfFavMenu(); else closeCfFavMenu();
    });
    document.getElementById('btnRefilter').addEventListener('click', refilterFromCache);
    // 비고 접기/펴기 + 내용 변경 시 배지 갱신
    document.getElementById('memoHead')?.addEventListener('click', toggleMemo);
    document.getElementById('presetMemo')?.addEventListener('input', updateMemoBadge);
    applyMemoCollapse();

    // 결과 뷰 탭: 필터링 / 전체
    document.getElementById('viewTabFiltered')?.addEventListener('click', () => setViewMode('filtered'));
    document.getElementById('viewTabAll')?.addEventListener('click', () => setViewMode('all'));
    document.getElementById('viewTabExcluded')?.addEventListener('click', () => setViewMode('excluded'));

    // 정렬바 — 단일 키 버튼 + 다중 키 select + 해제
    document.querySelectorAll('#sortBar .sort-tab[data-sort]').forEach(b => {
      b.addEventListener('click', () => setSort(b.dataset.sort));
    });
    document.querySelectorAll('#sortBar .sort-sel').forEach(s => {
      s.addEventListener('change', () => setSort(s.value || null));
    });
    document.getElementById('btnSortClear')?.addEventListener('click', () => setSort(null));

    // 숫자 입력 콤마 자동
    document.querySelectorAll('input[data-numfmt="1"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const raw = inp.value.replace(/[^0-9]/g, '');
        inp.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
      });
    });
  }

  // ── 가격 프리셋 패널 ─────────────────────────────────────
  // 단일 상태 (다중 panel 인스턴스 closure 누수 방지)
  let activePriceTarget = null; // 'apprMin' | 'apprMax' | 'lowMin' | 'lowMax'
  let pricePanelEl    = null;
  let pricePanelInp   = null;
  let pricePanelDoc   = null;

  function openPricePreset(inp) {
    const cell = inp.closest('.price-cell');
    if (!cell) return;
    // 같은 input 으로 이미 열려있으면 그대로 둠
    if (pricePanelInp === inp && pricePanelEl && pricePanelEl.parentNode) return;
    closePricePreset(); // 다른 input 의 패널 등은 정리

    activePriceTarget = inp.dataset.priceKey;
    pricePanelInp = inp;

    const panel = document.createElement('div');
    panel.className = 'price-preset show';
    const targetLabel = (cell.dataset.priceTarget === 'appr') ? '감정가격' : '최저가격';
    const slot = (activePriceTarget || '').endsWith('Min') ? '최소' : '최대';
    panel.innerHTML =
      '<div class="pp-head">'
      + '<span><b>' + targetLabel + '</b> <span class="pp-target">' + slot + '값</span> 빠른 선택 (만원 단위)</span>'
      + '<button type="button" class="pp-close">닫기</button>'
      + '</div>'
      + '<div class="pp-grid">'
      + D.PRICE_PRESETS.map(p => '<button type="button" class="pp-btn' + (p.special ? ' special' : '') + '" data-v="' + p.v + '">' + p.t + '</button>').join('')
      + '</div>'
      + '<div class="pp-foot">* 1억 = 10,000 (만원). [이하] 클릭 시 0 입력, [최대] 클릭 시 99,999,999 입력</div>';
    cell.appendChild(panel);
    pricePanelEl = panel;

    panel.querySelector('.pp-close').addEventListener('click', closePricePreset);
    // 버튼 클릭은 mousedown 단계에서 값 적용 (외부 클릭 감지가 click 보다 먼저 닫는 문제 회피)
    panel.querySelectorAll('.pp-btn').forEach(b => {
      const apply = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const v = parseInt(b.dataset.v, 10);
        const key = activePriceTarget;
        const f = document.querySelector('input[data-price-key="' + key + '"]');
        if (f) {
          if (v === 0) f.value = '0';
          else if (v < 0) f.value = '99,999,999';
          else f.value = Number(v).toLocaleString('ko-KR');
          if (typeof window.__refreshHighlights === 'function') window.__refreshHighlights();
        }
        closePricePreset();
      };
      b.addEventListener('mousedown', apply);  // 외부 클릭 감지 직전 처리
      b.addEventListener('click', apply);       // 키보드 enter 등 폴백
    });

    // 외부 클릭 닫기 (단일 핸들러)
    pricePanelDoc = function (e) {
      // 패널 내부 클릭은 자체 처리. 입력 자기자신은 토글 X.
      if (pricePanelEl && (pricePanelEl.contains(e.target) || e.target === pricePanelInp)) return;
      closePricePreset();
    };
    setTimeout(() => { document.addEventListener('mousedown', pricePanelDoc); }, 0);
  }
  function closePricePreset() {
    if (pricePanelDoc) {
      document.removeEventListener('mousedown', pricePanelDoc);
      pricePanelDoc = null;
    }
    if (pricePanelEl && pricePanelEl.parentNode) {
      pricePanelEl.parentNode.removeChild(pricePanelEl);
    }
    pricePanelEl = null;
    pricePanelInp = null;
    activePriceTarget = null;
  }

  // ── 추가 필터 후처리 ─────────────────────────────────────
  // price 셀 텍스트(여러 줄 "감정가 / 최저가 (NN%) / 평당가") → 구조화
  function parsePriceCell(s) {
    const text = String(s || '');
    const nums = text.replace(/,/g, '').match(/\d{4,}/g) || [];
    const appraisal = nums[0] ? parseInt(nums[0], 10) : null; // 감정가 (원)
    const low       = nums[1] ? parseInt(nums[1], 10) : null; // 최저가 (원)
    const pctMatch  = text.match(/\((\d{1,3})\s*%\)/);
    let pct = pctMatch ? parseInt(pctMatch[1], 10) : null;
    if (pct == null && appraisal && low) pct = Math.round((low / appraisal) * 100);
    return { appraisal, low, pct };
  }
  // status 셀 텍스트에서 유찰 회수 추출 (예: "유찰 3회", "신건")
  function parseFailCount(statusText) {
    const m = String(statusText || '').match(/유찰\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (/신건/.test(statusText || '')) return 0;
    return null;
  }
  // 비교 연산. contains/ncontains 는 콤마 구분 다중 키워드 지원.
  // logic='or'(기본): 포함=하나라도(some), 미포함=하나라도 있으면 제외(every !includes)
  // logic='and'     : 포함=모두(every),   미포함=모두 동시에 있을 때만 제외(some !includes)
  function cmp(itemVal, op, ref, logic) {
    if (itemVal == null) return false;
    const isNum = typeof itemVal === 'number';
    const refRaw = String(ref || '');
    const refNum = parseFloat(refRaw.replace(/,/g, ''));
    const refStr = refRaw.trim();
    const itemStr = String(itemVal);
    const isAnd = logic === 'and';
    switch (op) {
      case 'eq':        return isNum ? itemVal === refNum : itemStr === refStr;
      case 'ne':        return isNum ? itemVal !== refNum : itemStr !== refStr;
      case 'gte':       return isNum && itemVal >= refNum;
      case 'gt':        return isNum && itemVal >  refNum;
      case 'lte':       return isNum && itemVal <= refNum;
      case 'lt':        return isNum && itemVal <  refNum;
      case 'contains': {
        const tokens = refStr.split(',').map(s => s.trim()).filter(Boolean);
        if (!tokens.length) return false;
        return isAnd ? tokens.every(t => itemStr.includes(t)) : tokens.some(t => itemStr.includes(t));
      }
      case 'ncontains': {
        const tokens = refStr.split(',').map(s => s.trim()).filter(Boolean);
        if (!tokens.length) return true;
        // AND: 모두 동시에 있을 때만 제외 → 하나라도 없으면 통과(some !includes)
        return isAnd ? tokens.some(t => !itemStr.includes(t)) : tokens.every(t => !itemStr.includes(t));
      }
      case 'regex':     try { return new RegExp(refStr).test(itemStr); } catch (e) { return false; }
      default:          return true;
    }
  }
  // 특수물건 다중 전용 비교 — 라벨별 키워드 그룹을 1단위로 보고 AND/OR 판정.
  //  · 라벨 1개는 동의어(키워드) 여러 개를 가질 수 있어, "그 라벨 보유"=동의어 중 하나라도 포함.
  //  · groups = [[labelA 키워드들], [labelB 키워드들], ...]
  function cmpSpecials(itemVal, op, groups, logic) {
    if (itemVal == null) return false;
    const s = String(itemVal);
    const present = (groups || []).map(g => g.some(k => s.includes(k))); // 라벨별 보유 여부
    if (!present.length) return op === 'ncontains'; // 선택 없음: 미포함=통과, 포함=제외
    const isAnd = logic === 'and';
    const cond = isAnd ? present.every(Boolean) : present.some(Boolean);
    if (op === 'contains')  return cond;            // 포함: AND=모두 보유 / OR=하나라도
    if (op === 'ncontains') return !cond;           // 미포함: AND=모두 보유 시 제외 / OR=하나라도 보유 시 제외
    return true;
  }
  // 라벨 CSV → 라벨별 키워드 그룹 배열
  function specialsGroupsFor(labelsCSV) {
    const labels = String(labelsCSV || '').split(',').map(s => s.trim()).filter(Boolean);
    return labels.map(lab => {
      const o = (D.SPECIAL || []).find(x => x.t === lab);
      const src = o ? ((o.kw && o.kw.length) ? o.kw : o.t) : lab;
      return src.split(',').map(k => k.trim()).filter(Boolean);
    }).filter(g => g.length);
  }
  // 필터 종류 이름 → item 에서 비교값 추출
  // 새 종류 추가 시 여기에 핸들러를 등록.
  // address 토큰 분리: "경기도 광주시 신현동 ..." → ["경기도","광주시","신현동",...]
  function addrTokens(it) { return String(it.address || '').trim().split(/\s+/); }
  const FILTER_FIELDS = {
    '유찰율':                  it => parsePriceCell(it.price).pct,
    '유찰 횟수':               it => parseFailCount(it.status),
    '감정가 최소 (만원)':      it => { const a = parsePriceCell(it.price).appraisal; return a == null ? null : Math.round(a / 10000); },
    '비고/특이사항 키워드 포함': it => `${it.address} ${it.status} ${it.prop_kind} ${it.specials || ''}`,
    '주소':                    it => it.address || '',
    '주소 시도':               it => addrTokens(it)[0] || '',
    '주소시도':                it => addrTokens(it)[0] || '',
    '주소 구군':               it => addrTokens(it)[1] || '',
    '주소구군':                it => addrTokens(it)[1] || '',
    '특수물건':                it => it.specials || it.address || '',
    '특수권리':                it => it.specials || it.address || '',
    '특수물건 다중':           it => it.specials || it.address || '',
    '물건종류':                it => it.prop_kind || '',
    // 지층(지하) 제거 — 주소에 '지N층'/'지하N층' 있으면 '지*층' 마크. 값 고정(미포함 '지*층')
    '지층 제거':               it => /지하?\d+층/.test(it.address || '') ? '지*층' : '',
    // ── 대항력 관련 필터 ──────────────────────────
    // (1) '대항력 제거' — 대항력 있으면 무조건 '대항력' (HUG 여부 무관). 사용 예) 미포함 '대항력'
    '대항력 제거':             it => /대항력/.test(it.specials || it.address || '') ? '대항력' : '',
    // (2) '대항력(HUG포함)' — 대항력 + HUG 같이 있으면 살림. 대항력만 있으면 '제거대상'. 사용 예) 미포함 '제거대상'
    '대항력(HUG포함)':         it => _daeNoHugMark(it),
    // 호환: 옛 이름들도 같은 동작 유지
    '대항력(HUG제외)':         it => _daeNoHugMark(it),
    '대항력 (HUG제외)':        it => _daeNoHugMark(it)
  };
  function _daeNoHugMark(it) {
    const s = (it.specials || it.address || '');
    const hasDae = /대항력/.test(s);
    const hasHug = /HUG|주택도시보증|임차권인수조건변경/.test(s);
    return hasDae && !hasHug ? '제거대상' : '안전';
  }
  // 라벨 콤마 CSV → 결과 매칭용 키워드 콤마 CSV
  function expandSpecialsLabels(labelsCSV) {
    const labels = String(labelsCSV || '').split(',').map(s => s.trim()).filter(Boolean);
    const out = [];
    labels.forEach(lab => {
      const it = (D.SPECIAL || []).find(o => o.t === lab);
      if (!it) return;
      const src = it.kw && it.kw.length ? it.kw : it.t;
      src.split(',').forEach(k => {
        const t = k.trim();
        if (t && !out.includes(t)) out.push(t);
      });
    });
    return out.join(',');
  }
  function applyCustomFilters(items, rows) {
    if (!rows || !rows.length) return { items, applied: 0, skipped: [] };
    const handlers = [];
    const skipped = [];
    rows.forEach(r => {
      if (!r.typeId || !r.value) return; // 빈 값은 무시
      const t = ftypes.find(x => x.id === r.typeId);
      if (!t) return;
      const fn = FILTER_FIELDS[t.name];
      if (!fn) { skipped.push(t.name); return; }
      if (t.valueType === 'specials' || t.valueType === 'special1') {
        // 특수물건(단일 special1 / 다중 specials) — 라벨→키워드 그룹으로 평가 (다중은 AND/OR 토글)
        const groups = specialsGroupsFor(r.value);
        if (!groups.length) return; // 매핑 가능한 항목 없음 → 무시
        handlers.push({ name: t.name, fn, op: r.op || 'eq', groups, logic: r.logic || 'or', isSpecials: true });
      } else {
        if (!r.value) return; // 빈 값은 무시
        handlers.push({ name: t.name, fn, op: r.op || 'eq', value: r.value });
      }
    });
    if (!handlers.length) return { items, applied: 0, skipped };
    const filtered = items.filter(it => handlers.every(h =>
      h.isSpecials ? cmpSpecials(h.fn(it), h.op, h.groups, h.logic) : cmp(h.fn(it), h.op, h.value)
    ));
    return { items: filtered, applied: handlers.length, skipped };
  }

  // 크롤링 진행 중 [중지] 버튼 토글
  function setCrawlRunning(running) {
    const run = document.getElementById('btnRunCrawl');
    const cancel = document.getElementById('btnCancelCrawl');
    if (run)    run.classList.toggle('hidden', !!running);
    if (cancel) cancel.classList.toggle('hidden', !running);
  }

  // 백엔드 진행상황 폴링 (크롤링 중 1초마다)
  let _progressTimer = null;
  function startProgressPolling() {
    stopProgressPolling();
    const myTimer = setInterval(async () => {
      // ★ leftover 가드: clearInterval 후에도 in-flight fetch 가 응답 받으면 호출됨 → 다음 batch iteration 의 박스를 옛 옵저버로 덮는 사고 방지
      try {
        const r = await fetch('/api/progress');
        if (_progressTimer !== myTimer) return;
        if (!r.ok) return;
        const p = await r.json();
        // ★ 가로채기/세션누락 감지 시 prefix 강조 — retry 발동 vs 미발동(retry OFF) 분기
        const hijackN = Number(p.hijack_count) || 0;
        let hijackPrefix = '';
        if (hijackN > 0) {
          hijackPrefix = `⚠ 가로채기 — 재로그인 ${hijackN}회 · `;
        } else if (p.hijack_detected) {
          hijackPrefix = `⚠ 비로그인 감지 (재시도 OFF) · `;
        }
        let msg;
        if (p.stage === 'login')        msg = hijackPrefix + (hijackN > 0 ? '재로그인 중...' : '옥션원 로그인 중...');
        else if (p.stage === 'search')  msg = hijackPrefix + '옥션원 검색 중...';
        else if (p.stage === 'paging')  {
          msg = hijackPrefix + `페이지 ${p.pages_done} 진행 중 · ${p.current}` +
                (p.total ? ` / ${p.total}건` : '건');
        } else if (p.stage === 'cancelled') msg = `⏹ 중지 처리 중... (${p.current}건 까지)`;
        else                            msg = hijackPrefix + '크롤링 진행 중...';
        setStatus(msg, hijackN > 0);
        // 상단 [전체] 카운트 미리보기
        const elAll = document.getElementById('resCountAll');
        if (elAll && p.total) elAll.textContent = `${p.current}/${p.total}`;
        else if (elAll) elAll.textContent = p.current || 0;
      } catch (e) { /* 일시 실패 무시 */ }
    }, 1000);
    _progressTimer = myTimer;
  }
  function stopProgressPolling() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  }
  async function cancelCrawl() {
    setStatus('중지 신호 전송 중...');
    try {
      const r = await fetch('/api/cancel');
      if (r.ok) setStatus('중지 신호 전송됨 — 진행 중인 페이지 끝나면 결과 반환');
      else      setStatus('중지 신호 실패', true);
    } catch (e) {
      setStatus('중지 신호 실패: ' + (e.message || e), true);
    }
  }

  // ── 크롤링 실행 (백엔드 /api/crawl 호출) ─────────────────────
  async function runCrawl() {
    // ★ 미저장(신규) 리스트는 결과를 보관할 캐시 키(currentPresetId)가 없어 저장이 안 됨 → 크롤 차단.
    //   (저장된 리스트라야 IndexedDB 캐시에 보관되고 새로고침/재접속에도 유지됨)
    if (!currentPresetId) {
      alert('이 리스트는 아직 저장되지 않아 크롤링 결과를 보관할 수 없습니다.\n\n먼저 [저장] 으로 리스트를 저장한 뒤 크롤링하세요.');
      setStatus('미저장 리스트 — 저장 후 크롤링하세요', true);
      return;
    }
    const formData = collectFormData();
    const customFilters = custRows.slice();
    const titleEl = document.getElementById('presetTitle');
    const title = titleEl ? titleEl.value : '';
    const resultPanel = document.getElementById('resultPanel');
    const resBody = document.getElementById('resBody');
    const resCount = document.getElementById('resCount');
    resultPanel.classList.remove('hidden');
    resBody.innerHTML = '<tr><td colspan="8" class="center" style="padding:40px 0;color:#2563eb;">크롤링 실행 중... (옥션원 자동 검색) — 중지 가능</td></tr>';
    setResultCounts(0, 0, 0);  // 전체/필터링 카운트 모두 리셋 (이전 크롤 잔재 표시 방지)
    setStatus('크롤링 실행 중... (중지하려면 [⏹ 중지])');
    setCrawlRunning(true);
    // ★ 단일 크롤 모드 (일괄이 아닐 때) — 일괄 크롤 모달을 1개 박스로 재사용해서 진행/가로채기/PW오류 알림 표시
    const isSingle = !__batchCrawlActive__;
    if (isSingle) {
      const _pTitle = title || (currentPresetId ? '(' + currentPresetId + ')' : '단일 크롤');
      openBatchModal([{ title: _pTitle, id: currentPresetId || 'single' }], '🔄 크롤링 진행');
      __batchStatusObserver__ = function (msg) {
        if (typeof msg === 'string' && msg) updateBatchItem(0, 'b-running', '🔄', msg.length > 100 ? msg.substring(0, 100) + '…' : msg);
      };
    }
    startProgressPolling();
    try {
      const _acc = getActiveAccount();
      const r = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title, formData: formData, customFilters: customFilters,
          settings: getCrawlSettings(),
          account: { id: _acc.id, pw: _acc.pw, label: _acc.label },
        })
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || '백엔드 오류');
      // 가로채기/PW오류 등 응답 메타 (batch loop 가 결과 표시에 사용)
      // raw_count 추가 — 옥션원 응답이 너무 커서 캐시 저장 실패해도 batch loop 가 "0건" 으로 잘못 표시 안 하게
      window._lastCrawlMeta = {
        hijack_count: data.hijack_count || 0,
        hijack_detected: !!data.hijack_detected,
        cancelled: !!data.cancelled,
        auth_error: !!data.auth_error,
        auth_error_reason: data.auth_error_reason || '',
        raw_count: (data.items && data.items.length) || 0,
        cache_saved: false,  // 아래 캐시 저장 단계에서 갱신
      };
      // ★ PW 오류 자동 감지 — 활성 계정의 검증 결과를 자동으로 "✗ 실패" 로 업데이트 + 일시 갱신
      // 사용자가 별도로 [검증하기] 안 눌러도, 누가 옥션원 PW 바꾸면 즉시 검증 실패로 마킹됨
      if (data.auth_error) {
        const _activeIdx = getActiveAccountIdx();
        setAccountVerify(_activeIdx, {
          ok: false,
          reason: '🚨 크롤링 중 자동 감지 — ' + (data.auth_error_reason || 'PW 오류'),
        });
      }
      const raw = data.items || [];
      const ts = Date.now();
      const { filtered, applied, skipped } = applyAndRender(raw, customFilters, ts);
      // 결과 캐시 — IndexedDB (수백 MB ~ GB quota) 라 단순 저장. lite/LRU/minimal 폐기.
      // base64 이미지 + _html 모두 원본 보존 → MAPS 전송 / 결과 패널 / 사이드바 카운트 다 정상.
      if (currentPresetId) {
        cacheSet(currentPresetId, { items: raw, ts });
        try { localStorage.setItem(LS_LAST_PRESET, currentPresetId); } catch (_) {}
        if (window._lastCrawlMeta) window._lastCrawlMeta.cache_saved = true;
        console.log(`[idb] saved ${currentPresetId}: ${raw.length} items`);
      }
      let msg = `옥션원 ${raw.length}건 수신`;
      if (data.cancelled) msg = `⏹ 중지됨 — 옥션원 ${raw.length}건까지 받음`;
      if (applied) msg += ` · 추가필터 후 ${filtered.length}건`;
      if (skipped.length) {
        msg += ` · 미지원 필터 무시: ${skipped.join(', ')}`;
        if (!__batchCrawlActive__) alert(`아래 필터 종류는 매핑이 없어 무시됐습니다:\n\n${skipped.join(', ')}\n\n[필터 종류 관리]에서 정확한 이름으로 변경하세요.\n\n지원 목록:\n${Object.keys(FILTER_FIELDS).join(', ')}`);
      }
      setStatus(msg, !!data.cancelled || skipped.length > 0);
      // 단일 모드 결과 박스 표시 — 가로채기/PW오류/N건/캐시저장실패 분기
      if (isSingle) {
        const _meta = window._lastCrawlMeta || {};
        const _hN = Number(_meta.hijack_count) || 0;
        const _hD = !!_meta.hijack_detected;
        const _cacheSaved = !!_meta.cache_saved;
        let _cls, _icon, _sub;
        if (raw.length > 0) {
          _cls = 'b-done'; _icon = '✓';
          const _cacheTag = !_cacheSaved ? ' (⚠ 캐시 저장 실패: 결과 너무 큼)' : '';
          _sub = raw.length + '건 수신' + (applied ? ' · 추가필터 후 ' + filtered.length + '건' : '') + (_hN > 0 ? ' ⚠가로채기' + _hN + '회 복구' : '') + _cacheTag + (data.cancelled ? ' (중지됨)' : '');
        } else if (_meta.auth_error) {
          _cls = 'b-warning'; _icon = '⚠';
          _sub = '🚨 0건 — PW 오류 자동 감지: "' + (_meta.auth_error_reason || '인증 거부') + '". 활성 계정 검증결과 자동 ✗ 갱신됨. ⚙ 에서 PW 수정 + 재검증 필요';
        } else if (_hN > 0) {
          _cls = 'b-warning'; _icon = '⚠';
          _sub = '🚨 0건 — 가로채기 ' + _hN + '회 복구 시도했으나 실패. ⚙ [검증하기] 로 ID/PW 확인 권장';
        } else if (_hD) {
          _cls = 'b-warning'; _icon = '⚠';
          _sub = '🚨 0건 — 옥션원 비로그인 감지 (PW 오류 또는 세션 가로채기). ⚙ [검증하기] 로 확인 권장';
        } else {
          _cls = 'b-warning'; _icon = '⚠';
          _sub = '0건 — 옥션원에 검색결과 자체가 0건이거나 옥션원 응답 이상';
        }
        updateBatchItem(0, _cls, _icon, _sub);
        updateBatchProgress(1, 1);
      }
    } catch (e) {
      resBody.innerHTML = `<tr><td colspan="8" class="center" style="padding:40px 0;color:#dc2626;">크롤링 실패: ${escHtml(String(e.message || e))}<br><span class="muted small">crawler.py 가 실행 중인지 확인 (python crawler.py)</span></td></tr>`;
      setStatus('크롤링 실패', true);
      if (isSingle) {
        updateBatchItem(0, 'b-fail', '✗', '크롤링 실패: ' + String(e.message || e));
        updateBatchProgress(1, 1);
      }
    } finally {
      stopProgressPolling();
      setCrawlRunning(false);
      // 단일 모드 — 옵저버 해제 + 닫기 활성화
      if (isSingle) {
        __batchStatusObserver__ = null;
        finishBatchModal();
      }
      // 사이드바 캐시 표시 갱신
      renderSidebar();
    }
  }

  // 결과 캐시 시각 표시 (붉은색)
  function showResTimestamp(ts) {
    const el = document.getElementById('resTimestamp');
    if (!el) return;
    if (!ts) { el.textContent = ''; return; }
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    el.textContent = `검색: ${stamp}`;
  }

  // 결과 카운트 + 뷰 탭 갱신
  function setResultCounts(rawN, filteredN, applied) {
    const elFiltered = document.getElementById('resCountFiltered');
    const elAll      = document.getElementById('resCountAll');
    const elLegacy   = document.getElementById('resCount');
    if (elFiltered) elFiltered.textContent = filteredN;
    if (elAll)      elAll.textContent      = rawN;
    // '제외' 버튼 카운트 = 필터로 빠진 건수 (전체 - 필터링)
    const elExcluded = document.getElementById('resCountExcluded');
    if (elExcluded) elExcluded.textContent = Math.max(0, rawN - filteredN);
    // 호환성: 기존 resCount 도 업데이트 (안 보이지만 데이터 바인딩 코드 있을 수 있음)
    if (elLegacy)   elLegacy.textContent   = applied ? `${rawN} → ${filteredN} (필터 ${applied}개 적용)` : rawN;
  }

  // 뷰 전환: '필터링'/'전체'/'제외' 탭 클릭 시 동일 데이터에서 표시만 토글
  function setViewMode(mode) {
    viewMode = (mode === 'all') ? 'all' : (mode === 'excluded') ? 'excluded' : 'filtered';
    document.getElementById('viewTabFiltered')?.classList.toggle('active', viewMode === 'filtered');
    document.getElementById('viewTabAll')?.classList.toggle('active', viewMode === 'all');
    document.getElementById('viewTabExcluded')?.classList.toggle('active', viewMode === 'excluded');
    let items;
    if (viewMode === 'all') items = lastRawItems;
    else if (viewMode === 'excluded') {
      const passSet = new Set(lastFilteredItems || []);
      items = (lastRawItems || []).filter(it => !passSet.has(it));   // 필터로 빠진 건만
    } else items = lastFilteredItems;
    renderResults(items);
  }

  // 새 결과를 받았을 때 통합 처리 — raw 보관, filtered 계산, 카운트 + 뷰모드 + 정렬 적용
  function applyAndRender(rawItems, customFilters, ts) {
    const { items: filtered, applied, skipped } = applyCustomFilters(rawItems, customFilters);
    lastRawItems = rawItems;
    lastFilteredItems = filtered;
    lastFilterApplied = applied;
    setResultCounts(rawItems.length, filtered.length, applied);
    updateCustRowCounts();   // 추가필터 행별 단독 통과 건수 갱신
    showResTimestamp(ts);
    document.getElementById('resultPanel').classList.remove('hidden');
    applySort(); // 현재 정렬 키 있으면 적용
    setViewMode(viewMode);
    // 사이드바 활성 프리셋 카운트도 갱신 (custRows 변경/재필터 시 동기화)
    renderSidebar();
    return { filtered, applied, skipped };
  }

  // 캐시된 raw 에 현재 편집 중인 custRows 적용 (셀레니움 안 돌림).
  // 메모리(lastRawItems) 가 있으면 우선 사용 — full *_html 보존 (캐시는 lite 일 수도)
  // quiet=true: 캐시 없음/프리셋 미선택 에러·미지원 알림을 띄우지 않음 (필터 토글 시 라이브 재적용용)
  function refilterFromCache(opts) {
    const quiet = !!(opts && opts.quiet);
    if (!currentPresetId) { if (!quiet) setStatus('프리셋을 먼저 선택/저장하세요.', true); return; }
    let raw, ts;
    if (lastRawItems && lastRawItems.length) {
      raw = lastRawItems;
      ts = Date.now();
    } else {
      let cache;
      try { cache = cacheGetSync(currentPresetId); } catch (e) { cache = null; }
      if (!cache || !Array.isArray(cache.items)) { if (!quiet) setStatus('캐시 없음 — 먼저 [크롤링 실행] 한 번 필요', true); return; }
      raw = cache.items;
      ts = cache.ts;
    }
    const { filtered, skipped } = applyAndRender(raw, custRows.slice(), ts);
    let msg = `재필터링: 옥션원 ${raw.length}건 → ${filtered.length}건`;
    if (skipped.length) {
      msg += ` · 미지원 필터 무시: ${skipped.join(', ')}`;
      if (!quiet) alert(`아래 필터 종류는 매핑이 없어 무시됐습니다:\n\n${skipped.join(', ')}\n\n[필터 종류 관리]에서 이름을 정확히 (예: "특수물건", "주소 시도") 사용하세요.`);
    }
    setStatus(msg, skipped.length > 0);
  }

  // 캐시된 결과 복원 (프리셋 로드 / 페이지 시작 시)
  function restoreCachedResult(presetId) {
    if (!presetId) return false;
    let cache;
    try { cache = cacheGetSync(presetId); } catch (e) { cache = null; }
    if (!cache || !Array.isArray(cache.items)) return false;
    const preset = presets.find(p => p.id === presetId);
    applyAndRender(cache.items, (preset?.customFilters) || [], cache.ts);
    return true;
  }

  // 결과 화면 비우기 (공통)
  function blankResultPanel(noteText) {
    lastRawItems = [];
    const resBody = document.getElementById('resBody');
    if (resBody) resBody.innerHTML = `<tr><td colspan="8" class="center" style="padding:40px 0;color:#9ca3af;">${noteText || '초기화됨 — [크롤링 실행] 으로 다시 가져오세요'}</td></tr>`;
    setResultCounts(0, 0, 0);
  }

  // [초기화] 현재 결과 패널의 열린 리스트 = currentPresetId 의 크롤링 캐시 삭제 + 화면 비움. (확인 팝업)
  function clearCurrentResult() {
    if (!currentPresetId) { setStatus('선택/저장된 리스트가 없습니다.', true); return; }
    const preset = presets.find(p => p.id === currentPresetId);
    const nm = preset ? (preset.title || preset.id) : currentPresetId;
    if (!confirm(`"${nm}" 리스트의 가져온 결과를 초기화합니다.\n(크롤링 캐시 삭제 — 다시 [크롤링 실행] 하면 복구)\n\n진행할까요?`)) return;
    cacheDel(currentPresetId);
    blankResultPanel();
    renderSidebar();
    setStatus('결과 초기화 완료 — 다시 크롤링하세요');
  }

  // [초기화] 사이드바에서 체크된 리스트들의 크롤링 캐시 삭제. (확인 팝업)
  function clearCheckedCaches() {
    if (!selectedSyncIds.size) { alert('초기화할 리스트를 사이드바 체크박스로 선택하세요.'); return; }
    const ids = Array.from(selectedSyncIds);
    const names = ids.map(id => { const p = presets.find(x => x.id === id); return p ? (p.title || p.id) : id; });
    const shown = names.slice(0, 10).join(', ') + (names.length > 10 ? ` 외 ${names.length - 10}개` : '');
    if (!confirm(`체크된 ${ids.length}개 리스트의 크롤링 결과(캐시)를 초기화합니다.\n\n${shown}\n\n다시 크롤링하면 복구됩니다. 진행할까요?`)) return;
    ids.forEach(id => cacheDel(id));
    // 현재 열린 리스트가 초기화 대상이면 화면도 비움
    if (currentPresetId && ids.includes(currentPresetId)) blankResultPanel();
    renderSidebar();
    setStatus(`${ids.length}개 리스트 결과 초기화 완료`);
  }

  // 옥션원 셀 HTML 후처리: 상대 URL 절대화, onclick 제거, a 태그 새창 강제
  const A1_BASE = 'https://www.auction1.co.kr';
  function rewriteCellHtml(html) {
    if (!html) return '';
    let h = String(html);
    // 절대 경로(/foo) → https://www.auction1.co.kr/foo
    h = h.replace(/(\b(?:src|href))=(["'])\/([^"']*)\2/gi, (_m, attr, q, path) => `${attr}=${q}${A1_BASE}/${path}${q}`);
    // 옥션원 내부 함수 호출은 우리 도메인에서 작동 안 함 → 제거
    h = h.replace(/\son[a-z]+="[^"]*"/gi, '');
    h = h.replace(/\son[a-z]+='[^']*'/gi, '');
    // 모든 <a> 새창 + referrer 보호
    h = h.replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"');
    return h;
  }

  // 사건번호 셀 가공: 메모 분리 + 옥션원 [새 창] 버튼 살리기 + 사건번호 텍스트 클래스 부착
  function splitInterestMemo(cellHtml, idx) {
    const tmp = document.createElement('div');
    tmp.innerHTML = cellHtml;

    // 1) 관심물건 메모(.interest_box) 분리
    const memos = tmp.querySelectorAll('.interest_box');
    const memoHtml = memos.length ? Array.from(memos).map(m => m.outerHTML).join('') : '';
    memos.forEach(m => m.remove());

    // 2) 옥션원 [새 창] span (img.new_blank 부모) → 우리 클릭 핸들러 부착용 클래스 + idx
    const newWinImg = tmp.querySelector('img[src*="new_blank"]');
    const newWinSpan = newWinImg ? newWinImg.closest('span') : null;
    if (newWinSpan) {
      newWinSpan.classList.add('newwin-btn');
      newWinSpan.dataset.idx = String(idx);
      newWinSpan.setAttribute('title', '새창으로 사건상세 열기');
    }

    // 3) 사건번호 텍스트 wrapper 식별 → .sakun-no-text 클래스
    const sakunSpan = tmp.querySelector('span[id^="rFEs"], span[id^="rFE"]') || tmp.querySelector('span');
    if (sakunSpan) sakunSpan.classList.add('sakun-no-text');

    return { html: tmp.innerHTML, memo: memoHtml };
  }

  // 옥션원 새창 — 입찰물건관리/옥션원 가기 와 동일 크기
  const A1_POPUP_OPTS = 'width=896,height=900,left=100,top=50,resizable=yes,scrollbars=yes';
  function openAuctionPopup(url) {
    if (!url) return;
    window.open(url, '_auction', A1_POPUP_OPTS);
  }
  function closeCaseModal() {
    const modal = document.getElementById('caseModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.getElementById('caseModalBody').innerHTML = '';
  }

  // 메모 모달 열기/닫기
  function openMemoModal(title, memoHtml) {
    const modal = document.getElementById('memoModal');
    document.getElementById('memoModalTitle').textContent = title || '관심물건 메모';
    document.getElementById('memoModalBody').innerHTML = memoHtml || '<div class="muted">메모가 없습니다.</div>';
    modal.classList.remove('hidden');
  }
  function closeMemoModal() {
    document.getElementById('memoModal').classList.add('hidden');
  }

  // 결과 뷰 상태 — '필터링'(필터 적용) / '전체'(raw) 탭 토글
  let viewMode = 'filtered';        // 'filtered' | 'all'
  let lastRawItems = [];             // 옥션원 원본 (필터 전)
  let lastFilteredItems = [];        // 필터 적용 결과
  let lastFilterApplied = 0;
  let lastItems = [];

  // 정렬 상태
  let sortKey = null;   // null | 'sakun_no' | 'prop_kind' | 'address' | 'appraisal' | 'low' | 'pyeong' | 'failrate' | 'failcnt' | 'biddate' | 'biddays' | 'view'
  let sortDir = 'asc';  // 'asc' | 'desc'

  // 정렬 키별 값 추출기
  const SORT_GETTERS = {
    sakun_no:  it => it.sakun_no || '',
    prop_kind: it => it.prop_kind || '',
    address:   it => it.address || '',
    appraisal: it => parsePriceCell(it.price).appraisal || 0,
    low:       it => parsePriceCell(it.price).low || 0,
    pyeong:    it => {
      const m = String(it.price || '').match(/평당[^\d]*([\d,]+)/);
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
    },
    failrate:  it => parsePriceCell(it.price).pct || 0,
    failcnt:   it => parseFailCount(it.status) || 0,
    biddate:   it => {
      // "2026.05.12" 또는 "2026-05-12" 형태 → 비교 가능 문자열
      const m = String(it.bid_date || '').match(/(\d{4})[.\-](\d{2})[.\-](\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    },
    biddays:   it => {
      const m = String(it.bid_date || '').match(/입찰\s*(\d+)\s*일전/);
      return m ? parseInt(m[1], 10) : (/오늘/.test(it.bid_date || '') ? 0 : 9999);
    },
    view:      it => parseInt(String(it.view_count || '0').replace(/[^\d]/g, ''), 10) || 0
  };

  // 두 값 비교 (숫자/문자열 자동 분기)
  function sortCompare(a, b, dir) {
    const m = dir === 'desc' ? -1 : 1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * m;
    return String(a).localeCompare(String(b), 'ko') * m;
  }

  // 정렬 적용 — lastRawItems / lastFilteredItems 둘 다 같은 키로 정렬
  function applySort() {
    if (!sortKey || !SORT_GETTERS[sortKey]) return;
    const get = SORT_GETTERS[sortKey];
    const sorter = (a, b) => sortCompare(get(a), get(b), sortDir);
    lastRawItems = lastRawItems.slice().sort(sorter);
    lastFilteredItems = lastFilteredItems.slice().sort(sorter);
  }

  // 정렬 컨트롤 active 표시 갱신 (▲▼)
  function refreshSortUI() {
    document.querySelectorAll('#sortBar .sort-tab[data-sort]').forEach(b => {
      const k = b.dataset.sort;
      const isOn = k === sortKey;
      b.classList.toggle('active', isOn);
      const arrow = isOn ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
      const label = b.textContent.replace(/\s*[▲▼]\s*$/, '');
      b.textContent = label + arrow;
    });
    document.querySelectorAll('#sortBar .sort-sel').forEach(s => {
      const isOn = s.value && s.value === sortKey;
      s.classList.toggle('active', !!isOn);
    });
  }

  // 정렬 키 설정 (같은 키면 방향 토글, 다른 키면 asc 부터)
  function setSort(key) {
    if (!key) { sortKey = null; sortDir = 'asc'; }
    else if (key === sortKey) { sortDir = (sortDir === 'asc' ? 'desc' : 'asc'); }
    else { sortKey = key; sortDir = 'asc'; }
    // select 동기화: sakun/price/bid 그룹 중 선택된 것 외 reset
    document.querySelectorAll('#sortBar .sort-sel').forEach(s => {
      const opts = Array.from(s.options).map(o => o.value).filter(Boolean);
      s.value = (sortKey && opts.includes(sortKey)) ? sortKey : '';
    });
    applySort();
    refreshSortUI();
    setViewMode(viewMode);
  }
  function renderResults(items) {
    const resBody = document.getElementById('resBody');
    if (!items.length) {
      resBody.innerHTML = '<tr><td colspan="8" class="center" style="padding:40px 0;color:#888;">결과 없음</td></tr>';
      lastItems = [];
      return;
    }
    // 사건번호 셀 미리 가공: rewrite → 메모 분리
    const enriched = items.map((it, idx) => {
      const rewritten = rewriteCellHtml(it.sakun_html);
      const { html: sakunClean, memo } = splitInterestMemo(rewritten, idx);
      return { ...it, _sakun_html_clean: sakunClean, _memo_html: memo };
    });
    lastItems = enriched;

    resBody.innerHTML = enriched.map((it, idx) => {
      const img    = rewriteCellHtml(it.img_html)
                  || (it.img_url ? `<img src="${escAttr(it.img_url)}" style="max-width:100px;max-height:60px;" referrerpolicy="no-referrer">` : '');
      const sakun  = it._sakun_html_clean
                  || (`${escHtml(it.sakun_no)}<br><span class="f10 gray">${escHtml(it.prop_kind)}</span>`);
      const addr   = rewriteCellHtml(it.address_html) || escHtml(it.address);
      const price  = rewriteCellHtml(it.price_html)   || escHtml(it.price);
      const status = rewriteCellHtml(it.status_html)  || escHtml(it.status);
      const bid    = rewriteCellHtml(it.bid_html)     || escHtml(it.bid_date);
      const view   = rewriteCellHtml(it.view_html)    || escHtml(it.view_count);
      const viewUrl = it.view_url ? escAttr(it.view_url) : '';
      const memoBtn = it._memo_html
        ? `<button type="button" class="memo-btn" data-idx="${idx}" title="관심물건 메모">📝 메모</button>`
        : '';
      return `<tr data-idx="${idx}" data-view-url="${viewUrl}">
        <td class="center"><input type="checkbox" class="res-cb" data-idx="${idx}"></td>
        <td class="center">${img}</td>
        <td class="left sakun-cell" title="클릭: 사건상세 새창">${sakun}${memoBtn}</td>
        <td class="left">${addr}</td>
        <td class="center">${price}</td>
        <td class="center">${status}</td>
        <td class="center">${bid}</td>
        <td class="right">${view}</td>
      </tr>`;
    }).join('');

    // 사건번호 셀 클릭 → 사건 상세 새창
    // 셀의 옥션원 [새 창] 버튼 → 옥션원 popup (지정된 크기 새창)
    resBody.querySelectorAll('.newwin-btn').forEach(span => {
      span.style.cursor = 'pointer';
      span.addEventListener('click', e => {
        e.stopPropagation();
        const tr = span.closest('tr');
        const url = tr && tr.dataset.viewUrl;
        openAuctionPopup(url);
      });
    });
    // 사건번호 셀 클릭 → 옥션원 새창 (지정 크기). 메모/체크박스/새창버튼 클릭은 통과.
    resBody.querySelectorAll('.sakun-cell').forEach(cell => {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', e => {
        if (e.target.closest('a, input, button, .memo-btn, .newwin-btn')) return;
        const tr = cell.closest('tr');
        const url = tr && tr.dataset.viewUrl;
        if (!url) return;
        openAuctionPopup(url);
        cell.classList.add('visited');
      });
    });
    // 메모 버튼 클릭 → 모달
    resBody.querySelectorAll('.memo-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const item = lastItems[idx];
        if (!item) return;
        openMemoModal(`${item.sakun_no || ''} · 관심물건 메모`, item._memo_html);
      });
    });
  }

  // 메모 모달 닫기 핸들러 (init 에서 한 번만 바인딩)
  function bindMemoModal() {
    const memoModal = document.getElementById('memoModal');
    if (!memoModal) return;
    memoModal.querySelector('.modal-bg')?.addEventListener('click', closeMemoModal);
    document.getElementById('memoModalClose')?.addEventListener('click', closeMemoModal);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !memoModal.classList.contains('hidden')) closeMemoModal();
    });
  }

  // ── 면적 단위 자동 변환 (㎡ ↔ 평) ─────────────────────────
  // 1평 = 3.305785㎡, 1㎡ ≈ 0.3025평 (옥션원 기준)
  const M2_TO_PY = 0.3025;
  const PY_TO_M2 = 3.305785;
  let areaUpdating = false;
  function bindAreaConversion() {
    document.querySelectorAll('.area-inp').forEach(inp => {
      inp.addEventListener('input', () => {
        if (areaUpdating) return; // 페어 업데이트로 인한 재진입 방지
        const pairName = inp.dataset.areaPair;
        if (!pairName) return;
        const pair = document.querySelector('input[name="' + pairName + '"]');
        if (!pair) return;
        const raw = String(inp.value || '').replace(/,/g, '').trim();
        if (raw === '') {
          areaUpdating = true; pair.value = ''; areaUpdating = false;
          return;
        }
        const v = parseFloat(raw);
        if (isNaN(v)) return;
        const factor = inp.dataset.areaUnit === 'm2' ? M2_TO_PY : PY_TO_M2;
        const conv = v * factor;
        // 소수점 둘째까지, 끝의 0은 정리
        const out = (Math.round(conv * 100) / 100).toString();
        areaUpdating = true;
        pair.value = out;
        areaUpdating = false;
        if (typeof window.__refreshHighlights === 'function') window.__refreshHighlights();
      });
    });
  }

  // ── 보고서 모달 ──────────────────────────────────────────
  function _rptEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _rptDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function _rptMan(s) {
    if (!s) return '';
    const n = parseInt(String(s).replace(/[^0-9-]/g, ''), 10);
    if (isNaN(n)) return s;
    if (n >= 10000) return `${(n/10000).toLocaleString('ko-KR', {maximumFractionDigits:2})}억`;
    return `${n.toLocaleString('ko-KR')}만원`;
  }
  function _rptLookup(arr, v) {
    if (!arr || v == null || v === '') return '';
    const it = arr.find(o => String(o.v) === String(v));
    return it ? it.t : v;
  }
  // STATUS 는 '1,2,17,18' 같은 복합값이 하나의 라벨('진행물건') — 통째 매칭 우선
  function _rptStatus(v) {
    if (!v) return '';
    const exact = (D.STATUS || []).find(o => String(o.v) === String(v));
    if (exact) return exact.t;
    return String(v).split(',').map(x => {
      const f = (D.STATUS || []).find(o => String(o.v) === String(x).trim());
      return f ? f.t : x;
    }).filter(Boolean).join(', ');
  }
  function _rptRange(a, b, unit) {
    const aa = (a != null && a !== '') ? String(a) : '';
    const bb = (b != null && b !== '') ? String(b) : '';
    if (!aa && !bb) return '';
    return `${aa}~${bb}${unit ? ' ' + unit : ''}`;
  }
  function _rptFormData(fd) {
    if (!fd) return [];
    const out = [];
    const add = (k, v) => { if (v !== '' && v != null) out.push({ k, v }); };
    if (fd.court)    add('법원', _rptLookup(D.COURTS, fd.court));
    if (fd.branch)   add('법원지원', _rptLookup(D.BRANCHES, fd.branch));
    if (fd.caseYear || fd.caseNo) add('사건번호', `${fd.caseYear || ''}타경${fd.caseNo || ''}`);
    if (fd.apprMin || fd.apprMax) add('감정가', _rptRange(_rptMan(fd.apprMin), _rptMan(fd.apprMax)));
    if (fd.lowMin || fd.lowMax)   add('최저가', _rptRange(_rptMan(fd.lowMin), _rptMan(fd.lowMax)));
    if (fd.status)   add('물건현황', _rptStatus(fd.status));
    if (fd.failMin || fd.failMax) add('유찰횟수', _rptRange(fd.failMin, fd.failMax, '회'));
    if (fd.propType) add('물건종류', _rptLookup(D.PROPERTY_FLAT, fd.propType));
    if (Array.isArray(fd._multiProp) && fd._multiProp.length) {
      add('물건종류(다중)', fd._multiProp.map(v => _rptLookup(D.PROPERTY_FLAT, v)).filter(Boolean).join(', '));
    }
    if (fd.bidDateFrom || fd.bidDateTo) add('매각기일', _rptRange(fd.bidDateFrom, fd.bidDateTo));
    if (fd.regDateFrom || fd.regDateTo) add('보존등기일', _rptRange(fd.regDateFrom, fd.regDateTo));
    if (fd.bldArea1Min || fd.bldArea1Max) add('건물면적', _rptRange(fd.bldArea1Min, fd.bldArea1Max, '㎡'));
    if (fd.lndArea1Min || fd.lndArea1Max) add('대지면적', _rptRange(fd.lndArea1Min, fd.lndArea1Max, '㎡'));
    if (fd.addrSido) {
      let addr = _rptLookup(D.SIDO, fd.addrSido);
      if (fd.addrGugun) {
        const list = (D.GUGUN_BY_SIDO || {})[fd.addrSido] || [];
        const g = list.find(x => String(x.v) === String(fd.addrGugun));
        if (g) addr += ' / ' + g.t;
      }
      add('주소', addr);
    }
    if (Array.isArray(fd._addrTags) && fd._addrTags.length) {
      const addrText = fd._addrTags
        .map(a => (a && typeof a === 'object') ? (a.text || '') : String(a || ''))
        .filter(Boolean).join(', ');
      if (addrText) add('추가주소', addrText);
    }
    if (fd.bldName) add('건물명칭', fd.bldName);
    if (fd.lotKind || fd.lotFrom || fd.lotTo) {
      const kind = fd.lotKind === '1' ? '산' : (fd.lotKind === '2' ? '일반' : '');
      add('지번', `${kind} ${fd.lotFrom || ''}~${fd.lotTo || ''}`.trim());
    }
    if (fd.special)  add('특수물건', _rptLookup(D.SPECIAL, fd.special));
    if (fd.orderBy)  add('정렬', _rptLookup(D.ORDER_BY, fd.orderBy));
    if (fd.pageSize) add('페이지당', `${fd.pageSize}건`);
    if (fd.procType) add('경매절차', fd.procType === '4' ? '임의경매' : (fd.procType === '5' ? '강제경매' : ''));
    return out;
  }
  // MAPS sync 시 보고서용 라벨-친화 라인 + 캐시 통계 패키징.
  // cacheInfo 는 sendChecked 의 withItems[i] (rawCount/filteredCount/ts) 또는 null.
  function _buildSyncPresetEntry(p, cacheInfo) {
    var fdLines = [];
    try { fdLines = _rptFormData(p.formData); } catch (_) {}
    var cfLines = [];
    try {
      cfLines = (p.customFilters || []).map(function (c) {
        var f = _rptFilter(c);
        return { name: f.name, op: f.op, value: f.v };
      });
    } catch (_) {}
    // 캐시 통계 — cacheInfo 없으면 LS 캐시 직접 조회
    var rawN = '', filtN = '', ts = '';
    if (cacheInfo) {
      rawN = String(cacheInfo.rawCount || 0);
      filtN = String(cacheInfo.filteredCount || 0);
      ts = cacheInfo.ts ? String(cacheInfo.ts) : '';
    } else {
      try {
        var cache = cacheGetSync(p.id);
        if (cache && Array.isArray(cache.items)) {
          rawN = String(cache.items.length);
          try {
            var rows = (p.id === currentPresetId) ? custRows : (p.customFilters || []);
            var filt = applyCustomFilters(cache.items, rows);
            filtN = String((filt.items || []).length);
          } catch (_) { filtN = rawN; }
          if (cache.ts) ts = String(cache.ts);
        }
      } catch (_) {}
    }
    return {
      id: p.id,
      title: p.title || '',
      form_data_lines: JSON.stringify(fdLines),
      custom_filters_lines: JSON.stringify(cfLines),
      cache_total: rawN,
      cache_filtered: filtN,
      cache_ts: ts
    };
  }

  function _rptFilter(filter) {
    const t = ftypes.find(x => x.id === filter.typeId);
    const name = t ? t.name : '(알 수 없는 종류)';
    const opMap = { eq:'=', ne:'≠', gte:'≥', gt:'>', lte:'≤', lt:'<', contains:'포함', ncontains:'미포함', regex:'정규식' };
    let op = opMap[filter.op] || filter.op || '';
    // 특수물건 다중 + 값 2개 이상이면 AND/OR 표시 (모두 동시 / 하나라도)
    if (t && t.valueType === 'specials' && String(filter.value || '').split(',').filter(s => s.trim()).length > 1) {
      op += (filter.logic === 'and') ? ' (모두)' : ' (하나라도)';
    }
    return { name, op, v: filter.value || '' };
  }
  // 자동 분류 — 짧은 항목 2-col 페어, 긴 항목은 카드 아래쪽 full-row
  const _RPT_SHORT_LEN = 22;
  function _rptGroupPairs(lines) {
    const labelOf = l => l.label || l.k || '';
    const valOf   = l => l.val || l.v || '';
    const shorts = [], longs = [];
    lines.forEach(l => {
      const total = labelOf(l).length + valOf(l).length;
      if (total <= _RPT_SHORT_LEN) shorts.push(l); else longs.push(l);
    });
    const groups = [];
    for (let i = 0; i < shorts.length; i += 2) {
      if (i + 1 < shorts.length) groups.push([shorts[i], shorts[i+1]]);
      else                       groups.push([shorts[i]]);
    }
    longs.forEach(l => groups.push([l]));
    return groups;
  }
  function _rptKvCell(line, full) {
    const k = _rptEsc(line.label || line.k || '');
    const v = _rptEsc(line.val || line.v || '');
    return `<div class="kv-cell${full ? ' full-row' : ''}"><span class="kv-k">${k}</span><span class="kv-v">${v}</span></div>`;
  }

  function _rptCard(p) {
    let cache = null;
    try { cache = cacheGetSync(p.id); } catch (_) {}
    const items = cache ? (cache.items || []) : [];
    let filteredN = items.length;
    try {
      const { items: filt } = applyCustomFilters(items, p.customFilters || []);
      filteredN = filt.length;
    } catch (_) {}

    const fdLines = _rptFormData(p.formData);
    const groups = _rptGroupPairs(fdLines);
    const fdHtml = groups.length
      ? `<div class="kv-grid">${
          groups.map(g => g.length === 2 ? (_rptKvCell(g[0]) + _rptKvCell(g[1])) : _rptKvCell(g[0], true)).join('')
        }</div>`
      : '<div class="empty">설정된 검색조건 없음</div>';

    const cfHtml = (p.customFilters || []).length
      ? `<table class="cf-table">${
          (p.customFilters || []).map(c => {
            const f = _rptFilter(c);
            return `<tr><th class="cf-name">${_rptEsc(f.name)}</th><td class="cf-op">${_rptEsc(f.op)}</td><td class="cf-val">${_rptEsc(f.v)}</td></tr>`;
          }).join('')
        }</table>`
      : '<div class="empty">추가 필터 없음</div>';

    const lastTs = cache && cache.ts ? _rptDate(cache.ts) : '—';
    const countBadge = cache
      ? `<span class="cnt-badge"><span class="cnt-filtered">${filteredN}</span>/<span class="cnt-total">${items.length}</span></span>`
      : '<span class="cnt-badge cnt-empty">결과 없음</span>';

    return `<article class="rcard">
      <header class="rcard-head">
        <div class="rcard-title">📋 ${_rptEsc(p.title || '(제목 없음)')} ${countBadge}</div>
        <div class="rcard-sub">최근 크롤링: ${_rptEsc(lastTs)}</div>
      </header>
      <section class="rcard-sec"><h3>🔍 검색 조건</h3>${fdHtml}</section>
      <section class="rcard-sec"><h3>⚡ 추가 필터 (${(p.customFilters || []).length})</h3>${cfHtml}</section>
    </article>`;
  }
  function openReportModal() {
    const lastTs = p => { try { const c = cacheGetSync(p.id); return (c && c.ts) || p.updatedAt || 0; } catch (_) { return p.updatedAt || 0; } };
    const sorted = presets.slice().sort((a, b) => lastTs(b) - lastTs(a));
    document.getElementById('reportGenTs').textContent = _rptDate(Date.now());
    document.getElementById('reportGenCnt').textContent = sorted.length;
    document.getElementById('reportGrid').innerHTML = sorted.length
      ? sorted.map(_rptCard).join('')
      : '<div class="empty-state">등록된 크롤링이 없습니다.</div>';
    document.getElementById('reportModal').classList.remove('hidden');
    document.body.classList.add('report-open');
  }
  function closeReportModal() {
    document.getElementById('reportModal').classList.add('hidden');
    document.body.classList.remove('report-open');
  }

  // ── 입력박스 클릭/포커스 시 전체선택 (전역) ────────────────
  // 사용자 메모리: 텍스트 입력 박스는 한 번 클릭으로 기존 값 전체선택 → 즉시 덮어쓰기 가능.
  function bindGlobalInputSelectAll() {
    const ALLOWED = new Set(['text', 'number', 'search', 'tel', 'url', 'email', '']);
    function trySelect(el) {
      if (!el || el.tagName !== 'INPUT') return;
      const t = (el.type || '').toLowerCase();
      if (!ALLOWED.has(t)) return;
      try { el.select(); } catch (_) {}
    }
    document.addEventListener('focusin', e => trySelect(e.target));
    document.addEventListener('click',   e => trySelect(e.target));
  }

  // ── 초기화 ───────────────────────────────────────────
  // 옛 minimal 모드로 저장된 깨진 캐시 자동 정리 (img_url/_html 빠져 이미지·디자인 깨짐)
  function _cleanupMinimalCaches() {
    const removed = [];
    Object.keys(localStorage).filter(k => k.startsWith(LS_CACHE_PFX)).forEach(k => {
      try {
        const c = JSON.parse(localStorage.getItem(k) || '{}');
        if (c && c.minimal === true) {
          localStorage.removeItem(k);
          removed.push(k.substring(LS_CACHE_PFX.length));
        }
      } catch (_) {}
    });
    if (removed.length) {
      console.log(`[cleanup] minimal 모드 깨진 캐시 ${removed.length}개 자동 삭제 — 해당 프리셋 다시 [크롤링 실행] 필요:`, removed);
      try { setStatus(`⚠ minimal 깨진 캐시 ${removed.length}개 삭제됨 — 재크롤링 필요`, true); } catch (_) {}
    }
  }

  async function init() {
    fillStaticSelects();
    initSpecialCombo();
    // ★ IndexedDB 캐시 로드 (옛 localStorage 자동 마이그레이션 + persist 권한 요청)
    await _initCache();
    renderSidebar();
    bind();
    // 가격 input 클릭 → 프리셋 펼침
    document.querySelectorAll('.price-inp').forEach(inp => {
      inp.addEventListener('focus', () => openPricePreset(inp));
      inp.addEventListener('click', () => openPricePreset(inp));
    });
    bindAreaConversion();
    bindAddrCascade();
    bindValueHighlight();
    bindMemoModal();
    bindSpecialsFilterModal();
    bindGlobalInputSelectAll();
    document.getElementById('btnReport')?.addEventListener('click', openReportModal);
    document.getElementById('btnReportClose')?.addEventListener('click', closeReportModal);
    document.getElementById('btnReportPrint')?.addEventListener('click', () => window.print());
    setStatus('준비 완료');
    // 마지막에 본 프리셋 자동 복원 (캐시 결과 + 폼)
    try {
      const last = localStorage.getItem(LS_LAST_PRESET);
      if (last && presets.find(p => p.id === last)) loadPreset(last);
    } catch (e) {}
  }

  // ── 입력된 값 하이라이트 ────────────────────────────────
  function _hasValue(el) {
    if (!el || !el.name) return false;
    if (el.tagName === 'SELECT') {
      // 첫 옵션이 placeholder("", "전체", "-시/도-" 등) 인 경우 그 옵션 선택은 미입력으로 간주
      var v = el.value;
      return v !== '' && v !== '0';
    }
    var t = (el.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio') return el.checked;
    return String(el.value || '').trim() !== '';
  }
  function refreshHighlights() {
    var form = document.getElementById('filterForm');
    if (!form) return;
    Array.from(form.elements).forEach(function (el) {
      if (!el.name) return;
      el.classList.toggle('has-value', _hasValue(el));
    });
    // 특수물건 콤보 — hidden select 값에 따라 노랑 표시
    var sp = document.getElementById('f_special');
    var spBox = document.getElementById('specialCombo');
    if (sp && spBox) spBox.classList.toggle('has-value', sp.value !== '' && sp.value !== '0');
  }
  function bindValueHighlight() {
    var form = document.getElementById('filterForm');
    if (!form) return;
    form.addEventListener('input', refreshHighlights);
    form.addEventListener('change', refreshHighlights);
    // 폼 데이터 셋팅 직후에도 갱신할 수 있도록 노출
    window.__refreshHighlights = refreshHighlights;
    refreshHighlights();
  }

  // ── 주소 시/도 → 구/군 자동 채움 ─────────────────────────
  function bindAddrCascade() {
    const sidoEl  = document.getElementById('f_addrSido');
    const gugunEl = document.getElementById('f_addrGugun');
    const dongEl  = document.getElementById('f_addrDong');
    if (!sidoEl || !gugunEl) return;
    sidoEl.addEventListener('change', function () {
      const sidoCode = sidoEl.value;
      gugunEl.innerHTML = '<option value="">-구/군-</option>';
      if (dongEl) dongEl.innerHTML = '<option value="">-읍/면/동-</option>';
      if (!sidoCode) return;
      const list = (D.GUGUN_BY_SIDO || {})[sidoCode] || [];
      list.forEach(function (g) {
        const o = document.createElement('option');
        o.value = g.v; o.textContent = g.t;
        gugunEl.appendChild(o);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
