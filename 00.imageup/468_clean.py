print("?뱼 MJ寃쎈ℓ 理쒖쥌 ?꾧껐 (踰뺤썝紐낆닔??+ 怨듬ℓ媛뺤젣 + 愿꾪샇?몄떇 + ?⑹껜罹≪쿂)...")

import base64
import time
import os
import re
import traceback
import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# ==============================================================================
# [?ㅼ젙] 怨꾩젙 諛?寃쎈줈
# ==============================================================================
ACCOUNTS = [
    {"id": "mjgold",   "pw": "28471296",    "manager": "??쒕떂"},
    {"id": "mjjang1",  "pw": "28471298",    "manager": "??쒕떂"},
#    {"id": "jjhsm81",  "pw": "marlboro81!!", "manager": "?꾩젣??}
]

# ???寃쎈줈: 援ш? ?쒕씪?대툕 (???깅줉怨??숈씪?섍쾶 ?좎?)
BASE_SAVE_DIR = r"G:\???쒕씪?대툕\MAPS\mapsimage"

# ==============================================================================
# [?ㅼ젙] 踰뺤썝 愿??留ㅼ묶 (?щ??섏씠 ?뺣━ ?ㅽ겕由쏀듃 湲곕컲 - court_jurisdiction 紐⑤뱢 ?ъ슜)
# ==============================================================================
from court_jurisdiction import get_court_from_text

SELECTOR_ID = "client_id"
SELECTOR_PW_DUMMY = "pw_Dummy"
SELECTOR_PW_REAL = "passwd"
SELECTOR_LOGIN_BTN = "//div[@id='login_btn_area']//a | //input[@type='image' and contains(@src, 'login')]"
SELECTOR_RADIO_GONGMAE = '//*[@id="itype2"]'
SELECTOR_SEARCH_BTN = '//*[@id="btnSrch"]'

SKIP_KEYWORDS = ["?섏쓽 遺꾨쪟愿由?, "?묒????, "留ㅺ컖湲곗씪 蹂寃쎄났吏", "?뺣젹/蹂닿린", "寃??]

# ==============================================================================
# [?⑥닔 2] ?앹뾽 ?쒓굅
# ==============================================================================
def remove_popups_css(driver):
    try:
        driver.execute_script("""
            var styles = `
                #inter_popup, .layer, .popup, div[id^='layer'], div[class*='popup'], #div_pop_back { 
                    display: none !important; 
                    visibility: hidden !important; 
                    opacity: 0 !important;
                    pointer-events: none !important;
                    z-index: -9999 !important;
                }
            `;
            var styleSheet = document.createElement("style");
            styleSheet.innerText = styles;
            document.head.appendChild(styleSheet);
        """)
        time.sleep(0.5)
    except:
        pass

# ==============================================================================
# [?⑥닔 2-1] ?뺣젹/媛쒖닔 ?좏깮 ??寃??(罹≪쿂 吏곸쟾)
# ==============================================================================
def wait_for_ajax(driver, timeout=15):
    """AJAX ?꾨즺 ?湲?- jQuery ?щ? 臾닿?, 理쒖냼 3珥?蹂댁옣"""
    time.sleep(0.5)  # AJAX ?쒖옉 蹂댁옣
    _start = time.time()
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script("""
                try { return jQuery.active === 0; } catch(e) { return true; }
            """)
        )
    except:
        pass
    # 鍮?jQuery AJAX ?鍮? 珥?3珥?蹂댁옣 (0.5s 珥덇린 + 理쒖냼 2.5s 異붽?)
    _elapsed = time.time() - _start
    if _elapsed < 2.5:
        time.sleep(2.5 - _elapsed)

