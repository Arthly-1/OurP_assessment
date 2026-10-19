import { isIP } from 'node:net';
import { Errors } from '../../errors/app-error.js';
import { isBlockedAddress } from './ip-policy.js';

export interface UrlPolicyOptions {
  allowedPorts: ReadonlySet<number>;
  /** Empty = any public host. Entries match the exact host or any subdomain of it. */
  allowedHosts: readonly string[];
  /** Disables address/hostname blocking. Development and tests only. */
  allowPrivateNetworks: boolean;
}

const MAX_URL_LENGTH = 2048;
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

export class SourceUrlPolicy {
  constructor(private readonly options: UrlPolicyOptions) {}

  /** Parses `raw`, throwing a `url_not_allowed` AppError when it must not be fetched. */
  parse(raw: string): URL {
    if (raw.length > MAX_URL_LENGTH) {
      throw Errors.urlNotAllowed(`URL is longer than ${MAX_URL_LENGTH} characters`);
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw Errors.urlNotAllowed('not a valid absolute URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw Errors.urlNotAllowed(
        `scheme "${url.protocol.slice(0, -1)}" is not supported; use http or https`,
      );
    }
    if (url.username || url.password) {
      throw Errors.urlNotAllowed('URLs with embedded credentials are not supported');
    }

    const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol];
    if (port === undefined || !this.options.allowedPorts.has(port)) {
      const allowed = [...this.options.allowedPorts].join(', ');
      throw Errors.urlNotAllowed(`port ${port} is not allowed (allowed: ${allowed})`);
    }

    const host = normalizeHostname(url.hostname);
    this.assertHostAllowed(host);
    url.hash = '';
    return url;
  }

  /** Used by the DNS lookup guard on every resolved address. */
  isAddressAllowed(address: string): boolean {
    return this.options.allowPrivateNetworks || !isBlockedAddress(address);
  }

  private assertHostAllowed(host: string): void {
    const { allowedHosts, allowPrivateNetworks } = this.options;

    if (allowedHosts.length > 0 && !allowedHosts.some((rule) => matchesHostRule(host, rule))) {
      throw Errors.urlNotAllowed(`host "${host}" is not in this service's allow-list`);
    }
    if (allowPrivateNetworks) return;

    if (isIP(host) !== 0) {
      if (isBlockedAddress(host)) {
        throw Errors.urlNotAllowed('private, loopback and reserved IP addresses are not allowed');
      }
      return;
    }
    if (host === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      throw Errors.urlNotAllowed(`internal hostname "${host}" is not allowed`);
    }
  }
}

/** Lower-cases, strips IPv6 brackets and any trailing root dot ("example.com." -> "example.com"). */
function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return unbracketed.toLowerCase().replace(/\.$/, '');
}

function matchesHostRule(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}
