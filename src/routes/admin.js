const router = require('express').Router();
const { User, Item, Trade, Appraisal } = require('../models');
const { adminAuth } = require('../middleware/auth');

// 统计数据
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [userCount, itemCount, tradeCount, completedTrades] = await Promise.all([
      User.count(),
      Item.count(),
      Trade.count(),
      Trade.count({ where: { status: 'completed' } })
    ]);
    res.json({ code: 200, data: { userCount, itemCount, tradeCount, completedTrades } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 用户列表
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const { count, rows } = await User.findAndCountAll({
      attributes: { exclude: ['password_hash'] },
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['created_at', 'DESC']]
    });
    res.json({ code: 200, data: { list: rows, total: count } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 商品审核列表
router.get('/items', adminAuth, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, status } = req.query;
    const where = {};
    if (status) where.status = status;

    const { count, rows } = await Item.findAndCountAll({
      where,
      include: [{ model: User, attributes: ['id', 'nickname'] }],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['created_at', 'DESC']]
    });
    res.json({ code: 200, data: { list: rows, total: count } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 下架商品
router.put('/items/:id/offline', adminAuth, async (req, res) => {
  await Item.update({ status: 'offline' }, { where: { id: req.params.id } });
  res.json({ code: 200, message: '已下架' });
});

// 设置用户角色
router.put('/users/:id/role', adminAuth, async (req, res) => {
  const { role } = req.body;
  await User.update({ role }, { where: { id: req.params.id } });
  res.json({ code: 200, message: '角色已更新' });
});

module.exports = router;
