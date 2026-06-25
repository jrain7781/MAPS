/**
 * 다물건 입찰안내 — 웹 링크(회원이 여는 보고서 페이지)
 * 링크관리(생성1회·복사·폐기) + 전화 뒷4자리 게이트(3회 실패 시 자동 폐기)
 *
 * 시트 dm_links_v2 컬럼:
 *  1 token | 2 seed(member_id|sakun) | 3 member_id | 4 phone4 | 5 html | 6 title | 7 summary | 8 status(active/revoked) | 9 fail | 10 created
 *  - token : 랜덤 24자(추측 불가). 폐기 시 새 토큰 발급 → 옛 주소 무효
 *  - phone4: 게이트용 전화 뒷4자리(없으면 게이트 없이 통과)
 *  - html  : 보고서 HTML 스냅샷(🔗 누를 때마다 최신으로 갱신)
 */
var DM_LINK_SHEET = 'dm_links_v2';

function dmLinkSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(DM_LINK_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DM_LINK_SHEET);
    sh.getRange(1, 1, 1, 12).setValues([['token', 'seed', 'member_id', 'phone4', 'html', 'title', 'summary', 'status', 'fail', 'created', 'biddate', 'payload']]);
    sh.hideSheet();
  } else if (sh.getMaxColumns() < 12) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());   // 구버전 11열 시트 → payload(12열) 추가
    sh.getRange(1, 12).setValue('payload');
  }
  return sh;
}
function dmRandToken_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 24); }
function dmLinkUrl_(token) {
  var base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  base = base.replace(/\/dev$/, '/exec');
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + token;
}
function dmFindActiveBySeed_(data, seed) {
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(seed) && String(data[i][7]) === 'active') return i;
  }
  return -1;
}
function dmFindByToken_(data, token) {
  for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(token)) return i; }
  return -1;
}

/** 입찰일자(yyyy-MM-dd) 다음날부터 만료. */
function dmExpired_(biddate) {
  biddate = String(biddate || '').trim();
  if (!biddate) return false;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return today > biddate; // 오늘이 입찰일보다 뒤 = 다음날 이후
}

/** 🔗 링크복사: 활성 링크 있으면 재사용(내용만 최신 갱신), 없으면 새로 생성. → {token,url,gated} */
function dmGetOrCreateLink(seed, html, title, summary, phone4, member_id, biddate, payload) {
  if (!seed || !html) throw new Error('데이터 부족');
  phone4 = String(phone4 || '').replace(/[^0-9]/g, '').slice(-4);
  biddate = String(biddate || '').trim();
  payload = String(payload || '');   // 동적 렌더용 JSON(회원 새로고침=DB 최신)
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindActiveBySeed_(data, seed), token;
  if (ri >= 0) {
    token = String(data[ri][0]);
    sh.getRange(ri + 1, 4, 1, 6).setValues([[phone4, html, title || '', summary || '', 'active', 0]]); // 4..9
    sh.getRange(ri + 1, 11).setValue(biddate);
    sh.getRange(ri + 1, 12).setValue(payload);
  } else {
    token = dmRandToken_();
    sh.appendRow([token, seed, member_id || '', phone4, html, title || '', summary || '', 'active', 0, new Date(), biddate, payload]);
  }
  return { token: token, url: dmLinkUrl_(token), gated: phone4.length >= 4, expire: biddate };
}

/** 🚫 폐기·재발급: 현재 활성 링크 폐기 후 새 토큰 발급. → {token,url,gated} */
function dmRevokeAndRenew(seed, html, title, summary, phone4, member_id, biddate, payload) {
  if (!seed) throw new Error('seed 없음');
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindActiveBySeed_(data, seed);
  if (ri >= 0) sh.getRange(ri + 1, 8).setValue('revoked');
  if (html) return dmGetOrCreateLink(seed, html, title, summary, phone4, member_id, biddate, payload);
  return { revoked: true };
}

