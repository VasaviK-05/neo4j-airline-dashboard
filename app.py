from flask import Flask, render_template, jsonify
from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

driver = GraphDatabase.driver(
    os.getenv("NEO4J_URI"),
    auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD"))
)

def node_to_dict(node):
    return {
        "id": node["iata"],
        "label": node["name"],
        "city": node["city"] if "city" in node else "",
        "country": node["country"] if "country" in node else ""
    }

def dedupe_nodes_links(records):
    node_map = {}
    links = []
    link_set = set()

    for record in records:
        a = record.get("a")
        b = record.get("b")
        r = record.get("r")

        if a:
            node_map[a["iata"]] = node_to_dict(a)
        if b:
            node_map[b["iata"]] = node_to_dict(b)

        if a and b and r:
            key = (a["iata"], b["iata"], type(r).__name__)
            if key not in link_set:
                link_set.add(key)
                links.append({
                    "source": a["iata"],
                    "target": b["iata"],
                    "label": "FLIES_TO"
                })

    return {"nodes": list(node_map.values()), "links": links}

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/stats")
def stats():
    try:
        with driver.session(database=os.getenv("NEO4J_DATABASE")) as session:
            result = session.run("""
                MATCH (a:Airport)
                WITH count(a) AS airports
                MATCH ()-[r:FLIES_TO]->()
                RETURN airports, count(r) AS routes
            """)
            record = result.single()
            return jsonify({
                "airports": record["airports"],
                "routes": record["routes"]
            })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/top-hubs")
def top_hubs():
    try:
        with driver.session(database=os.getenv("NEO4J_DATABASE")) as session:
            result = session.run("""
                MATCH (a:Airport)-[r:FLIES_TO]->()
                WITH a, count(r) AS routes
                RETURN a.iata AS iata, a.name AS name, a.city AS city, a.country AS country, routes
                ORDER BY routes DESC
                LIMIT 8
            """)
            return jsonify([dict(record) for record in result])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/direct/<iata>")
def direct(iata):
    try:
        with driver.session(database=os.getenv("NEO4J_DATABASE")) as session:
            result = session.run("""
                MATCH (a:Airport {iata: $iata})-[r:FLIES_TO]->(b:Airport)
                RETURN a, r, b
                LIMIT 80
            """, iata=iata.upper())
            return jsonify(dedupe_nodes_links(result))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/path/<src>/<dst>")
def shortest_path(src, dst):
    try:
        with driver.session(database=os.getenv("NEO4J_DATABASE")) as session:
            result = session.run("""
                MATCH path = shortestPath((a:Airport {iata: $src})-[:FLIES_TO*]-(b:Airport {iata: $dst}))
                RETURN path
            """, src=src.upper(), dst=dst.upper())

            record = result.single()
            if not record or not record["path"]:
                return jsonify({"nodes": [], "links": [], "message": "No path found"})

            path = record["path"]
            node_map = {}
            links = []
            link_set = set()

            for node in path.nodes:
                node_map[node["iata"]] = node_to_dict(node)

            for rel in path.relationships:
                start = rel.nodes[0]["iata"]
                end = rel.nodes[1]["iata"]
                key = (start, end, "FLIES_TO")
                if key not in link_set:
                    link_set.add(key)
                    links.append({
                        "source": start,
                        "target": end,
                        "label": "FLIES_TO"
                    })

            return jsonify({"nodes": list(node_map.values()), "links": links})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/multihop/<iata>")
def multihop(iata):
    try:
        with driver.session(database=os.getenv("NEO4J_DATABASE")) as session:
            result = session.run("""
                MATCH (start:Airport {iata: $iata})-[r1:FLIES_TO]->(mid:Airport)
                OPTIONAL MATCH (mid)-[r2:FLIES_TO]->(dest:Airport)
                RETURN start, r1, mid, r2, dest
                LIMIT 120
            """, iata=iata.upper())

            node_map = {}
            links = []
            link_set = set()

            for record in result:
                start = record["start"]
                mid = record["mid"]
                dest = record["dest"]

                if start:
                    node_map[start["iata"]] = node_to_dict(start)
                if mid:
                    node_map[mid["iata"]] = node_to_dict(mid)
                if dest:
                    node_map[dest["iata"]] = node_to_dict(dest)

                if start and mid:
                    k1 = (start["iata"], mid["iata"], "FLIES_TO")
                    if k1 not in link_set:
                        link_set.add(k1)
                        links.append({
                            "source": start["iata"],
                            "target": mid["iata"],
                            "label": "FLIES_TO"
                        })

                if mid and dest:
                    k2 = (mid["iata"], dest["iata"], "FLIES_TO")
                    if k2 not in link_set:
                        link_set.add(k2)
                        links.append({
                            "source": mid["iata"],
                            "target": dest["iata"],
                            "label": "FLIES_TO"
                        })

            return jsonify({"nodes": list(node_map.values()), "links": links})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/airport/<iata>")
def airport_details(iata):
    try:
        with driver.session(database=os.getenv("NEO4J_DATABASE")) as session:
            result = session.run("""
                MATCH (a:Airport {iata: $iata})
                OPTIONAL MATCH (a)-[r:FLIES_TO]->()
                RETURN a.name AS name, a.city AS city, a.country AS country, a.iata AS iata, count(r) AS outgoing
            """, iata=iata.upper())
            record = result.single()

            if not record or record["name"] is None:
                return jsonify({"error": "Airport not found"}), 404

            return jsonify(dict(record))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)