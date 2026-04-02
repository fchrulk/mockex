"""Database connection pool and migration runner using asyncpg."""

import logging
from pathlib import Path

import asyncpg

from services import config

log = logging.getLogger("mockex.db")

_pool: asyncpg.Pool | None = None

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "models" / "migrations"


async def init_pool() -> asyncpg.Pool:
    """Create the connection pool and run pending migrations."""
    global _pool
    dsn = (
        f"postgresql://{config.DB_USER}:{config.DB_PASSWORD}"
        f"@{config.DB_HOST}:{config.DB_PORT}/{config.DB_NAME}"
    )
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    log.info("Database pool created (%s:%s/%s)", config.DB_HOST, config.DB_PORT, config.DB_NAME)
    await _run_migrations()
    return _pool


async def get_pool() -> asyncpg.Pool:
    """Return the existing pool (init_pool must have been called)."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized — call init_pool() first")
    return _pool


async def close_pool():
    """Close the connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        log.info("Database pool closed")
        _pool = None


async def _run_migrations():
    """Apply any pending SQL migration files in order."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Ensure schema and version table exist
        await conn.execute("CREATE SCHEMA IF NOT EXISTS mockex")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS mockex.schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

        # Find already-applied versions
        rows = await conn.fetch("SELECT version FROM mockex.schema_version ORDER BY version")
        applied = {r["version"] for r in rows}

        # Discover and sort migration files
        if not MIGRATIONS_DIR.exists():
            log.info("No migrations directory found at %s", MIGRATIONS_DIR)
            return

        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        for mf in migration_files:
            # Extract version number from filename prefix (e.g., "001_create_schema.sql" -> 1)
            try:
                version = int(mf.name.split("_", 1)[0])
            except ValueError:
                log.warning("Skipping non-numbered migration file: %s", mf.name)
                continue

            if version in applied:
                continue

            log.info("Applying migration %03d: %s", version, mf.name)
            sql = mf.read_text()
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO mockex.schema_version (version) VALUES ($1)", version
            )
            log.info("Migration %03d applied", version)

    log.info("All migrations up to date")