// 진행비 자동계산(회원·물건순·지역) — js-damulgeon _computeFees 동일 로직(서버판). 회원 링크 동적 렌더용.
function dmFeeRegion_(court) { var c = String(court || ''); if (c.indexOf('부산') >= 0) return 'bg'; if (c.indexOf('대구') >= 0 || c.indexOf('울산') >= 0 || c.indexOf('창원') >= 0) return 'gs'; return 'etc'; }
function dmComputeFees_(items) {
  var by = {};
  (items || []).forEach(function (it) { it._fee = ''; var m = String(it.member_name || '').trim(); if (m) { (by[m] = by[m] || []).push(it); } });
  Object.keys(by).forEach(function (m) {
    var arr = by[m].slice().sort(function (a, b) { return (parseInt(a.mulgeon_no, 10) || 0) - (parseInt(b.mulgeon_no, 10) || 0); });
    arr.forEach(function (it, i) { var bgGs = (dmFeeRegion_(it.court) !== 'etc'); it._fee = String(bgGs ? (i === 0 ? 80000 : 60000) : (i === 0 ? 80000 : (i === 1 ? 70000 : 60000))); });
  });
  (items || []).forEach(function (it) { var mv = String(it.jinhaengbi == null ? '' : it.jinhaengbi).trim(); if (mv !== '') it._fee = String(parseInt(mv.replace(/[^0-9]/g, ''), 10) || 0); });   // 수동 진행비(다물건 시트 jinhaengbi) 우선
}

/**
 * 동적 렌더 데이터: 게이트 검증 통과 시 저장된 payload(물건·기한·컨텍스트) + 라이브 명의상세(member_accounts) + 라이브 진행비를 반환.
 * → 회원이 새로고침하면 본인이 저장한 정보 + 관리자가 고친 진행비가 바로 반영됨. payload 없는 구버전 링크는 html 스냅샷으로 폴백.
 */
function dmRenderData(token, last4) {
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindByToken_(data, token);
  if (ri < 0) return { status: 'revoked' };
  var row = data[ri];
  if (String(row[7]) !== 'active') return { status: 'revoked' };
  if (dmExpired_(row[10])) return { status: 'expired' };
  var phone4 = String(row[3] || '').replace(/[^0-9]/g, '');
  if (phone4) {   // 게이트 검증(3회 실패 자동 폐기) — dmVerifyReport와 동일
    var inp = String(last4 || '').replace(/[^0-9]/g, '').slice(-4);
    if (inp !== phone4) {
      var fail = Number(row[8] || 0) + 1;
      if (fail >= 3) { sh.getRange(ri + 1, 8).setValue('revoked'); return { status: 'locked' }; }
      sh.getRange(ri + 1, 9).setValue(fail);
      return { status: 'fail', left: 3 - fail };
    }
    if (Number(row[8]) > 0) sh.getRange(ri + 1, 9).setValue(0);
  }
  var title = String(row[5] || '');
  var payloadStr = String(row[11] || '');
  if (!payloadStr) return { status: 'ok', html: String(row[4] || ''), title: title };   // 구버전 → 스냅샷 폴백
  var pl;
  try { pl = JSON.parse(payloadStr); } catch (e) { return { status: 'ok', html: String(row[4] || ''), title: title }; }
  var detailMap = {};
  try {
    var reqs = pl.reqs || [], reqKeys = pl.reqKeys || [];
    var res = getBulkDaeriipchalData(reqs);
    reqKeys.forEach(function (k, i) { detailMap[k] = res[i] || {}; });
  } catch (e2) {}
  // 물건별 전자서명 PDF 현황(물건단위 등록/삭제 표시용)
  var uploads = {};
  try {
    var its = (pl.m && pl.m.items) || [], ids = [];
    its.forEach(function (it) { var iid = String((it && it.link_item_id) || '').trim(); if (iid) ids.push(iid); });
    if (ids.length) uploads = dmGetUploadsByItems(ids);
  } catch (e3) {}
  // 진행비 동적 반영: 최신 jinhaengbi(다물건 시트, 3키) 읽어 _fee 재계산 → 회원 새로고침 = 최신 진행비(링크 재생성 불필요)
  try {
    var fitems = (pl.m && pl.m.items) || [];
    if (fitems.length) {
      var dmAll = readAllDamulgeon(), feeMap = {};
      dmAll.forEach(function (e) { feeMap[_dmKey3_(e.in_date, e.sakun_no, e.court)] = String(e.jinhaengbi == null ? '' : e.jinhaengbi); });
      fitems.forEach(function (it) { var k = _dmKey3_(it.in_date, it.sakun_no, it.court); it.jinhaengbi = (feeMap[k] != null ? feeMap[k] : ''); });
      dmComputeFees_(fitems);
    }
  } catch (eF) { Logger.log('[dmRenderData fee] ' + eF); }
  return { status: 'ok', payload: pl, detailMap: detailMap, uploads: uploads, title: title };
}

