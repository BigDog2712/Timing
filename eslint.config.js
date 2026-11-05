import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Timing — 前端 lint（v0.3 首次落地）
 * -----------------------------------------------------------------------------
 * 目标不是「代码风格统一」（那靠约定与格式化），而是**拦住真实缺陷**：
 *   1. 未定义变量 / 不可能到达的代码 / 重复 case（JS 基本正确性）；
 *   2. 可疑的 `any` 泄漏与未使用变量（只在明确无歧义时报告）；
 *   3. 分层规则的兜底（主门禁在 scripts/check-layers.mjs，因为它要跨语言 grep）。
 *
 * 刻意**不启用**：格式化类规则（缩进/引号/换行）、类型感知规则（跑得慢且需
 * `tsconfig` 全量解析）。一个刚引入 lint 的仓库，先把错误清零比把风格统一更重要。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'preview/**', 'release/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        fetch: 'readonly',
        URLSearchParams: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLDivElement: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        PointerEvent: 'readonly',
        WheelEvent: 'readonly',
        Event: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        DOMRect: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      // Hook 依赖：既有代码用 eslint-disable 注释显式标注了「故意不写依赖」的位置，
      // 装上插件后这些注释才有意义（之前它们引用了一个不存在的规则）。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TS 已经负责「未使用」与类型检查：这里只留「明显是 bug」的部分
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      // 真实缺陷类
      eqeqeq: ['error', 'smart'],
      'no-debugger': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
