from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from dotenv import load_dotenv
import os
import json
import time
import re
import httpx
import asyncio
import logging
import math
from collections import OrderedDict
from typing import Any, Literal, Optional
from urllib.parse import quote

from groq import AsyncGroq, BadRequestError as GroqBadRequestError

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

_allow_vercel_previews = os.getenv("ALLOW_VERCEL_PREVIEW_ORIGINS", "false").lower() == "true"
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app" if _allow_vercel_previews else None,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Lightweight request protection ───────────────────────────────────────────
# In-memory limiting is intentionally conservative for a single instance. Move this
# to Redis before running multiple backend instances.
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "30") or "30")
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60") or "60")
MAX_REQUEST_BODY_BYTES = int(os.getenv("MAX_REQUEST_BODY_BYTES", "50000") or "50000")
_request_windows: dict[str, tuple[float, int]] = {}


@app.middleware("http")
async def protect_api_requests(request: Request, call_next):
    if not request.url.path.startswith("/api/"):
        return await call_next(request)

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            body_size = int(content_length)
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header."})
        if body_size > MAX_REQUEST_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body is too large."})

    now = time.monotonic()
    client_key = request.client.host if request.client else "unknown"
    window_started, count = _request_windows.get(client_key, (now, 0))
    if now - window_started >= RATE_LIMIT_WINDOW_SECONDS:
        window_started, count = now, 0
    if count >= RATE_LIMIT_REQUESTS:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please wait a minute and try again."},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )
    _request_windows[client_key] = (window_started, count + 1)

    # Avoid unbounded memory use from one-off clients.
    if len(_request_windows) > 10_000:
        _request_windows.clear()
    return await call_next(request)

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
FOR WELL-KNOWN CITIES: Skip the obvious tourist traps. Think like a 5-year local resident.
- Breakfast? Not the hotel buffet — the specific tiffin shop on the corner.
- Evening? Not the tourist strip — the local market that winds up at 8pm.
- History? Not the UNESCO site — the forgotten step-well three streets behind it.

FOR SMALL TOWNS & TIER-3 CITIES (critical rule):
If you don't have deep local knowledge of a place, DO NOT invent vague names like "Local Market", "Town Square", "Old Bus Stand Area". That is useless and wrong.
Instead:
- Use the actual proper name of the most well-known temple, lake, fort, or bazaar in that town
- Name the specific street, colony, or neighbourhood — e.g. "Kanaka Durga Temple, Narsipatnam" not "the local temple"
- If you only know 1–2 real places, build the itinerary around those + nearby real landmarks
- A known landmark with a proper name is ALWAYS better than an invented vague place
- The place_name MUST be specific enough that someone can find it by typing it into Google Maps

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

━━━ OUTPUT ━━━
Your response is constrained to a fixed JSON schema — don't think about formatting,
only content. Never mention coordinates or lat/lng: they are not part of your output
and are looked up automatically after you respond.

