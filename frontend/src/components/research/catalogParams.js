export const FILTER_FIELDS = ["q", "museum", "material", "language", "script", "place", "objectTypeId", "reviewStatus", "sourceProvider", "dateFrom", "dateTo"];
const SORTS = new Set(["newest", "oldest", "title", "updated"]);

export function parseCatalogParams(input) {
  const search = new URLSearchParams(input);
  const params = {};
  for (const field of FILTER_FIELDS) {
    const value = search.get(field)?.trim();
    if (value) params[field] = value;
  }
  if (!["draft", "reviewed", "uncertain"].includes(params.reviewStatus)) delete params.reviewStatus;
  const page = Number(search.get("page"));
  const size = Number(search.get("pageSize"));
  params.page = Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1;
  params.pageSize = Number.isSafeInteger(size) && size > 0 ? Math.min(size, 100) : 24;
  params.sort = SORTS.has(search.get("sort")) ? search.get("sort") : "newest";
  return params;
}

export function validateDateRange({ dateFrom, dateTo }) {
  for (const value of [dateFrom, dateTo]) {
    if (value !== undefined && value !== "" && (!/^-?\d{1,7}$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Math.abs(Number(value)) > 1000000)) return "Enter whole signed years from -1000000 to 1000000, such as -500 for 500 BCE or 200 for 200 CE.";
  }
  if (dateFrom !== undefined && dateFrom !== "" && dateTo !== undefined && dateTo !== "" && Number(dateFrom) > Number(dateTo)) return "The start year must be earlier than or equal to the end year.";
  return "";
}

export function updateCatalogParams(input, changes) {
  const search = new URLSearchParams(input);
  for (const [key, value] of Object.entries(changes)) {
    if (value === "" || value === undefined || value === null) search.delete(key);
    else search.set(key, String(value));
  }
  if (!Object.hasOwn(changes, "page")) search.set("page", "1");
  return search;
}

export function formatYear(year) {
  if (year === undefined || year === null || year === "") return "";
  return Number(year) < 0 ? `${Math.abs(Number(year))} BCE` : `${Number(year)} CE`;
}
