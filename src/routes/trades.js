const router = require('express').Router();
const { Op } = require('sequelize');
const { Trade, Item, User, Message } = require('../models');
const { auth, verifiedAuth } = require('../middleware/auth');

// 发起交易
router.post('/', verifiedAuth, async (req, res) => {
  try {
    const { receiver_item_id, initiator_item_id, remark, points_diff } = req.body;

    const receiverItem = await Item.findByPk(receiver_item_id);
    if (!receiverItem || receiverItem.status !== 'active') return res.status(400).json({ code: 400, message: '目标商品不可交易' });
    if (receiverItem.user_id === req.user.id) return res.status(400).json({ code: 400, message: '不能与自己交易' });

    const initiatorItem = await Item.findByPk(initiator_item_id);
    if (!initiatorItem || initiatorItem.user_id !== req.user.id) return res.status(400).json({ code: 400, message: '请选择您自己的商品' });
    if (initiatorItem.status !== 'active') return res.status(400).json({ code: 400, message: '您的商品不可用于交易' });

    // 高价值商品确认
    const totalValue = (parseFloat(receiverItem.estimated_value) + parseFloat(initiatorItem.estimated_value)) / 2;
    const needConfirm = totalValue >= 1000;

    // 积分补差检查
    if (points_diff && points_diff > 0 && req.user.points < points_diff) {
      return res.status(400).json({ code: 400, message: '积分不足' });
    }

    const trade = await Trade.create({
      initiator_id: req.user.id,
      receiver_id: receiverItem.user_id,
      initiator_item_id,
      receiver_item_id,
      points_diff: points_diff || 0,
      remark
    });

    // 更新商品状态
    await initiatorItem.update({ status: 'in_trade' });
    await receiverItem.update({ status: 'in_trade' });

    // 发送通知
    await Message.create({
      from_user_id: req.user.id,
      to_user_id: receiverItem.user_id,
      content: `${req.user.nickname} 想用「${initiatorItem.title}」交换您的「${receiverItem.title}」`,
      msg_type: 'trade',
      related_trade_id: trade.id
    });

    res.json({ code: 200, data: { trade, needConfirm } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 获取我的交易列表
router.get('/mine', auth, async (req, res) => {
  try {
    const { status, role } = req.query;
    const where = {};

    if (role === 'initiator') {
      where.initiator_id = req.user.id;
    } else if (role === 'receiver') {
      where.receiver_id = req.user.id;
    } else {
      where[Op.or] = [{ initiator_id: req.user.id }, { receiver_id: req.user.id }];
    }

    if (status) where.status = status;

    const trades = await Trade.findAll({
      where,
      include: [
        { model: User, as: 'initiator', attributes: ['id', 'nickname', 'avatar'] },
        { model: User, as: 'receiver', attributes: ['id', 'nickname', 'avatar'] },
        { model: Item, as: 'initiatorItem', attributes: ['id', 'title', 'images', 'estimated_value'] },
        { model: Item, as: 'receiverItem', attributes: ['id', 'title', 'images', 'estimated_value'] }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json({ code: 200, data: trades });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 接受交易
router.put('/:id/accept', auth, async (req, res) => {
  try {
    const trade = await Trade.findByPk(req.params.id);
    if (!trade) return res.status(404).json({ code: 404, message: '交易不存在' });
    if (trade.receiver_id !== req.user.id) return res.status(403).json({ code: 403, message: '无权操作' });
    if (trade.status !== 'pending') return res.status(400).json({ code: 400, message: '交易状态不允许此操作' });

    await trade.update({ status: 'accepted' });

    await Message.create({
      from_user_id: req.user.id,
      to_user_id: trade.initiator_id,
      content: '对方已同意您的交换请求，请安排发货',
      msg_type: 'trade',
      related_trade_id: trade.id
    });

    res.json({ code: 200, data: trade });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 拒绝交易
router.put('/:id/reject', auth, async (req, res) => {
  try {
    const trade = await Trade.findByPk(req.params.id);
    if (!trade) return res.status(404).json({ code: 404, message: '交易不存在' });
    if (trade.receiver_id !== req.user.id) return res.status(403).json({ code: 403, message: '无权操作' });

    await trade.update({ status: 'cancelled' });

    // 恢复商品状态
    await Item.update({ status: 'active' }, { where: { id: [trade.initiator_item_id, trade.receiver_item_id] } });

    await Message.create({
      from_user_id: req.user.id,
      to_user_id: trade.initiator_id,
      content: '对方拒绝了您的交换请求',
      msg_type: 'trade',
      related_trade_id: trade.id
    });

    res.json({ code: 200, message: '已拒绝' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 确认收货
router.put('/:id/confirm', auth, async (req, res) => {
  try {
    const trade = await Trade.findByPk(req.params.id);
    if (!trade) return res.status(404).json({ code: 404, message: '交易不存在' });

    const isInitiator = trade.initiator_id === req.user.id;
    const isReceiver = trade.receiver_id === req.user.id;
    if (!isInitiator && !isReceiver) return res.status(403).json({ code: 403, message: '无权操作' });

    if (isInitiator) await trade.update({ initiator_confirmed: true });
    if (isReceiver) await trade.update({ receiver_confirmed: true });

    // 双方都确认则完成交易
    const updated = await Trade.findByPk(trade.id);
    if (updated.initiator_confirmed && updated.receiver_confirmed) {
      await updated.update({ status: 'completed' });
      await Item.update({ status: 'completed' }, { where: { id: [trade.initiator_item_id, trade.receiver_item_id] } });

      // 积分结算
      if (trade.points_diff > 0) {
        const initiator = await User.findByPk(trade.initiator_id);
        const receiver = await User.findByPk(trade.receiver_id);
        await initiator.update({ points: initiator.points - trade.points_diff });
        await receiver.update({ points: receiver.points + trade.points_diff });
      }

      // 交易完成奖励积分
      await User.increment('points', { by: 10, where: { id: [trade.initiator_id, trade.receiver_id] } });
    }

    res.json({ code: 200, message: '确认成功', data: updated });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 取消交易
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const trade = await Trade.findByPk(req.params.id);
    if (!trade) return res.status(404).json({ code: 404, message: '交易不存在' });
    if (trade.initiator_id !== req.user.id && trade.receiver_id !== req.user.id) return res.status(403).json({ code: 403, message: '无权操作' });
    if (['completed', 'cancelled'].includes(trade.status)) return res.status(400).json({ code: 400, message: '交易已结束' });

    await trade.update({ status: 'cancelled' });
    await Item.update({ status: 'active' }, { where: { id: [trade.initiator_item_id, trade.receiver_item_id].filter(Boolean) } });

    res.json({ code: 200, message: '交易已取消' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
