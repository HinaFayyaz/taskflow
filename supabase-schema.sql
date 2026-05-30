-- ════════════════════════════════════════════════════════════════════
--  TASKFLOW — Supabase Schema
--  Paste this ENTIRE file into Supabase → SQL Editor → New query → Run.
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════

-- ─── PROFILES ───────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid());

-- Auto-create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── FOLDERS ────────────────────────────────────────────────────────
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now()
);
alter table public.folders enable row level security;

-- ─── TASKS ──────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  folder_id   uuid references public.folders(id) on delete set null,
  text        text not null,
  tag         text default 'client',
  scope       text default 'daily',
  status      text default 'todo',
  due_date    text,
  note        text default '',
  attachments jsonb default '[]'::jsonb,
  created_at  timestamptz default now()
);
alter table public.tasks enable row level security;

-- ─── NOTES (private, per-user) ──────────────────────────────────────
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  title      text,
  body       text,
  created_at timestamptz default now()
);
alter table public.notes enable row level security;

-- ─── SHARES ─────────────────────────────────────────────────────────
create table if not exists public.shares (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check (resource_type in ('task','folder','board')),
  resource_id   uuid,                       -- null when resource_type = 'board'
  invited_email text not null,
  permission    text not null default 'view' check (permission in ('view','edit')),
  created_at    timestamptz default now()
);
alter table public.shares enable row level security;

-- ─── COMMENTS ───────────────────────────────────────────────────────
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references auth.users(id),
  author_name text,
  text        text not null,
  created_at  timestamptz default now()
);
alter table public.comments enable row level security;


-- ════════════════════════════════════════════════════════════════════
--  ROW-LEVEL SECURITY POLICIES
-- ════════════════════════════════════════════════════════════════════

-- ─── FOLDERS ────────────────────────────────────────────────────────
drop policy if exists "folders select" on public.folders;
create policy "folders select" on public.folders for select using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.shares s
    where lower(s.invited_email) = lower(auth.email())
      and (
        (s.resource_type = 'folder' and s.resource_id = folders.id)
        or (s.resource_type = 'board' and s.owner_id = folders.owner_id)
      )
  )
);

drop policy if exists "folders insert" on public.folders;
create policy "folders insert" on public.folders for insert
  with check (owner_id = auth.uid());

drop policy if exists "folders update" on public.folders;
create policy "folders update" on public.folders for update
  using (owner_id = auth.uid());

drop policy if exists "folders delete" on public.folders;
create policy "folders delete" on public.folders for delete
  using (owner_id = auth.uid());

-- ─── TASKS ──────────────────────────────────────────────────────────
drop policy if exists "tasks select" on public.tasks;
create policy "tasks select" on public.tasks for select using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.shares s
    where lower(s.invited_email) = lower(auth.email())
      and (
        (s.resource_type = 'task'   and s.resource_id = tasks.id)
        or (s.resource_type = 'folder' and s.resource_id = tasks.folder_id)
        or (s.resource_type = 'board'  and s.owner_id  = tasks.owner_id)
      )
  )
);

drop policy if exists "tasks insert" on public.tasks;
create policy "tasks insert" on public.tasks for insert
  with check (owner_id = auth.uid());

drop policy if exists "tasks update" on public.tasks;
create policy "tasks update" on public.tasks for update using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.shares s
    where lower(s.invited_email) = lower(auth.email())
      and s.permission = 'edit'
      and (
        (s.resource_type = 'task'   and s.resource_id = tasks.id)
        or (s.resource_type = 'folder' and s.resource_id = tasks.folder_id)
        or (s.resource_type = 'board'  and s.owner_id  = tasks.owner_id)
      )
  )
);

drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete
  using (owner_id = auth.uid());

-- ─── NOTES ──────────────────────────────────────────────────────────
drop policy if exists "notes all own" on public.notes;
create policy "notes all own" on public.notes for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ─── SHARES ─────────────────────────────────────────────────────────
drop policy if exists "shares select" on public.shares;
create policy "shares select" on public.shares for select using (
  owner_id = auth.uid()
  or lower(invited_email) = lower(auth.email())
);

drop policy if exists "shares insert" on public.shares;
create policy "shares insert" on public.shares for insert
  with check (owner_id = auth.uid());

drop policy if exists "shares delete" on public.shares;
create policy "shares delete" on public.shares for delete
  using (owner_id = auth.uid());

-- ─── COMMENTS ───────────────────────────────────────────────────────
drop policy if exists "comments select" on public.comments;
create policy "comments select" on public.comments for select using (
  exists (
    select 1 from public.tasks t
    where t.id = comments.task_id
      and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.shares s
          where lower(s.invited_email) = lower(auth.email())
            and (
              (s.resource_type = 'task'   and s.resource_id = t.id)
              or (s.resource_type = 'folder' and s.resource_id = t.folder_id)
              or (s.resource_type = 'board'  and s.owner_id  = t.owner_id)
            )
        )
      )
  )
);

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id = comments.task_id
      and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.shares s
          where lower(s.invited_email) = lower(auth.email())
            and (
              (s.resource_type = 'task'   and s.resource_id = t.id)
              or (s.resource_type = 'folder' and s.resource_id = t.folder_id)
              or (s.resource_type = 'board'  and s.owner_id  = t.owner_id)
            )
        )
      )
  )
);

-- ════════════════════════════════════════════════════════════════════
--  Done. Your database is ready.
-- ════════════════════════════════════════════════════════════════════
