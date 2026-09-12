import bcrypt from 'bcryptjs';

/**
 * Password hashing, formerly a `pre('save')` hook on the User and Admin
 * schemas. Called explicitly at every write site now — there is no hook layer
 * to do it silently, which is also why `userUsecase` no longer needs its
 * "findOneAndUpdate bypasses the hook" workaround.
 */

// Cost 12 for users and admins alike.
const SALT_ROUNDS = 12;

export const hashPassword = async (plain: string): Promise<string> => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
};

export const comparePassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
