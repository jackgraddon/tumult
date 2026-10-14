export type IssueSeverity = "error" | "warning" | "info";
export type IssueCode =
    | "invalid-envelope"
    | "unknown-token"
    | "missing-token"
    | "tier-violation"
    | "reference-cycle"
    | "banned-url"
    | "invalid-value"
    | "unknown-reference"
    | "unsupported-version";

export interface ValidationIssue {
    code: IssueCode;
    severity: IssueSeverity;
    token?: string;
    /** Set when the issue belongs to a mode override rather than the base mode. */
    mode?: string;
    message: string;
    suggestion?: string;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}

export { validateTheme } from "./index.ts";
export { suggestToken } from "./suggest.ts";
export type { ThemeDocument } from "./document.ts";
