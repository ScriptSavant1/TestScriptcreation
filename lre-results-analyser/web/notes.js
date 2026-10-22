/**
 * notes.js — plain-English explanations shown on every panel of the Results Analyser page.
 * Each entry: icon (see ICONS), what (one sentence: what the panel shows) and read (how to
 * read it — short tips for non-technical readers). Edit the wording here; nothing else changes.
 */
(function (root) {
  "use strict";

  /** Small monochrome icons (inherit the text colour). */
  const ICONS = {
    line: '<path d="M3 17l5-6 4 3 5-7 4 4"/><path d="M3 21h18"/>',
    bar: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M21.5 20c-.5-2.5-2-4.3-4-5"/>',
    heat: '<rect x="3" y="3" width="5" height="5"/><rect x="10" y="3" width="5" height="5"/><rect x="17" y="3" width="4" height="5"/><rect x="3" y="10" width="5" height="5"/><rect x="10" y="10" width="5" height="5"/><rect x="3" y="17" width="5" height="4"/>',
    gauge: '<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/>',
    scatter: '<path d="M3 21h18M3 21V3"/><circle cx="8" cy="15" r="1.2"/><circle cx="12" cy="11" r="1.2"/><circle cx="16" cy="12" r="1.2"/><circle cx="18" cy="6" r="1.2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  };
  const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;

  const NOTES = {
    // ── Overview ──
    load: {
      icon: "line",
      what: "How many virtual users (VUsers) were running, how many transactions finished per second, and when errors happened — across the whole test.",
      read: [
        "Blue = running VUsers. The flat top is the steady state — the shaded period the results are based on.",
        "Orange = transactions completed per second (throughput). It should stay level while the number of VUsers is level.",
        "Red bars = errors. Check whether they line up with dips or spikes in throughput.",
        "Drag the slider under the chart, or scroll inside it, to zoom into a period.",
      ],
    },
    slowest: {
      icon: "bar",
      what: "The transactions with the highest 90th-percentile (P90) response time: 90 % of their executions were this fast or faster.",
      read: [
        "The bar compares each transaction with the slowest one. A red bar means it missed its SLA.",
        "P90 is what most teams use for SLAs — it ignores the rare worst 10 %, but is stricter than the average.",
        "Click a transaction to see how it behaved over time and how its response times are spread.",
      ],
    },
    findings: {
      icon: "bulb",
      what: "Automatic checks on the results — slow-downs over time, sudden changes, spikes, errors, load-generator problems and SLA results.",
      read: [
        "High = should be understood before sign-off. Medium = worth investigating. Good = checked and fine.",
        "“Show chart” opens the chart that shows the evidence.",
        "The Insights tab lists every check, including the ones that passed.",
      ],
    },
    stats: {
      icon: "gauge",
      what: "How much traffic the test sent to the application: HTTP requests (hits) and the data that came back (throughput) — the same figures LoadRunner Analysis shows on its summary page.",
      read: [
        "Hits = HTTP requests, including pages, API calls, images and scripts. One transaction (e.g. Login) usually makes several, so hits per second is higher than transactions per second.",
        "Throughput = data received from the application. A drop while the number of VUsers stays level usually means the application slowed down or returned errors.",
        "Peak = the busiest moment of the test.",
      ],
    },
    details: {
      icon: "info",
      what: "How the test was set up: the scenario, how VUsers were started and stopped (planned and what actually happened), and the machines used.",
      read: [
        "If “Actual” differs from “Planned” — for example a shorter steady state — the test did not run fully as designed.",
        "“Stopped early” counts VUsers that stopped before the ramp-down, usually because the script stops a VUser when it hits an error.",
        "Load generators are the machines that run the VUsers. High CPU on them (above about 85 %) can make response times look worse than they really are.",
      ],
    },

    // ── Transactions ──
    txTable: {
      icon: "table",
      what: "Every transaction, grouped by script: how many times it ran, how many failed, and how fast it was (in seconds).",
      read: [
        "Steady state = only the period when all VUsers were running (recommended for results). Full run = the whole test, including ramp-up and ramp-down.",
        "Avg = average. P90 / P95 / P99 = 90 % / 95 % / 99 % of executions were this fast or faster. Max = the single slowest execution.",
        "Std dev = how much response times vary: small means consistent, large means erratic.",
        "Type an SLA (seconds) in a row to check it against the P90 (or the percentile chosen in settings). Hover over a column title for its meaning.",
        "Click a row for its charts. Click a column title to sort.",
      ],
    },

    // ── Charts ──
    rtOverTime: {
      icon: "line",
      what: "Response time of the selected transactions over the course of the test.",
      read: [
        "Each point is one time slot (the slot size is shown in the settings line at the top). Pick the measure with the buttons: Avg, P50 … Max.",
        "A line that keeps rising during the steady state suggests the system is slowing down (for example a memory or connection leak).",
        "A sudden jump that stays shows when something changed. A short peak is a spike — compare with the errors and load charts at the same time.",
      ],
    },
    throughput: {
      icon: "bar",
      what: "How many times per second each selected transaction completed.",
      read: [
        "During the steady state each line should stay roughly level.",
        "A drop while the VUsers stay the same usually means responses became slower or requests failed.",
      ],
    },
    latencyHeat: {
      icon: "heat",
      what: "Every execution placed by time (across) and response time (up); colour shows how many executions fell in each cell.",
      read: [
        "One bright horizontal band = consistent response times. Two bands = two different behaviours (for example cached and not cached).",
        "Cells scattered high up are slow outliers — useful to see when they happened.",
        "Unlike the averages, nothing is hidden here: every single execution counts.",
      ],
    },
    tpsVsRt: {
      icon: "scatter",
      what: "Each dot is one time slot: how much work was done (throughput, across) against how fast it was (P90 response time, up).",
      read: [
        "Dots in a flat cloud = the system handled the load comfortably.",
        "Dots that rise steeply on the right = response times grow as throughput grows: the system is near its limit (saturation point).",
        "Darker dots had more VUsers running.",
      ],
    },
    errors: {
      icon: "alert",
      what: "When errors happened during the test, coloured by error type, with the overall P90 response time as a grey line.",
      read: [
        "A burst of errors at one moment often has a single cause (a deployment, a service restart, a timeout).",
        "Errors that grow with load suggest a capacity limit.",
        "If response times rise at the same moment, the errors and the slowness are probably related.",
      ],
    },
    httpCodes: {
      icon: "globe",
      what: "HTTP responses per second, by status code (200 = OK, 3xx = redirect, 4xx = client error, 5xx = server error).",
      read: [
        "Most traffic should be 200 (or 204 / 302, depending on the application).",
        "Any 5xx line means the server failed requests; 4xx often means a script or data problem (for example expired sessions or missing data).",
      ],
    },
    bytes: {
      icon: "globe",
      what: "How much data per second the VUsers received from the application.",
      read: [
        "Should follow the load: level during the steady state.",
        "A drop while VUsers are steady can mean failed or empty responses; a rise can mean larger pages or reports being returned.",
      ],
    },
    lgHealth: {
      icon: "cpu",
      what: "CPU and memory use of the load generators — the machines that ran the virtual users.",
      read: [
        "Above about 80–85 % CPU (dotted lines) the load generator itself becomes a bottleneck, and response times measured on it look worse than they are.",
        "Memory that keeps growing during the test can make a long test fail later on.",
        "This is about the test machines, not the application being tested.",
      ],
    },
    rtPerLg: {
      icon: "server",
      what: "The P90 response time of each transaction, measured separately on each load generator.",
      read: [
        "Bars of similar height = the load generators agree, so the results reflect the application.",
        "If one load generator is slower on most transactions, look at that machine (CPU, network route, proxy) before blaming the application.",
      ],
    },
    vuserHeat: {
      icon: "users",
      what: "Average response time of each virtual user over time — one row per VUser, colour = how slow.",
      read: [
        "A whole column turning warm = everyone was slow at that moment (a system-wide issue).",
        "A single row turning warm = only one VUser was affected (its data, its session or its load generator).",
      ],
    },

    // ── Transaction drawer ──
    txTime: {
      icon: "line",
      what: "How this transaction's response time changed during the test: average, P90, P95 and the slowest execution in each time slot.",
      read: [
        "The gap between the average and P90/P95 shows how uneven the response times are.",
        "Isolated red peaks (Max) are single slow executions; a rise of all lines together is a real slow-down.",
      ],
    },
    dist: {
      icon: "bar",
      what: "How the response times of this transaction are spread — how many executions took how long.",
      read: [
        "Most bars should sit in one group on the left. A long tail to the right = occasional slow executions.",
        "The orange line is the running percentage: where it reaches 90 is the P90.",
        "Two separate groups of bars mean two different behaviours (for example with and without a cache).",
      ],
    },
    lg: {
      icon: "server",
      what: "This transaction's figures measured separately on each load generator.",
      read: ["If one load generator is clearly slower, the difference may come from that machine or its network route, not from the application."],
    },

    // ── Errors ──
    errGroups: {
      icon: "alert",
      what: "All errors logged during the test, grouped by error code, script line and message so that the same problem appears once.",
      read: [
        "Count = how many times it happened. VUsers = how many virtual users hit it (one VUser repeating it is often a data problem; many VUsers point to the application).",
        "The message shown is a real example, including the script line (e.g. Action.c(230)). Errors that differ only in IDs or numbers are counted together — hover over a message to see its general form.",
        "First / Last show when it started and stopped (local time).",
      ],
    },
    errLog: {
      icon: "list",
      what: "Every individual error, in time order. Use the search box to find a code, message, VUser or load generator.",
      read: ["Useful to see exactly what a VUser was doing when it failed, and in which iteration."],
    },

    // ── Workload ──
    wlScripts: {
      icon: "users",
      what: "The workload design and how well it was delivered: for each script, its VUsers, where they ran, how often each VUser started a new iteration (pacing), the waits inside the script (think time), and the iterations planned against those achieved.",
      read: [
        "Iterations planned = what the pacing should have produced for the time each VUser ran; achieved = what really ran.",
        "Achieved well below 100 % means iterations took longer than the pacing allows — the intended load was not reached for that script.",
        "Achieved well above 100 % usually means the pacing setting differs from what the VUsers really used (check the script's run-time settings).",
      ],
    },
    wlLgs: {
      icon: "server",
      what: "The machines used for the test: how many VUsers and scripts each one ran, and how busy it was (peak CPU and memory).",
      read: [
        "Peak CPU or memory above about 85 % means the machine itself may have slowed the test down — the response times on it are less reliable.",
        "The Controller runs the test but no VUsers. Open a row's script list to see which scripts ran on that machine.",
      ],
    },
    wlVusers: {
      icon: "users",
      what: "Every virtual user: when it started and stopped (local time), how many iterations it completed and its average response time.",
      read: ["A VUser that stopped much earlier than the others, or completed far fewer iterations, probably hit errors — check the Errors tab for that VUser."],
    },

    // ── Insights tab ──
    insights: {
      icon: "bulb",
      what: "Automatic checks run on the raw results, written in plain language — what was found, and the evidence.",
      read: [
        "Checks include: was the planned load reached (pacing), did response times rise over time (trend), did behaviour change suddenly, were there spikes, did the load generators agree and stay healthy, errors, and SLAs.",
        "High = should be understood before sign-off; Medium = worth investigating; Low / Info = for awareness; Good = checked and fine.",
        "Changing the analysis window or the SLAs re-runs the checks.",
      ],
    },
  };

  /** Hover help for the transaction table columns. */
  const COLUMNS = {
    name: "Transaction name (a step the script measures, e.g. Login)",
    count: "How many times the transaction completed (passed + failed)",
    pass: "Executions that completed successfully",
    fail: "Executions that failed (an error stopped them)",
    failPct: "Failed as a percentage of all executions",
    min: "Fastest single execution (seconds)",
    avg: "Average response time (seconds)",
    max: "Slowest single execution (seconds)",
    sd: "Standard deviation — how much response times vary. Small = consistent, large = erratic",
    p50: "Median — half of the executions were faster than this",
    p90: "90 % of executions were this fast or faster (the usual SLA measure)",
    p95: "95 % of executions were this fast or faster",
    p98: "98 % of executions were this fast or faster",
    p99: "99 % of executions were this fast or faster — close to the worst cases",
    tps: "Transactions per second — how often it completed on average",
    sla: "Your target in seconds (compared with the P90, or the percentile chosen in settings)",
    result: "PASS when the percentile is within the SLA, FAIL when it is above",
    apdex: "User-satisfaction score from 0 to 1: 1 = all fast, below 0.85 = users would notice",
    trend: "Shape of the P90 over the test — a rising line means it got slower",
  };

  /** Hover help for the overview tiles. */
  const KPIS = {
    vusers: "The highest number of virtual users running at the same time",
    duration: "How long the test ran, from start to stop",
    steady: "The period between the end of the ramp-up and the start of the ramp-down — the results are based on this period",
    throughput: "Transactions per second (TPS): business steps completed per second during the steady state. This is not the data throughput in bytes — that is under Test statistics",
    passed: "Transaction executions that completed successfully, over the whole test",
    failed: "Transaction executions that failed (an error stopped them), over the whole test",
    errors: "Errors logged by the virtual users (from the LRE error log)",
    sla: "How many transactions met the SLA you entered",
    slowest: "The transaction with the highest P90 response time",
  };

  (root.LreRA = root.LreRA || {}).notes = { NOTES, COLUMNS, KPIS, ICONS, icon };
})(typeof self !== "undefined" ? self : this);