Hard rules:
- category must be the single best fit: historical, food, nature, cultural, or market
- Every place must be inside the requested destination city/town (or its immediate outskirts), never from another city
- Never repeat a place across days
- When the user refines, only change what they asked — preserve everything else"""

# ── In-memory session store ───────────────────────────────────────────────────
MAX_ACTIVE_SESSIONS = int(os.getenv("MAX_ACTIVE_SESSIONS", "1000") or "1000")
sessions: OrderedDict[str, list[dict[str, str]]] = OrderedDict()

# ── LLM (Groq — free tier, fast) ─────────────────────────────────────────────
# llama-3.3-70b-versatile was decommissioned by Groq on 2026-08-16. gpt-oss-120b
# is Groq's recommended replacement and — unlike most Groq models — supports
# strict json_schema structured outputs, so the model literally cannot return
# malformed JSON or a value outside an enum. Override via GROQ_MODEL if Groq
# deprecates this one too.
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
_groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
llm: Optional[AsyncGroq] = AsyncGroq(api_key=_groq_api_key) if _groq_api_key else None

LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "30") or "30")


async def invoke_llm(
    messages: list[dict[str, str]],
    *,
    schema_name: str,
    schema: dict[str, Any],
    temperature: float = 0.7,
) -> str:
    """Call Groq with strict JSON-schema structured output. Returns raw JSON text —
    strict mode guarantees it parses and matches `schema`, so callers only need to
    re-check the constraints JSON Schema itself can't express (e.g. slot ordering)."""
    if llm is None:
        raise RuntimeError("LLM is not configured")
    try:
        response = await asyncio.wait_for(
            llm.chat.completions.create(
                model=GROQ_MODEL,
                messages=messages,
                temperature=temperature,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": schema_name, "schema": schema, "strict": True},
                },
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise TimeoutError("The model request timed out") from exc
    return response.choices[0].message.content or ""


async def _generate_and_validate(
    messages: list[dict[str, str]],
    *,
    schema_name: str,
    schema: dict[str, Any],
    model: type[BaseModel],
    temperature: float = 0.7,
) -> BaseModel:
    """Generate + validate, with one retry if the response is rejected — either
    by our own cross-field checks (not expressible in JSON Schema, e.g.
    day-number ordering) or by Groq's own schema check: strict mode's
    constrained decoding guarantees types and enums, but not array length, so
    a list that comes up short of minItems is rejected server-side as an HTTP
    400 instead of returned as malformed content. This is one retry, not a
    resilience layer — rate limits or outages still propagate immediately."""
    try:
        raw = await invoke_llm(messages, schema_name=schema_name, schema=schema, temperature=temperature)
        return model.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError, GroqBadRequestError) as exc:
        retry_messages = messages + [
            {
                "role": "user",
                "content": f"Your previous response was invalid: {exc}. Return corrected JSON that fully matches the schema.",
            }
        ]
        raw_retry = await invoke_llm(
            retry_messages, schema_name=schema_name, schema=schema, temperature=temperature
        )
        return model.model_validate(json.loads(raw_retry))  # let a second failure propagate


def get_session_history(session_id: str) -> list[dict[str, str]]:
    history = sessions.get(session_id)
    if history is None:
        history = [{"role": "system", "content": SYSTEM_PROMPT}]
        sessions[session_id] = history
    sessions.move_to_end(session_id)
    while len(sessions) > MAX_ACTIVE_SESSIONS:
        sessions.popitem(last=False)
    return history

