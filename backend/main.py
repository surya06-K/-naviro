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
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=500)
    phone: str = Field(min_length=1, max_length=80)


class EmergencyInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    emergency_number: str = Field(min_length=1, max_length=80)
    hospitals: list[EmergencyContact] = Field(min_length=1, max_length=3)
    police_station: EmergencyContact
    embassy: EmergencyContact
    safety_tips: list[str] = Field(min_length=1, max_length=5)


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
EMERGENCY_INFO_SCHEMA = EmergencyInfo.model_json_schema()
LIVE_RESPONSE_SCHEMA = LiveResponse.model_json_schema()


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
    if llm is None:
        raise HTTPException(status_code=500, detail="LLM not configured")
    # NOTE: this is still LLM-generated, including phone numbers — an invented
    # emergency number is the one category of wrong answer that can hurt someone.
    # Flagged for grounding in real Places/government data in a follow-up pass;
    # not fixed here since this change is scoped to the model migration only.
    prompt = (
        f'You are a travel safety assistant. For the destination "{request.destination}" '
        f'in "{request.country}", provide: the local police/emergency phone number, '
        f"2-3 nearby hospitals with real names and addresses, the nearest police station, "
        f"embassy or high commission details (only relevant for international travel — "
        f"use India's own emergency services if the destination is within India), and "
        f"3 specific, practical safety tips for this destination. Be accurate — do not "
        f"invent a detail you are not confident about; prefer a well-known, findable "
        f"landmark over a fabricated address."
    )
    try:
        return await _generate_and_validate(
            [{"role": "system", "content": prompt}],
            schema_name="emergency_info",
            schema=EMERGENCY_INFO_SCHEMA,
            model=EmergencyInfo,
        )
    except (ValueError, ValidationError, json.JSONDecodeError, GroqBadRequestError):
        logger.warning("Rejected invalid emergency response for %s", request.destination)
        raise HTTPException(status_code=502, detail="Safety information is unavailable right now. Please use local emergency services.")
    except Exception:
        logger.exception("Error in /api/emergency")
        raise HTTPException(status_code=500, detail="Safety information is unavailable right now. Please use local emergency services.")


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


# ══════════════════════════════════════════════════════════════════════════════
# REAL-TIME TRANSPORT DIRECTIONS
# ══════════════════════════════════════════════════════════════════════════════

GOOGLE_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"

