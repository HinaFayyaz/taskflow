-- ════════════════════════════════════════════════════════════════════
--  TaskFlow — Migration: add profile avatar support
--  Run this in Supabase → SQL Editor → New query → Run.
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════

-- Add an avatar column to store the user's profile picture (base64 data URL)
alter table public.profiles add column if not exists avatar_url text;

-- Allow users to insert their own profile row (needed if it didn't exist yet)
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
--  Done.
-- ════════════════════════════════════════════════════════════════════
