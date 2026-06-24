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

/**
 * 동적 렌더 데이터: 게이트 검증 통과 시 저장된 payload(물건·기한·컨텍스트) + 라이브 명의상세(member_accounts)를 반환.
 * → 회원이 새로고침하면 본인이 저장한 정보가 바로 반영됨. payload 없는 구버전 링크는 html 스냅샷으로 폴백.
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
  return { status: 'ok', payload: pl, detailMap: detailMap, title: title };
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
