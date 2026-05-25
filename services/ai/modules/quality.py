import cv2
import numpy as np


def assess_quality(img, face_box, blur_min, bright_min, bright_max, face_min_size):
    x, y, w, h = [int(v) for v in face_box[:4]]
    x, y = max(0, x), max(0, y)
    face_roi = img[y:y + h, x:x + w]

    if face_roi.size == 0:
        return {
            "score": 0.0,
            "blur": 0.0,
            "brightness": 0.0,
            "face_size": 0,
            "issues": ["no_face_roi"],
            "good_quality": False,
        }

    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness = np.mean(gray)
    face_size = max(w, h)
    contrast = np.std(gray)

    issues = []
    if blur_score < blur_min:
        issues.append("blurry")
    if brightness < bright_min:
        issues.append("too_dark")
    if brightness > bright_max:
        issues.append("too_bright")
    if face_size < face_min_size:
        issues.append("face_too_small")
    if contrast < 15:
        issues.append("low_contrast")

    blur_norm = min(blur_score / 150.0, 1.0)
    size_norm = min(face_size / 250.0, 1.0)
    brightness_norm = 1.0 - abs(brightness - 127.0) / 127.0
    contrast_norm = min(contrast / 40.0, 1.0)
    quality_score = 0.35 * blur_norm + 0.25 * size_norm + 0.20 * brightness_norm + 0.20 * contrast_norm

    return {
        "score": round(float(quality_score), 4),
        "blur": round(float(blur_score), 2),
        "brightness": round(float(brightness), 2),
        "contrast": round(float(contrast), 2),
        "face_size": face_size,
        "issues": issues,
        "good_quality": len(issues) == 0,
    }
