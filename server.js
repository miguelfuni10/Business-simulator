// Servidor HTTP sem dependências: API JSON + arquivos estáticos da pasta public/.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './src/store.js';
import {
  GameError, addBot, authenticate, createGame, forceClose, joinGame, removePlayer, runDeadlines,
  startGame, submitDecisions, viewFor,
} from './src/game.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'games.json');
const MAX_BODY = 32 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export function createServer(store) {
  const routes = [
    ['POST', /^\/api\/games$/, async (req) => {
      const body = await readBody(req);
      const { game, player } = createGame((code) => store.has(code), body);
      store.add(game);
      return { code: game.code, token: player.token };
    }],
    ['GET', /^\/api\/games\/([A-Za-z]{5})$/, async (req, game, url) => {
      const player = authenticate(game, url.searchParams.get('token'));
      if (Number(url.searchParams.get('since')) === game.version) return { unchanged: true, version: game.version };
      return viewFor(game, player);
    }],
    ['POST', /^\/api\/games\/([A-Za-z]{5})\/join$/, async (req, game) => {
      const player = joinGame(game, await readBody(req));
      return { code: game.code, token: player.token };
    }],
    ['POST', /^\/api\/games\/([A-Za-z]{5})\/bots$/, async (req, game) => {
      const body = await readBody(req);
      addBot(game, authenticate(game, body.token), body.profile);
      return { ok: true };
    }],
    ['POST', /^\/api\/games\/([A-Za-z]{5})\/remove$/, async (req, game) => {
      const body = await readBody(req);
      removePlayer(game, authenticate(game, body.token), body.playerId);
      return { ok: true };
    }],
    ['POST', /^\/api\/games\/([A-Za-z]{5})\/start$/, async (req, game) => {
      const body = await readBody(req);
      startGame(game, authenticate(game, body.token));
      return { ok: true };
    }],
    ['POST', /^\/api\/games\/([A-Za-z]{5})\/decisions$/, async (req, game) => {
      const body = await readBody(req);
      submitDecisions(game, authenticate(game, body.token), body);
      return { ok: true };
    }],
    ['POST', /^\/api\/games\/([A-Za-z]{5})\/close$/, async (req, game) => {
      const body = await readBody(req);
      forceClose(game, authenticate(game, body.token));
      return { ok: true };
    }],
  ];

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
        if (!route) throw new GameError(404, 'Rota não encontrada.');
        const [, re, handler] = route;
        const match = url.pathname.match(re);
        let game = null;
        if (match[1]) {
          game = store.get(match[1]);
          if (!game) throw new GameError(404, 'Partida não encontrada. Confira o código.');
          // Fecha períodos vencidos na hora do acesso: a hospedagem pode ter ficado dormindo.
          if (runDeadlines(game)) store.save(game);
        }
        const result = await handler(req, game, url);
        if (req.method !== 'GET' && game) store.save(game);
        return sendJson(res, 200, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new GameError(405, 'Método não permitido.');
      await serveStatic(url.pathname, res);
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      const status = err instanceof GameError ? err.status : 500;
      sendJson(res, status, { error: err instanceof GameError ? err.message : 'Erro interno do servidor.' });
    }
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new GameError(413, 'Requisição grande demais.'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new GameError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new GameError(404, 'Não encontrado.');
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    throw new GameError(404, 'Não encontrado.');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(data);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await openStore(process.env, DATA_FILE);
  const server = createServer(store);
  setInterval(() => {
    for (const game of store.all()) if (runDeadlines(game)) store.save(game);
  }, 15_000);
  const shutdown = async () => {
    try {
      await store.flush();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.listen(PORT, () => console.log(`Simulador de Empresas rodando em http://localhost:${PORT}`));
}
