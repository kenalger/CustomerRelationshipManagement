import { describe, expect, it } from "vitest";

import { isAllowedRedirectHost, parseSheetUrl } from "@/lib/google-sheet-url";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

describe("parseSheetUrl", () => {
  it("builds the CSV export for a normal sheet link", () => {
    const result = parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ref.sheetId).toBe(ID);
    expect(result.ref.gid).toBe("0");
    expect(result.ref.exportUrl).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=0`,
    );
  });

  it("works without a gid", () => {
    const result = parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(result.ok && result.ref.gid).toBeNull();
    expect(result.ok && result.ref.exportUrl).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`,
    );
  });

  it("reads a gid from the query as well as the fragment", () => {
    const result = parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=1234567`);
    expect(result.ok && result.ref.gid).toBe("1234567");
  });

  describe("the SSRF surface", () => {
    /*
     * The server fetches whatever this returns, so these are the tests that
     * matter most. Every one of them is an attempt to make the server issue a
     * request somewhere we did not intend.
     */
    it("refuses any host but docs.google.com", () => {
      for (const url of [
        "https://evil.test/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaa/edit",
        "https://docs.google.com.evil.test/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaa/edit",
        "https://localhost/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaa/edit",
        "https://169.254.169.254/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaa/edit",
      ]) {
        const result = parseSheetUrl(url);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("wrong-host");
      }
    });

    it("refuses a non-https scheme", () => {
      expect(parseSheetUrl(`http://docs.google.com/spreadsheets/d/${ID}/edit`).ok).toBe(false);
      expect(parseSheetUrl(`file:///etc/passwd`).ok).toBe(false);
      expect(parseSheetUrl(`javascript:alert(1)`).ok).toBe(false);
    });

    it("refuses a Google URL that is not a spreadsheet", () => {
      const result = parseSheetUrl("https://docs.google.com/document/d/abc/edit");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not-a-sheet");
    });

    it("cannot be made to reach a different path through the id", () => {
      // A traversal or a query smuggled into the id position must fail the id
      // pattern, not be interpolated into the URL the server fetches.
      for (const bad of [
        "https://docs.google.com/spreadsheets/d/../../../admin/edit",
        "https://docs.google.com/spreadsheets/d/abc%2F..%2Fadmin/edit",
        "https://docs.google.com/spreadsheets/d/short/edit",
      ]) {
        expect(parseSheetUrl(bad).ok).toBe(false);
      }
    });

    it("builds the export URL rather than trusting the caller's", () => {
      // The caller asked for a TSV of a different document; what comes back is
      // a CSV export of the id we parsed, with no other parameters carried.
      const result = parseSheetUrl(
        `https://docs.google.com/spreadsheets/d/${ID}/export?format=tsv&range=A1&foo=bar`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.ref.exportUrl).toBe(
        `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`,
      );
      expect(result.ref.exportUrl).not.toContain("tsv");
      expect(result.ref.exportUrl).not.toContain("foo");
    });
  });

  describe("published-to-web links", () => {
    const TOKEN = "2PACX-1vQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

    it("accepts a CSV publish", () => {
      const result = parseSheetUrl(
        `https://docs.google.com/spreadsheets/d/e/${TOKEN}/pub?output=csv`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.ref.exportUrl).toContain("/pub?output=csv");
    });

    it("refuses an HTML publish with an actionable reason", () => {
      // Fetching this would return a web page and the parser would report one
      // enormous column — a confusing failure three steps later.
      const result = parseSheetUrl(
        `https://docs.google.com/spreadsheets/d/e/${TOKEN}/pubhtml?gid=0&single=true`,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("published-html");
    });
  });

  describe("redirect hosts", () => {
    /*
     * A shared sheet answers 307 and points at a one-time
     * googleusercontent.com URL, so the fetcher must follow that hop — and
     * must not follow any other. Verified against a real public sheet: with
     * redirects refused, every correctly shared sheet reported "not shared".
     */
    it("allows Google's export delivery hosts", () => {
      expect(isAllowedRedirectHost("doc-08-4o-sheets.googleusercontent.com")).toBe(true);
      expect(isAllowedRedirectHost("googleusercontent.com")).toBe(true);
      expect(isAllowedRedirectHost("docs.google.com")).toBe(true);
    });

    it("refuses anything else, including lookalikes", () => {
      for (const host of [
        "evil.test",
        "googleusercontent.com.evil.test",
        "notgoogleusercontent.com",
        "localhost",
        "169.254.169.254",
        "accounts.google.com",
      ]) {
        expect(isAllowedRedirectHost(host)).toBe(false);
      }
    });
  });

  it("rejects nonsense without throwing", () => {
    for (const junk of ["", "   ", "not a url", "spreadsheets/d/abc"]) {
      const result = parseSheetUrl(junk);
      expect(result.ok).toBe(false);
    }
  });
});
