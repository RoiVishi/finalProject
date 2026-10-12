// NFR-MAIN-1 (KAN-72): the JavaScript/TypeScript leg of "lint on every merge".
// Python is linted by ruff in the `lint` CI job; this file covers the two Node
// components. It lives at the repo root (with its own package.json) so neither
// component has to carry the other's lint toolchain.
//
// Scope is correctness, not style: the recommended rule sets only, so a red
// lint job means a probable bug (undefined name, unused binding, broken hook
// usage), never a formatting preference.
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Files that render inside a react-three-fiber <Canvas>: their JSX elements are
// three.js objects (<mesh position args castShadow>), not DOM elements, so the
// DOM-attribute check would flag every line.
const R3F_FILES = [
  'frontend/src/DigitalTwin.jsx',
  'frontend/src/RealisticTwin.jsx',
  'frontend/src/RoomView.jsx',
  'frontend/src/furniture.jsx',
  'frontend/src/ar/**/*.jsx',
];

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },

  // ---- frontend: React 18 + Vite, plain JS/JSX ----
  {
    files: ['frontend/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // browser code + node --test unit tests live side by side
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18' } },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off', // no PropTypes in this codebase
      // `import React from 'react'` is kept for readability under the automatic JSX runtime
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$', argsIgnorePattern: '^_' }],
    },
  },
  { files: R3F_FILES, rules: { 'react/no-unknown-property': 'off' } },

  // ---- backend: NestJS, TypeScript ----
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['backend/src/**/*.ts'] })),
  {
    files: ['backend/src/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // reported, not blocking: a typing-quality signal rather than a probable bug
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
