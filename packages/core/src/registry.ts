import {
  EXIT_CODES,
  KlopsiError,
  type DataProvider,
  type ProviderDescriptor,
  type ProviderId,
} from "@klopsi/domain";

export class ProviderRegistry {
  private readonly providers = new Map<string, DataProvider>();

  constructor(providers: readonly DataProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: DataProvider): void {
    const id = provider.descriptor.id;
    if (this.providers.has(id)) {
      throw new KlopsiError({
        code: "DUPLICATE_PROVIDER",
        message: `Provider '${id}' is already registered.`,
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { providerId: id },
      });
    }
    this.providers.set(id, provider);
  }

  get(id: ProviderId | string): DataProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new KlopsiError({
        code: "PROVIDER_NOT_FOUND",
        message: `Provider '${id}' is not registered.`,
        exitCode: EXIT_CODES.INVALID_INPUT,
        suggestion: "Run 'klopsi providers list' to see available providers.",
        context: { providerId: id },
      });
    }
    return provider;
  }

  list(): readonly ProviderDescriptor[] {
    return [...this.providers.values()]
      .map((provider) => provider.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
