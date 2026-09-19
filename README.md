# 📱 Celular Novo — plataforma de doações via Pix

Campanha de arrecadação para comprar um **Samsung Galaxy A36 5G 256GB** e melhorar a
qualidade dos conteúdos de uma página de memes.

- 🎯 Meta: **R$ 2.000,00**
- 💸 Doação mínima: **R$ 1,00** · máxima: **R$ 1.000,00**
- 💳 Gateway: **MisticPay** (Pix) — <https://docs.misticpay.com/>
- 🖥️ Stack: Node.js + Express + frontend em HTML/CSS/JS puro (sem build)
- 🗄️ Banco: **SQLite** por padrão (zero configuração) ou **PostgreSQL/Supabase** (basta definir `DATABASE_URL`)
- ☁️ Deploy: VPS, Render/Railway ou **Vercel + Supabase** — veja [DEPLOY-VERCEL-SUPABASE.md](DEPLOY-VERCEL-SUPABASE.md)

---

## ⚠️ A regra mais importante

**Nenhum valor entra no total da campanha sem confirmação real do pagamento.**

Concretamente:

1. O clique no botão **não** confirma nada — só cria uma cobrança `PENDING`.
2. O corpo do webhook **não** confirma nada sozinho. Ele só diz *qual* transação olhar.
3. Antes de marcar uma doação como paga, o backend consulta
   `POST /api/transactions/check` na própria MisticPay e exige `transactionState = COMPLETO`.
4. O total arrecadado é sempre `SELECT SUM(amount) FROM donations WHERE status = 'PAID'` —
   nunca um contador incrementado. Contar duas vezes é estruturalmente impossível.
5. O frontend não tem como alterar o total: ele só lê.

Não existe modo de simulação, pagamento fake ou botão de "marcar como pago" no painel.

---

## 🧭 Como funciona o fluxo

```
1. Ver o celular          📱 Samsung Galaxy A36 5G 256GB
        ↓
2. Entender o objetivo    🎯 Meta de R$ 2.000
        ↓
3. Ver o progresso        📊 Barra de arrecadação animada
        ↓
4. Escolher o valor       R$ 1 | 5 | 10 | 20 | 50 | 100 | 200 | 500 | 1.000 (ou outro)
        ↓
5. Gerar Pix              POST /api/donations  →  backend  →  MisticPay
        ↓
6. Pagar                  QR Code + Pix Copia e Cola
        ↓
7. Confirmar              webhook + polling  →  check na MisticPay  →  🎉 PAID
```

---

## 📁 Estrutura

```
celular-novo/
├── api/
│   └── index.js                   # ponto de entrada serverless (Vercel)
├── vercel.json                    # rotas, estáticos e cron da Vercel
├── backend/
│   ├── app.js                     # aplicação Express (compartilhada)
│   ├── server.js                  # processo tradicional: listen + rotina periódica
│   ├── config/
│   │   ├── env.js                 # variáveis de ambiente (único lugar com credenciais)
│   │   └── campaign.defaults.js   # textos/valores iniciais da campanha
│   ├── database/
│   │   ├── db.js                  # escolhe o driver e isola as diferenças de dialeto
│   │   ├── drivers/               # sqlite.js (node:sqlite) e postgres.js (pg)
│   │   ├── schema.sqlite.sql      # tabelas (SQLite)
│   │   ├── schema.postgres.sql    # tabelas (Postgres/Supabase)
│   │   └── repositories/          # donations, settings, admin
│   ├── gateways/
│   │   ├── gateway.interface.js   # contrato — troque de gateway sem reescrever nada
│   │   ├── index.js               # fábrica de gateways
│   │   └── misticpay/             # client HTTP + adaptador da MisticPay
│   ├── services/
│   │   ├── campaign.service.js    # meta, progresso, apoiadores, configurações
│   │   └── donation.service.js    # validação, cobrança, confirmação, reconciliação
│   ├── api/
│   │   ├── routes/                # campaign, donations, admin, cron
│   │   └── middleware/            # auth, rate limit, erros
│   ├── webhooks/
│   │   └── misticpay.webhook.js   # POST /api/webhooks/misticpay
│   └── utils/                     # dinheiro, CPF, datas, sanitização, log
├── frontend/
│   ├── index.html                 # página da campanha
│   ├── admin/index.html           # painel administrativo
│   └── assets/
│       ├── css/styles.css         # design system da campanha
│       ├── css/admin.css          # complemento do painel
│       ├── js/                    # app.js, admin.js, api.js, format.js, ui.js
│       └── img/galaxy-a36.svg     # ilustração do aparelho
├── scripts/
│   ├── migrate.js                 # cria as tabelas
│   ├── create-admin.js            # cria o usuário do painel
│   ├── check-gateway.js           # diagnóstico da integração
│   └── test-database.js           # testes das regras nos dois bancos (npm test)
├── data/                          # banco SQLite (gerado, fora do git)
├── DEPLOY-VERCEL-SUPABASE.md      # passo a passo do deploy serverless
└── .env.example
```

