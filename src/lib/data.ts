
export type BusinessType = 'PRODUCT' | 'SERVICE' | 'HYBRID';

export type PricingModel = 
    | 'Fixed' 
    | 'Hourly' 
    | 'Daily' 
    | 'Weekly' 
    | 'Monthly' 
    | 'Project' 
    | 'Subscription' 
    | 'Visit' 
    | 'Unit';

export type CatalogItemType = 'Product' | 'Service' | 'Package';

export type CatalogItem = {
    id: string;
    type: CatalogItemType;
    name: string;
    category: string;
    description: string;
    price: number;
    tax?: number;
    status: 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Active' | 'Inactive';
    image?: string;
    // Product specific
    sku?: string;
    quantity?: number;
    reorderLevel?: number;
    // Service specific
    duration?: number; // in minutes
    pricingModel?: PricingModel;
    assignedStaff?: string[];
};

export const catalogItems: CatalogItem[] = [
    { 
        id: 'cat-001', 
        type: 'Product', 
        name: 'Premium Engine Oil', 
        category: 'Parts', 
        description: 'High performance synthetic oil.', 
        price: 15000, 
        sku: 'OIL-001', 
        quantity: 45, 
        reorderLevel: 10, 
        status: 'In Stock' 
    },
    { 
        id: 'cat-002', 
        type: 'Service', 
        name: 'Full Vehicle Service', 
        category: 'Maintenance', 
        description: 'Comprehensive car checkup and oil change.', 
        price: 25000, 
        duration: 120, 
        pricingModel: 'Fixed', 
        status: 'Active' 
    },
    { 
        id: 'cat-003', 
        type: 'Service', 
        name: 'Legal Consultation', 
        category: 'Legal', 
        description: 'One-on-one session with a senior partner.', 
        price: 50000, 
        duration: 60, 
        pricingModel: 'Hourly', 
        status: 'Active' 
    }
];

export type JobStatus = 'Draft' | 'Pending' | 'Approved' | 'Assigned' | 'In Progress' | 'Completed' | 'Cancelled';

export type Job = {
    id: string;
    customerName: string;
    title: string;
    description: string;
    status: JobStatus;
    priority: 'Low' | 'Medium' | 'High' | 'Urgent';
    assignedStaffId?: string;
    dueDate: string;
    createdAt: string;
    totalAmount: number;
};

export const jobs: Job[] = [
    {
        id: 'job-001',
        customerName: 'Alice Johnson',
        title: 'Brake Pad Replacement',
        description: 'Customer reported squeaking noises when braking.',
        status: 'In Progress',
        priority: 'High',
        assignedStaffId: 'emp-004',
        dueDate: '2024-07-25',
        createdAt: '2024-07-20',
        totalAmount: 18500
    },
    {
        id: 'job-002',
        customerName: 'Bob Williams',
        title: 'Tax Advisory Session',
        description: 'Preparation for Q3 VAT filing.',
        status: 'Assigned',
        priority: 'Medium',
        assignedStaffId: 'emp-001',
        dueDate: '2024-07-28',
        createdAt: '2024-07-22',
        totalAmount: 50000
    }
];

export type Appointment = {
    id: string;
    customerName: string;
    serviceName: string;
    staffName: string;
    startTime: string;
    endTime: string;
    status: 'Scheduled' | 'Confirmed' | 'Completed' | 'Cancelled';
};

export const appointments: Appointment[] = [
    {
        id: 'app-001',
        customerName: 'Diana Miller',
        serviceName: 'Hair Styling',
        staffName: 'Chioma Nwosu',
        startTime: '2024-07-24T10:00:00',
        endTime: '2024-07-24T11:30:00',
        status: 'Scheduled'
    }
];

export type Transaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'Income' | 'Expense';
  category: string;
  account: string;
};

export const transactions: Transaction[] = [
  { id: '1', date: '2024-07-20', description: 'Service Fee: Project Alpha', amount: 150000, type: 'Income', category: 'Services', account: 'Business Checking' },
  { id: '2', date: '2024-07-19', description: 'Parts Purchase: Brake Pads', amount: 25000, type: 'Expense', category: 'Inventory', account: 'Business Credit Card' },
  { id: '3', date: '2024-07-18', description: 'Consulting Retainer', amount: 75000, type: 'Income', category: 'Services', account: 'Business Checking' },
];

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'Active' | 'On Probation' | 'Terminated';
  checkInTime?: string;
  checkOutTime?: string;
};

export const employees: Employee[] = [
  { id: 'emp-001', name: 'Grace Adebayo', email: 'grace@example.com', role: 'Senior Consultant', status: 'Active', checkInTime: '09:05 AM', checkOutTime: '05:30 PM' },
  { id: 'emp-002', name: 'Samuel Okoro', email: 'samuel@example.com', role: 'Operations Manager', status: 'Active', checkInTime: '08:58 AM', checkOutTime: '06:00 PM' },
  { id: 'emp-003', name: 'Chioma Nwosu', email: 'chioma@example.com', role: 'Technical Specialist', status: 'On Probation', checkInTime: '09:15 AM' },
  { id: 'emp-004', name: 'David Bello', email: 'david@example.com', role: 'Mechanic', status: 'Active', checkInTime: '09:00 AM', checkOutTime: '05:00 PM' },
];

export const incomeVsExpenseData = [
    { month: 'Jan', income: 4000, expense: 2400 },
    { month: 'Feb', income: 3000, expense: 1398 },
    { month: 'Mar', income: 5000, expense: 3800 },
    { month: 'Apr', income: 2780, expense: 1908 },
    { month: 'May', income: 3890, expense: 2800 },
    { month: 'Jun', income: 4390, expense: 2100 },
    { month: 'Jul', income: 12500, expense: 1845 },
];

export const expensesByCategoryData = [
    { category: 'Wages', value: 5500 },
    { category: 'Rent', value: 2500 },
    { category: 'Supplies', value: 1800 },
    { category: 'Marketing', value: 1200 },
];
