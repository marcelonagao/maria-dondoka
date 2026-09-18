# maria-dondoka — Regras do Projeto

Sistema de gestão financeira multi-franquia (perfumaria, 8 lojas). Este arquivo carrega junto
com o `CLAUDE.md` do workspace quando você trabalha nesta pasta.

Histórico de decisões e pendências: @HISTORICO.md

## Stack e Deploy

Next.js App Router + Tailwind, deploy Vercel. Supabase (Postgres + Auth + Storage). Dev via
StackBlitz → GitHub → deploy automático. Multi-tenant via `franchise_id` + RLS em toda tabela.

- `npm run dev` / `npm run build` / `npm run lint` — sem script de teste (não existe suite
  automatizada neste projeto).
- `tsconfig.json` tem `target: "es5"` — `for...of` direto em `Map`/`Set` (`.entries()`,
  `.keys()`) não compila; sempre envolver em `Array.from(...)` antes de iterar.
- Build local sempre falha em "Collecting page data" numa rota de API aleatória, com
  `supabaseUrl is required` — falta `.env.local` nesta pasta (existe em `../maria-dondoka/`,
  a cópia antiga — nunca confirmado se dá pra copiar direto). Não bloqueia PR/deploy, a
  Vercel tem as env vars reais.

## Banco de dados — regras que já causaram bug real quando ignoradas

- **Toda tabela nova via SQL Editor precisa de**
  `grant select, insert, update, delete on <tabela> to service_role;` — existe
  `alter default privileges`, mas tabelas criadas antes disso ainda podem faltar o grant.
- **`paid_at` é a única fonte de verdade para regime de caixa** em Contas a Pagar e DRE — nunca
  `created_at` (auditoria) nem `due_date` (vencimento, não pagamento).
- Nunca delete físico de despesa — status vira `cancelado` (com motivo). Despesa paga só edita,
  com log em `accounts_payable_historico`.
- **Plano de contas tem 3 níveis reais**, não 2. Use a função SQL `categoria_raiz(id)`
  (recursiva) para agrupar por categoria-raiz — nunca `coalesce(categoria_pai_id, id)`, que só
  sobe um nível.
- Função `calcular_resultado_dre` roda `security invoker` — RLS já filtra, nunca usar
  `service_role` nessa função.
- **Supabase trunca em 1000 linhas por padrão, sem erro** — qualquer leitura de
  `vendas_itens` num intervalo de mês (~13 mil itens/mês em produção) precisa paginar com
  `.range()`. Use `buscarTodosVendasItens` (`src/lib/vendasItens.ts`), já pronto — nunca um
  `.select()` solto nessa tabela pra período largo, ou o DRE/CMV vem inflado pra baixo
  silenciosamente.

## Integração PDV (A7 Pharma) — a parte com mais pegadinha

Cada loja tem seu próprio banco MySQL independente, schema idêntico mas **dados de referência
diferentes por loja** — nunca assumir que um valor descoberto numa loja vale para outra sem
checar.

- **Tabela `contas`** (mapa `conta` → forma de pagamento) varia por loja — confirmado no
  código (`src/lib/lojasDiretas.ts`, `mapaContaForma` por franquia):
  - Loja1: `{1:dinheiro, 8:débito, 9:crédito, 10:venda_internet, 11:depósito, 12:pix}`
  - Loja4: `{1:dinheiro, 8:crédito, 9:débito, 10:pix, 11:depósito, 12:venda_internet}`
    (venda_internet existe, só troca de código com pix — não "some")
  - As outras 6 lojas usam script PHP fora deste repositório — **não verificável a partir do
    código aqui**; se alguém disse que seguem um dos dois padrões acima, tratar como hipótese
    a confirmar com `SELECT * FROM contas`, não como fato estabelecido.
  - **Sempre rodar `SELECT * FROM contas` na loja específica antes de escrever/reaproveitar
    mapeamento.** Já causou inversão real de débito/crédito quando pulado (Loja4).
  - `src/lib/gerarScriptPhp.ts` (`gerarScriptPhpPorUsuario`, usado no fluxo de onboarding em
    `/franquias`) **hardcoda o mapeamento da Loja1 sem parâmetro pra customizar** — gera o
    script errado se a franquia nova seguir o padrão da Loja4. Confirmar a tabela `contas`
    real antes de gerar/entregar o script pro fornecedor.
- `movimento.tipo`: nenhuma query atual usa essa coluna (sempre `movimento.conta`) — uma
  investigação anterior encontrou esse campo pouco confiável, mas não foi possível
  reconfirmar isso a partir do código; se for usar `tipo` no futuro, validar contra a base
  real antes de confiar.
- `movimento.es`: `'E'`/`'S'` = entrada/saída de **caixa**. `movprods.es`: `'S'` +
  historico começando com `Saida vd:` **ou** `sd ins:Saida vd:` = venda real. São conceitos
  diferentes, mesma letra de coluna — não confundir entre as duas tabelas.
