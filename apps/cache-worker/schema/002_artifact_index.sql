create table if not exists artifact_index (
  object_key text primary key,
  team text not null,
  artifact_id text not null,
  size integer not null,
  duration_ms integer not null,
  tag text,
  sha text,
  dirty_hash text,
  token_id text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists artifact_index_team on artifact_index(team);
create index if not exists artifact_index_artifact_id on artifact_index(artifact_id);
