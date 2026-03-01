FROM node:22-bookworm AS build

WORKDIR /app/apps/alert-hub

COPY apps/alert-hub/package.json ./
COPY apps/alert-hub/tsconfig.json ./
COPY sdks/alert-sdk ../../sdks/alert-sdk
RUN npm install

COPY apps/alert-hub/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app/apps/alert-hub
ENV NODE_ENV=production

COPY --from=build /app/apps/alert-hub/package.json ./package.json
COPY --from=build /app/apps/alert-hub/node_modules ./node_modules
COPY --from=build /app/apps/alert-hub/dist ./dist
COPY --from=build /app/sdks/alert-sdk/package.json /app/sdks/alert-sdk/package.json
COPY --from=build /app/sdks/alert-sdk/dist /app/sdks/alert-sdk/dist

EXPOSE 18280
CMD ["node", "--enable-source-maps", "dist/index.js"]
