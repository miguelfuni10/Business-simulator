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

**Prazo de cada período**

Ninguém precisa jogar ao mesmo tempo. Cada período tem um prazo (de 5 minutos a 24 horas, ou todo dia num horário
fixo). Até o prazo acabar, cada CEO envia e pode alterar suas decisões quando quiser. No fim do prazo o jogo consolida
tudo e revela os resultados e o ranking, mostrando quem subiu e quem caiu. Se a opção estiver ligada, o período fecha
antes quando todos já enviaram. O anfitrião também pode fechar a qualquer momento.

Sugestões: **10 a 30 minutos** para jogar numa noite; **24 horas** (ou "todo dia às 22h") para uma rodada por dia.

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
  ganho acumulado + R$ 100 mil (em dobro para reincidentes), tombo forte na bolsa, reputação menor, 4 períodos sob
  investigação e um desconto permanente de 3% no valor da ação por condenação. As escolhas são secretas: só os
  escândalos viram notícia.
- **Denúncia**: cada CEO pode denunciar um concorrente por período (R$ 20 mil em advogados). A denúncia soma +30% de chance
  de descoberta; se o denunciado for pego, o denunciante recebe R$ 60 mil e segue anônimo. Se o denunciado era
  honesto, a denúncia é **caluniosa**: o denunciante paga R$ 50 mil de indenização a ele, perde reputação e tem o nome
  publicado nas notícias. Se o denunciado trapaceava mas escapou, a denúncia só é arquivada.

Em simulações, trapacear de vez em quando custa em média de 13 a 32 pontos de valorização, embora às vezes renda a
vitória; trapacear sempre quebra a empresa.

### Cartel de preços e delação premiada

Um CEO propõe em segredo um preço mínimo a outras empresas; o convite chega no período seguinte e, com dois ou mais
membros, o cartel passa a valer. Os membros veem quem cumpriu o preço combinado. O CADE investiga o grupo todo (risco
crescente e maior com denúncias); se pegar, todos são multados. Qualquer membro pode delatar: o cartel cai no mesmo
fechamento, os parceiros são multados e o delator fica imune. Robôs nunca aceitam convites.

### Acesso e lembretes

- **Código pessoal**: cada CEO tem um código de 6 caracteres e um link de acesso que abrem a empresa em qualquer aparelho
  (tentativas erradas são limitadas).
- **Lembretes**: botão para avisar o grupo no WhatsApp com o prazo e o link; avisos do navegador quando o período fecha
  e 15 minutos antes do prazo (com o jogo aberto em alguma aba); no modo diário, arquivo de agenda (.ics) com todos os
  prazos e alarme 1 hora antes.

### Raio-X do CEO

Aba que decompõe a valorização de cada empresa (valor inicial + lucros por ação + emissão/recompra + prêmio do mercado =
cotação + dividendos), mostra a DRE acumulada contra a média do mercado, melhor e pior período e lições automáticas
sobre a gestão (caixa, rentabilidade vs. custo de capital, estoque, preço, escândalos, denúncias).

### Ajudas para decidir

- **Como as coisas se afetam**: banner na tela de decisões com a cadeia decisão → clientes e custos → DRE → balanço →
  cotação, e uma tabela do que cada alavanca dá e cobra.
- **Sua empresa no início do período**: balanço patrimonial e números de referência (demanda esperada, preço médio,
  custo por unidade, despesas fixas) antes do formulário.
- **Projeção do resultado**: enquanto você preenche, o próprio motor do jogo estima vendas, lucro, caixa e cotação,
  supondo que os concorrentes repitam o último período (sem sorte, leilão ou chance de ser pego).

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
npm run build:artifact  # gera dist/simulador-teste.html: versão de teste que roda sem servidor
```

Variáveis de ambiente: `PORT` (padrão 3000), `DATA_FILE` (padrão `data/games.json`) e, para guardar as partidas
no Upstash Redis, `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.

### Publicar de graça (Render + Upstash)

O jeito recomendado e gratuito: o **Render** roda o site e o **Upstash Redis** guarda as partidas. Nenhum dos dois
pede cartão de crédito no plano gratuito.

1. **Banco de dados (Upstash)**: crie uma conta em [upstash.com](https://upstash.com), clique em *Create Database*
   (Redis, região mais próxima, plano Free). Na página do banco, na seção **REST API**, copie
   `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
2. **Site (Render)**: crie uma conta em [render.com](https://render.com) entrando com o GitHub. Clique em
   *New → Blueprint*, escolha este repositório e o branch. O Render lê o arquivo `render.yaml` e pede as duas
   variáveis do passo 1: cole os valores e confirme.
3. Em alguns minutos o Render mostra o endereço `https://simulador-de-empresas-xxxx.onrender.com`. É esse link que
   você manda para os amigos.

Como funciona no plano gratuito:

- O site **dorme após 15 minutos sem acesso** e leva cerca de 1 minuto para acordar no próximo acesso.
  As partidas não se perdem, porque ficam no Upstash.
- Se o servidor estiver dormindo quando o prazo acabar, o período é fechado assim que alguém abrir o site.
  O resultado é o mesmo, e no modo "todo dia num horário" o ritmo de um período por dia é mantido.
- Os limites gratuitos (750 horas de servidor por mês no Render e 500 mil comandos por mês no Upstash) sobram
  para partidas entre amigos.

Sem as variáveis do Upstash, o jogo salva em `data/games.json`. Isso serve para rodar no seu computador ou num
servidor com disco persistente (o `Dockerfile` usa `/data`).

### Versão de teste sem servidor

`npm run build:artifact` gera um único arquivo HTML com o jogo inteiro rodando no navegador (o mesmo motor,
com um "servidor de bolso" em `src/local-api.js`). Serve para experimentar contra robôs ou com vários jogadores
alternando no mesmo aparelho, e pode ser publicado como artefato no Claude. Para jogar com amigos, cada um no seu
celular, é preciso publicar o site com servidor.

### Outras opções

- **Seu computador + túnel**: `npm start` e `cloudflared tunnel --url http://localhost:3000` geram um link
  público, que só funciona com o computador ligado. Bom para uma partida de prazos curtos numa noite.
- **Mesma rede Wi-Fi**: `npm start` e os amigos acessam `http://SEU-IP:3000`.

## Estrutura

```
server.js            servidor HTTP (API JSON + arquivos estáticos), sem dependências
src/engine.js        motor de simulação: mercado, contabilidade e cotação
src/bots.js          empresas-robô
src/game.js          regras da partida: sala, envio de decisões, fechamento de períodos
src/store.js         persistência (arquivo JSON ou Upstash Redis)
render.yaml          implantação gratuita no Render
src/local-api.js     rotas do servidor rodando no navegador (versão de teste)
scripts/build-artifact.js  empacota a versão de teste num único HTML
public/              front-end (HTML/CSS/JS puro)
test/                testes (node --test)
scripts/simulate.js  simulação de balanceamento
scripts/demo.js      partida de teste de 3 rodadas
```
