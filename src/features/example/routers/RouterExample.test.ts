import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { testHeaders } from "@/common/tests/TestManager.test";
import { RouterExample } from "./RouterExample";

const api = treaty(RouterExample);

describe("RouterExample", () => {
  it("Create a new example", async () => {
    const headers = await testHeaders();

    const res = await api.example.post(
      {
        exampleColumn: "Example Column",
        otherExampleColumn: "Other Example Column",
      },
      { headers },
    );

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("id");
  });

  it("Get all examples", async () => {
    const headers = await testHeaders();

    await api.example.post(
      {
        exampleColumn: "Example Column",
        otherExampleColumn: "Other Example Column",
      },
      { headers },
    );

    const res = await api.example.get({
      headers,
      query: { page: 1, limit: 100 },
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual([
      {
        exampleColumn: "Example Column",
        otherExampleColumn: "Other Example Column",
      },
    ]);
  });

  it("Get example by id (GET /:id)", async () => {
    const headers = await testHeaders();

    const example = await api.example.post(
      {
        exampleColumn: "Example Column",
        otherExampleColumn: "Other Example Column",
      },
      { headers },
    );

    const res = await api.example({ id: example.data!.id }).get({
      headers,
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      exampleColumn: "Example Column",
      otherExampleColumn: "Other Example Column",
    });
  });

  it("Update example", async () => {
    const headers = await testHeaders();
    const example = await api.example.post(
      {
        exampleColumn: "Example Column",
        otherExampleColumn: "Other Example Column",
      },
      { headers },
    );

    const res = await api.example({ id: example.data!.id }).put(
      {
        exampleColumn: "Updated Example Column",
      },
      { headers },
    );

    expect(res.status).toBe(200);

    const updatedRes = await api.example({ id: example.data!.id }).get({
      headers,
    });

    expect(updatedRes.status).toBe(200);
    expect(updatedRes.data).toStrictEqual({
      exampleColumn: "Updated Example Column",
      otherExampleColumn: "Other Example Column",
    });
  });

  it("Delete example", async () => {
    const headers = await testHeaders();
    const example = await api.example.post(
      {
        exampleColumn: "Example Column",
        otherExampleColumn: "Other Example Column",
      },
      { headers },
    );

    const res = await api
      .example({ id: example.data!.id })
      .delete({}, { headers });

    expect(res.status).toBe(200);

    const checkRes = await api.example({ id: example.data!.id }).get({
      headers,
    });

    expect(checkRes.status).toBe(404);
  });

  it("Return 404 for non-existent example", async () => {
    const headers = await testHeaders();
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await api.example({ id: fakeId }).get({
      headers,
    });

    expect(res.status).toBe(404);
  });
});
