# Traceability Matrix and Stage Gates

## Traceability Matrix

| Requirement | Design | Implementation | Test |
|-------------|--------|----------------|------|
| B0/B1 API | SDLC_02 | Backend API | frontend/tests/api-contract.test.mjs |
| B2 Data Snapshot | SDLC_02 | B2 Implementation | frontend/tests/b2-datasets.test.mjs |
| B3 Strategy/Model/Risk | SDLC_02 | B3 Implementation | frontend/tests/b3-research-domains.test.mjs |
| B4 Experiment/Backtest | SDLC_02 | B4 Implementation | frontend/tests/b4-experiment-compare.test.mjs |
| B5 Validation/Report | SDLC_02 | B5 Implementation | frontend/tests/b5-validation-report-audit.test.mjs |
| B6 Production | SDLC_02 | B6 Implementation | frontend/tests/b6-production-switchover.test.mjs |

## Stage Gates

### G1 - Requirements Baseline
- Status: **Approved**
- Date: 2026-08-09

### G2 - System Design
- Status: **Conditionally Approved** (B3 local research MVP scope only)
- Date: 2026-08-09

### B0-B6 - Implementation Gates
- B0/B1: **Accepted**
- B2: **Accepted**
- B2.1: **Closed**
- B3: **Accepted**
- B4: **Accepted**
- B5: **Accepted**
- B6: **Accepted**

### G3/G4 - Business Acceptance
- Status: **In Progress** (spec.md created at .codeartsdoer/specs/g3g4_acceptance/spec.md)