---

## 🚀 Instalação local

**Requisitos:** Node.js **22.5 ou superior** (usa o módulo nativo `node:sqlite`).

```bash
git clone https://github.com/castrinvini-oss/celular-novo.git
cd celular-novo
npm install
cp .env.example .env     # no Windows: copy .env.example .env
npm run migrate
npm run create-admin
npm run dev
```

Para conferir se as regras críticas continuam de pé (uma doação só entra no total quando
está paga, confirmar duas vezes não soma duas vezes, cobrança vencida expira...):

```bash
npm test
```

Os testes rodam a mesma bateria **nos dois bancos**: SQLite em arquivo temporário e
PostgreSQL de verdade via PGlite (WebAssembly), sem precisar instalar servidor nenhum.

E para conferir a aplicação no mesmo formato em que ela roda na Vercel (a função
serverless de `api/index.js`, com PostgreSQL por trás):

```bash
npm run test:api
```

Abra <http://localhost:3000> (campanha) e <http://localhost:3000/admin> (painel).

Sem credenciais da MisticPay a página abre normalmente; só a geração do Pix fica
bloqueada com uma mensagem clara.

---

## 🟢 Configurar a MisticPay

### 1. Criar a chave de acesso (forma recomendada)

No painel da MisticPay: **API → Chaves de Acesso → Criar Chave de Acesso** (pede código 2FA).

- Marque o escopo **cashin** (é o único que esta aplicação usa).
- Copie o `sk_...` **na hora** — ele não é exibido de novo.

No `.env`:

```env
MISTICPAY_PUBLIC_KEY=pk_sua_chave_publica
MISTICPAY_SECRET_KEY=sk_sua_chave_secreta
```

A aplicação envia essas chaves no header `Authorization: Basic base64(pk:sk)`,
exatamente como a documentação descreve.

### 2. Credencial legada `ci`/`cs` (opcional)

Se você ainda usa o par `ci_...`/`cs_...`, preencha:

```env
MISTICPAY_CLIENT_ID=ci_...
MISTICPAY_CLIENT_SECRET=cs_...
```

> ⚠️ **A autenticação ci/cs será desligada em 30/09/2026** e só funciona em
> `/transactions/create` e `/transactions/check`. Migre para a chave de acesso.

Quando as duas existem, a chave de acesso tem prioridade.

### 3. Ou cadastre pelo painel

Se preferir não mexer em variável de ambiente, dá para colar a `pk_`/`sk_` em
`/admin → Integração (API)`. Os detalhes (criptografia, prioridade do `.env`, teste de
conexão) estão na seção do painel administrativo, mais abaixo.

### 4. Conferir a configuração

```bash
npm run check-gateway
```

Mostra o que está configurado (sem imprimir segredo). Para consultar uma transação real:

```bash
npm run check-gateway -- 31484480
```

### Endpoints usados (todos da documentação oficial)

| Uso | Método e rota |
| --- | --- |
| Criar cobrança Pix | `POST https://api.misticpay.com/api/transactions/create` |
| Confirmar pagamento | `POST https://api.misticpay.com/api/transactions/check` |

O `payerName` e o `payerDocument` (CPF) são **obrigatórios pela MisticPay** — por isso o
formulário pede nome completo e CPF. O CPF é validado pelos dígitos verificadores, usado
só na chamada ao gateway e **nunca é gravado inteiro**: o banco guarda apenas a máscara
`***.456.789-**`, visível só no painel.

---

## 🔔 Configurar o webhook

A MisticPay envia `POST` com este corpo quando o depósito muda de status:

```json
{
  "transactionId": 31484480,
  "transactionType": "DEPOSITO",
  "status": "COMPLETO",
  "value": 455,
  "fee": 23,
  "e2e": "..."
}
```

A documentação **não** prevê assinatura criptográfica nos webhooks. A proteção aqui é dupla:

