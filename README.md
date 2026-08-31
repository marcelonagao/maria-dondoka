# Maria Dondoka

Sistema de gestão financeira multi-franquia, construído em [Next.js](https://nextjs.org/) com [Supabase](https://supabase.com/) (autenticação e banco de dados).

## O que o sistema faz

- **Dashboard**: visão geral de contas a receber, contas a pagar e saldo projetado, com gráfico de fluxo de caixa.
- **Tesouraria**: cadastro e acompanhamento de contas a pagar e a receber.
- **Vendas (PDV)**: conferência dos fechamentos de caixa enviados pelas lojas.
- **Franquias**: cadastro e administração das unidades franqueadas.
- **Configurações**: ajustes gerais da conta/franquia.

O acesso é protegido por autenticação do Supabase (ver `src/middleware.ts`), e cada usuário está vinculado a uma franquia através da tabela `profiles`.

## Agente de sincronização do PDV (`agent/`)

Um script Node.js separado, feito para rodar dentro de cada loja: ele lê os fechamentos de caixa pendentes de um banco MySQL local (do PDV físico) e os envia, com assinatura HMAC, para a rota `api/pdv/sync` do sistema central. Veja `agent/index.js` e configure `agent/.env` com base nas variáveis usadas nesse arquivo antes de rodá-lo (`npm start` dentro de `agent/`).

## Configuração local

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie um arquivo `.env.local` na raiz com as credenciais do seu projeto Supabase:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=<url do seu projeto>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<chave anon>
   SUPABASE_SERVICE_ROLE_KEY=<chave service_role>
   ```
   A `SUPABASE_SERVICE_ROLE_KEY` é necessária para as rotas administrativas (`api/admin/*`, `api/pdv/sync`, `api/fechamentos/*`) e **nunca** deve ser exposta no navegador nem commitada.
3. Rode o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
4. Acesse [http://localhost:3000](http://localhost:3000) — a rota raiz redireciona para `/login`.

## Estrutura

```
src/app/(auth)/login          Tela de login
src/app/(dashboard)           Dashboard, tesouraria, vendas, franquias, configurações
src/app/api                   Rotas administrativas e de sincronização do PDV
src/lib                       Clientes Supabase (browser e servidor)
src/middleware.ts             Proteção de rotas autenticadas
agent/                        Agente Node.js de sincronização do PDV local
```
