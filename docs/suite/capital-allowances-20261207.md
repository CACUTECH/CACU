# Capital allowances (R4, Nigeria Tax Act 2025)

Capital allowances are tax depreciation on the fixed asset register, worked out for the company income tax computation. They are kept apart from the depreciation in the books: **nothing here posts to the ledger.**

The feature is off until a tax professional confirms the rules (`accounting.capital_allowance_switch`). It is on for CACU's preview business.

## CACU's reading of the Act

The Act took effect on 1 January 2026. CACU's reading follows PwC Worldwide Tax Summaries (reviewed 29 May 2026), checked against Qeeva Advisory's guide. Every point below is for the reviewer to confirm.

- **No initial allowance.** Each asset gets an **annual allowance**, straight-line on its qualifying cost, at its class's rate:

  | Rate | Classes |
  | --- | --- |
  | 10% | Building, mast, heavy transportation, intangible assets, agricultural |
  | 20% | Plant, agricultural equipment, furniture and fittings, mining, other equipment |
  | 25% | Motor vehicle, software, other capital expenditure |

- **Which years:** a full year's allowance in each tax year the asset is held, starting with the year it was bought (or brought into CACU). There is none in the year it is disposed of.
- **1% kept:** 1% of the cost stays as the tax written-down value until disposal, so at most 99% is ever allowed.
- **Qualifying:** an asset qualifies only where any VAT due on it was charged, or import duty paid where it was imported. The owner marks an asset that doesn't qualify, with a note.
- **On disposal:** proceeds above the tax written-down value are a **balancing charge** (taxable). Proceeds below it are shown as a **balancing allowance**.
- **Assets owned before CACU:** they carry the allowances already claimed under earlier law, and only what is left of the 99% is allowed.
- **Tax years** end on the last day of the business's year-end month: 31 December unless it sets another month on the Income Tax Estimate page.

## Default classes

Each kind of asset in the register takes a default class. The owner can choose another on any asset, for example heavy transport for a truck, or software for a licence.

| Kind of asset | Default class |
| --- | --- |
| Land and buildings | Building (10%) |
| Motor vehicles | Motor vehicle (25%) |
| Plant and machinery | Plant (20%) |
| Furniture and fittings | Furniture and fittings (20%) |
| Computers and phones | Other equipment (20%) |
| Other equipment | Other capital expenditure (25%) |

## Screen

On **Accounting › Fixed Assets**, a **Capital allowances (tax)** card shows the following for a chosen year:

- the totals: capital allowances, balancing charges and balancing allowances;
- each asset's class, its start-of-year and end-of-year tax written-down value, and its allowance;
- a notice that the rates are still to be confirmed by a tax professional.

Owners and Admins set each asset's tax details: its class, whether it qualifies, any allowances already claimed before CACU, and a note.

## API

- `GET /fixed-assets/capital-allowances/{year}`: needs `ledger.view`.
- `PUT /fixed-assets/{asset_id}/tax`: Owner or Admin.

Both refuse while the switch is off for the business.

## To confirm before release (tax professional)

1. **The rates and classes.** The sources disagree on agricultural equipment (10% or 20%) and on intangibles.
2. **Allowance years:** whether a full year is allowed in the year an asset is bought, and none in the year it is sold.
3. **Disposals:** whether a balancing allowance is still given, or only the charge on proceeds above the tax written-down value.
4. **Assets partly used** for non-taxable income: the allowance is prorated unless that income is under 10% of the total. This is not modelled yet.
5. **Assets owned before 2026:** the transitional rule for remaining years (the years already claimed are deducted).
6. **The 1% kept:** whether it is held back from the allowance, as CACU does now, or recorded only notionally.

Once confirmed, set `reviewed_at` on `accounting.capital_allowance_rate`, and turn on `accounting.capital_allowance_switch` in production.
