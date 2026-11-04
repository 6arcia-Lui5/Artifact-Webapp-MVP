const client = async () => (await import('./axios.js')).default;
const root = '/research/discoveries';
export const getDiscoveries = async (status, page, signal) => (await (await client()).get(root, { params: { status, page }, signal })).data;
export const addDiscoveries = async body => (await (await client()).post(root, body, { timeout: 60000 })).data;
export const decideDiscovery = async ({ id, decision, expectedRevision, undo }) => {
  const api = await client();
  return (undo ? await api.post(`${root}/${encodeURIComponent(id)}/undo`, { expectedRevision })
    : await api.patch(`${root}/${encodeURIComponent(id)}`, { decision, expectedRevision })).data;
};
