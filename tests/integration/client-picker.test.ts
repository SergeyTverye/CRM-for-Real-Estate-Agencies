import { beforeEach, expect, it } from "vitest";
import { resetDatabase, seedBase, makeClient, apiRequest, sessionCookieFor, routeParams } from "../helpers/fixtures";
import { GET } from "@/app/api/v1/clients/pick/route";
import { pickClients } from "@/modules/clients/application/client-queries";

beforeEach(resetDatabase);
it("bounds query and result size while preserving client visibility", async () => {
  const users = await seedBase();
  for (let i = 0; i < 22; i++) await makeClient(users.realtor1, { displayName: `Picker ${i}` });
  const hidden = await makeClient(users.realtor2, { displayName: "Picker hidden" });
  const cookie = await sessionCookieFor(users.realtor1);
  const request = (q: string) => GET(apiRequest("GET", `/api/v1/clients/pick?q=${q}&take=10000`, { cookie }), routeParams({}));
  expect((await request("x".repeat(121))).status).toBe(400);
  expect((await request("x".repeat(120))).status).toBe(200);
  const response = await request("Picker");
  expect(response.status).toBe(200);
  const { items } = await response.json();
  expect(items).toHaveLength(20);
  expect(items.some((item: { id: string }) => item.id === hidden.id)).toBe(false);
  await expect(pickClients(users.realtor1, "", 21)).rejects.toThrow();
});
