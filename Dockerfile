# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG SERVE_DOCKER_REGISTRY

FROM ${SERVE_DOCKER_REGISTRY}/mr-yum/base-images-build-22:v2 AS node-dev-deps
WORKDIR /workdir

# install all npm dependencies for development
# the cache will be invalidated whenever these package*.json files have changed
COPY --link package-lock.json package.json ./
RUN \
  --mount=type=cache,target=/root/.npm \
  --mount=type=secret,id=npmrc,dst=/root/.npmrc \
  npm ci

FROM ${SERVE_DOCKER_REGISTRY}/mr-yum/base-images-build-22:v2 AS dev
WORKDIR /workdir

# copy in all npm dependencies for development
COPY --link --from=node-dev-deps /workdir/node_modules node_modules


FROM ${SERVE_DOCKER_REGISTRY}/mr-yum/base-images-build-22:v2 AS node-prod-deps
WORKDIR /workdir

# install minimal npm dependencies for production
# the cache will be invalidated whenever these package*.json files have changed
COPY --link package-lock.json package.json ./
RUN \
  --mount=type=cache,target=/root/.npm \
  --mount=type=secret,id=npmrc,dst=/root/.npmrc \
  npm ci --omit=dev

FROM dev AS build
WORKDIR /workdir

# copy in the minimal files to build the app code
COPY --link package.json tsconfig.json ./
COPY --link src ./src

# build the app code
RUN npm run build:js

FROM ${SERVE_DOCKER_REGISTRY}/mr-yum/base-images-run-22:v2 AS service
WORKDIR /workdir

# copy in the minimal npm dependencies for production
COPY --link --chown=1000:1000 --from=node-prod-deps /workdir/node_modules ./node_modules

# copy in the compiled app code
COPY --link --chown=1000:1000 --from=build /workdir/dist ./dist

# copy in other files necessary for the app to run
COPY --link --chown=1000:1000 package.json ./

# setup env vars
ENV NODE_ENV=production

# enable source maps
# these come at a performance cost and since we're no longer bundling, the difference between
# the source code and compiled code will be minimal, especially for a recent node version, so
# you might not need to enable them
# ENV NODE_OPTIONS=--enable-source-maps

ENV PORT=3000
EXPOSE 3000
USER 1000:1000
