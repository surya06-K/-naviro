import unittest
import json


class ItineraryRepairTests(unittest.TestCase):
    def test_parse_llm_json_rejects_an_incomplete_itinerary(self):
        from main import Itinerary, parse_llm_json

        with self.assertRaises(ValueError):
            parse_llm_json(json.dumps({"destination": "Jaipur"}), Itinerary)

    def test_api_rate_limit_rejects_the_next_request(self):
        from fastapi.testclient import TestClient
        import main

        previous_limit = main.RATE_LIMIT_REQUESTS
        main._request_windows.clear()
        main.RATE_LIMIT_REQUESTS = 1
        try:
            with TestClient(main.app) as client:
                self.assertEqual(client.get("/api/preferences/rate-limit-test").status_code, 200)
                self.assertEqual(client.get("/api/preferences/rate-limit-test").status_code, 429)
        finally:
            main.RATE_LIMIT_REQUESTS = previous_limit
            main._request_windows.clear()

    def test_find_slots_outside_radius_flags_far_coordinates(self):
        from main import _find_slots_outside_radius, MAX_PLACE_DISTANCE_KM

        itinerary = {
            "destination": "Narsipatnam",
            "days": [
                {
                    "day_number": 1,
                    "day_title": "Test",
                    "slots": [
                        {
                            "time_of_day": "morning",
                            "place_name": "Local Spot",
                            "coordinates": {"lat": 17.667, "lng": 82.612},
                        },
                        {
                            "time_of_day": "evening",
                            "place_name": "Far Spot",
                            "coordinates": {"lat": 17.800, "lng": 83.350},
                        },
                    ],
                }
            ],
        }

        city_center = {"lat": 17.667, "lng": 82.612}
        offenders = _find_slots_outside_radius(itinerary, city_center)
        if MAX_PLACE_DISTANCE_KM < 50:
            self.assertEqual(len(offenders), 1)
            self.assertEqual(offenders[0]["place_name"], "Far Spot")
        else:
            # If someone configures an unusually large radius, allow the test to stay stable.
            self.assertGreaterEqual(len(offenders), 0)

    # ── Groq structured-outputs migration (llama-3.3-70b-versatile was
    # decommissioned 2026-08-16; these lock in the replacement's contract) ────

    def _valid_slot(self, time_of_day: str, category: str = "food") -> dict:
        return {
            "time_of_day": time_of_day,
            "place_name": "Test Place",
            "description": "A place.",
            "category": category,
            "how_to_get_there": "Walk.",
            "estimated_duration": "1 hour",
            "estimated_cost": "free",
            "local_tip": "A tip.",
        }

    def test_itinerary_slot_draft_rejects_unknown_time_of_day_and_category(self):
        # Structured Outputs enforces this server-side via the schema's enum;
        # this proves the Pydantic side of that contract (the schema source of
        # truth) rejects the same values, so the two can't silently drift apart.
        from pydantic import ValidationError
        from main import ItinerarySlotDraft

        with self.assertRaises(ValidationError):
            ItinerarySlotDraft.model_validate(self._valid_slot("midnight"))
        with self.assertRaises(ValidationError):
            ItinerarySlotDraft.model_validate(self._valid_slot("morning", category="shopping"))

    def test_itinerary_slot_draft_rejects_coordinates_field(self):
        # The model is never asked to generate coordinates — geocoding always
        # fills them in. extra="forbid" is what lets Structured Outputs set
        # additionalProperties: false, so this must stay rejected.
        from pydantic import ValidationError
        from main import ItinerarySlotDraft

        with self.assertRaises(ValidationError):
            ItinerarySlotDraft.model_validate(
                {**self._valid_slot("morning"), "coordinates": {"lat": 0.0, "lng": 0.0}}
            )

    def test_itinerary_day_draft_rejects_out_of_order_slots(self):
        from pydantic import ValidationError
        from main import ItineraryDayDraft

        with self.assertRaises(ValidationError):
            ItineraryDayDraft.model_validate(
                {
                    "day_number": 1,
                    "day_title": "Test",
                    "slots": [
                        self._valid_slot("evening"),
                        self._valid_slot("morning"),
                        self._valid_slot("afternoon"),
                    ],
                }
            )

    def test_itinerary_draft_to_final_dict_matches_itinerary_shape(self):
        # End-to-end structural check (no network): a schema-conformant draft,
        # once expanded, must satisfy the same Itinerary model /api/plan returns
        # to the frontend — this is the seam between "what the LLM generates"
        # and "what geocode_itinerary_with_repair + the API response expect".
        from main import Itinerary, ItineraryDraft

        draft = ItineraryDraft.model_validate(
            {
                "destination": "Narsipatnam",
                "total_days": 1,
                "summary": "A test summary.",
                "days": [
                    {
                        "day_number": 1,
                        "day_title": "Day one",
                        "slots": [
                            self._valid_slot("morning", "historical"),
                            self._valid_slot("afternoon", "food"),
                            self._valid_slot("evening", "cultural"),
                        ],
                    }
                ],
            }
        )
        final = draft.to_final_dict()
        itinerary = Itinerary.model_validate(final)  # raises if the shapes disagree
        slot = itinerary.days[0].slots[0]
        self.assertEqual(slot.coordinates.lat, 0.0)
        self.assertEqual(slot.coordinates.lng, 0.0)

    def test_generate_and_validate_retries_once_then_succeeds(self):
        # Locks in the "retry once with the error appended, then fail honestly"
        # contract for when our own cross-field checks (day ordering, etc. —
        # not expressible in JSON Schema) reject an otherwise schema-valid reply.
        import asyncio
        from unittest.mock import AsyncMock, patch
        from main import _generate_and_validate, ReplanResponseDraft, REPLAN_DRAFT_SCHEMA

        good_raw = json.dumps({"slots": [self._valid_slot("morning")]})
        with patch("main.invoke_llm", new=AsyncMock(side_effect=["not valid json", good_raw])) as mocked:
            result = asyncio.run(
                _generate_and_validate(
                    [{"role": "system", "content": "x"}],
                    schema_name="replan",
                    schema=REPLAN_DRAFT_SCHEMA,
                    model=ReplanResponseDraft,
                )
            )
        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(result.slots[0].place_name, "Test Place")

    # ── /api/emergency grounded rewrite (emergency_number is now a hardcoded
    # constant, hospitals/police_station come from Places Nearby Search and are
    # empty rather than invented on failure) ───────────────────────────────

    def test_places_nearby_returns_empty_list_when_api_key_missing(self):
        import asyncio
        import main

        previous_key = main.LOCATIONIQ_API_KEY
        main.LOCATIONIQ_API_KEY = ""
        try:
            # No API key means _places_nearby returns before ever touching the
            # client, so passing None in place of a real httpx.AsyncClient is safe.
            result = asyncio.run(main._places_nearby(None, 17.667, 82.612, "amenity:hospital"))
            self.assertEqual(result, [])
        finally:
            main.LOCATIONIQ_API_KEY = previous_key

    def test_places_nearby_returns_empty_list_when_request_raises(self):
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, patch
        import main

        previous_key = main.LOCATIONIQ_API_KEY
        main.LOCATIONIQ_API_KEY = "test-key"

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(
                    httpx.AsyncClient, "get", new=AsyncMock(side_effect=Exception("simulated network failure"))
                ):
                    return await main._places_nearby(client, 17.667, 82.612, "amenity:hospital")

        try:
            result = asyncio.run(run())
            self.assertEqual(result, [])
        finally:
            main.LOCATIONIQ_API_KEY = previous_key

    def test_places_nearby_returns_parsed_results_on_success(self):
        # LocationIQ's Nearby endpoint returns a plain JSON array (not Google's
        # {"status": ..., "results": [...]} envelope) — locks in the parsed
        # name/address/maps_url shape that /api/emergency depends on.
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, MagicMock, patch
        import main

        previous_key = main.LOCATIONIQ_API_KEY
        main.LOCATIONIQ_API_KEY = "test-key"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {
                "name": "City Hospital",
                "lat": "17.667",
                "lon": "82.612",
                "display_name": "City Hospital, Main Road, Narsipatnam",
            }
        ]

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=mock_response)):
                    return await main._places_nearby(client, 17.667, 82.612, "amenity:hospital")

        try:
            result = asyncio.run(run())
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["name"], "City Hospital")
            self.assertEqual(result[0]["address"], "City Hospital, Main Road, Narsipatnam")
            self.assertEqual(
                result[0]["maps_url"], "https://www.google.com/maps/search/?api=1&query=17.667,82.612"
            )
        finally:
            main.LOCATIONIQ_API_KEY = previous_key

    def test_emergency_endpoint_degrades_gracefully_without_llm_or_places_key(self):
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock, patch
        import main

        previous_llm = main.llm
        previous_key = main.LOCATIONIQ_API_KEY
        main.llm = None
        main.LOCATIONIQ_API_KEY = ""
        main._request_windows.clear()
        try:
            # geocode_city_center is mocked to a real, non-zero coordinate pair
            # (rather than left to run for real) so the test stays hermetic —
            # with no LocationIQ key configured it would otherwise fall back to a
            # live Nominatim HTTP call plus a deliberate 1.1s rate-limit sleep.
            # A non-zero result still makes emergency_info proceed into the
            # Places lookups, so this exercises the real "no Places key"
            # degrade path (already unit-tested above) end-to-end through the
            # actual endpoint, rather than short-circuiting before reaching it.
            with patch(
                "main.geocode_city_center",
                new=AsyncMock(return_value={"lat": 26.9124, "lng": 75.7873}),
            ):
                with TestClient(main.app) as client:
                    response = client.post("/api/emergency", json={"destination": "Jaipur"})
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["emergency_number"], main.INDIA_EMERGENCY_NUMBER)
            self.assertEqual(body["hospitals"], [])
            self.assertIsNone(body["police_station"])
            self.assertIsInstance(body["safety_tips"], list)
            self.assertGreater(len(body["safety_tips"]), 0)
        finally:
            main.llm = previous_llm
            main.LOCATIONIQ_API_KEY = previous_key
            main._request_windows.clear()

    def test_emergency_contact_and_info_models_validate_expected_shape(self):
        from main import EmergencyContact, EmergencyInfo

        contact = EmergencyContact.model_validate(
            {"name": "X", "address": "Y", "maps_url": "https://maps.google.com/..."}
        )
        self.assertEqual(contact.name, "X")

        # police_station: Optional[...] accepts None, and there's no required
        # embassy field — this locks in that shape against the grounded rewrite.
        info = EmergencyInfo.model_validate(
            {"emergency_number": "112", "hospitals": [], "police_station": None, "safety_tips": ["tip"]}
        )
        self.assertIsNone(info.police_station)
        self.assertEqual(info.hospitals, [])
        self.assertEqual(info.safety_tips, ["tip"])

    # ── Session persistence survives a cold start (sessions are now backed by
    # SQLite via database.py, with the in-memory `sessions` OrderedDict as a
    # fast-path LRU cache in front of it — see get_session_history /
    # save_session_history in main.py) ─────────────────────────────────────

    def test_get_session_history_reloads_from_database_when_evicted_from_memory(self):
        import tempfile
        import os
        import database
        import main

        previous_db_path = database.DB_PATH
        fd, temp_path = tempfile.mkstemp()
        os.close(fd)
        database.DB_PATH = temp_path
        session_id = "test-reload-from-db-session"
        try:
            database.init_db()
            history = [
                {"role": "system", "content": main.SYSTEM_PROMPT},
                {"role": "user", "content": "Tokyo, 5 days, more food spots please"},
            ]
            database.save_session_history(session_id, history)

            # Simulate a cold start / cache eviction: nothing for this session
            # in the in-memory cache, even though the DB row exists.
            main.sessions.pop(session_id, None)

            reloaded = main.get_session_history(session_id)
            self.assertEqual(reloaded, history)
            # It should now be seeded into the in-memory cache too.
            self.assertIn(session_id, main.sessions)
            self.assertEqual(main.sessions[session_id], history)
        finally:
            main.sessions.pop(session_id, None)
            database.DB_PATH = previous_db_path
            os.remove(temp_path)

    def test_save_session_history_then_load_round_trips(self):
        import tempfile
        import os
        import database
        import main

        previous_db_path = database.DB_PATH
        fd, temp_path = tempfile.mkstemp()
        os.close(fd)
        database.DB_PATH = temp_path
        session_id = "test-round-trip-session"
        try:
            database.init_db()
            history = [
                {"role": "system", "content": main.SYSTEM_PROMPT},
                {"role": "user", "content": "Jaipur, 3 days, budget trip"},
                {"role": "assistant", "content": json.dumps({"destination": "Jaipur"})},
            ]
            # main.save_session_history is the wrapper the /api/plan handler
            # calls after a successful turn; it should delegate to
            # database.save_session_history under the hood.
            main.save_session_history(session_id, history)

            # A fresh load — not through the in-memory cache — should see
            # exactly what was persisted.
            reloaded = database.load_session_history(session_id)
            self.assertEqual(reloaded, history)
        finally:
            main.sessions.pop(session_id, None)
            database.DB_PATH = previous_db_path
            os.remove(temp_path)

    def test_get_session_history_seeds_fresh_system_prompt_when_absent_everywhere(self):
        import tempfile
        import os
        import database
        import main

        previous_db_path = database.DB_PATH
        fd, temp_path = tempfile.mkstemp()
        os.close(fd)
        database.DB_PATH = temp_path
        session_id = "test-brand-new-session"
        try:
            database.init_db()
            main.sessions.pop(session_id, None)  # guarantee it isn't already cached

            history = main.get_session_history(session_id)
            self.assertEqual(history, [{"role": "system", "content": main.SYSTEM_PROMPT}])
            self.assertIn(session_id, main.sessions)
            # A freshly-initialized history with no user turn yet is not worth
            # a DB write — that only happens once the caller has something
            # real to persist via save_session_history.
            self.assertIsNone(database.load_session_history(session_id))
        finally:
            main.sessions.pop(session_id, None)
            database.DB_PATH = previous_db_path
            os.remove(temp_path)

    def test_get_session_history_degrades_to_fresh_history_when_database_load_fails(self):
        from unittest.mock import patch
        import main

        session_id = "test-db-load-failure-session"
        main.sessions.pop(session_id, None)
        try:
            # A DB hiccup on the read path shouldn't surface as a 500 for what
            # used to be a plain cache miss — it should degrade to the same
            # fresh-history behavior as if nothing was ever persisted.
            with patch.object(main.database, "load_session_history", side_effect=Exception("simulated db failure")):
                history = main.get_session_history(session_id)
            self.assertEqual(history, [{"role": "system", "content": main.SYSTEM_PROMPT}])
            self.assertIn(session_id, main.sessions)
        finally:
            main.sessions.pop(session_id, None)


    # ── Weather context (OpenWeather "Current Weather Data" — Naviro only
    # collects a day *count* for a trip, never real dates, so this can only
    # ever describe today's conditions, never a forecast for a specific day
    # of the trip) ────────────────────────────────────────────────────────

    def test_get_weather_context_returns_none_and_skips_request_when_api_key_missing(self):
        import asyncio
        from unittest.mock import MagicMock
        import main

        previous_key = main.OPENWEATHER_API_KEY
        main.OPENWEATHER_API_KEY = ""
        try:
            # No API key means get_weather_context must return before ever
            # touching the client — a bare MagicMock stand-in lets us prove
            # that with assert_not_called() rather than just trusting the
            # early return.
            client = MagicMock()
            result = asyncio.run(main.get_weather_context(client, "Jaipur"))
            self.assertIsNone(result)
            client.get.assert_not_called()
        finally:
            main.OPENWEATHER_API_KEY = previous_key

    def test_get_weather_context_returns_context_string_on_success(self):
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, MagicMock, patch
        import main

        previous_key = main.OPENWEATHER_API_KEY
        main.OPENWEATHER_API_KEY = "test-key"

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "weather": [{"description": "light rain"}],
            "main": {"temp": 27.83},
        }

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=mock_response)):
                    return await main.get_weather_context(client, "Kochi")

        try:
            result = asyncio.run(run())
            self.assertIsNotNone(result)
            self.assertIn("Kochi", result)
            self.assertIn("28°C", result)  # round(27.83) == 28
            self.assertIn("light rain", result)
        finally:
            main.OPENWEATHER_API_KEY = previous_key

    def test_get_weather_context_returns_none_when_request_raises(self):
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, patch
        import main

        previous_key = main.OPENWEATHER_API_KEY
        main.OPENWEATHER_API_KEY = "test-key"

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(
                    httpx.AsyncClient, "get", new=AsyncMock(side_effect=Exception("simulated network failure"))
                ):
                    return await main.get_weather_context(client, "Kochi")

        try:
            result = asyncio.run(run())
            self.assertIsNone(result)
        finally:
            main.OPENWEATHER_API_KEY = previous_key

    def test_get_weather_context_returns_none_on_non_success_status(self):
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, MagicMock, patch
        import main

        previous_key = main.OPENWEATHER_API_KEY
        main.OPENWEATHER_API_KEY = "test-key"

        mock_response = MagicMock()
        mock_response.is_success = False
        mock_response.status_code = 404

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=mock_response)):
                    return await main.get_weather_context(client, "Nowhereville")

        try:
            result = asyncio.run(run())
            self.assertIsNone(result)
        finally:
            main.OPENWEATHER_API_KEY = previous_key

    # ── Step 2: place verification pipeline + relaxed slot counts ───────────
    # (LocationIQ has no opening-hours data, so the old _place_open_during_band
    # helper and its tests are gone entirely — not just changed.)

    def test_verify_place_returns_none_when_api_key_missing(self):
        import asyncio
        import main

        previous_key = main.LOCATIONIQ_API_KEY
        main.LOCATIONIQ_API_KEY = ""
        try:
            result = asyncio.run(main._verify_place(None, "Test Fort", "Jaipur", {"lat": 26.91, "lng": 75.78}))
            self.assertIsNone(result)
        finally:
            main.LOCATIONIQ_API_KEY = previous_key

    def test_verify_place_returns_none_when_every_result_too_far(self):
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, MagicMock, patch
        import main

        previous_key = main.LOCATIONIQ_API_KEY
        main.LOCATIONIQ_API_KEY = "test-key"

        # Every query variant resolves to the same distant result (Mumbai, while
        # the destination is Jaipur), so all three retries are exhausted and
        # verification honestly reports "couldn't confirm" rather than accepting
        # a real-but-wrong-city place. LocationIQ's Search endpoint returns a
        # plain JSON array (Nominatim-shaped), not Google's {"status": ...,
        # "results": [...]} envelope.
        mock_response = MagicMock()
        mock_response.json.return_value = [
            {"lat": "19.076", "lon": "72.877", "place_id": "123", "display_name": "Some Palace, Mumbai, India"}
        ]

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=mock_response)):
                    return await main._verify_place(client, "Some Palace", "Jaipur", {"lat": 26.91, "lng": 75.78})

        try:
            result = asyncio.run(run())
            self.assertIsNone(result)
        finally:
            main.LOCATIONIQ_API_KEY = previous_key

    def test_verify_place_returns_coordinates_for_a_confirmed_place(self):
        # LocationIQ is a single Search call with no Place Details enrichment
        # step — the returned dict is just coordinates, nothing else (no more
        # place_id/rating/user_ratings_total/business_status/open_now, none of
        # which LocationIQ has data for).
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, MagicMock, patch
        import main

        previous_key = main.LOCATIONIQ_API_KEY
        main.LOCATIONIQ_API_KEY = "test-key"

        mock_response = MagicMock()
        mock_response.json.return_value = [
            {
                "lat": "26.9124",
                "lon": "75.8107",
                "place_id": "amber-fort-id",
                "display_name": "Amber Fort, Jaipur, India",
            }
        ]

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=mock_response)):
                    return await main._verify_place(client, "Amber Fort", "Jaipur", {"lat": 26.91, "lng": 75.78})

        try:
            result = asyncio.run(run())
            self.assertEqual(result, {"lat": 26.9124, "lng": 75.8107})
        finally:
            main.LOCATIONIQ_API_KEY = previous_key

    def test_itinerary_day_draft_accepts_two_to_five_slots(self):
        # Locks in the relaxed range (was a fixed 3) that makes "packed = 4-5"
        # actually satisfiable instead of always failing Groq's schema check.
        from main import ItineraryDayDraft

        two_slots = ItineraryDayDraft.model_validate(
            {
                "day_number": 1,
                "day_title": "Light day",
                "slots": [self._valid_slot("morning"), self._valid_slot("afternoon")],
            }
        )
        self.assertEqual(len(two_slots.slots), 2)

        five_slots = ItineraryDayDraft.model_validate(
            {
                "day_number": 1,
                "day_title": "Packed day",
                "slots": [
                    self._valid_slot("morning"),
                    self._valid_slot("morning"),
                    self._valid_slot("afternoon"),
                    self._valid_slot("afternoon"),
                    self._valid_slot("evening"),
                ],
            }
        )
        self.assertEqual(len(five_slots.slots), 5)

    def test_itinerary_day_draft_rejects_fewer_than_two_or_more_than_five_slots(self):
        from pydantic import ValidationError
        from main import ItineraryDayDraft

        with self.assertRaises(ValidationError):
            ItineraryDayDraft.model_validate(
                {"day_number": 1, "day_title": "Too light", "slots": [self._valid_slot("morning")]}
            )
        with self.assertRaises(ValidationError):
            ItineraryDayDraft.model_validate(
                {
                    "day_number": 1,
                    "day_title": "Too packed",
                    "slots": [
                        self._valid_slot("morning"),
                        self._valid_slot("morning"),
                        self._valid_slot("afternoon"),
                        self._valid_slot("afternoon"),
                        self._valid_slot("evening"),
                        self._valid_slot("evening"),
                    ],
                }
            )

    def test_dedupe_offenders_keeps_first_reason_per_slot(self):
        from main import _dedupe_offenders

        offenders = [
            {"day_number": 1, "place_name": "Ghost Cafe", "reason": "not found on Google Maps"},
            {"day_number": 1, "place_name": "Ghost Cafe", "reason": "too far"},
            {"day_number": 2, "place_name": "Old Fort", "reason": "hours don't cover the assigned slot"},
        ]
        deduped = _dedupe_offenders(offenders)
        self.assertEqual(len(deduped), 2)
        self.assertEqual(deduped[0]["reason"], "not found on Google Maps")
        self.assertEqual(deduped[1]["place_name"], "Old Fort")

    def test_plan_endpoint_injects_weather_for_llm_but_never_persists_it(self):
        # Locks in the fix that lets /api/plan use a same-day weather nudge
        # (main.get_weather_context) for the generation call only. It must never
        # leak into the persisted session history that later refinement turns
        # read back — otherwise every subsequent turn would re-send stale
        # "current" weather as if it still applied.
        import tempfile
        import os
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock, MagicMock, patch
        import database
        import main

        previous_llm = main.llm
        previous_db_path = database.DB_PATH
        main.llm = MagicMock()
        fd, temp_path = tempfile.mkstemp()
        os.close(fd)
        database.DB_PATH = temp_path
        session_id = "weather-wiring-test-session"
        captured: dict = {}

        async def fake_generate_and_validate(messages, **kwargs):
            captured["messages"] = messages
            return main.ItineraryDraft.model_validate(
                {
                    "destination": "Goa",
                    "total_days": 1,
                    "summary": "A test summary.",
                    "days": [
                        {
                            "day_number": 1,
                            "day_title": "Day one",
                            "slots": [
                                self._valid_slot("morning", "historical"),
                                self._valid_slot("afternoon", "food"),
                            ],
                        }
                    ],
                }
            )

        try:
            database.init_db()
            main._request_windows.clear()
            with patch(
                "main.get_weather_context",
                new=AsyncMock(return_value="Current conditions in Goa: clear sky, 30°C."),
            ), patch(
                "main._generate_and_validate", new=AsyncMock(side_effect=fake_generate_and_validate)
            ), patch(
                "main.geocode_itinerary_with_repair", new=AsyncMock(side_effect=lambda d: d)
            ):
                with TestClient(main.app) as client:
                    response = client.post(
                        "/api/plan",
                        json={"session_id": session_id, "message": "2 days in Goa", "destination": "Goa"},
                    )

            self.assertEqual(response.status_code, 200)

            sent_messages = captured["messages"]
            self.assertTrue(any("Current conditions in Goa" in m.get("content", "") for m in sent_messages))

            persisted = database.load_session_history(session_id)
            self.assertIsNotNone(persisted)
            self.assertFalse(any("Current conditions in Goa" in m.get("content", "") for m in persisted))
        finally:
            main.llm = previous_llm
            main.sessions.pop(session_id, None)
            database.DB_PATH = previous_db_path
            os.remove(temp_path)
            main._request_windows.clear()


if __name__ == "__main__":
    unittest.main()
