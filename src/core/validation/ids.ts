import { error, type Diagnostic, type Path } from '../domain/diagnostics'

/**
 * Collects IDs from an entity collection and reports every repeated ID at the
 * repeat's path. All IDs (including repeats) are returned so references can
 * still be resolved and checked in the same pass.
 */
export function collectIds(
  entities: readonly { readonly id: string }[],
  path: Path,
  noun: string,
  out: Diagnostic[],
): Set<string> {
  const ids = new Set<string>()
  entities.forEach((entity, index) => {
    if (ids.has(entity.id)) {
      out.push(
        error('DUPLICATE_ID', [...path, index, 'id'], `Duplicate ${noun} ID "${entity.id}".`, {
          entityId: entity.id,
        }),
      )
    }
    ids.add(entity.id)
  })
  return ids
}
