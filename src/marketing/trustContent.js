// Copy for the public trust pages (About, Contact, Privacy, Terms, Neutrality).
// Source of truth for the wording is design/copy/*-page-draft.md, edited by the
// owner; this file is that copy with every review marker resolved or removed —
// nothing here may carry a [OWNER TO CONFIRM]/[VERIFY]/[TEMPORARY] note (the
// trustScreen test asserts that).
//
// Inline markup, parsed by trustScreen.js's renderInline (never innerHTML):
//   **bold**   and   [link text](/path/)
//
// The contact address is ONE constant. It is temporary until a
// hello@seduhscore.com mailbox exists; swap it here, and only here, when it does.
export const CONTACT_EMAIL = 'greymatter.cw@outlook.com';
const EMAIL = `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`;

export const PRIVACY_UPDATED = '1 November 2026';
export const TERMS_UPDATED = '1 November 2026';

export const TRUST_PAGES = [
  {
    slug: 'about',
    name: 'About',
    title: 'About — Seduh Score',
    description: 'Who builds Seduh Score, why it exists, and how it stays fair.',
    lede: 'Scoring for coffee competitions, built by people in the coffee community.',
    blocks: [
      { type: 'h2', text: 'What Seduh Score is' },
      {
        type: 'p',
        text: 'Seduh Score is a platform for running coffee competitions. It handles registering competitors, timing and scoring heats, working out the standings, and publishing results. It is built to keep working when the connection is poor, and to make every result something the organiser can explain and show.',
      },
      {
        type: 'p',
        text: 'It supports two competition formats today, Cup Taster and BTC (Barista Team Championship). Throwdown and Liga Seduh are still to come. We also offer free [community tools](/community/), including a Timer and Guess the Bean, and a public archive of published results.',
      },
      { type: 'h2', text: 'Who builds it' },
      {
        type: 'p',
        text: 'Seduh Score is built by Grey Matter Coffee Werks, a specialty coffee company based in Brunei. Now in our fifth year since rebranding from TwentyFive, we have been an active part of Brunei’s growing coffee community — participating in competitions, supporting education and events, and contributing to initiatives that help move the local coffee scene forward.',
      },
      { type: 'h2', text: 'Why we built it' },
      {
        type: 'p',
        text: 'Seduh Score began as a tool to help manage the first national-level Brunei Team Barista Championship. With no prior experience in competition management and a small team running the show, I created a basic tool to record scores in real time and deliver accurate results quickly.',
      },
      {
        type: 'p',
        text: 'Since then, it has grown in capability, one phase at a time. You can read more about that journey on the **[Behind the Seduh](/bts/)** page.',
      },
      {
        type: 'p',
        text: 'This version is a complete rebuild by the same person who created the original — now with offline capability, a proper database, and scoring and advancement rules built directly into the system instead of being worked out by hand.',
      },
      { type: 'h2', text: 'How we keep it fair' },
      {
        type: 'p',
        text: 'We run the platform. We don’t run your competition. The organiser decides the format, the judges, the rules and the results. Scoring follows fixed public rules, and changes to a score are logged. When Grey Matter, its staff or its students are involved in an event, there are extra safeguards. The details are on the [Neutrality page](/neutrality/).',
      },
      { type: 'h2', text: 'Where we are' },
      { type: 'p', text: 'With love from Old Kiulap, Negara Brunei Darussalam.' },
      { type: 'h2', text: 'Get in touch' },
      { type: 'p', text: 'See the [Contact page](/contact/).' },
    ],
  },
  {
    slug: 'contact',
    name: 'Contact',
    title: 'Contact — Seduh Score',
    description: 'How to reach the Seduh Score team.',
    lede: 'Get in touch.',
    blocks: [
      { type: 'h2', text: 'Email us' },
      { type: 'p', text: EMAIL },
      {
        type: 'p',
        text: 'We are a small team, so email is the best route. We read everything, and we aim to reply within 3 working days.',
      },
      { type: 'h2', text: 'What to email us about' },
      {
        type: 'ul',
        items: [
          '**Questions about Seduh Score**, including formats, pricing and running an event.',
          '**Problems using the platform**, such as something that does not load or a score that will not save. Tell us the event, the device and what you saw.',
          '**Data requests**, including asking us to delete or correct personal data we hold. See the [Privacy page](/privacy/).',
          '**A concern about how something was handled.** Tell us what happened and where.',
        ],
      },
      { type: 'h2', text: 'If you are a competitor and disagree with a result' },
      {
        type: 'p',
        text: 'Grey Matter does not run your event and cannot change its results. The organiser decides them. Ask the organiser first. They can give you the full record of the event, including every recorded score and every change to it. If you still have a concern about how the platform behaved, email us and we will look into it.',
      },
      { type: 'h2', text: 'Who you are writing to' },
      {
        type: 'p',
        text: 'Seduh Score is built by Grey Matter Coffee Werks, a specialty coffee company registered in Brunei Darussalam. See the [About page](/about/) and the [Neutrality page](/neutrality/).',
      },
    ],
  },
  {
    slug: 'privacy',
    name: 'Privacy',
    title: 'Privacy — Seduh Score',
    description: 'What Seduh Score holds, who can see it, and how to ask us to remove it.',
    lede: 'What we hold, who can see it, and how to ask us to remove it.',
    updated: PRIVACY_UPDATED,
    blocks: [
      { type: 'h2', text: 'Who is responsible' },
      {
        type: 'p',
        text: `Seduh Score is run by Grey Matter Coffee Werks in Brunei. Questions or requests about your data: ${EMAIL}.`,
      },
      { type: 'h2', text: 'What we hold' },
      {
        type: 'p',
        text: '**Competitors and event entries** (entered by the organiser, usually ahead of the event)',
      },
      {
        type: 'ul',
        items: [
          'Display name, cafe, and bib number for each event.',
          'Phone number (required), and optionally email, cafe, country and organiser notes, in the organiser’s own registry of people.',
          'Times, right and wrong answers and results recorded during the event.',
          'A log of changes made to scores, times and results since 24 September 2026 (who made the change, when, the old and new value, and any reason given).',
        ],
      },
      {
        type: 'p',
        text: '**Seduh ID record** (a private record we keep that links the same person across organisers)',
      },
      {
        type: 'ul',
        items: [
          'A phone number in international format, the name it was published under, and, if the organiser entered one, a country.',
          'It is created only when you are named in a published, non-test result, or by us on request. Rehearsal (“test”) events never create one.',
          'It is linked to the entry for you in each organiser’s own registry, so the same phone number is recognised as the same person. If an organiser changes the phone number on your entry, the link is removed and checked again.',
          'It holds no email address, no results, no scores and no sign-in. Its contents are shown on no page, public or private. An organiser’s own people list shows only whether a person is linked.',
          'An organiser can also record, for its own people, that someone is staff or affiliated with it.',
        ],
      },
      { type: 'p', text: '**Organisers and staff**' },
      {
        type: 'ul',
        items: [
          'An email address and password for signing in, handled by our authentication provider (Supabase).',
          'Which organisation you belong to, and your user ID against changes you make.',
        ],
      },
      { type: 'p', text: '**Guess the Bean participants** (public tool, no account needed)' },
      {
        type: 'ul',
        items: [
          'The name you give, your guess, and a phone number or Instagram handle you choose to give so an organiser can contact a winner.',
        ],
      },
      { type: 'p', text: '**What is published to the public archive**' },
      {
        type: 'ul',
        items: [
          '**A Community event’s podium, about 24 hours after it ends.** The event’s format, name, city, venue and date, the number of competitors and rounds, the winning time, and the podium: each person’s place, name, cafe, and how many sets they got right out of how many. The name of the organisation that ran the event is shown with it. When two or more people share a podium place, all of them are shown.',
          '**Not published:** the full standings, phone numbers, emails, set-by-set marks, or the names and details of competitors who are not on the podium.',
          '**A name-only entry** (the event’s name, date, venue, city and the organiser, with no results) in two cases: on Per-event and Annual when the organiser has not chosen to list the results, and on Community when we cannot build a reliable podium (for example, the organiser’s device never sent the final results, or a score was changed after they were prepared). We would rather publish no podium than a wrong one. The organiser can publish the results themselves at any time.',
          '**Never for a rehearsal.** An event the organiser has marked as a test is not published.',
          '**How we do it.** Your organiser’s device prepares the podium when the champion is declared and sends it to us. A job in our database publishes it. The job only copies the fields listed above; it does not work out placings itself.',
          '**When an event “ends”.** When the champion is declared, when the organiser presses “Finish event”, or when we close a stuck event at the organiser’s request. The publication follows about 24 hours later (not earlier than 24 hours, and usually within a few minutes after; later if a publish has to be retried).',
        ],
      },
      { type: 'p', text: '**On your device**' },
      {
        type: 'ul',
        items: [
          'The Timer, Brew Planner and Random Selector tools, Guess the Bean setup and offline scoring store small amounts of data in your browser (local storage and IndexedDB) so they keep working without a connection. For the Brew Planner that is your heats, coffees, machines and ticked-off items. For the Random Selector it is your entry list, its settings and your recent draws. This stays on your device: neither tool sends it to us. We use no advertising trackers. We do use Cloudflare Web Analytics, a privacy-focused service that measures how pages perform and how many people visit, without tracking individuals across sites. We also use Google Search Console and Bing Webmaster Tools to see how the site appears in search results. They report on searches, not on individual visitors.',
          '**Random Selector share links** put the list you shared in the link’s web address. Anyone you send the link to can read that list, and the address may be kept by the app you paste it into or in the logs of the services that deliver the page, such as Cloudflare. Leave out anything you would not want shared.',
        ],
      },
      { type: 'h2', text: 'Who can see it' },
      {
        type: 'ul',
        items: [
          '**Organisers and their team** can see their own organisation’s registry and events. Another organisation’s members cannot.',
          '**The public** sees the name and date of each event, the live audience view (standings and competitor names) while an event is running, and the results of events published to the public results archive. Whether an event’s results are published depends on the plan the organiser is on. **Community events are published automatically:** about 24 hours after an event ends, its podium is published to the public archive. The organiser can publish sooner, and is told in the app that the time is coming. **On Per-event and Annual, the organiser chooses** whether the results are listed. An event whose results are not listed is still named in the archive (its name, date, venue and city, and the organiser), with no results. For a Cup Taster event the organiser chooses how much. By default that is the event name, city, venue and date, the number of competitors and rounds, the winning time, and the top three (name, cafe and how many they got right). On Community, only the podium is published. The organiser can instead publish the full standings: every competitor’s placing, name, cafe, how many they got right and their time in the last round they reached, and which round that was. Competitors who withdrew, or who have no scores, are left out. Every published event also has a printable results sheet, showing the podium or the full standings, whichever the organiser chose. Every published result also shows the name of the organisation that ran the event. Published results never include phone numbers, emails or set-by-set marks. The score-change record on the results page shows what changed after results were confirmed, never the scores involved.',
          '**If you take part in an event run on the Community plan**, your placing, name and cafe appear in the public archive about 24 hours after the event ends, if you are on the podium. Your phone number, email and set-by-set marks are never published. On the paid plans, the organiser decides whether results are listed. If you want your name removed or changed in a published result, see “Asking us to remove or correct your data” below.',
          '**Can the organiser stop it?** On Community, the organiser can take a published result down. We count how often that happens, and the result is not published again automatically. Publication is a condition of the Community plan (see the [Terms](/terms/)). If you are a competitor and want something removed, you do not need to rely on the organiser: ask us, as below.',
          '**The Seduh ID record is private.** No organiser, competitor or member of the public can read it, and no page shows what is in it. An organiser sees only its own registry and its own entries; one organiser cannot see another organiser’s records, or what another organiser holds about you.',
          '**Staff and affiliate lists** are kept by an organiser about its own people (for example, that someone is staff). Only members of that organisation can see them. They are not shown to other organisers or to the public.',
          '**Our operator view shows totals only**: how many records exist and in what state. It does not show names, phone numbers or which organiser anyone belongs to. Direct access to the database stays with one person, as described below.',
          '**Set-by-set marks and the full change log** go only to the organiser, who may hand them over on request (the dispute pack). The pack contains names, cafes and bib numbers but not phone numbers or emails.',
          '**Guess the Bean phone numbers and Instagram handles** are visible only to the person who created that session. Before the reveal, the live display shows names but not guesses. The reveal shows names and guesses, never contact details.',
          '**Grey Matter** restricts direct access to the database to one person, the owner of Seduh Score. It is used to keep the service running and to act on your requests, not to read organisers’ data.',
        ],
      },
      { type: 'h2', text: 'Where it is stored' },
      {
        type: 'p',
        text: 'Data is stored in Singapore, with Supabase (AWS ap-southeast-1), and is primarily processed there. If personal data is transferred outside Brunei, we will make sure it is protected to a standard comparable to that of the Personal Data Protection Order, 2025. The website is served through Cloudflare. We do not sell your data and do not use it for advertising.',
      },
      { type: 'h2', text: 'How long we keep it' },
      {
        type: 'p',
        text: 'A result published to the public archive stays there until it is removed, by the organiser or by us at your request. There is no automatic deletion of published results, and we do not apply a fixed retention period to them.',
      },
      {
        type: 'p',
        text: 'Before a Community result is published, the organiser’s device sends us a prepared copy of the podium, which we hold until the result is published. We delete that copy when it is published, or 30 days after it was due to be published if it never was.',
      },
      {
        type: 'p',
        text: 'A Seduh ID record has no automatic deletion either. It stays until we delete it.',
      },
      { type: 'h2', text: 'Asking us to remove or correct your data' },
      {
        type: 'p',
        text: `Email us at ${EMAIL}. We will delete or correct what we hold about you. We aim to do this within 14 working days.`,
      },
      { type: 'p', text: 'Things to know:' },
      {
        type: 'ul',
        items: [
          'Deleting deletes what we can find by name, phone or email. Tell us which events you took part in to make sure we get everything.',
          '**Past results keep the name as it was entered for that event.** Each event entry stores the name and cafe as they were on the day, so a result is not rewritten later. If you want a name removed or changed from a past published result, tell us and we will handle it with the organiser.',
          `**Asking us to take your name off a published result, or to stop publishing yours.** Email our Data Protection Officer, Grey Matter Coffee Werks (D29, Bangunan Lim Eng Ming, Kg Kiulap, Brunei Darussalam), at ${EMAIL}. We will acknowledge your request within 10 days. We will tell you what we can do and what the consequence is: for example, we can remove your name from the public archive entry, but we cannot change the organiser’s own record of the event. If you took part in a Community event, tell us which one.`,
          '**Asking us to stop using your Seduh ID record.** Email us and we will mark your record as opted out. We remove the name from it and stop using it. **We keep the phone number on that record** so that we can recognise it and honour your request; without it, a later result with the same number would create the record again. It is used for nothing else. Organisers’ own registries are separate: ask the organiser, or us, to remove those as above.',
          'Guess the Bean sessions can be ended or reset by whoever created them, which permanently removes the guesses and contact details. If you took part and want yours removed, email us.',
        ],
      },
      { type: 'h2', text: 'Changes to this page' },
      {
        type: 'p',
        text: 'We will update this page when what we hold changes, and put the date at the top.',
      },
    ],
  },
  {
    slug: 'terms',
    name: 'Terms',
    title: 'Terms — Seduh Score',
    description: 'The ground rules for using Seduh Score.',
    lede: 'The ground rules for using Seduh Score.',
    updated: TERMS_UPDATED,
    blocks: [
      { type: 'h2', text: 'Who we are' },
      {
        type: 'p',
        text: `Seduh Score is run by Grey Matter Coffee Werks in Brunei (“we”, “us”). By using the website or the app you agree to these terms. If you do not agree, please do not use it. Contact: ${EMAIL}.`,
      },
      { type: 'h2', text: 'What Seduh Score is' },
      {
        type: 'p',
        text: 'A tool for running coffee competitions: registering competitors, timing and scoring heats, working out standings, and publishing results. We also offer free [community tools](/community/), such as the Timer and Guess the Bean.',
      },
      { type: 'h2', text: 'The organiser is in charge of the event' },
      {
        type: 'ul',
        items: [
          'The organiser decides the format, the judges, the rules and the results. We provide the platform. We do not run your event and do not decide its outcome.',
          'Organisers are responsible for the data they enter, including having the right to enter competitors’ details, and for telling competitors how the event is run.',
          'Organisers are responsible for checking results before they publish them.',
          'If your event runs on the Community plan, its results are published to the public archive automatically, about 24 hours after the event ends: the podium, which shows each placed competitor’s name, cafe and placing. **Tell your competitors before the event** that their name, cafe and placing will be public. You are responsible for having done so.',
          'On the Per-event and Annual plans, you choose whether the results are listed. If you do not, the event is still named in the archive, with no results.',
          'You can publish your results earlier than 24 hours after the event ends. You are responsible for checking them first. The automatic publication uses the results as they stand when the event ends.',
          'If you register competitors, you are responsible for having the right to enter their phone numbers. We use a competitor’s phone number to recognise the same person across organisers in a private Seduh ID record (see the [Privacy page](/privacy/)). Tell your competitors that.',
        ],
      },
      { type: 'h2', text: 'Your account' },
      {
        type: 'ul',
        items: [
          'Keep your sign-in details to yourself. You are responsible for what happens under your account.',
          'Give accurate information. Tell us if you think someone else has access to your account.',
        ],
      },
      { type: 'h2', text: 'Acceptable use' },
      {
        type: 'p',
        text: 'Do not use Seduh Score to break the law, to harass or mislead people, to enter other people’s personal details without a good reason, or to attack, overload or probe the service. We may suspend access that does.',
      },
      { type: 'h2', text: 'Your data' },
      {
        type: 'p',
        text: 'Event data belongs to the organiser. What we hold and how to ask us to remove it is set out on the [Privacy page](/privacy/).',
      },
      { type: 'h2', text: 'Seduh ID' },
      {
        type: 'ul',
        items: [
          'Seduh ID is a private record that recognises the same person, by phone number, across the organisers who use Seduh Score. It is not an account, a profile or a ranking, and it does not change any result.',
          'A match is made on the phone number only. It does not prove who a person is, and a number that has been reused or shared can match the wrong person. If a record is wrong, email us and we will correct it.',
          'You can ask us to stop using your record at any time (see the [Privacy page](/privacy/)).',
        ],
      },
      { type: 'h2', text: 'How the platform behaves' },
      {
        type: 'ul',
        items: [
          'Scores are worked out by fixed, public rules from the raw entries. Since 24 September 2026, changes to a score or time after it is entered are logged.',
          'Timing and confirming heats are saved on the device first and sent to our servers when the connection returns. Until then the data is only on that device, so do not clear the browser’s data. We cannot recover what was never sent.',
          'We work to keep the service running but do not promise it will always be available or free of errors.',
        ],
      },
      { type: 'h2', text: 'Pricing' },
      {
        type: 'p',
        text: 'Pricing is set out on the [Pricing page](/pricing/) and is not part of these terms, with one exception: on the Community plan, the organiser agrees that the event’s results (the podium) are published to the public archive automatically, about 24 hours after the event ends.',
      },
      { type: 'h2', text: 'Community results are public' },
      {
        type: 'ul',
        items: [
          'A condition of using the Community plan is that your event’s results are published to the public archive, as described above.',
          'If you take a published result down, we may count that and we do not publish it again automatically.',
          'A competitor can ask us to remove their own name from a published result (see the [Privacy page](/privacy/)). We will deal with each request ourselves; you do not need to approve it.',
          'If a published result is wrong, tell us and correct it by publishing the corrected result.',
        ],
      },
      { type: 'h2', text: 'Our responsibility' },
      {
        type: 'p',
        text: 'Seduh Score is provided as it is. To the extent the law allows, we are not responsible for losses that come from a result, a competition outcome, lost or late data, or downtime. Nothing here limits any right you have that the law does not let us limit.',
      },
      { type: 'h2', text: 'The software' },
      {
        type: 'p',
        text: 'The source code is publicly viewable for transparency. It is not open source: the licence in the repository’s LICENSE.md file lets anyone read it, but copying, modifying, self-hosting or selling it needs our written permission. The Seduh Score name and logo remain ours.',
      },
      { type: 'h2', text: 'Changes' },
      {
        type: 'p',
        text: 'We may update these terms. We will put the date at the top when we do. If you keep using Seduh Score after a change, you accept the new terms. For a change that matters, we will tell organisers by email.',
      },
      { type: 'h2', text: 'Governing law' },
      {
        type: 'p',
        text: 'These terms are governed by the laws of Brunei Darussalam, and the courts of Brunei Darussalam have jurisdiction over any dispute about them.',
      },
      { type: 'h2', text: 'Contact' },
      { type: 'p', text: 'Questions about these terms: see the [Contact page](/contact/).' },
    ],
  },
  {
    slug: 'neutrality',
    name: 'Neutrality',
    title: 'Neutrality & independence — Seduh Score',
    description: 'How Seduh Score stays neutral: we run the platform, not your competition.',
    lede: 'We run the platform. We don’t run your competition.',
    blocks: [
      { type: 'h2', text: 'Who we are' },
      {
        type: 'p',
        text: 'Seduh Score is built by Grey Matter Coffee Werks, a specialty coffee company in Brunei. We also take part in Brunei’s coffee community, and the wider one, as a business. Occasionally we offer training and coaching, and some of those individuals compete in events. This page says plainly how that is kept separate from the platform.',
      },
      { type: 'h2', text: 'What we do and don’t do' },
      {
        type: 'ul',
        items: [
          '**The organiser decides.** The organiser sets the format, the judges and the rules. As platform developer, Grey Matter has no say in any event’s results and does not see or edit scores on your behalf.',
          '**The rules are fixed code, and public.** Ranking, tie-breaks and advancement are deterministic and the source code is public, so anyone can read exactly how a result is worked out.',
          '**Results can be re-derived.** Standings are calculated from the raw per-cupper scores every time; they are never typed in as a final figure.',
          '**Changes leave a trail.** Since 24 September 2026, every score or time edit is logged with who, when, the old and new value, and a reason for corrections after confirmation. The public results page shows the shape of that record; the organiser can hand over the exact record on request.',
        ],
      },
      { type: 'h2', text: 'When Grey Matter is involved in an event' },
      { type: 'p', text: 'If there’s a potential Conflict of Interest (COI):' },
      {
        type: 'ol',
        items: [
          'The event page says so.',
          'Results sign-off is given by an independent organiser or head judge who is not part of Grey Matter.',
          'Grey Matter does not judge categories its own students enter.',
        ],
      },
      { type: 'h2', text: 'Your data' },
      {
        type: 'p',
        text: 'Event data belongs to the organiser. Only the owner of Seduh Score has direct access to the database. You can ask us to delete or correct data we hold about you, and we aim to do so within 14 working days. The [Privacy page](/privacy/) sets out what we hold and who can see it.',
      },
      { type: 'h2', text: 'Raising a concern' },
      {
        type: 'p',
        text: `If you disagree with a result, ask the organiser first. They can give you the full record of the event. If you still have a concern about how the platform behaved, or about a conflict of interest, email ${EMAIL} and we will look into it. See the [Contact page](/contact/).`,
      },
    ],
  },
];

export const TRUST_LINKS = TRUST_PAGES.map(({ slug, name }) => ({
  href: `/${slug}/`,
  text: name,
}));
