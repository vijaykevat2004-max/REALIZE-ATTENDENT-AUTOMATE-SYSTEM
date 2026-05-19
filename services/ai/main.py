from fastapi import FastAPI, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List
import cv2
import numpy as np
from io import BytesIO
from PIL import Image
import base64
import os
import logging
import traceback
import urllib.request
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI Face Service", version="6.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Numpy Safe Helpers ──────────────────────────────────────────────────

def _py(val):
    """Convert ANY numpy value to a native Python type recursively."""
    if isinstance(val, np.ndarray):
        return val.tolist()
    if isinstance(val, (np.bool_,)):
        return bool(val)
    if isinstance(val, np.integer):
        return int(val)
    if isinstance(val, np.floating):
        return float(val)
    if isinstance(val, dict):
        return {k: _py(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_py(v) for v in val]
    return val

def ok(data):
    """200 JSON with auto numpy→python conversion."""
    return JSONResponse(content=_py(data))

def err(status: int, detail: str):
    """Error JSON response."""
    return JSONResponse(status_code=status, content={"detail": detail})

# ── Models ──────────────────────────────────────────────────────────────

MODEL_DIR = "/tmp/hrms_ai_models"
PROTOTXT = os.path.join(MODEL_DIR, "deploy.prototxt")
CAFFEMODEL = os.path.join(MODEL_DIR, "res10_300x300_ssd_iter_140000.caffemodel")

dnn_net = None
haar_cascades = []

def _dl(url, dest):
    os.makedirs(MODEL_DIR, exist_ok=True)
    logger.info(f"Downloading {url}")
    urllib.request.urlretrieve(url, dest)
    logger.info(f"Downloaded {os.path.getsize(dest)} bytes to {dest}")

def _load_dnn():
    global dnn_net
    proto_url = "https://github.com/opencv/opencv/raw/4.x/samples/dnn/face_detector/deploy.prototxt"
    model_url = "https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20170830/res10_300x300_ssd_iter_140000.caffemodel"
    try:
        if not os.path.exists(PROTOTXT):
            _dl(proto_url, PROTOTXT)
        if not os.path.exists(CAFFEMODEL):
            _dl(model_url, CAFFEMODEL)
        dnn_net = cv2.dnn.readNetFromCaffe(PROTOTXT, CAFFEMODEL)
        logger.info("DNN face detector loaded OK")
    except Exception as e:
        logger.warning(f"DNN load failed: {e}")

def _load_haar():
    global haar_cascades
    paths = [
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
        cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml",
        cv2.data.haarcascades + "haarcascade_profileface.xml",
    ]
    for p in paths:
        try:
            c = cv2.CascadeClassifier(p)
            if not c.empty():
                haar_cascades.append(c)
                logger.info(f"Loaded: {os.path.basename(p)}")
        except Exception:
            pass
    logger.info(f"Haar cascades loaded: {len(haar_cascades)}")

@app.on_event("startup")
async def startup():
    _load_dnn()
    _load_haar()

# ── Image IO ────────────────────────────────────────────────────────────

def load_img(data: bytes):
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)

# ── Detection ───────────────────────────────────────────────────────────

def detect_dnn(img):
    if dnn_net is None:
        return []
    h, w = img.shape[:2]
    if h < 20 or w < 20:
        return []
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0, (300, 300), [104, 117, 123])
    dnn_net.setInput(blob)
    detections = dnn_net.forward()
    faces = []
    for i in range(detections.shape[2]):
        conf = float(detections[0, 0, i, 2])
        if conf < 0.5:
            continue
        box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
        x1, y1, x2, y2 = box.astype("int")
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 - x1 < 30 or y2 - y1 < 30:
            continue
        faces.append({"box": [x1, y1, x2 - x1, y2 - y1], "conf": round(conf, 3)})
    return faces