- **Venda real tem dois prefixos em `movprods.historico`**: `Saida vd:9279 ...` e
  `sd ins:Saida vd:9279 ...` — a mesma venda, com parte dos itens gravados com o prefixo extra.
  `sd ins` = **saldo insuficiente**: item vendido com estoque zerado no sistema (significado
  informado em 18/09/2026). O custo vem preenchido igual, então CMV não é afetado. A proporção
  por loja mede o quanto o estoque dela está desatualizado (1% na Loja2, 53% na Loja4). Filtrar só por `LIKE 'Saida vd:%'` perdeu 16–72% dos itens por loja até 18/09/2026 (~40% na
  Loja4), deixando o faturamento do dashboard abaixo do caixa. Para conferir itens contra
  caixa: `movimento.historico` traz `Venda Vista:NNNN`, e o número casa com o de `movprods`.
- **`movimento` es=E sem número de venda no histórico não é venda** — é suprimento de troco
  (ex: R$ 200 na abertura da Loja4 em 17/09). Hoje ele entra na soma de formas de pagamento.
- **Retiradas/sangria em `movimento` são gravadas com valor negativo** — sempre aplicar `abs()`
  antes de mandar pro payload (schema exige positivo; já esquecido uma vez, travou
  silenciosamente todo o payload daquele ciclo).
- **`movprods.custo` é o custo TOTAL da linha**, não unitário, apesar do nome — dividir por
  quantidade antes de gravar como `custo_unitario`.
- **`vendas_itens` exige upsert com `origem_id` (= `movprods.auto`) + constraint única
  `(franchise_id, origem_id)`, nunca `insert` simples.** Sem isso, cada sync recorrente
  reinsere o dia inteiro — já causou duplicação de até 38x em produção, inflando Faturamento
  Bruto/CMV/Margem no DRE. `formas`, `retiradas` e `transacoes` já usam
  `upsert + ignoreDuplicates` corretamente; qualquer tabela nova alimentada pelo webhook de PDV
  precisa do mesmo padrão desde o início.

### Arquitetura de sync (2 caminhos, não confundir)

- **Loja1 e Loja4** (hospedadas em provedor sem bloqueio de IP): agente TypeScript
  (`sincronizarLoja()` em `src/lib/lojasDiretas.ts`), disparado por `/api/pdv/trigger-sync`
  (autenticado por sessão) e agendado via **GitHub Actions** (Vercel Hobby só permite cron
  diário nativo).
- **As outras 6 lojas** (Locaweb DBaaS, bloqueio de IP confirmado, sem solução por fora): script
  PHP hospedado em ambiente compartilhado externo ao repositório (não existe `.php` aqui —
  mudanças nesse caminho são feitas manualmente, fora do fluxo de PR). Agendado via cron-job.org
  (serviço externo).
- **Webhook único para os dois caminhos**: `/api/pdv/sync` — autenticação por `x-pdv-token`
  (hash SHA-256) + `x-pdv-signature` (HMAC-SHA256 de `timestamp.body`) + `x-pdv-timestamp`
  (janela anti-replay de 5min).

## Modelo de fechamento de caixa (Prestação de Contas)

- Agrupado por `usuario` (login do PDV), não por dispositivo físico — lojas com 1 caixa têm
  **fechamento parcial obrigatório na troca de turno** (confirmado como necessidade real).
- `"SISTEMA"` como usuário = **login genérico real, usado quando o operador não loga na conta
  própria** — não é venda automática sem pessoa. Precisa de card de fechamento completo igual
  qualquer operador.
- Só **dinheiro** tem contagem física (esperado + valor contado). Cartão/débito/crédito/pix
  usam conciliação linha-a-linha (checkbox por transação) — nunca pré-marcado por padrão, isso
  esvaziaria o propósito da conferência.
- "Comparação com a Fita da Maquininha" é em nível de **loja** (não por operador — a maquininha
  física não sabe quem estava logado). Suporta múltiplas fitas por dia (loja com mais de um
  caixa/maquininha).

## Identidade visual

Cor de marca real: `#EC008C` (rosa-magenta, extraída da logo oficial). Uso **restrito**: só na
logo e no número-herói de cada tela. Nunca em navegação, botões, ou uso decorativo genérico —
decisão deliberada do usuário para não sobrecarregar a UI. `/dre` mantém paleta própria
intencionalmente diferente (petróleo `#1B4B54`) — não generalizar a cor de marca pra lá nem
generalizar a paleta do DRE pro resto do app.

## Antes de propor mudança de arquitetura

Este projeto já passou por várias reversões de decisão (ex: tentativa de unificar fechamento
por loja em vez de por operador foi revertida ao confirmar que fechamento parcial por turno é
requisito real, não suposição). Ao propor uma mudança estrutural, confirme primeiro se o
comportamento atual foi decisão deliberada (frequentemente é) antes de assumir que é bug.
