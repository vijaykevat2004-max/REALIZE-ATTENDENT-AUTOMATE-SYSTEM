"""Detector module placeholder for Phase 2 (RetinaFace migration)."""


def select_primary_face(faces, frame_width, frame_height, second_face_ratio):
    if not faces:
        return None, {"face_count": 0, "ambiguous_scene": False}

    cx, cy = (frame_width / 2.0), (frame_height / 2.0)
    scored = []
    for f in faces:
        fx, fy, fw, fh = [float(v) for v in f[:4]]
        conf = float(f[14])
        fcx, fcy = fx + fw / 2.0, fy + fh / 2.0
        center_dist = ((fcx - cx) ** 2 + (fcy - cy) ** 2) ** 0.5
        center_norm = center_dist / max((cx**2 + cy**2) ** 0.5, 1.0)
        area_norm = min((fw * fh) / float(max(frame_width * frame_height, 1)), 1.0)
        scene_score = (0.50 * conf) + (0.35 * (1.0 - center_norm)) + (0.15 * area_norm)
        scored.append((scene_score, f))

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0][1]
    ambiguous = False
    if len(scored) > 1:
        top = scored[0][0]
        second = scored[1][0]
        if top > 0 and (second / top) >= second_face_ratio:
            ambiguous = True

    return best, {"face_count": len(faces), "ambiguous_scene": ambiguous}
