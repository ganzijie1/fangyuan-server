const router = require('express').Router();
const { Category } = require('../models');

// 获取分类树
router.get('/', async (req, res) => {
  try {
    const categories = await Category.findAll({
      where: { parent_id: null },
      include: [{ model: Category, as: 'children' }],
      order: [['sort_order', 'ASC'], [{ model: Category, as: 'children' }, 'sort_order', 'ASC']]
    });
    res.json({ code: 200, data: categories });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

module.exports = router;
