-- Run once in the existing Supabase project after add-challenge.sql.
-- Existing picks and ratings remain intact. Their owners can assign categories in the app.

begin;

alter table public.challenge_picks
  add column if not exists category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.challenge_picks'::regclass
      and conname = 'challenge_picks_category_check'
  ) then
    alter table public.challenge_picks
      add constraint challenge_picks_category_check
      check (category is null or category in (
        'rock-country', 'indie-alternative', 'pop-party', 'funk-soul-disco'
      ));
  end if;
end;
$$;

-- Four picks total are allowed, including multiple picks in one category.
drop index if exists public.challenge_picks_one_per_category;

-- Keep the existing four-pick limit and require a category for every new pick.
-- The original member row lock serialises concurrent submissions.
create or replace function private.enforce_challenge_pick_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.owner_user_id <> auth.uid() then
    raise exception 'Only the member can add or categorise their own pick';
  end if;
  if new.category is null then
    raise exception 'Choose a category for this pick';
  end if;
  perform 1 from public.band_members
  where user_id = new.owner_user_id for update;
  if not found then
    raise exception 'Join the band before adding picks';
  end if;
  if tg_op = 'INSERT' and
    (select count(*) from public.challenge_picks where owner_user_id = new.owner_user_id) >= 4 then
    raise exception 'Four picks maximum. Remove one of your picks first.';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_challenge_pick_limit() from public, anon, authenticated;
drop trigger if exists challenge_picks_limit on public.challenge_picks;
create trigger challenge_picks_limit
before insert or update of category on public.challenge_picks
for each row execute function private.enforce_challenge_pick_limit();

grant update (category) on table public.challenge_picks to authenticated;

drop policy if exists "Members can categorise their own challenge picks" on public.challenge_picks;
create policy "Members can categorise their own challenge picks" on public.challenge_picks
for update to authenticated using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

notify pgrst, 'reload schema';

commit;
