import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_FOLDER } from '../config/db';

/**
 * `0002_drop-sample-data.sql` deletes rows before it drops columns, and the
 * normal harness only ever runs it against an empty database. This applies
 * the earlier migrations to a fresh PGlite, plants a garage with both demo
 * and real rows the way the retired seeder and a real owner would have left
 * them, then runs 0002 on its own and checks what survived.
 */

const sqlFile = (name: string): string[] =>
  fs.readFileSync(path.join(MIGRATIONS_FOLDER, name), 'utf-8')
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(Boolean);

const apply = async (db: PGlite, name: string) => {
  for (const statement of sqlFile(name)) await db.exec(statement);
};

describe('0002_drop-sample-data', () => {
  it('removes every flagged row and its dependents, keeps real data, then drops the flag', async () => {
    const db = new PGlite();
    await apply(db, '0000_init.sql');
    await apply(db, '0001_owner-verification.sql');

    await db.exec(`
      INSERT INTO garages (id, name, phone) VALUES ('g1', 'Garage', '9000000000');
      INSERT INTO users (id, name, email, phone, password, role, garage_id)
        VALUES ('u1', 'Owner', 'o@example.com', '9000000000', 'x', 'owner', 'g1');

      -- Demo customer with a demo car and a demo delivered card + paid invoice.
      INSERT INTO customers (id, name, phone, garage_id, is_sample) VALUES ('c-demo', 'Demo', '1', 'g1', true);
      INSERT INTO vehicles (id, license_plate, make, model, customer_id, garage_id, is_sample)
        VALUES ('v-demo', 'DEMO1', 'M', 'X', 'c-demo', 'g1', true);
      INSERT INTO job_cards (id, service_type, job_card_number, vehicle_id, customer_id, garage_id, odometer_at_intake, is_sample)
        VALUES ('jc-demo', 'service', 'JC-1', 'v-demo', 'c-demo', 'g1', 100, true);
      INSERT INTO invoices (id, invoice_number, job_card_id, customer_id, vehicle_id, garage_id, is_sample)
        VALUES ('inv-demo', 'INV-1', 'jc-demo', 'c-demo', 'v-demo', 'g1', true);
      UPDATE job_cards SET invoice_id = 'inv-demo' WHERE id = 'jc-demo';
      INSERT INTO service_reminders (id, vehicle_id, customer_id, garage_id, next_service_date)
        VALUES ('rem-demo', 'v-demo', 'c-demo', 'g1', now());

      -- A real job card a tester opened on the demo car through the UI.
      INSERT INTO job_cards (id, service_type, job_card_number, vehicle_id, customer_id, garage_id, odometer_at_intake, is_sample)
        VALUES ('jc-on-demo', 'repair', 'JC-2', 'v-demo', 'c-demo', 'g1', 200, false);

      -- A real customer, car, card, invoice and reminder — must all survive.
      INSERT INTO customers (id, name, phone, garage_id, is_sample) VALUES ('c-real', 'Asha', '2', 'g1', false);
      INSERT INTO vehicles (id, license_plate, make, model, customer_id, garage_id, is_sample)
        VALUES ('v-real', 'REAL1', 'H', 'Y', 'c-real', 'g1', false);
      INSERT INTO job_cards (id, service_type, job_card_number, vehicle_id, customer_id, garage_id, odometer_at_intake, is_sample)
        VALUES ('jc-real', 'service', 'JC-3', 'v-real', 'c-real', 'g1', 300, false);
      INSERT INTO invoices (id, invoice_number, job_card_id, customer_id, vehicle_id, garage_id, is_sample)
        VALUES ('inv-real', 'INV-2', 'jc-real', 'c-real', 'v-real', 'g1', false);
      INSERT INTO service_reminders (id, vehicle_id, customer_id, garage_id, next_service_date)
        VALUES ('rem-real', 'v-real', 'c-real', 'g1', now());
    `);

    await apply(db, '0002_drop-sample-data.sql');

    const ids = async (table: string) =>
      (await db.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).rows.map(r => r.id);

    expect(await ids('customers')).toEqual(['c-real']);
    expect(await ids('vehicles')).toEqual(['v-real']);
    expect(await ids('job_cards')).toEqual(['jc-real']);
    expect(await ids('invoices')).toEqual(['inv-real']);
    expect(await ids('service_reminders')).toEqual(['rem-real']);
    expect(await ids('users')).toEqual(['u1']);

    for (const table of ['customers', 'vehicles', 'job_cards', 'invoices']) {
      const cols = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND column_name = 'is_sample'`
      );
      expect(cols.rows).toHaveLength(0);
    }

    await db.close();
  });
});
