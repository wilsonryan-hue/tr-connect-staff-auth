# Treun Roc Connect — portable staff-auth (Node 20+)
# Deploy behind TLS; mount users.json out of band; never bake secrets into the image.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
COPY package.json ./
# No npm deps today — pure node:http / node:crypto. Keep COPY for future lockfile.
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY users.json.example ./users.json.example
RUN mkdir -p /var/data && chown node:node /var/data
ENV DATA_DIR=/var/data
# users.json must be mounted/copied at runtime (gitignored)
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1
USER node
CMD ["node", "src/server.js"]
