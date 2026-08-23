// ─── Swagger Route Documentation ───
// This file contains JSDoc annotations for all API routes

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication & profile management
 *   - name: Users
 *     description: Staff/user management (owner/admin only)
 *   - name: Customers
 *     description: Customer CRUD operations
 *   - name: Vehicles
 *     description: Vehicle CRUD operations
 *   - name: Job Cards
 *     description: Job card lifecycle management
 *   - name: Invoices
 *     description: Invoice generation & payment tracking
 *   - name: Inventory
 *     description: Parts & stock management
 *   - name: Garage
 *     description: Garage settings & info
 *   - name: Reminders
 *     description: Service reminder management
 *   - name: Dashboard
 *     description: Dashboard statistics
 *   - name: Public
 *     description: Public endpoints (no auth required)
 *   - name: Meta
 *     description: Static reference data (no auth required)
 *   - name: Admin
 *     description: Platform super-admin console — cross-tenant, separate auth
 *   - name: Health
 *     description: System health check
 */

// ════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new garage owner & create garage
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error
 */

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email & password
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 */

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current logged-in user profile
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 */

/**
 * @swagger
 * /auth/profile:
 *   put:
 *     tags: [Auth]
 *     summary: Update own profile (name, phone)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProfileRequest'
 *     responses:
 *       200:
 *         description: Profile updated
 */

/**
 * @swagger
 * /auth/updatepassword:
 *   put:
 *     tags: [Auth]
 *     summary: Change password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Current password incorrect
 */

// ════════════════════════════════════════
// USERS (STAFF) ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List all staff members
 *     description: Roles allowed — owner, admin, service_advisor, receptionist
 *     responses:
 *       200:
 *         description: Staff list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *   post:
 *     tags: [Users]
 *     summary: Create a new staff member
 *     description: Roles allowed — owner, admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       201:
 *         description: User created
 */

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a staff member by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 *   put:
 *     tags: [Users]
 *     summary: Update a staff member
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       200:
 *         description: User updated
 *   delete:
 *     tags: [Users]
 *     summary: Delete a staff member (owner only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted
 */

// ════════════════════════════════════════
// CUSTOMER ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /customers:
 *   get:
 *     tags: [Customers]
 *     summary: List all customers
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or phone
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Customer list
 *   post:
 *     tags: [Customers]
 *     summary: Create a customer
 *     description: Roles — owner, admin, service_advisor, receptionist
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCustomerRequest'
 *     responses:
 *       201:
 *         description: Customer created
 */

/**
 * @swagger
 * /customers/{id}:
 *   get:
 *     tags: [Customers]
 *     summary: Get customer by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer details
 *   put:
 *     tags: [Customers]
 *     summary: Update customer
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCustomerRequest'
 *     responses:
 *       200:
 *         description: Customer updated
 *   delete:
 *     tags: [Customers]
 *     summary: Delete customer (owner/admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer deleted
 */

// ════════════════════════════════════════
// VEHICLE ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /vehicles:
 *   get:
 *     tags: [Vehicles]
 *     summary: List all vehicles
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: customer
 *         schema:
 *           type: string
 *         description: Filter by customer ID
 *     responses:
 *       200:
 *         description: Vehicle list
 *   post:
 *     tags: [Vehicles]
 *     summary: Create a vehicle
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateVehicleRequest'
 *     responses:
 *       201:
 *         description: Vehicle created
 */

/**
 * @swagger
 * /vehicles/{id}:
 *   get:
 *     tags: [Vehicles]
 *     summary: Get vehicle by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vehicle details
 *   put:
 *     tags: [Vehicles]
 *     summary: Update vehicle
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateVehicleRequest'
 *     responses:
 *       200:
 *         description: Vehicle updated
 *   delete:
 *     tags: [Vehicles]
 *     summary: Delete vehicle (owner/admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vehicle deleted
 */

// ════════════════════════════════════════
// JOB CARD ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /jobcards:
 *   get:
 *     tags: [Job Cards]
 *     summary: List all job cards (paginated, filterable)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new, estimation_sent, approved, in_progress, quality_check, ready_for_pickup, delivered, cancelled]
 *       - in: query
 *         name: mechanicId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated job card list
 *   post:
 *     tags: [Job Cards]
 *     summary: Create a new job card
 *     description: Roles — owner, admin, service_advisor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateJobCardRequest'
 *     responses:
 *       201:
 *         description: Job card created
 */

