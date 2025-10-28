const config = require('./.node-builder/eslint-config.cjs')

const overrides = {
  rules: {
    'max-len': ['warn', { code: 240 }],
    // Allow console statements in this backend/CLI monitoring service
    'no-console': 'off',
    // Prevent absolute imports from 'src/' to avoid runtime resolution issues
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['src/*'],
            message: 'Use relative imports instead of absolute "src/" imports to ensure proper runtime module resolution.',
          },
        ],
      },
    ],
  },
}

module.exports = [...config, overrides]
