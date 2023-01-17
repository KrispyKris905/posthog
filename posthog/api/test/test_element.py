import json
from datetime import timedelta
from typing import Dict, List

from freezegun import freeze_time
from rest_framework import status

from posthog.models import Element, ElementGroup, Organization
from posthog.test.base import (
    APIBaseTest,
    ClickhouseTestMixin,
    QueryMatchingTest,
    _create_event,
    _create_person,
    snapshot_postgres_queries,
)

expected_all_data_response_results: List[Dict] = [
    {
        "count": 2,
        "hash": None,
        "elements": [
            {
                "text": "event 2",
                "tag_name": "a",
                "attr_class": None,
                "href": "https://posthog.com/event-2",
                "attr_id": None,
                "nth_child": 0,
                "nth_of_type": 0,
                "attributes": {},
                "order": 0,
            },
            {
                "text": "event 2",
                "tag_name": "div",
                "attr_class": None,
                "href": "https://posthog.com/event-2",
                "attr_id": None,
                "nth_child": 0,
                "nth_of_type": 0,
                "attributes": {},
                "order": 1,
            },
        ],
    },
    {
        "count": 1,
        "hash": None,
        "elements": [
            {
                "text": "event 1",
                "tag_name": "a",
                "attr_class": None,
                "href": "https://posthog.com/event-1",
                "attr_id": None,
                "nth_child": 0,
                "nth_of_type": 0,
                "attributes": {},
                "order": 0,
            },
            {
                "text": "event 1",
                "tag_name": "div",
                "attr_class": None,
                "href": "https://posthog.com/event-1",
                "attr_id": None,
                "nth_child": 0,
                "nth_of_type": 0,
                "attributes": {},
                "order": 1,
            },
        ],
    },
]


class TestElementChainMaterializedView(ClickhouseTestMixin, APIBaseTest):
    def test_does_not_use_table_if_flag_is_not_enabled(self) -> None:
        assert 1 == 2

    def test_does_not_use_table_if_not_enough_data_for_range(self) -> None:
        assert 1 == 2

    def test_can_query_element_chain_mv_by_exact_url(self) -> None:
        assert 1 == 2

    def test_can_query_element_chain_mv_by_regex_url(self) -> None:
        assert 1 == 2

    def test_can_query_element_chain_mv_by_several_date_ranges(self) -> None:
        assert 1 == 2

    def test_validation_error_if_date_range_greater_than_thirty_days(self) -> None:
        assert 1 == 2

    def test_validation_error_if_unexpected_property_operator(self) -> None:
        assert 1 == 2


