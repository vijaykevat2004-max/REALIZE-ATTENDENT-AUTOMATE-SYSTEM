"""
HRMS AI Face Service v7 — InsightFace ArcFace (iPhone Face ID grade)
"""
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List
import insightface
import cv2
import numpy as np
import logging
import traceback

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI", version="7.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

face_app = None

@app.on_event("startup")
async def startup():
    global face_app
    try:
        logger.info("Loading InsightFace buffalo_s model...")
        face_app = insightface.app.FaceAnalysis(name="buffalo_s")
        face_app.prepare(ctx_id=0, det_size=(640, 640))
        logger.info("✅ InsightFace loaded — ArcFace 512-d embeddings")
    except Exception as e:
        logger.error(f"❌ InsightFace failed: {e}")

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
        if face_app is None:
            return ok({"success": False, "message": "Face model not loaded"}, 500)
        # Auto-detect + align + encode (all in one call)
        faces = face_app.get(img)
        if not faces:
            return ok({"success": False, "message": "No face detected. Look directly at camera."})
        # Pick highest confidence face
        best = max(faces, key=lambda f: f.det_score)
        return ok({
            "success": True,
            "encodings": [best.embedding.tolist()],
            "locations": [best.bbox.astype(int).tolist()],
            "confidence": round(float(best.det_score), 3),
            "embedding_dim": 512,
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
        # Cosine similarity (ArcFace standard)
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
    return ok({"ok": True, "model": "insightface-arcface", "loaded": face_app is not None})

@app.get("/")
def root():
    return ok({"service": "HRMS AI v7 — ArcFace", "loaded": face_app is not None})

@app.post("/detect")
async def detect_endpoint(image: UploadFile = File(...)):
    try:
        img = load_img(await image.read())
        if img is None:
            return ok({"count": 0, "message": "Invalid image"})
        if face_app is None:
            return ok({"count": 0, "message": "Model not loaded"})
        faces = face_app.get(img)
        return ok({
            "count": len(faces),
            "locations": [f.bbox.astype(int).tolist() for f in faces],
            "confidences": [round(float(f.det_score), 3) for f in faces],
        })
    except Exception as e:
        return ok({"count": 0, "message": str(e)}, 500)
