// Semantic network rules (docs/network-model.md#invariants-and-static-controls).
// Runs only on schema-valid input. Unknown facts are valid values, never errors.

import { error, type Diagnostic, type Path } from '../domain/diagnostics'
import { EXECUTABLE_SERVICE_IDS, type Network } from '../domain/network'
import { collectIds } from './ids'

export function checkNetworkSemantics(network: Network, base: Path): Diagnostic[] {
  const out: Diagnostic[] = []
  const segmentIds = collectIds(network.segments, [...base, 'segments'], 'segment', out)
  const assetIds = collectIds(network.assets, [...base, 'assets'], 'asset', out)
  const credentialIds = collectIds(network.credentials, [...base, 'credentials'], 'credential', out)
  collectIds(network.links, [...base, 'links'], 'link', out)

  network.assets.forEach((asset, assetIndex) => {
    const assetPath = [...base, 'assets', assetIndex]
    if (!segmentIds.has(asset.segment_id)) {
      out.push(
        error('UNKNOWN_SEGMENT', [...assetPath, 'segment_id'], `Segment "${asset.segment_id}" does not exist.`, {
          entityId: asset.id,
        }),
      )
    }

    collectIds(asset.services, [...assetPath, 'services'], `service (asset ${asset.id})`, out)
    asset.services.forEach((service, serviceIndex) => {
      const executable = (EXECUTABLE_SERVICE_IDS as readonly string[]).includes(service.id)
      if (executable && service.transport !== 'tcp') {
        out.push(
          error(
            'INVALID_SERVICE_TRANSPORT',
            [...assetPath, 'services', serviceIndex, 'transport'],
            `Service "${service.id}" is evaluated over TCP in V1; "${service.transport}" is invalid.`,
            { entityId: asset.id },
          ),
        )
      }
    })

    collectIds(asset.vulnerabilities, [...assetPath, 'vulnerabilities'], `vulnerability (asset ${asset.id})`, out)

    asset.credential_ids.forEach((credentialId, index) => {
      if (!credentialIds.has(credentialId)) {
        out.push(
          error(
            'UNKNOWN_CREDENTIAL',
            [...assetPath, 'credential_ids', index],
            `Credential "${credentialId}" does not exist.`,
            { entityId: asset.id },
          ),
        )
      }
    })
  })

  const linkTuples = new Map<string, string>()
  network.links.forEach((link, index) => {
    const linkPath = [...base, 'links', index]
    for (const endpoint of ['source_id', 'target_id'] as const) {
      if (!assetIds.has(link[endpoint])) {
        out.push(
          error('UNKNOWN_ASSET', [...linkPath, endpoint], `Asset "${link[endpoint]}" does not exist.`, {
            entityId: link.id,
          }),
        )
      }
    }
    if (link.source_id === link.target_id) {
      out.push(
        error('SELF_LINK', [...linkPath, 'target_id'], `Link "${link.id}" connects asset "${link.source_id}" to itself.`, {
          entityId: link.id,
        }),
      )
    }
    const tuple = `${link.source_id}\u0000${link.target_id}\u0000${link.service_id}`
    const existing = linkTuples.get(tuple)
    if (existing !== undefined) {
      out.push(
        error(
          'DUPLICATE_LINK',
          linkPath,
          `Link "${link.id}" repeats ${link.source_id} → ${link.target_id} (${link.service_id}) already defined by "${existing}".`,
          { entityId: link.id },
        ),
      )
    } else {
      linkTuples.set(tuple, link.id)
    }
  })

  network.credentials.forEach((credential, credentialIndex) => {
    const seen = new Set<string>()
    credential.grants.forEach((grant, grantIndex) => {
      const grantPath = [...base, 'credentials', credentialIndex, 'grants', grantIndex]
      if (!assetIds.has(grant.target_id)) {
        out.push(
          error('UNKNOWN_ASSET', [...grantPath, 'target_id'], `Asset "${grant.target_id}" does not exist.`, {
            entityId: credential.id,
          }),
        )
      }
      const key = `${grant.target_id}\u0000${grant.service_id}`
      if (seen.has(key)) {
        out.push(
          error(
            'DUPLICATE_GRANT',
            grantPath,
            `Credential "${credential.id}" already has a grant for ${grant.target_id}/${grant.service_id}; duplicates are rejected, not merged.`,
            { entityId: credential.id },
          ),
        )
      }
      seen.add(key)
    })
  })

  return out
}
