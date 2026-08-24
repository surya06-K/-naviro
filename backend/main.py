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
import secrets
import httpx
import asyncio
import logging
import math
from collections import OrderedDict
from typing import Any, Literal, Optional
from urllib.parse import quote

from groq import AsyncGroq, BadRequestError as GroqBadRequestError

import database
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
# Render (and most PaaS hosts) sit the app behind one reverse proxy, so
# request.client.host is the proxy's own address — the same for every visitor —
# not the real caller. Set this to how many trusted hops sit in front of the app
# (1 for Render) so we read the right X-Forwarded-For entry instead of rate
# limiting the entire site as a single client.
TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "1") or "1")
_request_windows: dict[str, tuple[float, int]] = {}


def _client_ip(request: Request) -> str:
    """Best-effort real client IP behind TRUSTED_PROXY_HOPS reverse proxies.

    X-Forwarded-For is appended-to by each trusted hop it passes through, so the
    entry TRUSTED_PROXY_HOPS-from-the-right is the address our own edge proxy
    observed — i.e. the real caller. The leftmost entries are whatever the
    caller claimed and are trivially spoofable, so they're never trusted."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and TRUSTED_PROXY_HOPS > 0:
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if len(hops) >= TRUSTED_PROXY_HOPS:
            return hops[-TRUSTED_PROXY_HOPS]
    return request.client.host if request.client else "unknown"


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
    client_key = _client_ip(request)
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
- Pace (relaxed = 2–3 spots/day, balanced = 3–4, packed = 4–5) — if the message states a
  stop count or pace, hit that count for EVERY day. Don't default to 3 out of habit.

Everything you pick must reflect THEIR specific inputs, not a generic tourist's.

━━━ STEP 2: BUILD A LOGICAL DAY ━━━
Each day must have an intentional arc — not three random spots scattered across the city.

GEOGRAPHIC FLOW: Plan the day so its spots are near each other or on a natural route. Don't make someone go north → south → north.

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

# ── In-memory session cache — fast-path LRU in front of SQLite persistence ───
# (see get_session_history / save_session_history below; a Render cold start
# wipes this dict, but the DB row survives it)
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
    """Read-through cache: in-memory first, then SQLite, then a fresh
    system-prompt-only history. Free-tier hosts (Render) cold-start the
    backend after an idle period, wiping `sessions` — the DB row is what
    lets a mid-refinement session recover its prior turns after that."""
    history = sessions.get(session_id)
    if history is None:
        persisted = None
        try:
            persisted = database.load_session_history(session_id)
        except Exception as e:
            logger.warning("Failed to load session %s from database: %s", session_id, e)
        history = persisted if persisted is not None else [{"role": "system", "content": SYSTEM_PROMPT}]
        sessions[session_id] = history
    sessions.move_to_end(session_id)
    while len(sessions) > MAX_ACTIVE_SESSIONS:
        sessions.popitem(last=False)
    return history


def save_session_history(session_id: str, history: list[dict[str, str]]) -> None:
    """Persist session history to SQLite so it survives a cold start.
    Best-effort: a persistence failure shouldn't break a response that
    otherwise succeeded, so errors are logged and swallowed."""
    try:
        database.save_session_history(session_id, history)
    except Exception as e:
        logger.warning("Failed to persist session %s to database: %s", session_id, e)

# ── LocationIQ geocoding / place verification ────────────────────────────────
# Switched from Google Maps Platform (2026-08-24): Google requires a billing
# account before Geocoding/Places will respond at all, and that billing
# verification kept failing for reasons outside this app's control (payment
# method rejected). LocationIQ's free tier needs no card, and its Search/
# Nearby endpoints use the same OpenStreetMap data and query shape as the
# Nominatim fallback below — but it carries no ratings/reviews/business-status/
# opening-hours, so that evidence layer is gone from ItinerarySlot entirely,
# not just hidden. "verified" now means only "this is a real, locatable
# place", never "and here's evidence about it".
LOCATIONIQ_API_KEY = os.getenv("LOCATIONIQ_API_KEY", "")
LOCATIONIQ_SEARCH_URL = "https://us1.locationiq.com/v1/search"
LOCATIONIQ_NEARBY_URL = "https://us1.locationiq.com/v1/nearby"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
# LocationIQ's free plan allows 2 req/sec on ITS OWN account quota — unlike
# Nominatim's shared-public-server etiquette limit below, this is ours alone,
# so it only needs to stay under that cap, not be maximally polite. A single
# semaphore(1) with a per-call sleep would under-use the allowance (each call
# pays the sleep AND its own network latency serially); 2 concurrent slots
# each held for a full second correctly caps throughput at 2/sec while
# actually using both.
_LOCATIONIQ_RPS = float(os.getenv("LOCATIONIQ_RPS", "2") or "2")
_LOCATIONIQ_CONCURRENCY = max(1, int(_LOCATIONIQ_RPS))
_locationiq_semaphore = asyncio.Semaphore(_LOCATIONIQ_CONCURRENCY)
_NOMINATIM_CONCURRENCY = int(os.getenv("NOMINATIM_CONCURRENCY", "1") or "1")
_nominatim_semaphore = asyncio.Semaphore(_NOMINATIM_CONCURRENCY)
_geocode_cache: dict[str, dict] = {}
_nominatim_headers = {
    # Nominatim requires a valid User-Agent; keep it stable and specific.
    "User-Agent": "naviro/1.0 (travel.ai)",
}
MAX_PLACE_DISTANCE_KM = float(os.getenv("MAX_PLACE_DISTANCE_KM", "35") or "35")

# ── OpenWeather — current conditions only, never a future-day forecast ──────
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
OPENWEATHER_CURRENT_URL = "https://api.openweathermap.org/data/2.5/weather"


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


async def _locationiq_search(client: httpx.AsyncClient, query: str, limit: int = 1) -> list[dict]:
    """Raw LocationIQ Search results for `query`, or [] on any failure (no
    key, network error, no match, 401). Never raises — callers decide what
    "no result" means for them (unverified place vs. ungeocodable city
    center)."""
    if not LOCATIONIQ_API_KEY:
        return []
    async with _locationiq_semaphore:
        await asyncio.sleep(_LOCATIONIQ_CONCURRENCY / _LOCATIONIQ_RPS)
        try:
            resp = await client.get(
                LOCATIONIQ_SEARCH_URL,
                params={
                    "key": LOCATIONIQ_API_KEY,
                    "q": query,
                    "format": "json",
                    "limit": limit,
                    "countrycodes": "in",
                },
                timeout=8.0,
            )
            if resp.status_code == 401:
                logger.error("LocationIQ key rejected (401) for query '%s'", query)
                return []
            data = resp.json()
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.warning("LocationIQ search error for '%s': %s", query, e)
            return []


async def geocode_city_center(client: httpx.AsyncClient, city: str) -> dict:
    """Resolve the destination city center via LocationIQ (fallback: Nominatim)."""
    if LOCATIONIQ_API_KEY:
        results = await _locationiq_search(client, f"{city}, India")
        if results:
            try:
                return {"lat": float(results[0]["lat"]), "lng": float(results[0]["lon"])}
            except (KeyError, ValueError, TypeError):
                pass
    return await _nominatim_geocode(client, f"{city}, India")


async def _nominatim_fallback_coords(
    client: httpx.AsyncClient, place_name: str, city: str, city_center: dict
) -> Optional[dict]:
    """Last-resort real geocode when Places can't confirm a place at all. Never
    treated as verification — just a real point on the map, so the itinerary
    still has *a* pin while the offender goes through repair. Two query
    variants, not three — Nominatim's 1.1s/request politeness throttle means
    every extra variant is a full second added to this slot's worst-case
    latency, and the third, least-specific variant ("{place_name}, India")
    is also the one least likely to land near the right city anyway."""
    for query in [f"{place_name}, {city}, India", f"{place_name}, {city}"]:
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
    return None


async def _verify_place(
    client: httpx.AsyncClient, place_name: str, city: str, city_center: dict
) -> Optional[dict]:
    """Confirm a place is real via LocationIQ Search. Returns None when it
    can't be confirmed (no key, no result, or too far from the destination) —
    the caller treats None as an invented place needing repair, never as a
    reason to quietly scatter a fake pin near the city center.

    Unlike the Google Places version this replaced, there is no business-
    status or opening-hours data available here, so a temporarily/permanently
    closed place can't be detected this way anymore — "verified" means only
    "this is a real, locatable place"."""
    if not LOCATIONIQ_API_KEY:
        return None

    for query in [f"{place_name}, {city}", f"{place_name}, {city}, India", f"{place_name}, India"]:
        results = await _locationiq_search(client, query)
        if not results:
            continue
        try:
            lat, lng = float(results[0]["lat"]), float(results[0]["lon"])
        except (KeyError, ValueError, TypeError):
            continue

        if (
            city_center["lat"] != 0.0
            and city_center["lng"] != 0.0
            and _distance_km(city_center["lat"], city_center["lng"], lat, lng) > MAX_PLACE_DISTANCE_KM
        ):
            logger.warning("LocationIQ result for '%s' too far from '%s' — skipping", place_name, city)
            continue

        return {"lat": lat, "lng": lng}

    return None


async def _places_nearby(
    client: httpx.AsyncClient, lat: float, lng: float, osm_tag: str, limit: int = 2
) -> list[dict]:
    """Real, verifiable results only — returns [] on any failure rather than
    inventing a placeholder. Used for emergency info, where a wrong address is
    worse than no address. `osm_tag` is an OpenStreetMap key:value pair, e.g.
    "amenity:hospital" or "amenity:police". `maps_url` links to a plain
    Google Maps coordinate search rather than a Places `place_id` deep link —
    LocationIQ's place_id is an OSM reference, not a Google Maps one, so it
    can't be used to build that kind of link; a coordinate search works
    regardless of which provider found the point."""
    if not LOCATIONIQ_API_KEY:
        return []
    try:
        resp = await client.get(
            LOCATIONIQ_NEARBY_URL,
            params={
                "key": LOCATIONIQ_API_KEY,
                "lat": lat,
                "lon": lng,
                "tag": osm_tag,
                "radius": 5000,
                "limit": limit,
            },
            timeout=8.0,
        )
        if resp.status_code != 200:
            logger.warning("LocationIQ nearby search (%s) status=%s", osm_tag, resp.status_code)
            return []
        data = resp.json()
        if not isinstance(data, list):
            return []
        results = []
        for place in data[:limit]:
            name = place.get("name") or (place.get("display_name") or "").split(",")[0]
            if not name:
                continue
            try:
                p_lat, p_lng = float(place["lat"]), float(place["lon"])
            except (KeyError, ValueError, TypeError):
                continue
            results.append(
                {
                    "name": name,
                    "address": place.get("display_name") or "Address unavailable — see map",
                    "maps_url": f"https://www.google.com/maps/search/?api=1&query={p_lat},{p_lng}",
                }
            )
        return results
    except Exception as e:
        logger.warning("LocationIQ nearby search (%s) error: %s", osm_tag, e)
        return []


async def get_weather_context(client: httpx.AsyncClient, city: str) -> Optional[str]:
    """Best-effort *current* conditions for the destination city, phrased as a
    ready-to-inject hint for the planning conversation. Naviro only collects a
    trip's day *count*, never real dates, so there is no way to fetch a
    forecast for any specific day of the trip — this stays honest about that
    limit instead of overclaiming, and only offers today's weather as general
    seasonal awareness (e.g. lean indoors if it's currently pouring or very
    hot), never as a guarantee about any specific day. Returns None (never
    raises) when no key is configured, the request fails, or the response is
    missing fields we need — silence here just means the itinerary is built
    without a weather nudge, not that anything is broken."""
    if not OPENWEATHER_API_KEY:
        return None
    try:
        resp = await client.get(
            OPENWEATHER_CURRENT_URL,
            params={"q": f"{city},IN", "appid": OPENWEATHER_API_KEY, "units": "metric"},
            timeout=8.0,
        )
        if not resp.is_success:
            logger.warning("OpenWeather request for '%s' failed with status %s", city, resp.status_code)
            return None
        data = resp.json()
        description = data["weather"][0]["description"]
        temp = round(data["main"]["temp"])
        return (
            f"Current conditions in {city}: {description}, {temp}°C. This is "
            "today's weather, not a forecast for the trip's actual dates — use it "
            "only as general seasonal awareness (e.g. lean toward indoor/shaded "
            "picks if it's currently very rainy or very hot), not as a guarantee "
            "about any specific day."
        )
    except Exception as e:
        logger.warning("OpenWeather lookup failed for '%s': %s", city, e)
        return None


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
                        "reason": "too far",
                        "distance_km": round(distance_km, 1),
                    }
                )
    return offenders


def _dedupe_offenders(offenders: list[dict]) -> list[dict]:
    """A slot can be flagged for more than one reason (e.g. unverified AND, once
    a fallback geocode lands it somewhere odd, too far). Keep the first reason
    found per (day_number, place_name) rather than asking the LLM to repair the
    same slot twice over in one prompt."""
    seen: set[tuple] = set()
    deduped = []
    for offender in offenders:
        key = (offender.get("day_number"), offender.get("place_name"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(offender)
    return deduped


async def _repair_itinerary_far_places(itinerary: dict, offenders: list[dict]) -> Optional[dict]:
    """Ask the LLM to replace unusable picks with better local alternatives (JSON-only)."""
    if llm is None or not offenders:
        return None

    repair_prompt = """You are repairing a travel itinerary JSON.

