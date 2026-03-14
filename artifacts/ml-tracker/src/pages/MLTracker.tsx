import { useEffect, useRef, useState, useCallback } from "react";
import Chart from "chart.js/auto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Experiment {
  id?: string | number;
  model: string;
  dataset: string;

  modelNorm: string; // Added by manually
  datasetNorm: string; // Added by manually

  accuracy: number;
  notes: string;
  date: string;
}

// ─── Date fixer — converts Excel serial dates to ISO strings ─────────────────

function fixDate(d: string): string {
  const n = Number(d);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const fixed = new Date(excelEpoch.getTime() + n * 86400000);
    return fixed.toISOString().split("T")[0];
  }
  return d;
}

// ─── Data source configuration ────────────────────────────────────────────────

// All reads go through the api-server (/api/experiments), which fetches from
// Google Sheets server-to-server — no browser session cookies involved, so
// every user always receives the same shared dataset regardless of which
// Google account they are logged into in their browser.
const EXPERIMENTS_URL = "/api/experiments";

// Write/delete: Google Apps Script Web App URL.
// Deploy google-apps-script.js as a Web App in your Google Sheet
// (Extensions → Apps Script → Deploy → New deployment → Web App)
// then paste the URL here:
const APPS_SCRIPT_URL = "";

// ─── API helpers ──────────────────────────────────────────────────────────────

interface RawExperiment {
  id: number;
  model: string;
  dataset: string;
  accuracy: number;
  notes: string;
  date: string;
}

