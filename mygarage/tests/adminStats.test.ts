import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { useMyGarageDb, testDb } from './harness';
import { getMyGarageStats } from '../usecases/adminStatsUsecase';

useMyGarageDb();

const run = (q: string) => testDb.execute(sql.raw(q));

describe('MyGarage admin stats', () => {
  it('counts accounts, activity, Plus, invites, backup and sharing', async () => {
    await run(`insert into users (id, google_sub, email, wrapped_key, created_at) values
      ('a', 'sa', 'a@x.y', 'k', now()), ('b', 'sb', 'b@x.y', 'k', now() - interval '10 days'), ('c', 'sc', 'c@x.y', 'k', now() - interval '40 days')`);
    // Last seen: a now, b 10 days ago, c 91 days ago (session expired).
    await run(`insert into refresh_tokens (token_hash, user_id, expires_at) values
      ('t1', 'a', now() + interval '90 days'), ('t2', 'b', now() + interval '80 days'), ('t3', 'c', now() - interval '1 day')`);
    await run(`insert into subscriptions (purchase_token, user_id, product_id, base_plan_id, state, expires_at, auto_renew) values
      ('p1', 'a', 'plus', 'monthly', 'SUBSCRIPTION_STATE_ACTIVE', now() + interval '20 days', true),
      ('p2', 'b', 'plus', 'yearly', 'SUBSCRIPTION_STATE_CANCELED', now() - interval '1 day', false)`);
    await run(`insert into referral_codes (user_id, code) values ('a', 'MG-AAAAA')`);
    await run(`insert into referrals (id, referrer_id, referee_id, source, status) values ('r', 'a', 'b', 'typed', 'rewarded')`);
    await run(`insert into plus_grants (id, user_id, reason, days, starts_at, ends_at, referral_id) values
      ('g1', 'b', 'referral', 30, now() - interval '1 day', now() + interval '29 days', 'r'),
      ('g2', 'a', 'referral', 30, now() + interval '19 days', now() + interval '49 days', 'r')`);
    await run(`insert into sync_records (scope, tbl, id, updated_at, deleted_at, payload) values
      ('u:a', 'vehicles', '1', 1, null, 'x'), ('u:a', 'vehicles', '2', 1, null, 'x'), ('u:a', 'documents', '3', 1, 1, 'x'), ('g:x', 'vehicles', '4', 1, null, 'x')`);
    await run(`insert into cloud_files (scope, owner_id, file_id, size, status) values ('u:a', 'a', 'f1', 1000, 'uploaded'), ('u:a', 'a', 'f2', 5, 'pending')`);
    await run(`insert into shared_garages (id, owner_id, wrapped_key) values ('x', 'a', 'k')`);
    await run(`insert into garage_members (garage_id, user_id, role) values ('x', 'a', 'owner'), ('x', 'b', 'viewer')`);
    await run(`insert into garage_invites (id, garage_id, email, role, token_hash, garage_name, inviter_name, status, expires_at) values
      ('i1', 'x', 'd@x.y', 'editor', 'h', 'G', 'A', 'pending', now() + interval '7 days')`);
    await run(`insert into deleted_google_accounts (sub_hash) values ('gone')`);

    const s = await getMyGarageStats();
    if (!s.connected) throw new Error('not connected');

    expect(s.accounts).toEqual({ total: 3, new1: 1, new7: 1, new30: 2, signedIn: 2, active1: 1, active7: 1, active30: 2, deleted: 1, deleted30: 1 });
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)).toMatchObject({ signups: 1, deletions: 1 });
    expect(s.daily.reduce((n, d) => n + d.signups, 0)).toBe(2);
    expect(s.plus).toMatchObject({ paying: 1, granted: 1 });
    expect(s.plus.plans).toContainEqual({ plan: 'monthly', state: 'SUBSCRIPTION_STATE_ACTIVE', count: 1, autoRenew: 1 });
    expect(s.referrals).toEqual({ codes: 1, total: 1, rewarded: 1, pending: 0, viaLink: 0, typed: 1, capped: 0, grants: 2, grantedDays: 60 });
    expect(s.sync.backupUsers).toBe(1);
    expect(s.sync.backupGarages).toBe(1);
    expect(s.sync.tables).toContainEqual({ tbl: 'vehicles', live: 3, deleted: 0 });
    expect(s.sync.tables).toContainEqual({ tbl: 'documents', live: 0, deleted: 1 });
    expect(s.sync.files).toEqual({ uploaded: 1, bytes: 1000, pending: 1, owners: 1 });
    expect(s.sharing).toEqual({ garages: 1, members: { owner: 1, viewer: 1 }, invites: { pending: 1 } });
    expect(s.recentUsers.map((u) => u.email)).toEqual(['a@x.y', 'b@x.y', 'c@x.y']);
    expect(s.recentUsers[0]).toMatchObject({ paid: true, granted: false, backup: true, bytes: 1000 });
    expect(s.recentUsers[1]).toMatchObject({ paid: false, granted: true, backup: false, bytes: 0 });
  });
});
