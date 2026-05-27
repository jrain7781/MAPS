// 옥션원 크롤링 보고서 - 등록된 모든 프리셋을 한 페이지 카드로 렌더
(function () {
  'use strict';
  const D = window.AUCTION1_DATA;
  const LS_PRESETS = 'auction1_presets_v1';
  const LS_FTYPES  = 'auction1_ftypes_v1';
  const LS_CACHE_PFX = 'auction1_cache_';

  // ── 유틸 ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtNum(n) { return Number(n).toLocaleString('ko-KR'); }
  function fmtMan(s) {
    if (!s) return '';
    const n = parseInt(String(s).replace(/[^0-9-]/g, ''), 10);
    if (isNaN(n)) return s;
    if (n >= 10000) return `${(n/10000).toLocaleString('ko-KR', {maximumFractionDigits:2})}억`;
    return `${n.toLocaleString('ko-KR')}만원`;
  }
  function lookup(arr, v, key) {
    if (!arr) return v;
    const it = arr.find(o => String(o.v) === String(v));
    return it ? it[key || 't'] : v;
  }
  function looksupMulti(arr, csv, key) {
    if (!csv) return '';
    return String(csv).split(',').map(v => lookup(arr, v.trim(), key)).filter(Boolean).join(', ');
  }

  // ── formData → 사람-친화 텍스트 라인 배열 ─────────────────
  function formatFormData(fd) {
    if (!fd) return [];
    const out = [];
    const add = (label, val) => { if (val !== '' && val != null) out.push({ label, val }); };

    if (fd.court) add('법원', lookup(D.COURTS, fd.court));
    if (fd.branch) add('법원지원', lookup(D.BRANCHES, fd.branch));
    if (fd.caseYear || fd.caseNo) add('사건번호', `${fd.caseYear || ''}타경${fd.caseNo || ''}`);
    if (fd.apprMin || fd.apprMax) add('감정가', `${fmtMan(fd.apprMin) || '0'} ~ ${fmtMan(fd.apprMax) || '제한없음'}`);
    if (fd.lowMin || fd.lowMax) add('최저가', `${fmtMan(fd.lowMin) || '0'} ~ ${fmtMan(fd.lowMax) || '제한없음'}`);
    if (fd.status) add('물건현황', looksupMulti(D.STATUS, fd.status));
    if (fd.failMin || fd.failMax) add('유찰횟수', `${fd.failMin || '0'} ~ ${fd.failMax || '제한없음'} 회`);
    if (fd.propType) add('물건종류', lookup(D.PROPERTY_FLAT, fd.propType));
    if (Array.isArray(fd._multiProp) && fd._multiProp.length) {
      add('물건종류(다중)', fd._multiProp.map(v => lookup(D.PROPERTY_FLAT, v)).filter(Boolean).join(', '));
    }
    if (fd.bidDateFrom || fd.bidDateTo) add('매각기일', `${fd.bidDateFrom || ''} ~ ${fd.bidDateTo || ''}`);
    if (fd.regDateFrom || fd.regDateTo) add('보존등기일', `${fd.regDateFrom || ''} ~ ${fd.regDateTo || ''}`);
    if (fd.bldArea1Min || fd.bldArea1Max) add('건물면적', `${fd.bldArea1Min || '0'} ~ ${fd.bldArea1Max || '제한없음'} ㎡`);
    if (fd.lndArea1Min || fd.lndArea1Max) add('대지면적', `${fd.lndArea1Min || '0'} ~ ${fd.lndArea1Max || '제한없음'} ㎡`);
    // 위쪽 sido/gugun 단일 select 는 보고서에 기재하지 않음 (사용자 사양: 추가주소만)
    if (Array.isArray(fd._addrTags) && fd._addrTags.length) {
      var addrText = fd._addrTags.map(function (a) {
        return (a && typeof a === 'object') ? (a.text || '') : String(a || '');
      }).filter(Boolean).join(', ');
      if (addrText) add('추가주소', addrText);
    }
    if (fd.bldName) add('건물명칭', fd.bldName);
    if (fd.lotKind || fd.lotFrom || fd.lotTo) {
      const kind = fd.lotKind === '1' ? '산' : (fd.lotKind === '2' ? '일반' : '');
      add('지번', `${kind} ${fd.lotFrom || ''}~${fd.lotTo || ''}`.trim());
    }
    if (fd.special) add('특수물건', lookup(D.SPECIAL, fd.special));
    if (fd.orderBy) add('정렬', lookup(D.ORDER_BY, fd.orderBy));
    if (fd.pageSize) add('페이지당', `${fd.pageSize}건`);
    if (fd.procType) add('경매절차', fd.procType === '4' ? '임의경매' : (fd.procType === '5' ? '강제경매' : ''));
    return out;
  }

  // ── 추가 필터 → 텍스트 (각 행 1줄) ────────────────────────
  function formatFilter(filter, ftypes) {
    const t = ftypes.find(x => x.id === filter.typeId);
    const name = t ? t.name : '(알 수 없는 종류)';
    const opMap = { eq:'=', ne:'≠', gte:'≥', gt:'>', lte:'≤', lt:'<', contains:'포함', ncontains:'미포함', regex:'정규식' };
    const op = opMap[filter.op] || filter.op || '';
    const v = filter.value || '';
    return { name, op, v };
  }

  // ── 캐시 통계 ────────────────────────────────────────────
  function getCache(presetId) {
    try {
      const raw = localStorage.getItem(LS_CACHE_PFX + presetId);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  // ── 추가필터 매칭 로직 (app.js 와 동일 — 보고서에서도 카운트 재계산 위해 인라인) ─
  function expandSpecialsLabels(labelsCSV) {
    const labels = String(labelsCSV || '').split(',').map(s=>s.trim()).filter(Boolean);
    const out = [];
    labels.forEach(lab => {
      const it = (D.SPECIAL || []).find(o => o.t === lab);
      if (!it) return;
      const src = (it.kw && it.kw.length) ? it.kw : it.t;
      src.split(',').forEach(k => { const t = k.trim(); if (t && !out.includes(t)) out.push(t); });
    });
    return out.join(',');
  }
  function addrTokens(it) { return String(it.address || '').trim().split(/\s+/); }
  function _daeNoHugMark(it) {
    const s = (it.specials || it.address || '');
    const hasDae = /대항력/.test(s);
    const hasHug = /HUG|주택도시보증|임차권인수조건변경/.test(s);
    return hasDae && !hasHug ? '제거대상' : '안전';
  }
  function parsePriceCell(htmlOrText) {
    const text = String(htmlOrText || '').replace(/<[^>]+>/g, ' ');
    const nums = text.replace(/,/g, '').match(/\d{4,}/g) || [];
    const appraisal = nums[0] ? parseInt(nums[0], 10) : null;
    const low = nums[1] ? parseInt(nums[1], 10) : null;
    const pctMatch = text.match(/\((\d{1,3})\s*%\)/);
    let pct = pctMatch ? parseInt(pctMatch[1], 10) : null;
    if (pct == null && appraisal && low) pct = Math.round((low/appraisal)*100);
    return { appraisal, low, pct };
  }
  function parseFailCount(s) {
    const m = String(s || '').match(/유찰\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (/신건/.test(s || '')) return 0;
    return null;
  }
  const FILTER_FIELDS = {
    '유찰율': it => parsePriceCell(it.price).pct,
    '유찰 횟수': it => parseFailCount(it.status),
    '감정가 최소 (만원)': it => { const a = parsePriceCell(it.price).appraisal; return a == null ? null : Math.round(a/10000); },
    '비고/특이사항 키워드 포함': it => `${it.address} ${it.status} ${it.prop_kind} ${it.specials || ''}`,
    '주소': it => it.address || '',
    '주소 시도': it => addrTokens(it)[0] || '',
    '주소시도': it => addrTokens(it)[0] || '',
    '주소 구군': it => addrTokens(it)[1] || '',
    '주소구군': it => addrTokens(it)[1] || '',
    '특수물건': it => it.specials || it.address || '',
    '특수권리': it => it.specials || it.address || '',
    '특수물건 다중': it => it.specials || it.address || '',
    '물건종류': it => it.prop_kind || '',
    '대항력 제거': it => /대항력/.test(it.specials || it.address || '') ? '대항력' : '',
    '대항력(HUG포함)': _daeNoHugMark,
    '대항력(HUG제외)': _daeNoHugMark,
    '대항력 (HUG제외)': _daeNoHugMark
  };
  function cmp(itemVal, op, ref) {
    if (itemVal == null) return false;
    const isNum = typeof itemVal === 'number';
    const refRaw = String(ref || '');
    const refNum = parseFloat(refRaw.replace(/,/g, ''));
    const refStr = refRaw.trim();
    const itemStr = String(itemVal);
    switch (op) {
      case 'eq': return isNum ? itemVal === refNum : itemStr === refStr;
      case 'ne': return isNum ? itemVal !== refNum : itemStr !== refStr;
      case 'gte': return isNum && itemVal >= refNum;
      case 'gt': return isNum && itemVal > refNum;
      case 'lte': return isNum && itemVal <= refNum;
      case 'lt': return isNum && itemVal < refNum;
      case 'contains': { const tk = refStr.split(',').map(s=>s.trim()).filter(Boolean); return tk.length ? tk.some(t => itemStr.includes(t)) : false; }
      case 'ncontains': { const tk = refStr.split(',').map(s=>s.trim()).filter(Boolean); return tk.length ? tk.every(t => !itemStr.includes(t)) : true; }
      case 'regex': try { return new RegExp(refStr).test(itemStr); } catch (_) { return false; }
      default: return true;
    }
  }
  function applyFilters(items, rows, ftypes) {
    if (!rows || !rows.length) return items;
    const handlers = [];
    rows.forEach(r => {
      if (!r.typeId || !r.value) return;
      const t = ftypes.find(x => x.id === r.typeId);
      if (!t) return;
      const fn = FILTER_FIELDS[t.name];
      if (!fn) return;
      let value = r.value;
      if (t.valueType === 'specials') value = expandSpecialsLabels(value);
      if (!value) return;
      handlers.push({ fn, op: r.op || 'eq', value });
    });
    if (!handlers.length) return items;
    return items.filter(it => handlers.every(h => cmp(h.fn(it), h.op, h.value)));
  }

  // ── 카드 렌더링 ──────────────────────────────────────────
  function renderCard(p, ftypes) {
    const cache = getCache(p.id);
    const items = cache ? (cache.items || []) : [];
    const filtered = cache ? applyFilters(items, p.customFilters || [], ftypes) : [];

    const fdLines = formatFormData(p.formData);
    const fdHtml = fdLines.length
      ? `<table class="kv-table">${
          fdLines.map(l => `<tr><th>${esc(l.label)}</th><td>${esc(l.val)}</td></tr>`).join('')
        }</table>`
      : '<div class="empty">설정된 검색조건 없음</div>';

    const cfHtml = (p.customFilters || []).length
      ? `<table class="cf-table">${
          (p.customFilters || []).map(c => {
            const f = formatFilter(c, ftypes);
            return `<tr><th class="cf-name">${esc(f.name)}</th><td class="cf-op">${esc(f.op)}</td><td class="cf-val">${esc(f.v)}</td></tr>`;
          }).join('')
        }</table>`
      : '<div class="empty">추가 필터 없음</div>';

    const lastTs = cache && cache.ts ? fmtDate(cache.ts) : '—';
    const countBadge = cache
      ? `<span class="cnt-badge"><span class="cnt-filtered">${filtered.length}</span>/<span class="cnt-total">${items.length}</span></span>`
      : '<span class="cnt-badge cnt-empty">결과 없음</span>';

    return `<article class="rcard">
      <header class="rcard-head">
        <div class="rcard-title">📋 ${esc(p.title || '(제목 없음)')} ${countBadge}</div>
        <div class="rcard-sub">최근 크롤링: ${esc(lastTs)}</div>
      </header>
      <section class="rcard-sec">
        <h3>🔍 검색 조건</h3>
        ${fdHtml}
      </section>
      <section class="rcard-sec">
        <h3>⚡ 추가 필터 (${(p.customFilters || []).length})</h3>
        ${cfHtml}
      </section>
    </article>`;
  }

  // ── 초기화 ───────────────────────────────────────────────
  function init() {
    const presets = JSON.parse(localStorage.getItem(LS_PRESETS) || '[]');
    const ftypes  = JSON.parse(localStorage.getItem(LS_FTYPES) || '[]');

    // 최근 크롤링 시각 내림차순
    const ts = p => { const c = getCache(p.id); return (c && c.ts) || p.updatedAt || 0; };
    presets.sort((a, b) => ts(b) - ts(a));

    document.getElementById('genTs').textContent = fmtDate(Date.now());
    document.getElementById('genCnt').textContent = presets.length;
    document.getElementById('reportGrid').innerHTML =
      presets.map(p => renderCard(p, ftypes)).join('')
      || '<div class="empty-state">등록된 크롤링이 없습니다.</div>';

    const isInIframe = (window.self !== window.top);
    if (isInIframe) {
      // 모달 안 iframe — 자체 헤더는 부모(모달 헤더)와 중복이라 숨김
      const head = document.getElementById('reportHead');
      if (head) head.style.display = 'none';
      document.body.classList.add('report-iframed');
      // 부모로부터 'print' 메시지 수신 시 자체 window.print() 실행
      window.addEventListener('message', (e) => {
        if (e && e.data === 'print') { try { window.focus(); window.print(); } catch (_) {} }
      });
    } else {
      // standalone (새 창/탭) — [돌아가기] 동작 부여
      const btn = document.getElementById('btnReportClose');
      if (btn) {
        btn.addEventListener('click', () => {
          if (window.opener && !window.opener.closed) {
            window.close();
            setTimeout(() => { if (!window.closed) location.href = 'index.html'; }, 120);
            return;
          }
          if (history.length > 1) { history.back(); return; }
          location.href = 'index.html';
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
