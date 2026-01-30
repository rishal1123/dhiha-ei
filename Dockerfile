# Thaasbai - Maldivian Card Games
# Docker container optimized for ~1000 concurrent players

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=5002

# Server optimization settings (can be overridden)
ENV MAX_CONNECTIONS_PER_IP=10
ENV CONNECTION_RATE_LIMIT=5
ENV ADMIN_PASSWORD=thaasbai2024

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Expose port
EXPOSE 5002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5002/')" || exit 1

# Run the server with eventlet
CMD ["python", "server.py"]