def detect_haar(img):
    if not haar_cascades:
        return []
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    seen = set()
    faces = []
    for cascade in haar_cascades:
        for src in [enhanced, gray]:
            try:
                rects = cascade.detectMultiScale(src, 1.1, 3, minSize=(60, 60))
                for (x, y, w, h) in rects:
                    key = (round(x / 10), round(y / 10), round(w / 10), round(h / 10))
                    if key not in seen:
                        seen.add(key)
                        faces.append({"box": [int(x), int(y), int(w), int(h)], "conf": 0.6})
            except Exception:
                pass
    return faces

def nms(faces, iou_thresh=0.4):
    if len(faces) <= 1:
        return faces
    boxes = np.array([f["box"] for f in faces], dtype=np.float32)
    confs = np.array([f["conf"] for f in faces], dtype=np.float32)
    idxs = np.argsort(-confs)
    keep = []
    while len(idxs) > 0:
        i = int(idxs[0])
        keep.append(i)
        if len(idxs) == 1:
            break
        rest = idxs[1:]
        # IoU
        x1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        y1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        x2 = np.minimum(boxes[i, 0] + boxes[i, 2], boxes[rest, 0] + boxes[rest, 2])
        y2 = np.minimum(boxes[i, 1] + boxes[i, 3], boxes[rest, 1] + boxes[rest, 3])
        inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
        area_i = boxes[i, 2] * boxes[i, 3]
        area_r = boxes[rest, 2] * boxes[rest, 3]
        iou = inter / (area_i + area_r - inter + 1e-6)
        idxs = rest[iou < iou_thresh]
    return [faces[i] for i in keep]

# ── Quality ─────────────────────────────────────────────────────────────

