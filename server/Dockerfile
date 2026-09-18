# 作业同步服务端(Node ≥22.5,使用内置 node:sqlite)
FROM node:22-slim

WORKDIR /app

# 仅 3 个纯 JS 依赖,安装快且无原生编译
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8787
# 数据目录持久化:挂载卷到 /app/data
VOLUME ["/app/data"]

EXPOSE 8787

CMD ["node", "src/index.js"]