async function fetchExperiments(): Promise<Experiment[]> {
  const res = await fetch(EXPERIMENTS_URL);
  if (!res.ok) {
    let msg = `Failed to fetch experiments (HTTP ${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson.error) msg = errJson.error;
    } catch {}
    throw new Error(msg);
  }

  const rows = (await res.json()) as RawExperiment[];

  return rows.map((row) => {
    const rawModel = String(row.model ?? "");
    const rawDataset = String(row.dataset ?? "");
    return {
      id: row.id,
      model: rawModel,
      dataset: rawDataset,
      modelNorm: rawModel.trim().toLowerCase(),
      datasetNorm: rawDataset.trim().toLowerCase(),
      accuracy: Number(row.accuracy) || 0,
      notes: String(row.notes ?? ""),
      date: String(row.date ?? ""),
    };
  });
}

async function addExperiment(exp: Omit<Experiment, "id">): Promise<void> {
  if (!APPS_SCRIPT_URL) {
    throw new Error(
      "Write operations require a Google Apps Script Web App. " +
        "Deploy google-apps-script.js and set APPS_SCRIPT_URL in MLTracker.tsx.",
    );
  }
  const { model, dataset, accuracy, notes, date } = exp;
  const params = new URLSearchParams({
    action: "add",
    model,
    dataset,
    accuracy: String(accuracy),
    notes,
    date,
  });
  const res = await fetch(`${APPS_SCRIPT_URL}?${params}`);
  if (!res.ok) throw new Error("Failed to add experiment");
}

async function deleteExperiment(id: string | number): Promise<void> {
  if (!APPS_SCRIPT_URL) {
    throw new Error(
      "Write operations require a Google Apps Script Web App. " +
        "Deploy google-apps-script.js and set APPS_SCRIPT_URL in MLTracker.tsx.",
    );
  }
  const params = new URLSearchParams({
    action: "delete",
    rowIndex: String(id),
  });
  const res = await fetch(`${APPS_SCRIPT_URL}?${params}`);
  if (!res.ok) throw new Error("Failed to delete experiment");
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function computeStats(data: Experiment[]) {
  if (data.length === 0)
    return { total: 0, best: null as number | null, datasets: 0 };
  const best = Math.max(...data.map((e) => e.accuracy));
  const uniqueDatasets = new Set(data.map((e) => e.dataset.trim())).size;

  return { total: data.length, best, datasets: uniqueDatasets };
}

// ─── Highlight helper ─────────────────────────────────────────────────────────

function getRowHighlight(
  accuracy: number,
  topThree: number[],
): React.CSSProperties {
  if (topThree[0] !== undefined && accuracy === topThree[0])
    return { backgroundColor: "#2ecc71", color: "#fff" };
  if (topThree[1] !== undefined && accuracy === topThree[1])
    return { backgroundColor: "#58d68d", color: "#fff" };
  if (topThree[2] !== undefined && accuracy === topThree[2])
    return { backgroundColor: "#abebc6", color: "#333" };
  return {};
}

// ─── Autocomplete input component ─────────────────────────────────────────────

interface AutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder: string;
  required?: boolean;
}

function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  required,
}: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Deduplicate and trim original values, then filter by current input
  const uniqueSuggestions = Array.from(
    new Set(suggestions.map((s) => s.trim())),
  ).filter(Boolean);

  const filtered = uniqueSuggestions.filter(
    (s) => s.toLowerCase().includes(value.toLowerCase()) && s !== value.trim(),
  );

  // Close dropdown when clicking outside the component entirely
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="autocomplete-wrap" ref={wrapRef}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="autocomplete-list">
          {filtered.map((s) => (
            <li
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setOpen(false);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MLTracker() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("ml-tracker-theme") === "dark";
  });
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  const [form, setForm] = useState({
    model: "",
    dataset: "",
    accuracy: "",
    notes: "",
    date: "",
  });

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  // ── Dark mode persistence ──────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("ml-tracker-theme", darkMode ? "dark" : "light");
    document.documentElement.setAttribute(
      "data-theme",
      darkMode ? "dark" : "light",
    );
  }, [darkMode]);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExperiments();
      setExperiments(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Validate filter states whenever experiments change ─────────────────────
  // If a selected filter value no longer exists in the data (e.g. after deletion),
  // reset it to "all"/empty so the <select> never shows a blank/mismatched entry.
  useEffect(() => {
    if (experiments.length === 0) return;

    const datasetSet = new Set(
      experiments.map((e) => e.datasetNorm).filter(Boolean),
    );
    const modelSet = new Set(
      experiments.map((e) => e.modelNorm).filter(Boolean),
    );
    const dateSet = new Set(
      experiments.map((e) => fixDate(e.date)).filter(Boolean),
    );

    if (filter !== "all" && !datasetSet.has(filter)) setFilter("all");
    if (modelFilter !== "all" && !modelSet.has(modelFilter))
      setModelFilter("all");
    if (dateFilter !== "" && !dateSet.has(dateFilter)) setDateFilter("");
  }, [experiments, filter, modelFilter, dateFilter]);

  // ── Derived data ───────────────────────────────────────────────────────────

  // Each filter is independent — applied on top of each other but not reset by siblings

  // 1. Filter by dataset (compare normalized values)
  const byDataset =
    filter === "all"
      ? experiments
      : experiments.filter((e) => e.datasetNorm === filter);

  // 2. Filter by model (compare normalized values)
  const byModel =
    modelFilter === "all"
      ? byDataset
      : byDataset.filter((e) => e.modelNorm === modelFilter);

  // 3. Filter by exact date (independent)
  const byDate = dateFilter.trim()
    ? byModel.filter((e) => fixDate(e.date) === dateFilter)
    : byModel;

  // 4. Filter by search query (model, dataset, notes, date)
  const searchLower = search.toLowerCase();
  const filtered = search.trim()
    ? byDate.filter(
        (e) =>
          e.model.toLowerCase().includes(searchLower) ||
          e.dataset.toLowerCase().includes(searchLower) ||
          e.notes.toLowerCase().includes(searchLower) ||
          fixDate(e.date).toLowerCase().includes(searchLower),
      )
    : byDate;

  // 5. Sort by accuracy descending for the table
  const sorted = [...filtered].sort((a, b) => b.accuracy - a.accuracy);

  // 6. Chart data: sort by date for the time-series chart
  const chartSorted = [...filtered].sort((a, b) => {
    const da = new Date(fixDate(a.date)).getTime() || 0;
    const db = new Date(fixDate(b.date)).getTime() || 0;
    return da - db;
  });

  // Unique normalized values for filter dropdowns
  const uniqueDatasets = Array.from(
    new Set(experiments.map((e) => e.datasetNorm)),
  ).filter(Boolean);

  const uniqueModels = Array.from(
    new Set(experiments.map((e) => e.modelNorm)),
  ).filter(Boolean);

  // Unique original-cased values for autocomplete suggestions in the form
  const autocompleteModels = Array.from(
    new Set(experiments.map((e) => e.model)),
  ).filter(Boolean);

  const autocompleteDatasets = Array.from(
    new Set(experiments.map((e) => e.dataset)),
  ).filter(Boolean);

  const uniqueDates = Array.from(
    new Set(experiments.map((e) => fixDate(e.date))),
  )
    .filter(Boolean)
    .sort();

  const stats = computeStats(filtered);

  const sortedByAcc = [...filtered]
    .map((e) => e.accuracy)
    .sort((a, b) => b - a);
  const topThree = [...new Set(sortedByAcc)].slice(0, 3);

  // ── Chart — always destroy and recreate to avoid stale canvas refs ─────────
  useEffect(() => {
    if (!chartRef.current) return;

    // Always destroy stale instance first
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    const labels = chartSorted.map((e) => fixDate(e.date));
    const values = chartSorted.map((e) => e.accuracy);

    const gridColor = darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
    const tickColor = darkMode ? "#aaa" : "#555";

    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Accuracy",
            data: values,
            borderColor: "#27ae60",
            backgroundColor: "rgba(39,174,96,0.12)",
            tension: 0.3,
            pointBackgroundColor: "#2ecc71",
            pointRadius: 5,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => ` Accuracy: ${ctx.parsed.y}` },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, maxRotation: 45 },
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor },
            beginAtZero: false,
          },
        },
      },
    });

    return () => {
      chartInstance.current?.destroy();
      chartInstance.current = null;
    };
  }, [chartSorted, darkMode]);

  // ── Form submit ────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const newExp: Experiment = {
        model: form.model,
        dataset: form.dataset,
        modelNorm: form.model.trim().toLowerCase(),
        datasetNorm: form.dataset.trim().toLowerCase(),
        accuracy: Number(form.accuracy),
        notes: form.notes,
        date: form.date,
      };
      await addExperiment(newExp);
      setExperiments((prev) => [...prev, newExp]);
      setForm({ model: "", dataset: "", accuracy: "", notes: "", date: "" });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete handler ─────────────────────────────────────────────────────────
  const handleDelete = async (exp: Experiment, idx: number) => {
    const key = exp.id ?? idx;
    setDeletingId(key);
    try {
      await deleteExperiment(exp.id !== undefined ? exp.id : key);
      setExperiments((prev) =>
        exp.id !== undefined
          ? prev.filter((e) => e.id !== exp.id)
          : prev.filter((e) => e !== exp),
      );
    } catch {
      setExperiments((prev) =>
        exp.id !== undefined
          ? prev.filter((e) => e.id !== exp.id)
          : prev.filter((e) => e !== exp),
      );
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`ml-tracker${darkMode ? " dark" : ""}`}>
      {/* Header */}
      <header className="tracker-header">
        <div className="header-inner">
          <span className="header-icon">🧪</span>
          <h1>ML Experiment Tracker</h1>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setDarkMode((d) => !d)}
          aria-label="Toggle dark mode"
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? "☀️ Light" : "🌙 Dark"}
        </button>
      </header>

      <main className="tracker-main">
        {/* Left: Form */}
        <aside className="tracker-sidebar">
          <div className="card">
            <h2 className="card-title">Add Experiment</h2>
            <form onSubmit={handleSubmit} className="exp-form">
              <label>
                Model
                <AutocompleteInput
                  value={form.model}
                  onChange={(v) => setForm({ ...form, model: v })}
                  suggestions={autocompleteModels}
                  placeholder="e.g. ResNet-50"
                  required
                />
              </label>
              <label>
                Dataset
                <AutocompleteInput
                  value={form.dataset}
                  onChange={(v) => setForm({ ...form, dataset: v })}
                  suggestions={autocompleteDatasets}
                  placeholder="e.g. CIFAR-10"
                  required
                />
              </label>
              <label>
                Accuracy
                <input
                  type="number"
                  placeholder="e.g. 0.945"
                  step="any"
                  min="0"
                  value={form.accuracy}
                  onChange={(e) =>
                    setForm({ ...form, accuracy: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                Notes
                <textarea
                  placeholder="Optional notes..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </label>

              {error && <p className="msg msg-error">{error}</p>}
              {success && <p className="msg msg-success">Experiment added!</p>}

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Add Experiment"}
              </button>
            </form>
          </div>
        </aside>

        {/* Right: Stats + Filter + Table + Chart */}
        <section className="tracker-content">
          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Total Experiments</span>
              <span className="stat-value">{stats.total}</span>
            </div>
            <div className="stat-card stat-card-best">
              <span className="stat-label">Best Accuracy</span>
              <span className="stat-value stat-best">
                {stats.best !== null ? stats.best : "—"}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Unique Datasets</span>
              <span className="stat-value">{stats.datasets}</span>
            </div>
          </div>

          {/* Filter + Search bar */}
          <div className="filter-bar">
            <label htmlFor="dataset-filter" className="filter-label">
              Dataset:
            </label>
            <select
              id="dataset-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Datasets</option>
              {uniqueDatasets.map((ds) => (
                <option key={ds} value={ds}>
                  {experiments.find((e) => e.datasetNorm === ds)?.dataset}
                </option>
              ))}
            </select>

            <label htmlFor="model-filter" className="filter-label">
              Model:
            </label>
            <select
              id="model-filter"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Models</option>
              {uniqueModels.map((m) => (
                <option key={m} value={m}>
                  {experiments.find((e) => e.modelNorm === m)?.model}
                </option>
              ))}
            </select>

            <label htmlFor="date-filter" className="filter-label">
              Date:
            </label>
            <select
              id="date-filter"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="filter-select"
            >
              <option value="">All Dates</option>
              {uniqueDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <input
              type="search"
              className="search-input"
              placeholder="Search model, dataset, notes, date…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Table */}
          <div className="card table-card">
            <h2 className="card-title">
              Experiments
              {search && (
                <span className="result-count">
                  {" "}
                  — {sorted.length} result{sorted.length !== 1 ? "s" : ""}
                </span>
              )}
            </h2>
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : error && experiments.length === 0 ? (
              <p className="msg msg-error">{error}</p>
            ) : sorted.length === 0 ? (
              <p className="empty-text">
                {search
                  ? "No experiments match your search."
                  : "No experiments yet. Add one!"}
              </p>
            ) : (
              <div className="table-wrapper">
                <table className="exp-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Dataset</th>
                      <th>Accuracy</th>
                      <th>Notes</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((exp, idx) => {
                      const highlight = getRowHighlight(exp.accuracy, topThree);
                      const key = exp.id ?? idx;
                      const isDeleting = deletingId === key;
                      return (
                        <tr key={key} style={highlight}>
                          <td>{exp.model}</td>
                          <td>{exp.dataset}</td>
                          <td className="acc-cell">{exp.accuracy}</td>
                          <td className="notes-cell">{exp.notes}</td>
                          <td>{fixDate(exp.date)}</td>
                          <td className="delete-cell">
                            <button
                              className="btn-delete"
                              onClick={() => handleDelete(exp, idx)}
                              disabled={isDeleting}
                              title="Delete experiment"
                              aria-label="Delete"
                            >
                              {isDeleting ? "…" : "🗑"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="card chart-card">
            <h2 className="card-title">Accuracy Over Time</h2>
            <div className="chart-wrapper">
              <canvas ref={chartRef} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
