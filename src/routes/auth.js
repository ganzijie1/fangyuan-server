const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { auth } = require('../middleware/auth');

// 注册
router.post('/register', async (req, res) => {
  try {
    const { phone, password, nickname } = req.body;
    if (!phone || !password) return res.status(400).json({ code: 400, message: '手机号和密码不能为空' });

    const exists = await User.findOne({ where: { phone } });
    if (exists) return res.status(400).json({ code: 400, message: '该手机号已注册' });

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ phone, password_hash, nickname: nickname || `用户${phone.slice(-4)}` });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ code: 200, data: { token, user: { id: user.id, phone, nickname: user.nickname, points: user.points, role: user.role } } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ where: { phone } });
    if (!user) return res.status(400).json({ code: 400, message: '手机号未注册' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ code: 400, message: '密码错误' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ code: 200, data: { token, user: { id: user.id, phone: user.phone, nickname: user.nickname, avatar: user.avatar, points: user.points, role: user.role, is_verified: user.is_verified } } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 获取当前用户信息
router.get('/me', auth, async (req, res) => {
  const user = req.user;
  res.json({ code: 200, data: { id: user.id, phone: user.phone, nickname: user.nickname, avatar: user.avatar, real_name: user.real_name, is_verified: user.is_verified, points: user.points, role: user.role, created_at: user.created_at } });
});

// 实名认证
router.post('/verify', auth, async (req, res) => {
  try {
    const { real_name, id_card } = req.body;
    if (!real_name || !id_card) return res.status(400).json({ code: 400, message: '姓名和身份证号不能为空' });
    if (!/^\d{17}[\dX]$/.test(id_card)) return res.status(400).json({ code: 400, message: '身份证号格式不正确' });

    await req.user.update({ real_name, id_card, is_verified: true });
    res.json({ code: 200, message: '实名认证成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
