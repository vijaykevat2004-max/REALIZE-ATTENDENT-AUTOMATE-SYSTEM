import cv2
import numpy as np


def assess_liveness(img, face_box, min_liveness_score):
    x, y, w, h = [int(v) for v in face_box[:4]]
    x, y = max(0, x), max(0, y)
    roi = img[y:y + h, x:x + w]
    if roi.size == 0:
        return {"score": 0.0, "issues": ["no_face_roi"], "live": False}

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    texture_score = min(lap_var / 180.0, 1.0)

    p5 = float(np.percentile(gray, 5))
    p95 = float(np.percentile(gray, 95))
    spread = max(0.0, p95 - p5)
    spread_score = min(spread / 100.0, 1.0)

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
        "live": score >= min_liveness_score and len(issues) <= 1,
    }
