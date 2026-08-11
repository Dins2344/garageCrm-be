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
            phone: { type: 'string', example: '9876543210' },
            password: { type: 'string', minLength: 6, example: 'securepass123' },
            garageName: { type: 'string', example: 'SpeedFix Auto' },
            garagePhone: { type: 'string', example: '9876543211' },
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
                garage: { type: 'string' }
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
          properties: {
            currency: { type: 'string', example: 'INR' },
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
            gstNumber: { type: 'string' },
            logo: { type: 'string' },
            owner: { type: 'string' },
            settings: { $ref: '#/components/schemas/GarageSettings' },
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
