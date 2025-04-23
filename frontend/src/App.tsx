/*  Admin Review UI – React  */
/*  Assumes the backend provides:
      POST /api/scores     {pw}                       -> [{ student, percent, raw_points, max_points, answers }]
      GET  /api/plan/<id>  (header X-Admin-Pass or ?pw=) -> { questions:[{type,text,weight,…}] }
      POST /api/review     {pw, student_id, overrides:[{index, points}]}  -> {ok:true}
    Adjust the endpoints to match your Flask routes.                               */

import { useEffect, useState } from "react";

export default function App() {
  // Types for diagnostics
  type Score = {
    student: string;
    percent: number;
    raw_points: number;
    max_points: number;
    answers: any[];
  };

  type PlanQuestion = {
    type: string;
    text: string;
    weight: number;
    [key: string]: any;
  };

  type Plan =
    | {
        questions: PlanQuestion[];
        error?: string;
      }
    | { error: string }
    | null;

  const [pw, setPw] = useState<string>("");
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [sel, setSel] = useState<Score | null>(null); // selected score record
  const [plan, setPlan] = useState<Plan>(null); // student's plan (questions)
  const [overrides, setOverrides] = useState<Record<number, number>>({}); // {idx: newPoints}

  /* ---------- load all scores ---------- */
  const loadScores = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pw }),
      });
      if (!res.ok) throw new Error("wrong password");
      setScores(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  /* ---------- when student selected, fetch plan ---------- */
  useEffect(() => {
    if (!sel) {
      setPlan(null);
      return;
    }
    (async () => {
      setPlan(null);
      const res = await fetch(`/api/plan/${sel.student}`, {
        headers: { "X-Admin-Pass": pw },
      });
      if (res.ok) setPlan(await res.json());
      else setPlan({ error: "Plan file not found" });
    })();
  }, [sel, pw]);

  /* ---------- change handler for manual points ---------- */
  const changePoints = (idx: number, val: string) => {
    setOverrides({ ...overrides, [idx]: Number(val) });
  };

  /* ---------- save overrides ---------- */
  const save = async () => {
    if (!sel) {
      alert("No student selected");
      return;
    }
    const arr = Object.entries(overrides).map(([index, points]) => ({
      index: Number(index),
      points: Number(points),
    }));
    if (!arr.length) {
      alert("No changes");
      return;
    }
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pw, student_id: sel.student, overrides: arr }),
    });
    if (res.ok) {
      alert("Saved");
      setOverrides({});
      loadScores();
    } else alert("Save failed");
  };

  /* ---------- render ---------- */
  return (
    <div className="p-6 font-sans">
      <h1 className="text-2xl font-bold mb-4">Admin Review</h1>

      {/* password & load */}
      {scores.length === 0 && (
        <div className="mb-4 space-x-2">
          <input
            type="password"
            placeholder="Admin password"
            className="border p-1"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            onClick={loadScores}
            className="bg-blue-600 text-white px-3 py-1 rounded"
          >
            {loading ? "Loading…" : "Load scores"}
          </button>
          {err && <span className="text-red-600 ml-3">{err}</span>}
        </div>
      )}

      {/* list of students */}
      {scores.length > 0 && (
        <div className="flex gap-6">
          <div className="w-60">
            <h2 className="font-semibold mb-2">Students</h2>
            <ul className="border rounded divide-y max-h-96 overflow-y-auto">
              {scores.map((s) => (
                <li
                  key={s.student}
                  onClick={() => {
                    setSel(s);
                    setOverrides({});
                  }}
                  className={
                    "p-2 cursor-pointer hover:bg-gray-100 " +
                    (sel?.student === s.student ? "bg-blue-50" : "")
                  }
                >
                  <div className="font-medium">{s.student}</div>
                  <div className="text-sm text-gray-600">
                    {s.raw_points}/{s.max_points} – {s.percent}%
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* detail panel */}
          {sel && (
            <div className="flex-1">
              <h2 className="font-semibold mb-2">Answers – {sel.student}</h2>
              {!plan && <p>Loading plan…</p>}
              {"error" in (plan ?? {}) && plan?.error && (
                <p className="text-red-600">{plan.error}</p>
              )}
              {"questions" in (plan ?? {}) &&
                (plan as { questions: PlanQuestion[] }).questions && (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-1 text-left">#</th>
                        <th className="p-1 text-left">Question</th>
                        <th className="p-1">Student answer</th>
                        <th className="p-1">Weight</th>
                        <th className="p-1">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(plan as { questions: PlanQuestion[] }).questions.map(
                        (q: PlanQuestion, i: number) => {
                          const weight = q.weight ?? 1;
                          const ans = sel.answers[i];
                          const isOpen = q.type === "open";
                          return (
                            <tr key={i} className="border-t">
                              <td className="p-1 align-top">{i + 1}</td>
                              <td className="p-1 align-top">{q.text}</td>
                              <td className="p-1 align-top whitespace-pre-wrap">
                                {isOpen ? ans : JSON.stringify(ans)}
                              </td>
                              <td className="p-1 text-center align-top">
                                {weight}
                              </td>
                              <td className="p-1 align-top">
                                {isOpen ? (
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max={weight}
                                    className="w-20 border p-0.5"
                                    defaultValue={weight} /* auto-full credit */
                                    onChange={(e) =>
                                      changePoints(i, e.target.value)
                                    }
                                  />
                                ) : (
                                  "auto"
                                )}
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                )}

              {/* save button */}
              {Object.keys(overrides).length > 0 && (
                <button
                  onClick={save}
                  className="mt-4 bg-green-600 text-white px-4 py-1 rounded"
                >
                  Save manual scores
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
