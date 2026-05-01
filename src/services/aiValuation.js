/**
 * 方圆易仓 - AI智能估值系统
 *
 * 架构设计（参考闲鱼估价器）：
 * 1. 关键词优化层：品牌/品类/成色关键词提取与加权
 * 2. RAG信息采集层：从市场价格数据库检索相似商品历史成交价
 * 3. LLM智能体层：调用大语言模型进行综合估值推理
 * 4. 规则兜底层：当LLM不可用时使用规则引擎
 *
 * 支持：物物交换估值、劳务估值、过期商品残值评估、二手商品折旧估值
 */

const axios = require('axios');

// ==================== 1. 关键词优化层 ====================

// 品牌词库（持续扩充）
const BRAND_WEIGHTS = {
  // 数码电子
  '苹果': 1.6, 'Apple': 1.6, 'iPhone': 1.6, 'iPad': 1.5, 'MacBook': 1.7,
  '华为': 1.4, 'HUAWEI': 1.4, 'Mate': 1.4, 'P系列': 1.3,
  '小米': 1.2, '三星': 1.3, 'Samsung': 1.3, 'OPPO': 1.1, 'vivo': 1.1,
  '索尼': 1.3, 'Sony': 1.3, '佳能': 1.2, 'Canon': 1.2, '尼康': 1.2,
  '戴森': 1.5, 'Dyson': 1.5, '大疆': 1.5, 'DJI': 1.5,
  // 奢侈品
  'LV': 2.2, '路易威登': 2.2, 'Gucci': 2.0, '古驰': 2.0,
  'Chanel': 2.5, '香奈儿': 2.5, 'Hermès': 3.0, '爱马仕': 3.0,
  'Prada': 1.8, 'Dior': 2.0, '卡地亚': 2.5, 'Cartier': 2.5,
  'Rolex': 2.8, '劳力士': 2.8, '百达翡丽': 3.5, 'Patek': 3.5,
  // 珠宝贵金属
  '黄金': 2.0, '足金': 2.2, '铂金': 2.0, '钻石': 2.5,
  '翡翠': 1.8, '和田玉': 1.8, '玛瑙': 1.3, '珍珠': 1.5,
  // 收藏品
  '古董': 2.0, '限量版': 1.8, '绝版': 2.0, '收藏级': 1.8,
  '签名版': 1.6, '联名款': 1.5, '首发': 1.3,
  // 家电家具
  '全新': 1.3, '未拆封': 1.4, '国行': 1.1, '港版': 0.95,
  '进口': 1.3, '手工': 1.2, '定制': 1.4,
};

// 负面关键词（降低估值）
const NEGATIVE_WEIGHTS = {
  '破损': 0.4, '故障': 0.3, '不开机': 0.2, '碎屏': 0.3,
  '缺件': 0.5, '瑕疵': 0.7, '划痕': 0.8, '磨损': 0.7,
  '过期': 0.3, '临期': 0.5, '变质': 0.1, '发霉': 0.05,
  '山寨': 0.2, '仿品': 0.2, '高仿': 0.15, '翻新': 0.5,
  '维修过': 0.6, '拆修': 0.5, '换屏': 0.7,
};

// 品类基准价格数据库（RAG检索的种子数据）
const CATEGORY_BASE_PRICES = {
  '手机': { min: 200, max: 15000, avg: 3000 },
  '笔记本电脑': { min: 1000, max: 30000, avg: 5000 },
  '平板': { min: 500, max: 12000, avg: 2500 },
  '相机': { min: 500, max: 50000, avg: 5000 },
  '耳机': { min: 50, max: 5000, avg: 500 },
  '手表': { min: 100, max: 500000, avg: 3000 },
  '包包': { min: 100, max: 200000, avg: 2000 },
  '鞋': { min: 50, max: 20000, avg: 500 },
  '衣服': { min: 30, max: 50000, avg: 300 },
  '家电': { min: 100, max: 30000, avg: 2000 },
  '家具': { min: 200, max: 50000, avg: 3000 },
  '乐器': { min: 100, max: 100000, avg: 3000 },
  '运动器材': { min: 50, max: 20000, avg: 1000 },
  '图书': { min: 5, max: 5000, avg: 30 },
  '食品': { min: 10, max: 2000, avg: 100 },
  '美妆': { min: 20, max: 5000, avg: 200 },
  '母婴': { min: 20, max: 10000, avg: 500 },
  '宠物用品': { min: 10, max: 5000, avg: 200 },
  '车辆': { min: 5000, max: 2000000, avg: 80000 },
  '房产': { min: 100000, max: 50000000, avg: 2000000 },
};

// 成色折旧系数
const CONDITION_FACTORS = {
  'new': 1.0,        // 全新
  'like_new': 0.85,  // 几乎全新（开封无使用痕迹）
  'good': 0.65,      // 良好（轻微使用痕迹）
  'fair': 0.45,      // 一般（明显使用痕迹）
  'poor': 0.25,      // 较差（功能正常但外观差）
};

