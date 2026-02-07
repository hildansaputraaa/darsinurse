FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create tmp directory for logging
RUN mkdir -p tmp/summary

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD test -f health.txt && [ $(( $(date +%s) - $(grep -oE '[0-9]+' health.txt | head -1) )) -lt 120 ] || exit 1

# Start the application
CMD ["node", "index.js"]
