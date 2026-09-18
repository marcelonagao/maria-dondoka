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
- Rotação dos 6 `pdvSecret` das lojas do hosting (a senha do MySQL das lojas não se altera —
  o fornecedor do PDV depende dela).
- CNPJ de 2 lojas (Taubaté mais nova, Lorena) ainda pendente — bloqueia só o matching automático
  de DP por CNPJ pra essas duas, não bloqueia PDV.
