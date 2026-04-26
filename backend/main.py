from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
import json
import httpx
import asyncio
import logging
import math

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("naviro")

# ── Load environment variables ────────────────────────────────────────────────
load_dotenv()

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Naviro API", version="1.0.0")

# ── CORS — allow requests from the Next.js frontend ──────────────────────────
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]

# Optional convenience var for hosting setups (Vercel, Netlify, etc.)
_frontend_url = os.getenv("FRONTEND_URL", "").strip()
if _frontend_url and _frontend_url not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(_frontend_url)

_allow_credentials = True
if "*" in ALLOWED_ORIGINS:
    # Credentials can't be used with wildcard origins; keep CORS valid.
    _allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",  # allow all Vercel preview URLs
    allow_credentials=_allow_credentials,
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
- Every place must be inside the requested destination city/town (or its immediate outskirts), never from another city
- Coordinates are looked up automatically — always set to {"lat": 0.0, "lng": 0.0}
- Never repeat a place across days
- When the user refines, only change what they asked — preserve everything else
- Never add any text before or after the JSON"""

# ── In-memory session store ───────────────────────────────────────────────────
sessions: dict = {}

# ── LLM (Groq — free tier, fast) ─────────────────────────────────────────────
_groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
llm = None
if _groq_api_key:
    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        groq_api_key=_groq_api_key,
        temperature=0.7,
    )

# ── Google Maps / Places geocoding ───────────────────────────────────────────
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
GOOGLE_GEOCODE_URL  = "https://maps.googleapis.com/maps/api/geocode/json"
GOOGLE_PLACES_URL   = "https://maps.googleapis.com/maps/api/place/textsearch/json"


def _distance_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    """Haversine distance in kilometers."""
    r = 6371.0
    dlat = math.radians(b_lat - a_lat)
    dlng = math.radians(b_lng - a_lng)
    x = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(a_lat))
        * math.cos(math.radians(b_lat))
        * math.sin(dlng / 2) ** 2
    )
    return 2 * r * math.atan2(math.sqrt(x), math.sqrt(1 - x))


async def geocode_city_center(client: httpx.AsyncClient, city: str) -> dict:
    """Resolve the destination city center using Google Geocoding API."""
    try:
        resp = await client.get(
            GOOGLE_GEOCODE_URL,
            params={"address": f"{city}, India", "key": GOOGLE_MAPS_API_KEY},
            timeout=8.0,
        )
        data = resp.json()
        status = data.get("status")
        logger.info("Geocoding API city center [%s] status=%s", city, status)
        if status == "REQUEST_DENIED":
            logger.error("Geocoding API key rejected: %s", data.get("error_message", "no message"))
        if status == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return {"lat": loc["lat"], "lng": loc["lng"]}
    except Exception as e:
        logger.warning("City center geocoding failed for '%s': %s", city, e)
    return {"lat": 0.0, "lng": 0.0}


async def geocode_place(
    client: httpx.AsyncClient, place_name: str, city: str, city_center: dict
) -> dict:
    """Look up precise GPS coordinates using Google Places Text Search API."""
    queries = [
        f"{place_name} {city}",
        f"{place_name} {city} India",
        f"{place_name} India",
    ]
    for query in queries:
        try:
            resp = await client.get(
                GOOGLE_PLACES_URL,
                params={"query": query, "key": GOOGLE_MAPS_API_KEY},
                timeout=8.0,
            )
            data = resp.json()
            status = data.get("status")
            logger.info("Places API [%s] status=%s", query, status)

            if status == "REQUEST_DENIED":
                logger.error("Places API key rejected: %s", data.get("error_message", "no message"))
                break  # key issue — no point retrying

            if status == "OK" and data.get("results"):
                loc = data["results"][0]["geometry"]["location"]
                lat, lng = loc["lat"], loc["lng"]

                if (
                    city_center["lat"] != 0.0
                    and city_center["lng"] != 0.0
                    and _distance_km(city_center["lat"], city_center["lng"], lat, lng) > 70
                ):
                    logger.warning("Places result for '%s' too far from '%s' — skipping", place_name, city)
                    continue

                return {"lat": lat, "lng": lng}
        except Exception as e:
            logger.warning("Places geocoding error for '%s': %s", place_name, e)
            continue
    return {"lat": 0.0, "lng": 0.0}

async def geocode_itinerary(itinerary: dict) -> dict:
    """Geocode all places in an itinerary using Google Places API (parallel)."""
    city = itinerary.get("destination", "")
    async with httpx.AsyncClient() as client:
        city_center = await geocode_city_center(client, city)
        if city_center["lat"] == 0.0 and city_center["lng"] == 0.0:
            logger.warning("Could not resolve city center for '%s'", city)

        # Build a flat list of (d_idx, s_idx, place_name) to geocode
        tasks = []
        for d_idx, day in enumerate(itinerary.get("days", [])):
            for s_idx, slot in enumerate(day.get("slots", [])):
                place_name = slot.get("place_name", "")
                if place_name:
                    tasks.append((d_idx, s_idx, place_name))

        # Fire all geocode requests in parallel — Google has no rate-limit concern here
        results = await asyncio.gather(
            *[geocode_place(client, place_name, city, city_center)
              for _, _, place_name in tasks],
            return_exceptions=True,
        )

        for (d_idx, s_idx, place_name), coords in zip(tasks, results):
            if isinstance(coords, Exception) or (
                isinstance(coords, dict)
                and coords["lat"] == 0.0
                and coords["lng"] == 0.0
            ):
                # Fallback: scatter slightly around city center so pins are visible
                if city_center["lat"] != 0.0:
                    offsets = [(-0.012, -0.008), (0.010, 0.006), (0.004, -0.011)]
                    lat_off, lng_off = offsets[s_idx % len(offsets)]
                    coords = {
                        "lat": city_center["lat"] + lat_off + d_idx * 0.0015,
                        "lng": city_center["lng"] + lng_off + d_idx * 0.0015,
                    }
                    logger.warning(
                        "Fallback coords used for '%s' in '%s' (day %s slot %s)",
                        place_name, city, d_idx + 1, s_idx + 1,
                    )
                else:
                    coords = {"lat": 0.0, "lng": 0.0}

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
    return {
        "status": "ok",
        "service": "Naviro backend",
        "groq_configured": llm is not None,
    }

@app.post("/api/plan", response_model=PlanResponse)
async def plan(request: PlanRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if llm is None:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: GROQ_API_KEY is not set on the backend.",
        )

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

        # Geocode all places with precise coordinates via Google Places API
        if itinerary:
            itinerary = await geocode_itinerary(itinerary)

        return PlanResponse(reply=raw_reply, itinerary=itinerary)

    except Exception as e:
        logger.exception("Unhandled error in /api/plan")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")