1. **Token secreto na URL** (`MISTICPAY_WEBHOOK_TOKEN`), comparado em tempo constante.
   Também aceito no header `x-webhook-token`.
2. **Reconferência obrigatória** na API da MisticPay antes de creditar qualquer valor.

Configure no `.env`:

```env
PUBLIC_BASE_URL=https://suacampanha.com.br
MISTICPAY_WEBHOOK_TOKEN=um_token_aleatorio_longo
MISTICPAY_WEBHOOK_URL=https://suacampanha.com.br/api/webhooks/misticpay/um_token_aleatorio_longo
```

Gere o token com:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

A URL é enviada em `projectWebhook` a cada cobrança criada. Se você preferir cadastrar a
URL fixa no painel da MisticPay, use exatamente a mesma.

### Testar o webhook na sua máquina

`localhost` não é acessível pela MisticPay. Use um túnel:

```bash
npx localtunnel --port 3000
# ou: ngrok http 3000
```

Depois coloque a URL pública em `PUBLIC_BASE_URL` e `MISTICPAY_WEBHOOK_URL`.

> Mesmo sem webhook a campanha funciona: o frontend consulta o status a cada ~4,5 s e o
> servidor reconcilia as pendentes a cada 2 minutos direto na MisticPay.

---

## 👨‍💻 Painel administrativo

Acesse `/admin`. Crie o usuário com:

```bash
npm run create-admin
# ou direto: npm run create-admin -- meuusuario "minha senha forte"
```

O painel mostra:

- **KPIs**: meta, arrecadado (separando o que veio do Pix e o que foi lançado à mão),
  apoiadores e progresso.
- **Doações**: quem doou (nome público, nome do pagador, CPF mascarado e recado), valor,
  status, origem, transaction ID e datas — com filtros (todas / pagas / pendentes /
  canceladas / falhas / expiradas), busca, exportação CSV, **Reconferir** por doação e
  **Reconferir pendentes** em lote.
- **Doação recebida por fora**: registra Pix direto, dinheiro ou outro app como lançamento
  `MANUAL` (veja abaixo).
- **Configurações**: nome do projeto, título, descrição, texto da campanha, nome e
  imagem do celular, meta, valores mínimo e máximo, valores rápidos e textos de meta atingida.
- **Integração (API)**: cadastro das credenciais da MisticPay direto pelo painel, com teste
  de conexão.
- **Conta**: troca de senha.

### Doações recebidas fora da plataforma

Se alguém te mandar Pix direto na sua chave, te pagar em dinheiro ou usar outro app, use
**Doações → Registrar doação recebida por fora**. O valor entra no total da campanha como
um lançamento `MANUAL`, gravado com o motivo e o usuário que registrou.

Isso **não é um campo que sobrescreve o total**: o número continua sendo
`SUM(amount) WHERE status = 'PAID'`, e a coluna `source` permite separar, a qualquer
momento, o que a MisticPay confirmou (`GATEWAY`) do que foi lançado à mão (`MANUAL`).
Lançamentos manuais podem ser removidos; doações confirmadas pelo gateway, nunca.

### Credenciais pelo painel

Na aba **Integração (API)** dá para colar a `pk_`/`sk_` sem mexer em variável de ambiente.
Como funciona:

- as variáveis de ambiente **têm prioridade** — o que vem do `.env` aparece como
  "definido no .env" e o campo fica bloqueado no painel;
- o que é cadastrado pelo painel é gravado **criptografado** (AES-256-GCM, chave derivada do
  `SESSION_SECRET`) na tabela `secure_settings`;
- o valor real **nunca volta para a tela** — só a versão mascarada (`sk_1234…cdef`);
- o botão **Testar credenciais** consulta uma transação inexistente na MisticPay só para ver
  se a autenticação é aceita (401/403 = credencial inválida ou sem escopo).

> ⚠️ Para usar esse cadastro é obrigatório ter um `SESSION_SECRET` fixo no `.env`. Sem ele a
> chave de criptografia é sorteada a cada reinício e o que foi salvo vira ilegível — o painel
> avisa e recusa salvar nesse caso.

Senhas são guardadas com **scrypt**; a sessão é um cookie `HttpOnly` assinado com HMAC,
válido por 12 horas e revogável (a sessão também existe na tabela `admin_sessions`).

### Trocar a imagem do celular

