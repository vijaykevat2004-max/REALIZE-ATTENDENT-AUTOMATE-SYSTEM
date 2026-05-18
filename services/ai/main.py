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

app = FastAPI(title="HRMS AI Face Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

class MatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embedding: List[float]
    threshold: float = 0.55

class BatchMatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embeddings: List[List[float]]
    threshold: float = 0.55

def load_image(file_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img

@app.get("/health")
def health():
    return {"ok": True, "service": "ai", "method": "opencv-histogram"}

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5)
        if len(faces) == 0:
            return {"success": False, "message": "No face detected"}
        results = []
        for (x, y, w, h) in faces:
            face_roi = cv2.resize(gray[y:y+h, x:x+w], (128, 128))
            hist = cv2.calcHist([face_roi], [0], None, [64], [0, 256])
            cv2.normalize(hist, hist)
            results.append(hist.flatten().tolist())
        return {"success": True, "faces": len(results), "encodings": results, "locations": [[int(x), int(y), int(w), int(h)] for (x,y,w,h) in faces]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/match-face")
def match_face(payload: MatchRequest):
    try:
        known = np.array(payload.known_embeddings)
        target = np.array(payload.target_embedding)
        distances = np.linalg.norm(known - target, axis=1)
        min_idx = int(np.argmin(distances))
        confidence = float(1 / (1 + distances[min_idx]))
        return {
            "matched": bool(distances[min_idx] <= payload.threshold),
            "matched_index": min_idx,
            "distance": float(distances[min_idx]),
            "confidence": confidence
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
            results.append({
                "matched_index": min_idx,
                "distance": float(distances[min_idx]),
                "confidence": float(1 / (1 + distances[min_idx])),
                "matched": bool(distances[min_idx] <= payload.threshold)
            })
        return {"results": results, "total": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect-faces")
async def detect_faces(image: UploadFile = File(...)):
    try:
        img = load_image(await image.read())
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5)
        return {"count": len(faces), "locations": [[int(x), int(y), int(w), int(h)] for (x,y,w,h) in faces]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/anti-spoof")
async def anti_spoof(image: UploadFile = File(...)):
    return {"real": True, "confidence": 0.95, "method": "none", "note": "Coming soon"}

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
