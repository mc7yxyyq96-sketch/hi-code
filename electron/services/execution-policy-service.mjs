import {
  createExecutionLaunchPlan,
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  projectExecutionCapabilities,
} from "../../dist/execution-policy.js";
import { redactSensitive } from "../ipc/ipc-utils.mjs";

export function createExecutionPolicyService({
  platform = process.platform,
  backendAvailability,
  processTreeSupport,
  logger = null,
} = {}) {
  let detected = null;

  const capabilities = ({ refresh = false } = {}) => {
    if (!detected || refresh) {
      detected = detectExecutionCapabilities({ platform, backendAvailability, processTreeSupport });
    }
    return { ok: true, capabilities: projectExecutionCapabilities(detected) };
  };

  const evaluate = (request) => {
    const current = capabilities().capabilities;
    const decision = evaluateExecutionPolicy(request, current);
    logDecision(logger, decision);
    return decision;
  };

  const plan = (request) => {
    const current = capabilities().capabilities;
    const decision = evaluateExecutionPolicy(request, current);
    logDecision(logger, decision);
    return { decision, launch: decision.ok ? createExecutionLaunchPlan(decision, current) : null };
  };

  return Object.freeze({ capabilities, evaluate, plan });
}

export function registerExecutionPolicyIpc({ register, executionPolicy }) {
  if (!register) throw new Error("registerExecutionPolicyIpc requires register");
  if (!executionPolicy) throw new Error("registerExecutionPolicyIpc requires executionPolicy service");
  register.handle("execution-policy:capabilities", () => executionPolicy.capabilities());
}

function logDecision(logger, decision) {
  if (typeof logger !== "function") return;
  const payload = decision.ok
    ? {
      code: decision.code,
      strength: decision.strength,
      warnings: decision.warnings,
      enforced: decision.enforced,
      audit: decision.audit,
    }
    : {
      code: decision.code,
      strength: decision.strength,
      warnings: decision.warnings,
      error: decision.error,
    };
  logger("execution-policy:decision", redactSensitive(payload));
}
