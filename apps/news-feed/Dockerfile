FROM node:22-bookworm AS build

WORKDIR /app/apps/news-feed

COPY apps/news-feed/package.json ./
COPY apps/news-feed/tsconfig.json ./
COPY sdks/alert-sdk ../../sdks/alert-sdk
RUN npm install

COPY apps/news-feed/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app/apps/news-feed
ENV NODE_ENV=production

COPY --from=build /app/apps/news-feed/package.json ./package.json
COPY --from=build /app/apps/news-feed/node_modules ./node_modules
COPY --from=build /app/apps/news-feed/dist ./dist
COPY --from=build /app/sdks/alert-sdk/package.json /app/sdks/alert-sdk/package.json
COPY --from=build /app/sdks/alert-sdk/dist /app/sdks/alert-sdk/dist

EXPOSE 18380
CMD ["node", "--enable-source-maps", "dist/index.js"]
