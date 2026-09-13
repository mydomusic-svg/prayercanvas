FROM node:22-bookworm-slim

# ffmpeg for rendering, fontconfig + DejaVu for burned-in captions.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# index.js imports ./voice-effects.js at startup — if this COPY is missing
# the container builds cleanly and then dies on its first line with
# ERR_MODULE_NOT_FOUND. Add any future worker module here too.
COPY index.js voice-effects.js ./
COPY fonts ./fonts
COPY brand ./brand

CMD ["node", "index.js"]
