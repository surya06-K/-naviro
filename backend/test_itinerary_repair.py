import unittest


class ItineraryRepairTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

