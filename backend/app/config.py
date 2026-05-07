from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./agent_builder.db"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    socks_proxy_url: str | None = None
    mcp_settings_path: Path = Path("mcp_settings.json")
    agent_skills_dir: Path = Path("skills")
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
