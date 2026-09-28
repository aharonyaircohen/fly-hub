# Run tracing

Status: **Future extension**

Current simplified Runs store identity, target, Agent, optional Todo/parent
links, timestamps, output, and error. A full correlation tree, pinned definition
trace, policy hash, provider usage, and cross-process trace context are not one
current contract.

Add tracing only through the Run owner and Convex history. Logs are diagnostic;
they must not replace structured Run state or events.
