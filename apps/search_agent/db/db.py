from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from pgvector.psycopg2 import register_vector as register_sync_vector

from search_agent.ENV import ENV
from search_agent.db.ML import driver_setup as ml_driver_setup


ASYNC_ENGINE = create_async_engine(ENV.database_url(), echo=False, pool_pre_ping=True)
SYNC_ENGINE = create_engine(
    ENV.database_url(driver="psycopg2"), echo=False, pool_pre_ping=True
)


@event.listens_for(ASYNC_ENGINE.sync_engine, "connect")
def async_driver_setup(dbapi_connection, connection_record):
    ml_driver_setup(dbapi_connection)


@event.listens_for(SYNC_ENGINE, "connect")
def sync_driver_setup(dbapi_connection, connection_record):
    register_sync_vector(dbapi_connection)


ASYNC_SESSION_MAKER = async_sessionmaker(bind=ASYNC_ENGINE)
SYNC_SESSION_MAKER = sessionmaker(bind=SYNC_ENGINE)
