### SARIF Verification Check

#### Overview
Validates SARIF findings from an external SAST tool as true or false positives.

#### What to Check
1. Analyze each finding from the SARIF file

#### Result
- **PASS**: All findings are false positives
- **FAIL**: At least one finding is a true positive
