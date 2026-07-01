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

  // ── 불러오기: 낙찰 크롤(06.nc.py) 실행 → 매칭(진행사항확인과 동일) → 매각결과+조사내용 자동채움 ──
  // 로컬 매니저 서버(localhost)의 크롤 실행 경로. 외부 유료 API 아님(비용 0).
  var ncRunId = null, ncOffset = 0, ncFilled = false;
  function ncLoad() {
    if (ncRunId) { alert('이미 크롤 중입니다.'); return; }
    var sakun = ($('ncSakun').value || '').trim();
    if (!sakun) { alert('사건번호를 입력하세요.'); return; }
    // 키 3개: 사건번호(필수) · 입찰일자(매각기일란) · 법원(없으면 주소→법원 자동대조). cc와 동일 매칭.
    var kase = { sakun_no: sakun, bid_date: ($('ncDate').value || '').trim(), court: '' };
    ncOffset = 0; ncFilled = false;
    var lb = $('ncLoadBtn'); if (lb) lb.disabled = true;
    setStatus('크롤중… (옥션 매칭 → 매각결과 + 조사내용)');
    fetch('/api/imageup/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ which: 'nc', cases: [kase], headless: false })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { ncRunId = j.run_id; ncPoll(); }
      else { setStatus('시작 실패: ' + (j.error || '?')); if (lb) lb.disabled = false; }
    }).catch(function (e) { setStatus('요청 오류: ' + e); if (lb) lb.disabled = false; });
  }
  function ncPoll() {
    if (!ncRunId) return;
    fetch('/api/imageup/logs?run_id=' + encodeURIComponent(ncRunId) + '&offset=' + ncOffset)
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.lines && j.lines.length) {
          j.lines.forEach(function (line) {
            if (typeof line !== 'string' || line.indexOf('RESULT|') !== 0) return;
            try {
              var o = JSON.parse(line.slice(7));
              if (o && o.ok && !ncFilled) {
                ncFilled = true;
                window.NakchalCafe.fill({
                  sakun: o.sakun_no, member: o.member, buyer: o.buyer, date: o.date,
                  bid: o.bid, cnt: o.cnt, addr: o.addr, josa: o.josa
                });
                setStatus('✓ 크롤 완료 — 매수인 ' + (o.buyer || '?') + ' · 조사내용 ' + (o.josa_len || 0) + '자'
                  + (o.key_match ? '' : ' (⚠키불일치 확인)'));
              } else if (o && !o.ok) {
                setStatus('⚠ ' + (o.err || '매칭 실패') + ' (사건번호/기일 확인)');
              }
            } catch (e) {}
          });
          ncOffset += j.lines.length;
        }
        if (j.status === 'running') { setTimeout(ncPoll, 700); }
        else {
          ncRunId = null;
          var lb = $('ncLoadBtn'); if (lb) lb.disabled = false;
          if (!ncFilled) setStatus('크롤 종료 — 결과 없음(사건번호/매각기일 확인)');
        }
      }).catch(function (e) { setStatus('polling 오류: ' + e); setTimeout(ncPoll, 1500); });
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

  function init() {
    var g = $('ncGenBtn'); if (!g) return;
    g.addEventListener('click', generate);
    var c = $('ncCopyBtn'); if (c) c.addEventListener('click', copyImg);
    var dn = $('ncDownBtn'); if (dn) dn.addEventListener('click', download);
    var lb = $('ncLoadBtn'); if (lb) lb.addEventListener('click', ncLoad);
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
