# 🚀 Subir a campanha na Vercel + Supabase

Guia completo, do zero até a campanha no ar com Pix funcionando.

Tempo estimado: **30 a 40 minutos**.

---

## Por que precisa dos dois

A Vercel roda o site em **serverless**: cada requisição sobe uma função, responde e morre.
Duas consequências importantes:

| O que é | Na sua máquina / VPS | Na Vercel |
| --- | --- | --- |
| Banco de dados | SQLite num arquivo | ❌ o disco some a cada deploy → **precisa do Supabase** |
| Reconciliação periódica | `setInterval` no servidor | ❌ não existe processo vivo → **vira um cron** |

O projeto já está preparado para os dois modos: com `DATABASE_URL` preenchida ele usa
Postgres; sem ela, usa SQLite. Você não precisa mudar nenhuma linha de código.

```
Visitante ──► Vercel (CDN: HTML/CSS/JS)
                 │
                 └──► Vercel Function (/api/*) ──► Supabase (Postgres)
                                │
                                └──► MisticPay (cria o Pix e confirma o pagamento)
                                            │
       MisticPay ──webhook──► /api/webhooks/misticpay/<token> ──► reconfere na API
```

---

## Parte 1 — Supabase (banco de dados)

### 1.1 Criar o projeto

1. Entre em <https://supabase.com> e faça login com o GitHub.
2. **New project**.
   - **Name**: `celular-novo`
   - **Database Password**: clique em *Generate a password* e **guarde essa senha** —
     ela faz parte da string de conexão e não dá para ver de novo.
   - **Region**: `South America (São Paulo)` — é a mais perto, menos latência.
3. Aguarde ~2 minutos enquanto o banco é provisionado.

### 1.2 Criar as tabelas

Jeito mais simples, sem instalar nada:

1. No menu lateral, abra **SQL Editor** → **New query**.
2. Abra o arquivo [`backend/database/schema.postgres.sql`](backend/database/schema.postgres.sql)
   do projeto, copie **todo** o conteúdo e cole no editor.
3. Clique em **Run**. Deve aparecer *Success. No rows returned*.
4. Confira em **Table Editor**: devem existir `donations`, `gateway_events`, `settings`,
   `admins`, `admin_sessions` e `login_attempts`.

> As configurações iniciais da campanha (meta de R$ 2.000, textos, valores rápidos) são
> inseridas automaticamente na primeira vez que a aplicação sobe — ou quando você roda
> `npm run migrate`.

### 1.3 Pegar a string de conexão

1. **Project Settings** (engrenagem) → **Database** → seção **Connection string**.
2. Escolha a aba **URI**.
3. Você verá dois modos — **use o Transaction pooler** (porta **6543**), que é o
   recomendado para serverless:

```
postgresql://postgres.abcdefghijklm:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

4. Troque `[YOUR-PASSWORD]` pela senha que você guardou no passo 1.1.
5. Guarde essa URL — ela é o `DATABASE_URL`. **Ela dá acesso total ao banco: nunca
   coloque num arquivo versionado nem mande para ninguém.**

> Se a senha tiver caracteres especiais (`@`, `#`, `/`, `:`), eles precisam ser
> codificados na URL. Para evitar dor de cabeça, gere uma senha só com letras e números.

### 1.4 ⚠️ Projeto pausado por inatividade

No plano gratuito, o Supabase **pausa o projeto depois de 7 dias sem nenhuma atividade**
e o site passa a dar erro de banco. Duas formas de evitar:

- O cron diário que configuramos na Parte 3 já conta como atividade; ou
- Entre no painel do Supabase de vez em quando e clique em *Restore* se estiver pausado.

---

## Parte 2 — Vercel (o site)

### 2.1 Importar o repositório

1. Entre em <https://vercel.com> e faça login com o GitHub.
2. **Add New… → Project** → autorize o acesso e escolha o repositório
   `castrinvini-oss/celular-novo` → **Import**.
3. Na tela de configuração:
   - **Framework Preset**: `Other`
   - **Build Command**, **Output Directory**, **Install Command**: deixe como está.
     O arquivo [`vercel.json`](vercel.json) já diz tudo o que a Vercel precisa saber.
   - **Node.js Version** (em *Settings → General* depois do primeiro deploy): **22.x**.

### 2.2 Variáveis de ambiente

Ainda na tela de import, abra **Environment Variables** e adicione uma a uma
(marque os três ambientes: *Production*, *Preview*, *Development*):

