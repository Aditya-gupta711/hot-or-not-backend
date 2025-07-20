const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads folder exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Database
const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    url TEXT,
    total_votes INTEGER DEFAULT 0,
    hot_votes INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER,
    value TEXT CHECK(value IN ('hot', 'not')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Image Upload
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Upload Route
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const url = `/uploads/${req.file.filename}`;
  db.run('INSERT INTO images (filename, url) VALUES (?, ?)', [req.file.filename, url], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, url });
  });
});

// Get all images
app.get('/api/images', (req, res) => {
  db.all('SELECT * FROM images ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    rows.forEach(row => {
      row.rating = row.total_votes ? (row.hot_votes / row.total_votes).toFixed(2) : null;
    });
    res.json(rows);
  });
});

// Vote Route
app.post('/api/vote/:id', (req, res) => {
  const imageId = req.params.id;
  const vote = req.body.vote;

  if (!['hot', 'not'].includes(vote)) return res.status(400).json({ error: 'Invalid vote type' });

  const isHot = vote === 'hot' ? 1 : 0;

  db.serialize(() => {
    db.run('INSERT INTO votes (image_id, value) VALUES (?, ?)', [imageId, vote]);
    db.run(
      'UPDATE images SET total_votes = total_votes + 1, hot_votes = hot_votes + ? WHERE id = ?',
      [isHot, imageId],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  });
});

// 🆕 Top 5 Route
app.get('/api/top5', (req, res) => {
  db.all(`
    SELECT id, url, total_votes, hot_votes,
           ROUND(CAST(hot_votes AS FLOAT) / total_votes, 2) AS score
    FROM images
    WHERE total_votes > 0
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const sorted = [...rows].sort((a, b) => b.score - a.score);
    const topHot = sorted.slice(0, 5);
    const topNot = sorted.slice(-5).reverse();

    res.json({ hot: topHot, not: topNot });
  });
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));

