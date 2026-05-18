from fastapi.testclient import TestClient
from unittest.mock import patch
import numpy as np

from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["service"] == "ai"
    assert data["model"] == "face_recognition"


def test_encode_face_no_face():
    with patch("main.image_to_array") as mock_img, patch("main.face_recognition.face_locations") as mock_loc:
        mock_img.return_value = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_loc.return_value = []
        response = client.post("/encode-face", files={"image": b"fake_image_bytes"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["message"] == "No face detected"


def test_encode_face_with_face():
    fake_encoding = np.random.rand(128).tolist()
    with patch("main.image_to_array") as mock_img, \
         patch("main.face_recognition.face_locations") as mock_loc, \
         patch("main.face_recognition.face_encodings") as mock_enc:
        mock_img.return_value = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_loc.return_value = [(0, 50, 50, 0)]
        mock_enc.return_value = [np.array(fake_encoding)]
        response = client.post("/encode-face", files={"image": b"fake_image_bytes"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["faces"] == 1
        assert len(data["encodings"]) == 1


def test_match_face_matched():
    payload = {
        "known_embeddings": [[0.1] * 128, [0.9] * 128],
        "target_embedding": [0.11] * 128,
        "threshold": 0.55
    }
    response = client.post("/match-face", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "matched" in data
    assert "distance" in data
    assert "confidence" in data
    assert "matched_index" in data


def test_match_face_not_matched():
    payload = {
        "known_embeddings": [[0.1] * 128, [0.9] * 128],
        "target_embedding": [0.5] * 128,
        "threshold": 0.01
    }
    response = client.post("/match-face", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["matched"] is False


def test_batch_match():
    payload = {
        "known_embeddings": [[0.1] * 128, [0.9] * 128],
        "target_embeddings": [[0.11] * 128, [0.88] * 128],
        "threshold": 0.55
    }
    response = client.post("/batch-match", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert len(data["results"]) == 2
    for result in data["results"]:
        assert "matched" in result
        assert "distance" in result
        assert "confidence" in result
        assert "matched_index" in result


def test_anti_spoof():
    response = client.post("/anti-spoof", files={"image": b"fake_image_bytes"})
    assert response.status_code == 200
    data = response.json()
    assert data["real"] is True
    assert data["confidence"] == 0.95
    assert data["method"] == "none"


def test_detect_faces():
    with patch("main.image_to_array") as mock_img, \
         patch("main.face_recognition.face_locations") as mock_loc:
        mock_img.return_value = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_loc.return_value = [(0, 50, 50, 0), (10, 60, 60, 10)]
        response = client.post("/detect-faces", files={"image": b"fake_image_bytes"})
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert len(data["locations"]) == 2


def test_watermark_image():
    response = client.post(
        "/watermark-image",
        files={"image": b"fake_image_bytes"},
        params={
            "employee_name": "John Doe",
            "site_name": "HQ",
            "timestamp": "2026-01-01T00:00:00Z",
            "lat": "19.0760",
            "lng": "72.8777"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "watermarked_image" in data
