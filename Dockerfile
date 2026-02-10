FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create data and logs directories
RUN mkdir -p logs

# Default environment
ENV NODE_ENV=production
ENV DATABASE_PATH=./data.db

EXPOSE 3000

CMD ["node", "index.js"]
