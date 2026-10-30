import api from "./axios";
import { downloadErrorPayload } from "../src/components/research/catalogDownload";

const path = (id) => encodeURIComponent(id);
export const getResearchRecords = async (params, signal) => (await api.get("/research/records", { params, signal })).data;
export const getResearchFacets = async (signal) => (await api.get("/research/facets", { signal })).data;
export const getResearchCollections = async (signal) => (await api.get("/research/collections", { signal })).data;
export const getResearchCollection = async (id, signal) => (await api.get(`/research/collections/${path(id)}`, { signal })).data;
export const createResearchCollection = async (values) => (await api.post("/research/collections", values)).data;
export const updateResearchCollection = async ({ id, values }) => (await api.patch(`/research/collections/${path(id)}`, values)).data;
export const deleteResearchCollection = async (id) => (await api.delete(`/research/collections/${path(id)}`)).data;
export const addCollectionRecords = async ({ id, recordIds }) => (await api.post(`/research/collections/${path(id)}/records`, { recordIds })).data;
export const removeCollectionRecord = async ({ id, recordId }) => (await api.delete(`/research/collections/${path(id)}/records/${path(recordId)}`)).data;

export async function downloadResearchRecords(params, format, ids = []) {
  const exportParams = { ...params };
  delete exportParams.page;
  delete exportParams.pageSize;
  let data;
  try {
    ({ data } = await api.get("/research/export", {
      params: { ...exportParams, format, ...(ids.length ? { ids: ids.join(",") } : {}) },
      responseType: "blob",
    }));
  } catch (error) {
    if (error.response) error.response.data = await downloadErrorPayload(error.response.data);
    throw error;
  }
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `artifact-records.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function researchError(error) {
  const status = error?.response?.status;
  const detail = error?.response?.data?.error || error?.response?.data?.message;
  const message = typeof detail === "string" ? detail : "";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "Your account does not have access to this action.";
  if (status === 404 || status === 503) return `${message || "The research resource is unavailable."} If the catalog is not configured, ask the site administrator to apply the research database migration and enable the research API, then retry.`;
  return message || error?.message || "The request failed. Please retry.";
}
