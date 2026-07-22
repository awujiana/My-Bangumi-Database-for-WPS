// lint-staged 配置：对暂存文件按类型执行 ESLint 与 Prettier
// 仅匹配 ts/ 目录下的源码，排除 dist-ts/ 编译产物
module.exports = {
    'ts/**/*.ts': ['eslint --fix', 'prettier --write'],
    'tests/**/*.ts': ['prettier --write'],
    '*.{json,md}': ['prettier --write'],
};
