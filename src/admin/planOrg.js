// One organisation's plan, drawn from admin_plan_org (metadata only: tier, grants, the organisation's events as label /
// date / format / state, and the keys it would pass). Every change here is an EXISTING audited admin function reached
// through ctx.callAdmin (grant create / extend / revoke, payment confirm, event re-snapshot, event release); this file
// only collects the arguments, asks, and draws the page again from the database once a change is made (`reload`).
//
// What it draws is exactly the fields named below: an event's label (format, date, short id), date, format and state, never an entry, a person, a
// score, a phone or an e-mail (spec D-A4; the function returns none).
import { el } from '../core/dom.js';
import { formatDate } from './format.js';
import {
  bruneiDay,
  endOfBruneiDay,
  eventStateText,
  eventWindowText,
  formatName,
  keyName,
  offsetLabel,
  shortId,
  sourceLabel,
  tierLabel,
  windowDays,
  windowText,
} from './planFormat.js';
import {
  ask,
  confirmAction,
  labelled,
  nextId,
  plainInput,
  selectInput,
  writeForm,
  ALWAYS,
} from './planParts.js';

const OFFSETS = [-4, -3, -2, -1, 0];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UNKNOWN_GRANT =
  'We could not confirm whether the plan was saved. Reload the page and check the grants before trying again.';
const UNKNOWN_CHANGE =
  'We could not confirm whether the change was made. Reload the page to see the current state before trying again.';

const text = (value) => String(value ?? '');

function details(summary, node) {
  return el('details', { className: 'adm-details' }, [el('summary', { text: summary }), node]);
}

