# Referência: sincronização do PDV (A7 Pharma / Alpha 7)

## Formas de pagamento por usuário — implementado (PHP em produção, `/api/pdv/sync`)

1 dispositivo/credencial por franquia (não mais por vendedor). O script PHP roda
dentro do hosting Locaweb e agrupa por `usuario` no MySQL, mandando tudo numa
chamada só — a granularidade por operador vem do campo `usuario`, não de
credenciais separadas.

```sql
-- Formas de pagamento do dia, agrupadas por usuário (não faz loop, uma query só)
SELECT usuario, conta, COALESCE(SUM(valor), 0) AS total
FROM movimento
WHERE data = CURDATE() AND es = 'E'
GROUP BY usuario, conta;

-- Retiradas (sangria) do dia, por usuário
SELECT auto, valor, historico, usuario
FROM movimento
WHERE data = CURDATE() AND es = 'S' AND conta = 1;
```

**Achado em produção (2026-09-02, corrigido em campo)**: a documentação original assumia
colunas `id` e `data_hora` em `movimento`, baseado só nas telas vistas antes — erradas.
A chave primária real é **`auto`** (`int auto_increment`), e **não existe coluna de
hora** (só `data`, tipo `DATE`) — por isso o payload de retiradas não manda `criado_em`
(o webhook usa o horário da sincronização como aproximação). Estrutura real completa de
`movimento` (via `SHOW COLUMNS`, banco `brtestes` de produção):
`auto` (PK), `data`, `conta`, `cliente`, `partida`, `valor`, `es`, `historico`, `compra`,
`usuario`, `venda`, `vendedor`, `comissão`, `recibo`, `banco`, `cheque`, `agencia`, `tipo`,
`desconto_cheque`, `data_desconto`, `responsavel`, `comissão_resp`, `principal`, `juros`,
`juros_calc`, `empresa`. Vale conferir contra essa lista antes de assumir outros nomes de
coluna nesta tabela no futuro (ex: pro agente de `vendas_itens`).

Mapeamento de `conta` (confirmado em produção, tabela `conta` do A7 Pharma) — **não é
igual entre lojas** (achado em 2026-09-09, ver seção de lojas diretas abaixo): cada loja
cadastra sua própria tabela `conta`, então 8/9/10/12 podem apontar pra formas diferentes
de loja pra loja. A tabela abaixo é a de Loja1-Caraguatatuba; confirmar a tabela `conta`
real de cada loja antes de reaproveitar este mapeamento (não assumir que é universal).

| código | forma de pagamento (Loja1-Caraguatatuba) |
|--------|-------------------------------------------|
| 1      | Dinheiro (CAIXA)                          |
| 8      | Cartão Débito                             |
| 9      | Cartão Crédito                            |
| 10     | Venda p/ Internet                         |
| 11     | Depósito                                  |
| 12     | Pix                                       |

Payload enviado pro webhook: `formas: [{ usuario, forma_pagamento, valor }]` e
`retiradas: [{ origem_id, valor, motivo, usuario }]` (`criado_em` é opcional no schema
e não é enviado — `movimento` não tem coluna de hora, só de data) — `usuario` em cada
entrada, não um campo único do payload (uma sincronização cobre a loja inteira, todos
os operadores do dia).

## Vendas granulares (`vendas_itens`) — implementado (2026-09-02)

`/api/pdv/sync` aceita um campo `itens` no payload (opcional, default `[]`), gravado em
`vendas_itens` via `service_role` (sem policy de INSERT para `authenticated`). Schema real
de `movprods`/`produtos` confirmado em produção via `SHOW COLUMNS` — a query de referência
abaixo já estava correta desde a versão anterior desta doc, sem ajustes necessários (ao
contrário de `movimento`). Chave primária real de `movprods` também é `auto` (mesma
pegadinha de `movimento`), agora capturada em `vendas_itens.origem_id` para rastreabilidade.

```sql
SELECT
  mp.auto,
  mp.data,
  SUBSTRING_INDEX(SUBSTRING_INDEX(mp.historico, 'vd:', -1), ' ', 1) AS venda_referencia,
  mp.produto AS produto_codigo_pdv,
  p.referencia AS produto_sku,
  mp.marca,
  mp.qtd AS quantidade,
  mp.unitario AS valor_unitario,
  mp.vlr_total AS valor_total,
  mp.custo AS custo_unitario,
  p.icm AS aliquota_icm,
  mp.usuario,
  mp.vendedor
FROM movprods mp
LEFT JOIN produtos p ON p.codigo = mp.produto
WHERE mp.es = 'S'
  AND mp.historico LIKE 'Saida vd:%'
  AND (mp.cancelado IS NULL OR mp.cancelado = 0)
  AND mp.data = ?; -- CURDATE() na sincronização diária; dia específico no backfill
```

