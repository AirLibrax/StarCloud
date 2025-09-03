const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// 数据库文件路径
const dbPath = path.resolve(__dirname, 'library.db');

// 确保数据库目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// 初始化数据库表
function initializeDatabase() {
  // 创建用户表
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  )`, (err) => {
    if (err) {
      console.error('Error creating users table', err);
    } else {
      console.log('Users table ready');
      createDefaultAdmin();
    }
  });

  // 创建书籍表
  db.run(`CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    description TEXT,
    cover_image TEXT,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    uploader_id INTEGER,
    FOREIGN KEY (uploader_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating books table', err);
    } else {
      console.log('Books table ready');
    }
  });

  // 创建阅读进度表
  db.run(`CREATE TABLE IF NOT EXISTS reading_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    progress_percentage REAL DEFAULT 0,
    last_read DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (book_id) REFERENCES books (id),
    UNIQUE(user_id, book_id)
  )`, (err) => {
    if (err) {
      console.error('Error creating reading_progress table', err);
    } else {
      console.log('Reading progress table ready');
    }
  });

  // 创建用户访问令牌表
  db.run(`CREATE TABLE IF NOT EXISTS access_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating access_tokens table', err);
    } else {
      console.log('Access tokens table ready');
    }
  });
}

// 创建默认管理员账户
function createDefaultAdmin() {
  const defaultUsername = '宫时玄';
  const defaultPassword = '17890';
  
  // 检查是否已存在管理员账户
  db.get('SELECT id FROM users WHERE username = ?', [defaultUsername], (err, row) => {
    if (err) {
      console.error('Error checking for default admin', err);
      return;
    }
    
    if (!row) {
      // 哈希密码
      const passwordHash = bcrypt.hashSync(defaultPassword, 10);
      
      // 插入默认管理员账户
      db.run('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)', 
        [defaultUsername, passwordHash], 
        function(err) {
          if (err) {
            console.error('Error creating default admin', err);
          } else {
            console.log('Default admin account created:');
            console.log('Username: 宫时玄');
            console.log('Password: 17890');
            console.log('Please change this password after first login!');
          }
        }
      );
    }
  });
}

// 关闭数据库连接
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});

module.exports = db;