# -*- coding: utf-8 -*-
"""
법원 관할 매칭 (재미나이 정리 스크립트 기반)
- 시도/시군구 기반 매핑, 창원/마산 특수 처리
- pandas 없이 list of dicts 사용
"""


def get_jurisdiction_data():
    """행정구역별 관할 법원 매핑 데이터를 생성합니다. (list of dicts)"""
    mapping = []

    # [서울] 구 단위 매핑
    seoul_map = {
        "서울중앙": ["종로구", "중구", "강남구", "서초구", "관악구", "동작구"],
        "서울동부": ["성동구", "광진구", "강동구", "송파구"],
        "서울남부": ["영등포구", "강서구", "양천구", "구로구", "금천구"],
        "서울북부": ["도봉구", "강북구", "노원구", "동대문구", "중랑구", "성북구"],
        "서울서부": ["서대문구", "마포구", "은평구", "용산구"]
    }
    for court, districts in seoul_map.items():
        for dist in districts:
            mapping.append({"Sido": "서울특별시", "Sigungu": dist, "Court": court})

    # [인천/경기]
    incheon_main = ["중구", "동구", "미추홀구", "남구", "연수구", "남동구", "부평구", "계양구", "서구", "강화군", "옹진군"]
    for dist in incheon_main:
        mapping.append({"Sido": "인천광역시", "Sigungu": dist, "Court": "인천"})

    mapping.extend([
        {"Sido": "경기도", "Sigungu": "부천시", "Court": "인천부천"},
        {"Sido": "경기도", "Sigungu": "김포시", "Court": "인천부천"},
        {"Sido": "경기도", "Sigungu": "수원시", "Court": "수원"},
        {"Sido": "경기도", "Sigungu": "용인시", "Court": "수원"},
        {"Sido": "경기도", "Sigungu": "화성시", "Court": "수원"},
        {"Sido": "경기도", "Sigungu": "오산시", "Court": "수원"},
        {"Sido": "경기도", "Sigungu": "성남시", "Court": "수원성남"},
        {"Sido": "경기도", "Sigungu": "하남시", "Court": "수원성남"},
        {"Sido": "경기도", "Sigungu": "광주시", "Court": "수원성남"},
        {"Sido": "경기도", "Sigungu": "평택시", "Court": "수원평택"},
        {"Sido": "경기도", "Sigungu": "안성시", "Court": "수원평택"},
        {"Sido": "경기도", "Sigungu": "안산시", "Court": "수원안산"},
        {"Sido": "경기도", "Sigungu": "광명시", "Court": "수원안산"},
        {"Sido": "경기도", "Sigungu": "시흥시", "Court": "수원안산"},
        {"Sido": "경기도", "Sigungu": "안양시", "Court": "수원안양"},
        {"Sido": "경기도", "Sigungu": "군포시", "Court": "수원안양"},
        {"Sido": "경기도", "Sigungu": "의왕시", "Court": "수원안양"},
        {"Sido": "경기도", "Sigungu": "과천시", "Court": "수원안양"},
        {"Sido": "경기도", "Sigungu": "여주시", "Court": "수원여주"},
        {"Sido": "경기도", "Sigungu": "이천시", "Court": "수원여주"},
        {"Sido": "경기도", "Sigungu": "양평군", "Court": "수원여주"},
        {"Sido": "경기도", "Sigungu": "의정부시", "Court": "의정부"},
        {"Sido": "경기도", "Sigungu": "양주시", "Court": "의정부"},
        {"Sido": "경기도", "Sigungu": "포천시", "Court": "의정부"},
        {"Sido": "경기도", "Sigungu": "동두천시", "Court": "의정부"},
        {"Sido": "경기도", "Sigungu": "연천군", "Court": "의정부"},
        {"Sido": "강원특별자치도", "Sigungu": "철원군", "Court": "의정부"},
        {"Sido": "경기도", "Sigungu": "고양시", "Court": "의정부고양"},
        {"Sido": "경기도", "Sigungu": "파주시", "Court": "의정부고양"},
        {"Sido": "경기도", "Sigungu": "남양주시", "Court": "의정부남양주"},
        {"Sido": "경기도", "Sigungu": "구리시", "Court": "의정부남양주"},
        {"Sido": "경기도", "Sigungu": "가평군", "Court": "의정부남양주"},
    ])

    # [강원]
    mapping.extend([
        {"Sido": "강원특별자치도", "Sigungu": "춘천시", "Court": "춘천"},
        {"Sido": "강원특별자치도", "Sigungu": "화천군", "Court": "춘천"},
        {"Sido": "강원특별자치도", "Sigungu": "양구군", "Court": "춘천"},
        {"Sido": "강원특별자치도", "Sigungu": "인제군", "Court": "춘천"},
        {"Sido": "강원특별자치도", "Sigungu": "홍천군", "Court": "춘천"},
        {"Sido": "강원특별자치도", "Sigungu": "강릉시", "Court": "춘천강릉"},
        {"Sido": "강원특별자치도", "Sigungu": "동해시", "Court": "춘천강릉"},
        {"Sido": "강원특별자치도", "Sigungu": "삼척시", "Court": "춘천강릉"},
        {"Sido": "강원특별자치도", "Sigungu": "원주시", "Court": "춘천원주"},
        {"Sido": "강원특별자치도", "Sigungu": "횡성군", "Court": "춘천원주"},
        {"Sido": "강원특별자치도", "Sigungu": "속초시", "Court": "춘천속초"},
        {"Sido": "강원특별자치도", "Sigungu": "양양군", "Court": "춘천속초"},
        {"Sido": "강원특별자치도", "Sigungu": "고성군", "Court": "춘천속초"},
        {"Sido": "강원특별자치도", "Sigungu": "영월군", "Court": "춘천영월"},
        {"Sido": "강원특별자치도", "Sigungu": "정선군", "Court": "춘천영월"},
        {"Sido": "강원특별자치도", "Sigungu": "평창군", "Court": "춘천영월"},
        {"Sido": "강원특별자치도", "Sigungu": "태백시", "Court": "춘천영월"},
    ])

    # [대전/충청]
    mapping.extend([
        {"Sido": "대전광역시", "Sigungu": "대전", "Court": "대전"},
        {"Sido": "세종특별자치시", "Sigungu": "세종", "Court": "대전"},
        {"Sido": "충청남도", "Sigungu": "금산군", "Court": "대전"},
        {"Sido": "충청남도", "Sigungu": "홍성군", "Court": "대전홍성"},
        {"Sido": "충청남도", "Sigungu": "보령시", "Court": "대전홍성"},
        {"Sido": "충청남도", "Sigungu": "서천군", "Court": "대전홍성"},
        {"Sido": "충청남도", "Sigungu": "예산군", "Court": "대전홍성"},
        {"Sido": "충청남도", "Sigungu": "공주시", "Court": "대전공주"},
        {"Sido": "충청남도", "Sigungu": "청양군", "Court": "대전공주"},
        {"Sido": "충청남도", "Sigungu": "논산시", "Court": "대전논산"},
        {"Sido": "충청남도", "Sigungu": "계룡시", "Court": "대전논산"},
        {"Sido": "충청남도", "Sigungu": "부여군", "Court": "대전논산"},
        {"Sido": "충청남도", "Sigungu": "서산시", "Court": "대전서산"},
        {"Sido": "충청남도", "Sigungu": "태안군", "Court": "대전서산"},
        {"Sido": "충청남도", "Sigungu": "당진시", "Court": "대전서산"},
        {"Sido": "충청남도", "Sigungu": "천안시", "Court": "대전천안"},
        {"Sido": "충청남도", "Sigungu": "아산시", "Court": "대전천안"},
        {"Sido": "충청북도", "Sigungu": "청주시", "Court": "청주"},
        {"Sido": "충청북도", "Sigungu": "진천군", "Court": "청주"},
        {"Sido": "충청북도", "Sigungu": "보은군", "Court": "청주"},
        {"Sido": "충청북도", "Sigungu": "괴산군", "Court": "청주"},
        {"Sido": "충청북도", "Sigungu": "증평군", "Court": "청주"},
        {"Sido": "충청북도", "Sigungu": "충주시", "Court": "청주충주"},
        {"Sido": "충청북도", "Sigungu": "음성군", "Court": "청주충주"},
        {"Sido": "충청북도", "Sigungu": "제천시", "Court": "청주제천"},
        {"Sido": "충청북도", "Sigungu": "단양군", "Court": "청주제천"},
        {"Sido": "충청북도", "Sigungu": "영동군", "Court": "청주영동"},
        {"Sido": "충청북도", "Sigungu": "옥천군", "Court": "청주영동"},
    ])

    # [대구/경북]
    daegu_main = ["중구", "동구", "남구", "북구", "수성구"]
    daegu_west = ["서구", "달서구", "달성군"]
    for d in daegu_main:
        mapping.append({"Sido": "대구광역시", "Sigungu": d, "Court": "대구"})
    for d in daegu_west:
        mapping.append({"Sido": "대구광역시", "Sigungu": d, "Court": "대구서부"})

    mapping.extend([
        {"Sido": "경상북도", "Sigungu": "경산시", "Court": "대구"},
        {"Sido": "경상북도", "Sigungu": "영천시", "Court": "대구"},
        {"Sido": "경상북도", "Sigungu": "청도군", "Court": "대구"},
        {"Sido": "경상북도", "Sigungu": "칠곡군", "Court": "대구서부"},
        {"Sido": "경상북도", "Sigungu": "성주군", "Court": "대구서부"},
        {"Sido": "경상북도", "Sigungu": "고령군", "Court": "대구서부"},
        {"Sido": "경상북도", "Sigungu": "안동시", "Court": "대구안동"},
        {"Sido": "경상북도", "Sigungu": "영주시", "Court": "대구안동"},
        {"Sido": "경상북도", "Sigungu": "봉화군", "Court": "대구안동"},
        {"Sido": "경상북도", "Sigungu": "경주시", "Court": "대구경주"},
        {"Sido": "경상북도", "Sigungu": "포항시", "Court": "대구포항"},
        {"Sido": "경상북도", "Sigungu": "울릉군", "Court": "대구포항"},
        {"Sido": "경상북도", "Sigungu": "김천시", "Court": "대구김천"},
        {"Sido": "경상북도", "Sigungu": "구미시", "Court": "대구김천"},
        {"Sido": "경상북도", "Sigungu": "상주시", "Court": "대구상주"},
        {"Sido": "경상북도", "Sigungu": "문경시", "Court": "대구상주"},
        {"Sido": "경상북도", "Sigungu": "예천군", "Court": "대구상주"},
        {"Sido": "경상북도", "Sigungu": "의성군", "Court": "대구의성"},
        {"Sido": "대구광역시", "Sigungu": "군위군", "Court": "대구의성"},
        {"Sido": "경상북도", "Sigungu": "청송군", "Court": "대구의성"},
        {"Sido": "경상북도", "Sigungu": "영덕군", "Court": "대구영덕"},
        {"Sido": "경상북도", "Sigungu": "영양군", "Court": "대구영덕"},
        {"Sido": "경상북도", "Sigungu": "울진군", "Court": "대구영덕"},
    ])

    # [부산/울산/경남]
    busan_main = ["중구", "동구", "영도구", "부산진구", "동래구", "연제구", "금정구"]
    busan_east = ["해운대구", "남구", "수영구", "기장군"]
    busan_west = ["서구", "북구", "사상구", "사하구", "강서구"]
    for d in busan_main:
        mapping.append({"Sido": "부산광역시", "Sigungu": d, "Court": "부산"})
    for d in busan_east:
        mapping.append({"Sido": "부산광역시", "Sigungu": d, "Court": "부산동부"})
    for d in busan_west:
        mapping.append({"Sido": "부산광역시", "Sigungu": d, "Court": "부산서부"})

    mapping.extend([
        {"Sido": "울산광역시", "Sigungu": "울산", "Court": "울산"},
        {"Sido": "경상남도", "Sigungu": "양산시", "Court": "울산"},
        {"Sido": "경상남도", "Sigungu": "창원시 성산구", "Court": "창원"},
        {"Sido": "경상남도", "Sigungu": "창원시 의창구", "Court": "창원"},
        {"Sido": "경상남도", "Sigungu": "창원시 진해구", "Court": "창원"},
        {"Sido": "경상남도", "Sigungu": "김해시", "Court": "창원"},
        {"Sido": "경상남도", "Sigungu": "창원시 마산합포구", "Court": "창원마산"},
        {"Sido": "경상남도", "Sigungu": "창원시 마산회원구", "Court": "창원마산"},
        {"Sido": "경상남도", "Sigungu": "함안군", "Court": "창원마산"},
        {"Sido": "경상남도", "Sigungu": "의령군", "Court": "창원마산"},
        {"Sido": "경상남도", "Sigungu": "진주시", "Court": "창원진주"},
        {"Sido": "경상남도", "Sigungu": "사천시", "Court": "창원진주"},
        {"Sido": "경상남도", "Sigungu": "남해군", "Court": "창원진주"},
        {"Sido": "경상남도", "Sigungu": "하동군", "Court": "창원진주"},
        {"Sido": "경상남도", "Sigungu": "산청군", "Court": "창원진주"},
        {"Sido": "경상남도", "Sigungu": "통영시", "Court": "창원통영"},
        {"Sido": "경상남도", "Sigungu": "거제시", "Court": "창원통영"},
        {"Sido": "경상남도", "Sigungu": "고성군", "Court": "창원통영"},
        {"Sido": "경상남도", "Sigungu": "밀양시", "Court": "창원밀양"},
        {"Sido": "경상남도", "Sigungu": "창녕군", "Court": "창원밀양"},
        {"Sido": "경상남도", "Sigungu": "거창군", "Court": "창원거창"},
        {"Sido": "경상남도", "Sigungu": "함양군", "Court": "창원거창"},
        {"Sido": "경상남도", "Sigungu": "합천군", "Court": "창원거창"},
    ])

    # [광주/전라/제주]
    mapping.extend([
        {"Sido": "광주광역시", "Sigungu": "광주", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "나주시", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "화순군", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "장성군", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "담양군", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "곡성군", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "영광군", "Court": "광주"},
        {"Sido": "전라남도", "Sigungu": "목포시", "Court": "광주목포"},
        {"Sido": "전라남도", "Sigungu": "무안군", "Court": "광주목포"},
        {"Sido": "전라남도", "Sigungu": "신안군", "Court": "광주목포"},
        {"Sido": "전라남도", "Sigungu": "함평군", "Court": "광주목포"},
        {"Sido": "전라남도", "Sigungu": "영암군", "Court": "광주목포"},
        {"Sido": "전라남도", "Sigungu": "장흥군", "Court": "광주장흥"},
        {"Sido": "전라남도", "Sigungu": "강진군", "Court": "광주장흥"},
        {"Sido": "전라남도", "Sigungu": "순천시", "Court": "광주순천"},
        {"Sido": "전라남도", "Sigungu": "광양시", "Court": "광주순천"},
        {"Sido": "전라남도", "Sigungu": "구례군", "Court": "광주순천"},
        {"Sido": "전라남도", "Sigungu": "고흥군", "Court": "광주순천"},
        {"Sido": "전라남도", "Sigungu": "보성군", "Court": "광주순천"},
        {"Sido": "전라남도", "Sigungu": "해남군", "Court": "광주해남"},
        {"Sido": "전라남도", "Sigungu": "완도군", "Court": "광주해남"},
        {"Sido": "전라남도", "Sigungu": "진도군", "Court": "광주해남"},
        {"Sido": "전북특별자치도", "Sigungu": "전주시", "Court": "전주"},
        {"Sido": "전북특별자치도", "Sigungu": "김제시", "Court": "전주"},
        {"Sido": "전북특별자치도", "Sigungu": "완주군", "Court": "전주"},
        {"Sido": "전북특별자치도", "Sigungu": "임실군", "Court": "전주"},
        {"Sido": "전북특별자치도", "Sigungu": "진안군", "Court": "전주"},
        {"Sido": "전북특별자치도", "Sigungu": "무주군", "Court": "전주"},
        {"Sido": "전북특별자치도", "Sigungu": "군산시", "Court": "전주군산"},
        {"Sido": "전북특별자치도", "Sigungu": "익산시", "Court": "전주군산"},
        {"Sido": "전북특별자치도", "Sigungu": "정읍시", "Court": "전주정읍"},
        {"Sido": "전북특별자치도", "Sigungu": "부안군", "Court": "전주정읍"},
        {"Sido": "전북특별자치도", "Sigungu": "고창군", "Court": "전주정읍"},
        {"Sido": "전북특별자치도", "Sigungu": "남원시", "Court": "전주남원"},
        {"Sido": "전북특별자치도", "Sigungu": "장수군", "Court": "전주남원"},
        {"Sido": "전북특별자치도", "Sigungu": "순창군", "Court": "전주남원"},
        {"Sido": "제주특별자치도", "Sigungu": "제주시", "Court": "제주"},
        {"Sido": "제주특별자치도", "Sigungu": "서귀포시", "Court": "제주"},
    ])

    return mapping


