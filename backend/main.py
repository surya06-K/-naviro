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

from database import init_db, get_db

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("naviro")

# ── Load environment variables ────────────────────────────────────────────────
load_dotenv()

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Naviro API", version="2.0.0")

# ── Init database ─────────────────────────────────────────────────────────────
init_db()

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
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_CONCURRENCY = int(os.getenv("NOMINATIM_CONCURRENCY", "2") or "2")
_nominatim_semaphore = asyncio.Semaphore(_NOMINATIM_CONCURRENCY)
_geocode_cache: dict[str, dict] = {}
_nominatim_headers = {
    # Nominatim requires a valid User-Agent; keep it stable and specific.
    "User-Agent": "naviro/1.0 (travel.ai)",
}
MAX_PLACE_DISTANCE_KM = float(os.getenv("MAX_PLACE_DISTANCE_KM", "35") or "35")


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


async def _nominatim_geocode(client: httpx.AsyncClient, query: str) -> dict:
    cache_key = f"nominatim::{query}"
    cached = _geocode_cache.get(cache_key)
    if cached is not None:
        return cached

    # Be polite to Nominatim: limit concurrency and add a tiny delay.
    async with _nominatim_semaphore:
        await asyncio.sleep(0.15)
        try:
            resp = await client.get(
                NOMINATIM_SEARCH_URL,
                params={"q": query, "format": "json", "limit": 1, "addressdetails": 0},
                headers=_nominatim_headers,
                timeout=8.0,
            )
            data = resp.json()
            if isinstance(data, list) and data:
                lat = float(data[0].get("lat", 0.0) or 0.0)
                lng = float(data[0].get("lon", 0.0) or 0.0)
                coords = {"lat": lat, "lng": lng}
                _geocode_cache[cache_key] = coords
                return coords
        except Exception as e:
            logger.warning("Nominatim geocoding error for '%s': %s", query, e)

    coords = {"lat": 0.0, "lng": 0.0}
    _geocode_cache[cache_key] = coords
    return coords


async def geocode_city_center(client: httpx.AsyncClient, city: str) -> dict:
    """Resolve the destination city center using Google Geocoding API (fallback: Nominatim)."""
    try:
        if not GOOGLE_MAPS_API_KEY:
            return await _nominatim_geocode(client, f"{city}, India")

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
            return await _nominatim_geocode(client, f"{city}, India")
        if status == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return {"lat": loc["lat"], "lng": loc["lng"]}
    except Exception as e:
        logger.warning("City center geocoding failed for '%s': %s", city, e)
        if not GOOGLE_MAPS_API_KEY:
            return await _nominatim_geocode(client, f"{city}, India")
    return {"lat": 0.0, "lng": 0.0}


async def geocode_place(
    client: httpx.AsyncClient, place_name: str, city: str, city_center: dict
) -> dict:
    """Look up precise GPS coordinates using Google Places Text Search API (fallback: Nominatim)."""
    queries = [
        f"{place_name} {city}",
        f"{place_name} {city} India",
        f"{place_name} India",
    ]

    # If Google isn't configured, go straight to the fallback.
    if not GOOGLE_MAPS_API_KEY:
        for query in [
            f"{place_name}, {city}, India",
            f"{place_name}, {city}",
            f"{place_name}, India",
        ]:
            coords = await _nominatim_geocode(client, query)
            if coords["lat"] == 0.0 and coords["lng"] == 0.0:
                continue
            if (
                city_center.get("lat", 0.0) != 0.0
                and city_center.get("lng", 0.0) != 0.0
                and _distance_km(city_center["lat"], city_center["lng"], coords["lat"], coords["lng"]) > 120
            ):
                continue
            return coords
        return {"lat": 0.0, "lng": 0.0}
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
                    and _distance_km(city_center["lat"], city_center["lng"], lat, lng) > MAX_PLACE_DISTANCE_KM
                ):
                    logger.warning("Places result for '%s' too far from '%s' — skipping", place_name, city)
                    continue

                return {"lat": lat, "lng": lng}
        except Exception as e:
            logger.warning("Places geocoding error for '%s': %s", place_name, e)
            continue

    # Fallback: Nominatim
    for query in [
        f"{place_name}, {city}, India",
        f"{place_name}, {city}",
        f"{place_name}, India",
    ]:
        coords = await _nominatim_geocode(client, query)
        if coords["lat"] == 0.0 and coords["lng"] == 0.0:
            continue
        if (
            city_center.get("lat", 0.0) != 0.0
            and city_center.get("lng", 0.0) != 0.0
            and _distance_km(city_center["lat"], city_center["lng"], coords["lat"], coords["lng"]) > MAX_PLACE_DISTANCE_KM
        ):
            continue
        return coords
    return {"lat": 0.0, "lng": 0.0}


