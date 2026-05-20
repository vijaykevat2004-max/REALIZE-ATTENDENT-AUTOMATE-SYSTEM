"""
HRMS AI Face Service v10.0 — Advanced Multi-Layered Face Recognition
Models: YuNet Detection + SFace Recognition
Features: Quality gate, multi-factor scoring, dynamic threshold, temporal verification
"""
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import cv2
import numpy as np
import os
import logging
import traceback
import time
import math

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("hrms-ai")

app = FastAPI(title="HRMS AI", version="10.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YUNET_PATH = os.path.join(BASE_DIR, "yunet.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "sface.onnx")

detector = None
recognizer = None
load_error = ""

TEMPORAL_BUFFER: dict = {}
TEMPORAL_WINDOW_MS = 8000
TEMPORAL_MIN_FRAMES = 3
TEMPORAL_AVG_THRESHOLD = 0.88

QUALITY_BLUR_THRESHOLD = 80.0
QUALITY_MIN_FACE_SIZE = 60
QUALITY_MIN_FACE_RATIO = 0.05
QUALITY_MAX_FACE_RATIO = 0.70
QUALITY_DARK_THRESHOLD = 25
QUALITY_BRIGHT_THRESHOLD = 230

DYNAMIC_BASE_THRESHOLD = 0.78
DYNAMIC_MARGIN_MIN = 0.10
DYNAMIC_REVIEW_ZONE = 0.08

CONFIRMED = "CONFIRMED"
REVIEW = "REVIEW"
REJECT = "REJECT"

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

def compute_laplacian_variance(gray):
    return cv2.Laplacian(gray, cv2.CV_64F).var()

def compute_face_quality(img, face_box):
    x, y, w, h = face_box
    ih, iw = img.shape[:2]
    face = img[max(0,y):min(ih,y+h), max(0,x):min(iw,x+w)]
    if face.size == 0:
        return {"score": 0.0, "blur": 0.0, "brightness": 0.0, "face_size": 0, "issues": ["empty_face_crop"]}
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    blur_score = compute_laplacian_variance(gray)
    brightness = float(np.mean(gray))
    face_area = w * h
    image_area = iw * ih
    face_ratio = face_area / max(image_area, 1)
    issues = []
    if blur_score < QUALITY_BLUR_THRESHOLD:
        issues.append("blurry")
    if w < QUALITY_MIN_FACE_SIZE or h < QUALITY_MIN_FACE_SIZE:
        issues.append("face_too_small")
    if face_ratio < QUALITY_MIN_FACE_RATIO:
        issues.append("face_too_far")
    if face_ratio > QUALITY_MAX_FACE_RATIO:
        issues.append("face_too_close")
    if brightness < QUALITY_DARK_THRESHOLD:
        issues.append("too_dark")
    if brightness > QUALITY_BRIGHT_THRESHOLD:
        issues.append("too_bright")
    blur_norm = min(blur_score / 200.0, 1.0)
    size_norm = min(max(w, h) / 300.0, 1.0)
    brightness_norm = 1.0 - abs(brightness - 127.0) / 127.0
    quality_score = 0.45 * blur_norm + 0.30 * size_norm + 0.25 * brightness_norm
    return {
        "score": round(quality_score, 4),
        "blur": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "face_size": max(w, h),
        "face_ratio": round(face_ratio, 4),
        "issues": issues,
        "good_quality": len(issues) == 0,
    }

def compute_dynamic_threshold(num_enrolled: int, similarity_scores: List[float]) -> dict:
    if num_enrolled <= 5:
        base = 0.82
        margin = 0.12
    elif num_enrolled <= 20:
        base = 0.80
        margin = 0.10
    elif num_enrolled <= 50:
        base = 0.78
        margin = 0.08
    else:
        base = 0.76
        margin = 0.06
    if len(similarity_scores) >= 2:
        sorted_scores = sorted(similarity_scores, reverse=True)
        gap = sorted_scores[0] - sorted_scores[1]
        if gap < 0.05:
            base += 0.03
            margin += 0.02
        mean_sim = np.mean(similarity_scores)
        std_sim = np.std(similarity_scores)
        if std_sim < 0.05:
            base += 0.02
    confirmed_threshold = base + 0.06
    review_threshold = base
    return {
        "base": round(base, 4),
        "confirmed": round(confirmed_threshold, 4),
        "review": round(review_threshold, 4),
        "margin_min": round(margin, 4),
    }

def compute_temporal_score(session_id: str, employee_id: str, current_sim: float, now_ms: int) -> dict:
    if session_id not in TEMPORAL_BUFFER:
        TEMPORAL_BUFFER[session_id] = []
    buffer = TEMPORAL_BUFFER[session_id]
    cutoff = now_ms - TEMPORAL_WINDOW_MS
    buffer[:] = [entry for entry in buffer if entry["timestamp"] > cutoff]
    buffer.append({
        "employee_id": employee_id,
        "similarity": current_sim,
        "timestamp": now_ms,
    })
    recent = [e for e in buffer if e["employee_id"] == employee_id]
    if len(recent) < 2:
        return {"consistency": 0.0, "frame_count": len(recent), "avg_similarity": current_sim, "verified": False}
    sims = [e["similarity"] for e in recent]
    avg_sim = np.mean(sims)
    std_sim = np.std(sims)
    consistency = max(0.0, 1.0 - std_sim * 5)
    all_same = len(set(e["employee_id"] for e in buffer[-TEMPORAL_MIN_FRAMES:])) == 1
    verified = len(recent) >= TEMPORAL_MIN_FRAMES and avg_sim >= TEMPORAL_AVG_THRESHOLD and consistency > 0.7
    return {
        "consistency": round(consistency, 4),
        "frame_count": len(recent),
        "avg_similarity": round(float(avg_sim), 4),
        "std_deviation": round(float(std_sim), 4),
        "verified": verified,
    }

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
    threshold: float = 0.85

