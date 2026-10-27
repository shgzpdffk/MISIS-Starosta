FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /opt/misis-python && /opt/misis-python/bin/pip install --no-cache-dir -r requirements.txt
COPY package.json ./
COPY public ./public
COPY server ./server
COPY scripts ./scripts
RUN chmod 755 /app/scripts/docker-entrypoint.sh
ENV HOST=0.0.0.0 PORT=3000 PYTHON_BIN=/opt/misis-python/bin/python3 DATABASE_PATH=/data/misis/misis.sqlite
EXPOSE 3000
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
