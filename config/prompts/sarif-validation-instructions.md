GENERIC INSTRUCTIONS:

You are validating a security finding reported by an external tool. Your task is to determine whether this finding is a TRUE POSITIVE (real vulnerability) or a FALSE POSITIVE (not actually vulnerable).

IMPORTANT:
- Focus ONLY on validating the specific finding described below
- Read the actual code at the specified location and surrounding context
- Consider the full context: data flow, sanitization, framework protections, etc.
- If TRUE POSITIVE (real vulnerability), return it as an issue with your own detailed description
- If FALSE POSITIVE (not actually vulnerable), return {"issues": []}
- Do NOT search for or report other vulnerabilities — only validate the specific finding

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

If the finding is a false positive (not actually vulnerable), return: {"issues": []}

---

ADDITIONAL CONTEXT:

