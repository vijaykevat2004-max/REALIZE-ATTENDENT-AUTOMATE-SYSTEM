"""
HRMS AI Face Service v9 — YuNet Detection + SFace Recognition
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
import ssl

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI", version="9.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL_DIR = "/tmp/hrms_models"
YUNET_PATH = os.path.join(MODEL_DIR, "yunet.onnx")
SFACE_PATH = os.path.join(MODEL_DIR, "sface.onnx")

detector = None
recognizer = None
load_error = ""

def download(url, path):
    """Download with SSL context and retries."""
    if os.path.exists(path) and os.path.getsize(path) > 100000:
        return True
    os.makedirs(MODEL_DIR, exist_ok=True)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    for attempt in range(3):
        try:
            logger.info(f"Download attempt {attempt+1}: {url}")
            urllib.request.urlretrieve(url, path, context=ctx)
            size = os.path.getsize(path)
            logger.info(f"Downloaded {size} bytes to {path}")
            if size > 100000:
                return True
        except Exception as e:
            logger.error(f"Download attempt {attempt+1} failed: {e}")
    return False

@app.on_event("startup")
async def startup():
    global detector, recognizer, load_error
    os.makedirs(MODEL_DIR, exist_ok=True)
    logger.info(f"OpenCV version: {cv2.__version__}")
    logger.info(f"MODEL_DIR: {MODEL_DIR}")
    
    # Download models
    yunet_urls = [
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2022mar.onnx",
    ]
    sface_urls = [
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    ]
    
    yunet_ok = False
    for url in yunet_urls:
        if download(url, YUNET_PATH):
            yunet_ok = True
            break
    
    sface_ok = False
    for url in sface_urls:
        if download(url, SFACE_PATH):
            sface_ok = True
            break
    
    # Create detector
    try:
        if yunet_ok and os.path.exists(YUNET_PATH):
            detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.9, 0.3, 5000)
            logger.info("✅ YuNet detector created")
        else:
            load_error += "YuNet download failed. "
            logger.error("❌ YuNet not available")
    except Exception as e:
        load_error += f"YuNet create failed: {e}. "
        logger.error(f"❌ YuNet create failed: {e}")
    
    # Create recognizer
    try:
        if sface_ok and os.path.exists(SFACE_PATH):
            recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
            logger.info("✅ SFace recognizer created")
        else:
            load_error += "SFace download failed. "
            logger.error("❌ SFace not available")
    except Exception as e:
        load_error += f"SFace create failed: {e}. "
        logger.error(f"❌ SFace create failed: {e}")
    
    if not load_error:
        logger.info("✅ All models loaded successfully!")
    else:
        logger.error(f"❌ Load errors: {load_error}")

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
    return ok({"service": "HRMS AI v9.1", "detector": detector is not None, "recognizer": recognizer is not None, "error": load_error})

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
