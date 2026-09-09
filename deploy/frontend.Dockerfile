FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY public ./public
COPY vite.config.ts tsconfig.json ./
COPY deploy/build-frontend.mjs ./deploy/build-frontend.mjs
RUN node deploy/build-frontend.mjs

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
