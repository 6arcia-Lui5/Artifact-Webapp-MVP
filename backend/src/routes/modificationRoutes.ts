
import { Router } from "express";
import { requireApiAuth } from "../middleware/requireApiAuth";
import * as modificationController from "../controllers/modificationController";

const router = Router();

// Requests received by the logged-in publisher.
router.get(
    "/incoming",
    requireApiAuth,
    modificationController.getIncomingModificationRequests
);

// Requests submitted by the logged-in contributor.
router.get(
    "/outgoing",
    requireApiAuth,
    modificationController.getOutgoingModificationRequests
);

// View one modification request.
router.get(
    "/:id",
    requireApiAuth,
    modificationController.getModificationRequestById
);

// Review an individual proposed field change.
router.patch(
    "/:id/changes/:changeId",
    requireApiAuth,
    modificationController.reviewModificationChange
);

export default router;
