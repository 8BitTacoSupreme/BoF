module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: { global: { branches: 70, functions: 80, lines: 80 } },
  // Transform dt-sql-parser and its ESM-only dependencies (antlr4-c3, antlr4ng) for jest CJS compatibility
  transformIgnorePatterns: [
    '/node_modules/(?!(dt-sql-parser|antlr4-c3|antlr4ng)/)'
  ],
  transform: {
    '^.+\\.[jt]s$': ['babel-jest', { configFile: './babel.config.js' }],
    '^.+\\.mjs$': ['babel-jest', { configFile: './babel.config.js' }]
  }
};