Mapeamento pra `vendas_itens`: `mp.auto` → `origem_id`, `data` → `data_venda`,
`produto_codigo_pdv` → `produto_codigo_pdv`, `p.referencia` → `produto_sku`, `mp.custo` →
`custo_unitario` (custo histórico no momento da venda, não o custo atual), `mp.usuario` →
`usuario` (rastreio, mesmo padrão de `formas`/`retiradas`), `mp.vendedor` → `vendedor`
(campo distinto de `usuario`, ambos existem em `movprods`).

**Achado em produção (2026-09-04)**: `mp.custo` é o custo TOTAL da linha
(`quantidade × custo real por unidade`), não o custo de uma unidade só — apesar do nome
da coluna. Confirmado comparando o mesmo SKU em quantidades diferentes no mesmo dia
(`custo_unitario / quantidade` sempre bate no mesmo valor, ex: qtd=12 custo=372, qtd=3
custo=93, qtd=1 custo=31 — todos batem em 31). Isso inflava CMV/margem em qualquer venda
com quantidade > 1 (DRE, gráfico indexado do dashboard faziam `quantidade * custo_unitario`,
multiplicando a quantidade de novo). Corrigido em `/api/pdv/sync/route.ts`, que agora
divide por `quantidade` antes de gravar — o SQL de origem acima não precisa mudar, a
normalização acontece na gravação, não na consulta.

Payload: `itens: [{ venda_referencia, produto_codigo_pdv, produto_sku, marca, quantidade,
valor_unitario, valor_total, custo_unitario, aliquota_icm, usuario, vendedor, origem_id }]`.

**Sincronização diária**: `pdv-sync-locaweb-producao.php` roda essa query com `CURDATE()`
e inclui `itens` no mesmo payload de `formas`/`retiradas` — uma chamada só.

**Backfill histórico**: `pdv-backfill-vendas-itens.php`, script separado, disparado
manualmente (visita direta à URL, não Netscheduler — evita o limite de 30s do agendador).
Aceita `?mes=YYYY-MM&chave=...`, itera dia a dia dentro do mês e manda um payload por dia
(`formas: [], retiradas: [], itens: [...]`) pro mesmo webhook. Rodar uma vez por mês
(Jan–Ago/26), conferindo o DRE entre uma execução e outra — reexecutar o mesmo mês duplica
as linhas (sem constraint única em `vendas_itens`).

**Achado em produção (2026-09-10)**: sem constraint única, `vendas_itens` duplicava a cada
ciclo de sync automático (não só em reexecução manual do backfill) — cada sincronização
reinseria as vendas do dia inteiras, confirmado até 38x de duplicação nas lojas rodando via
cron-job.org a cada 15min. Diferente de `movimentacoes_caixa`/`vendas_transacoes_pagamento`,
que já usavam upsert com dedupe por `origem_id` desde o início. Corrigido no caminho
TypeScript (Loja1/Loja4): `origem_id` (mp.auto) já vinha sendo enviado por
`sincronizarLoja()` desde a implementação original, só não era usado do lado da gravação —
`/api/pdv/sync` trocou `insert` por `upsert(..., { onConflict: 'franchise_id, origem_id',
ignoreDuplicates: true })`, mesmo padrão das outras duas tabelas. Caminho PHP das outras 6
lojas corrigido separadamente, fora deste repositório. Constraint única
`unique (franchise_id, origem_id)` em `vendas_itens` só deve ser aplicada depois de um
truncate manual (dado histórico anterior não tem `origem_id` preenchido) — até lá, upserts
de itens falham silenciosamente no log (não derrubam o resto do sync) em vez de duplicar.

## Conciliação linha a linha de formas não-dinheiro — implementado (2026-09-08)

`vendas_diarias_formas_pagamento` guarda só o total agregado por forma/usuário/dia — não dá
pra conferir transação por transação (ex: bater um extrato de maquininha linha a linha).
Nova tabela `vendas_transacoes_pagamento` grava cada transação individual de forma
não-dinheiro (dinheiro continua só agregado — não tem o que conciliar linha a linha nele,
é contagem física de gaveta).

**Contrato pro PHP das outras 6 lojas** (ainda só implementado no TypeScript de
Loja1/Loja4, `sincronizarLoja()` em `src/lib/lojasDiretas.ts` — aplicar essa mesma query no
PHP quando chegar a vez de cada loja):

```sql
SELECT auto, conta, valor, usuario, historico
FROM movimento
WHERE data = CURDATE() AND es = 'E' AND conta IN (8, 9, 10, 11, 12)
ORDER BY conta, auto
```

Mesmos `conta` de `formas` (exceto 1/dinheiro, que não entra aqui) e mesmo
`$MAPA_CONTA_FORMA` de resolução. Payload: `transacoes: [{ usuario, forma_pagamento, valor,
origem_id, historico }]` — `auto` vira `origem_id` (dedupe, mesmo padrão de `retiradas`),
`historico` vai puro (ex: `"Venda Vista:215545 VENDA RAPIDA Vd DEISE"`) pra exibição na UI.
**Achado**: `historico` não tem horário embutido — `movimento` não tem coluna de hora (só
`data`), então não existe "horário da transação" pra extrair; a UI mostra o `historico` cru
como descrição, sem inventar um horário.

