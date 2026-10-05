import type { Request, Response } from "express"
import * as queries from "../db/queries"

export const getObjectTypes = async (
    req: Request,
    res: Response
) => {
    try {
        const objectTypes =
            await queries.getAllObjectTypes();

        res.status(200).json(objectTypes);
    } catch (error) {
        console.error("Error getting object types:", error);

        res.status(500).json({
            error: "Failed to get object types",
        });
    }
};

export const createObjectType = async (
    req: Request,
    res: Response
) => {
    try {
        const { name } = req.body;

        if (
            typeof name !== "string" ||
            !name.trim()
        ) {
            return res.status(400).json({
                error: "Object type name is required",
            });
        }

        const objectType =
            await queries.createObjectType(
                name.trim()
            );

        res.status(201).json(objectType);
    } catch (error) {
        console.error("Error creating object type:", error);

        res.status(500).json({
            error: "Failed to create object type",
        });
    }
};