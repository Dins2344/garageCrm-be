import mongoose, { Document, Schema, Types } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Platform super-admin.
 *
 * Deliberately a separate collection from `User`, not a new role on it:
 *
 * - `User.garage` is required, because every user belongs to exactly one
 *   tenant. A platform admin belongs to none, so it would need that constraint
 *   loosened — and loosening a required field on the tenant model to make room
 *   for a non-tenant actor is how tenant scoping quietly erodes.
 * - `Role` in `types/domain.ts` is mirrored by hand into both client repos.
 *   Adding `super_admin` there would ripple into two codebases for an actor
 *   neither client ever renders.
 *
 * `adminUsecase` is already the only cross-tenant module in the codebase; this
 * model belongs to it and to nothing else.
 */
export interface IAdmin extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
}

const adminSchema = new Schema<IAdmin>({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  // Longer floor than User's 6: this account can read and delete across every
  // tenant on the platform.
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [12, 'Admin password must be at least 12 characters'],
    select: false
  },
  // Deactivating is the revocation path. `verifyAdminToken` re-reads this on
  // every request, so flipping it false kills live sessions without waiting
  // for the 4h token to expire.
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Same cost factor as User.
adminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

adminSchema.methods.matchPassword = async function (this: IAdmin, enteredPassword: string): Promise<boolean> {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model<IAdmin>('Admin', adminSchema);
