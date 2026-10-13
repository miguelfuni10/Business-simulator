// Partida de teste com 3 rodadas, jogada pelas mesmas regras do servidor.
// Mostra decisões, leilão, práticas ilegais, denúncia e resultados rodada a rodada.
// Uso: npm run demo
import { addBot, closePeriod, createGame, joinGame, startGame, submitDecisions } from '../src/game.js';


const money = (x) => `R$ ${Math.round(x).toLocaleString('pt-BR')}`;
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')}%`;
const brl = (x) => `R$ ${x.toFixed(2).replace('.', ',')}`;

// Procura uma semente em que apareça uma empresa à venda na rodada 2, para a demo mostrar o leilão.
function setup(seed) {
  const { game, player: voce } = createGame(() => false, {
    name: 'Você', companyName: 'Funi Corp', totalPeriods: 3, mode: 'live',
  });
  game.seed = seed;
  const rival = joinGame(game, { name: 'Amigo', companyName: 'Rival S.A.' });
  addBot(game, voce, 'equilibrada');
  addBot(game, voce, 'agressiva');
  startGame(game, voce);
  return { game, voce, rival };
}

let seed = 1;
for (;; seed++) {
  const { game, voce, rival } = setup(seed);
  submitDecisions(game, voce, { period: 1, decisions: {} });
  submitDecisions(game, rival, { period: 1, decisions: {} });
  if (game.env.acquisition) break;
}

const { game, voce, rival } = setup(seed);
const name = (id) => game.players.find((p) => p.id === id).companyName;

const plan = {
  1: {
    voce: { decisions: { price: 63, production: 10_000, marketing: 60_000, rnd: 40_000 } },
    rival: { decisions: { price: 57, production: 11_500 }, moves: { illegal: ['informalLabor'] } },
  },
  2: {
    voce: (env) => ({
      decisions: {
        price: 63, production: 10_500, marketing: 60_000, rnd: 40_000,
        loan: Math.round(env.acquisition.minBid * 1.3 / 10_000) * 10_000 + 100_000,
      },
      moves: { acquisitionBid: Math.round(env.acquisition.minBid * 1.3 / 10_000) * 10_000 },
    }),
    rival: (env) => ({
      decisions: { price: 57, production: 11_500 },
      moves: { illegal: ['informalLabor'], acquisitionBid: env.acquisition.minBid },
    }),
  },
  3: {
    voce: { decisions: { price: 62, production: 13_500, marketing: 60_000, rnd: 40_000, capex: 0 }, moves: { reportTarget: rival.id } },
    rival: { decisions: { price: 57, production: 11_500 }, moves: { illegal: ['informalLabor', 'taxEvasion'] } },
  },
};

console.log(`# Partida de teste — 3 rodadas (semente ${seed})\n`);
console.log('Empresas: Funi Corp (você), Rival S.A. (amigo), Aurora Indústrias (robô equilibrado), Titã S.A. (robô agressivo).');
console.log('Todas começam com: caixa R$ 200 mil, fábrica para 12.000 un., dívida R$ 310 mil, ação a R$ 10,00.\n');

for (let period = 1; period <= 3; period++) {
  const env = game.env;
  console.log(`## Rodada ${period}`);
  console.log(`Cenário: demanda prevista ${pct(env.demandMult - 1)}, matéria-prima ${pct(env.materialMult - 1)}, juros ${(env.interestRate * 100).toFixed(2).replace('.', ',')}%/período.`);
  if (env.event) console.log(`Notícia: ${env.event.title} — ${env.event.text}`);
  if (env.acquisition) {
    const t = env.acquisition;
    console.log(`À venda: ${t.name} (${t.kind}) — fábrica ${money(t.fixedAssets)}, ${t.customers} clientes/período, lance mínimo ${money(t.minBid)}.`);
  }
  for (const [who, player] of [['voce', voce], ['rival', rival]]) {
    const p = typeof plan[period][who] === 'function' ? plan[period][who](env) : plan[period][who];
    const extras = [];
    if (p.moves?.acquisitionBid) extras.push(`lance de ${money(p.moves.acquisitionBid)}`);
    if (p.moves?.illegal?.length) extras.push(`em segredo: ${p.moves.illegal.join(', ')}`);
    if (p.moves?.reportTarget) extras.push(`denuncia ${name(p.moves.reportTarget)}`);
    console.log(`- ${name(player.id)} decide: ${Object.entries(p.decisions).map(([k, v]) => `${k}=${v}`).join(', ')}${extras.length ? ` | ${extras.join(' | ')}` : ''}`);
    submitDecisions(game, player, { period, ...p });
  }
  if (game.period === period && game.status === 'running') closePeriod(game);
  const h = game.history.at(-1);
  console.log('\n| Empresa | Preço | Vendas | Part. | Lucro líquido | Caixa | Ação | Valorização |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const p of game.players) {
    const r = h.reports[p.id];
    console.log(`| ${p.companyName} | ${money(r.decisions.price)} | ${r.operations.sales.toLocaleString('pt-BR')} | ${(r.operations.marketShare * 100).toFixed(1).replace('.', ',')}% | ${money(r.income.netIncome)} | ${money(r.balance.cash)} | ${brl(r.stock.price)} | ${pct(r.stock.tsr)} |`);
  }
  const acq = h.market.acquisition;
  if (acq) console.log(acq.winnerId ? `\n🏢 ${name(acq.winnerId)} venceu o leilão de ${acq.name} por ${money(acq.price)} (${acq.bidders} lances válidos).` : `\n🏚️ Ninguém comprou ${acq.name}.`);
  for (const p of game.players) {
    const r = h.reports[p.id];
    for (const sc of r.events.scandals) console.log(`🚔 ${p.companyName} foi pega por ${sc.label}${sc.reported ? ' (após denúncia)' : ''}: multa de ${money(sc.fine)}.`);
    if (r.events.reportsReceived && !r.events.scandals.length) console.log(`📨 Denúncia contra ${p.companyName} arquivada.`);
    if (r.income.reward) console.log(`💰 ${p.companyName} recebeu ${money(r.income.reward)} de recompensa pela denúncia.`);
  }
  console.log('');
}

const ranking = game.players
  .map((p) => ({ p, c: game.companies[p.id] }))
  .map((x) => ({ ...x, tsr: (x.c.price + x.c.cumDividendsPerShare) / 10 - 1 }))
  .sort((a, b) => b.tsr - a.tsr);
console.log('## Ranking final (valorização acumulada nas 3 rodadas)');
ranking.forEach((x, i) => console.log(`${i + 1}. ${x.p.companyName}: ação ${brl(x.c.price)} + dividendos ${brl(x.c.cumDividendsPerShare)}/ação → ${pct(x.tsr)}`));

