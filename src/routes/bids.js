const router = require('express').Router();
const { Bid, Item, User, Trade, Message } = require('../models');
const { auth, verifiedAuth } = require('../middleware/auth');

// 对某个竞拍商品出价
router.post('/', verifiedAuth, async (req, res) => {
  try {
    const { item_id, bid_item_id, message, points_offer } = req.body;

    const targetItem = await Item.findByPk(item_id);
    if (!targetItem || !targetItem.is_auction || targetItem.status !== 'active') {
      return res.status(400).json({ code: 400, message: '该商品不在竞拍中' });
    }
    if (targetItem.user_id === req.user.id) return res.status(400).json({ code: 400, message: '不能对自己的商品出价' });

    if (targetItem.auction_end_time && new Date(targetItem.auction_end_time) < new Date()) {
      return res.status(400).json({ code: 400, message: '竞拍已结束' });
    }

    const bidItem = await Item.findByPk(bid_item_id);
    if (!bidItem || bidItem.user_id !== req.user.id || bidItem.status !== 'active') {
      return res.status(400).json({ code: 400, message: '请选择有效的商品出价' });
    }

    const bid = await Bid.create({ item_id, bidder_id: req.user.id, bid_item_id, message, points_offer: points_offer || 0 });

    await Message.create({
      from_user_id: req.user.id,
      to_user_id: targetItem.user_id,
      content: `${req.user.nickname} 用「${bidItem.title}」对您的「${targetItem.title}」出价竞拍`,
      msg_type: 'trade'
    });

    res.json({ code: 200, data: bid });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 获取某个商品的所有出价
router.get('/item/:itemId', async (req, res) => {
  try {
    const bids = await Bid.findAll({
      where: { item_id: req.params.itemId, status: 'active' },
      include: [
        { model: User, as: 'bidder', attributes: ['id', 'nickname', 'avatar'] },
        { model: Item, as: 'bidItem', attributes: ['id', 'title', 'images', 'estimated_value'] }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json({ code: 200, data: bids });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 接受某个出价（创建交易）
router.put('/:id/accept', auth, async (req, res) => {
  try {
    const bid = await Bid.findByPk(req.params.id, { include: [{ model: Item, as: 'targetItem' }] });
    if (!bid) return res.status(404).json({ code: 404, message: '出价不存在' });
    if (bid.targetItem.user_id !== req.user.id) return res.status(403).json({ code: 403, message: '无权操作' });

    await bid.update({ status: 'accepted' });

    // 拒绝其他出价
    await Bid.update({ status: 'rejected' }, { where: { item_id: bid.item_id, id: { [require('sequelize').Op.ne]: bid.id } } });

    // 创建交易
    const trade = await Trade.create({
      initiator_id: bid.bidder_id,
      receiver_id: req.user.id,
      initiator_item_id: bid.bid_item_id,
      receiver_item_id: bid.item_id,
      points_diff: bid.points_offer,
      status: 'accepted'
    });

    await Item.update({ status: 'in_trade' }, { where: { id: [bid.bid_item_id, bid.item_id] } });

    await Message.create({
      from_user_id: req.user.id,
      to_user_id: bid.bidder_id,
      content: '恭喜！您的竞拍出价已被接受，请安排交换',
      msg_type: 'trade',
      related_trade_id: trade.id
    });

    res.json({ code: 200, data: { bid, trade } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 我的出价
router.get('/mine', auth, async (req, res) => {
  try {
    const bids = await Bid.findAll({
      where: { bidder_id: req.user.id },
      include: [
        { model: Item, as: 'targetItem', attributes: ['id', 'title', 'images', 'estimated_value'] },
        { model: Item, as: 'bidItem', attributes: ['id', 'title', 'images', 'estimated_value'] }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json({ code: 200, data: bids });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
