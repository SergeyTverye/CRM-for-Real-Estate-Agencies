/**
 * Единая модель ошибок (ТЗ 20.2, 32.1).
 * Ошибки валидации, аутентификации, авторизации, отсутствия, конфликта,
 * нарушения бизнес-инварианта и инфраструктуры различаются внутри приложения.
 * Внешний ответ не раскрывает сведений о недоступных объектах и stack trace.
 */

export type FieldErrors = Record<string, string[]>;

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";
  constructor(
    message = "Проверьте правильность заполнения полей",
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
  }
  override toJSON() {
    return { ...super.toJSON(), fieldErrors: this.fieldErrors };
  }
}

export class AuthenticationError extends AppError {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";
  constructor(message = "Требуется вход в систему") {
    super(message);
  }
}

/** Неверный логин/пароль: одинаковое сообщение для любого логина (не раскрывает его существование). */
export class InvalidCredentialsError extends AppError {
  readonly status = 401;
  readonly code = "INVALID_CREDENTIALS";
  constructor(message = "Неверный логин или пароль") {
    super(message);
  }
}

export class PasswordChangeRequiredError extends AppError {
  readonly status = 403;
  readonly code = "PASSWORD_CHANGE_REQUIRED";
  constructor(message = "Необходимо сменить временный пароль") {
    super(message);
  }
}

/** Отказ по роли/функции. Для конкретных записей используется NotFoundError, чтобы не раскрывать их существование. */
export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor(message = "Недостаточно прав для выполнения операции") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "NOT_FOUND";
  constructor(message = "Запись не найдена или недоступна") {
    super(message);
  }
}

/** Optimistic concurrency: запись изменена другим пользователем после открытия формы. */
export class StaleUpdateError extends AppError {
  readonly status = 409;
  readonly code = "STALE_UPDATE";
  constructor(message = "Запись была изменена другим пользователем. Обновите данные и повторите изменение.") {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code: string;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

/** Нарушение бизнес-инварианта (например, active ClientNeed без следующего действия). */
export class DomainError extends AppError {
  readonly status = 422;
  readonly code: string;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

export class RateLimitError extends AppError {
  readonly status = 429;
  readonly code = "RATE_LIMITED";
  constructor(message = "Слишком много попыток. Повторите позже.") {
    super(message);
  }
}

export class ReadOnlyInstanceError extends AppError {
  readonly status = 503;
  readonly code = "INSTANCE_READ_ONLY";
  constructor(message = "Экземпляр работает в режиме standby (только чтение). Изменения запрещены до promote.") {
    super(message);
  }
}

export class InfrastructureError extends AppError {
  readonly status = 503;
  readonly code = "INFRASTRUCTURE_ERROR";
  constructor(message = "Временная техническая ошибка. Повторите попытку позже.") {
    super(message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
