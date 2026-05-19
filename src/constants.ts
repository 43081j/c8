export const DEFAULT_EXCLUDE: readonly string[] = [
  'coverage/**',
  'packages/*/test{,s}/**',
  '**/*.d.ts',
  'test{,s}/**',
  'test{,-*}.{js,cjs,mjs,ts,tsx,jsx}',
  '**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}',
  '**/__tests__/**',
  '**/{ava,babel,nyc}.config.{js,cjs,mjs}',
  '**/jest.config.{js,cjs,mjs,ts}',
  '**/{karma,rollup,webpack}.config.js',
  '**/.{eslint,mocha}rc.{js,cjs}',
];

export const DEFAULT_EXTENSION: readonly string[] = [
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.jsx',
];
