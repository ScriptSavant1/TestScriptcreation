# ─── Build stage ────────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy only what npm needs to install production deps
COPY package.json package-lock.json ./

# Install production dependencies only (no devDependencies)
RUN npm ci --omit=dev

# ─── Runtime stage ───────────────────────────────────────────────────────────────
FROM node:18-alpine

LABEL maintainer="Your Organization" \
      version="2.1.1" \
      description="Bruno/Postman to LoadRunner DevWeb script converter"

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy only the application source — no examples, no prompts, no docs
COPY package.json ./
COPY src/ ./src/

# Make the CLI globally accessible via symlink (works on Linux/Alpine)
RUN ln -s /app/src/cli.js /usr/local/bin/bruno-devweb && \
    chmod +x /app/src/cli.js

# Default working directory for user-mounted collections
WORKDIR /workspace

ENTRYPOINT ["bruno-devweb"]
CMD ["--help"]
