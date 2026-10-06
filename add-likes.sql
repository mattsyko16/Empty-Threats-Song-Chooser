-- Run once in the SQL Editor of the EXISTING Empty Threats Supabase project.
-- Safe to run again if you are unsure whether it completed.
-- This leaves existing songs, members, and the band access code unchanged.

create table if not exists public.song_likes (
  song_id uuid not null references public.songs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
);

alter table public.song_likes enable row level security;
revoke all on table public.song_likes from anon, authenticated;
grant select, insert, delete on table public.song_likes to authenticated;

drop policy if exists "Members can see likes" on public.song_likes;
create policy "Members can see likes"
on public.song_likes for select to authenticated
using (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

drop policy if exists "Members can like suggestions" on public.song_likes;
create policy "Members can like suggestions"
on public.song_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.songs
    where id = song_id and stage = 'suggestions'
  )
);

drop policy if exists "Members can remove their likes" on public.song_likes;
create policy "Members can remove their likes"
on public.song_likes for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'song_likes'
  ) then
    alter publication supabase_realtime add table public.song_likes;
  end if;
end;
$$;
