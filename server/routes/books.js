const express = require('express');
const bookController = require('../controllers/bookController');
const upload = require('../middleware/upload');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 获取所有书籍
router.get('/', requireAuth, bookController.getAllBooks);

// 获取特定书籍
router.get('/:id', requireAuth, bookController.getBook);

// 上传新书（需要管理员权限）
router.post('/', requireAuth, requireAdmin, upload.single('bookFile'), bookController.createBook);

// 更新书籍信息（需要管理员权限）
router.put('/:id', requireAuth, requireAdmin, bookController.updateBook);

// 删除书籍（需要管理员权限）
router.delete('/:id', requireAuth, requireAdmin, bookController.deleteBook);

// 搜索书籍
router.get('/search', requireAuth, bookController.searchBooks);

// 获取最新书籍
router.get('/recent/new', requireAuth, bookController.getRecentBooks);

// 下载书籍文件
router.get('/:id/download', requireAuth, bookController.downloadBook);

module.exports = router;