O projeto acompanha uma ilustração vetorial do aparelho em
`frontend/assets/img/galaxy-a36.svg` (só o aparelho, sem pessoas). Para usar uma foto
oficial, coloque o arquivo em `frontend/assets/img/` e aponte o caminho no campo
**Imagem** do painel (ex.: `/assets/img/a36.jpg`) — ou cole uma URL `https://`.
Use apenas imagens que você tem direito de publicar.

---

## 🗄️ Banco de dados

SQLite em `data/campanha.db` por padrão; PostgreSQL quando `DATABASE_URL` está definida.
Os dois esquemas são equivalentes. **Todos os valores em centavos (INTEGER).**

### `donations`

| Campo | Descrição |
| --- | --- |
| `id` | chave primária |
| `transaction_id` | id gerado por nós — **UNIQUE** |
| `gateway_transaction_id` | id devolvido pela MisticPay — **UNIQUE** (barra duplicidade) |
| `name` | nome público (NULL = anônimo) |
| `payer_name` | nome informado ao gateway (não é público) |
| `payer_document_masked` | CPF mascarado |
| `amount` | valor cobrado, em centavos |
| `status` | `PENDING` · `PAID` · `EXPIRED` · `CANCELLED` · `FAILED` |
| `source` | `GATEWAY` (confirmado pela MisticPay) ou `MANUAL` (lançado no painel) |
| `admin_note` | de onde veio o valor, nos lançamentos manuais |
| `created_at` / `paid_at` | datas (UTC) |
| `paid_amount` / `amount_mismatch` | valor confirmado pelo gateway e flag de divergência |

Só `status = 'PAID'` entra no cálculo da arrecadação.

Outras tabelas: `gateway_events` (auditoria de webhooks), `settings` (configurações
editáveis), `secure_settings` (credenciais do gateway, cifradas), `admins`,
`admin_sessions` e `login_attempts` (bloqueio de força bruta que funciona também em
serverless, onde um limitador em memória não serviria).

### Cálculo

```
total_arrecadado = SUM(amount) WHERE status = 'PAID'
percentual       = (total_arrecadado / meta) * 100        # barra visual limitada a 100%
restante         = max(0, meta - total_arrecadado)
```

---

## 🔌 API

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/campaign` | meta, arrecadado, progresso, textos e apoiadores |
| `GET` | `/api/campaign/supporters?limit=20` | lista pública de apoiadores |
| `POST` | `/api/donations` | valida e cria a cobrança Pix |
| `GET` | `/api/donations/:transactionId/status` | status real (consulta a MisticPay) |
| `POST` | `/api/webhooks/misticpay/:token` | notificação do gateway |
| `POST` | `/api/admin/login` · `/logout` | sessão do painel |
| `GET` | `/api/admin/overview` · `/donations` · `/settings` | dados do painel |
| `PUT` | `/api/admin/settings` | altera a campanha |
| `POST` | `/api/admin/donations/:id/recheck` · `/reconcile` | reconferência manual |
| `POST` | `/api/admin/donations/manual` | registra doação recebida fora da plataforma |
| `DELETE` | `/api/admin/donations/:id` | remove lançamento manual (só `source = MANUAL`) |
| `GET`/`PUT` | `/api/admin/gateway` | situação e cadastro das credenciais do gateway |
| `POST` | `/api/admin/gateway/test` | testa as credenciais na API da MisticPay |
| `GET` | `/api/cron/reconcile` | manutenção periódica (exige `Authorization: Bearer $CRON_SECRET`) |
| `GET` | `/api/health` | healthcheck (mostra qual banco está em uso) |

Exemplo de criação de doação:

```json
POST /api/donations
{
  "amount": 20,
  "payerName": "Maria Souza",
  "document": "52998224725",
  "displayName": "Maria",
  "message": "boa sorte!",
  "anonymous": false
}
```

---

## 🔐 Segurança

- Validação no frontend **e** revalidação completa no backend (o valor do navegador é
  tratado como intenção, nunca como verdade).
- Credenciais só no backend, sempre por variável de ambiente. O frontend nunca fala
  com a MisticPay.
- Rate limiting por IP: 10 cobranças/10 min, 90 consultas de status/min, 8 logins/15 min,
  120 req/min na API pública — mais um teto de 15 cobranças por IP por hora no banco.
- Idempotência: `transaction_id` e `gateway_transaction_id` são `UNIQUE`, e marcar como
  paga usa `UPDATE ... WHERE status <> 'PAID'`.
- Webhook protegido por token na URL (comparação em tempo constante) **e** reconferência
  obrigatória na API do gateway.
- Sanitização de todas as entradas (remoção de HTML, caracteres de controle e limite de
  tamanho); o frontend renderiza tudo com `textContent`, nunca `innerHTML`.
- Cabeçalhos de segurança: CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` e HSTS em produção.
- Cookie de sessão `HttpOnly` + `SameSite=Strict` + `Secure` em produção.
- Dados sensíveis nunca aparecem em lugar público: CPF, chave Pix, dados bancários e
  payloads completos ficam fora da API pública.

