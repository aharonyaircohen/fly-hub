import { createGuidanceCollectionHandlers } from "./guidance";

const handlers = createGuidanceCollectionHandlers("constraint");
export const GET = handlers.GET;
export const POST = handlers.POST;
