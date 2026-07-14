interface CatalogueOrderKey {
  readonly id: string;
  readonly name: string;
}

export function compareCatalogueText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareCatalogueDatasets(
  left: CatalogueOrderKey,
  right: CatalogueOrderKey,
): number {
  return compareCatalogueText(left.name, right.name) || compareCatalogueText(left.id, right.id);
}
