/**
 * Aplicacao Express (sem escutar porta).
 *
 * Este arquivo e compartilhado por dois modos de execucao:
 *   - backend/server.js -> processo tradicional (local, VPS, Docker)
 *   - api/index.js      -> funcao serverless (Vercel)
 */
import path from 'node:path';
import express from 'express';
import config, { ROOT_DIR } from './config/env.js';
import apiRoutes from './api/routes/index.js';
import { errorHandler, notFoundHandler } from './api/middleware/errorHandler.js';

const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');

const app = express();

// Atras de proxy (Nginx, Vercel, Render...) para o rate limit ver o IP real.
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Cabecalhos de seguranca (sem dependencia extra)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Corpo JSON pequeno: nenhuma rota precisa de payload grande.
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use('/api', apiRoutes);

// ---------------------------------------------------------------------------
// Frontend estatico
// (na Vercel os estaticos sao servidos pela CDN, conforme vercel.json;
//  este bloco atende o modo processo tradicional)
// ---------------------------------------------------------------------------
app.use(
  express.static(FRONTEND_DIR, {
    extensions: ['html'],
    maxAge: config.isProduction ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'admin', 'index.html'));
});

// Qualquer rota nao-API cai na home (links compartilhados continuam abrindo).
// Caminhos com extensao (ex.: /assets/x.js) seguem para o 404 de verdade.
app.use((req, res, next) => {
  const isPage = req.method === 'GET' && !req.path.startsWith('/api') && !path.extname(req.path);
  if (!isPage) {
    next();
    return;
  }
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
