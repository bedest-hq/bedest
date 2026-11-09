/** One invalid input field of a 400 response [BUG-14]. */
export interface IApiErrorDetail {
  field: string;
  message: string;
}

/**
 * The body of every error response [BUG-14]: `error` is the HTTP reason
 * phrase (e.g. "Unauthorized"), `message` an optional human-readable
 * explanation, `details` the invalid fields of a validation error.
 */
export interface IApiError {
  error: string;
  message?: string;
  details?: IApiErrorDetail[];
}