def find_court(address, mapping_list):
    """
    주소를 입력받아 간소화된 법원 명칭을 반환합니다.
    (재미나이 스크립트 로직: 시도 정규화 → 창원/마산 특수 처리 → 1차/2차/3차 검색)
    """
    if not isinstance(address, str):
        return "기타"
    address = address.strip().replace("  ", " ")
    tokens = address.split()
    if len(tokens) < 2:
        return "기타"

    sido = tokens[0]
    sigungu = tokens[1]

    # 시도 이름 정규화
    if "서울" in sido:
        sido_norm = "서울특별시"
    elif "경기" in sido:
        sido_norm = "경기도"
    elif "인천" in sido:
        sido_norm = "인천광역시"
    elif "강원" in sido:
        sido_norm = "강원특별자치도"
    elif "대전" in sido:
        sido_norm = "대전광역시"
    elif "세종" in sido:
        sido_norm = "세종특별자치시"
    elif "충남" in sido or "충청남" in sido:
        sido_norm = "충청남도"
    elif "충북" in sido or "충청북" in sido:
        sido_norm = "충청북도"
    elif "대구" in sido:
        sido_norm = "대구광역시"
    elif "경북" in sido or "경상북" in sido:
        sido_norm = "경상북도"
    elif "부산" in sido:
        sido_norm = "부산광역시"
    elif "울산" in sido:
        sido_norm = "울산광역시"
    elif "경남" in sido or "경상남" in sido:
        sido_norm = "경상남도"
    elif "광주" in sido:
        sido_norm = "광주광역시"
    elif "전남" in sido or "전라남" in sido:
        sido_norm = "전라남도"
    elif "전북" in sido or "전라북" in sido:
        sido_norm = "전북특별자치도"
    elif "제주" in sido:
        sido_norm = "제주특별자치도"
    else:
        sido_norm = sido

    # 창원시 특수 처리 (구에 따라 본원/마산지원 나뉨)
    if "창원" in sigungu or (len(tokens) > 2 and "창원" in tokens[1]):
        full_sigungu = sigungu + (" " + tokens[2] if len(tokens) > 2 else "")
        if "마산" in full_sigungu:
            return "창원마산"
        return "창원"

    # 1차: 시도 + 시군구 정확 일치
    for row in mapping_list:
        if row["Sido"] == sido_norm and row["Sigungu"] == sigungu:
            return row["Court"]

    # 2차: 시군구명 포함 관계
    candidates = [r for r in mapping_list if r["Sido"] == sido_norm]
    input_detail = sigungu + (" " + tokens[2] if len(tokens) > 2 else "")
    for row in candidates:
        map_sigungu = row["Sigungu"]
        if map_sigungu in input_detail or (map_sigungu.replace("시", "") in input_detail):
            return row["Court"]

    # 3차: 광역 매핑 (시도 앞 2자리로 포함 검색)
    short_sido = sido_norm[:2]
    for row in mapping_list:
        if row["Sido"] == sido_norm and short_sido in row["Sigungu"]:
            return row["Court"]

    return "기타"


