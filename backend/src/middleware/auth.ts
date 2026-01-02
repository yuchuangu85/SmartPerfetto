import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    subscription: string;
  };
}

/**
 * Authentication middleware - currently passes through with mock user
 * TODO: Implement real authentication when needed
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Currently always use mock user (no auth implemented)
  req.user = {
    id: 'dev-user-123',
    email: 'dev@example.com',
    subscription: 'pro',
  };
  next();
};

/**
 * Usage check middleware - currently passes through
 * TODO: Implement usage limits when needed
 */
export const checkUsage = (isTraceAnalysis: boolean = false) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Currently no usage limits
    next();
  };
};

export type { AuthenticatedRequest };
