"""
HRMS AI Face Service v9.2 — YuNet Detection + SFace Recognition
Models bundled — no download needed
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI", version="9.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YUNET_PATH = os.path.join(BASE_DIR, "yunet.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "sface.onnx")

detector = None
recognizer = None
load_error = ""

@app.on_event("startup")
async def startup():
    global detector, recognizer, load_error
    logger.info(f"OpenCV version: {cv2.__version__}")
    logger.info(f"YuNet path: {YUNET_PATH} (exists: {os.path.exists(YUNET_PATH)}, size: {os.path.getsize(YUNET_PATH) if os.path.exists(YUNET_PATH) else 0})")
    logger.info(f"SFace path: {SFACE_PATH} (exists: {os.path.exists(SFACE_PATH)}, size: {os.path.getsize(SFACE_PATH) if os.path.exists(SFACE_PATH) else 0})")
    
    try:
        detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.9, 0.3, 5000)
        logger.info("✅ YuNet detector created")
    except Exception as e:
        load_error += f"YuNet: {e}. "
        logger.error(f"❌ YuNet failed: {e}")
    
    try:
        recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
        logger.info("✅ SFace recognizer created")
    except Exception as e:
        load_error += f"SFace: {e}. "
        logger.error(f"❌ SFace failed: {e}")
    
    if not load_error:
        logger.info("✅ All models loaded!")
    else:
        logger.error(f"❌ Errors: {load_error}")

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
    if detector is None or recognizer is None:
        return None, 0, None
    h, w = img.shape[:2]
    if h < 30 or w < 30:
        return None, 0, None
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return None, 0, None
    best = max(faces, key=lambda f: f[14])
    conf = float(best[14])
    landmarks = best[4:14].reshape((5, 2))
    aligned = recognizer.alignCrop(img, landmarks)
    embedding = recognizer.feature(aligned)
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    box = [int(best[0]), int(best[1]), int(best[2]), int(best[3])]
    return box, conf, embedding.flatten().astype(np.float32)

class MatchReq(BaseModel):
    known: List[List[float]]
    target: List[float]
    threshold: float = 0.5

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
            return ok({"success": False, "message": f"Face model not loaded: {load_error}"}, 500)
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
        sims = np.dot(known, target) / (np.linalg.norm(known, axis=1) * np.linalg.norm(target) + 1e-8)
        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])
        return ok({"matched": best_sim >= req.threshold, "index": best_idx, "similarity": round(best_sim, 4)})
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"matched": False, "message": str(e)}, 500)

@app.get("/health")
def health():
    return ok({
        "ok": detector is not None and recognizer is not None,
        "model": "yunet+sface",
        "detector_loaded": detector is not None,
        "recognizer_loaded": recognizer is not None,
        "error": load_error,
        "opencv": cv2.__version__,
    })

@app.get("/")
def root():
    return ok({"service": "HRMS AI v9.2", "detector": detector is not None, "recognizer": recognizer is not None, "error": load_error})

@app.post("/detect")
async def detect_endpoint(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return ok({"count": 0, "message": "Invalid image"})
        if detector is None:
            return ok({"count": 0, "message": "Detector not loaded"})
        h, w = img.shape[:2]
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
        if faces is None:
            return ok({"count": 0})
        return ok({"count": len(faces), "locations": [[int(f[0]), int(f[1]), int(f[2]), int(f[3])] for f in faces], "confidences": [round(float(f[14]), 3) for f in faces]})
    except Exception as e:
        return ok({"count": 0, "message": str(e)}, 500)
