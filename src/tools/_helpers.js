import { ApiError } from "../client/apiClient.js";

export function jsonResult(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function errorResult(err) {
  if (err instanceof ApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `API error ${err.status} on ${err.url}\n${
            typeof err.body === "string"
              ? err.body
              : JSON.stringify(err.body, null, 2)
          }`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }],
  };
}

export function safeHandler(fn) {
  return async (args) => {
    try {
      const value = await fn(args);
      return value && value.content ? value : jsonResult(value);
    } catch (err) {
      return errorResult(err);
    }
  };
}
