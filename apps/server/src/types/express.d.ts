import { RequestUser } from '../auth/jwt-auth.guard';

declare module 'express' {
  interface Request {
    user?: RequestUser;
  }
}

export {};
