create table if not exists tokens (
  id text primary key,
  token_hash text not null unique,
  teams text not null,
  scopes text not null,
  expires_at text,
  revoked_at text
);

create index if not exists tokens_revoked_at on tokens(revoked_at);
