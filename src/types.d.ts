// Augment Express's Request with the label of the API key that authenticated it.
import "express";

declare global {
  namespace Express {
    interface Request {
      apiKeyLabel?: string;
    }
  }
}