# ── Auto-rickshaw meter rates by city (2024-25) ───────────────────────────────
# Source: respective RTA published rates
AUTO_METER: dict[str, dict] = {
    "hyderabad":   {"base_fare": 25, "base_km": 1.8, "per_km": 14, "note": "TSRTC city"},
    "secunderabad":{"base_fare": 25, "base_km": 1.8, "per_km": 14, "note": ""},
    "warangal":    {"base_fare": 25, "base_km": 1.8, "per_km": 13, "note": ""},
    "vijayawada":  {"base_fare": 25, "base_km": 1.5, "per_km": 13, "note": "APSRTC city"},
    "visakhapatnam":{"base_fare": 25,"base_km": 1.5, "per_km": 13, "note": ""},
    "bengaluru":   {"base_fare": 30, "base_km": 2.0, "per_km": 15, "note": "BMTC city"},
    "bangalore":   {"base_fare": 30, "base_km": 2.0, "per_km": 15, "note": ""},
    "mysuru":      {"base_fare": 25, "base_km": 2.0, "per_km": 14, "note": ""},
    "mysore":      {"base_fare": 25, "base_km": 2.0, "per_km": 14, "note": ""},
    "mangaluru":   {"base_fare": 25, "base_km": 1.8, "per_km": 13, "note": ""},
    "chennai":     {"base_fare": 25, "base_km": 1.8, "per_km": 12, "note": "MTC city"},
    "coimbatore":  {"base_fare": 25, "base_km": 1.5, "per_km": 12, "note": ""},
    "madurai":     {"base_fare": 20, "base_km": 1.5, "per_km": 12, "note": ""},
    "tiruchirappalli":{"base_fare": 20,"base_km":1.5,"per_km": 11, "note": ""},
    "kochi":       {"base_fare": 30, "base_km": 2.0, "per_km": 14, "note": "KSRTC city"},
    "thiruvananthapuram":{"base_fare":25,"base_km":1.5,"per_km":13,"note":""},
    "kozhikode":   {"base_fare": 25, "base_km": 1.5, "per_km": 12, "note": ""},
    "mumbai":      {"base_fare": 21, "base_km": 1.5, "per_km": 14, "note": "BEST city"},
    "pune":        {"base_fare": 21, "base_km": 1.5, "per_km": 13, "note": ""},
    "nagpur":      {"base_fare": 20, "base_km": 1.5, "per_km": 12, "note": ""},
    "delhi":       {"base_fare": 25, "base_km": 1.5, "per_km":  9, "note": "DTC city"},
    "gurgaon":     {"base_fare": 25, "base_km": 1.5, "per_km": 10, "note": ""},
    "noida":       {"base_fare": 25, "base_km": 1.5, "per_km": 10, "note": ""},
    "kolkata":     {"base_fare": 30, "base_km": 2.0, "per_km": 12, "note": ""},
    "ahmedabad":   {"base_fare": 25, "base_km": 1.5, "per_km": 11, "note": ""},
    "surat":       {"base_fare": 25, "base_km": 1.5, "per_km": 11, "note": ""},
    "jaipur":      {"base_fare": 25, "base_km": 1.5, "per_km": 12, "note": ""},
    "lucknow":     {"base_fare": 25, "base_km": 1.5, "per_km": 11, "note": ""},
    "bhopal":      {"base_fare": 20, "base_km": 1.5, "per_km": 10, "note": ""},
    "indore":      {"base_fare": 20, "base_km": 1.5, "per_km": 10, "note": ""},
    "chandigarh":  {"base_fare": 25, "base_km": 1.5, "per_km": 12, "note": ""},
    "goa":         {"base_fare": 30, "base_km": 2.0, "per_km": 15, "note": "Pre-paid recommended"},
    "default":     {"base_fare": 25, "base_km": 1.8, "per_km": 13, "note": ""},
}

# ── Rapido bike-taxi rates (2024-25) ─────────────────────────────────────────
# Operates in 100+ Indian cities. Fastest in congested city traffic.
RAPIDO_CITIES: set[str] = {
    "hyderabad", "secunderabad", "bengaluru", "bangalore", "chennai",
    "kochi", "mysuru", "mysore", "coimbatore", "madurai", "visakhapatnam",
    "vijayawada", "warangal", "mangaluru", "thiruvananthapuram", "kozhikode",
    "tiruchirappalli", "tirupati", "vellore", "salem",
    "delhi", "gurgaon", "noida", "kolkata", "pune", "mumbai", "jaipur",
    "ahmedabad", "chandigarh", "lucknow", "patna", "bhubaneswar", "guwahati",
    "bhopal", "indore", "nagpur", "surat", "agra", "meerut", "varanasi",
}

RAPIDO_RATES: dict[str, dict] = {
    "hyderabad":  {"base": 25, "base_km": 1.5, "per_km": 7},
    "secunderabad": {"base": 25, "base_km": 1.5, "per_km": 7},
    "bengaluru":  {"base": 35, "base_km": 2.0, "per_km": 9},
    "bangalore":  {"base": 35, "base_km": 2.0, "per_km": 9},
    "chennai":    {"base": 30, "base_km": 1.5, "per_km": 8},
    "delhi":      {"base": 25, "base_km": 1.5, "per_km": 8},
    "mumbai":     {"base": 35, "base_km": 2.0, "per_km": 9},
    "kolkata":    {"base": 25, "base_km": 1.5, "per_km": 7},
    "kochi":      {"base": 30, "base_km": 1.5, "per_km": 8},
    "pune":       {"base": 30, "base_km": 1.5, "per_km": 8},
    "jaipur":     {"base": 25, "base_km": 1.5, "per_km": 7},
    "default":    {"base": 30, "base_km": 1.5, "per_km": 8},
}

# ── Cities where share-autos operate on fixed routes ─────────────────────────
SHARE_AUTO_CITIES: set[str] = {
    "hyderabad", "secunderabad", "chennai", "bengaluru", "bangalore",
    "coimbatore", "madurai", "vijayawada", "visakhapatnam", "kochi",
    "thiruvananthapuram", "kozhikode", "tiruchirappalli", "tirupati",
    "mysuru", "mysore", "mangaluru",
}

