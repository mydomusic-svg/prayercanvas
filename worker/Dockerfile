FROM node:22-bookworm-slim

# ffmpeg for rendering, fontconfig + DejaVu for burned-in captions.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./
COPY fonts ./fonts

CMD ["node", "index.js"]
