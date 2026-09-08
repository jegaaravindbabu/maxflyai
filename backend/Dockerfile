FROM python:3.12-slim

# ffmpeg for all media ops + fontconfig for caption fonts
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig curl fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Display fonts for caption styles (burned into exports via libass).
# Tolerant: a single failed download must not abort the image build.
RUN mkdir -p /usr/share/fonts/truetype/maxfly && cd /usr/share/fonts/truetype/maxfly \
    && curl -fsSL -o Anton-Regular.ttf     "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" || true \
    && curl -fsSL -o BebasNeue-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf" || true \
    && curl -fsSL -o Pacifico-Regular.ttf  "https://github.com/google/fonts/raw/main/ofl/pacifico/Pacifico-Regular.ttf" || true \
    && curl -fsSL -o Poppins-Bold.ttf      "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf" || true \
    && curl -fsSL -o Montserrat.ttf        "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" || true \
    && curl -fsSL -o Oswald.ttf            "https://github.com/google/fonts/raw/main/ofl/oswald/Oswald%5Bwght%5D.ttf" || true \
    && curl -fsSL -o Bangers-Regular.ttf   "https://github.com/google/fonts/raw/main/ofl/bangers/Bangers-Regular.ttf" || true \
    && curl -fsSL -o Fredoka.ttf           "https://github.com/google/fonts/raw/main/ofl/fredoka/Fredoka%5Bwght%5D.ttf" || true \
    && curl -fsSL -o LuckiestGuy.ttf       "https://github.com/google/fonts/raw/main/ofl/luckiestguy/LuckiestGuy-Regular.ttf" || true \
    && curl -fsSL -o PermanentMarker.ttf   "https://github.com/google/fonts/raw/main/ofl/permanentmarker/PermanentMarker-Regular.ttf" || true \
    && curl -fsSL -o Righteous.ttf         "https://github.com/google/fonts/raw/main/ofl/righteous/Righteous-Regular.ttf" || true \
    && curl -fsSL -o AlfaSlabOne.ttf       "https://github.com/google/fonts/raw/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf" || true \
    && curl -fsSL -o TitanOne.ttf          "https://github.com/google/fonts/raw/main/ofl/titanone/TitanOne-Regular.ttf" || true \
    && curl -fsSL -o Kanit-Bold.ttf        "https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Bold.ttf" || true \
    && curl -fsSL -o Kanit-Regular.ttf     "https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Regular.ttf" || true \
    && curl -fsSL -o ArchivoBlack.ttf      "https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf" || true \
    && curl -fsSL -o Caveat.ttf            "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf" || true \
    && curl -fsSL -o Lato-Regular.ttf      "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf" || true \
    && curl -fsSL -o Lato-Bold.ttf         "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Bold.ttf" || true \
    && curl -fsSL -o Rubik.ttf             "https://github.com/google/fonts/raw/main/ofl/rubik/Rubik%5Bwght%5D.ttf" || true \
    && curl -fsSL -o Teko.ttf              "https://github.com/google/fonts/raw/main/ofl/teko/Teko%5Bwght%5D.ttf" || true \
    && fc-cache -f || true

WORKDIR /app
COPY requirements.txt requirements-postgres.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-postgres.txt

COPY . .

ENV PORT=8000
EXPOSE 8000
# Render/Railway inject $PORT; bind to it
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
