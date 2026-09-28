import { createGuidanceCollectionHandlers } from "./guidance";

const handlers = createGuidanceCollectionHandlers("policy");
export const GET = handlers.GET;
export const POST = handlers.POST;
