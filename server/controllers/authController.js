const User = require('../models/User');

const authController = {
  // 用户登录
  login: (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    User.findByUsername(username, (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      if (!User.verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // 创建访问令牌
      User.createAccessToken(user.id, (err, tokenData) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to create access token' });
        }
        
        res.json({
          message: 'Login successful',
          token: tokenData.token,
          expiresAt: tokenData.expiresAt,
          user: {
            id: user.id,
            username: user.username,
            isAdmin: user.is_admin === 1
          }
        });
      });
    });
  },
  
  // 用户登出
  logout: (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      User.deleteAccessToken(token, (err) => {
        if (err) {
          console.error('Error deleting access token:', err);
        }
      });
    }
    
    res.json({ message: 'Logout successful' });
  },
  
  // 验证令牌
  verifyToken: (req, res) => {
    res.json({
      valid: true,
      user: req.user
    });
  },
  
  // 更改密码
  changePassword: (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    // 首先验证当前密码
    User.findById(userId, (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // 获取完整的用户信息以验证密码
      User.findByUsername(user.username, (err, fullUser) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!User.verifyPassword(currentPassword, fullUser.password_hash)) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // 更新密码
        User.changePassword(userId, newPassword, (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to change password' });
          }
          
          res.json({ message: 'Password changed successfully' });
        });
      });
    });
  }
};

module.exports = authController;