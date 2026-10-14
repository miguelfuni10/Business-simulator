// Servidor "de bolso": as mesmas rotas do server.js, rodando no próprio navegador.
// Usado pela versão de teste (artefato), onde não há servidor nem rede.
import {
  GameError, addBot, authenticate, createGame, forceClose, joinGame, removePlayer, runDeadlines,
  startGame, submitDecisions, viewFor,
} from './game.js';

export function createLocalApi(storage = globalThis.localStorage, key = 'bsim:local-games') {
  const games = new Map();
  try {
    for (const game of JSON.parse(storage?.getItem(key) || '[]')) games.set(game.code, game);
  } catch { /* armazenamento indisponível: começa vazio */ }

  const persist = () => {
    try {
      storage?.setItem(key, JSON.stringify([...games.values()]));
    } catch { /* armazenamento indisponível: a partida vive só nesta aba */ }
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function route(method, url, body = {}) {
    const u = new URL(url, 'http://local');
    const [, , , rawCode, action] = u.pathname.split('/'); // ['', 'api', 'games', código, ação]
    if (method === 'POST' && !rawCode) {
      const { game, player } = createGame((code) => games.has(code), body);
      games.set(game.code, game);
      persist();
      return { code: game.code, token: player.token };
    }
    const game = games.get(String(rawCode).toUpperCase());
    if (!game) throw new GameError(404, 'Partida não encontrada. Confira o código.');
    if (runDeadlines(game)) persist();

    if (method === 'GET' && !action) {
      const player = authenticate(game, u.searchParams.get('token'));
      if (Number(u.searchParams.get('since')) === game.version) return { unchanged: true, version: game.version };
      return clone(viewFor(game, player));
    }
    if (method !== 'POST') throw new GameError(404, 'Rota não encontrada.');
    let result = { ok: true };
    if (action === 'join') {
      const player = joinGame(game, body);
      result = { code: game.code, token: player.token };
    } else {
      const player = authenticate(game, body.token);
      if (action === 'bots') addBot(game, player, body.profile);
      else if (action === 'remove') removePlayer(game, player, body.playerId);
      else if (action === 'start') startGame(game, player);
      else if (action === 'decisions') submitDecisions(game, player, clone(body));
      else if (action === 'close') forceClose(game, player);
      else throw new GameError(404, 'Rota não encontrada.');
    }
    persist();
    return result;
  }

  async function api(method, url, body) {
    try {
      return route(method, url, body);
    } catch (err) {
      const e = new Error(err.message);
      e.status = err instanceof GameError ? err.status : 500;
      throw e;
    }
  }

  /** Jogadores humanos da partida, com os tokens (só faz sentido no modo teste, tudo no mesmo aparelho). */
  api.humans = (code) => (games.get(code)?.players ?? [])
    .filter((p) => !p.isBot)
    .map((p) => ({ id: p.id, name: p.name, companyName: p.companyName, token: p.token }));

  return api;
}
