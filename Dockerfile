# ── Build stage ──
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json ./

# Install full deps (including TypeScript) to compile
RUN npm ci

# Copy source and compile TS -> dist/
COPY . .
RUN npm run build

# ── Production stage ──
FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -g 1001 -S garagepulse && \
    adduser -S garagepulse -u 1001

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from the build stage
COPY --from=builder /app/dist ./dist

# Create logs directory with proper permissions
RUN mkdir -p logs uploads && chown -R garagepulse:garagepulse /app

USER garagepulse

# Expose the port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start the application
CMD ["node", "dist/server.js"]
