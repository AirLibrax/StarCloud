const User = require('../models/User');

// 认证中间件
function requireAuth(req, res, next) {
  const token = req.headers.authorization || req.query.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  // 移除Bearer前缀（如果存在）
  const authToken = token.replace('Bearer ', '');
  
  User.verifyAccessToken(authToken, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  });
}

// 管理员权限检查中间件
function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin === 1) {
    next();
  } else {
    res.status(403).json({ error: 'Admin privileges required' });
  }
}

module.exports = { requireAuth, requireAdmin };