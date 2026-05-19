from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import cv2
import numpy as np
from io import BytesIO
from PIL import Image
import base64
import json
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI Face Service", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

face_app = None

def get_face_app():
    global face_app
    if face_app is None:
        try:
            import insightface
            from insightface.app import FaceAnalysis
            logger.info("Initializing insightface with buffalo_s model...")
            face_app = FaceAnalysis(name='buffalo_s', providers=['CPUExecutionProvider'])
            face_app.prepare(ctx_id=0, det_size=(320, 320))
            logger.info("insightface initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize insightface: {e}")
            raise
    return face_app

class MatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embedding: List[float]
    threshold: float = 0.35

class BatchMatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embeddings: List[List[float]]
    threshold: float = 0.35

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

@app.get("/health")
def health():
    return {"ok": True, "service": "ai", "method": "insightface-arcface", "model": "buffalo_s", "status": "ready" if face_app else "initializing"}

@app.get("/")
def root():
    return {"service": "HRMS AI Face Service", "version": "3.0.0", "status": "running"}

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...), min_det_score: float = 0.4):
    try:
        img = load_image(await image.read())
        quality = check_quality(img)
        app = get_face_app()
        faces = app.get(img)
        if len(faces) == 0:
            return {"success": False, "message": "No face detected", "quality": quality}
        results = []
        locations = []
        scores = []
        for face in faces:
            if face.det_score < min_det_score:
                continue
            results.append(face.embedding.tolist())
            x1, y1, x2, y2 = face.bbox.astype(int).tolist()
            locations.append([x1, y1, x2 - x1, y2 - y1])
            scores.append(round(float(face.det_score), 4))
        if len(results) == 0:
            return {"success": False, "message": f"Face detected but confidence too low (min: {min_det_score})", "quality": quality, "raw_faces": len(faces)}
        return {
            "success": True,
            "faces": len(results),
            "encodings": results,
            "locations": locations,
            "detection_scores": scores,
            "quality": quality,
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
async def detect_faces(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        app = get_face_app()
        faces = app.get(img)
        return {
            "count": len(faces),
            "locations": [[int(x) for x in f.bbox] for f in faces],
            "detection_scores": [round(float(f.det_score), 4) for f in faces],
        }
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
        app = get_face_app()
        faces = app.get(img)
        face_scores = [float(f.det_score) for f in faces] if faces else []
        avg_face_score = sum(face_scores) / len(face_scores) if face_scores else 0
        is_real = is_real and avg_face_score > 0.3
        return {
            "real": bool(is_real),
            "confidence": confidence,
            "face_count": len(faces),
            "avg_detection_score": round(avg_face_score, 4),
            "method": "texture_analysis+face_detection",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/quality-check")
async def quality_check(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        quality = check_quality(img)
        app = get_face_app()
        faces = app.get(img)
        quality["face_count"] = len(faces)
        if faces:
            quality["max_detection_score"] = round(float(max(f.det_score for f in faces)), 4)
        return quality
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
