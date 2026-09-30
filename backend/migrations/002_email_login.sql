ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS email_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
