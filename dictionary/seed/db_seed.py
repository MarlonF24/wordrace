import sqlite3
from pathlib import Path

def seed_database(jsonl_path: Path):
    with sqlite3.connect(jsonl_path.parent.parent / 'dictionary.db') as conn:
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA journal_mode = WAL")  # Fast writing
        cursor.execute("PRAGMA synchronous = OFF") # Skip some disk-wait safety


        with open(jsonl_path.parent / 'schema.sql', 'r', encoding='utf-8') as f: 
            cursor.executescript(f.read())

        batch: list[str] = []
        
        insert_query = "INSERT INTO dictionary (raw_data) VALUES (jsonb(?))"
        
        with open(jsonl_path, 'r', encoding='utf-8') as f:
            for i, raw_json in enumerate(f):
                batch.append(raw_json.strip())
                print(f"Adding item {i} to db", end='\r')
                if len(batch) >= 10000:
                    cursor.executemany(insert_query, [(item,) for item in batch])
                    conn.commit()
                    batch = []

            if batch:
                    cursor.executemany(insert_query, [(item,) for item in batch])
                    conn.commit()
                


if __name__ == "__main__":
    FILE_PATH = Path(__file__)
    
    jsonl_path = FILE_PATH.parent / 'kaikki.org-dictionary-English-words.jsonl'
    seed_database(jsonl_path)