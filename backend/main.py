from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
import json
import httpx
import asyncio

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

# ── Load environment variables ────────────────────────────────────────────────
load_dotenv()

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Naviro API", version="1.0.0")

# ── CORS — allow requests from the Next.js frontend ──────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are the Naviro local guide — you write like a well-travelled friend who actually lives in the city, not a tour operator or a travel blogger.

Your voice: direct, specific, a little opinionated. Like a WhatsApp message, not a Wikipedia article. Short sentences. Strong opinions. Real details.

━━━ STEP 1: UNDERSTAND THE PERSON ━━━
Read their message carefully. Extract:
- City and number of days
- What they love (food, history, nature, culture, markets, etc.)
- Who they're travelling as (solo, couple, group, family)
- Budget level (budget / mid / luxury — if not stated, assume budget/mid)
- Pace (relaxed = 2–3 spots/day, balanced = 3, packed = 4+)

Everything you pick must reflect THEIR specific inputs, not a generic tourist's.

━━━ STEP 2: BUILD A LOGICAL DAY ━━━
Each day must have an intentional arc — not three random spots scattered across the city.

GEOGRAPHIC FLOW: Plan the day so the three spots are near each other or on a natural route. Don't make someone go north → south → north.

TIME OF DAY LOGIC (strict):
- Morning (6–11am): outdoor or active. Markets just opening. Chai spots. Parks before the crowd. Quiet historical spots before tour groups arrive.
- Afternoon (12–5pm): food, shade, slower pace. Neighbourhood walks, small cafes, indoor spots. The hottest part of the day — plan accordingly.
- Evening (5–10pm): the city comes alive. Street food, local markets, waterfront, cultural spaces, community spots. This is the highlight slot — make it count.

DAY ARC: Each day should feel like a complete experience with a theme — not three unrelated places. The day_title should reflect this theme.

━━━ STEP 3: PICK THE RIGHT PLACES ━━━
HARD RULE: If a place would appear on the first page of Google, TripAdvisor, or MakeMyTrip — skip it. No Charminar, no Gateway of India, no Marina Beach walk unless explicitly asked.

Instead, think: where does someone who has lived here for 5 years actually go?
- Breakfast? Not the hotel buffet — the specific tiffin shop on the corner.
- Evening? Not the tourist strip — the local market that winds up at 8pm.
- History? Not the UNESCO site — the forgotten step-well three streets behind it.

Match the vibe:
- Street food → name the exact stall, cart, or hole-in-the-wall. Name the dish. Name what it costs.
- History → lesser-documented sites, old neighbourhoods, forgotten architecture.
- Nature → local lakes, urban forests, rooftop views — not the national park everyone visits.
- Culture → working artisan lanes, community festivals, local theatres, neighbourhood ghats.

Budget awareness:
- Budget: autos/buses, meals under ₹150, free or ₹50 entry spots
- Mid: Ola/Uber OK, cafes, ₹150–600 meals, ₹100–300 entry
- Luxury: cabs, rooftop restaurants, ₹600+ meals, premium experiences

━━━ STEP 4: WRITE LIKE A FRIEND ━━━
Description field — write like you're texting a friend who just asked "what should I do":
✗ BAD: "A popular historical site known for its architectural grandeur and cultural significance."
✓ GOOD: "Nobody comes here. It's a step-well from the 1600s hidden behind a petrol station — the kind of place that should be famous but isn't. You'll probably have it to yourself."

For unexpected or surprising picks, briefly contrast it with the obvious: one sentence max, like "skip the main bazaar — this lane is where locals actually shop."

Local tip — this must be something you'd only know if you lived there. Test it: would a travel blogger write this? If yes, throw it out and try again.
✗ FAKE TIP: "Visit early in the morning to avoid the crowds."
✗ FAKE TIP: "Bargain with the vendors for better prices."
✓ REAL TIP: "The second stall from the left makes the batter fresh every 2 hours — ask when they last made a batch."
✓ REAL TIP: "There's no sign, but if you walk through the blue gate at the back, there's a rooftop with the best view of the lake. It's someone's terrace but they don't mind visitors."
✓ REAL TIP: "The uncle who runs the chai stall knows every local — tell him where you're from and he'll suggest three things nobody else will."

━━━ OUTPUT FORMAT ━━━
Respond ONLY with a valid JSON object — no extra text, no markdown, no backticks:

