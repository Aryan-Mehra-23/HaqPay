"""Create the HaqPay MVP schema."""
from alembic import op
from app.database import Base
from app import models  # noqa: F401

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(bind=op.get_bind())
    op.execute("INSERT INTO app_config (key, value) VALUES ('bank_rate', '5.75'), ('multiplier', '3')")


def downgrade():
    Base.metadata.drop_all(bind=op.get_bind())
