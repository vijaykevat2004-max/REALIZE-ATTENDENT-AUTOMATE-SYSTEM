"""
HRMS AI Face Service v9 — YuNet Detection + SFace Recognition
Lightweight (< 300MB RAM), accurate face recognition
"""
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List
import cv2
import numpy as np
import os
import logging
import traceback
import urllib.request

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI", version="9.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL_DIR = "/tmp/hrms_models"
YUNET_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2022mar.onnx")
SFACE_PATH = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")

detector = None
recognizer = None

@app.on_event("startup")
async def startup():
    global detector, recognizer
    os.makedirs(MODEL_DIR, exist_ok=True)
    urls = [
        ("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2022mar.onnx", YUNET_PATH),
        ("https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx", SFACE_PATH),
    ]
    for url, path in urls:
        if not os.path.exists(path):
            logger.info(f"Downloading {os.path.basename(path)}...")
            try:
                urllib.request.urlretrieve(url, path)
                logger.info(f"Downloaded {os.path.getsize(path)} bytes")
            except Exception as e:
                logger.error(f"Download failed: {e}")
    try:
        detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.9, 0.3, 5000)
        logger.info("✅ YuNet detector loaded")
    except Exception as e:
        logger.error(f"❌ YuNet load failed: {e}")
    try:
        recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
        logger.info("✅ SFace recognizer loaded")
    except Exception as e:
        logger.error(f"❌ SFace load failed: {e}")

def py(val):
    if isinstance(val, np.ndarray): return val.tolist()
    if isinstance(val, (np.bool_,)): return bool(val)
    if isinstance(val, np.integer): return int(val)
    if isinstance(val, np.floating): return float(val)
    if isinstance(val, dict): return {k: py(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)): return [py(v) for v in val]
    return val

def ok(data, status=200):
    return JSONResponse(status_code=status, content=py(data))

def load_img(data: bytes):
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)

def detect_and_encode(img):
    """Detect face with YuNet + extract 128-d embedding with SFace."""
    if detector is None or recognizer is None:
        return None, 0, None
    h, w = img.shape[:2]
    if h < 30 or w < 30:
        return None, 0, None
    # Set detector input size
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return None, 0, None
    # Pick highest confidence face
    best = faces[0]
    for f in faces:
        if f[14] > best[14]:
            best = f
    conf = float(best[14])
    # Extract landmarks for alignment
    landmarks = best[4:14].reshape((5, 2))
    # Align and extract embedding
    aligned = recognizer.alignCrop(img, landmarks)
    embedding = recognizer.feature(aligned)
    # Normalize
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    box = [int(best[0]), int(best[1]), int(best[2]), int(best[3])]
    return box, conf, embedding.flatten().astype(np.float32)

class MatchReq(BaseModel):
    known: List[List[float]]
    target: List[float]
    threshold: float = 0.36

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    try:
        raw = await image.read()
        if not raw:
            return ok({"success": False, "message": "Empty image"}, 400)
        img = load_img(raw)
        if img is None:
            return ok({"success": False, "message": "Invalid image"}, 400)
        if detector is None or recognizer is None:
            return ok({"success": False, "message": "Face model not loaded"}, 500)
        box, conf, embedding = detect_and_encode(img)
        if box is None:
            return ok({"success": False, "message": "No face detected. Look directly at camera."})
        return ok({
            "success": True,
            "encodings": [embedding.tolist()],
            "locations": [box],
            "confidence": round(conf, 3),
            "embedding_dim": 128,
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.post("/match")
def match(req: MatchReq):
    try:
        known = np.array(req.known, dtype=np.float32)
        target = np.array(req.target, dtype=np.float32)
        if known.shape[1] != target.shape[0]:
            return ok({"matched": False, "message": f"Dim mismatch: known={known.shape[1]} target={target.shape[0]}"})
        # Cosine similarity (SFace standard)
        sims = np.dot(known, target) / (np.linalg.norm(known, axis=1) * np.linalg.norm(target) + 1e-8)
        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])
        return ok({
            "matched": best_sim >= req.threshold,
            "index": best_idx,
            "similarity": round(best_sim, 4),
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"matched": False, "message": str(e)}, 500)

@app.get("/health")
def health():
    return ok({"ok": True, "model": "yunet+sface", "loaded": detector is not None and recognizer is not None})

@app.get("/")
def root():
    return ok({"service": "HRMS AI v9 — YuNet+SFace", "loaded": detector is not None and recognizer is not None})

@app.post("/detect")
async def detect_endpoint(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return ok({"count": 0, "message": "Invalid image"})
        if detector is None:
            return ok({"count": 0, "message": "Model not loaded"})
        h, w = img.shape[:2]
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
        if faces is None:
            return ok({"count": 0})
        return ok({
            "count": len(faces),
            "locations": [[int(f[0]), int(f[1]), int(f[2]), int(f[3])] for f in faces],
            "confidences": [round(float(f[14]), 3) for f in faces],
        })
    except Exception as e:
        return ok({"count": 0, "message": str(e)}, 500)
