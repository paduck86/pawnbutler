// PawnButler URL Allowlist - Domain-level access control

const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /gambling|casino|betting|toto|lottery|slot/i,
  /adult|porn|xxx|nsfw/i,
  /\.onion$|darkweb|darknet/i,
  /phishing|malware/i,
];

const DEFAULT_ALLOWED_DOMAINS: string[] = [
  'google.com',
  'github.com',
  'stackoverflow.com',
  'wikipedia.org',
  'npmjs.com',
  'developer.mozilla.org',
  'docs.python.org',
  'nodejs.org',
  'typescriptlang.org',
  'reddit.com',
];

export class UrlAllowlist {
  private allowedDomains: Set<string>;
  private blockedPatterns: RegExp[];

  constructor(config?: { allow?: string[]; block?: string[] }) {
    this.allowedDomains = new Set([
      ...DEFAULT_ALLOWED_DOMAINS,
      ...(config?.allow ?? []),
    ]);
    this.blockedPatterns = [
      ...DEFAULT_BLOCKED_PATTERNS,
      ...(config?.block ?? []).map((p) => new RegExp(p, 'i')),
    ];
  }

  isAllowed(url: string): { allowed: boolean; reason?: string; blockedByPattern?: boolean } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` };
    }

    const hostname = parsed.hostname.toLowerCase();
    const fullUrl = parsed.href;

    // Blocked patterns take priority (blacklist first)
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(hostname) || pattern.test(fullUrl)) {
        return {
          allowed: false,
          reason: `URL matches blocked pattern: ${pattern.source}`,
          blockedByPattern: true,
        };
      }
    }

    // Check if domain or parent domain is in allowlist
    if (this.isDomainAllowed(hostname)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Domain "${hostname}" is not in the allowlist`,
      blockedByPattern: false,
    };
  }

  addAllowed(domain: string): void {
    this.allowedDomains.add(domain.toLowerCase());
  }

  addBlocked(pattern: string): void {
    this.blockedPatterns.push(new RegExp(pattern, 'i'));
  }

  listAllowed(): string[] {
    return [...this.allowedDomains].sort();
  }

  listBlocked(): string[] {
    return this.blockedPatterns.map((p) => p.source);
  }

  private isDomainAllowed(hostname: string): boolean {
    // Exact match
    if (this.allowedDomains.has(hostname)) {
      return true;
    }

    // Subdomain match: e.g. "docs.google.com" matches "google.com"
    for (const allowed of this.allowedDomains) {
      if (hostname.endsWith(`.${allowed}`)) {
        return true;
      }
    }

    return false;
  }
}