| Nome | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `DATABASE_URL` | a URI do Supabase (Parte 1.3) |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `2` |
| `SESSION_SECRET` | 96 caracteres aleatórios (veja abaixo) |
| `MISTICPAY_PUBLIC_KEY` | sua chave `pk_...` |
| `MISTICPAY_SECRET_KEY` | sua chave `sk_...` |
| `MISTICPAY_WEBHOOK_TOKEN` | token aleatório (veja abaixo) |
| `CRON_SECRET` | outro token aleatório |
| `PUBLIC_BASE_URL` | preencha depois do primeiro deploy |
| `MISTICPAY_WEBHOOK_URL` | preencha depois do primeiro deploy |

Para gerar os segredos, rode no seu computador:

```bash
node -e "console.log('SESSION_SECRET  =', require('crypto').randomBytes(48).toString('hex'))"
```

```bash
node -e "console.log('WEBHOOK_TOKEN   =', require('crypto').randomBytes(24).toString('hex'))"
```

```bash
node -e "console.log('CRON_SECRET     =', require('crypto').randomBytes(24).toString('hex'))"
```

### 2.3 Primeiro deploy

Clique em **Deploy**. Em ~1 minuto você recebe uma URL do tipo
`https://celular-novo.vercel.app`.

Teste imediatamente:

```
https://SEU-PROJETO.vercel.app/api/health
```

Resposta esperada:

```json
{ "ok": true, "database": "postgres", "time": "..." }
```

Se aparecer `"database": "sqlite"`, o `DATABASE_URL` não foi lido — confira a variável
e refaça o deploy.

### 2.4 Completar as URLs

Agora que você sabe o domínio, volte em **Settings → Environment Variables** e preencha:

| Nome | Valor |
| --- | --- |
| `PUBLIC_BASE_URL` | `https://SEU-PROJETO.vercel.app` |
| `MISTICPAY_WEBHOOK_URL` | `https://SEU-PROJETO.vercel.app/api/webhooks/misticpay/SEU_WEBHOOK_TOKEN` |

Depois vá em **Deployments → … → Redeploy** para as novas variáveis valerem.

> Se você tiver um domínio próprio, adicione em **Settings → Domains** e use ele nas
> duas variáveis acima (fica mais confiável para quem vai doar).

### 2.5 Criar o usuário do painel

O painel `/admin` precisa de um usuário. Crie do seu computador, apontando para o banco
do Supabase:

**Windows (PowerShell):**

```powershell
$env:DATABASE_URL="postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"; npm run create-admin
```

**Linux / macOS:**

```bash
DATABASE_URL="postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" npm run create-admin
```

Escolha um usuário e uma senha forte (mínimo 8 caracteres). Depois acesse
`https://SEU-PROJETO.vercel.app/admin` e faça login.

> Se preferir, dá para cadastrar a `pk_`/`sk_` da MisticPay direto no painel, em
> **Integração (API)**, em vez de usar `MISTICPAY_PUBLIC_KEY` / `MISTICPAY_SECRET_KEY`.
> Funciona porque o `SESSION_SECRET` na Vercel é fixo. Ainda assim, variável de ambiente
> continua sendo o caminho recomendado: não depende do banco estar de pé.

---

## Parte 3 — Cron (rede de segurança)

O webhook da MisticPay confirma os pagamentos na hora, e a própria tela de pagamento
consulta o status a cada 4 segundos. O cron existe só para o caso de **um webhook se
perder**: ele reconfere as pendentes direto na MisticPay e expira as vencidas.

O [`vercel.json`](vercel.json) já traz o agendamento:

```json
"crons": [{ "path": "/api/cron/reconcile", "schedule": "0 4 * * *" }]
```

A Vercel envia automaticamente o header `Authorization: Bearer $CRON_SECRET`. Como você
já criou essa variável, não precisa fazer mais nada.

> **Plano Hobby:** a Vercel só executa cron **uma vez por dia**. Se quiser reconferência
> a cada 5 minutos (recomendado enquanto a campanha estiver ativa), crie uma tarefa
> gratuita no <https://cron-job.org>:
>
> - URL: `https://SEU-PROJETO.vercel.app/api/cron/reconcile?secret=SEU_CRON_SECRET`
> - Intervalo: a cada 5 minutos
>
> Isso também mantém o projeto do Supabase ativo, evitando a pausa por inatividade.

