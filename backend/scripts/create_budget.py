"""Configure project-scoped billing alerts. Does not cap spending or change billing linkage."""

import argparse

import google.auth
from google.auth.transport.requests import AuthorizedSession

parser = argparse.ArgumentParser()
parser.add_argument("--billing-account", required=True)
parser.add_argument("--project-number", required=True)
parser.add_argument("--currency", default="INR")
parser.add_argument("--amount", default="5000")
args = parser.parse_args()
credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
http = AuthorizedSession(credentials)
base = f"https://billingbudgets.googleapis.com/v1/billingAccounts/{args.billing_account}/budgets"
body = {
    "displayName": "PlantSense prototype",
    "budgetFilter": {"projects": ["projects/" + args.project_number], "calendarPeriod": "MONTH"},
    "amount": {"specifiedAmount": {"currencyCode": args.currency, "units": args.amount}},
    "thresholdRules": [{"thresholdPercent": x, "spendBasis": "CURRENT_SPEND"} for x in (0.2, 0.5, 0.8, 1)],
}
response = http.get(base, timeout=30)
response.raise_for_status()
existing = next(
    (b for b in response.json().get("budgets", []) if b["displayName"] == body["displayName"]), None
)
if existing:
    body["name"] = existing["name"]
    response = http.patch(
        "https://billingbudgets.googleapis.com/v1/" + existing["name"],
        params={"updateMask": "amount,budgetFilter,thresholdRules"},
        json=body,
        timeout=30,
    )
else:
    response = http.post(base, json=body, timeout=30)
response.raise_for_status()
print("Configured budget notifications at 20%, 50%, 80%, and 100% of the supplied monthly project budget.")
