const router = require('express').Router();
const { Message, User } = require('../models');
const { auth } = require('../middleware/auth');

// 获取我的消息
router.get('/', auth, async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: { to_user_id: req.user.id },
      include: [{ model: User, as: 'sender', attributes: ['id', 'nickname', 'avatar'] }],
      order: [['created_at', 'DESC']],
      limit: 50
    });
    res.json({ code: 200, data: messages });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 未读消息数
router.get('/unread-count', auth, async (req, res) => {
  const count = await Message.count({ where: { to_user_id: req.user.id, is_read: false } });
  res.json({ code: 200, data: { count } });
});

// 标记已读
router.put('/:id/read', auth, async (req, res) => {
  await Message.update({ is_read: true }, { where: { id: req.params.id, to_user_id: req.user.id } });
  res.json({ code: 200, message: '已读' });
});

// 全部标记已读
router.put('/read-all', auth, async (req, res) => {
  await Message.update({ is_read: true }, { where: { to_user_id: req.user.id, is_read: false } });
  res.json({ code: 200, message: '全部已读' });
});

module.exports = router;