# ── Google Maps / Places geocoding ───────────────────────────────────────────
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
GOOGLE_GEOCODE_URL  = "https://maps.googleapis.com/maps/api/geocode/json"
GOOGLE_PLACES_URL   = "https://maps.googleapis.com/maps/api/place/textsearch/json"
GOOGLE_PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_CONCURRENCY = int(os.getenv("NOMINATIM_CONCURRENCY", "1") or "1")
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
        await asyncio.sleep(1.1)  # Nominatim policy: max 1 req/sec
        try:
            resp = await client.get(
                NOMINATIM_SEARCH_URL,
                params={"q": query, "format": "json", "limit": 1, "addressdetails": 0, "countrycodes": "in"},
                headers=_nominatim_headers,
                timeout=10.0,
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


async def _places_nearby(
    client: httpx.AsyncClient, lat: float, lng: float, place_type: str, limit: int = 2
) -> list[dict]:
    """Real, verifiable results only — returns [] on any failure rather than
    inventing a placeholder. Used for emergency info, where a wrong address is
    worse than no address. No Nominatim fallback: OpenStreetMap has no
    equivalent "find hospitals near this point" category search."""
    if not GOOGLE_MAPS_API_KEY:
        return []
    try:
        resp = await client.get(
            GOOGLE_PLACES_NEARBY_URL,
            params={
                "location": f"{lat},{lng}",
                "radius": 5000,
                "type": place_type,
                "key": GOOGLE_MAPS_API_KEY,
            },
            timeout=8.0,
        )
        data = resp.json()
        if data.get("status") != "OK":
            logger.warning("Places nearby search (%s) status=%s", place_type, data.get("status"))
            return []
        results = []
        for place in data.get("results", [])[:limit]:
            name = place.get("name", "")
            place_id = place.get("place_id", "")
            if not name or not place_id:
                continue
            results.append(
                {
                    "name": name,
                    "address": place.get("vicinity") or "Address unavailable — see map",
                    "maps_url": f"https://www.google.com/maps/place/?q=place_id:{place_id}",
                }
            )
        return results
    except Exception as e:
        logger.warning("Places nearby search (%s) error: %s", place_type, e)
        return []


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


async def _repair_itinerary_far_places(itinerary: dict, offenders: list[dict]) -> Optional[dict]:
    """Ask the LLM to replace out-of-town picks with local alternatives (JSON-only)."""
    if llm is None or not offenders:
        return None

    repair_prompt = """You are repairing a travel itinerary JSON.

Some places are NOT inside the destination town/city (they geocode far away). Replace ONLY those slots with better local alternatives inside the destination town/city or immediate outskirts (<= 20 km). Keep everything else unchanged.

Rules:
- Preserve: destination, total_days, day_number/day_title structure, and time_of_day values.
- For each offender slot: change place_name/description/how_to_get_there/estimated_* /local_tip to match the new local place.
- Never include a place from another city (no day trips) unless the user explicitly asked.
"""

    try:
        raw = await invoke_llm(
            [
                {"role": "system", "content": repair_prompt},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"itinerary": itinerary, "offenders": offenders}, ensure_ascii=False
                    ),
                },
            ],
            schema_name="itinerary_repair",
            schema=ITINERARY_DRAFT_SCHEMA,
        )
        draft = ItineraryDraft.model_validate(json.loads(raw))
        return draft.to_final_dict()
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
class Coordinates(BaseModel):
    lat: float = 0.0
    lng: float = 0.0

    @model_validator(mode="after")
    def coordinates_are_valid(self):
        if not -90 <= self.lat <= 90 or not -180 <= self.lng <= 180:
            raise ValueError("Coordinates are outside valid latitude/longitude bounds")
        return self


class ItinerarySlot(BaseModel):
    time_of_day: str = Field(min_length=1, max_length=32)
    place_name: str = Field(min_length=1, max_length=180)
    description: str = Field(min_length=1, max_length=1500)
    category: str = Field(min_length=1, max_length=80)
    how_to_get_there: str = Field(min_length=1, max_length=800)
    estimated_duration: str = Field(min_length=1, max_length=80)
    estimated_cost: str = Field(min_length=1, max_length=80)
    local_tip: str = Field(min_length=1, max_length=1000)
    coordinates: Coordinates = Field(default_factory=Coordinates)


# ── LLM-facing "draft" schemas ────────────────────────────────────────────────
# The model never generates coordinates — geocoding always fills them in
# server-side (it's the only source of truth for where a place actually is), so
# these mirror the response models above minus that field. Every draft model
# sets extra="forbid" so Structured Outputs can emit additionalProperties: false,
# which Groq's strict json_schema mode requires on every object in the schema.
TimeOfDay = Literal["morning", "afternoon", "evening"]
SlotCategory = Literal["historical", "food", "nature", "cultural", "market"]


class ItinerarySlotDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time_of_day: TimeOfDay
    place_name: str = Field(min_length=1, max_length=180)
    description: str = Field(min_length=1, max_length=1500)
    category: SlotCategory
    how_to_get_there: str = Field(min_length=1, max_length=800)
    estimated_duration: str = Field(min_length=1, max_length=80)
    estimated_cost: str = Field(min_length=1, max_length=80)
    local_tip: str = Field(min_length=1, max_length=1000)

    def to_final(self) -> dict[str, Any]:
        """Expand into the final slot shape; coordinates are filled in by geocoding."""
        return {**self.model_dump(), "coordinates": {"lat": 0.0, "lng": 0.0}}


class ItineraryDay(BaseModel):
    day_number: int = Field(ge=1, le=30)
    day_title: str = Field(min_length=1, max_length=160)
    slots: list[ItinerarySlot] = Field(min_length=3, max_length=3)

    @model_validator(mode="after")
    def has_one_slot_for_each_part_of_day(self):
        expected = ["morning", "afternoon", "evening"]
        actual = [slot.time_of_day.lower().strip() for slot in self.slots]
        if actual != expected:
            raise ValueError("Slots must be morning, afternoon, and evening in that order")
        return self


