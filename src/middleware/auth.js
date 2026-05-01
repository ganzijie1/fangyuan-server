const jwt = require('jsonwebtoken');
const { User } = require('../models');

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ code: 401, message: '请先登录' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(401).json({ code: 401, message: '用户不存在' });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ code: 401, message: 'token无效或已过期' });
  }
};

const adminAuth = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ code: 403, message: '无管理员权限' });
    }
  });
};

const verifiedAuth = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user && req.user.is_verified) {
      next();
    } else {
      res.status(403).json({ code: 403, message: '请先完成实名认证' });
    }
  });
};

module.exports = { auth, adminAuth, verifiedAuth };