class AdvancedMatchRequest(BaseModel):
    known_embeddings: List[List[float]]
    known_ids: List[str]
    known_names: Optional[List[str]] = None
    target_embedding: List[float]
    quality_score: float = 1.0
    session_id: Optional[str] = None
    num_enrolled: Optional[int] = None

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
        quality = compute_face_quality(img, box)
        return ok({
            "success": True,
            "encodings": [embedding.tolist()],
            "locations": [box],
            "confidence": round(conf, 3),
            "embedding_dim": 128,
            "quality": quality,
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.post("/advanced-match")
async def advanced_match(req: AdvancedMatchRequest):
    t0 = time.time()
    try:
        num_enrolled = len(req.known_embeddings)
        if num_enrolled == 0:
            return ok({"classification": REJECT, "reason": "No enrolled employees", "confidence_score": 0.0})

        target = np.array(req.target_embedding, dtype=np.float32)
        known = np.array(req.known_embeddings, dtype=np.float32)

        target_norm = np.linalg.norm(target)
        if target_norm > 0:
            target = target / target_norm

        sims = np.dot(known, target)
        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])

        sorted_sims = sorted(sims.tolist(), reverse=True)
        second_sim = sorted_sims[1] if len(sorted_sims) > 1 else 0.0
        margin = best_sim - second_sim

        thresholds = compute_dynamic_threshold(num_enrolled, sims.tolist())

        quality_weight = req.quality_score
        quality_gate_passed = req.quality_score >= 0.4

        temporal_result = {"consistency": 0.0, "frame_count": 1, "avg_similarity": best_sim, "verified": False}
        if req.session_id:
            now_ms = int(time.time() * 1000)
            temporal_result = compute_temporal_score(req.session_id, req.known_ids[best_idx], best_sim, now_ms)

        temporal_weight = 0.0
        if temporal_result["verified"]:
            temporal_weight = 0.15 * min(temporal_result["consistency"], 1.0)
        elif temporal_result["frame_count"] >= 2:
            temporal_weight = 0.08 * min(temporal_result["consistency"], 1.0)

        margin_bonus = 0.0
        if margin >= thresholds["margin_min"]:
            margin_bonus = 0.05
        elif margin >= thresholds["margin_min"] * 0.5:
            margin_bonus = 0.02

        raw_score = best_sim
        quality_adjusted = raw_score * (0.7 + 0.3 * quality_weight)
        confidence_score = min(quality_adjusted + margin_bonus + temporal_weight, 1.0)

        if not quality_gate_passed:
            classification = REJECT
            reason = f"Quality gate failed: score={req.quality_score:.2f}, issues detected"
        elif confidence_score >= thresholds["confirmed"] and temporal_result["verified"]:
            classification = CONFIRMED
            reason = f"High confidence match: {confidence_score:.4f} >= {thresholds['confirmed']:.4f}"
        elif confidence_score >= thresholds["review"]:
            classification = REVIEW
            reason = f"Moderate confidence: {confidence_score:.4f} in review zone [{thresholds['review']:.4f}-{thresholds['confirmed']:.4f}]"
        elif confidence_score >= thresholds["confirmed"] - 0.05 and margin >= thresholds["margin_min"]:
            classification = REVIEW
            reason = f"Near threshold with good margin: {confidence_score:.4f}"
        else:
            classification = REJECT
            reason = f"Below threshold: {confidence_score:.4f} < {thresholds['review']:.4f}"

        elapsed_ms = round((time.time() - t0) * 1000, 2)

        name = None
        if req.known_names and best_idx < len(req.known_names):
            name = req.known_names[best_idx]

        all_scores = []
        for i in range(min(num_enrolled, 5)):
            idx = sorted(range(len(sims)), key=lambda k: sims[k], reverse=True)[i]
            emp_name = req.known_names[idx] if req.known_names and idx < len(req.known_names) else f"employee_{idx}"
            all_scores.append({
                "employee_id": req.known_ids[idx],
                "name": emp_name,
                "similarity": round(float(sims[idx]), 4),
            })

        return ok({
            "classification": classification,
            "reason": reason,
            "confidence_score": round(confidence_score, 4),
            "cosine_similarity": round(best_sim, 4),
            "quality_score": round(req.quality_score, 4),
            "margin": round(margin, 4),
            "second_best_similarity": round(second_sim, 4),
            "temporal": temporal_result,
            "thresholds": thresholds,
            "matched_employee": {
                "id": req.known_ids[best_idx],
                "name": name,
                "index": best_idx,
            } if classification != REJECT else None,
            "top_scores": all_scores,
            "quality_gate_passed": quality_gate_passed,
            "processing_time_ms": elapsed_ms,
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        elapsed_ms = round((time.time() - t0) * 1000, 2)
        return ok({
            "classification": REJECT,
            "reason": f"Error: {str(e)}",
            "confidence_score": 0.0,
            "processing_time_ms": elapsed_ms,
        }, 500)

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
        "version": "10.0.0",
        "features": ["advanced-match", "quality-gate", "dynamic-threshold", "temporal-verification"],
    })

@app.get("/")
def root():
    return ok({"service": "HRMS AI v10.0", "detector": detector is not None, "recognizer": recognizer is not None, "error": load_error})

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
        results = []
        for f in faces:
            box = [int(f[0]), int(f[1]), int(f[2]), int(f[3])]
            quality = compute_face_quality(img, box)
            results.append({
                "box": box,
                "confidence": round(float(f[14]), 3),
                "quality": quality,
            })
        return ok({"count": len(faces), "faces": results})
    except Exception as e:
        return ok({"count": 0, "message": str(e)}, 500)
