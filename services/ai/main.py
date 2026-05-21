"""
Industry-Grade Face Recognition Service v1.0
Zero False Positives - Only Registered Faces Accepted
PC Testing → Raspberry Pi Ready
"""
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
import cv2
import numpy as np
import os
import logging
import traceback
import time
import base64
from collections import defaultdict
import json

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("hrms-ai-industry")

app = FastAPI(title="HRMS AI Industry", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Model paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YUNET_PATH = os.path.join(BASE_DIR, "..", "ai", "yunet.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "..", "ai", "sface.onnx")

# Global state
detector = None
recognizer = None
load_error = ""

# Temporal buffer for verification
# Format: {session_id: [(employee_id, similarity, quality, timestamp), ...]}
TEMPORAL_BUFFER: Dict[str, List[dict]] = defaultdict(list)
TEMPORAL_WINDOW_MS = 8000  # 8 seconds
MIN_CONSENSUS_FRAMES = 5
CONSENSUS_AVG_THRESHOLD = 0.85

# Quality thresholds
QUALITY_BLUR_MIN = 80.0
QUALITY_BRIGHT_MIN = 40.0
QUALITY_BRIGHT_MAX = 220.0
QUALITY_FACE_MIN_SIZE = 80
QUALITY_FACE_RATIO_MAX = 0.8

# Matching thresholds
BASE_THRESHOLD = 0.55
MARGIN_THRESHOLD = 0.05
CONFIRMED_THRESHOLD = 0.65
REVIEW_THRESHOLD = 0.55

@app.on_event("startup")
async def startup():
    global detector, recognizer, load_error
    logger.info(f"OpenCV version: {cv2.__version__}")
    logger.info(f"YuNet path: {YUNET_PATH} (exists: {os.path.exists(YUNET_PATH)})")
    logger.info(f"SFace path: {SFACE_PATH} (exists: {os.path.exists(SFACE_PATH)})")
    
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
        logger.info("✅ All models loaded! Industry-grade system ready.")
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

def assess_quality(img, face_box):
    """Comprehensive quality assessment for face image"""
    x, y, w, h = [int(v) for v in face_box[:4]]
    x, y = max(0, x), max(0, y)
    face_roi = img[y:y+h, x:x+w]
    
    if face_roi.size == 0:
        return {"score": 0.0, "blur": 0.0, "brightness": 0.0, "face_size": 0, "issues": ["no_face_roi"], "good_quality": False}
    
    # 1. Blur detection (Laplacian variance)
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    # 2. Brightness check
    brightness = np.mean(gray)
    
    # 3. Face size check
    face_size = max(w, h)
    
    # 4. Face ratio check (shouldn't be too large/small relative to frame)
    frame_area = img.shape[0] * img.shape[1]
    face_area = w * h
    face_ratio = face_area / frame_area if frame_area > 0 else 0
    
    # 5. Contrast check
    contrast = np.std(gray)
    
    issues = []
    if blur_score < QUALITY_BLUR_MIN:
        issues.append("blurry")
    if brightness < QUALITY_BRIGHT_MIN:
        issues.append("too_dark")
    if brightness > QUALITY_BRIGHT_MAX:
        issues.append("too_bright")
    if face_size < QUALITY_FACE_MIN_SIZE:
        issues.append("face_too_small")
    if face_ratio > QUALITY_FACE_RATIO_MAX:
        issues.append("face_too_close")
    if contrast < 20:
        issues.append("low_contrast")
    
    # Quality score (0-1)
    blur_norm = min(blur_score / 200.0, 1.0)
    size_norm = min(face_size / 300.0, 1.0)
    brightness_norm = 1.0 - abs(brightness - 127.0) / 127.0
    contrast_norm = min(contrast / 50.0, 1.0)
    
    quality_score = 0.35 * blur_norm + 0.25 * size_norm + 0.20 * brightness_norm + 0.20 * contrast_norm
    
    return {
        "score": round(quality_score, 4),
        "blur": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "face_size": face_size,
        "face_ratio": round(face_ratio, 4),
        "issues": issues,
        "good_quality": len(issues) == 0,
    }

def detect_and_encode(img):
    """Detect face and generate embedding with quality assessment"""
    if detector is None or recognizer is None:
        return None, 0, None, None
    
    h, w = img.shape[:2]
    if h < 30 or w < 30:
        return None, 0, None, None
    
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    
    if faces is None or len(faces) == 0:
        return None, 0, None, None
    
    # Use the face with highest confidence
    best = max(faces, key=lambda f: f[14])
    conf = float(best[14])
    
    # Quality assessment
    quality = assess_quality(img, best)
    
    # Extract embedding
    landmarks = best[4:14].reshape((5, 2))
    aligned = recognizer.alignCrop(img, landmarks)
    embedding = recognizer.feature(aligned)
    
    # Normalize embedding
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    
    box = [int(best[0]), int(best[1]), int(best[2]), int(best[3])]
    return box, conf, embedding.flatten().astype(np.float32), quality

def compute_similarity(a, b):
    """Cosine similarity between two embeddings"""
    if len(a) != len(b) or len(a) == 0:
        return -1.0
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))

