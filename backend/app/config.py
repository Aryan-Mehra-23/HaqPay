from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./haqpay.db"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
