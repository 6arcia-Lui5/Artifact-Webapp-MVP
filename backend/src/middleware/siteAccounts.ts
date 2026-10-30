// Populated only by the existing server-side approved-account gate at startup.
// Kept independent of environment/file loading so policy helpers are pure imports.
let approved = new Set<string>();
export function configureApprovedAccounts(ids: Iterable<string>) { approved = new Set(ids); }
export const isApprovedUserId = (id: string) => approved.has(id);
export const approvedAccountIds = () => [...approved];
