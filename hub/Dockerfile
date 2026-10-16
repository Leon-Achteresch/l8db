FROM oven/bun:1.3.10-alpine
WORKDIR /app
COPY server.ts .
ENV L8DB_HUB_CONNECTIONS_FILE=/config/connections.json PORT=8080
USER bun
EXPOSE 8080
CMD ["bun", "server.ts"]