def apply_list_options_and_search(driver):
    """?뺣젹: ?깅줉?쇄넃(#order_type=idx desc), 媛쒖닔: 20(#list_scale=20), 寃??#btnSrch) ?대┃"""
    # order_type: ?깅줉?쇄넃 ?듭뀡???띿뒪?몃줈 李얠븘???ㅼ젙 (value媛 寃쎈ℓ/怨듬ℓ留덈떎 ?ㅻ쫫)
    try:
        r = driver.execute_script("""
            var s = document.getElementById('order_type');
            if(!s) return '?놁쓬';
            var opt = Array.from(s.options).find(o => o.text.includes('?깅줉??) && o.text.includes('??));
            if(!opt) return '?듭뀡?놁쓬';
            s.value = opt.value;
            s.dispatchEvent(new Event('change', {bubbles:true}));
            return s.value;
        """)
        print(f"    ???뺣젹(order_type) ?ㅼ젙: {r}")
        time.sleep(0.3)
    except:
        pass
    # list_scale: JS 吏곸젒 ?ㅼ젙
    try:
        driver.execute_script("""
            var s = document.getElementById('list_scale');
            if(s) { s.value = '20'; s.dispatchEvent(new Event('change', {bubbles:true})); }
        """)
        time.sleep(0.3)
    except:
        pass
    # btnSrch: JS 媛뺤젣 ?대┃
    try:
        btn = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.ID, "btnSrch")))
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(2)
    except Exception as e:
        print(f"  ??寃??踰꾪듉 ?대┃ ?ㅽ뙣: {e}")

# ==============================================================================
# [?⑥닔 3] [?듭떖] ?ㅻ뜑+?뚯씠釉??⑹껜 罹≪쿂
# ==============================================================================
def capture_combined_element(driver, header_element, table_element, file_path):
    try:
        # 1. ?ㅻ뜑 ?꾩튂濡??ㅽ겕濡?        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", header_element)
        time.sleep(0.2)

        # 2. 醫뚰몴 怨꾩궛
        rect_h = driver.execute_script("return arguments[0].getBoundingClientRect();", header_element)
        rect_t = driver.execute_script("return arguments[0].getBoundingClientRect();", table_element)
        scroll_x = driver.execute_script("return window.pageXOffset;")
        scroll_y = driver.execute_script("return window.pageYOffset;")

        x = rect_t['left'] + scroll_x
        y = rect_h['top'] + scroll_y
        width = rect_t['width']
        # ?믪씠 = (?뚯씠釉?諛붾떏) - (?ㅻ뜑 泥쒖옣)
        height = (rect_t['top'] + rect_t['height']) - rect_h['top']

        if width <= 0 or height <= 0:
            print(f"      ??罹≪쿂 ?ㅽ뙣: ?ш린 ?댁긽 (width={width:.1f}, height={height:.1f})")
            return False

        # 3. 罹≪쿂
        screenshot_base64 = driver.execute_cdp_cmd("Page.captureScreenshot", {
            "clip": { "x": x, "y": y, "width": width, "height": height, "scale": 1 },
            "captureBeyondViewport": True, "format": "png"
        })

        if os.path.exists(file_path):
            try: os.remove(file_path); time.sleep(0.1)
            except: pass

        with open(file_path, "wb") as f:
            f.write(base64.b64decode(screenshot_base64['data']))
        return True
    except Exception as e:
        print(f"      ??罹≪쿂 ?ㅻ쪟: {type(e).__name__}: {e}")
        return False

# ==============================================================================
# [?⑥닔 4] ?좎쭨 異붿텧 濡쒖쭅 (?ㅻ뜑 ?띿뒪??湲곕컲)
# ==============================================================================
def extract_reg_date(header_text):
    """?ㅻ뜑?먯꽌 ?깅줉??YY.MM.DD) ?뚯떛 ??datetime.date 諛섑솚"""
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{2})", header_text)
    if m:
        yy, mm, dd = m.groups()
        try:
            return datetime.date(2000 + int(yy), int(mm), int(dd))
        except:
            pass
    return None

