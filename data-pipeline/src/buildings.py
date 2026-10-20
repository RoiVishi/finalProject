"""Which projects count as BUILDINGS — the single source of truth for corpus v3 (registry v6, RR-21c).

The product predicts risk on building projects. Training on other domains (bridges, plants,
oil & gas, UK infrastructure) did not help the building domain (RR-16, RR-21), and removing the
non-building projects of our own corpus was the largest single improvement measured for a NEW
building project (RR-21c: leave-one-project-out median AUC 0.551 → 0.623 on `grew`).

Own corpus (Buildings.Historical.Data): despite its name, 5 of the 15 labeled projects are not
buildings. Classified 20.10.2026 from WBS names, task names and resource names in the raw P6
tables (PROJWBS / TASK / RSRC) — the reason for every decision is recorded below so a reviewer
can check it. DSLIB (Ghent): the corpus's own sector field; only projects whose tracking the
authors flag as authentic ("G") are used — adding the non-authentic building projects did not
help (RR-21b).
"""
from __future__ import annotations

import pandas as pd

OWN_BUILDINGS: dict[str, str] = {
    "129 trial": "GRG and HDF finishing, concrete (same schedule family as 130 TRIAL)",
    "130 TRIAL": "GRG and HDF finishing, concrete",
    "CCA R03 dt 24Oct11SC": "clinic — WBS 'All Areas - Clinic', public areas, HV/LV rooms, sprinklers, lifts",
    "PORTO MATROUH": "hotel — WBS 'HOTEL AREA', 'Building 1'; slabs, columns, footings",
    "Update 01-09-2010": "multi-storey frame — WBS 'Ground Floor' .. '6th Floor'",
    "cairo alex-road": "WBS 'Architectural Design Template for Mid Rise Commercial Office' (name is misleading)",
    "jumaira": "Jumeirah Islands apartments — tiles, doors, fire alarm, ducts",
    "rehab-2": "building rehabilitation — CSI divisions 03/04/08/10/12/16, resource 'Edison High' (school)",
    "update of jungle 20-07-2010": "villa — WBS 'Villa Number D9'; foundations, brickwork, plastering",
}

OWN_NOT_BUILDINGS: dict[str, str] = {
    "Convention _ Exhibition Center Project Roads _ Utilities": "bridge — box girder, piers, abutments",
    "Detailed Program": "bridge approach slabs (keystone, elastomeric)",
    "EBCF-4 070127 Forecast Original": "industrial plant — piping, equipment, plant layout",
    "Petrofac": "storage tanks — shell welding, tank erection",
    "hela-2l": "oil & gas — piping, valves, sea fastening (GUPCO)",
}

OWN_UNKNOWN: dict[str, str] = {
    "trial for me": "15 labels, no WBS/task/resource names to classify by — excluded",
}

DSLIB_BUILDING_GROUP = "buildings"   # rr17_dslib_etl.sector_group: residential / commercial / institutional
DSLIB_AUTHENTIC_FLAG = "G"           # DSLIB_Analysis_Sheet tracking authenticity


def own_buildings(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["project"].isin(OWN_BUILDINGS)]


def dslib_buildings(df: pd.DataFrame) -> pd.DataFrame:
    return df[(df["sector_group"] == DSLIB_BUILDING_GROUP)
              & (df["auth_tracking"].astype(str) == DSLIB_AUTHENTIC_FLAG)]