class Itinerary(BaseModel):
    destination: str = Field(min_length=1, max_length=120)
    total_days: int = Field(ge=1, le=30)
    summary: str = Field(min_length=1, max_length=800)
    days: list[ItineraryDay] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def days_match_declared_total(self):
        if len(self.days) != self.total_days:
            raise ValueError("total_days must match the number of day entries")
        if [day.day_number for day in self.days] != list(range(1, self.total_days + 1)):
            raise ValueError("Day numbers must be consecutive and start at 1")
        return self


class ItineraryDayDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day_number: int = Field(ge=1, le=30)
    day_title: str = Field(min_length=1, max_length=160)
    slots: list[ItinerarySlotDraft] = Field(min_length=3, max_length=3)

    @model_validator(mode="after")
    def has_one_slot_for_each_part_of_day(self):
        # Strict mode's enum guarantees each time_of_day is valid; it can't
        # guarantee the three appear in order, so we still check that here.
        expected = ["morning", "afternoon", "evening"]
        if [slot.time_of_day for slot in self.slots] != expected:
            raise ValueError("Slots must be morning, afternoon, and evening in that order")
        return self


class ItineraryDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    destination: str = Field(min_length=1, max_length=120)
    total_days: int = Field(ge=1, le=30)
    summary: str = Field(min_length=1, max_length=800)
    days: list[ItineraryDayDraft] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def days_match_declared_total(self):
        if len(self.days) != self.total_days:
            raise ValueError("total_days must match the number of day entries")
        if [day.day_number for day in self.days] != list(range(1, self.total_days + 1)):
            raise ValueError("Day numbers must be consecutive and start at 1")
        return self

    def to_final_dict(self) -> dict[str, Any]:
        """Expand into the shape `Itinerary` expects, coordinates zeroed pending geocoding."""
        return {
            "destination": self.destination,
            "total_days": self.total_days,
            "summary": self.summary,
            "days": [
                {
                    "day_number": day.day_number,
                    "day_title": day.day_title,
                    "slots": [slot.to_final() for slot in day.slots],
                }
                for day in self.days
            ],
        }


class EmergencyContact(BaseModel):
    name: str
    address: str
    maps_url: str


class EmergencyInfo(BaseModel):
    # Sourced from Google Places Nearby Search + a hardcoded national number,
    # not the LLM — a fabricated hospital address or phone number is the one
    # category of wrong answer that can hurt someone. hospitals/police_station
    # are empty/None (never invented) when Places is unavailable; the frontend
    # shows an honest "couldn't verify" state in that case.
    emergency_number: str
    hospitals: list[EmergencyContact]
    police_station: Optional[EmergencyContact]
    safety_tips: list[str]


class SafetyTipsResponse(BaseModel):
    # The one part of this panel that's still LLM-generated — subjective,
    # destination-specific advice, not a verifiable fact like an address.
    model_config = ConfigDict(extra="forbid")
    safety_tips: list[str] = Field(min_length=2, max_length=4)


class LiveSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    place_name: str = Field(min_length=1, max_length=180)
    why_now: str = Field(min_length=1, max_length=800)
    how_to_get_there: str = Field(min_length=1, max_length=800)
    estimated_duration: str = Field(min_length=1, max_length=80)
    local_tip: str = Field(min_length=1, max_length=1000)


class LiveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context: str = Field(min_length=1, max_length=800)
    suggestions: list[LiveSuggestion] = Field(min_length=2, max_length=3)


class ReplanResponse(BaseModel):
    slots: list[ItinerarySlot] = Field(min_length=1, max_length=3)


class ReplanResponseDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slots: list[ItinerarySlotDraft] = Field(min_length=1, max_length=3)