# ── Ferry / boat routes by city ───────────────────────────────────────────────
FERRY_CITIES: dict[str, str] = {
    "mumbai":       "BEST Ferry (Gateway ↔ Elephanta, ~₹200 return). Mandwa ferry for Alibaug. Ferry terminal at Apollo Bunder.",
    "kochi":        "Kochi Water Metro + KSWTD public ferries. Ernakulam → Fort Kochi in ~10 min, ₹5–20. Very reliable.",
    "goa":          "Government ferries cross Mandovi & Zuari rivers — free for pedestrians. Panaji ferry to Betim is famous.",
    "varanasi":     "Row boats & motor boats on the Ganga ghats. ₹100–200 for ghat tours. Non-motorised boats available at dawn.",
    "alappuzha":    "KSWTD public ferries + private houseboats. Ferry to Kottayam ~₹15. Water bus from Alappuzha Boat Jetty.",
    "alleppey":     "KSWTD public ferries + private houseboats. Ferry to Kottayam ~₹15. Water bus from Alappuzha Boat Jetty.",
    "kolkata":      "Hooghly River Hooghly Ferry Services. Babughat to Howrah in ~15 min, ₹5. Also: Millennium Park to Belur Math.",
    "mandapam":     "Ferry to Rameswaram via Pamban Island. Check Tamil Nadu Maritime Board for schedule.",
    "srinagar":     "Shikara rides on Dal Lake — iconic and practical. ₹30–60 for short rides. Also connects houseboats.",
}

# ── E-rickshaw / Toto availability by city ───────────────────────────────────
ERICKSHAW_CITIES: dict[str, str] = {
    "delhi":      "E-rickshaws (e-rikshaw) run feeder routes near metro stations. ₹10–30 shared, ₹30–70 private.",
    "noida":      "Very common near metro exits. ₹10–25 shared.",
    "gurgaon":    "Available near metro feeder routes. ₹20–50.",
    "kolkata":    "Toto (e-rickshaw) very common, especially in suburban areas. ₹10–30 per trip.",
    "patna":      "Widely available across the city. ₹20–50 for short trips.",
    "lucknow":    "Available near main roads and railway station areas. ₹20–40.",
    "agra":       "Common around tourist areas — Taj Ganj, Fatehabad Rd. ₹30–80.",
    "varanasi":   "Common feeder to ghats and old city lanes. ₹20–50.",
    "bhubaneswar":"Very common. ₹20–40 per trip.",
    "guwahati":   "Available near Paltan Bazaar and major junctions. ₹20–40.",
    "bhopal":     "Available near ISBT and major areas. ₹20–40.",
    "meerut":     "Very common. ₹10–30 shared.",
    "allahabad":  "Common around Prayagraj station and ghats. ₹20–40.",
    "prayagraj":  "Common around station and ghats. ₹20–40.",
}

# ── City bus fallback notes (when no GTFS transit data) ──────────────────────
CITY_BUS_NOTES: dict[str, str] = {
    "hyderabad":  "TSRTC buses cover the whole city (₹10–30). Check TSRTC app or MetroRail + bus combo.",
    "secunderabad": "TSRTC buses + MMTS train. Check TSRTC app.",
    "bengaluru":  "BMTC buses extensive. Check BMTC app or Namma Metro + bus combo. Fare ₹5–30.",
    "bangalore":  "BMTC buses extensive. Check BMTC app or Namma Metro + bus combo. Fare ₹5–30.",
    "chennai":    "MTC buses very affordable (₹5–25). Check MTC website for route numbers.",
    "mumbai":     "BEST buses frequent across the city (₹5–30). Check BEST app or m-Indicator app.",
    "delhi":      "DTC + cluster buses cover most areas (₹5–25). Delhi Transit app has real-time tracking.",
    "kochi":      "KSRTC city buses + private buses. Fare ~₹10–30. Complements the Water Metro.",
    "kolkata":    "CTC + private buses (₹7–20). Kolkata Metro is often faster for long routes.",
    "pune":       "PMPML buses (₹5–25). Check PMPML app.",
    "ahmedabad":  "BRTS (Bus Rapid Transit) + AMTS buses (₹5–25). Very frequent on BRT corridors.",
    "jaipur":     "City buses (₹10–25) + Jaipur Metro. Check JMC transport website.",
    "surat":      "BRTS buses excellent (₹5–15). Very punctual on BRT routes.",
    "bhopal":     "BRTS + city buses (₹7–25). Check BCLL transport.",
    "indore":     "iBus (₹7–25). Indore has one of India's best city bus systems.",
}