/** 회원 페이지: 전화 뒷4자리 검증 → 보고서 HTML 반환. 3회 실패 시 자동 폐기. */
function dmVerifyReport(token, last4) {
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindByToken_(data, token);
  if (ri < 0) return { status: 'revoked' };
  var row = data[ri];
  if (String(row[7]) !== 'active') return { status: 'revoked' };
  if (dmExpired_(row[10])) return { status: 'expired' };   // 입찰일 다음날 이후 자동 만료
  var phone4 = String(row[3] || '').replace(/[^0-9]/g, '');
  if (!phone4) return { status: 'ok', html: String(row[4] || ''), title: String(row[5] || '') }; // 전화 없으면 게이트 통과
  var inp = String(last4 || '').replace(/[^0-9]/g, '').slice(-4);
  if (inp === phone4) {
    if (Number(row[8]) > 0) sh.getRange(ri + 1, 9).setValue(0);
    return { status: 'ok', html: String(row[4] || ''), title: String(row[5] || '') };
  }
  var fail = Number(row[8] || 0) + 1;
  if (fail >= 3) { sh.getRange(ri + 1, 8).setValue('revoked'); return { status: 'locked' }; }
  sh.getRange(ri + 1, 9).setValue(fail);
  return { status: 'fail', left: 3 - fail };
}

/** 🚫 폐기 전용: 현재 활성 링크만 폐기(새 링크 발급 안 함). */
function dmRevokeOnly(seed) {
  if (!seed) throw new Error('seed 없음');
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindActiveBySeed_(data, seed);
  if (ri >= 0) sh.getRange(ri + 1, 8).setValue('revoked');
  return { revoked: true };
}

/**
 * 회원 페이지에서 노란칸(누락 항목) 일괄 저장. token으로 회원 식별 → member_accounts 부분 병합 저장.
 * edits = [{idx, field, value}]. (field: jumin_corp/biz_no/phone/address/account_bank/account_no/account_name/job/name)
 */
function dmSaveMemberFields(token, edits) {
  var data = dmLinkSheet_().getDataRange().getValues();
  var ri = dmFindByToken_(data, token);
  if (ri < 0) return { success: false, msg: '유효하지 않은 링크' };
  var row = data[ri];
  if (String(row[7]) !== 'active') return { success: false, msg: '폐기된 링크' };
  if (dmExpired_(row[10])) return { success: false, msg: '만료된 링크' };
  var memberId = String(row[2] || '').trim();
  if (!memberId) return { success: false, msg: '회원 식별 불가' };
  return _dmSaveFieldsCore_(memberId, edits);
}

/** 관리자(모달)용 직접 저장 — 토큰 없이 member_id로. 노란칸 부분 병합. */
function dmSaveMemberFieldsByMember(memberId, edits) {
  memberId = String(memberId || '').trim();
  if (!memberId) return { success: false, msg: '회원 식별 불가' };
  return _dmSaveFieldsCore_(memberId, edits);
}

