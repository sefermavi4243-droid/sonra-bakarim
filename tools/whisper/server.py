"""Yerel sesi yazıya dökme sunucusu (faster-whisper).

OpenAI uyumlu `POST /v1/audio/transcriptions` ucunu sunar; uygulama
`TRANSCRIBE_BASE_URL=http://127.0.0.1:8000/v1` ile bağlanır. Yalnızca
127.0.0.1'i dinler. Model ilk açılışta Hugging Face'ten bir kez indirilir.

Ortam değişkenleri:
  WHISPER_MODEL   tiny | base | small (varsayılan) | medium | large-v3-turbo
  WHISPER_PORT    varsayılan 8000
"""

import json
import os
import tempfile
import threading
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import av
import numpy as np
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
PORT = int(os.environ.get("WHISPER_PORT", "8000"))
MAX_BYTES = 25 * 1024 * 1024

print(f"whisper: '{MODEL_NAME}' modeli yükleniyor…", flush=True)
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
lock = threading.Lock()
print(f"whisper: hazır, http://127.0.0.1:{PORT}/v1", flush=True)


def decode_audio(path: str) -> np.ndarray:
    """Sesi 16 kHz tek kanal float32'ye çevirir (ogg/opus, mp3, m4a, amr…).

    faster-whisper'ın kendi çözücüsü güncel PyAV sürümleriyle uyumsuz; bu yüzden
    çözme burada yapılır ve modele hazır dizi verilir.
    """
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    with av.open(path, mode="r") as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def parse_multipart(content_type: str, body: bytes) -> dict:
    """multipart/form-data gövdesini {alan: (dosya_adı, bayt)} sözlüğüne çevirir."""
    msg = BytesParser(policy=HTTP).parsebytes(
        b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body
    )
    fields = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            fields[name] = (part.get_filename(), part.get_payload(decode=True) or b"")
    return fields


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/health", "/v1/health"):
            self._json(200, {"ok": True, "model": MODEL_NAME})
        else:
            self._json(404, {"error": "bulunamadı"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/audio/transcriptions":
            self._json(404, {"error": "bulunamadı"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BYTES:
            self._json(413, {"error": "dosya boyutu geçersiz"})
            return
        fields = parse_multipart(self.headers.get("Content-Type", ""), self.rfile.read(length))
        if "file" not in fields:
            self._json(400, {"error": "file alanı yok"})
            return
        filename, audio = fields["file"]
        language = (fields.get("language", (None, b"tr"))[1] or b"tr").decode()
        suffix = os.path.splitext(filename or "")[1] or ".ogg"
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(audio)
            samples = decode_audio(path)
            with lock:
                segments, _ = model.transcribe(samples, language=language, beam_size=5)
                text = " ".join(s.text.strip() for s in segments).strip()
            self._json(200, {"text": text})
        except Exception as err:  # bozuk ses dosyası vb.
            self._json(500, {"error": str(err)})
        finally:
            os.remove(path)

    def log_message(self, fmt: str, *args) -> None:  # istek başına günlük basma
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
