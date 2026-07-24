# LRE Toolkit — Docker Deployment Guide

**Version:** 2.9.2 | **Date:** May 2026

> **Note:** IIS + iisnode is the primary and recommended deployment method for the bank's Windows Server environment. Docker is an alternative for teams that prefer containerized deployments or use Linux-based infrastructure.

---

## Dockerfile

Create a `Dockerfile` at the project root:

```dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Remove development-only files
RUN rm -rf src/__tests__ .git .gitignore

# Non-root user for security
RUN addgroup -S lretoolkit && adduser -S lretoolkit -G lretoolkit
USER lretoolkit

# Expose port
EXPOSE 3000

# Start
CMD ["node", "src/web/server.js"]
```

---

## .dockerignore

Create `.dockerignore` at the project root:

```
node_modules
.git
.gitignore
src/__tests__
*.test.js
iisnode
web.config
Docs
```

---

## Build and Run

```bash
# Build the image
docker build -t lre-toolkit:2.9.2 .
docker tag lre-toolkit:2.9.2 lre-toolkit:latest

# Run (development / local test)
docker run -p 3000:3000 --name lre-toolkit lre-toolkit:latest

# Run in background
docker run -d -p 3000:3000 --name lre-toolkit \
  -e NODE_ENV=production \
  lre-toolkit:latest

# Check logs
docker logs lre-toolkit

# Stop
docker stop lre-toolkit
```

Navigate to `http://localhost:3000/converter` to verify.

---

## Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  lre-toolkit:
    image: lre-toolkit:latest
    build: .
    container_name: lre-toolkit
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/converter"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

---

## With Reverse Proxy (Nginx + HTTPS)

For HTTPS termination in a containerized environment:

```yaml
# docker-compose.yml with nginx
version: '3.8'

services:
  lre-toolkit:
    image: lre-toolkit:latest
    container_name: lre-toolkit
    restart: unless-stopped
    expose:
      - "3000"
    environment:
      - NODE_ENV=production

  nginx:
    image: nginx:alpine
    container_name: lre-nginx
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /path/to/ssl/certs:/etc/ssl/certs:ro
    depends_on:
      - lre-toolkit
```

```nginx
# nginx.conf
events {}
http {
    server {
        listen 80;
        return 301 https://$host$request_uri;
    }
    server {
        listen 443 ssl;
        ssl_certificate     /etc/ssl/certs/lre-toolkit.crt;
        ssl_certificate_key /etc/ssl/certs/lre-toolkit.key;
        ssl_protocols       TLSv1.2 TLSv1.3;

        client_max_body_size 100m;

        location / {
            proxy_pass         http://lre-toolkit:3000;
            proxy_http_version 1.1;
            proxy_set_header   Upgrade $http_upgrade;
            proxy_set_header   Connection 'upgrade';
            proxy_set_header   Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 300s;
            proxy_send_timeout 300s;
        }
    }
}
```

---

## Kubernetes (Optional)

For enterprise container orchestration:

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lre-toolkit
  namespace: perf-tools
spec:
  replicas: 2
  selector:
    matchLabels:
      app: lre-toolkit
  template:
    metadata:
      labels:
        app: lre-toolkit
    spec:
      containers:
      - name: lre-toolkit
        image: lre-toolkit:2.9.2
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        readinessProbe:
          httpGet:
            path: /converter
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: lre-toolkit
  namespace: perf-tools
spec:
  selector:
    app: lre-toolkit
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

---

## Container Security Notes

| Concern | Implementation |
|---|---|
| Non-root process | `USER lretoolkit` in Dockerfile |
| Read-only filesystem | All processing in-memory; no writes needed |
| No secrets in image | No credentials baked in |
| Minimal base image | `node:18-alpine` — ~50MB |

The application makes no outbound network calls, so `--network none` (or equivalent network policy) is appropriate if your security policy requires it.

---

## Updating to a New Version

```bash
# Pull new code
git pull origin main

# Rebuild image
docker build -t lre-toolkit:2.9.3 .
docker tag lre-toolkit:2.9.3 lre-toolkit:latest

# Rolling update (zero downtime if using multiple replicas)
docker compose up -d --no-deps --build lre-toolkit
```

---

*See also: [IIS Deployment Guide](DEPLOYMENT-IIS.md) | [Configuration Reference](CONFIGURATION.md)*