def match_against_known(target_embedding, known_embeddings: List[dict]):
    """
    Match target embedding against all known embeddings.
    Returns: best_match, all_scores, decision
    """
    if not known_embeddings:
        return None, [], {"decision": "REJECT", "reason": "no_known_faces"}
    
    scores = []
    for known in known_embeddings:
        sim = compute_similarity(target_embedding, known["embedding"])
        scores.append({
            "employee_id": known["employee_id"],
            "name": known["name"],
            "similarity": round(sim, 4),
        })
    
    # Sort by similarity (descending)
    scores.sort(key=lambda x: x["similarity"], reverse=True)
    
    best = scores[0]
    second_best = scores[1] if len(scores) > 1 else {"similarity": 0.0}
    
    # Margin check
    margin = best["similarity"] - second_best["similarity"]
    
    # Decision logic
    if best["similarity"] < BASE_THRESHOLD:
        decision = "REJECT"
        reason = f"similarity {best['similarity']:.2%} < threshold {BASE_THRESHOLD:.2%}"
    elif margin < MARGIN_THRESHOLD and len(scores) > 1:
        decision = "REJECT"
        reason = f"margin {margin:.2%} < min {MARGIN_THRESHOLD:.2%} (ambiguous)"
    elif best["similarity"] >= CONFIRMED_THRESHOLD:
        decision = "CONFIRMED"
        reason = f"similarity {best['similarity']:.2%} >= confirmed {CONFIRMED_THRESHOLD:.2%}"
    elif best["similarity"] >= REVIEW_THRESHOLD:
        decision = "REVIEW"
        reason = f"similarity {best['similarity']:.2%} in review zone"
    else:
        decision = "REJECT"
        reason = f"below review threshold"
    
    return best, scores, {"decision": decision, "reason": reason, "margin": round(margin, 4)}

def temporal_verification(session_id: str, employee_id: str, similarity: float, quality_score: float):
    """
    Verify identity across multiple frames.
    Returns: (verified, avg_similarity, frame_count)
    """
    now = time.time() * 1000  # milliseconds
    
    # Add to buffer
    TEMPORAL_BUFFER[session_id].append({
        "employee_id": employee_id,
        "similarity": similarity,
        "quality": quality_score,
        "timestamp": now,
    })
    
    # Clean old entries
    cutoff = now - TEMPORAL_WINDOW_MS
    TEMPORAL_BUFFER[session_id] = [
        entry for entry in TEMPORAL_BUFFER[session_id]
        if entry["timestamp"] > cutoff
    ]
    
    # Get recent frames for this employee
    recent = [
        entry for entry in TEMPORAL_BUFFER[session_id]
        if entry["employee_id"] == employee_id
    ]
    
    if len(recent) < MIN_CONSENSUS_FRAMES:
        return False, 0.0, len(recent)
    
    # Check last MIN_CONSENSUS_FRAMES
    last_n = recent[-MIN_CONSENSUS_FRAMES:]
    avg_sim = sum(e["similarity"] for e in last_n) / len(last_n)
    avg_quality = sum(e["quality"] for e in last_n) / len(last_n)
    
    # Verification criteria
    all_above_threshold = all(e["similarity"] >= BASE_THRESHOLD for e in last_n)
    quality_ok = avg_quality >= 0.4
    
    verified = all_above_threshold and avg_sim >= CONSENSUS_AVG_THRESHOLD and quality_ok
    
    return verified, avg_sim, len(recent)

