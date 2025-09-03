const ReadingProgress = require('../models/ReadingProgress');

const progressController = {
  // 获取用户的阅读进度
  getUserProgress: (req, res) => {
    const userId = req.user.id;
    
    ReadingProgress.findByUser(userId, (err, progress) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(progress);
    });
  },
  
  // 更新阅读进度
  updateProgress: (req, res) => {
    const userId = req.user.id;
    const bookId = req.params.bookId;
    const { current_page, total_pages, progress_percentage } = req.body;
    
    if (current_page === undefined || progress_percentage === undefined) {
      return res.status(400).json({ error: 'Current page and progress percentage are required' });
    }
    
    ReadingProgress.update(userId, bookId, { 
      current_page, 
      total_pages: total_pages || 0, 
      progress_percentage 
    }, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update progress' });
      }
      
      res.json({ message: 'Progress updated successfully' });
    });
  },
  
  // 获取特定书籍的阅读进度
  getBookProgress: (req, res) => {
    const userId = req.user.id;
    const bookId = req.params.bookId;
    
    ReadingProgress.findByUserAndBook(userId, bookId, (err, progress) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!progress) {
        return res.status(404).json({ error: 'Progress not found' });
      }
      
      res.json(progress);
    });
  },
  
  // 删除阅读进度
  deleteProgress: (req, res) => {
    const userId = req.user.id;
    const bookId = req.params.bookId;
    
    ReadingProgress.delete(userId, bookId, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete progress' });
      }
      
      res.json({ message: 'Progress deleted successfully' });
    });
  },
  
  // 获取阅读统计
  getStats: (req, res) => {
    const userId = req.user.id;
    
    ReadingProgress.getStats(userId, (err, stats) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(stats);
    });
  }
};

module.exports = progressController;