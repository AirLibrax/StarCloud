const db = require('../database');

class ReadingProgress {
  // 获取用户的阅读进度
  static findByUser(userId, callback) {
    db.all(
      `SELECT r.*, b.title, b.author, b.cover_image, b.file_type 
       FROM reading_progress r 
       JOIN books b ON r.book_id = b.id 
       WHERE r.user_id = ? 
       ORDER BY r.last_read DESC`,
      [userId],
      callback
    );
  }

  // 获取用户对特定书籍的阅读进度
  static findByUserAndBook(userId, bookId, callback) {
    db.get(
      'SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?',
      [userId, bookId],
      callback
    );
  }

  // 更新阅读进度
  static update(userId, bookId, progressData, callback) {
    const { current_page, total_pages, progress_percentage } = progressData;
    
    db.run(
      `INSERT INTO reading_progress (user_id, book_id, current_page, total_pages, progress_percentage) 
       VALUES (?, ?, ?, ?, ?) 
       ON CONFLICT(user_id, book_id) 
       DO UPDATE SET 
         current_page = ?, 
         total_pages = ?, 
         progress_percentage = ?, 
         last_read = CURRENT_TIMESTAMP`,
      [
        userId, bookId, current_page, total_pages, progress_percentage,
        current_page, total_pages, progress_percentage
      ],
      function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, { changes: this.changes });
        }
      }
    );
  }

  // 删除阅读进度
  static delete(userId, bookId, callback) {
    db.run(
      'DELETE FROM reading_progress WHERE user_id = ? AND book_id = ?',
      [userId, bookId],
      callback
    );
  }

  // 获取用户的阅读统计
  static getStats(userId, callback) {
    db.get(
      `SELECT 
         COUNT(*) as total_books,
         SUM(progress_percentage) as total_progress,
         AVG(progress_percentage) as avg_progress
       FROM reading_progress 
       WHERE user_id = ?`,
      [userId],
      callback
    );
  }
}

module.exports = ReadingProgress;