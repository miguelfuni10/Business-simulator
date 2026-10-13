// Persistência simples em arquivo JSON (suficiente para partidas entre amigos).
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(file) {
    this.file = file;
    this.games = new Map();
    this.timer = null;
    if (file && fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const game of data.games ?? []) this.games.set(game.code, game);
    }
  }

  get(code) {
    return this.games.get(String(code).toUpperCase());
  }

  has(code) {
    return this.games.has(code);
  }

  add(game) {
    this.games.set(game.code, game);
    this.save();
  }

  all() {
    return this.games.values();
  }

  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 300);
  }

  flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ games: [...this.games.values()] }));
    fs.renameSync(tmp, this.file);
  }
}
