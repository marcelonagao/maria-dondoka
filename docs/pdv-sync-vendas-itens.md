# Referência: sincronização de `vendas_itens` a partir do PDV (A7 Pharma / Alpha 7)

**Status: não implementado.** Este documento só registra as queries de referência pro
futuro agente de sincronização. Bloqueado até termos um servidor com IP fixo
provisionado (mesma limitação que já bloqueou o agente de sincronização original,
resolvida na época rodando o PHP dentro do próprio hosting Locaweb — aqui a leitura
é mais pesada, então a abordagem de sync pode precisar ser revisitada).

Quando o agente for construído, ele vai precisar ler três tabelas por franquia no
banco MySQL do PDV: `movprods`, `movimento` e `produtos`.

## Vendas granulares (para `vendas_itens`)

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
  mp.vendedor
FROM movprods mp
LEFT JOIN produtos p ON p.codigo = mp.produto
WHERE mp.es = 'S'
  AND mp.historico LIKE 'Saida vd:%'
  AND (mp.cancelado IS NULL OR mp.cancelado = 0)
  AND mp.data = CURDATE(); -- ajustar para o período de sincronização real
```

Mapeamento pra `vendas_itens`: `data` → `data_venda`, `produto_codigo_pdv` → `produto_codigo_pdv`,
`p.referencia` → `produto_sku` (se o produto já estiver mapeado no nosso catálogo),
`mp.custo`/`cmedio` → `custo_unitario` (custo histórico no momento da venda, não o custo atual).

## Dinheiro em espécie do dia (para `vendas_diarias_pdv` / batimento de caixa)

```sql
SELECT SUM(valor) FROM movimento WHERE conta = 1 AND data = CURDATE();
```

## Outras formas de pagamento (para `vendas_diarias_pdv`)

```sql
SELECT conta, SUM(valor) FROM movimento WHERE conta IN (8,9,10,11,12) AND data = CURDATE() GROUP BY conta;
```

Mapeamento de `conta` (confirmado em produção, tabela `conta` do A7 Pharma):

| código | forma de pagamento     |
|--------|-------------------------|
| 1      | Dinheiro (CAIXA)        |
| 8      | Cartão Débito           |
| 9      | Cartão Crédito          |
| 10     | Venda p/ Internet       |
| 11     | Depósito                |
| 12     | Pix                     |

## Quando o agente for construído

Ele vai usar exatamente os filtros e mapeamentos acima, por franquia (cada franquia
tem seu próprio banco/credenciais MySQL, igual ao padrão já usado no sync de
`vendas_diarias_pdv`/`movimentacoes_caixa`). A escrita em `vendas_itens` deve ser
feita via `service_role` (sem policy de INSERT para `authenticated` nesta tabela).
