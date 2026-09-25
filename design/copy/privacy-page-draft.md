# Privacy page — draft

_Status: DRAFT for owner review. Nothing here is published. Written from the actual database schema and code as of 2026-09-25, describing what exists today, not what we might build. [OWNER TO CONFIRM] marks commitments only you can make; [VERIFY] marks facts I could not fully confirm from the code._

## Headline

What we hold, who can see it, and how to ask us to remove it.

## Who is responsible

Seduh Score is run by Grey Matter Coffee Werks in Brunei. Questions or requests about your data: greymatter.cw@outlook.com. [TEMPORARY: swap for hello@seduhscore.com later.]

## What we hold

**Competitors and event entries** (entered by the organiser, usually ahead of the event)

- Display name, cafe, and bib number for each event.
- Phone number (required), and optionally email, cafe, country and organiser notes, in the organiser's own registry of people.
- Times, right and wrong answers and results recorded during the event.
- A log of changes made to scores, times and results since 24 September 2026 (who made the change, when, the old and new value, and any reason given).

**Organisers and staff**

- An email address and password for signing in, handled by our authentication provider (Supabase).
- Which organisation you belong to, and your user ID against changes you make.

**Guess the Bean participants** (public tool, no account needed)

- The name you give, your guess, and a phone number or Instagram handle you choose to give so an organiser can contact a winner.

**On your device**

- The Timer tool, Guess the Bean setup and offline scoring store small amounts of data in your browser (local storage and IndexedDB) so they keep working without a connection. This stays on your device. We use no advertising trackers. We do use Cloudflare Web Analytics, a privacy-focused service that measures how pages perform and how many people visit, without tracking individuals across sites. We also use Google Search Console and Bing Webmaster Tools to see how the site appears in search results. They report on searches, not on individual visitors.

## Who can see it

- **Organisers and their team** can see their own organisation's registry and events. Another organisation's members cannot.
- **The public** sees the name and date of each event, the live audience view (standings and competitor names) while an event is running, and whatever an organiser chooses to publish as event results. For a Cup Taster event that is the event name, city, venue and date, the number of competitors and rounds, the winning time, and the top three (name, cafe and how many they got right). It never includes phone numbers or emails. Published results show the shape of the score-change record, never exact scores.
- **Exact scores and the full change log** go only to the organiser, who may hand them over on request (the dispute pack). The pack contains names, cafes and bib numbers but not phone numbers or emails.
- **Guess the Bean phone numbers and Instagram handles** are visible only to the person who created that session. Before the reveal, the live display shows names but not guesses. The reveal shows names and guesses, never contact details.
- **Grey Matter** restricts direct access to the database to one person, the owner of Seduh Score. It is used to keep the service running and to act on your requests, not to read organisers' data.

## Where it is stored

Data is stored with Supabase in Singapore (AWS ap-southeast-1). The website is served through Cloudflare. We do not sell your data and do not use it for advertising.

## How long we keep it

There is no automatic deletion today. Data stays until it is deleted, either by the organiser or by us at your request. We do not apply a fixed retention period.

## Asking us to remove or correct your data

Email us. We will delete or correct what we hold about you. We aim to do this within 14 working days.

Things to know:

- Deleting deletes what we can find by name, phone or email. Tell us which events you took part in to make sure we get everything.
- **Past results keep the name as it was entered for that event.** Each event entry stores the name and cafe as they were on the day, so a result is not rewritten later. If you want a name removed or changed from a past published result, tell us and we will handle it with the organiser.
- Guess the Bean sessions can be ended or reset by whoever created them, which permanently removes the guesses and contact details. If you took part and want yours removed, email us.

## Changes to this page

We will update this page when what we hold changes, and put the date at the top. [ADD: last updated date when published]
