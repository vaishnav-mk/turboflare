create table if not exists tokens (
  id text primary key,
  token_hash text not null unique,
  teams text not null,
  scopes text not null,
  expires_at text,
  revoked_at text
);

create index if not exists tokens_revoked_at on tokens(revoked_at);

create table if not exists token_audit (
  id text primary key,
  token_id text not null,
  action text not null,
  created_at text not null
);

create index if not exists token_audit_token_id on token_audit(token_id);