Some slots are flagged as offenders, each with a reason: "too far" (not actually inside
the destination town/city) or "not found" (could not be confirmed as a real, findable
place). Replace ONLY the flagged slots with better local alternatives that don't have the
same problem. Keep everything else unchanged.

Rules:
- Preserve: destination, total_days, day_number/day_title structure, and time_of_day values.
- For each offender slot: change place_name/description/how_to_get_there/estimated_*/local_tip
  to a real, well-known, specific place inside the destination town/city or immediate
  outskirts (<= 20 km) that fits the reason it was flagged for.
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
    """Verify + geocode, then repair unverified/closed/mistimed/out-of-town slots
    once and verify again. One retry, same philosophy as the LLM's own
    structured-output retry: fix once, then be honest about whatever's left."""
    itinerary, offenders = await geocode_itinerary(itinerary)

    city = itinerary.get("destination", "")
    async with httpx.AsyncClient() as client:
        city_center = await geocode_city_center(client, city)

    offenders = _dedupe_offenders(offenders + _find_slots_outside_radius(itinerary, city_center))
    if not offenders:
        return itinerary

    logger.warning("Itinerary offenders for '%s': %s", city, offenders)

    repaired = await _repair_itinerary_far_places(itinerary, offenders)
    if not repaired:
        return itinerary

    repaired, _ = await geocode_itinerary(repaired)
    return repaired