export function orgPlanView({ ctx, data, onGateRefused, mayTakeFocus, reload, writes = ALWAYS }) {
  const org = data?.org ?? {};
  const orgId = text(org.id);
  const grants = Array.isArray(data?.grants) ? data.grants : [];
  const events = Array.isArray(data?.events) ? data.events : [];
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  const common = { ctx, onGateRefused, mayTakeFocus, writes };

  // ---- creating a grant (by hand, or from a payment the operator confirms) ----

  function paymentField(idPrefix) {
    const input = plainInput(`${idPrefix}-payment`, 'text', { maxlength: '200' });
    const built = labelled(`${idPrefix}-payment`, 'Payment received (optional)', input, {
      hint: 'If this was paid, write the amount and the reference. It is recorded as a confirmed payment. Leave empty for a grant by hand.',
      required: false,
    });
    return { input, ...built };
  }

  function noteField(idPrefix) {
    const input = plainInput(`${idPrefix}-note`, 'text', { maxlength: '500' });
    return {
      input,
      ...labelled(`${idPrefix}-note`, 'Note (optional)', input, { required: false }),
    };
  }

  // The write itself: a confirmed payment when a payment note is given, else a grant by hand.
  function grantRun({ tier, eventId, offset, until, payment, note }) {
    if (payment) {
      return ask(ctx, 'admin_payment_confirm', {
        p_org_id: orgId,
        p_tier: tier,
        p_event_id: eventId ?? null,
        p_start_offset_days: offset ?? null,
        p_valid_until: until ?? null,
        p_amount_note: payment,
      });
    }
    return ask(ctx, 'admin_grant_create', {
      p_org_id: orgId,
      p_tier: tier,
      p_event_id: eventId ?? null,
      p_start_offset_days: offset ?? null,
      p_valid_until: until ?? null,
      p_note: note || null,
    });
  }

  function orgGrantForm() {
    const id = nextId('adm-plan-og');
    const tier = selectInput(`${id}-tier`, [
      { value: 'annual', label: 'Annual' },
      { value: 'per_event', label: 'Per-event (for the whole organisation)' },
    ]);
    const until = plainInput(`${id}-until`, 'date');
    const payment = paymentField(id);
    const note = noteField(id);
    return writeForm({
      ...common,
      title: 'Give the organisation a plan',
      intro:
        'For an Annual plan, or a Per-event plan that covers every event of the organisation. For one event only, use that event below.',
      submitLabel: 'Give the plan',
      workingLabel: 'Saving…',
      unknown: UNKNOWN_GRANT,
      fields: [
        labelled(`${id}-tier`, 'Plan', tier),
        labelled(`${id}-until`, 'Ends (optional)', until, {
          hint: 'The plan stays until the end of this day, Brunei time. Leave empty for no end.',
          required: false,
        }),
        payment,
        note,
      ],
      collect: () => {
        let endAt = null;
        if (until.value) {
          if (!DAY.test(until.value) || !endOfBruneiDay(until.value))
            return { problem: 'Enter the end as a date, or leave it empty.', focus: until };
          endAt = endOfBruneiDay(until.value);
        }
        return {
          args: {
            tier: tier.value,
            until: endAt,
            payment: payment.input.value.trim(),
            note: note.input.value.trim(),
          },
        };
      },
      run: (args) => grantRun(args),
      onDone: reload,
      successMessage: (args) =>
        args.payment
          ? `Payment confirmed: ${tierLabel(args.tier)} plan given.`
          : `${tierLabel(args.tier)} plan given.`,
    });
  }

  function eventGrantForm(event) {
    const id = nextId('adm-plan-eg');
    const date = text(event.event_date);
    const offsets = selectInput(
      `${id}-offset`,
      OFFSETS.map((o) => {
        const days = windowDays(date, o);
        return {
          value: o,
          label: days ? `${offsetLabel(o)} (${days.first} to ${days.last})` : offsetLabel(o),
        };
      }),
    );
    offsets.value = '-2';
    const payment = paymentField(id);
    const note = noteField(id);
    return writeForm({
      ...common,
      title: `Per-event plan for ${text(event.label)}`,
      intro: `Five days in Brunei time that include the competition date (${formatDate(event.event_date)}). T is the competition date.`,
      submitLabel: 'Give the Per-event plan',
      workingLabel: 'Saving…',
      unknown: UNKNOWN_GRANT,
      fields: [
        labelled(`${id}-offset`, 'Which five days?', offsets, {
          hint: 'The applicant chooses where the competition sits in the five days.',
        }),
        payment,
        note,
      ],
      collect: () => ({
        args: {
          tier: 'per_event',
          eventId: text(event.id),
          offset: Number(offsets.value),
          payment: payment.input.value.trim(),
          note: note.input.value.trim(),
        },
      }),
      run: (args) => grantRun(args),
      onDone: reload,
      successMessage: (args) =>
        args.payment
          ? `Payment confirmed: Per-event plan given for ${text(event.label)}.`
          : `Per-event plan given for ${text(event.label)}.`,
    });
  }

  // ---- extending, revoking ----

  function extendForm(grant) {
    const id = nextId('adm-plan-ex');
    const until = plainInput(`${id}-until`, 'date');
    const reason = plainInput(`${id}-reason`, 'text', { maxlength: '500' });
    return writeForm({
      ...common,
      title: 'Extend this plan',
      intro:
        'Adds a new linked row that starts where this one ends. Every extension is logged with its reason.',
      submitLabel: 'Extend the plan',
      workingLabel: 'Extending…',
      unknown: UNKNOWN_CHANGE,
      fields: [
        labelled(`${id}-until`, 'New end', until, {
          hint: 'The plan stays until the end of this day, Brunei time.',
        }),
        labelled(`${id}-reason`, 'Reason', reason, {
          hint: 'Required. For example: the venue postponed the final.',
        }),
      ],
      collect: () => {
        const end = endOfBruneiDay(until.value);
        if (!end) return { problem: 'Choose the new end date.', focus: until };
        if (Date.parse(end) <= Date.parse(grant.valid_until))
          return { problem: 'The new end must be later than the current end.', focus: until };
        if (!reason.value.trim())
          return { problem: 'Give a reason for the extension.', focus: reason };
        return { args: { end, reason: reason.value.trim() } };
      },
      run: (args) =>
        ask(ctx, 'admin_grant_extend', {
          p_grant_id: text(grant.id),
          p_new_valid_until: args.end,
          p_reason: args.reason,
        }),
      onDone: reload,
      successMessage: 'The plan was extended.',
    });
  }

  function grantItem(grant) {
    const scope = grant.event_id
      ? `Event: ${text(events.find((e) => e.id === grant.event_id)?.label ?? 'an event no longer listed')}`
      : 'The whole organisation';
    const revoked = Boolean(grant.revoked_at);
    const extended = grants.some((g) => g.extends_grant_id === grant.id && !g.revoked_at);
    const extendable = !revoked && Boolean(grant.valid_until) && !extended;
    const item = el(
      'li',
      { className: 'card adm-grant' },
      [
        el(
          'p',
          { className: 'adm-grant-title' },
          [
            el('strong', { text: tierLabel(grant.tier) }),
            el('span', { className: 'adm-muted', text: ` · ${scope}` }),
            revoked
              ? el('span', { className: 'adm-badge adm-badge--revoked', text: 'Revoked' })
              : null,
          ].filter(Boolean),
        ),
        el('p', { className: 'adm-muted', text: windowText(grant) }),
        el('p', {
          className: 'adm-muted',
          text: `${sourceLabel(grant.source)} · by ${shortId(grant.granted_by)} on ${formatDate(grant.created_at)}${
            grant.extends_grant_id ? ' · extends an earlier plan' : ''
          }`,
        }),
        grant.note ? el('p', { className: 'adm-muted', text: `Note: ${text(grant.note)}` }) : null,
      ].filter(Boolean),
    );
    if (revoked) return item;
    const actions = el('div', { className: 'adm-actions' });
    if (extendable) item.appendChild(details('Extend…', extendForm(grant).node));
    actions.appendChild(
      confirmAction({
        ...common,
        label: 'Revoke',
        subject: `${tierLabel(grant.tier)} plan for ${scope.replace(/^Event: /, '')}`,
        question: `Revoke this ${tierLabel(grant.tier)} plan? The organisation falls back to what its other plans give.`,
        confirmLabel: 'Revoke',
        workingLabel: 'Revoking…',
        unknown: UNKNOWN_CHANGE,
        run: () => ask(ctx, 'admin_grant_revoke', { p_grant_id: text(grant.id), p_note: null }),
        onDone: reload,
        successMessage: 'The plan was revoked.',
      }),
    );
    item.appendChild(actions);
    return item;
  }

  // ---- events ----

  function reasonForm({ title, intro, submitLabel, workingLabel, fn, arg, id, success }) {
    const fid = nextId('adm-plan-rs');
    const reason = plainInput(`${fid}-reason`, 'text', { maxlength: '500' });
    return writeForm({
      ...common,
      title,
      intro,
      submitLabel,
      workingLabel,
      unknown: UNKNOWN_CHANGE,
      fields: [labelled(`${fid}-reason`, 'Reason', reason, { hint: 'Required. It is logged.' })],
      collect: () =>
        reason.value.trim()
          ? { args: { reason: reason.value.trim() } }
          : { problem: 'Give a reason.', focus: reason },
      run: (args) => ask(ctx, fn, { [arg]: id, p_reason: args.reason }),
      onDone: reload,
      successMessage: success,
    });
  }

  function eventItem(event) {
    const open = !event.ended_via;
    const item = el(
      'li',
      { className: 'card adm-event' },
      [
        el(
          'p',
          { className: 'adm-grant-title' },
          [
            el('strong', { text: text(event.label) }),
            el('span', {
              className: 'adm-muted',
              text: ` · ${formatName(event.format)} · ${formatDate(event.event_date)}`,
            }),
            event.is_test
              ? el('span', { className: 'adm-badge adm-badge--test', text: 'Test event' })
              : null,
          ].filter(Boolean),
        ),
        el('p', {
          className: 'adm-muted',
          text: `${eventStateText(event)} · ${eventWindowText(event)}`,
        }),
        event.snapshot_tier
          ? el('p', {
              className: 'adm-muted',
              text: `Plan fixed when the event went live: ${tierLabel(event.snapshot_tier)}`,
            })
          : null,
      ].filter(Boolean),
    );
    if (!event.has_window && event.event_date)
      item.appendChild(details('Per-event plan…', eventGrantForm(event).node));
    if (event.snapshot_tier) {
      item.appendChild(
        details(
          'Raise this event’s plan…',
          reasonForm({
            title: 'Raise this event’s plan',
            intro:
              'An event keeps the plan it had when it went live. Use this when a better plan was bought after that. It only ever goes up.',
            submitLabel: 'Raise the plan',
            workingLabel: 'Raising…',
            fn: 'admin_event_resnapshot',
            arg: 'p_event_id',
            id: text(event.id),
            success: `The plan of ${text(event.label)} was raised.`,
          }).node,
        ),
      );
    }
    if (open) {
      item.appendChild(
        details(
          'Release this event…',
          reasonForm({
            title: 'Release this event',
            intro:
              'Ends a stuck open event so a Community organisation can start another. The organiser cannot reopen it.',
            submitLabel: 'Release the event',
            workingLabel: 'Releasing…',
            fn: 'admin_event_release',
            arg: 'p_event_id',
            id: text(event.id),
            success: `${text(event.label)} was released.`,
          }).node,
        ),
      );
    }
    return item;
  }

  // ---- the keys this organisation would pass ----

  function keyRow(key) {
    const would = key.allowed_if_enforced === true;
    return el('li', { className: 'adm-member' }, [
      el('span', { className: 'adm-member-email', text: keyName(key.key) }),
      el('span', { className: 'adm-role', text: key.enforced === true ? 'On' : 'Off' }),
      el('span', {
        className: 'adm-muted',
        text: `${
          key.enforced === true
            ? would
              ? 'Allowed'
              : 'Blocked'
            : would
              ? 'Allowed once this is on'
              : 'Would be blocked once this is on'
        }${
          key.kind === 'cap'
            ? ` · ${key.limit === null || key.limit === undefined ? 'no limit' : `limit ${key.limit}`}`
            : ''
        }`,
      }),
    ]);
  }

  const bruneiNote = `Times are Brunei time (UTC+8). Today is ${bruneiDay(new Date().toISOString())} there.`;

  return [
    el('dl', { className: 'adm-facts' }, [
      el('div', { className: 'adm-fact' }, [
        el('dt', { text: 'Link name' }),
        el('dd', { text: text(org.slug) }),
      ]),
      el('div', { className: 'adm-fact' }, [
        el('dt', { text: 'Plan now' }),
        el('dd', { text: tierLabel(data?.tier) }),
      ]),
    ]),
    el('section', { className: 'adm-section' }, [
      el('h2', { text: `Plans (${grants.length})` }),
      el('p', { className: 'adm-muted', text: bruneiNote }),
      grants.length === 0
        ? el('p', {
            className: 'adm-muted',
            text: 'No plan has been given. This organisation is on the free Community plan.',
          })
        : el('ul', { className: 'adm-org-list', attrs: { role: 'list' } }, grants.map(grantItem)),
      orgGrantForm().node,
    ]),
    el(
      'section',
      { className: 'adm-section' },
      [
        el('h2', { text: `Events (${events.length})` }),
        Number.isInteger(data?.events_total) && data.events_total > events.length
          ? el('p', {
              className: 'adm-muted',
              text: `Showing the newest ${events.length} of ${data.events_total} events.`,
            })
          : null,
        events.length === 0
          ? el('p', { className: 'adm-muted', text: 'This organisation has no events.' })
          : el('ul', { className: 'adm-org-list', attrs: { role: 'list' } }, events.map(eventItem)),
      ].filter(Boolean),
    ),
    el('section', { className: 'adm-section' }, [
      el('h2', { text: 'Keys for this organisation' }),
      el('p', {
        className: 'adm-muted',
        text: 'What this organisation can do, or would be able to do once each key is on, using its plan today. Single-event plans are not counted.',
      }),
      el('ul', { className: 'adm-members', attrs: { role: 'list' } }, keys.map(keyRow)),
    ]),
  ];
}
