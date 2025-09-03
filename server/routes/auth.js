const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 登录
router.post('/login', authController.login);

// 登出
router.post('/logout', requireAuth, authController.logout);

// 验证令牌
router.get('/verify', requireAuth, authController.verifyToken);

// 更改密码
router.post('/change-password', requireAuth, authController.changePassword);

module.exports = router;