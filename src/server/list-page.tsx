import "server-only";
import Link from "next/link";
import { ValidationError } from "@/shared/errors";

/** Выполняет загрузку списка. некорректные параметры фильтра показываются понятным сообщением. */
export async function loadList<T>(fn: () => Promise<T>, resetHref: string): Promise<{ data: T; error: null } | { data: null; error: React.ReactNode }> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    if (e instanceof ValidationError) {
      return {
        data: null,
        error: (
          <div className="alert alert-warning">
            Некорректные параметры фильтра. <Link className="link" href={resetHref}>Сбросить фильтры</Link>
          </div>
        ),
      };
    }
    throw e;
  }
}
