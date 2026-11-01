
import type { Request, Response } from "express";
import * as queries from "../db/queries";
import { getAuth } from "@clerk/express";

// Helper to safely retrieve route parameters.
const getParam = (value: string | string[] | undefined): string | null => {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    return value;
};

// Submit a modification request.
export const createModificationRequest = async (
    req: Request,
    res: Response
) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        const recordId = getParam(req.params.id);

        if (!recordId) {
            return res.status(400).json({
                error: "Invalid record ID",
            });
        }

        const record = await queries.getRecordById(recordId);

        if (!record) {
            return res.status(404).json({
                error: "Record not found",
            });
        }

        if (record.userId === userId) {
            return res.status(403).json({
                error: "You cannot submit a modification request for your own record",
            });
        }

        const { changes } = req.body;

        if (!Array.isArray(changes) || changes.length === 0) {
            return res.status(400).json({
                error: "At least one proposed change is required",
            });
        }

        // Validate the structure and value types of each proposed change.
        for (const change of changes) {
            if (
                !change ||
                typeof change.fieldName !== "string" ||
                !change.fieldName.trim()
            ) {
                return res.status(400).json({
                    error: "Each change must include a valid fieldName",
                });
            }

            const validValue =
                typeof change.proposedValue === "string" ||
                typeof change.proposedValue === "boolean" ||
                change.proposedValue === null;

            if (!validValue) {
                return res.status(400).json({
                    error: `Invalid proposed value for ${change.fieldName}`,
                });
            }
        }

        // Prevent duplicate field proposals in one request.
        const fieldNames = changes.map(
            (change: { fieldName: string }) => change.fieldName
        );

        if (new Set(fieldNames).size !== fieldNames.length) {
            return res.status(400).json({
                error: "A field can only be proposed once per request",
            });
        }

        const modificationRequest =
            await queries.createModificationRequest(
                recordId,
                userId,
                changes
            );

        return res.status(201).json(modificationRequest);

    } catch (error) {
        console.error("Error creating modification request:", error);

        if (
            error instanceof Error &&
            (
                error.message.includes("cannot be modified") ||
                error.message.includes("must have") ||
                error.message.includes("cannot be empty") ||
                error.message.includes("already exist") ||
                error.message.includes("required") ||
                error.message.includes("own record")
            )
        ) {
            return res.status(400).json({
                error: error.message,
            });
        }

        return res.status(500).json({
            error: "Failed to submit modification request",
        });
    }
};


// Get a modification request by ID.
// Only the original publisher and the contributor can view it.
export const getModificationRequestById = async (
    req: Request,
    res: Response
) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        const id = getParam(req.params.id);

        if (!id) {
            return res.status(400).json({
                error: "Invalid modification request ID",
            });
        }

        const modificationRequest =
            await queries.getModificationRequestById(id);

        if (!modificationRequest) {
            return res.status(404).json({
                error: "Modification request not found",
            });
        }

        // Only the publisher or the contributor can access this request.
        if (
            modificationRequest.publisherId !== userId &&
            modificationRequest.modifierId !== userId
        ) {
            return res.status(403).json({
                error: "You are not authorized to view this request",
            });
        }

        return res.status(200).json(modificationRequest);

    } catch (error) {
        console.error("Error getting modification request:", error);

        return res.status(500).json({
            error: "Failed to get modification request",
        });
    }
};


// Get modification requests for records owned by the logged-in user.
export const getIncomingModificationRequests = async (
    req: Request,
    res: Response
) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        const requests =
            await queries.getIncomingModificationRequests(userId);

        return res.status(200).json(requests);

    } catch (error) {
        console.error("Error getting incoming modification requests:", error);

        return res.status(500).json({
            error: "Failed to get incoming modification requests",
        });
    }
};


// Get modification requests submitted by the logged-in user.
export const getOutgoingModificationRequests = async (
    req: Request,
    res: Response
) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        const requests =
            await queries.getOutgoingModificationRequests(userId);

        return res.status(200).json(requests);

    } catch (error) {
        console.error("Error getting outgoing modification requests:", error);

        return res.status(500).json({
            error: "Failed to get outgoing modification requests",
        });
    }
};


// Approve or reject one proposed field change.
export const reviewModificationChange = async (
    req: Request,
    res: Response
) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        const requestId = getParam(req.params.id);
        const changeId = getParam(req.params.changeId);

        if (!requestId || !changeId) {
            return res.status(400).json({
                error: "Invalid request ID or change ID",
            });
        }

        const { decision, rejectionReason } = req.body;

        if (decision !== "APPROVED" && decision !== "REJECTED") {
            return res.status(400).json({
                error: "Decision must be APPROVED or REJECTED",
            });
        }

        if (
            rejectionReason !== undefined &&
            rejectionReason !== null &&
            typeof rejectionReason !== "string"
        ) {
            return res.status(400).json({
                error: "Rejection reason must be a string",
            });
        }

        // Check that the request exists and that the reviewer owns the record.
        const modificationRequest =
            await queries.getModificationRequestById(requestId);

        if (!modificationRequest) {
            return res.status(404).json({
                error: "Modification request not found",
            });
        }

        if (modificationRequest.publisherId !== userId) {
            return res.status(403).json({
                error: "Only the original publisher can review this request",
            });
        }

        const change = modificationRequest.changes.find(
            (item: { id: string }) => item.id === changeId
        );

        if (!change) {
            return res.status(404).json({
                error: "Modification change not found",
            });
        }

        if (change.status !== "PENDING") {
            return res.status(409).json({
                error: "This change has already been reviewed",
            });
        }

        const result = await queries.reviewModificationChange(
            requestId,
            changeId,
            userId,
            decision,
            rejectionReason
        );

        return res.status(200).json(result);

    } catch (error) {
        console.error("Error reviewing modification change:", error);

        return res.status(500).json({
            error: "Failed to review modification change",
        });
    }
};
