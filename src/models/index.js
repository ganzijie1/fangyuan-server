const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data.sqlite'),
  logging: false,
});

// User Model
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  phone: { type: DataTypes.STRING(20), unique: true, allowNull: false },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  nickname: { type: DataTypes.STRING(50), defaultValue: '' },
  avatar: { type: DataTypes.STRING(500), defaultValue: '' },
  real_name: { type: DataTypes.STRING(50), defaultValue: '' },
  id_card: { type: DataTypes.STRING(30), defaultValue: '' },
  is_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
  points: { type: DataTypes.INTEGER, defaultValue: 100 },
  role: { type: DataTypes.ENUM('user', 'appraiser', 'admin'), defaultValue: 'user' }
}, { tableName: 'users', underscored: true });

// Category Model
const Category = sequelize.define('Category', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(50), allowNull: false },
  parent_id: { type: DataTypes.INTEGER },
  icon: { type: DataTypes.STRING(50) },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 }
}, { tableName: 'categories', underscored: true, timestamps: false });

// Item Model
const Item = sequelize.define('Item', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT },
  images: { type: DataTypes.JSON, defaultValue: [] },
  category_id: { type: DataTypes.INTEGER },
  item_type: { type: DataTypes.ENUM('goods', 'service', 'expired', 'secondhand'), defaultValue: 'goods' },
  condition_level: { type: DataTypes.ENUM('new', 'like_new', 'good', 'fair', 'poor'), defaultValue: 'good' },
  estimated_value: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  exchange_for: { type: DataTypes.STRING(500), defaultValue: '' },
  status: { type: DataTypes.ENUM('active', 'in_trade', 'completed', 'offline'), defaultValue: 'active' },
  view_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  is_auction: { type: DataTypes.BOOLEAN, defaultValue: false },
  auction_end_time: { type: DataTypes.DATE }
}, { tableName: 'items', underscored: true });

// Trade Model
const Trade = sequelize.define('Trade', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  initiator_id: { type: DataTypes.INTEGER, allowNull: false },
  receiver_id: { type: DataTypes.INTEGER, allowNull: false },
  initiator_item_id: { type: DataTypes.INTEGER, allowNull: false },
  receiver_item_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.ENUM('pending', 'accepted', 'in_progress', 'shipping', 'completed', 'cancelled', 'disputed'), defaultValue: 'pending' },
  points_diff: { type: DataTypes.INTEGER, defaultValue: 0 },
  initiator_confirmed: { type: DataTypes.BOOLEAN, defaultValue: false },
  receiver_confirmed: { type: DataTypes.BOOLEAN, defaultValue: false },
  remark: { type: DataTypes.TEXT }
}, { tableName: 'trades', underscored: true });

// Bid Model
const Bid = sequelize.define('Bid', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  item_id: { type: DataTypes.INTEGER, allowNull: false },
  bidder_id: { type: DataTypes.INTEGER, allowNull: false },
  bid_item_id: { type: DataTypes.INTEGER, allowNull: false },
  message: { type: DataTypes.STRING(500) },
  points_offer: { type: DataTypes.INTEGER, defaultValue: 0 },
  status: { type: DataTypes.ENUM('active', 'accepted', 'rejected', 'withdrawn'), defaultValue: 'active' }
}, { tableName: 'bids', underscored: true });

// Appraisal Model
const Appraisal = sequelize.define('Appraisal', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  item_id: { type: DataTypes.INTEGER, allowNull: false },
  requester_id: { type: DataTypes.INTEGER, allowNull: false },
  appraiser_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'rejected'), defaultValue: 'pending' },
  result: { type: DataTypes.ENUM('authentic', 'fake', 'uncertain') },
  estimated_value: { type: DataTypes.DECIMAL(10, 2) },
  report: { type: DataTypes.TEXT }
}, { tableName: 'appraisals', underscored: true });

// Message Model
const Message = sequelize.define('Message', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  from_user_id: { type: DataTypes.INTEGER, allowNull: false },
  to_user_id: { type: DataTypes.INTEGER, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  msg_type: { type: DataTypes.ENUM('system', 'trade', 'chat'), defaultValue: 'chat' },
  related_trade_id: { type: DataTypes.INTEGER },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'messages', underscored: true });

// Associations
User.hasMany(Item, { foreignKey: 'user_id' });
Item.belongsTo(User, { foreignKey: 'user_id' });

Category.hasMany(Item, { foreignKey: 'category_id' });
Item.belongsTo(Category, { foreignKey: 'category_id' });

Category.hasMany(Category, { as: 'children', foreignKey: 'parent_id' });
Category.belongsTo(Category, { as: 'parent', foreignKey: 'parent_id' });

User.hasMany(Trade, { as: 'initiatedTrades', foreignKey: 'initiator_id' });
User.hasMany(Trade, { as: 'receivedTrades', foreignKey: 'receiver_id' });
Trade.belongsTo(User, { as: 'initiator', foreignKey: 'initiator_id' });
Trade.belongsTo(User, { as: 'receiver', foreignKey: 'receiver_id' });
Trade.belongsTo(Item, { as: 'initiatorItem', foreignKey: 'initiator_item_id' });
Trade.belongsTo(Item, { as: 'receiverItem', foreignKey: 'receiver_item_id' });

Bid.belongsTo(Item, { as: 'targetItem', foreignKey: 'item_id' });
Bid.belongsTo(Item, { as: 'bidItem', foreignKey: 'bid_item_id' });
Bid.belongsTo(User, { as: 'bidder', foreignKey: 'bidder_id' });

Appraisal.belongsTo(Item, { foreignKey: 'item_id' });
Appraisal.belongsTo(User, { as: 'requester', foreignKey: 'requester_id' });
Appraisal.belongsTo(User, { as: 'appraiser', foreignKey: 'appraiser_id' });

Message.belongsTo(User, { as: 'sender', foreignKey: 'from_user_id' });
Message.belongsTo(User, { as: 'recipient', foreignKey: 'to_user_id' });

module.exports = { sequelize, User, Category, Item, Trade, Bid, Appraisal, Message };
