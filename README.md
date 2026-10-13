# 📈 Simulador de Empresas

Jogo web multiplayer para jogar com os amigos: cada um é **CEO** de uma empresa, todos disputam o mesmo mercado
e, a cada período contábil, tomam **10 decisões**. No fim, vence quem entregar a **maior valorização da ação**
(cotação + dividendos recebidos).

## Como funciona

1. Alguém cria a partida, escolhe o número de períodos e o ritmo, e manda o link para os amigos.
   Dá para completar a mesa com **empresas-robô** (perfis Conservadora, Equilibrada, Agressiva e Inovadora).
2. Em cada período, cada CEO envia as decisões. Pode reenviar até o fechamento; quem não enviar repete as do período anterior.
3. Quando o período fecha, saem a **DRE**, o **balanço**, o **fluxo de caixa**, os indicadores e a nova **cotação** de todas
   as empresas (os demonstrativos são públicos, como numa empresa de capital aberto).

**Ritmos de jogo**

- **Diário**: 1 período por dia, que fecha automaticamente num horário escolhido (ex.: 22h). O anfitrião pode fechar antes.
- **Ao vivo**: o período fecha assim que todos enviam. Bom para jogar tudo numa noite.

### As 10 decisões

| # | Decisão | Efeito principal |
|---|---------|------------------|
| 1 | Preço de venda | Fator mais forte na divisão do mercado; se todos sobem, o mercado encolhe |
| 2 | Produção | Limitada pela capacidade; sobra vira estoque, falta derruba vendas e reputação |
| 3 | Marketing | Constrói marca (acumula, desgasta 35%/período) |
| 4 | P&D | Constrói qualidade (lento e duradouro, desgasta 15%/período) |
| 5 | Investimento na fábrica | R$ 70 = 1 unidade de capacidade no período seguinte; depreciação de 5% |
| 6 | Nível salarial | Produtividade e atendimento × custo |
| 7 | Prazo aos clientes | Atrai clientes × capital de giro e inadimplência |
| 8 | Empréstimo / amortização | Alavancagem; juros sobem com a dívida; limite de 1,5× o PL |
| 9 | Dividendos | Contam na valorização, reduzem caixa e PL |
| 10 | Emissão / recompra de ações | Levanta caixa diluindo, ou concentra o lucro |

Há eventos aleatórios por período (recessão, alta das commodities, juros etc.), anunciados antes das decisões.
Se o caixa ficar negativo, o banco cobre com um empréstimo emergencial e multa de 8%.

O jogo é **cumulativo**: caixa, dívida, fábrica, marca, reputação e cotação passam de uma rodada para a outra, e o ranking
final mede a valorização acumulada desde o início.

### Movimentos estratégicos (opcionais)

O anfitrião pode ligar ou desligar cada um ao criar a partida.

- **Aquisições**: a partir do período 2, às vezes uma empresa é posta à venda (fábrica, marca regional com clientes,
  startup de tecnologia, distribuidora, concorrente em recuperação judicial). Leilão de **lance fechado**: o maior lance
  acima do mínimo leva e paga o próprio lance. A fábrica vira capacidade, os clientes viram demanda cativa e o que for pago
  acima da fábrica vira **ágio** no balanço.
- **Bastidores (práticas ilegais)**: sonegação, trabalho informal, descarte ilegal de resíduos, propaganda enganosa,
  espionagem industrial e maquiagem contábil. Dão ganho imediato, mas o risco de ser descoberto cresce a cada período de
  uso, ganhos não punidos continuam expostos e há uma auditoria de encerramento no último período. Se pego: multa de 2× o
  ganho acumulado + R$ 50 mil, queda da ação, reputação menor e 3 períodos sob investigação. As escolhas são secretas:
  só os escândalos viram notícia.
- **Denúncia**: cada CEO pode denunciar um concorrente por período (R$ 20 mil em advogados). A denúncia soma +30% de chance
  de descoberta; se o denunciado for pego, o denunciante recebe R$ 60 mil. Contra empresa honesta, é arquivada.

Em simulações, trapacear tem retorno médio levemente negativo, mas aumenta muito a variância: às vezes rende a vitória,
às vezes afunda a empresa. Usar sempre é quase suicídio.

**Como a ação é precificada**: valor patrimonial por ação × um fator que cresce quando o retorno sobre o patrimônio supera
o custo de capital (3,5%/período, mais alto para empresas muito endividadas), mais um prêmio por crescimento de receita e
um pouco de humor do mercado. Os lucros são suavizados e parte do marketing/P&D é tratada como investimento, para que
cortar tudo no último período não infle a ação.

## Rodando

Precisa só do **Node.js 18+**. Não há dependências para instalar.

```bash
npm start          # http://localhost:3000
npm test           # testes do motor contábil, das regras e da API
npm run simulate   # 200 partidas só com robôs, para conferir o balanceamento
npm run demo       # partida de teste com 3 rodadas, mostrando leilão, trapaça e denúncia
```

Variáveis de ambiente: `PORT` (padrão 3000) e `DATA_FILE` (padrão `data/games.json`), onde as partidas ficam salvas.

### Jogando com amigos pela internet

O servidor precisa ficar no ar durante toda a partida (no modo diário, por vários dias) e o arquivo de dados precisa
sobreviver a reinícios. Opções:

- **Railway / Fly.io / Render** com o `Dockerfile` incluso e um **volume persistente** montado em `/data`.
  Atenção: sem disco persistente (comum em planos gratuitos), as partidas se perdem quando o servidor reinicia ou "dorme".
- **Um computador de casa** rodando `npm start` + um túnel (ex.: `cloudflared tunnel --url http://localhost:3000`)
  para gerar um link público.
- **Mesma rede Wi-Fi**: `npm start` e os amigos acessam `http://SEU-IP:3000`.

## Estrutura

```
server.js            servidor HTTP (API JSON + arquivos estáticos), sem dependências
src/engine.js        motor de simulação: mercado, contabilidade e cotação
src/bots.js          empresas-robô
src/game.js          regras da partida: sala, envio de decisões, fechamento de períodos
src/store.js         persistência em arquivo JSON
public/              front-end (HTML/CSS/JS puro)
test/                testes (node --test)
scripts/simulate.js  simulação de balanceamento
scripts/demo.js      partida de teste de 3 rodadas
```
