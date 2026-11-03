FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ARG LIBRARY_DATA_REVISION=4453ed941ecf2fab58d2edae4a0c49e03ff7551c
RUN git clone https://github.com/zoulouti-cell/Qalam-Library-data.git /tmp/qalam-library-data \
    && cd /tmp/qalam-library-data && git checkout "${LIBRARY_DATA_REVISION}" && git lfs pull \
    && mkdir -p /app/data \
    && cp /tmp/qalam-library-data/library.sqlite /app/data/library.sqlite \
    && cd /app && npm install --omit=dev \
    && rm -rf /tmp/qalam-library-data
ENV HOST=0.0.0.0
EXPOSE 10000
CMD ["npm","start"]
