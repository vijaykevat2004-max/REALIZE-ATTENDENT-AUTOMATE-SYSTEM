"""
HRMS AI Face Service v8 — Lightweight OpenCV DNN + Aligned Multi-Feature Encoding
Works within 512MB RAM (Render free tier)
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

app = FastAPI(title="HRMS AI", version="8.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Models ──────────────────────────────────────────────────────────────

MODEL_DIR = "/tmp/hrms_models"
PROTO = os.path.join(MODEL_DIR, "deploy.prototxt")
CAFFE = os.path.join(MODEL_DIR, "res10_300x300_ssd_iter_140000.caffemodel")

dnn = None
eye_cascade = None

@app.on_event("startup")
async def startup():
    global dnn, eye_cascade
    os.makedirs(MODEL_DIR, exist_ok=True)
    urls = [
        ("https://raw.githubusercontent.com/opencv/opencv/4.x/samples/dnn/face_detector/deploy.prototxt", PROTO),
        ("https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20170830/res10_300x300_ssd_iter_140000.caffemodel", CAFFE),
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
        dnn = cv2.dnn.readNetFromCaffe(PROTO, CAFFE)
        logger.info("✅ DNN model loaded")
    except Exception as e:
        logger.error(f"❌ DNN load failed: {e}")
    try:
        eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
        logger.info("✅ Eye cascade loaded")
    except:
        pass

# ── Helpers ─────────────────────────────────────────────────────────────

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

# ── Detection ───────────────────────────────────────────────────────────

def detect_face(img):
    if dnn is None:
        return None, 0
    h, w = img.shape[:2]
    if h < 30 or w < 30:
        return None, 0
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0, (300, 300), [104, 117, 123])
    dnn.setInput(blob)
    out = dnn.forward()
    best = None
    best_conf = 0
    for i in range(out.shape[2]):
        conf = float(out[0, 0, i, 2])
        if conf < 0.4:
            continue
        box = out[0, 0, i, 3:7] * np.array([w, h, w, h])
        x1, y1, x2, y2 = box.astype("int")
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        fw, fh = x2 - x1, y2 - y1
        if fw < 40 or fh < 40:
            continue
        if conf > best_conf:
            best_conf = conf
            best = (x1, y1, fw, fh)
    return best, best_conf

# ── Alignment ───────────────────────────────────────────────────────────

def align_face(img, box):
    """Align face using eye positions for better encoding accuracy."""
    x, y, w, h = box
    face = img[y:y+h, x:x+w]
    if face.size == 0:
        return face, 0
    # Find eyes
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    eyes = eye_cascade.detectMultiScale(gray, 1.1, 5, minSize=(10, 10)) if eye_cascade else []
    if len(eyes) >= 2:
        # Use first two eyes for alignment
        left_eye = eyes[0]
        right_eye = eyes[1]
        # Sort by x position
        if left_eye[0] > right_eye[0]:
            left_eye, right_eye = right_eye, left_eye
        left_center = (left_eye[0] + left_eye[2] // 2, left_eye[1] + left_eye[3] // 2)
        right_center = (right_eye[0] + right_eye[2] // 2, right_eye[1] + right_eye[3] // 2)
        # Calculate angle
        dY = right_center[1] - left_center[1]
        dX = right_center[0] - left_center[0]
        angle = np.degrees(np.arctan2(dY, dX))
        # Rotate
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        aligned = cv2.warpAffine(face, M, (w, h), flags=cv2.INTER_CUBIC)
        return aligned, abs(angle)
    return face, 0

# ── Encoding ────────────────────────────────────────────────────────────

def extract_features(img, box):
    """Extract multi-scale features from aligned face."""
    aligned, angle = align_face(img, box)
    if aligned.size == 0:
        return np.zeros(512, dtype=np.float32), angle
    # Resize to standard size
    aligned = cv2.resize(aligned, (160, 160))
    # Convert to grayscale
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    # Histogram equalization for lighting invariance
    gray = cv2.equalizeHist(gray)
    # 1. HOG features (256 dims)
    hog = cv2.HOGDescriptor((160, 160), (16, 16), (8, 8), (8, 8), 9)
    hog_feats = hog.compute(gray)
    hog_feats = hog_feats.flatten()
    # 2. LBP features (256 dims)
    lbp = np.zeros(256, dtype=np.float32)
    for i in range(1, 159):
        for j in range(1, 159):
            c = float(gray[i, j])
            code = 0
            for di, dj in [(-1,-1),(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1),(0,-1)]:
                code = (code << 1) | (float(gray[i+di, j+dj]) > c)
            lbp[code] += 1
    lbp = lbp / (lbp.sum() + 1e-8)
    # 3. Gradient magnitude features (128 dims)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx**2 + gy**2)
    # Downsample to 16x8 = 128 features
    mag_small = cv2.resize(mag, (8, 16))
    mag_feats = mag_small.flatten()
    # Combine all features
    features = np.concatenate([hog_feats[:256], lbp, mag_feats])
    # Normalize
    norm = np.linalg.norm(features)
    if norm > 0:
        features = features / norm
    return features.astype(np.float32), angle

class MatchReq(BaseModel):
    known: List[List[float]]
    target: List[float]
    threshold: float = 0.4

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    try:
        raw = await image.read()
        if not raw:
            return ok({"success": False, "message": "Empty image"}, 400)
        img = load_img(raw)
        if img is None:
            return ok({"success": False, "message": "Invalid image"}, 400)
        if dnn is None:
            return ok({"success": False, "message": "Face model not loaded"}, 500)
        box, conf = detect_face(img)
        if box is None:
            return ok({"success": False, "message": "No face detected. Look directly at camera."})
        features, angle = extract_features(img, box)
        if np.all(features == 0):
            return ok({"success": False, "message": "Feature extraction failed"})
        return ok({
            "success": True,
            "encodings": [features.tolist()],
            "locations": [list(box)],
            "confidence": round(conf, 3),
            "alignment_angle": round(angle, 1),
            "embedding_dim": 640,
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
        # Cosine similarity
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
    return ok({"ok": True, "model": "opencv-dnn+hog+lbp", "loaded": dnn is not None})

@app.get("/")
def root():
    return ok({"service": "HRMS AI v8 — Lightweight", "loaded": dnn is not None})

@app.post("/detect")
async def detect_endpoint(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return ok({"count": 0, "message": "Invalid image"})
        if dnn is None:
            return ok({"count": 0, "message": "Model not loaded"})
        box, conf = detect_face(img)
        if box:
            return ok({"count": 1, "locations": [list(box)], "confidences": [round(conf, 3)]})
        return ok({"count": 0, "locations": [], "confidences": []})
    except Exception as e:
        return ok({"count": 0, "message": str(e)}, 500)
