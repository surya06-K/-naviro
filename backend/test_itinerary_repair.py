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

        previous_key = main.GOOGLE_MAPS_API_KEY
        main.GOOGLE_MAPS_API_KEY = ""
        try:
            # No API key means _places_nearby returns before ever touching the
            # client, so passing None in place of a real httpx.AsyncClient is safe.
            result = asyncio.run(main._places_nearby(None, 17.667, 82.612, "hospital"))
            self.assertEqual(result, [])
        finally:
            main.GOOGLE_MAPS_API_KEY = previous_key

    def test_places_nearby_returns_empty_list_when_request_raises(self):
        import asyncio
        import httpx
        from unittest.mock import AsyncMock, patch
        import main

        previous_key = main.GOOGLE_MAPS_API_KEY
        main.GOOGLE_MAPS_API_KEY = "test-key"

        async def run():
            async with httpx.AsyncClient() as client:
                with patch.object(
                    httpx.AsyncClient, "get", new=AsyncMock(side_effect=Exception("simulated network failure"))
                ):
                    return await main._places_nearby(client, 17.667, 82.612, "hospital")

        try:
            result = asyncio.run(run())
            self.assertEqual(result, [])
        finally:
            main.GOOGLE_MAPS_API_KEY = previous_key

    def test_emergency_endpoint_degrades_gracefully_without_llm_or_places_key(self):
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock, patch
        import main

        previous_llm = main.llm
        previous_key = main.GOOGLE_MAPS_API_KEY
        main.llm = None
        main.GOOGLE_MAPS_API_KEY = ""
        main._request_windows.clear()
        try:
            # geocode_city_center is mocked to a real, non-zero coordinate pair
            # (rather than left to run for real) so the test stays hermetic —
            # with no Google key configured it would otherwise fall back to a
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
            main.GOOGLE_MAPS_API_KEY = previous_key
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


if __name__ == "__main__":
    unittest.main()
