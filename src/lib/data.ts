
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
  { id: '1', date: '2024-07-20', description: 'Client Project A Payment', amount: 5000, type: 'Income', category: 'Client Revenue', account: 'Business Checking' },
  { id: '2', date: '2024-07-19', description: 'Office Supplies', amount: 150, type: 'Expense', category: 'Office Supplies', account: 'Business Credit Card' },
  { id: '3', date: '2024-07-18', description: 'Software Subscription (SaaS)', amount: 45, type: 'Expense', category: 'Software', account: 'Business Credit Card' },
  { id: '4', date: '2024-07-17', description: 'Client Project B Payment', amount: 7500, type: 'Income', category: 'Client Revenue', account: 'Business Checking' },
  { id: '5', date: '2024-07-16', description: 'Lunch with Client', amount: 80, type: 'Expense', category: 'Meals & Entertainment', account: 'Business Credit Card' },
  { id: '6', date: '2024-07-15', description: 'Freelance Designer Payment', amount: 1200, type: 'Expense', category: 'Contractors', account: 'Business Checking' },
  { id: '7', date: '2024-07-14', description: 'Social Media Ad Campaign', amount: 300, type: 'Expense', category: 'Marketing', account: 'Business Credit Card' },
  { id: '8', date: '2024-07-13', description: 'Domain Name Renewal', amount: 20, type: 'Expense', category: 'Utilities', account: 'Business Credit Card' },
];

export type InventoryItem = {
    id: string;
    name: string;
    sku: string;
    quantity: number;
    price: number;
    reorderLevel: number;
    status: 'In Stock' | 'Low Stock' | 'Out of Stock';
};

export const inventoryItems: InventoryItem[] = [
    { id: 'prod-001', name: 'Premium Widget', sku: 'PW-001', quantity: 150, price: 29.99, reorderLevel: 50, status: 'In Stock' },
    { id: 'prod-002', name: 'Standard Gadget', sku: 'SG-002', quantity: 80, price: 19.99, reorderLevel: 30, status: 'In Stock' },
    { id: 'prod-003', name: 'Basic Thingamajig', sku: 'BT-003', quantity: 15, price: 9.99, reorderLevel: 20, status: 'Low Stock' },
    { id: 'prod-004', name: 'Advanced Contraption', sku: 'AC-004', quantity: 0, price: 99.99, reorderLevel: 10, status: 'Out of Stock' },
    { id: 'prod-005', name: 'Simple Doohickey', sku: 'SD-005', quantity: 200, price: 4.99, reorderLevel: 100, status: 'In Stock' },
];

export const accounts = [
    { id: 'acc-1', name: 'Business Checking', balance: 12500.50 },
    { id: 'acc-2', name: 'Business Credit Card', balance: -2450.75 },
    { id: 'acc-3', name: 'Savings Account', balance: 50000.00 },
];

export const categories = [
    { id: 'cat-1', name: 'Client Revenue', type: 'Income' },
    { id: 'cat-2', name: 'Office Supplies', type: 'Expense' },
    { id: 'cat-3', name: 'Software', type: 'Expense' },
    { id: 'cat-4', name: 'Meals & Entertainment', type: 'Expense' },
    { id: 'cat-5', name: 'Contractors', type: 'Expense' },
    { id: 'cat-6', name: 'Marketing', type: 'Expense' },
    { id: 'cat-7', name: 'Utilities', type: 'Expense' },
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
    { category: 'Office Supplies', value: 150 },
    { category: 'Software', value: 45 },
    { category: 'Meals & Ent.', value: 80 },
    { category: 'Contractors', value: 1200 },
    { category: 'Marketing', value: 300 },
    { category: 'Utilities', value: 20 },
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
  { id: 'emp-001', name: 'Grace Adebayo', email: 'grace@example.com', role: 'Lead Developer', status: 'Active', checkInTime: '09:05 AM', checkOutTime: '05:30 PM' },
  { id: 'emp-002', name: 'Samuel Okoro', email: 'samuel@example.com', role: 'Marketing Manager', status: 'Active', checkInTime: '08:58 AM', checkOutTime: '06:00 PM' },
  { id: 'emp-003', name: 'Chioma Nwosu', email: 'chioma@example.com', role: 'UX Designer', status: 'On Probation', checkInTime: '09:15 AM' },
  { id: 'emp-004', name: 'David Bello', email: 'david@example.com', role: 'Accountant', status: 'Active', checkInTime: '09:00 AM', checkOutTime: '05:00 PM' },
  { id: 'emp-005', name: 'Fatima Aliyu', email: 'fatima@example.com', role: 'HR Specialist', status: 'Terminated' },
];

export type PayrollRun = {
    id: string;
    month: string;
    totalPaid: number;
    employeesPaid: number;
    payslips: {
        employeeName: string;
        netPay: number;
    }[];
}

export const payrollHistory: PayrollRun[] = [
    {
        id: 'run-001',
        month: 'June 2024',
        totalPaid: 1317500,
        employeesPaid: 4,
        payslips: [
            { employeeName: "Grace Adebayo", netPay: 425000 },
            { employeeName: "Samuel Okoro", netPay: 340000 },
            { employeeName: "Chioma Nwosu", netPay: 297500 },
            { employeeName: "David Bello", netPay: 255000 },
        ]
    },
    {
        id: 'run-002',
        month: 'May 2024',
        totalPaid: 1295000,
        employeesPaid: 4,
        payslips: [
             { employeeName: "Grace Adebayo", netPay: 425000 },
            { employeeName: "Samuel Okoro", netPay: 340000 },
            { employeeName: "Chioma Nwosu", netPay: 297500 },
            { employeeName: "David Bello", netPay: 232500 },
        ]
    }
]
