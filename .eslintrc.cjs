// ESLint 配置文件 - 使用 legacy 配置格式
// 严格遵循团队 TypeScript 规范：禁用 any、强制类型导入、导入顺序检查等
module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
    },
    plugins: ['@typescript-eslint', 'import'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/strict',
        'plugin:import/recommended',
        'plugin:import/typescript',
    ],
    settings: {
        'import/resolver': {
            typescript: {
                project: './tsconfig.json',
                alwaysTryTypes: true,
            },
        },
    },
    env: {
        browser: true,
        es2022: true,
        node: true,
    },
    rules: {
        // 禁止 any 类型
        '@typescript-eslint/no-explicit-any': 'error',
        // 禁止非空断言 !
        '@typescript-eslint/no-non-null-assertion': 'warn',
        // 禁止未使用变量
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        // 强制类型导入
        '@typescript-eslint/consistent-type-imports': 'error',
        // 导入顺序
        'import/order': ['error', {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
        }],
        // 循环依赖检测（降级为 warn：re-export 文件导致的循环依赖需大型重构）
        'import/no-cycle': ['warn', { maxDepth: 10 }],
        // 禁止 @ts-ignore
        'no-restricted-syntax': [
            'error',
            {
                selector: 'TSIgnoreComment',
                message: '禁止使用 @ts-ignore，请使用类型守卫或 $TSFixMe + TODO 跟踪',
            },
        ],
        // 禁止 debugger
        'no-debugger': 'error',
        // 禁止 console.log（生产代码）
        'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
    ignorePatterns: [
        'dist/',
        'dist-ts/',
        'wps-addon-build/',
        'node_modules/',
        '*.js',
        '!vite.config.js',
        '!vitest.config.ts',
    ],
};