function _dmSaveFieldsCore_(memberId, edits) {
  edits = edits || [];
  var allow = { gubun: 1, name: 1, job: 1, jumin_corp: 1, biz_no: 1, phone: 1, address: 1, account_bank: 1, account_no: 1, account_name: 1 };
  var byIdx = {};
  edits.forEach(function (e) {
    e = e || {};
    var idx = parseInt(e.idx, 10), f = String(e.field || ''), v = String(e.value == null ? '' : e.value).trim();
    if (isNaN(idx) || !allow[f] || !v) return;
    if (!byIdx[idx]) byIdx[idx] = {};
    byIdx[idx][f] = v;
  });
  var idxs = Object.keys(byIdx);
  if (!idxs.length) return { success: false, msg: '입력값 없음' };
  var acc = getMemberAccounts(memberId);
  if (!acc || !acc.success) return { success: false, msg: '회원 조회 실패' };
  var saved = 0;
  idxs.forEach(function (idxKey) {
    var idx = parseInt(idxKey, 10);
    var cur = (acc.accounts || []).filter(function (a) { return a.idx === idx; })[0] || { idx: idx };
    var merged = {
      gubun: cur.gubun || '', name: cur.name || '', job: cur.job || '회사원',
      jumin_corp: cur.jumin_corp || '', biz_no: cur.biz_no || '',
      phone: cur.phone || '', address: cur.address || '',
      account_bank: cur.account_bank || '', account_no: cur.account_no || '', account_name: cur.account_name || ''
    };
    var fields = byIdx[idx];
    Object.keys(fields).forEach(function (f) { merged[f] = fields[f]; });
    var r = saveMemberAccount(memberId, idx, merged);
    if (r && r.success) saved++;
  });
  return { success: saved > 0, saved: saved };
}

/** 전자서명 PDF 업로드(회원 — 토큰 검증) → Drive 저장 + dm_uploads 기록. itemId=물건단위(선택). */
function dmUploadPdf(token, filename, base64, itemId) {
  var data = dmLinkSheet_().getDataRange().getValues();
  var ri = dmFindByToken_(data, token);
  if (ri < 0) return { success: false, msg: '유효하지 않은 링크' };
  var row = data[ri];
  if (String(row[7]) !== 'active') return { success: false, msg: '폐기된 링크' };
  return _dmSavePdf_(String(row[2] || ''), token, filename, base64, itemId);
}

/** 전자서명 PDF 업로드(관리자 모달 — member_id 직접). itemId=물건단위(선택). */
function dmUploadPdfByMember(memberId, filename, base64, itemId) {
  return _dmSavePdf_(String(memberId || ''), '', filename, base64, itemId);
}

function _dmSavePdf_(memberId, token, filename, base64, itemId) {
  if (!base64) return { success: false, msg: '파일 없음' };
  try {
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
    var info = _dmItemFileInfo_(itemId);                       // { in_date, court, sakun(사건번호+물건번호), mname }
    // 파일명 = 입찰일자_법원_사건번호(물건번호)_회원명_등록일시.pdf  (한 폴더·사건번호 중복 대비 유일 식별). 정보 없으면 폴백.
    var parts = [info.in_date, info.court, info.sakun, info.mname, stamp].filter(function (x) { return String(x || '').trim(); });
    var base = parts.length >= 2 ? parts.join('_') : ((memberId || 'm') + '_' + stamp + '_' + String(filename || '전자서명.pdf').replace(/\.pdf$/i, ''));
    var safe = String(base).replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/_+/g, '_').trim();
    if (!/\.pdf$/i.test(safe)) safe += '.pdf';
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/pdf', safe);
    var file = _dmPdfFolder_().createFile(blob);
    file.setDescription('다물건 전자서명 업로드 member=' + memberId + ' token=' + token + ' item=' + (itemId || '') + ' orig=' + (filename || ''));
    var url = file.getUrl();
    _dmRecordUpload_(token, memberId, safe, url, _dmBiddateFor_(token, memberId), itemId);   // 입찰일 기록 → 다음날 자동 삭제
    return { success: true, url: url, name: safe, item_id: String(itemId || '') };
  } catch (e) {
    return { success: false, msg: (e && e.message) || String(e) };
  }
}

