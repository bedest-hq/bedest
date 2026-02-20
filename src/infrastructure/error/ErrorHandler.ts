import { status } from "elysia";

class ErrorHandler {
  badRequest(message: string = "Bad request") {
    throw status(400, { error: message });
  }

  unauthorized(message: string = "Unauthorized") {
    throw status(401, { error: message });
  }

  forbidden(message: string = "Forbidden") {
    throw status(403, { error: message });
  }

  notFound(message: string = "Resource not found") {
    throw status(404, { error: message });
  }

  alreadyExists(message: string = "Resource already exists") {
    throw status(409, { error: message });
  }

  validationError(message: string = "Validation error") {
    throw status(400, { error: message });
  }

  internal(message: string = "Internal server error") {
    throw status(500, { error: message });
  }

  databaseError(message: string = "Database error") {
    throw status(500, { error: message });
  }

  recordInUse(message: string = "Record is in use") {
    throw status(409, { error: message });
  }

  maintenance(message: string = "Service under maintenance") {
    throw status(503, { error: message });
  }

  planNotExists(message: string = "Plan does not exist") {
    throw status(400, { error: message });
  }

  planNotEnabled(message: string = "Plan is not enabled") {
    throw status(403, { error: message });
  }

  planNotActive(message: string = "Plan is not active") {
    throw status(403, { error: message });
  }
}

export default new ErrorHandler();
