import { createGuidanceDetailHandlers } from "./guidance";

const handlers = createGuidanceDetailHandlers("policy");
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
