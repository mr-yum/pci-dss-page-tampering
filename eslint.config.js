const config = require('./.node-builder/eslint-config.cjs')

const overrides = {
  rules: {
    'max-len': ['warn', { code: 240 }],
  },
}

module.exports = [...config, overrides]