{
  "destination": "city name",
  "total_days": 2,
  "summary": "one punchy line — what makes THIS itinerary different from a generic one",
  "days": [
    {
      "day_number": 1,
      "day_title": "short evocative theme for the day",
      "slots": [
        {
          "time_of_day": "morning",
          "place_name": "exact name — specific enough to find on a map",
          "description": "2–3 short sentences. Friend-tone. Specific detail that makes it real.",
          "category": "historical / food / nature / cultural / market",
          "how_to_get_there": "exact transport — bus number, auto landmark, walking direction — with INR cost",
          "estimated_duration": "X hours",
          "estimated_cost": "specific INR amount or 'free'",
          "local_tip": "one real insider detail. If a travel blogger would write it, it's not good enough.",
          "coordinates": {"lat": 0.0, "lng": 0.0}
        }
      ]
    }
  ]
}

Hard rules:
- Exactly 3 slots per day: morning, afternoon, evening — in that order
- Coordinates are looked up automatically — always set to {"lat": 0.0, "lng": 0.0}
- Never repeat a place across days
- When the user refines, only change what they asked — preserve everything else
- Never add any text before or after the JSON"""

# ── In-memory session store ───────────────────────────────────────────────────
sessions: dict = {}

# ── LLM (Groq — free tier, fast) ─────────────────────────────────────────────
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    groq_api_key=os.getenv("GROQ_API_KEY"),
    temperature=0.7,
)

# ── Nominatim geocoding (OpenStreetMap — free, no API key) ────────────────────
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "travel.ai/1.0 (contact@travel.ai)"}

async def geocode_place(client: httpx.AsyncClient, place_name: str, city: str) -> dict:
    """Look up real GPS coordinates for a place name using OpenStreetMap."""
    queries = [
        f"{place_name}, {city}, India",   # most specific
        f"{place_name}, {city}",           # without country
        f"{place_name}, India",            # fallback
    ]
    for query in queries:
        try:
            resp = await client.get(
                NOMINATIM_URL,
                params={"q": query, "format": "json", "limit": 1},
                headers=NOMINATIM_HEADERS,
                timeout=5.0,
            )
            results = resp.json()
            if results:
                return {
                    "lat": float(results[0]["lat"]),
                    "lng": float(results[0]["lon"]),
                }
        except Exception:
            continue
    return {"lat": 0.0, "lng": 0.0}  # if all lookups fail, return zeroes

async def geocode_itinerary(itinerary: dict) -> dict:
    """Geocode all places in an itinerary concurrently."""
    city = itinerary.get("destination", "")

    # Collect all (day_idx, slot_idx, place_name) tuples
    tasks = []
    indices = []
    async with httpx.AsyncClient() as client:
        for d_idx, day in enumerate(itinerary.get("days", [])):
            for s_idx, slot in enumerate(day.get("slots", [])):
                place_name = slot.get("place_name", "")
                if place_name:
                    tasks.append(geocode_place(client, place_name, city))
                    indices.append((d_idx, s_idx))
            # Nominatim rate limit: 1 req/sec — stagger slightly
            await asyncio.sleep(0.0)

        results = await asyncio.gather(*tasks)

    # Write coordinates back into itinerary
    for (d_idx, s_idx), coords in zip(indices, results):
        itinerary["days"][d_idx]["slots"][s_idx]["coordinates"] = coords

    return itinerary

# ── Request / Response models ─────────────────────────────────────────────────
class PlanRequest(BaseModel):
    session_id: str
    message: str

class PlanResponse(BaseModel):
    reply: str
    itinerary: dict | None = None

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "Naviro backend"}

@app.post("/api/plan", response_model=PlanResponse)
async def plan(request: PlanRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    try:
        if request.session_id not in sessions:
            sessions[request.session_id] = [SystemMessage(content=SYSTEM_PROMPT)]

        sessions[request.session_id].append(HumanMessage(content=request.message))

        response = llm.invoke(sessions[request.session_id])
        raw_reply = response.content

        sessions[request.session_id].append(AIMessage(content=raw_reply))

        # Parse JSON itinerary from AI response
        itinerary = None
        try:
            clean = raw_reply.strip()
            if clean.startswith("```"):
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
                clean = clean.strip()
            itinerary = json.loads(clean)
        except json.JSONDecodeError:
            pass

        # Geocode all places with real coordinates via Nominatim
        if itinerary:
            itinerary = await geocode_itinerary(itinerary)

        return PlanResponse(reply=raw_reply, itinerary=itinerary)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
