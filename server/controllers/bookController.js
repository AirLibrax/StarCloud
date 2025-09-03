const Book = require('../models/Book');
const path = require('path');
const fs = require('fs');

const bookController = {
  // 获取所有书籍
  getAllBooks: (req, res) => {
    Book.findAll((err, books) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(books);
    });
  },
  
  // 获取特定书籍
  getBook: (req, res) => {
    const bookId = req.params.id;
    
    Book.findById(bookId, (err, book) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      
      res.json(book);
    });
  },
  
  // 上传新书
  createBook: (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Book file is required' });
    }
    
    const { title, author, description, fileType } = req.body;
    
    if (!title || !fileType) {
      // 删除已上传的文件
      if (req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Title and file type are required' });
    }
    
    const bookData = {
      title,
      author: author || '',
      description: description || '',
      cover_image: req.body.cover_image || '',
      file_path: req.file.path,
      file_type: fileType,
      file_size: req.file.size,
      uploader_id: req.user.id
    };
    
    Book.create(bookData, (err, book) => {
      if (err) {
        // 删除已上传的文件
        if (req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(500).json({ error: 'Failed to create book' });
      }
      
      res.status(201).json(book);
    });
  },
  
  // 更新书籍信息
  updateBook: (req, res) => {
    const bookId = req.params.id;
    const { title, author, description, cover_image } = req.body;
    
    Book.update(bookId, { title, author, description, cover_image }, (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update book' });
      }
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Book not found' });
      }
      
      res.json({ message: 'Book updated successfully' });
    });
  },
  
  // 删除书籍
  deleteBook: (req, res) => {
    const bookId = req.params.id;
    
    Book.delete(bookId, (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete book' });
      }
      
      res.json({ message: 'Book deleted successfully' });
    });
  },
  
  // 搜索书籍
  searchBooks: (req, res) => {
    const query = req.query.q;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    Book.search(query, (err, books) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(books);
    });
  },
  
  // 获取最新书籍
  getRecentBooks: (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    
    Book.getRecent(limit, (err, books) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(books);
    });
  },
  
  // 下载书籍文件
  downloadBook: (req, res) => {
    const bookId = req.params.id;
    
    Book.findById(bookId, (err, book) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      
      const filePath = path.resolve(book.file_path);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Book file not found' });
      }
      
      // 设置适当的Content-Type和Content-Disposition头
      const filename = `${book.title}${path.extname(book.file_path)}`;
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      
      // 根据文件类型设置Content-Type
      let contentType = 'application/octet-stream';
      if (book.file_type === 'pdf') {
        contentType = 'application/pdf';
      } else if (book.file_type === 'epub') {
        contentType = 'application/epub+zip';
      } else if (book.file_type === 'txt') {
        contentType = 'text/plain';
      }
      
      res.setHeader('Content-Type', contentType);
      
      // 发送文件
      res.sendFile(filePath);
    });
  }
};

module.exports = bookController;