/**
 * @swagger
 * /jobcards/{id}:
 *   get:
 *     tags: [Job Cards]
 *     summary: Get job card details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Full job card with populated references
 *   put:
 *     tags: [Job Cards]
 *     summary: Update job card (status, fields, etc.)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [new, estimation_sent, approved, in_progress, quality_check, ready_for_pickup, delivered, cancelled]
 *               assignedMechanic:
 *                 type: string
 *               internalNotes:
 *                 type: string
 *               statusNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Job card updated
 *   delete:
 *     tags: [Job Cards]
 *     summary: Delete job card (owner/admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job card deleted
 */

/**
 * @swagger
 * /jobcards/{id}/estimation:
 *   put:
 *     tags: [Job Cards]
 *     summary: Update estimation (parts, labor, discount)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateEstimationRequest'
 *     responses:
 *       200:
 *         description: Estimation updated with calculated totals
 */

/**
 * @swagger
 * /jobcards/{id}/approve:
 *   put:
 *     tags: [Job Cards]
 *     summary: Approve estimation internally
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Estimation approved
 */

/**
 * @swagger
 * /jobcards/{id}/estimation/download:
 *   get:
 *     tags: [Job Cards]
 *     summary: Download estimation as PDF
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */

// ════════════════════════════════════════
// INVOICE ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /invoices:
 *   get:
 *     tags: [Invoices]
 *     summary: List all invoices
 *     parameters:
 *       - in: query
 *         name: paymentStatus
 *         schema:
 *           type: string
 *           enum: [unpaid, partial, paid]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Invoice list
 *   post:
 *     tags: [Invoices]
 *     summary: Create invoice from job card
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateInvoiceRequest'
 *     responses:
 *       201:
 *         description: Invoice created
 */

/**
 * @swagger
 * /invoices/{id}:
 *   get:
 *     tags: [Invoices]
 *     summary: Get invoice by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invoice details
 *   delete:
 *     tags: [Invoices]
 *     summary: Delete invoice (owner/admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invoice deleted
 */

/**
 * @swagger
 * /invoices/{id}/payment:
 *   put:
 *     tags: [Invoices]
 *     summary: Update payment status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePaymentRequest'
 *     responses:
 *       200:
 *         description: Payment updated
 */

/**
 * @swagger
 * /invoices/{id}/pdf:
 *   get:
 *     tags: [Invoices]
 *     summary: Download invoice as PDF
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */

// ════════════════════════════════════════
// INVENTORY ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /inventory:
 *   get:
 *     tags: [Inventory]
 *     summary: List all inventory items
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory list
 *   post:
 *     tags: [Inventory]
 *     summary: Add new inventory item
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateInventoryRequest'
 *     responses:
 *       201:
 *         description: Item created
 */