**Gravação**: `/api/pdv/sync` faz upsert em `vendas_transacoes_pagamento` com
`onConflict: 'franchise_id, origem_id', ignoreDuplicates: true` — mesmo padrão de
`movimentacoes_caixa`.

**Conciliação é independente de fechamento de dinheiro** (decisão de escopo, não a mesma
coisa — cartão/pix não têm contagem física, o valor já é exato). `fechamento_id` na tabela
fica sempre `null` nesse fluxo; o estado "conciliado" é só `conciliado_por`/`conciliado_em`.
UI em `/vendas`: cada chip de forma não-dinheiro com transações pendentes vira clicável,
expande uma lista com checkbox + histórico + valor, e um botão "Conciliar Selecionadas"
chama `POST /api/fechamentos/conciliar-transacoes` (`{ ids }`), que seta
`conciliado_por`/`conciliado_em` nas linhas selecionadas (travado por `franchise_id` do
servidor, nunca confia no client; idempotente contra clique duplo via
`conciliado_em is null` na própria condição do update).

## Lojas sem barreira de IP (Loja1-Caraguatatuba, Loja4-Jacareí) — implementado (2026-09-08)

Diferente das outras franquias (hospedagem Locaweb, MySQL só acessível de dentro do
próprio hosting — por isso o PHP roda lá e empurra pro webhook), Loja1 e Loja4 estão em
`hospedagemdesites.ws`, que não filtra por IP. Pra essas duas, não existe script PHP: um
endpoint (`src/app/api/cron/sync-lojas-diretas/route.ts`, protegido por `CRON_SECRET`)
conecta direto via `mysql2/promise`, roda as mesmas 3 queries acima (formas por usuário,
retiradas, itens), monta o mesmo payload, assina com HMAC (mesma lógica do PHP, em
TypeScript) e chama o próprio `/api/pdv/sync` — mesma porta de entrada, mesma validação
de token/assinatura, nenhum caminho especial. Credenciais de banco e de device
(token/secret gerados em Configurações, franquia real de cada loja) vêm de env vars na
Vercel (`LOJA1_*`/`LOJA4_*`), nunca hardcoded.

**Quem chama o endpoint a cada 15 min**: não é o Cron nativo da Vercel — o plano Hobby só
permite agendamento diário, rejeita qualquer `schedule` mais frequente (a tentativa de
usar `vercel.json` pra isso nem chegou a gerar deployment). Em vez disso, um workflow do
GitHub Actions (`.github/workflows/sync-lojas-diretas.yml`, `schedule: cron: '*/15 * * *
*'`) chama o endpoint com o header `Authorization: Bearer $CRON_SECRET` (secret do
repositório, mesmo valor cadastrado na Vercel). Timing é best-effort do runner do GitHub
(pode atrasar alguns minutos em picos de fila), mas sem custo adicional — alternativa
seria upgrade pro plano Pro da Vercel.

**Achado em produção (2026-09-08)**: `movimento` grava saída de caixa (`es='S'`,
retiradas/sangria) com `valor` **negativo** — convenção da própria origem, não
documentada até então. O schema de `/api/pdv/sync` exige `valor: z.number().positive()`,
e a validação do payload é atômica (formas + retiradas + itens numa checagem só) — uma
retirada negativa sem tratamento rejeita a sincronização inteira daquele ciclo, não só a
retirada.
Corrigido em `src/lib/lojasDiretas.ts` com `Math.abs()` no `valor` das retiradas antes de
montar o payload.

**Achado em produção (2026-09-09)**: o mapeamento `conta → forma_pagamento` **não é igual
entre lojas** — confirmado com a tabela `conta` real de cada uma. Loja4 tem 8/9
(débito/crédito) e 10/12 (pix/venda internet) invertidos em relação a Loja1:

| código | Loja1-Caraguatatuba | Loja4-Jacareí     |
|--------|----------------------|--------------------|
| 8      | cartao_debito        | cartao_credito     |
| 9      | cartao_credito       | cartao_debito      |
| 10     | venda_internet       | pix                |
| 12     | pix                  | venda_internet     |

Corrigido: `mapaContaForma` deixou de ser uma constante global e passou a ser uma
propriedade de cada entrada em `LOJAS_DIRETAS` (`src/lib/lojasDiretas.ts`) — cada loja usa
o seu próprio mapa, nunca compartilhado. Antes desse fix, toda transação de cartão/pix de
Loja4 estava gravada com a forma errada em `vendas_diarias_formas_pagamento` e
`vendas_transacoes_pagamento` desde que o sync direto entrou no ar — dados já sincronizados
de Loja4 continuam com o mapeamento antigo (invertido) até uma correção/re-sync retroativa,
ainda não feita.