def _find_slots_outside_radius(itinerary: dict, city_center: dict) -> list[dict]:
    """Return slots whose coordinates are too far from the destination center."""
    if (
        not city_center
        or city_center.get("lat", 0.0) == 0.0
        or city_center.get("lng", 0.0) == 0.0
    ):
        return []

    offenders: list[dict] = []
    for d_idx, day in enumerate(itinerary.get("days", [])):
        for slot in (day or {}).get("slots", []):
            coords = (slot or {}).get("coordinates") or {}
            lat = coords.get("lat", 0.0) or 0.0
            lng = coords.get("lng", 0.0) or 0.0
            if lat == 0.0 and lng == 0.0:
                continue
            distance_km = _distance_km(
                city_center["lat"], city_center["lng"], float(lat), float(lng)
            )
            if distance_km > MAX_PLACE_DISTANCE_KM:
                offenders.append(
                    {
                        "day_number": (day or {}).get("day_number", d_idx + 1),
                        "time_of_day": (slot or {}).get("time_of_day", ""),
                        "place_name": (slot or {}).get("place_name", ""),
                        "distance_km": round(distance_km, 1),
                    }
                )
    return offenders


async def _repair_itinerary_far_places(itinerary: dict, offenders: list[dict]) -> dict | None:
    """Ask the LLM to replace out-of-town picks with local alternatives (JSON-only)."""
    if llm is None or not offenders:
        return None

    repair_prompt = """You are repairing a travel itinerary JSON.

Some places are NOT inside the destination town/city (they geocode far away). Replace ONLY those slots with better local alternatives inside the destination town/city or immediate outskirts (<= 20 km). Keep everything else unchanged.

Hard rules:
- Output ONLY valid JSON (no markdown, no backticks).
- Preserve: destination, total_days, day_number/day_title structure, and time_of_day values.
- For each offender slot: change place_name/description/how_to_get_there/estimated_* /local_tip to match the new local place.
- Never include a place from another city (no day trips) unless the user explicitly asked.
- Coordinates must always be {"lat": 0.0, "lng": 0.0}.
"""

    try:
        response = llm.invoke(
            [
                SystemMessage(content=repair_prompt),
                HumanMessage(
                    content=json.dumps(
                        {"itinerary": itinerary, "offenders": offenders},
                        ensure_ascii=False,
                    )
                ),
            ]
        )
        clean = (response.content or "").strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()
        return json.loads(clean)
    except Exception as e:
        logger.warning("Itinerary repair failed: %s", e)
        return None


async def geocode_itinerary_with_repair(itinerary: dict) -> dict:
    """Geocode, then repair out-of-town slots once and geocode again."""
    itinerary = await geocode_itinerary(itinerary)

    city = itinerary.get("destination", "")
    async with httpx.AsyncClient() as client:
        city_center = await geocode_city_center(client, city)

    offenders = _find_slots_outside_radius(itinerary, city_center)
    if not offenders:
        return itinerary

    logger.warning("Out-of-town slots detected for '%s': %s", city, offenders)

    repaired = await _repair_itinerary_far_places(itinerary, offenders)
    if not repaired:
        return itinerary

    return await geocode_itinerary(repaired)

async def geocode_itinerary(itinerary: dict) -> dict:
    """Geocode all places in an itinerary using Google Places API (fallback: Nominatim)."""
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
            itinerary = await geocode_itinerary_with_repair(itinerary)

        return PlanResponse(reply=raw_reply, itinerary=itinerary)

    except Exception as e:
        logger.exception("Unhandled error in /api/plan")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")


# ── Emergency Info ─────────────────────────────────────────────────────────────
class EmergencyRequest(BaseModel):
    destination: str
    country: str = "India"


@app.post("/api/emergency")
async def emergency_info(request: EmergencyRequest):
    if llm is None:
        raise HTTPException(status_code=500, detail="LLM not configured")
    prompt = f"""For the travel destination "{request.destination}" in "{request.country}", return ONLY this JSON with no extra text, no markdown:
{{
  "emergency_number": "local police/emergency number",
  "hospitals": [
    {{"name": "hospital name", "address": "full address", "phone": "number"}},
    {{"name": "hospital name", "address": "full address", "phone": "number"}}
  ],
  "police_station": {{"name": "station name", "address": "full address", "phone": "number"}},
  "embassy": {{"country": "Indian Embassy / High Commission", "address": "full address", "phone": "number"}},
  "safety_tips": ["specific tip 1", "specific tip 2", "specific tip 3"]
}}"""
    try:
        response = llm.invoke([SystemMessage(content=prompt)])
        clean = response.content.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()
        return json.loads(clean)
    except Exception as e:
        logger.exception("Error in /api/emergency")
        raise HTTPException(status_code=500, detail=str(e))


