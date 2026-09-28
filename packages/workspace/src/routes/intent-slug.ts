import { createGuidanceDetailHandlers } from "./guidance";

const handlers = createGuidanceDetailHandlers("intent");
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
