import { createGuidanceCollectionHandlers } from "./guidance";

const handlers = createGuidanceCollectionHandlers("intent");
export const GET = handlers.GET;
export const POST = handlers.POST;
