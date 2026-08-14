import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import User from '../models/User';
import Garage from '../models/Garage';
import Customer from '../models/Customer';
import { createGarageWithOwner, addGarageToOwner, nextPhone, authHeader, authHeaderFor } from './helpers/factories';

// Note: the free plan caps an owner at 2 garages total (their original +
// one branch) — see config/planLimits.ts maxGaragesPerOwner. Tests below
// are deliberately scoped to stay within that cap; going through the real
// create-branch API 3+ times for one owner would hit the plan limit (403)
// before ever reaching the logic under test.
describe('Branches: create (uniqueness)', () => {
  it('allows creating one additional branch with a distinct name', async () => {
    const owner = await createGarageWithOwner('branch-unique-ok');
    const b1 = await addGarageToOwner(owner.token, 'Downtown Branch');
    expect(b1.status).toBe(201);
  });

  it("rejects a branch whose name matches the owner's existing garage", async () => {
    const owner = await createGarageWithOwner('branch-unique-dupe');
    const original = await Garage.findById(owner.garageId);

    const dupe = await addGarageToOwner(owner.token, original!.name);

    expect(dupe.status).toBe(400);
    expect(dupe.body.success).toBe(false);
    expect(dupe.body.message).toMatch(/duplicate/i);

    const count = await Garage.countDocuments({ owner: owner.userId, name: original!.name });
    expect(count).toBe(1);
  });

  it('allows two DIFFERENT owners to each use the same branch name', async () => {
    const ownerA = await createGarageWithOwner('branch-unique-cross-a');
    const ownerB = await createGarageWithOwner('branch-unique-cross-b');

    const a = await addGarageToOwner(ownerA.token, 'Shared Name Branch');
    const b = await addGarageToOwner(ownerB.token, 'Shared Name Branch');

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("enforces the {owner, name} unique index at the database level directly", async () => {
    const owner = await createGarageWithOwner('branch-unique-model-level');
    await Garage.create({ name: 'Model Level Branch', phone: nextPhone(), owner: owner.userId });

    await expect(
      Garage.create({ name: 'Model Level Branch', phone: nextPhone(), owner: owner.userId })
    ).rejects.toThrow();
  });
});

describe('Branches: delete', () => {
  it('refuses to delete the only branch an owner has', async () => {
    const owner = await createGarageWithOwner('branch-del-only');
    const del = await request(app)
      .delete(`/api/garage/branches/${owner.garageId}`)
      .set(authHeader(owner.token));

    expect(del.status).toBe(400);
    expect(del.body.success).toBe(false);
    expect(await Garage.findById(owner.garageId)).not.toBeNull();
  });

  it('deletes a branch with no staff directly, no staffAction needed', async () => {
    const owner = await createGarageWithOwner('branch-del-empty');
    const branch = await addGarageToOwner(owner.token, 'Empty Branch');
    const branchId = branch.body.data._id;

    // Give the branch some business data to prove it's cleaned up too.
    const customer = await request(app)
      .post('/api/customers')
      .set(authHeaderFor(owner.token, branchId))
      .send({ name: 'Branch Customer', phone: nextPhone() });
    expect(customer.status).toBe(201);

    const del = await request(app)
      .delete(`/api/garage/branches/${branchId}`)
      .set(authHeader(owner.token));

    expect(del.status).toBe(200);
    expect(await Garage.findById(branchId)).toBeNull();
    expect(await Customer.countDocuments({ garage: branchId })).toBe(0);
  });

  it('refuses to delete a branch belonging to a different owner', async () => {
    const ownerA = await createGarageWithOwner('branch-del-cross-a');
    const ownerB = await createGarageWithOwner('branch-del-cross-b');

    const del = await request(app)
      .delete(`/api/garage/branches/${ownerB.garageId}`)
      .set(authHeader(ownerA.token));

    expect(del.status).toBe(404);
    expect(await Garage.findById(ownerB.garageId)).not.toBeNull();
  });

  it('requires staffAction when the branch has staff assigned', async () => {
    const owner = await createGarageWithOwner('branch-del-staff-required');
    const branch = await addGarageToOwner(owner.token, 'Staffed Branch');
    const branchId = branch.body.data._id;

    await request(app)
      .post('/api/users')
      .set(authHeaderFor(owner.token, branchId))
      .send({ name: 'Branch Mechanic', email: 'branch-mech-1@example.com', phone: nextPhone(), password: 'password123', role: 'mechanic' });

    const del = await request(app)
      .delete(`/api/garage/branches/${branchId}`)
      .set(authHeader(owner.token));

    expect(del.status).toBe(400);
    expect(del.body.message).toMatch(/staff/i);
    expect(await Garage.findById(branchId)).not.toBeNull();
  });

  it('GET branch staff returns the assigned staff, excluding the owner', async () => {
    const owner = await createGarageWithOwner('branch-staff-list');
    const branch = await addGarageToOwner(owner.token, 'Listed Branch');
    const branchId = branch.body.data._id;

    await request(app)
      .post('/api/users')
      .set(authHeaderFor(owner.token, branchId))
      .send({ name: 'Listed Mechanic', email: 'branch-mech-2@example.com', phone: nextPhone(), password: 'password123', role: 'mechanic' });

    const res = await request(app)
      .get(`/api/garage/branches/${branchId}/staff`)
      .set(authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe('branch-mech-2@example.com');
    expect(res.body.data.every((u: { role: string }) => u.role !== 'owner')).toBe(true);
  });

  it('deletes staff along with the branch when staffAction is "delete"', async () => {
    const owner = await createGarageWithOwner('branch-del-staff-delete');
    const branch = await addGarageToOwner(owner.token, 'Doomed Staff Branch');
    const branchId = branch.body.data._id;

    const staff = await request(app)
      .post('/api/users')
      .set(authHeaderFor(owner.token, branchId))
      .send({ name: 'Doomed Mechanic', email: 'doomed-branch-mech@example.com', phone: nextPhone(), password: 'password123', role: 'mechanic' });
    const staffId = staff.body.data._id;

    const del = await request(app)
      .delete(`/api/garage/branches/${branchId}`)
      .set(authHeader(owner.token))
      .send({ staffAction: 'delete' });

    expect(del.status).toBe(200);
    expect(await User.findById(staffId)).toBeNull();
    expect(await Garage.findById(branchId)).toBeNull();
  });

  it('reassigns staff to the chosen branch when staffAction is "reassign"', async () => {
    const owner = await createGarageWithOwner('branch-del-staff-reassign');
    const destBranch = await addGarageToOwner(owner.token, 'Destination Branch');
    const keepId = destBranch.body.data._id;
    const deleteId = owner.garageId; // the owner's own original/default branch

    const staff = await request(app)
      .post('/api/users')
      .set(authHeaderFor(owner.token, deleteId))
      .send({ name: 'Movable Mechanic', email: 'movable-mech@example.com', phone: nextPhone(), password: 'password123', role: 'mechanic' });
    const staffId = staff.body.data._id;

    const del = await request(app)
      .delete(`/api/garage/branches/${deleteId}`)
      .set(authHeader(owner.token))
      .send({ staffAction: 'reassign', reassignToGarageId: keepId });

    expect(del.status).toBe(200);
    const movedStaff = await User.findById(staffId);
    expect(String(movedStaff!.garage)).toBe(String(keepId));
    expect(await Garage.findById(deleteId)).toBeNull();
    expect(await Garage.findById(keepId)).not.toBeNull();
  });

  it('rejects reassign without a target branch', async () => {
    const owner = await createGarageWithOwner('branch-del-reassign-notarget');
    const branch = await addGarageToOwner(owner.token, 'No Target Branch');
    const branchId = branch.body.data._id;

    await request(app)
      .post('/api/users')
      .set(authHeaderFor(owner.token, branchId))
      .send({ name: 'Stuck Mechanic', email: 'stuck-mech@example.com', phone: nextPhone(), password: 'password123', role: 'mechanic' });

    const del = await request(app)
      .delete(`/api/garage/branches/${branchId}`)
      .set(authHeader(owner.token))
      .send({ staffAction: 'reassign' });

    expect(del.status).toBe(400);
  });

  it("keeps the owner's account working after deleting their default (home) branch", async () => {
    const owner = await createGarageWithOwner('branch-del-owner-default');
    const secondBranch = await addGarageToOwner(owner.token, 'Second Home Branch');
    const secondBranchId = secondBranch.body.data._id;

    // owner.garageId is the owner's original/default garage (User.garage).
    const del = await request(app)
      .delete(`/api/garage/branches/${owner.garageId}`)
      .set(authHeader(owner.token));
    expect(del.status).toBe(200);

    // The owner's own account must now point at a surviving branch, not a
    // dangling reference to the one just deleted — otherwise /auth/me breaks.
    const me = await request(app).get('/api/auth/me').set(authHeader(owner.token));
    expect(me.status).toBe(200);
    expect(me.body.data.garage).toBe(String(secondBranchId));
  });

  it('a non-owner (e.g. admin) cannot delete branches', async () => {
    const owner = await createGarageWithOwner('branch-del-role-gate');
    const branch = await addGarageToOwner(owner.token, 'Role Gated Branch');
    const branchId = branch.body.data._id;

    const admin = await request(app)
      .post('/api/users')
      .set(authHeaderFor(owner.token, owner.garageId))
      .send({ name: 'Some Admin', email: 'branch-admin@example.com', phone: nextPhone(), password: 'password123', role: 'admin' });
    const adminLogin = await request(app).post('/api/auth/login').send({ email: 'branch-admin@example.com', password: 'password123' });
    expect(admin.status).toBe(201);

    const del = await request(app)
      .delete(`/api/garage/branches/${branchId}`)
      .set(authHeader(adminLogin.body.token));

    expect(del.status).toBe(403);
    expect(await Garage.findById(branchId)).not.toBeNull();
  });
});
