"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { Modal, SelectInput } from "../client-kit";
import { formatDateTime } from "@/shared/time";

export interface AdminUserRow {
  id: string;
  login: string;
  displayName: string;
  roleCode: string;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  createdAt: string;
}

const ROLES = [
  { value: "realtor", label: "Риелтор" },
  { value: "manager", label: "Руководитель" },
];
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

interface IssuedPassword {
  login: string;
  displayName: string;
  password: string;
  reason: "created" | "reset";
}

/** Временный пароль показывается один раз: после закрытия панели его нельзя получить повторно. */
function TemporaryPasswordPanel({ issued, onDismiss }: { issued: IssuedPassword; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert alert-success mb-4 space-y-2" role="status">
      <div className="font-medium">
        {issued.reason === "created" ? "Учётная запись создана" : "Пароль сброшен"}: {issued.displayName} (логин <span className="font-mono">{issued.login}</span>)
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Временный пароль:</span>
        <code className="rounded border border-green-300 bg-white px-2 py-1 font-mono text-base tracking-wide text-slate-900 select-all">{issued.password}</code>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(issued.password);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <div className="text-xs">
        Пароль показывается только сейчас — скопируйте его и передайте сотруднику лично, не по открытым каналам. При первом входе система потребует сменить пароль.
      </div>
      <button type="button" className="btn btn-sm" onClick={onDismiss}>
        Я передал пароль — скрыть
      </button>
    </div>
  );
}

function CreateUserForm({ onCreated, onCancel }: { onCreated: (i: IssuedPassword) => void; onCancel: () => void }) {
  const [login, setLogin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleCode, setRoleCode] = useState("realtor");
  const { pending, error, run, fieldError } = useApiAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (roleCode === "manager" && !window.confirm("Создать учётную запись с ролью «Руководитель»? Она получит полный доступ, включая администрирование.")) return;
        const res = await run(() => apiCall<{ user: { login: string; displayName: string }; temporaryPassword: string }>("POST", "/api/v1/admin/users", { login, displayName, roleCode }));
        if (res) onCreated({ login: res.user.login, displayName: res.user.displayName, password: res.temporaryPassword, reason: "created" });
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Логин" required error={fieldError("login")} hint="Латиница, цифры, точка, дефис, подчёркивание; 3–50 символов">
        <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Имя сотрудника" required error={fieldError("displayName")}>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Роль" required error={fieldError("roleCode")}>
        <SelectInput value={roleCode} onChange={setRoleCode} options={ROLES} />
      </Field>
      <p className="text-xs text-slate-500">Система сгенерирует временный пароль; сотрудник сменит его при первом входе.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Создание…" : "Создать"}
        </button>
      </div>
    </form>
  );
}

