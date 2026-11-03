/** Минимальная политика паролей для локальных учётных записей. */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordPolicyErrors(password: string, login?: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) errors.push(`Не короче ${PASSWORD_MIN_LENGTH} символов`);
  if (password.length > 200) errors.push("Не длиннее 200 символов");
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) errors.push("Должен содержать буквы и цифры");
  if (login && password.toLowerCase().includes(login.toLowerCase())) errors.push("Не должен содержать логин");
  return errors;
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export const LOGIN_RE = /^[a-z0-9._-]{3,50}$/;