# ── Cab fare estimates (Ola Mini / Uber Go approximate) ───────────────────────
CAB_RATES: dict[str, dict] = {
    "bengaluru": {"base": 50, "per_km": 13, "surge_max": 1.8},
    "bangalore": {"base": 50, "per_km": 13, "surge_max": 1.8},
    "hyderabad": {"base": 45, "per_km": 11, "surge_max": 1.6},
    "chennai":   {"base": 45, "per_km": 12, "surge_max": 1.6},
    "mumbai":    {"base": 55, "per_km": 14, "surge_max": 2.0},
    "delhi":     {"base": 50, "per_km": 11, "surge_max": 1.8},
    "kolkata":   {"base": 40, "per_km": 10, "surge_max": 1.5},
    "pune":      {"base": 45, "per_km": 12, "surge_max": 1.6},
    "kochi":     {"base": 50, "per_km": 13, "surge_max": 1.5},
    "default":   {"base": 49, "per_km": 12, "surge_max": 1.7},
}


def _auto_fare(distance_km: float, city: str) -> str:
    key = city.lower().strip()
    rates = AUTO_METER.get(key, AUTO_METER["default"])
    if distance_km <= rates["base_km"]:
        fare = rates["base_fare"]
    else:
        fare = rates["base_fare"] + (distance_km - rates["base_km"]) * rates["per_km"]
    # ±20% range to account for traffic, minor detours, night charges
    return f"₹{int(fare * 0.9)}–{int(fare * 1.2)}"


def _cab_fare(distance_km: float, city: str) -> str:
    key = city.lower().strip()
    rates = CAB_RATES.get(key, CAB_RATES["default"])
    base_fare = rates["base"] + distance_km * rates["per_km"]
    low = int(base_fare * 0.9)
    high = int(base_fare * rates["surge_max"])
    return f"₹{low}–{high}"


def _rapido_fare(distance_km: float, city: str) -> str:
    key = city.lower().strip()
    rates = RAPIDO_RATES.get(key, RAPIDO_RATES["default"])
    if distance_km <= rates["base_km"]:
        fare = rates["base"]
    else:
        fare = rates["base"] + (distance_km - rates["base_km"]) * rates["per_km"]
    return f"₹{int(fare * 0.9)}–{int(fare * 1.15)}"


def _strip_html(text: str) -> str:
    """Remove HTML tags from Google Directions step instructions."""
    return re.sub(r"<[^>]+>", " ", text).replace("  ", " ").strip()