# Precomputed once at import time — regenerating a JSON schema on every request
# would be wasted work for a schema that never changes at runtime.
ITINERARY_DRAFT_SCHEMA = ItineraryDraft.model_json_schema()
REPLAN_DRAFT_SCHEMA = ReplanResponseDraft.model_json_schema()
SAFETY_TIPS_SCHEMA = SafetyTipsResponse.model_json_schema()
LIVE_RESPONSE_SCHEMA = LiveResponse.model_json_schema()

INDIA_EMERGENCY_NUMBER = "112"  # National unified emergency number (police/fire/ambulance)


def parse_llm_json(raw_response: str, expected_type: type[BaseModel]) -> BaseModel:
    """Validate a Structured-Outputs response. Strict mode guarantees `raw_response`
    is well-formed JSON matching the schema we sent, so this only needs to catch
    the empty-response edge case and hand off to Pydantic for our own extra
    constraints (string lengths, cross-field ordering) that JSON Schema can't express."""
    try:
        parsed = json.loads(raw_response or "")
    except json.JSONDecodeError as exc:
        raise ValueError("The model did not return valid JSON") from exc
    return expected_type.model_validate(parsed)


class PlanRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128)
    message: str = Field(min_length=1, max_length=2000)

class PlanResponse(BaseModel):
    reply: str
    itinerary: Optional[Itinerary] = None

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
        history = get_session_history(request.session_id)
        history.append({"role": "user", "content": request.message})

        draft = await _generate_and_validate(
            history, schema_name="itinerary", schema=ITINERARY_DRAFT_SCHEMA, model=ItineraryDraft
        )
        geocoded = await geocode_itinerary_with_repair(draft.to_final_dict())
        itinerary = Itinerary.model_validate(geocoded)

        # Only retain a valid model response as conversation context.
        history.append({"role": "assistant", "content": json.dumps(draft.model_dump())})
        return PlanResponse(reply="Itinerary ready.", itinerary=itinerary)

    except (ValueError, ValidationError, json.JSONDecodeError, GroqBadRequestError):
        logger.warning("Rejected invalid itinerary response for session %s", request.session_id)
        raise HTTPException(
            status_code=502,
            detail="Naviro could not create a reliable itinerary. Please try again.",
        )
    except Exception as e:
        logger.exception("Unhandled error in /api/plan")
        raise HTTPException(status_code=500, detail="Naviro could not create your itinerary right now. Please try again.")


# ── Emergency Info ─────────────────────────────────────────────────────────────
class EmergencyRequest(BaseModel):
    destination: str = Field(min_length=1, max_length=120)
    country: str = Field(default="India", min_length=1, max_length=80)


@app.post("/api/emergency", response_model=EmergencyInfo)
async def emergency_info(request: EmergencyRequest):
    hospitals: list[dict] = []
    police: list[dict] = []
    try:
        async with httpx.AsyncClient() as client:
            city_center = await geocode_city_center(client, request.destination)
            if city_center["lat"] != 0.0 or city_center["lng"] != 0.0:
                hospitals, police = await asyncio.gather(
                    _places_nearby(client, city_center["lat"], city_center["lng"], "hospital"),
                    _places_nearby(client, city_center["lat"], city_center["lng"], "police", limit=1),
                )
    except Exception:
        logger.exception("Error looking up hospitals/police for %s", request.destination)

    # Generic, always-true fallback tips if the LLM call below fails or isn't configured —
    # better than an empty panel, and nothing here is destination-specific enough to be wrong.
    safety_tips = [
        f"Save {INDIA_EMERGENCY_NUMBER} (India's unified emergency number) in your phone before you set out.",
        "Share your live location with someone you trust while travelling.",
    ]
    if llm is not None:
        try:
            tips_result = await _generate_and_validate(
                [
                    {
                        "role": "system",
                        "content": (
                            f'Give 3 specific, practical safety tips for a traveller visiting '
                            f'"{request.destination}", India. Avoid generic advice like "stay alert" '
                            f"or \"keep your belongings safe\" — be concrete: a specific area or time "
                            f"to be careful, a common local scam, or a transport safety note."
                        ),
                    }
                ],
                schema_name="safety_tips",
                schema=SAFETY_TIPS_SCHEMA,
                model=SafetyTipsResponse,
            )
            safety_tips = tips_result.safety_tips
        except Exception:
            logger.warning("Safety tips generation failed for %s; using generic fallback", request.destination)

    return EmergencyInfo(
        emergency_number=INDIA_EMERGENCY_NUMBER,
        hospitals=[EmergencyContact(**h) for h in hospitals],
        police_station=EmergencyContact(**police[0]) if police else None,
        safety_tips=safety_tips,
    )


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
    session_id: str = Field(min_length=8, max_length=128)
    destination: str = Field(min_length=1, max_length=120)
    current_location: str = Field(min_length=1, max_length=300)
    time_of_day: str = Field(min_length=1, max_length=32)
    hours_remaining: int = Field(ge=1, le=24)
    past_slots: list[str] = Field(default_factory=list, max_length=30)


