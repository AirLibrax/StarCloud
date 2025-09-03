const User = require('../models/User');

const userController = {
  // 获取所有用户（仅管理员）
  getAllUsers: (req, res) => {
    User.findAll((err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(users);
    });
  },
  
  // 创建新用户（仅管理员）
  createUser: (req, res) => {
    const { username, password, isAdmin } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    User.create({ username, password, isAdmin }, (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message || 'Failed to create user' });
      }
      
      res.status(201).json(user);
    });
  },
  
  // 更新用户信息（仅管理员）
  updateUser: (req, res) => {
    const userId = req.params.id;
    const { username, isAdmin, isActive } = req.body;
    
    User.update(userId, { username, isAdmin, isActive }, (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update user' });
      }
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json({ message: 'User updated successfully' });
    });
  },
  
  // 删除用户（仅管理员）
  deleteUser: (req, res) => {
    const userId = req.params.id;
    
    User.delete(userId, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete user' });
      }
      
      res.json({ message: 'User deleted successfully' });
    });
  },
  
  // 获取当前用户信息
  getCurrentUser: (req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      isAdmin: req.user.is_admin === 1
    });
  }
};

module.exports = userController;