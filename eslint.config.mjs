/**
 * StarCloud monorepo 统一 ESLint 配置（flat config，ESLint 9+）。
 *
 * 设计目标：拦截死代码与低级错误，不做严格风格约束（无 prettier/format 规则）。
 * - 规则集：@eslint/js recommended + typescript-eslint recommended（非 type-checked）
 * - 核心：@typescript-eslint/no-unused-vars（error）—— 未使用的 import/变量/参数
 * - 历史噪音规则（any / require 等）初始降为 warn，待网络恢复后按实际统计复核
 * - 不启用 type-aware linting（parserOptions.project / projectService）：
 *   避免对 apps/mobile 的 TypeScript 6.0（Expo SDK 57 默认）的解析兼容风险，
 *   类型正确性已由各包 tsc --noEmit 把关
 * - 不开启 no-undef：TS 已覆盖未定义变量，TS parser 下易误报
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      '**/.npm-cache/**',
      '**/.pnpm-store/**',
      '_tmp/**',
      'apps/server/uploads/**',
      'apps/server/prisma/data/**',
      'apps/server/prisma/migrations/**',
      '**/*.db',
      '**/*.db-journal',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      // metro.config.js 等 CJS 配置文件使用 require/module
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // CJS 配置文件（metro.config.js 等）的 require 属正常用法，与 TS 侧一致降 warn
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // ---- 死代码拦截（本配置的核心目标） ----
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],

      // ---- 历史噪音规则：初始 warn，待实跑统计后复核 ----
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',

      // ---- React Hooks ----
      // 只启用 exhaustive-deps（warn）：匹配代码中已有的 disable 注释；
      // 不整套启用 v7 recommended（含 15 个新规则，会洪泛新报错）
      'react-hooks/exhaustive-deps': 'warn',

      // ---- 与现有代码风格对齐的放宽 ----
      // React 19 + react-jsx 无需显式导入 React
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);