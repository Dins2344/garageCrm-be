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
