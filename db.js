const Database = require('better-sqlite3');
const db = new Database('news.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    title TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function isAlreadySeen(url) {
  const row = db.prepare('SELECT id FROM news WHERE url = ?').get(url);
  return !!row;
}

function markAsSeen(url, title) {
  db.prepare('INSERT OR IGNORE INTO news (url, title) VALUES (?, ?)').run(url, title);
}

module.exports = { isAlreadySeen, markAsSeen };