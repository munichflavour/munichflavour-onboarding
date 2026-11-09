# Kartengenerator als eigener Dienst (Railway: Service mit Root Directory tools/cocktailkarte).
# Erreichbar nur im privaten Netz des Projekts, das Portal reicht Anfragen mit Admin-Login weiter.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV KARTEN_WEB=1 \
    KARTEN_HOST=:: \
    KARTEN_PORT=8765 \
    PYTHONUNBUFFERED=1 \
    DATEN_ORDNER=/data
EXPOSE 8765
CMD ["python", "app.py"]
