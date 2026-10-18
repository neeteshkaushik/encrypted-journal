create table public.journal_vault_changes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  vault_id uuid not null,
  change_id uuid not null,
  parent_change_id uuid,
  encrypted_record jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, vault_id, change_id),
  foreign key (owner_id, vault_id, parent_change_id)
    references public.journal_vault_changes (owner_id, vault_id, change_id),
  check (jsonb_typeof(encrypted_record) is not distinct from 'object'),
  check (encrypted_record ->> 'vaultId' is not distinct from vault_id::text),
  check (encrypted_record -> 'schemaVersion' is not distinct from '1'::jsonb)
);

create table public.journal_note_changes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  vault_id uuid not null,
  note_id uuid not null,
  change_id uuid not null,
  parent_change_id uuid,
  encrypted_record jsonb,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, vault_id, note_id, change_id),
  foreign key (owner_id, vault_id, note_id, parent_change_id)
    references public.journal_note_changes (owner_id, vault_id, note_id, change_id),
  check (
    case
      when is_deleted then encrypted_record is null
      else
        encrypted_record is not null
        and jsonb_typeof(encrypted_record) is not distinct from 'object'
        and encrypted_record ->> 'noteId' is not distinct from note_id::text
        and encrypted_record ->> 'vaultId' is not distinct from vault_id::text
        and encrypted_record -> 'schemaVersion' is not distinct from '1'::jsonb
        and jsonb_typeof(encrypted_record -> 'nonce') is not distinct from 'string'
        and jsonb_typeof(encrypted_record -> 'ciphertext') is not distinct from 'string'
    end
  )
);

create index journal_vault_changes_by_vault
  on public.journal_vault_changes (owner_id, vault_id, created_at);

create index journal_note_changes_by_vault
  on public.journal_note_changes (owner_id, vault_id, note_id, created_at);

alter table public.journal_vault_changes enable row level security;
alter table public.journal_note_changes enable row level security;

create policy "Users can read their own encrypted vault changes"
  on public.journal_vault_changes
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can add their own encrypted vault changes"
  on public.journal_vault_changes
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can read their own encrypted note changes"
  on public.journal_note_changes
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can add their own encrypted note changes"
  on public.journal_note_changes
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

revoke all on public.journal_vault_changes from anon;
revoke all on public.journal_note_changes from anon;
revoke update, delete on public.journal_vault_changes from authenticated;
revoke update, delete on public.journal_note_changes from authenticated;
grant select, insert on public.journal_vault_changes to authenticated;
grant select, insert on public.journal_note_changes to authenticated;
