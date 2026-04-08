# ---- Stage 1: Build SDK + frontend ----
FROM node:20-alpine AS build

WORKDIR /app

# Copy SDK source and build it
COPY package.json tsconfig.json tsup.config.ts ./sdk/
COPY src/ ./sdk/src/
WORKDIR /app/sdk
RUN npm install --legacy-peer-deps && npm run build

# Copy example and install with local SDK
WORKDIR /app/example
COPY example/package.json example/tsconfig.json example/vite.config.ts ./
COPY example/src/ ./src/
COPY example/index.html ./
RUN npm install --legacy-peer-deps && npm run build

# ---- Stage 2: Runtime (nginx + node backend) ----
FROM node:20-alpine

RUN apk add --no-cache nginx supervisor

# Nginx config
COPY example/nginx.conf /etc/nginx/http.d/default.conf
RUN rm -f /etc/nginx/http.d/default.conf.bak

# Frontend static files
COPY --from=build /app/example/dist /usr/share/nginx/html

# Backend: install only production deps
WORKDIR /app
COPY --from=build /app/sdk/dist ./sdk-dist/
COPY --from=build /app/sdk/package.json ./sdk/package.json
COPY --from=build /app/sdk/dist/ ./sdk/dist/

# Minimal package.json for the server
RUN echo '{"type":"module","dependencies":{"jose":"^5.0.0","tsx":"^4.0.0"}}' > package.json && \
    npm install

# Copy server source
COPY example/server.ts ./server.ts

# Point import to local built SDK
RUN mkdir -p node_modules/@cherrydotfun/miniapp-sdk && \
    cp -r sdk/dist/* node_modules/@cherrydotfun/miniapp-sdk/ && \
    cp sdk/package.json node_modules/@cherrydotfun/miniapp-sdk/

# Supervisor: run nginx + node backend together
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/dev/stdout\nlogfile_maxbytes=0\n\n[program:nginx]\ncommand=nginx -g "daemon off;"\nautorestart=true\nstdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\nstderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n\n[program:backend]\ncommand=npx tsx server.ts\nautorestart=true\nstdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\nstderr_logfile=/dev/stderr\nstderr_logfile_maxbytes=0\n' > /etc/supervisord.conf

ENV PORT=3456
ENV APP_ID=example-app
ENV JWKS_URL=https://chat.cherry.fun/.well-known/jwks.json

EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
