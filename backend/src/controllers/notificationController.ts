
import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import * as queries from "../db/queries";

// Helper to safely retrieve route parameters.
const getParam = (value: string | string[] | undefined): string | null => {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    return value;
};

// Retrieve notifications for the logged-in user.
export const getNotifications = async (
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

        const notifications =
            await queries.getNotificationsByUserId(userId);

        const unreadCount =
            await queries.getUnreadNotificationCount(userId);

        return res.status(200).json({
            notifications,
            unreadCount,
        });

    } catch (error) {
        console.error("Error getting notifications:", error);

        return res.status(500).json({
            error: "Failed to retrieve notifications",
        });
    }
};


// Retrieve the unread notification count.
export const getUnreadNotificationCount = async (
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

        const unreadCount =
            await queries.getUnreadNotificationCount(userId);

        return res.status(200).json({
            unreadCount,
        });

    } catch (error) {
        console.error("Error getting unread notification count:", error);

        return res.status(500).json({
            error: "Failed to retrieve unread notification count",
        });
    }
};


// Mark one notification as read.
export const markNotificationAsRead = async (
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

        const notificationId = getParam(req.params.id);

        if (!notificationId) {
            return res.status(400).json({
                error: "Invalid notification ID",
            });
        }

        const notification =
            await queries.markNotificationAsRead(
                notificationId,
                userId
            );

        if (!notification) {
            return res.status(404).json({
                error: "Notification not found",
            });
        }

        return res.status(200).json({
            message: "Notification marked as read",
            notification,
        });

    } catch (error) {
        console.error("Error marking notification as read:", error);

        return res.status(500).json({
            error: "Failed to mark notification as read",
        });
    }
};


// Mark all notifications as read for the logged-in user.
export const markAllNotificationsAsRead = async (
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

        const updatedNotifications =
            await queries.markAllNotificationsAsRead(userId);

        return res.status(200).json({
            message: "All notifications marked as read",
            updatedCount: updatedNotifications.length,
        });

    } catch (error) {
        console.error("Error marking all notifications as read:", error);

        return res.status(500).json({
            error: "Failed to mark all notifications as read",
        });
    }
};
