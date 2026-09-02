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

Mapeamento de `conta` (confirmado em produção, tabela `conta` do A7 Pharma):

| código | forma de pagamento     |
|--------|-------------------------|
| 1      | Dinheiro (CAIXA)        |
| 8      | Cartão Débito           |
| 9      | Cartão Crédito          |
| 10     | Venda p/ Internet       |
| 11     | Depósito                |
| 12     | Pix                     |

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
