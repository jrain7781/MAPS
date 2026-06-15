# -*- coding: utf-8 -*-
import sys

def search_file(filepath, query):
    encodings = ['utf-8', 'utf-16', 'utf-16-le', 'utf-16-be', 'cp949', 'euc-kr']
    for enc in encodings:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                content = f.read()
            lines = content.splitlines()
            matches = []
            for i, line in enumerate(lines):
                if query.lower() in line.lower():
                    matches.append(f"L{i+1}: {line}")
            
            with open('matches.txt', 'w', encoding='utf-8') as out:
                out.write(f"Encoding: {enc}\nFound {len(matches)} matches:\n" + "\n".join(matches))
            print("Successfully written matches to matches.txt")
            return
        except UnicodeDecodeError:
            continue
        except Exception as e:
            print(f"Error reading with {enc}: {e}")
            return
    print("Failed to read file with any encoding.")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python search_db.py <filepath> <query>")
    else:
        search_file(sys.argv[1], sys.argv[2])
