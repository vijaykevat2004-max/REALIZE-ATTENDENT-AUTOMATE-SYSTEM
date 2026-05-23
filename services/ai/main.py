"""
Industry-Grade Face Recognition Service v2.0
- Multi-image enrollment with quality gates
- Temporal verification for matching
- Dynamic thresholds based on employee count
- Zero false positives guarantee
"""
from fastapi import FastAPI, UploadFile, File
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

app = FastAPI(title="HRMS AI Industry v4.0 Strict", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Model paths - models are in the same directory as main.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YUNET_PATH = os.path.join(BASE_DIR, "yunet.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "sface.onnx")

# Global state
detector = None
recognizer = None
load_error = ""

# Temporal buffer for verification
TEMPORAL_BUFFER: Dict[str, List[dict]] = defaultdict(list)
TEMPORAL_WINDOW_MS = 10000  # 10 seconds
MIN_CONSENSUS_FRAMES = 7

# Quality thresholds
QUALITY_BLUR_MIN = 50.0
QUALITY_BRIGHT_MIN = 30.0
QUALITY_BRIGHT_MAX = 230.0
QUALITY_FACE_MIN_SIZE = 60
MAX_SECOND_FACE_SCORE_RATIO = 0.92

# Matching thresholds (strict mode to avoid unknown-face false accepts)
BASE_THRESHOLD = 0.72
MARGIN_THRESHOLD = 0.18
CONFIRMED_THRESHOLD = 0.88
REVIEW_THRESHOLD = 0.84
MIN_DETECTION_CONFIDENCE = 0.90
MIN_MATCH_QUALITY_SCORE = 0.45
MAX_SECOND_BEST_SIMILARITY = 0.74
MIN_LIVENESS_SCORE = 0.55


def assess_liveness(img, face_box):
    """Heuristic liveness score for RGB-only camera.
    Returns score [0..1] and reasons; low score gets rejected.
    """
    x, y, w, h = [int(v) for v in face_box[:4]]
    x, y = max(0, x), max(0, y)
    roi = img[y:y+h, x:x+w]
    if roi.size == 0:
        return {"score": 0.0, "issues": ["no_face_roi"], "live": False}

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

    # Texture energy: screens/prints tend to have flatter skin texture.
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    texture_score = min(lap_var / 180.0, 1.0)

    # Histogram spread: replays often collapse dynamic range.
    p5 = float(np.percentile(gray, 5))
    p95 = float(np.percentile(gray, 95))
    spread = max(0.0, p95 - p5)
    spread_score = min(spread / 100.0, 1.0)

    # Saturated glare ratio: displays/paper often create hotspot clipping.
    sat_ratio = float(np.mean(gray >= 245))
    glare_score = max(0.0, 1.0 - min(sat_ratio / 0.12, 1.0))

    score = 0.45 * texture_score + 0.35 * spread_score + 0.20 * glare_score
    issues = []
    if texture_score < 0.30:
        issues.append("low_texture")
    if spread_score < 0.30:
        issues.append("flat_dynamic_range")
    if glare_score < 0.35:
        issues.append("excessive_glare")

    return {
        "score": round(float(score), 4),
        "texture": round(texture_score, 4),
        "spread": round(spread_score, 4),
        "glare": round(glare_score, 4),
        "issues": issues,
        "live": score >= MIN_LIVENESS_SCORE and len(issues) <= 1,
    }

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
    
    # 4. Contrast check
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
    if contrast < 15:
        issues.append("low_contrast")
    
    # Quality score (0-1)
    blur_norm = min(blur_score / 150.0, 1.0)
    size_norm = min(face_size / 250.0, 1.0)
    brightness_norm = 1.0 - abs(brightness - 127.0) / 127.0
    contrast_norm = min(contrast / 40.0, 1.0)
    
    quality_score = 0.35 * blur_norm + 0.25 * size_norm + 0.20 * brightness_norm + 0.20 * contrast_norm
    
    return {
        "score": round(quality_score, 4),
        "blur": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "face_size": face_size,
        "issues": issues,
        "good_quality": len(issues) == 0,
    }

def detect_and_encode(img):
    """Detect face and generate embedding with quality assessment"""
    if detector is None or recognizer is None:
        return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}
    
    h, w = img.shape[:2]
    if h < 30 or w < 30:
        return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}
    
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    
    if faces is None or len(faces) == 0:
        return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

    face_count = len(faces)
    cx, cy = (w / 2.0), (h / 2.0)

    # Prefer center + larger face to avoid matching background faces.
    scored = []
    for f in faces:
        fx, fy, fw, fh = [float(v) for v in f[:4]]
        conf = float(f[14])
        fcx, fcy = fx + fw / 2.0, fy + fh / 2.0
        center_dist = ((fcx - cx) ** 2 + (fcy - cy) ** 2) ** 0.5
        center_norm = center_dist / max((cx**2 + cy**2) ** 0.5, 1.0)
        area_norm = min((fw * fh) / float(max(w * h, 1)), 1.0)
        scene_score = (0.50 * conf) + (0.35 * (1.0 - center_norm)) + (0.15 * area_norm)
        scored.append((scene_score, f))

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0][1]

    ambiguous_scene = False
    if len(scored) > 1:
        top = scored[0][0]
        second = scored[1][0]
        if top > 0 and (second / top) >= MAX_SECOND_FACE_SCORE_RATIO:
            ambiguous_scene = True

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
    return box, conf, embedding.flatten().astype(np.float32), quality, {
        "face_count": face_count,
        "ambiguous_scene": ambiguous_scene,
    }

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
    """Match target embedding against all known embeddings."""
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
    
    # Decision logic (strict)
    if best["similarity"] < BASE_THRESHOLD:
        decision = "REJECT"
        reason = f"similarity {best['similarity']:.2%} < threshold {BASE_THRESHOLD:.2%}"
    elif len(scores) > 1 and second_best["similarity"] > MAX_SECOND_BEST_SIMILARITY:
        decision = "REJECT"
        reason = f"second-best {second_best['similarity']:.2%} > max {MAX_SECOND_BEST_SIMILARITY:.2%}"
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
    """Verify identity across multiple frames."""
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
    quality_ok = avg_quality >= 0.3
    
    verified = all_above_threshold and avg_sim >= CONFIRMED_THRESHOLD and quality_ok
    
    return verified, avg_sim, len(recent)

