import { useState } from "react";
import type { AIApproval } from "./types";

export default function AIMcpApproval({
  request,
  busy,
  answer,
}: {
  request: AIApproval;
  busy: boolean;
  answer(
    decision: "accept" | "decline",
    content?: Record<string, unknown>,
  ): void;
}) {
  const fields = Object.entries(request.requestedSchema?.properties || {});
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields
        .filter(([, field]) => field.default !== undefined)
        .map(([key, field]) => [key, field.default]),
    ),
  );
  const [error, setError] = useState("");
  const supported =
    request.mode === "url" ||
    (request.requestedSchema?.type === "object" &&
      fields.every(
        ([, field]) =>
          ["string", "integer", "number", "boolean"].includes(field.type) ||
          (field.type === "array" &&
            !!(field.items?.enum || field.items?.anyOf)),
      ));
  return (
    <div className="ai-approval">
      <strong>{request.serverName || "Connection"} needs your input</strong>
      <p>{request.reason}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          answer("accept", request.mode === "url" ? undefined : values);
        }}
      >
        {request.mode === "url" ? (
          <>
            <p>
              Open the connection’s page and finish the requested step before
              continuing.
            </p>
            <button
              type="button"
              className="button small"
              onClick={() =>
                void window
                  .research!.openLink(request.url || "")
                  .catch((error: Error) => setError(error.message))
              }
            >
              Open connection page
            </button>
          </>
        ) : supported ? (
          fields.map(([key, field]) => {
            const required = request.requestedSchema?.required?.includes(key);
            const options =
              field.enum?.map((value, i) => ({
                value,
                label: field.enumNames?.[i] || value,
              })) ||
              field.oneOf?.map((option) => ({
                value: option.const,
                label: option.title || option.const,
              }));
            const multiple =
              field.items?.enum?.map((value) => ({ value, label: value })) ||
              field.items?.anyOf?.map((option) => ({
                value: option.const,
                label: option.title || option.const,
              }));
            const update = (value: unknown) =>
              setValues((old) => {
                const next = { ...old };
                if (value === undefined) delete next[key];
                else next[key] = value;
                return next;
              });
            return (
              <label key={key}>
                {field.title || key}
                {required ? " *" : ""}
                {field.description && <small>{field.description}</small>}
                {field.type === "boolean" ? (
                  <select
                    aria-label={field.title || key}
                    required={required}
                    value={values[key] === undefined ? "" : String(values[key])}
                    onChange={(event) =>
                      update(
                        event.target.value === ""
                          ? undefined
                          : event.target.value === "true",
                      )
                    }
                  >
                    <option value="">Choose…</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : options || multiple ? (
                  <select
                    aria-label={field.title || key}
                    required={required}
                    multiple={!!multiple}
                    value={
                      multiple
                        ? (values[key] as string[]) || []
                        : String(values[key] ?? "")
                    }
                    onChange={(event) =>
                      update(
                        multiple
                          ? Array.from(
                              event.target.selectedOptions,
                              (option) => option.value,
                            )
                          : event.target.value || undefined,
                      )
                    }
                  >
                    {!multiple && <option value="">Choose…</option>}
                    {(options || multiple)?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={field.title || key}
                    required={required}
                    type={
                      field.type === "number" || field.type === "integer"
                        ? "number"
                        : field.format === "email"
                          ? "email"
                          : "text"
                    }
                    step={field.type === "integer" ? 1 : "any"}
                    min={field.minimum}
                    max={field.maximum}
                    minLength={field.minLength}
                    maxLength={field.maxLength}
                    value={String(values[key] ?? "")}
                    onChange={(event) =>
                      update(
                        event.target.value === ""
                          ? undefined
                          : field.type === "number" || field.type === "integer"
                            ? Number(event.target.value)
                            : event.target.value,
                      )
                    }
                  />
                )}
              </label>
            );
          })
        ) : (
          <p>
            This connection requested an unsupported form. Decline it to let the
            agent continue.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="ai-approval-actions">
          {supported && (
            <button className="button primary small" disabled={busy}>
              Continue
            </button>
          )}
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => answer("decline")}
          >
            Decline
          </button>
        </div>
      </form>
    </div>
  );
}
