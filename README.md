# Naviro

AI-powered travel guide — instant, hyper-local itineraries for anyone new to a place in India.

## Project Structure

```
travel-ai/
  ├── frontend/     Next.js (React + TypeScript + Tailwind)
  └── backend/      Python FastAPI + LangChain + Groq (Llama 3.3)
```

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate       # Mac/Linux
venv\Scripts\activate          # Windows

pip install -r requirements.txt

cp .env.example .env
# Edit .env and add your GROQ_API_KEY

uvicorn main:app --reload
# Runs at http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs at http://localhost:3000
```

## API Keys Needed
- **Groq API** (free): https://console.groq.com
- **OpenStreetMap Nominatim** — no key needed (geocoding)
