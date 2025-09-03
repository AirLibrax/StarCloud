const db = require('../database');
const fs = require('fs');
const path = require('path');

class Book {
  // 获取所有书籍
  static findAll(callback) {
    db.all(`
      SELECT b.*, u.username as uploader_name 
      FROM books b 
      LEFT JOIN users u ON b.uploader_id = u.id 
      ORDER BY b.title
    `, callback);
  }

  // 根据ID查找书籍
  static findById(id, callback) {
    db.get(`
      SELECT b.*, u.username as uploader_name 
      FROM books b 
      LEFT JOIN users u ON b.uploader_id = u.id 
      WHERE b.id = ?
    `, [id], callback);
  }

  // 添加新书籍
  static create(bookData, callback) {
    const { title, author, description, cover_image, file_path, file_type, file_size, uploader_id } = bookData;
    
    db.run(
      `INSERT INTO books 
       (title, author, description, cover_image, file_path, file_type, file_size, uploader_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, author, description, cover_image, file_path, file_type, file_size, uploader_id],
      function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, { 
            id: this.lastID, 
            title, 
            author, 
            description, 
            cover_image, 
            file_path, 
            file_type,
            file_size,
            uploader_id
          });
        }
      }
    );
  }

  // 更新书籍信息
  static update(id, bookData, callback) {
    const { title, author, description, cover_image } = bookData;
    
    db.run(
      'UPDATE books SET title = ?, author = ?, description = ?, cover_image = ? WHERE id = ?',
      [title, author, description, cover_image, id],
      function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, { changes: this.changes });
        }
      }
    );
  }

  // 删除书籍
  static delete(id, callback) {
    // 先获取文件路径，以便删除实际文件
    db.get('SELECT file_path FROM books WHERE id = ?', [id], (err, book) => {
      if (err) {
        return callback(err);
      }
      
      if (book && book.file_path) {
        // 删除实际文件
        const filePath = path.resolve(book.file_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      // 删除数据库记录
      db.run('DELETE FROM books WHERE id = ?', [id], (err) => {
        if (err) {
          callback(err);
        } else {
          callback(null, { success: true });
        }
      });
    });
  }

  // 搜索书籍
  static search(query, callback) {
    const searchQuery = `%${query}%`;
    db.all(
      `SELECT b.*, u.username as uploader_name 
       FROM books b 
       LEFT JOIN users u ON b.uploader_id = u.id 
       WHERE b.title LIKE ? OR b.author LIKE ? 
       ORDER BY b.title`,
      [searchQuery, searchQuery],
      callback
    );
  }

  // 获取最新书籍
  static getRecent(limit = 10, callback) {
    db.all(
      `SELECT b.*, u.username as uploader_name 
       FROM books b 
       LEFT JOIN users u ON b.uploader_id = u.id 
       ORDER BY b.upload_date DESC 
       LIMIT ?`,
      [limit],
      callback
    );
  }
}

module.exports = Book;