function EditUserForm({ user, isSelf, onDone, onCancel }: { user: AdminUserRow; isSelf: boolean; onDone: () => void; onCancel: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [roleCode, setRoleCode] = useState(user.roleCode);
  const { pending, error, run, fieldError } = useApiAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const roleChanged = roleCode !== user.roleCode;
        if (roleChanged) {
          const msg =
            roleCode === "manager"
              ? `Повысить ${user.displayName} до руководителя? Он получит полный доступ ко всем данным и администрированию.`
              : `Понизить ${user.displayName} до риелтора? ${isSelf ? "Вы потеряете доступ к администрированию." : "Он потеряет доступ к данным других сотрудников."}`;
          if (!window.confirm(msg)) return;
        }
        const res = await run(() =>
          apiCall("PATCH", `/api/v1/admin/users/${user.id}`, {
            ...(displayName !== user.displayName ? { displayName } : {}),
            ...(roleChanged ? { roleCode } : {}),
          }),
        );
        if (res !== undefined) onDone();
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Логин">
        <input className="input" value={user.login} disabled />
      </Field>
      <Field label="Имя сотрудника" required error={fieldError("displayName")}>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Роль" error={fieldError("roleCode")} hint="Изменение роли фиксируется в журнале аудита">
        <SelectInput value={roleCode} onChange={setRoleCode} options={ROLES} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || (displayName === user.displayName && roleCode === user.roleCode)}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

/** Управление учётными записями (UC-13): создание, роль/имя, деактивация/восстановление, сброс пароля. */
export function AdminUsersPanel({ users, currentUserId, timeZone }: { users: AdminUserRow[]; currentUserId: string; timeZone: string }) {
  const router = useRouter();
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { error, run, setError } = useApiAction();

  async function toggleActive(u: AdminUserRow) {
    const isSelf = u.id === currentUserId;
    const msg = u.isActive
      ? `Деактивировать учётную запись ${u.displayName}? Все её сеансы будут завершены, вход станет невозможен. История и записи сохранятся.${isSelf ? " Это ваша учётная запись — вы будете отключены." : ""}`
      : `Восстановить учётную запись ${u.displayName}? Сотрудник снова сможет входить в систему.`;
    if (!window.confirm(msg)) return;
    setBusyId(u.id);
    const res = await run(() => apiCall("PATCH", `/api/v1/admin/users/${u.id}`, { isActive: !u.isActive }));
    setBusyId(null);
    if (res !== undefined) router.refresh();
  }

  async function resetPassword(u: AdminUserRow) {
    if (!window.confirm(`Сбросить пароль ${u.displayName}? Текущие сеансы будут завершены, сотрудник войдёт по временному паролю и сменит его.`)) return;
    setBusyId(u.id);
    const res = await run(() => apiCall<{ temporaryPassword: string }>("POST", `/api/v1/admin/users/${u.id}/reset-password`, {}));
    setBusyId(null);
    if (res) {
      setIssued({ login: u.login, displayName: u.displayName, password: res.temporaryPassword, reason: "reset" });
      router.refresh();
    }
  }

  return (
    <div>
      {issued ? <TemporaryPasswordPanel issued={issued} onDismiss={() => setIssued(null)} /> : null}
      {error ? (
        <div className="mb-3">
          <FormErrorBanner error={error} />
          <button type="button" className="btn btn-sm btn-link" onClick={() => setError(null)}>
            Скрыть сообщение
          </button>
        </div>
      ) : null}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Учётные записи · {users.length}</h2>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            + Пользователь
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Логин</th>
              <th>Роль</th>
              <th>Состояние</th>
              <th>Пароль изменён</th>
              <th>Создан</th>
              <th className="w-0" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "text-slate-400"}>
                <td className="font-medium">
                  {u.displayName}
                  {u.id === currentUserId ? <span className="ml-1 text-xs text-slate-500">(вы)</span> : null}
                </td>
                <td className="font-mono text-xs">{u.login}</td>
                <td>{roleLabel(u.roleCode)}</td>
                <td>
                  <span className={`badge ${u.isActive ? "badge-green" : "badge-gray"}`}>{u.isActive ? "Активна" : "Деактивирована"}</span>
                  {u.isActive && u.mustChangePassword ? <span className="badge badge-yellow ml-1">временный пароль</span> : null}
                </td>
                <td className="whitespace-nowrap">{u.passwordChangedAt ? formatDateTime(u.passwordChangedAt, timeZone) : "—"}</td>
                <td className="whitespace-nowrap">{formatDateTime(u.createdAt, timeZone)}</td>
                <td>
                  <div className="flex justify-end gap-1 whitespace-nowrap">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setError(null);
                        setEditing(u);
                      }}
                    >
                      Изменить
                    </button>
                    {u.isActive ? (
                      <button type="button" className="btn btn-sm" disabled={busyId === u.id} onClick={() => void resetPassword(u)}>
                        Сбросить пароль
                      </button>
                    ) : null}
                    <button type="button" className={`btn btn-sm ${u.isActive ? "btn-danger" : ""}`} disabled={busyId === u.id} onClick={() => void toggleActive(u)}>
                      {u.isActive ? "Деактивировать" : "Восстановить"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Modal open={creating} onClose={() => setCreating(false)} title="Новая учётная запись">
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onCreated={(i) => {
            setCreating(false);
            setIssued(i);
            router.refresh();
          }}
        />
      </Modal>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Изменение учётной записи">
        {editing ? (
          <EditUserForm
            user={editing}
            isSelf={editing.id === currentUserId}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
