import { describe, it, expect, vi } from 'vitest';
import {
  TeamError,
  canManageTeam,
  listTeamMembers,
  listRemovedTeamMembers,
  removeTeamMember,
  addTeamMember,
  resetTeamMemberPassword,
  restoreTeamMember,
  describeTeamError,
} from './team.js';

const ORG = 'org-1';

function rpcClient(result) {
  const rpc = vi.fn(async () => result);
  return { rpc, client: { rpc } };
}

function functionsClient(invoke) {
  return { functions: { invoke: vi.fn(invoke) } };
}

describe('canManageTeam', () => {
  it('asks the database about this org and is true only for an exact true', async () => {
    const { rpc, client } = rpcClient({ data: true, error: null });
    expect(await canManageTeam(ORG, client)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('team_can_manage', { p_org_id: ORG });
  });

  it.each([[false], [null], ['true'], [1]])('is false for %s', async (data) => {
    expect(await canManageTeam(ORG, rpcClient({ data, error: null }).client)).toBe(false);
  });

  it('is null, not false, when the check itself fails — so the caller can keep what it knew', async () => {
    expect(
      await canManageTeam(ORG, rpcClient({ data: null, error: { message: 'x' } }).client),
    ).toBe(null);
  });
});

describe('listTeamMembers', () => {
  it('maps the rows for the screen, in the order given', async () => {
    const { rpc, client } = rpcClient({
      data: [
        {
          user_id: 'u1',
          email: 'owner@example.com',
          role: 'owner',
          added_at: '2026-08-30T00:00:00Z',
          last_sign_in_at: '2026-10-07T01:00:00Z',
          must_change_password: false,
        },
        {
          user_id: 'u2',
          email: 'new@example.com',
          role: 'organiser',
          added_at: '2026-10-07T02:00:00Z',
          last_sign_in_at: null,
          must_change_password: true,
        },
      ],
      error: null,
    });
    expect(await listTeamMembers(ORG, client)).toEqual([
      {
        userId: 'u1',
        email: 'owner@example.com',
        role: 'owner',
        lastSignInAt: '2026-10-07T01:00:00Z',
        mustChangePassword: false,
      },
      {
        userId: 'u2',
        email: 'new@example.com',
        role: 'organiser',
        lastSignInAt: null,
        mustChangePassword: true,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith('team_list_members', { p_org_id: ORG });
  });

  it('returns an empty list for no rows', async () => {
    expect(await listTeamMembers(ORG, rpcClient({ data: null, error: null }).client)).toEqual([]);
  });

  it('turns a permission refusal (42501) into the "only the owner" message', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'raw' } });
    await expect(listTeamMembers(ORG, client)).rejects.toMatchObject({
      message: 'Only the owner can manage the team.',
      status: 403,
    });
  });

  it('does not repeat any other database message', async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: 'XX000', message: 'internal secret' },
    });
    const error = await listTeamMembers(ORG, client).catch((e) => e);
    expect(error).toBeInstanceOf(TeamError);
    expect(error.message).toBe('Something went wrong. Try again.');
  });
});

describe('removeTeamMember', () => {
  it('calls the RPC with the org and the person', async () => {
    const { rpc, client } = rpcClient({ data: null, error: null });
    await removeTeamMember(ORG, 'u2', client);
    expect(rpc).toHaveBeenCalledWith('team_remove_member', { p_org_id: ORG, p_user_id: 'u2' });
  });

  it('shows the owner the rule that stopped them, without the function-name prefix', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'team_remove_member: an owner cannot be removed' },
    });
    await expect(removeTeamMember(ORG, 'u1', client)).rejects.toMatchObject({
      message: 'an owner cannot be removed',
    });
  });

  it('turns a permission refusal into the "only the owner" message', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'x' } });
    await expect(removeTeamMember(ORG, 'u2', client)).rejects.toMatchObject({
      message: 'Only the owner can manage the team.',
    });
  });
});

describe('listRemovedTeamMembers', () => {
  it('asks the database for this org’s removed members and maps the rows for the screen, in the order given', async () => {
    const { rpc, client } = rpcClient({
      data: [
        { user_id: 'u3', email: 'may@example.com', removed_at: '2026-10-07T12:00:00Z' },
        { user_id: 'u4', email: 'ned@example.com', removed_at: '2026-10-06T12:00:00Z' },
      ],
      error: null,
    });
    expect(await listRemovedTeamMembers(ORG, client)).toEqual([
      { userId: 'u3', email: 'may@example.com', removedAt: '2026-10-07T12:00:00Z' },
      { userId: 'u4', email: 'ned@example.com', removedAt: '2026-10-06T12:00:00Z' },
    ]);
    expect(rpc).toHaveBeenCalledWith('team_list_removed_members', { p_org_id: ORG });
  });

  it('returns an empty list for no rows', async () => {
    expect(
      await listRemovedTeamMembers(ORG, rpcClient({ data: null, error: null }).client),
    ).toEqual([]);
  });

  it('turns a permission refusal (42501) into the "only the owner" message', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'raw' } });
    await expect(listRemovedTeamMembers(ORG, client)).rejects.toMatchObject({
      message: 'Only the owner can manage the team.',
      status: 403,
    });
  });

  it('does not repeat any other database message', async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: 'XX000', message: 'internal secret' },
    });
    const error = await listRemovedTeamMembers(ORG, client).catch((e) => e);
    expect(error).toBeInstanceOf(TeamError);
    expect(error.message).toBe('Something went wrong. Try again.');
  });
});

