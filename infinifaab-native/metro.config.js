// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// npm workspaces monorepo: this app's own dependencies get hoisted up to
// the repo root's node_modules, and shared-core/infinidata live outside
// this app's own directory entirely - Metro only watches/resolves within
// its project root by default, so both need to be opened up explicitly
// (same shape as every Expo-in-a-monorepo setup: see Expo's monorepo docs).
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Mirrors the @shared-core/@infinidata Vite aliases every web app
// (infinidraft/infinileague/infinifaab) already uses - same alias names,
// same targets, so shared-core's hooks (which import "@infinidata/api")
// resolve identically under Metro as they do under Vite.
config.resolver.extraNodeModules = {
  '@shared-core': path.resolve(workspaceRoot, 'shared-core'),
  '@infinidata': path.resolve(workspaceRoot, 'infinidata/convex/_generated'),
};

module.exports = config;
