import re
import os

file_path = r"C:\LJW\MAPS_TEST\index.html"

# Read the entire file content
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Identify the button to move
button_to_move_text = "전체보기"
target_button_text = "선택 전송"

# Regex to find the '전체보기' button with its surrounding whitespace
# This pattern is more robust against minor whitespace variations but still specific enough
view_all_pattern = re.compile(r'(\s*)(<button\s+onclick="showAllItemData\(\)"[^>]*>' + re.escape(button_to_move_text) + r'</button>)', re.DOTALL)
view_all_match = view_all_pattern.search(content)

if view_all_match:
    view_all_indent = view_all_match.group(1)
    view_all_html = view_all_match.group(2)
    
    # Remove the button from its current position
    content_removed = view_all_pattern.sub("", content, 1) # Limit to 1 replacement

    # Regex to find the '선택 전송' button with its surrounding whitespace
    # This pattern is more robust against minor whitespace variations but still specific enough
    select_send_pattern = re.compile(r'(\s*)(<button\s+type="button"\s+onclick="handleBulkTelegramSendFromItemList\(\)"[^>]*>' + re.escape(target_button_text) + r'</button>)', re.DOTALL)
    select_send_match = select_send_pattern.search(content_removed)
    
    if select_send_match:
        select_send_indent = select_send_match.group(1)
        select_send_html = select_send_match.group(2)

        # Insert the '전체보기' button after '선택 전송'
        # Ensure proper indentation
        new_button_block = f"{select_send_html}
{select_send_indent}{view_all_html.strip()}"
        modified_content = content_removed.replace(select_send_html, new_button_block, 1) # Limit to 1 replacement

        # Write the modified content back to the file
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(modified_content)
        print(f"Successfully moved '{button_to_move_text}' button in index.html.")
    else:
        print(f"'{target_button_text}' button not found for insertion.")
else:
    print(f"'{button_to_move_text}' button not found for moving.")