def _parse_transit_leg(leg: dict) -> Optional[dict]:
    """Convert a Google Directions transit leg into Naviro's transport option format."""
    steps_out: list[dict] = []
    transit_modes: set[str] = set()
    agencies: set[str] = set()

    for step in leg.get("steps", []):
        mode = step.get("travel_mode", "")
        if mode == "WALKING":
            dist = step.get("distance", {}).get("text", "")
            dur  = step.get("duration", {}).get("text", "")
            instr = _strip_html(step.get("html_instructions", "Walk"))
            steps_out.append({"type": "walk", "instruction": instr,
                               "duration": dur, "distance": dist})
        elif mode == "TRANSIT":
            td      = step.get("transit_details", {})
            line    = td.get("line", {})
            vehicle = line.get("vehicle", {})
            v_type  = vehicle.get("type", "BUS")
            transit_modes.add(v_type)
            for ag in line.get("agencies", []):
                agencies.add(ag.get("name", ""))

            dep_time = td.get("departure_time", {})
            arr_time = td.get("arrival_time", {})

            steps_out.append({
                "type":           "transit",
                "vehicle_type":   v_type,
                "line":           line.get("short_name") or line.get("name", ""),
                "line_full_name": line.get("name", ""),
                "agency":         ", ".join(agencies) or "Transit",
                "headsign":       td.get("headsign", ""),
                "from_stop":      td.get("departure_stop", {}).get("name", ""),
                "to_stop":        td.get("arrival_stop", {}).get("name", ""),
                "departure_time": dep_time.get("text", ""),
                "arrival_time":   arr_time.get("text", ""),
                "num_stops":      td.get("num_stops", 0),
                "is_realtime":    bool(dep_time.get("value")),
            })

    if not steps_out:
        return None

    # Pick icon + label for primary vehicle type
    if transit_modes & {"SUBWAY", "METRO_RAIL", "TRAM"}:
        icon, label = "🚇", "Metro"
    elif transit_modes & {"HEAVY_RAIL", "COMMUTER_TRAIN", "HIGH_SPEED_TRAIN", "RAIL"}:
        icon, label = "🚆", "Train"
    else:
        icon  = "🚌"
        label = ", ".join(agencies) if agencies else "Bus"

    # Google Directions API sometimes returns fare
    fare_text = ""
    if leg.get("fare"):
        fare_text = leg["fare"].get("text", "")

    return {
        "mode":         "transit",
        "icon":         icon,
        "label":        label,
        "duration":     leg.get("duration", {}).get("text", ""),
        "fare_estimate": fare_text or "Check at boarding point",
        "agencies":     list(agencies),
        "is_realtime":  any(
            s.get("is_realtime") for s in steps_out if s.get("type") == "transit"
        ),
        "steps": steps_out,
    }


# ── Request model ─────────────────────────────────────────────────────────────
class DirectionsRequest(BaseModel):
    origin_text:     str   = ""    # user-typed location (optional if coords given)
    origin_lat:      float = 0.0   # from GPS (optional)
    origin_lng:      float = 0.0   # from GPS (optional)
    destination_name: str          # place name (for display + Ola/Uber links)
    destination_lat:  float        # from slot coordinates
    destination_lng:  float
    city:            str           # destination city (for fare table lookup)


