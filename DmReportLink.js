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
    sh.getRange(1, 1, 1, 11).setValues([['token', 'seed', 'member_id', 'phone4', 'html', 'title', 'summary', 'status', 'fail', 'created', 'biddate']]);
    sh.hideSheet();
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
function dmGetOrCreateLink(seed, html, title, summary, phone4, member_id, biddate) {
  if (!seed || !html) throw new Error('데이터 부족');
  phone4 = String(phone4 || '').replace(/[^0-9]/g, '').slice(-4);
  biddate = String(biddate || '').trim();
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindActiveBySeed_(data, seed), token;
  if (ri >= 0) {
    token = String(data[ri][0]);
    sh.getRange(ri + 1, 4, 1, 6).setValues([[phone4, html, title || '', summary || '', 'active', 0]]); // 4..9
    sh.getRange(ri + 1, 11).setValue(biddate);
  } else {
    token = dmRandToken_();
    sh.appendRow([token, seed, member_id || '', phone4, html, title || '', summary || '', 'active', 0, new Date(), biddate]);
  }
  return { token: token, url: dmLinkUrl_(token), gated: phone4.length >= 4, expire: biddate };
}

/** 🚫 폐기·재발급: 현재 활성 링크 폐기 후 새 토큰 발급. → {token,url,gated} */
function dmRevokeAndRenew(seed, html, title, summary, phone4, member_id, biddate) {
  if (!seed) throw new Error('seed 없음');
  var sh = dmLinkSheet_(), data = sh.getDataRange().getValues();
  var ri = dmFindActiveBySeed_(data, seed);
  if (ri >= 0) sh.getRange(ri + 1, 8).setValue('revoked');
  if (html) return dmGetOrCreateLink(seed, html, title, summary, phone4, member_id, biddate);
  return { revoked: true };
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

/** doGet 게이트 페이지용 메타(제목/요약/게이트여부) — 검증 전 미리보기. */
function dmGetReportMeta(token) {
  var data = dmLinkSheet_().getDataRange().getValues();
  var ri = dmFindByToken_(data, token);
  if (ri < 0) return null;
  return { title: String(data[ri][5] || ''), summary: String(data[ri][6] || ''), gated: !!String(data[ri][3] || ''), active: String(data[ri][7]) === 'active' };
}