describe('restoreTeamMember', () => {
  it('sends the restore action with the org and the person, and returns the new one-time password', async () => {
    const client = functionsClient(async () => ({
      data: { userId: 'u3', password: 'k7mx-p3qa-9wdn' },
      error: null,
    }));
    expect(await restoreTeamMember(ORG, 'u3', client)).toEqual({ password: 'k7mx-p3qa-9wdn' });
    expect(client.functions.invoke).toHaveBeenCalledWith('team-accounts', {
      body: { action: 'restore', orgId: ORG, userId: 'u3' },
    });
  });

  it('shows the owner the function’s own message when it refuses', async () => {
    const client = functionsClient(async () => ({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: 'That person cannot be restored.' }), {
          status: 403,
        }),
      },
    }));
    await expect(restoreTeamMember(ORG, 'u3', client)).rejects.toMatchObject({
      message: 'That person cannot be restored.',
      status: 403,
    });
  });

  it('says it could not reach the server when there was no answer', async () => {
    const client = functionsClient(async () => {
      throw new Error('network');
    });
    await expect(restoreTeamMember(ORG, 'u3', client)).rejects.toMatchObject({
      message: 'Could not reach the server — check your connection and try again.',
    });
  });
});

describe('addTeamMember / resetTeamMemberPassword', () => {
  it('add sends the org and email to the function and returns the one-time password', async () => {
    const client = functionsClient(async () => ({
      data: { userId: 'u9', email: 'a@b.com', password: 'k7mx-p3qa-9wdn' },
      error: null,
    }));
    expect(await addTeamMember(ORG, 'a@b.com', client)).toEqual({
      email: 'a@b.com',
      password: 'k7mx-p3qa-9wdn',
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('team-accounts', {
      body: { action: 'add', orgId: ORG, email: 'a@b.com' },
    });
  });

  it('reset sends the org and the person and returns the new one-time password', async () => {
    const client = functionsClient(async () => ({
      data: { userId: 'u2', password: 'aaaa-bbbb-cccc' },
      error: null,
    }));
    expect(await resetTeamMemberPassword(ORG, 'u2', client)).toEqual({
      password: 'aaaa-bbbb-cccc',
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('team-accounts', {
      body: { action: 'reset', orgId: ORG, userId: 'u2' },
    });
  });

  it("shows the function's own message and status when it refuses", async () => {
    const client = functionsClient(async () => ({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: 'That email already has an account.' }), {
          status: 409,
        }),
      },
    }));
    await expect(addTeamMember(ORG, 'a@b.com', client)).rejects.toMatchObject({
      message: 'That email already has an account.',
      status: 409,
    });
  });

  it('says something generic when the refusal has no readable message', async () => {
    const client = functionsClient(async () => ({
      data: null,
      error: { context: new Response('<html>bad gateway</html>', { status: 502 }) },
    }));
    const error = await addTeamMember(ORG, 'a@b.com', client).catch((e) => e);
    expect(error.message).toBe('Something went wrong. Try again.');
    expect(error.status).toBe(502);
  });

  it('says it could not reach the server when there was no response at all', async () => {
    const offline = functionsClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(addTeamMember(ORG, 'a@b.com', offline)).rejects.toMatchObject({
      message: 'Could not reach the server — check your connection and try again.',
    });
    const noResponse = functionsClient(async () => ({
      data: null,
      error: { context: new TypeError('Failed to fetch') },
    }));
    await expect(resetTeamMemberPassword(ORG, 'u2', noResponse)).rejects.toMatchObject({
      message: 'Could not reach the server — check your connection and try again.',
    });
  });
});

describe('describeTeamError', () => {
  it('uses a TeamError’s own message and hides anything else', () => {
    expect(describeTeamError(new TeamError('Only the owner can manage the team.'))).toBe(
      'Only the owner can manage the team.',
    );
    expect(describeTeamError(new Error('stack trace words'))).toBe(
      'Something went wrong. Try again.',
    );
  });
});

describe('small contracts', () => {
  it('only strips the SQL function-name prefix when it is the start of the message', async () => {
    const { client } = rpcClient({
      data: null,
      error: { message: 'xx team_remove_member: an owner cannot be removed' },
    });
    await expect(removeTeamMember(ORG, 'u1', client)).rejects.toMatchObject({
      message: 'Something went wrong. Try again.',
    });
  });

  it('reads a missing must_change_password as false, not undefined', async () => {
    const { client } = rpcClient({
      data: [{ user_id: 'u1', email: 'a@b.com', role: 'organiser', must_change_password: null }],
      error: null,
    });
    const [row] = await listTeamMembers(ORG, client);
    expect(row.mustChangePassword).toBe(false);
  });

  it('ignores a function error whose payload message is not text', async () => {
    const client = functionsClient(async () => ({
      data: null,
      error: { context: new Response(JSON.stringify({ error: 42 }), { status: 400 }) },
    }));
    const error = await addTeamMember(ORG, 'a@b.com', client).catch((e) => e);
    expect(error.message).toBe('Something went wrong. Try again.');
  });

  it('names its error class, so a log line says what it is', () => {
    expect(new TeamError('x').name).toBe('TeamError');
  });
});