/** 파일명 생성용: item_id(정확한 키=items.id) → { in_date(입찰일), court(법원), sakun(사건번호+물건번호), mname(회원 기본명) } */
function _dmItemFileInfo_(itemId) {
  var out = { in_date: '', court: '', sakun: '', mname: '' };
  itemId = String(itemId || '').trim();
  if (!itemId) return out;
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_SHEET_NAME);   // 'items'
    if (!sh || sh.getLastRow() < 2) return out;
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();   // id0 in-date1 sakun_no2 court3 .. m_name6
    for (var i = 0; i < v.length; i++) {
      if (String(v[i][0]).trim() === itemId) {
        out.in_date = (typeof formatParamsDate === 'function') ? String(formatParamsDate(v[i][1]) || '') : String(v[i][1] || '').trim();   // yyMMdd 통일
        out.sakun = String(v[i][2] || '').trim();
        out.court = String(v[i][3] || '').trim();
        var mn = String(v[i][6] || '').trim().replace(/^\([^)]+\)\s*/, '');   // 앞 (구분) 제거
        out.mname = (mn.split(/[\s(]/)[0] || '').trim();                       // 기본 이름만
        break;
      }
    }
  } catch (e) {}
  return out;
}

/** 전자서명 PDF 삭제 — Drive 휴지통 + dm_uploads 행 제거. token 주면 그 회원 것만 허용(회원 삭제용). */
function dmDeleteUpload(url, token) {
  try {
    url = String(url || '').trim();
    if (!url) return { success: false, msg: 'url 없음' };
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName('dm_uploads');
    if (!sh || sh.getLastRow() < 2) return { success: false, msg: '기록 없음' };
    var allowMember = '';
    if (token) {
      var data = dmLinkSheet_().getDataRange().getValues(), ri = dmFindByToken_(data, token);
      if (ri < 0) return { success: false, msg: '유효하지 않은 링크' };
      allowMember = String(data[ri][2] || '').trim();
    }
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < v.length; i++) {
      if (String(v[i][4]).trim() === url) {
        if (token && String(v[i][2]).trim() !== allowMember) return { success: false, msg: '권한 없음' };
        var idm = url.match(/[-\w]{25,}/);
        if (idm) { try { DriveApp.getFileById(idm[0]).setTrashed(true); } catch (e) {} }
        sh.deleteRow(i + 2);
        return { success: true, item_id: String(v[i][6] || '') };
      }
    }
    return { success: false, msg: '대상 없음' };
  } catch (e) { return { success: false, msg: (e && e.message) || String(e) }; }
}

/** 물건(item_id)별 업로드 목록 — { item_id: [{date,filename,url}] } */
function dmGetUploadsByItems(itemIds) {
  itemIds = itemIds || [];
  var want = {}; itemIds.forEach(function (id) { want[String(id).trim()] = 1; });
  var map = {};
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('dm_uploads');
    if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 7) return map;
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < v.length; i++) {
      var iid = String(v[i][6] || '').trim();
      if (!iid || !want[iid]) continue;
      if (!map[iid]) map[iid] = [];
      var d = ''; try { d = Utilities.formatDate(new Date(v[i][0]), Session.getScriptTimeZone(), 'MM/dd HH:mm'); } catch (e) {}
      map[iid].push({ date: d, filename: String(v[i][3] || ''), url: String(v[i][4] || '') });
    }
  } catch (e) {}
  return map;
}

/** 물건(item_id)별 PDF 바이트(base64) — 클라이언트 합본용. itemIds 순서대로. [{filename,item_id,b64}] */
function dmGetPdfBytesByItems(itemIds) {
  itemIds = itemIds || [];
  var want = {}; itemIds.forEach(function (id) { want[String(id).trim()] = 1; });
  var byItem = {}, out = [];
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('dm_uploads');
    if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 7) return out;
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < v.length; i++) {
      var iid = String(v[i][6] || '').trim();
      if (!iid || !want[iid]) continue;
      if (!byItem[iid]) byItem[iid] = [];
      byItem[iid].push({ filename: String(v[i][3] || ''), url: String(v[i][4] || '') });
    }
    itemIds.forEach(function (id) {
      id = String(id).trim();
      (byItem[id] || []).forEach(function (u) {
        try {
          var idm = u.url.match(/[-\w]{25,}/);
          if (!idm) return;
          var blob = DriveApp.getFileById(idm[0]).getBlob();
          out.push({ filename: u.filename, item_id: id, b64: Utilities.base64Encode(blob.getBytes()) });
        } catch (e) {}
      });
    });
  } catch (e) { Logger.log('[dmGetPdfBytesByItems] ' + e); }
  return out;
}

