const router = require('express').Router();
const { Op } = require('sequelize');
const { Item, User, Category } = require('../models');
const { auth } = require('../middleware/auth');
const { estimateValue } = require('../services/aiValuation');

// 违禁品关键词
const BANNED_KEYWORDS = ['刀具', '军火', '毒品', '枪支', '弹药', '炸药', '管制刀具', '仿真枪'];

function checkBanned(text) {
  return BANNED_KEYWORDS.some(k => text.includes(k));
}

// 获取商品列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 12, category_id, item_type, keyword, is_auction, sort = 'newest' } = req.query;
    const where = { status: 'active' };

    if (category_id) where.category_id = category_id;
    if (item_type) where.item_type = item_type;
    if (is_auction === '1') where.is_auction = true;
    if (keyword) where.title = { [Op.like]: `%${keyword}%` };

    const order = sort === 'views' ? [['view_count', 'DESC']] :
                  sort === 'value_asc' ? [['estimated_value', 'ASC']] :
                  sort === 'value_desc' ? [['estimated_value', 'DESC']] :
                  [['created_at', 'DESC']];

    const { count, rows } = await Item.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ['id', 'nickname', 'avatar'] },
        { model: Category, attributes: ['id', 'name'] }
      ],
      order,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize)
    });

    res.json({ code: 200, data: { list: rows, total: count, page: parseInt(page), pageSize: parseInt(pageSize) } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 获取商品详情
router.get('/:id', async (req, res) => {
  try {
    const item = await Item.findByPk(req.params.id, {
      include: [
        { model: User, attributes: ['id', 'nickname', 'avatar', 'is_verified'] },
        { model: Category, attributes: ['id', 'name'] }
      ]
    });
    if (!item) return res.status(404).json({ code: 404, message: '商品不存在' });

    await item.increment('view_count');
    res.json({ code: 200, data: item });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 发布商品
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, images, category_id, item_type, condition_level, exchange_for, is_auction, auction_end_time } = req.body;

    if (!title) return res.status(400).json({ code: 400, message: '标题不能为空' });
    if (checkBanned(title + (description || ''))) return res.status(400).json({ code: 400, message: '包含违禁品关键词，禁止发布' });

    // AI智能估值（含RAG检索 + LLM推理 + 规则引擎融合）
    const valuation = await estimateValue(title, description || '', item_type || 'goods', condition_level || 'good');

    const item = await Item.create({
      user_id: req.user.id,
      title, description, images: images || [],
      category_id, item_type: item_type || 'goods',
      condition_level: condition_level || 'good',
      estimated_value: valuation.estimated_value,
      exchange_for: exchange_for || '',
      is_auction: is_auction || false,
      auction_end_time
    });

    res.json({ code: 200, data: { item, valuation } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 更新商品
router.put('/:id', auth, async (req, res) => {
  try {
    const item = await Item.findByPk(req.params.id);
    if (!item) return res.status(404).json({ code: 404, message: '商品不存在' });
    if (item.user_id !== req.user.id) return res.status(403).json({ code: 403, message: '无权操作' });

    const { title, description, images, category_id, item_type, condition_level, exchange_for, status } = req.body;
    if (title && checkBanned(title + (description || ''))) return res.status(400).json({ code: 400, message: '包含违禁品关键词' });

    await item.update({ title, description, images, category_id, item_type, condition_level, exchange_for, status });
    res.json({ code: 200, data: item });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 删除商品（下架）
router.delete('/:id', auth, async (req, res) => {
  try {
    const item = await Item.findByPk(req.params.id);
    if (!item) return res.status(404).json({ code: 404, message: '商品不存在' });
    if (item.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ code: 403, message: '无权操作' });

    await item.update({ status: 'offline' });
    res.json({ code: 200, message: '已下架' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// AI智能估值接口（通过WebSocket桥接调用本地AI引擎）
router.post('/estimate', auth, async (req, res) => {
  try {
    const { title, description, item_type, condition_level } = req.body;

    // 优先通过 WebSocket 桥接调用远程 AI 引擎
    if (req.app.locals.isAiConnected()) {
      const result = await req.app.locals.callAiEngine({
        type: 'estimate',
        title: title || '', description: description || '',
        item_type: item_type || 'goods', condition: condition_level || 'good',
      });
      return res.json({ code: 200, data: result });
    }

    // Fallback: 本地规则引擎
    const result = await estimateValue(title || '', description || '', item_type || 'goods', condition_level || 'good');
    res.json({ code: 200, data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: '估值服务异常: ' + err.message });
  }
});

// AI图片估值接口（通过WebSocket桥接）
router.post('/estimate/image', auth, async (req, res) => {
  try {
    const { image, text, item_type, condition_level } = req.body;
    if (!image) return res.status(400).json({ code: 400, message: '请提供商品图片(base64)' });

    // 优先通过 WebSocket 桥接
    if (req.app.locals.isAiConnected()) {
      const result = await req.app.locals.callAiEngine({
        type: 'estimate_image',
        image, text: text || '',
        item_type: item_type || 'secondhand', condition: condition_level || 'good',
      }, 60000);
      return res.json({ code: 200, data: result });
    }

    // Fallback: 直接调用本地AI引擎HTTP
    const axios = require('axios');
    const LLM_URL = process.env.LLM_API_URL || 'http://localhost:8000';
    const apiUrl = LLM_URL.replace('/v1/chat/completions', '') + '/estimate/image';
    const response = await axios.post(apiUrl, {
      image, text: text || '', item_type: item_type || 'secondhand', condition: condition_level || 'good',
    }, { timeout: 60000 });
    res.json({ code: 200, data: response.data });
  } catch (err) {
    res.status(500).json({ code: 500, message: '估值服务异常: ' + (err.response?.data?.error || err.message) });
  }
});

// 我的商品
router.get('/user/mine', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const where = { user_id: req.user.id };
    if (status) where.status = status;

    const items = await Item.findAll({ where, include: [{ model: Category, attributes: ['id', 'name'] }], order: [['created_at', 'DESC']] });
    res.json({ code: 200, data: items });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
