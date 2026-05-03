import sqlite3
import json
import os

DB_PATH = os.getenv("DB_PATH", "naviro.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            vibes TEXT DEFAULT '[]',
            travel_style TEXT DEFAULT '',
            budget TEXT DEFAULT '',
            pace TEXT DEFAULT '',
            past_destinations TEXT DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()
