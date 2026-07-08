/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // *.live.test.ts 是真实网络测试，默认排除；用 pnpm run test:ports 单独跑
  testPathIgnorePatterns: ['/node_modules/', '\\.live\\.test\\.ts$'],
  collectCoverageFrom: ['src/core/stt.ts', 'src/core/packet.ts'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
