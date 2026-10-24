-- OpsHub schema (idempotent)

CREATE TABLE IF NOT EXISTS departments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'dept_head', 'employee')),
  department_id INT REFERENCES departments(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

-- Broadcasts and direct / cross-department messages.
CREATE TABLE IF NOT EXISTS messages (
  id             SERIAL PRIMARY KEY,
  sender_id      INT REFERENCES users(id) ON DELETE SET NULL,
  target_type    TEXT NOT NULL CHECK (target_type IN ('all', 'dept', 'user')),
  target_dept_id INT REFERENCES departments(id) ON DELETE SET NULL,
  target_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_target_dept ON messages(target_dept_id);
CREATE INDEX IF NOT EXISTS idx_messages_target_user ON messages(target_user_id);

-- One row per recipient per message.
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Web Push subscriptions: one row per browser / phone install.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS goals (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  goal_date    DATE NOT NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'completed', 'blocked', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  blocked_at   TIMESTAMPTZ
);
-- Upgrade for databases created before the 'cancelled' status existed (goals are never deleted).
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_status_check;
ALTER TABLE goals ADD CONSTRAINT goals_status_check
  CHECK (status IN ('todo', 'in_progress', 'completed', 'blocked', 'cancelled'));

-- Why a goal is blocked (shown to managers, grouped in the Today view).
ALTER TABLE goals ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_goals_user_date ON goals(user_id, goal_date);
CREATE INDEX IF NOT EXISTS idx_goals_date ON goals(goal_date);
CREATE INDEX IF NOT EXISTS idx_goals_blocked ON goals(blocked_at) WHERE status = 'blocked';

CREATE TABLE IF NOT EXISTS eod_notes (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_date  DATE NOT NULL,
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, note_date)
);
CREATE INDEX IF NOT EXISTS idx_eod_date ON eod_notes(note_date, updated_at DESC);
