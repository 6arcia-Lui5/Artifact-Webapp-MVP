import api from "./axios";

// Users API
export const syncUser = async (userData) => {
    const { data } = await api.post("/users/sync", userData);
    return data;
}

// Record API
export const getAllRecords = async () => {
    const { data } = await api.get("/records");
    return data;
}

export const getRecordById = async (id) => {
    const { data } = await api.get(`/records/${id}`);
    return data;
}

export const getMyRecords = async () => {
    const { data } = await api.get("/records/my");
    return data;
}

export const searchRecords = async (query) => {
    const { data } = await api.get("/records/search", {
        params: { query },
    });

    return data;
}

export const createRecord = async (recordData) => {
    const { data } = await api.post("/records", recordData);
    return data;
}

export const updateRecord = async (id, recordData) => {
    const { data } = await api.put(`/records/${id}`, recordData);
    return data;
}

export const deleteRecord = async (id) => {
    const { data } = await api.delete(`/records/${id}`);
    return data;
}

// Collection API
export const getAllCollections = async () => {
    const { data } = await api.get("/collections");
    return data;
}

export const getCollectionById = async (id) => {
    const { data } = await api.get(`/collections/${id}`);
    return data;
}

export const createCollection = async (recordData) => {
    const { data } = await api.post("/collections", recordData);
    return data;
}

export const importRecords = async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    const { data } = await api.post("/records/import", formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });

    return data;
}

export const getObjectTypes = async () => {
  const { data } = await api.get("/object-types");
  return data;
};

export const createObjectType = async (name) => {
  const { data } = await api.post("/object-types", { name });
  return data;
};