@app.post("/api/live", response_model=LiveResponse)
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

context should be one sentence setting the scene — what time/vibe it is right now.
Each suggestion's place_name must be an exact name findable on a map, why_now should
explain why it works at this specific time and location, how_to_get_there should be
from their current location with specific transport and cost in INR, and local_tip
should be one real insider detail a local would know."""
    try:
        return await _generate_and_validate(
            [{"role": "system", "content": prompt}],
            schema_name="live_suggestions",
            schema=LIVE_RESPONSE_SCHEMA,
            model=LiveResponse,
        )
    except (ValueError, ValidationError, json.JSONDecodeError, GroqBadRequestError):
        logger.warning("Rejected invalid live-mode response for %s", request.destination)
        raise HTTPException(status_code=502, detail="Naviro could not make reliable live suggestions. Please try again.")
    except Exception:
        logger.exception("Error in /api/live")
        raise HTTPException(status_code=500, detail="Naviro could not make live suggestions right now. Please try again.")


# ── Auto Re-planning Agent ─────────────────────────────────────────────────────
class ReplanRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128)
    destination: str = Field(min_length=1, max_length=120)
    original_slots: list[ItinerarySlot] = Field(min_length=1, max_length=3)
    completed_slots: list[str] = Field(default_factory=list, max_length=3)
    disruption: str = Field(min_length=1, max_length=800)
    time_remaining: str = Field(min_length=1, max_length=80)


@app.post("/api/replan", response_model=ReplanResponse)
async def replan(request: ReplanRequest):
    if llm is None:
        raise HTTPException(status_code=500, detail="LLM not configured")
    prompt = f"""You are Naviro's live re-planning agent. The user's trip has hit a disruption mid-day.

Destination: {request.destination}
Disruption: {request.disruption}
Time remaining: {request.time_remaining}
Already visited (keep these, don't repeat): {", ".join(request.completed_slots) or "None"}
Original remaining plan: {json.dumps([slot.model_dump() for slot in request.original_slots], ensure_ascii=False)}

Replace the disrupted/remaining slots with better alternatives that account for the disruption.

Rules:
- Adapt specifically to the disruption (rain → indoor spots, closed → nearby alternative, late → closer/faster)
- Don't repeat any completed spots
- Maintain time-of-day order
- Keep within the city"""
    try:
        draft = await _generate_and_validate(
            [{"role": "system", "content": prompt}],
            schema_name="replan",
            schema=REPLAN_DRAFT_SCHEMA,
            model=ReplanResponseDraft,
        )
        dummy_itinerary = {
            "destination": request.destination,
            "days": [{"day_number": 1, "slots": [slot.to_final() for slot in draft.slots]}],
        }
        geocoded = await geocode_itinerary(dummy_itinerary)
        return ReplanResponse.model_validate({"slots": geocoded["days"][0]["slots"]})
    except (ValueError, ValidationError, json.JSONDecodeError, GroqBadRequestError):
        logger.warning("Rejected invalid replan response for %s", request.destination)
        raise HTTPException(status_code=502, detail="Naviro could not create a reliable replanned route. Please try again.")
    except Exception:
        logger.exception("Error in /api/replan")
        raise HTTPException(status_code=500, detail="Naviro could not replan your trip right now. Please try again.")