/**
 * @swagger
 * /inventory/alerts:
 *   get:
 *     tags: [Inventory]
 *     summary: Get low stock alerts
 *     responses:
 *       200:
 *         description: Items below threshold
 */

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     tags: [Inventory]
 *     summary: Get inventory item by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item details
 *   put:
 *     tags: [Inventory]
 *     summary: Update inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateInventoryRequest'
 *     responses:
 *       200:
 *         description: Item updated
 *   delete:
 *     tags: [Inventory]
 *     summary: Delete inventory item (owner/admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item deleted
 */

/**
 * @swagger
 * /inventory/{id}/stock:
 *   put:
 *     tags: [Inventory]
 *     summary: Adjust stock quantity
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdjustStockRequest'
 *     responses:
 *       200:
 *         description: Stock adjusted
 */

// ════════════════════════════════════════
// GARAGE ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /garage:
 *   get:
 *     tags: [Garage]
 *     summary: Get garage info & settings
 *     responses:
 *       200:
 *         description: Garage details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Garage'
 *   put:
 *     tags: [Garage]
 *     summary: Update garage info (owner/admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Garage'
 *     responses:
 *       200:
 *         description: Garage updated
 */

// ════════════════════════════════════════
// REMINDER ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /reminders:
 *   get:
 *     tags: [Reminders]
 *     summary: List all service reminders
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, sent, completed, dismissed]
 *     responses:
 *       200:
 *         description: Reminder list
 *   post:
 *     tags: [Reminders]
 *     summary: Create a service reminder
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateReminderRequest'
 *     responses:
 *       201:
 *         description: Reminder created
 */

/**
 * @swagger
 * /reminders/upcoming:
 *   get:
 *     tags: [Reminders]
 *     summary: Get upcoming reminders (next 7 days)
 *     responses:
 *       200:
 *         description: Upcoming reminders list
 */

/**
 * @swagger
 * /reminders/trigger-cron:
 *   post:
 *     tags: [Reminders]
 *     summary: Manually trigger reminder cron job (owner/admin)
 *     responses:
 *       200:
 *         description: Cron triggered
 */

/**
 * @swagger
 * /reminders/{id}:
 *   patch:
 *     tags: [Reminders]
 *     summary: Update reminder status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateReminderStatusRequest'
 *     responses:
 *       200:
 *         description: Status updated
 *   delete:
 *     tags: [Reminders]
 *     summary: Delete reminder (owner/admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reminder deleted
 */

// ════════════════════════════════════════
// DASHBOARD ROUTES
// ════════════════════════════════════════

/**
 * @swagger
 * /dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard statistics
 *     description: Returns aggregated stats — job counts, revenue, recent activity, etc.
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DashboardStats'
 */

// ════════════════════════════════════════
// PUBLIC ROUTES (NO AUTH)
// ════════════════════════════════════════

/**
 * @swagger
 * /public/estimate/{token}:
 *   get:
 *     tags: [Public]
 *     summary: Get estimation by approval token
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID token from estimation email
 *     responses:
 *       200:
 *         description: Estimation details for customer review
 *       404:
 *         description: Invalid or expired token
 */

/**
 * @swagger
 * /public/estimate/{token}/approve:
 *   post:
 *     tags: [Public]
 *     summary: Approve estimation via token
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Estimation approved successfully
 *       404:
 *         description: Invalid or expired token
 */

// ════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: System health check
 *     security: []
 *     description: Returns server uptime, memory, CPU, DB status, and platform info
 *     responses:
 *       200:
 *         description: System health info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: object
 *                   properties:
 *                     process:
 *                       type: string
 *                     system:
 *                       type: string
 *                 memory:
 *                   type: object
 *                 cpu:
 *                   type: object
 *                 database:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     host:
 *                       type: string
 *                 environment:
 *                   type: string
 */

// ════════════════════════════════════════
// AUTH — PASSWORD RESET & SESSION
// ════════════════════════════════════════

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Clear the auth cookie
 *     description: >
 *       Clears the httpOnly cookie. Mobile clients hold the JWT themselves and
 *       simply discard it, so this is a no-op for them.
 *     security: []
 *     responses:
 *       200:
 *         description: Logged out
 */

/**
 * @swagger
 * /auth/forgotpassword:
 *   post:
 *     tags: [Auth]
 *     summary: Send a password-reset link (garage owners only)
 *     description: >
 *       Only an account with the `owner` role receives a link. Staff passwords
 *       are managed by their owner or an admin from Settings. The response is
 *       deliberately identical whether or not the email matches an account, so
 *       it cannot be used to discover which addresses are registered.
 *       Rate limited.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: owner@garagepulse.com
 *     responses:
 *       200:
 *         description: Always returned when the request is well-formed, regardless of whether the account exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       429:
 *         description: Too many reset requests
 */

/**
 * @swagger
 * /auth/resetpassword/{token}:
 *   put:
 *     tags: [Auth]
 *     summary: Set a new password using a reset token
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token from the emailed reset link
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: newsecurepass123
 *     responses:
 *       200:
 *         description: Password updated, returns a fresh session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Token invalid or expired
 *       429:
 *         description: Too many attempts
 */

/**
 * @swagger
 * /auth/changepassword:
 *   put:
 *     tags: [Auth]
 *     summary: Change your own password (alias of /auth/updatepassword)
 *     description: >
 *       Identical behaviour to `PUT /auth/updatepassword`. Both paths exist
 *       because published mobile builds call one and the web app the other —
 *       neither can be removed without breaking a client in the wild.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed
 *       401:
 *         description: Current password incorrect
 */

// ════════════════════════════════════════
// GARAGE — BRANCHES
// ════════════════════════════════════════

/**
 * @swagger
 * /garage/branches:
 *   get:
 *     tags: [Garage]
 *     summary: List every branch owned by the caller (owner only)
 *     responses:
 *       200:
 *         description: Branch list, each with its resolved locale
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 count: { type: number }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Garage'
 *       403:
 *         description: Caller is not an owner
 *   post:
 *     tags: [Garage]
 *     summary: Create an additional branch (owner only)
 *     description: >
 *       The new branch inherits `country` and the seeded settings from the
 *       owner's oldest garage. Branch names must be unique per owner.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name: { type: string, example: 'Downtown Branch' }
 *               phone: { type: string, example: '9876543210' }
 *               email: { type: string, format: email }
 *               gstNumber: { type: string }
 *               address: { $ref: '#/components/schemas/Address' }
 *     responses:
 *       201:
 *         description: Branch created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Garage'
 *       400:
 *         description: Duplicate branch name, or the free-plan branch cap was reached
 */

/**
 * @swagger
 * /garage/branches/{id}/staff:
 *   get:
 *     tags: [Garage]
 *     summary: List the staff assigned to one branch (owner only)
 *     description: Used to preview who is affected before deleting a branch.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staff assigned to that branch
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       403:
 *         description: Caller is not the owner of that branch
 */

/**
 * @swagger
 * /garage/branches/{id}:
 *   delete:
 *     tags: [Garage]
 *     summary: Delete a branch (owner only)
 *     description: >
 *       Refuses to delete an owner's last remaining branch. Staff assigned to
 *       the branch must be handled explicitly via `staffAction`: `delete`
 *       removes them, `reassign` moves them to `reassignToGarageId`. All data
 *       scoped to the branch is removed with it.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               staffAction:
 *                 type: string
 *                 enum: [delete, reassign]
 *               reassignToGarageId:
 *                 type: string
 *                 description: Required when staffAction is 'reassign'
 *     responses:
 *       200:
 *         description: Branch deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     fallbackGarageId:
 *                       type: string
 *                       description: Branch the caller is switched to if the deleted one was active
 *       400:
 *         description: Last remaining branch, or staff present with no staffAction given
 */

// ════════════════════════════════════════
// META — REFERENCE DATA
// ════════════════════════════════════════

/**
 * @swagger
 * /meta/countries:
 *   get:
 *     tags: [Meta]
 *     summary: Supported countries for the signup and settings pickers
 *     description: >
 *       Unauthenticated on purpose — the registration form needs this before a
 *       user exists. Static reference data; clients cache it per page load.
 *     security: []
 *     responses:
 *       200:
 *         description: Supported countries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CountryOption'
 */

// ════════════════════════════════════════
// DASHBOARD — CHARTS
// ════════════════════════════════════════

/**
 * @swagger
 * /dashboard/charts:
 *   get:
 *     tags: [Dashboard]
 *     summary: Revenue trend and job-status breakdown for a date range
 *     description: >
 *       Axis labels are formatted server-side in the garage's locale, so the
 *       client renders them as-is.
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 *           default: day
 *     responses:
 *       200:
 *         description: Chart data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     revenueTrend:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key: { type: string }
 *                           label: { type: string, description: 'Pre-formatted in the garage locale' }
 *                           revenue: { type: number }
 *                           invoiceCount: { type: number }
 *                     jobStatusBreakdown:
 *                       type: object
 *                       additionalProperties: { type: number }
 */

// ════════════════════════════════════════
// VEHICLES — SERVICE HISTORY
// ════════════════════════════════════════

/**
 * @swagger
 * /vehicles/{id}/history:
 *   get:
 *     tags: [Vehicles]
 *     summary: Paginated job-card history for one vehicle
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: number, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: number, default: 10 }
 *     responses:
 *       200:
 *         description: Job cards for this vehicle, newest first
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/JobCard'
 *       404:
 *         description: Vehicle not found in the caller's garage
 */

// ════════════════════════════════════════
// USERS — ACTIVATE / DEACTIVATE
// ════════════════════════════════════════

/**
 * @swagger
 * /users/{id}/{action}:
 *   patch:
 *     tags: [Users]
 *     summary: Activate or deactivate a staff member (owner/admin only)
 *     description: >
 *       Deactivating blocks sign-in while preserving the person's history on
 *       job cards and invoices — prefer it to deletion.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *           enum: [activate, deactivate]
 *     responses:
 *       200:
 *         description: Staff status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: Staff member not found in the caller's garage
 */

// ════════════════════════════════════════
// ADMIN — PLATFORM CONSOLE
// ════════════════════════════════════════
// Cross-tenant by design and gated behind a separate super-admin JWT
// (AdminAuth), not the per-garage BearerAuth used everywhere else.

/**
 * @swagger
 * /admin/login:
 *   post:
 *     tags: [Admin]
 *     summary: Sign in to the platform-admin console
 *     description: >
 *       Credentials come from the `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`
 *       environment variables. Issues a short-lived token signed with a
 *       separate secret from normal user JWTs.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Admin token issued
 *       401:
 *         description: Invalid admin credentials
 */

/**
 * @swagger
 * /admin/verify:
 *   get:
 *     tags: [Admin]
 *     summary: Check that an admin token is still valid
 *     security:
 *       - AdminAuth: []
 *     responses:
 *       200:
 *         description: Token valid
 *       401:
 *         description: Token missing, invalid or expired
 */

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Platform-wide counts and revenue
 *     description: >
 *       Revenue is summed across every tenant and can therefore mix
 *       currencies — it carries no single currency and must not be rendered
 *       with one.
 *     security:
 *       - AdminAuth: []
 *     responses:
 *       200:
 *         description: Platform statistics
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /admin/garages:
 *   get:
 *     tags: [Admin]
 *     summary: Every garage, with per-garage counts, revenue and resolved locale
 *     security:
 *       - AdminAuth: []
 *     responses:
 *       200:
 *         description: Enriched garage list
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /admin/garages/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete an ownerless (orphaned) garage
 *     description: >
 *       Deliberately refuses any garage that still has an owner — that is a
 *       real business with real data. This exists to clean up garages left
 *       behind by a registration failure.
 *     security:
 *       - AdminAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Orphaned garage deleted
 *       400:
 *         description: Refused — the garage has an owner
 *       404:
 *         description: Garage not found
 */

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Every user across all garages
 *     security:
 *       - AdminAuth: []
 *     responses:
 *       200:
 *         description: User list
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete a user, cascading their data
 *     description: >
 *       Deleting an owner also deletes every garage they own and all data
 *       scoped to those garages. Deleting a staff member removes only that
 *       account. Irreversible.
 *     security:
 *       - AdminAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User deleted, with a summary of what was cascaded
 *       404:
 *         description: User not found
 */

/**
 * @swagger
 * /admin/health:
 *   get:
 *     tags: [Admin]
 *     summary: Process, memory, CPU and database health
 *     security:
 *       - AdminAuth: []
 *     responses:
 *       200:
 *         description: System health
 *       401:
 *         description: Unauthorized
 */

export {};
