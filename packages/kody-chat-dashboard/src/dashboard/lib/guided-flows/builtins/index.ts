import type { GuidedFlowDefinition } from "../controller";
import {
  buildGuidedFlowFromRequestBlueprint,
  type RequestBlueprintDefinition,
} from "../../request-blueprints";
import { CREATE_WORKFLOW_FLOW } from "./create-workflow";
import { INITIALIZE_KODY_ENGINE_FLOW } from "./initialize-kody-engine";
import { SETUP_UI_LOGIN_FLOW } from "./setup-ui-login";
import {
  PROJECT_ASSESSMENT_REQUEST_BLUEPRINT,
  PROJECT_ASSESSMENT_REQUEST_BLUEPRINT_V1,
} from "./project-assessment";
import {
  ONBOARDING_FLOW,
  ONBOARDING_FLOW_V1,
  ONBOARDING_FLOW_V2,
  ONBOARDING_FLOW_V4,
} from "./onboarding";
import { NEW_AGENCY_REQUEST_BLUEPRINT } from "./new-agency-request";
import { CREATE_BLUEPRINT_REQUEST_BLUEPRINT } from "../../request-blueprints/create-blueprint";

export { CREATE_WORKFLOW_FLOW_ID } from "./create-workflow";
export { INITIALIZE_KODY_ENGINE_FLOW_ID } from "./initialize-kody-engine";
export { ONBOARDING_FLOW_ID } from "./onboarding";
export { SETUP_UI_LOGIN_FLOW_ID } from "./setup-ui-login";
export { PROJECT_ASSESSMENT_FLOW_ID } from "./project-assessment";
export { NEW_AGENCY_REQUEST_FLOW_ID } from "./new-agency-request";
export { CREATE_BLUEPRINT_FLOW_ID } from "../../request-blueprints/create-blueprint";

export const BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS: readonly RequestBlueprintDefinition[] =
  [
    PROJECT_ASSESSMENT_REQUEST_BLUEPRINT_V1,
    PROJECT_ASSESSMENT_REQUEST_BLUEPRINT,
    NEW_AGENCY_REQUEST_BLUEPRINT,
    CREATE_BLUEPRINT_REQUEST_BLUEPRINT,
  ];

export const BUILTIN_GUIDED_FLOW_DEFINITIONS: readonly GuidedFlowDefinition[] =
  [
    ONBOARDING_FLOW_V1,
    ONBOARDING_FLOW_V2,
    ONBOARDING_FLOW_V4,
    ONBOARDING_FLOW,
    INITIALIZE_KODY_ENGINE_FLOW,
    SETUP_UI_LOGIN_FLOW,
    CREATE_WORKFLOW_FLOW,
    ...BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS.map((definition) =>
      buildGuidedFlowFromRequestBlueprint(definition),
    ),
  ];
