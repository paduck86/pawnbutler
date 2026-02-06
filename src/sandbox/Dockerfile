FROM node:22-alpine

# Install minimal tools - NO network tools (no curl, wget, nc, etc.)
RUN apk add --no-cache \
    bash \
    python3 \
    && rm -rf /var/cache/apk/*

# Remove any pre-installed network tools
RUN rm -f /usr/bin/wget 2>/dev/null; \
    rm -f /usr/bin/curl 2>/dev/null; \
    rm -f /usr/bin/nc 2>/dev/null; \
    rm -f /usr/bin/ncat 2>/dev/null; \
    true

# Create non-root user for safety
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

CMD ["/bin/sh"]
