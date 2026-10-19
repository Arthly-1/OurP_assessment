import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Errors } from '../../errors/app-error.js';
import type { SourceUrlPolicy } from './url-policy.js';

export function createGuardedLookup(policy: SourceUrlPolicy): LookupFunction {
  const lookup = (
    hostname: string,
    options: dns.LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 0);

      if (addresses.some((entry) => !policy.isAddressAllowed(entry.address))) {
        return callback(
          Errors.urlNotAllowed('the host resolves to a private, loopback or reserved address'),
          '',
          0,
        );
      }

      const first = addresses[0];
      if (!first)
        return callback(Object.assign(new Error('no addresses'), { code: 'ENOTFOUND' }), '', 0);
      if (options.all) return callback(null, addresses);
      return callback(null, first.address, first.family);
    });
  };
  return lookup as LookupFunction;
}