// 商品类型系数
const TYPE_FACTORS = {
  'goods': 1.0,       // 普通商品
  'service': 0.8,     // 劳务（按次/时计价）
  'secondhand': 0.7,  // 二手
  'expired': 0.15,    // 过期（残值）
};

// ==================== 2. RAG信息采集层 ====================

/**
 * 模拟RAG检索：从历史成交数据中找到相似商品
 * 实际生产中应接入向量数据库（如Milvus/Pinecone）存储商品embedding
 */
function ragRetrieveSimilarItems(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const results = [];

  // 匹配品类
  for (const [category, prices] of Object.entries(CATEGORY_BASE_PRICES)) {
    if (text.includes(category) || text.includes(category.toLowerCase())) {
      results.push({
        category,
        reference_price: prices,
        relevance: 0.9,
      });
    }
  }

  // 通过关键词推断品类
  const categoryInference = {
    '手机|iPhone|华为|小米|OPPO|vivo': '手机',
    '电脑|笔记本|MacBook|ThinkPad|联想': '笔记本电脑',
    'iPad|平板': '平板',
    '相机|单反|微单|镜头': '相机',
    '耳机|AirPods|降噪': '耳机',
    '手表|腕表|Rolex|劳力士|卡西欧': '手表',
    '包|LV|Gucci|Chanel|背包|钱包': '包包',
    '鞋|Nike|Adidas|运动鞋|皮鞋': '鞋',
    '冰箱|洗衣机|空调|电视|微波炉': '家电',
    '沙发|桌子|椅子|床|柜': '家具',
    '吉他|钢琴|小提琴|鼓|乐器': '乐器',
  };

  for (const [pattern, category] of Object.entries(categoryInference)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(text) && !results.find(r => r.category === category)) {
      results.push({
        category,
        reference_price: CATEGORY_BASE_PRICES[category],
        relevance: 0.7,
      });
    }
  }

  return results;
}

// ==================== 3. LLM智能体层 ====================

/**
 * 调用LLM进行智能估值（支持多种模型接入）
 * 优先使用本地Qwen模型，fallback到规则引擎
 */
async function llmEstimate(title, description, itemType, condition, ragResults) {
  // 构建估值prompt
  const systemPrompt = `你是方圆易仓平台的AI商品估值专家。你需要根据商品信息给出合理的市场估值。

估值原则：
1. 参考同类商品的市场成交价
2. 考虑品牌溢价、成色折旧、稀缺性
3. 二手商品按原价的30%-85%估值
4. 过期商品按残值估算（通常原价的5%-30%）
5. 劳务按市场时薪×预估工时计算
6. 给出估值区间（最低-最高）和最可能价格

输出格式（严格JSON）：
{"min_value": 数字, "max_value": 数字, "estimated_value": 数字, "confidence": "high/medium/low", "reasoning": "估值理由", "category": "商品类别", "factors": ["影响因素1", "影响因素2"]}`;

  const userPrompt = `请估算以下商品的价值：

商品名称：${title}
商品描述：${description || '无'}
商品类型：${itemType === 'goods' ? '普通商品' : itemType === 'service' ? '劳务服务' : itemType === 'expired' ? '过期商品' : '二手商品'}
成色等级：${condition === 'new' ? '全新' : condition === 'like_new' ? '几乎全新' : condition === 'good' ? '良好' : condition === 'fair' ? '一般' : '较差'}

${ragResults.length > 0 ? `参考市场数据：\n${ragResults.map(r => `- ${r.category}: 市场价${r.reference_price.min}-${r.reference_price.max}元，均价${r.reference_price.avg}元`).join('\n')}` : ''}

请给出估值（人民币）：`;

  try {
    // 尝试调用本地Qwen模型（通过OpenAI兼容接口）
    const response = await axios.post(
      process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions',
      {
        model: process.env.LLM_MODEL || 'qwen',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      },
      {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${process.env.LLM_API_KEY || 'not-needed'}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = response.data.choices[0].message.content;
    // 提取JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        source: 'llm',
        ...result,
      };
    }
  } catch (err) {
    // LLM不可用，返回null由规则引擎兜底
    console.log('LLM估值服务不可用，使用规则引擎:', err.message);
  }

  return null;
}

// ==================== 4. 规则兜底层 ====================

