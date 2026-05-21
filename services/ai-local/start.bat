@echo off
echo ========================================
echo Industry-Grade Face AI Service v1.0
echo Starting local AI server...
echo ========================================
echo.

cd /d "%~dp0"

echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Starting AI service on http://localhost:8000
echo Press Ctrl+C to stop
echo.

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
