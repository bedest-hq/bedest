import { status } from "elysia";

class ErrorHandler {
  badRequest(message: string = "Bad request") {
    throw status(400, message);
  }

  unauthorized(message: string = "Unauthorized") {
    throw status(401, message);
  }

  forbidden(message: string = "Forbidden") {
    throw status(403, message);
  }

  notFound(message: string = "Resource not found") {
    throw status(404, message);
  }

  alreadyExists(message: string = "Resource already exists") {
    throw status(409, message);
  }

  validationError(message: string = "Validation error") {
    throw status(400, message);
  }

  internal(message: string = "Internal server error") {
    throw status(500, message);
  }

  databaseError(message: string = "Database error") {
    throw status(500, message);
  }

  recordInUse(message: string = "Record is in use") {
    throw status(409, message);
  }

  maintenance(message: string = "Service under maintenance") {
    throw status(503, message);
  }

  planNotExists(message: string = "Plan does not exist") {
    throw status(400, message);
  }

  planNotEnabled(message: string = "Plan is not enabled") {
    throw status(403, message);
  }

  planNotActive(message: string = "Plan is not active") {
    throw status(403, message);
  }
}

export default new ErrorHandler();
