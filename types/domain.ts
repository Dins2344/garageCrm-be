// Shared domain enums — single source of truth for values that must stay in
// sync with frontend/mobile (see root .agents/AGENTS.md "Shared enum values").

export const ROLES = ['owner', 'admin', 'service_advisor', 'mechanic', 'receptionist'] as const;
export type Role = (typeof ROLES)[number];

export const JOB_STATUSES = [
  'new',
  'estimation_sent',
  'approved',
  'in_progress',
  'quality_check',
  'ready_for_pickup',
  'delivered',
  'cancelled'
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SERVICE_TYPES = ['service', 'repair', 'accident'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const COMPLAINT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const FUEL_TYPES = ['petrol', 'diesel', 'cng', 'electric', 'hybrid', 'other'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'other', ''] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVENTORY_CATEGORIES = [
  'engine_oil',
  'filters',
  'brakes',
  'electrical',
  'suspension',
  'body_parts',
  'tyres',
  'battery',
  'coolant',
  'transmission',
  'accessories',
  'other'
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const REMINDER_TYPES = ['periodic_service', 'oil_change', 'tire_rotation', 'inspection', 'custom'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const REMINDER_STATUSES = ['pending', 'sent', 'completed', 'dismissed'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