/** 업로드(PDF)가 1건이라도 있는 item_id 집합 — 그리드 심볼용. { item_id: true } */
function _dmItemPdfSet_() {
  var set = {};
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('dm_uploads');
    if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 7) return set;
    var v = sh.getRange(2, 7, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) { var iid = String(v[i][0] || '').trim(); if (iid) set[iid] = true; }
  } catch (e) {}
  return set;
}

/** 전자서명 PDF 저장 폴더: 내 드라이브 / MAPS / damulgun_pdf (없으면 생성). */
function _dmPdfFolder_() {
  var root = DriveApp.getRootFolder();
  var mit = root.getFoldersByName('MAPS');                 // 내 드라이브 루트의 MAPS
  var maps = mit.hasNext() ? mit.next() : root.createFolder('MAPS');
  var sit = maps.getFoldersByName('damulgun_pdf');
  return sit.hasNext() ? sit.next() : maps.createFolder('damulgun_pdf');
}

/** 회원이 등록한 전자서명 PDF 목록(최신순). [{date,filename,url}] */
function dmGetUploads(memberId) {
  memberId = String(memberId || '').trim();
  if (!memberId) return [];
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('dm_uploads');
    if (!sh || sh.getLastRow() < 2) return [];
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues(), out = [];
    for (var i = 0; i < v.length; i++) {
      if (String(v[i][2]).trim() === memberId) {
        var d = ''; try { d = Utilities.formatDate(new Date(v[i][0]), Session.getScriptTimeZone(), 'MM/dd HH:mm'); } catch (e) {}
        out.push({ date: d, filename: String(v[i][3] || ''), url: String(v[i][4] || '') });
      }
    }
    return out.reverse();   // 최신 먼저
  } catch (e) { return []; }
}

/** 일괄: member_id 배열 → { member_id: [{date,filename,url}] } */
function dmGetUploadsBulk(memberIds) {
  memberIds = memberIds || [];
  var want = {}; memberIds.forEach(function (id) { want[String(id).trim()] = 1; });
  var map = {};
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('dm_uploads');
    if (!sh || sh.getLastRow() < 2) return map;
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    for (var i = 0; i < v.length; i++) {
      var mid = String(v[i][2]).trim();
      if (!want[mid]) continue;
      if (!map[mid]) map[mid] = [];
      var d = ''; try { d = Utilities.formatDate(new Date(v[i][0]), Session.getScriptTimeZone(), 'MM/dd HH:mm'); } catch (e) {}
      map[mid].push({ date: d, filename: String(v[i][3] || ''), url: String(v[i][4] || '') });
    }
  } catch (e) {}
  return map;
}

function _dmRecordUpload_(token, memberId, name, url, biddate, itemId) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('dm_uploads');
    if (!sh) { sh = ss.insertSheet('dm_uploads'); sh.getRange(1, 1, 1, 7).setValues([['date', 'token', 'member_id', 'filename', 'url', 'biddate', 'item_id']]); sh.hideSheet(); }
    else if (sh.getLastColumn() < 7) { sh.getRange(1, 7).setValue('item_id'); }   // 구버전 6열 → item_id 헤더 보강
    sh.appendRow([new Date(), token, memberId, name, url, String(biddate || ''), String(itemId || '')]);
  } catch (e) {}
}

/** 업로드 PDF의 입찰일 추정: token이면 그 링크, 없으면 member_id의 활성/최근 링크 biddate. */
function _dmBiddateFor_(token, memberId) {
  try {
    var data = dmLinkSheet_().getDataRange().getValues();
    if (token) { var ri = dmFindByToken_(data, token); if (ri >= 0) return String(data[ri][10] || ''); }
    memberId = String(memberId || '').trim();
    if (memberId) {
      for (var i = 1; i < data.length; i++) { if (String(data[i][2]).trim() === memberId && String(data[i][7]) === 'active') return String(data[i][10] || ''); }
      for (var j = data.length - 1; j >= 1; j--) { if (String(data[j][2]).trim() === memberId) return String(data[j][10] || ''); }
    }
  } catch (e) {}
  return '';
}

