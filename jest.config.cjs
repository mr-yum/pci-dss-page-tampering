const swcConfig = {
  swcrc: false,
  jsc: {
    loose: true,
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    keepClassNames: true,
  },
  sourceMaps: 'inline',
  inlineSourcesContent: false,
  module: { type: 'commonjs', ignoreDynamic: true },
}

// Source uses ESM-style `.js` extensions on relative imports (required by
// Node's ESM resolver). Tests are transformed to CommonJS, so strip the `.js`
// back off here to resolve the real `.ts` source files.
const moduleNameMapper = {
  '^(\\.{1,2}/.*)\\.js$': '$1',
}

/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.(j|t)s', '<rootDir>/src/**/*.spec.(j|t)s'],
      testPathIgnorePatterns: ['\\.integration\\.(spec|test)\\.(j|t)s$', '__fixtures__'],
      modulePathIgnorePatterns: ['<rootDir>/dist'],
      moduleNameMapper,
      transform: {
        '^.+\\.(t|j)sx?$': ['@swc/jest', swcConfig],
      },
      collectCoverageFrom: ['<rootDir>/src/**/*.(t|j)s', '!**/*.spec.ts', '!**/*.test.ts', '!**/__tests__/**'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.integration.spec.(j|t)s', '<rootDir>/src/**/*.integration.test.(j|t)s', '<rootDir>/test/integration/**/*.test.(j|t)s', '<rootDir>/test/integration/**/*.spec.(j|t)s'],
      testPathIgnorePatterns: ['__fixtures__'],
      modulePathIgnorePatterns: ['<rootDir>/dist'],
      moduleNameMapper,
      transform: {
        '^.+\\.(t|j)sx?$': ['@swc/jest', swcConfig],
      },
    },
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['lcovonly'],
  testLocationInResults: true,
}

module.exports = config
