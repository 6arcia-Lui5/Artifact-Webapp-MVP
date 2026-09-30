import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

// API clients need JSON 401 responses, not redirects to an HTML sign-in page.
// Apply this to any future export/download endpoint before reading its data.
export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  next();
}