---

## 🌐 Deploy em produção

### Variáveis obrigatórias

```env
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://suacampanha.com.br
SESSION_SECRET=<48 bytes aleatórios>
TRUST_PROXY=1
MISTICPAY_PUBLIC_KEY=pk_...
MISTICPAY_SECRET_KEY=sk_...
MISTICPAY_WEBHOOK_TOKEN=<token aleatório>
MISTICPAY_WEBHOOK_URL=https://suacampanha.com.br/api/webhooks/misticpay/<token>
```

Gere os segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Opção A — VPS com Nginx + systemd (SQLite, sem banco externo)

```bash
npm ci --omit=dev
npm run migrate
npm run create-admin
```

`/etc/systemd/system/celular-novo.service`:

```ini
[Unit]
Description=Campanha Celular Novo
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/celular-novo
ExecStart=/usr/bin/node --env-file=/var/www/celular-novo/.env backend/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now celular-novo
```

Nginx (com HTTPS via `certbot --nginx`):

```nginx
server {
  server_name suacampanha.com.br;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Opção B — Vercel + Supabase (serverless, grátis)

Guia completo e passo a passo: **[DEPLOY-VERCEL-SUPABASE.md](DEPLOY-VERCEL-SUPABASE.md)**.

Em resumo: o banco vira Postgres no Supabase (`DATABASE_URL`), o site roda como função
serverless a partir de `api/index.js` (configurado em `vercel.json`) e a rotina periódica
vira o cron `GET /api/cron/reconcile`.

### Opção C — Render / Railway / Fly.io

- Build: `npm ci`
- Start: `npm start`
- Runtime: Node **22.5+**
- Variáveis de ambiente: as da lista acima (`TRUST_PROXY=1`)
- **Disco persistente** montado em `/data` e `DATABASE_FILE=/data/campanha.db` —
  sem isso o SQLite é apagado a cada deploy.

Depois do primeiro deploy, rode `npm run migrate` e `npm run create-admin` no shell do
serviço.

### Checklist final

- [ ] HTTPS ativo e `PUBLIC_BASE_URL` com `https://`
- [ ] `SESSION_SECRET` forte e único
- [ ] Chave de acesso `pk_`/`sk_` configurada (não a legada)
- [ ] Webhook cadastrado com token e testado
- [ ] `npm run check-gateway` sem avisos
- [ ] Usuário do painel criado com senha forte
- [ ] Backup periódico de `data/campanha.db`
- [ ] Uma doação real de R$ 1,00 feita de ponta a ponta para validar

---

## 🔁 Trocar de gateway no futuro

Toda a aplicação conversa apenas com o contrato de `backend/gateways/gateway.interface.js`
(`createPixCharge`, `checkTransaction`, `parseWebhook`, `isConfigured`).

1. Crie `backend/gateways/<provedor>/index.js` implementando o mesmo contrato.
2. Registre no mapa `GATEWAYS` em `backend/gateways/index.js`.
3. Defina `PAYMENT_GATEWAY=<provedor>` no `.env`.

Nenhum service, rota, tabela ou tela precisa mudar.

---

## 🛠️ Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| "O sistema de pagamento ainda não foi configurado" | `MISTICPAY_PUBLIC_KEY`/`SECRET_KEY` ausentes no `.env` |
| Pix gera mas nunca confirma | Webhook não configurado **e** credencial sem permissão em `/transactions/check` — rode `npm run check-gateway -- <id>` |
| `403` da MisticPay | Credencial `ci/cs` usada em endpoint que exige chave de acesso |
| Webhook retorna `401` | Token da URL diferente de `MISTICPAY_WEBHOOK_TOKEN` |
| Banco zerado após deploy | Falta disco persistente — aponte `DATABASE_FILE` para o volume |
| Rate limit disparando cedo demais | Defina `TRUST_PROXY=1` quando houver proxy na frente |
| Na Vercel, dados somem | Faltou `DATABASE_URL`: em serverless o SQLite não persiste |

---

Feito com ❤️ para a campanha do Galaxy A36. Bons memes!
