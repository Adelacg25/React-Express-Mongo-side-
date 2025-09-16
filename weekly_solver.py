import sys, json
from ortools.sat.python import cp_model

DIFFERENT_YEAR_SERVICES = {"STROKE"} 
YEAR_DOMAIN = {2, 3, 4}             

def _norm_service(s):
    name = str(s.get("Service") or s.get("name") or "").upper().strip()
    slots = int(s.get("residentsRequired", 1) or 1)
    return {"name": name, "slotsPerWeek": max(1, slots)}

def _norm_resident(r):
    y = int(r.get("year"))
    if y not in YEAR_DOMAIN:
        raise ValueError(f"Resident {r.get('name')} has year={y}; expected one of {sorted(YEAR_DOMAIN)}")

    raw_off = r.get("weeksOff") or r.get("weeksoff") or []
    try:
        off_weeks = [int(w) for w in raw_off]
    except Exception:
        off_weeks = []

    return {
        "_id": r.get("_id"),
        "name": r.get("name"),
        "email": r.get("email") or "",
        "year": y,
        "offWeeks": off_weeks,                  
    }


def build_multiweek_schedule(residents_raw, services_raw, weeks: int,):
    services = [_norm_service(s) for s in services_raw]
    residents = [_norm_resident(r) for r in residents_raw]

    N = len(residents)
    for s in services:
        total_slots = weeks * s["slotsPerWeek"]
        if total_slots < N:
            raise ValueError(
                f"Infeasible: service '{s['name']}' has only {total_slots} total slots "
                f"over {weeks} weeks, but there are {N} residents. Increase slots or weeks."
            )

    model = cp_model.CpModel()

    X = {}
    for r_i, r in enumerate(residents):
        for s in services:
            s_name = s["name"]
            for w in range(1, weeks + 1):
                for k in range(s["slotsPerWeek"]):
                    v = model.NewBoolVar(f"x_r{r_i}_{s_name}_w{w}_k{k}")
                    X[(r_i, s_name, w, k)] = v

    for s in services:
        s_name = s["name"]
        for w in range(1, weeks + 1):
            for k in range(s["slotsPerWeek"]):
                model.Add(sum(X[(r_i, s_name, w, k)] for r_i, _ in enumerate(residents)) == 1)

    for r_i, _ in enumerate(residents):
        for w in range(1, weeks + 1):
            model.Add(sum(
                X[(r_i, s["name"], w, k)]
                for s in services
                for k in range(s["slotsPerWeek"])
            ) <= 1)

    for s in services:
        if s["name"] in DIFFERENT_YEAR_SERVICES and s["slotsPerWeek"] >= 2:
            for w in range(1, weeks + 1):
                for y in YEAR_DOMAIN:
                    model.Add(sum(
                        X[(r_i, s["name"], w, k)]
                        for r_i, r in enumerate(residents) if r["year"] == y
                        for k in range(s["slotsPerWeek"])
                    ) <= 1)

    for r_i, _ in enumerate(residents):
        for s in services:
            total_for_service = sum(
                X[(r_i, s["name"], w, k)]
                for w in range(1, weeks + 1)
                for k in range(s["slotsPerWeek"])
            )
            model.Add(total_for_service >= 1)

    pref_flags = []  

    for r_i, r in enumerate(residents):
        offset = set(int(w) for w in (r.get("offWeeks") or []) if 1 <= int(w) <= weeks)
        for w in offset:
            sum_week = sum(
                X[(r_i, s["name"], w, k)]
                for s in services
                for k in range(s["slotsPerWeek"])
            )
            a = model.NewBoolVar(f"pref_violation_r{r_i}_w{w}")
            model.Add(a == sum_week) 
            pref_flags.append(a)

    loads = []
    for r_i, _ in enumerate(residents):
        ld = model.NewIntVar(0, weeks, f"load_r{r_i}")
        model.Add(ld == sum(
            X[(r_i, s["name"], w, k)]
            for s in services for w in range(1, weeks + 1) for k in range(s["slotsPerWeek"])
        ))
        loads.append(ld)
    max_load = model.NewIntVar(0, weeks, "max_load")
    for ld in loads:
        model.Add(ld <= max_load)
    PENALTY_WEIGHT = 1  
    model.Minimize(max_load * 1000 + PENALTY_WEIGHT * sum(pref_flags))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 15.0
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    weeks_out = []
    for w in range(1, weeks + 1):
        week_asg = []
        week_off = []
        for r_i, r in enumerate(residents):
            if w in set(r.get("offWeeks", [])):
                week_off.append({
                    "residentId": str((r or {}).get("_id") or ""),
                    "residentName": (r or {}).get("name"),
                    "residentEmail": (r or {}).get("email"),
                    "residentYear": int((r or {}).get("year", 0)),
                })

        for s in services:
            for k in range(s["slotsPerWeek"]):
                for r_i, r in enumerate(residents):
                    if solver.Value(X[(r_i, s["name"], w, k)]) == 1:
                        week_asg.append({
                            "service": s["name"],
                            "slot": int(k),
                            "residentId": str((r or {}).get("_id") or ""),
                            "residentName": (r or {}).get("name"),
                            "residentEmail": (r or {}).get("email"),
                            "residentYear": int((r or {}).get("year", 0)),
                        })
                        break

        weeks_out.append({
            "week": w,
            "feasible": True,
            "assignments": week_asg,
            "weekOff": week_off,   
        })
    return weeks_out


def main():
    data = json.load(sys.stdin)
    residents = data["residents"]
    services  = data["services"]
    weeks     = int(data.get("weeks", 27))
    rotation  = int(data.get("rotationLen", 10))

    try:
        weeks_out = build_multiweek_schedule(residents, services, weeks)
    except ValueError as e:
        print(json.dumps({"ok": False, "reason": "invalid_config", "message": str(e)}))
        return

    if weeks_out is None:
        print(json.dumps({"ok": False, "reason": "infeasible"}))
        return

    print(json.dumps({"ok": True, "weeks": weeks_out}))

if __name__ == "__main__":
    main()
