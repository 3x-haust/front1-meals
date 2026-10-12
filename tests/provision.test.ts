import { expect, test } from "bun:test";
import { createProvisionHandler } from "../scripts/provision-handler";

const exampleToken = `123456789:${"x".repeat(35)}`;

test("rejects an unauthenticated credential submission without storing it", async () => {
  // Given
  const stored: string[] = [];
  const handler = createProvisionHandler("test-challenge", async (value) => {
    stored.push(value);
  });
  // When
  const result = await handler(
    new Request("http://127.0.0.1/telegram", {
      method: "POST",
      body: exampleToken,
    }),
  );
  // Then
  expect(result.status).toBe(401);
  expect(stored).toEqual([]);
});

test("stores a valid token once and never returns the token", async () => {
  // Given
  const stored: string[] = [];
  const handler = createProvisionHandler("test-challenge", async (value) => {
    stored.push(value);
  });
  const request = () =>
    new Request("http://127.0.0.1/telegram", {
      method: "POST",
      headers: { Authorization: "Bearer test-challenge" },
      body: exampleToken,
    });
  // When
  const response = await handler(request());
  const duplicate = await handler(request());
  // Then
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(duplicate.status).toBe(410);
  expect(stored).toEqual([exampleToken]);
});

test("rejects malformed tokens without consuming the setup challenge", async () => {
  // Given
  const stored: string[] = [];
  const handler = createProvisionHandler("test-challenge", async (value) => {
    stored.push(value);
  });
  // When
  const response = await handler(
    new Request("http://127.0.0.1/telegram", {
      method: "POST",
      headers: { Authorization: "Bearer test-challenge" },
      body: "not-a-token",
    }),
  );
  // Then
  expect(response.status).toBe(400);
  expect(stored).toEqual([]);
});
