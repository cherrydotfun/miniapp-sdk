# ---- Stage 1: Build SDK ----
FROM node:20-alpine AS sdk-build

WORKDIR /sdk
COPY package.json tsconfig.json tsup.config.ts ./
COPY src/ ./src/
RUN npm install --legacy-peer-deps && npm run build

# ---- Stage 2: Build frontend ----
FROM node:20-alpine AS frontend-build

WORKDIR /app

# Copy example source
COPY example/package.json example/tsconfig.json example/vite.config.ts ./
COPY example/src/ ./src/
COPY example/index.html ./

# Install deps without the SDK link, add jose (SDK runtime dep)
RUN sed -i '/"@cherrydotfun\/miniapp-sdk"/d' package.json && \
    npm install --legacy-peer-deps && \
    npm install jose

# Copy full SDK package into node_modules (dist + package.json with exports)
COPY --from=sdk-build /sdk/dist/ ./node_modules/@cherrydotfun/miniapp-sdk/dist/
COPY --from=sdk-build /sdk/package.json ./node_modules/@cherrydotfun/miniapp-sdk/package.json

RUN npm run build

# ---- Stage 3: Runtime ----
FROM node:20-alpine

RUN apk add --no-cache nginx supervisor

# Nginx
COPY example/nginx.conf /etc/nginx/http.d/default.conf

# Frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Backend (uses jose directly, no SDK dependency at runtime)
WORKDIR /app
RUN echo '{"type":"module","dependencies":{"jose":"^5.0.0","tsx":"^4.0.0"}}' > package.json && \
    npm install
COPY example/server.ts ./server.ts

# Supervisor
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/dev/stdout\nlogfile_maxbytes=0\n\n[program:nginx]\ncommand=nginx -g "daemon off;"\nautorestart=true\nstdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\nstderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n\n[program:backend]\ncommand=npx tsx server.ts\nautorestart=true\nstdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\nstderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n' > /etc/supervisord.conf

ENV PORT=3456
ENV APP_ID=example-app
ENV JWKS_URL=https://chat.cherry.fun/.well-known/jwks.json

EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
