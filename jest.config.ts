import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'NodeNext',
          esModuleInterop: true,
          resolveJsonModule: true,
          allowSyntheticDefaultImports: true,
          // keep TS only for speed
          isolatedModules: true,
          jsx: 'react-jsx',
        },
        useESM: true,
        diagnostics: false,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transformIgnorePatterns: ['/node_modules/(?!(?:@modelcontextprotocol/sdk)/)'],
  moduleNameMapper: {
    '^~/common/events$': '<rootDir>/__mocks__/common-events.ts',
    '^~/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: [],
  maxWorkers: 1,
  testTimeout: 120000,
};

export default config;
