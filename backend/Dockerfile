FROM python:3.12-slim

# ffmpeg for all media ops + fontconfig for caption fonts
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig curl \
    && rm -rf /var/lib/apt/lists/*

# Display fonts for caption styles (burned into exports via libass).
# Tolerant: a single failed download must not abort the image build.
RUN mkdir -p /usr/share/fonts/truetype/maxfly && cd /usr/share/fonts/truetype/maxfly \
    && curl -fsSL -o Anton-Regular.ttf     "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" || true \
    && curl -fsSL -o BebasNeue-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf" || true \
    && curl -fsSL -o Pacifico-Regular.ttf  "https://github.com/google/fonts/raw/main/ofl/pacifico/Pacifico-Regular.ttf" || true \
    && curl -fsSL -o Poppins-Bold.ttf      "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf" || true \
    && curl -fsSL -o Montserrat.ttf        "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" || true \
    && fc-cache -f || true

WORKDIR /app
COPY requirements.txt requirements-postgres.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-postgres.txt

COPY . .

ENV PORT=8000
EXPOSE 8000
# Render/Railway inject $PORT; bind to it
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
