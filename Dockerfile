# Munich Flavour Portal inkl. Kartengenerator (Python) fuer Railway.
FROM node:20-bookworm-slim

# Python fuer den Kartengenerator (tools/cocktailkarte), in eigener virtueller Umgebung
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv
COPY tools/cocktailkarte/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
CMD ["node", "server.js"]