def qcheck(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    bright = float(np.mean(gray))
    return {
        "blurry": blur < 80,
        "blur_score": round(blur, 2),
        "dark": bright < 40,
        "brightness": round(bright, 2),
        "good_quality": blur >= 80 and 40 <= bright <= 230,
    }

def best_face(img, faces, quality):
    """Score each face and return the best one."""
    if not faces:
        return None
    scored = []
    for f in faces:
        x, y, w, h = f["box"]
        face_roi = img[y:y+h, x:x+w]
        if face_roi.size == 0:
            continue
        blur = float(cv2.Laplacian(cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        bright = float(np.mean(cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)))
        face_size_score = min(1.0, (w * h) / (200 * 200))
        center_x, center_y = x + w / 2, y + h / 2
        img_h, img_w = img.shape[:2]
        center_score = 1.0 - (abs(center_x / img_w - 0.5) * 2) * 0.3 - (abs(center_y / img_h - 0.5) * 2) * 0.3
        center_score = max(0, center_score)
        quality_score = 1.0 if (blur >= 80 and 40 <= bright <= 230) else 0.3
        total = f["conf"] * 2 + face_size_score * 3 + center_score * 2 + quality_score * 3
        scored.append((total, f))
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]

# ── Embedding ───────────────────────────────────────────────────────────

def embed(img, box):
    x, y, w, h = box
    face = img[y:y+h, x:x+w]
    if face.size == 0:
        return np.zeros(128, dtype=np.float32)
    face = cv2.resize(face, (160, 160))
    hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    gray_face = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    lbp = np.zeros(256, dtype=np.float32)
    for i in range(1, gray_face.shape[0] - 1):
        for j in range(1, gray_face.shape[1] - 1):
            c = float(gray_face[i, j])
            code = 0
            for di, dj in [(-1,-1),(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1),(0,-1)]:
                code = (code << 1) | (float(gray_face[i+di, j+dj]) > c)
            lbp[code] += 1
    cv2.normalize(lbp, lbp)
    emb = np.concatenate([hist.flatten(), lbp])
    return emb.astype(np.float32)

# ── Pydantic ────────────────────────────────────────────────────────────

class MatchReq(BaseModel):
    known_embeddings: List[List[float]]
    target_embedding: List[float]
    threshold: float = 0.7

class BatchMatchReq(BaseModel):
    known_embeddings: List[List[float]]
    target_embeddings: List[List[float]]
    threshold: float = 0.7

# ── Routes ──────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return ok({"service": "HRMS AI Face Service v6", "dnn": dnn_net is not None, "haar": len(haar_cascades)})

@app.get("/health")
def health():
    return ok({"ok": True, "dnn": dnn_net is not None, "haar": len(haar_cascades), "status": "ready"})

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    try:
        raw = await image.read()
        if not raw:
            return err(400, "Empty image")
        img = load_img(raw)
        if img is None:
            return err(400, "Cannot decode image")
        quality = qcheck(img)
        faces_dnn = detect_dnn(img)
        all_faces = nms(faces_dnn) if faces_dnn else nms(detect_haar(img))
        method = "dnn" if faces_dnn else "haar"
        if not all_faces:
            return ok({"success": False, "message": "No face detected", "quality": quality, "method": method})
        best = best_face(img, all_faces, quality)
        if best is None:
            return ok({"success": False, "message": "No valid face region", "quality": quality})
        emb = embed(img, best["box"])
        if np.all(emb == 0):
            return ok({"success": False, "message": "Embedding failed", "quality": quality})
        return ok({
            "success": True,
            "faces": 1,
            "encodings": [emb.tolist()],
            "locations": [best["box"]],
            "quality": quality,
            "method": method,
            "confidence": best["conf"],
            "embedding_dim": len(emb),
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        return err(500, f"encode-face: {str(e)}")

@app.post("/match-face")
def match_face(payload: MatchReq):
    try:
        known = np.array(payload.known_embeddings, dtype=np.float32)
        target = np.array(payload.target_embedding, dtype=np.float32)
        dists = np.linalg.norm(known - target, axis=1)
        idx = int(np.argmin(dists))
        d = float(dists[idx])
        return ok({"matched": d <= payload.threshold, "matched_index": idx, "distance": d, "similarity": round(1 / (1 + d), 4)})
    except Exception as e:
        logger.error(traceback.format_exc())
        return err(500, f"match-face: {str(e)}")

@app.post("/batch-match")
def batch_match(payload: BatchMatchReq):
    try:
        known = np.array(payload.known_embeddings, dtype=np.float32)
        results = []
        for t in payload.target_embeddings:
            ta = np.array(t, dtype=np.float32)
            dists = np.linalg.norm(known - ta, axis=1)
            idx = int(np.argmin(dists))
            d = float(dists[idx])
            results.append({"matched_index": idx, "distance": d, "similarity": round(1 / (1 + d), 4), "matched": d <= payload.threshold})
        return ok({"results": results, "total": len(results)})
    except Exception as e:
        logger.error(traceback.format_exc())
        return err(500, f"batch-match: {str(e)}")

@app.post("/quality-check")
async def quality_check(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return err(400, "Cannot decode image")
        quality = qcheck(img)
        faces = nms(detect_dnn(img)) or nms(detect_haar(img))
        quality["face_count"] = len(faces)
        quality["method"] = "dnn" if detect_dnn(img) else "haar"
        return ok(quality)
    except Exception as e:
        logger.error(traceback.format_exc())
        return err(500, f"quality-check: {str(e)}")

@app.post("/anti-spoof")
async def anti_spoof(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return err(400, "Cannot decode image")
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        l = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        b = float(np.mean(gray))
        faces = nms(detect_dnn(img)) or nms(detect_haar(img))
        return ok({"real": bool(l > 30 and 20 < b < 240 and len(faces) > 0), "confidence": round(min(1.0, l / 150), 4), "face_count": len(faces),
                    "method": "dnn+haar+texture",
                   "laplacian": round(l, 1), "brightness": round(b, 1)})
    except Exception as e:
        logger.error(traceback.format_exc())
        return err(500, f"anti-spoof: {str(e)}")

@app.post("/detect-faces")
async def detect_faces(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return err(400, "Cannot decode image")
        faces = nms(detect_dnn(img)) or nms(detect_haar(img))
        return ok({"count": len(faces), "locations": [f["box"] for f in faces], "confidences": [f["conf"] for f in faces]})
    except Exception as e:
        logger.error(traceback.format_exc())
        return err(500, f"detect-faces: {str(e)}")
