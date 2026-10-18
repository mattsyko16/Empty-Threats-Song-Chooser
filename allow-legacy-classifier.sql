-- Run in Supabase SQL Editor after add-categories.sql.
-- This prepares a single-device allowlist for categorising older picks.
-- It grants no extra access until the chosen phone's user ID is inserted below.

begin;

create table if not exists private.challenge_classifiers (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table private.challenge_classifiers enable row level security;
revoke all on table private.challenge_classifiers from public, anon, authenticated;

create or replace function public.can_classify_legacy()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (select 1 from private.challenge_classifiers where user_id = auth.uid())
    and exists (select 1 from public.band_members where user_id = auth.uid());
$$;
revoke all on function public.can_classify_legacy() from public, anon, authenticated;
grant execute on function public.can_classify_legacy() to authenticated;

create or replace function private.enforce_challenge_pick_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Join the band before adding or categorising picks';
  end if;
  if tg_op = 'INSERT' then
    if new.owner_user_id <> auth.uid() then
      raise exception 'Only the member can add their own pick';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_user_id <> old.owner_user_id or
       (old.owner_user_id <> auth.uid() and
        (old.category is not null or not public.can_classify_legacy())) then
      raise exception 'Only the pick owner or authorised legacy classifier can change this category';
    end if;
  end if;
  if new.category is null then
    raise exception 'Choose a category for this pick';
  end if;
  perform 1 from public.band_members where user_id = auth.uid() for update;
  if not found then
    raise exception 'Join the band before adding picks';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.challenge_picks where owner_user_id = new.owner_user_id) >= 4 then
      raise exception 'Four picks maximum. Remove one of your picks first.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_challenge_pick_limit() from public, anon, authenticated;

drop policy if exists "Members can categorise their own challenge picks" on public.challenge_picks;
drop policy if exists "Members can categorise challenge picks" on public.challenge_picks;
create policy "Members can categorise challenge picks" on public.challenge_picks
for update to authenticated using (
  owner_user_id = (select auth.uid())
  or (category is null and (select public.can_classify_legacy()))
)
with check (
  owner_user_id = (select auth.uid())
  or (select public.can_classify_legacy())
);

notify pgrst, 'reload schema';
commit;

-- After identifying the correct phone account, run this with its copied ID:
-- insert into private.challenge_classifiers (user_id)
-- values ('PASTE-PHONE-DEVICE-ID-HERE')
-- on conflict (user_id) do nothing;
