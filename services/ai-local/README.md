# Industry-Grade Face AI Service v1.0

Zero False Positives - Only Registered Faces Accepted

## Quick Start (PC Testing)

1. Install Python 3.10+
2. Run: `start.bat` (Windows) or `./start.sh` (Linux/Mac)
3. Service starts at: http://localhost:8000
4. Health check: http://localhost:8000/health

## Raspberry Pi Deployment

1. Install Raspberry Pi OS (64-bit)
2. Install dependencies:
   ```bash
   sudo apt update
   sudo apt install -y python3-pip python3-opencv libatlas-base-dev
   pip3 install -r requirements.txt
   ```
3. Copy ONNX models from `../ai/` folder
4. Run: `uvicorn main:app --host 0.0.0.0 --port 8000`

## Features

- **Quality Gate**: Blur, brightness, face size, contrast checks
- **Dynamic Thresholds**: Auto-adjust based on employee count
- **Temporal Verification**: 5-frame consensus in 8-second window
- **Margin Check**: Rejects ambiguous matches (too close to another person)
- **Zero False Positives**: Only registered faces accepted

## Thresholds

| Metric | Value |
|---|---|
| Base Threshold | 0.82 (82%) |
| Confirmed Threshold | 0.88 (88%) |
| Review Threshold | 0.82 (82%) |
| Margin Threshold | 0.12 (12%) |
| Consensus Frames | 5 |
| Consensus Avg | 0.85 (85%) |

## API Endpoints

- `GET /health` - Health check
- `POST /encode-face` - Encode face from image
- `POST /industry-match` - Industry-grade matching with quality gates

## Industry-Match Response

```json
{
  "success": true,
  "decision": "CONFIRMED",
  "reason": "temporal verified: 5 frames, avg sim 0.89",
  "best_match": {
    "employee_id": "emp123",
    "name": "John Doe",
    "similarity": 0.91
  },
  "all_scores": [...],
  "quality": {
    "score": 0.85,
    "blur": 120.5,
    "brightness": 125.3,
    "good_quality": true
  },
  "temporal": {
    "verified": true,
    "avg_similarity": 0.89,
    "frame_count": 5,
    "required_frames": 5
  }
}
```

## Decision Logic

1. **Quality Gate** → Reject if blur/dark/small face
2. **Similarity Check** → Reject if < 82%
3. **Margin Check** → Reject if margin < 12% (ambiguous)
4. **Temporal Verification** → Require 5 consistent frames
5. **Final Decision**:
   - `CONFIRMED`: ≥88% + temporal verified → Auto-accept
   - `REVIEW`: 82-88% → Manual review needed
   - `REJECT`: <82% or quality failed → Auto-deny
