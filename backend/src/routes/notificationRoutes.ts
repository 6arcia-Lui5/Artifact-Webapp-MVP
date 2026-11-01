
import { Router } from "express";
import { requireApiAuth } from "../middleware/requireApiAuth";
import * as notificationController from "../controllers/notificationController";

const router = Router();

// Retrieve notifications for the logged-in user.
router.get(
    "/",
    requireApiAuth,
    notificationController.getNotifications
);

// Retrieve unread notification count.
router.get(
    "/unread-count",
    requireApiAuth,
    notificationController.getUnreadNotificationCount
);

// Mark one notification as read.
router.patch(
    "/:id/read",
    requireApiAuth,
    notificationController.markNotificationAsRead
);

// Mark all notifications as read.
router.patch(
    "/read-all",
    requireApiAuth,
    notificationController.markAllNotificationsAsRead
);

export default router;
