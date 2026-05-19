from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["service"] == "ai"


def test_encode_face_no_image():
    response = client.post("/encode-face")
    assert response.status_code == 422


def test_match_face_matched():
    payload = {
        "known_embeddings": [[0.1] * 768, [0.9] * 768],
        "target_embedding": [0.11] * 768,
        "threshold": 0.55
    }
    response = client.post("/match-face", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "matched" in data
    assert "distance" in data
    assert "similarity" in data
    assert "matched_index" in data


def test_match_face_not_matched():
    payload = {
        "known_embeddings": [[0.1] * 768, [0.9] * 768],
        "target_embedding": [0.5] * 768,
        "threshold": 0.01
    }
    response = client.post("/match-face", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["matched"] is False


def test_batch_match():
    payload = {
        "known_embeddings": [[0.1] * 768, [0.9] * 768],
        "target_embeddings": [[0.11] * 768, [0.88] * 768],
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
        assert "similarity" in result
        assert "matched_index" in result
