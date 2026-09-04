"""Typed runtime configuration for the search service."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    """Load database and HTTP server settings from environment variables."""

    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "wordrace"
    db_user: str = "postgres"
    db_password: str = "12345678"
    api_host: str = "127.0.0.1"
    api_port: int = 8000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    def database_url(self, driver: str = "asyncpg") -> str:
        """Return the SQLAlchemy PostgreSQL URL for the selected driver."""
        return URL.create(
            drivername=f"postgresql+{driver}" if driver else "postgresql",
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        ).render_as_string(hide_password=False)


ENV = Settings()