function ruleBasedEstimate(title, description, itemType, conditionLevel, ragResults) {
  const text = `${title} ${description || ''}`;

  // 基础系数
  const typeFactor = TYPE_FACTORS[itemType] || 1.0;
  const conditionFactor = CONDITION_FACTORS[conditionLevel] || 0.65;

  // 品牌加权
  let brandMultiplier = 1.0;
  let matchedBrands = [];
  for (const [keyword, weight] of Object.entries(BRAND_WEIGHTS)) {
    if (text.includes(keyword)) {
      brandMultiplier = Math.max(brandMultiplier, weight); // 取最高品牌权重
      matchedBrands.push(keyword);
    }
  }

  // 负面关键词
  let negativeFactor = 1.0;
  let negativeReasons = [];
  for (const [keyword, weight] of Object.entries(NEGATIVE_WEIGHTS)) {
    if (text.includes(keyword)) {
      negativeFactor *= weight;
      negativeReasons.push(keyword);
    }
  }

  // RAG参考价格
  let basePrice = 500; // 默认基准
  let category = '未知';
  if (ragResults.length > 0) {
    const bestMatch = ragResults.sort((a, b) => b.relevance - a.relevance)[0];
    basePrice = bestMatch.reference_price.avg;
    category = bestMatch.category;
  }

  // 综合计算
  let estimatedValue = basePrice * typeFactor * conditionFactor * brandMultiplier * negativeFactor;

  // 描述详细度加分（详细描述通常意味着卖家认真对待）
  const descLength = (description || '').length;
  const descBonus = Math.min(1.0 + descLength / 1000, 1.3);
  estimatedValue *= descBonus;

  // 合理性约束
  const minValue = Math.max(1, estimatedValue * 0.5);
  const maxValue = estimatedValue * 2.0;
  estimatedValue = Math.round(estimatedValue * 100) / 100;

  // 置信度判断
  let confidence = 'low';
  if (ragResults.length > 0 && matchedBrands.length > 0) confidence = 'high';
  else if (ragResults.length > 0 || matchedBrands.length > 0) confidence = 'medium';

  return {
    success: true,
    source: 'rule_engine',
    estimated_value: estimatedValue,
    min_value: Math.round(minValue),
    max_value: Math.round(maxValue),
    confidence,
    category,
    reasoning: buildReasoning(category, matchedBrands, negativeReasons, conditionLevel, itemType),
    factors: {
      brandMultiplier,
      conditionFactor,
      typeFactor,
      negativeFactor,
      descBonus: Math.round(descBonus * 100) / 100,
      matchedBrands,
      negativeReasons,
      ragMatches: ragResults.length,
    },
  };
}

function buildReasoning(category, brands, negatives, condition, type) {
  const parts = [];
  if (category !== '未知') parts.push(`该商品归类为「${category}」`);
  if (brands.length > 0) parts.push(`识别到品牌关键词：${brands.join('、')}，品牌溢价已计入`);
  if (negatives.length > 0) parts.push(`注意：存在${negatives.join('、')}等问题，已降低估值`);

  const conditionMap = { 'new': '全新', 'like_new': '几乎全新', 'good': '良好', 'fair': '一般', 'poor': '较差' };
  parts.push(`成色等级「${conditionMap[condition] || condition}」`);

  if (type === 'expired') parts.push('过期商品按残值估算');
  if (type === 'service') parts.push('劳务按市场行情估算');

  return parts.join('；') + '。';
}

// ==================== 主入口 ====================

/**
 * AI智能估值 - 主函数
 * 流程：关键词提取 → RAG检索 → LLM估值（或规则兜底）→ 结果融合
 */
async function estimateValue(title, description, itemType, conditionLevel) {
  // Step 1: RAG检索相似商品
  const ragResults = ragRetrieveSimilarItems(title, description || '');

  // Step 2: 尝试LLM智能估值
  const llmResult = await llmEstimate(title, description || '', itemType, conditionLevel, ragResults);

  // Step 3: 规则引擎估值（作为兜底或验证）
  const ruleResult = ruleBasedEstimate(title, description || '', itemType, conditionLevel, ragResults);

  // Step 4: 结果融合
  if (llmResult && llmResult.estimated_value) {
    // LLM结果可用，与规则引擎交叉验证
    const llmValue = llmResult.estimated_value;
    const ruleValue = ruleResult.estimated_value;

    // 如果两者差距超过5倍，以规则引擎为准（防止LLM幻觉）
    if (llmValue > ruleValue * 5 || llmValue < ruleValue * 0.2) {
      return {
        ...ruleResult,
        llm_reference: llmValue,
        note: 'LLM估值与市场数据偏差过大，已使用规则引擎结果',
      };
    }

    // 加权融合：LLM 60% + 规则 40%
    const fusedValue = Math.round((llmValue * 0.6 + ruleValue * 0.4) * 100) / 100;
    return {
      success: true,
      source: 'ai_fusion',
      estimated_value: fusedValue,
      min_value: Math.round(Math.min(llmResult.min_value || fusedValue * 0.5, ruleResult.min_value)),
      max_value: Math.round(Math.max(llmResult.max_value || fusedValue * 2, ruleResult.max_value)),
      confidence: llmResult.confidence || ruleResult.confidence,
      category: llmResult.category || ruleResult.category,
      reasoning: llmResult.reasoning || ruleResult.reasoning,
      factors: {
        llm_value: llmValue,
        rule_value: ruleValue,
        fusion_weight: '60% AI + 40% 规则',
        ...ruleResult.factors,
      },
    };
  }

  // LLM不可用，纯规则引擎结果
  return ruleResult;
}

module.exports = { estimateValue, ragRetrieveSimilarItems, BRAND_WEIGHTS, CATEGORY_BASE_PRICES };