/**
 * 입찰 다음날 자동 폐기: 만료된 링크의 첨부 PDF를 휴지통으로(복구가능) + dm_uploads 행 제거.
 * 링크 자체는 dmExpired_로 이미 접근 차단(만료). 일일 트리거(installDmCleanupTrigger)로 실행.
 */
function dmCleanupExpired() {
  var trashed = 0, kept = 0;
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName('dm_uploads');
    if (sh && sh.getLastRow() >= 2) {
      var cols = Math.max(6, sh.getLastColumn());   // item_id(7열) 포함 — 행 재기록 시 어긋남 방지
      var n = sh.getLastRow() - 1, v = sh.getRange(2, 1, n, cols).getValues(), keep = [];
      for (var i = 0; i < v.length; i++) {
        var bd = String(v[i][5] || '');
        if (bd && dmExpired_(bd)) {
          var url = String(v[i][4] || ''), idm = url.match(/[-\w]{25,}/);
          if (idm) { try { DriveApp.getFileById(idm[0]).setTrashed(true); } catch (e) {} }
          trashed++;
        } else { keep.push(v[i]); kept++; }
      }
      sh.getRange(2, 1, n, cols).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, cols).setValues(keep);
    }
  } catch (e2) { Logger.log('dmCleanupExpired err: ' + e2); }
  Logger.log('dmCleanupExpired: trashedPdf=' + trashed + ' keptPdf=' + kept);
  return { trashedPdf: trashed, keptPdf: kept };
}

/** 일일 트리거 설치(1회 실행) — 매일 새벽 4시 dmCleanupExpired. */
function installDmCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dmCleanupExpired') ScriptApp.deleteTrigger(t); });
  var hour = (typeof trgHour_ === 'function') ? trgHour_('dmCleanupExpired') : 4;  // 환경설정▸트리거 탭과 단일 소스
  if (hour == null) hour = 4;
  ScriptApp.newTrigger('dmCleanupExpired').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('dmCleanupExpired 일일 트리거 설치 완료(매일 ' + hour + '시)');
  return { installed: true };
}

/** 모달 표시용: seed의 현재 활성 링크 상태(활성/만료/없음) + 생성시각·게이트여부. 읽기 전용. */
function dmGetLinkStatus(seed) {
  seed = String(seed || '').trim();
  if (!seed) return { status: 'none' };
  var data = dmLinkSheet_().getDataRange().getValues();
  var ri = dmFindActiveBySeed_(data, seed);
  if (ri < 0) return { status: 'none' };
  var row = data[ri];
  var created = '';
  try { if (row[9]) created = Utilities.formatDate(new Date(row[9]), Session.getScriptTimeZone(), 'MM/dd HH:mm'); } catch (e) {}
  return {
    status: dmExpired_(row[10]) ? 'expired' : 'active',
    created: created,
    gated: !!String(row[3] || ''),
    biddate: String(row[10] || ''),
    url: dmLinkUrl_(String(row[0]))
  };
}

/** doGet용 메타. 게이트 없으면(전화 미등록) html까지 실어 doGet에서 바로 임베드(서버 재호출 없이 빠르게). */
function dmGetReportMeta(token) {
  var data = dmLinkSheet_().getDataRange().getValues();
  var ri = dmFindByToken_(data, token);
  if (ri < 0) return null;
  var row = data[ri];
  var active = String(row[7]) === 'active', expired = dmExpired_(row[10]), gated = !!String(row[3] || '');
  var status = !active ? 'revoked' : (expired ? 'expired' : 'active');
  var meta = { title: String(row[5] || ''), summary: String(row[6] || ''), gated: gated, status: status };
  if (status === 'active' && !gated) meta.html = String(row[4] || '');   // 게이트 없음 → 바로 임베드
  return meta;
}
