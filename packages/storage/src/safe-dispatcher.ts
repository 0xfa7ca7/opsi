import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Agent, type Dispatcher } from "undici";
import { assertPublicAddressSet, type AddressRecord } from "./ip-policy.js";

export type AddressResolver = (hostname: string) => Promise<readonly AddressRecord[]>;
export interface SafeDispatcherFactoryOptions {
  readonly resolver?: AddressResolver;
  readonly connectTimeoutMs?: number;
}
const defaultResolver: AddressResolver = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export class SafeDispatcherFactory {
  private readonly resolver: AddressResolver;
  private readonly connectTimeoutMs: number;
  constructor(options: SafeDispatcherFactoryOptions = {}) {
    this.resolver = options.resolver ?? defaultResolver;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  }
  lookupFor(_origin: URL, allowPrivateNetwork = false): LookupFunction {
    return (hostname, options, callback) => {
      void this.resolver(hostname)
        .then((answers) => {
          const approved = allowPrivateNetwork ? answers : assertPublicAddressSet(answers);
          if (approved.length === 0) throw new Error("DNS returned no addresses.");
          if (typeof options === "object" && options.all) callback(null, approved as never);
          else {
            const family = typeof options === "object" ? options.family : undefined;
            const answer =
              approved.find((item) =>
                family === 4 || family === 6 ? item.family === family : true,
              ) ?? approved[0];
            callback(null, answer!.address, answer!.family);
          }
        })
        .catch((error: unknown) => callback(error as NodeJS.ErrnoException, undefined as never));
    };
  }
  create(origin: URL, allowPrivateNetwork = false): Dispatcher {
    return new Agent({
      maxHeaderSize: 64 * 1024,
      connect: {
        lookup: this.lookupFor(origin, allowPrivateNetwork),
        timeout: this.connectTimeoutMs,
      },
    });
  }
}
