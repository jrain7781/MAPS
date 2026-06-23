/**
 * 다물건 입찰안내 — 웹 링크(회원이 여는 보고서 페이지) 저장/조회
 * - 토큰은 (회원+사건) 기반 SHA-256 해시 → 같은 물건의 같은 회원이면 항상 같은 링크(고정), 추측 불가
 * - 보고서 HTML 스냅샷을 dm_report_links 시트에 저장(재생성 시 최신으로 갱신)
 * - doGet(?r=토큰)에서 dmGetReportLink로 읽어 dm-report.html로 렌더
 */
var DM_REPORT_SHEET = 'dm_report_links';

function dmReportToken_(seed) {
  var salt = '';
  try { salt = (typeof getAdminSecretKey_ === 'function') ? getAdminSecretKey_() : ''; } catch (e) { salt = ''; }
  if (!salt) salt = 'mj-dm-report-salt';
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(seed) + '|' + salt, Utilities.Charset.UTF_8);
  var hex = raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return hex.slice(0, 24);
}

function dmReportSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(DM_REPORT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DM_REPORT_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([['token', 'title', 'html', 'updated']]);
    sh.hideSheet();
  }
  return sh;
}

/**
 * 링크 저장(또는 갱신) — 클라이언트(모달 🔗링크 버튼)에서 호출
 * @param {string} seed  회원+사건 식별자 (예: member_id + '|' + sakun)
 * @param {string} html  보고서 카드 HTML 스냅샷(.rrep-card outerHTML)
 * @param {string} title 페이지 제목
 * @return {{token:string, url:string}}
 */
function dmSaveReportLink(seed, html, title) {
  if (!seed) throw new Error('seed 없음');
  if (!html) throw new Error('보고서 내용 없음');
  var token = dmReportToken_(seed);
  var sh = dmReportSheet_();
  var data = sh.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === token) { rowIdx = i + 1; break; }
  }
  var now = new Date();
  if (rowIdx > 0) {
    sh.getRange(rowIdx, 2, 1, 3).setValues([[title || '', html, now]]);
  } else {
    sh.appendRow([token, title || '', html, now]);
  }
  var base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; }
  // /dev 로 끝나면 /exec 로 보정(배포 URL)
  base = base.replace(/\/dev$/, '/exec');
  return { token: token, url: base + (base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + token };
}

/** doGet에서 호출 — 토큰으로 저장된 보고서 HTML 조회 */
function dmGetReportLink(token) {
  if (!token) return null;
  try {
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DM_REPORT_SHEET);
    if (!sh) return null;
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(token)) {
        return { title: String(data[i][1] || ''), html: String(data[i][2] || '') };
      }
    }
  } catch (e) { Logger.log('dmGetReportLink err: ' + e); }
  return null;
}
