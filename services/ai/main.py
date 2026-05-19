from fastapi import FastAPI, UploadFile, File, HTTPException, Request
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI Face Service", version="5.0.0")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url}:\n{traceback.format_exc()}")
    return JSONResponse(status_code=500, content={"detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load face cascades (built into OpenCV, no downloads)
cascades = []
cascade_paths = [
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
    cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml",
    cv2.data.haarcascades + "haarcascade_profileface.xml",
]
for p in cascade_paths:
    c = cv2.CascadeClassifier(p)
    if not c.empty():
        cascades.append(c)
        logger.info(f"Loaded cascade: {os.path.basename(p)}")

if not cascades:
    logger.error("No face cascades loaded!")
else:
    logger.info(f"Total cascades loaded: {len(cascades)}")

class MatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embedding: List[float]
    threshold: float = 0.7

class BatchMatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embeddings: List[List[float]]
    threshold: float = 0.7

def load_image(file_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img

def check_quality(img: np.ndarray) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness = float(np.mean(gray))
    return {
        "blurry": blur_score < 80,
        "blur_score": round(blur_score, 2),
        "dark": brightness < 40,
        "brightness": round(brightness, 2),
        "good_quality": blur_score >= 80 and 40 <= brightness <= 230,
    }

def detect_faces_multi(img: np.ndarray, min_neighbors: int = 3, min_size: int = 60) -> List[tuple]:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Enhance contrast for better detection
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    all_faces = []
    for cascade in cascades:
        faces = cascade.detectMultiScale(
            enhanced,
            scaleFactor=1.1,
            minNeighbors=min_neighbors,
            minSize=(min_size, min_size),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )
        for (x, y, w, h) in faces:
            all_faces.append((x, y, w, h))
    # Also try on original (non-enhanced) image as fallback
    for cascade in cascades:
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.15,
            minNeighbors=min_neighbors + 1,
            minSize=(min_size, min_size),
        )
        for (x, y, w, h) in faces:
            all_faces.append((x, y, w, h))
    # Merge overlapping detections (simple NMS)
    if not all_faces:
        return []
    boxes = np.array(all_faces, dtype=np.float32)
    # Non-maximum suppression
    picked = []
    if len(boxes) > 0:
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 0] + boxes[:, 2]
        y2 = boxes[:, 1] + boxes[:, 3]
        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        idxs = np.argsort(boxes[:, 2] * boxes[:, 3])[::-1]  # sort by area descending
        while len(idxs) > 0:
            last = len(idxs) - 1
            i = idxs[0]
            picked.append(i)
            xx1 = np.maximum(x1[i], x1[idxs[1:]])
            yy1 = np.maximum(y1[i], y1[idxs[1:]])
            xx2 = np.minimum(x2[i], x2[idxs[1:]])
            yy2 = np.minimum(y2[i], y2[idxs[1:]])
            w_n = np.maximum(0, xx2 - xx1 + 1)
            h_n = np.maximum(0, yy2 - yy1 + 1)
            overlap = (w_n * h_n) / areas[idxs[1:]]
            idxs = np.delete(idxs, np.concatenate(([0], np.where(overlap > 0.3)[0] + 1)))
    result = [(int(boxes[i][0]), int(boxes[i][1]), int(boxes[i][2]), int(boxes[i][3])) for i in picked]
    return result

def compute_embedding(img: np.ndarray, face_rect: tuple) -> np.ndarray:
    x, y, w, h = face_rect
    face = img[y:y+h, x:x+w]
    if face.size == 0:
        return np.zeros(128, dtype=np.float32)
    # Resize to standard size
    face = cv2.resize(face, (128, 128))
    # Convert to HSV for lighting invariance
    hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
    # Compute 3D histogram (8 bins per channel = 512 features)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    # Add HOG-like features for better discrimination
    gray_face = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    # LBP features
    lbp = np.zeros(256, dtype=np.float32)
    for i in range(1, gray_face.shape[0] - 1):
        for j in range(1, gray_face.shape[1] - 1):
            center = gray_face[i, j]
            code = 0
            code |= (gray_face[i-1, j-1] > center) << 7
            code |= (gray_face[i-1, j] > center) << 6
            code |= (gray_face[i-1, j+1] > center) << 5
            code |= (gray_face[i, j+1] > center) << 4
            code |= (gray_face[i+1, j+1] > center) << 3
            code |= (gray_face[i+1, j] > center) << 2
            code |= (gray_face[i+1, j-1] > center) << 1
            code |= (gray_face[i, j-1] > center) << 0
            lbp[code] += 1
    cv2.normalize(lbp, lbp)
    # Combine histogram + LBP
    embedding = np.concatenate([hist.flatten(), lbp])
    return embedding.astype(np.float32)

@app.get("/health")
def health():
    return {"ok": True, "service": "ai", "method": "multi-cascade + HSV+LBP", "cascades": len(cascades), "status": "ready"}

@app.get("/")
def root():
    return {"service": "HRMS AI Face Service", "version": "5.0.0", "status": "running"}

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...), min_det_score: float = 0.4):
    try:
        img = load_image(await image.read())
        quality = check_quality(img)
        faces = detect_faces_multi(img)
        if len(faces) == 0:
            return {"success": False, "message": "No face detected after trying multiple cascades", "quality": quality}
        results = []
        locations = []
        for (x, y, w, h) in faces:
            if w < 60 or h < 60:
                continue
            emb = compute_embedding(img, (x, y, w, h))
            results.append(emb.tolist())
            locations.append([int(x), int(y), int(w), int(h)])
        if len(results) == 0:
            return {"success": False, "message": "Detected faces too small", "quality": quality}
        return {
            "success": True,
            "faces": len(results),
            "encodings": results,
            "locations": locations,
            "quality": quality,
            "method": "multi-cascade-ms",
            "embedding_dim": len(results[0]),
        }
    except Exception as e:
        logger.error(f"encode-face error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/match-face")
