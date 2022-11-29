

from posthog.settings import KAFKA_EVENTS_PLUGIN_INGESTION_TOPIC, CLICKHOUSE_CLUSTER, CLICKHOUSE_DATABASE

from posthog.clickhouse.kafka_engine import kafka_engine, ttl_period
from posthog.clickhouse.table_engines import Distributed, ReplicationScheme, MergeTreeEngine


LIVE_EVENTS_TABLE_BASE_SQL = """
CREATE TABLE IF NOT EXISTS {table_name} ON CLUSTER '{cluster}'
(
    uuid UUID,
    event VARCHAR,
    properties VARCHAR,
    timestamp DateTime64(6, 'UTC'),
    team_id Int64,
    distinct_id VARCHAR,
    elements_chain VARCHAR,
    created_at DateTime64(6, 'UTC'),
    _timestamp Nullable(DateTime)
) ENGINE = {engine}
"""


LIVE_EVENTS_DATA_TABLE_ENGINE = lambda: MergeTreeEngine(
    "sharded_live_events", replication_scheme=ReplicationScheme.SHARDED
)

# TODO: Double check TTL and if we want to manually drop partitions e.g. every hour
LIVE_EVENTS_DATA_TABLE_SQL = lambda: (
    LIVE_EVENTS_TABLE_BASE_SQL
    + """PARTITION BY toStartOfTenMinutes(timestamp)
ORDER BY (team_id, timestamp, event, cityHash64(distinct_id), cityHash64(uuid))
TTL toDateTime(timestamp) + INTERVAL 1 DAY 
"""
).format(
    table_name="sharded_live_events",
    cluster=CLICKHOUSE_CLUSTER,
    engine=LIVE_EVENTS_DATA_TABLE_ENGINE(),
)

# This table is responsible for writing to sharded_live_events based on a sharding key
# We also read from this table instead of sharded_live_events
DISTRIBUTED_LIVE_EVENTS_TABLE_SQL = lambda: LIVE_EVENTS_TABLE_BASE_SQL.format(
    table_name="live_events",
    cluster=CLICKHOUSE_CLUSTER,
    engine=Distributed(data_table="sharded_live_events", sharding_key="rand()"), # use team_id?
)


KAFKA_LIVE_EVENTS_TABLE_SQL = lambda: LIVE_EVENTS_TABLE_BASE_SQL.format(
    table_name="kafka_live_events",
    cluster=CLICKHOUSE_CLUSTER,
    # being explicit about the group even though we're using the default
    # to highlight that this is important - we should never use the same
    # consumer group as the plugin server here!
    engine=kafka_engine(topic=KAFKA_EVENTS_PLUGIN_INGESTION_TOPIC, group="group1")
)

LIVE_EVENTS_MV_TABLE_SQL = lambda: """
CREATE MATERIALIZED VIEW live_events_mv ON CLUSTER '{cluster}'
TO {database}.{target_table}
AS SELECT
	uuid,
	event,
    properties,
	-- KLUDGE: we don't have the real timestamp yet
	toDateTime64(now(), 6, 'UTC') as timestamp, 
	team_id,
	distinct_id,
	'' as elements_chain,
	toDateTime64(0, 6, 'UTC') as created_at,
	_timestamp
FROM {database}.kafka_live_events
WHERE event != '$snapshot'
""".format(
    target_table="live_events",
    cluster=CLICKHOUSE_CLUSTER,
    database=CLICKHOUSE_DATABASE,
)


SELECT_LIVE_EVENTS_BY_TEAM_AND_CONDITIONS_FILTERS_SQL = """
SELECT
	uuid,
	event,
	team_id,
	distinct_id,
	argMax(properties, created_at) as properties,
	argMax(elements_chain, created_at) as elements_chain,
	argMax(timestamp, created_at) as ts,
	argMax(_table, created_at) as source_table
FROM
	merge('{database}', '^(events|live_events)$')
WHERE
    team_id = %(team_id)s
    {conditions}
    {filters}
GROUP BY uuid, event, team_id, distinct_id
ORDER BY ts {order} {limit}
"""


SELECT_LIVE_EVENTS_BY_TEAM_AND_CONDITIONS_SQL = """
SELECT
	uuid,
	event,
	team_id,
	distinct_id,
	argMax(properties, created_at) as properties,
	argMax(elements_chain, created_at) as elements_chain,
	argMax(timestamp, created_at) as ts,
	argMax(_table, created_at) as source_table
FROM
	merge('{database}', '^(events|live_events)$')
WHERE
    team_id = %(team_id)s
    {conditions}
GROUP BY uuid, event, team_id, distinct_id
ORDER BY ts {order} {limit}
"""