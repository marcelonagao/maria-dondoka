# Histórico e Pendências — maria-dondoka

Log de decisões e status, não regras fixas (essas ficam no `CLAUDE.md`). Atualize quando um item
for resolvido — remova daqui, não deixe acumular.

## Franquias

8 lojas reais (Caraguatatuba ×2, Taubaté ×3, Pindamonhangaba, Jacareí, Lorena) + 1 franquia de
teste antiga, marcada `[TESTE - NÃO USAR]` no nome — não apagada por risco de cascade em tabelas
relacionadas, mas não deve receber dado novo.

## Resolvido — não redescobrir

- Sync de PDV das 8 lojas testado e funcionando (2 caminhos, ver `CLAUDE.md`).
- Backfill histórico de `vendas_itens` (jan–set) rodado — cobertura real varia por loja (algumas
  só têm dado a partir de quando o sistema A7 Pharma foi adotado naquela unidade, não desde
  janeiro).
- Itens com histórico `sd ins:Saida vd:` (ver `CLAUDE.md`) recuperados em 18/09/2026 nas 7
  lojas com histórico — ~205 mil itens, R$ ~1,58 mi de faturamento passado. Validado: contagem
  final = esperado − 38 itens descartados por valor incoerente (com alerta), e itens ÷ caixa
  entre 93% e 105% por dia. Loja8 ficou de fora (ver Pendente).
- Bug de duplicação em `vendas_itens` (upsert com `origem_id`) corrigido e validado em produção.
- Grade unificada de conciliação (dinheiro + cartão/débito/crédito/pix numa grade só, com
  diferença total reativa) implementada.
- Identidade visual real (logo + cor `#EC008C`) aplicada, substituindo paleta âmbar provisória
  usada antes da logo real ser fornecida.
- Vigia automático de duplicidade (`/api/cron/auditoria-duplicidade`, 1x/dia, compara
  `COUNT(*)` vs `COUNT(DISTINCT origem_id)` por franquia/dia) implementado e no ar — banner
  em `/dashboard` pra quem tem `escopo=todas_franquias`.
- Conferência diária itens × caixa (18/09/2026), no mesmo cron da duplicidade: alerta
  `itens_divergem_caixa` quando os itens de uma loja/dia ficam fora de 90–110% das formas de
  pagamento (dias com caixa ≥ R$ 500). É o que pega um prefixo novo de venda no histórico do PDV.
- Painel de vendas (19/09/2026): `resumo_vendas` estourava o timeout de 8s depois do backfill
  "sd ins:". Agora lê `vendas_resumo_dia` (uma linha por loja/dia), atualizada pelo mesmo
  `atualizar_resumo_linha_dia` que o sync já chama — 7s → ~0,3s. Faturamento, CMV, impostos e
  série idênticos. Corrigiu de quebra a quantidade de vendas consolidada: a versão antiga fazia
  `count(distinct venda_referencia)` misturando lojas e contava uma vez só o mesmo número de
  venda em lojas diferentes (30 dias: 38.387 → 44.898; ticket médio R$ 44,16 → R$ 37,75).
  Definições em `docs/sql/rollup-resumo-vendas.sql`.
- Detalhe de produtos por categoria (19/09/2026): `top_produtos_da_linha` estourava 57014 na
  MAQUIAGEM (maior categoria). Índice `idx_vendas_itens_linha_coalesce_data` sobre a mesma
  expressão do filtro — 60 mil linhas lidas em vez de 197 mil; ~0,5–0,9s com cache, até ~6s
  no primeiro clique frio. Corrigido também o agrupamento: juntava produtos de lojas
  diferentes com o mesmo código interno (ex.: "Squishy Bum Grande" somado ao "Squishy Bum").
  "N produtos no período" passou a contar por nome. `docs/sql/top-produtos-indice.sql`.
- Vigia de duplicidade corrigido (19/09/2026): lia `vendas_itens` sem paginar e só via 1000 das
  ~47 mil linhas da janela. Agora conta no banco — função `auditar_duplicidade_vendas_itens`
  (~0,8s, índice `idx_vendas_itens_data_franquia`).

## Pendente

- Resposta do fornecedor sobre como "Vendas Convênio" (compra de funcionário descontada em
  folha) e "Pix CNPJ" (delivery/Instagram) são identificados na origem — investigação extensa já
  feita (sem marca em `historico`, sem tabela dedicada `pedpedidos` vazia) — provavelmente
  processo manual fora do sistema A7, não capturável nos dados atuais sem mudança do lado do
  fornecedor.
- Provisão de férias/13º — aguardando data-base real de cada funcionário vinda da contabilidade
  (decisão deliberada: não usar data de hoje como base, esconderia férias já vencidas).
- Loja8: vendas de teste antes da inauguração (15/09 e 17/09) — decidir se cancela no PDV.
  Depois disso, gravar ou não os 22 itens `sd ins:` de 17/09 que o backfill deixou de fora.
- Reenviar os 39 itens descartados por desconto grande (38 do backfill de 18/09 + 1 da Loja4 em
  15/09), recusados pela regra antiga — junto com a Loja8. Os 30 alertas `item_valor_invalido`
  já foram marcados como resolvidos em 18/09 para limpar o dashboard; a lista de vendas e
  origem_id a reenviar continua neles (`alertas_sistema`, `resolvido = true`).
- Rotação dos 6 `pdvSecret` das lojas do hosting (a senha do MySQL das lojas não se altera —
  o fornecedor do PDV depende dela).
- CNPJ de 2 lojas (Taubaté mais nova, Lorena) ainda pendente — bloqueia só o matching automático
  de DP por CNPJ pra essas duas, não bloqueia PDV.
