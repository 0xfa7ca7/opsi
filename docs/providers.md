# Provider development

A provider supplies a stable descriptor and implements search, dataset/resource lookup, dataset resources, and resource resolution as declared capabilities. Map remote values to domain entities, preserve unknown upstream metadata under `providerMetadata.raw`, emit canonical references, validate every response, and map authentication, network, rate-limit, not-found, and unsupported failures to stable `OpsiError` values. Tests must use stored or local controlled fixtures and cover malformed legacy responses; normal tests may not contact OPSI.
