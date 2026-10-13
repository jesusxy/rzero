// Ordered, machine-readable diagnostics (docs/scenario-model.md#errors).
// The code and path are authoritative; the message is derived display text.

export type DiagnosticSeverity = 'error' | 'warning'

export type DiagnosticCode =
  // Document decoding and parsing
  | 'DOCUMENT_TOO_LARGE'
  | 'INVALID_UTF8'
  | 'JSON_SYNTAX'
  | 'YAML_SYNTAX'
  | 'YAML_EMPTY'
  | 'YAML_MULTIPLE_DOCUMENTS'
  | 'YAML_DIRECTIVE'
  | 'YAML_ANCHOR'
  | 'YAML_ALIAS'
  | 'YAML_TAG'
  | 'YAML_NON_STRING_KEY'
  | 'DUPLICATE_KEY'
  | 'NONFINITE_NUMBER'
  | 'INVALID_STRING'
  | 'NESTING_TOO_DEEP'
  | 'NOT_JSON_VALUE'
  | 'STIX_NOT_NATIVE'
  // Envelope, limits and shape (JSON Schema)
  | 'UNSUPPORTED_MODEL_VERSION'
  | 'LIMIT_EXCEEDED'
  | 'MISSING_FIELD'
  | 'UNKNOWN_FIELD'
  | 'FIELD_NOT_ALLOWED'
  | 'INVALID_TYPE'
  | 'INVALID_ENUM'
  | 'INVALID_FORMAT'
  | 'INVALID_VALUE'
  | 'TOO_FEW_ITEMS'
  | 'TOO_MANY_ITEMS'
  | 'DUPLICATE_ITEM'
  // Semantic validation
  | 'DUPLICATE_ID'
  | 'UNKNOWN_SEGMENT'
  | 'UNKNOWN_ASSET'
  | 'UNKNOWN_CREDENTIAL'
  | 'UNKNOWN_SERVICE'
  | 'UNKNOWN_GRANT'
  | 'UNKNOWN_EVIDENCE'
  | 'SELF_LINK'
  | 'DUPLICATE_LINK'
  | 'DUPLICATE_GRANT'
  | 'INVALID_SERVICE_TRANSPORT'
  | 'INVALID_DATE'
  | 'MISSING_NONSYNTHETIC_EVIDENCE'
  | 'PROFILE_NOT_REVIEWED'
  | 'INTERVENTION_NO_MATCH'
  | 'CONFLICTING_INTERVENTIONS'
  // Controlled comparison (analysis)
  | 'COMPARISON_INCOMPATIBLE'
  | 'COMPARISON_ABORTED_RUN'
  // Warnings (never block compilation)
  | 'INTERVENTION_NOOP'
  | 'VULNERABILITY_FACT_MISSING'

export type SourceLocation = {
  /** 1-based. */
  readonly line: number
  /** 1-based, in UTF-16 code units. */
  readonly column: number
}

export type Diagnostic = {
  readonly severity: DiagnosticSeverity
  readonly code: DiagnosticCode
  /** Field path such as `network.links[2].target_id`. The empty string is the document root. */
  readonly path: string
  readonly message: string
  readonly entity_id?: string
  /** Present for parse-stage diagnostics when the source position is known. */
  readonly location?: SourceLocation
}

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type PathSegment = string | number

export type Path = readonly PathSegment[]

const identifierKey = /^[A-Za-z_][A-Za-z0-9_]*$/

export function formatPath(path: Path): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`
    } else if (identifierKey.test(segment)) {
      out += out === '' ? segment : `.${segment}`
    } else {
      out += `[${JSON.stringify(segment)}]`
    }
  }
  return out
}

type DiagnosticOptions = {
  entityId?: string
  location?: SourceLocation
}

export function error(
  code: DiagnosticCode,
  path: Path,
  message: string,
  options: DiagnosticOptions = {},
): Diagnostic {
  return build('error', code, path, message, options)
}

export function warning(
  code: DiagnosticCode,
  path: Path,
  message: string,
  options: DiagnosticOptions = {},
): Diagnostic {
  return build('warning', code, path, message, options)
}

function build(
  severity: DiagnosticSeverity,
  code: DiagnosticCode,
  path: Path,
  message: string,
  options: DiagnosticOptions,
): Diagnostic {
  return {
    severity,
    code,
    path: formatPath(path),
    message,
    ...(options.entityId === undefined ? {} : { entity_id: options.entityId }),
    ...(options.location === undefined ? {} : { location: options.location }),
  }
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

export function ok<T>(value: T, diagnostics: readonly Diagnostic[] = []): Result<T> {
  return { ok: true, value, diagnostics }
}

export function fail<T>(diagnostics: readonly Diagnostic[]): Result<T> {
  return { ok: false, diagnostics }
}
