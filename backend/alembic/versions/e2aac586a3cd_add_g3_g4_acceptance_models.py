"""Add G3/G4 acceptance models

Revision ID: e2aac586a3cd
Revises: 
Create Date: 2026-08-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = 'e2aac586a3cd'
down_revision = '0005_b5_validation_reports_risk'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create users table if not exists
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username VARCHAR(100) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            is_active BOOLEAN DEFAULT TRUE,
            is_admin BOOLEAN DEFAULT FALSE,
            role VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # Create acceptance_reports table
    op.execute("""
        CREATE TABLE IF NOT EXISTS acceptance_reports (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phase VARCHAR(20) NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            assignee_id UUID REFERENCES users(id),
            due_date TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) NOT NULL
        );
    """)

    # Create index on acceptance_reports
    op.execute("CREATE INDEX idx_acceptance_reports_phase ON acceptance_reports(phase);")
    op.execute("CREATE INDEX idx_acceptance_reports_status ON acceptance_reports(status);")

    # Create checklist_items table
    op.execute("""
        CREATE TABLE IF NOT EXISTS checklist_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id UUID NOT NULL REFERENCES acceptance_reports(id) ON DELETE CASCADE,
            item_id VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            acceptance_criteria TEXT,
            result VARCHAR(20) NOT NULL DEFAULT 'pending',
            notes TEXT,
            checked_at TIMESTAMP WITH TIME ZONE,
            checked_by UUID REFERENCES users(id)
        );
    """)

    # Create index on checklist_items
    op.execute("CREATE INDEX idx_checklist_items_report_id ON checklist_items(report_id);")
    op.execute("CREATE INDEX idx_checklist_items_result ON checklist_items(result);")

    # Create issues table
    op.execute("""
        CREATE TABLE IF NOT EXISTS issues (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            checklist_id UUID REFERENCES checklist_items(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            severity VARCHAR(20) NOT NULL DEFAULT 'major',
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            assignee_id UUID REFERENCES users(id),
            resolved_at TIMESTAMP WITH TIME ZONE,
            resolution_notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) NOT NULL
        );
    """)

    # Create index on issues
    op.execute("CREATE INDEX idx_issues_checklist_id ON issues(checklist_id);")
    op.execute("CREATE INDEX idx_issues_severity ON issues(severity);")
    op.execute("CREATE INDEX idx_issues_status ON issues(status);")

    # Create signatures table
    op.execute("""
        CREATE TABLE IF NOT EXISTS signatures (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id UUID NOT NULL REFERENCES acceptance_reports(id) ON DELETE CASCADE,
            role VARCHAR(50) NOT NULL,
            signer_id UUID REFERENCES users(id) NOT NULL,
            signature_data TEXT,
            signed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        );
    """)

    # Create index on signatures
    op.execute("CREATE INDEX idx_signatures_report_id ON signatures(report_id);")

    # Create test_results table
    op.execute("""
        CREATE TABLE IF NOT EXISTS test_results (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            test_type VARCHAR(50) NOT NULL,
            test_name VARCHAR(255) NOT NULL,
            status VARCHAR(20) NOT NULL,
            metrics JSONB,
            started_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE,
            report_id UUID REFERENCES acceptance_reports(id),
            error_details TEXT
        );
    """)

    # Create index on test_results
    op.execute("CREATE INDEX idx_test_results_test_type ON test_results(test_type);")
    op.execute("CREATE INDEX idx_test_results_status ON test_results(status);")
    op.execute("CREATE INDEX idx_test_results_report_id ON test_results(report_id);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS test_results CASCADE;")
    op.execute("DROP TABLE IF EXISTS signatures CASCADE;")
    op.execute("DROP TABLE IF EXISTS issues CASCADE;")
    op.execute("DROP TABLE IF EXISTS checklist_items CASCADE;")
    op.execute("DROP TABLE IF EXISTS acceptance_reports CASCADE;")
    op.execute("DROP TABLE IF EXISTS users CASCADE;")
