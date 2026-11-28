// The one list of free community tools: names, one-line pitches and addresses. The Community hub's
// cards and every tool's "More free community tools" strip (toolChrome.js) both read it, so a tool
// is renamed or re-described in exactly one place. Pure data, no DOM: the hub keeps its own icons.
//
// `id` is stable (a tool passes its own id to the chrome so it is left out of its own strip);
// `number` is the hub card's index.
export const COMMUNITY_TOOLS = [
  {
    id: 'timer',
    number: '01',
    title: 'Competition Timer',
    eyebrow: 'For keeping the room moving',
    body: 'A clear, full-screen timer for heats, routines, brews and the moments everyone needs to see at once.',
    href: '/tools/timer/',
    meta: 'No account needed',
  },
  {
    id: 'guess-the-bean',
    number: '02',
    title: 'Guess the Bean',
    eyebrow: 'For a little friendly suspense',
    body: 'Set the jar, share the link, and let the room guess. A simple booth game with a live display built in.',
    href: '/guess-the-bean/',
    meta: 'Set up with email',
  },
  {
    id: 'guess-the-bean-widget',
    number: '03',
    title: 'Guess the Bean Widget',
    eyebrow: 'For a glance from the home screen',
    body: 'A free Android widget that keeps the latest guesses, status and count one tap away — no app to open, no tab to find.',
    href: 'https://github.com/greymattercoffeewerks/Seduh-Score-Next/releases/latest/download/guess-the-bean-widget.apk',
    meta: 'Android · free download',
    arrowText: 'Download APK →',
    external: true,
    // A download, not a page: it is not offered as "another tool" inside a tool.
    inStrip: false,
  },
  {
    id: 'brew-planner',
    number: '04',
    title: 'Brew Planner',
    eyebrow: 'For the batch-brew crew backstage',
    body: 'Answer a few questions about heats, beans and machines, and get a run-sheet, water and Cambro cheat sheet for the day.',
    href: '/tools/brew-planner/',
    meta: 'No account needed',
  },
  {
    id: 'random-selector',
    number: '05',
    title: 'Random Selector',
    eyebrow: 'For turns, prizes and lucky draws',
    body: 'Draw one entry from a list on a split-flap board, with weighted odds, CSV import, share links and a big-screen mode.',
    href: '/tools/random-selector/',
    meta: 'No account needed',
  },
  {
    id: 'throwdown-planner',
    number: '06',
    title: 'Throwdown Bracket Planner',
    eyebrow: 'For planning a knockout before the day',
    body: 'Enter how many brewers you expect and see the rounds, byes, 3rd place match and Final, with or without a redemption round.',
    href: '/tools/throwdown-planner/',
    meta: 'No account needed',
  },
];

export const COMMUNITY_HUB_HREF = '/community/';

// The tools a strip on a tool page offers: every OTHER page-style tool.
export function otherCommunityTools(currentId) {
  return COMMUNITY_TOOLS.filter((tool) => tool.id !== currentId && tool.inStrip !== false);
}