def extract_smart_date(header_text, type_prefix, reg_date=None):
    """?좎쭨 異붿텧 ??(?뚯씪紐낆슜 臾몄옄??YYMMDD, datetime.date or None) 諛섑솚"""
    today_year = datetime.datetime.now().year

    # [怨듬ℓ ?꾩슜] "02.23 14:00~02.25 17:00" ??~ ??醫낅즺???ъ슜
    if type_prefix == "怨듬ℓ":
        end_match = re.search(r"~\s*(\d{1,2})[\./](\d{1,2})", header_text)
        if end_match:
            em, ed = int(end_match.group(1)), int(end_match.group(2))
            # ?꾨룄 ?뺤젙: ?깅줉????> ?낆같 醫낅즺?붿씠硫??ㅼ쓬 ?곕룄
            if reg_date:
                year = (reg_date.year + 1) if reg_date.month > em else reg_date.year
            else:
                year = today_year
            try:
                bid_date = datetime.date(year, em, ed)
                return f"{str(year)[2:]}{str(em).zfill(2)}{str(ed).zfill(2)}", bid_date
            except:
                pass
        # fallback: 泥?踰덉㎏ ?쒓컙 ?⑦꽩
        gm = re.search(r"(\d{1,2})[\./](\d{1,2})\s+\d{1,2}:\d{1,2}", header_text)
        if gm:
            month, day = gm.group(1), gm.group(2)
            return f"{str(today_year)[2:]}{month.zfill(2)}{day.zfill(2)}", None

    # [寃쎈ℓ ?꾩슜] "2026-02-26" ?먮뒗 "2025.02.14" ?뺥깭
    k_auction_pattern = re.search(r"(20\d{2})[\.-](\d{1,2})[\.-](\d{1,2})", header_text)
    if k_auction_pattern:
        year, month, day = k_auction_pattern.groups()
        try:
            bid_date = datetime.date(int(year), int(month), int(day))
            return f"{year[2:]}{month.zfill(2)}{day.zfill(2)}", bid_date
        except:
            pass

    return "000000", None

def extract_sakun_from_dom(driver, container):
    """?ш굔踰덊샇/愿由щ쾲??異붿텧 (寃쎈ℓ/怨듬ℓ 怨듯넻)
    ?꾩튂: table.tbl_grid.hand tbody tr:nth-child(1) td:nth-child(2)
    """
    try:
        td = container.find_element(By.CSS_SELECTOR, "table.tbl_grid.hand tbody tr:nth-child(1) td:nth-child(2)")
        return td.text.strip()
    except:
        return None


def extract_date_from_dom(driver, container):
    """寃쎈ℓ ?꾩슜: table.tbl_noline 6踰덉㎏ td?먯꽌 ?낆같?쇱옄 異붿텧
    ?꾩튂: table.tbl_noline tbody tr td:nth-child(6)
    ?? '2026-03-04(寃쎈ℓ1?쇱쟾)' ??('260304', datetime.date(2026, 3, 4))
    """
    try:
        td = container.find_element(By.CSS_SELECTOR, "table.tbl_noline tbody tr td:nth-child(6)")
        td_text = td.text.strip()          # "2026-03-04(寃쎈ℓ1?쇱쟾)"
        date_part = td_text.split("(")[0].strip()  # "2026-03-04"
        m = re.match(r"(20\d{2})-(\d{1,2})-(\d{1,2})", date_part)
        if m:
            year, month, day = m.groups()
            bid_date = datetime.date(int(year), int(month), int(day))
            return f"{year[2:]}{month.zfill(2)}{day.zfill(2)}", bid_date
    except:
        pass
    return "000000", None

