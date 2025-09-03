require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// 初始化数据库
require('./database');

// 导入路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const bookRoutes = require('./routes/books');
const progressRoutes = require('./routes/progress');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保上传目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 中间件
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务
app.use('/uploads', express.static(uploadsDir));

// 提供 web-admin 静态文件服务
const webAdminPath = path.join(__dirname, '../web-admin');
if (fs.existsSync(webAdminPath)) {
  app.use('/web-admin', express.static(webAdminPath));
  console.log('Web admin static files served from:', webAdminPath);
} else {
  console.warn('Web admin directory not found:', webAdminPath);
}

//配置静态文件
app.use('/web-admin', express.static(path.join(__dirname, '../web-admin')));

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/progress', progressRoutes);

// 根路径重定向到 web-admin
app.get('/', (req, res) => {
  res.redirect('/web-admin/login.html');
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  
  if (err.message === 'Invalid file type') {
    return res.status(415).json({ error: 'Invalid file type' });
  }
  
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Web admin: http://localhost:${PORT}/web-admin/login.html`);
});