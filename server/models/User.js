const db = require('../database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class User {
  // 根据用户名查找用户
  static findByUsername(username, callback) {
    db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], callback);
  }

  // 根据ID查找用户
  static findById(id, callback) {
    db.get('SELECT id, username, created_at, is_admin FROM users WHERE id = ? AND is_active = 1', [id], callback);
  }

  // 验证用户密码
  static verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compareSync(plainPassword, hashedPassword);
  }

  // 创建新用户（仅限管理员使用）
  static create(userData, callback) {
    const { username, password, isAdmin } = userData;
    
    // 检查用户名是否已存在
    db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        return callback(err);
      }
      
      if (row) {
        return callback(new Error('Username already exists'));
      }
      
      const passwordHash = bcrypt.hashSync(password, 10);
      
      db.run(
        'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
        [username, passwordHash, isAdmin ? 1 : 0],
        function(err) {
          if (err) {
            callback(err);
          } else {
            callback(null, { 
              id: this.lastID, 
              username, 
              isAdmin: isAdmin ? 1 : 0 
            });
          }
        }
      );
    });
  }

  // 获取所有用户（仅限管理员使用）
  static findAll(callback) {
    db.all('SELECT id, username, created_at, is_admin, is_active FROM users ORDER BY username', callback);
  }

  // 更新用户信息
  static update(id, userData, callback) {
    const { username, isAdmin, isActive } = userData;
    
    db.run(
      'UPDATE users SET username = ?, is_admin = ?, is_active = ? WHERE id = ?',
      [username, isAdmin ? 1 : 0, isActive ? 1 : 0, id],
      function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, { changes: this.changes });
        }
      }
    );
  }

  // 更改用户密码
  static changePassword(id, newPassword, callback) {
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    
    db.run(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, id],
      function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, { changes: this.changes });
        }
      }
    );
  }

  // 删除用户（软删除）
  static delete(id, callback) {
    db.run('UPDATE users SET is_active = 0 WHERE id = ?', [id], callback);
  }

  // 创建访问令牌
  static createAccessToken(userId, callback) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天后过期
    
    db.run(
      'INSERT INTO access_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, token, expiresAt.toISOString()],
      function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, { 
            token, 
            expiresAt 
          });
        }
      }
    );
  }

  // 验证访问令牌
  static verifyAccessToken(token, callback) {
    db.get(
      `SELECT u.id, u.username, u.is_admin 
       FROM access_tokens at 
       JOIN users u ON at.user_id = u.id 
       WHERE at.token = ? AND at.expires_at > datetime('now') AND u.is_active = 1`,
      [token],
      callback
    );
  }

  // 删除访问令牌
  static deleteAccessToken(token, callback) {
    db.run('DELETE FROM access_tokens WHERE token = ?', [token], callback);
  }
}

module.exports = User;