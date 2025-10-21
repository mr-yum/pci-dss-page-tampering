const config = require('./.node-builder/eslint-config.cjs')

const overrides = {
  rules: {
    'max-len': ['warn', { code: 240 }],
    // Allow console statements in this backend/CLI monitoring service
    'no-console': 'off',
  },
}

module.exports = [...config, overrides]
