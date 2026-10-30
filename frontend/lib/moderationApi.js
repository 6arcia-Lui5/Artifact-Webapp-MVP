const client = async () => (await import("./axios.js")).default;
const segment = value => encodeURIComponent(value);

export const getResearchAccess = async signal => (await (await client()).get("/research/access", { signal, timeout: 15000 })).data;
export const getModerationQueue = async (params, signal) => (await (await client()).get("/research/moderation", { params, signal, timeout: 25000 })).data;
export const moderateRecord = async ({ id, ...body }) => (await (await client()).post(`/research/records/${segment(id)}/moderate`, body, { timeout: 25000 })).data;
export const getResearchRoles = async signal => (await (await client()).get("/research/roles", { signal, timeout: 15000 })).data;
export const changeResearchRole = async ({ userId, role }) => (await (await client()).patch(`/research/roles/${segment(userId)}`, { role }, { timeout: 15000 })).data;

export function parseModerationParams(input) {
  const search = new URLSearchParams(input);
  const page = Number(search.get("page"));
  const size = Number(search.get("pageSize"));
  const status = search.get("status");
  return {
    status: ["pending", "approved", "changes_requested"].includes(status) ? status : "pending",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1,
    pageSize: Number.isSafeInteger(size) && size >= 1 ? Math.min(size, 100) : 24,
  };
}

export function validateModerationDecision({ record, access, status, notes }) {
  if (!access?.canReview) return "Your account does not have permission to moderate submissions.";
  if (!["approved", "changes_requested"].includes(status)) return "Choose approval or request changes.";
  if (!Number.isInteger(record?.revision) || record.revision < 1) return "This record has no revision for conflict checks. Reload before making a decision.";
  if (typeof notes !== "string" || notes.length > 10000) return "Decision notes must be 10000 characters or fewer.";
  const ownApproval = status === "approved" && record.userId === access.userId;
  if (record.userId === access.userId && access.role !== "admin") return "A reviewer cannot decide their own submission. Ask another reviewer or an administrator.";
  if (ownApproval && !notes.trim()) return "Document your reason for approving your own submission.";
  if (status === "changes_requested" && !notes.trim()) return "Explain the changes the contributor needs to make.";
  if (!notes.trim()) return "Add a short factual review note before approving the submission.";
  return "";
}

export function validateRoleChange({ access, target, role }) {
  if (!access?.canManageRoles || access.role !== "admin") return "Only administrators can manage reviewer roles.";
  if (!["contributor", "reviewer"].includes(role)) return "Administrator assignment is managed on the server.";
  if (!target?.userId || target.userId === access.userId || target.role === "admin") return "This account's role cannot be changed here.";
  return "";
}

export function moderationError(error) {
  if (error?.response?.status === 409) return "This record changed after you opened it. Reload the queue and inspect the latest revision before submitting another decision. Your notes have been kept.";
  if (error?.response?.status === 401) return "Your session expired. Sign in again to continue.";
  if (error?.response?.status === 403) return "You do not have permission to perform this action. Reload your access to check your current role.";
  const detail = error?.response?.data?.error || error?.response?.data?.message;
  return typeof detail === "string" ? detail : error?.message || "The request failed. Please retry.";
}
