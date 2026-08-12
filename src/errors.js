export class PipelineError extends Error {
  constructor(message, code = "PIPELINE_ERROR", cause) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export class ApiError extends PipelineError {
  constructor(message, status, body, cause) {
    super(message, "API_ERROR", cause);
    this.status = status;
    this.body = body;
  }
}

export class ValidationFailure extends PipelineError {
  constructor(report) {
    super("Data validation failed: " + report.summary, "VALIDATION_FAILED");
    this.report = report;
  }
}

export class HealFailure extends PipelineError {
  constructor(reason) {
    super("Self-healing failed: " + reason, "HEAL_FAILED");
    this.reason = reason;
  }
}
