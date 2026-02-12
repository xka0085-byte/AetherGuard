# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in AetherGuard, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use one of the following methods:

1. **GitHub Security Advisories** (preferred): [Report a vulnerability](https://github.com/xka0085-byte/AetherGuard/security/advisories/new)
2. **Email**: Open a private security advisory on GitHub

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: Depends on severity (critical: ASAP, high: 1-2 weeks, medium/low: next release)

## Security Best Practices for Deployers

- **Never commit `.env`** to version control
- Set `WALLET_ENCRYPTION_KEY` in production to encrypt wallet addresses at rest
- Use a process manager (PM2, systemd) for automatic restart on crashes
- Restrict database file permissions (`chmod 600 data.db`)
- Rotate your Discord Bot Token and Alchemy API Key periodically
- Monitor the `logs/security.log` for suspicious activity
