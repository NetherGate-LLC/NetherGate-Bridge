# ---- build stage: bundle everything into dist/index.js ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json build.mjs ./
COPY src ./src
RUN npm run build

# ---- runtime stage: just Node + the single bundled file ----
# The bundle already contains express + mongodb + all deps, so there is no
# node_modules to install here.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist/index.js ./index.js

USER node
EXPOSE 3000
CMD ["node", "index.js"]