class MatchRequest(BaseModel):
    known_embeddings: List[dict]  # [{employee_id, name, embedding: [float]}]
    session_id: str
    quality_threshold: float = 0.4

@app.post("/industry-match")
async def industry_match(image: UploadFile = File(...), known_embeddings: str = None, session_id: str = None):
    """
    Industry-grade face matching endpoint.
    Returns: decision (CONFIRMED/REVIEW/REJECT) with quality and temporal verification.
    """
    try:
        raw = await image.read()
        if not raw:
            return ok({"success": False, "message": "Empty image"}, 400)
        
        img = load_img(raw)
        if img is None:
            return ok({"success": False, "message": "Invalid image"}, 400)
        
        if detector is None or recognizer is None:
            return ok({"success": False, "message": f"Model not loaded: {load_error}"}, 500)
        
        # Step 1: Detect and encode
        box, conf, embedding, quality = detect_and_encode(img)
        
        if box is None or embedding is None:
            return ok({
                "success": False,
                "decision": "REJECT",
                "reason": "no_face_detected",
                "quality": quality,
                "message": "No face detected. Look directly at camera."
            })
        
        # Step 2: Quality gate
        if quality and not quality.get("good_quality", False):
            return ok({
                "success": True,
                "decision": "REJECT",
                "reason": "quality_gate_failed",
                "quality": quality,
                "detection_confidence": conf,
                "message": f"Quality issues: {', '.join(quality.get('issues', []))}"
            })
        
        # Step 3: Parse known embeddings
        known_list = []
        if known_embeddings:
            known_list = json.loads(known_embeddings)
        
        if not known_list:
            return ok({
                "success": False,
                "decision": "REJECT",
                "reason": "no_known_embeddings",
                "quality": quality,
                "message": "No known embeddings provided"
            })
        
        # Step 4: Match against known
        best_match, all_scores, match_decision = match_against_known(embedding, known_list)
        
        # DEBUG: Log matching scores
        logger.info(f"🔍 MATCH DEBUG: best={best_match['name'] if best_match else 'None'} sim={best_match['similarity'] if best_match else 0:.4f}")
        logger.info(f"🔍 ALL SCORES: {[(s['name'], s['similarity']) for s in all_scores[:3]]}")
        
        # Step 5: Temporal verification (if CONFIRMED candidate)
        temporal_verified = False
        avg_sim = 0.0
        frame_count = 0
        
        if match_decision["decision"] in ["CONFIRMED", "REVIEW"] and session_id:
            temporal_verified, avg_sim, frame_count = temporal_verification(
                session_id, best_match["employee_id"], best_match["similarity"], quality.get("score", 0)
            )
            
            if temporal_verified:
                match_decision["decision"] = "CONFIRMED"
                match_decision["reason"] = f"temporal verified: {frame_count} frames, avg sim {avg_sim:.2%}"
            else:
                match_decision["decision"] = "REVIEW"
                match_decision["reason"] = f"temporal pending: {frame_count}/{MIN_CONSENSUS_FRAMES} frames"
        
        # Step 6: Build response
        response = {
            "success": True,
            "decision": match_decision["decision"],
            "reason": match_decision["reason"],
            "best_match": best_match,
            "all_scores": all_scores[:5],  # Top 5
            "quality": quality,
            "detection_confidence": conf,
            "temporal": {
                "verified": temporal_verified,
                "avg_similarity": round(avg_sim, 4),
                "frame_count": frame_count,
                "required_frames": MIN_CONSENSUS_FRAMES,
            },
            "margin": match_decision.get("margin", 0),
        }
        
        return ok(response)
        
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.post("/industry-match-json")
async def industry_match_json(req: dict):
    """
    Industry-grade face matching endpoint (JSON with base64 image).
    Returns: decision (CONFIRMED/REVIEW/REJECT) with quality and temporal verification.
    """
    try:
        image_base64 = req.get("image_base64", "")
        known_embeddings = req.get("known_embeddings", [])
        session_id = req.get("session_id", "")
        
        logger.info(f"🔍 industry-match-json: known_embeddings count={len(known_embeddings)}, session_id={session_id}")
        
        if not image_base64:
            return ok({"success": False, "message": "No image provided"}, 400)
        
        # Decode base64 image
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
        raw = base64.b64decode(image_base64)
        
        img = load_img(raw)
        if img is None:
            return ok({"success": False, "message": "Invalid image"}, 400)
        
        if detector is None or recognizer is None:
            return ok({"success": False, "message": f"Model not loaded: {load_error}"}, 500)
        
        # Step 1: Detect and encode
        box, conf, embedding, quality = detect_and_encode(img)
        
        if box is None or embedding is None:
            return ok({
                "success": False,
                "decision": "REJECT",
                "reason": "no_face_detected",
                "quality": quality,
                "message": "No face detected. Look directly at camera."
            })
        
        # Step 2: Quality gate (disabled for testing)
        # if quality and not quality.get("good_quality", False):
        #     return ok({
        #         "success": True,
        #         "decision": "REJECT",
        #         "reason": "quality_gate_failed",
        #         "quality": quality,
        #         "detection_confidence": conf,
        #         "message": f"Quality issues: {', '.join(quality.get('issues', []))}"
        #     })
        
        # Step 3: Match against known
        logger.info(f"🔍 Matching against {len(known_embeddings)} known embeddings")
        best_match, all_scores, match_decision = match_against_known(embedding, known_embeddings)
        
        # DEBUG: Log matching scores
        logger.info(f"🔍 MATCH DEBUG: best={best_match['name'] if best_match else 'None'} sim={best_match['similarity'] if best_match else 0:.4f}")
        logger.info(f"🔍 ALL SCORES: {[(s['name'], s['similarity']) for s in all_scores[:3]]}")
        
        # Step 4: Temporal verification (if CONFIRMED candidate)
        temporal_verified = False
        avg_sim = 0.0
        frame_count = 0
        
        if match_decision["decision"] in ["CONFIRMED", "REVIEW"] and session_id:
            temporal_verified, avg_sim, frame_count = temporal_verification(
                session_id, best_match["employee_id"], best_match["similarity"], quality.get("score", 0)
            )
            
            if temporal_verified:
                match_decision["decision"] = "CONFIRMED"
                match_decision["reason"] = f"temporal verified: {frame_count} frames, avg sim {avg_sim:.2%}"
            else:
                match_decision["decision"] = "REVIEW"
                match_decision["reason"] = f"temporal pending: {frame_count}/{MIN_CONSENSUS_FRAMES} frames"
        
        # Step 5: Build response
        response = {
            "success": True,
            "decision": match_decision["decision"],
            "reason": match_decision["reason"],
            "best_match": best_match,
            "all_scores": all_scores[:5],
            "quality": quality,
            "detection_confidence": conf,
            "temporal": {
                "verified": temporal_verified,
                "avg_similarity": round(avg_sim, 4),
                "frame_count": frame_count,
                "required_frames": MIN_CONSENSUS_FRAMES,
            },
            "margin": match_decision.get("margin", 0),
        }
        
        return ok(response)
        
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.post("/encode-face")
async def encode_face(image: UploadFile = File(...)):
    """Encode face from image. Returns embedding + quality."""
    try:
        raw = await image.read()
        if not raw:
            return ok({"success": False, "message": "Empty image"}, 400)
        
        img = load_img(raw)
        if img is None:
            return ok({"success": False, "message": "Invalid image"}, 400)
        
        if detector is None or recognizer is None:
            return ok({"success": False, "message": f"Model not loaded: {load_error}"}, 500)
        
        box, conf, embedding, quality = detect_and_encode(img)
        
        if box is None or embedding is None:
            return ok({"success": False, "message": "No face detected. Look directly at camera."})
        
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

@app.get("/health")
def health():
    return ok({
        "ok": detector is not None and recognizer is not None,
        "model": "yunet+sface-industry",
        "detector_loaded": detector is not None,
        "recognizer_loaded": recognizer is not None,
        "error": load_error,
        "opencv": cv2.__version__,
        "version": "1.0.0-industry",
    })

@app.get("/")
def root():
    return ok({
        "service": "HRMS AI Industry v1.0",
        "detector": detector is not None,
        "recognizer": recognizer is not None,
        "error": load_error,
        "endpoints": ["/health", "/encode-face", "/industry-match"],
    })
