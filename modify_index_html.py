import re
import os

file_path = r"C:\LJW\MAPS_TEST\index.html" # Use raw string for path

# Read the entire file content
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Find the "전체보기" button HTML
# Use re.DOTALL for multiline match and \s* for flexible whitespace
view_all_button_pattern = re.compile(r'\s*(<button\s+onclick="showAllItemData\(\)"[^>]*>전체보기</button>)\s*', re.DOTALL)
view_all_button_match = view_all_button_pattern.search(content)

if view_all_button_match:
    view_all_button_html = view_all_button_match.group(1)
    
    # 2. Remove the "전체보기" button from its current location
    content_without_view_all = view_all_button_pattern.sub("", content)

    # 3. Find the "선택 전송" button HTML
    # Make sure to capture the indentation before the button for proper re-insertion
    select_send_button_pattern = re.compile(r'(\s*)(<button\s+type="button"\s+onclick="handleBulkTelegramSendFromItemList\(\)"[^>]*>선택 전송</button>)', re.DOTALL)
    select_send_button_match = select_send_button_pattern.search(content_without_view_all)

    if select_send_button_match:
        select_send_button_indentation = select_send_button_match.group(1)
        select_send_button_html = select_send_button_match.group(2)
        
        # 4. Insert "전체보기" after "선택 전송"
        # Re-add indentation to the moved button
        new_content = content_without_view_all.replace(
            select_send_button_html,
            f"{select_send_button_html}\n{select_send_button_indentation}{view_all_button_html.strip()}" # strip to remove leading/trailing whitespace from the captured button HTML
        )

        # 5. Write the modified content back to the file
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully moved '전체보기' button in index.html.")
    else:
        print("'선택 전송' button not found for insertion.")
else:
    print("'전체보기' button not found for moving.")