async def geocode_itinerary(itinerary: dict) -> tuple[dict, list[dict]]:
    """Verify + geocode every place via LocationIQ (fallback: Nominatim).

    Returns (itinerary, offenders). An offender is a slot that couldn't be
    confirmed as a real, locatable place — the caller decides whether to run
    a repair pass. This function never invents evidence or silently treats a
    guess as a confirmed place; unconfirmed slots still get *a* real (if
    approximate) pin via Nominatim/city-center scatter so the map isn't left
    with a hole, but are marked verified=False and reported as offenders
    rather than passed off as solid.

    Unlike the Google Places version this replaced, there's no business-status
    or opening-hours data available, so a closed or badly-timed-but-real place
    can no longer be detected here — only "does this place exist at all"."""
    city = itinerary.get("destination", "")
    offenders: list[dict] = []
    async with httpx.AsyncClient() as client:
        city_center = await geocode_city_center(client, city)
        if city_center["lat"] == 0.0 and city_center["lng"] == 0.0:
            logger.warning("Could not resolve city center for '%s'", city)

        tasks = []
        for d_idx, day in enumerate(itinerary.get("days", [])):
            for s_idx, slot in enumerate(day.get("slots", [])):
                place_name = slot.get("place_name", "")
                if place_name:
                    tasks.append((d_idx, s_idx, place_name, slot.get("time_of_day", "")))

        # Fired in parallel; _verify_place's own semaphore keeps this within
        # LocationIQ's 2 req/sec account quota regardless of how many run here.
        results = await asyncio.gather(
            *[_verify_place(client, place_name, city, city_center) for _, _, place_name, _ in tasks],
            return_exceptions=True,
        )

        for (d_idx, s_idx, place_name, time_of_day), verified in zip(tasks, results):
            slot_dict = itinerary["days"][d_idx]["slots"][s_idx]
            day_number = itinerary["days"][d_idx].get("day_number", d_idx + 1)

            if isinstance(verified, Exception):
                logger.warning("Verification error for '%s': %s", place_name, verified)
                verified = None

            if verified is not None:
                slot_dict["coordinates"] = {"lat": verified["lat"], "lng": verified["lng"]}
                slot_dict["verified"] = True
                continue

            offenders.append({
                "day_number": day_number,
                "time_of_day": time_of_day,
                "place_name": place_name,
                "reason": "not found",
            })

            fallback_coords = await _nominatim_fallback_coords(client, place_name, city, city_center)
            if fallback_coords is None and city_center["lat"] != 0.0:
                offsets = [(-0.012, -0.008), (0.010, 0.006), (0.004, -0.011)]
                lat_off, lng_off = offsets[s_idx % len(offsets)]
                fallback_coords = {
                    "lat": city_center["lat"] + lat_off + d_idx * 0.0015,
                    "lng": city_center["lng"] + lng_off + d_idx * 0.0015,
                }
                logger.warning(
                    "Fallback coords used for '%s' in '%s' (day %s slot %s)",
                    place_name, city, d_idx + 1, s_idx + 1,
                )
            slot_dict["coordinates"] = fallback_coords or {"lat": 0.0, "lng": 0.0}
            slot_dict["verified"] = False

    return itinerary, offenders

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
    # Filled in by geocoding/verification, never by the LLM. False means
    # LocationIQ couldn't confirm this as a real place — the pin shown is an
    # approximate fallback, not a confirmed location.
    verified: bool = False


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


