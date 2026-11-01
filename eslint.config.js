import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Configuración plana de ESLint (ESLint 9).
 *
 * El script `lint` del package.json es `eslint .`, pero el repositorio no tenía
 * `eslint.config.js` ni `.eslintrc.*`, así que `npm run lint` abortaba antes de
 * analizar nada. Con este archivo la verificación vuelve a ser real.
 *
 * Alcance: TypeScript/TSX del POS y del servidor de sincronización local.
 * Se excluyen artefactos de build, el proyecto Android y los scripts sueltos de
 * depuración (`.js`/`.cjs` de la raíz) que no forman parte del bundle.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'android/**',
      'public/**',
      'native-stubs/**',
      'scripts/**',
      '*.cjs',
      '*.js',
      'eslint.config.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // El POS consume payloads del ERP sin esquema generado y el snapshot se
      // tipa parcialmente: `any` es deliberado en los bordes de integración
      // (hay ~1.000 usos previos), así que la regla no aporta señal aquí.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
