-- =============================================================================
-- Inflaatio.fi – own event statistics and the owner dashboard /tilastot/
-- =============================================================================
--
-- WHO RUNS THIS: the site owner, once, in the Supabase dashboard
--   (project ysuhexvvgjoizrcdrxso → SQL Editor → New query → paste → Run),
--   AFTER docs/supabase.sql (the page-view table) and AFTER creating the
--   dashboard user (Authentication → Users → Add user → Create new user,
--   "Auto Confirm User" on). Step-by-step: docs/TILASTOT.md, "Käyttöönotto".
--   Idempotent: running it again is safe.
--
-- BEFORE RUNNING: replace OMA@SAHKOPOSTI.FI in section 4 with the e-mail
--   address of the dashboard user. Nothing else needs editing.
--
-- WHAT THIS SCRIPT DOES
--   1. Adds the column `detail` to public.inflaatio_analytics and lets anon
--      insert, besides the page view of docs/supabase.sql, the whitelisted
--      product events of src/js/lib/tilastot-events.js (sent by the site
--      ONLY with analytics consent): { event_type, page, detail }.
--      The event list below must equal OWN_EVENTS (test/tilastot.test.js).
--   2. public.inflaatio_stats_admins: the auth users allowed to read the
--      statistics. Not readable or writable through the API at all.
--   3. public.inflaatio_stats(p_from, p_to): the only way to read anything –
--      daily aggregates and top lists as JSON (no rows, no ids). Runs as the
--      table owner (security definer) but first checks that the caller is a
--      signed-in user listed in inflaatio_stats_admins; anon cannot call it.
--   4. Grants the dashboard user access (edit the e-mail address).
--
-- DATA MINIMISATION: events have no referrer, device, id or visitor text.
--   `detail` is the site's own vocabulary (calculator name, file path, chart
--   option, link host …), normalised to [a-z0-9_./:-], ≤ 80 characters.
--   Retention: the pg_cron job of docs/supabase.sql deletes every row (page
--   views and events) after 14 months.
--
-- AFTER RUNNING – verify (ANON = anon key from src/site.config.js):
--   # an event must be accepted (HTTP 201):
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--        "https://ysuhexvvgjoizrcdrxso.supabase.co/rest/v1/inflaatio_analytics" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" -H "Prefer: return=minimal" \
--        -d '{"event_type":"calculator_used","page":"/__tarkistus__/","detail":"vuokrankorotus"}'
--   # anon must NOT be able to read the statistics (HTTP 401 or 403):
--   curl -s -w "\n%{http_code}\n" -X POST \
--        "https://ysuhexvvgjoizrcdrxso.supabase.co/rest/v1/rpc/inflaatio_stats" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" -d '{}'
--   Then: delete from public.inflaatio_analytics where page = '/__tarkistus__/';
--   Finally log in at https://inflaatio.fi/tilastot/.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Events: column, checks, insert policy
-- -----------------------------------------------------------------------------

alter table public.inflaatio_analytics add column if not exists detail text;

alter table public.inflaatio_analytics drop constraint if exists inflaatio_analytics_detail_check;
alter table public.inflaatio_analytics
  add constraint inflaatio_analytics_detail_check
  check (detail is null or (char_length(detail) between 1 and 80 and detail ~ '^[a-z0-9_./:-]+$'));

comment on table public.inflaatio_analytics is
  'Inflaatio.fi own statistics: cookieless page views (event_type page_view: page, referrer category, device class) and, only with analytics consent, whitelisted product events (event_type, page, detail). No personal data; retention 14 months (pg_cron job inflaatio-analytics-retention). Schema: docs/supabase.sql and docs/supabase-tilastot.sql. Read only through public.inflaatio_stats().';

-- The dashboard filters by time and type.
create index if not exists inflaatio_analytics_type_created_idx
  on public.inflaatio_analytics (event_type, created_at);

revoke all on table public.inflaatio_analytics from anon, authenticated;
grant insert (event_type, page, referrer, device, detail) on table public.inflaatio_analytics to anon;

