import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

// __filename's extension tells us whether we're running from TS source (dev,
// via tsx) or compiled output (prod, dist/*.js) — swagger-jsdoc just reads
// file text for `@swagger` JSDoc blocks, so either works as long as the glob
// matches the actual files on disk next to this compiled/interpreted file.
const ext = path.extname(__filename);

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GaragePulse API',
      version: '1.0.0',
      description:
        'Complete REST API documentation for GaragePulse — a garage & workshop management platform. ' +
        'Manage job cards, customers, vehicles, invoices, inventory, staff, and more.',
      contact: {
        name: 'GaragePulse Support',
        email: 'dind4322@gmail.com'
      },
      license: {
        name: 'Private',
        url: 'https://garagepulse.com'
      }
    },
    servers: [
      {
        url: '/api',
        description: 'API Base'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token obtained from /auth/login'
        },
        AdminAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Platform super-admin token from /admin/login. Signed with a separate ' +
            'secret from user tokens and only accepted on /admin routes.'
        }
      },
      schemas: {
        // ─── Error Response ───
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Error message' }
          }
        },
        MessageResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation completed' }
          }
        },

        // ─── Locale ───
        // Resolved server-side from the garage's `country` and returned on
        // garage and auth payloads. Clients must format money, dates and tax
        // labels from this rather than hardcoding a currency or locale.
        ResolvedLocale: {
          type: 'object',
          properties: {
            country: { type: 'string', example: 'IN', description: 'ISO 3166-1 alpha-2' },
            currency: { type: 'string', example: 'INR', description: 'ISO 4217' },
            locale: { type: 'string', example: 'en-IN', description: 'BCP 47' },
            taxLabel: { type: 'string', example: 'GST' },
            taxIdLabel: { type: 'string', example: 'GSTIN' },
            postalLabel: { type: 'string', example: 'Pincode' },
            postalInputMode: { type: 'string', enum: ['numeric', 'text'] },
            phoneExample: { type: 'string', example: '98765 43210' },
            timezone: { type: 'string', example: 'Asia/Kolkata' }
          }
        },
        CountryOption: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'GB' },
            name: { type: 'string', example: 'United Kingdom' },
            currency: { type: 'string', example: 'GBP' },
            taxLabel: { type: 'string', example: 'VAT' },
            taxIdLabel: { type: 'string', example: 'VAT No.' },
            postalLabel: { type: 'string', example: 'Postcode' },
            postalInputMode: { type: 'string', enum: ['numeric', 'text'] },
            phoneExample: { type: 'string', example: '07911 123456' },
            requiresTimezoneChoice: {
              type: 'boolean',
              description: 'True when the country spans several zones and the owner must pick one'
            }
          }
        },

        // ─── Auth ───
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'owner@garagepulse.com' },
            password: { type: 'string', example: 'password123' }
          }
        },
        RegisterRequest: {
          type: 'object',
          required: ['name', 'email', 'phone', 'password', 'garageName', 'garagePhone'],
          properties: {
            name: { type: 'string', example: 'John Doe' },
            email: { type: 'string', format: 'email', example: 'john@garage.com' },
            phone: {
              type: 'string',
              example: '9876543210',
              description:
                'Validated against `country`. A number that is not valid there is rejected with 400.'
            },
            password: { type: 'string', minLength: 6, example: 'securepass123' },
            garageName: { type: 'string', example: 'SpeedFix Auto' },
            garagePhone: { type: 'string', example: '9876543211' },
            country: {
              type: 'string',
              example: 'IN',
              description:
                'ISO 3166-1 alpha-2. Omitted by older clients, in which case it defaults to IN. ' +
                'Seeds the garage currency, locale, tax label and default tax rate.'
            },
            timezone: {
              type: 'string',
              example: 'America/Chicago',
              description:
                'IANA zone. Only honoured for countries spanning several zones (US, CA, AU); ' +
                'ignored elsewhere so the country table stays authoritative.'
            },
            garageAddress: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                pincode: { type: 'string' }
              }
            }
          }
        },
        AuthResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
            data: {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
                role: { type: 'string', enum: ['owner', 'admin', 'service_advisor', 'mechanic', 'receptionist'] },
                garage: { type: 'string' },
                locale: {
                  allOf: [{ $ref: '#/components/schemas/ResolvedLocale' }],
                  description:
                    "The user's home-garage locale. Present on every auth response because " +
                    'it is the only path a non-owner has to it — staff never load a branch list.'
                }
              }
            }
          }
        },
        UpdateProfileRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'John Updated' },
            phone: { type: 'string', example: '9876543299' }
          }
        },
        ChangePasswordRequest: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', example: 'oldpass123' },
            newPassword: { type: 'string', example: 'newpass456' }
          }
        },

        // ─── User (Staff) ───
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string', example: 'Raj Mechanic' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', example: '9876543210' },
            role: { type: 'string', enum: ['owner', 'admin', 'service_advisor', 'mechanic', 'receptionist'] },
            garage: { type: 'string' },
            avatar: { type: 'string' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateUserRequest: {
          type: 'object',
          required: ['name', 'email', 'phone', 'password', 'role'],
          properties: {
            name: { type: 'string', example: 'New Staff' },
            email: { type: 'string', format: 'email', example: 'staff@garage.com' },
            phone: { type: 'string', example: '9876543222' },
            password: { type: 'string', example: 'pass123' },
            role: { type: 'string', enum: ['admin', 'service_advisor', 'mechanic', 'receptionist'] }
          }
        },

        // ─── Customer ───
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string', example: '123 Main St' },
            city: { type: 'string', example: 'Mumbai' },
            state: { type: 'string', example: 'Maharashtra' },
            pincode: { type: 'string', example: '400001' }
          }
        },
        Customer: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string', example: 'Rahul Sharma' },
            phone: { type: 'string', example: '9876543210' },
            email: { type: 'string' },
            address: { $ref: '#/components/schemas/Address' },
            vehicles: { type: 'array', items: { type: 'string' } },
            garage: { type: 'string' },
            totalVisits: { type: 'number' },
            totalSpent: { type: 'number' },
            notes: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateCustomerRequest: {
          type: 'object',
          required: ['name', 'phone'],
          properties: {
            name: { type: 'string', example: 'Rahul Sharma' },
            phone: { type: 'string', example: '9876543210' },
            email: { type: 'string', example: 'rahul@email.com' },
            address: { $ref: '#/components/schemas/Address' },
            notes: { type: 'string' }
          }
        },

        // ─── Vehicle ───
        Vehicle: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            licensePlate: { type: 'string', example: 'MH01AB1234' },
            make: { type: 'string', example: 'Maruti' },
            model: { type: 'string', example: 'Swift' },
            year: { type: 'number', example: 2022 },
            color: { type: 'string', example: 'White' },
            fuelType: { type: 'string', enum: ['petrol', 'diesel', 'cng', 'electric', 'hybrid', 'other'] },
            vin: { type: 'string' },
            engineNumber: { type: 'string' },
            currentOdometerReading: { type: 'number' },
            customer: { type: 'string' },
            garage: { type: 'string' },
            serviceHistory: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateVehicleRequest: {
          type: 'object',
          required: ['licensePlate', 'make', 'model', 'customer'],
          properties: {
            licensePlate: { type: 'string', example: 'MH01AB1234' },
            make: { type: 'string', example: 'Maruti' },
            model: { type: 'string', example: 'Swift' },
            year: { type: 'number', example: 2022 },
            color: { type: 'string', example: 'White' },
            fuelType: { type: 'string', enum: ['petrol', 'diesel', 'cng', 'electric', 'hybrid', 'other'] },
            vin: { type: 'string' },
            engineNumber: { type: 'string' },
            currentOdometerReading: { type: 'number', example: 25000 },
            customer: { type: 'string', description: 'Customer ObjectId' }
          }
        },

        // ─── Job Card ───
        Complaint: {
          type: 'object',
          properties: {
            description: { type: 'string', example: 'Engine noise at high RPM' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
          }
        },
        EstimationPart: {
          type: 'object',
          properties: {
            inventoryItem: { type: 'string', description: 'Inventory ObjectId' },
            partName: { type: 'string', example: 'Oil Filter' },
            quantity: { type: 'number', example: 1 },
            unitPrice: { type: 'number', example: 350 },
            total: { type: 'number', example: 350 }
          }
        },
        EstimationLabor: {
          type: 'object',
          properties: {
            description: { type: 'string', example: 'Engine diagnostics' },
            hours: { type: 'number', example: 2 },
            ratePerHour: { type: 'number', example: 500 },
            total: { type: 'number', example: 1000 }
          }
        },
        Estimation: {
          type: 'object',
          properties: {
            parts: { type: 'array', items: { $ref: '#/components/schemas/EstimationPart' } },
            labor: { type: 'array', items: { $ref: '#/components/schemas/EstimationLabor' } },
            subtotal: { type: 'number' },
            taxRate: { type: 'number', example: 18 },
            taxAmount: { type: 'number' },
            discount: { type: 'number', default: 0 },
            grandTotal: { type: 'number' },
            approvedByCustomer: { type: 'boolean' },
            approvedAt: { type: 'string', format: 'date-time', nullable: true },
            sentAt: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        JobCard: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            jobCardNumber: { type: 'string', example: 'JC-260512-0001' },
            serviceType: { type: 'string', enum: ['service', 'repair', 'accident'] },
            vehicle: { $ref: '#/components/schemas/Vehicle' },
            customer: { $ref: '#/components/schemas/Customer' },
            garage: { type: 'string' },
            complaints: { type: 'array', items: { $ref: '#/components/schemas/Complaint' } },
            assignedMechanic: { $ref: '#/components/schemas/User' },
            assignedAdvisor: { type: 'string' },
            status: {
              type: 'string',
              enum: ['new', 'estimation_sent', 'approved', 'in_progress', 'quality_check', 'ready_for_pickup', 'delivered', 'cancelled']
            },
            statusHistory: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  changedBy: { type: 'string' },
                  changedAt: { type: 'string', format: 'date-time' },
                  notes: { type: 'string' }
                }
              }
            },
            estimation: { $ref: '#/components/schemas/Estimation' },
            odometerAtIntake: { type: 'number' },
            expectedDeliveryDate: { type: 'string', format: 'date-time', nullable: true },
            actualDeliveryDate: { type: 'string', format: 'date-time', nullable: true },
            internalNotes: { type: 'string' },
            invoice: { type: 'string', nullable: true },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateJobCardRequest: {
          type: 'object',
          required: ['serviceType', 'vehicle', 'customer'],
          properties: {
            serviceType: { type: 'string', enum: ['service', 'repair', 'accident'] },
            vehicle: { type: 'string', description: 'Vehicle ObjectId' },
            customer: { type: 'string', description: 'Customer ObjectId' },
            complaints: { type: 'array', items: { $ref: '#/components/schemas/Complaint' } },
            assignedMechanic: { type: 'string', description: 'User ObjectId' },
            assignedAdvisor: { type: 'string', description: 'User ObjectId' },
            odometerAtIntake: { type: 'number', example: 35000 },
            expectedDeliveryDate: { type: 'string', format: 'date-time' },
            internalNotes: { type: 'string' }
          }
        },
        UpdateEstimationRequest: {
          type: 'object',
          properties: {
            parts: { type: 'array', items: { $ref: '#/components/schemas/EstimationPart' } },
            labor: { type: 'array', items: { $ref: '#/components/schemas/EstimationLabor' } },
            discount: { type: 'number', example: 500 },
            taxRate: { type: 'number', example: 18 }
          }
        },

        // ─── Invoice ───
        Invoice: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            invoiceNumber: { type: 'string', example: 'INV-260512-0001' },
            jobCard: { type: 'string' },
            customer: { $ref: '#/components/schemas/Customer' },
            vehicle: { $ref: '#/components/schemas/Vehicle' },
            garage: { type: 'string' },
            parts: { type: 'array', items: { $ref: '#/components/schemas/EstimationPart' } },
            labor: { type: 'array', items: { $ref: '#/components/schemas/EstimationLabor' } },
            subtotal: { type: 'number' },
            taxRate: { type: 'number' },
            taxAmount: { type: 'number' },
            discount: { type: 'number' },
            grandTotal: { type: 'number' },
            paymentStatus: { type: 'string', enum: ['unpaid', 'partial', 'paid'] },
            paymentMethod: { type: 'string', enum: ['cash', 'upi', 'card', 'bank_transfer', 'other', ''] },
            amountPaid: { type: 'number' },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            notes: { type: 'string' },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateInvoiceRequest: {
          type: 'object',
          required: ['jobCard'],
          properties: {
            jobCard: { type: 'string', description: 'JobCard ObjectId' },
            notes: { type: 'string' }
          }
        },
        UpdatePaymentRequest: {
          type: 'object',
          required: ['paymentStatus'],
          properties: {
            paymentStatus: { type: 'string', enum: ['unpaid', 'partial', 'paid'] },
            paymentMethod: { type: 'string', enum: ['cash', 'upi', 'card', 'bank_transfer', 'other'] },
            amountPaid: { type: 'number', example: 5000 }
          }
        },

        // ─── Inventory ───
        Supplier: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Auto Parts Inc' },
            phone: { type: 'string' },
            email: { type: 'string' }
          }
        },
        InventoryItem: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            partName: { type: 'string', example: 'Castrol 5W30 Engine Oil' },
            partNumber: { type: 'string', example: 'CST-5W30-4L' },
            category: {
              type: 'string',
              enum: ['engine_oil', 'filters', 'brakes', 'electrical', 'suspension', 'body_parts', 'tyres', 'battery', 'coolant', 'transmission', 'accessories', 'other']
            },
            quantity: { type: 'number' },
            threshold: { type: 'number' },
            unitPrice: { type: 'number' },
            sellingPrice: { type: 'number' },
            supplier: { $ref: '#/components/schemas/Supplier' },
            location: { type: 'string', example: 'Shelf A3' },
            garage: { type: 'string' },
            isActive: { type: 'boolean' },
            isLowStock: { type: 'boolean', description: 'Virtual field: true when quantity <= threshold' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateInventoryRequest: {
          type: 'object',
          required: ['partName', 'unitPrice'],
          properties: {
            partName: { type: 'string', example: 'Brake Pad Set' },
            partNumber: { type: 'string', example: 'BP-001' },
            category: { type: 'string', enum: ['engine_oil', 'filters', 'brakes', 'electrical', 'suspension', 'body_parts', 'tyres', 'battery', 'coolant', 'transmission', 'accessories', 'other'] },
            quantity: { type: 'number', example: 20 },
            threshold: { type: 'number', example: 5 },
            unitPrice: { type: 'number', example: 1200 },
            sellingPrice: { type: 'number', example: 1800 },
            supplier: { $ref: '#/components/schemas/Supplier' },
            location: { type: 'string', example: 'Shelf B2' }
          }
        },
        AdjustStockRequest: {
          type: 'object',
          required: ['adjustment'],
          properties: {
            adjustment: { type: 'number', example: 10, description: 'Positive to add, negative to subtract' }
          }
        },

        // ─── Garage ───
        GarageSettings: {
          type: 'object',
          description:
            'taxRate and laborRatePerHour are seeded from the country at creation and then ' +
            'owned by the garage. The presentation overrides below default to an empty string, ' +
            'meaning "inherit from the country table" — so a later correction to that table ' +
            'reaches existing garages.',
          properties: {
            currency: {
              type: 'string',
              example: '',
              description: "Override only. '' means inherit from the garage's country."
            },
            locale: { type: 'string', example: '', description: "Override only. '' means inherit." },
            taxLabel: { type: 'string', example: '', description: "Override only. '' means inherit." },
            timezone: {
              type: 'string',
              example: '',
              description:
                "Override only. Set for multi-zone countries (US/CA/AU); '' means inherit."
            },
            taxRate: { type: 'number', example: 18 },
            laborRatePerHour: { type: 'number', example: 500 },
            serviceReminderDays: { type: 'number', example: 180 }
          }
        },
        Garage: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string', example: 'SpeedFix Auto' },
            address: { $ref: '#/components/schemas/Address' },
            phone: { type: 'string' },
            email: { type: 'string' },
            gstNumber: {
              type: 'string',
              description:
                'Tax registration number. Field name is historical — it holds a GSTIN, VAT ' +
                'number, EIN or ABN depending on the country. Render it under locale.taxIdLabel.'
            },
            logo: { type: 'string' },
            country: {
              type: 'string',
              example: 'IN',
              description:
                'ISO 3166-1 alpha-2. Absent on garages created before country support shipped; ' +
                'those resolve to IN.'
            },
            owner: { type: 'string' },
            settings: { $ref: '#/components/schemas/GarageSettings' },
            locale: {
              allOf: [{ $ref: '#/components/schemas/ResolvedLocale' }],
              description: 'Server-resolved. Attached to every garage response.'
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },

        // ─── Service Reminder ───
        ServiceReminder: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            vehicle: { type: 'string' },
            customer: { type: 'string' },
            garage: { type: 'string' },
            jobCard: { type: 'string' },
            type: { type: 'string', enum: ['periodic_service', 'oil_change', 'tire_rotation', 'inspection', 'custom'] },
            nextServiceDate: { type: 'string', format: 'date-time' },
            nextServiceKm: { type: 'number' },
            notes: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'sent', 'completed', 'dismissed'] },
            reminderSentAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateReminderRequest: {
          type: 'object',
          required: ['vehicle', 'customer', 'nextServiceDate'],
          properties: {
            vehicle: { type: 'string', description: 'Vehicle ObjectId' },
            customer: { type: 'string', description: 'Customer ObjectId' },
            type: { type: 'string', enum: ['periodic_service', 'oil_change', 'tire_rotation', 'inspection', 'custom'] },
            nextServiceDate: { type: 'string', format: 'date-time' },
            nextServiceKm: { type: 'number', example: 50000 },
            notes: { type: 'string' }
          }
        },
        UpdateReminderStatusRequest: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['pending', 'sent', 'completed', 'dismissed'] }
          }
        },

        // ─── Dashboard ───
        DashboardStats: {
          type: 'object',
          properties: {
            totalJobCards: { type: 'number' },
            activeJobCards: { type: 'number' },
            totalCustomers: { type: 'number' },
            totalVehicles: { type: 'number' },
            totalRevenue: { type: 'number' },
            pendingPayments: { type: 'number' },
            recentJobCards: { type: 'array', items: { $ref: '#/components/schemas/JobCard' } },
            jobsByStatus: { type: 'object' },
            queryTimeMs: { type: 'number' }
          }
        },

        // ─── Mobile App Release ───
        AppUpdateDecision: {
          type: 'object',
          description:
            'What a given app build is told about updates. Every field is always present — never omitted, never null — because published mobile builds cannot be force-upgraded and two client generations would read a sometimes-absent field differently.',
          properties: {
            updateAvailable: { type: 'boolean', description: 'A newer version exists on the store' },
            updateRequired: { type: 'boolean', description: 'This build is below the minimum and must not be used' },
            latestVersion: { type: 'string', example: '1.1.0', description: 'Empty when there is no policy' },
            storeUrl: {
              type: 'string',
              description:
                'Store listing. Present for iOS, whose App Store id is assigned by Apple and is not knowable from app.json. Android clients deliberately ignore this and use their own compiled-in constant — the store link is the escape hatch when a bad policy has blocked the app, so it must not come from the same document that did the blocking.'
            },
            message: { type: 'string', description: 'Copy to show; the blocking message when required' },
            receivedVersion: {
              type: 'string',
              description: 'Echo of the version query param, so a client can detect a cached or misrouted response'
            }
          }
        },

        AppReleasePolicy: {
          type: 'object',
          description: 'The stored mobile release policy. One document per platform.',
          properties: {
            platform: { type: 'string', enum: ['android', 'ios'] },
            latestVersion: { type: 'string', example: '1.1.0' },
            minSupportedVersion: {
              type: 'string',
              example: '',
              description: 'Builds below this are blocked. An empty string means nobody is blocked — this is the undo path for a bad policy, so it must stay clearable.'
            },
            storeUrl: { type: 'string' },
            updateMessage: { type: 'string' },
            blockingMessage: { type: 'string' },
            enabled: {
              type: 'boolean',
              description: 'Kill switch. While false the endpoint reports no update and blocks nobody, whatever the versions say.'
            },
            updatedBy: { type: 'string', description: 'Email of the admin who last saved' }
          }
        },

        // ─── Paginated Response ───
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            count: { type: 'number', description: 'Items in current page' },
            total: { type: 'number', description: 'Total items' },
            pages: { type: 'number', description: 'Total pages' },
            currentPage: { type: 'number' }
          }
        }
      }
    },
    security: [{ BearerAuth: [] }]
  },
  apis: [
    path.join(__dirname, '..', 'routes', `*${ext}`),
    path.join(__dirname, `swaggerDocs${ext}`)
  ]
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
