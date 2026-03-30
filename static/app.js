let network = null;

const viewMeta = {
  overview: {
    title: "Overview",
    subtitle: "Graph-first airline intelligence powered by Neo4j"
  },
  explorer: {
    title: "Airport Explorer",
    subtitle: "Inspect direct route neighborhoods from any airport"
  },
  pathfinder: {
    title: "Path Finder",
    subtitle: "Visualize shortest route chains between source and destination"
  },
  multihop: {
    title: "Multi-Hop",
    subtitle: "Expand first-hop and second-hop route connectivity"
  },
  hubs: {
    title: "Hub Network",
    subtitle: "Reveal the densest airport hubs and their route clusters"
  }
};

function setView(view) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  document.querySelectorAll(".panel-view").forEach(panel => {
    panel.classList.toggle("active", panel.id === view);
  });

  document.getElementById("viewTitle").textContent = viewMeta[view].title;
  document.getElementById("viewSubtitle").textContent = viewMeta[view].subtitle;
}

function showGraphPlaceholder(message) {
  const graph = document.getElementById("graph");
  if (network) {
    network.destroy();
    network = null;
  }
  graph.innerHTML = `<div class="graph-placeholder">${message}</div>`;
}

function renderGraph(data) {
  const container = document.getElementById("graph");
  container.innerHTML = "";

  const nodeList = data.nodes || [];
  const edgeList = data.links || [];

  if (!nodeList.length) {
    showGraphPlaceholder("No graph data available for this view.");
    return;
  }

  const nodes = new vis.DataSet(
    nodeList.map(n => ({
      id: n.id,
      label: n.id,
      title: `
        <div style="padding:6px 8px">
          <strong>${n.label}</strong><br>
          ${n.city || ""}${n.city && n.country ? ", " : ""}${n.country || ""}
        </div>
      `,
      shape: "dot",
      size: 18,
      color: {
        background: "#32d6c7",
        border: "#d7fff9",
        highlight: {
          background: "#d6b36a",
          border: "#fff1cf"
        }
      },
      font: {
        color: "#dff7ff",
        size: 12,
        face: "Inter"
      }
    }))
  );

  const edges = new vis.DataSet(
    edgeList.map((e, idx) => ({
      id: idx + 1,
      from: e.source,
      to: e.target,
      arrows: "to",
      label: e.label || "",
      color: {
        color: "rgba(214, 179, 106, 0.42)",
        highlight: "#7fdfff"
      },
      font: {
        color: "#8aa8b7",
        size: 10,
        strokeWidth: 0
      },
      smooth: {
        type: "dynamic"
      }
    }))
  );

  const options = {
    autoResize: true,
    physics: {
      stabilization: false,
      barnesHut: {
        gravitationalConstant: -5000,
        springLength: 150,
        springConstant: 0.035,
        damping: 0.18
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      navigationButtons: true,
      keyboard: true
    },
    nodes: {
      borderWidth: 1.6
    },
    edges: {
      width: 1.4
    }
  };

  if (network) {
    network.destroy();
  }

  network = new vis.Network(container, { nodes, edges }, options);
  setTimeout(() => {
    if (network) network.fit({ animation: true });
  }, 250);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }

  return data;
}

async function loadStats() {
  try {
    const stats = await fetchJson("/api/stats");
    document.getElementById("airportCount").textContent = stats.airports;
    document.getElementById("routeCount").textContent = stats.routes;
  } catch (err) {
    console.error("Stats failed:", err);
    document.getElementById("airportCount").textContent = "ERR";
    document.getElementById("routeCount").textContent = "ERR";
  }
}

async function loadTopHubsList() {
  try {
    const hubs = await fetchJson("/api/top-hubs");
    const box = document.getElementById("topHubsList");
    box.innerHTML = "";

    hubs.forEach(hub => {
      const div = document.createElement("div");
      div.className = "hub-item";
      div.innerHTML = `
        <div class="hub-name">${hub.name} (${hub.iata})</div>
        <div class="hub-meta">${hub.city}, ${hub.country} · ${hub.routes} routes</div>
      `;
      box.appendChild(div);
    });
  } catch (err) {
    console.error("Top hubs failed:", err);
    document.getElementById("topHubsList").textContent = "Could not load top hubs.";
  }
}

async function loadHubGraph() {
  try {
    const hubs = await fetchJson("/api/top-hubs");
    if (!hubs.length) {
      showGraphPlaceholder("No hub data found.");
      return;
    }

    const firstHub = hubs[0].iata;
    const data = await fetchJson(`/api/direct/${firstHub}`);
    renderGraph(data);
  } catch (err) {
    console.error("Hub graph failed:", err);
    showGraphPlaceholder("Could not load graph.");
  }
}

async function exploreAirport() {
  const iata = document.getElementById("explorerIata").value.trim().toUpperCase();
  if (!iata) return;

  try {
    const data = await fetchJson(`/api/direct/${iata}`);
    renderGraph(data);

    const details = await fetchJson(`/api/airport/${iata}`);
    document.getElementById("airportDetails").innerHTML = `
      <strong>${details.name} (${details.iata})</strong><br>
      ${details.city}, ${details.country}<br>
      Outgoing routes: ${details.outgoing}
    `;
  } catch (err) {
    console.error("Airport explorer failed:", err);
    document.getElementById("airportDetails").textContent = "Airport not found or data could not load.";
    showGraphPlaceholder("Could not load airport graph.");
  }
}

async function runPath() {
  const src = document.getElementById("pathSrc").value.trim().toUpperCase();
  const dst = document.getElementById("pathDst").value.trim().toUpperCase();
  if (!src || !dst) return;

  try {
    const data = await fetchJson(`/api/path/${src}/${dst}`);
    renderGraph(data);

    const box = document.getElementById("pathInfo");
    box.textContent = data.message ? data.message : `Path loaded: ${src} → ${dst}`;
  } catch (err) {
    console.error("Path failed:", err);
    document.getElementById("pathInfo").textContent = "Could not load shortest path.";
    showGraphPlaceholder("Could not load path graph.");
  }
}

async function runMultihop() {
  const iata = document.getElementById("multiIata").value.trim().toUpperCase();
  if (!iata) return;

  try {
    const data = await fetchJson(`/api/multihop/${iata}`);
    renderGraph(data);
  } catch (err) {
    console.error("Multihop failed:", err);
    showGraphPlaceholder("Could not load multi-hop graph.");
  }
}

function attachEvents() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.view);
    });
  });

  document.getElementById("explorerBtn").addEventListener("click", exploreAirport);
  document.getElementById("pathBtn").addEventListener("click", runPath);
  document.getElementById("multiBtn").addEventListener("click", runMultihop);
  document.getElementById("hubBtn").addEventListener("click", loadHubGraph);

  document.getElementById("explorerIata").addEventListener("keydown", (e) => {
    if (e.key === "Enter") exploreAirport();
  });

  document.getElementById("pathSrc").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runPath();
  });

  document.getElementById("pathDst").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runPath();
  });

  document.getElementById("multiIata").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runMultihop();
  });
}

async function init() {
  attachEvents();
  showGraphPlaceholder("Loading graph workspace...");
  await loadStats();
  await loadTopHubsList();
  await loadHubGraph();
}

init();