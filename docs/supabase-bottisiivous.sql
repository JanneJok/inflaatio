-- =============================================================================
-- Inflaatio.fi – remove bot-inflated page-view days recorded BEFORE 2026-09-30
-- =============================================================================
--
-- WHY: until 2026-09-30 crawlers that run JavaScript (Googlebot etc.) were
--   counted as page views (fixed in src/js/lib/analytics.js, isAutomatedBrowser).
--   The table never stored a User-Agent or any identifier, so a single bot row
--   CANNOT be told apart from a human one. The only reliable signal is the
--   day total: a day far above its normal level. This script finds those days
--   (the dashboard's "!" rule: more than 5 × the median of the previous 28
--   days) and trims that day back to the median: the excess page_view rows
--   are deleted (which rows is arbitrary – they are indistinguishable).
--   The day then shows its normal level instead of a spike or a gap. Events
--   (with consent) and days from 2026-09-30 on are never touched.
--
-- WHO RUNS THIS: the site owner, in Supabase → SQL Editor, in two steps.
--   The deletion cannot be undone (take a backup first if you want one:
--   Database → Backups, or Table Editor → inflaatio_analytics → Export CSV).
-- =============================================================================

-- STEP 1 – PREVIEW (changes nothing). Run this first and look at the list:
-- day, page views, median of the previous 28 days and the ratio.
with d as (
  select (created_at at time zone 'Europe/Helsinki')::date as day, count(*) as views
  from public.inflaatio_analytics
  where event_type = 'page_view'
    and created_at < ('2026-09-30'::timestamp at time zone 'Europe/Helsinki')
  group by 1
),
m as (
  select d.day, d.views,
         (select percentile_cont(0.5) within group (order by p.views)
            from d p where p.day >= d.day - 28 and p.day < d.day) as median,
         (select count(*) from d p where p.day >= d.day - 28 and p.day < d.day) as history_days
  from d
)
select day, views, median, round((views / nullif(median, 0))::numeric, 1) as ratio
from m
where history_days >= 7 and median >= 1 and views > 5 * median
order by day;

-- STEP 2 – TRIM those days to their median (deletes the excess rows). Run only if the list
-- of step 1 looks right (e.g. no day you know had real publicity).
-- To keep a day, add it to the "keep" list below, e.g. ('2026-09-12').
/*
begin;

with keep(day) as (values (null::date)),
d as (
  select (created_at at time zone 'Europe/Helsinki')::date as day, count(*) as views
  from public.inflaatio_analytics
  where event_type = 'page_view'
    and created_at < ('2026-09-30'::timestamp at time zone 'Europe/Helsinki')
  group by 1
),
m as (
  select d.day, d.views,
         (select percentile_cont(0.5) within group (order by p.views)
            from d p where p.day >= d.day - 28 and p.day < d.day) as median,
         (select count(*) from d p where p.day >= d.day - 28 and p.day < d.day) as history_days
  from d
),
spikes as (
  select day, round(median)::int as target from m
  where history_days >= 7 and median >= 1 and views > 5 * median
    and day not in (select day from keep where day is not null)
),
ranked as (
  select a.id, s.target,
         row_number() over (partition by s.day order by a.id) as rn
  from public.inflaatio_analytics a
  join spikes s
    on a.created_at >= (s.day::timestamp at time zone 'Europe/Helsinki')
   and a.created_at < ((s.day + 1)::timestamp at time zone 'Europe/Helsinki')
  where a.event_type = 'page_view'
)
delete from public.inflaatio_analytics a
using ranked r
where a.id = r.id and r.rn > r.target;

commit;
*/