# 모듈 로드 시 1회만 생성
_JURISDICTION_MAP = get_jurisdiction_data()


def get_court_from_text(text):
    """
    화면/테이블 텍스트에서 주소를 추출한 뒤 관할 법원을 반환합니다.
    - '주소' 라인이 있으면 그 라인에서 주소 부분만 사용
    - 없으면 텍스트 전체에서 시도로 시작하는 부분을 주소로 사용
    """
    if not text or not isinstance(text, str):
        return "기타"
    text = text.strip()
    address = None
    # '주소' 라인 추출
    for line in text.split("\n"):
        line = line.strip()
        if "주소" in line:
            parts = line.split("주소", 1)
            if len(parts) >= 2:
                address = parts[1].strip()
                # 라벨만 남기고 실제 주소만 (예: "경상남도 창원시 ...")
                break
    # 주소 라인이 없으면 시도로 시작하는 첫 줄/부분 사용
    if not address:
        for part in text.replace("\n", " ").split():
            if part.startswith("경상") or part.startswith("서울") or part.startswith("경기") or \
               part.startswith("인천") or part.startswith("강원") or part.startswith("대전") or \
               part.startswith("충청") or part.startswith("대구") or part.startswith("부산") or \
               part.startswith("울산") or part.startswith("광주") or part.startswith("전라") or \
               part.startswith("제주") or part.startswith("세종"):
                idx = text.find(part)
                chunk = text[idx:idx + 80].split("\n")[0].strip()
                address = chunk
                break
    if address:
        return find_court(address, _JURISDICTION_MAP)
    return "기타"
