from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import face_recognition
import numpy as np
from io import BytesIO
from PIL import Image
import base64
import time

app = FastAPI(title="HRMS AI Face Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class MatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embedding: List[float]
    threshold: float = 0.55

class BatchMatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    target_embeddings: List[List[float]]
    threshold: float = 0.55

def image_to_array(file_bytes: bytes) -> np.ndarray:
    img = Image.open(BytesIO(file_bytes)).convert("RGB")
    return np.array(img)

def image_to_base64(img: Image.Image) -> str:
    buffer = BytesIO()
    img.save(buffer, format="JPEG", quality=95)
    return base64.b64encode(buffer.getvalue()).decode()

@app.get("/health")
def health():
    return {"ok": True, "service": "ai", "model": "face_recognition"}

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    try:
        img = image_to_array(await image.read())
        locations = face_recognition.face_locations(img, model="hog")
        if not locations:
            return {"success": False, "message": "No face detected"}
        encodings = face_recognition.face_encodings(img, known_face_locations=locations)
        return {
            "success": True,
            "faces": len(encodings),
            "encodings": [enc.tolist() for enc in encodings],
            "locations": locations
        }
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

@app.post("/anti-spoof")
async def anti_spoof(image: UploadFile = File(...)):
    return {
        "real": True,
        "confidence": 0.95,
        "method": "none",
        "note": "Anti-spoofing model coming soon"
    }

@app.post("/detect-faces")
async def detect_faces(image: UploadFile = File(...)):
    try:
        img = image_to_array(await image.read())
        locations = face_recognition.face_locations(img, model="hog")
        return {
            "count": len(locations),
            "locations": locations
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/watermark-image")
async def watermark_image(
    image: UploadFile = File(...),
    employee_name: str = "",
    site_name: str = "",
    timestamp: str = "",
    lat: str = "",
    lng: str = ""
):
    try:
        img_bytes = await image.read()
        img = Image.open(BytesIO(img_bytes)).convert("RGB")
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        font = ImageFont.load_default()

        lines = [f"Name: {employee_name}", f"Site: {site_name}", f"Time: {timestamp}"]
        if lat and lng:
            lines.append(f"GPS: {lat}, {lng}")

        y = img.height - 60
        for line in lines:
            draw.text((10, y), line, fill=(255, 255, 255), font=font)
            y -= 15

        return {"success": True, "watermarked_image": image_to_base64(img)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
