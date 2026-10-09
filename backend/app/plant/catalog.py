"""Transactional, versioned configuration. Existing installations keep their plant."""

import json

from fastapi import HTTPException

from app.core.events import now
from app.plant.configuration import PROFILE_TYPES, PlantConfiguration, hydraulic_template


def seed_catalog(db, plant_id):
    if db.execute("SELECT 1 FROM plant_configurations WHERE plant_id=?", (plant_id,)).fetchone():
        return
    name = db.execute("SELECT name FROM plants WHERE id=?", (plant_id,)).fetchone()[0]
    template = hydraulic_template(2, name)
    for area in template.areas:
        db.execute(
            "INSERT OR IGNORE INTO plant_areas VALUES (?,?,?)", (plant_id, area.id, area.model_dump_json())
        )
    for asset in template.assets:
        db.execute(
            "INSERT OR IGNORE INTO plant_assets VALUES (?,?,?,?)",
            (plant_id, asset.id, asset.area_id, asset.model_dump_json()),
        )
    for edge in template.dependencies:
        db.execute(
            "INSERT OR IGNORE INTO plant_dependencies VALUES (?,?,?,?)",
            (plant_id, edge.source, edge.target, edge.model_dump_json()),
        )
    catalog = read_catalog(db, plant_id)
    for area in catalog["areas"]:
        area.setdefault(
            "nominal_units_per_hour",
            100
            if any(asset["type"] == "press" and asset["area_id"] == area["id"] for asset in catalog["assets"])
            else 0,
        )
    for asset in catalog["assets"]:
        asset.pop("status", None)
        asset.setdefault(
            "diagnostic_profile",
            next((profile for profile, type in PROFILE_TYPES.items() if type == asset["type"]), None),
        )
    configuration = PlantConfiguration(name=name, **catalog)
    db.execute(
        "INSERT INTO plant_configurations VALUES (?,?,?,?)",
        (plant_id, 1, configuration.model_dump_json(), now()),
    )
    write_catalog(db, plant_id, configuration)


def read_catalog(db, plant_id):
    return {
        key: [
            json.loads(row[0])
            for row in db.execute(f"SELECT data FROM {table} WHERE plant_id=? ORDER BY rowid", (plant_id,))
        ]
        for key, table in (
            ("areas", "plant_areas"),
            ("assets", "plant_assets"),
            ("dependencies", "plant_dependencies"),
        )
    }


def configuration_view(db, plant_id):
    row = db.execute(
        "SELECT version,data FROM plant_configurations WHERE plant_id=? ORDER BY version DESC LIMIT 1",
        (plant_id,),
    ).fetchone()
    if not row:
        raise HTTPException(409, "Plant configuration is unavailable")
    return {"version": row[0], "configuration": json.loads(row[1])}


def write_catalog(db, plant_id, configuration):
    for table in ("plant_dependencies", "plant_assets", "plant_areas"):
        db.execute(f"DELETE FROM {table} WHERE plant_id=?", (plant_id,))
    for area in configuration.areas:
        db.execute("INSERT INTO plant_areas VALUES (?,?,?)", (plant_id, area.id, area.model_dump_json()))
    for asset in configuration.assets:
        db.execute(
            "INSERT INTO plant_assets VALUES (?,?,?,?)",
            (plant_id, asset.id, asset.area_id, asset.model_dump_json()),
        )
    for edge in configuration.dependencies:
        db.execute(
            "INSERT INTO plant_dependencies VALUES (?,?,?,?)",
            (plant_id, edge.source, edge.target, edge.model_dump_json()),
        )


def read_configuration(store, token, plant_id):
    from app.identity.staff_access import authorize, available

    available(store)
    with store.connection() as db:
        authorize(db, token, plant_id)
        return configuration_view(db, plant_id)


def activate_configuration(store, token, plant_id, request):
    from app.identity.staff_access import audit, authorize, available
    from app.telemetry.legacy_monitoring import is_enabled

    available(store)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        actor = authorize(db, token, plant_id, "plant.configure")["user"]
        if is_enabled(db, plant_id):
            raise HTTPException(409, "Pause and disable plant monitoring before changing the plant layout")
        current = configuration_view(db, plant_id)
        if request.expected_version != current["version"]:
            raise HTTPException(409, "Plant configuration changed; reload before applying your draft")
        for (data,) in db.execute("SELECT data FROM plant_workflows WHERE plant_id=?", (plant_id,)):
            state = json.loads(data)
            from app.core import config

            if (
                not config.INTERNAL_TEST_MODE
                and state.get("record_origin", "legacy_replay") != "plant_observation"
            ):
                continue
            if not state["incident"] or state["incident"]["state"] != "resolved":
                raise HTTPException(
                    409, "Resolve every open telemetry source and incident before changing the plant"
                )
        used = {
            row[0]
            for row in db.execute(
                "SELECT DISTINCT asset_id FROM plant_workflows WHERE plant_id=?", (plant_id,)
            )
        }
        assets = {asset.id: asset for asset in request.configuration.assets}
        source_assets = {
            row[0]
            for row in db.execute("SELECT asset_id FROM telemetry_sources WHERE plant_id=?", (plant_id,))
        }
        if not source_assets.issubset(assets):
            raise HTTPException(409, "Equipment mapped to telemetry sources must retain its ID")
        prior_assets = {asset["id"]: asset for asset in current["configuration"]["assets"]}
        if not used.issubset(assets) or any(assets[key].type != prior_assets[key]["type"] for key in used):
            raise HTTPException(
                409, "Equipment referenced by historical workflows must retain its ID and type"
            )
        if request.configuration.model_dump() == current["configuration"]:
            return current
        version = current["version"] + 1
        write_catalog(db, plant_id, request.configuration)
        db.execute("UPDATE plants SET name=? WHERE id=?", (request.configuration.name, plant_id))
        db.execute(
            "INSERT INTO plant_configurations VALUES (?,?,?,?)",
            (plant_id, version, request.configuration.model_dump_json(), now()),
        )
        audit(
            db,
            plant_id,
            actor,
            "plant.configuration_activated",
            f"Plant configuration v{version} activated: {len(assets)} assets across {len(request.configuration.areas)} areas",
        )
        return {"version": version, "configuration": request.configuration.model_dump()}