---

## Parte 4 — MisticPay

1. No painel da MisticPay, vá em **API → Chaves de Acesso** e crie uma chave com o
   escopo **cashin**. Copie o `sk_` na hora (ele só aparece uma vez).
2. Coloque `pk_` e `sk_` nas variáveis da Vercel (Parte 2.2).
3. O webhook é enviado em cada cobrança pelo campo `projectWebhook`, então basta a
   variável `MISTICPAY_WEBHOOK_URL` estar correta. Se você preferir cadastrar a URL fixa
   no painel da MisticPay, use exatamente a mesma string.

### Testar de ponta a ponta

Faça uma doação real de **R$ 1,00** e confira:

- [ ] o QR Code aparece;
- [ ] após pagar, a tela muda sozinha para 🟢 *Pagamento confirmado* em poucos segundos;
- [ ] o total na barra de progresso sobe R$ 1,00;
- [ ] a doação aparece como `PAID` no `/admin`;
- [ ] no Supabase (**Table Editor → donations**) a linha está com `status = PAID` e
      `paid_at` preenchido.

---

## ✅ Checklist final

- [ ] `/api/health` responde `"database": "postgres"`
- [ ] Tabelas criadas no Supabase
- [ ] `SESSION_SECRET`, `MISTICPAY_WEBHOOK_TOKEN` e `CRON_SECRET` são aleatórios e diferentes
- [ ] `PUBLIC_BASE_URL` e `MISTICPAY_WEBHOOK_URL` com o domínio real e `https://`
- [ ] Usuário do painel criado e login funcionando
- [ ] Chave `pk_`/`sk_` configurada (a credencial legada `ci`/`cs` sai do ar em 30/09/2026)
- [ ] Doação de teste de R$ 1,00 confirmada de ponta a ponta
- [ ] Cron externo configurado (opcional, mas recomendado)

---

## 🛠️ Problemas comuns

| Sintoma | Causa e solução |
| --- | --- |
| `/api/health` diz `"database": "sqlite"` | `DATABASE_URL` ausente ou escrita errada nas variáveis da Vercel. Corrija e faça **Redeploy**. |
| `relation "donations" does not exist` | O schema não foi executado. Rode o `schema.postgres.sql` no SQL Editor do Supabase. |
| `password authentication failed` | Senha errada na `DATABASE_URL`, ou caracteres especiais não codificados. Redefina a senha em *Settings → Database → Reset database password*. |
| `Connection terminated` / timeout | Você usou a conexão direta (porta 5432). Troque pelo **Transaction pooler** (6543). |
| Site fora do ar depois de uns dias | Projeto do Supabase pausado por inatividade. Restaure no painel e configure o cron externo. |
| Painel desloga sozinho a toda hora | `SESSION_SECRET` diferente entre ambientes, ou não definido. Use o mesmo valor em Production e Preview. |
| Webhook devolve 401 | O token no fim da `MISTICPAY_WEBHOOK_URL` está diferente do `MISTICPAY_WEBHOOK_TOKEN`. |
| Muitas conexões no Supabase | Baixe `DATABASE_POOL_MAX` para `1` ou `2`. Em serverless cada instância abre o próprio pool. |
| Build falha com `Found invalid Node.js Version` | Em **Settings → General → Node.js Version** escolha `22.x`. Se insistir, troque `"engines": { "node": ">=22.5.0" }` por `"22.x"` no `package.json`. |
| Erro 500 sem explicação | **Vercel → Deployments → Functions → Logs**. A mensagem real fica lá; o navegador só recebe o texto genérico, de propósito. |

---

## 📌 Sobre os planos gratuitos

Dois pontos honestos antes de você divulgar a campanha:

1. **Vercel Hobby** é, pelos termos de uso, para projetos pessoais e **não comerciais**.
   Uma vaquinha pessoal costuma se enquadrar, mas se a página virar algo com fins
   comerciais o plano correto é o Pro. Vale ler os [termos](https://vercel.com/docs/limits/fair-use-guidelines).
2. **Supabase Free** pausa o projeto após 7 dias sem atividade e tem 500 MB de banco —
   folgadíssimo para esta campanha, mas mantenha o cron rodando.

Se preferir fugir dessas limitações, o [README.md](README.md) traz o passo a passo de
deploy em VPS com Nginx e systemd, onde o SQLite funciona sem Supabase nenhum.