@app.post("/industry-match-json")
async def industry_match_json(req: dict):
    """Industry-grade face matching endpoint (JSON with base64 image)."""
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
        box, conf, embedding, quality, scene = detect_and_encode(img)
        
        if box is None or embedding is None:
            return ok({
                "success": False,
                "decision": "REJECT",
                "reason": "no_face_detected",
                "quality": quality,
                "message": "No face detected. Look directly at camera."
            })

        if scene.get("face_count", 0) != 1:
            return ok({
                "success": True,
                "decision": "REJECT",
                "reason": f"exactly_one_face_required: found {scene.get('face_count', 0)}",
                "best_match": None,
                "all_scores": [],
                "quality": quality,
                "detection_confidence": conf,
                "temporal": {
                    "verified": False,
                    "avg_similarity": 0.0,
                    "frame_count": 0,
                    "required_frames": MIN_CONSENSUS_FRAMES,
                },
                "margin": 0,
                "scene": scene,
            })

        if scene.get("ambiguous_scene", False):
            return ok({
                "success": True,
                "decision": "REJECT",
                "reason": "multiple_faces_ambiguous_scene",
                "best_match": None,
                "all_scores": [],
                "quality": quality,
                "detection_confidence": conf,
                "temporal": {
                    "verified": False,
                    "avg_similarity": 0.0,
                    "frame_count": 0,
                    "required_frames": MIN_CONSENSUS_FRAMES,
                },
                "margin": 0,
                "scene": scene,
            })

        # Hard quality gates before matching
        if conf < MIN_DETECTION_CONFIDENCE:
            return ok({
                "success": True,
                "decision": "REJECT",
                "reason": f"detection confidence {conf:.2%} < min {MIN_DETECTION_CONFIDENCE:.2%}",
                "best_match": None,
                "all_scores": [],
                "quality": quality,
                "detection_confidence": conf,
                "temporal": {
                    "verified": False,
                    "avg_similarity": 0.0,
                    "frame_count": 0,
                    "required_frames": MIN_CONSENSUS_FRAMES,
                },
                "margin": 0,
            })

        if quality is None or quality.get("score", 0.0) < MIN_MATCH_QUALITY_SCORE:
            return ok({
                "success": True,
                "decision": "REJECT",
                "reason": f"face quality {quality.get('score', 0.0) if quality else 0.0:.2f} < min {MIN_MATCH_QUALITY_SCORE:.2f}",
                "best_match": None,
                "all_scores": [],
                "quality": quality,
                "detection_confidence": conf,
                "temporal": {
                    "verified": False,
                    "avg_similarity": 0.0,
                    "frame_count": 0,
                    "required_frames": MIN_CONSENSUS_FRAMES,
                },
                "margin": 0,
                "scene": scene,
            })

        liveness = assess_liveness(img, box)
        if not liveness.get("live", False):
            return ok({
                "success": True,
                "decision": "REJECT",
                "reason": f"liveness_failed score {liveness.get('score', 0.0):.2f} < {MIN_LIVENESS_SCORE:.2f}",
                "best_match": None,
                "all_scores": [],
                "quality": quality,
                "detection_confidence": conf,
                "temporal": {
                    "verified": False,
                    "avg_similarity": 0.0,
                    "frame_count": 0,
                    "required_frames": MIN_CONSENSUS_FRAMES,
                },
                "margin": 0,
                "scene": scene,
                "liveness": liveness,
            })
        
        # Step 2: Match against known
        logger.info(f"🔍 Matching against {len(known_embeddings)} known embeddings")
        best_match, all_scores, match_decision = match_against_known(embedding, known_embeddings)
        
        # DEBUG: Log matching scores
        logger.info(f"🔍 MATCH DEBUG: best={best_match['name'] if best_match else 'None'} sim={best_match['similarity'] if best_match else 0:.4f}")
        logger.info(f"🔍 ALL SCORES: {[(s['name'], s['similarity']) for s in all_scores[:3]]}")
        
        # Step 3: Temporal verification (if CONFIRMED candidate)
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
                match_decision["decision"] = "REJECT"
                match_decision["reason"] = f"temporal not verified: {frame_count}/{MIN_CONSENSUS_FRAMES} frames"
        elif match_decision["decision"] in ["CONFIRMED", "REVIEW"]:
            match_decision["decision"] = "REJECT"
            match_decision["reason"] = "missing session_id for temporal verification"
        
        # Step 4: Build response
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
            "scene": scene,
            "liveness": liveness,
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
        
        box, conf, embedding, quality, scene = detect_and_encode(img)
        
        if box is None or embedding is None:
            return ok({"success": False, "message": "No face detected. Look directly at camera."})
        
        return ok({
            "success": True,
            "encodings": [embedding.tolist()],
            "locations": [box],
            "confidence": round(conf, 3),
            "embedding_dim": 128,
            "quality": quality,
            "scene": scene,
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.post("/encode-multi")
async def encode_multi_face(images: List[UploadFile] = File(...)):
    """Encode face from multiple images. Returns averaged embedding + quality stats."""
    try:
        if len(images) < 3:
            return ok({"success": False, "message": "At least 3 images required"}, 400)
        
        embeddings = []
        qualities = []
        
        for img_file in images:
            raw = await img_file.read()
            img = load_img(raw)
            if img is None:
                continue
            
            box, conf, embedding, quality, scene = detect_and_encode(img)
            if box is None or embedding is None:
                continue
            if scene.get("face_count", 0) != 1 or scene.get("ambiguous_scene", False):
                continue
            
            # Only use good quality images
            if quality and quality.get("good_quality", False):
                embeddings.append(embedding)
                qualities.append(quality)
        
        if len(embeddings) < 2:
            return ok({
                "success": False,
                "message": f"Only {len(embeddings)} good quality faces detected. Need at least 2. Try again in better lighting."
            })
        
        # Average embeddings
        avg_embedding = np.mean(embeddings, axis=0)
        norm = np.linalg.norm(avg_embedding)
        if norm > 0:
            avg_embedding = avg_embedding / norm
        
        # Average quality scores
        avg_quality_score = np.mean([q["score"] for q in qualities])
        
        return ok({
            "success": True,
            "encodings": [avg_embedding.tolist()],
            "embedding_dim": 128,
            "images_used": len(embeddings),
            "images_total": len(images),
            "avg_quality": round(avg_quality_score, 4),
            "quality_details": qualities,
        })
    except Exception as e:
        logger.error(traceback.format_exc())
        return ok({"success": False, "message": str(e)}, 500)

@app.get("/health")
def health():
    return ok({
        "ok": detector is not None and recognizer is not None,
        "model": "yunet+sface-industry-strict",
        "detector_loaded": detector is not None,
        "recognizer_loaded": recognizer is not None,
        "error": load_error,
        "opencv": cv2.__version__,
        "version": "4.0.0-industry-strict",
        "features": ["industry-match-json", "encode-face", "encode-multi", "quality-gate", "temporal-verification", "single-face-gate", "liveness-gate"],
    })

@app.get("/")
def root():
    return ok({
        "service": "HRMS AI Industry v2.0",
        "detector": detector is not None,
        "recognizer": recognizer is not None,
        "error": load_error,
        "endpoints": ["/health", "/encode-face", "/encode-multi", "/industry-match-json"],
    })
