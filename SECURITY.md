# Security Policy

## Reporting Security Vulnerabilities

The me&u team takes security seriously. If you discover a security vulnerability in this project, please report it through our [Vulnerability Disclosure Program](https://www.meandu.com/vulnerability-disclosure-program).

Please include reproduction steps and any supporting documentation with your report. Suggested fixes or workarounds are appreciated but optional.

## Response Timeline

- **Initial acknowledgment**: Within 10 business days
- **Status update**: Within 20 business days
- **Resolution**: Swift action on identified vulnerabilities

## Rules of Engagement

- Do not exploit vulnerabilities to damage systems or access unauthorized data
- Do not share vulnerability details with third parties before resolution
- Allow me&u to determine whether public disclosure is appropriate

me&u commits to not pursuing legal action against compliant researchers.

## Scope

### In Scope

High-impact issues affecting data confidentiality or integrity, including but not limited to:

- Cross-Site Scripting (XSS)
- Cross-Site Request Forgery (CSRF)
- Authentication flaws
- Server-Side Request Forgery (SSRF)
- Server-Side Template Injection (SSTI)
- SQL Injection
- XML External Entity (XXE)
- Remote Code Execution (RCE)
- File inclusions

Reports for all software and dependencies are welcome, especially if they affect sensitive user data.

### Out of Scope

- SPF/DMARC configuration issues
- Email policy problems
- Logout CSRF
- Vulnerabilities requiring physical device access
- Social engineering
- Automated tool reports without manual validation
- Missing headers without direct vulnerability correlation
