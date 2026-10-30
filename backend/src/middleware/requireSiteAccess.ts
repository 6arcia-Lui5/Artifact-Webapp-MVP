import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENV } from "../config/env";

type DevelopmentAccount = { userId?: string };

function approvedUserIds(): Set<string> {
  const configured = ENV.ALLOWED_CLERK_USER_IDS?.split(",").map(id => id.trim()).filter(Boolean);
  if (configured?.length) return new Set(configured);

  // The seed script writes IDs next to the repository. Use them only for local development.
  if (ENV.NODE_ENV === "development") {
    try {
      const file = path.resolve(__dirname, "../../../.local/dev-accounts.json");
      const accounts = JSON.parse(readFileSync(file, "utf8")) as DevelopmentAccount[];
      return new Set(accounts.map(account => account.userId).filter((id): id is string => Boolean(id)));
    } catch {
      // A missing or incomplete local account sheet leaves the site closed.
    }
  }
  return new Set();
}

const allowedIds = approvedUserIds();

export function requireSiteAccess(req: Request, res: Response, next: NextFunction) {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  if (!allowedIds.has(userId)) {
    res.status(403).json({ error: "This account does not have access" });
    return;
  }
  next();
}
