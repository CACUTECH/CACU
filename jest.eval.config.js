// The AI-on-the-books evaluation (Doc 15, TEST-411): staging only, run with `npm run ai:eval`, never part of `npm test`.
const nextJest = require('next/jest')

module.exports = nextJest({ dir: './' })({
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/evals/**/*.eval.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
})
