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
  const LS_CACHE_PFX  = 'auction1_cache_';      // + presetId → {items, ts}
  const LS_LAST_PRESET = 'auction1_last_preset'; // 마지막 active preset id

  // 기본 추가 필터 종류 (예시 - 처음 한번만 시드)
  const DEFAULT_FTYPES = [
    { id: 'ft_keyword',  name: '비고/특이사항 키워드 포함', valueType: 'text'   },
    { id: 'ft_failcnt',  name: '유찰 횟수',                valueType: 'number' },
    { id: 'ft_apprmin',  name: '감정가 최소 (만원)',       valueType: 'number' }
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
      if (raw) return JSON.parse(raw);
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

  // ── 사이드바 렌더 ───────────────────────────────────────
  function renderSidebar() {
    const list  = document.getElementById('sideList');
    const empty = document.getElementById('sideEmpty');
    if (!presets.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    const sorted = presets.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    list.innerHTML = sorted.map(p => {
      const active = p.id === currentPresetId ? ' active' : '';
      const date = p.updatedAt ? new Date(p.updatedAt).toLocaleString('ko-KR', { hour12: false }) : '';
      const cnt = (p.customFilters || []).length;
      return `<li class="snb_item${active}" data-id="${p.id}">
        <div class="it-title">${escHtml(p.title || '(제목 없음)')}</div>
        <div class="it-sub">${date} · 추가필터 ${cnt}건</div>
      </li>`;
    }).join('');
    list.querySelectorAll('.snb_item').forEach(el => {
      el.addEventListener('click', () => loadPreset(el.dataset.id));
    });
  }

  // ── 폼 → 객체, 객체 → 폼 ────────────────────────────────
  function collectFormData() {
    const form = document.getElementById('filterForm');
    const data = {};
    Array.from(form.elements).forEach(el => {
      if (!el.name) return;
      data[el.name] = el.value;
    });
    data._addrTags = addrTags.slice();
    data._multiProp = Array.from(multiPropSelected);
    return data;
  }
  function applyFormData(data) {
    const form = document.getElementById('filterForm');
    Array.from(form.elements).forEach(el => {
      if (!el.name) return;
      el.value = (data && data[el.name] != null) ? data[el.name] : '';
    });
    addrTags = (data && Array.isArray(data._addrTags)) ? data._addrTags.slice() : [];
    renderAddrTags();
    multiPropSelected = new Set((data && Array.isArray(data._multiProp)) ? data._multiProp : []);
    renderMultiPropTags();
    if (typeof window.__refreshHighlights === 'function') window.__refreshHighlights();
  }
  function clearForm() { applyFormData({}); }

  // ── 주소 태그 ──────────────────────────────────────────
  function renderAddrTags() {
    const wrap = document.getElementById('addrTags');
    if (!addrTags.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = addrTags.map((a, i) =>
      `<span class="addr-tag">${escHtml(a)} <button data-i="${i}" title="제거">×</button></span>`
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
    if (!multiPropSelected.size) { wrap.innerHTML = ''; return; }
    const idToText = {};
    D.PROPERTY_GROUPS.forEach(g => g.items.forEach(it => { idToText[it.v] = it.t; }));
    wrap.innerHTML = Array.from(multiPropSelected).map(v =>
      `<span class="multi-tag">${escHtml(idToText[v] || v)}</span>`
    ).join('');
  }

  // ── 추가 필터 행 렌더링 ───────────────────────────────────
  let custRows = []; // [{typeId, op, value}]
  function renderCustRows() {
    const wrap = document.getElementById('custFilterRows');
    if (!custRows.length) {
      wrap.innerHTML = `<div class="cust-empty">추가된 필터 조건이 없습니다. 아래 [+ 필터 조건 추가]를 눌러 추가하세요.</div>`;
      return;
    }
    wrap.innerHTML = custRows.map((r, i) => {
      const typeOpts = ftypes.map(t => `<option value="${t.id}"${t.id === r.typeId ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('')
                       + `<option value="__new__">+ 새 필터 종류 추가...</option>`;
      const opOpts = D.CUSTOM_OPS.map(o => `<option value="${o.v}"${o.v === r.op ? ' selected' : ''}>${o.t}</option>`).join('');
      return `<div class="cust-row" data-i="${i}">
        <select class="sel ftype-sel">${typeOpts}</select>
        <select class="sel fop-sel">${opOpts}</select>
        <input type="text" class="inp fval-inp" value="${escAttr(r.value || '')}" placeholder="비교값">
        <button class="row-del" title="이 행 삭제">×</button>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.cust-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelector('.ftype-sel').addEventListener('change', e => onCustTypeChange(i, e.target));
      row.querySelector('.fop-sel').addEventListener('change', e => { custRows[i].op = e.target.value; });
      row.querySelector('.fval-inp').addEventListener('input', e => { custRows[i].value = e.target.value; });
      row.querySelector('.row-del').addEventListener('click', () => { custRows.splice(i, 1); renderCustRows(); });
    });
  }
  function onCustTypeChange(idx, sel) {
    if (sel.value === '__new__') {
      const name = prompt('새 필터 종류 이름을 입력하세요\n(예: 임차인 수, 유치권 여부, 키워드 포함 등)');
      if (!name) { sel.value = custRows[idx].typeId || ''; return; }
      const newType = { id: uid('ft'), name: name.trim(), valueType: 'text' };
      ftypes.push(newType);
      saveFtypes();
      custRows[idx].typeId = newType.id;
      renderCustRows();
    } else {
      custRows[idx].typeId = sel.value;
    }
  }

  // ── 편집 모드 진입 ──────────────────────────────────────
  function newPreset() {
    currentPresetId = null;
    document.getElementById('editorMode').textContent = '새 크롤링 등록';
    document.getElementById('editorIdBadge').textContent = '';
    document.getElementById('btnDelete').classList.add('hidden');
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
    document.getElementById('presetTitle').value = p.title || '';
    applyFormData(p.formData || {});
    custRows = (p.customFilters || []).map(c => ({ ...c }));
    renderCustRows();
    showEditor();
    renderSidebar();
    // 캐시된 결과 자동 복원 (있으면)
    if (!restoreCachedResult(id)) {
      // 캐시 없으면 결과 패널 비움
      document.getElementById('resultPanel').classList.add('hidden');
      showResTimestamp(0);
    }
    try { localStorage.setItem(LS_LAST_PRESET, id); } catch (e) {}
  }
  function showEditor() {
    document.getElementById('editorPanel').classList.remove('hidden');
    document.getElementById('emptyHint').classList.add('hidden');
  }
  function hideEditor() {
    document.getElementById('editorPanel').classList.add('hidden');
    document.getElementById('emptyHint').classList.remove('hidden');
    currentPresetId = null;
    renderSidebar();
  }

  // ── 저장/삭제 ────────────────────────────────────────────
  function savePreset() {
    const title = document.getElementById('presetTitle').value.trim();
    if (!title) { setStatus('제목을 입력해 주세요.', true); return; }
    const formData = collectFormData();
    const customFilters = custRows.filter(r => r.typeId).map(r => ({
      typeId: r.typeId, op: r.op || 'eq', value: r.value || ''
    }));
    if (currentPresetId) {
      const idx = presets.findIndex(p => p.id === currentPresetId);
      if (idx >= 0) {
        presets[idx] = { ...presets[idx], title, formData, customFilters, updatedAt: Date.now() };
      }
    } else {
      const np = { id: uid('p'), title, formData, customFilters, updatedAt: Date.now() };
      presets.push(np);
      currentPresetId = np.id;
    }
    savePresets();
    setStatus('저장 완료');
    renderSidebar();
    document.getElementById('editorMode').textContent = '크롤링 수정';
    document.getElementById('editorIdBadge').textContent = '· ID: ' + currentPresetId;
    document.getElementById('btnDelete').classList.remove('hidden');
  }
  function deletePreset() {
    if (!currentPresetId) return;
    if (!confirm('이 크롤링을 삭제하시겠습니까?')) return;
    const id = currentPresetId;
    presets = presets.filter(p => p.id !== id);
    savePresets();
    try {
      localStorage.removeItem(LS_CACHE_PFX + id);
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
    addrTags.push(parts.join(' '));
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
  }
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
    document.getElementById('btnNewTop').addEventListener('click', newPreset);
    document.getElementById('btnNewMain').addEventListener('click', newPreset);
    document.getElementById('btnSave').addEventListener('click', savePreset);
    document.getElementById('btnDelete').addEventListener('click', deletePreset);
    document.getElementById('btnCancel').addEventListener('click', hideEditor);
    document.getElementById('btnReset').addEventListener('click', () => { clearForm(); custRows = []; renderCustRows(); });
    document.getElementById('btnRunCrawl').addEventListener('click', runCrawl);

    // 복수선택
    document.getElementById('btnMultiProp').addEventListener('click', openMultiPropModal);
    document.getElementById('multiPropApply').addEventListener('click', applyMultiProp);
    document.getElementById('multiPropClear').addEventListener('click', clearMultiProp);
    document.getElementById('multiPropClose').addEventListener('click', closeMultiPropModal);
    document.querySelector('#multiPropModal .modal-bg').addEventListener('click', closeMultiPropModal);

    // 주소 추가
    document.getElementById('btnAddrAdd').addEventListener('click', addAddress);

    // 추가 필터 조건
    document.getElementById('btnAddCustRow').addEventListener('click', () => {
      custRows.push({ typeId: ftypes[0]?.id || '', op: 'eq', value: '' });
      renderCustRows();
    });
    document.getElementById('btnManageTypes').addEventListener('click', openManageTypes);
    document.getElementById('btnRefilter').addEventListener('click', refilterFromCache);

    // 결과 뷰 탭: 필터링 / 전체
    document.getElementById('viewTabFiltered')?.addEventListener('click', () => setViewMode('filtered'));
    document.getElementById('viewTabAll')?.addEventListener('click', () => setViewMode('all'));

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
  // 예) "서울,경기,인천" + 미포함 → 셋 다 미포함이어야 통과 (every !includes)
  // 예) "서울,경기"     + 포함   → 둘 중 하나라도 포함이면 통과 (some includes)
  function cmp(itemVal, op, ref) {
    if (itemVal == null) return false;
    const isNum = typeof itemVal === 'number';
    const refRaw = String(ref || '');
    const refNum = parseFloat(refRaw.replace(/,/g, ''));
    const refStr = refRaw.trim();
    const itemStr = String(itemVal);
    switch (op) {
      case 'eq':        return isNum ? itemVal === refNum : itemStr === refStr;
      case 'ne':        return isNum ? itemVal !== refNum : itemStr !== refStr;
      case 'gte':       return isNum && itemVal >= refNum;
      case 'gt':        return isNum && itemVal >  refNum;
      case 'lte':       return isNum && itemVal <= refNum;
      case 'lt':        return isNum && itemVal <  refNum;
      case 'contains': {
        const tokens = refStr.split(',').map(s => s.trim()).filter(Boolean);
        return tokens.length ? tokens.some(t => itemStr.includes(t)) : false;
      }
      case 'ncontains': {
        const tokens = refStr.split(',').map(s => s.trim()).filter(Boolean);
        return tokens.length ? tokens.every(t => !itemStr.includes(t)) : true;
      }
      case 'regex':     try { return new RegExp(refStr).test(itemStr); } catch (e) { return false; }
      default:          return true;
    }
  }
  // 필터 종류 이름 → item 에서 비교값 추출
  // 새 종류 추가 시 여기에 핸들러를 등록.
  // address 토큰 분리: "경기도 광주시 신현동 ..." → ["경기도","광주시","신현동",...]
  function addrTokens(it) { return String(it.address || '').trim().split(/\s+/); }
  const FILTER_FIELDS = {
    '유찰율':                  it => parsePriceCell(it.price).pct,
    '유찰 횟수':               it => parseFailCount(it.status),
    '감정가 최소 (만원)':      it => { const a = parsePriceCell(it.price).appraisal; return a == null ? null : Math.round(a / 10000); },
    '비고/특이사항 키워드 포함': it => `${it.address} ${it.status} ${it.prop_kind}`,
    '주소':                    it => it.address || '',
    '주소 시도':               it => addrTokens(it)[0] || '',
    '주소시도':                it => addrTokens(it)[0] || '',
    '주소 구군':               it => addrTokens(it)[1] || '',
    '주소구군':                it => addrTokens(it)[1] || ''
  };
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
      handlers.push({ name: t.name, fn, op: r.op || 'eq', value: r.value });
    });
    if (!handlers.length) return { items, applied: 0, skipped };
    const filtered = items.filter(it => handlers.every(h => cmp(h.fn(it), h.op, h.value)));
    return { items: filtered, applied: handlers.length, skipped };
  }

  // ── 크롤링 실행 (백엔드 /api/crawl 호출) ─────────────────────
  async function runCrawl() {
    const formData = collectFormData();
    const customFilters = custRows.slice();
    const titleEl = document.getElementById('presetTitle');
    const title = titleEl ? titleEl.value : '';
    const resultPanel = document.getElementById('resultPanel');
    const resBody = document.getElementById('resBody');
    const resCount = document.getElementById('resCount');
    resultPanel.classList.remove('hidden');
    resBody.innerHTML = '<tr><td colspan="8" class="center" style="padding:40px 0;color:#2563eb;">크롤링 실행 중... (옥션원 자동 검색)</td></tr>';
    setStatus('크롤링 실행 중...');
    try {
      const r = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, formData: formData, customFilters: customFilters })
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || '백엔드 오류');
      const raw = data.items || [];
      const ts = Date.now();
      const { filtered, applied, skipped } = applyAndRender(raw, customFilters, ts);
      // 결과 캐시 — quota 초과 시 다른 프리셋 캐시 LRU 제거 후 재시도
      if (currentPresetId) {
        const payload = JSON.stringify({ items: raw, ts });
        const key = LS_CACHE_PFX + currentPresetId;
        let saved = false;
        try { localStorage.setItem(key, payload); saved = true; }
        catch (_) {
          try {
            // 다른 프리셋 캐시 모두 제거 → 재시도
            Object.keys(localStorage).forEach(k => { if (k.startsWith(LS_CACHE_PFX) && k !== key) localStorage.removeItem(k); });
            localStorage.setItem(key, payload); saved = true;
          } catch (_) { /* 그래도 큼 — 포기 */ }
        }
        // last_preset 은 작은 string — cache 와 분리해서 항상 저장
        try { localStorage.setItem(LS_LAST_PRESET, currentPresetId); } catch (_) {}
        if (!saved) console.warn('[cache] save failed (too large):', payload.length, 'bytes');
      }
      let msg = `옥션원 ${raw.length}건 수신`;
      if (applied) msg += ` · 추가필터 후 ${filtered.length}건`;
      if (skipped.length) msg += ` · 미지원 필터 무시: ${skipped.join(', ')}`;
      setStatus(msg);
    } catch (e) {
      resBody.innerHTML = `<tr><td colspan="8" class="center" style="padding:40px 0;color:#dc2626;">크롤링 실패: ${escHtml(String(e.message || e))}<br><span class="muted small">crawler.py 가 실행 중인지 확인 (python crawler.py)</span></td></tr>`;
      setStatus('크롤링 실패', true);
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
    // 호환성: 기존 resCount 도 업데이트 (안 보이지만 데이터 바인딩 코드 있을 수 있음)
    if (elLegacy)   elLegacy.textContent   = applied ? `${rawN} → ${filteredN} (필터 ${applied}개 적용)` : rawN;
  }

  // 뷰 전환: '필터링'/'전체' 탭 클릭 시 동일 데이터에서 표시만 토글
  function setViewMode(mode) {
    viewMode = mode === 'all' ? 'all' : 'filtered';
    document.getElementById('viewTabFiltered')?.classList.toggle('active', viewMode === 'filtered');
    document.getElementById('viewTabAll')?.classList.toggle('active', viewMode === 'all');
    const items = viewMode === 'all' ? lastRawItems : lastFilteredItems;
    renderResults(items);
  }

  // 새 결과를 받았을 때 통합 처리 — raw 보관, filtered 계산, 카운트 + 뷰모드 적용
  function applyAndRender(rawItems, customFilters, ts) {
    const { items: filtered, applied, skipped } = applyCustomFilters(rawItems, customFilters);
    lastRawItems = rawItems;
    lastFilteredItems = filtered;
    lastFilterApplied = applied;
    setResultCounts(rawItems.length, filtered.length, applied);
    showResTimestamp(ts);
    document.getElementById('resultPanel').classList.remove('hidden');
    setViewMode(viewMode); // 현재 모드로 렌더
    return { filtered, applied, skipped };
  }

  // 캐시된 raw 에 현재 편집 중인 custRows 적용 (셀레니움 안 돌림)
  function refilterFromCache() {
    if (!currentPresetId) { setStatus('프리셋을 먼저 선택/저장하세요.', true); return; }
    let cache;
    try { cache = JSON.parse(localStorage.getItem(LS_CACHE_PFX + currentPresetId) || 'null'); } catch (e) { cache = null; }
    if (!cache || !Array.isArray(cache.items)) { setStatus('캐시 없음 — 먼저 [크롤링 실행] 한 번 필요', true); return; }
    const { filtered, skipped } = applyAndRender(cache.items, custRows.slice(), cache.ts);
    let msg = `재필터링: 옥션원 ${cache.items.length}건 → ${filtered.length}건`;
    if (skipped.length) msg += ` · 미지원 필터 무시: ${skipped.join(', ')}`;
    setStatus(msg);
  }

  // 캐시된 결과 복원 (프리셋 로드 / 페이지 시작 시)
  function restoreCachedResult(presetId) {
    if (!presetId) return false;
    let cache;
    try { cache = JSON.parse(localStorage.getItem(LS_CACHE_PFX + presetId) || 'null'); } catch (e) { cache = null; }
    if (!cache || !Array.isArray(cache.items)) return false;
    const preset = presets.find(p => p.id === presetId);
    applyAndRender(cache.items, (preset?.customFilters) || [], cache.ts);
    return true;
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

  // ── 초기화 ───────────────────────────────────────────
  function init() {
    fillStaticSelects();
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
