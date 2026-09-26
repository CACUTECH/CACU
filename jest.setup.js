import '@testing-library/jest-dom'

// Mock Supabase Server Client.
//
// `from()` and `createClient()` each return the SAME shared object on every
// call (rather than a fresh one per invocation) so that a test's captured
// reference (`await createClient()`) and the service-under-test's internal
// calls are the exact same mock instance — otherwise overrides like
// `mockResolvedValueOnce` set up in a test would silently never be seen by
// the code being tested.
const mockQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: {}, error: null }),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
};

const mockSupabaseClient = {
  auth: {
    getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user-id', email: 'test@example.com' } }, error: null })),
  },
  from: jest.fn(() => mockQueryBuilder),
  rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
};

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

// Mock Next.js Headers
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn(),
    getAll: jest.fn(() => []),
  })),
}));

// Mock ResizeObserver for UI components
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));