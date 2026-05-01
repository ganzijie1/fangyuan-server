require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { sequelize } = require('./models');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ==================== WebSocket Bridge for AI Engine ====================
// 本地 AI 引擎通过 WebSocket 主动连接到这个服务器
// 当收到估价请求时，通过 WebSocket 转发给 AI 引擎

let aiEngineSocket = null;
const pendingRequests = new Map(); // requestId -> { resolve, reject, timer }

// AI引擎桥接：发送请求并等待响应
function callAiEngine(data, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!aiEngineSocket || aiEngineSocket.readyState !== 1) {
      reject(new Error('AI引擎未连接'));
      return;
    }
    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('AI引擎响应超时'));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });
    aiEngineSocket.send(JSON.stringify({ requestId, ...data }));
  });
}

// 暴露给 routes 使用
app.locals.callAiEngine = callAiEngine;
app.locals.isAiConnected = () => aiEngineSocket && aiEngineSocket.readyState === 1;

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/trades', require('./routes/trades'));
app.use('/api/bids', require('./routes/bids'));
app.use('/api/appraisals', require('./routes/appraisals'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/users', require('./routes/users'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/admin', require('./routes/admin'));

// AI引擎状态接口
app.get('/api/ai/status', (req, res) => {
  res.json({
    code: 200,
    data: {
      connected: app.locals.isAiConnected(),
      pending_requests: pendingRequests.size,
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

const PORT = process.env.PORT || 3001;

sequelize.sync().then(() => {
  const server = http.createServer(app);

  // WebSocket server for AI engine bridge
  const wss = new WebSocketServer({ server, path: '/ws/ai-bridge' });

  wss.on('connection', (ws, req) => {
    // 验证连接密钥
    const key = new URL(req.url, 'http://localhost').searchParams.get('key');
    if (key !== (process.env.AI_BRIDGE_KEY || 'fangyuan-ai-2026')) {
      ws.close(4001, 'Invalid key');
      return;
    }

    console.log('[AI Bridge] AI引擎已连接');
    aiEngineSocket = ws;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
          const { resolve, timer } = pendingRequests.get(msg.requestId);
          clearTimeout(timer);
          pendingRequests.delete(msg.requestId);
          resolve(msg.result);
        }
      } catch (e) {
        console.error('[AI Bridge] Parse error:', e.message);
      }
    });

    ws.on('close', () => {
      console.log('[AI Bridge] AI引擎断开连接');
      if (aiEngineSocket === ws) aiEngineSocket = null;
    });

    ws.on('error', (err) => {
      console.error('[AI Bridge] Error:', err.message);
    });

    // Ping keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.ping();
      else clearInterval(pingInterval);
    }, 30000);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`方圆易仓服务器运行在 http://0.0.0.0:${PORT}`);
    console.log(`AI引擎WebSocket桥: ws://0.0.0.0:${PORT}/ws/ai-bridge`);
  });
}).catch(err => {
  console.error('数据库连接失败:', err);
});
