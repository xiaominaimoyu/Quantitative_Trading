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

CREATE INDEX idx_acceptance_reports_phase ON acceptance_reports(phase);
CREATE INDEX idx_acceptance_reports_status ON acceptance_reports(status);

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

CREATE INDEX idx_checklist_items_report_id ON checklist_items(report_id);
CREATE INDEX idx_checklist_items_result ON checklist_items(result);

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

CREATE INDEX idx_issues_checklist_id ON issues(checklist_id);
CREATE INDEX idx_issues_severity ON issues(severity);
CREATE INDEX idx_issues_status ON issues(status);

CREATE TABLE IF NOT EXISTS signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES acceptance_reports(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    signer_id UUID REFERENCES users(id) NOT NULL,
    signature_data TEXT,
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX idx_signatures_report_id ON signatures(report_id);

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

CREATE INDEX idx_test_results_test_type ON test_results(test_type);
CREATE INDEX idx_test_results_status ON test_results(status);
CREATE INDEX idx_test_results_report_id ON test_results(report_id);