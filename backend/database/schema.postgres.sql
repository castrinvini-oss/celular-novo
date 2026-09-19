-- ==========================================================================
--  Esquema do banco (PostgreSQL / Supabase)
--  Equivalente ao schema.sqlite.sql. Valores monetarios sempre em centavos.
--
--  Pode ser executado de duas formas:
--    1. npm run migrate            (com DATABASE_URL apontando para o Supabase)
--    2. colando este arquivo inteiro no SQL Editor do Supabase
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Doacoes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
  id                     BIGSERIAL PRIMARY KEY,

  -- Identificador unico gerado pela nossa aplicacao (enviado ao gateway).
  transaction_id         TEXT        NOT NULL UNIQUE,

  -- Identificador devolvido pelo gateway. UNIQUE impede contabilizar duas
  -- vezes a mesma transacao vinda do webhook.
  gateway_transaction_id TEXT                 UNIQUE,
  gateway                TEXT        NOT NULL DEFAULT 'misticpay',

  -- Nome publico escolhido pelo doador (NULL = anonimo).
  name                   TEXT,
  -- Nome real informado ao gateway (obrigatorio pela MisticPay). Nao e publico.
  payer_name             TEXT        NOT NULL,
  -- CPF mascarado (ex.: ***.456.789-**). O CPF completo nunca e persistido.
  payer_document_masked  TEXT,

  amount                 INTEGER     NOT NULL CHECK (amount > 0), -- centavos
  status                 TEXT        NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED','FAILED')),
  message                TEXT,

  -- Dados do Pix devolvidos pelo gateway.
  pix_copy_paste         TEXT,
  pix_qrcode_base64      TEXT,
  pix_qrcode_url         TEXT,

  -- Controle interno.
  client_ip              TEXT,
  last_checked_at        TIMESTAMPTZ,
  paid_amount            INTEGER,
  amount_mismatch        INTEGER     NOT NULL DEFAULT 0,
  raw_confirmation       TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_donations_status     ON donations (status);
CREATE INDEX IF NOT EXISTS idx_donations_paid_at    ON donations (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations (created_at DESC);

-- --------------------------------------------------------------------------
-- Eventos recebidos do gateway (auditoria + idempotencia)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway_events (
  id                     BIGSERIAL PRIMARY KEY,
  gateway                TEXT        NOT NULL DEFAULT 'misticpay',
  event_type             TEXT,
  gateway_transaction_id TEXT,
  donation_id            BIGINT REFERENCES donations (id) ON DELETE SET NULL,
  payload                TEXT,
  verified               INTEGER     NOT NULL DEFAULT 0,
  result                 TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gateway_events_tx ON gateway_events (gateway_transaction_id);

-- --------------------------------------------------------------------------
-- Configuracoes editaveis da campanha
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Administradores e sessoes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id         TEXT        PRIMARY KEY,
  admin_id   BIGINT      NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions (admin_id);

-- --------------------------------------------------------------------------
-- Tentativas de login (rate limit que sobrevive a serverless)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  ip         TEXT        NOT NULL,
  username   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip, created_at);
