# Dockerfile — Bride of Flinkenstein producers
#
# Runs the selected producer based on PRODUCER_TYPE env var:
#   retail  → retail.orders, retail.returns, retail.products
#   fsi     → fsi.transactions, fsi.accounts
#   fraud   → fraud.alerts

FROM node:22-slim

WORKDIR /app

# Install dependencies first (leverages Docker layer cache when only source changes)
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy producer source
COPY . .

CMD ["node", "entrypoint.js"]
