const Database = require('better-sqlite3');

// Create (or open) our database file
const db = new Database('calendar.db');

// Create our events table if it doesn't already exist
db.exec(`
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
`);

// Remember which Discord message is our permanent calendar
db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_messages (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL
    )
`);

module.exports = db;