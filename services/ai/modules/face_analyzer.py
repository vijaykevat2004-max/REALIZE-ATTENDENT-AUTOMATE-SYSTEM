"""
Face Analyzer module (Phase 2)
Wraps InsightFace (RetinaFace + ArcFace) for detection and recognition.
Falls back to OpenCV YuNet + SFace if InsightFace is unavailable.
"""
import logging
import os
from typing import Optional
import cv2
import numpy as np

from modules.quality import assess_quality as assess_quality_module
from modules.detector import select_primary_face
from modules.alignment import extract_landmarks

logger = logging.getLogger("hrms-ai-face-analyzer")

INSIGHTFACE_AVAILABLE = False
try:
    import insightface
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    pass


class FaceAnalyzer:
    def __init__(
        self,
        quality_blur_min=50.0,
        quality_bright_min=30.0,
        quality_bright_max=230.0,
        quality_face_min_size=60,
        max_second_face_score_ratio=0.92,
    ):
        self.quality_blur_min = quality_blur_min
        self.quality_bright_min = quality_bright_min
        self.quality_bright_max = quality_bright_max
        self.quality_face_min_size = quality_face_min_size
        self.max_second_face_score_ratio = max_second_face_score_ratio

        self.mode = "opencv_strict"
        self.insightface_app = None
        self.detector = None
        self.recognizer = None
        self.load_error = ""

    def initialize(self, yunet_path, sface_path):
        if INSIGHTFACE_AVAILABLE:
            try:
                self.insightface_app = FaceAnalysis(
                    name='buffalo_l',
                    providers=['CPUExecutionProvider'],
                )
                self.insightface_app.prepare(ctx_id=-1, det_size=(640, 640))
                logger.info("✅ InsightFace (buffalo_l) loaded successfully")
                self.mode = "insightface_strict"
                return
            except Exception as e:
                logger.warning(f"InsightFace init failed: {e}, falling back to OpenCV")
                self.insightface_app = None

        try:
            self.detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320), 0.9, 0.3, 5000)
            logger.info("✅ YuNet detector created")
        except Exception as e:
            self.load_error += f"YuNet: {e}. "
            logger.error(f"❌ YuNet failed: {e}")

        try:
            self.recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
            logger.info("✅ SFace recognizer created")
        except Exception as e:
            self.load_error += f"SFace: {e}. "
            logger.error(f"❌ SFace failed: {e}")

        if self.detector is None or self.recognizer is None:
            self.mode = "failed"
            logger.error(f"❌ Both modes failed: {self.load_error}")
        else:
            self.mode = "opencv_strict"
            logger.info("✅ OpenCV models loaded! Industry-grade system ready.")

    def is_ready(self):
        return self.mode != "failed"

    def detect_and_encode(self, img):
        if self.mode == "insightface_strict":
            return self._detect_and_encode_insightface(img)
        elif self.mode == "opencv_strict":
            return self._detect_and_encode_opencv(img)
        else:
            return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

    def _detect_and_encode_insightface(self, img):
        try:
            h, w = img.shape[:2]
            if h < 30 or w < 30:
                return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            faces = self.insightface_app.get(img_rgb)

            if faces is None or len(faces) == 0:
                return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

            face_count = len(faces)
            ambiguous_scene = False

            if face_count > 1:
                cx, cy = w / 2.0, h / 2.0
                scored = []
                for f in faces:
                    bbox = f.bbox.astype(float)
                    fx, fy = bbox[0], bbox[1]
                    fw_val = bbox[2] - bbox[0]
                    fh_val = bbox[3] - bbox[1]
                    conf = float(f.det_score)
                    fcx, fcy = fx + fw_val / 2.0, fy + fh_val / 2.0
                    center_dist = ((fcx - cx) ** 2 + (fcy - cy) ** 2) ** 0.5
                    center_norm = center_dist / max((cx**2 + cy**2) ** 0.5, 1.0)
                    area_norm = min((fw_val * fh_val) / float(max(w * h, 1)), 1.0)
                    scene_score = (0.50 * conf) + (0.35 * (1.0 - center_norm)) + (0.15 * area_norm)
                    scored.append((scene_score, f))

                scored.sort(key=lambda x: x[0], reverse=True)
                best = scored[0][1]

                if len(scored) > 1:
                    top = scored[0][0]
                    second = scored[1][0]
                    if top > 0 and (second / top) >= self.max_second_face_score_ratio:
                        ambiguous_scene = True
            else:
                best = faces[0]

            conf = float(best.det_score)

            embedding = best.embedding.astype(np.float32)
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            bbox = best.bbox.astype(int)
            box = [int(bbox[0]), int(bbox[1]), int(bbox[2] - bbox[0]), int(bbox[3] - bbox[1])]

            quality = assess_quality_module(
                img, box,
                self.quality_blur_min,
                self.quality_bright_min,
                self.quality_bright_max,
                self.quality_face_min_size,
            )

            return box, conf, embedding, quality, {
                "face_count": face_count,
                "ambiguous_scene": ambiguous_scene,
            }

        except Exception as e:
            logger.error(f"InsightFace error: {e}")
            return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

    def _detect_and_encode_opencv(self, img):
        if self.detector is None or self.recognizer is None:
            return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

        h, w = img.shape[:2]
        if h < 30 or w < 30:
            return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)

        if faces is None or len(faces) == 0:
            return None, 0, None, None, {"face_count": 0, "ambiguous_scene": False}

        best, scene = select_primary_face(faces, w, h, self.max_second_face_score_ratio)
        face_count = scene["face_count"]
        ambiguous_scene = scene["ambiguous_scene"]

        conf = float(best[14])

        quality = assess_quality_module(
            img, best,
            self.quality_blur_min,
            self.quality_bright_min,
            self.quality_bright_max,
            self.quality_face_min_size,
        )

        landmarks = extract_landmarks(best)
        aligned = self.recognizer.alignCrop(img, landmarks)
        embedding = self.recognizer.feature(aligned)

        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm

        box = [int(best[0]), int(best[1]), int(best[2]), int(best[3])]
        return box, conf, embedding.flatten().astype(np.float32), quality, {
            "face_count": face_count,
            "ambiguous_scene": ambiguous_scene,
        }
