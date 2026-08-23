import sqlite3
import json
import os
from typing import Optional

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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            history TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def load_session_history(session_id: str) -> Optional[list[dict]]:
    conn = get_db()
    row = conn.execute(
        "SELECT history FROM sessions WHERE session_id = ?", (session_id,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return json.loads(row["history"])


def save_session_history(session_id: str, history: list[dict]) -> None:
    conn = get_db()
    conn.execute(
        """
        INSERT INTO sessions (session_id, history, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id) DO UPDATE SET
            history=excluded.history,
            updated_at=CURRENT_TIMESTAMP
        """,
        (session_id, json.dumps(history)),
    )
    conn.commit()
    conn.close()