# ==============================================================================
# [?⑥닔 5] 由ъ뒪??泥섎━
# ==============================================================================
def process_list_page(driver, save_dir, type_prefix, manager=""):
    print(f"\n  ??[{type_prefix}] 由ъ뒪??遺꾩꽍 ?쒖옉...")
    remove_popups_css(driver)
    
    try:
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "table")))
        time.sleep(2) 
    except:
        return

    container_xpath = "//div[starts-with(@id, 'tr_')] | //tr[starts-with(@id, 'tr_')]"
    all_containers = driver.find_elements(By.XPATH, container_xpath)
    candidates = []
    
    for item in all_containers:
        try:
            if item.size['height'] > 100:
                text = item.text
                is_skip = False
                for k in SKIP_KEYWORDS:
                    if k in text: is_skip = True; break
                if is_skip: continue

                # [?꾪꽣] ?ш굔踰덊샇 ?먮뒗 愿由щ쾲??(怨듬ℓ ?ы븿)
                if ("?ш굔踰덊샇" in text or "愿由щ쾲?? in text) and "媛먯젙媛" in text:
                    # [紐⑤뱶 援먯감 寃利? ?섏씠??媛쒖닔 湲곗?: 寃쎈ℓ=1媛? 怨듬ℓ=2媛?                    _cn = re.search(r"20\d{2}-[\d-]+", text)
                    if _cn:
                        _dash = _cn.group().count("-")
                        if type_prefix == "寃쎈ℓ" and _dash >= 2: continue
                        if type_prefix == "怨듬ℓ" and _dash < 2: continue
                    candidates.append(item)
        except: continue
    
    if not candidates:
        print(f"    - [{type_prefix}] 泥섎━??臾쇨굔???놁뒿?덈떎.")
        return

    count = 0
    skipped_count = 0
    
    for i, item in enumerate(candidates):
        try:
            full_text = item.text
            
            # 1. 硫붾え 泥댄겕
            has_memo = False
            if "硫붾え" in full_text:
                for line in full_text.split('\n'):
                    if "硫붾え" in line:
                        clean = line.replace("硫붾え", "").replace(":", "").strip()
                        if len(clean) > 0: has_memo = True; break
            
            if not has_memo:
                skipped_count += 1
                continue

            # 2. ?ㅻ뜑 李얘린 (?뺤젣 ?붿냼)
            try:
                header_element = item.find_element(By.XPATH, "preceding-sibling::*[1]")
                header_text = header_element.text + " " + full_text.split('\n')[0]
            except:
                header_text = full_text.split('\n')[0]
                header_element = item 

            # 3. ?ш굔踰덊샇 異붿텧 + ?섏씠??媛쒖닔 寃利?            # DOM?먯꽌 ?ш굔踰덊샇 異붿텧 ?쒕룄
            dom_sakun = extract_sakun_from_dom(driver, item)
            if dom_sakun:
                raw_sakun = dom_sakun
            else:
                pattern = r"20\d{2}-\d+[\d-]*(?:\(\d+\))?"
                match = re.search(pattern, full_text)
                if not match: match = re.search(pattern, header_text)
                raw_sakun = match.group() if match else f"踰덊샇誘몄긽{i}"
            
            dash_count = raw_sakun.count("-")

            if type_prefix == "寃쎈ℓ":
                if dash_count >= 2:
                    print(f"    ??寃쎈ℓ ?ш굔踰덊샇 ?섏씠??2媛??댁긽 ???ㅽ궢: {raw_sakun}")
                    skipped_count += 1
                    continue
                sakun_no = raw_sakun.replace("-", "?寃?)  # 2025-1234 ??2025?寃?234
            else:  # 怨듬ℓ
                if dash_count < 2:
                    print(f"    ??怨듬ℓ ?ш굔踰덊샇 ?섏씠??1媛??댄븯 ???ㅽ궢: {raw_sakun}")
                    skipped_count += 1
                    continue
                sakun_no = raw_sakun.split()[0] if " " in raw_sakun else raw_sakun

            # 4. ?깅줉???뚯떛
            reg_date = extract_reg_date(header_text)

            # 5. ?좎쭨 異붿텧 + ?낆같???ㅽ궢 泥댄겕
            if type_prefix == "寃쎈ℓ":
                bid_date_str, bid_date_obj = extract_date_from_dom(driver, item)
                if bid_date_str == "000000":
                    bid_date_str, bid_date_obj = extract_smart_date(header_text, type_prefix, reg_date)
            else:
                # 怨듬ℓ???낆같?쇱옄 濡쒖쭅 ?덈? 嫄대뱶由ъ? 留?寃?(吏?쒖궗??
                bid_date_str, bid_date_obj = extract_smart_date(header_text, type_prefix, reg_date)
            if bid_date_obj and bid_date_obj <= datetime.date.today():
                print(f"    ???낆같??{bid_date_obj} <= ?ㅻ뒛, ?ㅽ궢")
                skipped_count += 1
                continue

            # 6. 踰뺤썝紐?異붿텧
            court_name = "怨듬ℓ" if type_prefix == "怨듬ℓ" else get_court_from_text(full_text)

            # 6-1. ?μ뀡 product_id 異붿텧 (?대?吏 src ?⑦꽩: 寃쎈ℓ=Thumnail/m/.../m{ID}_, 怨듬ℓ=PubAuct/...//{ID}_)
            product_id = ""
            try:
                product_id = driver.execute_script("""
                    var tbl = arguments[0], hdr = arguments[1];
                    // 1. ?대?吏 src/onerror?먯꽌 異붿텧
                    var imgs = tbl.querySelectorAll('img');
                    for(var i=0; i<imgs.length; i++){
                        var src = imgs[i].getAttribute('src') || '';
                        var m = src.match(/Thumnail\/m\/\d+\/m(\d+)_/) || src.match(/PubAuct\/\d+\/\d+\/(\d+)_/);
                        if(m) return m[1];
                        var oe = imgs[i].getAttribute('onerror') || '';
                        var m2 = oe.match(/Thumnail\/m\/\d+\/m(\d+)_/) || oe.match(/PubAuct\/\d+\/\d+\/(\d+)_/);
                        if(m2) return m2[1];
                    }
                    // 2. href/onclick fallback (?뚯씠釉붴넂?ㅻ뜑)
                    var sources = [tbl, hdr];
                    for(var s=0; s<sources.length; s++){
                        var link = sources[s].querySelector('a[href*="product_id="]');
                        if(link){ var m=link.href.match(/product_id=(\d+)/); if(m) return m[1]; }
                        var all = sources[s].querySelectorAll('[onclick]');
                        for(var j=0; j<all.length; j++){
                            var m=(all[j].getAttribute('onclick')||'').match(/product_id[=\(,]['"]?(\d+)/);
                            if(m) return m[1];
                        }
                    }
                    // 3. 遺紐?諛⑺뼢 ?띿꽦 ?먯깋
                    var el = tbl.parentElement;
                    for(var i=0; i<10; i++){
                        if(!el || el===document.body) break;
                        var attrs = el.attributes || [];
                        for(var j=0; j<attrs.length; j++){
                            var m = attrs[j].value.match(/product_id[=\(,]['"]?(\d+)/);
                            if(m) return m[1];
                        }
                        el = el.parentElement;
                    }
                    return '';
                """, item, header_element) or ""
            except:
                pass
            print(f"    ?뵇 product_id: {product_id or '誘몄텛異?}")

            # 7. ???(?⑹껜 罹≪쿂)
            safe_sakun = re.sub(r'[\\/*?:"<>|]', "", sakun_no)
            safe_court = re.sub(r'[\\/*?:"<>|]', "", court_name)
            pid_suffix = f"_{product_id}" if product_id else ""
            filename = f"{safe_sakun}_{bid_date_str}_{safe_court}_{manager}{pid_suffix}.png"
            file_path = os.path.join(save_dir, filename)

            if capture_combined_element(driver, header_element, item, file_path):
                print(f"    - ({i+1}) ?벝 ??? {filename}")
                count += 1
            else:
                print(f"    - ({i+1}) ??罹≪쿂 ?ㅽ뙣")
            
        except Exception as e:
            print(f"    ??臾쇨굔 泥섎━ ?ㅻ쪟 ({i+1}踰덉㎏): {type(e).__name__}: {e}")
            continue

    print(f"  ??[{type_prefix}] {count}嫄?????꾨즺 (硫붾え?놁쓬 ?쒖쇅: {skipped_count}嫄?")

# ==============================================================================
# 硫붿씤 ?ㅽ뻾遺 (?덉젙 濡쒓렇??+ 怨듬ℓ 媛뺤젣吏꾩엯)
# ==============================================================================
def run_macro(account):
    user_id = account['id']
    user_pw = account['pw']
    manager = account.get("manager", "")
    save_dir = BASE_SAVE_DIR
    os.makedirs(save_dir, exist_ok=True)

    print(f"\n?? 怨꾩젙 [{user_id}] ?묒뾽 ?쒖옉")
    print(f"?뱛 ???寃쎈줈: {save_dir}")

    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--force-device-scale-factor=2")
    options.add_experimental_option("detach", True)

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)

    try:
        # 濡쒓렇??        driver.get("https://www.auction1.co.kr/common/login_box.php")
        remove_popups_css(driver)
        wait.until(EC.presence_of_element_located((By.ID, SELECTOR_ID)))
        
        login_script = f"""
            document.getElementById('{SELECTOR_ID}').value = '{user_id}';
            var dummy = document.getElementById('{SELECTOR_PW_DUMMY}');
            var real = document.getElementById('{SELECTOR_PW_REAL}');
            if(dummy) dummy.style.display = 'none';
            if(real) {{ real.style.display = 'block'; real.value = '{user_pw}'; }}
        """
        driver.execute_script(login_script)
        
        try:
            driver.find_element(By.XPATH, SELECTOR_LOGIN_BTN).click()
        except:
            driver.find_element(By.ID, SELECTOR_PW_REAL).send_keys(Keys.RETURN)
        
        time.sleep(2)

        # 寃쎈ℓ (愿?щЪ嫄?吏꾩엯 ???앹뾽 ?쒓굅 ???뺣젹/媛쒖닔/寃????罹≪쿂)
        driver.get("https://www.auction1.co.kr/member/inter_list.php")
        remove_popups_css(driver)
        time.sleep(1)
        apply_list_options_and_search(driver)
        process_list_page(driver, save_dir, "寃쎈ℓ", manager)

        # [?섏젙] 怨듬ℓ 媛뺤젣 吏꾩엯 (?먮윭 臾댁떆?섏? ?딄퀬 ?뚰뙆)
        try:
            print("  ??[怨듬ℓ] ?섏씠吏 ?꾪솚 ?쒕룄...")
            # 1. ?쇰뵒??踰꾪듉 媛뺤젣 ?대┃
            driver.execute_script("if(document.querySelector('#itype2')) document.querySelector('#itype2').click();")
            wait_for_ajax(driver)  # 怨듬ℓ ?꾪솚 AJAX ?꾨즺源뚯? ?湲?(議고쉶 ?앸궗?붿? ?뺤씤)
            remove_popups_css(driver)
            # 2. ?뺣젹(?깅줉?쇄넃) / 媛쒖닔(20) / 寃??            apply_list_options_and_search(driver)
            # 3. 遺꾩꽍 ?쒖옉
            process_list_page(driver, save_dir, "怨듬ℓ", manager)
            
        except Exception as e:
            print(f"  ??怨듬ℓ 吏꾩엯 以??ㅻ쪟: {e}")

    except Exception as e:
        print(f"\n???ㅻ쪟 諛쒖깮:")
        traceback.print_exc() 
    finally:
        print(f"?몝 [{user_id}] 醫낅즺")
        driver.quit()

if __name__ == "__main__":
    for acc in ACCOUNTS:
        run_macro(acc)
        time.sleep(3)
    print("\n?럦 紐⑤뱺 ?묒뾽 ?꾨즺!")
