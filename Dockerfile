# Builder installs devDependencies and produces two artifacts the runtime copies:
# server.mjs, and dist/ which staticWeb() reads relative to the working directory
# (apps/api/src/lib/static-web.ts). Do not relocate dist without changing that default.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# The lockfile records optional native packages only for the platform that
# created it. esbuild, lightningcss, and rolldown still need Alpine binaries
# before `npm run build` (Vite) and the API bundle can run.
RUN <<'EOF'
set -eu
npm ci --ignore-scripts
node node_modules/esbuild/install.js
node <<'NODE'
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const suffix = process.arch === 'arm64' ? 'linux-arm64-musl' : 'linux-x64-musl';
function version(paths) {
  const file = paths.find((path) => existsSync(path));
  if (!file) throw new Error(`Missing package: ${paths.join(' or ')}`);
  return require(`./${file}`).version;
}
// One install: a second `npm install` would prune the package the first one added.
const specs = [
  `lightningcss-${suffix}@${version([
    'node_modules/lightningcss/package.json',
    'node_modules/vite/node_modules/lightningcss/package.json',
  ])}`,
  `@rolldown/binding-${suffix}@${version([
    'node_modules/rolldown/package.json',
    'node_modules/vite/node_modules/rolldown/package.json',
  ])}`,
];
execFileSync('npm', ['install', '--no-save', '--ignore-scripts', ...specs], { stdio: 'inherit' });
NODE
EOF

COPY . .
# jsdom stays external: it resolves xhr-sync-worker.js from its own package tree.
RUN npm run build \
 && ./node_modules/.bin/esbuild apps/api/src/main.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --target=node22 \
      --outfile=/app/server.mjs \
      --external:pg \
      --external:@napi-rs/canvas \
      --external:@node-rs/argon2 \
      --external:ws \
      --external:jsdom

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

# Only the packages esbuild left external. Versions come from the repo manifest
# so native addons stay aligned with the source that was bundled.
COPY package.json /tmp/agentboard-package.json
RUN <<'EOF'
set -eu
node <<'NODE'
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const src = require('/tmp/agentboard-package.json');
const names = ['pg', 'ws', 'jsdom', '@napi-rs/canvas', '@node-rs/argon2'];
const dependencies = {};
for (const name of names) {
  if (src.dependencies && src.dependencies[name]) dependencies[name] = src.dependencies[name];
}
writeFileSync('/app/package.json', JSON.stringify({ name: 'agentboard', private: true, dependencies }));
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts'], { stdio: 'inherit', cwd: '/app' });
NODE
rm -f /tmp/agentboard-package.json
npm cache clean --force
EOF

COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/dist ./dist

EXPOSE 4173
CMD ["node", "server.mjs"]
