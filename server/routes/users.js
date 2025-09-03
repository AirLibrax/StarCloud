const express = require('express');
const userController = require('../controllers/userController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 获取所有用户（仅管理员）
router.get('/', requireAuth, requireAdmin, userController.getAllUsers);

// 创建新用户（仅管理员）
router.post('/', requireAuth, requireAdmin, userController.createUser);

// 更新用户信息（仅管理员）
router.put('/:id', requireAuth, requireAdmin, userController.updateUser);

// 删除用户（仅管理员）
router.delete('/:id', requireAuth, requireAdmin, userController.deleteUser);

// 获取当前用户信息
router.get('/me', requireAuth, userController.getCurrentUser);

module.exports = router;