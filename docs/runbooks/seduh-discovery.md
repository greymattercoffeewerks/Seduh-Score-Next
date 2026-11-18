# Runbook: Seduh ID discovery (the search switch)

Built as T-ID2.C5 (migration `20261125100000_seduh_discovery.sql`). Discovery is the hub at `/id/` (search a claimed, public
person by name, handle or café, or browse by country), the "Find a competitor" box and "Seduh ID" links on the landing page, and
a claimed competitor's name linking to their page on the results pages. **All of it sits behind one switch that is OFF until the
owner opens it** (after the January pilot, owner decision 2026-11-16). The switch is a database row, so it is enforced in SQL:
with it off every discovery door returns nothing, whatever a page tries.

## Before you open it

1. The migration is in the cloud project (it is a separate manual push from the merge: compare `supabase/migrations/` with
   `list_migrations`).
2. The Privacy page wording ("Being found in Seduh ID search") is live. It ships in the same release as the code.
3. Check what would show: run the check query below and look at who is in it.

## Open it, close it

Owner SQL (the SQL editor as `postgres`, or `apply_migration` is not needed: this is data, not schema):

```sql
-- open
update app.seduh_discovery_switch set enabled = true, changed_at = now();
-- close (the instant way to take it all down)
update app.seduh_discovery_switch set enabled = false, changed_at = now();
-- state
select enabled, changed_at from app.seduh_discovery_switch;
```

The row is a single row (`id` is always true). A missing row reads as CLOSED. There is no API grant on the table: only the
owner can flip it. Takes effect at once for every door. The pages read the switch when they load, so a page already open
shows the old state until it is reloaded; the landing page's box and the results links appear on the next load.

## Who can be found (what the check query shows)

A person appears in search and country browse only if ALL of: the account is claimed and open (not closed), 18-attested, on an
active identity (not merged or opted out), `vis_identity = 'public'` (a hidden name never comes back) and `listed_in_search`
(the person's own "Show me in Seduh ID search", ON by default). An unclaimed person has no account and can never appear. A results-page link needs a
public name and `vis_recorded_results = 'public'` but not the search setting.

```sql
-- everyone discovery would list right now (switch must be on for the helper to return rows; this reads the tables directly)
select a.handle, i.display_name, i.country_code
  from app.seduh_accounts a
  join app.seduh_identities i on i.id = a.identity_id
  join app.seduh_profile_settings s on s.account_id = a.id
 where a.closed_at is null and a.adult_attested_at is not null and i.status = 'active'
   and s.vis_identity = 'public' and s.listed_in_search
 order by i.country_code, i.display_name;
```

## Taking one person out

Ask first whether they can do it themselves: My Seduh ID → Privacy → untick "Show me in Seduh ID search" (or hide their
name). To remove someone on request, as owner SQL:

```sql
update app.seduh_profile_settings set listed_in_search = false
 where account_id = (select id from app.seduh_accounts where handle = '<handle>');
```

## Limits to know

- Search is 2 to 40 characters, at most 20 results (country browse 60), no paging; wildcards are literal. SQL cannot
  rate-limit a caller; the platform's request limits apply. If traffic ever calls for it, add a Cloudflare rate rule for the
  `rpc/seduh_discovery_search` path.
- A café query matches the café printed on the person's published result rows (same rule as the profile), only while their
  recorded results are public. The café is never returned.
- The results-page link uses the exact name and café printed on the page; a roster edited after publishing links nobody.
- Tests: pgTAP `088_seduh_discovery.sql`, Playwright `seduh-discovery-live.spec.js` (flips the switch locally and puts it back OFF).
