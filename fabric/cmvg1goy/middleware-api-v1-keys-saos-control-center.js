const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Middleware לאימות טוקן JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware לבדיקת תפקיד
const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

// החלת middleware על כל ה-routes בנתיב /api/v1/keys
router.use(authenticateToken);
router.use(authorizeRole(['admin', 'key_manager']));

// Routes קיימים להדגמה
router.post('/', (req, res) => {
  res.status(200).json({ message: 'Key created successfully' });
});

router.get('/', (req, res) => {
  res.status(200).json({ keys: [] });
});

router.delete('/:id', (req, res) => {
  res.status(200).json({ message: 'Key deleted successfully' });
});

module.exports = router;