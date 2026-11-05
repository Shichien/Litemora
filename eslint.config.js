import antfu from '@antfu/eslint-config'

const composer = antfu({
  ignores: [
    'node_modules',
    'node_modules/**',
    '.md',
    '.pnp',
    '.pnp/**',
    '.pnp.js',
    '**/.pnp.js/**',
    'coverage',
    'coverage/**',
    'test-results/',
    'test-results/**/',
    'dist',
    'dist/**',
    'output',
    'output/**',
    '.playwright-cli',
    '.playwright-cli/**',
    'high-level-dependencies.html',
    '**/high-level-dependencies.html/**',
    '.DS_Store',
    '**/.DS_Store/**',
    '*.pem',
    '**/*.pem/**',
    'npm-debug.log*',
    '**/npm-debug.log*/**',
    'yarn-debug.log*',
    '**/yarn-debug.log*/**',
    'yarn-error.log*',
    '**/yarn-error.log*/**',
    '.pnpm-debug.log*',
    '**/.pnpm-debug.log*/**',
    '.env*.local',
    '**/.env*.local/**',
    '.vercel',
    '**/.vercel/**',
    'public/.dev-gallery/**',
    'public/minecraft-default-pack/**',
    'public/redstone-archive/*.replay.json',
    'public/**/world-state.json',
    'src/js/generated/**',
  ],
  rules: {
    // 允许使用 console.debug (用于调试功能)
    'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
  },
})

composer.overrideRules({
  // `@antfu/eslint-config` 4.10 still emits the deprecated option name here,
  // but the resolved Vue/Stylistic rule schema in this repo only accepts
  // `allowAllPropertiesOnSameLine`.
  'jsonc/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
  'vue/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
})

composer.append({
  files: ['scripts/**/*.mjs'],
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
  },
})

export default composer
