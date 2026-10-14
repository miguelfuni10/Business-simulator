// Persistência das partidas. As partidas ficam em memória; a cada mudança são gravadas:
// - em um arquivo JSON (padrão, para rodar no próprio computador ou com disco persistente);
// - ou no Upstash Redis via API REST (para hospedagens gratuitas sem disco, como o Render).

import fs from 'node:fs';
import path from 'node:path';

class MemoryStore {
  constructor() {
    this.games = new Map();
  }

  get(code) {
    return this.games.get(String(code).toUpperCase());
  }

  has(code) {
    return this.games.has(code);
  }

  add(game) {
    this.games.set(game.code, game);
    this.save(game);
  }

  all() {
    return this.games.values();
  }

  save() {}

  async flush() {}
}

export class FileStore extends MemoryStore {
  constructor(file) {
    super();
    this.file = file;
    this.timer = null;
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const game of data.games ?? []) this.games.set(game.code, game);
    }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushSync();
    }, 300);
  }

  flushSync() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ games: [...this.games.values()] }));
    fs.renameSync(tmp, this.file);
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.flushSync();
  }
}

export class RedisStore extends MemoryStore {
  constructor(url, token, { prefix = 'bsim', fetchImpl = fetch } = {}) {
    super();
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.prefix = prefix;
    this.fetch = fetchImpl;
    this.dirty = new Set();
    this.timer = null;
    this.writing = Promise.resolve();
  }

  async command(body, endpoint = '') {
    const res = await this.fetch(`${this.url}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const failed = Array.isArray(data) ? data.find((r) => r.error) : data;
    if (!res.ok || failed?.error) throw new Error(`Upstash: ${failed?.error ?? res.status}`);
    return data;
  }

  async load() {
    const { result: codes } = await this.command(['SMEMBERS', `${this.prefix}:games`]);
    if (!codes?.length) return;
    const { result: values } = await this.command(['MGET', ...codes.map((c) => `${this.prefix}:game:${c}`)]);
    for (const raw of values ?? []) {
      if (raw) {
        const game = JSON.parse(raw);
        this.games.set(game.code, game);
      }
    }
  }

  save(game) {
    if (game) this.dirty.add(game.code);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((err) => console.error('Falha ao salvar no Upstash:', err.message));
    }, 300);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const codes = [...this.dirty];
    this.dirty.clear();
    if (!codes.length) return this.writing;
    const pipeline = [];
    for (const code of codes) {
      pipeline.push(['SET', `${this.prefix}:game:${code}`, JSON.stringify(this.games.get(code))]);
      pipeline.push(['SADD', `${this.prefix}:games`, code]);
    }
    // Grava em sequência para uma versão antiga nunca sobrescrever uma nova.
    this.writing = this.writing.then(() => this.command(pipeline, '/pipeline')).catch((err) => {
      for (const code of codes) this.dirty.add(code);
      throw err;
    });
    return this.writing;
  }
}

/** Escolhe o armazenamento pelas variáveis de ambiente. */
export async function openStore(env = process.env, defaultFile = 'data/games.json') {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const store = new RedisStore(url, token);
    await store.load();
    console.log(`Partidas carregadas do Upstash Redis: ${store.games.size}`);
    return store;
  }
  return new FileStore(env.DATA_FILE || defaultFile);
}

export { MemoryStore };
