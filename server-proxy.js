const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WEKNORA_BASE = process.env.WEKNORA_BASE || 'http://localhost:8080';
const WEKNORA_API_KEY = process.env.WEKNORA_API_KEY || '';

if (!WEKNORA_API_KEY) {
  console.warn('[WARN] WEKNORA_API_KEY 未设置，代理请求可能无法通过认证');
}

// Proxy API requests to WeKnora backend
app.use(
  '/api',
  createProxyMiddleware({
    target: WEKNORA_BASE,
    changeOrigin: true,
    pathRewrite: { '^/api': '/api' },
    onProxyReq: (proxyReq) => {
      if (WEKNORA_API_KEY) {
        proxyReq.setHeader('X-API-Key', WEKNORA_API_KEY);
      }
    },
    onProxyRes: (proxyRes, req) => {
      // Log stream endpoints for debugging
      if (req.url.includes('/chat/')) {
        console.log(`[SSE] ${req.method} ${req.url}`);
      }
    },
    onError: (err, req, res) => {
      console.error('[PROXY ERROR]', err.message);
      res.status(502).json({ success: false, error: { message: '代理请求失败：' + err.message } });
    }
  })
);

// Serve static PWA files
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[WeKnora Mobile Proxy] listening on http://localhost:${PORT}`);
  console.log(`[Backend] ${WEKNORA_BASE}`);
});
