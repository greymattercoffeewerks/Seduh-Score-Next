// The guided tours for Throwdown's organiser screens. The engine is core/tour.js; this file is only the words and the
// anchors (`data-tour="..."` attributes the screens carry). A step whose anchor is not on the page (no redemption
// toggle, no planner after the draw) is skipped by the engine, so these lists can name everything.
// Bump the `.vN` of an id when a tour changes enough that people who saw the old one should see it again.

export const SETUP_TOUR_ID = 'throwdown-setup.v1';
export const DASHBOARD_TOUR_ID = 'throwdown-dashboard.v1';

export const setupTourSteps = [
  {
    title: 'Setting up a Throwdown',
    body: 'A one-minute walk through this page: who is competing, the rules, and what the bracket will look like. Skip it any time. The Take the tour button brings it back.',
  },
  {
    target: '[data-tour="td-competitors"]',
    title: 'Add your brewers',
    body: 'Type each competitor in here. The count in the heading is how many are in. You can still edit a name or café after the draw.',
  },
  {
    target: '[data-tour="td-setup"]',
    title: 'Set the rules',
    body: 'Pick how many judges vote, whether there is a 3rd place match, and how the bracket is drawn. This locks as soon as Round 1 starts.',
  },
  {
    target: '[data-tour="td-redemption"]',
    title: 'Redemption: a second chance',
    body: 'Turn this on and brewers who lose a chosen round are drawn into small groups. Each group votes for one winner, who goes back into the bracket.',
  },
  {
    target: '[data-tour="td-preview"]',
    title: 'What will happen',
    body: 'This card shows, from the numbers alone, how many rounds and matches you will get, who gets a bye, and anything to check.',
  },
  {
    target: '[data-tour="td-plan"]',
    title: 'Plan the event',
    body: 'Try a different number of brewers, 3rd place or redemption here to see what changes. It is a what-if: nothing is saved.',
  },
  {
    target: '[data-tour="td-draw"]',
    title: 'Draw and start',
    body: 'When the roster and rules are right, draw the bracket here and start Round 1. After that the setup is locked.',
  },
];

export const dashboardTourSteps = [
  {
    target: '[data-tour="td-next"]',
    title: 'Your next step',
    body: 'This card always names the one thing to do next, with a button for it.',
  },
  {
    target: '[data-tour="td-preview"]',
    title: 'What will happen',
    body: 'Before the draw, this shows how the bracket will play out with your saved setup: rounds, matches and byes.',
  },
  {
    target: '[data-tour="td-plan"]',
    title: 'Plan the event',
    body: 'Try a different number of brewers or redemption to see the effect. Nothing here is saved. The real setup is on the Matches page.',
  },
];
