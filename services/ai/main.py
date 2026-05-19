"""
HRMS AI Face Service v6
Uses: OpenCV DNN (Caffe SSD) for face detection + HSV+LBP for encoding
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
import time

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI", version="6.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── helpers ────────────────────────────────────────────────────────────

def py(val):
    """Convert numpy → Python native for JSON safety."""
    if isinstance(val, np.ndarray): return val.tolist()
    if isinstance(val, (np.bool_,)): return bool(val)
    if isinstance(val, np.integer): return int(val)
    if isinstance(val, np.floating): return float(val)
    if isinstance(val, dict): return {k: py(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)): return [py(v) for v in val]
    return val

def ok(data, status=200):
    return JSONResponse(status_code=status, content=py(data))

# ── models ──────────────────────────────────────────────────────────────

MODEL_DIR = "/tmp/hrms_models"
PROTO = os.path.join(MODEL_DIR, "deploy.prototxt")
CAFFE = os.path.join(MODEL_DIR, "res10_300x300_ssd_iter_140000.caffemodel")

dnn = None  # type: cv2.dnn_Net

@app.on_event("startup")
async def startup():
    global dnn
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
        logger.info("DNN model loaded")
    except Exception as e:
        logger.error(f"DNN load failed: {e}")

# ── image ───────────────────────────────────────────────────────────────

def load_img(data: bytes):
    a = np.frombuffer(data, np.uint8)
    return cv2.imdecode(a, cv2.IMREAD_COLOR)

# ── detection ───────────────────────────────────────────────────────────

def detect(img):
    if dnn is None:
        return {"faces": [], "method": "no-model"}
    h, w = img.shape[:2]
    if h < 30 or w < 30:
        return {"faces": [], "method": "too-small"}
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0, (300, 300), [104, 117, 123])
    dnn.setInput(blob)
    out = dnn.forward()
    faces = []
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
        faces.append({"box": [x1, y1, fw, fh], "conf": round(conf, 3)})
    return {"faces": faces, "method": "dnn"}

def nms(faces, thresh=0.4):
    if len(faces) <= 1:
        return faces
    boxes = np.array([f["box"] for f in faces], dtype=np.float32)
    confs = np.array([f["conf"] for f in faces])
    idx = np.argsort(-confs)
    keep = []
    while len(idx) > 0:
        i = int(idx[0])
        keep.append(faces[i])
        if len(idx) == 1:
            break
        r = idx[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[r, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[r, 1])
        xx2 = np.minimum(boxes[i, 0] + boxes[i, 2], boxes[r, 0] + boxes[r, 2])
        yy2 = np.minimum(boxes[i, 1] + boxes[i, 3], boxes[r, 1] + boxes[r, 3])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        area_i = boxes[i, 2] * boxes[i, 3]
        area_r = boxes[r, 2] * boxes[r, 3]
        iou = inter / (area_i + area_r - inter + 1e-6)
        idx = r[iou < thresh]
    return keep

# ── quality ─────────────────────────────────────────────────────────────

def quality(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    b = float(cv2.Laplacian(g, cv2.CV_64F).var())
    br = float(np.mean(g))
    return {"blurry": b < 80, "blur_score": round(b, 2), "dark": br < 40, "brightness": round(br, 2),
            "good_quality": b >= 80 and 40 <= br <= 230}

# ── encoding ────────────────────────────────────────────────────────────

def embed(img, box):
    x, y, w, h = box
    face = img[y:y+h, x:x+w]
    if face.size == 0:
        return np.zeros(128, dtype=np.float32)
    face = cv2.resize(face, (160, 160))
    hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    g = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    lbp = np.zeros(256, dtype=np.float32)
    for i in range(1, g.shape[0] - 1):
        for j in range(1, g.shape[1] - 1):
            c = float(g[i, j])
            code = 0
            for di, dj in [(-1,-1),(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1),(0,-1)]:
                code = (code << 1) | (float(g[i+di, j+dj]) > c)
            lbp[code] += 1
    cv2.normalize(lbp, lbp)
    return np.concatenate([hist.flatten(), lbp]).astype(np.float32)

# ── pydantic ────────────────────────────────────────────────────────────

class MatchReq(BaseModel):
    known: List[List[float]]
    target: List[float]
    threshold: float = 0.7

# ── routes ──────────────────────────────────────────────────────────────

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    try:
        raw = await image.read()
        if not raw:
            return ok({"success": False, "message": "Empty image"}, 400)
        img = load_img(raw)
        if img is None:
            return ok({"success": False, "message": "Invalid image"}, 400)
        q = quality(img)
        det = detect(img)
        if not det["faces"]:
            return ok({"success": False, "message": "No face detected", "quality": q, "method": det["method"]})
        kept = nms(det["faces"])
        if not kept:
            return ok({"success": False, "message": "No face after NMS", "quality": q})
        best = max(kept, key=lambda f: f["conf"] * (f["box"][2] * f["box"][3]))
        emb = embed(img, best["box"])
        if np.all(emb == 0):
            return ok({"success": False, "message": "Embedding failed", "quality": q})
        return ok({"success": True, "encodings": [emb.tolist()], "locations": [best["box"]],
                    "confidence": best["conf"], "method": det["method"], "quality": q, "embedding_dim": len(emb)})
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.post("/match")
def match(req: MatchReq):
    try:
        known = np.array(req.known, dtype=np.float32)
        target = np.array(req.target, dtype=np.float32)
        if len(known) == 0 or len(target) == 0:
            return ok({"matched": False, "message": "Empty vectors"})
        if known.shape[1] != target.shape[0]:
            return ok({"matched": False, "message": f"Dim mismatch: known={known.shape[1]} target={target.shape[0]}"})
        dists = np.linalg.norm(known - target, axis=1)
        idx = int(np.argmin(dists))
        d = float(dists[idx])
        return ok({"matched": d <= req.threshold, "index": idx, "distance": round(d, 4),
                    "similarity": round(1 / (1 + d), 4)})
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"matched": False, "message": str(e)}, 500)

@app.get("/health")
def health():
    return ok({"ok": True, "dnn_loaded": dnn is not None, "status": "ready"})

@app.get("/")
def root():
    return ok({"service": "HRMS AI v6", "dnn": dnn is not None})

@app.post("/detect")
async def detect_endpoint(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return ok({"count": 0, "message": "Invalid image"})
        det = detect(img)
        kept = nms(det["faces"])
        return ok({"count": len(kept), "locations": [f["box"] for f in kept], "confidences": [f["conf"] for f in kept], "method": det["method"]})
    except Exception as e:
        return ok({"count": 0, "message": str(e)}, 500)
