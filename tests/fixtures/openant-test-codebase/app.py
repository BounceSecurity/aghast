"""Simple test application for OpenAnt parse integration tests.

This file contains multiple functions and a class to ensure OpenAnt's parser
extracts at least one code unit during the parse stage.
"""

import sqlite3
import os
import hashlib


# --- Database helpers ---

def get_db_connection():
    """Get a database connection."""
    db_path = os.environ.get("DATABASE_PATH", "app.db")
    return sqlite3.connect(db_path)


def get_user_by_id(user_id):
    """Fetch a user by ID — uses string concatenation (vulnerable to SQL injection)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM users WHERE id = " + str(user_id)
    cursor.execute(query)
    result = cursor.fetchone()
    conn.close()
    return result


def get_user_by_name(name):
    """Fetch a user by name — uses parameterized query (safe)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE name = ?", (name,))
    result = cursor.fetchone()
    conn.close()
    return result


def list_users(limit=100):
    """List all users with a limit."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, email FROM users LIMIT ?", (limit,))
    results = cursor.fetchall()
    conn.close()
    return results


def create_user(name, email, password):
    """Create a new user with hashed password."""
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = hashlib.md5(password.encode()).hexdigest()
    cursor.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        (name, email, password_hash),
    )
    conn.commit()
    user_id = cursor.lastrowid
    conn.close()
    return user_id


def delete_user(user_id):
    """Delete a user by ID — no authorization check."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = " + str(user_id))
    conn.commit()
    conn.close()


def search_users(query_string):
    """Search users by name — vulnerable to SQL injection."""
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = f"SELECT * FROM users WHERE name LIKE '%{query_string}%'"
    cursor.execute(sql)
    results = cursor.fetchall()
    conn.close()
    return results


# --- User class ---

class UserService:
    """Service class for user operations."""

    def __init__(self):
        self.conn = get_db_connection()

    def authenticate(self, username, password):
        """Authenticate a user — uses MD5 for password hashing (weak)."""
        password_hash = hashlib.md5(password.encode()).hexdigest()
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT id FROM users WHERE name = ? AND password_hash = ?",
            (username, password_hash),
        )
        return cursor.fetchone() is not None

    def update_email(self, user_id, new_email):
        """Update user email — no input validation."""
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE users SET email = ? WHERE id = ?",
            (new_email, user_id),
        )
        self.conn.commit()

    def get_user_profile(self, user_id):
        """Get full user profile including sensitive fields."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return cursor.fetchone()

    def close(self):
        """Close database connection."""
        self.conn.close()