def match_face(payload: MatchRequest):
    try:
        known = np.array(payload.known_embeddings)
        target = np.array(payload.target_embedding)
        distances = np.linalg.norm(known - target, axis=1)
        min_idx = int(np.argmin(distances))
        min_dist = float(distances[min_idx])
        return {
            "matched": min_dist <= payload.threshold,
            "matched_index": min_idx,
            "distance": min_dist,
            "similarity": round(float(1 / (1 + min_dist)), 4),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/batch-match")
def batch_match(payload: BatchMatchRequest):
    try:
        known = np.array(payload.known_embeddings)
        results = []
        for target in payload.target_embeddings:
            target_arr = np.array(target)
            distances = np.linalg.norm(known - target_arr, axis=1)
            min_idx = int(np.argmin(distances))
            min_dist = float(distances[min_idx])
            results.append({
                "matched_index": min_idx,
                "distance": min_dist,
                "similarity": round(float(1 / (1 + min_dist)), 4),
                "matched": min_dist <= payload.threshold,
            })
        return {"results": results, "total": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect-faces")
async def detect_faces_endpoint(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        faces = detect_faces_multi(img)
        return {
            "count": len(faces),
            "locations": [[int(x) for x in f] for f in faces],
            "detection_scores": [1.0 for _ in faces],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/quality-check")
async def quality_check_endpoint(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        quality = check_quality(img)
        faces = detect_faces_multi(img)
        quality["face_count"] = len(faces)
        return quality
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/anti-spoof")
async def anti_spoof(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        brightness = float(np.mean(gray))
        is_real = laplacian_var > 30 and 20 < brightness < 240
        confidence = round(min(1.0, laplacian_var / 150), 4)
        faces = detect_faces_multi(img)
        is_real = is_real and len(faces) > 0
        return {
            "real": bool(is_real),
            "confidence": confidence,
            "face_count": len(faces),
            "method": "texture_analysis+multi-cascade",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/watermark-image")
async def watermark_image(image: UploadFile = File(...), employee_name: str = "", site_name: str = "", timestamp: str = "", lat: str = "", lng: str = ""):
    try:
        img_bytes = await image.read()
        img = Image.open(BytesIO(img_bytes)).convert("RGB")
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        font = ImageFont.load_default()
        lines = [f"Name: {employee_name}", f"Site: {site_name}", f"Time: {timestamp}"]
        if lat and lng: lines.append(f"GPS: {lat}, {lng}")
        y = img.height - 60
        for line in lines:
            draw.text((10, y), line, fill=(255, 255, 255), font=font)
            y -= 15
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=95)
        return {"success": True, "watermarked_image": base64.b64encode(buffer.getvalue()).decode()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