drop policy if exists inflaatio_analytics_anon_insert on public.inflaatio_analytics;
create policy inflaatio_analytics_anon_insert
  on public.inflaatio_analytics
  for insert
  to anon
  with check (
    page is not null
    and char_length(page) between 1 and 200
    and left(page, 1) = '/'
    and page !~ '[?#[:space:]]'                                   -- path only: no query, hash or spaces
    and (
      (
        -- Page view (no consent needed; docs/supabase.sql)
        event_type = 'page_view'
        and detail is null
        and (referrer is null or (char_length(referrer) between 1 and 100 and referrer ~ '^[a-z0-9.-]+$'))
        and (device is null or device in ('mobile', 'tablet', 'desktop'))
      )
      or (
        -- Product event (sent only with analytics consent) – = OWN_EVENTS in
        -- src/js/lib/tilastot-events.js
        event_type in (
          'page_read',
          'calculator_used',
          'result_shared',
          'csv_download',
          'json_download',
          'widget_code_copied',
          'text_copied',
          'contact_form_sent',
          'chart_changed',
          'table_opened',
          'faq_opened',
          'outbound_click',
          'page_printed',
          'js_error'
        )
        and referrer is null
        and device is null
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Who may read the statistics
-- -----------------------------------------------------------------------------

create table if not exists public.inflaatio_stats_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

comment on table public.inflaatio_stats_admins is
  'Auth users allowed to call public.inflaatio_stats() (the /tilastot/ dashboard). Not accessible through the API.';

alter table public.inflaatio_stats_admins enable row level security;
revoke all on table public.inflaatio_stats_admins from anon, authenticated;
-- No policies: anon and authenticated can do nothing with this table.

-- -----------------------------------------------------------------------------
-- 3. Aggregates for the dashboard
-- -----------------------------------------------------------------------------

-- Referrer category (as stored by the site: 'direct', 'internal' or a host
-- name without "www.") → 'direct' | 'internal' | 'search' | 'ai' | 'social' | 'other'.
create or replace function public.inflaatio_source_class(ref text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when ref is null or ref = '' or ref = 'direct' then 'direct'
    when ref = 'internal' then 'internal'
    when ref ~ '^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|com\.google\.android\.gm)$' then 'other'
    when ref ~ '^(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|chat\.mistral\.ai|chat\.deepseek\.com|grok\.com|meta\.ai|you\.com|phind\.com)$' then 'ai'
    when ref ~ '(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|ecosia\.org|yahoo\.[a-z.]+|yandex\.[a-z.]+|baidu\.com|qwant\.com|startpage\.com|kagi\.com|seznam\.cz|ask\.com|naver\.com|search\.brave\.com|googlequicksearchbox)$' then 'search'
    when ref ~ '(^|\.)(facebook\.com|fb\.com|messenger\.com|instagram\.com|t\.co|x\.com|twitter\.com|reddit\.com|linkedin\.com|lnkd\.in|youtube\.com|tiktok\.com|threads\.net|threads\.com|bsky\.app|mastodon\.social|pinterest\.[a-z.]+|snapchat\.com|whatsapp\.com|telegram\.org|t\.me|discord\.com|tumblr\.com|vk\.com)$'
      or ref ~ '^com\.(facebook|instagram|linkedin|twitter|reddit|zhiliaoapp)\.' then 'social'
    else 'other'
  end
$$;

-- Section of the site for a path (the dashboard stacks page views by these).
create or replace function public.inflaatio_section(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p = '/' then 'etusivu'
    when p in ('/laskurit/', '/vuokrankorotus/', '/rahanarvo/', '/oma-inflaatio/', '/ostovoima/') then 'laskurit'
    when p like '/inflaatio/%' or p like '/katsaus/%' or p = '/pisteluvut/' then 'historia'
    when p like '/hinnat/%' or p = '/polttoaineet/' then 'hinnat'
    when p in ('/vertailu/', '/korot/') then 'vertailu'
    when p like '/en/%' then 'en'
    when p = '/upotus/' then 'upotus'
    when p = '/404.html' then 'notfound'
    else 'muut'
  end
$$;

revoke all on function public.inflaatio_source_class(text) from public, anon, authenticated;
revoke all on function public.inflaatio_section(text) from public, anon, authenticated;

-- The dashboard's single read endpoint. p_from/p_to are Helsinki calendar
-- days (null p_from = from the first row, null p_to = today). Returns
--   counters: [{d, k, n}] per day for p_from − 35 days … p_to (history for
--             the KPI tiles and spike alerts); k is 'pv', 'dev.<class>',
--             'src.<class>', 'sec.<section>' or 'ev.<event>'
--   pages:    [{p, n, e}] top 500 pages in p_from…p_to (e = arrivals from
--             outside the site, i.e. landing views)
--   referrers:[{r, c, n}] top 100 external referrer hosts with their class
--   hours:    [{w, h, n}] page views by ISO weekday (1 = Monday) and hour
--   details:  [{e, x, n}] events by detail, top 500
--   eventPages:[{e, p, n}] events by page, top 500
-- The range is capped at 500 days.
create or replace function public.inflaatio_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz constant text := 'Europe/Helsinki';
  v_today date := (now() at time zone 'Europe/Helsinki')::date;
  v_first date;
  v_from date;
  v_to date;
  t_hist timestamptz;
  t_from timestamptz;
  t_to timestamptz;
  result jsonb;
begin
  if auth.uid() is null
     or not exists (select 1 from public.inflaatio_stats_admins a where a.user_id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select (min(created_at) at time zone tz)::date into v_first from public.inflaatio_analytics;
  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := coalesce(p_from, v_first, v_to);
  if v_from > v_to then v_from := v_to; end if;
  if v_to - v_from > 500 then v_from := v_to - 500; end if;

  t_hist := ((v_from - 35)::timestamp at time zone tz);
  t_from := (v_from::timestamp at time zone tz);
  t_to := ((v_to + 1)::timestamp at time zone tz);

  with r as (
    select (a.created_at at time zone tz) as lt, a.created_at, a.event_type, a.page, a.referrer, a.device, a.detail
    from public.inflaatio_analytics a
    where a.created_at >= t_hist and a.created_at < t_to
  ),
  pv as (
    select r.*, public.inflaatio_source_class(r.referrer) as src, public.inflaatio_section(r.page) as sec
    from r where r.event_type = 'page_view'
  ),
  ev as (
    select r.* from r where r.event_type <> 'page_view'
  ),
  counters as (
    select lt::date as d, 'pv' as k, count(*) as n from pv group by 1
    union all
    select lt::date, 'dev.' || coalesce(device, 'unknown'), count(*) from pv group by 1, 2
    union all
    select lt::date, 'src.' || src, count(*) from pv group by 1, 2
    union all
    select lt::date, 'sec.' || sec, count(*) from pv group by 1, 2
    union all
    select lt::date, 'ev.' || event_type, count(*) from ev group by 1, 2
  )
  select jsonb_build_object(
    'timeZone', tz,
    'today', v_today,
    'from', v_from,
    'to', v_to,
    'first', v_first,
    'generatedAt', now(),
    'counters', coalesce((
      select jsonb_agg(jsonb_build_object('d', c.d, 'k', c.k, 'n', c.n) order by c.d, c.k) from counters c
    ), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('p', q.page, 'n', q.n, 'e', q.e) order by q.n desc, q.page)
      from (
        select page, count(*) as n, count(*) filter (where src <> 'internal') as e
        from pv where created_at >= t_from group by page order by n desc, page limit 500
      ) q
    ), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(jsonb_build_object('r', q.referrer, 'c', q.src, 'n', q.n) order by q.n desc, q.referrer)
      from (
        select referrer, src, count(*) as n
        from pv where created_at >= t_from and src not in ('direct', 'internal')
        group by referrer, src order by n desc, referrer limit 100
      ) q
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('w', q.w, 'h', q.h, 'n', q.n) order by q.w, q.h)
      from (
        select extract(isodow from lt)::int as w, extract(hour from lt)::int as h, count(*) as n
        from pv where created_at >= t_from group by 1, 2
      ) q
    ), '[]'::jsonb),
    'details', coalesce((
      select jsonb_agg(jsonb_build_object('e', q.event_type, 'x', q.detail, 'n', q.n) order by q.n desc, q.event_type, q.detail)
      from (
        select event_type, coalesce(detail, '') as detail, count(*) as n
        from ev where created_at >= t_from
        group by 1, 2 order by n desc, 1, 2 limit 500
      ) q
    ), '[]'::jsonb),
    'eventPages', coalesce((
      select jsonb_agg(jsonb_build_object('e', q.event_type, 'p', q.page, 'n', q.n) order by q.n desc, q.event_type, q.page)
      from (
        select event_type, page, count(*) as n
        from ev where created_at >= t_from
        group by 1, 2 order by n desc, 1, 2 limit 500
      ) q
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$$;

-- Supabase grants EXECUTE on new functions to anon by default: take it back.
revoke all on function public.inflaatio_stats(date, date) from public, anon;
grant execute on function public.inflaatio_stats(date, date) to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- 4. Grant the dashboard user access – EDIT THE ADDRESS, then run.
--    (Create the user first: Authentication → Users → Add user.)
-- -----------------------------------------------------------------------------

insert into public.inflaatio_stats_admins (user_id)
select id from auth.users where lower(email) = lower('OMA@SAHKOPOSTI.FI')
on conflict (user_id) do nothing;

-- Check: the query below must list your address.
--   select u.email, a.added_at from public.inflaatio_stats_admins a join auth.users u on u.id = a.user_id;
-- Remove someone's access:
--   delete from public.inflaatio_stats_admins where user_id = (select id from auth.users where email = '…');
