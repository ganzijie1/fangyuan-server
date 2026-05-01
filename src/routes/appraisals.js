const router = require('express').Router();
const { Appraisal, Item, User } = require('../models');
const { auth } = require('../middleware/auth');
const { estimateValue } = require('../services/aiValuation');

// 提交鉴定请求
router.post('/', auth, async (req, res) => {
  try {
    const { item_id } = req.body;
    const item = await Item.findByPk(item_id);
    if (!item) return res.status(404).json({ code: 404, message: '商品不存在' });

    const existing = await Appraisal.findOne({ where: { item_id, status: ['pending', 'in_progress'] } });
    if (existing) return res.status(400).json({ code: 400, message: '该商品已有鉴定申请' });

    const appraisal = await Appraisal.create({ item_id, requester_id: req.user.id });
    res.json({ code: 200, data: appraisal });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 获取鉴定列表
router.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};

    if (req.user.role === 'appraiser') {
      // 鉴定师看所有待鉴定
      if (status) where.status = status;
    } else {
      where.requester_id = req.user.id;
      if (status) where.status = status;
    }

    const list = await Appraisal.findAll({
      where,
      include: [
        { model: Item, attributes: ['id', 'title', 'images', 'description', 'item_type', 'condition_level'] },
        { model: User, as: 'requester', attributes: ['id', 'nickname'] },
        { model: User, as: 'appraiser', attributes: ['id', 'nickname'] }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json({ code: 200, data: list });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 鉴定师完成鉴定
router.put('/:id/complete', auth, async (req, res) => {
  try {
    if (req.user.role !== 'appraiser' && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无鉴定师权限' });
    }

    const appraisal = await Appraisal.findByPk(req.params.id, { include: [{ model: Item }] });
    if (!appraisal) return res.status(404).json({ code: 404, message: '鉴定记录不存在' });

    const { result, report } = req.body;

    // AI辅助估值
    const item = appraisal.Item;
    const valuation = estimateValue(item.title, item.description || '', item.item_type, item.condition_level);

    await appraisal.update({
      status: 'completed',
      appraiser_id: req.user.id,
      result,
      estimated_value: valuation.estimated_value,
      report: report || `鉴定结果：${result === 'authentic' ? '正品' : result === 'fake' ? '假货' : '待定'}。AI参考估值：${valuation.estimated_value}元。${report || ''}`
    });

    // 更新商品估值
    await item.update({ estimated_value: valuation.estimated_value });

    res.json({ code: 200, data: appraisal });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
