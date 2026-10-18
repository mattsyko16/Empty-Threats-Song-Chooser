-- Run once in Supabase SQL Editor for a project that already ran the
-- original add-categories.sql. Keep existing picks and ratings intact.

drop index if exists public.challenge_picks_one_per_category;