class TestElement(ClickhouseTestMixin, APIBaseTest, QueryMatchingTest):
    def test_element_automatic_order(self) -> None:
        elements = [
            Element(tag_name="a", href="https://posthog.com/about", text="click here"),
            Element(tag_name="span"),
            Element(tag_name="div"),
        ]
        ElementGroup.objects.create(team=self.team, elements=elements)

        self.assertEqual(elements[0].order, 0)
        self.assertEqual(elements[1].order, 1)
        self.assertEqual(elements[2].order, 2)

    def test_event_property_values(self) -> None:
        _create_event(
            team=self.team,
            distinct_id="test",
            event="$autocapture",
            elements=[Element(tag_name="a", href="https://posthog.com/about", text="click here")],
        )
        team2 = Organization.objects.bootstrap(None)[2]
        _create_event(team=team2, distinct_id="test", event="$autocapture", elements=[Element(tag_name="bla")])

        response = self.client.get("/api/element/values/?key=tag_name").json()
        self.assertEqual(response[0]["name"], "a")
        self.assertEqual(len(response), 1)

        response = self.client.get("/api/element/values/?key=text&value=click").json()
        self.assertEqual(response[0]["name"], "click here")
        self.assertEqual(len(response), 1)

    @snapshot_postgres_queries
    def test_element_stats_postgres_queries_are_as_expected(self) -> None:
        self._setup_events()

        with self.assertNumQueries(6):
            """django session, posthog_user, team, organization_membership, then two person inserts 🤷"""
            self.client.get("/api/element/stats/?paginate_response=true").json()

    def test_element_stats_can_filter_by_properties(self) -> None:
        self._setup_events()

        response = self.client.get("/api/element/stats/?paginate_response=true").json()
        assert len(response["results"]) == 2

        properties_filter = json.dumps([{"key": "$current_url", "value": "http://example.com/another_page"}])
        response = self.client.get(f"/api/element/stats/?paginate_response=true&properties={properties_filter}").json()
        self.assertEqual(len(response["results"]), 1)

    def test_element_stats_without_pagination(self) -> None:
        """Can be removed once we can default to returning paginated responses"""
        self._setup_events()

        response = self.client.get("/api/element/stats").json()
        # not nested into a results property
        assert response == expected_all_data_response_results

    def test_element_stats_clamps_date_from_to_start_of_day(self) -> None:
        event_start = "2012-01-14T03:21:34.000Z"
        query_time = "2012-01-14T08:21:34.000Z"

        with freeze_time(event_start) as frozen_time:
            elements = [
                Element(tag_name="a", href="https://posthog.com/about", text="click here", order=0),
                Element(tag_name="div", href="https://posthog.com/about", text="click here", order=1),
            ]

            _create_event(  # 3 am but included because date_from is set to start of day
                timestamp=frozen_time(),
                team=self.team,
                elements=elements,
                event="$autocapture",
                distinct_id="test",
                properties={"$current_url": "http://example.com/demo"},
            )

            frozen_time.tick(delta=timedelta(hours=10))

            _create_event(  # included
                timestamp=frozen_time(),
                team=self.team,
                elements=elements,
                event="$autocapture",
                distinct_id="test",
                properties={"$current_url": "http://example.com/demo"},
            )

        with freeze_time(query_time):
            # the UI doesn't allow you to choose time, so query should always be from start of day
            response = self.client.get(f"/api/element/stats/?paginate_response=true&date_from={query_time}")
            self.assertEqual(response.status_code, status.HTTP_200_OK)

            response_json = response.json()
            self.assertEqual(response_json["results"][0]["count"], 2)
            self.assertEqual(response_json["results"][0]["elements"][0]["tag_name"], "a")

    def test_element_stats_can_load_all_the_data(self) -> None:
        self._setup_events()

        response = self.client.get(f"/api/element/stats/?paginate_response=true")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response_json = response.json()
        assert response_json["next"] is None  # loaded all the data, so no next link
        results = response_json["results"]

        assert results == expected_all_data_response_results

    def test_element_stats_obeys_limit_parameter(self) -> None:
        self._setup_events()

        response = self.client.get(f"/api/element/stats/?paginate_response=true&limit=1")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response_json = response.json()
        assert response_json["next"] == "http://testserver/api/element/stats/?paginate_response=true&limit=1&offset=1"
        limit_to_one_results = response_json["results"]
        assert limit_to_one_results == [expected_all_data_response_results[0]]

        response = self.client.get(f"/api/element/stats/?paginate_response=true&limit=1&offset=1")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response_json = response.json()
        assert response_json["next"] is None
        limit_to_one_results = response_json["results"]
        assert limit_to_one_results == [expected_all_data_response_results[1]]

    def test_element_stats_does_not_allow_non_numeric_limit(self) -> None:
        response = self.client.get(f"/api/element/stats/?limit=not-a-number")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_element_stats_does_not_allow_non_numeric_offset(self) -> None:
        response = self.client.get(f"/api/element/stats/?limit=not-a-number")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def _setup_events(self):
        _create_person(distinct_ids=["one"], team=self.team)
        _create_person(distinct_ids=["two"], team=self.team)
        _create_person(distinct_ids=["three"], team=self.team)
        _create_event(
            team=self.team,
            elements=[
                Element(tag_name="a", href="https://posthog.com/event-1", text="event 1", order=0),
                Element(tag_name="div", href="https://posthog.com/event-1", text="event 1", order=1),
            ],
            event="$autocapture",
            distinct_id="one",
            properties={"$current_url": "http://example.com/demo"},
        )
        _create_event(
            team=self.team,
            elements=[
                Element(tag_name="a", href="https://posthog.com/event-2", text="event 2", order=0),
                Element(tag_name="div", href="https://posthog.com/event-2", text="event 2", order=1),
            ],
            event="$autocapture",
            distinct_id="two",
            properties={"$current_url": "http://example.com/demo"},
        )
        _create_event(
            team=self.team,
            elements=[
                Element(tag_name="a", href="https://posthog.com/event-2", text="event 2", order=0),
                Element(tag_name="div", href="https://posthog.com/event-2", text="event 2", order=1),
            ],
            event="$autocapture",
            distinct_id="three",
            properties={"$current_url": "http://example.com/another_page"},
        )