_TIME_OF_DAY_ORDER = {"morning": 0, "afternoon": 1, "evening": 2}


class ItineraryDay(BaseModel):
    day_number: int = Field(ge=1, le=30)
    day_title: str = Field(min_length=1, max_length=160)
    # 2-5 covers the full pace range (relaxed 2-3, balanced 3-4, packed 4-5) —
    # a day can have more than one stop in the same band, so this is no longer
    # a fixed "exactly one morning/afternoon/evening" triple.
    slots: list[ItinerarySlot] = Field(min_length=2, max_length=5)

    @model_validator(mode="after")
    def slots_progress_chronologically(self):
        positions = [_TIME_OF_DAY_ORDER.get(slot.time_of_day.lower().strip(), -1) for slot in self.slots]
        if positions != sorted(positions):
            raise ValueError("Slots must progress morning → afternoon → evening, never backward")
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
    slots: list[ItinerarySlotDraft] = Field(min_length=2, max_length=5)

    @model_validator(mode="after")
    def slots_progress_chronologically(self):
        # Strict mode's enum guarantees each time_of_day is valid; it can't
        # guarantee they appear in non-decreasing order, so we still check that.
        positions = [_TIME_OF_DAY_ORDER.get(slot.time_of_day, -1) for slot in self.slots]
        if positions != sorted(positions):
            raise ValueError("Slots must progress morning → afternoon → evening, never backward")
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
    # Sourced from LocationIQ Nearby search + a hardcoded national number, not
    # the LLM — a fabricated hospital address or phone number is the one
    # category of wrong answer that can hurt someone. hospitals/police_station
    # are empty/None (never invented) when LocationIQ is unavailable; the
    # frontend shows an honest "couldn't verify" state in that case.
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
    # Bound matches ItineraryDay's 2-5 (Step 2) — a packed day has up to 5
    # remaining slots to replace, not the old fixed-3 max.
    slots: list[ItinerarySlot] = Field(min_length=1, max_length=5)


class ReplanResponseDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slots: list[ItinerarySlotDraft] = Field(min_length=1, max_length=5)


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
    # Known up front from the trip-planning form (unlike freeform chat, where
    # the destination only exists inside the LLM's own response) — lets us
    # fetch weather context before generating instead of after.
    destination: Optional[str] = Field(default=None, max_length=120)

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
        "locationiq_configured": bool(LOCATIONIQ_API_KEY),
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

        # Weather is a same-day nudge, not part of the durable conversation — built
        # fresh per request and never persisted into `history`, so it can't go stale
        # in a saved session or pile up as repeated blurbs across refinements.
        messages_for_llm = history
        if request.destination:
            async with httpx.AsyncClient() as client:
                weather_context = await get_weather_context(client, request.destination)
            if weather_context:
                messages_for_llm = history + [{"role": "system", "content": weather_context}]

        draft = await _generate_and_validate(
            messages_for_llm, schema_name="itinerary", schema=ITINERARY_DRAFT_SCHEMA, model=ItineraryDraft
        )
        geocoded = await geocode_itinerary_with_repair(draft.to_final_dict())
        itinerary = Itinerary.model_validate(geocoded)

        # Only retain a valid model response as conversation context.
        history.append({"role": "assistant", "content": json.dumps(draft.model_dump())})
        save_session_history(request.session_id, history)
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
                    _places_nearby(client, city_center["lat"], city_center["lng"], "amenity:hospital"),
                    _places_nearby(client, city_center["lat"], city_center["lng"], "amenity:police", limit=1),
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
    original_slots: list[ItinerarySlot] = Field(min_length=1, max_length=5)
    completed_slots: list[str] = Field(default_factory=list, max_length=5)
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
        geocoded, _ = await geocode_itinerary(dummy_itinerary)
        return ReplanResponse.model_validate({"slots": geocoded["days"][0]["slots"]})
    except (ValueError, ValidationError, json.JSONDecodeError, GroqBadRequestError):
        logger.warning("Rejected invalid replan response for %s", request.destination)
        raise HTTPException(status_code=502, detail="Naviro could not create a reliable replanned route. Please try again.")
    except Exception:
        logger.exception("Error in /api/replan")
        raise HTTPException(status_code=500, detail="Naviro could not replan your trip right now. Please try again.")


# ── Save & Share ────────────────────────────────────────────────────────────────
class SaveTripResponse(BaseModel):
    slug: str


@app.post("/api/trip", response_model=SaveTripResponse)
async def save_trip(itinerary: Itinerary):
    slug = secrets.token_urlsafe(6)  # ~8 url-safe chars, collision chance negligible at this scale
    try:
        database.save_trip(slug, itinerary.model_dump())
    except Exception:
        logger.exception("Failed to save trip")
        raise HTTPException(status_code=500, detail="Could not save this trip. Please try again.")
    return SaveTripResponse(slug=slug)


@app.get("/api/trip/{slug}", response_model=Itinerary)
async def get_trip(slug: str):
    # slug is a random token_urlsafe string used only as a SQLite lookup key
    # (parameterized query already prevents injection) — a garbage/guessed
    # slug just misses and falls through to the 404 below, which is a safe
    # enough failure mode that extra shape validation here isn't worth it.
    try:
        data = database.load_trip(slug)
    except Exception:
        logger.exception("Failed to load trip %s", slug)
        raise HTTPException(status_code=500, detail="Could not load this trip.")
    if data is None:
        raise HTTPException(status_code=404, detail="This trip link doesn't exist or has expired.")
    return Itinerary.model_validate(data)
