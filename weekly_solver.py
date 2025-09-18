import sys, json
from ortools.sat.python import cp_model

DIFFERENT_YEAR_SERVICES = {"STROKE"} 
YEAR_DOMAIN = {2, 3, 4}             
CC_NAME = "CC"
ELECTIVE_NAME = "ELECTIVE"

HOLIDAY_WEEKS = {29, 30}  

def plan_cc(residents, weeks, other_weekly_slots):
    N = len(residents)
    model = cp_model.CpModel()


    C = {}  
    for r_i, _ in enumerate(residents):
        for w in range(1, weeks + 1):
            C[(r_i, w)] = model.NewBoolVar(f"C_r{r_i}_w{w}")

    S = {}
    for w in range(1, weeks + 1):
        if w == 1 or w in HOLIDAY_WEEKS:
            s = model.NewIntVar(0, 0, f"S_w{w}")  
        else:
            ub = max(0, min(5, N - other_weekly_slots))
            lb = 0 if ub == 0 else 4
            s = model.NewIntVar(lb, ub, f"S_w{w}")
        S[w] = s

    for w in range(1, weeks + 1):
        model.Add(sum(C[(r_i, w)] for r_i, _ in enumerate(residents)) == S[w])

    WINDOW = 6
    for r_i, _ in enumerate(residents):
        for t in range(1, weeks - WINDOW + 2):
            model.Add(sum(C[(r_i, w)] for w in range(t, t + WINDOW)) <= 1)

    lo = max(0, (weeks - 1) // 6 - 1)
    hi = (weeks + 5) // 6 + 1
    for r_i, _ in enumerate(residents):
        tot = model.NewIntVar(0, weeks, f"tot_cc_r{r_i}")
        model.Add(tot == sum(C[(r_i, w)] for w in range(1, weeks + 1)))
        model.Add(tot >= lo)
        model.Add(tot <= hi)

    off_penalties = []
    for r_i, r in enumerate(residents):
        off = set(int(w) for w in (r.get("offWeeks") or []) if 1 <= int(w) <= weeks)
        for w in off:
            off_penalties.append(C[(r_i, w)])

    first_window_penalties = []
    hi_first = min(6, weeks)
    for r_i, _ in enumerate(residents):
        got = model.NewIntVar(0, 1, f"got_first_win_r{r_i}")
        model.Add(got == sum(C[(r_i, w)] for w in range(2, hi_first + 1)))
        miss = model.NewIntVar(0, 1, f"miss_first_win_r{r_i}")
        model.Add(miss == 1 - got)
        first_window_penalties.append(miss)

    model.Minimize(10 * sum(off_penalties) + 2 * sum(first_window_penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, None

    cc_plan = {(r_i, w): int(solver.Value(C[(r_i, w)]))
               for r_i, _ in enumerate(residents) for w in range(1, weeks + 1)}
    slots_plan = {w: int(solver.Value(S[w])) for w in range(1, weeks + 1)}
    return cc_plan, slots_plan


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


def build_multiweek_schedule(residents_raw, services_raw, weeks: int):
    services = [_norm_service(s) for s in services_raw]
    residents = [_norm_resident(r) for r in residents_raw]

    cc = next((s for s in services if s["name"] == CC_NAME), None)
    elective_present = any(s["name"] == ELECTIVE_NAME for s in services)
    fixed_services = [s for s in services if s["name"] != ELECTIVE_NAME]

    other_weekly_slots = sum(s["slotsPerWeek"] for s in fixed_services if s["name"] != CC_NAME)

    N = len(residents)
    for s in fixed_services:
        total_slots = weeks * (s["slotsPerWeek"] if s["name"] != CC_NAME else 5)
        if total_slots < N:
            raise ValueError(
                f"Infeasible: service '{s['name']}' has only {total_slots} total slots "
                f"over {weeks} weeks, but there are {N} residents. Increase slots or weeks."
            )
            

    cc_plan, slots_plan = (None, {w: 0 for w in range(1, weeks + 1)})
    if cc is not None:
        cc_plan, slots_plan = plan_cc(residents, weeks, other_weekly_slots)
        if cc_plan is None:
            return None
        
    for w in range(1, weeks + 1):
        need = other_weekly_slots + (slots_plan[w] if cc is not None else 0)
        if need > N:
            raise ValueError(f"Infeasible: week {w} needs {need} fixed slots but only {N} residents.")

    model = cp_model.CpModel()

    X = {}
    for r_i, _ in enumerate(residents):
        for s in fixed_services:
            s_name = s["name"]
            for w in range(1, weeks + 1):
                slots_here = s["slotsPerWeek"]
                if s_name == CC_NAME:
                    slots_here = slots_plan[w]
                for k in range(slots_here):
                    X[(r_i, s_name, w, k)] = model.NewBoolVar(f"x_r{r_i}_{s_name}_w{w}_k{k}")
    E = {}
    if elective_present:
        for r_i, _ in enumerate(residents):
            for w in range(1, weeks + 1):
                E[(r_i, w)] = model.NewBoolVar(f"elective_r{r_i}_w{w}")

    OFF = {}
    for r_i, _ in enumerate(residents):
        for w in range(1, weeks + 1):
            OFF[(r_i, w)] = model.NewBoolVar(f"OFF_r{r_i}_w{w}")


    for s in fixed_services:
        s_name = s["name"]
        for w in range(1, weeks + 1):
            slots_here = s["slotsPerWeek"]
            if s_name == CC_NAME:
                slots_here = slots_plan[w]
            for k in range(slots_here):
                model.Add(sum(X[(r_i, s_name, w, k)] for r_i, _ in enumerate(residents)) == 1)

    for r_i, _ in enumerate(residents):
        for w in range(1, weeks + 1):
            fixed_sum = sum(
                X[(r_i, s["name"], w, k)]
                for s in fixed_services
                for k in range(slots_plan[w] if s["name"] == CC_NAME else s["slotsPerWeek"])
            )
            if elective_present:
                model.Add(OFF[(r_i, w)] + E[(r_i, w)] + fixed_sum == 1)
            else:
                model.Add(OFF[(r_i, w)] + fixed_sum == 1)

    for r_i, r in enumerate(residents):
        for w in (r.get("offWeeks") or []):
            if 1 <= int(w) <= weeks:
                model.Add(OFF[(r_i, int(w))] == 1)

    for r_i, _ in enumerate(residents):
        model.Add(sum(OFF[(r_i, w)] for w in range(1, weeks + 1)) == 5)

    H = [h for h in HOLIDAY_WEEKS if 1 <= h <= weeks]
    if len(H) == 2:
        wA, wB = H

        for r_i in range(N):
            model.Add(OFF[(r_i, wA)] + OFF[(r_i, wB)] == 1)

        half_lo = N // 2
        half_hi = N - half_lo
        flip = model.NewBoolVar("holiday_flip") 

        model.Add(
            sum(OFF[(r_i, wA)] for r_i in range(N))
            == half_lo + (half_hi - half_lo) * (1 - flip)
        )
        model.Add(
            sum(OFF[(r_i, wB)] for r_i in range(N))
            == half_lo + (half_hi - half_lo) * flip
        )

    elif len(H) == 1:
        h = H[0]
        for r_i in range(N):
            model.Add(OFF[(r_i, h)] == 1)

    for s in fixed_services:
        if s["name"] in DIFFERENT_YEAR_SERVICES:
            for w in range(1, weeks + 1):
                slots_here = s["slotsPerWeek"] if s["name"] != CC_NAME else slots_plan[w]
                if slots_here >= 2:
                    for y in YEAR_DOMAIN:
                        model.Add(sum(
                            X[(r_i, s["name"], w, k)]
                            for r_i, r in enumerate(residents) if r["year"] == y
                            for k in range(slots_here)
                        ) <= 1)

    if cc is not None:
        for w in range(1, weeks + 1):
            slots_here = slots_plan[w]
            for r_i, _ in enumerate(residents):
                want = cc_plan[(r_i, w)]
                if slots_here == 0 and want == 0:
                    continue
                model.Add(sum(X[(r_i, CC_NAME, w, k)] for k in range(slots_here)) == want)

    for r_i, _ in enumerate(residents):
        for s in fixed_services:
            if s["name"] in (CC_NAME, ELECTIVE_NAME):
                continue
            total_for_service = sum(
                X[(r_i, s["name"], w, k)]
                for w in range(1, weeks + 1)
                for k in range(s["slotsPerWeek"])
            )
            model.Add(total_for_service >= 1)

    service_spreads = []
    for s in fixed_services:
        if s["name"] in (CC_NAME, ELECTIVE_NAME):
            continue
        counts = []
        for r_i, _ in enumerate(residents):
            cnt = model.NewIntVar(0, weeks, f"cnt_{s['name']}_r{r_i}")
            model.Add(cnt == sum(
                X[(r_i, s["name"], w, k)]
                for w in range(1, weeks + 1)
                for k in range(s["slotsPerWeek"])
            ))
            counts.append(cnt)
        s_max = model.NewIntVar(0, weeks, f"{s['name']}_max")
        s_min = model.NewIntVar(0, weeks, f"{s['name']}_min")
        for cnt in counts:
            model.Add(cnt <= s_max)
            model.Add(cnt >= s_min)
        spread = model.NewIntVar(0, weeks, f"{s['name']}_spread")
        model.Add(spread == s_max - s_min)
        service_spreads.append(spread)

    model.Minimize(5 * sum(service_spreads))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 20.0
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    weeks_out = []
    for w in range(1, weeks + 1):
        week_asg = []
        week_off = []
        for r_i, r in enumerate(residents):
            if solver.Value(OFF[(r_i, w)]) == 1:
                week_off.append({
                    "residentId": str(r.get("_id") or ""),
                    "residentName": r.get("name"),
                    "residentEmail": r.get("email"),
                    "residentYear": int(r.get("year", 0)),
                })

        for s in fixed_services:
            slots_here = slots_plan[w] if s["name"] == CC_NAME else s["slotsPerWeek"]
            for k in range(slots_here):
                for r_i, r in enumerate(residents):
                    if solver.Value(X[(r_i, s["name"], w, k)]) == 1:
                        week_asg.append({
                            "service": s["name"],
                            "slot": int(k),
                            "residentId": str(r.get("_id") or ""),
                            "residentName": r.get("name"),
                            "residentEmail": r.get("email"),
                            "residentYear": int(r.get("year", 0)),
                        })
                        break

        if elective_present:
            e_slot = 0
            for r_i, r in enumerate(residents):
                if solver.Value(E[(r_i, w)]) == 1:
                    week_asg.append({
                        "service": ELECTIVE_NAME,
                        "slot": e_slot,
                        "residentId": str(r.get("_id") or ""),
                        "residentName": r.get("name"),
                        "residentEmail": r.get("email"),
                        "residentYear": int(r.get("year", 0)),
                    })
                    e_slot += 1

        weeks_out.append({
            "week": w,
            "feasible": True,
            "assignments": week_asg,
            "weekOff": week_off,
            "ccCapacity": (0 if cc is None else int(slots_plan[w])),
        })
    return weeks_out


def main():
    data = json.load(sys.stdin)
    residents = data["residents"]
    services  = data["services"]
    weeks     = int(data.get("weeks", 27))

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
