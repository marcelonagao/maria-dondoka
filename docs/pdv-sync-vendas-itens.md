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

## Vendas granulares (para `vendas_itens`) — não implementado

**Status: não implementado.** Só registra a query de referência pro futuro agente de
sincronização granular por produto. Bloqueado até termos um servidor com IP fixo
provisionado (mesma limitação que já bloqueou o agente original, resolvida na época
rodando o PHP dentro do próprio hosting Locaweb — aqui a leitura é mais pesada, então
a abordagem de sync pode precisar ser revisitada).

```sql
SELECT
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
  mp.usuario
FROM movprods mp
LEFT JOIN produtos p ON p.codigo = mp.produto
WHERE mp.es = 'S'
  AND mp.historico LIKE 'Saida vd:%'
  AND (mp.cancelado IS NULL OR mp.cancelado = 0)
  AND mp.data = CURDATE(); -- ajustar para o período de sincronização real
```

Mapeamento pra `vendas_itens`: `data` → `data_venda`, `produto_codigo_pdv` → `produto_codigo_pdv`,
`p.referencia` → `produto_sku` (se o produto já estiver mapeado no nosso catálogo),
`mp.custo`/`cmedio` → `custo_unitario` (custo histórico no momento da venda, não o custo
atual), `mp.usuario` → `usuario` (coluna já existe na tabela, informativo).

## Quando o agente de `vendas_itens` for construído

Vai usar exatamente os filtros e mapeamentos acima, por franquia (cada franquia tem
seu próprio banco/credenciais MySQL). A escrita em `vendas_itens` deve ser feita via
`service_role` (sem policy de INSERT para `authenticated` nesta tabela).
