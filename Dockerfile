# ── Build stage ──
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Production stage ──
FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -g 1001 -S garagepulse && \
    adduser -S garagepulse -u 1001

WORKDIR /app

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Remove dev files that shouldn't be in production
RUN rm -rf .git .env .gitignore logs/*.log

# Create logs directory with proper permissions
RUN mkdir -p logs uploads && chown -R garagepulse:garagepulse /app

USER garagepulse

# Expose the port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start the application
CMD ["node", "server.js"]
