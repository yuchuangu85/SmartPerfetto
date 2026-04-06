# ============================
# Stage 1: Build backend
# ============================
FROM node:22-bookworm AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ============================
# Stage 2: Build Perfetto UI (with AI Assistant plugin)
# ============================
FROM node:22-bookworm AS frontend-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/perfetto
COPY perfetto/ ./

# Install UI deps using Perfetto's bundled pnpm
RUN tools/install-build-deps --ui

# Build frontend
RUN tools/node ui/build.js

# ============================
# Stage 3: Download trace_processor_shell
# ============================
FROM debian:bookworm-slim AS tp-downloader

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Download pre-built trace_processor for the target platform
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
      TP_URL="https://get.perfetto.dev/trace_processor"; \
    elif [ "$ARCH" = "aarch64" ]; then \
      TP_URL="https://get.perfetto.dev/trace_processor"; \
    else \
      echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    curl -Lo /tmp/trace_processor_shell "$TP_URL" && \
    chmod +x /tmp/trace_processor_shell

# ============================
# Stage 4: Runtime
# ============================
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy trace_processor_shell
COPY --from=tp-downloader /tmp/trace_processor_shell /app/perfetto/out/ui/trace_processor_shell

# Copy backend (built + node_modules)
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/

# Copy backend runtime files (skills, strategies, templates)
COPY backend/skills ./backend/skills
COPY backend/strategies ./backend/strategies

# Copy frontend build output
COPY --from=frontend-builder /app/perfetto/out/ui/ui ./perfetto/out/ui/ui
COPY --from=frontend-builder /app/perfetto/ui/run-dev-server ./perfetto/ui/run-dev-server
COPY --from=frontend-builder /app/perfetto/tools/node ./perfetto/tools/node

# Create required directories
RUN mkdir -p backend/uploads backend/logs/sessions backend/data

# Environment defaults
ENV PORT=3000
ENV NODE_ENV=production
ENV FRONTEND_URL=http://localhost:10000

EXPOSE 3000 10000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start both services
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
