module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    // Revert: Keep original ignore pattern
    '/node_modules/(?!(@babel/runtime)/)'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  moduleFileExtensions: ['js', 'json'],
  // Revert: Remove moduleNameMapper for node-fetch
  // moduleNameMapper: {
  //   '^node-fetch$': 'node-fetch-commonjs',
  // },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};