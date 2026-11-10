import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { UtilHttp } from "./UtilHttp";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamptz rendered in UTC with microseconds (see `key`).
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface ICursor {
  /** createdAt as rendered by Postgres, microsecond precision. */
  createdAt: string;
  id: string;
}

/**
 * Keyset ("cursor") pagination over (createdAt DESC, id DESC) [PERF-02].
 * The cursor is base64url("<createdAt>|<id>"); createdAt is taken from
 * Postgres as text so no microseconds are lost (a JS Date would round
 * them and skip or repeat rows).
 */
export class UtilCursor {
  /** Select this as the row's cursor key (UTC, microseconds). */
  static key(createdAt: PgColumn): SQL<string> {
    return sql<string>`to_char(${createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  }

  static encode(row: ICursor): string {
    return Buffer.from(`${row.createdAt}|${row.id}`, "utf8").toString(
      "base64url",
    );
  }

  /** Parses a client cursor; anything malformed is a 400. */
  static decode(cursor: string): ICursor {
    const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url")
      .toString("utf8")
      .split("|");
    if (
      rest.length > 0 ||
      !createdAt ||
      !id ||
      !TS_RE.test(createdAt) ||
      !UUID_RE.test(id)
    ) {
      throw UtilHttp.fail(400, "Invalid cursor");
    }
    return { createdAt, id };
  }

  /** Rows strictly after the cursor in (createdAt DESC, id DESC) order. */
  static after(createdAt: PgColumn, id: PgColumn, cursor: ICursor): SQL {
    return sql`(${createdAt}, ${id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
  }

  /**
   * Splits a `limit + 1` result of `{ row, cursorKey }` selections into the
   * page and the next cursor (null on the last page).
   */
  static page<T extends { id: string }>(
    rows: Array<{ row: T; cursorKey: string }>,
    limit: number,
  ): { data: T[]; nextCursor: string | null } {
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? UtilCursor.encode({ createdAt: last.cursorKey, id: last.row.id })
        : null;
    return { data: pageRows.map((r) => r.row), nextCursor };
  }
}