@app.post("/api/directions")
async def get_directions(req: DirectionsRequest):
    if not GOOGLE_MAPS_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="Google Maps API key is not configured. Add GOOGLE_MAPS_API_KEY to your Railway environment variables.",
        )

    async with httpx.AsyncClient() as client:

        # ── Resolve origin coordinates ────────────────────────────────────────
        if req.origin_lat != 0.0 and req.origin_lng != 0.0:
            origin_coords = (req.origin_lat, req.origin_lng)
        elif req.origin_text.strip():
            geocoded = await geocode_place(
                client,
                req.origin_text.strip(),
                req.city,
                {"lat": req.destination_lat, "lng": req.destination_lng},
            )
            if geocoded["lat"] == 0.0 and geocoded["lng"] == 0.0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Couldn't find '{req.origin_text}'. Try being more specific — add the city name.",
                )
            origin_coords = (geocoded["lat"], geocoded["lng"])
        else:
            raise HTTPException(status_code=400, detail="Provide either GPS coordinates or a location name.")

        origin_str = f"{origin_coords[0]},{origin_coords[1]}"
        dest_str   = f"{req.destination_lat},{req.destination_lng}"
        now_ts     = int(time.time())

        # Always compute straight-line distance as fallback (used when driving API fails)
        straight_km  = _distance_km(origin_coords[0], origin_coords[1], req.destination_lat, req.destination_lng)
        estimated_km = straight_km * 1.35  # typical road:straight ratio

        # ── Fire transit + driving + walking in parallel ──────────────────────
        common_params = {"language": "en", "region": "in", "key": GOOGLE_MAPS_API_KEY}

        transit_task = client.get(
            GOOGLE_DIRECTIONS_URL,
            params={**common_params, "origin": origin_str, "destination": dest_str,
                    "mode": "transit", "alternatives": "true",
                    "departure_time": now_ts, "transit_routing_preference": "fewer_transfers"},
            timeout=10.0,
        )
        driving_task = client.get(
            GOOGLE_DIRECTIONS_URL,
            params={**common_params, "origin": origin_str, "destination": dest_str,
                    "mode": "driving", "departure_time": now_ts},
            timeout=10.0,
        )
        walking_task = client.get(
            GOOGLE_DIRECTIONS_URL,
            params={**common_params, "origin": origin_str, "destination": dest_str,
                    "mode": "walking"},
            timeout=10.0,
        )

        transit_resp, driving_resp, walking_resp = await asyncio.gather(
            transit_task, driving_task, walking_task, return_exceptions=True
        )

        options: list[dict] = []
        distance_km: float  = 0.0
        driving_duration    = ""

        # ── Parse transit routes ──────────────────────────────────────────────
        if not isinstance(transit_resp, Exception):
            t_data = transit_resp.json()
            if t_data.get("status") == "OK":
                seen_labels: set[str] = set()
                for route in t_data.get("routes", [])[:3]:
                    leg    = route["legs"][0]
                    option = _parse_transit_leg(leg)
                    if option and option["label"] not in seen_labels:
                        options.append(option)
                        seen_labels.add(option["label"])
            elif t_data.get("status") == "ZERO_RESULTS":
                logger.info("No transit routes found for this origin/destination pair.")
            else:
                logger.warning("Transit API status: %s", t_data.get("status"))

        # ── Parse driving (used for auto + cab estimates) ─────────────────────
        if not isinstance(driving_resp, Exception):
            d_data = driving_resp.json()
            if d_data.get("status") == "OK":
                d_leg            = d_data["routes"][0]["legs"][0]
                distance_km      = d_leg["distance"]["value"] / 1000
                driving_duration = d_leg.get("duration_in_traffic", d_leg["duration"])["text"]
            else:
                logger.warning("Driving API status: %s — using haversine estimate", d_data.get("status"))

        # Use real driving distance or haversine fallback for fare calculations
        fare_km      = distance_km if distance_km > 0 else estimated_km
        fare_dur_str = driving_duration if driving_duration else f"~{int(fare_km / 0.4)} min (est.)"

        # Auto-rickshaw (always show — fares from official RTA rates)
        options.append({
            "mode":          "auto",
            "icon":          "🛺",
            "label":         "Auto-rickshaw",
            "duration":      fare_dur_str,
            "fare_estimate": _auto_fare(fare_km, req.city),
            "note":          "Metered in most cities. Confirm fare before boarding. Night charges (10 PM–5 AM) are usually 1.5×."
                             + ("" if distance_km > 0 else " (Fare based on straight-line estimate — actual may vary.)"),
            "steps":         [],
            "is_realtime":   False,
        })

        # Cab — Ola + Uber deep links (always show)
        o_name    = quote(req.origin_text or "Current location")
        d_name    = quote(req.destination_name)
        ola_link  = (
            f"https://book.olacabs.com/?pickup_lat={origin_coords[0]}"
            f"&pickup_lng={origin_coords[1]}&pickup_name={o_name}"
            f"&drop_lat={req.destination_lat}&drop_lng={req.destination_lng}"
            f"&drop_name={d_name}&category=auto"
        )
        uber_link = (
            f"https://m.uber.com/ul/?action=setPickup"
            f"&pickup[latitude]={origin_coords[0]}&pickup[longitude]={origin_coords[1]}"
            f"&pickup[nickname]={o_name}"
            f"&dropoff[latitude]={req.destination_lat}&dropoff[longitude]={req.destination_lng}"
            f"&dropoff[nickname]={d_name}"
        )
        options.append({
            "mode":          "cab",
            "icon":          "🚕",
            "label":         "Cab",
            "duration":      fare_dur_str,
            "fare_estimate": _cab_fare(fare_km, req.city),
            "note":          "Estimate only. Actual price shown in Ola/Uber app. May surge during peak hours.",
            "ola_link":      ola_link,
            "uber_link":     uber_link,
            "steps":         [],
            "is_realtime":   False,
        })

        # ── Parse walking (only show if ≤ 3 km) ──────────────────────────────
        if not isinstance(walking_resp, Exception):
            w_data = walking_resp.json()
            if w_data.get("status") == "OK":
                w_leg    = w_data["routes"][0]["legs"][0]
                walk_km  = w_leg["distance"]["value"] / 1000
                if walk_km <= 3.0:
                    options.append({
                        "mode":         "walk",
                        "icon":         "🚶",
                        "label":        "Walk",
                        "duration":     w_leg["duration"]["text"],
                        "fare_estimate": "Free",
                        "distance":     f"{walk_km:.1f} km",
                        "note":         "Use footpaths where available. Avoid walking in heavy traffic areas.",
                        "steps":        [],
                        "is_realtime":  False,
                    })

        city_lower = req.city.lower().strip()

        # ── Rapido bike taxi ──────────────────────────────────────────────────
        # Available in 100+ Indian cities. Fastest in congested city traffic.
        if city_lower in RAPIDO_CITIES and fare_km <= 20.0:
            options.append({
                "mode":          "rapido",
                "icon":          "🛵",
                "label":         "Rapido Bike Taxi",
                "duration":      fare_dur_str,
                "fare_estimate": _rapido_fare(fare_km, req.city),
                "note":          "Quickest & cheapest motorised option in city traffic. No surge pricing on short rides. Helmets provided.",
                "rapido_link":   "https://rapido.bike/",
                "steps":         [],
                "is_realtime":   False,
            })

        # ── Share auto (South India fixed-route autos) ────────────────────────
        if city_lower in SHARE_AUTO_CITIES and fare_km <= 8.0:
            options.append({
                "mode":          "share_auto",
                "icon":          "🚐",
                "label":         "Share Auto",
                "duration":      "Varies by route",
                "fare_estimate": "₹10–25 per person",
                "note":          "Flag one down on the main road heading your direction. No app needed — ask locals for the right route. Stops are near bus stands and main junctions.",
                "steps":         [],
                "is_realtime":   False,
            })

        # ── E-rickshaw / Toto ─────────────────────────────────────────────────
        if city_lower in ERICKSHAW_CITIES and fare_km <= 5.0:
            options.append({
                "mode":          "erickshaw",
                "icon":          "⚡",
                "label":         "E-Rickshaw / Toto",
                "duration":      "Short trips only",
                "fare_estimate": "₹20–50",
                "note":          ERICKSHAW_CITIES[city_lower],
                "steps":         [],
                "is_realtime":   False,
            })

        # ── Walk (straight-line fallback when API unavailable) ───────────────
        # If walking API gave us a route, it's already added. Add estimate if short.
        has_walk = any(o["mode"] == "walk" for o in options)
        if not has_walk and straight_km <= 2.5:
            walk_min = int(straight_km * 12)  # ~5 km/h walking speed
            options.append({
                "mode":          "walk",
                "icon":          "🚶",
                "label":         "Walk",
                "duration":      f"~{walk_min} min (est.)",
                "fare_estimate": "Free",
                "distance":      f"{straight_km:.1f} km (straight-line)",
                "note":          "Short enough to walk. Use Google Maps for exact footpath directions.",
                "steps":         [],
                "is_realtime":   False,
            })

        # ── Ferry / Boat ──────────────────────────────────────────────────────
        if city_lower in FERRY_CITIES:
            options.append({
                "mode":          "ferry",
                "icon":          "⛴️",
                "label":         "Ferry / Boat",
                "duration":      "Varies by route",
                "fare_estimate": "₹5–200",
                "note":          FERRY_CITIES[city_lower],
                "steps":         [],
                "is_realtime":   False,
            })

        # ── City bus fallback (when GTFS/transit data unavailable) ────────────
        has_transit = any(o["mode"] == "transit" for o in options)
        if not has_transit:
            bus_note = CITY_BUS_NOTES.get(
                city_lower,
                "City buses likely operate on this route. Ask at the nearest bus stop or check the state RTC website for route numbers. Fare usually ₹5–30.",
            )
            options.append({
                "mode":          "transit",
                "icon":          "🚌",
                "label":         "City Bus",
                "duration":      "Varies",
                "fare_estimate": "₹5–30",
                "note":          bus_note,
                "steps":         [],
                "is_realtime":   False,
            })

        if not options:
            raise HTTPException(
                status_code=404,
                detail="No transport options found. Make sure GOOGLE_MAPS_API_KEY has Directions API enabled.",
            )

        return {
            "origin":      req.origin_text or "Your location",
            "destination": req.destination_name,
            "distance_km": round(fare_km, 1),
            "options":     options,
        }