# ── User Preferences (Memory) ──────────────────────────────────────────────────
class PreferencesPayload(BaseModel):
    user_id: str
    vibes: list[str] = []
    travel_style: str = ""
    budget: str = ""
    pace: str = ""
    destination: str = ""


@app.get("/api/preferences/{user_id}")
def get_preferences(user_id: str):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM user_preferences WHERE user_id = ?", (user_id,)
    ).fetchone()
    conn.close()
    if not row:
        return {}
    return {
        "vibes": json.loads(row["vibes"]),
        "travel_style": row["travel_style"],
        "budget": row["budget"],
        "pace": row["pace"],
        "past_destinations": json.loads(row["past_destinations"]),
    }


@app.post("/api/preferences")
def save_preferences(payload: PreferencesPayload):
    conn = get_db()
    existing = conn.execute(
        "SELECT past_destinations FROM user_preferences WHERE user_id = ?",
        (payload.user_id,),
    ).fetchone()
    past = json.loads(existing["past_destinations"]) if existing else []
    if payload.destination and payload.destination not in past:
        past = [payload.destination] + past[:9]
    conn.execute(
        """
        INSERT INTO user_preferences (user_id, vibes, travel_style, budget, pace, past_destinations, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            vibes=excluded.vibes,
            travel_style=excluded.travel_style,
            budget=excluded.budget,
            pace=excluded.pace,
            past_destinations=excluded.past_destinations,
            updated_at=CURRENT_TIMESTAMP
        """,
        (
            payload.user_id,
            json.dumps(payload.vibes),
            payload.travel_style,
            payload.budget,
            payload.pace,
            json.dumps(past),
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Live Trip Mode ─────────────────────────────────────────────────────────────
class LiveRequest(BaseModel):
    session_id: str
    destination: str
    current_location: str
    time_of_day: str
    hours_remaining: int
    past_slots: list[str] = []


@app.post("/api/live")
async def live_mode(request: LiveRequest):
    if llm is None:
        raise HTTPException(status_code=500, detail="LLM not configured")
    prompt = f"""You are Naviro in live trip mode. The user is actively travelling right now.

Destination: {request.destination}
Current location: {request.current_location}
Current time: {request.time_of_day}
Hours left in trip: {request.hours_remaining}
Already visited today: {", ".join(request.past_slots) or "Nothing yet"}

Give 2–3 specific suggestions for RIGHT NOW based on their location and remaining time. Write like a local friend texting them — short, direct, specific. No tourism-brochure language.

Return ONLY valid JSON, no markdown:
{{
  "context": "one sentence setting the scene — what time/vibe it is right now",
  "suggestions": [
    {{
      "place_name": "exact name findable on a map",
      "why_now": "why this works at this specific time and from their location — 1 sentence",
      "how_to_get_there": "from their current location — specific transport and cost in INR",
      "estimated_duration": "X hours",
      "local_tip": "one real insider tip a local would know"
    }}
  ]
}}"""
    try:
        response = llm.invoke([SystemMessage(content=prompt)])
        clean = response.content.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()
        return json.loads(clean)
    except Exception as e:
        logger.exception("Error in /api/live")
        raise HTTPException(status_code=500, detail=str(e))


# ── Auto Re-planning Agent ─────────────────────────────────────────────────────
class ReplanRequest(BaseModel):
    session_id: str
    destination: str
    original_slots: list[dict]
    completed_slots: list[str]
    disruption: str
    time_remaining: str


@app.post("/api/replan")
async def replan(request: ReplanRequest):
    if llm is None:
        raise HTTPException(status_code=500, detail="LLM not configured")
    prompt = f"""You are Naviro's live re-planning agent. The user's trip has hit a disruption mid-day.

Destination: {request.destination}
Disruption: {request.disruption}
Time remaining: {request.time_remaining}
Already visited (keep these, don't repeat): {", ".join(request.completed_slots) or "None"}
Original remaining plan: {json.dumps(request.original_slots, ensure_ascii=False)}

Replace the disrupted/remaining slots with better alternatives that account for the disruption.
Keep completed slots unchanged. Respond ONLY with a JSON array of new slot objects.

Rules:
- Adapt specifically to the disruption (rain → indoor spots, closed → nearby alternative, late → closer/faster)
- Don't repeat any completed spots
- Maintain time-of-day order
- Keep within the city
- Coordinates always {{"lat": 0.0, "lng": 0.0}}
- Match the same slot structure as the original"""
    try:
        response = llm.invoke([SystemMessage(content=prompt)])
        clean = response.content.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.strip()
        new_slots = json.loads(clean)
        dummy_itinerary = {
            "destination": request.destination,
            "days": [{"day_number": 1, "slots": new_slots}],
        }
        geocoded = await geocode_itinerary(dummy_itinerary)
        return {"slots": geocoded["days"][0]["slots"]}
    except Exception as e:
        logger.exception("Error in /api/replan")
        raise HTTPException(status_code=500, detail=str(e))
