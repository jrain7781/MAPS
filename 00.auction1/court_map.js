/* ===== MAPS 법원명 ↔ 옥션원 법원(lawsup 코드) 매칭표 =====
 * - MAPS 는 본원에 '본원' 접미사 없음(예: '전주'), 옥션원은 '전주 본원'.
 * - 지원은 공백만 차이(MAPS '광주순천' = 옥션 '광주 순천').
 * - court_jurisdiction.py 의 Court 값 60개 전부 1:1 매칭(미매칭 0).
 * - 옥션 종합검색 lawsup select 옵션 기준 (2026 시점).
 */
(function () {
  'use strict';
  var COURT_MAP = [
    { maps: '광주', code: '2410', auction: '광주 본원' },
    { maps: '광주목포', code: '2411', auction: '광주 목포' },
    { maps: '광주순천', code: '2413', auction: '광주 순천' },
    { maps: '광주장흥', code: '2412', auction: '광주 장흥' },
    { maps: '광주해남', code: '2414', auction: '광주 해남' },
    { maps: '대구', code: '2010', auction: '대구 본원' },
    { maps: '대구경주', code: '2012', auction: '대구 경주' },
    { maps: '대구김천', code: '2013', auction: '대구 김천' },
    { maps: '대구상주', code: '2014', auction: '대구 상주' },
    { maps: '대구서부', code: '2018', auction: '대구 서부' },
    { maps: '대구안동', code: '2011', auction: '대구 안동' },
    { maps: '대구영덕', code: '2016', auction: '대구 영덕' },
    { maps: '대구의성', code: '2015', auction: '대구 의성' },
    { maps: '대구포항', code: '2017', auction: '대구 포항' },
    { maps: '대전', code: '1910', auction: '대전 본원' },
    { maps: '대전공주', code: '1914', auction: '대전 공주' },
    { maps: '대전논산', code: '1912', auction: '대전 논산' },
    { maps: '대전서산', code: '1915', auction: '대전 서산' },
    { maps: '대전천안', code: '1913', auction: '대전 천안' },
    { maps: '대전홍성', code: '1911', auction: '대전 홍성' },
    { maps: '부산', code: '2110', auction: '부산 본원' },
    { maps: '부산동부', code: '2111', auction: '부산 동부' },
    { maps: '부산서부', code: '2112', auction: '부산 서부' },
    { maps: '서울남부', code: '1310', auction: '서울남부 본원' },
    { maps: '서울동부', code: '1110', auction: '서울동부 본원' },
    { maps: '서울북부', code: '1410', auction: '서울북부 본원' },
    { maps: '서울서부', code: '1210', auction: '서울서부 본원' },
    { maps: '서울중앙', code: '1010', auction: '서울중앙 본원' },
    { maps: '수원', code: '1710', auction: '수원 본원' },
    { maps: '수원성남', code: '1711', auction: '수원 성남' },
    { maps: '수원안산', code: '1714', auction: '수원 안산' },
    { maps: '수원안양', code: '1715', auction: '수원 안양' },
    { maps: '수원여주', code: '1712', auction: '수원 여주' },
    { maps: '수원평택', code: '1713', auction: '수원 평택' },
    { maps: '울산', code: '2210', auction: '울산 본원' },
    { maps: '의정부', code: '1510', auction: '의정부 본원' },
    { maps: '의정부고양', code: '1511', auction: '의정부 고양' },
    { maps: '의정부남양주', code: '1512', auction: '의정부 남양주' },
    { maps: '인천', code: '1610', auction: '인천 본원' },
    { maps: '인천부천', code: '1611', auction: '인천 부천' },
    { maps: '전주', code: '2510', auction: '전주 본원' },
    { maps: '전주군산', code: '2511', auction: '전주 군산' },
    { maps: '전주남원', code: '2513', auction: '전주 남원' },
    { maps: '전주정읍', code: '2512', auction: '전주 정읍' },
    { maps: '제주', code: '2710', auction: '제주 본원' },
    { maps: '창원', code: '2310', auction: '창원 본원' },
    { maps: '창원거창', code: '2314', auction: '창원 거창' },
    { maps: '창원마산', code: '2315', auction: '창원 마산' },
    { maps: '창원밀양', code: '2313', auction: '창원 밀양' },
    { maps: '창원진주', code: '2311', auction: '창원 진주' },
    { maps: '창원통영', code: '2312', auction: '창원 통영' },
    { maps: '청주', code: '2610', auction: '청주 본원' },
    { maps: '청주영동', code: '2613', auction: '청주 영동' },
    { maps: '청주제천', code: '2612', auction: '청주 제천' },
    { maps: '청주충주', code: '2611', auction: '청주 충주' },
    { maps: '춘천', code: '1810', auction: '춘천 본원' },
    { maps: '춘천강릉', code: '1811', auction: '춘천 강릉' },
    { maps: '춘천속초', code: '1813', auction: '춘천 속초' },
    { maps: '춘천영월', code: '1814', auction: '춘천 영월' },
    { maps: '춘천원주', code: '1812', auction: '춘천 원주' }
  ];

  // MAPS 법원명 → lawsup 코드 (공백 무시). 못 찾으면 ''.
  var _byMaps = {};
  COURT_MAP.forEach(function (r) { _byMaps[r.maps] = r; _byMaps[r.maps.replace(/\s/g, '')] = r; });
  function courtToLawsup(mapsCourt) {
    var k = String(mapsCourt || '').replace(/\s/g, '').trim();
    var r = _byMaps[k];
    return r ? r.code : '';
  }

  window.COURT_MAP = COURT_MAP;
  window.courtToLawsup = courtToLawsup;
})();
