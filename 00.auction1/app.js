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
    presets = presets.filter(p => p.id !== currentPresetId);
    savePresets();
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
    document.getElementById('btnRunCrawl').addEventListener('click', () => {
      const data = collectFormData();
      const cust = custRows.slice();
      console.log('[크롤링 실행 요청]', { title: document.getElementById('presetTitle').value, formData: data, customFilters: cust });
      // 결과 패널 노출 (현재는 placeholder. 백엔드 연결 후 실제 데이터 채워짐)
      document.getElementById('resultPanel').classList.remove('hidden');
      setStatus('크롤링 실행 요청 전송 (백엔드 연결 대기)');
    });

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
    setStatus('준비 완료');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
