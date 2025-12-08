# ================================
# DARSINURSE GATEWAY - Dockerfile
# ================================
FROM node:18-alpine

# Buat direktori aplikasi
WORKDIR /app

# Copy file package*
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy seluruh project
COPY . .

# Expose port
EXPOSE 4000

# Jalankan server
CMD ["node", "server.js"]
