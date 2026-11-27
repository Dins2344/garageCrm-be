import { SQL, sql } from 'drizzle-orm';
import { mgDb, isMyGarageReady } from '../config/db';
import { getMyGarageEnv } from '../config/env';
import { parseVersionRule } from '../controllers/appController';
import { REFRESH_DAYS } from './authUsecase';

const rows = async <T>(q: SQL): Promise<T[]> => ((await mgDb.execute(q)) as unknown as { rows: T[] }).rows;
const one = async <T>(q: SQL): Promise<T> => (await rows<T>(q))[0];

// Same rule as grantsPlus() in billingUsecase, in SQL. Change both together.
const PAID_NOW = sql.raw(`(s.state in ('SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD')
  or (s.state = 'SUBSCRIPTION_STATE_CANCELED' and s.expires_at > now()))`);
const GRANT_NOW = sql.raw('(g.starts_at <= now() and g.ends_at > now())');
// Every token refresh writes a new row expiring REFRESH_DAYS later, so the newest expiry minus that is when the
// app last refreshed its session (at most hourly while in use). Guests never reach the server and are not counted.
const LAST_SEEN = sql`max(expires_at) - make_interval(days => ${REFRESH_DAYS}::int)`;

/**
 * Platform-wide MyGarage figures for the admin console. Counts only: records and files are encrypted on the phone,
 * so the server knows how many there are and their table, never what they say.
 */
export const getMyGarageStats = async () => {
  if (!isMyGarageReady()) return { connected: false as const };
  const env = getMyGarageEnv();

  const [accounts, activity, deleted, daily, plans, plus, referrals, grants, syncTables, backup, files, members, invites, sharedGarages, recentUsers] = await Promise.all([
    one<{ total: number; new1: number; new7: number; new30: number }>(sql`
      select count(*)::int total,
        count(*) filter (where created_at >= now() - interval '1 day')::int new1,
        count(*) filter (where created_at >= now() - interval '7 days')::int new7,
        count(*) filter (where created_at >= now() - interval '30 days')::int new30
      from users`),
    one<{ signedIn: number; active1: number; active7: number; active30: number }>(sql`
      select count(*) filter (where seen > now() - make_interval(days => ${REFRESH_DAYS}::int))::int "signedIn",
        count(*) filter (where seen >= now() - interval '1 day')::int active1,
        count(*) filter (where seen >= now() - interval '7 days')::int active7,
        count(*) filter (where seen >= now() - interval '30 days')::int active30
      from (select ${LAST_SEEN} seen from refresh_tokens group by user_id) t`),
    one<{ total: number; last30: number }>(sql`
      select count(*)::int total, count(*) filter (where deleted_at >= now() - interval '30 days')::int last30
      from deleted_google_accounts`),
    // India time, since the app is sold in India: a day here is the owner's day.
    rows<{ day: string; signups: number; deletions: number }>(sql`
      select to_char(d, 'YYYY-MM-DD') "day",
        (select count(*)::int from users where (created_at at time zone 'Asia/Kolkata')::date = d::date) signups,
        (select count(*)::int from deleted_google_accounts where (deleted_at at time zone 'Asia/Kolkata')::date = d::date) deletions
      from generate_series((now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
      order by d`),
    rows<{ plan: string; state: string; count: number; autoRenew: number }>(sql`
      select coalesce(base_plan_id, product_id) plan, state, count(*)::int "count", count(*) filter (where auto_renew)::int "autoRenew"
      from subscriptions group by 1, 2 order by 3 desc`),
    one<{ paying: number; granted: number }>(sql`
      select (select count(distinct s.user_id)::int from subscriptions s where ${PAID_NOW}) paying,
        (select count(distinct g.user_id)::int from plus_grants g where ${GRANT_NOW}) granted`),
    one<{ codes: number; total: number; rewarded: number; pending: number; viaLink: number; typed: number; capped: number }>(sql`
      select (select count(*)::int from referral_codes) codes, count(*)::int total,
        count(*) filter (where status = 'rewarded')::int rewarded,
        count(*) filter (where status = 'pending')::int pending,
        count(*) filter (where source = 'play')::int "viaLink",
        count(*) filter (where source = 'typed')::int typed,
        count(*) filter (where referrer_capped)::int capped
      from referrals`),
    one<{ count: number; days: number }>(sql`select count(*)::int "count", coalesce(sum(days), 0)::int days from plus_grants`),
    rows<{ tbl: string; live: number; deleted: number }>(sql`
      select tbl, count(*) filter (where deleted_at is null)::int live, count(*) filter (where deleted_at is not null)::int deleted
      from sync_records group by tbl order by 2 desc`),
    one<{ users: number; garages: number }>(sql`
      select count(distinct scope) filter (where scope like 'u:%')::int users, count(distinct scope) filter (where scope like 'g:%')::int garages
      from sync_records`),
    one<{ uploaded: number; bytes: number; pending: number; owners: number }>(sql`
      select count(*) filter (where status = 'uploaded')::int uploaded,
        coalesce(sum(size) filter (where status = 'uploaded'), 0)::float8 bytes,
        count(*) filter (where status = 'pending')::int pending,
        count(distinct owner_id) filter (where status = 'uploaded')::int owners
      from cloud_files`),
    rows<{ role: string; count: number }>(sql`select role, count(*)::int "count" from garage_members group by role`),
    rows<{ status: string; count: number }>(sql`select status, count(*)::int "count" from garage_invites group by status`),
    one<{ count: number }>(sql`select count(*)::int "count" from shared_garages`),
    rows<{ email: string; name: string | null; createdAt: Date; lastSeen: Date | null; paid: boolean; granted: boolean; backup: boolean; bytes: number }>(sql`
      select u.email, u.name, u.created_at "createdAt",
        (select ${LAST_SEEN} from refresh_tokens r where r.user_id = u.id) "lastSeen",
        exists(select 1 from subscriptions s where s.user_id = u.id and ${PAID_NOW}) paid,
        exists(select 1 from plus_grants g where g.user_id = u.id and ${GRANT_NOW}) granted,
        exists(select 1 from sync_records x where x.scope = 'u:' || u.id) backup,
        (select coalesce(sum(size), 0)::float8 from cloud_files f where f.owner_id = u.id and f.status = 'uploaded') bytes
      from users u order by u.created_at desc limit 25`)
  ]);

  return {
    connected: true as const,
    settings: { purchases: env.play !== null, requirePlus: env.requirePlus, referrals: env.referrals, ...parseVersionRule(process.env) },
    accounts: { ...accounts, ...activity, deleted: deleted.total, deleted30: deleted.last30 },
    daily,
    plus: { ...plus, plans },
    referrals: { ...referrals, grants: grants.count, grantedDays: grants.days },
    sync: { backupUsers: backup.users, backupGarages: backup.garages, tables: syncTables, files },
    sharing: {
      garages: sharedGarages.count,
      members: Object.fromEntries(members.map((m) => [m.role, m.count])),
      invites: Object.fromEntries(invites.map((i) => [i.status, i.count]))
    },
    recentUsers
  };
};
