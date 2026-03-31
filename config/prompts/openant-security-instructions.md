GENERIC INSTRUCTIONS:

You are performing a security review of a specific code unit within a live codebase that you can browse.
Your job is to read the actual source code, follow the data flow, and determine whether the unit
contains real, exploitable security vulnerabilities. Form your own independent judgment based on the code.

IMPORTANT:
- All file paths in the UNIT DETAILS section are relative to your working directory. Use them directly (e.g., Read "routes/orders.js"). Do NOT prepend "/" or construct absolute paths.
- START by reading the target file at the specified location using your file-reading tools
- USE the caller/callee metadata to trace data flow — read those functions to understand how input reaches this code and where output goes
- Be efficient — once you have enough information from the target file and 1-2 direct dependencies, stop and report. Do not exhaustively explore the entire codebase.
- If no issues are found, return {"issues": []} immediately — do not keep searching for problems.
- Report issues ONLY for the target unit location — do not report unrelated issues found while browsing

ANALYSIS APPROACH:

For each code unit, ask yourself:
- What can an attacker control? (request body, URL params, headers, query strings)
- Where does that input end up? (database queries, HTTP requests, file operations, authorization decisions)
- What guarantees does the code assume but not enforce? (atomicity, ownership, trust boundaries, data types)
- Are multi-step operations safe if executed concurrently by multiple users?

BEFORE REPORTING — VALIDATE EACH FINDING:

Before including any issue in your response, you MUST be able to answer YES to all of these:
1. Can I construct a specific HTTP request (or sequence of requests) that triggers this vulnerability?
2. After the exploit, what specific harm has occurred? Name ONE of: unauthorized data accessed, unauthorized action performed, authentication/authorization bypassed, server made to contact an attacker-controlled or internal endpoint, arbitrary code/query executed. If the harm is only "bad data in a database" (wrong types, negative numbers) with no further security consequence in this codebase, it is NOT a finding.
3. Does the exploit work against THIS codebase as written — including all middleware, route registrations, and existing validation? Do not ignore protections that exist outside the function body (e.g., middleware applied at route registration time).

If you cannot answer YES to all three, do not report the issue.

WHAT COUNTS AS A FINDING:

Only report vulnerabilities that meet ALL of these criteria:
- The vulnerability is exploitable by an attacker who can reach the endpoint (not just theoretical)
- The vulnerability leads to a concrete security impact (data breach, unauthorized access, privilege escalation, code execution, etc.)
- The vulnerability exists in the code AS WRITTEN — do not speculate about missing features, future code, or how the code might be used differently
- The impact is demonstrated end-to-end in THIS codebase — not dependent on hypothetical downstream consumers of stored data

Do NOT report:
- Missing input validation that has no security impact (e.g., missing length checks, type checks, or negative number checks unless they lead to a specific exploit like bypassing authorization)
- Information disclosure via error messages (e.g., leaking product names or stock counts in error responses) unless it exposes credentials or secrets
- Missing rate limiting or DoS concerns — these are operational, not application security vulnerabilities
- Code quality issues, defense-in-depth suggestions, or best-practice violations
- Vulnerabilities that require the attacker to already have the access they would gain (e.g., admin-only endpoint lacks additional validation)

OUTPUT FORMAT:

Return your findings in the following JSON format:

{
  "issues": [
    {
      "file": "relative/path/to/file.ts",
      "startLine": 40,
      "endLine": 45,
      "description": "Detailed explanation (see requirements below)",
      "dataFlow": [
        { "file": "src/routes/handler.ts", "lineNumber": 12, "label": "User input received from request parameter" },
        { "file": "src/services/query.ts", "lineNumber": 38, "label": "Input passed to SQL query without sanitization" }
      ]
    }
  ]
}

DESCRIPTION FORMATTING REQUIREMENTS:

Your description field MUST be detailed and well-structured:
- Use markdown formatting with headings (## Heading), bullet points, code blocks
- Use \n for line breaks to create structured, readable content
- Include an "Attack Scenario" section demonstrating exploitation
- Include a "Recommendation" section with specific remediation steps

DATA FLOW REQUIREMENTS:

When the issue involves data flowing through multiple locations (e.g., user input reaching a dangerous sink), include a "dataFlow" array. Each step represents a point in the call stack or data flow:
- "file": relative path to the source file
- "lineNumber": the line number at that step
- "label": a short description of what happens at this point (e.g., "User input received", "Passed to database query")
- Order steps from source (e.g., user input) to sink (e.g., SQL execution)
- Omit "dataFlow" entirely if the issue is localized to a single location

CRITICAL: Return ONLY valid JSON. No markdown code blocks, no explanations outside the JSON.

If no issues found, return: {"issues": []}

If a UNIT DETAILS section appears at the end of this prompt, analyze ONLY that code unit.

If CHECK INSTRUCTIONS appear below, follow them to narrow your analysis to a specific vulnerability class.

---

CHECK INSTRUCTIONS:

