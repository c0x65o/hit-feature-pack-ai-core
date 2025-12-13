export function autoApproveWritesEnabled() {
    // Dev sandbox default: auto-approve writes in development.
    // Can be overridden by setting HIT_AI_AUTO_APPROVE_WRITES=1.
    return process.env.NODE_ENV === 'development' || process.env.HIT_AI_AUTO_APPROVE_WRITES === '1';
}
export function autoApproveDeleteEnabled() {
    // Extra guardrail: even in rogue mode, DELETE defaults to requiring approval.
    // Flip on if you really want it: HIT_AI_AUTO_APPROVE_DELETE=1
    return process.env.HIT_AI_AUTO_APPROVE_DELETE === '1';
}
