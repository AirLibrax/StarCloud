const express = require('express');
const progressController = require('../controllers/progressController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 获取用户的阅读进度
router.get('/', requireAuth, progressController.getUserProgress);

// 更新阅读进度
router.post('/:bookId', requireAuth, progressController.updateProgress);

// 获取特定书籍的阅读进度
router.get('/:bookId', requireAuth, progressController.getBookProgress);

// 删除阅读进度
router.delete('/:bookId', requireAuth, progressController.deleteProgress);

// 获取阅读统计
router.get('/stats/summary', requireAuth, progressController.getStats);

module.exports = router;