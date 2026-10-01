export class OorableCaptchaError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "OorableCaptchaError";
    this.code = code;
  }
}

export class ConfigurationError extends OorableCaptchaError {
  constructor(message: string) {
    super(message, "configuration_error");
    this.name = "ConfigurationError";
  }
}

/** Thrown when a bounded store or limiter is full and refuses new state rather than growing without limit. */
export class CapacityError extends OorableCaptchaError {
  constructor(message: string) {
    super(message, "store_capacity");
    this.name = "CapacityError";
  }
}
