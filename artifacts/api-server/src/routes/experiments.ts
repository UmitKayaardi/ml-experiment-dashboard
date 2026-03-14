import { Router } from "express";

const SHEET_ID = "1DG-xLRM9wnNccXowsMqlbcxbSAScQAez3FeuH1MN3xw";
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

interface GvizCol {
  label: string;
}

interface GvizCell {
  v: unknown;
  f?: string;
}

interface GvizRow {
  c: Array<GvizCell | null>;
}

interface GvizTable {
  cols: GvizCol[];
  rows: GvizRow[] | null;
}

interface GvizResponse {
  status: string;
  errors?: Array<{ message: string }>;
  table: GvizTable;
}

const router = Router();

router.get("/experiments", async (_req, res) => {
  try {
    const response = await fetch(GVIZ_URL);
    if (!response.ok) {
      res
        .status(502)
        .json({ error: `Google Sheets returned HTTP ${response.status}` });
      return;
    }

    const text = await response.text();

    let json: GvizResponse;
    try {
      json = JSON.parse(
        text.replace(/^[^(]*\(/, "").replace(/\);\s*$/, ""),
      ) as GvizResponse;
    } catch {
      res
        .status(502)
        .json({ error: "Unexpected response format from Google Sheets" });
      return;
    }

    if (json.status === "error") {
      res
        .status(502)
        .json({ error: json.errors?.[0]?.message ?? "Google Sheets API error" });
      return;
    }

    const { cols, rows } = json.table;
    const headers = cols.map((c) => c.label.toLowerCase().trim());
    const col = (name: string) => headers.indexOf(name);

    const experiments = (rows ?? []).map((row, idx) => {
      const cells = row.c ?? [];
      const val = (name: string): unknown => cells[col(name)]?.v ?? "";
      const fmt = (name: string): string =>
        String(cells[col(name)]?.f ?? cells[col(name)]?.v ?? "");

      const rawModel = String(val("model"));
      const rawDataset = String(val("dataset"));

      return {
        id: idx + 2,
        model: rawModel,
        dataset: rawDataset,
        accuracy: Number(val("accuracy")) || 0,
        notes: String(val("notes")),
        date: fmt("date") || String(val("date")),
      };
    });

    res.json(experiments);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
