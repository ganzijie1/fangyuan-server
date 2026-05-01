const router = require('express').Router();
const { User, Item } = require('../models');
const { auth } = require('../middleware/auth');

// 更新用户资料
router.put('/profile', auth, async (req, res) => {
  try {
    const { nickname, avatar } = req.body;
    await req.user.update({ nickname, avatar });
    res.json({ code: 200, data: req.user });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 查看其他用户
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: ['id', 'nickname', 'avatar', 'is_verified', 'created_at']
    });
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });

    const itemCount = await Item.count({ where: { user_id: req.params.id, status: 'active' } });
    res.json({ code: 200, data: { ...user.toJSON(), itemCount } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 积分明细（简化版）
router.get('/points/balance', auth, async (req, res) => {
  res.json({ code: 200, data: { points: req.user.points } });
});

module.exports = router;
